import { describe, expect, it } from 'vitest';
import { openRouterRemainingMicroUsd } from './credit.js';

// As duas respostas do OpenRouter no formato conferido em 06/11/2026 com a chave da Temporada 1 (GET /api/v1/key e /api/v1/credits).
const answer = (
  key: Record<string, unknown>,
  credits: Record<string, unknown>,
  status = { key: 200, credits: 200 },
) => {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const fetchFn: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
    const isKey = url.endsWith('/api/v1/key');
    return Promise.resolve(
      new Response(JSON.stringify({ data: isKey ? key : credits }), {
        status: isKey ? status.key : status.credits,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetchFn, seen };
};

describe('openRouterRemainingMicroUsd', () => {
  it('o menor entre o que resta no limite da chave e o que resta na conta, em micro-dólares', async () => {
    const limited = answer({ limit_remaining: 7.5 }, { total_credits: 20, total_usage: 3.25 });
    expect(await openRouterRemainingMicroUsd('sk-or-v1-teste', limited.fetchFn)).toBe(7_500_000n);
    expect(limited.seen.map((s) => s.url)).toEqual([
      'https://openrouter.ai/api/v1/key',
      'https://openrouter.ai/api/v1/credits',
    ]);
    expect(limited.seen.every((s) => s.auth === 'Bearer sk-or-v1-teste')).toBe(true);

    // a conta acaba antes do limite da chave
    const account = answer({ limit_remaining: 20 }, { total_credits: 20, total_usage: 18.5 });
    expect(await openRouterRemainingMicroUsd('k', account.fetchFn)).toBe(1_500_000n);
  });

  it('chave sem limite (limit_remaining nulo): vale o que resta na conta; saldo negativo é zero', async () => {
    const free = answer({ limit_remaining: null }, { total_credits: 20, total_usage: 0.25 });
    expect(await openRouterRemainingMicroUsd('k', free.fetchFn)).toBe(19_750_000n);
    const over = answer({ limit_remaining: -0.2 }, { total_credits: 20, total_usage: 20.2 });
    expect(await openRouterRemainingMicroUsd('k', over.fetchFn)).toBe(0n);
  });

  it('HTTP fora de 200 e resposta fora do formato sobem com o caminho e o status, sem o corpo', async () => {
    const refused = answer({ limit_remaining: 1 }, {}, { key: 401, credits: 200 });
    await expect(openRouterRemainingMicroUsd('k', refused.fetchFn)).rejects.toThrow(
      'OpenRouter /key: HTTP 401',
    );
    const missing = answer({ limit_remaining: 1 }, { total_credits: '20', total_usage: 0 });
    await expect(openRouterRemainingMicroUsd('k', missing.fetchFn)).rejects.toThrow(
      'OpenRouter /credits total_credits: não é um número',
    );
    const absent = answer({}, { total_credits: 20, total_usage: 0 });
    await expect(openRouterRemainingMicroUsd('k', absent.fetchFn)).rejects.toThrow(
      'OpenRouter /key limit_remaining: não é um número',
    );
    const html: typeof fetch = () => Promise.resolve(new Response('<html>', { status: 200 }));
    await expect(openRouterRemainingMicroUsd('k', html)).rejects.toThrow(
      'OpenRouter /key: resposta fora do formato',
    );
  });
});
