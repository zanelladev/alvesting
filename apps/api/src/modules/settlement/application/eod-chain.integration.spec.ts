import { seasonFileSchema, type QueueMessage } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { CycleCloser } from '../../arena/application/cycle-closer.js';
import { ArenaRepository } from '../../arena/infrastructure/arena.repository.js';
import { seasonFile } from '../../arena/testing/arena.fixture.js';
import { BarLoader } from '../../market-data/application/bar-loader.js';
import { EodHandler } from '../../market-data/application/eod.handler.js';
import { addDays } from '../../market-data/domain/dates.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { MarketRepository } from '../../market-data/infrastructure/market.repository.js';
import { UniverseRepository } from '../../market-data/infrastructure/universe.repository.js';
import {
  at,
  brapiWorld,
  marketOf,
  type BrapiTestWorld,
} from '../../market-data/testing/brapi-market.fixture.js';
import { handleDelivery } from '../../messaging/application/handle-delivery.js';
import { JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { SettlementRepository } from '../infrastructure/settlement.repository.js';
import { cleanSettlementTables, day } from '../testing/settlement.fixture.js';
import { SettleHandler } from './settle.handler.js';
import { SettlementPublisher } from './settlement-publisher.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// O encadeamento eod -> settle de ponta a ponta: o EodHandler de verdade (com a brapi falsa, nenhuma rede), o publicador de verdade (a
// fila é só uma lista) e o SettleHandler de verdade, no Postgres. Os dados são inventados: duas ações, o BOVA11 e três pregões.
const D1 = '2026-11-03';
const D2 = '2026-11-04';
const D3 = '2026-11-05';
const TICKERS = ['PETR4', 'VALE3'];
// o fechamento de cada papel em cada pregão (centavos)
const CLOSES: Record<string, Record<string, bigint>> = {
  PETR4: { [D1]: 3300n, [D2]: 3400n, [D3]: 3500n },
  VALE3: { [D1]: 5300n, [D2]: 5200n, [D3]: 5100n },
  BOVA11: { [D1]: 15000n, [D2]: 15100n, [D3]: 15200n },
};
const closeOf = (ticker: string, date: string) => CLOSES[ticker]![date]!;

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('o encadeamento eod -> settle (de ponta a ponta)'),
  () => {
    let prisma: PrismaService;
    let jobs: JobRunStore;
    let arena: ArenaRepository;
    let settle: SettleHandler;
    let published: QueueMessage[];

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      jobs = new JobRunStore(prisma);
      arena = new ArenaRepository(prisma);
      settle = new SettleHandler({
        jobs,
        arena,
        closer: new CycleCloser(arena),
        repo: new SettlementRepository(prisma),
        calendar: loadTradingCalendar(),
        clock: () => new Date('2026-11-06T00:35:00Z'),
      });
    }, 120_000);

    beforeEach(async () => {
      await cleanSettlementTables(prisma);
      published = [];
    });

    afterAll(async () => {
      await cleanSettlementTables(prisma);
      await prisma.onModuleDestroy();
    });

    // O universo da semana (PETR4 e VALE3), os instrumentos (e o BOVA11, a sonda do eod), o CDI e uma temporada de `sessions` pregões a
    // partir de 03/11
    async function world(sessions: number) {
      const ids = new Map<string, string>();
      for (const [ticker, name, kind] of [
        ['PETR4', 'PETROBRAS', 'STOCK'],
        ['VALE3', 'VALE', 'STOCK'],
        ['BOVA11', 'ISHARES BOVA', 'REFERENCE'],
      ] as const) {
        const id = newId();
        ids.set(ticker, id);
        await prisma.instrument.create({
          data: { id, ticker, name, spec: 'ON', kind, lastSeen: day('2026-10-30') },
        });
      }
      await prisma.universeSnapshot.create({
        data: {
          id: newId(),
          week: '2026-W45',
          windowStart: day('2026-08-03'),
          windowEnd: day('2026-10-30'),
          windowDays: 60,
          candidates: 2,
          eligible: 2,
          members: {
            create: TICKERS.map((ticker, index) => ({
              id: newId(),
              instrumentId: ids.get(ticker)!,
              position: index + 1,
              avgVolumeCents: 1_000_000_000n,
              presenceDays: 60,
            })),
          },
        },
      });
      await prisma.macroDaily.createMany({
        data: ['2026-10-30', D1, D2, D3].map((date) => ({
          series: 'cdi_daily_pct',
          date: day(date),
          value: '0.0500',
        })),
      });
      const file = seasonFile();
      const seasonId = await arena.createSeason(
        seasonFileSchema.parse({ ...file, params: { ...file.params, sessions } }),
      );
      await arena.startSeason(seasonId, D1, new Date('2026-11-01T18:00:00Z'));
      return seasonId;
    }

    // A brapi falsa com o mercado destes três pregões; `extra` injeta o que o teste quer (publicação atrasada, queda, papel sem negócio)
    const brapi = (
      extra: Parameters<typeof brapiWorld>[0]['intercept'] | undefined = undefined,
      options: Partial<Parameters<typeof brapiWorld>[0]> = {},
      absent?: (ticker: string, date: string) => boolean,
    ) =>
      brapiWorld({
        market: marketOf({
          days: [D1, D2, D3],
          tickers: ['BOVA11', ...TICKERS],
          close: closeOf,
          absent,
        }),
        start: at(D1, '20:00'),
        intercept: extra,
        ...options,
      });

    // O eod de verdade de um pregão. Cada chamada é uma entrega da fila `market`; o publicador só anota a mensagem.
    function eod(w: BrapiTestWorld) {
      const calendar = loadTradingCalendar();
      const market = new MarketRepository(prisma);
      const publisher = new SettlementPublisher({
        seasons: arena,
        jobs,
        messaging: {
          publish: vi.fn((message: QueueMessage) => {
            published.push(message);
            return Promise.resolve();
          }),
        },
        calendar,
      });
      return new EodHandler(
        jobs,
        calendar,
        market,
        new UniverseRepository(prisma),
        new BarLoader(w.client, market),
        { publishScheduled: vi.fn(() => Promise.resolve()) },
        publisher,
      );
    }
    // uma entrega do eod nesse horário de Brasília (21:30 é a primeira tentativa; o prazo é 00:30 do dia seguinte)
    const run = (handler: EodHandler, w: BrapiTestWorld, date: string, hhmm = '21:30') => {
      const now = hhmm === '00:30' ? at(addDays(date, 1), hhmm, 0) : at(date, hhmm);
      w.clock.set(now);
      return handler.execute(date, now);
    };

    // A entrega de uma mensagem settle pela fila: o mesmo caminho do MessagingService (handleDelivery), sem o Service Bus.
    const deliver = (message: QueueMessage) => handleDelivery('settlement', message, settle.handle);
    const settleOf = (seasonId: string, date: string): QueueMessage => ({
      type: 'settle',
      seasonId,
      date,
    });
    const snapshotsOf = (seasonId: string, date: string) =>
      prisma.equitySnapshot.count({ where: { seasonId, date: day(date) } });

    it('o eod concluído publica o settle do pregão; entregue pela fila, liquida a temporada; o último pregão a encerra', async () => {
      const seasonId = await world(2);
      const w = brapi();

      await run(eod(w), w, D1);
      expect(published).toEqual([settleOf(seasonId, D1)]);
      await expect(deliver(published[0]!)).resolves.toEqual({ action: 'complete' });
      expect(await prisma.equitySnapshot.count({ where: { seasonId } })).toBe(7);

      await run(eod(w), w, D2);
      expect(published.at(-1)).toEqual(settleOf(seasonId, D2));
      await expect(deliver(published.at(-1)!)).resolves.toEqual({ action: 'complete' });
      expect(await prisma.equitySnapshot.count({ where: { seasonId } })).toBe(14);
      expect(await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })).toMatchObject({
        status: 'FINISHED',
      });
      // a liquidação usa as barras que o eod gravou (a abertura do pregão para executar, o fechamento para marcar)
      const igualPeso = await prisma.position.findMany({
        where: { seasonId, competitor: { slug: 'igual-peso' }, date: day(D1) },
        orderBy: { ticker: 'asc' },
      });
      expect(igualPeso.map((p) => [p.ticker, p.markCents])).toEqual([
        ['PETR4', 3300n],
        ['VALE3', 5300n],
      ]);
    });

    it('um pregão que a brapi ainda não publicou (reagendado) não publica nada; quando ela publica, publica', async () => {
      const seasonId = await world(2);
      const w = brapi(undefined, { publishedAt: new Map([[D1, at(D1, '22:10', 0)]]) });
      const handler = eod(w);
      await expect(run(handler, w, D1)).resolves.toBe('rescheduled');
      expect(published).toEqual([]);

      await expect(run(handler, w, D1, '22:30')).resolves.toBe('complete'); // a cópia agendada
      expect(published).toEqual([settleOf(seasonId, D1)]);
    });

    it('o eod repetido (a publicação anterior se perdeu) republica; o settle entregue duas vezes liquida uma só', async () => {
      const seasonId = await world(2);
      const w = brapi();
      await run(eod(w), w, D1);
      published = []; // a mensagem se perdeu antes de chegar à fila

      await run(eod(w), w, D1, '21:31'); // a fila entrega o eod de novo
      expect(published).toEqual([settleOf(seasonId, D1)]);
      await deliver(published[0]!);
      const before = await prisma.equitySnapshot.findMany({
        where: { seasonId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      await deliver(published[0]!); // a segunda entrega do mesmo settle
      expect(
        await prisma.equitySnapshot.findMany({
          where: { seasonId },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(before);
      expect(await prisma.jobRun.count({ where: { type: 'settle' } })).toBe(1);
    });

    // A5: a noite inteira sem brapi. O eod seguinte preenche o pregão anterior pela janela e liquida os dois, em ordem.
    it('uma noite inteira sem a brapi: o eod seguinte preenche o pregão anterior e a liquidação do mais novo refaz os dois em ordem', async () => {
      const seasonId = await world(3);
      let down = true;
      const w = brapi(() => (down ? new Response('{}', { status: 503 }) : undefined));
      const handler = eod(w);

      // a noite de D1: nada vem, até o prazo das 00:30; o pregão não é confirmado nem liquidado
      for (const hhmm of ['21:30', '22:30', '23:30']) {
        await expect(run(handler, w, D1, hhmm)).resolves.toBe('rescheduled');
      }
      await expect(run(handler, w, D1, '00:30')).resolves.toBe('closed_incomplete');
      expect(published).toEqual([]);
      expect(await prisma.dailyBar.count()).toBe(0);

      // a noite de D2: a brapi voltou; a janela de 5 pregões traz D1 e D2, e UMA liquidação (a de D2) refaz a temporada do zero, em ordem
      down = false;
      await expect(run(handler, w, D2)).resolves.toBe('complete');
      expect(published).toEqual([settleOf(seasonId, D2)]);
      await expect(deliver(published[0]!)).resolves.toEqual({ action: 'complete' });
      expect(await snapshotsOf(seasonId, D1)).toBe(7);
      expect(await snapshotsOf(seasonId, D2)).toBe(7);
      // o patrimônio de D1 existe e foi calculado com as barras de D1 (a abertura de D1 executou as ordens do primeiro pregão)
      const marks = await prisma.position.findMany({
        where: { seasonId, competitor: { slug: 'igual-peso' }, date: day(D1) },
        orderBy: { ticker: 'asc' },
      });
      expect(marks.map((p) => [p.ticker, p.markCents])).toEqual([
        ['PETR4', 3300n],
        ['VALE3', 5300n],
      ]);
      expect(await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })).toMatchObject({
        status: 'RUNNING',
      });
    });

    // A4: a barra que chega atrasada para um pregão já liquidado é gravada, mas o eod não pede a liquidação dele de novo.
    it('a barra atrasada de um pregão já liquidado é gravada e o eod não o reabre: o settle dele fica como está', async () => {
      const seasonId = await world(3);
      // o VALE3 não negociou em D1 na brapi (a barra de D1 dele só aparece na janela de D2)
      let vale3Late = false;
      const w = brapi((url) => {
        const symbol = url.searchParams.get('symbols');
        if (symbol === 'VALE3' && !vale3Late && url.searchParams.get('endDate') === D1) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  requestedSymbol: 'VALE3',
                  symbol: 'VALE3',
                  changed: false,
                  data: { usedInterval: '1d', usedRange: '1mo', historicalDataPrice: [] },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return undefined;
      });
      const handler = eod(w);
      await run(handler, w, D1, '21:30');
      await run(handler, w, D1, '00:30'); // o prazo: o VALE3 de D1 não veio, o pregão conclui sem ele
      expect(published).toEqual([settleOf(seasonId, D1)]);
      await deliver(published[0]!);
      const run1 = await prisma.jobRun.findFirstOrThrow({
        where: { type: 'settle', idempotencyKey: `${seasonId}:${D1}` },
      });

      vale3Late = true;
      await run(handler, w, D2);
      expect(
        await prisma.dailyBar.count({ where: { instrument: { ticker: 'VALE3' }, date: day(D1) } }),
      ).toBe(1); // a barra atrasada foi gravada
      // só o settle de D2 é pedido: o de D1 não é reaberto
      expect(published.at(-1)).toEqual(settleOf(seasonId, D2));
      expect(published.filter((m) => m.type === 'settle' && m.date === D1)).toHaveLength(1);
      const run2 = await prisma.jobRun.findFirstOrThrow({
        where: { type: 'settle', idempotencyKey: `${seasonId}:${D1}` },
      });
      expect(run2).toMatchObject({ status: 'SUCCEEDED', attempts: run1.attempts });
    });
  },
);
