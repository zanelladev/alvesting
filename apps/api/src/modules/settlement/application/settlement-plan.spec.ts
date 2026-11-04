import { seasonParamsSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import {
  HAND_CHECKED_CAPITAL_CENTS,
  HAND_CHECKED_DATES,
  HAND_CHECKED_MARKET,
} from '../domain/fixtures/hand-checked.fixture.js';
import { PLAN_RULES } from '../domain/fixtures/rules.fixture.js';
import { monteCarlo } from '../domain/monte-carlo.js';
import { seasonStats } from '../domain/season-stats.js';
import { simulateSeason } from '../domain/simulation.js';
import type {
  BarRow,
  DecisionItemRow,
  SettlementCompetitor,
} from '../infrastructure/settlement.repository.js';
import { IncompleteDataError, buildPlan, derivedRows, type PlanInput } from './settlement-plan.js';

// A ligação entre o banco e o domínio, sem banco: linhas entram, o domínio roda, linhas saem. O caminho com o Postgres de verdade
// (e a planilha conferida à mão) está em settle.handler.integration.spec.ts.
const SEASON_ID = newId();
const params = seasonParamsSchema.parse({
  capitalCents: Number(HAND_CHECKED_CAPITAL_CENTS),
  sessions: 5,
  randomSeed: 'sorteio',
  monteCarloSeed: 'mc',
});
const ids = {
  model: newId(),
  other: newId(),
  random: newId(),
  equal: newId(),
  cdi: newId(),
  bova: newId(),
};
const competitors: SettlementCompetitor[] = [
  { id: ids.model, slug: 'model-a', kind: 'MODEL', benchmark: null },
  { id: ids.other, slug: 'model-b', kind: 'MODEL', benchmark: null },
  { id: ids.random, slug: 'sorteio', kind: 'RANDOM', benchmark: null },
  { id: ids.equal, slug: 'equal-weight', kind: 'BENCHMARK', benchmark: 'EQUAL_WEIGHT' },
  { id: ids.cdi, slug: 'cdi', kind: 'BENCHMARK', benchmark: 'CDI' },
  { id: ids.bova, slug: 'bova11', kind: 'BENCHMARK', benchmark: 'BOVA11' },
];

const barRows: BarRow[] = HAND_CHECKED_MARKET.sessions.flatMap((session) =>
  [...session.bars].map(([ticker, bar]) => ({
    date: session.date,
    ticker,
    openCents: bar.openCents,
    closeCents: bar.closeCents,
  })),
);
const universes = new Map([
  ['2026-W45', ['CCC3', 'AAA3', 'BBB4']],
  ['2026-W46', ['AAA3', 'BBB4', 'CCC3']],
]);
const item = (
  date: string,
  position: number,
  action: 'BUY' | 'SELL' | 'HOLD',
  ticker: string,
  percent: string | null,
  competitorId = ids.model,
): DecisionItemRow => ({
  id: newId(),
  competitorId,
  date,
  position,
  action,
  ticker,
  percent,
  rationale: 'teste',
});

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    params,
    sessions: HAND_CHECKED_DATES,
    competitors,
    items: [],
    bars: barRows,
    universes,
    cdi: HAND_CHECKED_MARKET.cdi,
    events: HAND_CHECKED_MARKET.events,
    ...over,
  };
}

describe('buildPlan: do banco para o domínio', () => {
  it('monta o mercado: barras por pregão, o universo da semana de cada um, o CDI e os eventos', () => {
    const { market } = buildPlan(input());
    expect(market.sessions.map((s) => s.date)).toEqual([...HAND_CHECKED_DATES]);
    const fifth = market.sessions[2]!;
    expect([...fifth.bars.keys()].sort()).toEqual(['BBB4', 'BOVA11', 'CCC3']); // AAA3 sem barra em 05/11
    expect(fifth.bars.get('BBB4')).toEqual({ openCents: 1300n, closeCents: 1250n });
    // a semana de 09/11 é a W46; o universo de cada pregão vem do snapshot da semana dele
    expect(market.sessions[4]!.universe).toEqual(['AAA3', 'BBB4', 'CCC3']);
    expect(market.sessions[0]!.universe).toEqual(['CCC3', 'AAA3', 'BBB4']);
    expect(market.cdi).toBe(HAND_CHECKED_MARKET.cdi);
    expect(market.events).toBe(HAND_CHECKED_MARKET.events);
  });

  it('cada tipo de competidor vira o do domínio, na ordem do elenco, e a semente do Sorteio é a da temporada', () => {
    const plan = buildPlan(input());
    expect(plan.competitors.map((c) => [c.id, c.kind])).toEqual([
      [ids.model, 'MODEL'],
      [ids.other, 'MODEL'],
      [ids.random, 'RANDOM'],
      [ids.equal, 'EQUAL_WEIGHT'],
      [ids.cdi, 'CDI'],
      [ids.bova, 'BOVA11'],
    ]);
    const sorteio = plan.competitors.find((c) => c.kind === 'RANDOM');
    expect(sorteio).toEqual({ id: ids.random, kind: 'RANDOM', seed: 'sorteio' });
  });

  it('as decisões do modelo viram itens do contrato: o percentual do BUY e do SELL entra como número, o HOLD sem percentual', () => {
    const plan = buildPlan(
      input({
        items: [
          item('2026-11-03', 0, 'BUY', 'AAA3', '20'),
          item('2026-11-03', 1, 'BUY', 'BBB4', '15.5'),
          item('2026-11-03', 2, 'HOLD', 'CCC3', null),
          item('2026-11-04', 0, 'SELL', 'AAA3', '51'),
        ],
      }),
    );
    const model = plan.competitors[0];
    if (model?.kind !== 'MODEL') throw new Error('devia ser o modelo');
    expect(model.decisions.get('2026-11-03')).toEqual([
      { ticker: 'AAA3', action: 'BUY', percent_of_equity: 20, rationale: 'teste' },
      { ticker: 'BBB4', action: 'BUY', percent_of_equity: 15.5, rationale: 'teste' },
      { ticker: 'CCC3', action: 'HOLD', rationale: 'teste' },
    ]);
    expect(model.decisions.get('2026-11-04')).toEqual([
      { ticker: 'AAA3', action: 'SELL', percent_of_position: 51, rationale: 'teste' },
    ]);
    // sem decisão no pregão (ciclo pulado, ausente ou HOLD forçado) = HOLD: o mapa não tem a data
    expect(model.decisions.has('2026-11-05')).toBe(false);
    const other = plan.competitors[1];
    if (other?.kind !== 'MODEL') throw new Error('devia ser o modelo');
    expect(other.decisions.size).toBe(0);
  });

  it('o item de outro competidor, de um pregão fora da temporada ou de quem não é modelo não entra', () => {
    const plan = buildPlan(
      input({
        items: [
          item('2026-11-03', 0, 'BUY', 'AAA3', '10', ids.other),
          item('2026-11-12', 0, 'BUY', 'AAA3', '10'),
          item('2026-11-03', 0, 'BUY', 'AAA3', '10', ids.random),
        ],
      }),
    );
    const [model, other] = plan.competitors;
    if (model?.kind !== 'MODEL' || other?.kind !== 'MODEL') throw new Error('devia ser modelo');
    expect(model.decisions.size).toBe(0);
    expect([...other.decisions.keys()]).toEqual(['2026-11-03']);
  });

  it('guarda o id do item da decisão de cada posição da lista, para ligar a ordem a ele', () => {
    const a = item('2026-11-03', 0, 'BUY', 'AAA3', '20');
    // o item 1 foi descartado e não veio da consulta: a lista que o domínio recebe tem o 0 e o 2, nessa ordem
    const c = item('2026-11-03', 2, 'HOLD', 'CCC3', null);
    const plan = buildPlan(input({ items: [c, a] }));
    expect(plan.itemIds.get(`${ids.model}|2026-11-03`)).toEqual([a.id, c.id]);
  });

  it('percentual que não é número é erro de dado, não zero', () => {
    expect(() =>
      buildPlan(input({ items: [item('2026-11-03', 0, 'BUY', 'AAA3', 'muito')] })),
    ).toThrow(/percentual/i);
    expect(() => buildPlan(input({ items: [item('2026-11-03', 0, 'BUY', 'AAA3', null)] }))).toThrow(
      /percentual/i,
    );
  });

  describe('dados incompletos: não liquida e deixa a fila tentar de novo', () => {
    // o erro lançado, para conferir a classe e o texto juntos
    const thrown = (work: () => unknown): unknown => {
      try {
        work();
      } catch (error) {
        return error;
      }
      return undefined;
    };

    it('um pregão sem nenhuma barra do universo (as barras do dia não foram carregadas)', () => {
      const bars = barRows.filter((b) => b.date !== '2026-11-05');
      const error = thrown(() => buildPlan(input({ bars })));
      expect(error).toBeInstanceOf(IncompleteDataError);
      expect((error as Error).message).toMatch(/2026-11-05/);
    });

    it('só a referência com barra não basta: precisa de barra de alguma ação do universo', () => {
      const bars = barRows.filter((b) => b.date !== '2026-11-09' || b.ticker === 'BOVA11');
      expect(() => buildPlan(input({ bars }))).toThrow(IncompleteDataError);
    });

    it('uma ação do universo sem barra num dia que tem as outras não é problema (daily_bar nunca é denso)', () => {
      expect(() => buildPlan(input())).not.toThrow(); // AAA3 sem barra em 05/11
    });

    it('uma semana sem universo congelado', () => {
      const error = thrown(() =>
        buildPlan(input({ universes: new Map([['2026-W45', ['AAA3', 'BBB4', 'CCC3']]]) })),
      );
      expect(error).toBeInstanceOf(IncompleteDataError);
      expect((error as Error).message).toMatch(/2026-W46/);
    });
  });
});

describe('derivedRows: do domínio para o banco', () => {
  function settle(items: DecisionItemRow[]) {
    const plan = buildPlan(input({ items }));
    const runs = simulateSeason({
      market: plan.market,
      startingCashCents: HAND_CHECKED_CAPITAL_CENTS,
      rules: PLAN_RULES,
      competitors: plan.competitors,
    });
    const mc = monteCarlo({
      market: plan.market,
      startingCashCents: HAND_CHECKED_CAPITAL_CENTS,
      rules: PLAN_RULES,
      seed: 'mc',
      runs: 50,
      competitors: runs,
    });
    const stats = seasonStats({
      startingCashCents: HAND_CHECKED_CAPITAL_CENTS,
      runs,
      monteCarlo: mc,
    });
    return { plan, runs, mc, rows: derivedRows({ seasonId: SEASON_ID, plan, runs, mc, stats }) };
  }
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('liga cada ordem ao item da decisão, e a execução à ordem; Sorteio e referências não têm item', () => {
    const buyA = item('2026-11-03', 0, 'BUY', 'AAA3', '20');
    const hold = item('2026-11-03', 1, 'HOLD', 'CCC3', null);
    const { rows } = settle([buyA, hold]);

    const modelOrders = rows.orders.filter((o) => o.competitorId === ids.model);
    expect(modelOrders).toHaveLength(1);
    expect(modelOrders[0]).toMatchObject({
      seasonId: SEASON_ID,
      date: day('2026-11-03'),
      itemIndex: 0,
      decisionItemId: buyA.id, // o HOLD não vira ordem, mas o índice dele não desloca o do BUY
      ticker: 'AAA3',
      action: 'BUY',
      status: 'FILLED',
      filledQuantity: 86n,
      priceCents: 2300n,
    });
    const fill = rows.fills.find((f) => f.orderId === modelOrders[0]!.id);
    expect(fill).toMatchObject({
      quantity: 86n,
      priceCents: 2300n,
      notionalCents: 197_800n,
      costCents: 59n,
    });
    expect(fill?.realizedCents ?? null).toBeNull();
    const others = rows.orders.filter((o) => o.competitorId !== ids.model);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((o) => o.decisionItemId === null)).toBe(true);
    // toda execução aponta para uma ordem que existe, e toda ordem tem id próprio
    expect(new Set(rows.orders.map((o) => o.id)).size).toBe(rows.orders.length);
    const orderIds = new Set(rows.orders.map((o) => o.id));
    expect(rows.fills.every((f) => orderIds.has(f.orderId))).toBe(true);
  });

  it('uma linha por competidor e pregão no snapshot, com o percentil do Monte Carlo; uma estatística por competidor', () => {
    const { rows, runs, mc } = settle([]);
    expect(rows.snapshots).toHaveLength(competitors.length * HAND_CHECKED_DATES.length);
    const cdiRows = rows.snapshots.filter((s) => s.competitorId === ids.cdi);
    expect(cdiRows.map((s) => s.equityCents)).toEqual(
      runs.find((r) => r.id === ids.cdi)!.snapshots.map((s) => s.equityCents),
    );
    expect(cdiRows[0]).toMatchObject({ cdiDate: null, interestCents: 0n });
    expect(cdiRows[1]).toMatchObject({ cdiDate: day('2026-11-03') });
    expect(cdiRows.map((s) => s.percentileBps)).toEqual(
      mc.sessions.map((s) => s.percentileBps[ids.cdi]),
    );
    expect(rows.stats.map((s) => s.competitorId)).toEqual(competitors.map((c) => c.id));
    expect(
      rows.stats.every((s) => (s.asOf as Date).getTime() === day('2026-11-09').getTime()),
    ).toBe(true);
    expect(rows.stats[0]).toMatchObject({
      percentileBps: mc.sessions.at(-1)!.percentileBps[ids.model],
    });
  });

  it('as posições do fechamento viram linhas, com a marcação antiga marcada como stale', () => {
    const { rows } = settle([item('2026-11-03', 0, 'BUY', 'AAA3', '20')]);
    const aaa = rows.positions.filter((p) => p.competitorId === ids.model);
    expect(aaa).toHaveLength(5); // AAA3 em cada fechamento
    expect(aaa[0]).toMatchObject({
      ticker: 'AAA3',
      quantity: 86n,
      costCents: 197_859n,
      markCents: 2400n,
      valueCents: 206_400n,
      stale: false,
    });
    expect(aaa[2]).toMatchObject({ stale: true, markCents: 2500n }); // 05/11: AAA3 sem barra
  });

  it('uma linha do Monte Carlo por pregão, com a semente, o número de carteiras e os percentis', () => {
    const { rows, mc } = settle([]);
    expect(rows.baselines).toHaveLength(HAND_CHECKED_DATES.length);
    expect(rows.baselines[0]).toMatchObject({
      seasonId: SEASON_ID,
      date: day('2026-11-03'),
      seed: 'mc',
      runs: 50,
      equityP5Cents: mc.sessions[0]!.equityCents.p5,
      equityP95Cents: mc.sessions[0]!.equityCents.p95,
      returnP50Bps: mc.sessions[0]!.returnBps.p50,
    });
  });
});
