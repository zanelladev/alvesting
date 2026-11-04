import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { integrationTitle, testDatabaseUrl } from './test-database.fixture.js';
import {
  applyMigrations,
  assertDisposable,
  databaseName,
  recreateDatabase,
} from './database-admin.js';

describe('databaseName', () => {
  it('é o nome do banco da URL, sem a barra e decodificado', () => {
    expect(databaseName('postgresql://u:p@localhost:25432/alvesting_ensaio')).toBe(
      'alvesting_ensaio',
    );
    expect(databaseName('postgresql://u:p@localhost:25432/alvesting_ensaio?schema=public')).toBe(
      'alvesting_ensaio',
    );
  });
});

describe('recreateDatabase e applyMigrations só mexem em banco descartável', () => {
  // a recusa vem antes de qualquer conexão: se tentasse conectar, o servidor que não existe daria outro erro
  const nowhere = (name: string) => `postgresql://u:p@127.0.0.1:1/${name}`;

  it('recusam o banco de dev e qualquer outro que não termina em _ensaio ou _test', async () => {
    for (const name of ['alvesting_dev', 'alvesting', 'postgres', 'ensaio', 'alvesting_test_dev']) {
      await expect(recreateDatabase(nowhere(name)), name).rejects.toThrow(/_ensaio ou _test/);
      expect(() => applyMigrations(nowhere(name)), name).toThrow(/_ensaio ou _test/);
    }
  });
});

// O nome não basta: um E2E_DATABASE_URL ou ENSAIO_DATABASE_URL que aponte para outro servidor, com um banco *_test, teria o banco derrubado.
describe('só o Postgres da própria máquina tem um banco recriado', () => {
  const at = (host: string) => `postgresql://u:p@${host}:5432/alvesting_test`;

  it('recusa outro servidor, mesmo com o nome descartável, sem conectar a ele', async () => {
    for (const host of [
      'db.exemplo.com',
      '10.0.0.4',
      'psql-alvesting.postgres.database.azure.com',
      'localhost.exemplo.com',
      '127.0.0.1.exemplo.com',
      '0.0.0.0',
    ]) {
      await expect(recreateDatabase(at(host)), host).rejects.toThrow(/própria máquina/);
      expect(() => applyMigrations(at(host)), host).toThrow(/própria máquina/);
      expect(() => assertDisposable(at(host)), host).toThrow(/própria máquina/);
    }
  });

  it('a mensagem diz o servidor e não repete a senha da URL', () => {
    try {
      assertDisposable('postgresql://u:senha-secreta@db.exemplo.com:5432/alvesting_test');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('db.exemplo.com');
      expect((error as Error).message).not.toContain('senha-secreta');
    }
  });

  it('aceita localhost, 127.0.0.1 e ::1', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(() => assertDisposable(at(host)), host).not.toThrow();
    }
  });

  it('o nome continua valendo: o banco de dev é recusado até na própria máquina', () => {
    expect(() => assertDisposable('postgresql://u:p@localhost:25432/alvesting_dev')).toThrow(
      /_ensaio ou _test/,
    );
  });
});

// O DROP e o CREATE de verdade, num banco só deste teste (o nome termina em _test): o que existia antes some, e as migrations entram.
// O banco fica depois do teste (como o alvesting_test): cada DROP DATABASE força um checkpoint no servidor, e um a mais no fim
// atrapalharia os testes seguintes, que dividem o servidor e têm prazo de 5 s. A próxima execução o recria do zero.
describe.skipIf(!testDatabaseUrl)(integrationTitle('recreateDatabase e applyMigrations'), () => {
  const url = (() => {
    if (!testDatabaseUrl) return '';
    const copy = new URL(testDatabaseUrl);
    copy.pathname = '/alvesting_recreate_test';
    return copy.toString();
  })();

  async function withClient<T>(
    database: string,
    run: (client: pg.Client) => Promise<T>,
  ): Promise<T> {
    const target = new URL(url);
    target.pathname = `/${database}`;
    const client = new pg.Client({ connectionString: target.toString() });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.end();
    }
  }

  it('recria o banco do zero (o que havia some) e aplica todas as migrations', async () => {
    await recreateDatabase(url);
    await withClient('alvesting_recreate_test', (c) => c.query('CREATE TABLE sobra (id int)'));

    await recreateDatabase(url);
    const tables = await withClient('alvesting_recreate_test', (c) =>
      c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"),
    );
    expect(tables.rowCount).toBe(0);

    applyMigrations(url);
    const migrated = await withClient('alvesting_recreate_test', async (c) => ({
      migrations: await c.query('SELECT count(*)::int AS n FROM _prisma_migrations'),
      season: await c.query("SELECT to_regclass('public.season') AS name"),
    }));
    expect((migrated.migrations.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(9);
    expect((migrated.season.rows[0] as { name: string }).name).toBe('season');
  }, 120_000);
});
