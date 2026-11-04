import { describe, expect, it, vi } from 'vitest';
import { ok, type Portfolio } from '@alvesting/contracts';
import { type ApiDeps } from './api';
import { readPortfolio } from './wallet';

// A leitura da carteira no servidor (etapa 12, parte 2; docs/TELAS.md, seção 9): dado de uma pessoa e dinheiro. Nunca pelo cache de dados do
// Next (apiGetFresh: no-store, sem tags, sem revalidate), com o cookie da sessão e o X-Azure-FDID, e a resposta validada pelo schema do
// contrato. Nenhum teste chama rede.
const FDID = 'c0ffee00-1234-4abc-8def-0123456789ab';
const env = { API_INTERNAL_URL: 'http://127.0.0.1:4310', FRONT_DOOR_ID: FDID };
const COOKIE = 'alvesting.session_token=token-sintetico';

const WALLET: Portfolio = {
  lots: [
    {
      id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      ticker: 'MOVE3',
      quantity: 100,
      costCents: 355_000,
      boughtOn: '2026-10-15',
      createdAt: '2026-11-03T12:00:00.000Z',
      updatedAt: '2026-11-03T12:00:00.000Z',
    },
  ],
  positions: [
    {
      ticker: 'MOVE3',
      quantity: 100,
      costCents: 355_000,
      avgPriceCents: 3_550,
      closeCents: 4_000,
      closeDate: '2026-11-09',
      valueCents: 400_000,
      pnlCents: 45_000,
      pnlBps: 1_268,
    },
  ],
  totals: {
    costCents: 355_000,
    pricedCostCents: 355_000,
    valueCents: 400_000,
    pnlCents: 45_000,
    pnlBps: 1_268,
    unpriced: 0,
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(respond: () => Response) {
  const calls: Array<{ url: string; headers: Record<string, string>; init: RequestInit }> = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      init: init ?? {},
    });
    return Promise.resolve(respond());
  });
  return { calls, deps: { fetch: fn as unknown as typeof fetch, env } satisfies ApiDeps };
}

describe('readPortfolio', () => {
  it('lê a carteira da api, validada pelo contrato', async () => {
    const { deps } = fakeFetch(() => json(ok(WALLET)));
    expect(await readPortfolio(COOKIE, deps)).toEqual(WALLET);
  });

  it('nunca pelo cache de dados do Next: no-store, sem revalidate nem tags; o cookie e o X-Azure-FDID vão, e nada de redirecionamento', async () => {
    const { calls, deps } = fakeFetch(() => json(ok(WALLET)));
    await readPortfolio(COOKIE, deps);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(new URL(call!.url).pathname).toBe('/api/v1/me/portfolio');
    // a rota não tem parâmetro nenhum (a api recusa query com 400)
    expect(new URL(call!.url).search).toBe('');
    expect(call!.init.cache).toBe('no-store');
    expect(call!.init).not.toHaveProperty('next');
    expect(call!.init.redirect).toBe('error');
    expect(call!.headers.cookie).toBe(COOKIE);
    expect(call!.headers['x-azure-fdid']).toBe(FDID);
  });

  it('a api fora do contrato (campo a mais, estado misturado) é erro 502, nunca dado mostrado', async () => {
    const extra = fakeFetch(() => json(ok({ ...WALLET, userId: '01JABCDEFGHJKMNPQRSTVWXYZ1' })));
    await expect(readPortfolio(COOKIE, extra.deps)).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
    // fechamento sem a data: o contrato recusa o estado misturado
    const mixed = fakeFetch(() =>
      json(ok({ ...WALLET, positions: [{ ...WALLET.positions[0], closeDate: null }] })),
    );
    await expect(readPortfolio(COOKIE, mixed.deps)).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('o erro da api sobe com o status e o código, para a página decidir (401 entrar, 403 a conta)', async () => {
    const unauthorized = fakeFetch(() =>
      json({ success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'x' } }, 401),
    );
    await expect(readPortfolio(COOKIE, unauthorized.deps)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    const consent = fakeFetch(() =>
      json({ success: false, data: null, error: { code: 'CONSENT_REQUIRED', message: 'x' } }, 403),
    );
    await expect(readPortfolio(COOKIE, consent.deps)).rejects.toMatchObject({
      status: 403,
      code: 'CONSENT_REQUIRED',
    });
  });

  it('a api fora do ar é 503, sem o texto do erro de baixo', async () => {
    const fn = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    await expect(
      readPortfolio(COOKIE, { fetch: fn as unknown as typeof fetch, env }),
    ).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE' });
  });
});
