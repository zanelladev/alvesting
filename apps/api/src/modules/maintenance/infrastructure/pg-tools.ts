import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// As peças do backup-verify (modules/maintenance) que falam com o `pg_dump` e o `pg_restore`: o banco temporário e a trava que o protege, a
// URL do administrador virando argumentos e ambiente do processo filho, a versão dos binários e o processo com prazo e abort. Nada aqui
// abre conexão com o banco (o único SQL é o DROP do banco temporário, num cliente que o chamador passa); o resto está em
// application/backup-verify.handler.ts.

// --- o banco temporário da restauração de teste ----------------------------------------------------------------------------------
// O banco onde o dump é restaurado vive no MESMO servidor e só existe durante o backup-verify. O nome tem um padrão exato, e o código NUNCA
// apaga banco cujo nome não case com ele: um erro de quem chama (uma variável trocada, um mês torto) não pode derrubar o banco de verdade.
export const TEMP_DATABASE = /^alvesting_verify_\d{6}_[0-9a-f]{8}$/;

export function tempDatabaseName(
  month: string,
  random: string = randomBytes(4).toString('hex'),
): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Mês inválido: ${month}`);
  const name = `alvesting_verify_${month.replace('-', '')}_${random}`;
  assertTempDatabase(name);
  return name;
}

export function assertTempDatabase(name: string): void {
  if (!TEMP_DATABASE.test(name)) {
    throw new Error(
      `"${name.slice(0, 80)}" não é um banco temporário do backup-verify (alvesting_verify_AAAAMM_<8 hexadecimais>): nada foi apagado`,
    );
  }
}

// O que o DROP precisa de um cliente do Postgres (o pg.Client tem os dois): o teste passa um falso e prova que o SQL nem sai para o banco
// que não é temporário.
export interface DropClient {
  query(sql: string): Promise<unknown>;
  escapeIdentifier(name: string): string;
}

// A ÚNICA porta para DROP DATABASE no código: a trava do nome vem antes de qualquer SQL. `force` (WITH (FORCE)) derruba as sessões que
// ainda estejam no banco: é o que o fim do backup-verify usa no banco que ele mesmo criou; a varredura de órfãos de outra execução NÃO usa
// (o banco de uma execução ainda viva tem sessão aberta, o DROP falha e ele fica).
export async function dropTempDatabase(
  client: DropClient,
  name: string,
  force: boolean,
): Promise<void> {
  assertTempDatabase(name);
  await client.query(
    `DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)}${force ? ' WITH (FORCE)' : ''}`,
  );
}

// --- a URL do administrador no processo filho ------------------------------------------------------------------------------------
export interface DatabaseTarget {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
}

const SSL_MODES = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']);

export function databaseTarget(url: string): DatabaseTarget {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode') ?? undefined;
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    ...(sslmode !== undefined && SSL_MODES.has(sslmode) ? { sslmode } : {}),
  };
}

// A senha vai SÓ no ambiente do filho (PGPASSWORD), nunca em argumento de linha de comando (apareceria na lista de processos, no log do
// orquestrador e em mensagem de erro). O filho não herda o ambiente do worker: lá estão o token da brapi, o segredo da revalidação e a
// própria URL do banco com a senha. PGCONNECT_TIMEOUT: a conexão que não abre não prende o filho para sempre.
export function toolEnv(
  target: DatabaseTarget,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...(base.PATH === undefined ? {} : { PATH: base.PATH }),
    PGPASSWORD: target.password,
    PGCONNECT_TIMEOUT: '30',
    ...(target.sslmode === undefined ? {} : { PGSSLMODE: target.sslmode }),
  };
}

// host, porta e usuário em argumentos longos (--chave=valor): é o que o teste local troca pelos de dentro do contêiner do Postgres
// (pg-tools.fixture.ts) sem mexer no resto dos argumentos.
export const connectionArgs = (target: DatabaseTarget): string[] => [
  `--host=${target.host}`,
  `--port=${target.port}`,
  `--username=${target.user}`,
  '--no-password',
];

const SNAPSHOT = /^[0-9A-F]{8}-[0-9A-F]{8}-\d+$/;
const TABLE = /^[a-z][a-z0-9_]*$/;

// O dump: formato custom (o único que o pg_restore lê em fluxo e que comprime), o esquema INTEIRO, e o dado de todas as tabelas menos o das
// pessoais (--exclude-table-data deixa a tabela, as chaves e os gatilhos no dump e tira só as linhas). `snapshot` é o de
// pg_export_snapshot(): o dump e a contagem da origem enxergam o mesmo instante.
export function dumpArgs(
  target: DatabaseTarget,
  snapshot: string,
  personalTables: readonly string[],
): string[] {
  if (!SNAPSHOT.test(snapshot))
    throw new Error('Snapshot inválido: esperava o de pg_export_snapshot()');
  for (const table of personalTables) {
    if (!TABLE.test(table)) throw new Error(`Nome de tabela inválido para o dump: ${table}`);
  }
  return [
    ...connectionArgs(target),
    `--dbname=${target.database}`,
    '--format=custom',
    `--snapshot=${snapshot}`,
    '--lock-wait-timeout=60s',
    ...personalTables.map((table) => `--exclude-table-data=public.${table}`),
  ];
}

// A restauração lê o dump da entrada padrão (sem nome de arquivo): o fluxo vem direto do Blob, sem arquivo grande no disco efêmero do
// contêiner. Sem dono (o servidor de destino pode não ter o mesmo papel de dono) e parando no primeiro erro: restauração que "terminou com
// avisos" não é restauração que passou.
export const restoreArgs = (target: DatabaseTarget, database: string): string[] => [
  ...connectionArgs(target),
  `--dbname=${database}`,
  '--no-owner',
  '--exit-on-error',
];

// "pg_dump (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2)" -> 17. As ferramentas têm de ser do major do servidor: um pg_dump de major
// maior escreve sintaxe que o servidor não conhece, e o de major menor recusa o servidor.
export function majorOfVersionText(text: string): number | undefined {
  const major = /\(PostgreSQL\) (\d+)/.exec(text)?.[1];
  return major === undefined ? undefined : Number(major);
}

// --- o processo filho ------------------------------------------------------------------------------------------------------------
export type PgTool = 'pg_dump' | 'pg_restore';

export interface SpawnOptions {
  env: NodeJS.ProcessEnv;
  // o abort do chamador mata o filho; o prazo (timeoutMs) também. Todo filho tem os dois.
  signal: AbortSignal;
  timeoutMs: number;
}

// Como o handler cria o processo: em produção o executável do PATH da imagem (postgresql-client-17); no teste local, o do contêiner do
// projeto (pg-tools.fixture.ts), que troca só o executável e o host e a porta.
export type SpawnTool = (tool: PgTool, args: string[], options: SpawnOptions) => ChildProcess;

export function spawnProcess(command: string, args: string[], options: SpawnOptions): ChildProcess {
  return spawn(command, args, {
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: options.signal,
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
  });
}

export const spawnNative: SpawnTool = (tool, args, options) => spawnProcess(tool, args, options);

const STDERR_TAIL = 4096;

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
  // só o fim da saída de erro: o suficiente para dizer por que falhou, sem entupir a linha do job_run
  stderr: string;
  stdout: string;
}

// Espera o filho terminar e devolve o código, o sinal e as saídas. Se ele não puder ser criado (ENOENT) ou o abort o matar, rejeita. A
// saída padrão só é lida aqui se `stdout` (a versão do binário): no dump quem a lê é o envio ao Blob, e no restore ninguém a quer.
export function collect(child: ChildProcess, options: { stdout?: boolean } = {}): Promise<Exit> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let stdout = '';
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });
    if (options.stdout ?? true) {
      child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
        stdout = (stdout + chunk).slice(-STDERR_TAIL);
      });
    }
    // `on`, e não `once`: um segundo 'error' do mesmo filho (o kill depois do abort) sem ouvinte derrubaria o worker
    child.on('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stderr, stdout }));
  });
}
