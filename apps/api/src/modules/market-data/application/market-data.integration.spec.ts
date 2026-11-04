import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { cleanSettlementTables } from '../../settlement/testing/settlement.fixture.js';
import { QUOTA_RESERVE } from '../domain/bar-plan.js';
import { addDays, type IsoDate } from '../domain/dates.js';
import { loadTradingCalendar } from '../domain/trading-calendar.js';
import { BrapiConfigError } from '../infrastructure/brapi.client.js';
import { MarketRepository } from '../infrastructure/market.repository.js';
import { UniverseRepository } from '../infrastructure/universe.repository.js';
import {
  at,
  brapiWorld,
  marketOf,
  type BrapiTestWorld,
  type MarketSpec,
} from '../testing/brapi-market.fixture.js';
import { BarLoader } from './bar-loader.js';
import { EodHandler } from './eod.handler.js';

// O eod de ponta a ponta no Postgres: o EodHandler, o BarLoader, o BrapiClient e os repositórios de verdade, com a brapi falsa do ensaio
// (nenhuma rede) e a fila e o publicador do settle só anotando o que recebem. Cobre A1 a A5 do pedido da onda: a requisição por papel que
// falta, a falha parcial, a cota, a barra que nunca é sobrescrita e a noite inteira sem brapi.
const calendar = loadTradingCalendar();
const D0 = '2026-10-30'; // o último pregão do histórico
const D1 = '2026-11-03'; // o pregão da noite (02/11 é feriado)
const D2 = '2026-11-04';
const HISTORY: IsoDate[] = ['2026-10-27', '2026-10-28', '2026-10-29', D0];
const DAYS: IsoDate[] = [...HISTORY, D1, D2, '2026-11-05'];
const UNIVERSE = ['PETR4', 'VALE3', 'ITUB4'];
const ALL = ['BOVA11', ...UNIVERSE, 'AMER3', 'WEGE3'];
// o obrigatório: o BOVA11, o universo e a posição de uma temporada em andamento (AMER3, fora do universo); o opcional: o WEGE3, da
// carteira de um usuário
const day = (date: IsoDate) => new Date(`${date}T00:00:00Z`);

describe.skipIf(!testDatabaseUrl)(integrationTitle('eod com a brapi (A1 a A5)'), () => {
  let prisma: PrismaService;
  let jobs: JobRunStore;
  let market: MarketRepository;
  let scheduled: Array<{ message: unknown; at: Date }>;
  let settled: IsoDate[][];
  let error: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    jobs = new JobRunStore(prisma);
    market = new MarketRepository(prisma);
  }, 120_000);

  const clean = async () => {
    await cleanSettlementTables(prisma);
    await prisma.portfolioLot.deleteMany();
    await prisma.portfolio.deleteMany();
    await prisma.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
  };

  beforeEach(async () => {
    await clean();
    scheduled = [];
    settled = [];
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await clean();
    await prisma.onModuleDestroy();
  });

  const spec = (extra: Partial<MarketSpec> = {}): MarketSpec => ({
    days: DAYS,
    tickers: ALL,
    ...extra,
  });

  // O banco no começo da noite de D1: os papéis, o histórico até D0 (confirmado), o universo da semana e, com `extras`, uma posição de
  // temporada em andamento no AMER3 (fora do universo) e o WEGE3 (e o PETR4) na carteira de um usuário.
  async function seed(w: BrapiTestWorld, options: { tickers?: string[]; extras?: boolean } = {}) {
    const tickers = options.tickers ?? ALL;
    await market.insertInstruments(
      tickers.map((ticker) => ({
        ticker,
        name: `${ticker} SA`,
        spec: 'ON',
        kind: ticker === 'BOVA11' ? ('REFERENCE' as const) : ('STOCK' as const),
      })),
      D0,
    );
    await market.insertBars(
      HISTORY.flatMap((date) =>
        (w.marketData.bars.get(date) ?? [])
          .filter((bar) => tickers.includes(bar.ticker))
          .map((bar) => ({
            ticker: bar.ticker,
            date,
            openCents: bar.open,
            highCents: bar.high,
            lowCents: bar.low,
            closeCents: bar.close,
            volumeCents: bar.volume,
          })),
      ),
    );
    await market.confirmTradingDays(HISTORY);
    const ids = new Map((await prisma.instrument.findMany()).map((i) => [i.ticker, i.id]));
    const members = options.extras === false ? tickers.filter((t) => t !== 'BOVA11') : UNIVERSE;
    await prisma.universeSnapshot.create({
      data: {
        id: newId(),
        week: '2026-W45',
        windowStart: day('2026-08-04'),
        windowEnd: day(D0),
        windowDays: 60,
        candidates: members.length,
        eligible: members.length,
        members: {
          create: members.map((ticker, index) => ({
            id: newId(),
            instrumentId: ids.get(ticker)!,
            position: index + 1,
            avgVolumeCents: 1_000_000n,
            presenceDays: 60,
          })),
        },
      },
    });
    if (options.extras === false) return;
    const season = await prisma.season.create({
      data: {
        id: newId(),
        slug: `temporada-${newId().toLowerCase()}`,
        name: 'Em andamento',
        status: 'RUNNING',
        startDate: day(D0),
        params: {},
      },
    });
    const competitor = await prisma.competitor.create({
      data: {
        id: newId(),
        seasonId: season.id,
        slug: 'sorteio',
        name: 'Sorteio',
        kind: 'RANDOM',
        position: 1,
      },
    });
    await prisma.position.create({
      data: {
        id: newId(),
        seasonId: season.id,
        competitorId: competitor.id,
        date: day(D0),
        ticker: 'AMER3',
        quantity: 10n,
        costCents: 1_000n,
        markCents: 100n,
        valueCents: 1_000n,
        stale: false,
      },
    });
    const user = await prisma.user.create({
      data: { id: newId(), name: 'Teste', email: `eod-${newId().toLowerCase()}@example.test` },
    });
    const portfolio = await prisma.portfolio.create({ data: { id: newId(), userId: user.id } });
    for (const ticker of ['WEGE3', 'PETR4']) {
      await prisma.portfolioLot.create({
        data: { id: newId(), portfolioId: portfolio.id, ticker, quantity: 10, costCents: 1_000n },
      });
    }
  }

  function handler(w: BrapiTestWorld, afterEod?: (days: readonly IsoDate[]) => Promise<never[]>) {
    return new EodHandler(
      jobs,
      calendar,
      market,
      new UniverseRepository(prisma),
      new BarLoader(w.client, market),
      {
        publishScheduled: vi.fn((message: unknown, when: Date) => {
          scheduled.push({ message, at: when });
          return Promise.resolve();
        }),
      },
      {
        afterEod: vi.fn(
          afterEod ??
            ((days: readonly IsoDate[]) => {
              settled.push([...days]);
              return Promise.resolve([]);
            }),
        ),
      },
    );
  }

  // uma entrega do eod nesse horário de Brasília (o relógio da brapi falsa anda junto)
  const run = (eod: EodHandler, w: BrapiTestWorld, date: IsoDate, hhmm: string, seconds = 5) => {
    const now = at(date, hhmm, seconds);
    w.clock.set(now);
    return eod.execute(date, now);
  };
  // a entrega do prazo, 00:30 em ponto do dia seguinte
  const runAtDeadline = (eod: EodHandler, w: BrapiTestWorld, date: IsoDate) => {
    const now = at(addDays(date, 1), '00:30', 0);
    w.clock.set(now);
    return eod.execute(date, now);
  };
  const historical = (w: BrapiTestWorld) => w.calls.filter((r) => r.kind === 'historical');
  const askedFor = (w: BrapiTestWorld) => historical(w).map((request) => request.symbol);
  const barsOn = (date: IsoDate, ticker?: string) =>
    prisma.dailyBar.count({
      where: { date: day(date), ...(ticker && { instrument: { ticker } }) },
    });
  const confirmedSource = async (date: IsoDate) =>
    (await prisma.tradingDay.findUnique({ where: { date: day(date) } }))?.source;
  const jobRow = (date: IsoDate) =>
    prisma.jobRun.findFirstOrThrow({ where: { type: 'eod', idempotencyKey: date } });
  const world = (extra: Partial<Parameters<typeof brapiWorld>[0]> = {}, data = spec()) =>
    brapiWorld({ market: marketOf(data), start: at(D1, '20:00'), ...extra });
  const unavailable = () => new Response('{}', { status: 503 });

  describe('A1: uma requisição por papel que falta', () => {
    it('pede cada papel uma vez (o obrigatório, o BOVA11 primeiro, e depois o opcional), grava, confirma o dia e publica a liquidação', async () => {
      const w = world();
      await seed(w);
      const outcome = await run(handler(w), w, D1, '21:30');

      expect(outcome).toBe('complete');
      expect(askedFor(w)).toEqual(['BOVA11', 'PETR4', 'VALE3', 'ITUB4', 'AMER3', 'WEGE3']);
      // só o pregão da noite: o histórico já estava no banco, então nenhum pedido o repete
      expect(historical(w).map((r) => [r.from, r.to])).toEqual(Array(6).fill([D1, D1]));
      expect(await barsOn(D1)).toBe(6);
      expect(await confirmedSource(D1)).toBe('BRAPI');
      expect(settled).toEqual([[D1]]);
      expect(await jobRow(D1)).toMatchObject({ status: 'SUCCEEDED' });
      expect(scheduled).toEqual([]);
      expect(error).not.toHaveBeenCalled();
    });

    it('a segunda entrega da mesma mensagem não faz nenhuma requisição (só republica a liquidação)', async () => {
      const w = world();
      await seed(w);
      const eod = handler(w);
      await run(eod, w, D1, '21:30');
      const before = w.calls.length;
      expect(await run(eod, w, D1, '21:31')).toBe('already_done');
      expect(w.calls).toHaveLength(before);
      expect(settled).toEqual([[D1], [D1]]);
      expect(await barsOn(D1)).toBe(6);
    });

    it('a entrega que caiu depois de gravar as barras e antes de concluir recomeça sem pedir nada e publica de novo', async () => {
      const w = world();
      await seed(w);
      const crashing = handler(w, () => Promise.reject(new Error('Service Bus fora do ar')));
      await expect(run(crashing, w, D1, '21:30')).rejects.toThrow('Service Bus fora do ar');
      expect(await jobRow(D1)).toMatchObject({ status: 'FAILED' });
      expect(await confirmedSource(D1)).toBe('BRAPI');
      const before = w.calls.length;

      expect(await run(handler(w), w, D1, '21:32')).toBe('complete');
      expect(w.calls).toHaveLength(before);
      expect(settled).toEqual([[D1]]); // o dia já estava confirmado e mesmo assim é publicado
    });

    it('o pregão que a brapi ainda não publicou custa uma requisição só (a sonda do BOVA11) e se reagenda para daqui a 60 minutos', async () => {
      const w = world({ publishedAt: new Map([[D1, at(D1, '22:10', 0)]]) });
      await seed(w);
      const eod = handler(w);
      expect(await run(eod, w, D1, '21:30')).toBe('rescheduled');
      expect(askedFor(w)).toEqual(['BOVA11']);
      expect(scheduled).toEqual([{ message: { type: 'eod', date: D1 }, at: at(D1, '22:30') }]);
      expect(await jobRow(D1)).toMatchObject({ status: 'WAITING' });
      expect(settled).toEqual([]);
      expect(await confirmedSource(D1)).toBeUndefined();

      expect(await run(eod, w, D1, '22:30')).toBe('complete');
      expect(askedFor(w).slice(1)).toEqual(['BOVA11', 'PETR4', 'VALE3', 'ITUB4', 'AMER3', 'WEGE3']);
      expect(settled).toEqual([[D1]]);
    });
  });

  describe('A2: falha parcial', () => {
    it('429 com Retry-After, 5xx e timeout em alguns papéis: a nova tentativa de +60 min pede só a falta', async () => {
      let second = false;
      let limited = false;
      const w = world({
        intercept: (url) => {
          if (second) return undefined;
          const symbol = url.searchParams.get('symbols');
          if (symbol === 'PETR4' && !limited) {
            limited = true;
            return new Response('{}', { status: 429, headers: { 'retry-after': '3' } });
          }
          if (symbol === 'VALE3') return unavailable();
          if (symbol === 'ITUB4') return new DOMException('timeout', 'TimeoutError');
          return undefined;
        },
      });
      await seed(w);
      const eod = handler(w);

      expect(await run(eod, w, D1, '21:30')).toBe('rescheduled');
      expect(w.sleeps).toContain(3000);
      // o PETR4 foi repetido uma vez (o 429), o VALE3 e o ITUB4 também (5xx e timeout), e o opcional ficou para depois
      expect(askedFor(w)).toEqual([
        'BOVA11',
        'PETR4',
        'PETR4',
        'VALE3',
        'VALE3',
        'ITUB4',
        'ITUB4',
        'AMER3',
      ]);
      expect(await barsOn(D1)).toBe(3); // BOVA11, PETR4 e AMER3 já estão gravados
      expect(settled).toEqual([]);
      expect(scheduled).toHaveLength(1);

      second = true;
      const first = askedFor(w).length;
      expect(await run(eod, w, D1, '22:30')).toBe('complete');
      // só o que faltava e, agora que o pregão conclui, o opcional
      expect(askedFor(w).slice(first)).toEqual(['VALE3', 'ITUB4', 'WEGE3']);
      expect(await barsOn(D1)).toBe(6);
      expect(settled).toEqual([[D1]]);
    });

    it('no prazo das 00:30 segue com o que tem, registra a falta e dispara o eod-barras-ausentes (faltar mais de 10% do obrigatório)', async () => {
      const w = world({
        intercept: (url) =>
          url.searchParams.get('symbols') === 'VALE3' ? unavailable() : undefined,
      });
      await seed(w);
      const eod = handler(w);
      expect(await run(eod, w, D1, '21:30')).toBe('rescheduled');
      const first = askedFor(w).length;
      expect(await run(eod, w, D1, '22:30')).toBe('rescheduled');
      expect(await run(eod, w, D1, '23:30')).toBe('rescheduled');
      expect(error).not.toHaveBeenCalled();
      // as novas tentativas pedem só o VALE3 (e a repetição do 5xx)
      expect(askedFor(w).slice(first)).toEqual(['VALE3', 'VALE3', 'VALE3', 'VALE3']);

      expect(await runAtDeadline(eod, w, D1)).toBe('closed_incomplete');
      expect(error).toHaveBeenCalledWith(
        { date: D1, missing: 1, required: 5, first: ['VALE3'] },
        ALERT_LOG.eodBarsMissing,
      );
      expect(await confirmedSource(D1)).toBe('BRAPI');
      expect(settled).toEqual([[D1]]);
      expect(await jobRow(D1)).toMatchObject({ status: 'SUCCEEDED' });
      expect(await barsOn(D1)).toBe(5); // os quatro obrigatórios que vieram e o opcional
    });

    it('um papel sem negócio entre 11 (9%) fica abaixo do limite: só vai ao registro, sem o alerta', async () => {
      const tickers = ['BOVA11', ...Array.from({ length: 10 }, (_, i) => `ACAO${i}3`)];
      const w = world(
        {},
        spec({ tickers, absent: (ticker, date) => ticker === 'ACAO03' && date === D1 }),
      );
      await seed(w, { tickers, extras: false });
      const eod = handler(w);
      expect(await run(eod, w, D1, '21:30')).toBe('rescheduled');
      expect(await runAtDeadline(eod, w, D1)).toBe('closed_incomplete');
      expect(error).not.toHaveBeenCalled();
      expect(settled).toEqual([[D1]]);
      expect(await barsOn(D1)).toBe(10);
    });

    it('401 encerra a busca como erro de configuração: job_run FAILED (job-falhou), sem o corpo, sem refazer a lista e sem mais requisições', async () => {
      const w = world({
        intercept: (url) =>
          url.searchParams.get('symbols') === 'ITUB4'
            ? new Response('{"message":"token inválido"}', { status: 401 })
            : undefined,
      });
      await seed(w);
      await expect(run(handler(w), w, D1, '21:30')).rejects.toThrow(BrapiConfigError);
      // BOVA11, PETR4 e VALE3 foram gravados antes do 401; o ITUB4 recebeu o 401 e mais nada foi pedido
      expect(askedFor(w)).toEqual(['BOVA11', 'PETR4', 'VALE3', 'ITUB4']);
      expect(await barsOn(D1)).toBe(3);
      const row = await jobRow(D1);
      expect(row.status).toBe('FAILED');
      expect(row.error).not.toContain('token inválido');
      expect(error).toHaveBeenCalledWith(expect.anything(), ALERT_LOG.jobFailed);
      expect(scheduled).toEqual([]);
      expect(settled).toEqual([]);

      // a entrega seguinte da fila (token corrigido) pede só o que faltou, nunca a lista inteira
      const fixed = world({ start: at(D1, '21:40') });
      expect(await run(handler(fixed), fixed, D1, '21:40')).toBe('complete');
      expect(askedFor(fixed)).toEqual(['ITUB4', 'AMER3', 'WEGE3']);
      expect(await barsOn(D1)).toBe(6);
    });
  });

  describe('A3: a cota', () => {
    it('perto da reserva a busca para antes de cruzá-la, registra brapi-cota-baixa e não faz mais nenhuma requisição', async () => {
      const w = world({ quota: QUOTA_RESERVE + 3 });
      await seed(w);
      expect(await run(handler(w), w, D1, '21:30')).toBe('rescheduled');
      // a 3ª resposta informa que restam exatamente QUOTA_RESERVE: a próxima requisição cruzaria a reserva
      expect(askedFor(w)).toEqual(['BOVA11', 'PETR4', 'VALE3']);
      expect(warn).toHaveBeenCalledWith(
        { remaining: QUOTA_RESERVE, reserve: QUOTA_RESERVE },
        ALERT_LOG.brapiQuotaLow,
      );
      expect(await barsOn(D1)).toBe(3);
      expect(settled).toEqual([]);
    });
  });

  describe('A4: a barra existente nunca é sobrescrita', () => {
    it('a nova busca com valor diferente registra barras-divergentes e não muda nada', async () => {
      const w = world();
      await seed(w);
      // o PETR4 ficou sem a barra de 29/10 e a de D1; a de 30/10 que o banco tem (ajustada, por exemplo) difere da que a brapi serve
      const petr4 = await prisma.instrument.findUniqueOrThrow({ where: { ticker: 'PETR4' } });
      await prisma.dailyBar.deleteMany({
        where: { instrumentId: petr4.id, date: day('2026-10-29') },
      });
      const stored = await prisma.dailyBar.findFirstOrThrow({
        where: { instrumentId: petr4.id, date: day(D0) },
      });
      await prisma.dailyBar.update({
        where: { id: stored.id },
        data: { closeCents: stored.closeCents - 7n },
      });

      await run(handler(w), w, D1, '21:30');

      // o pedido do PETR4 começou em 29/10 (o buraco) e trouxe 30/10 de novo
      expect(historical(w).find((r) => r.symbol === 'PETR4')).toMatchObject({
        from: '2026-10-29',
        to: D1,
      });
      expect(warn).toHaveBeenCalledWith(
        { count: 1, first: [{ ticker: 'PETR4', date: D0, fields: ['close'] }] },
        ALERT_LOG.barsDiverged,
      );
      const after = await prisma.dailyBar.findUniqueOrThrow({ where: { id: stored.id } });
      expect(after.closeCents).toBe(stored.closeCents - 7n);
      expect(await prisma.dailyBar.count({ where: { instrumentId: petr4.id } })).toBe(
        HISTORY.length + 1,
      );
    });

    it('a barra que chega atrasada para um pregão já confirmado é gravada e a liquidação dele não é pedida de novo', async () => {
      const w = world();
      await seed(w);
      // o VALE3 não tinha a barra de 30/10 (o pregão foi confirmado e liquidado sem ela)
      await prisma.dailyBar.deleteMany({
        where: { instrument: { ticker: 'VALE3' }, date: day(D0) },
      });

      await run(handler(w), w, D1, '21:30');

      expect(historical(w).find((r) => r.symbol === 'VALE3')).toMatchObject({ from: D0, to: D1 });
      expect(await barsOn(D0, 'VALE3')).toBe(1);
      // só D1 vai para a liquidação: 30/10 já estava confirmado e a barra atrasada não o reabre
      expect(settled).toEqual([[D1]]);
    });
  });

  describe('A5: uma noite inteira sem brapi', () => {
    it('o eod seguinte preenche o pregão anterior pela janela e liquida os dois, em ordem', async () => {
      let down = true;
      const w = world({ intercept: () => (down ? unavailable() : undefined) });
      await seed(w);
      const eod = handler(w);

      // a noite de D1: a brapi fora do ar o tempo todo, até o prazo das 00:30
      for (const hhmm of ['21:30', '22:30', '23:30']) {
        expect(await run(eod, w, D1, hhmm)).toBe('rescheduled');
      }
      expect(await runAtDeadline(eod, w, D1)).toBe('closed_incomplete');
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ date: D1, missing: 5 }),
        ALERT_LOG.eodBarsMissing,
      );
      expect(await barsOn(D1)).toBe(0);
      expect(await confirmedSource(D1)).toBe('CALENDAR'); // sem nenhuma barra o dia segue só previsto
      expect(settled).toEqual([]);
      expect(await jobRow(D1)).toMatchObject({ status: 'SUCCEEDED' });

      // a noite de D2: a brapi voltou. Cada papel é pedido UMA vez, de D1 a D2
      down = false;
      const before = w.calls.length;
      expect(await run(eod, w, D2, '21:30')).toBe('complete');
      expect(w.calls.slice(before).map((r) => [r.symbol, r.from, r.to])).toEqual([
        ['BOVA11', D1, D2],
        ['PETR4', D1, D2],
        ['VALE3', D1, D2],
        ['ITUB4', D1, D2],
        ['AMER3', D1, D2],
        ['WEGE3', D1, D2],
      ]);
      expect(await barsOn(D1)).toBe(6);
      expect(await barsOn(D2)).toBe(6);
      expect(await confirmedSource(D1)).toBe('BRAPI');
      expect(await confirmedSource(D2)).toBe('BRAPI');
      // os dois vão para a liquidação, em ordem de data (a liquidação do mais novo refaz a temporada do zero, na mesma ordem)
      expect(settled).toEqual([[D1, D2]]);
    });
  });

  describe('o conjunto obrigatório e o opcional', () => {
    it('o papel em posição fora do universo é obrigatório; a carteira do usuário é opcional e não segura a conclusão', async () => {
      const w = world({
        intercept: (url) =>
          url.searchParams.get('symbols') === 'WEGE3' ? unavailable() : undefined,
      });
      await seed(w);
      expect(await run(handler(w), w, D1, '21:30')).toBe('complete');
      expect(settled).toEqual([[D1]]);
      expect(scheduled).toEqual([]);
      expect(await barsOn(D1, 'AMER3')).toBe(1);
      // o WEGE3 não veio, e fica para a janela da noite seguinte
      expect(await barsOn(D1, 'WEGE3')).toBe(0);
    });

    it('o opcional só é pedido na tentativa que conclui, nunca numa que vai se reagendar', async () => {
      const w = world({
        intercept: (url) =>
          url.searchParams.get('symbols') === 'AMER3' ? unavailable() : undefined,
      });
      await seed(w);
      expect(await run(handler(w), w, D1, '21:30')).toBe('rescheduled');
      expect(askedFor(w)).not.toContain('WEGE3');
    });
  });
});
