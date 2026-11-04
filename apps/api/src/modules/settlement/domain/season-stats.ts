import { divRound, safeNumber } from './money.js';
import type { MonteCarloResult } from './monte-carlo.js';
import type { CompetitorRun } from './simulation.js';

// Métricas da temporada (tabela season_stat; docs/METODOLOGIA.md). Tudo em pontos-base inteiros (1 bp = 0,01%) e
// arredondado uma vez só, ao mais próximo, com o meio indo para longe do zero.

export interface SeasonStat {
  id: string;
  // patrimônio final sobre o capital, menos 1
  returnBps: number;
  // percentil no Monte Carlo no último pregão (0 a 10.000); null sem Monte Carlo ou fora dele
  percentileBps: number | null;
  // (patrimônio final - o da referência) sobre o capital; null se o elenco não tem a referência
  excessEqualWeightBps: number | null;
  excessCdiBps: number | null;
  // maior queda desde um pico, positiva, tendo o capital inicial como primeiro pico
  maxDrawdownBps: number;
  // vendas executadas e as de resultado realizado positivo (resultado zero não é acerto)
  sells: number;
  winningSells: number;
  // acerto = vendas com lucro / vendas executadas; null sem venda
  winRateBps: number | null;
  // execuções (compras e vendas); ordem que não executou não conta
  trades: number;
}

export interface SeasonStatsInput {
  startingCashCents: bigint;
  runs: readonly CompetitorRun[];
  monteCarlo: MonteCarloResult | null;
}

export function seasonStats({
  startingCashCents,
  runs,
  monteCarlo,
}: SeasonStatsInput): SeasonStat[] {
  if (startingCashCents <= 0n) throw new RangeError('O capital inicial deve ser positivo');
  const bps = (cents: bigint) => safeNumber(divRound(cents * 10_000n, startingCashCents));
  const finalEquity = (run: CompetitorRun) =>
    run.snapshots.at(-1)?.equityCents ?? startingCashCents;
  const equalWeight = runs.find((r) => r.kind === 'EQUAL_WEIGHT');
  const cdi = runs.find((r) => r.kind === 'CDI');
  const lastDay = monteCarlo?.sessions.at(-1);

  return runs.map((run) => {
    const equity = finalEquity(run);

    let peak = startingCashCents;
    let maxDrawdownBps = 0;
    for (const { equityCents } of run.snapshots) {
      if (equityCents > peak) peak = equityCents;
      else
        maxDrawdownBps = Math.max(
          maxDrawdownBps,
          safeNumber(divRound((peak - equityCents) * 10_000n, peak)),
        );
    }

    const sells = run.fills.filter((f) => f.action === 'SELL');
    const winningSells = sells.filter((f) => (f.realizedCents ?? 0n) > 0n).length;

    return {
      id: run.id,
      returnBps: bps(equity - startingCashCents),
      percentileBps: lastDay?.percentileBps[run.id] ?? null,
      excessEqualWeightBps: equalWeight ? bps(equity - finalEquity(equalWeight)) : null,
      excessCdiBps: cdi ? bps(equity - finalEquity(cdi)) : null,
      maxDrawdownBps,
      sells: sells.length,
      winningSells,
      winRateBps:
        sells.length === 0
          ? null
          : safeNumber(divRound(BigInt(winningSells) * 10_000n, BigInt(sells.length))),
      trades: run.fills.length,
    };
  });
}
