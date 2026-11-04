import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTES, dmy, fetchBars } from './data';

// Mobile primeiro (plano §13): em TODA tela, em pixel-7, iphone-15 e desktop, sem rolagem horizontal em 360 px, alvos de toque de
// pelo menos 44 px, acessibilidade (axe) sem violação séria ou crítica, e o aviso fixo com as atribuições. As telas são as de
// ROUTES (e2e/data.ts), sobre o banco sintético. O desktop também roda em 360 px: o que conta é a largura, não o aparelho.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local com o banco sintético');

// A fonte carregada muda a largura do texto: só mede depois dela.
async function loaded(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

for (const route of ROUTES) {
  test.describe(`tela ${route}`, () => {
    test('em 360 px não rola na horizontal, o menu cabe e os alvos de toque têm pelo menos 44 px', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(route);
      await loaded(page);

      const { scrollWidth, clientWidth, bodyWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      expect(bodyWidth).toBeLessThanOrEqual(clientWidth);

      // o cabeçalho inteiro cabe na largura, nenhum link cortado
      for (const link of await page.getByRole('banner').getByRole('link').all()) {
        const box = (await link.boundingBox())!;
        expect(box.x, await link.innerText()).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(360);
      }

      // a medida crua, sem arredondar (43,6 px não vira 44): só uma folga de 0,05 px para o ruído da conta de ponto flutuante
      const small = await page.evaluate(() => {
        const selector =
          'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"]';
        return [...document.querySelectorAll(selector)]
          .filter((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return (
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              box.width > 0 &&
              box.height > 0
            );
          })
          .map((element) => {
            const box = element.getBoundingClientRect();
            return {
              element: `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 30)}"`,
              width: box.width,
              height: box.height,
            };
          })
          .filter(({ width, height }) => width < 43.95 || height < 43.95);
      });
      expect(small).toEqual([]);
    });

    test('não deixa erro no console nem exceção na página (hidratação, recurso que falha)', async ({
      page,
    }) => {
      const problems: string[] = [];
      // a tela 404 responde 404 de propósito, e o Chromium registra o status do próprio documento como erro de recurso
      const expected404 = route === '/rota-que-nao-existe';
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (expected404 && message.text().includes('status of 404')) return;
        problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`exceção: ${error.message}`));
      page.on('requestfailed', (request) => problems.push(`pedido falhou: ${request.url()}`));
      await page.goto(route);
      await loaded(page);
      // dá tempo de a hidratação acontecer e de o rodapé (que chega por streaming) terminar
      await expect(page.getByRole('contentinfo')).toContainText('brapi.dev, pregão de');
      await page.waitForLoadState('networkidle');
      expect(problems).toEqual([]);
    });

    test('acessibilidade (axe): nenhuma violação séria ou crítica', async ({ page }) => {
      await page.goto(route);
      await loaded(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        serious,
        JSON.stringify(
          serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })),
        ),
      ).toEqual([]);
    });

    // O mesmo axe na largura do celular mais comum, e sem perdoar nada (nem violação moderada ou leve): o teste acima roda na largura do
    // aparelho de cada projeto (412, 393 e 1280 px). O contraste do texto do gráfico SVG e das células de tabela fora da parte visível da
    // caixa rolada o axe não consegue medir ("incomplete", não violação): ele vem do projeto das cores, que são só #000 e #4a4a4a sobre
    // #f2efe6 (7,4:1 ou mais), e não deste teste.
    test('acessibilidade (axe) em 360 px: nenhuma violação, de qualquer impacto', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(route);
      await loaded(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations,
        JSON.stringify(
          violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target),
          })),
        ),
      ).toEqual([]);
    });

    test('o aviso fixo e as atribuições estão no rodapé', async ({ page, request }) => {
      // a data do pregão vem do último fechamento do BOVA11, que a API pública não entrega: o teste a lê da rota interna, como o site
      const lastBar = (await fetchBars(request, 'BOVA11')).at(-1)!;
      await page.goto(route);
      const footer = page.getByRole('contentinfo');
      await expect(footer).toContainText('Arena acadêmica com dinheiro fictício');
      await expect(footer).toContainText('não é recomendação de investimento');
      await expect(footer).toContainText('não se responsabiliza pelas decisões do usuário');
      await expect(footer).toContainText('Resoluções CVM 19 e 20');
      await expect(footer).toContainText('Contém dados da CVM, licença ODbL');
      await expect(footer).toContainText('Fonte: Banco Central do Brasil');
      // as cotações são da brapi, com o link e a data do dado (chega por streaming: o texto sem data aparece primeiro)
      await expect(footer).toContainText(`Cotações: brapi.dev, pregão de ${dmy(lastBar.date)}`);
      await expect(footer.getByRole('link', { name: /^brapi\.dev/ })).toHaveAttribute(
        'href',
        'https://brapi.dev/',
      );
      // e a B3 não é mais citada como fonte: nenhum link para ela
      await expect(footer.locator('a[href*="b3.com.br"]')).toHaveCount(0);
      for (const source of ['InfoMoney', 'Money Times', 'Seu Dinheiro', 'Agência Brasil']) {
        await expect(footer.getByRole('link', { name: source })).toHaveAttribute(
          'href',
          /^https:\/\//,
        );
      }
    });
  });
}

test.describe('cabeçalho', () => {
  test('a navegação principal lista as telas, na ordem, com o endereço de cada uma', async ({
    page,
  }) => {
    await page.goto('/ranking');
    const nav = page.getByRole('navigation', { name: 'Principal' });
    // os dois últimos são os links fixos da carteira (etapa 12) e da conta (etapa 11): o cabeçalho não lê a sessão, então são os mesmos com
    // ou sem login, e a /carteira e a /conta mandam quem não entrou para a /entrar
    await expect(nav.getByRole('link')).toHaveText([
      'Início',
      'Ranking',
      'Notícias',
      'Ações',
      'Como funciona',
      'Carteira',
      'Conta',
    ]);
    for (const [name, href] of [
      ['Início', '/'],
      ['Ranking', '/ranking'],
      ['Notícias', '/noticias'],
      ['Ações', '/acoes'],
      ['Como funciona', '/como-funciona'],
      ['Carteira', '/carteira'],
      ['Conta', '/conta'],
    ] as const) {
      await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
    await expect(page.getByRole('banner').getByRole('link', { name: 'Alvesting' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  // Sete links em 360 px: o menu quebra em duas linhas, nunca em três (cada link tem o alvo de 44 px, e uma linha a mais empurra a página
  // para baixo em toda tela do site).
  test('em 360 px o menu cabe em no máximo duas linhas, cada link com 44 px de altura e dentro da largura', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/ranking');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const links = await page.getByRole('navigation', { name: 'Principal' }).getByRole('link').all();
    expect(links).toHaveLength(7);
    const rows = new Set<number>();
    for (const link of links) {
      const box = (await link.boundingBox())!;
      rows.add(Math.round(box.y));
      expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.x, await link.innerText()).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(360);
    }
    expect(rows.size).toBeLessThanOrEqual(2);
  });
});
