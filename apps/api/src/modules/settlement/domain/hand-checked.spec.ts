import { describe, expect, it } from 'vitest';
import {
  HAND_CHECKED_CAPITAL_CENTS,
  HAND_CHECKED_COMPETITORS,
  HAND_CHECKED_DATES,
  HAND_CHECKED_MARKET,
  readHandCheckedCsv as csv,
  type CsvRow as Row,
} from './fixtures/hand-checked.fixture.js';
import { PLAN_RULES } from './fixtures/rules.fixture.js';
import { seasonStats } from './season-stats.js';
import { simulateSeason, type CompetitorRun } from './simulation.js';

// A planilha conferida à mão: os CSVs de fixtures/ foram derivados à mão, passo a passo (docs/METODOLOGIA.md, "A
// planilha conferida à mão"), sem rodar este código. O teste compara a simulação com eles centavo a centavo.

const show = (value: bigint | number | boolean | string | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

const runs = simulateSeason({
  market: HAND_CHECKED_MARKET,
  startingCashCents: HAND_CHECKED_CAPITAL_CENTS,
  rules: PLAN_RULES,
  competitors: HAND_CHECKED_COMPETITORS,
});
const byId = (id: string): CompetitorRun => {
  const run = runs.find((r) => r.id === id);
  if (!run) throw new Error(`competidor ${id} não simulado`);
  return run;
};
const ids = HAND_CHECKED_COMPETITORS.map((c) => c.id);

const orderRows = (run: CompetitorRun): Row[] =>
  run.orders.map((order) => {
    const fill = run.fills.find((f) => f.date === order.date && f.itemIndex === order.itemIndex);
    return {
      competitor: run.id,
      date: order.date,
      item_index: show(order.itemIndex),
      ticker: order.ticker,
      action: order.action,
      status: order.status,
      reason: show(order.reason),
      requested_quantity: show(order.requestedQuantity),
      filled_quantity: show(order.filledQuantity),
      price_cents: show(order.priceCents),
      notional_cents: show(fill?.notionalCents),
      cost_cents: show(fill?.costCents),
      realized_cents: show(fill?.realizedCents),
    };
  });

const positionRows = (run: CompetitorRun): Row[] =>
  run.snapshots.flatMap((snapshot) =>
    snapshot.positions.map((p) => ({
      competitor: run.id,
      date: snapshot.date,
      ticker: p.ticker,
      quantity: show(p.quantity),
      cost_cents: show(p.costCents),
      mark_cents: show(p.markCents),
      value_cents: show(p.valueCents),
      stale: show(p.stale),
    })),
  );

const snapshotRows = (run: CompetitorRun): Row[] =>
  run.snapshots.map((s) => ({
    competitor: run.id,
    date: s.date,
    cash_cents: show(s.cashCents),
    positions_value_cents: show(s.positionsValueCents),
    equity_cents: show(s.equityCents),
    interest_cents: show(s.interestCents),
    cdi_date: show(s.cdiDate),
  }));

const forCompetitor = (rows: Row[], id: string) => rows.filter((row) => row['competitor'] === id);

describe('a planilha conferida à mão (3 ações, 5 pregões)', () => {
  describe.each(ids)('%s', (id) => {
    it('ordens e execuções batem com o CSV, centavo a centavo', () => {
      expect(orderRows(byId(id))).toEqual(forCompetitor(csv('hand-checked-orders.csv'), id));
    });

    it('posições de cada fechamento batem com o CSV', () => {
      expect(positionRows(byId(id))).toEqual(forCompetitor(csv('hand-checked-positions.csv'), id));
    });

    it('caixa, juros do CDI e patrimônio de cada fechamento batem com o CSV', () => {
      expect(snapshotRows(byId(id))).toEqual(forCompetitor(csv('hand-checked-snapshots.csv'), id));
    });
  });

  it('métricas da temporada batem com o CSV', () => {
    const rows = seasonStats({
      startingCashCents: HAND_CHECKED_CAPITAL_CENTS,
      runs,
      monteCarlo: null,
    }).map((stat) => ({
      competitor: stat.id,
      return_bps: show(stat.returnBps),
      excess_equal_weight_bps: show(stat.excessEqualWeightBps),
      excess_cdi_bps: show(stat.excessCdiBps),
      max_drawdown_bps: show(stat.maxDrawdownBps),
      sells: show(stat.sells),
      winning_sells: show(stat.winningSells),
      win_rate_bps: show(stat.winRateBps),
      trades: show(stat.trades),
    }));
    expect(rows).toEqual(csv('hand-checked-stats.csv'));
  });

  it('o CSV cobre todos os competidores e todos os pregões', () => {
    const snapshots = csv('hand-checked-snapshots.csv');
    expect(snapshots).toHaveLength(ids.length * HAND_CHECKED_DATES.length);
    for (const id of ids) {
      expect(forCompetitor(snapshots, id).map((row) => row['date'])).toEqual([
        ...HAND_CHECKED_DATES,
      ]);
    }
  });

  describe('aceite: nenhuma ordem usa preço anterior à decisão', () => {
    const openOf = (date: string, ticker: string) =>
      HAND_CHECKED_MARKET.sessions.find((s) => s.date === date)?.bars.get(ticker)?.openCents;

    it('toda execução sai pela abertura do próprio pregão, nunca pelo fechamento nem pelo preço de D-1', () => {
      const fills = runs.flatMap((run) => run.fills);
      expect(fills.length).toBeGreaterThan(10);
      for (const fill of fills) {
        expect(fill.priceCents).toBe(openOf(fill.date, fill.ticker));
      }
    });

    it('AAA3 não tem barra em 05/11: a venda não executa mesmo com posição e fechamento anterior de R$ 25,00', () => {
      const order = byId('model-a').orders.find(
        (o) => o.date === '2026-11-05' && o.ticker === 'AAA3',
      );
      expect(order).toMatchObject({
        status: 'NOT_EXECUTED',
        reason: 'no_bar',
        priceCents: null,
        filledQuantity: 0n,
      });
      expect(
        byId('model-a').fills.some((f) => f.date === '2026-11-05' && f.ticker === 'AAA3'),
      ).toBe(false);
      // a posição segue lá, marcada pelo último fechamento conhecido (R$ 25,00 de 04/11)
      const snapshot = byId('model-a').snapshots.find((s) => s.date === '2026-11-05');
      expect(snapshot?.positions.find((p) => p.ticker === 'AAA3')).toMatchObject({
        quantity: 43n,
        markCents: 2500n,
        stale: true,
      });
    });

    it('a taxa de CDI de 06/11 ainda não saiu: a liquidação de 09/11 usa a de 05/11 e registra a data', () => {
      for (const run of runs) {
        expect(run.snapshots.find((s) => s.date === '2026-11-09')?.cdiDate).toBe('2026-11-05');
      }
    });
  });
});
