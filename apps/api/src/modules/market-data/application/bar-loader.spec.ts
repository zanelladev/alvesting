import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import type { BarRequest } from '../domain/bar-plan.js';
import type { Opening } from '../domain/opening-anomaly.js';
import type { BrapiBar, OnResult, PaperResult } from '../infrastructure/brapi.client.js';
import type { InsertResult } from '../infrastructure/market.repository.js';
import { BarLoader } from './bar-loader.js';

// O BarLoader sem rede e sem banco: o cliente entrega as respostas de papel em papel e o repositório responde o que gravou. O fluxo com o
// Postgres está em market-data.integration.spec.ts.
const bar = (ticker: string): BrapiBar => ({
  ticker,
  date: '2026-10-30',
  openCents: 100n,
  highCents: 110n,
  lowCents: 90n,
  closeCents: 105n,
  volumeCents: 1_000n,
});
const ok = (ticker: string): PaperResult => ({ ticker, status: 'ok', bars: [bar(ticker)] });
const asks = (...tickers: string[]): BarRequest[] =>
  tickers.map((ticker) => ({ ticker, from: '2026-10-30', to: '2026-10-30' }));

function setup(
  results: PaperResult[],
  insert: (bars: readonly BrapiBar[]) => Partial<InsertResult>,
) {
  const fetchBars = vi.fn(
    async (_requests: readonly BarRequest[], onResult: OnResult, _budgetMs?: number) => {
      for (const result of results) {
        if ((await onResult(result)) === 'stop') break;
      }
      return { requests: results.length, remaining: 9000, stopped: null };
    },
  );
  const insertBars = vi.fn((bars: readonly BrapiBar[]) =>
    Promise.resolve({ inserted: 0, divergent: [], unknown: [], openings: [], ...insert(bars) }),
  );
  return { loader: new BarLoader({ fetchBars }, { insertBars }), fetchBars, insertBars };
}

const silent = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
let warn: ReturnType<typeof silent>;
beforeEach(() => {
  warn = silent();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('BarLoader', () => {
  it('grava cada papel que chega, soma o que entrou e leva a falha do papel para a lista de falhas', async () => {
    const t = setup([ok('A1'), { ticker: 'B1', status: 'failed' }, ok('C1')], () => ({
      inserted: 1,
    }));
    const report = await t.loader.load(asks('A1', 'B1', 'C1'));
    expect(t.insertBars).toHaveBeenCalledTimes(2); // o papel sem resposta não grava nada
    expect(report).toMatchObject({
      asked: 3,
      requests: 3,
      remaining: 9000,
      stopped: null,
      failed: ['B1'],
      inserted: 2,
      divergent: [],
      unknown: [],
    });
  });

  it('stopAfter encerra a passada depois de gravar o papel, e o orçamento vai ao cliente', async () => {
    const t = setup([ok('BOVA11'), ok('PETR4')], () => ({}));
    await t.loader.load(asks('BOVA11', 'PETR4'), {
      stopAfter: (result) => result.ticker === 'BOVA11',
      budgetMs: 1234,
    });
    expect(t.insertBars).toHaveBeenCalledTimes(1);
    expect(t.fetchBars.mock.calls[0]![2]).toBe(1234);
  });

  it('divergência: o sinal barras-divergentes sai no log com a contagem e os 20 primeiros', async () => {
    const divergent = Array.from({ length: 25 }, (_, i) => ({
      ticker: `T${i}`,
      date: '2026-10-30',
      fields: ['close'],
    }));
    const t = setup([ok('A1')], () => ({ divergent }));
    const report = await t.loader.load(asks('A1'));
    expect(report.divergent).toHaveLength(25);
    expect(warn).toHaveBeenCalledWith(
      { count: 25, first: divergent.slice(0, 20) },
      ALERT_LOG.barsDiverged,
    );
  });

  it('barra de papel sem linha em instrument não é gravada: vai ao relatório e ao log (sem isso a causa fica invisível)', async () => {
    // o BOVA11 só nasce em instrument pela carga inicial (market:backfill); sem ela o eod o pede toda noite e joga a barra fora
    const t = setup([ok('BOVA11'), ok('PETR4')], (bars) =>
      bars[0]!.ticker === 'BOVA11' ? { unknown: ['BOVA11'] } : { inserted: 1 },
    );
    const report = await t.loader.load(asks('BOVA11', 'PETR4'));
    expect(report).toMatchObject({ inserted: 1, unknown: ['BOVA11'] });
    expect(warn).toHaveBeenCalledWith(
      { count: 1, first: ['BOVA11'] },
      expect.stringContaining('sem linha em instrument'),
    );
  });

  it('abertura anômala: o sinal abertura-anomala sai no log com a contagem e os 20 primeiros (papel, data e razão; nenhum preço)', async () => {
    // a regra é a do domínio (opening-anomaly.spec.ts): aqui, 25 barras que a apontam e uma que não
    const opening = (ticker: string, openCents: bigint): Opening => ({
      ticker,
      date: '2026-11-03',
      openCents,
      previousCloseCents: 3_000n,
      exEvent: false,
    });
    const anomalous = Array.from({ length: 25 }, (_, i) => opening(`T${i}`, 300_000n));
    const t = setup([ok('A1')], () => ({ openings: [...anomalous, opening('B1', 3_100n)] }));
    await t.loader.load(asks('A1'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      {
        count: 25,
        first: anomalous.slice(0, 20).map(({ ticker, date }) => ({ ticker, date, ratio: 100 })),
      },
      ALERT_LOG.openingAnomaly,
    );
  });

  it('sem divergência nem papel desconhecido, nada vai ao log', async () => {
    const t = setup([ok('A1')], () => ({ inserted: 1 }));
    await t.loader.load(asks('A1'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('o aviso das divergências e o da abertura anômala saem também quando a passada acaba em erro de configuração', async () => {
    const divergent = [{ ticker: 'A1', date: '2026-10-30', fields: ['close'] }];
    const openings = [
      {
        ticker: 'A1',
        date: '2026-10-29',
        openCents: 100n,
        previousCloseCents: 3_000n,
        exEvent: false,
      },
    ];
    const insertBars = vi.fn(() =>
      Promise.resolve({ inserted: 1, divergent, unknown: [], openings }),
    );
    const fetchBars = vi.fn(async (_requests: readonly BarRequest[], onResult: OnResult) => {
      await onResult(ok('A1'));
      throw new Error('401');
    });
    const loader = new BarLoader({ fetchBars }, { insertBars });
    await expect(loader.load(asks('A1', 'B1'))).rejects.toThrow('401');
    expect(warn).toHaveBeenCalledWith({ count: 1, first: divergent }, ALERT_LOG.barsDiverged);
    // a barra nova não volta a ser nova na próxima passada: sem este aviso, o sinal dela se perderia
    expect(warn).toHaveBeenCalledWith(
      { count: 1, first: [{ ticker: 'A1', date: '2026-10-29', ratio: 0.0333 }] },
      ALERT_LOG.openingAnomaly,
    );
  });
});
