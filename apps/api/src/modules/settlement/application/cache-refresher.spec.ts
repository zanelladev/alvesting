import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Secret } from '../../../config/secret.js';
import { CALL_TIMEOUT_MS, CacheRefresher, type RefreshResult } from './cache-refresher.js';
import { SettleHandler, type SettleOutcome } from './settle.handler.js';

// A revalidação do site e o purge do Front Door depois de uma liquidação (plano §5.5 e §7; docs/JOBS.md). Nenhum teste chama a
// Azure nem o site de verdade: o fetch e a credencial são falsos, injetados.
const SECRET = 'segredo-de-revalidacao-que-nao-pode-vazar';
const TOKEN = 'token-do-arm-que-nao-pode-vazar';
const ENDPOINT_ID =
  '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-alvesting-prod/providers/Microsoft.Cdn/profiles/afd-alvesting/afdEndpoints/alvesting';
const configured = {
  WEB_INTERNAL_URL: 'https://ca-web.exemplo.azurecontainerapps.io',
  REVALIDATE_SECRET: new Secret(SECRET),
  FRONT_DOOR_ENDPOINT_ID: ENDPOINT_ID,
};

const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal | undefined;
  redirect: RequestInit['redirect'];
}

// o que o fetch falso devolve a cada chamada, na ordem; a lista acaba: 200
function fakeFetch(responses: Array<Response | Error> = []) {
  const calls: Call[] = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: urlOf(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
      redirect: init?.redirect,
    });
    const next = responses.shift() ?? new Response('{}', { status: 200 });
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const credential = (token: Promise<{ token: string; expiresOnTimestamp: number }>) => ({
  getToken: vi.fn(() => token),
});
const goodToken = () =>
  Promise.resolve({ token: TOKEN, expiresOnTimestamp: Date.now() + 3_600_000 });

// tudo que o refresher imprime, para provar que nenhum segredo vai a log
let logged: string[] = [];
beforeEach(() => {
  logged = [];
  const push = (...args: unknown[]) =>
    void logged.push(args.map((a) => JSON.stringify(a)).join(' '));
  vi.spyOn(Logger.prototype, 'log').mockImplementation(push);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(push);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(push);
});
afterEach(() => vi.restoreAllMocks());

describe('CacheRefresher', () => {
  it('pede ao site que revalide e depois limpa o /api/v1/* do Front Door, nessa ordem', async () => {
    const order: string[] = [];
    const { fn, calls } = fakeFetch();
    const spy = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      order.push(urlOf(input).includes('/interno/revalidar') ? 'site' : 'front-door');
      return fn(input, init);
    });
    const cred = credential(goodToken());
    const refresher = new CacheRefresher({ env: configured, fetch: spy, credential: cred });

    const result = await refresher.afterSettle();

    expect(order).toEqual(['site', 'front-door']);
    expect(result).toEqual({ revalidate: 'ok', purge: 'ok' });

    // o site: POST na rota interna, com o segredo no cabeçalho de autorização (nunca na URL nem no corpo)
    expect(calls[0]).toMatchObject({
      url: 'https://ca-web.exemplo.azurecontainerapps.io/interno/revalidar',
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(calls[0]!.url).not.toContain(SECRET);
    expect(calls[0]!.body ?? '').not.toContain(SECRET);

    // o Front Door: a ARM REST do endpoint, na api-version do Bicep (2025-06-01), com o token da identidade do worker
    expect(cred.getToken).toHaveBeenCalledWith(
      'https://management.azure.com/.default',
      expect.anything(),
    );
    expect(calls[1]).toMatchObject({
      url: `https://management.azure.com${ENDPOINT_ID}/purge?api-version=2025-06-01`,
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    });
    expect(JSON.parse(calls[1]!.body!)).toEqual({ contentPaths: ['/api/v1/*'] });
  });

  it('cada chamada de rede tem prazo de 10 s: o worker não fica pendurado num site ou numa Azure que não respondem', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { fn, calls } = fakeFetch();
    await new CacheRefresher({
      env: configured,
      fetch: fn,
      credential: credential(goodToken()),
    }).afterSettle();
    expect(CALL_TIMEOUT_MS).toBe(10_000);
    // o site, o token da identidade e o purge: três prazos, todos do mesmo tamanho
    expect(timeout.mock.calls).toEqual([[CALL_TIMEOUT_MS], [CALL_TIMEOUT_MS], [CALL_TIMEOUT_MS]]);
    for (const call of calls) expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('não segue redirecionamento: o Bearer do site e o token da Azure só vão para onde foram mandados', async () => {
    const { fn, calls } = fakeFetch();
    await new CacheRefresher({
      env: configured,
      fetch: fn,
      credential: credential(goodToken()),
    }).afterSettle();
    expect(calls.map((c) => c.redirect)).toEqual(['error', 'error']);
  });

  it('a credencial da identidade é criada uma vez só: o token fica em cache nela, e a próxima liquidação o reaproveita', async () => {
    const created = vi.fn();
    const getToken = vi.fn(() => goodToken());
    vi.doMock('@azure/identity', () => ({
      DefaultAzureCredential: class {
        constructor() {
          created();
        }
        getToken = getToken;
      },
    }));
    try {
      const { fn } = fakeFetch();
      // sem `credential` injetada: vale a do SDK
      const refresher = new CacheRefresher({ env: configured, fetch: fn });
      await refresher.afterSettle();
      await refresher.afterSettle();
      expect(created).toHaveBeenCalledTimes(1);
      expect(getToken).toHaveBeenCalledTimes(2);
    } finally {
      vi.doUnmock('@azure/identity');
    }
  });

  it('o purge aceita 200 e 202 (a limpeza é assíncrona na Azure)', async () => {
    for (const status of [200, 202]) {
      const { fn } = fakeFetch([new Response('{}'), new Response(null, { status })]);
      const result = await new CacheRefresher({
        env: configured,
        fetch: fn,
        credential: credential(goodToken()),
      }).afterSettle();
      expect(result.purge, String(status)).toBe('ok');
    }
  });

  it('sem as variáveis (dev e o perfil econômico) pula cada passo, com um aviso no log, e não chama nada', async () => {
    const { fn, calls } = fakeFetch();
    const cred = credential(goodToken());
    const result = await new CacheRefresher({ env: {}, fetch: fn, credential: cred }).afterSettle();
    expect(result).toEqual({ revalidate: 'skipped', purge: 'skipped' });
    expect(calls).toEqual([]);
    expect(cred.getToken).not.toHaveBeenCalled();
    expect(logged.join('\n')).toMatch(/pulad/i);
  });

  it('só o site configurado (perfil econômico, sem Front Door): revalida e pula o purge', async () => {
    const { fn, calls } = fakeFetch();
    const result = await new CacheRefresher({
      env: { ...configured, FRONT_DOOR_ENDPOINT_ID: undefined },
      fetch: fn,
    }).afterSettle();
    expect(result).toEqual({ revalidate: 'ok', purge: 'skipped' });
    expect(calls).toHaveLength(1);
  });

  it('a URL do site sem o segredo, ou o segredo sem a URL, não chama o site', async () => {
    for (const env of [
      { ...configured, REVALIDATE_SECRET: undefined },
      { ...configured, WEB_INTERNAL_URL: undefined },
    ]) {
      const { fn, calls } = fakeFetch();
      const result = await new CacheRefresher({
        env: { ...env, FRONT_DOOR_ENDPOINT_ID: undefined },
        fetch: fn,
      }).afterSettle();
      expect(result.revalidate).toBe('skipped');
      expect(calls).toEqual([]);
    }
  });

  describe('falha não derruba nada: registra um evento sem segredo e segue', () => {
    it('o site responde 500: o purge ainda roda e nada é lançado', async () => {
      const { fn, calls } = fakeFetch([new Response('erro', { status: 500 })]);
      const result = await new CacheRefresher({
        env: configured,
        fetch: fn,
        credential: credential(goodToken()),
      }).afterSettle();
      expect(result).toEqual({ revalidate: 'failed', purge: 'ok' });
      expect(calls).toHaveLength(2);
    });

    it('o site responde 401 (segredo trocado): falha registrada, sem repetir o segredo', async () => {
      const { fn } = fakeFetch([new Response('{}', { status: 401 })]);
      const result = await new CacheRefresher({
        env: configured,
        fetch: fn,
        credential: credential(goodToken()),
      }).afterSettle();
      expect(result.revalidate).toBe('failed');
      expect(logged.join('\n')).toContain('401');
    });

    it('o site não responde (rede): falha registrada e o purge segue', async () => {
      const { fn } = fakeFetch([new TypeError(`fetch failed: ${SECRET}`)]);
      const result = await new CacheRefresher({
        env: configured,
        fetch: fn,
        credential: credential(goodToken()),
      }).afterSettle();
      expect(result).toEqual({ revalidate: 'failed', purge: 'ok' });
    });

    it('a Azure recusa o purge (403, sem o papel): falha registrada, o site já foi revalidado', async () => {
      const { fn } = fakeFetch([
        new Response('{}'),
        new Response('{"error":"x"}', { status: 403 }),
      ]);
      const result = await new CacheRefresher({
        env: configured,
        fetch: fn,
        credential: credential(goodToken()),
      }).afterSettle();
      expect(result).toEqual({ revalidate: 'ok', purge: 'failed' });
      expect(logged.join('\n')).toContain('403');
    });

    it('sem token da identidade: o purge falha sem chamar a Azure', async () => {
      const { fn, calls } = fakeFetch();
      const result = await new CacheRefresher({
        env: configured,
        fetch: fn,
        credential: credential(Promise.reject(new Error(`CredentialUnavailable ${TOKEN}`))),
      }).afterSettle();
      expect(result).toEqual({ revalidate: 'ok', purge: 'failed' });
      expect(calls).toHaveLength(1);
    });

    it('as duas falham: resolve do mesmo jeito', async () => {
      const { fn } = fakeFetch([new Error('rede'), new Response('{}', { status: 500 })]);
      const result = await new CacheRefresher({
        env: configured,
        fetch: fn,
        credential: credential(goodToken()),
      }).afterSettle();
      expect(result).toEqual({ revalidate: 'failed', purge: 'failed' });
    });

    it('o log diz por que a rede falhou (o código curto do erro de sistema), sem a mensagem nem o que não for um código', async () => {
      const refused = Object.assign(new TypeError(`fetch failed ${SECRET}`), {
        cause: Object.assign(new Error(`connect ECONNREFUSED ${SECRET}`), { code: 'ECONNREFUSED' }),
      });
      // um "código" que não tem a forma de um (pode ser qualquer texto) não é registrado
      const odd = Object.assign(new TypeError('fetch failed'), { cause: { code: SECRET } });
      const { fn } = fakeFetch([refused, odd]);
      await new CacheRefresher({
        env: { ...configured, FRONT_DOOR_ENDPOINT_ID: undefined },
        fetch: fn,
      }).afterSettle();
      await new CacheRefresher({
        env: { ...configured, FRONT_DOOR_ENDPOINT_ID: undefined },
        fetch: fn,
      }).afterSettle();
      const text = logged.join('\n');
      expect(text).toContain('ECONNREFUSED');
      expect(text).toContain('TypeError');
      expect(text).not.toContain(SECRET);
    });

    it('nenhum segredo vai a log, nem o do site, nem o token, nem o ID da assinatura', async () => {
      const { fn } = fakeFetch([
        new TypeError(`fetch failed ${SECRET}`),
        new Response(`{"token":"${TOKEN}"}`, { status: 500 }),
      ]);
      await new CacheRefresher({
        env: configured,
        fetch: fn,
        credential: credential(goodToken()),
      }).afterSettle();
      const text = logged.join('\n');
      expect(text.length).toBeGreaterThan(0);
      for (const forbidden of [SECRET, TOKEN, '00000000-0000-0000-0000-000000000000', 'Bearer']) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    });
  });
});

// O gancho no SettleHandler: depois da liquidação concluída, e só dela.
describe('SettleHandler: revalidação e purge depois da liquidação', () => {
  const message = {
    type: 'settle',
    seasonId: '01M6D0RFWKKZJBPTWNWN76J316',
    date: '2026-11-03',
  } as const;
  const settled: SettleOutcome = {
    status: 'settled',
    through: '2026-11-03',
    sessions: 1,
    finished: false,
  };

  function handler(options: {
    claim: 'claimed' | 'done';
    settle?: () => Promise<SettleOutcome>;
    cache: { afterSettle: () => Promise<RefreshResult> };
  }) {
    const jobs = {
      claim: vi.fn(() =>
        Promise.resolve(
          options.claim === 'done'
            ? ({ status: 'done' } as const)
            : ({ status: 'claimed', claim: { token: 'c' } } as never),
        ),
      ),
      succeed: vi.fn(() => Promise.resolve()),
      fail: vi.fn(() => Promise.resolve()),
    };
    const instance = new SettleHandler({
      jobs: jobs,
      arena: {} as never,
      closer: {} as never,
      repo: {} as never,
      calendar: {} as never,
      cache: options.cache,
    });
    // a liquidação em si tem os testes dela (settle.handler.integration.spec.ts); aqui só o que vem depois
    vi.spyOn(
      instance as unknown as { settle: () => Promise<SettleOutcome> },
      'settle',
    ).mockImplementation(options.settle ?? (() => Promise.resolve(settled)));
    return { instance, jobs };
  }

  it('depois de concluída (job_run SUCCEEDED), pede a revalidação e o purge uma vez', async () => {
    const afterSettle = vi.fn(() =>
      Promise.resolve<RefreshResult>({ revalidate: 'ok', purge: 'ok' }),
    );
    const { instance, jobs } = handler({ claim: 'claimed', cache: { afterSettle } });
    await expect(instance.execute(message)).resolves.toEqual(settled);
    expect(afterSettle).toHaveBeenCalledTimes(1);
    expect(jobs.succeed).toHaveBeenCalledBefore(afterSettle);
  });

  it('mensagem repetida de uma liquidação já feita não revalida nem limpa de novo', async () => {
    const afterSettle = vi.fn(() =>
      Promise.resolve<RefreshResult>({ revalidate: 'ok', purge: 'ok' }),
    );
    const { instance } = handler({ claim: 'done', cache: { afterSettle } });
    await expect(instance.execute(message)).resolves.toEqual({ status: 'already_done' });
    expect(afterSettle).not.toHaveBeenCalled();
  });

  it('liquidação que falha não revalida nada: o resultado anterior segue valendo', async () => {
    const afterSettle = vi.fn(() =>
      Promise.resolve<RefreshResult>({ revalidate: 'ok', purge: 'ok' }),
    );
    const { instance, jobs } = handler({
      claim: 'claimed',
      settle: () => Promise.reject(new Error('dado incompleto')),
      cache: { afterSettle },
    });
    await expect(instance.execute(message)).rejects.toThrow('dado incompleto');
    expect(afterSettle).not.toHaveBeenCalled();
    expect(jobs.fail).toHaveBeenCalledTimes(1);
  });

  it('a falha da revalidação ou do purge não falha o settle: o job fica SUCCEEDED e a mensagem é concluída', async () => {
    const afterSettle = vi.fn(() => Promise.reject(new Error('o site caiu')));
    const { instance, jobs } = handler({ claim: 'claimed', cache: { afterSettle } });
    await expect(instance.execute(message)).resolves.toEqual(settled);
    expect(jobs.succeed).toHaveBeenCalledTimes(1);
    expect(jobs.fail).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain('falhou depois da liquidação');
    expect(logged.join('\n')).not.toContain('o site caiu');
  });

  it('sem o gancho (o comando settle:event, o ensaio) liquida do mesmo jeito', async () => {
    const jobs = {
      claim: vi.fn(() => Promise.resolve({ status: 'claimed', claim: {} } as never)),
      succeed: vi.fn(() => Promise.resolve()),
      fail: vi.fn(() => Promise.resolve()),
    };
    const instance = new SettleHandler({
      jobs: jobs,
      arena: {} as never,
      closer: {} as never,
      repo: {} as never,
      calendar: {} as never,
    });
    vi.spyOn(
      instance as unknown as { settle: () => Promise<SettleOutcome> },
      'settle',
    ).mockResolvedValue(settled);
    await expect(instance.execute(message)).resolves.toEqual(settled);
  });
});
