import type { DecisionItem, SeasonParams } from '@alvesting/contracts';
import { newId } from '../../../common/id.js';
import { isoWeek, type IsoDate } from '../../market-data/domain/dates.js';
import type { CdiPoint } from '../domain/cdi.js';
import type { CorporateEvent } from '../domain/corporate-events.js';
import type { MonteCarloResult } from '../domain/monte-carlo.js';
import type { Bar } from '../domain/portfolio.js';
import type { SeasonStat } from '../domain/season-stats.js';
import type { Competitor, CompetitorRun, Market, Session } from '../domain/simulation.js';
import type {
  BarRow,
  DecisionItemRow,
  DerivedRows,
  SettlementCompetitor,
} from '../infrastructure/settlement.repository.js';

// A ligação entre o banco e o domínio puro da liquidação (domain/): as linhas lidas viram o mercado e o elenco que a simulação
// recebe, e o que ela devolve vira as linhas que a transação grava. Funções puras, sem banco nem relógio.

const toDate = (day: IsoDate): Date => new Date(`${day}T00:00:00Z`);

// Falta dado que a liquidação precisa e que ainda pode chegar (as barras do dia, o universo da semana). Não liquida e não grava
// nada: a falha leva a mensagem a ser tentada de novo, e a DLQ avisa se o dado não vier. Chutar um dia sem barras daria um
// patrimônio errado e com cara de certo.
export class IncompleteDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteDataError';
  }
}

export interface PlanInput {
  params: SeasonParams;
  // do primeiro pregão da temporada até o último a liquidar, em ordem
  sessions: readonly IsoDate[];
  competitors: readonly SettlementCompetitor[];
  // só os itens que valeram (nunca o descartado), de qualquer competidor e pregão
  items: readonly DecisionItemRow[];
  bars: readonly BarRow[];
  // semana ISO -> tickers do universo congelado dela
  universes: ReadonlyMap<string, readonly string[]>;
  cdi: readonly CdiPoint[];
  events: readonly CorporateEvent[];
}

export interface Plan {
  market: Market;
  competitors: Competitor[];
  // `${competitorId}|${pregão}` -> os ids dos decision_item, na ordem da lista que o domínio recebeu: o índice de uma ordem
  // (itemIndex) aponta aqui para o item da decisão que a originou
  itemIds: ReadonlyMap<string, readonly string[]>;
}

// O percentual vem do Decimal(7,4) do banco como texto ("15.5"). O domínio o converte em ponto-base pela grafia do número, sem
// passar pelo float; isto só o devolve como number, e recusa o que não é número em vez de tratar como zero.
function percentOf(row: DecisionItemRow): number {
  if (row.percent === null || !/^\d+(\.\d+)?$/.test(row.percent)) {
    throw new Error(`decision_item ${row.id}: percentual inválido (${String(row.percent)})`);
  }
  return Number(row.percent);
}

function toDecisionItem(row: DecisionItemRow): DecisionItem {
  const base = { ticker: row.ticker, rationale: row.rationale };
  if (row.action === 'HOLD') return { ...base, action: 'HOLD' };
  return row.action === 'BUY'
    ? { ...base, action: 'BUY', percent_of_equity: percentOf(row) }
    : { ...base, action: 'SELL', percent_of_position: percentOf(row) };
}

export function buildPlan(input: PlanInput): Plan {
  const barsByDate = new Map<IsoDate, Map<string, Bar>>();
  for (const row of input.bars) {
    const day = barsByDate.get(row.date) ?? new Map<string, Bar>();
    day.set(row.ticker, { openCents: row.openCents, closeCents: row.closeCents });
    barsByDate.set(row.date, day);
  }
  const sessions: Session[] = input.sessions.map((date) => {
    const week = isoWeek(date);
    const universe = input.universes.get(week);
    if (!universe) {
      throw new IncompleteDataError(
        `Sem universo congelado da semana ${week} (pregão ${date}): rode o universe dela e reenvie a liquidação`,
      );
    }
    const bars = barsByDate.get(date) ?? new Map<string, Bar>();
    // daily_bar nunca é denso (uma ação sem negócio no dia não tem barra), mas um pregão sem barra de nenhuma ação do universo é
    // um pregão que não foi carregado
    if (!universe.some((ticker) => bars.has(ticker))) {
      throw new IncompleteDataError(
        `Nenhuma barra do universo em ${date}: as barras do dia ainda não foram carregadas`,
      );
    }
    return { date, bars, universe };
  });

  // As decisões por modelo e pregão, na ordem em que o modelo listou. Pregão sem decisão (ciclo pulado, ausente ou HOLD forçado)
  // não tem entrada, e o domínio trata como HOLD. Item de quem não é modelo, ou de um pregão fora da temporada, não executa.
  const dates = new Set(input.sessions);
  const modelIds = new Set(input.competitors.filter((c) => c.kind === 'MODEL').map((c) => c.id));
  const decisions = new Map<string, Map<IsoDate, DecisionItem[]>>();
  const itemIds = new Map<string, string[]>();
  for (const row of [...input.items].sort((a, b) => a.position - b.position)) {
    if (!modelIds.has(row.competitorId) || !dates.has(row.date)) continue;
    const byDate = decisions.get(row.competitorId) ?? new Map<IsoDate, DecisionItem[]>();
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), toDecisionItem(row)]);
    decisions.set(row.competitorId, byDate);
    const key = `${row.competitorId}|${row.date}`;
    itemIds.set(key, [...(itemIds.get(key) ?? []), row.id]);
  }

  const competitors = input.competitors.map((competitor): Competitor => {
    switch (competitor.kind) {
      case 'MODEL':
        return {
          id: competitor.id,
          kind: 'MODEL',
          decisions: decisions.get(competitor.id) ?? new Map(),
        };
      case 'RANDOM':
        return { id: competitor.id, kind: 'RANDOM', seed: input.params.randomSeed };
      case 'BENCHMARK':
        if (competitor.benchmark === null) {
          throw new Error(`Competidor ${competitor.slug}: referência sem tipo (dado corrompido)`);
        }
        return { id: competitor.id, kind: competitor.benchmark };
    }
  });

  return {
    market: { sessions, cdi: input.cdi, events: input.events },
    competitors,
    itemIds,
  };
}

export interface DerivedInput {
  seasonId: string;
  plan: Plan;
  runs: readonly CompetitorRun[];
  mc: MonteCarloResult;
  stats: readonly SeasonStat[];
}

// O que a simulação devolveu, no formato das tabelas. Cada linha ganha o seu ULID; a execução aponta para a ordem pela
// (data, índice), que é única por competidor.
export function derivedRows({ seasonId, plan, runs, mc, stats }: DerivedInput): DerivedRows {
  const rows: DerivedRows = {
    orders: [],
    fills: [],
    positions: [],
    snapshots: [],
    stats: [],
    baselines: [],
  };
  const asOf = plan.market.sessions[plan.market.sessions.length - 1]?.date;
  if (asOf === undefined) throw new RangeError('A temporada não tem pregão');

  for (const run of runs) {
    const orderIds = new Map<string, string>();
    for (const order of run.orders) {
      const id = newId();
      orderIds.set(`${order.date}|${order.itemIndex}`, id);
      rows.orders.push({
        id,
        seasonId,
        competitorId: run.id,
        date: toDate(order.date),
        itemIndex: order.itemIndex,
        decisionItemId: plan.itemIds.get(`${run.id}|${order.date}`)?.[order.itemIndex] ?? null,
        ticker: order.ticker,
        action: order.action,
        status: order.status,
        reason: order.reason,
        requestedQuantity: order.requestedQuantity,
        filledQuantity: order.filledQuantity,
        priceCents: order.priceCents,
      });
    }
    for (const fill of run.fills) {
      const orderId = orderIds.get(`${fill.date}|${fill.itemIndex}`);
      if (orderId === undefined) {
        throw new Error(`Execução de ${fill.ticker} em ${fill.date} sem a ordem correspondente`);
      }
      rows.fills.push({
        id: newId(),
        orderId,
        quantity: fill.quantity,
        priceCents: fill.priceCents,
        notionalCents: fill.notionalCents,
        costCents: fill.costCents,
        realizedCents: fill.realizedCents,
      });
    }
    run.snapshots.forEach((snapshot, k) => {
      rows.snapshots.push({
        id: newId(),
        seasonId,
        competitorId: run.id,
        date: toDate(snapshot.date),
        cashCents: snapshot.cashCents,
        positionsValueCents: snapshot.positionsValueCents,
        equityCents: snapshot.equityCents,
        interestCents: snapshot.interestCents,
        cdiDate: snapshot.cdiDate === null ? null : toDate(snapshot.cdiDate),
        percentileBps: mc.sessions[k]?.percentileBps[run.id] ?? null,
      });
      for (const position of snapshot.positions) {
        rows.positions.push({
          id: newId(),
          seasonId,
          competitorId: run.id,
          date: toDate(snapshot.date),
          ticker: position.ticker,
          quantity: position.quantity,
          costCents: position.costCents,
          markCents: position.markCents,
          valueCents: position.valueCents,
          stale: position.stale,
        });
      }
    });
  }

  for (const stat of stats) {
    rows.stats.push({
      id: newId(),
      seasonId,
      competitorId: stat.id,
      asOf: toDate(asOf),
      returnBps: stat.returnBps,
      percentileBps: stat.percentileBps,
      excessEqualWeightBps: stat.excessEqualWeightBps,
      excessCdiBps: stat.excessCdiBps,
      maxDrawdownBps: stat.maxDrawdownBps,
      sells: stat.sells,
      winningSells: stat.winningSells,
      winRateBps: stat.winRateBps,
      trades: stat.trades,
    });
  }

  for (const session of mc.sessions) {
    rows.baselines.push({
      id: newId(),
      seasonId,
      date: toDate(session.date),
      seed: mc.seed,
      runs: mc.runs,
      equityP5Cents: session.equityCents.p5,
      equityP25Cents: session.equityCents.p25,
      equityP50Cents: session.equityCents.p50,
      equityP75Cents: session.equityCents.p75,
      equityP95Cents: session.equityCents.p95,
      returnP5Bps: session.returnBps.p5,
      returnP25Bps: session.returnBps.p25,
      returnP50Bps: session.returnBps.p50,
      returnP75Bps: session.returnBps.p75,
      returnP95Bps: session.returnBps.p95,
    });
  }
  return rows;
}
