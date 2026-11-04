import {
  BUY_PERCENT_OF_EQUITY,
  MAX_ORDERS_PER_CYCLE,
  SELL_PERCENT_OF_POSITION,
  type DecisionItem,
} from '@alvesting/contracts';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { divRound, maxShares, percentToBps, tradeCost } from './money.js';

// Um pregão D de um competidor (plano, 2; docs/METODOLOGIA.md): as ordens executam ao preço oficial de abertura de D,
// as vendas antes das compras, só em ações inteiras, com o custo por operação da temporada (0,03% no plano). Função
// pura: recebe o estado e devolve o novo, sem relógio, sem acaso e sem banco. Dinheiro em centavos (bigint).

// As regras de ações que mudam de temporada para temporada (season.params). Sem valor padrão: quem chama diz quais são,
// e uma temporada com 5 pontos-base não pode liquidar com 3 por esquecimento. As faixas de percentual e o limite de
// ordens por ciclo são do contrato da decisão e não mudam.
export interface SettlementRules {
  // custo por operação, em pontos-base: 3 = 0,03% (season.params.tradeCostBps)
  tradeCostBps: bigint;
  // posições abertas ao mesmo tempo (season.params.maxPositions)
  maxPositions: number;
}

// Os pontos de entrada (simulateSeason e monteCarlo) conferem as regras uma vez; executeSession confia nelas.
export function assertRules({ tradeCostBps, maxPositions }: SettlementRules): void {
  if (tradeCostBps < 0n || tradeCostBps >= 10_000n) {
    throw new RangeError(`Custo de ${tradeCostBps} pontos-base não faz sentido`);
  }
  if (!Number.isInteger(maxPositions) || maxPositions < 1) {
    throw new RangeError(`Limite de ${maxPositions} posições não faz sentido`);
  }
}

const BPS = 10_000n;

export interface Bar {
  openCents: bigint;
  closeCents: bigint;
}

export interface Position {
  quantity: bigint;
  // custo total da posição: o que foi pago nas compras (valor mais custo), baixado na proporção a cada venda
  costCents: bigint;
  // último fechamento conhecido. A posição sem barra no pregão é marcada por ele, e a ordem nunca o usa como preço
  markCents: bigint;
}

export interface Portfolio {
  cashCents: bigint;
  positions: ReadonlyMap<string, Position>;
}

export type RejectionReason =
  'no_position' | 'max_positions' | 'no_bar' | 'below_one_share' | 'insufficient_cash';

export interface OrderRecord {
  date: IsoDate;
  // posição do item na lista da decisão (HOLD também ocupa índice): liga a ordem ao decision_item
  itemIndex: number;
  ticker: string;
  action: 'BUY' | 'SELL';
  // FILLED: executou o que o percentual pediu. REDUCED: o caixa não deixou, executou menos. NOT_EXECUTED: não executou
  status: 'FILLED' | 'REDUCED' | 'NOT_EXECUTED';
  reason: RejectionReason | null;
  // quantas ações o percentual pedia (antes do limite de caixa); null quando não deu para calcular
  requestedQuantity: bigint | null;
  filledQuantity: bigint;
  // a abertura de D; null quando a ação não tem barra em D
  priceCents: bigint | null;
}

export interface Fill {
  date: IsoDate;
  itemIndex: number;
  ticker: string;
  action: 'BUY' | 'SELL';
  quantity: bigint;
  priceCents: bigint;
  notionalCents: bigint;
  costCents: bigint;
  // só na venda: o recebido (valor menos custo) menos o custo médio das ações vendidas
  realizedCents: bigint | null;
}

export interface SessionInput {
  date: IsoDate;
  rules: SettlementRules;
  portfolio: Portfolio;
  // itens da decisão de D já validados (BUY, SELL e HOLD), na ordem em que o modelo os listou
  items: readonly DecisionItem[];
  // barras de D por ticker; ticker ausente = sem barra em D
  bars: ReadonlyMap<string, Bar>;
}

export interface SessionResult {
  portfolio: Portfolio;
  // na ordem de execução: vendas primeiro, depois compras, cada grupo na ordem em que o modelo listou
  orders: OrderRecord[];
  fills: Fill[];
}

type OrderItem = Exclude<DecisionItem, { action: 'HOLD' }>;

// O contrato já recusa o que está fora da faixa; esta é a última barreira, na fronteira do domínio. Compara o número
// como veio (5, 25, 1 e 100 são exatos em float), e só depois converte para ponto-base.
function bpsOf(item: OrderItem): bigint {
  const [percent, [min, max]] =
    item.action === 'BUY'
      ? [item.percent_of_equity, BUY_PERCENT_OF_EQUITY]
      : [item.percent_of_position, SELL_PERCENT_OF_POSITION];
  if (!(percent >= min && percent <= max)) {
    throw new RangeError(`${item.action} ${item.ticker}: ${percent}% fora de ${min}% a ${max}%`);
  }
  return percentToBps(percent);
}

// Patrimônio na abertura de D: o caixa mais as posições pelo preço de abertura de D (sem barra: pelo último
// fechamento conhecido). É a base do percentual do BUY, medida antes de qualquer ordem do pregão.
export function equityAtOpen(portfolio: Portfolio, bars: ReadonlyMap<string, Bar>): bigint {
  let equity = portfolio.cashCents;
  for (const [ticker, position] of portfolio.positions) {
    equity += position.quantity * (bars.get(ticker)?.openCents ?? position.markCents);
  }
  return equity;
}

export function executeSession({
  date,
  portfolio,
  items,
  bars,
  rules,
}: SessionInput): SessionResult {
  const requested = items.flatMap((item, itemIndex) =>
    item.action === 'HOLD' ? [] : [{ item, itemIndex, bps: bpsOf(item) }],
  );
  if (requested.length > MAX_ORDERS_PER_CYCLE) {
    throw new RangeError(
      `${requested.length} ordens: o máximo por ciclo é ${MAX_ORDERS_PER_CYCLE}`,
    );
  }

  const equity = equityAtOpen(portfolio, bars);
  const positions = new Map(portfolio.positions);
  let cash = portfolio.cashCents;
  const orders: OrderRecord[] = [];
  const fills: Fill[] = [];

  const sequence = [
    ...requested.filter((r) => r.item.action === 'SELL'),
    ...requested.filter((r) => r.item.action === 'BUY'),
  ];
  for (const { item, itemIndex, bps } of sequence) {
    const bar = bars.get(item.ticker);
    const price = bar?.openCents ?? null;
    const base = { date, itemIndex, ticker: item.ticker, action: item.action };
    const reject = (reason: RejectionReason, requestedQuantity: bigint | null) =>
      orders.push({
        ...base,
        status: 'NOT_EXECUTED',
        reason,
        requestedQuantity,
        filledQuantity: 0n,
        priceCents: price,
      });
    const held = positions.get(item.ticker);

    if (item.action === 'SELL') {
      if (!held) {
        reject('no_position', null);
        continue;
      }
      if (!bar) {
        reject('no_bar', null);
        continue;
      }
      const quantity = (held.quantity * bps) / BPS; // para baixo: ação inteira
      if (quantity < 1n) {
        reject('below_one_share', 0n);
        continue;
      }
      const notional = quantity * bar.openCents;
      const cost = tradeCost(notional, rules.tradeCostBps);
      // custo médio: a venda leva a parte proporcional do custo da posição (a total leva tudo, sem resto)
      const basis = divRound(held.costCents * quantity, held.quantity);
      cash += notional - cost;
      if (quantity === held.quantity) positions.delete(item.ticker);
      else {
        positions.set(item.ticker, {
          ...held,
          quantity: held.quantity - quantity,
          costCents: held.costCents - basis,
        });
      }
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
        realizedCents: notional - cost - basis,
      });
      continue;
    }

    // BUY: o limite de posições vale na hora da execução, depois das vendas do pregão
    if (!held && positions.size >= rules.maxPositions) {
      reject('max_positions', null);
      continue;
    }
    if (!bar) {
      reject('no_bar', null);
      continue;
    }
    // o percentual do patrimônio da abertura paga o valor das ações; o custo vai por cima, do caixa
    const target = (equity * bps) / (BPS * bar.openCents);
    if (target < 1n) {
      reject('below_one_share', 0n);
      continue;
    }
    const affordable = maxShares(cash, bar.openCents, rules.tradeCostBps); // sem alavancagem
    const quantity = target < affordable ? target : affordable;
    if (quantity < 1n) {
      reject('insufficient_cash', target);
      continue;
    }
    const notional = quantity * bar.openCents;
    const cost = tradeCost(notional, rules.tradeCostBps);
    cash -= notional + cost;
    positions.set(item.ticker, {
      quantity: (held?.quantity ?? 0n) + quantity,
      costCents: (held?.costCents ?? 0n) + notional + cost,
      markCents: bar.openCents,
    });
    orders.push({
      ...base,
      status: quantity === target ? 'FILLED' : 'REDUCED',
      reason: null,
      requestedQuantity: target,
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
  }

  return { portfolio: { cashCents: cash, positions }, orders, fills };
}

export interface PositionSnapshot {
  ticker: string;
  quantity: bigint;
  costCents: bigint;
  // o fechamento de D, ou o último conhecido quando a ação não tem barra em D
  markCents: bigint;
  valueCents: bigint;
  // true: marcada por um fechamento anterior a D
  stale: boolean;
}

export interface MarkResult {
  portfolio: Portfolio;
  positions: PositionSnapshot[];
  positionsValueCents: bigint;
  equityCents: bigint;
}

// Marcação no fechamento de D: o caixa mais cada posição pelo fechamento de D, ou pelo último fechamento conhecido
// quando a ação não tem barra. O estado devolvido guarda as marcações novas para o pregão seguinte.
export function markToMarket(portfolio: Portfolio, bars: ReadonlyMap<string, Bar>): MarkResult {
  const marked = new Map<string, Position>();
  const rows: PositionSnapshot[] = [];
  let value = 0n;
  const ordered = [...portfolio.positions].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [ticker, position] of ordered) {
    const bar = bars.get(ticker);
    const markCents = bar ? bar.closeCents : position.markCents;
    const valueCents = position.quantity * markCents;
    value += valueCents;
    marked.set(ticker, { ...position, markCents });
    rows.push({
      ticker,
      quantity: position.quantity,
      costCents: position.costCents,
      markCents,
      valueCents,
      stale: !bar,
    });
  }
  return {
    portfolio: { cashCents: portfolio.cashCents, positions: marked },
    positions: rows,
    positionsValueCents: value,
    equityCents: portfolio.cashCents + value,
  };
}
