import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import { assertDisposable } from '../../../infrastructure/database/database-admin.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';

// O schema do mercado depois da saída do legado da fonte antiga (a migration 20261104100000, a "drop" do legado; ADR 0032, nota de 04/11/2026;
// docs/DADOS.md, seção 1). Ela NÃO é aditiva (exceção autorizada: não há produção nem dado legado): tira um valor de cada um dos dois enums
// de origem, três colunas e refaz o CHECK que o `DROP COLUMN` derruba junto. Este arquivo não nomeia o que saiu: o que saiu é a diferença
// entre o banco ANTES da migration e a lista do que ficou (SURVIVING_*), lida do próprio banco. Duas provas: o catálogo do banco de teste
// (o que o Prisma não vê, como o CHECK) e a migration aplicada sobre um banco com os lançamentos anteriores e dado dentro, que preserva o
// dado da brapi e RECUSA, sem mudar nada, qualquer linha que ainda use algo do que sai (a guarda cobre tudo o que a migration derruba).
const MIGRATIONS = fileURLToPath(new URL('../../../../prisma/migrations/', import.meta.url));
const NAMES = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const THIS_MIGRATION = NAMES.find((name) => name.startsWith('20261104100000_'))!;
const sqlOf = (name: string) => readFileSync(`${MIGRATIONS}${name}/migration.sql`, 'utf8');
const day = (value: string) => new Date(`${value}T00:00:00Z`);

// O que fica depois da migration, por tabela (colunas em ordem alfabética) e por enum (valores em ordem alfabética).
const SURVIVING_COLUMNS = {
  daily_bar:
    'close_cents,date,high_cents,id,instrument_id,low_cents,open_cents,source,volume_cents',
  instrument: 'cnpj,created_at,id,isin,kind,last_seen,name,spec,ticker',
  trading_day: 'date,source',
} as const;
const SURVIVING_LABELS = { bar_source: 'BRAPI', trading_day_source: 'BRAPI,CALENDAR' } as const;

describe.skipIf(!testDatabaseUrl)(integrationTitle('o schema do mercado sem o legado'), () => {
  describe('o banco de teste, migrado', () => {
    let prisma: PrismaService;
    const instrumentId = newId();

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      // limpa só o que um teste interrompido deixou deste arquivo
      await prisma.dailyBar.deleteMany({ where: { instrument: { ticker: 'SCHM3' } } });
      await prisma.instrument.deleteMany({ where: { ticker: 'SCHM3' } });
      await prisma.instrument.create({
        data: {
          id: instrumentId,
          ticker: 'SCHM3',
          name: 'SCHEMA',
          spec: 'ON',
          kind: 'STOCK',
          lastSeen: day('2026-10-30'),
        },
      });
    }, 120_000);

    afterAll(async () => {
      await prisma.dailyBar.deleteMany({ where: { instrumentId } });
      await prisma.instrument.deleteMany({ where: { id: instrumentId } });
      await prisma.onModuleDestroy();
    });

    it('os dois enums de origem só têm os valores que o código grava', async () => {
      const rows = await prisma.$queryRaw<Array<{ type: string; labels: string }>>`
        SELECT t.typname AS type, string_agg(e.enumlabel::text, ',' ORDER BY e.enumlabel) AS labels
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname IN ('bar_source', 'trading_day_source')
        GROUP BY t.typname ORDER BY t.typname`;
      expect(rows).toEqual(
        Object.entries(SURVIVING_LABELS).map(([type, labels]) => ({ type, labels })),
      );
    });

    it('as três tabelas têm só as colunas de hoje', async () => {
      const rows = await prisma.$queryRaw<Array<{ table: string; columns: string }>>`
        SELECT table_name AS "table", string_agg(column_name::text, ',' ORDER BY column_name) AS columns
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('instrument', 'trading_day', 'daily_bar')
        GROUP BY table_name ORDER BY table_name`;
      expect(rows).toEqual(
        Object.entries(SURVIVING_COLUMNS).map(([table, columns]) => ({ table, columns })),
      );
    });

    // O `DROP COLUMN trades` derrubaria o CHECK junto (ele cita a coluna), e o `prisma migrate diff` não vê CHECK: sem refazê-lo à mão, a
    // migration passaria limpa e o banco perderia a rede de segurança contra preço negativo e máxima abaixo da mínima.
    describe('daily_bar_values_check sobrevive à saída da coluna trades', () => {
      const bar = (overrides: Record<string, bigint> = {}) => ({
        id: newId(),
        instrumentId,
        date: day('2026-10-30'),
        openCents: 5245n,
        highCents: 5366n,
        lowCents: 5236n,
        closeCents: 5271n,
        volumeCents: 1_000n,
        source: 'BRAPI' as const,
        ...overrides,
      });

      it('a restrição existe e não cita mais trades', async () => {
        const rows = await prisma.$queryRaw<Array<{ def: string }>>`
          SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'daily_bar'::regclass AND conname = 'daily_bar_values_check'`;
        expect(rows).toHaveLength(1);
        expect(rows[0]!.def).not.toMatch(/trades/);
        expect(rows[0]!.def).toMatch(/high_cents >= low_cents/);
      });

      it.each([
        ['abertura negativa', { openCents: -1n }],
        ['fechamento negativo', { closeCents: -1n }],
        ['mínima negativa', { lowCents: -1n }],
        ['máxima abaixo da mínima', { highCents: 1n, lowCents: 2n }],
        ['volume negativo', { volumeCents: -1n }],
      ])('recusa %s', async (_name, overrides) => {
        await expect(prisma.dailyBar.create({ data: bar(overrides) })).rejects.toThrow(
          /daily_bar_values_check|violates check constraint/i,
        );
        expect(await prisma.dailyBar.count({ where: { instrumentId } })).toBe(0);
      });

      it('aceita a barra boa, e a de preço zero com máxima igual à mínima', async () => {
        await expect(prisma.dailyBar.create({ data: bar() })).resolves.toBeDefined();
        const zero = { openCents: 0n, highCents: 0n, lowCents: 0n, closeCents: 0n };
        await expect(
          prisma.dailyBar.create({ data: { ...bar(zero), date: day('2026-10-29') } }),
        ).resolves.toBeDefined();
      });
    });
  });

  // A migration sobre um banco que já tem dado: o banco-base recebe os lançamentos anteriores à dela (o SQL de cada um, na ordem), e cada
  // caso nasce de uma cópia dele (CREATE DATABASE ... TEMPLATE), semeia o que quer e roda o SQL da migration de uma vez, como o
  // `migrate deploy` faz (uma consulta só). Banco descartável: o nome termina em _test.
  describe('a migration, aplicada sobre um banco com os lançamentos anteriores', () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const baseName = `alvesting_schema_${suffix}_base_test`;
    const urlOf = (name: string) => {
      const url = new URL(testDatabaseUrl!);
      url.pathname = `/${name}`;
      return url.toString();
    };
    const created: string[] = [];
    let baseUrl: string;
    // o que a migration tira, lido do banco ANTES dela: tudo o que existe e não está na lista do que fica
    let legacyColumns: Array<{ table: string; column: string; type: string }>;
    let legacyLabels: Array<{ type: string; label: string }>;

    async function onServer<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        return await run(client);
      } finally {
        await client.end();
      }
    }
    const maintenance = <T>(run: (client: pg.Client) => Promise<T>) =>
      onServer(urlOf('postgres'), run);

    async function createFrom(name: string, template?: string): Promise<string> {
      assertDisposable(urlOf(name));
      // O banco-base acabou de fechar a conexão, e o Postgres leva alguns milissegundos para soltá-lo como modelo (55006): repete.
      for (let attempt = 1; ; attempt += 1) {
        try {
          await maintenance(async (client) => {
            await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
            await client.query(
              `CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ''}`,
            );
          });
          break;
        } catch (error) {
          if ((error as { code?: string }).code !== '55006' || attempt === 20) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      created.push(name);
      return urlOf(name);
    }

    beforeAll(async () => {
      baseUrl = await createFrom(baseName);
      const before = NAMES.filter((name) => name < THIS_MIGRATION);
      await onServer(baseUrl, async (client) => {
        for (const name of before) await client.query(sqlOf(name));
        const columns = await client.query<{ table: string; column: string; type: string }>(
          `SELECT table_name AS "table", column_name AS "column", data_type AS type
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name IN ('instrument', 'trading_day', 'daily_bar')`,
        );
        legacyColumns = columns.rows.filter(
          (row) =>
            !SURVIVING_COLUMNS[row.table as keyof typeof SURVIVING_COLUMNS]
              .split(',')
              .includes(row.column),
        );
        const labels = await client.query<{ type: string; label: string }>(
          `SELECT t.typname AS type, e.enumlabel::text AS label
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname IN ('bar_source', 'trading_day_source')`,
        );
        legacyLabels = labels.rows.filter(
          (row) =>
            !SURVIVING_LABELS[row.type as keyof typeof SURVIVING_LABELS]
              .split(',')
              .includes(row.label),
        );
      });
    }, 120_000);

    afterAll(async () => {
      await maintenance(async (client) => {
        for (const name of created) {
          assertDisposable(urlOf(name));
          await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        }
      });
    });

    // Cada caso: uma cópia do banco-base, o que o caso semeia, a migration (mais, se o caso pedir, um `tail` que vai na MESMA consulta).
    async function run(seed: string[], tail = ''): Promise<{ url: string; error: Error | null }> {
      const url = await createFrom(`alvesting_schema_${suffix}_${created.length}_test`, baseName);
      return onServer(url, async (client) => {
        for (const statement of seed) await client.query(statement);
        try {
          await client.query(sqlOf(THIS_MIGRATION) + tail);
          return { url, error: null };
        } catch (error) {
          return { url, error: error as Error };
        }
      });
    }

    const INSTRUMENT_ID = 'INSTR000000000000000000001';
    const INSTRUMENT = `INSERT INTO instrument (id, ticker, name, spec, kind, last_seen)
      VALUES ('${INSTRUMENT_ID}', 'PETR4', 'PETROBRAS', 'PN', 'STOCK', '2026-10-30')`;
    const BAR = `INSERT INTO daily_bar (id, instrument_id, date, open_cents, high_cents, low_cents, close_cents, volume_cents, source)
      VALUES ('BAR00000000000000000000001', '${INSTRUMENT_ID}', '2026-10-30', 5245, 5366, 5236, 5271, 326552170100, 'BRAPI')`;
    const DAYS = `INSERT INTO trading_day (date, source) VALUES ('2026-10-30', 'BRAPI'), ('2026-11-03', 'CALENDAR')`;

    it('o que a migration tira é o que se esperava: dois valores de enum e três colunas, uma em cada tipo de dado', () => {
      expect(legacyLabels.map((row) => row.type).sort()).toEqual([
        'bar_source',
        'trading_day_source',
      ]);
      expect(legacyColumns.map((row) => `${row.table}.${row.type}`).sort()).toEqual([
        'daily_bar.integer',
        'instrument.integer',
        'trading_day.character',
      ]);
    });

    it('preserva o dado da brapi: as barras, os pregões, os papéis e as origens ficam como estavam', async () => {
      const { url, error } = await run([INSTRUMENT, BAR, DAYS]);
      expect(error).toBeNull();
      await onServer(url, async (client) => {
        const bars = await client.query(
          `SELECT count(*)::int AS n, sum(close_cents)::text AS total, min(source::text) AS source FROM daily_bar`,
        );
        expect(bars.rows).toEqual([{ n: 1, total: '5271', source: 'BRAPI' }]);
        const days = await client.query(
          `SELECT date::text AS date, source::text AS source FROM trading_day ORDER BY date`,
        );
        expect(days.rows).toEqual([
          { date: '2026-10-30', source: 'BRAPI' },
          { date: '2026-11-03', source: 'CALENDAR' },
        ]);
        expect((await client.query(`SELECT ticker FROM instrument`)).rows).toEqual([
          { ticker: 'PETR4' },
        ]);
        // o CHECK refeito vale no banco migrado
        await expect(
          client.query(
            `UPDATE daily_bar SET high_cents = 1, low_cents = 2 WHERE id = 'BAR00000000000000000000001'`,
          ),
        ).rejects.toThrow(/daily_bar_values_check/);
      });
    });

    // A guarda tem de cobrir TUDO o que a migration derruba: um caso por valor de enum e por coluna que sai (a lista vem do banco, acima). Coluna
    // nova na lista do que sai sem guarda reprova aqui, em vez de perder o dado em silêncio.
    async function expectRefusedAndUntouched(seed: string[]) {
      const { url, error } = await run(seed);
      expect(error?.message).toMatch(/recusada/);
      await expectUntouched(url);
    }

    // nada mudou: as colunas que iam sair seguem lá, e os valores de enum também
    async function expectUntouched(url: string) {
      await onServer(url, async (client) => {
        const columns = await client.query<{ table: string; column: string }>(
          `SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name IN ('instrument', 'trading_day', 'daily_bar')`,
        );
        const have = new Set(columns.rows.map((row) => `${row.table}.${row.column}`));
        for (const row of legacyColumns) expect(have.has(`${row.table}.${row.column}`)).toBe(true);
        const labels = await client.query<{ type: string; label: string }>(
          `SELECT t.typname AS type, e.enumlabel::text AS label
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname IN ('bar_source', 'trading_day_source')`,
        );
        const kept = new Set(labels.rows.map((row) => `${row.type}.${row.label}`));
        for (const row of legacyLabels) expect(kept.has(`${row.type}.${row.label}`)).toBe(true);
      });
    }

    it('recusa, sem mudar nada, a barra com o valor de origem que sai', async () => {
      const label = legacyLabels.find((row) => row.type === 'bar_source')!.label;
      await expectRefusedAndUntouched([INSTRUMENT, BAR.replace(`'BRAPI')`, `'${label}')`)]);
    }, 60_000);

    it('recusa, sem mudar nada, o pregão com o valor de origem que sai', async () => {
      const label = legacyLabels.find((row) => row.type === 'trading_day_source')!.label;
      await expectRefusedAndUntouched([
        `INSERT INTO trading_day (date, source) VALUES ('2026-10-30', '${label}')`,
      ]);
    }, 60_000);

    // Sem BEGIN nem COMMIT escritos (abaixo), a atomicidade é a da consulta única: uma instrução que falha DEPOIS das trocas dos enums e dos
    // DROP COLUMN desfaz tudo. Uma migration enviada em pedaços, ou com um COMMIT no meio, reprova aqui.
    it('é atômica: uma instrução que falha no fim da mesma consulta desfaz tudo o que veio antes', async () => {
      const { url, error } = await run([INSTRUMENT, BAR, DAYS], '\nSELECT 1 / 0;\n');
      expect(error?.message).toMatch(/division by zero/);
      await expectUntouched(url);
    }, 60_000);

    // um caso por coluna que sai, com um valor que a guarda tem de achar (inteiro: 1000, que não é o padrão 1 do fator nem nulo; texto fixo: 64 "a")
    it('recusa, sem mudar nada, a linha que tem dado numa coluna que sai (uma por coluna)', async () => {
      expect(legacyColumns.length).toBeGreaterThan(0);
      for (const { table, column, type } of legacyColumns) {
        const value = type === 'integer' ? '1000' : `repeat('a', 64)`;
        const seed =
          table === 'instrument'
            ? [
                `INSERT INTO instrument (id, ticker, name, spec, kind, last_seen, "${column}")
                 VALUES ('${INSTRUMENT_ID}', 'PETR4', 'PETROBRAS', 'PN', 'STOCK', '2026-10-30', ${value})`,
              ]
            : table === 'trading_day'
              ? [
                  `INSERT INTO trading_day (date, source, "${column}") VALUES ('2026-10-30', 'BRAPI', ${value})`,
                ]
              : [INSTRUMENT, BAR, `UPDATE daily_bar SET "${column}" = ${value}`];
        await expectRefusedAndUntouched(seed);
      }
    }, 120_000);
  });
});

// O `prisma migrate deploy` (o caminho do job-migrate e do applyMigrations dos testes) manda o arquivo ao servidor como uma consulta só, que o
// Postgres já trata como uma transação. Um BEGIN ou COMMIT escrito no arquivo faz a recusa da guarda deixar a sessão numa transação abortada: o
// operador lê só "current transaction is aborted" em vez da razão, e o erro não chega a ser gravado em _prisma_migrations. O `client.query` dos
// casos acima mostra a mensagem com ou sem eles, então só esta checagem do texto pega a volta dos dois.
describe('a migration do legado, como o Prisma a envia', () => {
  it('não escreve BEGIN nem COMMIT (a consulta única já é uma transação)', () => {
    expect(sqlOf(THIS_MIGRATION)).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
  });
});
