import { fail, ok } from '@alvesting/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ApiDeps } from './api';
import { authCookieHeader, readLegal, readMe, readProviders } from './account';

// As leituras do servidor para as telas da conta: o que lê dado do usuário (ou o que não pode ficar velho) nunca passa pelo cache de dados
// do Next, repassa à api só o cookie da sessão e trata a falta de sessão como "ninguém", e não como erro. Nenhum teste chama rede.
const FDID = 'c0ffee00-1234-4abc-8def-0123456789ab';
const env = { API_INTERNAL_URL: 'http://127.0.0.1:4310', FRONT_DOOR_ID: FDID };
const SESSION = 'alvesting.session_token=token-sintetico';

const ME = {
  id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  name: 'Pessoa do teste',
  email: 'pessoa@example.test',
  emailVerified: true,
  role: 'USER',
  consent: {
    upToDate: true,
    documents: [
      {
        document: 'TERMS',
        version: '0.1',
        effectiveDate: '2026-11-02',
        sha256: 'a'.repeat(64),
        acceptedAt: '2026-11-02T12:00:00.000Z',
      },
      {
        document: 'PRIVACY',
        version: '0.1',
        effectiveDate: '2026-11-02',
        sha256: 'b'.repeat(64),
        acceptedAt: '2026-11-02T12:00:00.000Z',
      },
    ],
  },
};

interface Call {
  url: string;
  headers: Record<string, string>;
  init: RequestInit;
}
function fakeFetch(respond: () => Response) {
  const calls: Call[] = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      init: init ?? {},
    });
    return Promise.resolve(respond());
  });
  return { calls, deps: { fetch: fn as unknown as typeof fetch, env } satisfies ApiDeps };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('authCookieHeader', () => {
  it('repassa à api só os cookies da sessão do Better Auth (prefixo alvesting., com ou sem __Secure-), como vieram', () => {
    expect(
      authCookieHeader(
        'alvesting.session_token=a.b%2Bc%3D; __Secure-alvesting.session_token=d; _ga=rastreador; ' +
          'alvesting.dont_remember=true; outro=x; alvestingx=sem-o-ponto; x-alvesting.session_token=no-meio',
      ),
    ).toBe(
      'alvesting.session_token=a.b%2Bc%3D; __Secure-alvesting.session_token=d; alvesting.dont_remember=true',
    );
  });

  it('o valor segue como o navegador mandou: o que está codificado não é decodificado nem codificado de novo', () => {
    // a assinatura do cookie é base64 (+, / e =), e o Better Auth a confere byte a byte
    expect(authCookieHeader('alvesting.session_token=tok%2Fen.sig%2Bnal%3D%3D')).toBe(
      'alvesting.session_token=tok%2Fen.sig%2Bnal%3D%3D',
    );
  });

  it('sem cookie da sessão não há cabeçalho', () => {
    for (const raw of [undefined, null, '', 'outro=x; _ga=1', 'alvesting.sem_igual']) {
      expect(authCookieHeader(raw), String(raw)).toBeUndefined();
    }
  });

  it('um cookie sem valor ou com nome vazio não passa', () => {
    expect(authCookieHeader('alvesting.vazio=; =x; alvesting.ok=1')).toBe(
      'alvesting.vazio=; alvesting.ok=1',
    );
  });
});

describe('readMe', () => {
  it('lê GET /api/v1/me com o cookie da sessão e o X-Azure-FDID, sem cache de dados do Next', async () => {
    const { calls, deps } = fakeFetch(() => json(ok(ME)));
    await expect(readMe(SESSION, deps)).resolves.toEqual(ME);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/me');
    expect(calls[0]!.headers).toMatchObject({ cookie: SESSION, 'x-azure-fdid': FDID });
    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.next).toBeUndefined();
  });

  it('sem cookie não há sessão: nem chama a api', async () => {
    const { calls, deps } = fakeFetch(() => json(ok(ME)));
    await expect(readMe(undefined, deps)).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('a api diz 401 (sessão vencida, adulterada ou de usuário apagado): ninguém, e não um erro', async () => {
    const { deps } = fakeFetch(() => json(fail('UNAUTHORIZED', 'Sessão ausente ou expirada'), 401));
    await expect(readMe(SESSION, deps)).resolves.toBeNull();
  });

  it('qualquer outro erro sobe, para a tela de "a arena não respondeu": 403 da trava, 5xx e a rede', async () => {
    for (const status of [403, 500, 502]) {
      const { deps } = fakeFetch(() => json(fail('INTERNAL_ERROR', 'x'), status));
      await expect(readMe(SESSION, deps), String(status)).rejects.toMatchObject({ status });
    }
    const down = {
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
      env,
    };
    await expect(readMe(SESSION, down)).rejects.toMatchObject({ status: 503 });
  });

  it('resposta fora do contrato (um campo a mais, como um token) é erro, não dado', async () => {
    const { deps } = fakeFetch(() => json(ok({ ...ME, token: 'segredo' })));
    await expect(readMe(SESSION, deps)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('readLegal e readProviders (públicas, mas nunca em cache)', () => {
  it('os textos legais: o aceite grava a versão que a pessoa viu, então texto velho em cache vira 409', async () => {
    const legal = {
      controller: { name: 'Controlador de Teste', contact: 'privacidade@example.test' },
      documents: ['TERMS', 'PRIVACY'].map((document) => ({
        document,
        version: '0.1',
        effectiveDate: '2026-11-02',
        title: 'Título',
        sha256: 'c'.repeat(64),
        text: '# Título',
      })),
    };
    const { calls, deps } = fakeFetch(() => json(ok(legal)));
    await expect(readLegal(deps)).resolves.toEqual(legal);
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/legal');
    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.next).toBeUndefined();
    expect(calls[0]!.headers.cookie).toBeUndefined();
  });

  it('os provedores de login: o botão do Google só aparece com a api configurada', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ google: false })));
    await expect(readProviders(deps)).resolves.toEqual({ google: false });
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/auth/providers');
    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.next).toBeUndefined();
  });
});
