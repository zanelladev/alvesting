import type { DecisionItem } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { MissingCdiError } from './cdi.js';
import type { CorporateEvent } from './corporate-events.js';
import { PLAN_RULES } from './fixtures/rules.fixture.js';
import { syntheticMarket, syntheticTickers } from './fixtures/synthetic-market.fixture.js';
import type { Bar } from './portfolio.js';
import { SORTEIO_PORTFOLIO, randomDecisions } from './random-policy.js';
import {
  BOVA11_TICKER,
  prepare,
  simulateSeason,
  type Competitor,
  type CompetitorRun,
  type Market,
  type Session,
} from './simulation.js';

// Prepare e simulateSeason, fora da planilha conferida à mão (hand-checked.spec.ts): as regras de data do CDI e do
// evento, os competidores de referência e as propriedades de uma temporada recalculada do zero.

const CAPITAL = 1_000_000n;
const bar = (open: number, close = open): Bar => ({
  openCents: BigInt(open),
  closeCents: BigInt(close),
});
const session = (
  date: string,
  bars: Record<string, Bar | null> = {},
  universe: string[] = Object.keys(bars),
): Session => ({
  date,
  bars: new Map(Object.entries(bars).flatMap(([t, b]): [string, Bar][] => (b ? [[t, b]] : []))),
  universe,
});
const event = (
  id: string,
  ticker: string,
  exDate: string,
  from: number,
  to: number,
): CorporateEvent => ({
  id,
  ticker,
  exDate,
  from: BigInt(from),
  to: BigInt(to),
});
const buy = (ticker: string, percent: number): DecisionItem => ({
  ticker,
  action: 'BUY',
  percent_of_equity: percent,
  rationale: 'teste',
});
const only = (runs: CompetitorRun[]): CompetitorRun => {
  const [first] = runs;
  if (!first || runs.length !== 1) throw new Error('esperava um competidor');
  return first;
};
const simulate = (market: Market, competitors: Competitor[], capital = CAPITAL) =>
  simulateSeason({ market, startingCashCents: capital, rules: PLAN_RULES, competitors });

describe('prepare', () => {
  const days = ['2026-11-03', '2026-11-04', '2026-11-09'];

  it('uma temporada sem pregão não existe', () => {
    expect(() => prepare({ sessions: [], cdi: [], events: [] })).toThrow(RangeError);
  });

  it('recusa pregões repetidos, fora de ordem ou com data inválida', () => {
    const m = (dates: string[]) => ({
      sessions: dates.map((d) => session(d)),
      cdi: [{ date: '2026-11-03', pct: '0.05' }],
      events: [],
    });
    expect(() => prepare(m(['2026-11-03', '2026-11-03']))).toThrow(RangeError);
    expect(() => prepare(m(['2026-11-04', '2026-11-03']))).toThrow(RangeError);
    expect(() => prepare(m(['2026-11-03', '2026-02-30']))).toThrow(RangeError);
  });

  describe('regra de data do CDI', () => {
    it('o primeiro pregão não rende; cada intervalo rende a taxa do pregão anterior (um dia útil por intervalo)', () => {
      const prepared = prepare({
        sessions: days.map((d) => session(d)),
        cdi: [
          { date: '2026-11-03', pct: '0.050000' },
          { date: '2026-11-04', pct: '0.060000' },
          { date: '2026-11-09', pct: '0.070000' },
        ],
        events: [],
      });
      // 03->04 rende a de 03/11; 04->09 (fim de semana no meio) rende só a de 04/11, uma vez; a de 09/11 é do futuro
      expect(prepared.map((s) => s.cdi?.date ?? null)).toEqual([null, '2026-11-03', '2026-11-04']);
    });

    it('taxa do pregão anterior ainda não publicada: vale a última publicada, com a data registrada', () => {
      const prepared = prepare({
        sessions: days.map((d) => session(d)),
        cdi: [{ date: '2026-11-03', pct: '0.050000' }],
        events: [],
      });
      expect(prepared.map((s) => s.cdi?.date ?? null)).toEqual([null, '2026-11-03', '2026-11-03']);
    });

    it('sem nenhuma taxa publicada até o pregão anterior, falha em vez de render zero em silêncio', () => {
      expect(() => prepare({ sessions: days.map((d) => session(d)), cdi: [], events: [] })).toThrow(
        MissingCdiError,
      );
      expect(() =>
        prepare({
          sessions: days.map((d) => session(d)),
          cdi: [{ date: '2026-11-04', pct: '0.05' }], // só existe uma taxa depois do 1º pregão
          events: [],
        }),
      ).toThrow(MissingCdiError);
    });

    it('um pregão só não precisa de CDI', () => {
      expect(prepare({ sessions: [session('2026-11-03')], cdi: [], events: [] })).toHaveLength(1);
    });

    it('CDI mal formado derruba a preparação', () => {
      expect(() =>
        prepare({
          sessions: days.map((d) => session(d)),
          cdi: [{ date: '2026-11-03', pct: '0,05' }],
          events: [],
        }),
      ).toThrow(RangeError);
    });
  });

  describe('regra de data do evento corporativo', () => {
    const sessions = [
      session('2026-11-03', { XXX3: bar(100) }),
      session('2026-11-04', { XXX3: bar(100) }),
      session('2026-11-05', { YYY3: bar(100) }), // XXX3 sem barra
      session('2026-11-06', { XXX3: bar(50) }),
    ];
    const cdi = [{ date: '2026-11-03', pct: '0.05' }];
    const eventsPerSession = (events: CorporateEvent[]) =>
      prepare({ sessions, cdi, events }).map((s) => s.events.map((e) => e.id));

    it('vale no pregão da data ex, se a ação tem barra nele', () => {
      expect(eventsPerSession([event('A', 'XXX3', '2026-11-04', 1, 2)])).toEqual([
        [],
        ['A'],
        [],
        [],
      ]);
    });

    it('sem barra na data ex, vale no primeiro pregão seguinte em que a ação tem barra', () => {
      // 05/11: XXX3 não negociou, então o preço novo só aparece em 06/11; o estado velho (quantidade e preço velhos)
      // continua coerente até lá
      expect(eventsPerSession([event('A', 'XXX3', '2026-11-05', 1, 2)])).toEqual([
        [],
        [],
        [],
        ['A'],
      ]);
    });

    it('data ex em dia sem pregão (fim de semana, feriado) vale no próximo pregão com barra', () => {
      expect(eventsPerSession([event('A', 'XXX3', '2026-11-01', 1, 2)])).toEqual([
        ['A'],
        [],
        [],
        [],
      ]);
    });

    it('data ex depois do último pregão ainda não vale', () => {
      expect(eventsPerSession([event('A', 'XXX3', '2026-11-09', 1, 2)])).toEqual([[], [], [], []]);
    });

    it('ação que nunca tem barra na temporada: o evento não vale (não há posição possível)', () => {
      expect(eventsPerSession([event('A', 'ZZZ3', '2026-11-03', 1, 2)])).toEqual([[], [], [], []]);
    });

    it('vários eventos no mesmo pregão aplicam na ordem da data ex e, depois, do id', () => {
      const ids = (events: CorporateEvent[]) => eventsPerSession(events)[3];
      const base = [
        event('C', 'XXX3', '2026-11-05', 1, 2),
        event('B', 'XXX3', '2026-11-05', 10, 11),
        event('D', 'XXX3', '2026-11-04', 2, 1), // data ex anterior, aplica antes (no pregão de 04/11)
      ];
      expect(eventsPerSession(base)[1]).toEqual(['D']);
      expect(ids(base)).toEqual(['B', 'C']);
      expect(ids([...base].reverse())).toEqual(['B', 'C']); // a ordem de entrada não importa
    });

    it('evento mal formado derruba a preparação', () => {
      expect(() => eventsPerSession([event('A', 'XXX3', '2026-11-04', 0, 2)])).toThrow(RangeError);
      expect(() => eventsPerSession([event('A', 'XXX3', '2026-02-30', 1, 2)])).toThrow(RangeError);
    });
  });

  it('barra com preço zero ou negativo não é preço: conta como sem barra', () => {
    const [first] = prepare({
      sessions: [
        session('2026-11-03', {
          OK: bar(100, 110),
          ABERTURA0: bar(0, 110),
          FECHAMENTO0: bar(100, 0),
          NEGATIVA: bar(-5, 110),
        }),
      ],
      cdi: [],
      events: [],
    });
    expect([...(first?.bars.keys() ?? [])]).toEqual(['OK']);
  });

  it('o universo vem ordenado e sem repetição, qualquer que seja a ordem em que chega', () => {
    const [first] = prepare({
      sessions: [session('2026-11-03', {}, ['CCC3', 'AAA3', 'BBB4', 'AAA3'])],
      cdi: [],
      events: [],
    });
    expect(first?.universe).toEqual(['AAA3', 'BBB4', 'CCC3']);
  });

  it('não muda o mercado de entrada', () => {
    const market: Market = {
      sessions: [session('2026-11-03', { B: bar(0, 1), A: bar(1) }, ['B', 'A'])],
      cdi: [],
      events: [event('Z', 'A', '2026-11-03', 1, 2), event('Y', 'A', '2026-11-03', 1, 3)],
    };
    prepare(market);
    expect(market.sessions[0]?.universe).toEqual(['B', 'A']);
    expect(market.sessions[0]?.bars.has('B')).toBe(true);
    expect(market.events.map((e) => e.id)).toEqual(['Z', 'Y']);
  });
});

describe('os competidores', () => {
  const flat = (tickers: Record<string, number>, dates = ['2026-11-03', '2026-11-04']): Market => ({
    sessions: dates.map((d) =>
      session(d, Object.fromEntries(Object.entries(tickers).map(([t, p]) => [t, bar(p)]))),
    ),
    cdi: dates.map((date) => ({ date, pct: '0.050000' })),
    events: [],
  });

  it('modelo sem decisão no pregão não opera (HOLD)', () => {
    const run = only(
      simulate(flat({ AAA3: 1000 }), [{ id: 'm', kind: 'MODEL', decisions: new Map() }]),
    );
    expect(run.orders).toEqual([]);
    expect(run.fills).toEqual([]);
    // sem posição, o patrimônio é só o caixa rendendo: 1.000.000 x 0,05% = 500
    expect(run.snapshots.map((s) => s.equityCents)).toEqual([1_000_000n, 1_000_500n]);
  });

  it('CDI: o capital rendendo, sem ordem nem posição', () => {
    const run = only(simulate(flat({ AAA3: 1000 }), [{ id: 'cdi', kind: 'CDI' }]));
    expect(run.orders).toEqual([]);
    expect(run.snapshots.map((s) => [s.cashCents, s.positions.length])).toEqual([
      [1_000_000n, 0],
      [1_000_500n, 0],
    ]);
  });

  it('BOVA11: compra na abertura do primeiro pregão com todo o capital e segura', () => {
    const market = flat({ AAA3: 1000, [BOVA11_TICKER]: 13_000 }, [
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
    const run = only(simulate(market, [{ id: 'b', kind: 'BOVA11' }]));
    expect(run.fills).toHaveLength(1);
    expect(run.fills[0]).toMatchObject({
      ticker: BOVA11_TICKER,
      quantity: 76n,
      priceCents: 13_000n,
    });
    // 76 x 130,00 = 988.000 + 296 de custo: sobram 11.704
    expect(run.snapshots[0]?.cashCents).toBe(11_704n);
    expect(run.snapshots.map((s) => s.positions.map((p) => p.quantity))).toEqual([
      [76n],
      [76n],
      [76n],
    ]);
  });

  it('BOVA11 sem barra no primeiro pregão: a ordem fica registrada como não executada e o capital segue em CDI', () => {
    const run = only(simulate(flat({ AAA3: 1000 }), [{ id: 'b', kind: 'BOVA11' }]));
    expect(run.orders[0]).toMatchObject({
      ticker: BOVA11_TICKER,
      status: 'NOT_EXECUTED',
      reason: 'no_bar',
    });
    expect(run.snapshots.map((s) => s.equityCents)).toEqual([1_000_000n, 1_000_500n]);
  });

  describe('igual-peso do universo, só preço', () => {
    it('compra todas as ações do universo da semana de início, sem o limite de 10 posições', () => {
      const tickers = Object.fromEntries(syntheticTickers(25).map((t) => [t, 1000]));
      const run = only(
        simulate(flat(tickers, ['2026-11-03', '2026-11-04', '2026-11-05']), [
          { id: 'ew', kind: 'EQUAL_WEIGHT' },
        ]),
      );
      // fatia de 1.000.000 / 25 = 40.000: cabem 39 ações (39.000 + 12 de custo; 40 já passam)
      expect(run.fills).toHaveLength(25);
      expect(new Set(run.fills.map((f) => f.quantity))).toEqual(new Set([39n]));
      expect(run.snapshots[0]?.positions).toHaveLength(25);
      expect(run.snapshots[0]?.cashCents).toBe(1_000_000n - 25n * 39_012n);
      // segura até o fim: nada de ordem depois do primeiro pregão
      expect(run.orders.every((o) => o.date === '2026-11-03')).toBe(true);
      expect(run.snapshots[2]?.positions).toHaveLength(25);
    });

    it('os pesos são iguais: cada ação recebe a mesma fatia do caixa, com o mesmo custo de 0,03%', () => {
      const run = only(
        simulate(flat({ AAA3: 1000, BBB4: 2500, CCC3: 700 }), [{ id: 'ew', kind: 'EQUAL_WEIGHT' }]),
      );
      // fatia 333.333: AAA3 333 ações (333.100), BBB4 133 (332.600), CCC3 476 (333.200 + 100 = 333.300)
      expect(run.fills.map((f) => [f.ticker, f.quantity, f.notionalCents + f.costCents])).toEqual([
        ['AAA3', 333n, 333_100n],
        ['BBB4', 133n, 332_600n],
        ['CCC3', 476n, 333_300n],
      ]);
      for (const fill of run.fills)
        expect(fill.notionalCents + fill.costCents <= 333_333n).toBe(true);
    });

    it('ação do universo sem barra no primeiro pregão fica de fora e o peso se divide entre as que têm', () => {
      const market: Market = {
        sessions: [
          session('2026-11-03', { AAA3: bar(1000), BBB4: bar(1000), CCC3: bar(1000), DDD3: null }, [
            'AAA3',
            'BBB4',
            'CCC3',
            'DDD3',
          ]),
        ],
        cdi: [],
        events: [],
      };
      const run = only(simulate(market, [{ id: 'ew', kind: 'EQUAL_WEIGHT' }]));
      expect(run.orders.map((o) => [o.ticker, o.status, o.reason])).toEqual([
        ['AAA3', 'FILLED', null],
        ['BBB4', 'FILLED', null],
        ['CCC3', 'FILLED', null],
        ['DDD3', 'NOT_EXECUTED', 'no_bar'],
      ]);
      // fatia de 1.000.000 / 3, e não de / 4
      expect(run.fills.map((f) => f.quantity)).toEqual([333n, 333n, 333n]);
    });

    it('ação cujo preço passa da fatia não é comprada e a fatia fica no caixa', () => {
      const run = only(
        simulate(flat({ AAA3: 1000, CARA3: 600_000 }), [{ id: 'ew', kind: 'EQUAL_WEIGHT' }]),
      );
      expect(run.orders.find((o) => o.ticker === 'CARA3')).toMatchObject({
        status: 'NOT_EXECUTED',
        reason: 'below_one_share',
      });
      // fatia de 500.000: AAA3 499 ações (499.000 + 150)
      expect(run.fills.map((f) => [f.ticker, f.quantity])).toEqual([['AAA3', 499n]]);
      expect(run.snapshots[0]?.cashCents).toBe(1_000_000n - 499_150n);
    });

    it('universo vazio: não há o que comprar e o capital rende CDI', () => {
      const market: Market = {
        sessions: [
          session('2026-11-03', { AAA3: bar(1000) }, []),
          session('2026-11-04', { AAA3: bar(1000) }, []),
        ],
        cdi: [{ date: '2026-11-03', pct: '0.050000' }],
        events: [],
      };
      const run = only(simulate(market, [{ id: 'ew', kind: 'EQUAL_WEIGHT' }]));
      expect(run.orders).toEqual([]);
      expect(run.snapshots.map((s) => s.equityCents)).toEqual([1_000_000n, 1_000_500n]);
    });

    it('usa o universo do primeiro pregão, não o dos seguintes', () => {
      const market: Market = {
        sessions: [
          session('2026-11-03', { AAA3: bar(1000), BBB4: bar(1000) }, ['AAA3']),
          session('2026-11-04', { AAA3: bar(1000), BBB4: bar(1000) }, ['AAA3', 'BBB4']),
        ],
        cdi: [{ date: '2026-11-03', pct: '0.05' }],
        events: [],
      };
      const run = only(simulate(market, [{ id: 'ew', kind: 'EQUAL_WEIGHT' }]));
      expect(run.fills.map((f) => f.ticker)).toEqual(['AAA3']);
    });
  });

  it('o Sorteio é a política aleatória, com a semente própria, na carteira "sorteio"', () => {
    const market = syntheticMarket({ tickers: 30, sessions: 6, gapEvery: 1_000_000 });
    const first = market.sessions[0];
    if (!first) throw new Error('mercado vazio');
    const expected = randomDecisions({
      seed: 'temporada-1', // sorteia 5 ordens no primeiro pregão (conferido por fora com o SHA-256)
      date: first.date,
      portfolio: SORTEIO_PORTFOLIO,
      held: [],
      universe: first.universe,
    });
    expect(expected).toHaveLength(5);
    const run = only(simulate(market, [{ id: 'sorteio', kind: 'RANDOM', seed: 'temporada-1' }]));
    expect(run.orders.filter((o) => o.date === first.date).map((o) => o.ticker)).toEqual(
      expected.map((i) => i.ticker),
    );
    // outra semente, outra temporada
    const other = only(simulate(market, [{ id: 'sorteio', kind: 'RANDOM', seed: 'outra' }]));
    expect(other.snapshots.map((s) => s.equityCents)).not.toEqual(
      run.snapshots.map((s) => s.equityCents),
    );
  });

  it('as mesmas regras valem para o Sorteio: caixa nunca negativo, até 10 posições, até 5 ordens, preço de abertura', () => {
    const market = syntheticMarket({ tickers: 60, sessions: 20 });
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const run = only(simulate(market, [{ id: 'sorteio', kind: 'RANDOM', seed }]));
      for (const snapshot of run.snapshots) {
        expect(snapshot.cashCents >= 0n).toBe(true);
        expect(snapshot.positions.length).toBeLessThanOrEqual(10);
      }
      const perDay = new Map<string, number>();
      for (const order of run.orders) perDay.set(order.date, (perDay.get(order.date) ?? 0) + 1);
      expect(Math.max(0, ...perDay.values())).toBeLessThanOrEqual(5);
      for (const fill of run.fills) {
        const open = market.sessions
          .find((s) => s.date === fill.date)
          ?.bars.get(fill.ticker)?.openCents;
        expect(fill.priceCents).toBe(open);
      }
    }
  });

  it('recusa ids repetidos e capital sem sentido', () => {
    const market = flat({ AAA3: 1000 });
    expect(() =>
      simulate(market, [
        { id: 'x', kind: 'CDI' },
        { id: 'x', kind: 'BOVA11' },
      ]),
    ).toThrow(RangeError);
    expect(() => simulate(market, [{ id: 'x', kind: 'CDI' }], 0n)).toThrow(RangeError);
    expect(() => simulate(market, [{ id: 'x', kind: 'CDI' }], -1n)).toThrow(RangeError);
  });

  it('sem competidores, nada a devolver', () => {
    expect(simulate(flat({ AAA3: 1000 }), [])).toEqual([]);
  });
});

describe('as regras da temporada (tradeCostBps e maxPositions) valem para todos os competidores', () => {
  const market = syntheticMarket({ tickers: 60, sessions: 12 });
  const cast: Competitor[] = [
    { id: 'sorteio', kind: 'RANDOM', seed: 'temporada-1' },
    { id: 'ew', kind: 'EQUAL_WEIGHT' },
  ];
  const withRules = (rules: { tradeCostBps: bigint; maxPositions: number }) =>
    simulateSeason({ market, startingCashCents: CAPITAL, rules, competitors: cast });

  it('o limite de posições é o da temporada, no Sorteio; o igual-peso segue fora dele', () => {
    const [sorteio, ew] = withRules({ tradeCostBps: 3n, maxPositions: 3 });
    const most = Math.max(...(sorteio?.snapshots.map((s) => s.positions.length) ?? [99]));
    expect(most).toBeLessThanOrEqual(3);
    expect(sorteio?.orders.some((o) => o.reason === 'max_positions')).toBe(true);
    expect(ew?.snapshots[0]?.positions.length).toBeGreaterThan(40);
  });

  it('o custo é o da temporada em toda execução, inclusive nas referências', () => {
    for (const bps of [0n, 3n, 25n]) {
      const runs = withRules({ tradeCostBps: bps, maxPositions: 10 });
      for (const run of runs) {
        expect(run.fills.length).toBeGreaterThan(0);
        for (const fill of run.fills) {
          // custo = valor x bps / 10.000 no centavo mais próximo: a diferença para o exato é de meio centavo, no máximo
          const exact = fill.notionalCents * bps;
          expect(fill.costCents * 10_000n >= exact - 5_000n).toBe(true);
          expect(fill.costCents * 10_000n <= exact + 5_000n).toBe(true);
        }
      }
    }
    const free = withRules({ tradeCostBps: 0n, maxPositions: 10 });
    expect(free[1]?.fills.every((f) => f.costCents === 0n)).toBe(true);
    // custo maior, patrimônio menor para quem compra e segura
    const cheap =
      withRules({ tradeCostBps: 3n, maxPositions: 10 })[1]?.snapshots[0]?.equityCents ?? 0n;
    const dear =
      withRules({ tradeCostBps: 25n, maxPositions: 10 })[1]?.snapshots[0]?.equityCents ?? 0n;
    expect(dear < cheap).toBe(true);
  });

  it('regras sem sentido são recusadas', () => {
    for (const rules of [
      { tradeCostBps: -1n, maxPositions: 10 },
      { tradeCostBps: 10_000n, maxPositions: 10 },
      { tradeCostBps: 3n, maxPositions: 0 },
      { tradeCostBps: 3n, maxPositions: 1.5 },
    ]) {
      expect(() => withRules(rules)).toThrow(RangeError);
    }
  });
});

describe('evento corporativo na temporada', () => {
  it('sem barra na data ex, a posição segue no estado velho (quantidade e preço velhos) até o primeiro preço novo', () => {
    // XXX3: 100 ações compradas a R$ 20,00; desdobramento 1 para 2 com data ex em 05/11, mas XXX3 só negocia de novo
    // em 06/11, já a R$ 10,00. Em 05/11 a posição vale 100 x 20,00 (último fechamento); em 06/11, 200 x 10,00.
    const market: Market = {
      sessions: [
        session('2026-11-03', { XXX3: bar(2000, 2000) }),
        session('2026-11-04', { XXX3: bar(2000, 2000) }),
        session('2026-11-05', {}),
        session('2026-11-06', { XXX3: bar(1000, 1000) }),
      ],
      cdi: ['03', '04', '05', '06'].map((d) => ({ date: `2026-11-${d}`, pct: '0' })),
      events: [event('E1', 'XXX3', '2026-11-05', 1, 2)],
    };
    const model: Competitor = {
      id: 'm',
      kind: 'MODEL',
      decisions: new Map([['2026-11-03', [buy('XXX3', 5)]]]), // 5% de 1.000.000 = 50.000: 25 ações
    };
    const run = only(simulate(market, [model]));
    const positions = run.snapshots.map((s) => s.positions[0]);
    expect(positions.map((p) => [p?.quantity, p?.markCents, p?.stale])).toEqual([
      [25n, 2000n, false],
      [25n, 2000n, false],
      [25n, 2000n, true], // sem barra: marcada pelo último fechamento
      [50n, 1000n, false], // evento aplicado, preço novo
    ]);
    // o valor da posição não tem salto nenhum pelo evento
    expect(run.snapshots.map((s) => s.positionsValueCents)).toEqual([
      50_000n,
      50_000n,
      50_000n,
      50_000n,
    ]);
  });

  it('fração de ação vira dinheiro no caixa, ao preço de abertura do pregão em que o evento vale', () => {
    // 25 ações; grupamento de 10 para 1 em 04/11 = 2,5 ações: ficam 2 e a meia ação paga 0,5 x R$ 105,00 = R$ 52,50
    const market: Market = {
      sessions: [
        session('2026-11-03', { XXX3: bar(1000, 1000) }),
        session('2026-11-04', { XXX3: bar(10_500, 10_800) }),
      ],
      cdi: [{ date: '2026-11-03', pct: '0.050000' }],
      events: [event('E1', 'XXX3', '2026-11-04', 10, 1)],
    };
    const model: Competitor = {
      id: 'm',
      kind: 'MODEL',
      decisions: new Map([['2026-11-03', [buy('XXX3', 5)]]]),
    };
    const run = only(simulate(market, [model], 500_000n));
    // 5% de 500.000 = 25.000 = 25 ações a R$ 10,00; custo 7,5 -> 8
    expect(run.snapshots[0]).toMatchObject({ cashCents: 500_000n - 25_008n });
    const second = run.snapshots[1];
    // caixa: 474.992 + juros de 0,05% (237,496 -> 237) + 5.250 da fração
    expect(second?.cashCents).toBe(474_992n + 237n + 5_250n);
    // 2 ações x R$ 108,00; o custo das 2 ações é 25.008 x 2 / 2,5 = 20.006,4 -> 20.006
    expect(second?.positions).toEqual([
      {
        ticker: 'XXX3',
        quantity: 2n,
        costCents: 20_006n,
        markCents: 10_800n,
        valueCents: 21_600n,
        stale: false,
      },
    ]);
  });
});

describe('a temporada é recalculada do zero (plano, etapa 7)', () => {
  const base = syntheticMarket({ tickers: 40, sessions: 12 });
  // uma ação que negocia em todos os pregões leva o desdobramento de 1 para 2, com data ex em 12/11
  const split = syntheticTickers(40).find((t) => base.sessions.every((s) => s.bars.has(t))) ?? '';
  const market: Market = { ...base, events: [event('E1', split, '2026-11-12', 1, 2)] };
  const decisions = new Map<string, DecisionItem[]>(
    market.sessions.map((s) => [
      s.date,
      randomDecisions({
        seed: 'um-modelo',
        date: s.date,
        portfolio: 'm',
        held: [],
        universe: s.universe,
      }).filter((i) => i.action === 'BUY'),
    ]),
  );
  const cast: Competitor[] = [
    { id: 'm', kind: 'MODEL', decisions },
    { id: 'sorteio', kind: 'RANDOM', seed: 'semente' },
    { id: 'ew', kind: 'EQUAL_WEIGHT' },
    { id: 'cdi', kind: 'CDI' },
  ];

  it('a mesma entrada dá exatamente a mesma saída, sem estado escondido entre as chamadas', () => {
    const first = simulate(market, cast);
    simulate(syntheticMarket({ tickers: 40, sessions: 12, salt: 'outro' }), cast);
    expect(simulate(market, cast)).toEqual(first);
  });

  it('o pregão k não depende do que vem depois dele (nem barra, nem CDI, nem evento)', () => {
    const full = simulate(market, cast);
    // 10 pregões já inclui a data ex (o 8º); 3 e 7 ficam antes dela
    for (const k of [1, 3, 7, 10]) {
      const cut: Market = { ...market, sessions: market.sessions.slice(0, k) };
      const partial = simulate(cut, cast);
      for (const [index, run] of partial.entries()) {
        const complete = full[index];
        expect(run.snapshots).toEqual(complete?.snapshots.slice(0, k));
        const upTo = market.sessions[k - 1]?.date ?? '';
        expect(run.orders).toEqual(complete?.orders.filter((o) => o.date <= upTo));
        expect(run.fills).toEqual(complete?.fills.filter((f) => f.date <= upTo));
      }
    }
  });

  it('trocar as barras de um dia (uma correção do dado) corrige tudo dali em diante e só dali em diante', () => {
    const before = simulate(market, cast);
    const target = market.sessions[5];
    if (!target) throw new Error('mercado curto');
    // a barra corrigida de todas as ações do dia: abertura e fechamento 2% mais altos
    const fixedBars = new Map(
      [...target.bars].map(([ticker, b]) => [
        ticker,
        { openCents: (b.openCents * 102n) / 100n, closeCents: (b.closeCents * 102n) / 100n },
      ]),
    );
    const corrected: Market = {
      ...market,
      sessions: market.sessions.map((s, i) => (i === 5 ? { ...s, bars: fixedBars } : s)),
    };
    const after = simulate(corrected, cast);
    for (const [index, run] of after.entries()) {
      const old = before[index];
      if (run.kind === 'CDI') {
        expect(run.snapshots).toEqual(old?.snapshots); // o CDI não olha preço
        continue;
      }
      expect(run.snapshots.slice(0, 5)).toEqual(old?.snapshots.slice(0, 5));
    }
    // o igual-peso segura todas as ações: do dia 6 em diante o patrimônio dele muda, sem lógica de correção
    const equalWeight = (runs: CompetitorRun[]) => runs.find((r) => r.id === 'ew')?.snapshots;
    expect(
      equalWeight(after)
        ?.slice(5)
        .map((s) => s.equityCents),
    ).not.toEqual(
      equalWeight(before)
        ?.slice(5)
        .map((s) => s.equityCents),
    );
  });

  it('um evento registrado depois entra na conta do zero, sem corrigir o que já foi publicado', () => {
    const withoutEvent = simulate({ ...market, events: [] }, cast);
    const withEvent = simulate(market, cast);
    const exIndex = market.sessions.findIndex((s) => s.date >= '2026-11-12');
    expect(exIndex).toBe(7);
    for (const [index, run] of withEvent.entries()) {
      // até a véspera da data ex, as duas contas são iguais
      expect(run.snapshots.slice(0, exIndex)).toEqual(
        withoutEvent[index]?.snapshots.slice(0, exIndex),
      );
    }
    // o igual-peso tem a ação desde o primeiro pregão: na data ex a quantidade dobra (no pregão em que a ação negocia)
    const quantity = (runs: CompetitorRun[], at: number) =>
      runs.find((r) => r.id === 'ew')?.snapshots[at]?.positions.find((p) => p.ticker === split)
        ?.quantity;
    const applyIndex = market.sessions.findIndex(
      (s) => s.date >= '2026-11-12' && s.bars.has(split),
    );
    expect(quantity(withoutEvent, applyIndex)).toBeGreaterThan(0n);
    expect(quantity(withEvent, applyIndex)).toBe((quantity(withoutEvent, applyIndex) ?? 0n) * 2n);
    expect(quantity(withEvent, 11)).toBe((quantity(withoutEvent, 11) ?? 0n) * 2n);
  });
});
