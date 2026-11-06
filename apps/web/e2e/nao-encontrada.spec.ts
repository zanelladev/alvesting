import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// A 404 e o urso (ADR 0035; docs/redesign-rallies/plano.md, f.8; docs/redesign-rallies/relatorios/landing.md). A árvore da 404 vai no payload de
// TODA página (o Next a serializa duas vezes), então o urso não manda o quadro 0 no documento: o HTML leva o texto, os caminhos e o quadro de
// espera (a grade e o sprite do quadro 0, os ladrilhos, pelo CSS), e o texto do quadro chega depois do load, do arquivo pequeno
// (urso-q0.json). O celular nunca pede o arquivo inteiro (o JSON dos quadros e o sprite grande); a partir de 1024 px o urso anda; com
// movimento reduzido, não. A URL que não existe é desenhada no servidor; a 404 do `notFound()` de uma página do app só aparece com
// JavaScript (o Next 16.4.3 manda o documento vazio nesse caso), e por isso ela só é conferida com ele. Roda em pixel-7, iphone-15 e desktop.
test.skip(Boolean(process.env.BASE_URL), 'precisa do build local');

const bearFrame = (page: Page) => page.locator('[data-arte="urso"] pre');
const WHOLE_BEAR = /\/ascii\/arte\/urso\.(json|png)$/;
const BEAR_FRAME_0 = '/ascii/arte/urso-q0.json';

async function wholeBear(request: APIRequestContext) {
  return (await (await request.get('/ascii/arte/urso.json')).json()) as {
    rows: number;
    frames: string[];
  };
}

// Um trecho do quadro 0 que denuncia a arte no documento: a janela de 40 caracteres com mais glifos diferentes (fora os que o HTML e o JSON
// do payload escapam), que nenhuma outra tela tem.
function sampleOf(frame: string): string {
  let best = '';
  for (const line of frame.split('\n')) {
    for (let i = 0; i + 40 <= line.length; i += 1) {
      const window = line.slice(i, i + 40);
      if (/["\\<>&]/.test(window)) continue;
      if (new Set(window).size > new Set(best).size) best = window;
    }
  }
  return best;
}

const PATHS = [
  ['Voltar ao início', '/'],
  ['Ver o ranking', '/ranking'],
  ['Buscar uma ação', '/acoes'],
] as const;

test.describe('404 sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('a URL que não existe responde 404 com o texto, os caminhos e o quadro de espera do urso, sem nenhum byte da arte no documento', async ({
    page,
    request,
  }) => {
    const sample = sampleOf((await wholeBear(request)).frames[0]!);
    expect(sample.length).toBe(40);
    const response = await page.goto('/rota-que-nao-existe');
    expect(response?.status()).toBe(404);
    expect(await response!.text()).not.toContain(sample);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeVisible();
    for (const [name, href] of PATHS) {
      await expect(page.getByRole('main').getByRole('link', { name })).toHaveAttribute(
        'href',
        href,
      );
    }
    // o quadro de espera: a grade com o sprite do quadro 0 nos ladrilhos, e o texto da arte vazio
    await expect(page.locator('[data-arte="urso"]')).toHaveAttribute(
      'style',
      /--sprite:url\(\/ascii\/arte\/urso-q0\.png\)/,
    );
    expect(
      await page
        .locator('[data-arte="urso"] .arte-ladrilho')
        .evaluate((element) => getComputedStyle(element).backgroundImage),
    ).toContain('/ascii/arte/urso-q0.png');
    expect(await bearFrame(page).textContent()).toBe('');
  });
});

// A meta da tarefa (o "atalho de bytes" do relatório da fundação): nenhuma página carrega a arte da 404 no documento.
test('nenhuma página leva a arte do urso no documento: a landing, o Como funciona, o ranking e a própria 404', async ({
  request,
}) => {
  const sample = sampleOf((await wholeBear(request)).frames[0]!);
  for (const path of ['/', '/como-funciona', '/ranking', '/rota-que-nao-existe']) {
    const html = await (await request.get(path)).text();
    expect(html, path).not.toContain(sample);
  }
});

test.describe('404 com JavaScript', () => {
  test('em 390 px o quadro 0 chega depois do load, do arquivo pequeno: nem o JSON dos quadros nem o sprite grande', async ({
    page,
    request,
  }) => {
    const whole = await wholeBear(request);
    await page.setViewportSize({ width: 390, height: 844 });
    const asked: string[] = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (WHOLE_BEAR.test(path) || path === BEAR_FRAME_0) asked.push(path);
    });
    await page.goto('/rota-que-nao-existe');
    await expect.poll(() => bearFrame(page).textContent()).toBe(whole.frames[0]);
    expect(whole.frames[0]!.split('\n')).toHaveLength(whole.rows);
    await page.waitForLoadState('networkidle');
    // o laço só começaria depois do load, quando o navegador fica à toa: o tempo de ele ter começado, se fosse começar
    await page.waitForTimeout(1_000);
    expect(asked).toEqual([BEAR_FRAME_0]);
  });

  test('em 1440 px o quadro 0 chega e o urso anda (o quadro muda)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/rota-que-nao-existe');
    await expect
      .poll(async () => (await bearFrame(page).textContent())?.length ?? 0)
      .toBeGreaterThan(0);
    const first = await bearFrame(page).textContent();
    await expect
      .poll(async () => (await bearFrame(page).textContent()) !== first, { timeout: 10_000 })
      .toBe(true);
  });

  test('com movimento reduzido o quadro 0 chega e fica parado, sem pedir o arquivo inteiro', async ({
    page,
    request,
  }) => {
    const whole = await wholeBear(request);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    const asked: string[] = [];
    page.on('request', (r) => {
      if (WHOLE_BEAR.test(new URL(r.url()).pathname)) asked.push(r.url());
    });
    await page.goto('/rota-que-nao-existe');
    await expect.poll(() => bearFrame(page).textContent()).toBe(whole.frames[0]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1_000);
    expect(await bearFrame(page).textContent()).toBe(whole.frames[0]);
    expect(asked).toEqual([]);
  });

  // a 404 de uma página do app (o modelo que não existe) é a mesma do site, com a casca do site em volta
  test('o modelo que não existe mostra a mesma 404, na casca do site, com status 404', async ({
    page,
  }) => {
    expect((await page.goto('/modelos/nao-existe'))?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeVisible();
    for (const [name, href] of PATHS) {
      await expect(page.getByRole('main').getByRole('link', { name })).toHaveAttribute(
        'href',
        href,
      );
    }
    await expect(page.getByRole('contentinfo')).toContainText(
      'Arena acadêmica com dinheiro fictício',
    );
    await expect
      .poll(async () => (await bearFrame(page).textContent())?.length ?? 0)
      .toBeGreaterThan(0);
  });
});

test('a moldura do urso é escura nos dois temas', { tag: '@tema' }, async ({ page }) => {
  await page.goto('/rota-que-nao-existe');
  expect(
    await page
      .locator('[data-arte="urso"]')
      .evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor),
  ).toBe('rgb(0, 0, 0)');
});
