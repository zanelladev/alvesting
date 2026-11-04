import { PORTFOLIO_LIMITS, type Position, type Totals } from '@alvesting/contracts';
import { divRound, safeNumber } from '../../settlement/domain/money.js';

// As posições da carteira (plano §11, etapa 12; docs/API.md, seção 9): os lançamentos somados por ticker, com o preço médio, o valor de mercado
// e o P&L. As contas são em bigint (centavos exatos); só o preço médio e o percentual arredondam, os dois pela regra do domínio (`divRound`: o
// mais próximo, com o meio indo para longe do zero). O que sai é número JSON exato: `safeNumber` recusa o que perderia precisão.
//
// O pior caso cabe em inteiro seguro (packages/contracts, portfolio-rules.ts): 200 lançamentos somam até 2 × 10^13 centavos de custo e 2 × 10^8
// ações. O valor de mercado (ações × fechamento) de toda a carteira só cabe em inteiro seguro com um fechamento de até R$ 450.000,00 por ação
// (`maxCloseCents`): uma barra acima disso não é cotação (o `daily_bar` só exige close_cents >= 0, sem teto), e a posição sai "sem fechamento",
// como a de um ticker sem barra, em vez de a leitura inteira dar 500 para todo detentor do papel. Com esse teto o valor, o P&L em centavos e a
// soma deles cabem sempre. O PERCENTUAL é o que sai do inteiro seguro antes (custo de centavos sobre valor alto: a partir de uns R$ 9.007 por
// ação com 1 centavo por 1.000.000 de ações): ele vira nulo, e o resto da posição vale.

// O lançamento como o repositório o lê. `costCents` é bigint, como no banco.
export interface LotRecord {
  id: string;
  ticker: string;
  quantity: number;
  costCents: bigint;
  boughtOn: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// O último fechamento de um ticker: o `close_cents` da barra mais recente do papel e o dia dela (AAAA-MM-DD).
export interface CloseRow {
  ticker: string;
  date: string;
  closeCents: bigint;
}

const BPS = 10_000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_CLOSE = BigInt(PORTFOLIO_LIMITS.maxCloseCents);

// O P&L sobre o custo em pontos-base, no ponto-base mais próximo; nulo quando o resultado perderia precisão em JSON.
const bpsOf = (pnl: bigint, cost: bigint): number | null => {
  const bps = divRound(pnl * BPS, cost);
  return bps > MAX_SAFE || bps < -MAX_SAFE ? null : Number(bps);
};

export function consolidate(
  lots: ReadonlyArray<Pick<LotRecord, 'ticker' | 'quantity' | 'costCents'>>,
  closes: ReadonlyArray<CloseRow>,
): { positions: Position[]; totals: Totals } {
  const sums = new Map<string, { quantity: bigint; cost: bigint }>();
  for (const lot of lots) {
    const sum = sums.get(lot.ticker) ?? { quantity: 0n, cost: 0n };
    sum.quantity += BigInt(lot.quantity);
    sum.cost += lot.costCents;
    sums.set(lot.ticker, sum);
  }
  const closeOf = new Map(closes.map((close) => [close.ticker, close]));

  const positions: Position[] = [];
  let cost = 0n;
  let pricedCost = 0n;
  let value = 0n;
  for (const ticker of [...sums.keys()].sort()) {
    const { quantity, cost: positionCost } = sums.get(ticker)!;
    cost += positionCost;
    const base = {
      ticker,
      quantity: safeNumber(quantity),
      costCents: safeNumber(positionCost),
      avgPriceCents: safeNumber(divRound(positionCost, quantity)),
    };
    const close = closeOf.get(ticker);
    if (!close || close.closeCents > MAX_CLOSE) {
      positions.push({
        ...base,
        closeCents: null,
        closeDate: null,
        valueCents: null,
        pnlCents: null,
        pnlBps: null,
      });
      continue;
    }
    const positionValue = quantity * close.closeCents;
    const pnl = positionValue - positionCost;
    pricedCost += positionCost;
    value += positionValue;
    positions.push({
      ...base,
      closeCents: safeNumber(close.closeCents),
      closeDate: close.date,
      valueCents: safeNumber(positionValue),
      pnlCents: safeNumber(pnl),
      pnlBps: bpsOf(pnl, positionCost),
    });
  }

  const priced = positions.filter((position) => position.closeCents !== null).length;
  const pnl = value - pricedCost;
  return {
    positions,
    totals: {
      costCents: safeNumber(cost),
      pricedCostCents: safeNumber(pricedCost),
      valueCents: priced > 0 ? safeNumber(value) : null,
      pnlCents: priced > 0 ? safeNumber(pnl) : null,
      pnlBps: priced > 0 ? bpsOf(pnl, pricedCost) : null,
      unpriced: positions.length - priced,
    },
  };
}
