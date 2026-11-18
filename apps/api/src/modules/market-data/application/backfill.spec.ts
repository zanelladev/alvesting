import { describe, expect, it, vi } from 'vitest';
import { loadTradingCalendar } from '../domain/trading-calendar.js';
import { BrapiBackfill } from './backfill.js';
import type { LoadReport } from './bar-loader.js';

// A trava do --ate da carga (market:backfill e as barras do arena:retroativo), sem rede e sem banco: o dia de hoje ou depois é recusado antes da
// lista da brapi e de qualquer leitura, nos dois modos. O fluxo com o Postgres está em weekly-and-backfill.integration.spec.ts.
const TODAY = '2026-11-18';

function setup() {
  const brapi = {
    listStocks: vi.fn(() =>
      Promise.resolve({ listings: [], requests: 1, remaining: null, stopped: null }),
    ),
  };
  const loader = {
    load: vi.fn(() =>
      Promise.resolve({
        requests: 0,
        remaining: null,
        stopped: null,
        asked: 0,
        failed: [],
        outcomes: new Map(),
        inserted: 0,
        divergent: [],
        unknown: [],
      } satisfies LoadReport),
    ),
  };
  const market = {
    stockTickers: vi.fn(() => Promise.resolve(['PETR4'])),
    insertInstruments: vi.fn(() => Promise.resolve([])),
    barDates: vi.fn(() => Promise.resolve(new Map<string, Set<string>>())),
    confirmTradingDays: vi.fn(() => Promise.resolve([])),
  };
  const backfill = new BrapiBackfill(brapi, loader, market, loadTradingCalendar());
  return { backfill, calls: [brapi.listStocks, loader.load, ...Object.values(market)] };
}

describe('BrapiBackfill: o último dia é de antes de hoje', () => {
  it.each([
    ['hoje', TODAY],
    ['amanhã', '2026-11-19'],
  ])('%s é recusado antes da brapi e do banco, sem rede e com ela', async (_label, to) => {
    const t = setup();
    const message = `--ate ${to} recusado: o último dia tem de ser de antes de hoje (${TODAY}, no fuso de São Paulo)`;
    await expect(t.backfill.plan({ to, today: TODAY, fetch: false })).rejects.toThrow(message);
    await expect(t.backfill.run({ to, today: TODAY, fetch: true })).rejects.toThrow(message);
    for (const call of t.calls) expect(call).not.toHaveBeenCalled();
  });

  it('ontem passa', async () => {
    const t = setup();
    await expect(
      t.backfill.plan({ to: '2026-11-17', today: TODAY, fetch: false }),
    ).resolves.toMatchObject({ to: '2026-11-17', papers: 2 });
  });
});
