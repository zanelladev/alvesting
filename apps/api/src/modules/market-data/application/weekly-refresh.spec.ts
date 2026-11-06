import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { historyStart } from '../domain/bar-plan.js';
import type { IsoDate } from '../domain/dates.js';
import { loadTradingCalendar } from '../domain/trading-calendar.js';
import { FETCH_BUDGET_MS } from '../infrastructure/brapi.client.js';
import type { LoadOptions, LoadReport } from './bar-loader.js';
import type { LogoRefresh } from './logo-refresh.js';
import { WeeklyRefresh } from './weekly-refresh.js';

// A atualização semanal sem rede e sem banco: o que pedir (papel novo, papel sem barra nos 3 meses, papel sem a semana) e quanto do orçamento
// de tempo sobra para as barras depois da lista. O fluxo com o Postgres está em weekly-and-backfill.integration.spec.ts.
const calendar = loadTradingCalendar();
const MONDAY = '2026-11-02'; // feriado: a semana que acabou é 26 a 30/10
const TODAY = '2026-11-01'; // o domingo da execução
const WEEK = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
const FROM = historyStart(TODAY);

interface Options {
  // as ações da lista da brapi (ticker; todas viram ação à vista)
  listed?: string[] | null;
  // o que o servidor já conhece
  known?: string[];
  // as barras que o banco tem (papel -> pregões)
  have?: Record<string, IsoDate[]>;
  daily?: { universe?: string[]; held?: string[]; portfolio?: string[] };
  // quanto a lista demora
  listMs?: number;
  // quanto as barras demoram
  loadMs?: number;
  // a passada dos logos (ADR 0036): nenhuma, a que dá certo ou a que falha
  logos?: 'none' | 'ok' | 'fails';
}

function setup(options: Options = {}) {
  const have = new Map(
    Object.entries(options.have ?? {}).map(([ticker, days]) => [ticker, new Set(days)]),
  );
  const known = new Set(options.known ?? []);
  const brapi = {
    listStocks: vi.fn(() => {
      vi.setSystemTime(Date.now() + (options.listMs ?? 0));
      const listed = options.listed === undefined ? ['PETR4', 'VALE3'] : options.listed;
      return Promise.resolve({
        listings: listed === null ? null : listed.map((ticker) => ({ ticker, subType: 'stock' })),
        requests: 1,
        remaining: 9000,
        stopped: null,
      });
    }),
  };
  const loads: Array<
    { requests: Array<{ ticker: string; from: string; to: string }> } & LoadOptions
  > = [];
  const loader = {
    load: vi.fn(
      (
        requests: Array<{ ticker: string; from: string; to: string }>,
        loadOptions?: LoadOptions,
      ) => {
        loads.push({ requests: [...requests], ...loadOptions });
        vi.setSystemTime(Date.now() + (options.loadMs ?? 0));
        return Promise.resolve({
          requests: requests.length,
          remaining: 8000,
          stopped: null,
          asked: requests.length,
          failed: [],
          inserted: 0,
          divergent: [],
          unknown: [],
        } satisfies LoadReport);
      },
    ),
  };
  const market = {
    insertInstruments: vi.fn((seeds: ReadonlyArray<{ ticker: string }>) =>
      Promise.resolve(seeds.map((seed) => seed.ticker).filter((ticker) => !known.has(ticker))),
    ),
    barDates: vi.fn((tickers: readonly string[], from: IsoDate, to: IsoDate) => {
      const out = new Map<string, Set<IsoDate>>();
      for (const ticker of tickers) {
        const days = [...(have.get(ticker) ?? [])].filter((d) => d >= from && d <= to);
        if (days.length > 0) out.set(ticker, new Set(days));
      }
      return Promise.resolve(out);
    }),
    heldTickers: vi.fn(() => Promise.resolve(options.daily?.held ?? [])),
    portfolioTickers: vi.fn(() => Promise.resolve(options.daily?.portfolio ?? [])),
  };
  const universe = { tickersOf: vi.fn(() => Promise.resolve(options.daily?.universe ?? [])) };
  const logos = {
    run: vi.fn(() =>
      options.logos === 'fails'
        ? Promise.reject(new Error('relation "instrument_logo" does not exist'))
        : Promise.resolve({} as Awaited<ReturnType<LogoRefresh['run']>>),
    ),
  };
  const refresh = new WeeklyRefresh(
    brapi,
    loader,
    market,
    universe,
    calendar,
    (options.logos ?? 'ok') === 'none' ? undefined : logos,
  );
  return { refresh, brapi, loader, loads, market, logos };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WeeklyRefresh: o orçamento de tempo', () => {
  it('as barras ficam com o orçamento da passada menos o que a lista gastou', async () => {
    const t = setup({ listMs: 90_000 });
    await t.refresh.run(MONDAY, TODAY);
    expect(t.loader.load).toHaveBeenCalledTimes(1);
    expect(t.loads[0]!.budgetMs).toBe(FETCH_BUDGET_MS - 90_000);
  });

  it('se a lista gastou tudo, as barras ficam sem tempo (0), e nunca com tempo negativo', async () => {
    const t = setup({ listMs: FETCH_BUDGET_MS + 60_000 });
    await t.refresh.run(MONDAY, TODAY);
    expect(t.loads[0]!.budgetMs).toBe(0);
  });
});

describe('WeeklyRefresh: o que pedir (o banco decide, não o que aconteceu nesta execução)', () => {
  it('papel novo e papel conhecido sem nenhuma barra nos 3 meses recebem o histórico inteiro; o que tem barra mas não a da semana, só a semana', async () => {
    const t = setup({
      listed: ['NEWW3', 'FAIL3', 'OLDD4', 'FULL3'],
      known: ['FAIL3', 'OLDD4', 'FULL3'],
      have: {
        // a carga dele falhou na semana anterior: nenhuma barra
        OLDD4: ['2026-08-10', '2026-09-15'], // tem barra, mas nenhuma dos 5 últimos pregões
        FULL3: ['2026-09-15', '2026-10-29'], // já tem a semana
      },
    });
    const summary = await t.refresh.run(MONDAY, TODAY);

    expect(t.market.barDates).toHaveBeenCalledWith(expect.any(Array), FROM, WEEK.at(-1));
    expect(
      t.loads[0]!.requests.map((r) => [r.ticker, r.from, r.to]).sort(([a], [b]) =>
        a! < b! ? -1 : 1,
      ),
    ).toEqual([
      ['FAIL3', FROM, '2026-10-30'],
      ['NEWW3', FROM, '2026-10-30'],
      ['OLDD4', WEEK[0], '2026-10-30'],
    ]);
    expect(summary).toMatchObject({ listed: 4, created: 1, asked: 3, requests: 4 });
  });

  it('o conjunto diário (universo, posições, carteiras e BOVA11) não é pedido de domingo', async () => {
    const t = setup({
      listed: ['PETR4', 'VALE3', 'HELD3', 'CART3', 'RARE3'],
      known: ['PETR4', 'VALE3', 'HELD3', 'CART3', 'RARE3'],
      daily: { universe: ['PETR4'], held: ['HELD3'], portfolio: ['CART3', 'VALE3'] },
    });
    await t.refresh.run(MONDAY, TODAY);
    expect(t.loads[0]!.requests.map((r) => r.ticker)).toEqual(['RARE3']);
  });

  it('semana seguinte sem nada novo: só a requisição da lista', async () => {
    const t = setup({
      listed: ['AAAA3'],
      known: ['AAAA3'],
      have: { AAAA3: ['2026-09-15', '2026-10-27'] },
    });
    const summary = await t.refresh.run(MONDAY, TODAY);
    expect(t.loads[0]!.requests).toEqual([]);
    expect(summary).toMatchObject({ created: 0, asked: 0, requests: 1 });
  });

  it('lista que não veio: não semeia, não pede nada e não carrega barra', async () => {
    const t = setup({ listed: null });
    const summary = await t.refresh.run(MONDAY, TODAY);
    expect(summary).toEqual({ listed: null, created: 0, asked: 0, requests: 1 });
    expect(t.market.insertInstruments).not.toHaveBeenCalled();
    expect(t.loader.load).not.toHaveBeenCalled();
  });
});

// Os logos das ações (ADR 0036): no fim da atualização semanal, depois da lista e das barras, para os papéis que a lista trouxe (a passada
// confere quais o banco tem). A falha dela nunca derruba a atualização (nem o universo, que vem depois).
describe('WeeklyRefresh: os logos no fim', () => {
  it('a passada dos logos recebe a lista inteira e o orçamento que a lista e as barras deixaram', async () => {
    const t = setup({ listed: ['PETR4', 'VALE3'], listMs: 30_000, loadMs: 60_000 });
    await t.refresh.run(MONDAY, TODAY);
    expect(t.logos.run).toHaveBeenCalledTimes(1);
    const [listings, budgetMs] = t.logos.run.mock.calls[0] as unknown as [
      Array<{ ticker: string }>,
      number,
    ];
    expect(listings.map((listing) => listing.ticker)).toEqual(['PETR4', 'VALE3']);
    expect(budgetMs).toBe(FETCH_BUDGET_MS - 90_000);
    // depois das barras
    expect(t.loader.load.mock.invocationCallOrder[0]).toBeLessThan(
      t.logos.run.mock.invocationCallOrder[0]!,
    );
  });

  it('sem a lista, a passada dos logos não roda', async () => {
    const t = setup({ listed: null });
    await t.refresh.run(MONDAY, TODAY);
    expect(t.logos.run).not.toHaveBeenCalled();
  });

  it('a falha da passada dos logos não derruba a atualização: o resumo sai igual, com um aviso', async () => {
    const ok = await setup({ listed: ['PETR4'] }).refresh.run(MONDAY, TODAY);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = setup({ listed: ['PETR4'], logos: 'fails' });
    await expect(failing.refresh.run(MONDAY, TODAY)).resolves.toEqual(ok);
    expect(failing.logos.run).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((call) => String(call[1]).includes('logos'))).toBe(true);
  });

  it('sem a passada dos logos (o ensaio, o market:universe), a atualização é a de antes', async () => {
    const t = setup({ listed: ['PETR4'], logos: 'none' });
    await expect(t.refresh.run(MONDAY, TODAY)).resolves.toMatchObject({ listed: 1 });
  });
});
