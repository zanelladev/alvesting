import { revalidateTag } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_TAGS } from '../../../lib/cache';
import { POST } from './route';

// O que o e2e (e2e/revalidate.spec.ts) não enxerga: que uma chamada autorizada vence mesmo as tags de cache e que as recusadas
// não vencem nenhuma. O `revalidateTag` só funciona dentro do runtime do Next, então aqui ele é falso.
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const SECRET = 'segredo-sintetico-de-revalidacao-0123456789';
const call = (headers: Record<string, string> = {}) =>
  POST(new Request('http://site.interno/interno/revalidar', { method: 'POST', headers }));

beforeEach(() => {
  vi.stubEnv('REVALIDATE_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /interno/revalidar', () => {
  it('com o segredo certo vence todas as tags de uma vez, sem servir o dado velho (expire: 0)', async () => {
    const response = call({ Authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: { revalidated: [...CACHE_TAGS] },
      error: null,
    });
    expect(vi.mocked(revalidateTag).mock.calls).toEqual(
      CACHE_TAGS.map((tag) => [tag, { expire: 0 }]),
    );
  });

  it('as tags são as que o cliente de dados usa (arena e news)', () => {
    expect([...CACHE_TAGS]).toEqual(['arena', 'news']);
  });

  it.each([
    ['sem cabeçalho', {}],
    ['segredo errado', { Authorization: 'Bearer errado' }],
    ['sem o Bearer', { Authorization: SECRET }],
    ['o segredo mais um caractere', { Authorization: `Bearer ${SECRET}x` }],
    ['o segredo em outro cabeçalho', { 'X-Revalidate-Secret': SECRET }],
  ])('%s: 401, nenhuma tag vencida e o segredo fora da resposta', async (_nome, headers) => {
    const response = call(headers);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.text()).not.toContain(SECRET);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('segredo curto demais (menos de 32 caracteres) vale como desligado: 503, até para quem o conhece', () => {
    vi.stubEnv('REVALIDATE_SECRET', 'curto');
    const response = call({ Authorization: 'Bearer curto' });
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('sem REVALIDATE_SECRET no ambiente a rota fica fechada para todos (503), até para quem manda um segredo', () => {
    for (const value of ['', undefined]) {
      vi.stubEnv('REVALIDATE_SECRET', value);
      const response = call({ Authorization: 'Bearer qualquer' });
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
