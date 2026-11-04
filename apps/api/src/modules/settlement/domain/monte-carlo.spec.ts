import { describe, expect, it } from 'vitest';
import { PLAN_RULES } from './fixtures/rules.fixture.js';
import { syntheticMarket } from './fixtures/synthetic-market.fixture.js';
import {
  MONTE_CARLO_RUNS,
  PERCENTILES,
  monteCarlo,
  nearestRank,
  percentRankBps,
} from './monte-carlo.js';
import { divRound } from './money.js';
import { seasonStats } from './season-stats.js';
import {
  prepare,
  randomStep,
  simulatePortfolio,
  simulateSeason,
  type Competitor,
  type CompetitorRun,
} from './simulation.js';

// Monte Carlo (plano, 2): 1.000 carteiras aleatórias com as mesmas regras e a semente fixa da temporada. Devolve a
// distribuição do patrimônio e do retorno por pregão (percentis 5, 25, 50, 75 e 95) e o percentil de cada competidor.

const CAPITAL = 1_000_000n;
const ints = (n: number) => Array.from({ length: n }, (_, i) => BigInt(i + 1));

describe('nearestRank (percentil pelo método do posto mais próximo, sem interpolar)', () => {
  it('os percentis são 5, 25, 50, 75 e 95', () => {
    expect(PERCENTILES).toEqual([5, 25, 50, 75, 95]);
  });

  it('com 1.000 valores de 1 a 1.000, o percentil p é o valor de posto p x 10', () => {
    expect(PERCENTILES.map((p) => nearestRank(ints(1000), p))).toEqual([
      50n,
      250n,
      500n,
      750n,
      950n,
    ]);
  });

  it('o posto é o teto de p x N / 100 (o meio sobe)', () => {
    // N = 10: tetos de 0,5; 2,5; 5; 7,5; 9,5
    expect(PERCENTILES.map((p) => nearestRank(ints(10), p))).toEqual([1n, 3n, 5n, 8n, 10n]);
    // N = 7: tetos de 0,35; 1,75; 3,5; 5,25; 6,65
    expect(PERCENTILES.map((p) => nearestRank(ints(7), p))).toEqual([1n, 2n, 4n, 6n, 7n]);
  });

  it('um valor só é todos os percentis; lista vazia não tem percentil', () => {
    expect(PERCENTILES.map((p) => nearestRank([42n], p))).toEqual([42n, 42n, 42n, 42n, 42n]);
    expect(() => nearestRank([], 50)).toThrow(RangeError);
  });
});

describe('percentRankBps (percentil de um valor na distribuição)', () => {
  const sorted = [10n, 20n, 30n, 40n];

  it('é a parcela da distribuição abaixo do valor, mais metade dos empates, em pontos-base', () => {
    expect(percentRankBps(sorted, 25n)).toBe(5000); // 2 abaixo de 4
    expect(percentRankBps(sorted, 20n)).toBe(3750); // 1 abaixo + metade de 1 igual = 1,5 de 4
    expect(percentRankBps(sorted, 5n)).toBe(0);
    expect(percentRankBps(sorted, 45n)).toBe(10_000);
  });

  it('empate com todos fica no meio', () => {
    expect(percentRankBps([5n, 5n, 5n, 5n], 5n)).toBe(5000);
  });

  it('arredonda o meio para cima', () => {
    expect(percentRankBps([1n, 2n, 3n], 2n)).toBe(5000);
    expect(percentRankBps([1n, 2n, 3n], 1n)).toBe(1667); // 1/6 = 16,666...%
  });

  it('distribuição vazia não tem percentil', () => {
    expect(() => percentRankBps([], 1n)).toThrow(RangeError);
  });
});

describe('monteCarlo', () => {
  const market = syntheticMarket({ tickers: 40, sessions: 6 });
  const cast: Competitor[] = [
    { id: 'ew', kind: 'EQUAL_WEIGHT' },
    { id: 'cdi', kind: 'CDI' },
    { id: 'sorteio', kind: 'RANDOM', seed: 'temporada-1' },
  ];
  const runs = simulateSeason({
    market,
    startingCashCents: CAPITAL,
    rules: PLAN_RULES,
    competitors: cast,
  });
  const mc = (seed: string, count = 200, competitors: CompetitorRun[] = runs) =>
    monteCarlo({
      market,
      startingCashCents: CAPITAL,
      rules: PLAN_RULES,
      seed,
      runs: count,
      competitors,
    });

  it('são 1.000 carteiras por padrão', () => {
    expect(MONTE_CARLO_RUNS).toBe(1000);
    expect(
      monteCarlo({
        market,
        startingCashCents: CAPITAL,
        rules: PLAN_RULES,
        seed: 'x',
        competitors: [],
      }).runs,
    ).toBe(1000);
  });

  it('a mesma semente dá exatamente o mesmo resultado, até o último percentil de cada competidor', () => {
    expect(mc('semente-fixa')).toEqual(mc('semente-fixa'));
  });

  it('outra semente dá outro resultado', () => {
    const a = mc('semente-fixa');
    const b = mc('outra-semente');
    expect(a.seed).not.toBe(b.seed);
    expect(b.sessions.map((s) => s.equityCents)).not.toEqual(a.sessions.map((s) => s.equityCents));
    expect(b.sessions.map((s) => s.percentileBps)).not.toEqual(
      a.sessions.map((s) => s.percentileBps),
    );
  });

  it('uma entrada por pregão, com os percentis em ordem e o retorno ligado ao patrimônio', () => {
    const result = mc('semente-fixa');
    expect(result.runs).toBe(200);
    expect(result.sessions.map((s) => s.date)).toEqual(market.sessions.map((s) => s.date));
    for (const day of result.sessions) {
      const e = day.equityCents;
      expect(e.p5 <= e.p25 && e.p25 <= e.p50 && e.p50 <= e.p75 && e.p75 <= e.p95).toBe(true);
      const r = day.returnBps;
      expect(r.p5 <= r.p25 && r.p25 <= r.p50 && r.p50 <= r.p75 && r.p75 <= r.p95).toBe(true);
      for (const p of PERCENTILES) {
        const key = `p${p}` as const;
        expect(r[key]).toBe(Number(divRound((e[key] - CAPITAL) * 10_000n, CAPITAL)));
      }
    }
  });

  it('as carteiras são as da política aleatória "mc:0" a "mc:N-1", conferidas por fora', () => {
    const result = mc('semente-fixa', 25);
    const sessions = prepare(market);
    const equities = Array.from({ length: 25 }, (_, i) =>
      simulatePortfolio(
        sessions,
        CAPITAL,
        randomStep('semente-fixa', `mc:${i}`, PLAN_RULES),
      ).snapshots.map((s) => s.equityCents),
    );
    result.sessions.forEach((day, k) => {
      const sorted = equities.map((e) => e[k] ?? 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(day.equityCents.p5).toBe(nearestRank(sorted, 5));
      expect(day.equityCents.p50).toBe(nearestRank(sorted, 50));
      expect(day.equityCents.p95).toBe(nearestRank(sorted, 95));
    });
  });

  it('o percentil de cada competidor, em cada pregão, é o da sua posição na distribuição daquele pregão', () => {
    const result = mc('semente-fixa');
    const sessions = prepare(market);
    const equities = Array.from({ length: 200 }, (_, i) =>
      simulatePortfolio(
        sessions,
        CAPITAL,
        randomStep('semente-fixa', `mc:${i}`, PLAN_RULES),
      ).snapshots.map((s) => s.equityCents),
    );
    result.sessions.forEach((day, k) => {
      const sorted = equities.map((e) => e[k] ?? 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(Object.keys(day.percentileBps).sort()).toEqual(['cdi', 'ew', 'sorteio']);
      for (const run of runs) {
        expect(day.percentileBps[run.id]).toBe(
          percentRankBps(sorted, run.snapshots[k]?.equityCents ?? 0n),
        );
      }
    });
  });

  it('quem fica abaixo de todas as carteiras está no percentil 0, e acima de todas, no 100', () => {
    const fake = (id: string, equity: bigint): CompetitorRun => ({
      id,
      kind: 'MODEL',
      orders: [],
      fills: [],
      snapshots: market.sessions.map((s) => ({
        date: s.date,
        cashCents: equity,
        positionsValueCents: 0n,
        equityCents: equity,
        interestCents: 0n,
        cdiDate: null,
        positions: [],
      })),
    });
    const result = mc('semente-fixa', 100, [fake('quebrado', 1n), fake('milionario', 10n ** 15n)]);
    for (const day of result.sessions) {
      expect(day.percentileBps['quebrado']).toBe(0);
      expect(day.percentileBps['milionario']).toBe(10_000);
    }
  });

  it('o Sorteio não é uma das carteiras do Monte Carlo (a carteira dele é outra)', () => {
    // se fosse a "mc:0", o percentil dele coincidiria com o de uma carteira da distribuição em todos os pregões
    const sorteio = runs.find((r) => r.id === 'sorteio');
    const sessions = prepare(market);
    const mc0 = simulatePortfolio(sessions, CAPITAL, randomStep('temporada-1', 'mc:0', PLAN_RULES));
    expect(sorteio?.snapshots.map((s) => s.equityCents)).not.toEqual(
      mc0.snapshots.map((s) => s.equityCents),
    );
  });

  it('as regras da temporada mudam a distribuição e as sem sentido são recusadas', () => {
    const base = mc('semente-fixa');
    const costly = monteCarlo({
      market,
      startingCashCents: CAPITAL,
      rules: { tradeCostBps: 500n, maxPositions: 10 }, // 5% por operação
      seed: 'semente-fixa',
      runs: 200,
      competitors: [],
    });
    // as mesmas ordens com custo 5% sobre as carteiras: o patrimônio mediano do último pregão cai
    expect(
      (costly.sessions.at(-1)?.equityCents.p50 ?? 0n) <
        (base.sessions.at(-1)?.equityCents.p50 ?? 0n),
    ).toBe(true);
    expect(() =>
      monteCarlo({
        market,
        startingCashCents: CAPITAL,
        rules: { tradeCostBps: -1n, maxPositions: 10 },
        seed: 'x',
        runs: 10,
        competitors: [],
      }),
    ).toThrow(RangeError);
  });

  it('recusa número de carteiras sem sentido e capital sem sentido', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(() => mc('x', count)).toThrow(RangeError);
    }
    expect(() =>
      monteCarlo({
        market,
        startingCashCents: 0n,
        rules: PLAN_RULES,
        seed: 'x',
        runs: 10,
        competitors: [],
      }),
    ).toThrow(RangeError);
  });
});

describe('desempenho', () => {
  const CAPITAL_100K = 10_000_000n; // R$ 100.000,00
  const market = syntheticMarket({ tickers: 500, sessions: 20 });

  it('1.000 carteiras x 20 pregões x 500 ações rodam em poucos segundos', () => {
    const started = performance.now();
    const result = monteCarlo({
      market,
      startingCashCents: CAPITAL_100K,
      rules: PLAN_RULES,
      seed: 'temporada-1',
      competitors: [],
    });
    const seconds = (performance.now() - started) / 1000;
    console.info(`monteCarlo 1000 x 20 x 500: ${seconds.toFixed(2)} s`);
    expect(result.runs).toBe(1000);
    expect(result.sessions).toHaveLength(20);
    // as carteiras operam de verdade: a distribuição do último pregão tem largura
    const last = result.sessions[19];
    expect(last && last.equityCents.p5 < last.equityCents.p95).toBe(true);
    // poucos segundos: o teto tem folga de mais de 10 vezes sobre a medida (cerca de 0,25 s), para máquina de CI cheia
    // não derrubar o teste. A medida real vai no console
    expect(seconds).toBeLessThan(5);
  }, 60_000);

  it('a liquidação inteira (elenco com o igual-peso de 500 ações, Sorteio, Monte Carlo e métricas) cabe em poucos segundos', () => {
    const cast: Competitor[] = [
      { id: 'ew', kind: 'EQUAL_WEIGHT' },
      { id: 'cdi', kind: 'CDI' },
      { id: 'sorteio', kind: 'RANDOM', seed: 'temporada-1' },
    ];
    const started = performance.now();
    const runs = simulateSeason({
      market,
      startingCashCents: CAPITAL_100K,
      rules: PLAN_RULES,
      competitors: cast,
    });
    const mc = monteCarlo({
      market,
      startingCashCents: CAPITAL_100K,
      rules: PLAN_RULES,
      seed: 'temporada-1',
      competitors: runs,
    });
    const stats = seasonStats({ startingCashCents: CAPITAL_100K, runs, monteCarlo: mc });
    const seconds = (performance.now() - started) / 1000;
    console.info(`liquidação completa (3 competidores + Monte Carlo): ${seconds.toFixed(2)} s`);
    // o igual-peso comprou o universo inteiro, sem o limite de 10 posições
    expect(runs[0]?.snapshots[0]?.positions.length).toBeGreaterThan(400);
    expect(stats.map((s) => s.percentileBps !== null)).toEqual([true, true, true]);
    expect(seconds).toBeLessThan(5);
  }, 60_000);
});
