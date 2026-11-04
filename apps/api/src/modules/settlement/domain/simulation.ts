import type { DecisionItem } from '@alvesting/contracts';
import { isIsoDate, type IsoDate } from '../../market-data/domain/dates.js';
import {
  MissingCdiError,
  interest,
  parseCdi,
  rateOnOrBefore,
  type CdiPoint,
  type CdiRate,
} from './cdi.js';
import { applyCorporateEvent, validateEvent, type CorporateEvent } from './corporate-events.js';
import { maxShares, tradeCost } from './money.js';
import {
  assertRules,
  executeSession,
  markToMarket,
  type Bar,
  type Fill,
  type OrderRecord,
  type Portfolio,
  type PositionSnapshot,
  type SessionResult,
  type SettlementRules,
} from './portfolio.js';
import { randomDecisions, SORTEIO_PORTFOLIO } from './random-policy.js';

// A temporada recalculada do zero (plano, 16, etapa 7; docs/METODOLOGIA.md): do primeiro pregão até D, para cada
// competidor, na ordem do dia: juros do caixa, eventos corporativos, ordens a preço de abertura, marcação no
// fechamento. Funções puras, sem banco, fila nem relógio. Recalcular tudo a cada liquidação é proposital: a troca das
// uma barra corrigida e um evento registrado depois saem certos sem nenhuma lógica de correção, porque o
// pregão k só depende de dados até k.

// A referência de contexto (plano, 2). Mesmo ticker do instrument.
export const BOVA11_TICKER = 'BOVA11';

export interface Session {
  date: IsoDate;
  // barras de D por ticker (só abertura e fechamento importam); ticker ausente = sem barra
  bars: ReadonlyMap<string, Bar>;
  // universo da semana de D
  universe: readonly string[];
}

export interface Market {
  // do primeiro pregão até D, em ordem crescente de data
  sessions: readonly Session[];
  cdi: readonly CdiPoint[];
  events: readonly CorporateEvent[];
}

export type Competitor =
  // uma LLM: as decisões validadas de cada pregão (item por pregão; sem decisão = HOLD)
  | { id: string; kind: 'MODEL'; decisions: ReadonlyMap<IsoDate, readonly DecisionItem[]> }
  // o Sorteio: a política aleatória com a semente própria da temporada
  | { id: string; kind: 'RANDOM'; seed: string }
  // referência principal: igual-peso do universo da semana de início, só preço
  | { id: string; kind: 'EQUAL_WEIGHT' }
  // referência: o capital rendendo CDI
  | { id: string; kind: 'CDI' }
  // referência de contexto: BOVA11 comprado na abertura do primeiro pregão
  | { id: string; kind: 'BOVA11' };

export interface Snapshot {
  date: IsoDate;
  cashCents: bigint;
  positionsValueCents: bigint;
  equityCents: bigint;
  // juros do caixa creditados no início deste pregão (zero no primeiro)
  interestCents: bigint;
  // a data da taxa de CDI usada; a do pregão anterior, ou a última publicada antes dela
  cdiDate: IsoDate | null;
  // as posições no fechamento, em ordem de ticker
  positions: PositionSnapshot[];
}

export interface CompetitorRun {
  id: string;
  kind: Competitor['kind'];
  orders: OrderRecord[];
  fills: Fill[];
  snapshots: Snapshot[];
}

export interface PreparedSession {
  index: number;
  date: IsoDate;
  // só barras com preço de verdade (abertura e fechamento positivos)
  bars: ReadonlyMap<string, Bar>;
  // ordenado e sem repetição: a ordem entra no sorteio da política aleatória
  universe: readonly string[];
  // a taxa que rende o caixa entre o pregão anterior e este; null no primeiro pregão
  cdi: CdiRate | null;
  // eventos que valem no começo deste pregão, na ordem de aplicação
  events: readonly CorporateEvent[];
}

const byDateThenId = (a: CorporateEvent, b: CorporateEvent): number =>
  a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// Resolve as regras de data uma vez, para todos os competidores e para o Monte Carlo:
// - CDI: cada intervalo entre pregões rende UMA taxa, a do pregão anterior (o CDI de D sai no dia útil seguinte). Se
//   ela ainda não saiu, vale a última publicada antes dela, e a data fica no snapshot. Sem taxa nenhuma, erro.
// - Evento: vale no primeiro pregão em ou depois da data ex em que a ação tem barra. Sem barra não há preço novo, e a
//   posição segue no estado velho (quantidade e último fechamento velhos), que é coerente.
// - Barra com abertura ou fechamento zero (ou negativo) não é preço: conta como sem barra.
export function prepare(market: Market): PreparedSession[] {
  if (market.sessions.length === 0) throw new RangeError('A temporada não tem pregão');
  const rates = parseCdi(market.cdi);
  const events = [...market.events].sort(byDateThenId);
  events.forEach(validateEvent);

  const prepared = market.sessions.map((session, index) => {
    if (!isIsoDate(session.date)) throw new RangeError(`Data de pregão inválida: ${session.date}`);
    const previous = market.sessions[index - 1];
    if (previous && session.date <= previous.date) {
      throw new RangeError(`Pregões repetidos ou fora de ordem: ${previous.date}, ${session.date}`);
    }
    let cdi: CdiRate | null = null;
    if (previous) {
      cdi = rateOnOrBefore(rates, previous.date);
      if (!cdi) throw new MissingCdiError(previous.date);
    }
    return {
      index,
      date: session.date,
      bars: new Map([...session.bars].filter(([, b]) => b.openCents > 0n && b.closeCents > 0n)),
      universe: [...new Set(session.universe)].sort(),
      cdi,
      events: [] as CorporateEvent[],
    };
  });
  for (const event of events) {
    prepared.find((s) => s.date >= event.exDate && s.bars.has(event.ticker))?.events.push(event);
  }
  return prepared;
}

// O que um competidor faz no pregão: recebe a carteira depois dos juros e dos eventos e devolve ordens e carteira.
export type Step = (session: PreparedSession, portfolio: Portfolio) => SessionResult;

// Uma carteira, do primeiro pregão ao último. A mesma rotina serve aos modelos, ao Sorteio, às referências e às 1.000
// carteiras do Monte Carlo: as regras são as mesmas por construção.
export function simulatePortfolio(
  sessions: readonly PreparedSession[],
  startingCashCents: bigint,
  step: Step,
): Pick<CompetitorRun, 'orders' | 'fills' | 'snapshots'> {
  // o capital entra na abertura do primeiro pregão: não rende antes dela
  let portfolio: Portfolio = { cashCents: startingCashCents, positions: new Map() };
  const orders: OrderRecord[] = [];
  const fills: Fill[] = [];
  const snapshots: Snapshot[] = [];

  for (const session of sessions) {
    let interestCents = 0n;
    if (session.cdi) {
      interestCents = interest(portfolio.cashCents, session.cdi);
      portfolio = {
        cashCents: portfolio.cashCents + interestCents,
        positions: portfolio.positions,
      };
    }
    for (const event of session.events) {
      const open = session.bars.get(event.ticker)?.openCents;
      if (open !== undefined) portfolio = applyCorporateEvent(portfolio, event, open);
    }

    const result = step(session, portfolio);
    orders.push(...result.orders);
    fills.push(...result.fills);

    const marked = markToMarket(result.portfolio, session.bars);
    portfolio = marked.portfolio;
    snapshots.push({
      date: session.date,
      cashCents: portfolio.cashCents,
      positionsValueCents: marked.positionsValueCents,
      equityCents: marked.equityCents,
      interestCents,
      cdiDate: session.cdi?.date ?? null,
      positions: marked.positions,
    });
  }
  return { orders, fills, snapshots };
}

const modelStep =
  (decisions: ReadonlyMap<IsoDate, readonly DecisionItem[]>, rules: SettlementRules): Step =>
  (session, portfolio) =>
    executeSession({
      date: session.date,
      portfolio,
      items: decisions.get(session.date) ?? [],
      bars: session.bars,
      rules,
    });

// A política aleatória de uma carteira (a do Sorteio ou uma do Monte Carlo): sorteia as ordens olhando só as posições
// que a carteira tem ao começar o pregão e o universo da semana, e executa pelo mesmo motor dos modelos.
export const randomStep =
  (seed: string, portfolioKey: string, rules: SettlementRules): Step =>
  (session, portfolio) =>
    executeSession({
      date: session.date,
      rules,
      portfolio,
      items: randomDecisions({
        seed,
        date: session.date,
        portfolio: portfolioKey,
        held: [...portfolio.positions.keys()],
        universe: session.universe,
      }),
      bars: session.bars,
    });

// Compra `tickers` com pesos iguais na abertura do pregão: cada ação com barra recebe a mesma fatia do caixa (inteira,
// para baixo) e compra o que couber nela, valor mais custo. Serve ao igual-peso (o universo) e ao BOVA11 (um papel, a
// fatia é o caixa todo). Não passa pelo motor dos modelos de propósito: o limite de posições e a faixa de 5% a 25% não
// se aplicam às referências, por construção. Papel sem barra fica de fora e o peso se divide entre os que têm;
// papel cujo preço passa da fatia não é comprado, e a fatia fica no caixa rendendo CDI.
function buyEqualWeight(
  portfolio: Portfolio,
  tickers: readonly string[],
  { date, bars }: PreparedSession,
  costBps: bigint,
): SessionResult {
  const buyable = tickers.filter((ticker) => bars.has(ticker)).length;
  const slice = buyable === 0 ? 0n : portfolio.cashCents / BigInt(buyable);
  let cash = portfolio.cashCents;
  const positions = new Map(portfolio.positions);
  const orders: OrderRecord[] = [];
  const fills: Fill[] = [];

  tickers.forEach((ticker, itemIndex) => {
    const base = { date, itemIndex, ticker, action: 'BUY' } as const;
    const bar = bars.get(ticker);
    if (!bar) {
      orders.push({
        ...base,
        status: 'NOT_EXECUTED',
        reason: 'no_bar',
        requestedQuantity: null,
        filledQuantity: 0n,
        priceCents: null,
      });
      return;
    }
    const quantity = maxShares(slice, bar.openCents, costBps);
    if (quantity < 1n) {
      orders.push({
        ...base,
        status: 'NOT_EXECUTED',
        reason: 'below_one_share',
        requestedQuantity: 0n,
        filledQuantity: 0n,
        priceCents: bar.openCents,
      });
      return;
    }
    const notional = quantity * bar.openCents;
    const cost = tradeCost(notional, costBps);
    cash -= notional + cost;
    positions.set(ticker, {
      quantity: (positions.get(ticker)?.quantity ?? 0n) + quantity,
      costCents: (positions.get(ticker)?.costCents ?? 0n) + notional + cost,
      markCents: bar.openCents,
    });
    orders.push({
      ...base,
      status: 'FILLED',
      reason: null,
      requestedQuantity: quantity,
      filledQuantity: quantity,
      priceCents: bar.openCents,
    });
    fills.push({
      ...base,
      quantity,
      priceCents: bar.openCents,
      notionalCents: notional,
      costCents: cost,
      realizedCents: null,
    });
  });
  return { portfolio: { cashCents: cash, positions }, orders, fills };
}

const holdStep: Step = (_session, portfolio) => ({ portfolio, orders: [], fills: [] });

function stepFor(competitor: Competitor, rules: SettlementRules): Step {
  switch (competitor.kind) {
    case 'MODEL':
      return modelStep(competitor.decisions, rules);
    case 'RANDOM':
      return randomStep(competitor.seed, SORTEIO_PORTFOLIO, rules);
    case 'EQUAL_WEIGHT':
      // compra o universo da semana de início e segura até o fim
      return (session, portfolio) =>
        session.index === 0
          ? buyEqualWeight(portfolio, session.universe, session, rules.tradeCostBps)
          : holdStep(session, portfolio);
    case 'BOVA11':
      return (session, portfolio) =>
        session.index === 0
          ? buyEqualWeight(portfolio, [BOVA11_TICKER], session, rules.tradeCostBps)
          : holdStep(session, portfolio);
    case 'CDI':
      return holdStep;
  }
}

export interface SeasonInput {
  market: Market;
  startingCashCents: bigint;
  // custo e limite de posições da temporada (season.params), sem valor padrão
  rules: SettlementRules;
  competitors: readonly Competitor[];
}

// Recalcula a temporada do primeiro pregão até o último de `market`. Devolve, por competidor e na ordem do elenco, as
// ordens, as execuções e um snapshot por pregão (com as posições do fechamento).
export function simulateSeason({
  market,
  startingCashCents,
  rules,
  competitors,
}: SeasonInput): CompetitorRun[] {
  if (startingCashCents <= 0n) throw new RangeError('O capital inicial deve ser positivo');
  assertRules(rules);
  if (new Set(competitors.map((c) => c.id)).size !== competitors.length) {
    throw new RangeError('Dois competidores com o mesmo id');
  }
  const sessions = prepare(market);
  return competitors.map((competitor) => ({
    id: competitor.id,
    kind: competitor.kind,
    ...simulatePortfolio(sessions, startingCashCents, stepFor(competitor, rules)),
  }));
}
