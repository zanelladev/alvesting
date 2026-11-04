import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Criar, recriar e migrar um banco descartável. Só o ensaio (arena:ensaio), o e2e e os testes usam; o banco de dev nunca passa por
// aqui (CLAUDE.md: nunca `DROP` no dev). O nome e o servidor são conferidos de novo dentro de cada função, para um erro de quem chama
// (uma variável de ambiente trocada) não derrubar um banco de verdade.

const DISPOSABLE = /^[a-z0-9_]+_(ensaio|test)$/;
// O Postgres do docker compose e do job de CI estão sempre na própria máquina. Um banco *_test de outro servidor não é descartável.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));

export const databaseName = (url: string): string =>
  decodeURIComponent(new URL(url).pathname.slice(1));

// O nome termina em _ensaio ou _test E o servidor é o da própria máquina. A mensagem não repete a URL (tem senha).
export function assertDisposable(url: string): void {
  const name = databaseName(url);
  if (!DISPOSABLE.test(name)) {
    throw new Error(
      `Só um banco que termina em _ensaio ou _test pode ser recriado (veio "${name}")`,
    );
  }
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Só o Postgres da própria máquina (localhost, 127.0.0.1 ou ::1) pode ter um banco recriado (veio "${hostname}")`,
    );
  }
}

// DROP DATABASE e CREATE DATABASE, pela conexão de manutenção (o banco `postgres` do mesmo servidor). WITH (FORCE) derruba as
// conexões abertas de uma execução anterior.
export async function recreateDatabase(url: string): Promise<void> {
  assertDisposable(url);
  const name = databaseName(url);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

// prisma migrate deploy: só avança, nunca apaga. CHECKPOINT_DISABLE: o CLI do Prisma consulta checkpoint.prisma.io (versão e
// telemetria), e o ensaio não usa rede.
export function applyMigrations(url: string): void {
  assertDisposable(url);
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url, CHECKPOINT_DISABLE: '1' },
    stdio: 'pipe',
  });
}
