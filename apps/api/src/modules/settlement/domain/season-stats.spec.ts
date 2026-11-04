import { describe, expect, it } from 'vitest';
import type { MonteCarloResult } from './monte-carlo.js';
import type { Fill } from './portfolio.js';
import { seasonStats } from './season-stats.js';
import type { CompetitorRun, Snapshot } from './simulation.js';

// Métricas da temporada (season_stat), cada uma definida e conferida à mão (docs/METODOLOGIA.md). A planilha de
// 5 pregões (hand-checked.spec.ts) confere as métricas de ponta a ponta; aqui ficam as bordas de cada definição.

const CAPITAL = 1_000_000n;
const DATES = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09'];

const snapshot = (equity: number, index: number): Snapshot => ({
  date: DATES[index] ?? '2026-12-31',
  cashCents: BigInt(equity),
  positionsValueCents: 0n,
  equityCents: BigInt(equity),
  interestCents: 0n,
  cdiDate: null,
  positions: [],
});
const sellFill = (realized: number): Fill => ({
  date: '2026-11-04',
  itemIndex: 0,
  ticker: 'AAA3',
  action: 'SELL',
  quantity: 1n,
  priceCents: 100n,
  notionalCents: 100n,
  costCents: 0n,
  realizedCents: BigInt(realized),
});
const buyFill = (): Fill => ({ ...sellFill(0), action: 'BUY', realizedCents: null });
const run = (
  id: string,
  kind: CompetitorRun['kind'],
  equities: number[],
  fills: Fill[] = [],
): CompetitorRun => ({ id, kind, orders: [], fills, snapshots: equities.map(snapshot) });
const stat = (
  target: CompetitorRun,
  others: CompetitorRun[] = [],
  mc: MonteCarloResult | null = null,
) => {
  const found = seasonStats({
    startingCashCents: CAPITAL,
    runs: [target, ...others],
    monteCarlo: mc,
  }).find((s) => s.id === target.id);
  if (!found) throw new Error('competidor sem métricas');
  return found;
};

describe('retorno e excessos (em pontos-base, o meio vai para longe do zero)', () => {
  it('retorno = patrimônio final sobre o capital, menos 1', () => {
    expect(stat(run('a', 'MODEL', [1_000_000, 1_012_500])).returnBps).toBe(125); // +1,25%
    expect(stat(run('a', 'MODEL', [1_000_000, 980_000])).returnBps).toBe(-200);
  });

  it.each([
    [1_000_049, 0], // 0,49 bps
    [1_000_050, 1], // 0,50: sobe
    [999_950, -1], // -0,50: desce (para longe do zero)
    [999_951, 0], // -0,49
  ])('patrimônio final %s dá retorno de %s bps', (final, bps) => {
    expect(stat(run('a', 'MODEL', [final])).returnBps).toBe(bps);
  });

  it('excesso é a diferença dos patrimônios finais sobre o capital, arredondada uma vez só', () => {
    const model = run('m', 'MODEL', [1_000_000, 1_000_050]);
    const ew = run('ew', 'EQUAL_WEIGHT', [1_000_000, 1_000_100]);
    const cdi = run('cdi', 'CDI', [1_000_000, 1_000_001]);
    const found = stat(model, [ew, cdi]);
    // (1.000.050 - 1.000.100) / 1.000.000 = -0,5 bps -> -1; (1.000.050 - 1.000.001) -> 0,49 -> 0
    expect(found.excessEqualWeightBps).toBe(-1);
    expect(found.excessCdiBps).toBe(0);
    // cada retorno arredondado dá 1 - 1 = 0 (0,5 -> 1 e 1,0 -> 1): o excesso não é a diferença dos arredondados
    expect(found.returnBps - stat(ew, [model]).returnBps).toBe(0);
  });

  it('sem referência no elenco, o excesso não existe (null), não zero', () => {
    const found = stat(run('m', 'MODEL', [1_000_000, 1_010_000]));
    expect(found.excessEqualWeightBps).toBeNull();
    expect(found.excessCdiBps).toBeNull();
  });

  it('a referência tem excesso zero sobre ela mesma', () => {
    const ew = run('ew', 'EQUAL_WEIGHT', [1_000_000, 1_020_000]);
    expect(stat(ew).excessEqualWeightBps).toBe(0);
  });
});

describe('drawdown máximo', () => {
  it('queda desde o maior patrimônio até o fundo seguinte, em pontos-base positivos', () => {
    // pico 1.200.000, fundo seguinte 1.050.000: 150.000 / 1.200.000 = 12,5%
    const found = stat(run('a', 'MODEL', [1_100_000, 990_000, 1_200_000, 1_080_000, 1_050_000]));
    expect(found.maxDrawdownBps).toBe(1250);
  });

  it('o capital inicial conta como o primeiro pico: queda logo no primeiro pregão é drawdown', () => {
    expect(stat(run('a', 'MODEL', [900_000, 950_000])).maxDrawdownBps).toBe(1000);
  });

  it('patrimônio que só sobe tem drawdown zero', () => {
    expect(stat(run('a', 'MODEL', [1_000_100, 1_000_200, 1_000_300])).maxDrawdownBps).toBe(0);
  });

  it('o pico não volta atrás: queda depois de recuperar conta do novo pico', () => {
    // 1.000.000 -> 800.000 (20%), recupera a 1.500.000, cai a 1.350.000 (10%): vale o maior, 20%
    expect(stat(run('a', 'MODEL', [800_000, 1_500_000, 1_350_000])).maxDrawdownBps).toBe(2000);
  });
});

describe('acerto e operações', () => {
  it('acerto = vendas com resultado realizado positivo sobre as vendas executadas', () => {
    const found = stat(
      run(
        'a',
        'MODEL',
        [1_000_000],
        [buyFill(), sellFill(500), sellFill(-300), sellFill(700), buyFill()],
      ),
    );
    expect(found).toMatchObject({ sells: 3, winningSells: 2, winRateBps: 6667 }); // 2/3 = 66,67%
  });

  it('resultado zero não é acerto', () => {
    const found = stat(run('a', 'MODEL', [1_000_000], [sellFill(0), sellFill(5)]));
    expect(found).toMatchObject({ sells: 2, winningSells: 1, winRateBps: 5000 });
  });

  it('sem venda executada não há taxa de acerto (null), só compras não acertam nem erram', () => {
    const found = stat(run('a', 'MODEL', [1_000_000], [buyFill(), buyFill()]));
    expect(found).toMatchObject({ sells: 0, winningSells: 0, winRateBps: null });
  });

  it('número de operações = execuções (compras e vendas); ordem que não executou não conta', () => {
    const found = stat(run('a', 'MODEL', [1_000_000], [buyFill(), sellFill(1), buyFill()]));
    expect(found.trades).toBe(3);
    expect(stat(run('b', 'MODEL', [1_000_000])).trades).toBe(0);
  });
});

describe('percentil no Monte Carlo', () => {
  const mc = (percentileBps: Record<string, number>): MonteCarloResult => {
    const set = { p5: 0n, p25: 0n, p50: 0n, p75: 0n, p95: 0n };
    const ret = { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 };
    return {
      seed: 's',
      runs: 1000,
      sessions: [
        { date: DATES[0] ?? '', equityCents: set, returnBps: ret, percentileBps: { a: 1 } },
        { date: DATES[1] ?? '', equityCents: set, returnBps: ret, percentileBps },
      ],
    };
  };

  it('é o do último pregão simulado', () => {
    expect(stat(run('a', 'MODEL', [1_000_000, 1_010_000]), [], mc({ a: 9650 })).percentileBps).toBe(
      9650,
    );
  });

  it('sem Monte Carlo, ou competidor fora dele, é null', () => {
    expect(stat(run('a', 'MODEL', [1_000_000])).percentileBps).toBeNull();
    expect(stat(run('b', 'MODEL', [1_000_000]), [], mc({ a: 5000 })).percentileBps).toBeNull();
  });
});

describe('seasonStats', () => {
  it('devolve uma linha por competidor, na ordem do elenco', () => {
    const runs = [run('z', 'MODEL', [1_000_000]), run('a', 'CDI', [1_000_000])];
    expect(
      seasonStats({ startingCashCents: CAPITAL, runs, monteCarlo: null }).map((s) => s.id),
    ).toEqual(['z', 'a']);
  });

  it('capital sem sentido é erro', () => {
    expect(() => seasonStats({ startingCashCents: 0n, runs: [], monteCarlo: null })).toThrow(
      RangeError,
    );
  });
});
