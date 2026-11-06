import { LOGO_HEADERS, LOGO_NOT_FOUND, fail } from '@alvesting/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A rota do site que serve o logo de um papel do próprio domínio (ADR 0036, "Como o site mostra"): GET /logos/<TICKER>.svg?v=<versão>, que o
// <LogoDoPapel> põe no <img>. O ticker é conferido antes de chamar a api; o SVG só passa se a api o der como image/svg+xml dentro do teto, com
// o viewBox normalizado, e sai com os cabeçalhos dos logos (LOGO_HEADERS) e o cache longo (a versão está na URL). O resto é 404 sem cache.
// O `fetch` e o ambiente são falsos: nenhum teste chama a api.
vi.mock('server-only', () => ({}));
const { GET } = await import('./route');

const SECRET = 'segredo-sintetico-dos-logos-0123456789abcdef';
const API = 'http://127.0.0.1:4310';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><path fill="#0b7a5c" d="M0 0h56v56H0z"/></svg>';

let fetch: ReturnType<typeof vi.fn>;
function api(respond: () => Response) {
  fetch = vi.fn(() => Promise.resolve(respond()));
  vi.stubGlobal('fetch', fetch);
}
const svgFromApi =
  (body: string, type = 'image/svg+xml') =>
  () =>
    new Response(body, { headers: { 'content-type': type } });
const get = (arquivo: string) =>
  GET(new Request(`http://site.interno/logos/${arquivo}?v=659e50f6c54d8fca`), {
    params: Promise.resolve({ arquivo }),
  });

beforeEach(() => {
  vi.stubEnv('API_INTERNAL_URL', API);
  vi.stubEnv('QUOTES_SECRET', SECRET);
  vi.stubEnv('FRONT_DOOR_ID', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /logos/<TICKER>.svg', () => {
  it('repassa o SVG com o viewBox posto, os cabeçalhos dos logos e o cache de um ano, imutável', async () => {
    api(svgFromApi(SVG));
    const response = await get('PETR4.svg');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><path fill="#0b7a5c" d="M0 0h56v56H0z"/></svg>',
    );
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'image/svg+xml',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      'cache-control': 'public, max-age=31536000, immutable',
    });
    // os cabeçalhos são os do contrato da T1 (packages/contracts/src/internal.ts)
    for (const [key, value] of Object.entries(LOGO_HEADERS)) {
      expect(response.headers.get(key)).toBe(value);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toBe(`${API}/api/v1/interno/logos/PETR4`);
  });

  it('o SVG que já tem viewBox sai byte a byte como a api o deu', async () => {
    const withViewBox =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 0h32v32H0z"/></svg>';
    api(svgFromApi(withViewBox));
    expect(await (await get('SINA3.svg')).text()).toBe(withViewBox);
  });

  it('nada do segredo nem da api na resposta', async () => {
    api(svgFromApi(SVG));
    const response = await get('PETR4.svg');
    const everything = `${JSON.stringify([...response.headers])}${await response.text()}`;
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('4310');
    expect(everything).not.toContain('interno');
  });

  // O ticker é o nome do arquivo que o navegador pediu: A-Z e 0-9, de 4 a 12, com `.svg`, e nada mais (minúsculas inclusive: a URL que o site
  // escreve é sempre em maiúsculas). O caminho com `../` chega aqui já decodificado num segmento só.
  it.each([
    'petr4.svg',
    'Petr4.svg',
    'PETR4',
    'PETR4.SVG',
    'PETR4.png',
    'PETR4.svg.svg',
    '../PETR4.svg',
    '..%2FPETR4.svg',
    '..',
    'PET.svg',
    'ABCDEFGHIJKLM.svg',
    'PETR-4.svg',
    ' PETR4.svg',
    'PETR4.svg ',
    'PETR4\u0000.svg',
    '.svg',
    '',
  ])('o arquivo fora da forma (%j) é 404 sem cache, sem chamar a api', async (arquivo) => {
    api(svgFromApi(SVG));
    const response = await get(arquivo);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  // A forma da rota (A-Z e 0-9, de 4 a 12) é mais larga que a da B3 (as letras e o número do fim): o que só passa na primeira também não
  // chama a api (lib/quotes.ts, readLogoSvg).
  it('o arquivo na forma da rota mas fora da forma da B3 também é 404 sem chamar a api', async () => {
    api(svgFromApi(SVG));
    for (const arquivo of ['ABCD.svg', '1234.svg', 'PETR4X.svg']) {
      expect((await get(arquivo)).status, arquivo).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it(`o papel sem logo (404 ${LOGO_NOT_FOUND} da api) é 404 sem cache`, async () => {
    api(() => Response.json(fail(LOGO_NOT_FOUND, 'Este papel não tem logo'), { status: 404 }));
    const response = await get('PETR4.svg');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBeNull();
  });

  it.each([
    ['HTML', svgFromApi(`<html>${SECRET}</html>`, 'text/html')],
    ['JSON', () => Response.json({ svg: SVG })],
    ['texto', svgFromApi(SVG, 'text/plain')],
    ['acima do teto', svgFromApi(`<svg>${'x'.repeat(200 * 1024)}</svg>`)],
    ['o segredo recusado', () => Response.json(fail('NOT_FOUND', 'Cannot GET'), { status: 404 })],
    ['a api com erro', () => Response.json(fail('INTERNAL_ERROR', 'Erro'), { status: 500 })],
  ])(
    'o que a api deu fora do esperado (%s) é recusado: 404 sem cache, nada repassado',
    async (_name, respond) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        api(respond);
        const response = await get('PETR4.svg');
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toBeNull();
        expect(await response.text()).toBe('');
        expect(log).toHaveBeenCalledTimes(1);
      } finally {
        log.mockRestore();
      }
    },
  );
});
