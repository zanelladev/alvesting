import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { RestError, type BlobServiceClient, type BlockBlobClient } from '@azure/storage-blob';
import pg from 'pg';
import {
  POLICY_TABLES,
  TABLE_POLICY,
  policyGaps,
} from '../../../infrastructure/database/table-policy.js';
import { requireBlob } from '../../../infrastructure/storage/blob-upload.js';
import {
  assertToolsMajor,
  collect,
  connectionArgs,
  databaseTarget,
  spawnNative,
  toolEnv,
  type DatabaseTarget,
  type Exit,
  type PgTool,
  type SpawnTool,
} from '../infrastructure/pg-tools.js';

// A restauração da temporada no Postgres da Azure (ADR 0039; docs/RUNBOOK.md, 13.6). O servidor é privado, então isto roda DENTRO do
// ambiente: uma execução do job-migrate com o comando trocado (`node dist/restore-cli.js temporada <dump> <sha256>`), que lê o dump do
// container `backups` pela identidade do migrate (só leitura nesse container, perfil econômico) e restaura no banco do DATABASE_URL (o
// administrador, que NÃO é superusuário no Flexible Server). Por isso:
//
//  - só DADOS, no esquema que as migrations já criaram (o job-migrate roda antes): o dump é o `pg_dump --data-only` do RUNBOOK, sem as tabelas
//    pessoais (a política de privacidade promete cópia com dado pessoal só pelo ponto de restauração de 7 dias, e o dump fica no `backups`)
//    e sem o `_prisma_migrations` (o controle das migrations é do destino). O pg_dump só de dados já põe as tabelas na ordem das chaves
//    estrangeiras (o esquema não tem ciclo), e o restaurado obedece a elas sem gatilho desligado: nada pede superusuário;
//  - o SHA-256 do dump (o `shasum -a 256` de quem o fez) é conferido ANTES de qualquer escrita: um dump trocado no container (o worker
//    escreve ali) não chega ao banco;
//  - numa TRANSAÇÃO só (o script do pg_restore aplicado pelo psql com --single-transaction e ON_ERROR_STOP): a conferência de que o destino
//    não tem temporada, sob a trava da tabela; o TRUNCATE do que os agendadores da Azure já gravaram nas tabelas que o dump traz (as notícias, o
//    job_run, o universo...: sem temporada, nada disso é resultado da arena); e os COPY do dump. Qualquer erro desfaz tudo. A trilha
//    (audit_log) só cresce (a do dump soma à do destino) e as tabelas pessoais (a conta de quem já se cadastrou no site novo) não são tocadas;
//  - depois, cada tabela restaurada tem de ter as linhas que o dump trazia (contadas no script, linha a linha) e o comando registra as
//    contagens no log da execução. Só números: nenhuma linha do banco vai para o log.

export const RESTORE_CONTAINER = 'backups';
// o nome de um arquivo do container, sem pasta (nada de `../` nem de outro container)
const DUMP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.dump$/;
const SHA256 = /^[0-9a-f]{64}$/;
// a trilha só cresce: a api só tem INSERT nela (ADR 0028), e nada a apaga
const APPEND_ONLY = new Set(['audit_log']);
// abaixo dos 900 s do job-migrate (replicaTimeout, infra/modules/containerapps.bicep)
const DEADLINE_MS = 12 * 60_000;
const QUERY_TIMEOUT_MS = 5 * 60_000;
const STDERR_IN_MESSAGE = 1500;

const SEASON_EXISTS = 'o destino já tem temporada';

export interface RestoreOptions {
  // o login ADMINISTRADOR do banco de destino (o DATABASE_URL do job-migrate)
  databaseUrl: string;
  blob: BlobServiceClient | undefined;
  blobName: string;
  // o SHA-256 do arquivo, em hexadecimal, que quem fez o dump anotou
  sha256: string;
  // só o teste troca (um container `azure-teste-*` do Azurite): na Azure é sempre o `backups`
  container?: string;
  // como criar o pg_restore e o psql: o PATH da imagem (padrão) ou, no teste local, o contêiner do projeto
  spawn?: SpawnTool;
  log?: (line: string) => void;
  deadlineMs?: number;
}

export interface RestoreResult {
  blob: string;
  bytes: number;
  sha256: string;
  // por tabela restaurada: as linhas que o dump trazia e as que o destino tem depois
  tables: Record<string, { dump: number; restored: number }>;
}

// As linhas de cada tabela da matriz (table-policy.ts): a mesma lista na origem (na máquina) e no destino (na Azure), para comparar.
export async function countTables(
  databaseUrl: string,
  tables: readonly string[] = POLICY_TABLES,
): Promise<Record<string, number>> {
  const client = connect(databaseUrl);
  await client.connect();
  try {
    return await count(client, tables);
  } finally {
    await client.end();
  }
}

export async function restoreSeason(options: RestoreOptions): Promise<RestoreResult> {
  const { blobName, sha256: expected } = options;
  if (!DUMP_NAME.test(blobName)) {
    throw new Error(
      `O nome do dump é o de um arquivo .dump do container, sem pasta (letras, números, ponto, hífen e sublinhado): "${blobName.slice(0, 80)}"`,
    );
  }
  if (!SHA256.test(expected)) {
    throw new Error(
      'O SHA-256 esperado do dump tem 64 hexadecimais minúsculos (o `shasum -a 256` do arquivo, na máquina que o fez)',
    );
  }
  const spawn = options.spawn ?? spawnNative;
  const log = options.log ?? (() => undefined);
  const signal = AbortSignal.timeout(options.deadlineMs ?? DEADLINE_MS);
  const target = databaseTarget(options.databaseUrl);
  const container = options.container ?? RESTORE_CONTAINER;
  const source = requireBlob(options.blob)
    .getContainerClient(container)
    .getBlockBlobClient(blobName);

  const client = connect(options.databaseUrl);
  await client.connect();
  const dir = await mkdtemp(path.join(tmpdir(), 'alvesting-restaurar-'));
  try {
    const { rows } = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    const serverMajor = Math.floor(Number(rows[0]!.server_version_num) / 10_000);
    await assertToolsMajor(spawn, ['pg_restore', 'psql'], serverMajor, target, signal);
    await assertMigrated(client);
    if ((await client.query('SELECT 1 FROM public.season LIMIT 1')).rowCount) {
      throw new Error(
        `${capitalize(SEASON_EXISTS)}: a restauração é só para o banco novo, sem temporada (docs/RUNBOOK.md, 13.6). Nada foi restaurado`,
      );
    }

    const file = path.join(dir, 'temporada.dump');
    const got = await download(source, file, signal, `${container}/${blobName}`);
    if (got.sha256 !== expected) {
      throw new Error(
        `O SHA-256 do dump (${got.sha256}) não é o esperado (${expected}): nada foi restaurado`,
      );
    }
    const tables = await dataTables(spawn, target, file, signal);
    log(
      `restauração: ${container}/${blobName} (${got.bytes} bytes, SHA-256 conferido), ${tables.length} tabelas`,
    );

    const before = await count(client, POLICY_TABLES);
    const dumped = await apply(spawn, target, file, tables, signal);
    const after = await count(client, POLICY_TABLES);

    const result: RestoreResult['tables'] = {};
    const wrong: string[] = [];
    for (const table of tables) {
      const dump = dumped.get(table) ?? 0;
      const want = APPEND_ONLY.has(table) ? before[table]! + dump : dump;
      result[table] = { dump, restored: after[table]! };
      if (after[table] !== want) wrong.push(`${table} (esperava ${want}, tem ${after[table]})`);
      log(`restauração: ${table} ${after[table]} linhas (${dump} do dump)`);
    }
    if (wrong.length > 0) {
      throw new Error(`Contagem diferente depois da restauração: ${wrong.join('; ')}`);
    }
    return { blob: blobName, bytes: got.bytes, sha256: got.sha256, tables: result };
  } finally {
    await rm(dir, { recursive: true, force: true });
    await client.end();
  }
}

function connect(databaseUrl: string): pg.Client {
  const client = new pg.Client({
    connectionString: databaseUrl,
    statement_timeout: QUERY_TIMEOUT_MS,
    application_name: 'alvesting-restore',
  });
  // a conexão que cai emite 'error', e sem ouvinte o Node derruba o processo; a consulta pendente falha por conta própria
  client.on('error', () => undefined);
  return client;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

async function count(client: pg.Client, tables: readonly string[]) {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.${client.escapeIdentifier(table)}`,
    );
    counts[table] = Number(rows[0]!.n);
  }
  return counts;
}

// O destino tem de ter exatamente o esquema das migrations desta imagem (o job-migrate roda antes): toda tabela classificada na matriz.
async function assertMigrated(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'`,
  );
  const { missing, extra } = policyGaps(rows.map((row) => row.relname));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `O banco de destino não tem o esquema das migrations desta imagem (rode o job-migrate antes; sem decisão na matriz: ${missing.join(', ') || 'nenhuma'}; faltando: ${extra.join(', ') || 'nenhuma'})`,
    );
  }
}

// O dump do container para um arquivo do processo (o diretório do mkdtemp é só dele), com o SHA-256 calculado no caminho.
async function download(
  blob: BlockBlobClient,
  file: string,
  signal: AbortSignal,
  label: string,
): Promise<{ sha256: string; bytes: number }> {
  let body: Readable;
  try {
    body = (await blob.download(0, undefined, { abortSignal: signal }))
      .readableStreamBody as Readable;
  } catch (error) {
    if (error instanceof RestError && error.statusCode === 404) {
      throw new Error(`O dump ${label} não está no Blob (o envio do RUNBOOK, 13.6, foi feito?)`, {
        cause: error,
      });
    }
    throw error;
  }
  const hash = createHash('sha256');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(body, tap, createWriteStream(file, { mode: 0o600 }));
  return { sha256: hash.digest('hex'), bytes };
}

// As tabelas cujo dado o dump traz, pelo índice dele (pg_restore --list), na ordem do arquivo. Recusa o dump que não é só de dados, o que leva
// as tabelas pessoais e o que traz tabela que a matriz não conhece (outra versão do esquema). O `_prisma_migrations` fica de fora.
// ponytail: só TABLE DATA; uma sequência no esquema (hoje os IDs são ULID) traria SEQUENCE SET, e esta lista teria de aceitá-lo.
async function dataTables(
  spawn: SpawnTool,
  target: DatabaseTarget,
  file: string,
  signal: AbortSignal,
): Promise<string[]> {
  const child = spawn('pg_restore', ['--list'], {
    env: toolEnv(target),
    signal,
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  const chunks: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  const feeding = settle(pipeline(createReadStream(file), child.stdin!));
  const [exit, feedError] = await Promise.all([collect(child, { stdout: false }), feeding]);
  if (exit.code !== 0) throw failed('pg_restore --list', exit);
  // o --list lê só o índice, no começo do arquivo, e sai com 0 sem esperar o resto: o que ele não leu volta como EPIPE (ou como o fim
  // antes da hora do fluxo), e não é erro. Sem isso, todo dump maior que o buffer do pipe (64 KB no Linux) virava "write EPIPE", o
  // bom e o ruim (o primeiro CI no GitHub pegou, com o pg_restore nativo; o do contêiner, no Mac, lê o stdin inteiro)
  if (feedError && !LEFTOVER.has((feedError as NodeJS.ErrnoException).code ?? '')) throw feedError;

  const tables: string[] = [];
  const personal: string[] = [];
  const unknown: string[] = [];
  const schema: string[] = [];
  for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
    if (line.trim() === '' || line.startsWith(';')) continue;
    const table = /^\d+; \d+ \d+ TABLE DATA public (\S+) \S+$/.exec(line)?.[1];
    if (table === undefined) schema.push(line);
    else if (table === '_prisma_migrations') continue;
    else if (!TABLE_POLICY[table]) unknown.push(table);
    else if (TABLE_POLICY[table].personal) personal.push(table);
    else tables.push(table);
  }
  if (schema.length > 0) {
    throw new Error(
      `O dump não é só de dados: tem ${schema.length} entradas de esquema (como "${schema[0]!.slice(0, 80)}"). Faça-o com o pg_dump --data-only do RUNBOOK, 13.6`,
    );
  }
  if (personal.length > 0) {
    throw new Error(
      `O dump traz o dado das tabelas pessoais (${personal.join(', ')}): faça-o com o --exclude-table-data de cada uma (docs/RUNBOOK.md, 13.6). Dado pessoal não fica no container backups`,
    );
  }
  if (unknown.length > 0) {
    throw new Error(
      `O dump tem tabela que a matriz desta imagem não conhece (${unknown.join(', ')}): é de outra versão do esquema`,
    );
  }
  if (tables.length === 0) throw new Error('O dump não traz dado de tabela nenhuma');
  return tables;
}

// As linhas de dados de cada COPY do script do pg_restore (entre `COPY public.<tabela> (...) FROM stdin;` e `\.`). Os bytes passam sem mudança.
function rowCounter() {
  const counts = new Map<string, number>();
  const decoder = new StringDecoder('utf8');
  let current: string | undefined;
  let rest = '';
  const header = /^COPY public\.(?:"((?:[^"]|"")+)"|([a-z_][a-z0-9_]*)) \(/;
  const line = (text: string) => {
    if (current === undefined) {
      const match = header.exec(text);
      if (match) {
        current = match[1]?.replaceAll('""', '"') ?? match[2]!;
        counts.set(current, 0);
      }
    } else if (text === '\\.') {
      current = undefined;
    } else {
      counts.set(current, counts.get(current)! + 1);
    }
  };
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const parts = (rest + decoder.write(chunk)).split('\n');
      rest = parts.pop()!;
      for (const part of parts) line(part);
      callback(null, chunk);
    },
    flush(callback) {
      const tail = rest + decoder.end();
      if (tail) line(tail);
      callback();
    },
  });
  return { stream, counts };
}

const quoted = (table: string) => `public."${table.replaceAll('"', '""')}"`;

// O que sobra no fluxo para um processo que já saiu de propósito (o pg_restore --list depois do índice).
const LEFTOVER = new Set(['EPIPE', 'ERR_STREAM_PREMATURE_CLOSE']);

// O fim de um fluxo (pipeline) sem rejeição: o erro, se houver, para ser lido DEPOIS do código de saída do processo (o que explica a falha).
const settle = (flow: Promise<unknown>): Promise<Error | undefined> =>
  flow.then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );

// O script do pg_restore (só os dados, só das tabelas escolhidas) aplicado pelo psql numa transação só, depois da conferência e do TRUNCATE.
async function apply(
  spawn: SpawnTool,
  target: DatabaseTarget,
  file: string,
  tables: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, number>> {
  const options = { env: toolEnv(target), signal, timeoutMs: QUERY_TIMEOUT_MS };
  const psql = spawn(
    'psql',
    [
      ...connectionArgs(target),
      `--dbname=${target.database}`,
      '--no-psqlrc',
      '--quiet',
      '--single-transaction',
      '--set=ON_ERROR_STOP=1',
      '--file=-',
    ],
    options,
  );
  const script = spawn(
    'pg_restore',
    ['--data-only', ...tables.map((table) => `--table=${table}`), '--file=-'],
    options,
  );
  const truncated = tables.filter((table) => !APPEND_ONLY.has(table));
  psql.stdin!.write(
    [
      // ninguém cria uma temporada no meio: a conferência vale até o COMMIT
      'LOCK TABLE public.season IN ACCESS EXCLUSIVE MODE;',
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.season) THEN RAISE EXCEPTION '${SEASON_EXISTS}: nada foi restaurado'; END IF; END $$;`,
      `TRUNCATE TABLE ${truncated.map(quoted).join(', ')};`,
      '',
    ].join('\n'),
  );
  const counter = rowCounter();
  const feeding = settle(pipeline(createReadStream(file), script.stdin!));
  const flowing = settle(pipeline(script.stdout as Readable, counter.stream, psql.stdin!));
  try {
    const [scriptExit, psqlExit, feedError, flowError] = await Promise.all([
      collect(script, { stdout: false }),
      collect(psql, { stdout: false }),
      feeding,
      flowing,
    ]);
    // o erro do psql é o que explica (a transação desfeita); o do fluxo (EPIPE) é só o efeito de um dos dois ter parado antes
    if (psqlExit.code !== 0) throw failed('psql', psqlExit);
    if (scriptExit.code !== 0) throw failed('pg_restore', scriptExit);
    if (feedError) throw feedError;
    if (flowError) throw flowError;
    return counter.counts;
  } finally {
    script.kill('SIGKILL');
    psql.kill('SIGKILL');
  }
}

const failed = (tool: PgTool | `${PgTool} --list`, exit: Exit) =>
  new Error(
    `${tool} saiu com ${exit.code ?? exit.signal}: ${exit.stderr.trim().slice(-STDERR_IN_MESSAGE)}`,
  );

// A outra metade de levar a temporada (docs/RUNBOOK.md, 13.6): os arquivos do Blob da temporada local (os containers `temporada-briefings` e
// `temporada-llm-io` do Azurite, src/temporada/pieces.ts) para uma pasta, com os mesmos nomes, de onde o `az storage blob upload-batch
// --auth-mode login` os leva aos containers da conta. A leitura do briefing usa o pregão e o SHA-256 do nome, então o nome não pode mudar.
// `containers` diz de onde para onde; o teste usa um prefixo próprio no lugar do `temporada-`.
// Os containers da temporada local (o prefixo TEMPORADA_CONTAINER_PREFIX de src/temporada/pieces.ts, que este módulo não importa: ele puxaria
// o ensaio inteiro para o job-migrate; o teste confere que são os mesmos) e os da conta da Azure.
export const TEMPORADA_BLOB_CONTAINERS: Readonly<Record<string, string>> = {
  'temporada-briefings': 'briefings',
  'temporada-llm-io': 'llm-io',
};

export async function exportBlobs(
  blob: BlobServiceClient | undefined,
  dir: string,
  containers: Readonly<Record<string, string>>,
): Promise<Record<string, number>> {
  const client = requireBlob(blob);
  const counts: Record<string, number> = {};
  for (const [from, to] of Object.entries(containers)) {
    const root = path.resolve(dir, to);
    const source = client.getContainerClient(from);
    let files = 0;
    for await (const item of source.listBlobsFlat()) {
      const file = path.resolve(root, item.name);
      // um nome de blob com `..` não escreve fora da pasta
      if (!file.startsWith(`${root}${path.sep}`)) {
        throw new Error(
          `O blob "${item.name.slice(0, 80)}" de ${from} sairia da pasta: nada além dele foi copiado`,
        );
      }
      await mkdir(path.dirname(file), { recursive: true });
      await source.getBlobClient(item.name).downloadToFile(file);
      files += 1;
    }
    counts[to] = files;
  }
  return counts;
}
