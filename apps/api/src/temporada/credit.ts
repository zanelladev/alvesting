// O saldo que ainda dá para gastar no OpenRouter, em micro-dólares: o menor entre o que resta no limite da chave (GET /api/v1/key,
// `limit_remaining`, nulo quando a chave não tem limite) e o que resta na conta (GET /api/v1/credits). Nenhuma das duas consultas gasta
// crédito. Qualquer falha (rede, HTTP fora de 200, formato) sobe com o caminho e o status, nunca com o corpo: quem chama não abre o pregão.
// A regra 5 do operador local (operator.ts) usa isto antes de abrir o ciclo ao vivo.
const BASE_URL = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 15_000;

export async function openRouterRemainingMicroUsd(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<bigint> {
  const read = async (path: string): Promise<Record<string, unknown>> => {
    const response = await fetchFn(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status !== 200) throw new Error(`OpenRouter ${path}: HTTP ${response.status}`);
    const body: unknown = await response.json().catch(() => null);
    const data = (body as { data?: unknown } | null)?.data;
    if (typeof data !== 'object' || data === null) {
      throw new Error(`OpenRouter ${path}: resposta fora do formato`);
    }
    return data as Record<string, unknown>;
  };
  const key = await read('/key');
  const credits = await read('/credits');
  const account =
    dollars(credits.total_credits, '/credits total_credits') -
    dollars(credits.total_usage, '/credits total_usage');
  const remaining =
    key.limit_remaining === null
      ? account
      : Math.min(account, dollars(key.limit_remaining, '/key limit_remaining'));
  return remaining <= 0 ? 0n : BigInt(Math.floor(remaining * 1_000_000));
}

function dollars(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`OpenRouter ${field}: não é um número`);
  }
  return value;
}
