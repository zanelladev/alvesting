import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { JobBusyError, type ClaimResult } from '../../messaging/infrastructure/job-run.store.js';
import type { IsoDate } from '../domain/dates.js';
import { loadTradingCalendar } from '../domain/trading-calendar.js';
import type { PaperResult } from '../infrastructure/brapi.client.js';
import type { LoadOptions, LoadReport } from './bar-loader.js';
import { EodHandler } from './eod.handler.js';

// A decisão do eod (o que pedir, quando reagendar, quando concluir, o que liquidar), com tudo em memória. O fluxo com o Postgres e a brapi
// falsa está em market-data.integration.spec.ts.
const calendar = loadTradingCalendar();
const D = '2026-11-04';
// os 5 pregões da janela de D (02/11 é feriado)
const WINDOW = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-03', '2026-11-04'];
// 21:30 de Brasília de D (a primeira tentativa) e 00:30 do dia seguinte (o prazo)
const FIRST = new Date('2026-11-05T00:30:05Z');
const DEADLINE = new Date('2026-11-05T03:30:00Z');
const CLAIM: ClaimResult = { status: 'claimed', claim: { id: 'job-eod', attempt: 1 } };

interface Options {
  claim?: ClaimResult;
  universe?: string[];
  held?: string[];
  portfolio?: string[];
  // as barras que o banco já tem (papel -> pregões)
  have?: Record<string, IsoDate[]>;
  // os papéis que a brapi entrega nesta passada (ganham a barra de D)
  delivers?: string[];
  confirmed?: IsoDate[];
  stopped?: LoadReport['stopped'];
}

function setup(options: Options = {}) {
  const have = new Map(
    Object.entries(options.have ?? {}).map(([ticker, days]) => [ticker, new Set(days)]),
  );
  const confirmedDays = new Set(options.confirmed ?? []);
  const jobs = {
    claim: vi.fn(() => Promise.resolve(options.claim ?? CLAIM)),
    succeed: vi.fn(() => Promise.resolve()),
    fail: vi.fn(() => Promise.resolve()),
    wait: vi.fn(() => Promise.resolve()),
  };
  const market = {
    barDates: vi.fn((tickers: readonly string[], from: IsoDate, to: IsoDate) => {
      const out = new Map<string, Set<IsoDate>>();
      for (const ticker of tickers) {
        const days = [...(have.get(ticker) ?? [])].filter((d) => d >= from && d <= to);
        if (days.length > 0) out.set(ticker, new Set(days));
      }
      return Promise.resolve(out);
    }),
    confirmedDays: vi.fn((days: readonly IsoDate[]) =>
      Promise.resolve(new Set(days.filter((d) => confirmedDays.has(d)))),
    ),
    // devolve os dias que têm barra e ainda não estavam confirmados: o repositório de verdade confere isto no SQL
    confirmTradingDays: vi.fn((days: readonly IsoDate[]) =>
      Promise.resolve(days.filter((d) => [...have.values()].some((got) => got.has(d))).sort()),
    ),
    seedCalendar: vi.fn(() => Promise.resolve(0)),
    heldTickers: vi.fn(() => Promise.resolve(options.held ?? [])),
    portfolioTickers: vi.fn(() => Promise.resolve(options.portfolio ?? [])),
  };
  const universe = {
    tickersOf: vi.fn(() => Promise.resolve(options.universe ?? ['PETR4', 'VALE3'])),
  };
  type Ask = Array<{ ticker: string; from: string; to: string }>;
  const loads: Array<{ requests: Ask; options?: LoadOptions }> = [];
  const loader = {
    load: vi.fn((requests: Ask, loadOptions?: LoadOptions) => {
      loads.push({ requests: [...requests], options: loadOptions });
      for (const request of requests) {
        if (options.delivers?.includes(request.ticker)) {
          have.set(request.ticker, new Set([...(have.get(request.ticker) ?? []), D]));
        }
      }
      return Promise.resolve({
        requests: requests.length,
        remaining: null,
        stopped: options.stopped ?? null,
        asked: requests.length,
        failed: [],
        inserted: 0,
        divergent: [],
        unknown: [],
      } satisfies LoadReport);
    }),
  };
  const messaging = { publishScheduled: vi.fn(() => Promise.resolve()) };
  const settlement = { afterEod: vi.fn((_days: readonly IsoDate[]) => Promise.resolve([])) };
  const handler = new EodHandler(jobs, calendar, market, universe, loader, messaging, settlement);
  return { handler, jobs, market, universe, loader, loads, messaging, settlement };
}

const silent = (level: 'log' | 'warn' | 'error') =>
  vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
let error: ReturnType<typeof silent>;
let log: ReturnType<typeof silent>;
beforeEach(() => {
  silent('warn');
  log = silent('log');
  error = silent('error');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('EodHandler (a decisão)', () => {
  it('dia sem pregão é ignorado, sem tocar na fila de trabalho', async () => {
    const t = setup();
    await expect(t.handler.execute('2026-11-02', FIRST)).resolves.toBe('not_trading_day');
    expect(t.jobs.claim).not.toHaveBeenCalled();
    expect(t.loader.load).not.toHaveBeenCalled();
  });

  it('mensagem repetida depois de concluída: nenhum pedido à brapi, só republica a liquidação do pregão', async () => {
    const t = setup({ claim: { status: 'done' } });
    await expect(t.handler.execute(D, FIRST)).resolves.toBe('already_done');
    expect(t.loader.load).not.toHaveBeenCalled();
    expect(t.settlement.afterEod).toHaveBeenCalledWith([D]);
    expect(t.jobs.succeed).not.toHaveBeenCalled();
  });

  it('mensagem em processamento por outra entrega falha com JobBusyError (a fila repete)', async () => {
    const t = setup({ claim: { status: 'busy' } });
    await expect(t.handler.execute(D, FIRST)).rejects.toThrow(JobBusyError);
    expect(t.jobs.fail).not.toHaveBeenCalled();
  });

  describe('o que pedir', () => {
    it('o obrigatório é o BOVA11 (primeiro), o universo da semana e os papéis em posição; cada um da falta até D', async () => {
      const t = setup({
        universe: ['PETR4', 'VALE3'],
        held: ['AMER3'],
        have: { PETR4: ['2026-10-28', '2026-10-29', '2026-10-30'], VALE3: WINDOW },
        delivers: ['BOVA11', 'PETR4', 'AMER3'],
      });
      await t.handler.execute(D, FIRST);
      expect(t.universe.tickersOf).toHaveBeenCalledWith('2026-W45');
      // o VALE3 já tem a barra de D e não é pedido; o PETR4 pede de 03/11 (o pregão mais antigo que lhe falta)
      expect(t.loads[0]!.requests).toEqual([
        { ticker: 'BOVA11', from: '2026-10-28', to: D },
        { ticker: 'PETR4', from: '2026-11-03', to: D },
        { ticker: 'AMER3', from: '2026-10-28', to: D },
      ]);
    });

    it('a sonda: a passada acaba depois do BOVA11 se a resposta dele não traz a barra do dia', async () => {
      const t = setup({ delivers: [] });
      await t.handler.execute(D, FIRST);
      const probe = t.loads[0]!.options!.stopAfter!;
      const ok = (ticker: string, dates: string[]): PaperResult => ({
        ticker,
        status: 'ok',
        bars: dates.map((date) => ({ ticker, date }) as never),
      });
      expect(probe(ok('BOVA11', ['2026-11-03']))).toBe(true);
      expect(probe(ok('BOVA11', []))).toBe(true);
      expect(probe(ok('BOVA11', [D]))).toBe(false);
      expect(probe(ok('PETR4', []))).toBe(false); // só o BOVA11 é sonda
      expect(probe({ ticker: 'BOVA11', status: 'failed' })).toBe(false); // sem resposta, não se sabe
    });

    it('papel que já tem tudo não gera pedido nenhum', async () => {
      const all = { BOVA11: WINDOW, PETR4: WINDOW, VALE3: WINDOW };
      const t = setup({ have: all });
      await expect(t.handler.execute(D, FIRST)).resolves.toBe('complete');
      expect(t.loads[0]!.requests).toEqual([]);
    });
  });

  describe('reagendar ou concluir', () => {
    it('falta papel antes do prazo: reagenda para daqui a 60 minutos, espera (WAITING), não confirma nem liquida e nem pede o opcional', async () => {
      const t = setup({ portfolio: ['WEGE3'], delivers: ['BOVA11', 'PETR4'] });
      await expect(t.handler.execute(D, FIRST)).resolves.toBe('rescheduled');
      expect(t.messaging.publishScheduled).toHaveBeenCalledWith(
        { type: 'eod', date: D },
        new Date('2026-11-05T01:30:05Z'),
      );
      expect(t.jobs.wait).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('faltam 1 de 3 papéis'),
      );
      expect(t.jobs.succeed).not.toHaveBeenCalled();
      expect(t.market.confirmTradingDays).not.toHaveBeenCalled();
      expect(t.settlement.afterEod).not.toHaveBeenCalled();
      expect(t.loader.load).toHaveBeenCalledTimes(1); // o opcional não foi pedido
    });

    it('todo papel do obrigatório com a barra: conclui, confirma os pregões da janela que faltam e liquida o de hoje', async () => {
      const t = setup({
        portfolio: ['WEGE3'],
        confirmed: ['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-03'],
        have: { BOVA11: WINDOW, PETR4: WINDOW, VALE3: WINDOW },
      });
      t.market.barDates.mockImplementation((tickers: readonly string[], from: IsoDate) =>
        Promise.resolve(
          new Map(
            tickers
              .filter((ticker) => ticker !== 'WEGE3')
              .map((ticker) => [ticker, new Set(WINDOW.filter((day) => day >= from))]),
          ),
        ),
      );
      await expect(t.handler.execute(D, FIRST)).resolves.toBe('complete');
      // 2 passadas: o obrigatório (nada a pedir) e o opcional (o WEGE3 não tem barra nenhuma)
      expect(t.loads.map((l) => l.requests.map((r) => r.ticker))).toEqual([[], ['WEGE3']]);
      expect(t.market.confirmTradingDays).toHaveBeenCalledWith([D]);
      expect(t.market.seedCalendar).toHaveBeenCalled();
      expect(t.settlement.afterEod).toHaveBeenCalledWith([D]);
      expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
    });

    it('o opcional divide o orçamento de tempo da trava com o obrigatório (não ganha um novo)', async () => {
      const t = setup({
        portfolio: ['WEGE3'],
        have: { BOVA11: WINDOW, PETR4: WINDOW, VALE3: WINDOW },
      });
      await t.handler.execute(D, FIRST);
      expect(t.loads[0]!.options?.budgetMs).toBeUndefined();
      const budget = t.loads[1]!.options!.budgetMs!;
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThanOrEqual(4 * 60_000);
    });

    it('no prazo, com papel faltando: conclui com o que tem, e a falta vai ao registro (contagem e os 20 primeiros)', async () => {
      const universe = Array.from({ length: 30 }, (_, i) => `ACAO${i}3`);
      const t = setup({ universe, delivers: ['BOVA11', ...universe.slice(1)] });
      await expect(t.handler.execute(D, DEADLINE)).resolves.toBe('closed_incomplete');
      // 1 de 31 (3%): abaixo do limite, só o registro
      expect(error).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        { date: D, missing: 1, required: 31, first: ['ACAO03'] },
        'eod concluído no prazo com papéis sem a barra do dia',
      );
      expect(t.messaging.publishScheduled).not.toHaveBeenCalled();
      expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
      expect(t.settlement.afterEod).toHaveBeenCalledWith([D]);
    });

    it('no prazo, sem o BOVA11: o eod-barras-ausentes', async () => {
      const t = setup({ delivers: ['PETR4', 'VALE3'] });
      await t.handler.execute(D, DEADLINE);
      expect(error).toHaveBeenCalledWith(
        { date: D, missing: 1, required: 3, first: ['BOVA11'] },
        ALERT_LOG.eodBarsMissing,
      );
    });

    it('no prazo, faltando mais de 10% do obrigatório: o eod-barras-ausentes, com só os 20 primeiros', async () => {
      const universe = Array.from({ length: 40 }, (_, i) => `ACAO${i}3`);
      const t = setup({ universe, delivers: ['BOVA11'] }); // só o BOVA11 veio
      await t.handler.execute(D, DEADLINE);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ missing: 40, required: 41 }),
        ALERT_LOG.eodBarsMissing,
      );
      const [context] = error.mock.calls[0] as unknown as [{ first: string[] }];
      expect(context.first).toHaveLength(20);
    });

    it('no prazo, sem nenhuma barra (a brapi fora a noite inteira): não confirma nem liquida, mas conclui a mensagem', async () => {
      const t = setup({ delivers: [] });
      await expect(t.handler.execute(D, DEADLINE)).resolves.toBe('closed_incomplete');
      expect(t.market.confirmTradingDays).toHaveBeenCalledWith([...WINDOW].sort());
      expect(t.settlement.afterEod).not.toHaveBeenCalled(); // nada foi confirmado
      expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
    });
  });

  describe('o que vai para a liquidação', () => {
    it('os pregões anteriores da janela que acabam de ser confirmados vão junto, em ordem de data (A5)', async () => {
      const t = setup({
        confirmed: ['2026-10-29', '2026-10-30'],
        delivers: ['BOVA11', 'PETR4', 'VALE3'],
        have: { BOVA11: ['2026-11-03'], PETR4: ['2026-11-03'], VALE3: ['2026-11-03'] },
      });
      await t.handler.execute(D, FIRST);
      expect(t.settlement.afterEod).toHaveBeenCalledWith(['2026-11-03', D]);
    });

    it('o pregão que já estava confirmado não reabre a liquidação: barra atrasada dele não o põe na lista', async () => {
      const t = setup({
        confirmed: ['2026-10-29', '2026-10-30', '2026-11-03'],
        delivers: ['BOVA11', 'PETR4', 'VALE3'],
        have: { BOVA11: ['2026-11-03'] },
      });
      await t.handler.execute(D, FIRST);
      expect(t.settlement.afterEod).toHaveBeenCalledWith([D]);
    });

    it('o pregão já confirmado por uma entrega que caiu antes de concluir volta à lista (a liquidação dele não se perde)', async () => {
      const t = setup({
        confirmed: ['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-03', D],
        have: { BOVA11: WINDOW, PETR4: WINDOW, VALE3: WINDOW },
      });
      await expect(t.handler.execute(D, FIRST)).resolves.toBe('complete');
      expect(t.settlement.afterEod).toHaveBeenCalledWith([D]);
    });
  });

  describe('erro', () => {
    it('a falha do loader (erro de configuração) marca o job como falho e sobe, sem reagendar', async () => {
      const t = setup();
      t.loader.load.mockRejectedValueOnce(
        new Error('brapi: HTTP 401, confira o BRAPI_TOKEN e o plano'),
      );
      await expect(t.handler.execute(D, FIRST)).rejects.toThrow('HTTP 401');
      expect(t.jobs.fail).toHaveBeenCalledTimes(1);
      expect(t.messaging.publishScheduled).not.toHaveBeenCalled();
      expect(t.settlement.afterEod).not.toHaveBeenCalled();
    });

    it('a liquidação que não publica repete o eod: o job falha, e não é concluído', async () => {
      const t = setup({ have: { BOVA11: WINDOW, PETR4: WINDOW, VALE3: WINDOW } });
      t.settlement.afterEod.mockRejectedValueOnce(new Error('Service Bus fora do ar'));
      await expect(t.handler.execute(D, FIRST)).rejects.toThrow('Service Bus');
      expect(t.jobs.fail).toHaveBeenCalledTimes(1);
      expect(t.jobs.succeed).not.toHaveBeenCalled();
    });
  });
});
