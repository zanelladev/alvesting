import { describe, expect, it, vi } from 'vitest';
import { ok } from '@alvesting/contracts';
import { ApiError, type ApiDeps } from './api';
import { readAdmin } from './admin';

// As leituras do painel de admin no servidor (etapa 10, parte 2; docs/TELAS.md): dado de operação, de uma pessoa só. Nunca pelo cache de
// dados do Next (apiGetFresh: sem tags, sem revalidate), com o cookie da sessão e o X-Azure-FDID, e cada resposta validada pelo schema do
// contrato. Nenhum teste chama rede.
const FDID = 'c0ffee00-1234-4abc-8def-0123456789ab';
const env = { API_INTERNAL_URL: 'http://127.0.0.1:4310', FRONT_DOOR_ID: FDID };
const COOKIE = 'alvesting.session_token=token-sintetico';

const COSTS = { month: '2026-11', capMicroUsd: 40_000_000, spentMicroUsd: 0, rows: [] };
const JOBS = { jobs: [], failures: [], fetchStates: [], queues: [] };
const SEASONS = { seasons: [] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; headers: Record<string, string>; init: RequestInit }> = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      init: init ?? {},
    });
    const path = new URL(url).pathname;
    const route = routes[path];
    return Promise.resolve(route ? route() : json(ok(null), 404));
  });
  return { calls, deps: { fetch: fn as unknown as typeof fetch, env } satisfies ApiDeps };
}

const ROUTES = {
  '/api/v1/admin/jobs': () => json(ok(JOBS)),
  '/api/v1/admin/costs': () => json(ok(COSTS)),
  '/api/v1/admin/seasons': () => json(ok(SEASONS)),
};

describe('readAdmin', () => {
  it('lê jobs, custos e temporadas da api, validados pelo contrato', async () => {
    const { deps } = fakeFetch(ROUTES);
    expect(await readAdmin(COOKIE, deps)).toEqual({ jobs: JOBS, costs: COSTS, seasons: SEASONS });
  });

  it('nunca pelo cache de dados do Next: no-store, sem revalidate nem tags; o cookie e o X-Azure-FDID vão, e nada de redirecionamento', async () => {
    const { calls, deps } = fakeFetch(ROUTES);
    await readAdmin(COOKIE, deps);
    expect(calls.map((c) => new URL(c.url).pathname).sort()).toEqual([
      '/api/v1/admin/costs',
      '/api/v1/admin/jobs',
      '/api/v1/admin/seasons',
    ]);
    for (const call of calls) {
      expect(call.init.cache).toBe('no-store');
      expect(call.init).not.toHaveProperty('next');
      expect(call.init.redirect).toBe('error');
      expect(call.headers.cookie).toBe(COOKIE);
      expect(call.headers['x-azure-fdid']).toBe(FDID);
      expect(new URL(call.url).search).toBe('');
    }
  });

  it('a api fora do contrato (campo a mais) é erro 502, nunca dado mostrado', async () => {
    const { deps } = fakeFetch({
      ...ROUTES,
      '/api/v1/admin/costs': () => json(ok({ ...COSTS, prompt: 'texto' })),
    });
    await expect(readAdmin(COOKIE, deps)).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('o erro da api sobe com o status e o código, para a página decidir (401 entrar, 403 a página não existe)', async () => {
    const forbidden = fakeFetch({
      ...ROUTES,
      '/api/v1/admin/jobs': () =>
        json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'x' } }, 403),
    });
    const error = await readAdmin(COOKIE, forbidden.deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});
