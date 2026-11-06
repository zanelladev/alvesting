import { inspect } from 'node:util';
import {
  LOGO_NOT_FOUND,
  PUBLIC_CACHE_TTL_SECONDS,
  QUOTES_SECRET_MIN_LENGTH,
  ok,
  fail,
} from '@alvesting/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiDeps } from './api';

// O marcador `server-only` é do Next (o build quebra se um componente de cliente importar o módulo); fora do Next, no vitest, ele não existe.
vi.mock('server-only', () => ({}));
const {
  LOGO_MAX_BYTES,
  LOGOS_TTL_SECONDS,
  REFERENCE_TICKER,
  readBars,
  readLogoSvg,
  readLogos,
  readTape,
} = await import('./quotes');

// A leitura das barras de preço pela rota interna da api (docs/API.md, seção 6; ADR 0033): o SSR manda o segredo do servidor em
// `Authorization: Bearer`, com o X-Azure-FDID, pelo cache de dados do Next (as tags e o tempo de vida da API pública). Nenhum teste chama rede.
const FDID = 'c0ffee00-1234-4abc-8def-0123456789ab';
const SECRET = 'segredo-sintetico-das-cotacoes-0123456789abcdef';
const env = {
  API_INTERNAL_URL: 'http://127.0.0.1:4310',
  FRONT_DOOR_ID: FDID,
  QUOTES_SECRET: SECRET,
};

const BARS = [
  { date: '2026-11-03', openCents: 3_660, highCents: 3_712, lowCents: 3_594, closeCents: 3_690 },
  { date: '2026-11-04', openCents: 3_644, highCents: 3_819, lowCents: 3_569, closeCents: 3_750 },
];

interface Call {
  url: string;
  headers: Record<string, string>;
  init: RequestInit;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(respond: () => Response | Error) {
  const calls: Call[] = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      init: init ?? {},
    });
    const next = respond();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { calls, deps: { fetch: fn as unknown as typeof fetch, env } satisfies ApiDeps };
}

describe('readBars', () => {
  it('chama a rota interna no endereço interno, com o segredo em Bearer e o X-Azure-FDID, e devolve as barras', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ bars: BARS })));
    await expect(readBars('PETR4', deps)).resolves.toEqual(BARS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/interno/barras/PETR4');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0]!.headers['x-azure-fdid']).toBe(FDID);
    expect(calls[0]!.headers.accept).toBe('application/json');
  });

  it('sem FRONT_DOOR_ID (dev e perfil econômico) não manda o X-Azure-FDID, mas manda o segredo', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
    await readBars('PETR4', { ...deps, env: { ...env, FRONT_DOOR_ID: undefined } });
    expect(calls[0]!.headers['x-azure-fdid']).toBeUndefined();
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  // A revalidação que o worker pede depois da liquidação vence a tag `arena`: a leitura tem de estar nela, com o mesmo tempo de vida do
  // Cache-Control público, para a página mostrar a barra nova na primeira leitura depois do settle.
  it('lê pelo cache de dados do Next, com a tag arena e o mesmo tempo de vida da API pública', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
    await readBars('PETR4', deps);
    expect(calls[0]!.init.next).toEqual({ revalidate: PUBLIC_CACHE_TTL_SECONDS, tags: ['arena'] });
    expect(PUBLIC_CACHE_TTL_SECONDS).toBe(300);
    // nunca desliga o cache (no-store ou revalidate 0): o SSR leria a api a cada visita
    expect(calls[0]!.init.cache).toBeUndefined();
  });

  it('o ticker em minúsculas vale, e a referência (BOVA11) é um ticker como os outros', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
    await readBars('petr4', deps);
    await readBars(REFERENCE_TICKER, deps);
    expect(REFERENCE_TICKER).toBe('BOVA11');
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/api/v1/interno/barras/PETR4',
      '/api/v1/interno/barras/BOVA11',
    ]);
  });

  // O ticker vem da URL da página, ou seja, de quem a digitou: só passa o que tem a forma do contrato. Fora dela o recurso não existe (404 do
  // site, sem chamar a api).
  it.each(['..', '../x', 'PETR', 'PETR4/x', 'PETR4?x=1', '%00', 'x'.repeat(40), ' PETR4', ''])(
    'ticker torto (%j) é 404 sem chamar a api',
    async (ticker) => {
      const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
      await expect(readBars(ticker, deps)).rejects.toMatchObject({ status: 404 });
      expect(calls).toEqual([]);
    },
  );

  it('o segredo nunca vai na URL, na query nem no corpo', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
    await readBars('PETR4', deps);
    expect(calls[0]!.url).not.toContain(SECRET);
    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.init.method).toBeUndefined();
  });

  // O cabeçalho vai nesta requisição: um redirecionamento (undici só tira authorization, cookie e host na troca de origem) a levaria a
  // outro endereço.
  it('não segue redirecionamento: o segredo só vai para o endereço da API', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
    await readBars('PETR4', deps);
    expect(calls[0]!.init.redirect).toBe('error');
  });

  // Defeito de configuração do site: a leitura vira ApiError 503 QUOTES_UNCONFIGURED, que o withApiDown mostra como a tela de erro montada no
  // servidor, com o aviso fixo (e não um 500 em branco: o React não renderiza o error.tsx no servidor). O log diz o nome da variável, nunca o valor.
  describe('o segredo não está configurado', () => {
    function loud() {
      return vi.spyOn(console, 'error').mockImplementation(() => undefined);
    }

    it.each([
      ['ausente', undefined],
      ['vazio', ''],
      ['só espaço', '   \n'],
      ['PENDENTE', 'PENDENTE'],
      ['curto demais', 'x'.repeat(QUOTES_SECRET_MIN_LENGTH - 1)],
      ['com espaço no meio', `${'x'.repeat(20)} ${'y'.repeat(20)}`],
      ['com quebra de linha no meio', `${'x'.repeat(20)}\n${'y'.repeat(20)}`],
      ['com tab no meio', `${'x'.repeat(20)}\t${'y'.repeat(20)}`],
      ['com NUL no meio', `${'x'.repeat(20)}\u0000${'y'.repeat(20)}`],
      ['com acento', `${'x'.repeat(20)}ç${'y'.repeat(20)}`],
    ])(
      '%s: ApiError 503 QUOTES_UNCONFIGURED, sem chamar a api e sem repetir o valor',
      async (_name, value) => {
        const log = loud();
        try {
          const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
          const error = await readBars('PETR4', {
            ...deps,
            env: { ...env, QUOTES_SECRET: value },
          }).catch((e: unknown) => e);
          expect(error).toBeInstanceOf(ApiError);
          expect(error).toMatchObject({ status: 503, code: 'QUOTES_UNCONFIGURED' });
          expect(calls).toEqual([]);
          // o log diz o que falta (o nome da variável), e nem ele nem o erro, com a causa, repetem o valor
          expect(log).toHaveBeenCalledTimes(1);
          const logged = String(log.mock.calls[0]![0]);
          expect(logged).toMatch(/QUOTES_SECRET/);
          for (const text of [logged, inspect(error, { depth: null }), String(error)]) {
            if (value && value.trim().length > 4) expect(text).not.toContain(value.trim());
          }
        } finally {
          log.mockRestore();
        }
      },
    );

    // O ticker vem da URL de quem a digitou: o torto é 404 mesmo com a configuração com defeito (a página não vira tela de erro por causa disso).
    it('o ticker torto é 404 antes da conferência do segredo', async () => {
      const log = loud();
      try {
        const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
        for (const ticker of ['..', 'PETR', 'x'.repeat(40)]) {
          await expect(
            readBars(ticker, { ...deps, env: { ...env, QUOTES_SECRET: undefined } }),
          ).rejects.toMatchObject({ status: 404 });
        }
        expect(calls).toEqual([]);
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    });

    it('com exatamente o mínimo de caracteres vale', async () => {
      const { deps } = fakeFetch(() => json(ok({ bars: [] })));
      await expect(
        readBars('PETR4', { ...deps, env: { ...env, QUOTES_SECRET: 'x'.repeat(32) } }),
      ).resolves.toEqual([]);
    });

    // O que o `openssl rand -base64 48` gera (letras, dígitos, + / =) vale; e a quebra de linha do `echo` no fim, que a api também apara,
    // não impede a leitura: o valor mandado é o aparado, o mesmo que a api compara.
    it('aparado nas pontas, como a api: a quebra de linha do fim não vira defeito, e o Bearer leva o valor aparado', async () => {
      const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
      const base64 = 'dGVzdGU+L3NlZ3JlZG8vYmFzZTY0Zm9ybWF0bz09abcdef==';
      await readBars('PETR4', { ...deps, env: { ...env, QUOTES_SECRET: `${base64}\n` } });
      expect(calls[0]!.headers.authorization).toBe(`Bearer ${base64}`);
    });

    // Foi assim que o segredo chegaria ao log (achado da revisão): o `fetch` do Node recusa o cabeçalho com quebra de linha e repete o
    // valor inteiro na mensagem do TypeError, que a página registra com a cadeia de causas. A forma conferida antes do fetch impede o erro.
    it('o valor torto nunca chega ao fetch: nenhum erro, nem a causa, o repete', async () => {
      const log = loud();
      try {
        const bad = `${'x'.repeat(20)}\n${'y'.repeat(20)}`;
        // um fetch que valida o cabeçalho como o do Node e põe o valor na mensagem, como o de verdade
        const validating = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
          new Headers(init?.headers);
          return Promise.resolve(json(ok({ bars: [] })));
        });
        // a premissa: o Headers do Node recusa o valor e o repete na mensagem
        let premise: unknown;
        try {
          new Headers({ authorization: `Bearer ${bad}` });
        } catch (thrown) {
          premise = thrown;
        }
        expect((premise as Error).message).toContain('y'.repeat(20));
        const error = await readBars('PETR4', {
          fetch: validating as unknown as typeof fetch,
          env: { ...env, QUOTES_SECRET: bad },
        }).catch((e: unknown) => e);
        expect(validating).not.toHaveBeenCalled();
        expect(error).toMatchObject({ status: 503, code: 'QUOTES_UNCONFIGURED' });
        for (const text of [inspect(error, { depth: null }), String(log.mock.calls[0]![0])]) {
          expect(text).not.toContain(bad);
          expect(text).not.toContain('y'.repeat(20));
        }
      } finally {
        log.mockRestore();
      }
    });
  });

  // O segredo vai em cabeçalho para o endereço da api: em produção só por TLS (o loopback não sai da máquina), como a api exige do endereço do
  // site. O Bicep injeta https://ca-api.<domínio>; o http://127.0.0.1 do .env.example colado na Azure mandaria o segredo em claro.
  describe('o endereço da api em produção', () => {
    const production = (API_INTERNAL_URL: string) => ({
      ...env,
      NODE_ENV: 'production',
      API_INTERNAL_URL,
    });

    it.each(['http://ca-api.exemplo.internal', 'http://10.0.0.7:4310', 'http://exemplo.test/'])(
      'http fora do loopback (%s): QUOTES_UNCONFIGURED, sem chamar a api e sem repetir o segredo',
      async (url) => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
          const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
          const error = await readBars('PETR4', { ...deps, env: production(url) }).catch(
            (e: unknown) => e,
          );
          expect(error).toMatchObject({ status: 503, code: 'QUOTES_UNCONFIGURED' });
          expect(calls).toEqual([]);
          expect(String(log.mock.calls[0]![0])).toMatch(/API_INTERNAL_URL/);
          expect(String(log.mock.calls[0]![0])).not.toContain(SECRET);
        } finally {
          log.mockRestore();
        }
      },
    );

    it.each([
      'https://ca-api.exemplo.internal',
      'http://127.0.0.1:4310',
      'http://localhost:4310',
      'http://[::1]:4310',
    ])('https, ou http no loopback (%s), vale', async (url) => {
      const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
      await expect(readBars('PETR4', { ...deps, env: production(url) })).resolves.toEqual([]);
      expect(calls).toHaveLength(1);
    });

    it('fora de produção (dev, teste) o http de qualquer endereço vale', async () => {
      const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
      for (const NODE_ENV of ['development', 'test', undefined]) {
        await readBars('PETR4', {
          ...deps,
          env: { ...env, NODE_ENV, API_INTERNAL_URL: 'http://ca-api.exemplo.internal' },
        });
      }
      expect(calls).toHaveLength(3);
    });

    it('endereço ausente ou torto segue com a mensagem da própria leitura (não é QUOTES_UNCONFIGURED)', async () => {
      const { calls, deps } = fakeFetch(() => json(ok({ bars: [] })));
      for (const API_INTERNAL_URL of [undefined, 'não é uma url']) {
        await expect(
          readBars('PETR4', { ...deps, env: { ...production('x'), API_INTERNAL_URL } }),
        ).rejects.toThrow(/API_INTERNAL_URL ausente ou inválida/);
      }
      expect(calls).toEqual([]);
    });
  });

  describe('a api não deu as barras', () => {
    // A rota responde 404 só quando o segredo não vale (ou a api está sem ele): papel desconhecido é lista vazia. Então um 404 aqui é um
    // defeito de configuração, e a página não pode dizer "ação não encontrada" por causa dele.
    it('404 (segredo recusado) vira 502 QUOTES_REFUSED, nunca 404', async () => {
      const { deps } = fakeFetch(() =>
        json(fail('NOT_FOUND', 'Cannot GET /api/v1/interno/barras/PETR4'), 404),
      );
      const error = await readBars('PETR4', deps).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 502, code: 'QUOTES_REFUSED' });
    });

    it('5xx, rede e prazo seguem como os de toda leitura da api', async () => {
      const server = fakeFetch(() => json(fail('INTERNAL_ERROR', 'Erro interno'), 500));
      await expect(readBars('PETR4', server.deps)).rejects.toMatchObject({
        status: 500,
        code: 'INTERNAL_ERROR',
      });
      const down = fakeFetch(() => new TypeError('fetch failed'));
      await expect(readBars('PETR4', down.deps)).rejects.toMatchObject({
        status: 503,
        code: 'UNAVAILABLE',
      });
    });

    it('resposta com campo a mais, ou corpo que não é JSON, é INVALID_RESPONSE', async () => {
      const extra = fakeFetch(() => json(ok({ bars: BARS, volume: 1 })));
      await expect(readBars('PETR4', extra.deps)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
      const html = fakeFetch(() => new Response('<html>502</html>', { status: 200 }));
      await expect(readBars('PETR4', html.deps)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    });

    // O que vai ao log do servidor é o erro inteiro, com a cadeia de causas (o withApiDown o imprime): `inspect` mostra o que o log mostraria.
    it('nenhum erro, nem a causa dele, repete o segredo (o que o log do servidor imprime)', async () => {
      const refused = fakeFetch(() =>
        json(fail('NOT_FOUND', `Cannot GET /x?token=${SECRET}`), 404),
      );
      const down = fakeFetch(() => new TypeError('fetch failed'));
      const server = fakeFetch(() => json(fail('INTERNAL_ERROR', `falha com ${SECRET}`), 500));
      for (const { deps } of [refused, down, server]) {
        const error = await readBars('PETR4', deps).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).message).not.toContain(SECRET);
        expect(inspect(error, { depth: null })).not.toContain(SECRET);
      }
    });
  });
});

// A fita da home pela rota interna (docs/API.md, seção 6): o universo da semana do último ciclo, com o fechamento e o anterior de cada papel.
// A mesma leitura das barras: o segredo em Bearer, o cache de dados com a tag `arena`, e os mesmos erros de configuração e de recusa.
describe('readTape', () => {
  const TAPE = {
    date: '2026-11-04',
    rows: [
      { ticker: 'VALE3', closeCents: 6_100, previousCloseCents: null },
      { ticker: 'PETR4', closeCents: 3_200, previousCloseCents: 3_100 },
    ],
  };

  it('chama a fita no endereço interno, com o segredo em Bearer e o X-Azure-FDID, pelo cache de dados, e devolve a data e as linhas', async () => {
    const { calls, deps } = fakeFetch(() => json(ok(TAPE)));
    await expect(readTape(deps)).resolves.toEqual(TAPE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/interno/fita');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0]!.headers['x-azure-fdid']).toBe(FDID);
    expect(calls[0]!.init.next).toEqual({ revalidate: PUBLIC_CACHE_TTL_SECONDS, tags: ['arena'] });
    expect(calls[0]!.init.cache).toBeUndefined();
    expect(calls[0]!.init.redirect).toBe('error');
  });

  it('a resposta vazia (sem ciclo, sem universo ou sem barra) passa como veio', async () => {
    const { deps } = fakeFetch(() => json(ok({ date: null, rows: [] })));
    await expect(readTape(deps)).resolves.toEqual({ date: null, rows: [] });
  });

  it('o segredo ausente ou torto: 503 QUOTES_UNCONFIGURED, sem chamar a api', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const QUOTES_SECRET of [undefined, 'PENDENTE', `${'x'.repeat(20)}\n${'y'.repeat(20)}`]) {
        const { calls, deps } = fakeFetch(() => json(ok(TAPE)));
        await expect(readTape({ ...deps, env: { ...env, QUOTES_SECRET } })).rejects.toMatchObject({
          status: 503,
          code: 'QUOTES_UNCONFIGURED',
        });
        expect(calls).toEqual([]);
      }
    } finally {
      log.mockRestore();
    }
  });

  it('em produção, o endereço da api sem https fora do loopback: QUOTES_UNCONFIGURED, sem chamar a api', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { calls, deps } = fakeFetch(() => json(ok(TAPE)));
      const production = {
        ...env,
        NODE_ENV: 'production',
        API_INTERNAL_URL: 'http://10.0.0.7:4310',
      };
      await expect(readTape({ ...deps, env: production })).rejects.toMatchObject({
        status: 503,
        code: 'QUOTES_UNCONFIGURED',
      });
      expect(calls).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it('404 (segredo recusado) vira 502 QUOTES_REFUSED; o 5xx segue como o de toda leitura', async () => {
    const refused = fakeFetch(() =>
      json(fail('NOT_FOUND', 'Cannot GET /api/v1/interno/fita'), 404),
    );
    await expect(readTape(refused.deps)).rejects.toMatchObject({
      status: 502,
      code: 'QUOTES_REFUSED',
    });
    const server = fakeFetch(() => json(fail('INTERNAL_ERROR', 'Erro interno'), 500));
    await expect(readTape(server.deps)).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  // O contrato é estrito: campo a mais, abertura numa linha, ou a data sem linha (a legenda leria um pregão sem cotação) não passam.
  it.each([
    ['campo a mais', { ...TAPE, universe: 4 }],
    ['abertura na linha', { ...TAPE, rows: [{ ...TAPE.rows[1]!, openCents: 3_150 }] }],
    ['data sem linha', { date: '2026-11-04', rows: [] }],
    ['linha sem data', { date: null, rows: TAPE.rows }],
  ])('resposta fora do contrato (%s) é INVALID_RESPONSE', async (_name, body) => {
    const { deps } = fakeFetch(() => json(ok(body)));
    await expect(readTape(deps)).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
  });
});

// Os logos das ações (ADR 0036; docs/API.md, seção 6): o índice de quem tem logo, com a versão do SVG, e o SVG de um papel, pelas rotas
// internas da api, com o mesmo segredo e as mesmas conferências da fita e das barras. O logo é enfeite: a falha nunca derruba a tela.
describe('readLogos', () => {
  const LOGOS = [
    { ticker: 'ABEV3', version: '40bd304825b00630' },
    { ticker: 'PETR4', version: '659e50f6c54d8fca' },
  ];

  it('chama o índice no endereço interno, com o segredo em Bearer e o X-Azure-FDID, e devolve a lista', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ logos: LOGOS })));
    await expect(readLogos(deps)).resolves.toEqual(LOGOS);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/interno/logos');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0]!.headers['x-azure-fdid']).toBe(FDID);
    expect(calls[0]!.init.redirect).toBe('error');
  });

  // O logo novo chega com a atualização semanal (domingo): uma hora no cache de dados do Next basta, e a liquidação diária (a tag `arena`)
  // não o pede de novo. Nunca no-store: a api seria lida a cada página.
  it('lê pelo cache de dados do Next, por uma hora e sem tag', async () => {
    const { calls, deps } = fakeFetch(() => json(ok({ logos: [] })));
    await expect(readLogos(deps)).resolves.toEqual([]);
    expect(LOGOS_TTL_SECONDS).toBe(3600);
    expect(calls[0]!.init.next).toEqual({ revalidate: 3600 });
    expect(calls[0]!.init.cache).toBeUndefined();
  });

  describe('a falha vira "nenhum logo": a tela mostra os monogramas e nunca cai por isso', () => {
    it.each([
      ['a api fora', () => new TypeError('fetch failed')],
      ['o erro da api', () => json(fail('INTERNAL_ERROR', `falha com ${SECRET}`), 500)],
      [
        'o segredo recusado (o 404 da rota)',
        () => json(fail('NOT_FOUND', `Cannot GET /x?t=${SECRET}`), 404),
      ],
      ['o campo a mais', () => json(ok({ logos: LOGOS, total: 2 }))],
      ['a ordem errada', () => json(ok({ logos: [...LOGOS].reverse() }))],
      ['a versão torta', () => json(ok({ logos: [{ ticker: 'PETR4', version: 'xyz' }] }))],
      ['o corpo que não é JSON', () => new Response('<html>502</html>', { status: 200 })],
    ])('%s: lista vazia, com uma linha de log sem o segredo', async (_name, respond) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const { deps } = fakeFetch(respond);
        await expect(readLogos(deps)).resolves.toEqual([]);
        expect(log).toHaveBeenCalledTimes(1);
        const line = log.mock.calls[0]!.map((part) => inspect(part, { depth: null })).join(' ');
        expect(line).toMatch(/logos/);
        expect(line).not.toContain(SECRET);
      } finally {
        log.mockRestore();
      }
    });

    it('o segredo ausente ou torto: lista vazia, sem chamar a api, e só a linha da configuração (sem o valor)', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const bad = `${'x'.repeat(20)}\n${'y'.repeat(20)}`;
        for (const QUOTES_SECRET of [undefined, 'PENDENTE', bad]) {
          log.mockClear();
          const { calls, deps } = fakeFetch(() => json(ok({ logos: LOGOS })));
          await expect(readLogos({ ...deps, env: { ...env, QUOTES_SECRET } })).resolves.toEqual([]);
          expect(calls).toEqual([]);
          expect(log).toHaveBeenCalledTimes(1);
          expect(String(log.mock.calls[0]![0])).toMatch(/QUOTES_SECRET/);
          expect(String(log.mock.calls[0]![0])).not.toContain('y'.repeat(20));
        }
      } finally {
        log.mockRestore();
      }
    });
  });
});

describe('readLogoSvg', () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><path d="M0 0h56v56H0z"/></svg>';
  const svgResponse = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Response(body, { status: 200, headers: { 'content-type': 'image/svg+xml', ...headers } });
  function quiet() {
    return vi.spyOn(console, 'error').mockImplementation(() => undefined);
  }

  it('pede o SVG do papel no endereço interno, com o segredo em Bearer, sem cache e sem seguir redirecionamento, e devolve o texto', async () => {
    const { calls, deps } = fakeFetch(() => svgResponse(SVG));
    await expect(readLogoSvg('PETR4', deps)).resolves.toBe(SVG);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:4310/api/v1/interno/logos/PETR4');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0]!.headers['x-azure-fdid']).toBe(FDID);
    expect(calls[0]!.headers.accept).toBe('image/svg+xml');
    // o navegador guarda o SVG pela URL com a versão; o cache de dados guardaria o SVG velho sob a versão nova
    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.next).toBeUndefined();
    expect(calls[0]!.init.redirect).toBe('error');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('o image/svg+xml com charset também vale', async () => {
    const { deps } = fakeFetch(() =>
      svgResponse(SVG, { 'content-type': 'image/svg+xml; charset=utf-8' }),
    );
    await expect(readLogoSvg('PETR4', deps)).resolves.toBe(SVG);
  });

  it(`o papel sem logo (404 ${LOGO_NOT_FOUND}) é nulo, sem log`, async () => {
    const log = quiet();
    try {
      const { deps } = fakeFetch(() => json(fail(LOGO_NOT_FOUND, 'Este papel não tem logo'), 404));
      await expect(readLogoSvg('PETR4', deps)).resolves.toBeNull();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it.each(['petr4', 'PETR', 'PETR4.svg', '../PETR4', 'PETR4/x', '%00', 'X'.repeat(13), ''])(
    'o ticker fora da forma da B3 (%j) é nulo, sem chamar a api e sem log',
    async (ticker) => {
      const log = quiet();
      try {
        const { calls, deps } = fakeFetch(() => svgResponse(SVG));
        await expect(readLogoSvg(ticker, deps)).resolves.toBeNull();
        expect(calls).toEqual([]);
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    },
  );

  describe('o que não se repassa: nulo, com uma linha de log do ticker e do motivo, nunca o segredo nem o corpo', () => {
    it.each([
      [
        'o segredo recusado (404 sem o código)',
        () => json(fail('NOT_FOUND', `Cannot GET /x?t=${SECRET}`), 404),
      ],
      ['o erro da api', () => json(fail('INTERNAL_ERROR', `falha com ${SECRET}`), 500)],
      ['a api fora', () => new TypeError(`fetch failed ${SECRET}`)],
      [
        'outro tipo de conteúdo (HTML)',
        () => svgResponse(`<html>${SECRET}</html>`, { 'content-type': 'text/html' }),
      ],
      ['outro tipo de conteúdo (JSON)', () => json(ok({ svg: SVG }))],
      ['sem tipo de conteúdo', () => new Response(SVG, { status: 200, headers: {} })],
      [
        'acima do teto pelo Content-Length',
        () => svgResponse(SVG, { 'content-length': String(LOGO_MAX_BYTES + 1) }),
      ],
      [
        'acima do teto lido do corpo',
        () => svgResponse(`<svg>${'x'.repeat(LOGO_MAX_BYTES)}</svg>`),
      ],
      [
        'o corpo que não é UTF-8',
        () => svgResponse(new Uint8Array([0x3c, 0x73, 0xff, 0xfe, 0x3e])),
      ],
    ])('%s', async (_name, respond) => {
      const log = quiet();
      try {
        const { deps } = fakeFetch(respond);
        await expect(readLogoSvg('PETR4', deps)).resolves.toBeNull();
        expect(log).toHaveBeenCalledTimes(1);
        const line = log.mock.calls[0]!.map((part) => inspect(part, { depth: null })).join(' ');
        expect(line).toContain('PETR4');
        expect(line).not.toContain(SECRET);
        expect(line).not.toContain('<svg');
      } finally {
        log.mockRestore();
      }
    });

    // A conexão que cai no meio do corpo (ou o prazo de 10 s, que vale para a leitura dele) não pode virar exceção: a rota daria 500.
    it('o corpo que falha no meio da leitura: nulo, com uma linha de log, sem exceção', async () => {
      const log = quiet();
      try {
        const broken = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('<svg'));
            controller.error(new TypeError(`terminated ${SECRET}`));
          },
        });
        const { deps } = fakeFetch(() => svgResponse(broken));
        await expect(readLogoSvg('PETR4', deps)).resolves.toBeNull();
        expect(log).toHaveBeenCalledTimes(1);
        const line = log.mock.calls[0]!.map((part) => inspect(part, { depth: null })).join(' ');
        expect(line).toContain('PETR4');
        expect(line).not.toContain(SECRET);
      } finally {
        log.mockRestore();
      }
    });

    it('o teto é o da T1 (200 KB, o CHECK da tabela), e exatamente o teto passa', async () => {
      expect(LOGO_MAX_BYTES).toBe(204_800);
      const body = `<svg>${'x'.repeat(LOGO_MAX_BYTES - '<svg></svg>'.length)}</svg>`;
      const { deps } = fakeFetch(() => svgResponse(body));
      await expect(readLogoSvg('PETR4', deps)).resolves.toBe(body);
    });

    it('o segredo ausente: nulo, sem chamar a api, e só a linha da configuração', async () => {
      const log = quiet();
      try {
        const { calls, deps } = fakeFetch(() => svgResponse(SVG));
        await expect(
          readLogoSvg('PETR4', { ...deps, env: { ...env, QUOTES_SECRET: undefined } }),
        ).resolves.toBeNull();
        expect(calls).toEqual([]);
        expect(log).toHaveBeenCalledTimes(1);
        expect(String(log.mock.calls[0]![0])).toMatch(/QUOTES_SECRET/);
      } finally {
        log.mockRestore();
      }
    });

    it('o endereço da api ausente: nulo, sem chamar nada', async () => {
      const log = quiet();
      try {
        const { calls, deps } = fakeFetch(() => svgResponse(SVG));
        await expect(
          readLogoSvg('PETR4', { ...deps, env: { ...env, API_INTERNAL_URL: undefined } }),
        ).resolves.toBeNull();
        expect(calls).toEqual([]);
        expect(log).toHaveBeenCalledTimes(1);
        expect(String(log.mock.calls[0]![0])).toMatch(/API_INTERNAL_URL/);
      } finally {
        log.mockRestore();
      }
    });
  });
});
