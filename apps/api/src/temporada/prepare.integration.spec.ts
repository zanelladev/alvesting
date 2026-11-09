import { readdirSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../common/id.js';
import { truncateAll } from '../ensaio/driver.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import {
  apiTestUrl,
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../infrastructure/database/test-database.fixture.js';
import { assertSeasonDatabase, prepareSeasonDatabase } from './prepare.js';

// O temporada:preparar (ADR 0038) de verdade, só com bancos de teste: a ORIGEM é o banco de teste desta execução (no lugar do de dev), semeado
// com dados de mercado sintéticos, e o DESTINO é um banco *_test criado pelo próprio comando e apagado no fim. O alvesting_temporada de
// verdade nunca é tocado aqui. O login da api é o de dev (o do .env.example): a senha dele vale para o servidor inteiro, e a demo e o e2e
// usam o mesmo login.
const target = testDatabaseUrl
  ? (() => {
      const url = new URL(testDatabaseUrl);
      url.pathname = `/${url.pathname.slice(1).replace(/_test$/, '')}_preparar_test`;
      return url.toString();
    })()
  : '';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe.skipIf(!testDatabaseUrl)(integrationTitle('temporada:preparar'), () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    prisma = await openTestDatabase(testDatabaseUrl!);
    await truncateAll(prisma);
    const petr = newId();
    const bova = newId();
    await prisma.instrument.createMany({
      data: [
        {
          id: petr,
          ticker: 'PETR4',
          name: 'PETROBRAS',
          spec: 'PN',
          kind: 'STOCK',
          lastSeen: day('2026-11-03'),
        },
        {
          id: bova,
          ticker: 'BOVA11',
          name: 'ISHARES BOVA',
          spec: 'CI',
          kind: 'REFERENCE',
          lastSeen: day('2026-11-03'),
        },
      ],
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    await prisma.instrumentLogo.create({
      data: {
        instrumentId: petr,
        sourceUrl: 'https://icons.brapi.dev/icons/PETR4.svg',
        svg,
        sha256: 'a'.repeat(64),
        bytes: Buffer.byteLength(svg),
        fetchedAt: new Date('2026-11-04T12:00:00Z'),
      },
    });
    await prisma.tradingDay.createMany({
      data: [
        { date: day('2026-10-30'), source: 'BRAPI' },
        { date: day('2026-11-03'), source: 'BRAPI' },
        { date: day('2026-11-04'), source: 'CALENDAR' },
      ],
    });
    await prisma.dailyBar.createMany({
      data: [petr, bova].flatMap((instrumentId) =>
        ['2026-10-30', '2026-11-03'].map((date) => ({
          id: newId(),
          instrumentId,
          date: day(date),
          openCents: 3_000n,
          highCents: 3_100n,
          lowCents: 2_900n,
          closeCents: 3_050n,
          volumeCents: 1_000_000_000n,
          source: 'BRAPI' as const,
        })),
      ),
    });
  }, 120_000);

  afterAll(async () => {
    await truncateAll(prisma);
    await prisma.onModuleDestroy();
    // o banco de destino é deste teste: some no fim
    const maintenance = new URL(target);
    maintenance.pathname = '/postgres';
    const client = new pg.Client({ connectionString: maintenance.toString() });
    await client.connect();
    await client.query(
      `DROP DATABASE IF EXISTS "${new URL(target).pathname.slice(1)}" WITH (FORCE)`,
    );
    await client.end();
  });

  const counts = async (url: string) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const one = async (table: string) =>
        (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0]!.n;
      return {
        instrument: await one('instrument'),
        instrument_logo: await one('instrument_logo'),
        trading_day: await one('trading_day'),
        daily_bar: await one('daily_bar'),
      };
    } finally {
      await client.end();
    }
  };

  it('cria o banco, aplica as migrations, prepara o login da api e copia o mercado; a segunda vez não copia nada de novo', async () => {
    const before = await counts(testDatabaseUrl!);
    const lines: string[] = [];
    const first = await prepareSeasonDatabase({
      targetUrl: target,
      sourceUrl: testDatabaseUrl!,
      apiUrl: apiTestUrl(target),
      log: (line) => lines.push(line),
    });
    expect(first).toEqual({
      created: true,
      copied: { instruments: 2, logos: 1, tradingDays: 3, bars: 4 },
    });
    const second = await prepareSeasonDatabase({
      targetUrl: target,
      sourceUrl: testDatabaseUrl!,
      apiUrl: apiTestUrl(target),
      log: () => undefined,
    });
    expect(second).toEqual({
      created: false,
      copied: { instruments: 0, logos: 0, tradingDays: 0, bars: 0 },
    });
    expect(await counts(target)).toEqual({
      instrument: 2,
      instrument_logo: 1,
      trading_day: 3,
      daily_bar: 4,
    });
    // a origem só foi lida
    expect(await counts(testDatabaseUrl!)).toEqual(before);
    // as migrations todas, e o login da api entra no banco novo
    const migrations = readdirSync(new URL('../../prisma/migrations/', import.meta.url)).filter(
      (name) => /^\d{14}_/.test(name),
    );
    const admin = new pg.Client({ connectionString: target });
    await admin.connect();
    const applied = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL',
    );
    await admin.end();
    expect(applied.rows[0]!.n).toBe(migrations.length);
    const api = new pg.Client({ connectionString: apiTestUrl(target) });
    await api.connect();
    const who = await api.query('SELECT current_user AS who, count(*)::int AS n FROM instrument');
    await api.end();
    expect(who.rows[0]).toEqual({ who: 'alvesting_api', n: 2 });
    // o log diz o que fez, sem a URL (que tem senha)
    expect(lines.join('\n')).not.toMatch(/postgresql:\/\//);
  }, 180_000);

  it('o pregão confirmado na origem confirma o que no destino ainda era só previsão; o resto do destino não muda', async () => {
    const client = new pg.Client({ connectionString: target });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO trading_day (date, source) VALUES ('2026-11-05', 'CALENDAR') ON CONFLICT DO NOTHING`,
      );
      await client.query(`UPDATE trading_day SET source = 'CALENDAR' WHERE date = '2026-11-03'`);
      await prepareSeasonDatabase({
        targetUrl: target,
        sourceUrl: testDatabaseUrl!,
        apiUrl: apiTestUrl(target),
        log: () => undefined,
      });
      const rows = await client.query(
        `SELECT date::text AS date, source::text AS source FROM trading_day ORDER BY date`,
      );
      expect(rows.rows).toEqual([
        { date: '2026-10-30', source: 'BRAPI' },
        { date: '2026-11-03', source: 'BRAPI' },
        { date: '2026-11-04', source: 'CALENDAR' },
        { date: '2026-11-05', source: 'CALENDAR' },
      ]);
    } finally {
      await client.end();
    }
  }, 180_000);

  it('recusa qualquer banco que não seja o alvesting_temporada ou um *_test, e servidor fora da máquina, antes de conectar', () => {
    for (const url of [
      'postgresql://alvesting:alvesting@localhost:25432/alvesting_dev',
      'postgresql://alvesting:alvesting@localhost:25432/alvesting_ensaio',
      'postgresql://alvesting:alvesting@localhost:25432/alvesting_temporada2',
    ]) {
      expect(() => assertSeasonDatabase(url), url).toThrow(/só prepara o alvesting_temporada/);
    }
    expect(() =>
      assertSeasonDatabase(
        'postgresql://alvesting:segredo@db.exemplo.invalid:5432/alvesting_temporada',
      ),
    ).toThrow(/própria máquina/);
    expect(() =>
      assertSeasonDatabase(
        'postgresql://alvesting:segredo@db.exemplo.invalid:5432/alvesting_temporada',
      ),
    ).not.toThrow(/segredo/);
    expect(() =>
      assertSeasonDatabase('postgresql://alvesting:alvesting@localhost:25432/alvesting_temporada'),
    ).not.toThrow();
  });
});
