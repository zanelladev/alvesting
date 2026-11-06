import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTES, dmy, fetchBars } from './data';
import { abrirMenu } from './menu';

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
    // caixa rolada o axe não consegue medir ("incomplete", não violação), nem o do texto perto da arte do hero: ele vem do projeto das cores
    // (docs/TELAS.md, seção 10: a tinta, o texto e o cinza sobre o canvas preto, de 6,1:1 para cima) e da regra de a arte nunca ficar atrás
    // de texto, e não deste teste.
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
    // abaixo de 1024 px o menu é a folha que o botão "Menu" abre; no desktop, a cápsula já está na tela (e2e/menu.ts)
    await abrirMenu(page);
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

  // Em 360 px o cabeçalho é a marca e o botão "Menu" (ADR 0034): a folha abre por cima da página, sem empurrar nada, e é uma lista, uma
  // linha por tela, com o alvo de 44 px; o Esc a fecha (o `popover` nativo, sem JavaScript).
  test('em 360 px o botão "Menu" tem 44 px, abre a folha com os sete links dentro da largura, e o Esc a fecha', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/ranking');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav).toBeHidden();
    const button = page.getByRole('button', { name: 'Menu', exact: true });
    const buttonBox = (await button.boundingBox())!;
    expect(buttonBox.width).toBeGreaterThanOrEqual(43.95);
    expect(buttonBox.height).toBeGreaterThanOrEqual(43.95);

    await button.click();
    await expect(nav).toBeVisible();
    const links = await nav.getByRole('link').all();
    expect(links).toHaveLength(7);
    for (const link of links) {
      const box = (await link.boundingBox())!;
      expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.x, await link.innerText()).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(360);
    }

    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
  });

  // O toque fora de um `popover` fecha a folha E segue para o que está embaixo (no WebKit o fechamento é no pointerdown, e o clique cai no
  // link que voltou a aparecer): quem só queria fechar o menu saía da página. A folha vai até o pé da tela, e o resto dela, embaixo dos
  // links, é o botão "Fechar o menu".
  test('em 390 px, o toque embaixo dos links fecha a folha e não segue o link da página por baixo', async ({
    page,
    isMobile,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ranking');
    await abrirMenu(page);
    const nav = page.getByRole('navigation', { name: 'Principal' });
    // um link da página que fica bem abaixo do último link da folha: sem a folha até o pé, o dedo cairia nele
    const target = await page.evaluate(() => {
      const last = [...document.querySelectorAll('#menu a')].at(-1)!.getBoundingClientRect();
      for (const link of document.querySelectorAll('main a[href]')) {
        const box = link.getBoundingClientRect();
        if (box.width > 0 && box.top > last.bottom + 24 && box.bottom < innerHeight - 8) {
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
      }
      return null;
    });
    expect(target).not.toBeNull();
    if (isMobile) await page.touchscreen.tap(target!.x, target!.y);
    else await page.mouse.click(target!.x, target!.y);
    await expect(nav).toBeHidden();
    // o tempo de a navegação (suave, pelo link do Next) sair, se fosse sair
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/ranking$/);
  });

  // Pelo teclado, depois do último link o foco ia para a página coberta pela folha aberta (o anel âmbar escondido: WCAG 2.4.11). Com a
  // folha aberta a página por baixo sai da ordem do Tab, e o foco volta ao cabeçalho.
  test('em 390 px, pelo teclado, o foco nunca vai para a página coberta pela folha aberta', async ({
    page,
    isMobile,
  }) => {
    test.skip(
      isMobile,
      'o teclado é o do desktop (o Tab do WebKit do Playwright não percorre links)',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/entrar');
    await page.getByRole('button', { name: 'Menu', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    const places: string[] = [];
    // os sete links, o "Fechar o menu" e a volta ao começo do cabeçalho
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      places.push(
        await page.evaluate(() => {
          const focused = document.activeElement;
          if (!focused || focused === document.body) return 'nada';
          if (focused.closest('#menu')) return 'folha';
          if (focused.closest('header')) return 'cabeçalho';
          return `página: ${focused.outerHTML.slice(0, 60)}`;
        }),
      );
    }
    expect(places.filter((place) => place.startsWith('página'))).toEqual([]);
    expect(places.filter((place) => place === 'folha').length).toBeGreaterThanOrEqual(8);
  });

  // A partir de 1024 px a cápsula e as ações ficam na tela, com a pílula visível de 32 a 36 px dentro da caixa de 44 px: o laço de ROUTES
  // mede os alvos só em 360 px, onde a cápsula não aparece.
  test('em 1280 px a cápsula aparece sem o botão "Menu", e todo link do cabeçalho tem o alvo de 44 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/ranking');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link')).toHaveCount(
      7,
    );
    const links = await page.getByRole('banner').getByRole('link').all();
    expect(links).toHaveLength(8);
    for (const link of links) {
      const box = (await link.boundingBox())!;
      expect(box.width, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(1280);
    }
  });
});

// A moldura (layout.tsx): as laterais são duas linhas de 1 px por fora da coluna de 1200, e não uma caixa de 1202 px com borda por cima de
// tudo. Com a caixa, todo texto da coluna ficava embaixo dela, e o axe do desktop não achava o fundo de nenhum ("incompleto", nem violação
// nem aprovação): uma regressão de cor passaria.
test.describe('moldura', () => {
  test('em 1280 px as duas laterais aparecem, e nada da moldura fica por cima do texto da coluna', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/entrar');
    const lines = page.locator('[data-moldura]');
    await expect(lines).toHaveCount(2);
    const boxes = await lines.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { x: Math.round(box.x), width: Math.round(box.width) };
      }),
    );
    // a coluna, centrada em 1280, vai de 40 a 1240: as laterais ficam 1 px por fora dela
    expect(boxes).toEqual([
      { x: 39, width: 1 },
      { x: 1240, width: 1 },
    ]);
    const covered = await page.evaluate(
      () =>
        [...document.querySelectorAll('main h1, main p, main label')].filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 &&
            document
              .elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              .some((hit) => hit.closest('[data-moldura]'))
          );
        }).length,
    );
    expect(covered).toBe(0);
  });
});
