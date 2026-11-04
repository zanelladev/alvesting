// O custo das LLMs em micro-dólares (1 US$ = 1.000.000), em bigint: sem float no que soma, compara ou grava. O float só
// existe na fronteira, onde o provedor devolve o custo como número JSON (usage.cost), e sai dela já como inteiro.

const MICRO_PER_USD = 1_000_000n;
const USD = /^(\d{1,9})(?:\.(\d{1,6}))?$/;
// Um custo de uma chamada acima disto não é plausível (o provedor errou, ou o campo é outra coisa): vira null, e o custo sai
// da tabela de preços.
const MAX_CALL_USD = 10_000;

export function parseUsdToMicro(text: string): bigint {
  const match = USD.exec(text);
  if (!match) {
    throw new RangeError(
      'Valor em dólares inválido: use dígitos com até 6 casas decimais (ex.: 12.5)',
    );
  }
  const [, whole, fraction = ''] = match;
  return BigInt(whole!) * MICRO_PER_USD + BigInt(fraction.padEnd(6, '0'));
}

// usage.cost do OpenRouter (créditos = dólares). toFixed(6) fixa as casas antes de virar inteiro; valor que não é número
// finito, é negativo ou absurdo vira null.
export function reportedCostMicro(cost: unknown): bigint | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > MAX_CALL_USD) {
    return null;
  }
  return parseUsdToMicro(cost.toFixed(6));
}

// Para o provedor que não informa o custo (Azure OpenAI): tokens x preço por milhão, arredondado para cima (o teto de custo
// nunca pode subestimar o gasto).
export function pricedCostMicro(
  tokens: { promptTokens: number; completionTokens: number },
  pricing: { input: string; output: string },
): bigint {
  const part = (count: number, usdPerMTok: string): bigint =>
    (BigInt(count) * parseUsdToMicro(usdPerMTok) + 999_999n) / 1_000_000n;
  return part(tokens.promptTokens, pricing.input) + part(tokens.completionTokens, pricing.output);
}

export function formatUsd(micro: bigint): string {
  return `${micro / MICRO_PER_USD}.${String(micro % MICRO_PER_USD).padStart(6, '0')}`;
}
