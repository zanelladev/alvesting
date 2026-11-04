// Dinheiro da liquidação: centavos inteiros em bigint, nunca float (CLAUDE.md). Toda divisão que não é exata passa por
// divRound, e a regra é uma só em todo o domínio: o mais próximo, com o meio indo para longe do zero (para cima nos
// valores positivos). O changeBps do briefing chama esta mesma função, para a regra ser uma só. Detalhes e exemplos em
// docs/METODOLOGIA.md.

const BPS = 10_000n;

export function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('divisor deve ser positivo');
  const magnitude = ((n < 0n ? -n : n) * 2n + d) / (2n * d);
  return n < 0n ? -magnitude : magnitude;
}

// Custo de uma operação (compra ou venda) sobre o valor negociado, arredondado para o centavo mais próximo. A taxa é
// parâmetro da temporada, em pontos-base (season.params.tradeCostBps): 3 = 0,03%, o valor do plano. Sem custo mínimo e
// sem slippage (limitações declaradas na METODOLOGIA).
export const tradeCost = (notionalCents: bigint, costBps: bigint): bigint =>
  divRound(notionalCents * costBps, BPS);

// Maior quantidade de ações inteiras cujo valor mais o custo cabe em `limitCents` ao preço `priceCents`. Serve ao
// caixa (a compra nunca passa do que há) e à fatia das referências. O custo cresce junto com o valor, então a conta
// é uma estimativa sem o arredondamento do custo, corrigida em no máximo uma ação.
export function maxShares(limitCents: bigint, priceCents: bigint, costBps: bigint): bigint {
  if (limitCents <= 0n || priceCents <= 0n) return 0n;
  const outlay = (quantity: bigint) =>
    quantity * priceCents + tradeCost(quantity * priceCents, costBps);
  let quantity = (limitCents * BPS) / (priceCents * (BPS + costBps));
  while (outlay(quantity + 1n) <= limitCents) quantity += 1n;
  while (quantity > 0n && outlay(quantity) > limitCents) quantity -= 1n;
  return quantity;
}

// O percentual da decisão (5 a 25 no BUY, 1 a 100 no SELL) vem do JSON do modelo como number. Para não passar float
// para o dinheiro, vira ponto-base (centésimo de ponto percentual) a partir da grafia mais curta do número: 12.5 é
// 1250, 12.345 é 1235 (o terceiro decimal decide e o 5 sobe) e 1.005 é 101, sem o erro da representação binária.
export function percentToBps(percent: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(percent));
  if (!Number.isFinite(percent) || !match) throw new RangeError(`percentual inválido: ${percent}`);
  const [, whole = '0', fraction = ''] = match;
  const padded = fraction.padEnd(3, '0');
  const bps = BigInt(whole + padded.slice(0, 2));
  return padded.charCodeAt(2) >= 53 ? bps + 1n : bps; // 53 = '5'
}

// Para métricas em ponto-base, que são razões pequenas e cabem em number. Recusa o que perderia precisão.
export function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('valor fora do intervalo seguro');
  }
  return Number(value);
}
