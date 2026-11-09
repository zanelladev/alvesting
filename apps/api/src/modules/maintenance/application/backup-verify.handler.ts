import { createHash } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BlobServiceClient, BlockBlobClient } from '@azure/storage-blob';
import { Logger } from '@nestjs/common';
import type { QueueMessage } from '@alvesting/contracts';
import pg from 'pg';
import { containerFor } from '../../../infrastructure/storage/blob-upload.js';
import {
  POLICY_TABLES,
  TABLE_POLICY,
  personalTables,
  policyGaps,
} from '../../../infrastructure/database/table-policy.js';
import { JobBusyError, type JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import {
  TEMP_DATABASE,
  assertToolsMajor,
  collect,
  databaseTarget,
  dropTempDatabase,
  dumpArgs,
  restoreArgs,
  spawnNative,
  tempDatabaseName,
  toolEnv,
  type DatabaseTarget,
  type PgTool,
  type SpawnTool,
} from '../infrastructure/pg-tools.js';

// O container do Blob dos dumps (infra/modules/storage.bicep: cool em 30 dias, apagado em 365; o `backups/` do lifecycle).
const CONTAINER = 'backups';
// Memória do envio em fluxo: 4 MiB por bloco e 2 em voo = uns 12 MiB, qualquer que seja o tamanho do dump (o contêiner tem 0,5 a 1 GiB e
// disco efêmero pequeno; nada do dump passa pelo disco).
const BLOCK_BYTES = 4 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 2;
// O prazo do conjunto (dump, envio, restauração e contagens). Fica abaixo do `lockRenewalMs` da fila maintenance (packages/contracts, 25 min):
// a mensagem não é reentregue a outra réplica enquanto este handler ainda trabalha.
const DEADLINE_MS = 20 * 60_000;
const QUERY_TIMEOUT_MS = 5 * 60_000;

export interface TableCount {
  origin: number;
  restored: number;
}

export type BackupVerifyResult =
  | {
      outcome: 'verified';
      month: string;
      blob: string;
      bytes: number;
      sha256: string;
      counts: Record<string, TableCount>;
    }
  | { outcome: 'already_done' };

export interface BackupVerifyDeps {
  jobs: Pick<JobRunStore, 'claim' | 'succeed' | 'fail'>;
  blob: BlobServiceClient | undefined;
  // a URL do login ADMINISTRADOR (o DATABASE_URL do worker): cria o banco temporário e restaura nele
  databaseUrl: string;
  // como criar pg_dump e pg_restore: o PATH da imagem (padrão) ou, no teste local, o contêiner do projeto
  spawn?: SpawnTool;
  // as tabelas cujo DADO o dump deixa de fora; o padrão é a lista de pessoais da matriz (table-policy.ts). Só o teste a troca (para forçar
  // a contagem diferente): quem DECIDE o que a restauração tem de ter é sempre a matriz
  personalTables?: readonly string[];
  deadlineMs?: number;
}

// O SHA-256 e o tamanho do dump, calculados enquanto ele passa para o Blob (nada é guardado): um Transform que só olha e repassa.
function tap() {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  return { stream, result: () => ({ sha256: hash.digest('hex'), bytes }) };
}

// A mensagem `backup-verify {mês}` da fila `maintenance` (plano 5.8): o backup mensal que se PROVA restaurável ("backup que nunca foi
// restaurado não é backup"). Idempotente pela linha de job_run (backup-verify + mês). Tudo em fluxo, sem arquivo no disco do contêiner:
//
//  1. confere que o pg_dump e o pg_restore são do major do servidor, varre bancos temporários órfãos de uma execução que caiu e recusa
//     tabela sem decisão na matriz (table-policy.ts: o dump poderia levar dado pessoal que ninguém classificou);
//  2. cria o banco temporário `alvesting_verify_AAAAMM_<hex>` no MESMO servidor;
//  3. exporta um snapshot (pg_export_snapshot, numa transação REPEATABLE READ que fica aberta) e conta as linhas de toda tabela da matriz
//     NESSE instante; o `pg_dump --snapshot` enxerga o mesmo instante, então as contagens são comparáveis mesmo com a arena escrevendo;
//  4. pg_dump (formato custom) → Blob `backups/alvesting-AAAA-MM.dump`, com o esquema inteiro e o dado de todas as tabelas MENOS as pessoais
//     (a política de privacidade promete cópia com dado pessoal só pelo ponto de restauração de 7 dias; o dump fica até 12 meses);
//  5. baixa o dump do Blob e o passa ao pg_restore (o que foi guardado é o que se restaura) no banco temporário;
//  6. conta de novo: toda tabela tem de ter a contagem da origem, e as pessoais, zero;
//  7. APAGA o banco temporário, dê certo ou não (só se o nome tem o padrão exato: dropTempDatabase, a única porta do DROP DATABASE).
//
// Falhou: o job_run vira FAILED (o JobRunStore escreve a linha do alerta job-falhou), o dump que não passou na conferência é apagado do
// Blob e a fila repete. "Só dump verificado fica" vale enquanto o processo chega ao `finally`: se ele morre depois do envio e antes da
// conferência (SIGKILL, falta de memória), o dump inteiro e NÃO verificado fica no Blob, e o que o distingue do verificado são os
// metadados, que só são gravados depois da conferência (sem `sha256` e `personal_data`, não foi verificado; docs/JOBS.md, 8.2).
// Todo processo filho tem prazo e morre no abort; a senha vai no PGPASSWORD do filho.
export class BackupVerifyHandler {
  private readonly logger = new Logger(BackupVerifyHandler.name);
  private readonly spawn: SpawnTool;
  private readonly excluded: readonly string[];
  private readonly deadlineMs: number;

  constructor(private readonly deps: BackupVerifyDeps) {
    this.spawn = deps.spawn ?? spawnNative;
    this.excluded = deps.personalTables ?? personalTables();
    this.deadlineMs = deps.deadlineMs ?? DEADLINE_MS;
  }

  readonly handle = async (message: QueueMessage): Promise<void> => {
    if (message.type !== 'backup-verify') {
      throw new Error(`O backup-verify não trata mensagens ${message.type}`);
    }
    await this.execute(message.month);
  };

  async execute(month: string): Promise<BackupVerifyResult> {
    const message = { type: 'backup-verify', month } as const;
    const claimed = await this.deps.jobs.claim(message);
    if (claimed.status === 'done') return { outcome: 'already_done' };
    if (claimed.status === 'busy') throw new JobBusyError(message);
    try {
      const result = await this.backupAndVerify(month);
      await this.deps.jobs.succeed(claimed.claim);
      return result;
    } catch (error) {
      await this.deps.jobs.fail(claimed.claim, error);
      throw error;
    }
  }

  private async backupAndVerify(month: string): Promise<BackupVerifyResult> {
    const signal = AbortSignal.timeout(this.deadlineMs);
    const target = databaseTarget(this.deps.databaseUrl);
    const container = await containerFor(this.deps.blob, CONTAINER);
    const name = `alvesting-${month}.dump`;
    const dump = container.getBlockBlobClient(name);
    const temp = tempDatabaseName(month);

    const maintenance = this.client('postgres');
    const origin = this.client(target.database);
    // só se encerra (end) o cliente que chegou a conectar: o `end()` de um que nunca conectou espera para sempre
    const connected = new Set<pg.Client>();
    const open = async (client: pg.Client) => {
      await client.connect();
      connected.add(client);
    };
    let restored: pg.Client | undefined;
    let tempCreated = false;
    let uploaded = false;
    let failure: unknown;
    try {
      await open(maintenance);
      await open(origin);
      const serverMajor = await this.serverMajor(maintenance);
      await assertToolsMajor(this.spawn, ['pg_dump', 'pg_restore'], serverMajor, target, signal);
      await this.assertClassified(origin);
      await this.sweepOrphans(maintenance);

      await maintenance.query(`CREATE DATABASE ${maintenance.escapeIdentifier(temp)}`);
      tempCreated = true;

      // 3. o snapshot e as contagens da origem NESSE instante; a transação fica aberta até o pg_dump terminar
      await origin.query('BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const snapshot = (
        await origin.query<{ snapshot: string }>('SELECT pg_export_snapshot() AS snapshot')
      ).rows[0]!.snapshot;
      const originCounts = await this.count(origin, POLICY_TABLES);

      // 4. dump -> Blob, em fluxo
      uploaded = true;
      const sent = await this.dumpToBlob(target, snapshot, dump, signal);
      await origin.query('ROLLBACK');

      // 5. Blob -> restauração no banco temporário, em fluxo
      await this.restoreFromBlob(target, temp, dump, signal);

      // 6. a mesma contagem, no banco restaurado
      restored = this.client(temp);
      await open(restored);
      const restoredCounts = await this.count(restored, POLICY_TABLES);
      const counts = this.compare(originCounts, restoredCounts);

      await dump.setMetadata({
        month,
        sha256: sent.sha256,
        bytes: String(sent.bytes),
        personal_data: 'excluded',
        pg_dump_format: 'custom',
      });
      this.logger.log(
        { month, blob: name, bytes: sent.bytes, sha256: sent.sha256, tables: POLICY_TABLES.length },
        'backup-verify: dump guardado, restaurado e conferido',
      );
      return { outcome: 'verified', month, blob: name, ...sent, counts };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      // limpeza que roda inclusive na falha, sem esconder o erro de verdade: o que falhar aqui só vai ao log. Um DROP do banco temporário que
      // falhe deixa um órfão do padrão exato, e a varredura da execução seguinte (sweepOrphans) o apaga
      const cleanup: unknown[] = [];
      const attempt = async (step: () => Promise<unknown>) => {
        try {
          await step();
        } catch (error) {
          cleanup.push(error);
        }
      };
      if (connected.has(origin)) {
        await attempt(() => origin.query('ROLLBACK')); // solta o snapshot se o dump não chegou ao fim
        await attempt(() => origin.end());
      }
      const verifying = restored;
      if (verifying && connected.has(verifying)) await attempt(() => verifying.end());
      if (failure !== undefined && uploaded) await attempt(() => dump.deleteIfExists());
      if (tempCreated) await attempt(() => dropTempDatabase(maintenance, temp, true));
      if (connected.has(maintenance)) await attempt(() => maintenance.end());
      for (const error of cleanup) {
        this.logger.warn(
          { month, err: error instanceof Error ? error.message : String(error) },
          'backup-verify: a limpeza falhou',
        );
      }
    }
  }

  // Um cliente para o banco pedido, com a mesma URL do administrador (o sslmode da URL vale). Prazo em cada consulta.
  private client(database: string): pg.Client {
    const url = new URL(this.deps.databaseUrl);
    url.pathname = `/${encodeURIComponent(database)}`;
    const client = new pg.Client({
      connectionString: url.toString(),
      statement_timeout: QUERY_TIMEOUT_MS,
      application_name: 'alvesting-backup-verify',
    });
    // a conexão que cai com o dump em andamento (a da transação do snapshot dura o dump todo) emite 'error', e sem ouvinte o Node derruba o
    // worker inteiro; a consulta pendente falha por conta própria e o handler segue o caminho de falha
    client.on('error', (error) =>
      this.logger.warn(
        { database, err: error.message },
        'backup-verify: a conexão com o Postgres caiu',
      ),
    );
    return client;
  }

  private async serverMajor(client: pg.Client): Promise<number> {
    const { rows } = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    return Math.floor(Number(rows[0]!.server_version_num) / 10_000);
  }

  // Fail closed: toda tabela do banco tem de ter decisão na matriz (e vice-versa). Uma tabela nova, pessoal e sem classificação (a carteira,
  // o chat) iria para o dump COM os dados, contra a política de privacidade.
  private async assertClassified(origin: pg.Client): Promise<void> {
    const { rows } = await origin.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'`,
    );
    const { missing, extra } = policyGaps(rows.map((row) => row.relname));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `Tabela sem classificação em apps/api/src/infrastructure/database/table-policy.ts (sem decisão: ${missing.join(', ') || 'nenhuma'}; na matriz e fora do banco: ${extra.join(', ') || 'nenhuma'}): o dump poderia levar dado pessoal`,
      );
    }
  }

  // Bancos temporários de uma execução que caiu (SIGKILL no meio): só os do padrão exato, e SEM `FORCE` — o de uma execução ainda viva tem
  // sessão aberta, o DROP falha e ele fica.
  private async sweepOrphans(maintenance: pg.Client): Promise<void> {
    const { rows } = await maintenance.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'alvesting\\_verify\\_%'`,
    );
    for (const { datname } of rows) {
      if (!TEMP_DATABASE.test(datname)) continue;
      try {
        await dropTempDatabase(maintenance, datname, false);
        this.logger.warn({ database: datname }, 'backup-verify: banco temporário órfão apagado');
      } catch (error) {
        this.logger.warn(
          { database: datname, err: error instanceof Error ? error.message : String(error) },
          'backup-verify: banco temporário órfão não apagado (em uso?)',
        );
      }
    }
  }

  private async count(client: pg.Client, tables: readonly string[]): Promise<Map<string, bigint>> {
    const counts = new Map<string, bigint>();
    for (const table of tables) {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.${client.escapeIdentifier(table)}`,
      );
      counts.set(table, BigInt(rows[0]!.n));
    }
    return counts;
  }

  // O que a restauração tem de ter vem da MATRIZ: a contagem da origem para toda tabela, e zero para as pessoais (o dado não vai para o
  // dump). Só números vão para a mensagem de erro e para o log, nunca linhas.
  private compare(
    origin: Map<string, bigint>,
    restored: Map<string, bigint>,
  ): Record<string, TableCount> {
    const counts: Record<string, TableCount> = {};
    const different: string[] = [];
    for (const table of POLICY_TABLES) {
      const expected = TABLE_POLICY[table]!.personal ? 0n : origin.get(table)!;
      const got = restored.get(table)!;
      counts[table] = { origin: Number(origin.get(table)!), restored: Number(got) };
      if (got !== expected) different.push(`${table} (esperava ${expected}, restaurou ${got})`);
    }
    if (different.length > 0) {
      throw new Error(`Contagem diferente depois da restauração: ${different.join('; ')}`);
    }
    return counts;
  }

  private async dumpToBlob(
    target: DatabaseTarget,
    snapshot: string,
    blob: BlockBlobClient,
    signal: AbortSignal,
  ): Promise<{ sha256: string; bytes: number }> {
    const child = this.spawn('pg_dump', dumpArgs(target, snapshot, this.excluded), {
      env: toolEnv(target),
      signal,
      timeoutMs: this.deadlineMs,
    });
    try {
      const hashed = tap();
      const piping = pipeline(child.stdout as Readable, hashed.stream);
      const [, , exit] = await Promise.all([
        blob.uploadStream(hashed.stream, BLOCK_BYTES, UPLOAD_CONCURRENCY, {
          abortSignal: signal,
          blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
        }),
        piping,
        collect(child, { stdout: false }),
      ]);
      // o fluxo acabou antes da hora: um pg_dump que morre no meio fecha a saída, e o envio termina "com sucesso" com o dump partido
      if (exit.code !== 0) throw this.failed('pg_dump', exit);
      return hashed.result();
    } finally {
      child.kill('SIGKILL');
    }
  }

  private async restoreFromBlob(
    target: DatabaseTarget,
    database: string,
    blob: BlockBlobClient,
    signal: AbortSignal,
  ): Promise<void> {
    const download = await blob.download(0, undefined, { abortSignal: signal });
    const child = this.spawn('pg_restore', restoreArgs(target, database), {
      env: toolEnv(target),
      signal,
      timeoutMs: this.deadlineMs,
    });
    try {
      child.stdout?.resume();
      const feeding = pipeline(download.readableStreamBody as Readable, child.stdin!).then(
        () => undefined,
        (error: unknown) =>
          error instanceof Error ? error : new Error('o fluxo do dump para o pg_restore falhou'),
      );
      const [exit, feedError] = await Promise.all([collect(child, { stdout: false }), feeding]);
      // o erro do filho é o que explica; o do fluxo (EPIPE) é só o efeito de ele ter morrido antes de ler tudo
      if (exit.code !== 0) throw this.failed('pg_restore', exit);
      if (feedError) throw feedError;
    } finally {
      child.kill('SIGKILL');
    }
  }

  private failed(
    tool: PgTool,
    exit: { code: number | null; signal: string | null; stderr: string },
  ) {
    return new Error(
      `${tool} falhou (${exit.signal ? `sinal ${exit.signal}` : `código ${String(exit.code)}`}): ${exit.stderr.trim().slice(-500)}`,
    );
  }
}
