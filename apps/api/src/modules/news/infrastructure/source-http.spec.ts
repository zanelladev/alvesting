import { describe, expect, it, vi } from 'vitest';
import { fetchLimited, USER_AGENT } from './source-http.js';
import { urlOf } from '../testing/http.fixture.js';

// A busca de fonte externa (RSS, CVM, BCB) é a fronteira de confiança do worker: só https, só host da lista, com
// prazo, teto de tamanho (já inflado) e sem seguir redirecionamento para fora da lista. Nada de rede aqui: o fetch é
// um falso que devolve Response.

const HOSTS = ['feeds.exemplo.com.br'];
const URL_OK = 'https://feeds.exemplo.com.br/feed/';

type FetchFn = typeof fetch;
const fake = (...responses: Array<Response | Error>) => {
  const queue = [...responses];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: urlOf(input), init: init ?? {} });
    const next = queue.shift();
    if (next === undefined) throw new Error('fetch chamado mais vezes que o esperado');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as FetchFn;
  return { fn, calls };
};
const options = (fetchFn: FetchFn, extra: Record<string, unknown> = {}) => ({
  allowedHosts: HOSTS,
  maxBytes: 1000,
  fetchFn,
  ...extra,
});
const body = (text: string, init: ResponseInit = {}) =>
  new Response(text, { status: 200, ...init });
const stream = (...chunks: number[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    }),
    { status: 200 },
  );

describe('fetchLimited: resposta', () => {
  it('200 devolve o corpo e os validadores da resposta', async () => {
    const f = fake(
      body('<rss/>', {
        headers: { etag: '"abc"', 'last-modified': 'Sun, 01 Nov 2026 10:00:17 GMT' },
      }),
    );
    const result = await fetchLimited(URL_OK, options(f.fn));
    expect(result).toEqual({
      status: 'ok',
      body: Buffer.from('<rss/>'),
      validators: { etag: '"abc"', lastModified: 'Sun, 01 Nov 2026 10:00:17 GMT' },
    });
  });

  it('manda GET com user-agent, accept e o prazo, sem seguir redirecionamento sozinho', async () => {
    const f = fake(body('x'));
    await fetchLimited(URL_OK, options(f.fn, { accept: 'application/rss+xml' }));
    const { init } = f.calls[0]!;
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get('user-agent')).toBe(USER_AGENT);
    expect(headers.get('accept')).toBe('application/rss+xml');
  });

  it('o user-agent se identifica como projeto acadêmico e não leva contato nem segredo', () => {
    expect(USER_AGENT).toMatch(/Alvesting/);
    expect(USER_AGENT).not.toMatch(/@|http/);
  });

  it('com validadores, manda o GET condicional; 304 diz que nada mudou', async () => {
    const f = fake(new Response(null, { status: 304 }));
    const result = await fetchLimited(
      URL_OK,
      options(f.fn, {
        validators: { etag: '"abc"', lastModified: 'Sun, 01 Nov 2026 10:00:17 GMT' },
      }),
    );
    expect(result).toEqual({ status: 'not_modified' });
    const headers = new Headers(f.calls[0]!.init.headers);
    expect(headers.get('if-none-match')).toBe('"abc"');
    expect(headers.get('if-modified-since')).toBe('Sun, 01 Nov 2026 10:00:17 GMT');
  });

  it('sem validadores, não manda cabeçalho condicional', async () => {
    const f = fake(body('x'));
    await fetchLimited(URL_OK, options(f.fn));
    const headers = new Headers(f.calls[0]!.init.headers);
    expect(headers.has('if-none-match')).toBe(false);
    expect(headers.has('if-modified-since')).toBe(false);
  });

  it('404 é "não existe" (o chamador decide); outros erros HTTP lançam sem repetir o corpo', async () => {
    expect(
      await fetchLimited(URL_OK, options(fake(new Response('nada', { status: 404 })).fn)),
    ).toEqual({ status: 'not_found', body: Buffer.from('nada') });
    for (const status of [403, 429, 500, 503]) {
      const f = fake(new Response('SEGREDO-NO-CORPO token=abc123', { status }));
      const error = await fetchLimited(URL_OK, options(f.fn)).catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(String(status));
      expect(message).toContain('feeds.exemplo.com.br');
      expect(message).not.toContain('SEGREDO');
      expect(message).not.toContain('abc123');
    }
  });

  it('um 2xx que não é 200 (204, 206) também é falha', async () => {
    await expect(
      fetchLimited(URL_OK, options(fake(new Response(null, { status: 204 })).fn)),
    ).rejects.toThrow(/204/);
  });
});

describe('fetchLimited: o endereço', () => {
  it('só https, só host da lista, sem usuário e sem porta', async () => {
    const f = fake();
    for (const bad of [
      'http://feeds.exemplo.com.br/feed/',
      'https://outro.exemplo.com.br/feed/',
      'https://feeds.exemplo.com.br.atacante.com/feed/',
      'https://user:senha@feeds.exemplo.com.br/feed/',
      'https://feeds.exemplo.com.br:8443/feed/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      await expect(fetchLimited(bad, options(f.fn)), bad).rejects.toThrow();
    }
    expect(f.fn).not.toHaveBeenCalled();
  });

  it('o host é comparado em minúsculas', async () => {
    const f = fake(body('x'));
    await expect(
      fetchLimited('https://FEEDS.Exemplo.com.br/feed/', options(f.fn)),
    ).resolves.toMatchObject({ status: 'ok' });
  });
});

describe('fetchLimited: redirecionamento', () => {
  const redirect = (location: string, status = 301) =>
    new Response(null, { status, headers: { location } });

  it('segue para outro endereço da própria lista, até 3 vezes', async () => {
    const f = fake(
      redirect('/novo-feed/'),
      redirect('https://feeds.exemplo.com.br/outro/', 302),
      redirect('/ultimo/', 307),
      body('fim'),
    );
    const result = await fetchLimited(URL_OK, options(f.fn));
    expect(result).toMatchObject({ status: 'ok', body: Buffer.from('fim') });
    expect(f.calls.map((c) => c.url)).toEqual([
      URL_OK,
      'https://feeds.exemplo.com.br/novo-feed/',
      'https://feeds.exemplo.com.br/outro/',
      'https://feeds.exemplo.com.br/ultimo/',
    ]);
  });

  it('o validador condicional vai também nos saltos', async () => {
    const f = fake(redirect('/novo/'), new Response(null, { status: 304 }));
    await fetchLimited(URL_OK, options(f.fn, { validators: { etag: '"abc"' } }));
    expect(new Headers(f.calls[1]!.init.headers).get('if-none-match')).toBe('"abc"');
  });

  it('recusa redirecionar para host fora da lista, para http, para endereço interno ou para outro esquema', async () => {
    for (const location of [
      'https://atacante.com/feed',
      'http://feeds.exemplo.com.br/feed',
      'http://169.254.169.254/metadata/identity',
      'https://169.254.169.254/',
      'https://localhost/',
      'file:///etc/passwd',
      'https://user:x@feeds.exemplo.com.br/',
    ]) {
      const f = fake(redirect(location));
      await expect(fetchLimited(URL_OK, options(f.fn)), location).rejects.toThrow();
      expect(f.fn, location).toHaveBeenCalledTimes(1);
    }
  });

  it('mais de 3 saltos, ou salto sem Location, falha', async () => {
    const loop = fake(redirect('/a'), redirect('/b'), redirect('/c'), redirect('/d'));
    await expect(fetchLimited(URL_OK, options(loop.fn))).rejects.toThrow(/redirecion/i);
    const noLocation = fake(new Response(null, { status: 302 }));
    await expect(fetchLimited(URL_OK, options(noLocation.fn))).rejects.toThrow(/redirecion/i);
  });
});

describe('fetchLimited: tamanho e prazo', () => {
  it('content-length acima do teto falha sem ler o corpo', async () => {
    const response = body('x', { headers: { 'content-length': '5000' } });
    const f = fake(response);
    await expect(fetchLimited(URL_OK, options(f.fn))).rejects.toThrow(/grande demais/);
  });

  it('corpo em pedaços que passa do teto (inflado, sem content-length) falha e cancela a leitura', async () => {
    const f = fake(stream(600, 600, 600));
    await expect(fetchLimited(URL_OK, options(f.fn))).rejects.toThrow(/grande demais/);
  });

  it('o teto vale o corpo já descomprimido: o falso entrega o inflado, como o fetch do Node', async () => {
    // 5000 bytes "depois da descompressão", declarados como 200 comprimidos
    const response = new Response(new Uint8Array(5000), { headers: { 'content-length': '200' } });
    await expect(fetchLimited(URL_OK, options(fake(response).fn))).rejects.toThrow(/grande demais/);
  });

  it('corpo exatamente no teto passa', async () => {
    const f = fake(stream(500, 500));
    const result = await fetchLimited(URL_OK, options(f.fn));
    expect(result).toMatchObject({ status: 'ok' });
    expect((result as { body: Buffer }).body.length).toBe(1000);
  });

  it('estoura o prazo: aborta, em vez de esperar para sempre', async () => {
    const hang = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('abortado pelo prazo')));
        }),
    ) as unknown as FetchFn;
    const started = Date.now();
    await expect(fetchLimited(URL_OK, options(hang, { timeoutMs: 30 }))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('o prazo vale também para o corpo que não termina', async () => {
    const never = new Response(new ReadableStream({ start() {} }), { status: 200 });
    const started = Date.now();
    await expect(
      fetchLimited(URL_OK, options(fake(never).fn, { timeoutMs: 30 })),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('falha de rede sobe como erro', async () => {
    await expect(
      fetchLimited(URL_OK, options(fake(new TypeError('fetch failed')).fn)),
    ).rejects.toThrow(/fetch failed/);
  });
});
