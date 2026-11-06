import { PUBLIC_CACHE_TTL_SECONDS, ok, fail } from '@alvesting/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  API_TIMEOUT_MS,
  ApiError,
  apiGet,
  apiGetFresh,
  isNotFound,
  reader,
  type ApiDeps,
} from './api';

// O cliente de dados do site: o SSR chama a API pelo endereço interno, manda o X-Azure-FDID, valida a resposta com o schema do
// contrato e marca a leitura com as tags de cache do Next. Nenhum teste chama rede: o fetch é falso.
const FDID = 'c0ffee00-1234-4abc-8def-0123456789ab';
const env = { API_INTERNAL_URL: 'http://127.0.0.1:4310', FRONT_DOOR_ID: FDID };
const schema = z.strictObject({ nome: z.string(), n: z.number().int() });

interface Call {
  url: string;
  headers: Record<string, string>;
  init: RequestInit;
}

function fakeFetch(respond: () => Response | Promise<Response> | Error) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      init: init ?? {},
    });
    const next = respond();
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, deps: { fetch: fn as unknown as typeof fetch, env } satisfies ApiDeps };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiGet', () => {
  it('chama /api/v1 no endereço interno, manda o X-Azure-FDID e devolve o dado validado', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await expect(apiGet('/arena/current', schema, { tags: ['arena'] }, deps)).resolves.toEqual({
      nome: 'a',
      n: 1,
    });
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/arena/current');
    expect(calls[0]!.headers['x-azure-fdid']).toBe(FDID);
    expect(calls[0]!.headers.accept).toBe('application/json');
  });

  it('sem FRONT_DOOR_ID (dev e perfil econômico) não manda o cabeçalho', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await apiGet(
      '/x',
      schema,
      { tags: ['arena'] },
      { ...deps, env: { API_INTERNAL_URL: env.API_INTERNAL_URL } },
    );
    expect(calls[0]!.headers['x-azure-fdid']).toBeUndefined();
  });

  it('o endereço aceita barra no fim e não duplica o caminho', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await apiGet(
      '/x',
      schema,
      { tags: ['arena'] },
      { ...deps, env: { API_INTERNAL_URL: 'https://ca-api.exemplo.io/' } },
    );
    expect(calls[0]!.url).toBe('https://ca-api.exemplo.io/api/v1/x');
  });

  it('marca a leitura com as tags de cache do Next e o mesmo tempo de vida do cache público', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await apiGet('/x', schema, { tags: ['arena', 'news'] }, deps);
    expect(calls[0]!.init.next).toEqual({
      revalidate: PUBLIC_CACHE_TTL_SECONDS,
      tags: ['arena', 'news'],
    });
    expect(PUBLIC_CACHE_TTL_SECONDS).toBe(300);
  });

  describe('de fetch', () => {
    afterEach(() => vi.restoreAllMocks());

    it('cada leitura tem prazo de 10 s: uma api que não responde não pendura a página', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
      await apiGet('/x', schema, { tags: ['arena'] }, deps);
      expect(API_TIMEOUT_MS).toBe(10_000);
      expect(timeout.mock.calls).toEqual([[API_TIMEOUT_MS]]);
      expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    });

    // O X-Azure-FDID vai na requisição: um redirecionamento da API (ou de quem a imitar) não pode levá-lo para outro endereço
    // (o undici só tira authorization, cookie e host na troca de origem).
    it('não segue redirecionamento: o X-Azure-FDID só vai para o endereço da API', async () => {
      const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
      await apiGet('/x', schema, { tags: ['arena'] }, deps);
      expect(calls[0]!.init.redirect).toBe('error');
    });
  });

  it('monta a query string sem os valores ausentes e com o que precisa de escape', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await apiGet(
      '/decisions',
      schema,
      { tags: ['arena'], query: { action: 'BUY', cursor: undefined, limit: 5, q: 'a&b=c d' } },
      deps,
    );
    const url = new URL(calls[0]!.url);
    expect([...url.searchParams]).toEqual([
      ['action', 'BUY'],
      ['limit', '5'],
      ['q', 'a&b=c d'],
    ]);
    expect(url.search).not.toContain('&b=c');
  });

  describe('o que a API devolve fora do contrato', () => {
    it('resposta com campo a mais é erro, e o corpo não vai para a mensagem', async () => {
      const { deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1, snippet: 'texto-privado' })));
      const error = await apiGet('/x', schema, { tags: ['arena'] }, deps).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('INVALID_RESPONSE');
      expect((error as ApiError).message).not.toContain('texto-privado');
    });

    it('JSON torto, HTML e corpo vazio viram INVALID_RESPONSE', async () => {
      for (const body of ['<html>502</html>', '', '{"success":']) {
        const { deps } = fakeFetch(() => new Response(body, { status: 200 }));
        await expect(apiGet('/x', schema, { tags: ['arena'] }, deps)).rejects.toMatchObject({
          code: 'INVALID_RESPONSE',
        });
      }
    });

    it('o erro do envelope vira ApiError com o status e o código da API', async () => {
      const { deps } = fakeFetch(() => json(fail('NOT_FOUND', 'Competidor não encontrado'), 404));
      const error = await apiGet('/competitors/x', schema, { tags: ['arena'] }, deps).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });

    it('403 da trava de origem e 5xx sem envelope também viram ApiError, com o status', async () => {
      for (const status of [403, 502, 503]) {
        const { deps } = fakeFetch(() => new Response('Bad gateway', { status }));
        await expect(apiGet('/x', schema, { tags: ['arena'] }, deps)).rejects.toMatchObject({
          status,
        });
      }
    });

    it('status de sucesso com corpo de erro do envelope não passa como dado', async () => {
      const { deps } = fakeFetch(() => json(fail('INTERNAL_ERROR', 'Erro interno'), 200));
      await expect(apiGet('/x', schema, { tags: ['arena'] }, deps)).rejects.toBeInstanceOf(
        ApiError,
      );
    });
  });

  it('falha de rede e prazo vencido viram ApiError 503 UNAVAILABLE: a página trata todo ApiError do mesmo jeito, e o detalhe fica só na causa', async () => {
    const refused = new TypeError('fetch failed', {
      cause: new Error('connect ECONNREFUSED 10.0.0.7:8080'),
    });
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    for (const failure of [refused, timeout]) {
      const { deps } = fakeFetch(() => failure);
      const error = await apiGet('/x', schema, { tags: ['arena'] }, deps).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 503, code: 'UNAVAILABLE', cause: failure });
      // o endereço interno da API não vai para a mensagem
      expect((error as ApiError).message).toBe('API respondeu 503 (UNAVAILABLE)');
    }
  });

  it('sem API_INTERNAL_URL falha dizendo o que falta, sem chamar nada', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await expect(apiGet('/x', schema, { tags: ['arena'] }, { ...deps, env: {} })).rejects.toThrow(
      /API_INTERNAL_URL/,
    );
    await expect(
      apiGet('/x', schema, { tags: ['arena'] }, { ...deps, env: { API_INTERNAL_URL: 'banana' } }),
    ).rejects.toThrow(/API_INTERNAL_URL/);
    expect(calls).toEqual([]);
  });
});

describe('as leituras tipadas', () => {
  const empty = fakeFetch(() => json(ok({})));

  // Cada leitura aponta para a rota do §9 e carrega as tags que a revalidação do site conhece.
  it.each([
    ['arenaCurrent', () => reader(empty.deps).arenaCurrent(), '/arena/current', ['arena']],
    ['seasons', () => reader(empty.deps).seasons({ limit: 5 }), '/seasons?limit=5', ['arena']],
    [
      'leaderboard',
      () => reader(empty.deps).leaderboard('ensaio'),
      '/seasons/ensaio/leaderboard',
      ['arena'],
    ],
    ['equity', () => reader(empty.deps).equity('ensaio'), '/seasons/ensaio/equity', ['arena']],
    [
      'randomBaseline',
      () => reader(empty.deps).randomBaseline('ensaio'),
      '/seasons/ensaio/random-baseline',
      ['arena'],
    ],
    [
      'competitor',
      () => reader(empty.deps).competitor('gemini-4-argon'),
      '/competitors/gemini-4-argon',
      ['arena'],
    ],
    [
      'competitor (temporada)',
      () => reader(empty.deps).competitor('gemini-4-argon', 'ensaio'),
      '/competitors/gemini-4-argon?season=ensaio',
      ['arena'],
    ],
    ['cycle', () => reader(empty.deps).cycle('2026-11-04'), '/cycles/2026-11-04', ['arena']],
    [
      'decisions',
      () => reader(empty.deps).decisions({ action: 'SELL' }),
      '/decisions?action=SELL',
      ['arena'],
    ],
    ['news', () => reader(empty.deps).news({ ticker: 'PETR4' }), '/news?ticker=PETR4', ['news']],
    ['searchStocks', () => reader(empty.deps).searchStocks('petr'), '/stocks?q=petr', ['arena']],
    ['stock', () => reader(empty.deps).stock('PETR4'), '/stocks/PETR4', ['arena', 'news']],
  ] as const)('%s', async (_name, call, path, tags) => {
    empty.calls.length = 0;
    await call().catch(() => undefined); // o corpo vazio não passa no schema; o que importa é a chamada
    expect(empty.calls[0]!.url).toBe(`http://127.0.0.1:4310/api/v1${path}`);
    expect(empty.calls[0]!.init.next?.tags).toEqual(tags);
  });

  // O segmento do caminho vem da URL da página, ou seja, de quem a digitou. `encodeURIComponent` deixa o `..` passar, e o `new URL` o
  // resolve: `stock('..')` pediria /api/v1/ e `leaderboard('..')`, /api/v1/leaderboard. Só passa o que tem a forma do contrato.
  describe('o segmento do caminho tem a forma do contrato, ou o recurso não existe (nenhuma chamada)', () => {
    it.each([
      ['competitor', (r: ReturnType<typeof reader>) => r.competitor('..')],
      ['competitor', (r: ReturnType<typeof reader>) => r.competitor('../me/portfolio')],
      ['competitor', (r: ReturnType<typeof reader>) => r.competitor('Gemini 4 Argon')],
      ['competitor', (r: ReturnType<typeof reader>) => r.competitor('')],
      ['leaderboard', (r: ReturnType<typeof reader>) => r.leaderboard('..')],
      ['leaderboard', (r: ReturnType<typeof reader>) => r.leaderboard('a/b')],
      ['equity', (r: ReturnType<typeof reader>) => r.equity('%2e%2e')],
      ['randomBaseline', (r: ReturnType<typeof reader>) => r.randomBaseline('A_B')],
      ['cycle', (r: ReturnType<typeof reader>) => r.cycle('..')],
      ['cycle', (r: ReturnType<typeof reader>) => r.cycle('2026-02-30')],
      ['cycle', (r: ReturnType<typeof reader>) => r.cycle('0000-01-01')],
      ['cycle', (r: ReturnType<typeof reader>) => r.cycle('2026-11-04/../..')],
      ['stock', (r: ReturnType<typeof reader>) => r.stock('..')],
      ['stock', (r: ReturnType<typeof reader>) => r.stock('PETR4/../..')],
      ['stock', (r: ReturnType<typeof reader>) => r.stock('petr')],
    ])('%s', async (_name, call) => {
      const empty = fakeFetch(() => json(ok({})));
      const error = await call(reader(empty.deps)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(isNotFound(error)).toBe(true);
      expect(empty.calls).toEqual([]);
    });

    it('o que tem a forma do contrato passa: slug, ULID, data e ticker (em minúsculas também)', async () => {
      const empty = fakeFetch(() => json(ok({})));
      const r = reader(empty.deps);
      await r.competitor('claude-opus-5-5').catch(() => undefined);
      await r.leaderboard('01M6D0RFWKKZJBPTWNWN76J316').catch(() => undefined);
      await r.cycle('2026-11-04').catch(() => undefined);
      await r.cycle('01M6D0RFWKKZJBPTWNWN76J316').catch(() => undefined);
      await r.stock('petr4').catch(() => undefined);
      expect(empty.calls.map((c) => new URL(c.url).pathname)).toEqual([
        '/api/v1/competitors/claude-opus-5-5',
        '/api/v1/seasons/01M6D0RFWKKZJBPTWNWN76J316/leaderboard',
        '/api/v1/cycles/2026-11-04',
        '/api/v1/cycles/01M6D0RFWKKZJBPTWNWN76J316',
        '/api/v1/stocks/PETR4',
      ]);
    });
  });
});

// A leitura que NUNCA entra no cache de dados do Next (etapa 11, parte 2): o dado do usuário (GET /api/v1/me) e o que não pode ficar
// velho (os textos legais, que o aceite grava; os provedores de login). Sem `next.revalidate`, sem tags (a revalidação da liquidação
// nem as vê) e `cache: 'no-store'`. O cookie vai só para a api, e só quando a página o passa.
describe('apiGetFresh', () => {
  const COOKIE = 'alvesting.session_token=token-sintetico';

  it('lê sem cache nenhum: no-store, sem revalidate e sem tags', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await expect(apiGetFresh('/me', schema, {}, deps)).resolves.toEqual({ nome: 'a', n: 1 });
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/me');
    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.next).toBeUndefined();
  });

  it('manda o X-Azure-FDID como toda chamada interna, e o cookie quando a página o dá', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await apiGetFresh('/me', schema, { cookie: COOKIE }, deps);
    expect(calls[0]!.headers).toMatchObject({
      'x-azure-fdid': FDID,
      cookie: COOKIE,
      accept: 'application/json',
    });
  });

  it('sem cookie não manda cabeçalho de cookie', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await apiGetFresh('/legal', schema, {}, deps);
    expect(calls[0]!.headers.cookie).toBeUndefined();
  });

  it('as leituras públicas (apiGet) nunca levam cookie, nem a de dado do usuário leva o cache', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await apiGet('/arena/current', schema, { tags: ['arena'] }, deps);
    expect(calls[0]!.headers.cookie).toBeUndefined();
    expect(calls[0]!.init.cache).toBeUndefined();
  });

  it('não segue redirecionamento (o cookie e o X-Azure-FDID só vão ao endereço da api) e tem prazo', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { calls, deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1 })));
    await apiGetFresh('/me', schema, { cookie: COOKIE }, deps);
    expect(calls[0]!.init.redirect).toBe('error');
    expect(timeout).toHaveBeenCalledWith(API_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it('o erro do envelope vira ApiError com o status e o código (401 é a sessão que acabou)', async () => {
    const { deps } = fakeFetch(() => json(fail('UNAUTHORIZED', 'Sessão ausente'), 401));
    await expect(apiGetFresh('/me', schema, { cookie: COOKIE }, deps)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('resposta fora do contrato é erro, e o cookie não vai para a mensagem', async () => {
    const { deps } = fakeFetch(() => json(ok({ nome: 'a', n: 1, senha: 'x' })));
    const error = await apiGetFresh('/me', schema, { cookie: COOKIE }, deps).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect((error as ApiError).message).not.toContain('token-sintetico');
  });

  it('falha de rede vira 503 UNAVAILABLE, como nas outras leituras', async () => {
    const { deps } = fakeFetch(() => new TypeError('fetch failed'));
    await expect(apiGetFresh('/me', schema, { cookie: COOKIE }, deps)).rejects.toMatchObject({
      status: 503,
      code: 'UNAVAILABLE',
    });
  });
});
