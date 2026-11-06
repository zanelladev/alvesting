import { ok } from '@alvesting/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

// O auxiliar das telas: a versão do logo de cada papel, com o índice lido uma vez por requisição. O `cache` do React só memoriza dentro de uma
// renderização no servidor (fora dela, no vitest, ele repassa): aqui ele é trocado por um que memoriza, para provar que as telas que pedem a
// versão de vinte papéis leem o índice uma vez só.
vi.mock('server-only', () => ({}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    let memo: { value: R } | undefined;
    return (...args: A) => (memo ??= { value: fn(...args) }).value;
  },
}));
const { versoesDosLogos } = await import('./logos');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('versoesDosLogos', () => {
  it('o índice vira o mapa ticker → versão, lido uma vez por requisição', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://127.0.0.1:4310');
    vi.stubEnv('QUOTES_SECRET', 'segredo-sintetico-dos-logos-0123456789abcdef');
    const fetch = vi.fn(() =>
      Promise.resolve(
        Response.json(ok({ logos: [{ ticker: 'PETR4', version: '659e50f6c54d8fca' }] })),
      ),
    );
    vi.stubGlobal('fetch', fetch);

    const first = await versoesDosLogos();
    const again = await versoesDosLogos();
    expect(first.get('PETR4')).toBe('659e50f6c54d8fca');
    expect(first.get('VALE3')).toBeUndefined();
    expect(again).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
