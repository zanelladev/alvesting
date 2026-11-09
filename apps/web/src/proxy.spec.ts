import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';

// O repasse de /api/* pelo site, o que dá uma origem só ao navegador no perfil econômico, sem Front Door (ADR 0039; docs/INFRA.md, 2.7).
// O Next aplica o que o proxy devolve assim (node_modules/next/dist/server/lib/router-utils/resolve-routes.js): `x-middleware-rewrite` é o
// destino (uma origem de fora vira um repasse HTTP, router-server.js e proxy-request.js), `x-middleware-override-headers` lista os
// cabeçalhos da requisição que seguem, e `x-middleware-request-<nome>` traz o valor de cada um (o que não está na lista não segue).
const SITE = 'https://ca-web.example.test';
const API = 'https://ca-api.internal.example.test';

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new NextRequest(new URL(path, SITE), {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
  });
}

function forwarded(response: Response) {
  const names = (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .filter(Boolean);
  return {
    destination: response.headers.get('x-middleware-rewrite'),
    headers: Object.fromEntries(
      names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`)]),
    ),
  };
}

beforeEach(() => {
  vi.stubEnv('API_PROXY', 'on');
  vi.stubEnv('API_INTERNAL_URL', API);
  vi.stubEnv('FRONT_DOOR_ID', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy: o repasse de /api/* à api (API_PROXY=on, perfil econômico)', () => {
  it('repassa /api/* ao endereço interno da api, com o caminho e a query como vieram', () => {
    expect(forwarded(proxy(request('/api/v1/health'))).destination).toBe(`${API}/api/v1/health`);
    expect(
      forwarded(proxy(request('/api/auth/verify-email?token=abc&callbackURL=%2Fverificar-email')))
        .destination,
    ).toBe(`${API}/api/auth/verify-email?token=abc&callbackURL=%2Fverificar-email`);
    expect(forwarded(proxy(request('/api'))).destination).toBe(`${API}/api`);
  });

  // o corpo quem leva é o roteador do Next (o clone do corpo, router-server.js); o e2e do econômico prova o login inteiro pelo repasse
  it('o POST do login segue para a api com os cabeçalhos dele: o Origin (que a api confere), o cookie, o tipo e o tamanho do corpo', () => {
    const body = JSON.stringify({ email: 'pessoa@example.test', password: 'senha-de-teste-1' });
    const response = proxy(
      request('/api/auth/sign-in/email', {
        method: 'POST',
        body,
        headers: {
          origin: SITE,
          cookie: '__Secure-alvesting.session_token=abc',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
      }),
    );
    const { destination, headers } = forwarded(response);
    expect(destination).toBe(`${API}/api/auth/sign-in/email`);
    expect(headers).toMatchObject({
      origin: SITE,
      cookie: '__Secure-alvesting.session_token=abc',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    });
  });

  it('regrava o X-Forwarded-For com a entrada da direita (a que o ingress acrescentou): o que o cliente escreveu à esquerda não segue', () => {
    const xff = (value: string) =>
      forwarded(
        proxy(request('/api/auth/sign-in/email', { headers: { 'x-forwarded-for': value } })),
      ).headers['x-forwarded-for'];
    expect(xff('203.0.113.9')).toBe('203.0.113.9');
    expect(xff('198.51.100.7, 10.0.0.1, 203.0.113.9')).toBe('203.0.113.9');
    expect(xff(' 198.51.100.7 ,203.0.113.9 ')).toBe('203.0.113.9');
    expect(xff('198.51.100.7, 2001:db8::1')).toBe('2001:db8::1');
  });

  it('sem um IP válido na direita (ou sem o cabeçalho) nenhum X-Forwarded-For segue', () => {
    const headersOf = (incoming: Record<string, string>) => {
      const result = forwarded(proxy(request('/api/auth/sign-in/email', { headers: incoming })));
      expect(result.destination).toBe(`${API}/api/auth/sign-in/email`);
      return result.headers;
    };
    expect(headersOf({ 'x-forwarded-for': '203.0.113.9, banana' })).not.toHaveProperty(
      'x-forwarded-for',
    );
    expect(headersOf({ 'x-forwarded-for': '203.0.113.9,' })).not.toHaveProperty('x-forwarded-for');
    expect(headersOf({})).not.toHaveProperty('x-forwarded-for');
  });

  it.each([
    '/api/v1/interno/fita',
    '/api/v1/interno/barras/PETR4',
    '/api/v1/interno/logos',
    '/api/v1/interno/logos/PETR4',
    '/api/v1/INTERNO/fita',
    '/api/v1/%69nterno/fita',
    '/api/v1/%2569nterno/fita',
    '/api/v1/x/../interno/fita',
    '/api/v1/interno',
    '/api/interno/qualquer',
  ])(
    'nunca leva %s: 404 igual ao da rota que não existe, sem repasse, mesmo com o segredo certo',
    async (path) => {
      const response = proxy(
        request(path, { headers: { authorization: 'Bearer o-segredo-certo-das-cotacoes' } }),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = (await response.json()) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toMatch(/^Cannot GET \//);
    },
  );

  it('o que não é /api fica no site', () => {
    for (const path of ['/', '/conta', '/apix', '/entrar?proximo=%2Fapi', '/interno/revalidar']) {
      expect(proxy(request(path)).headers.get('x-middleware-rewrite'), path).toBeNull();
    }
  });

  it('do endereço da api só a origem vale: caminho e query dele não entram', () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://127.0.0.1:4310/qualquer?x=1');
    expect(forwarded(proxy(request('/api/v1/health'))).destination).toBe(
      'http://127.0.0.1:4310/api/v1/health',
    );
  });

  it('com o repasse ligado e sem um endereço http(s) da api, 503 no envelope (e nada vai a lugar nenhum)', async () => {
    for (const base of ['', 'banana', 'file:///etc/passwd']) {
      vi.stubEnv('API_INTERNAL_URL', base);
      const response = proxy(request('/api/v1/health'));
      expect(response.status, base).toBe(503);
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'UNAVAILABLE',
      );
    }
  });
});

describe('proxy: sem API_PROXY=on o site não repassa nada (o padrão: quem manda /api/* à api é o Front Door)', () => {
  it.each(['', 'off', 'true', '1'])('API_PROXY="%s": nenhum repasse', (value) => {
    vi.stubEnv('API_PROXY', value);
    const response = proxy(request('/api/v1/health'));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('a trava de origem vem antes do repasse: com FRONT_DOOR_ID e sem o X-Azure-FDID, 403 até no /api', () => {
    vi.stubEnv('FRONT_DOOR_ID', 'c0ffee00-1234-4abc-8def-0123456789ab');
    const response = proxy(request('/api/v1/health'));
    expect(response.status).toBe(403);
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
