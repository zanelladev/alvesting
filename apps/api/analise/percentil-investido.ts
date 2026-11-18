import pg from 'pg';
import {
  MAX_ORDERS_PER_CYCLE,
  seasonParamsSchema,
  type DecisionItem,
  type SeasonParams,
} from '@alvesting/contracts';
import { isoWeek, type IsoDate } from '../src/modules/market-data/domain/dates.js';
import { loadTradingCalendar } from '../src/modules/market-data/domain/trading-calendar.js';
import { MACRO_SERIES } from '../src/modules/news/domain/bcb.js';
import { buildPlan } from '../src/modules/settlement/application/settlement-plan.js';
import type { CorporateEvent } from '../src/modules/settlement/domain/corporate-events.js';
import { divRound, maxShares, tradeCost } from '../src/modules/settlement/domain/money.js';
import {
  monteCarlo,
  nearestRank,
  percentRankBps,
  type MonteCarloResult,
} from '../src/modules/settlement/domain/monte-carlo.js';
import {
  equityAtOpen,
  executeSession,
  type Bar,
  type Portfolio,
  type SessionInput,
  type SessionResult,
  type SettlementRules,
} from '../src/modules/settlement/domain/portfolio.js';
import { draw, randomDecisions } from '../src/modules/settlement/domain/random-policy.js';
import {
  prepare,
  randomStep,
  simulatePortfolio,
  simulateSeason,
  type Competitor,
  type CompetitorRun,
  type Market,
  type PreparedSession,
  type Snapshot,
  type Step,
} from '../src/modules/settlement/domain/simulation.js';
import type {
  BarRow,
  DecisionItemRow,
  SettlementCompetitor,
} from '../src/modules/settlement/infrastructure/settlement.repository.js';

// Análise, fora da produção: quanto o percentil de cada modelo no Monte Carlo (docs/METODOLOGIA.md, "Monte Carlo") mudaria se as
// carteiras aleatórias continuassem investidas. A política de produção enche as 10 posições e depois quase só vende (a compra
// sorteada é quase sempre de ação nova e o teto a recusa; a venda tira de 1% a 100% e quase nunca zera), e a carteira vira caixa
// (METODOLOGIA, "Limitações declaradas", "Carteiras aleatórias"). Reaproveita o domínio da liquidação sem mudar nada nele: o
// mercado sai de buildPlan, os competidores de simulateSeason, o método da produção é monteCarlo(), e as variantes trocam só a
// política de cada carteira (o Step) dentro do mesmo simulatePortfolio e do mesmo executeSession.

// Variante A, a troca: a compra que o teto de posições recusaria vende antes, por inteiro, uma posição sorteada. As outras regras
// são as da produção (5 ordens por pregão, caixa, ação inteira, barra, custo): a troca gasta uma das 5 ordens, e sem ordem livre
// a compra é recusada como antes. Só troca a compra de ação com barra no pregão (sem barra, ela cairia depois da venda), e a
// posição vendida sai das que a carteira tinha ao começar o pregão, têm barra e ainda não têm ordem nele, em ordem alfabética,
// pelo sorteio `pick`. Cada troca refaz o pregão do começo, porque a venda muda o caixa das compras.
export function executeWithSwaps(
  input: SessionInput,
  pick: (n: number, free: readonly string[]) => string,
): SessionResult {
  let items = [...input.items];
  let result = executeSession(input);
  for (let n = 0; items.length < MAX_ORDERS_PER_CYCLE; n += 1) {
    const capped = result.orders.some(
      (order) => order.reason === 'max_positions' && input.bars.has(order.ticker),
    );
    if (!capped) break;
    const used = new Set(items.map((item) => item.ticker));
    const free = [...input.portfolio.positions.keys()]
      .filter((ticker) => !used.has(ticker) && input.bars.has(ticker))
      .sort();
    if (free.length === 0) break;
    const sell: DecisionItem = {
      ticker: pick(n, free),
      action: 'SELL',
      percent_of_position: 100,
      rationale: 'troca',
    };
    items = [sell, ...items];
    result = executeSession({ ...input, items });
  }
  return result;
}

// A política da produção (as mesmas ordens sorteadas, a mesma semente e a mesma chave) com a troca. O sorteio da posição vendida
// é o SHA-256 da política (draw), com a chave `${carteira}:troca`, então nenhum sorteio da produção muda: a carteira só se afasta
// da de produção no pregão em que uma compra bate no teto.
export const swapStep =
  (seed: string, portfolioKey: string, rules: SettlementRules): Step =>
  (session, portfolio) =>
    executeWithSwaps(
      {
        date: session.date,
        rules,
        portfolio,
        bars: session.bars,
        items: randomDecisions({
          seed,
          date: session.date,
          portfolio: portfolioKey,
          held: [...portfolio.positions.keys()],
          universe: session.universe,
        }),
      },
      (n, free) =>
        free[draw(seed, session.date, `${portfolioKey}:troca`, n) % free.length] as string,
    );

// Uma fração exata (sem float): o valor em ações sobre o patrimônio.
export interface Fraction {
  num: bigint;
  den: bigint;
}

// A fração investida de um competidor na abertura de cada pregão, depois das ordens dele: as posições do snapshot (as ordens já
// executaram e nada muda até o fechamento) pela abertura do pregão (sem barra: pelo último fechamento), sobre elas mais o caixa.
export function exposureAtOpen(
  sessions: readonly PreparedSession[],
  snapshots: readonly Snapshot[],
): Map<IsoDate, Fraction> {
  const result = new Map<IsoDate, Fraction>();
  snapshots.forEach((snapshot, k) => {
    const bars = sessions[k]?.bars;
    let invested = 0n;
    for (const p of snapshot.positions)
      invested += p.quantity * (bars?.get(p.ticker)?.openCents ?? p.markCents);
    result.set(snapshot.date, { num: invested, den: invested + snapshot.cashCents });
  });
  return result;
}

// Variante B, a exposição do modelo: depois das ordens sorteadas, a carteira põe em ações a fração do patrimônio que o modelo tinha
// na mesma abertura, comprando ou vendendo todas as posições na mesma proporção (a composição é a do sorteio; o tamanho, o do
// modelo). Ação inteira, para baixo, pela abertura e com o custo da temporada; a compra cabe no caixa. A posição sem barra no
// pregão não negocia e conta pelo último fechamento. Sem posição que negocie, a carteira fica como está. O ajuste não passa pelas
// regras de ordem (5 por pregão, 5% a 25%): é um controle de exposição, não uma decisão.
export function matchExposure(
  portfolio: Portfolio,
  bars: ReadonlyMap<string, Bar>,
  target: Fraction,
  costBps: bigint,
): Portfolio {
  let tradable = 0n;
  let fixed = 0n;
  for (const [ticker, position] of portfolio.positions) {
    const open = bars.get(ticker)?.openCents;
    if (open === undefined) fixed += position.quantity * position.markCents;
    else tradable += position.quantity * open;
  }
  if (tradable === 0n || target.den <= 0n) return portfolio;
  const goal = (equityAtOpen(portfolio, bars) * target.num) / target.den - fixed;
  const wanted = goal > 0n ? goal : 0n;

  let cash = portfolio.cashCents;
  const positions = new Map(portfolio.positions);
  const moves = [...portfolio.positions].flatMap(([ticker, position]) => {
    const open = bars.get(ticker)?.openCents;
    if (open === undefined) return [];
    return [{ ticker, position, open, quantity: (position.quantity * wanted) / tradable }];
  });
  // as vendas antes, para o caixa delas pagar as compras
  for (const { ticker, position, open, quantity } of moves) {
    if (quantity >= position.quantity) continue;
    const sold = position.quantity - quantity;
    const notional = sold * open;
    cash += notional - tradeCost(notional, costBps);
    if (quantity === 0n) positions.delete(ticker);
    else {
      const basis = divRound(position.costCents * sold, position.quantity);
      positions.set(ticker, { ...position, quantity, costCents: position.costCents - basis });
    }
  }
  for (const { ticker, position, open, quantity } of moves) {
    if (quantity <= position.quantity) continue;
    const affordable = maxShares(cash, open, costBps);
    const want = quantity - position.quantity;
    const bought = want < affordable ? want : affordable;
    if (bought < 1n) continue;
    const notional = bought * open;
    const cost = tradeCost(notional, costBps);
    cash -= notional + cost;
    positions.set(ticker, {
      quantity: position.quantity + bought,
      costCents: position.costCents + notional + cost,
      markCents: open,
    });
  }
  return { cashCents: cash, positions };
}

export const exposureStep =
  (
    seed: string,
    portfolioKey: string,
    rules: SettlementRules,
    targets: ReadonlyMap<IsoDate, Fraction>,
  ): Step =>
  (session, portfolio) => {
    const result = randomStep(seed, portfolioKey, rules)(session, portfolio);
    const target = targets.get(session.date);
    if (!target) return result;
    return {
      ...result,
      portfolio: matchExposure(result.portfolio, session.bars, target, rules.tradeCostBps),
    };
  };

// N carteiras com a política `step(i)`, pela mesma rotina do Monte Carlo da produção (simulatePortfolio, chave "mc:i"). Por
// pregão, em ordem crescente: o patrimônio de fechamento de cada carteira e a fração dele em ações, em pontos-base.
export interface Distribution {
  sortedEquityCents: bigint[][];
  investedBps: number[][];
}

const ascending = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);
const bps = (num: bigint, den: bigint): number =>
  den === 0n ? 0 : Number(divRound(num * 10_000n, den));

export function distribution(
  sessions: readonly PreparedSession[],
  startingCashCents: bigint,
  runs: number,
  step: (key: string) => Step,
): Distribution {
  const equities: bigint[][] = sessions.map(() => []);
  const invested: number[][] = sessions.map(() => []);
  for (let i = 0; i < runs; i += 1) {
    const { snapshots } = simulatePortfolio(sessions, startingCashCents, step(`mc:${i}`));
    snapshots.forEach((s, k) => {
      equities[k]?.push(s.equityCents);
      invested[k]?.push(bps(s.positionsValueCents, s.equityCents));
    });
  }
  return {
    sortedEquityCents: equities.map((list) => list.sort(ascending)),
    investedBps: invested.map((list) => list.sort((a, b) => a - b)),
  };
}

// O último pregão: o patrimônio das N carteiras, crescente (o que o percentil do fim compara).
export const finalEquities = (d: Distribution): bigint[] => d.sortedEquityCents.at(-1) ?? [];

// --- leitura do banco: as mesmas fontes da liquidação (SettlementRepository), em SQL, numa conexão só de leitura ---------------

const CDI_SERIES = MACRO_SERIES.find((series) => series.code === 12)?.id;

// O RAIZ4 cotado por lote a partir de 03/11/2026 (METODOLOGIA, "Evento corporativo"): na produção, o evento entrou pelo painel em
// 15/11/2026, e o banco local da temporada é de antes. A análise o aplica na conta, só quando o banco ainda não o tem.
// ponytail: um evento só, escrito aqui; se outro faltar no banco lido, registrá-lo no banco (settle:event) em vez de crescer a lista.
const RAIZ4_LOT: CorporateEvent = {
  id: 'analise-raiz4-lote',
  ticker: 'RAIZ4',
  exDate: '2026-11-03',
  from: 100n,
  to: 1n,
};

interface Recorded {
  equityCents: bigint;
  percentileBps: number | null;
}

interface SeasonData {
  params: SeasonParams;
  sessions: IsoDate[];
  competitors: SettlementCompetitor[];
  market: Market;
  modelIds: Set<string>;
  competitorsInput: Competitor[];
  // `${competitorId}|${pregão}` -> o que a liquidação gravou
  recorded: Map<string, Recorded>;
  // pregão -> os patrimônios do Monte Carlo nos percentis 5, 25, 50, 75 e 95, como gravados
  baselines: Map<IsoDate, bigint[]>;
}

async function load(url: string, slug: string): Promise<SeasonData> {
  if (!CDI_SERIES) throw new Error('A série 12 do SGS (CDI) não está em MACRO_SERIES');
  // a análise nunca escreve: o próprio Postgres recusa qualquer escrita nesta conexão
  const client = new pg.Client({
    connectionString: url,
    options: '-c default_transaction_read_only=on',
  });
  await client.connect();
  const rows = async <T extends pg.QueryResultRow>(text: string, values: unknown[]) =>
    (await client.query<T>(text, values)).rows;
  try {
    const [season] = await rows<{ id: string; start: string | null; params: unknown }>(
      'SELECT id, start_date::text AS start, params FROM season WHERE slug = $1',
      [slug],
    );
    if (!season?.start) throw new Error(`Temporada ${slug} inexistente ou sem início`);
    const params = seasonParamsSchema.parse(season.params);
    const [last] = await rows<{ end: string | null }>(
      'SELECT max(date)::text AS end FROM equity_snapshot WHERE season_id = $1',
      [season.id],
    );
    if (!last?.end) throw new Error(`Temporada ${slug} ainda não liquidada`);
    const sessions = loadTradingCalendar().tradingDaysBetween(season.start, last.end);

    const competitors = await rows<SettlementCompetitor>(
      `SELECT id, slug, kind::text AS kind, benchmark::text AS benchmark
       FROM competitor WHERE season_id = $1 ORDER BY position`,
      [season.id],
    );
    const items = await rows<DecisionItemRow>(
      `SELECT di.id, d.competitor_id AS "competitorId", c.date::text AS date, di.position,
              di.action::text AS action, di.ticker, di.percent::text AS percent, di.rationale
       FROM decision_item di
       JOIN decision d ON d.id = di.decision_id
       JOIN cycle c ON c.id = d.cycle_id
       WHERE di.dropped = false AND c.season_id = $1 AND c.date <= $2
       ORDER BY c.date, d.competitor_id, di.position`,
      [season.id, last.end],
    );
    const bars = (
      await rows<{ date: string; ticker: string; open: string; close: string }>(
        `SELECT b.date::text AS date, i.ticker, b.open_cents AS open, b.close_cents AS close
         FROM daily_bar b JOIN instrument i ON i.id = b.instrument_id
         WHERE b.date BETWEEN $1 AND $2`,
        [season.start, last.end],
      )
    ).map((row): BarRow => ({
      date: row.date,
      ticker: row.ticker,
      openCents: BigInt(row.open),
      closeCents: BigInt(row.close),
    }));
    const universes = new Map<string, string[]>();
    for (const row of await rows<{ week: string; ticker: string }>(
      `SELECT s.week, i.ticker
       FROM universe_snapshot s
       JOIN universe_member m ON m.snapshot_id = s.id
       JOIN instrument i ON i.id = m.instrument_id
       WHERE s.week = ANY($1)`,
      [[...new Set(sessions.map(isoWeek))]],
    )) {
      universes.set(row.week, [...(universes.get(row.week) ?? []), row.ticker]);
    }
    const cdi = await rows<{ date: string; pct: string }>(
      `SELECT date::text AS date, value::text AS pct
       FROM macro_daily WHERE series = $1 AND date <= $2 ORDER BY date`,
      [CDI_SERIES, last.end],
    );
    const events = (
      await rows<{ id: string; ticker: string; exDate: string; from: number; to: number }>(
        `SELECT id, ticker, ex_date::text AS "exDate", ratio_from AS "from", ratio_to AS "to"
         FROM corporate_event WHERE ex_date BETWEEN $1 AND $2 ORDER BY ex_date, id`,
        [season.start, last.end],
      )
    ).map((row): CorporateEvent => ({ ...row, from: BigInt(row.from), to: BigInt(row.to) }));

    const recorded = new Map<string, Recorded>();
    for (const row of await rows<{
      competitorId: string;
      date: string;
      equity: string;
      percentile: number | null;
    }>(
      `SELECT competitor_id AS "competitorId", date::text AS date, equity_cents AS equity,
              percentile_bps AS percentile
       FROM equity_snapshot WHERE season_id = $1`,
      [season.id],
    )) {
      recorded.set(`${row.competitorId}|${row.date}`, {
        equityCents: BigInt(row.equity),
        percentileBps: row.percentile,
      });
    }
    const baselines = new Map<IsoDate, bigint[]>();
    for (const row of await rows<{ date: string; p: string[] }>(
      `SELECT date::text AS date,
              ARRAY[equity_p5_cents, equity_p25_cents, equity_p50_cents, equity_p75_cents,
                    equity_p95_cents]::text[] AS p
       FROM random_baseline WHERE season_id = $1`,
      [season.id],
    )) {
      baselines.set(row.date, row.p.map(BigInt));
    }

    const plan = buildPlan({ params, sessions, competitors, items, bars, universes, cdi, events });
    return {
      params,
      sessions,
      competitors,
      market: plan.market,
      modelIds: new Set(competitors.filter((c) => c.kind === 'MODEL').map((c) => c.id)),
      competitorsInput: plan.competitors,
      recorded,
      baselines,
    };
  } finally {
    await client.end();
  }
}

// --- a conta --------------------------------------------------------------------------------------------------------------

interface Production {
  runs: CompetitorRun[];
  mc: MonteCarloResult;
}

function production(data: SeasonData, market: Market, seed: string): Production {
  const startingCashCents = BigInt(data.params.capitalCents);
  const rules = rulesOf(data.params);
  const runs = simulateSeason({
    market,
    startingCashCents,
    rules,
    competitors: data.competitorsInput,
  });
  const mc = monteCarlo({
    market,
    startingCashCents,
    rules,
    seed,
    runs: data.params.monteCarloRuns,
    competitors: runs,
  });
  return { runs, mc };
}

const rulesOf = (params: SeasonParams): SettlementRules => ({
  tradeCostBps: BigInt(params.tradeCostBps),
  maxPositions: params.maxPositions,
});

// O caminho desta análise refaz o que a liquidação gravou: o patrimônio de cada competidor e o percentil dele em cada pregão, e os
// cinco percentis do Monte Carlo. Devolve as divergências (vazio = reproduziu).
function validate(data: SeasonData, { runs, mc }: Production): string[] {
  const problems: string[] = [];
  const slugOf = new Map(data.competitors.map((c) => [c.id, c.slug]));
  for (const run of runs) {
    run.snapshots.forEach((snapshot, k) => {
      const want = data.recorded.get(`${run.id}|${snapshot.date}`);
      const percentileBps = mc.sessions[k]?.percentileBps[run.id] ?? null;
      if (
        !want ||
        want.equityCents !== snapshot.equityCents ||
        want.percentileBps !== percentileBps
      ) {
        problems.push(
          `${slugOf.get(run.id)} ${snapshot.date}: gravado ${want?.equityCents} / ${want?.percentileBps}, ` +
            `refeito ${snapshot.equityCents} / ${percentileBps}`,
        );
      }
    });
  }
  for (const session of mc.sessions) {
    const want = data.baselines.get(session.date)?.join(',');
    const got = Object.values(session.equityCents).join(',');
    if (want !== got) problems.push(`Monte Carlo ${session.date}: gravado ${want}, refeito ${got}`);
  }
  return problems;
}

const pct = (value: number): string => (value / 100).toFixed(1).replace('.', ',');
const ret = (equity: bigint, capital: bigint): string =>
  pct(Number(divRound((equity - capital) * 10_000n, capital)));
const median = (sorted: readonly number[]): number =>
  sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;

function summary(label: string, d: Distribution, capital: bigint): string {
  const at = (p: number) => ret(nearestRank(finalEquities(d), p), capital);
  const invested = pct(median(d.investedBps.at(-1) ?? []));
  return `| ${label} | ${at(5)}% | ${at(50)}% | ${at(95)}% | ${invested}% |`;
}

// A semente das variantes (e da coluna de hoje) é a do Monte Carlo da temporada; outra, no terceiro argumento, mede o acaso do
// sorteio. A validação usa sempre a da temporada, que é a do que foi gravado.
export async function main(argv: readonly string[]): Promise<number> {
  const [url, slug = 'temporada-1', other] = argv;
  if (!url || argv.length > 3) {
    console.error(
      'Uso: node apps/api/analise/percentil-investido.mjs <url do banco> [temporada] [semente]',
    );
    return 2;
  }
  const data = await load(url, slug);
  const { params, sessions } = data;
  const capital = BigInt(params.capitalCents);
  const rules = rulesOf(params);
  const seed = other ?? params.monteCarloSeed;
  const runsCount = params.monteCarloRuns;
  const end = sessions[sessions.length - 1] as IsoDate;

  // 1. a validação: o método da produção, sobre o banco como está, refaz o que a liquidação gravou
  const recorded = production(data, data.market, params.monteCarloSeed);
  const problems = validate(data, recorded);
  console.log(
    problems.length === 0
      ? `Validação: ${sessions.length} pregões (${sessions[0]} a ${end}) x ${data.competitors.length} competidores, ` +
          `patrimônio e percentil de cada um e os 5 percentis do Monte Carlo iguais aos gravados.`
      : `Validação FALHOU (${problems.length} divergências):\n${problems.slice(0, 20).join('\n')}`,
  );
  if (problems.length > 0) return 1;

  // 2. o evento do RAIZ4, na conta, se o banco ainda não o tem
  const hasLot = data.market.events.some(
    (e) => e.ticker === RAIZ4_LOT.ticker && e.exDate === RAIZ4_LOT.exDate,
  );
  const market = hasLot
    ? data.market
    : { ...data.market, events: [...data.market.events, RAIZ4_LOT] };
  console.log(
    hasLot
      ? 'O evento do RAIZ4 já está no banco.'
      : 'Evento do RAIZ4 (grupamento 100:1, data ex 03/11/2026) aplicado na conta.',
  );
  const today = production(data, market, seed);
  const prepared = prepare(market);

  // o mesmo laço das variantes, com a política da produção, tem de dar o percentil de hoje (o que muda nas variantes é só o Step)
  const base = distribution(prepared, capital, runsCount, (key) => randomStep(seed, key, rules));
  const last = today.mc.sessions[today.mc.sessions.length - 1];
  for (const run of today.runs) {
    const equity = run.snapshots[run.snapshots.length - 1]?.equityCents ?? 0n;
    if (percentRankBps(finalEquities(base), equity) !== last?.percentileBps[run.id]) {
      throw new Error(`O laço das variantes não refaz o Monte Carlo da produção (${run.id})`);
    }
  }

  // 3. as variantes
  const swap = distribution(prepared, capital, runsCount, (key) => swapStep(seed, key, rules));
  const matched = new Map<string, Distribution>();
  for (const run of today.runs) {
    if (!data.modelIds.has(run.id)) continue;
    const targets = exposureAtOpen(prepared, run.snapshots);
    matched.set(
      run.id,
      distribution(prepared, capital, runsCount, (key) => exposureStep(seed, key, rules, targets)),
    );
  }

  console.log(
    `\nPercentil em ${end} (pontos percentuais; ${runsCount.toLocaleString('pt-BR')} carteiras, semente "${seed}", chaves mc:0 a mc:${runsCount - 1}):\n`,
  );
  console.log(
    `| Competidor | Retorno | Investido | Gravado${hasLot ? '' : ' (sem RAIZ4)'} | ` +
      'Hoje (produção, com RAIZ4) | A: troca no teto | B: exposição do modelo |',
  );
  console.log('| --- | --: | --: | --: | --: | --: | --: |');
  data.competitors.forEach((competitor, index) => {
    const run = today.runs[index] as CompetitorRun;
    const snapshot = run.snapshots[run.snapshots.length - 1] as Snapshot;
    const own = matched.get(run.id);
    console.log(
      `| ${competitor.slug} | ${ret(snapshot.equityCents, capital)}% | ` +
        `${pct(bps(snapshot.positionsValueCents, snapshot.equityCents))}% | ` +
        `${pct(data.recorded.get(`${run.id}|${end}`)?.percentileBps ?? 0)} | ` +
        `${pct(last?.percentileBps[run.id] ?? 0)} | ` +
        `${pct(percentRankBps(finalEquities(swap), snapshot.equityCents))} | ` +
        `${own ? pct(percentRankBps(finalEquities(own), snapshot.equityCents)) : '—'} |`,
    );
  });

  console.log(
    `\nAs ${runsCount.toLocaleString('pt-BR')} carteiras em ${end} (retorno nos percentis 5, 50 e 95; fração investida mediana):\n`,
  );
  console.log('| Distribuição | p5 | p50 | p95 | Investido |');
  console.log('| --- | --: | --: | --: | --: |');
  console.log(summary('Hoje (produção, com RAIZ4)', base, capital));
  console.log(summary('A: troca no teto', swap, capital));
  for (const [id, d] of matched) {
    const competitor = data.competitors.find((c) => c.id === id);
    console.log(summary(`B: exposição de ${competitor?.slug}`, d, capital));
  }

  // a trajetória: quando o caixa das carteiras sorteadas cresce, e o que o mercado fez nesse tempo
  const bova = today.runs[data.competitors.findIndex((c) => c.benchmark === 'BOVA11')];
  console.log(
    `\nPor pregão (as ${runsCount.toLocaleString('pt-BR')} carteiras: fração investida mediana e retorno mediano; o BOVA11 de contexto):\n`,
  );
  console.log('| Pregão | Investido, hoje | Investido, A | Retorno, hoje | Retorno, A | BOVA11 |');
  console.log('| --- | --: | --: | --: | --: | --: |');
  prepared.forEach((session, k) => {
    const at = (d: Distribution) => ret(nearestRank(d.sortedEquityCents[k] ?? [], 50), capital);
    const bovaEquity = bova?.snapshots[k]?.equityCents;
    console.log(
      `| ${session.date} | ${pct(median(base.investedBps[k] ?? []))}% | ` +
        `${pct(median(swap.investedBps[k] ?? []))}% | ${at(base)}% | ${at(swap)}% | ` +
        `${bovaEquity === undefined ? '—' : `${ret(bovaEquity, capital)}%`} |`,
    );
  });
  return 0;
}
