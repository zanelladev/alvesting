import { spawnSync } from 'node:child_process';
import {
  majorOfVersionText,
  spawnProcess,
  type PgTool,
  type SpawnTool,
} from '../infrastructure/pg-tools.js';

// Como os testes de integração do backup-verify acham o pg_dump e o pg_restore 17 (a produção os chama pelo PATH da imagem, com o
// postgresql-client-17). Esta máquina NÃO tem pg_dump nativo, e é proibido instalar o do Homebrew (o libpq dele é o 18, major acima do
// servidor 17, e atualizaria bibliotecas de outros projetos). Então:
//  1. se há pg_dump 17 no PATH (o CI, pelo passo "Cliente do PostgreSQL 17" do ci.yml, que põe /usr/lib/postgresql/17/bin na frente do PATH:
//     o /usr/bin/pg_dump do Debian é um wrapper que, sem --host, escolheria o servidor 16 do runner), roda ele;
//  2. senão, se o contêiner do projeto está de pé (docker compose), roda os binários 17.11 que vêm DENTRO dele com `docker exec -i`: o mesmo
//     código monta os argumentos e trata a saída, trocando só o executável e o host e a porta pelos de dentro do contêiner;
//  3. senão não há como rodar, e o teste é pulado com o motivo no nome (como os do Service Bus) — menos no CI, onde isto falha (abaixo).
// Tudo com prazo (spawnSync com timeout; o CLI do Docker já travou nesta máquina) e decidido na hora de carregar o arquivo, para o
// `describe.skipIf` e o título saberem.
const SERVER_MAJOR = 17;
const CONTAINER = process.env.TEST_PG_CONTAINER ?? 'alvesting-postgres-1';

const versionOf = (command: string, args: string[], timeout: number): number | undefined => {
  const run = spawnSync(command, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
  return run.status === 0 ? majorOfVersionText(run.stdout) : undefined;
};

export interface LocalPgTools {
  // como o handler cria o processo
  spawn: SpawnTool;
  // o mesmo executável, com o que ele escreve passando por um filtro de shell (`head -c 3000`): é como o teste produz um dump TRUNCADO de
  // verdade (o pg_dump é morto pelo SIGPIPE e o pipeline sai com 0, a pior falha: só a restauração percebe)
  spawnThrough: (filter: string) => SpawnTool;
  // de onde vêm os binários, para o título do teste
  source: 'PATH' | 'contêiner';
}

function native(): LocalPgTools | undefined {
  if (versionOf('pg_dump', ['--version'], 5_000) !== SERVER_MAJOR) return undefined;
  if (versionOf('pg_restore', ['--version'], 5_000) !== SERVER_MAJOR) return undefined;
  const through =
    (filter: string): SpawnTool =>
    (tool, args, options) =>
      filtered(tool, args, options, filter, (script, rest) => [
        'sh',
        ['-c', script, 'sh', ...rest],
      ]);
  return {
    spawn: (tool, args, options) => spawnProcess(tool, args, options),
    spawnThrough: through,
    source: 'PATH',
  };
}

// O host e a porta que o teste usa (localhost:25432) não existem dentro do contêiner: lá o Postgres é localhost:5432.
const inside = (args: string[]): string[] =>
  args.map((arg) =>
    arg.startsWith('--host=')
      ? '--host=localhost'
      : arg.startsWith('--port=')
        ? '--port=5432'
        : arg,
  );

// O `docker` precisa do HOME e das variáveis do contexto para achar o daemon; o filho do pg_dump, não (o handler monta o ambiente dele
// só com PATH e PG*). O PGPASSWORD vai para dentro do contêiner por `-e NOME` (sem valor: o docker o copia do ambiente do próprio CLI).
const dockerEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  ...Object.fromEntries(
    ['HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'].flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  ),
});
const forwarded = (env: NodeJS.ProcessEnv): string[] =>
  ['PGPASSWORD', 'PGCONNECT_TIMEOUT', 'PGSSLMODE'].flatMap((name) =>
    env[name] === undefined ? [] : ['-e', name],
  );

function filtered(
  tool: PgTool,
  args: string[],
  options: Parameters<SpawnTool>[2],
  filter: string,
  wrap: (script: string, rest: string[]) => [string, string[]],
) {
  const [command, wrapped] = wrap(`${tool} "$@" | ${filter}`, args);
  return spawnProcess(command, wrapped, options);
}

function container(): LocalPgTools | undefined {
  const running = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], {
    encoding: 'utf8',
    timeout: 15_000,
    killSignal: 'SIGKILL',
  });
  if (running.status !== 0 || running.stdout.trim() !== 'true') return undefined;
  for (const tool of ['pg_dump', 'pg_restore']) {
    if (versionOf('docker', ['exec', CONTAINER, tool, '--version'], 15_000) !== SERVER_MAJOR)
      return undefined;
  }
  const spawn: SpawnTool = (tool, args, options) =>
    spawnProcess(
      'docker',
      ['exec', '-i', ...forwarded(options.env), CONTAINER, tool, ...inside(args)],
      { ...options, env: dockerEnv(options.env) },
    );
  const through =
    (filter: string): SpawnTool =>
    (tool, args, options) =>
      filtered(tool, args, { ...options, env: dockerEnv(options.env) }, filter, (script, rest) => [
        'docker',
        [
          'exec',
          '-i',
          ...forwarded(options.env),
          CONTAINER,
          'sh',
          '-c',
          script,
          'sh',
          ...inside(rest),
        ],
      ]);
  return { spawn, spawnThrough: through, source: 'contêiner' };
}

export const localPgTools: LocalPgTools | undefined = native() ?? container();

export const noPgToolsReason = `sem pg_dump 17 no PATH e sem o contêiner ${CONTAINER} (docker compose up -d postgres)`;

// No CI o teste NÃO pode ser pulado: o passo "Cliente do PostgreSQL 17" do ci.yml instala o pacote, e se ele faltar (o passo saiu, o
// repositório PGDG mudou) pular em silêncio tiraria do CI a única prova de que o backup restaura. Falha aqui, na carga do arquivo.
if (localPgTools === undefined && process.env.CI) {
  throw new Error(
    `O CI não achou o pg_dump 17: o passo "Cliente do PostgreSQL 17" do .github/workflows/ci.yml deveria tê-lo instalado (${noPgToolsReason})`,
  );
}
