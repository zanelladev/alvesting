import { createHash } from 'node:crypto';
import { seasonParamsSchema } from '@alvesting/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { BriefingRepository } from './briefing.repository.js';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe.skipIf(!testDatabaseUrl)(integrationTitle('BriefingRepository'), () => {
  let prisma: PrismaService;
  let repo: BriefingRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    repo = new BriefingRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    await prisma.briefing.deleteMany();
    await prisma.newsItem.deleteMany();
    await prisma.macroDaily.deleteMany();
    await prisma.universeMember.deleteMany();
    await prisma.universeSnapshot.deleteMany();
    await prisma.dailyBar.deleteMany();
    await prisma.instrument.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function instrument(ticker: string, name = ticker, kind: 'STOCK' | 'REFERENCE' = 'STOCK') {
    return prisma.instrument.create({
      data: { id: newId(), ticker, name, spec: 'ON', kind, lastSeen: day('2026-10-29') },
    });
  }
  async function bar(instrumentId: string, date: string, close: bigint) {
    await prisma.dailyBar.create({
      data: {
        id: newId(),
        instrumentId,
        date: day(date),
        openCents: close - 10n,
        highCents: close + 20n,
        lowCents: close - 30n,
        closeCents: close,
        volumeCents: 5_000_000_000n,
        source: 'BRAPI',
      },
    });
  }

  describe('universe', () => {
    it('devolve os membros da semana em ordem de posição, com o nome e o volume médio', async () => {
      const petr = await instrument('PETR4', 'PETROBRAS');
      const vale = await instrument('VALE3', 'VALE');
      const snapshot = await prisma.universeSnapshot.create({
        data: {
          id: newId(),
          week: '2026-W44',
          windowStart: day('2026-07-27'),
          windowEnd: day('2026-10-23'),
          windowDays: 60,
          candidates: 2,
          eligible: 2,
        },
      });
      await prisma.universeMember.createMany({
        data: [
          {
            id: newId(),
            snapshotId: snapshot.id,
            instrumentId: vale.id,
            position: 2,
            avgVolumeCents: 200n,
            presenceDays: 60,
          },
          {
            id: newId(),
            snapshotId: snapshot.id,
            instrumentId: petr.id,
            position: 1,
            avgVolumeCents: 300n,
            presenceDays: 60,
          },
        ],
      });
      expect(await repo.universe('2026-W44')).toEqual([
        { ticker: 'PETR4', name: 'PETROBRAS', position: 1, avgVolumeCents: 300n },
        { ticker: 'VALE3', name: 'VALE', position: 2, avgVolumeCents: 200n },
      ]);
    });

    it('semana sem universo congelado: nulo (o freeze não usa o de outra semana)', async () => {
      expect(await repo.universe('2026-W44')).toBeNull();
    });
  });

  describe('bars', () => {
    it('devolve as barras dos tickers pedidos dentro do intervalo, agrupadas por ticker', async () => {
      const petr = await instrument('PETR4');
      const vale = await instrument('VALE3');
      await instrument('ITUB4');
      for (const [i, date] of ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].entries()) {
        await bar(petr.id, date, 3000n + BigInt(i));
        await bar(vale.id, date, 6000n + BigInt(i));
      }
      const bars = await repo.bars(['PETR4', 'ITUB4', 'XXXX3'], '2026-10-28', '2026-10-29');
      expect([...bars.keys()]).toEqual(['PETR4']);
      expect(bars.get('PETR4')?.map((b) => [b.date, b.closeCents])).toEqual([
        ['2026-10-28', 3001n],
        ['2026-10-29', 3002n],
      ]);
      expect(bars.get('PETR4')?.[0]).toEqual({
        date: '2026-10-28',
        openCents: 2991n,
        highCents: 3021n,
        lowCents: 2971n,
        closeCents: 3001n,
        volumeCents: 5_000_000_000n,
      });
    });

    it('lista vazia de tickers não consulta nada', async () => {
      expect((await repo.bars([], '2026-10-28', '2026-10-29')).size).toBe(0);
    });
  });

  describe('macro', () => {
    it('o valor mais recente de cada série até a data, com as casas da série', async () => {
      await prisma.$executeRaw`
        INSERT INTO macro_daily (series, date, value) VALUES
          ('cdi_daily_pct', '2026-10-27', 0.05), ('cdi_daily_pct', '2026-10-29', 0.050788), ('cdi_daily_pct', '2026-10-30', 0.09),
          ('selic_target_pct_year', '2026-10-29', 13.75), ('ipca_month_pct', '2026-09-01', 0.82),
          ('usd_brl_ptax_sell', '2026-10-29', 5.3744), ('serie_fora_da_lista', '2026-10-29', 1)`;
      const rows = await repo.macro('2026-10-29');
      expect(Object.fromEntries(rows.map((r) => [r.series, [r.date, r.value]]))).toEqual({
        cdi_daily_pct: ['2026-10-29', '0.050788'],
        selic_target_pct_year: ['2026-10-29', '13.75'],
        ipca_month_pct: ['2026-09-01', '0.82'],
        usd_brl_ptax_sell: ['2026-10-29', '5.3744'],
      });
    });

    it('sem nada até a data: lista vazia', async () => {
      expect(await repo.macro('2026-10-29')).toEqual([]);
    });
  });

  describe('news: cada notícia entra em exatamente um briefing', () => {
    const item = (path: string, firstSeenAt: string) => ({
      id: newId(),
      urlHash: createHash('sha256').update(path).digest('hex'),
      url: `https://exemplo.com.br/${path}`,
      source: 'infomoney',
      title: `Título ${path}`,
      snippet: 'Resumo.',
      tickers: ['PETR4'],
      publishedAt: new Date(firstSeenAt),
      firstSeenAt: new Date(firstSeenAt),
    });

    it('janela aberta no início e fechada no fim: (de, até] sobre a hora em que foi vista', async () => {
      await prisma.newsItem.createMany({
        data: [
          item('antes', '2026-10-29T10:29:59Z'),
          item('no-inicio', '2026-10-29T10:30:00Z'), // pertence ao briefing anterior
          item('dentro', '2026-10-29T21:00:00Z'),
          item('no-fim', '2026-10-30T10:30:00Z'), // pertence a este
          item('depois', '2026-10-30T10:30:01Z'),
        ],
      });
      const rows = await repo.news(
        new Date('2026-10-29T10:30:00Z'),
        new Date('2026-10-30T10:30:00Z'),
      );
      expect(rows.map((r) => r.title).sort()).toEqual(['Título dentro', 'Título no-fim']);
      const first = rows[0]!;
      expect(first.publishedAt).toBeInstanceOf(Date);
      expect(first.urlHash).toMatch(/^[0-9a-f]{64}$/);
      expect({ ...first, publishedAt: null, title: '', urlHash: '' }).toEqual({
        source: 'infomoney',
        publishedAt: null,
        title: '',
        snippet: 'Resumo.',
        tickers: ['PETR4'],
        urlHash: '',
      });
    });

    it('duas janelas seguidas (de, até] e (até, depois] não perdem nem repetem notícia', async () => {
      await prisma.newsItem.createMany({
        data: Array.from({ length: 24 }, (_, hour) =>
          item(`h${hour}`, `2026-10-29T${String(hour).padStart(2, '0')}:30:00Z`),
        ),
      });
      const a = await repo.news(new Date('2026-10-29T00:30:00Z'), new Date('2026-10-29T10:30:00Z'));
      const b = await repo.news(new Date('2026-10-29T10:30:00Z'), new Date('2026-10-29T23:30:00Z'));
      const titles = [...a, ...b].map((r) => r.title);
      expect(new Set(titles).size).toBe(titles.length);
      expect(titles).toHaveLength(23); // da 01:30 até a 23:30, sem a das 00:30
    });
  });

  describe('runningSeasons: de onde saem as regras do briefing', () => {
    // valores sintéticos; só as sementes não têm padrão
    const params = (sessions: number) =>
      seasonParamsSchema.parse({ randomSeed: 'a', monteCarloSeed: 'b', sessions });
    const season = (
      slug: string,
      status: 'DRAFT' | 'RUNNING' | 'FINISHED',
      startDate: string | null,
      sessions: number,
    ) =>
      prisma.season.create({
        data: {
          id: newId(),
          slug,
          name: slug,
          status,
          startDate: startDate === null ? null : day(startDate),
          // o banco recusa FINISHED sem a hora do encerramento (season_finished_check, etapa 7)
          finishedAt: status === 'FINISHED' ? new Date('2026-10-30T21:00:00Z') : null,
          params: params(sessions),
        },
      });

    beforeEach(async () => {
      await prisma.season.deleteMany();
    });

    it('só a temporada RUNNING que já começou no pregão, com os parâmetros validados', async () => {
      await season('ja-comecou', 'RUNNING', '2026-11-03', 5);
      await season('comeca-depois', 'RUNNING', '2026-11-04', 6);
      await season('rascunho', 'DRAFT', null, 7);
      await season('acabou', 'FINISHED', '2026-10-01', 8);
      const found = await repo.runningSeasons('2026-11-03');
      expect(found.map((p) => p.sessions)).toEqual([5]);
      expect(found[0]).toEqual(params(5));
      expect((await repo.runningSeasons('2026-11-04')).map((p) => p.sessions).sort()).toEqual([
        5, 6,
      ]);
      expect(await repo.runningSeasons('2026-11-02')).toEqual([]);
    });

    it('parâmetro gravado fora do schema derruba a leitura (o freeze falha em vez de anunciar regra torta)', async () => {
      await prisma.season.create({
        data: {
          id: newId(),
          slug: 'torta',
          name: 'torta',
          status: 'RUNNING',
          startDate: day('2026-11-03'),
          params: { capitalCents: 'muito' },
        },
      });
      await expect(repo.runningSeasons('2026-11-03')).rejects.toThrow();
    });
  });

  describe('briefing', () => {
    it('grava uma linha por pregão e a segunda tentativa só reconhece', async () => {
      const input = {
        date: '2026-10-30',
        sha256: 'a'.repeat(64),
        uri: 'https://x/briefings/a.json',
        bytes: 1234,
      };
      await expect(repo.save(input)).resolves.toBe('created');
      await expect(repo.save({ ...input, sha256: 'b'.repeat(64) })).resolves.toBe('exists');
      expect(await prisma.briefing.count()).toBe(1);
      expect(await repo.find('2026-10-30')).toEqual({
        date: '2026-10-30',
        sha256: 'a'.repeat(64),
        uri: 'https://x/briefings/a.json',
      });
      expect(await repo.find('2026-10-29')).toBeNull();
    });

    it('latestBefore devolve o último briefing anterior à data', async () => {
      for (const date of ['2026-10-27', '2026-10-29', '2026-11-03']) {
        await repo.save({ date, sha256: 'a'.repeat(64), uri: 'https://x/a.json', bytes: 1 });
      }
      expect(await repo.latestBefore('2026-10-30')).toBe('2026-10-29');
      expect(await repo.latestBefore('2026-10-29')).toBe('2026-10-27');
      expect(await repo.latestBefore('2026-10-27')).toBeNull();
    });

    it('o banco recusa SHA-256 que não é hexadecimal minúsculo de 64 caracteres e arquivo vazio', async () => {
      await expect(
        repo.save({ date: '2026-10-30', sha256: 'XYZ', uri: 'https://x', bytes: 1 }),
      ).rejects.toThrow();
      await expect(
        repo.save({ date: '2026-10-30', sha256: 'A'.repeat(64), uri: 'https://x', bytes: 1 }),
      ).rejects.toThrow();
      await expect(
        repo.save({ date: '2026-10-30', sha256: 'a'.repeat(64), uri: 'https://x', bytes: 0 }),
      ).rejects.toThrow();
    });
  });
});
