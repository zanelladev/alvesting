import type { IsoDate } from '../../market-data/domain/dates.js';
import { divRound, safeNumber } from './money.js';
import { assertRules, type SettlementRules } from './portfolio.js';
import {
  prepare,
  randomStep,
  simulatePortfolio,
  type CompetitorRun,
  type Market,
} from './simulation.js';

// Monte Carlo (plano, 2; docs/METODOLOGIA.md): 1.000 carteiras da política aleatória, com as mesmas regras e custos dos
// modelos (é a mesma rotina de execução, simulatePortfolio) e a semente fixa da temporada. Carteira i usa a chave
// "mc:i", então nenhuma repete a do Sorteio. A mesma semente dá exatamente o mesmo resultado.

export const MONTE_CARLO_RUNS = 1000;
export const PERCENTILES = [5, 25, 50, 75, 95] as const;
export type Percentile = (typeof PERCENTILES)[number];
export type PercentileSet<T> = Record<`p${Percentile}`, T>;

export interface MonteCarloSession {
  date: IsoDate;
  // patrimônio de fechamento das carteiras aleatórias, nos percentis 5, 25, 50, 75 e 95
  equityCents: PercentileSet<bigint>;
  // o mesmo, como retorno sobre o capital, em pontos-base
  returnBps: PercentileSet<number>;
  // percentil de cada competidor nesse pregão, em pontos-base (0 a 10.000), por id
  percentileBps: Record<string, number>;
}

export interface MonteCarloResult {
  seed: string;
  runs: number;
  sessions: MonteCarloSession[];
}

// Percentil pelo posto mais próximo, sem interpolar: o valor de posto ceil(p x N / 100) da lista ordenada. É sempre
// o patrimônio de uma carteira de verdade. Com N = 1.000, p5 é o 50º menor valor.
export function nearestRank(sortedAscending: readonly bigint[], p: number): bigint {
  const n = sortedAscending.length;
  if (n === 0) throw new RangeError('Distribuição vazia');
  const rank = Math.floor((p * n + 99) / 100);
  return sortedAscending[Math.max(1, rank) - 1] as bigint;
}

// O percentil de um valor na distribuição: quantas carteiras ficaram abaixo dele, mais metade das empatadas, sobre
// o total. Em pontos-base, arredondado ao mais próximo. 10.000 = acima de todas; 0 = abaixo de todas.
export function percentRankBps(sortedAscending: readonly bigint[], value: bigint): number {
  const n = sortedAscending.length;
  if (n === 0) throw new RangeError('Distribuição vazia');
  // ponytail: contagem linear (1.000 valores, ~10 competidores, 20 pregões); busca binária se N passar de 100 mil.
  let below = 0;
  let equal = 0;
  for (const other of sortedAscending) {
    if (other < value) below += 1;
    else if (other === value) equal += 1;
    else break;
  }
  return safeNumber(divRound(BigInt(2 * below + equal) * 10_000n, BigInt(2 * n)));
}

const ascending = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);
const forEachPercentile = <T>(f: (p: Percentile) => T): PercentileSet<T> => ({
  p5: f(5),
  p25: f(25),
  p50: f(50),
  p75: f(75),
  p95: f(95),
});

export interface MonteCarloInput {
  market: Market;
  startingCashCents: bigint;
  // as mesmas regras com que os competidores foram simulados
  rules: SettlementRules;
  // a semente fixa da temporada
  seed: string;
  runs?: number;
  // os competidores já simulados (simulateSeason): recebem o percentil em cada pregão
  competitors: readonly CompetitorRun[];
}

export function monteCarlo({
  market,
  startingCashCents,
  rules,
  seed,
  runs = MONTE_CARLO_RUNS,
  competitors,
}: MonteCarloInput): MonteCarloResult {
  if (!Number.isInteger(runs) || runs < 1)
    throw new RangeError(`${runs} carteiras não faz sentido`);
  if (startingCashCents <= 0n) throw new RangeError('O capital inicial deve ser positivo');
  assertRules(rules);

  const sessions = prepare(market);
  const equities: bigint[][] = sessions.map(() => []);
  // ponytail: CPU síncrona, sem ceder o event loop, dentro da transação da liquidação (120 s, SettlementRepository.locked) e no
  // processo do worker-data, que também renova as travas das filas. Medido num Mac arm64: 1.000 carteiras x 20 pregões x 500
  // ações levam 0,23 s; o teto do contrato (10.000 carteiras x 60 pregões) leva uns 6 s, e no worker de 0,5 vCPU será várias
  // vezes isso (estimado, não medido). Se uma temporada passar de uns 100 s, ceder o event loop a cada lote de carteiras (com
  // await setImmediate, o que torna esta função async) ou mover o Monte Carlo para um worker thread.
  // ponytail: cada carteira monta ordens, execuções e linhas de posição que o Monte Carlo descarta (só o patrimônio
  // importa). Com 1.000 x 20 x 500 isso leva uma fração de segundo; se pesar, um modo enxuto de simulatePortfolio.
  for (let i = 0; i < runs; i += 1) {
    const { snapshots } = simulatePortfolio(
      sessions,
      startingCashCents,
      randomStep(seed, `mc:${i}`, rules),
    );
    snapshots.forEach((snapshot, k) => equities[k]?.push(snapshot.equityCents));
  }

  return {
    seed,
    runs,
    sessions: sessions.map((session, k) => {
      const sorted = (equities[k] ?? []).sort(ascending);
      const equityCents = forEachPercentile((p) => nearestRank(sorted, p));
      const percentileBps: Record<string, number> = {};
      for (const competitor of competitors) {
        const snapshot = competitor.snapshots[k];
        if (snapshot) percentileBps[competitor.id] = percentRankBps(sorted, snapshot.equityCents);
      }
      return {
        date: session.date,
        equityCents,
        returnBps: forEachPercentile((p) =>
          safeNumber(
            divRound((equityCents[`p${p}`] - startingCashCents) * 10_000n, startingCashCents),
          ),
        ),
        percentileBps,
      };
    }),
  };
}
