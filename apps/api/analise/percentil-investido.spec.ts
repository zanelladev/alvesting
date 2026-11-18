import { describe, expect, it } from 'vitest';
import { PLAN_RULES } from '../src/modules/settlement/domain/fixtures/rules.fixture.js';
import { syntheticMarket } from '../src/modules/settlement/domain/fixtures/synthetic-market.fixture.js';
import { monteCarlo, percentRankBps } from '../src/modules/settlement/domain/monte-carlo.js';
import {
  executeSession,
  type Bar,
  type Portfolio,
  type SessionInput,
} from '../src/modules/settlement/domain/portfolio.js';
import {
  prepare,
  randomStep,
  simulatePortfolio,
  simulateSeason,
} from '../src/modules/settlement/domain/simulation.js';
import {
  distribution,
  executeWithSwaps,
  exposureAtOpen,
  exposureStep,
  finalEquities,
  matchExposure,
  swapStep,
} from './percentil-investido.js';

// As variantes da análise do percentil (percentil-investido.ts). As contas em centavos foram feitas à mão; o custo é 0,03%, no
// centavo mais próximo, com o meio subindo (docs/METODOLOGIA.md, "Custo e arredondamento").

const bars = (entries: Record<string, number>): Map<string, Bar> =>
  new Map(
    Object.entries(entries).map(([ticker, open]) => [
      ticker,
      { openCents: BigInt(open), closeCents: BigInt(open) },
    ]),
  );
const position = (quantity: number, costCents: number, markCents: number) => ({
  quantity: BigInt(quantity),
  costCents: BigInt(costCents),
  markCents: BigInt(markCents),
});
// caixa de R$ 1.000,00, 10 AAA3 a R$ 10,00 e 20 BBB4 a R$ 5,00: patrimônio de 120.000 centavos na abertura
const full: Portfolio = {
  cashCents: 100_000n,
  positions: new Map([
    ['AAA3', position(10, 10_000, 1_000)],
    ['BBB4', position(20, 10_000, 500)],
  ]),
};

describe('executeWithSwaps (variante A: a compra que o teto recusaria vende antes uma posição sorteada)', () => {
  const input: SessionInput = {
    date: '2026-11-03',
    rules: { tradeCostBps: 3n, maxPositions: 2 },
    portfolio: full,
    bars: bars({ AAA3: 1_000, BBB4: 500, CCC3: 2_000 }),
    items: [{ ticker: 'CCC3', action: 'BUY', percent_of_equity: 10, rationale: 'sorteio' }],
  };

  it('na produção, a carteira cheia recusa a compra de ação nova', () => {
    const result = executeSession(input);
    expect(result.orders.map((o) => o.reason)).toEqual(['max_positions']);
    expect(result.portfolio).toEqual(full);
  });

  it('com a troca, vende a posição sorteada inteira e a compra executa', () => {
    const offered: string[][] = [];
    const result = executeWithSwaps(input, (_n, free) => {
      offered.push([...free]);
      return free[0] as string;
    });
    expect(offered).toEqual([['AAA3', 'BBB4']]);
    // SELL 10 AAA3 a 1.000: 10.000 - 3 de custo; caixa 109.997. BUY CCC3 10% de 120.000 = 12.000 ÷ 2.000 = 6 ações: 12.000 + 3,6 -> 4
    expect(result.orders.map((o) => [o.action, o.ticker, o.status])).toEqual([
      ['SELL', 'AAA3', 'FILLED'],
      ['BUY', 'CCC3', 'FILLED'],
    ]);
    expect(result.portfolio.cashCents).toBe(97_993n);
    expect([...result.portfolio.positions]).toEqual([
      ['BBB4', position(20, 10_000, 500)],
      ['CCC3', position(6, 12_004, 2_000)],
    ]);
  });

  it('a posição vendida não é uma que já tem ordem no pregão nem uma sem barra', () => {
    const offered: string[][] = [];
    executeWithSwaps(
      {
        ...input,
        portfolio: {
          ...full,
          positions: new Map([...full.positions, ['DDD3', position(1, 1_000, 1_000)]]),
        },
        rules: { tradeCostBps: 3n, maxPositions: 3 },
        items: [
          { ticker: 'AAA3', action: 'SELL', percent_of_position: 10, rationale: 'sorteio' },
          ...input.items,
        ],
      },
      (_n, free) => {
        offered.push([...free]);
        return free[0] as string;
      },
    );
    expect(offered).toEqual([['BBB4']]); // AAA3 já tem ordem; DDD3 não tem barra
  });

  it('não troca para comprar ação sem barra, nem com as 5 ordens do pregão usadas', () => {
    const never = () => {
      throw new Error('não devia trocar');
    };
    const noBar = {
      ...input,
      items: [
        { ticker: 'EEE3', action: 'BUY' as const, percent_of_equity: 10, rationale: 'sorteio' },
      ],
    };
    expect(executeWithSwaps(noBar, never)).toEqual(executeSession(noBar));
    const busy = {
      ...input,
      bars: bars({ AAA3: 1_000, BBB4: 500, CCC3: 2_000, FFF3: 100, GGG3: 100 }),
      items: [
        { ticker: 'AAA3', action: 'SELL' as const, percent_of_position: 10, rationale: 'sorteio' },
        { ticker: 'BBB4', action: 'SELL' as const, percent_of_position: 10, rationale: 'sorteio' },
        { ticker: 'CCC3', action: 'BUY' as const, percent_of_equity: 5, rationale: 'sorteio' },
        { ticker: 'FFF3', action: 'BUY' as const, percent_of_equity: 5, rationale: 'sorteio' },
        { ticker: 'GGG3', action: 'BUY' as const, percent_of_equity: 5, rationale: 'sorteio' },
      ],
    };
    expect(executeWithSwaps(busy, never)).toEqual(executeSession(busy));
  });
});

describe('matchExposure (variante B: a fração investida do modelo, todas as posições na mesma proporção)', () => {
  // caixa 50.000, 10 AAA3 a 1.000 e 20 BBB4 a 500: patrimônio de 70.000, 20.000 em ações
  const portfolio: Portfolio = { ...full, cashCents: 50_000n };
  const open = bars({ AAA3: 1_000, BBB4: 500 });

  it('sobe para 50%: compra ação inteira de cada posição, para baixo, pagando o custo', () => {
    // alvo 35.000 em ações: AAA3 10 x 35.000 ÷ 20.000 = 17,5 -> 17 (+7 = 7.000 + 2,1 -> 2); BBB4 35 (+15 = 7.500 + 2,25 -> 2)
    const result = matchExposure(portfolio, open, { num: 1n, den: 2n }, 3n);
    expect(result.cashCents).toBe(35_496n);
    expect([...result.positions]).toEqual([
      ['AAA3', position(17, 17_002, 1_000)],
      ['BBB4', position(35, 17_502, 500)],
    ]);
  });

  it('desce para 1/7: vende cada posição na mesma proporção, com o custo médio', () => {
    // alvo 10.000: AAA3 5 (vende 5 = 5.000 - 1,5 -> 2; custo 5.000), BBB4 10 (vende 10 = 5.000 - 2; custo 5.000)
    const result = matchExposure(portfolio, open, { num: 1n, den: 7n }, 3n);
    expect(result.cashCents).toBe(59_996n);
    expect([...result.positions]).toEqual([
      ['AAA3', position(5, 5_000, 1_000)],
      ['BBB4', position(10, 5_000, 500)],
    ]);
  });

  it('a posição sem barra fica parada e conta pelo último fechamento; sem posição que negocie, nada muda', () => {
    // + 5 CCC3 sem barra, marcadas a 2.000: patrimônio 80.000, alvo 40.000, fixo 10.000; AAA3 e BBB4 vão a 30.000 (x 1,5)
    const withStale: Portfolio = {
      cashCents: 50_000n,
      positions: new Map([...full.positions, ['CCC3', position(5, 5_000, 2_000)]]),
    };
    const result = matchExposure(withStale, open, { num: 1n, den: 2n }, 3n);
    expect(result.cashCents).toBe(39_996n);
    expect([...result.positions].map(([ticker, p]) => [ticker, p.quantity])).toEqual([
      ['AAA3', 15n],
      ['BBB4', 30n],
      ['CCC3', 5n],
    ]);
    expect(matchExposure(withStale, new Map(), { num: 1n, den: 2n }, 3n)).toBe(withStale);
  });
});

describe('exposureAtOpen (a fração do modelo na abertura, depois das ordens dele)', () => {
  it('as posições do snapshot pela abertura do pregão (sem barra: pelo último fechamento), sobre elas mais o caixa', () => {
    const [session] = prepare({
      sessions: [{ date: '2026-11-03', bars: bars({ AAA3: 1_000 }), universe: ['AAA3'] }],
      cdi: [],
      events: [],
    });
    const fraction = exposureAtOpen(
      [session!],
      [
        {
          date: '2026-11-03',
          cashCents: 50_000n,
          positionsValueCents: 0n,
          equityCents: 0n,
          interestCents: 0n,
          cdiDate: null,
          positions: [
            {
              ticker: 'AAA3',
              quantity: 10n,
              costCents: 0n,
              markCents: 1_100n,
              valueCents: 0n,
              stale: false,
            },
            {
              ticker: 'BBB4',
              quantity: 20n,
              costCents: 0n,
              markCents: 400n,
              valueCents: 0n,
              stale: true,
            },
          ],
        },
      ],
    );
    expect(fraction.get('2026-11-03')).toEqual({ num: 18_000n, den: 68_000n });
  });
});

describe('as variantes no mercado sintético', () => {
  const market = syntheticMarket({ tickers: 300, sessions: 20 });
  const sessions = prepare(market);
  const capital = 10_000_000n;
  const seed = 'semente-mc';

  it('o laço das variantes, com a política da produção, refaz o percentil do monteCarlo()', () => {
    const competitors = simulateSeason({
      market,
      startingCashCents: capital,
      rules: PLAN_RULES,
      competitors: [
        { id: 'sorteio', kind: 'RANDOM', seed: 'outra' },
        { id: 'igual', kind: 'EQUAL_WEIGHT' },
        { id: 'cdi', kind: 'CDI' },
      ],
    });
    const mc = monteCarlo({
      market,
      startingCashCents: capital,
      rules: PLAN_RULES,
      seed,
      runs: 200,
      competitors,
    });
    const base = distribution(sessions, capital, 200, (key) => randomStep(seed, key, PLAN_RULES));
    for (const run of competitors) {
      expect(percentRankBps(finalEquities(base), run.snapshots.at(-1)!.equityCents)).toBe(
        mc.sessions.at(-1)!.percentileBps[run.id],
      );
    }
  });

  it('a troca deixa a carteira mais investida', () => {
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const base = distribution(sessions, capital, 100, (key) => randomStep(seed, key, PLAN_RULES));
    const swap = distribution(sessions, capital, 100, (key) => swapStep(seed, key, PLAN_RULES));
    expect(mean(swap.investedBps.at(-1)!)).toBeGreaterThan(mean(base.investedBps.at(-1)!) + 1_000);
  });

  it('a exposição do modelo leva cada carteira à fração dele na abertura, pregão a pregão', () => {
    const [model] = simulateSeason({
      market,
      startingCashCents: capital,
      rules: PLAN_RULES,
      competitors: [{ id: 'modelo', kind: 'RANDOM', seed: 'outra' }],
    });
    const targets = exposureAtOpen(sessions, model!.snapshots);
    const ratio = ({ num, den }: { num: bigint; den: bigint }) => Number((num * 10_000n) / den);
    let compared = 0;
    for (let i = 0; i < 20; i += 1) {
      const { snapshots } = simulatePortfolio(
        sessions,
        capital,
        exposureStep(seed, `mc:${i}`, PLAN_RULES, targets),
      );
      const own = exposureAtOpen(sessions, snapshots);
      snapshots.forEach((s) => {
        // sem posição que negocie no pregão, a carteira não tem como seguir
        if (s.positions.every((p) => p.stale)) return;
        compared += 1;
        // só a ação inteira e o custo separam as duas frações
        expect(Math.abs(ratio(own.get(s.date)!) - ratio(targets.get(s.date)!))).toBeLessThan(100);
      });
    }
    expect(compared).toBeGreaterThan(300);
  });
});
