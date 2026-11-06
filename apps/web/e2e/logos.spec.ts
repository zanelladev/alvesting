import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  LOGO_HEADERS,
  envelopeSchema,
  internalLogosSchema,
  stockSearchSchema,
} from '@alvesting/contracts';
import { API_URL, QUOTES_SECRET } from './api-server';
import { fetchApi } from './data';

// Os logos das ações no site (ADR 0036, "Como o site mostra"; docs/TELAS.md, "Logos das ações"), sobre o banco sintético do e2e: o seed
// (`arena:ensaio --logos-sinteticos`, apps/api/src/ensaio/synthetic-logos.ts) grava, depois do ensaio, um SVG desenhado à mão para o MOVE3
// (sem viewBox, como 300 dos 357 da brapi) e para o SINA3 (com viewBox); os outros papéis não têm logo. O que se prova: o <img> da rota do
// site nos dois e o monograma nos outros, na lista e na página da ação; a rota com os cabeçalhos dos logos, o cache longo e o viewBox posto;
// os 404; e que o navegador só fala com o próprio site (nunca com a brapi). Nos seis projetos (`@tema`): o claro e o escuro.
test.skip(
  Boolean(process.env.BASE_URL),
  'precisa da api local com o banco sintético e os logos do seed',
);

const COM_LOGO = ['MOVE3', 'SINA3'] as const;
const bearer = { Authorization: `Bearer ${QUOTES_SECRET}` };

// o índice dos logos pela rota interna da api, como o site o lê (o teste não usa nada do site)
async function versions(request: APIRequestContext): Promise<Record<string, string>> {
  const response = await request.get(`${API_URL}/api/v1/interno/logos`, { headers: bearer });
  expect(response.status()).toBe(200);
  const body = envelopeSchema(internalLogosSchema).parse(await response.json());
  if (!body.success) throw new Error(body.error.code);
  return Object.fromEntries(body.data.logos.map(({ ticker, version }) => [ticker, version]));
}

// o SVG guardado, byte a byte, pela rota interna da api
async function stored(request: APIRequestContext, ticker: string): Promise<string> {
  const response = await request.get(`${API_URL}/api/v1/interno/logos/${ticker}`, {
    headers: bearer,
  });
  expect(response.status(), ticker).toBe(200);
  return response.text();
}

// O <img> chegou de verdade (o `loading="lazy"` espera ele chegar perto da tela) e desenhou um SVG.
async function loaded(img: Locator) {
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}

// O que todo logo-imagem tem: o endereço da rota com a versão, decorativo, de tamanho fixo e preguiçoso, num círculo branco com o contorno
// de 1 px por dentro da borda (preto a 10% no claro, branco a 10% no escuro).
async function expectImage(img: Locator, ticker: string, version: string, size: number) {
  await expect(img).toHaveAttribute('src', `/logos/${ticker}.svg?v=${version}`);
  await expect(img).toHaveAttribute('alt', '');
  await expect(img).toHaveAttribute('width', String(size));
  await expect(img).toHaveAttribute('height', String(size));
  await expect(img).toHaveAttribute('loading', 'lazy');
  await expect(img).toHaveAttribute('decoding', 'async');
  await loaded(img);
  const box = (await img.boundingBox())!;
  expect(box.width).toBeCloseTo(size, 0);
  expect(box.height).toBeCloseTo(size, 0);
  const dark = await img.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const style = await img.evaluate((el) => {
    const css = getComputedStyle(el);
    // a cor do contorno pintada num pixel transparente: cada navegador escreve a cor computada de um jeito (lab, oklch, rgba), e os canais
    // não mentem
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.fillStyle = css.outlineColor;
    context.fillRect(0, 0, 1, 1);
    return {
      background: css.backgroundColor,
      radius: css.borderTopLeftRadius,
      outline: `${css.outlineStyle} ${css.outlineWidth} ${css.outlineOffset}`,
      outlineRgba: [...context.getImageData(0, 0, 1, 1).data],
    };
  });
  expect(style.background).toBe('rgb(255, 255, 255)');
  expect(parseFloat(style.radius)).toBeGreaterThanOrEqual(size / 2);
  expect(style.outline).toBe('solid 1px -1px');
  // preto a 10% no claro e branco a 10% no escuro (0,1 × 255 ≈ 26), nunca um cinza da paleta
  const [r, g, b, a] = style.outlineRgba;
  expect([r, g, b]).toEqual(dark ? [255, 255, 255] : [0, 0, 0]);
  expect(Math.abs(a! - 25.5)).toBeLessThanOrEqual(1);
}

async function expectMonogram(monogram: Locator, ticker: string) {
  await expect(monogram).toHaveAttribute('aria-hidden', 'true');
  await expect(monogram).toHaveAttribute('data-inicial', ticker.charAt(0));
  // a letra vem do ::before: fora do texto
  await expect(monogram).toHaveText('');
}

test.describe('os logos das ações', { tag: '@tema' }, () => {
  test('o índice da api tem os dois logos do seed, e só eles', async ({ request }) => {
    expect(Object.keys(await versions(request))).toEqual([...COM_LOGO]);
  });

  test('a lista: o <img> da rota no papel com logo, dentro do link, e o monograma nos outros, sem mudar o texto', async ({
    page,
    request,
  }) => {
    const version = await versions(request);
    const found = await fetchApi(request, '/stocks?q=SIN', stockSearchSchema);
    expect(found.rows.map((r) => r.ticker)).toContain('SINA3');
    expect(found.rows.length).toBeGreaterThan(2);
    await page.goto('/acoes?q=SIN');
    const rows = page.getByRole('list', { name: 'Resultados da busca' }).getByRole('listitem');
    // o texto de cada linha, que o leitor e o e2e das telas leem, continua o ticker e o nome
    await expect(rows).toHaveText(
      found.rows.map((r) => `${r.ticker} ${r.name}`),
      { useInnerText: true },
    );
    for (const [i, { ticker }] of found.rows.entries()) {
      const link = rows.nth(i).getByRole('link', { name: ticker, exact: true });
      await expect(link).toHaveAttribute('href', `/acoes/${ticker}`);
      if (ticker in version) {
        await expect(link.locator('[data-logo]')).toHaveCount(1);
        await expectImage(link.locator('img[data-logo="imagem"]'), ticker, version[ticker]!, 16);
      } else {
        await expect(link.locator('img')).toHaveCount(0);
        await expectMonogram(link.locator('[data-logo="monograma"]'), ticker);
      }
    }

    await page.goto('/acoes?q=MO');
    const move = page.getByRole('link', { name: 'MOVE3', exact: true });
    await expectImage(move.locator('img[data-logo="imagem"]'), 'MOVE3', version.MOVE3!, 16);
  });

  test('a página da ação: o logo maior no cabeçalho, sem mudar o nome do h1; sem logo, o monograma', async ({
    page,
    request,
  }) => {
    const version = await versions(request);
    for (const ticker of COM_LOGO) {
      await page.goto(`/acoes/${ticker}`);
      const h1 = page.getByRole('heading', { level: 1, name: ticker, exact: true });
      await expect(h1).toBeVisible();
      const img = h1.locator('img[data-logo="imagem"]');
      await expectImage(img, ticker, version[ticker]!, 40);
      // na mesma linha do ticker, à esquerda dele e no meio da altura da linha (o <img> corre no texto do h1)
      const { gap, centers } = await img.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.nextSibling!);
        const text = range.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return {
          gap: text.left - box.right,
          centers: text.top + text.height / 2 - (box.top + box.height / 2),
        };
      });
      expect(gap).toBeCloseTo(12, 0);
      expect(Math.abs(centers)).toBeLessThanOrEqual(4);
    }
    await page.goto('/acoes/SINB4');
    const h1 = page.getByRole('heading', { level: 1, name: 'SINB4', exact: true });
    await expect(h1).toBeVisible();
    await expect(h1.locator('img')).toHaveCount(0);
    await expectMonogram(h1.locator('[data-logo="monograma"]'), 'SINB4');
    await expect(h1.locator('[data-logo="monograma"]')).toHaveCSS('width', '40px');
  });

  test('a rota: o SVG guardado, com os cabeçalhos dos logos, o cache de um ano e o viewBox posto no que não tem', async ({
    request,
  }) => {
    const version = await versions(request);
    const raw = await stored(request, 'MOVE3');
    expect(raw).not.toContain('viewBox');
    const root = raw.match(/^<svg[^>]*>/)![0];
    const withViewBox = raw.replace(root, `${root.slice(0, -1)} viewBox="0 0 56 56">`);

    for (const [ticker, expected] of [
      ['MOVE3', withViewBox],
      ['SINA3', await stored(request, 'SINA3')],
    ] as const) {
      const response = await request.get(`/logos/${ticker}.svg?v=${version[ticker]}`);
      expect(response.status(), ticker).toBe(200);
      const headers = response.headers();
      for (const [key, value] of Object.entries(LOGO_HEADERS)) {
        expect(headers[key.toLowerCase()], `${ticker} ${key}`).toBe(value);
      }
      expect(headers['content-security-policy']).toBe(
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      );
      expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(await response.text()).toBe(expected);
      // nada do segredo nem da api na resposta
      const everything = `${JSON.stringify(headers)}${expected}`;
      expect(everything).not.toContain(QUOTES_SECRET);
      expect(everything).not.toContain(API_URL);
      expect(headers['x-powered-by']).toBeUndefined();
    }

    // o HEAD responde os mesmos cabeçalhos, sem corpo
    const head = await request.head(`/logos/MOVE3.svg?v=${version.MOVE3}`);
    expect(head.status()).toBe(200);
    expect(head.headers()['content-type']).toBe('image/svg+xml');
    expect(head.headers()['content-security-policy']).toMatch(/; sandbox$/);
    expect(await head.body()).toHaveLength(0);
  });

  test('o 404: o papel sem logo e o arquivo torto (minúsculas, ../, outra extensão, tamanho errado), sempre sem cache', async ({
    request,
  }) => {
    for (const path of [
      '/logos/SINB4.svg',
      '/logos/ZZZZ3.svg',
      '/logos/move3.svg',
      '/logos/Move3.svg',
      '/logos/..%2FMOVE3.svg',
      '/logos/%2E%2E%2FMOVE3.svg',
      '/logos/MOVE3.png',
      '/logos/MOVE3.SVG',
      '/logos/MOVE3',
      '/logos/MOV.svg',
      '/logos/ABCDEFGHIJKLM.svg',
      '/logos/MOVE3.svg/x',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()['cache-control'], path).toMatch(/no-store/);
      expect(response.headers()['content-type'] ?? '', path).not.toMatch(/svg/);
      // o 404 da rota não tem corpo; o de dois segmentos (/logos/MOVE3.svg/x) é a página 404 do site, em HTML
      if (response.headers()['content-type'] === undefined) {
        expect(await response.text(), path).toBe('');
      } else {
        expect(response.headers()['content-type'], path).toMatch(/^text\/html/);
      }
    }
  });

  test('nenhuma das duas páginas pede nada a outro host além do próprio site (o visitante nunca fala com a brapi)', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    for (const [path, ticker, within] of [
      ['/acoes?q=SIN', 'SINA3', ''],
      // na página da ação, o logo do cabeçalho (o h1): o chip de cada notícia dela também o tem (a T2a, docs/TELAS.md, 4a)
      ['/acoes/MOVE3', 'MOVE3', 'h1 '],
    ] as const) {
      await page.goto(path);
      await loaded(page.locator(`${within}img[src^="/logos/${ticker}.svg"]`));
      await page.waitForLoadState('networkidle');
    }
    const outside = requested.filter(
      (url) => !url.startsWith('data:') && new URL(url).origin !== origin,
    );
    expect(outside).toEqual([]);
    expect(requested.some((url) => url.startsWith(`${origin}/logos/SINA3.svg?v=`))).toBe(true);
    expect(requested.some((url) => url.startsWith(`${origin}/logos/MOVE3.svg?v=`))).toBe(true);
    expect(requested.join('\n')).not.toMatch(/brapi/);
  });

  // As telas com logo do ROUTES (a lista com o MOVE3 e a página dele) já passam pelo axe e pela rolagem de layout.spec.ts; aqui, as que têm o
  // monograma: a lista em que os dois se misturam e a página sem logo.
  for (const path of ['/acoes?q=SIN', '/acoes/SINB4']) {
    test(`${path}: o axe sem violação nenhuma em 360 px, e nenhuma rolagem horizontal de 360 a 1920 px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(path);
      await ready(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
        [],
      );
      const wide: string[] = [];
      for (const width of [360, 390, 412, 768, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (over > 0) wide.push(`${width} px: ${over} px a mais`);
      }
      expect(wide).toEqual([]);
    });
  }
});

// a fonte carregada muda a largura do texto: só mede depois dela
async function ready(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
