import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MODEL, ROUTES, dmy, fetchBars } from './data';
import { abrirMenu } from './menu';

// Mobile primeiro (plano §13): em TODA tela, em pixel-7, iphone-15 e desktop, sem rolagem horizontal em 360 px, alvos de toque de
// pelo menos 44 px, acessibilidade (axe) sem violação séria ou crítica, e o aviso fixo com as atribuições. As telas são as de
// ROUTES (e2e/data.ts), sobre o banco sintético. O desktop também roda em 360 px: o que conta é a largura, não o aparelho.
// Os testes marcados `@tema` rodam também nos projetos `-escuro` (playwright.config.ts): o tema segue o sistema, e o escuro vale igual.
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
    test(
      'em 360 px não rola na horizontal, a navegação cabe e os alvos de toque têm pelo menos 44 px',
      { tag: '@tema' },
      async ({ page }) => {
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

        // o cabeçalho inteiro (no app, a barra de abas do pé também: ela mora no banner) cabe na largura, nenhum link cortado
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
      },
    );

    // A largura do Rallies (o fechamento da onda): o app enche a tela até a coluna de 1.550 px, e acima dela a coluna fica no centro, com o fio
    // de cada lado (a T2 das linhas, que trouxe os 1920 px: a moldura e os fios de borda a borda comem o respiro do principal, e nada pode
    // passar da largura). Em nenhuma largura do celular ao desktop largo a página rola para o lado (o de 360 px, acima, mede também os alvos).
    test('de 390 a 1920 px não rola na horizontal', async ({ page }) => {
      await page.goto(route);
      await loaded(page);
      const wide: string[] = [];
      for (const width of [390, 412, 768, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (over > 0) wide.push(`${width} px: ${over} px a mais`);
      }
      expect(wide).toEqual([]);
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

    test(
      'acessibilidade (axe): nenhuma violação séria ou crítica',
      { tag: '@tema' },
      async ({ page }) => {
        await page.goto(route);
        await loaded(page);
        const { violations } = await new AxeBuilder({ page }).analyze();
        const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(
          serious,
          JSON.stringify(
            serious.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.map((n) => n.target),
            })),
          ),
        ).toEqual([]);
      },
    );

    // O mesmo axe na largura do celular mais comum, e sem perdoar nada (nem violação moderada ou leve): o teste acima roda na largura do
    // aparelho de cada projeto (412, 393 e 1280 px). É ele que pega o contraste nos dois temas (os projetos `-escuro`). O contraste do texto
    // do gráfico SVG e das células de tabela fora da parte visível da caixa rolada o axe não consegue medir ("incomplete", não violação), nem
    // o do texto perto da arte: ele vem dos tokens (plano do redesenho, seção a.2: o contraste de cada par nos dois temas) e da regra de a
    // arte morar na moldura escura, nunca atrás de texto.
    test(
      'acessibilidade (axe) em 360 px: nenhuma violação, de qualquer impacto',
      { tag: '@tema' },
      async ({ page }) => {
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
      },
    );

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
      // os logos dos laboratórios: as marcas são dos donos (ADR 0035)
      await expect(footer).toContainText(
        'Os nomes e os logos dos modelos são marcas dos seus donos (OpenAI, Anthropic, Google, xAI, DeepSeek e Alibaba Cloud); a Alvesting não tem relação com eles.',
      );
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

// Os dois temas seguem o sistema (ADR 0035), sem botão: o projeto claro e o escuro abrem a mesma tela, e o que muda é o tema que o
// navegador anuncia. Uma tela do site e uma do app.
for (const route of ['/', '/ranking']) {
  test(
    `${route}: o tema é o do sistema, e o navegador sabe dos dois`,
    { tag: '@tema' },
    async ({ page }) => {
      await page.goto(route);
      const dark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
      const look = await page.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      }));
      expect(look).toEqual({
        background: dark ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)',
        scheme: 'light dark',
      });
      // a cor da barra do navegador acompanha o canvas de cada tema; o `color-scheme` também vai no <meta>, antes do CSS
      const themeColors = await page
        .locator('meta[name="theme-color"]')
        .evaluateAll((metas) =>
          metas.map((m) => [m.getAttribute('media'), m.getAttribute('content')]),
        );
      expect(themeColors).toEqual([
        ['(prefers-color-scheme: light)', '#ffffff'],
        ['(prefers-color-scheme: dark)', '#171717'],
      ]);
      await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
        'content',
        'light dark',
      );
    },
  );
}

// A casca do app (components/app-shell.tsx; ADR 0035): a mesma `nav "Principal"` é o trilho de ícones no desktop e a barra de abas no pé
// no celular, e o item da área leva `aria-current="page"` sem JavaScript. O "Mais" abre uma folha `popover` com as telas de apoio.
test.describe('casca do app', () => {
  test('a navegação lista as áreas na ordem, com o endereço de cada uma, e marca a área da tela', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/ranking');
    const nav = page.getByRole('navigation', { name: 'Principal' });
    const links = [
      ['Arena', '/arena'],
      ['Explorar', '/explorar'],
      ['Carteira', '/carteira'],
      ['Chat', '/chat'],
      ['Buscar', '/acoes'],
      ['Conta', '/conta'],
    ] as const;
    await expect(nav.getByRole('link')).toHaveText(links.map(([name]) => name));
    for (const [name, href] of links) {
      await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
    await expect(nav.getByRole('button', { name: 'Mais', exact: true })).toBeVisible();
    // o /ranking é da área da arena: só ela marcada
    await expect(nav.locator('[aria-current="page"]')).toHaveText(['Arena']);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Alvesting' })).toHaveAttribute(
      'href',
      '/',
    );
    // cada área marca o seu item; entrar e criar conta moram na área da conta (o grupo (auth), na casca do app, desde 06/11/2026)
    for (const [route, area] of [
      ['/acoes', 'Explorar'],
      ['/chat', 'Chat'],
      ['/entrar?proximo=%2Fconta', 'Conta'],
      ['/cadastro', 'Conta'],
    ] as const) {
      await page.goto(route);
      await expect(nav.locator('[aria-current="page"]')).toHaveText([area]);
    }
  });

  // Em 1280 px o trilho de 80 px fica à esquerda, e todo link do banner tem o alvo de 44 px (o laço de ROUTES mede os alvos só em 360 px).
  test('em 1280 px é o trilho de 80 px à esquerda, sem botão "Menu", e todo link do banner tem 44 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/ranking');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
    const banner = (await page.getByRole('banner').boundingBox())!;
    expect(banner).toMatchObject({ x: 0, y: 0, width: 80, height: 720 });
    const links = await page.getByRole('banner').getByRole('link').all();
    expect(links).toHaveLength(7);
    for (const link of links) {
      const box = (await link.boundingBox())!;
      expect(box.width, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(80);
    }
    // o principal começa depois do trilho
    expect((await page.getByRole('main').boundingBox())!.x).toBeGreaterThanOrEqual(80);
  });

  // A largura do Rallies (medida nas capturas dele, .data/rallies-referencia/): em 1440 px o app não tem teto, a barra secundária encosta no
  // trilho (400 px na arena, 300 no explorar), o conteúdo começa 24 px depois do fio dela e vai até 24 px da borda; o chat fica no centro da
  // área toda.
  test('em 1440 px o app enche a largura, como o Rallies: a barra encosta no trilho, e o chat fica no centro', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const measure = () =>
      page.evaluate(() => {
        const box = (el: Element | null) => el!.getBoundingClientRect();
        const main = box(document.querySelector('main'));
        const bar = document.querySelector('#carteiras, nav[aria-labelledby="explorar-titulo"]');
        return {
          main: [main.x, main.width],
          bar: bar ? [box(bar.parentElement).x, box(bar.parentElement).width] : null,
          h1: box(document.querySelector('h1')).x,
        };
      });
    await page.goto('/arena');
    expect(await measure()).toEqual({ main: [80, 1360], bar: [80, 400], h1: 504 });
    await page.goto('/explorar');
    expect(await measure()).toEqual({ main: [80, 1360], bar: [80, 300], h1: 404 });
    await page.goto('/chat');
    const chat = (await page.getByRole('group', { name: 'O chat, desligado' }).boundingBox())!;
    expect(Math.abs(chat.x + chat.width / 2 - (80 + 1360 / 2))).toBeLessThanOrEqual(1);
  });

  // A moldura do Rallies, medida na captura do Artur (a Arena logado numa janela de 1.917 px, .data/rallies-referencia/arena-1917-logado.png):
  // com a janela mais larga que a coluna do app (1.550 px), a coluna fica no centro, com o fio de cada lado (o da esquerda é o do trilho, o da
  // direita é o da coluna, como lá) e o fundo fora dela, e o trilho, a barra, o principal e o menu "Mais" andam juntos. Os fios entre as
  // carteiras vão de uma borda da barra à outra, e os da faixa dos modelos, de uma borda do principal à outra (antes paravam no respiro). Em
  // 1440 px a coluna enche a tela, sem os fios dos lados, como antes.
  test('em 1920 px a coluna do app fica no centro, com o fio de cada lado, e os fios vão de borda a borda', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/arena');
    const measure = () =>
      page.evaluate(() => {
        const box = (el: Element | null) => {
          const b = el!.getBoundingClientRect();
          return [b.x, b.width];
        };
        const app = document.querySelector('.app')!;
        const rail = document.querySelector('.app-topo')!;
        return {
          app: box(app),
          rail: box(rail),
          main: box(document.querySelector('main')),
          bar: box(document.querySelector('#carteiras')!.parentElement),
          h1: box(document.querySelector('h1'))[0],
          faixa: box(document.querySelector('[role="region"][aria-label^="Modelos e Sorteio"]')),
          carteiras: [...document.querySelectorAll('[data-carteira]')].map(box),
          sides: [getComputedStyle(rail).borderLeftWidth, getComputedStyle(app).borderRightWidth],
          outside: [92, 1828].map((x) => document.elementFromPoint(x, 540)?.tagName),
        };
      });
    const wide = await measure();
    // (1920 − 1550) ÷ 2 = 185: o trilho de 80 px, a barra de 400 e o principal até o fio da direita (1550 − 80 − 1)
    expect(wide.app).toEqual([185, 1550]);
    expect(wide.rail).toEqual([185, 80]);
    expect(wide.main).toEqual([265, 1469]);
    expect(wide.bar).toEqual([265, 400]);
    expect(wide.h1).toBe(265 + 400 + 24);
    expect(wide.sides).toEqual(['1px', '1px']);
    expect(wide.outside).toEqual(['BODY', 'BODY']);
    // a faixa vai do fio da barra ao fio da direita, e cada carteira enche a barra até o fio dela
    expect(wide.faixa).toEqual([665, 1734 - 665]);
    expect(wide.carteiras.length).toBeGreaterThan(0);
    for (const carteira of wide.carteiras) expect(carteira).toEqual([265, 399]);
    // o menu "Mais" abre ao lado do trilho, onde quer que a coluna esteja
    await page.getByRole('button', { name: 'Mais', exact: true }).click();
    const menu = (await page.locator('#mais').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(265);
    expect(menu.x).toBeLessThanOrEqual(281);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    const narrow = await measure();
    expect(narrow.app).toEqual([0, 1440]);
    expect(narrow.rail).toEqual([0, 80]);
    expect(narrow.sides).toEqual(['0px', '0px']);
  });

  // O fio contínuo embaixo da barra do topo, como o do Rallies (y = 44 na captura do Artur, embaixo de "Portfolios" e de "Arena / My Funds /
  // Popular Funds"): a linha de abas do principal e o título da barra secundária têm 45 px (os 44 e o fio), e os dois fios ficam na mesma
  // altura, cada um de uma borda à outra da sua coluna. Na tela sem barra (o modelo), o fio da linha de abas vai do trilho à borda; no
  // Explorar o principal não tem linha de abas (como o Discover), e o fio é o do título da barra.
  test('o fio embaixo da barra do topo fica na mesma altura na barra secundária e no principal', async ({
    page,
  }) => {
    const lines = () =>
      page.getByRole('navigation', { name: 'Telas da arena' }).evaluate((nav) => {
        const edges = (el: Element | null) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            line: getComputedStyle(el).borderBottomWidth,
          };
        };
        return {
          tabs: edges(nav.parentElement),
          title: edges(document.querySelector('#carteiras-titulo')),
          bar: edges(document.querySelector('#carteiras')?.parentElement ?? null),
          main: edges(document.querySelector('main')),
        };
      });
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['/arena', '/ranking']) {
        await page.goto(route);
        const { tabs, title, bar, main } = await lines();
        const where = `${route} em ${width} px`;
        expect({ top: tabs!.top, bottom: tabs!.bottom, line: tabs!.line }, where).toEqual({
          top: 0,
          bottom: 45,
          line: '1px',
        });
        expect({ top: title!.top, bottom: title!.bottom, line: title!.line }, where).toEqual({
          top: 0,
          bottom: 45,
          line: '1px',
        });
        // de uma borda à outra: o título, da borda da barra até o fio dela; a linha de abas, do fio da barra até a borda do principal
        expect([title!.left, title!.right], where).toEqual([bar!.left, bar!.right - 1]);
        expect([tabs!.left, tabs!.right], where).toEqual([bar!.right, main!.right]);
      }
      await page.goto(`/modelos/${MODEL}`);
      const modelo = await lines();
      expect(modelo.title).toBeNull();
      expect(modelo.tabs).toMatchObject({ top: 0, bottom: 45, line: '1px' });
      expect([modelo.tabs!.left, modelo.tabs!.right]).toEqual([
        modelo.main!.left,
        modelo.main!.right,
      ]);
      await page.goto('/explorar');
      const explorar = (await page.locator('#explorar-titulo').boundingBox())!;
      expect([explorar.y, explorar.y + explorar.height]).toEqual([0, 45]);
    }
  });

  // Nenhuma barra de rolagem à vista (o pedido do Artur): o macOS dele mostra as barras clássicas, e o Playwright sem janela as esconde (o
  // --hide-scrollbars que ele passa ao Chromium), então o teste lê o que o CSS manda: o `scrollbar-width` calculado é `none` na raiz (a
  // página), na barra das carteiras e na faixa.
  test('o scrollbar-width é none na página, na barra das carteiras e na faixa', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/arena');
    const widths = await page.evaluate(() =>
      [
        document.documentElement,
        document.querySelector('#carteiras')!.parentElement!,
        document.querySelector('[role="region"][aria-label^="Modelos e Sorteio"]')!,
      ].map((el) => getComputedStyle(el).getPropertyValue('scrollbar-width')),
    );
    expect(widths).toEqual(['none', 'none', 'none']);
  });

  // Sem a barra, a rolagem continua: a roda rola a barra das carteiras (presa no topo, com a própria rolagem), e na faixa dos modelos o botão
  // redondo "›" do Rallies (o `::scroll-button()` do Chromium, só CSS, a 8 px da borda e no meio da altura) e as setas do teclado, com o foco
  // nela, rolam para o lado. O botão é do mouse (`pointer: fine`): os projetos de toque rolam com o dedo, e o WebKit não tem o botão. O foco
  // que sai do "›" depois do fim da rolagem não pode derrubar a aba (com `display: none` no botão desabilitado, o Chromium 156 caía aqui).
  test('sem a barra, a roda rola a barra das carteiras, e o "›" e o teclado rolam a faixa', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'o botão e a roda são do mouse; o toque rola com o dedo',
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/arena');
    const bar = page.locator('#carteiras').locator('..');
    const barBox = (await bar.boundingBox())!;
    await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + 300);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => bar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    const faixa = page.getByRole('region', { name: 'Modelos e Sorteio, por retorno' });
    await faixa.scrollIntoViewIfNeeded();
    const box = (await faixa.boundingBox())!;
    const scrolled = () => faixa.evaluate((el) => el.scrollLeft);
    expect(await scrolled()).toBe(0);
    await page.mouse.click(box.x + box.width - 8 - 22, box.y + box.height / 2);
    await expect.poll(scrolled).toBeGreaterThan(0);
    await faixa.focus();
    const end = await scrolled();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(scrolled).toBeLessThan(end);
    // o cartão focado pelo Tab para antes do "›": a rolagem que leva o foco à vista deixa a largura do botão livre na ponta (o QA do
    // fechamento, achado 15: o anel do cartão da ponta ficava embaixo do botão)
    expect(
      await faixa.evaluate((el) => parseFloat(getComputedStyle(el).scrollPaddingInlineEnd)),
    ).toBeGreaterThanOrEqual(52);
  });

  // Em 360 px a barra de abas fica no pé, com os seis alvos (Arena, Explorar, Carteira, Chat, Mais e Conta) de 60 × 56 px dentro da largura.
  test('em 360 px a barra de abas fica no pé, com os seis alvos de 60 × 56 px dentro da largura', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/ranking');
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('link')).toHaveText([
      'Arena',
      'Explorar',
      'Carteira',
      'Chat',
      'Conta',
    ]);
    const targets = [
      ...(await nav.getByRole('link').all()),
      nav.getByRole('button', { name: 'Mais', exact: true }),
    ];
    for (const target of targets) {
      const box = (await target.boundingBox())!;
      const name = await target.innerText();
      expect(box.width, name).toBeGreaterThanOrEqual(59.95);
      expect(box.height, name).toBeGreaterThanOrEqual(55.95);
      expect(box.x, name).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, name).toBeLessThanOrEqual(360);
      // no pé da tela (o WebKit do Playwright não tem área segura: o pé da barra é o da janela)
      expect(Math.round(box.y + box.height), name).toBe(800);
    }
    // o conteúdo não fica escondido atrás da barra: rolada até o fim, a coluna termina acima dela
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = (await page.getByRole('contentinfo').boundingBox())!;
    expect(Math.round(footer.y + footer.height)).toBeLessThanOrEqual(800 - 56);
  });

  test('o "Mais" abre a folha com as telas de apoio dentro da largura, e o Esc a fecha', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/ranking');
    const sheet = page.locator('#mais');
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: 'Mais', exact: true }).click();
    await expect(sheet).toBeVisible();
    const links = sheet.getByRole('link');
    await expect(links).toHaveText([
      'Como funciona',
      'Notícias',
      'Ações',
      'Termos de uso',
      'Política de privacidade',
    ]);
    for (const link of await links.all()) {
      const box = (await link.boundingBox())!;
      expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.x, await link.innerText()).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(360);
    }
    await expect(sheet.getByRole('link', { name: 'Notícias' })).toHaveAttribute(
      'href',
      '/noticias',
    );
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  // No celular a folha "Mais" é a tela inteira acima da barra de abas, como a folha do site: o título, o ✕ e a lista na própria folha, no
  // canvas (a página coberta sai de vista; antes, a metade de cima da tela ficava vazia, sem véu, e parecia que a página tinha quebrado). O
  // toque na parte vazia da folha não chega à página nem a fecha (o toque fora de um `popover` fecha e segue para o que está embaixo, e no
  // WebKit o fechamento é no pointerdown); o ✕ a fecha.
  test('em 390 px, a folha "Mais" enche a tela acima da barra de abas, com o título e o ✕, e o toque nela não chega à página', async ({
    page,
    isMobile,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ranking');
    await page.getByRole('button', { name: 'Mais', exact: true }).click();
    const sheet = page.locator('#mais');
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box).toMatchObject({ x: 0, y: 0, width: 390 });
    expect(Math.round(box.y + box.height)).toBe(844 - 56);
    expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    );
    await expect(sheet.getByText('Mais', { exact: true })).toBeVisible();
    // a página coberta não está à vista
    await expect(page.getByRole('main')).toBeHidden();
    // o toque embaixo do último link, ainda na folha: nada fecha, nada navega
    const last = (await sheet.getByRole('link').last().boundingBox())!;
    const below = { x: 195, y: last.y + last.height + 40 };
    expect(below.y).toBeLessThan(box.y + box.height);
    if (isMobile) await page.touchscreen.tap(below.x, below.y);
    else await page.mouse.click(below.x, below.y);
    await page.waitForTimeout(500);
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/\/ranking$/);
    // o ✕ fecha, e a página volta
    await sheet.getByRole('button', { name: 'Fechar o menu' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('main')).toBeVisible();
  });

  // Pelo teclado, no celular, depois do último link da folha o foco não pode ir para a página coberta por ela (WCAG 2.4.11): com a folha
  // aberta a coluna do app e a marca do topo saem da ordem do Tab, e o foco anda entre a folha e a barra de abas, que segue à vista.
  test('em 390 px, pelo teclado, o foco nunca vai para a página coberta pela folha "Mais"', async ({
    page,
  }, testInfo) => {
    // o pixel-7 e o iphone-15 são de toque (e o Tab do WebKit do Playwright não percorre links): o teclado é o do projeto desktop
    test.skip(testInfo.project.name !== 'desktop', 'o teclado é o do desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ranking');
    await page.getByRole('button', { name: 'Mais', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#mais')).toBeVisible();
    const places: string[] = [];
    // o ✕, os cinco links e a volta pela barra de abas
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('Tab');
      places.push(
        await page.evaluate(() => {
          const focused = document.activeElement;
          if (!focused || focused === document.body) return 'nada';
          if (focused.closest('#mais')) return 'folha';
          if (focused.closest('nav[aria-label="Principal"]')) return 'barra';
          return `página: ${focused.outerHTML.slice(0, 60)}`;
        }),
      );
    }
    expect(places.filter((place) => place.startsWith('página'))).toEqual([]);
    expect(places.filter((place) => place === 'folha').length).toBeGreaterThanOrEqual(6);
  });

  // No desktop o "Mais" é um menu curto ao lado do item do trilho, e a coluna do app segue à vista (antes, uma gaveta de 288 px e a coluna
  // inteira apagada).
  test('em 1280 px, o "Mais" é um menu curto ao lado do item do trilho, e a coluna do app segue à vista', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/ranking');
    const button = page.getByRole('button', { name: 'Mais', exact: true });
    await button.click();
    const menu = page.locator('#mais');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link')).toHaveCount(5);
    const item = (await button.boundingBox())!;
    const box = (await menu.boundingBox())!;
    // ao lado do trilho de 80 px, na altura do item "Mais"
    expect(box.x).toBeGreaterThanOrEqual(80);
    expect(box.x).toBeLessThanOrEqual(96);
    expect(Math.abs(box.y - item.y)).toBeLessThanOrEqual(1);
    expect(box.width).toBeLessThanOrEqual(260);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Ranking' })).toBeVisible();
  });

  // Pelo teclado, no desktop, o Esc fecha o menu e devolve o foco ao "Mais" (a página não está coberta: o foco que sai do menu vai para o
  // resto do trilho e para a coluna, que estão à vista).
  test('em 1280 px, pelo teclado, o Esc fecha o menu "Mais" e o foco volta ao "Mais"', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'o teclado é o do desktop');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/ranking');
    const button = page.getByRole('button', { name: 'Mais', exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('#mais');
    await expect(menu).toBeVisible();
    // o Tab entra no menu (o primeiro link)
    const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest('#mais')));
    for (let i = 0; i < 4 && !(await inside()); i += 1) await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });
});

// A casca do site (components/site-chrome.tsx; ADR 0035): a marca, os links no meio e a pílula "Entrar"; abaixo de 1024 px, a folha que
// o botão "Menu" abre (o `popover` nativo, sem JavaScript).
test.describe('casca do site', () => {
  test('a navegação lista as telas na ordem, com o endereço de cada uma', async ({ page }) => {
    await page.goto('/como-funciona');
    // abaixo de 1024 px os links estão na folha que o botão "Menu" abre (e2e/menu.ts)
    await abrirMenu(page);
    const nav = page.getByRole('navigation', { name: 'Principal' });
    const links = [
      ['Arena', '/arena'],
      ['Ranking', '/ranking'],
      ['Explorar', '/explorar'],
      ['Como funciona', '/como-funciona'],
      ['Entrar', '/entrar'],
    ] as const;
    await expect(nav.getByRole('link')).toHaveText(links.map(([name]) => name));
    for (const [name, href] of links) {
      await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
    await expect(page.getByRole('banner').getByRole('link', { name: 'Alvesting' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  test('em 360 px o botão "Menu" tem 44 px, abre a folha com os cinco links dentro da largura, e o Esc a fecha', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/como-funciona');
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
    expect(links).toHaveLength(5);
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
  // link que voltou a aparecer): a folha vai até o pé da tela, e o resto dela, embaixo dos links, é o botão "Fechar o menu".
  test('em 390 px, o toque embaixo dos links fecha a folha e não segue o link da página por baixo', async ({
    page,
    isMobile,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await abrirMenu(page);
    const nav = page.getByRole('navigation', { name: 'Principal' });
    // o alvo: um link da página que fica bem abaixo do último link da folha (sem a folha até o pé, o dedo cairia nele). A folha é fixa e o
    // conteúdo é o de cada página (na landing, o topo só tem os CTAs e a pílula, cobertos pela folha): com a folha fechada, a página rola de
    // 200 em 200 px, no máximo 10 vezes, até ter um link na faixa; só então a folha abre de novo, com a página onde parou.
    const sheetBottom = await page.evaluate(
      () => [...document.querySelectorAll('#menu a')].at(-1)!.getBoundingClientRect().bottom,
    );
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    const findTarget = () =>
      page.evaluate((limit) => {
        for (const link of document.querySelectorAll('main a[href]')) {
          const box = link.getBoundingClientRect();
          if (box.width > 0 && box.top > limit + 24 && box.bottom < innerHeight - 8) {
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }
        }
        return null;
      }, sheetBottom);
    let target = await findTarget();
    for (let i = 0; i < 10 && !target; i += 1) {
      await page.evaluate(() => scrollBy(0, 200));
      target = await findTarget();
    }
    expect(
      target,
      'nenhum link da página na faixa embaixo da folha, nem rolando 2.000 px',
    ).not.toBeNull();
    const scrolled = await page.evaluate(() => scrollY);
    // a folha abre pelo toque no botão, onde ele está: o `click()` do Playwright rolaria a página até o botão preso no topo (no Chromium, o
    // scrollIntoView de um elemento `sticky` volta ao lugar dele no fluxo, o topo da página), e o alvo sairia de onde foi medido
    const menu = (await page.getByRole('button', { name: 'Menu', exact: true }).boundingBox())!;
    if (isMobile) await page.touchscreen.tap(menu.x + menu.width / 2, menu.y + menu.height / 2);
    else await page.mouse.click(menu.x + menu.width / 2, menu.y + menu.height / 2);
    await expect(nav).toBeVisible();
    // abrir a folha não leva a página de volta ao topo: o alvo continua onde foi medido
    expect(await page.evaluate(() => scrollY)).toBe(scrolled);
    if (isMobile) await page.touchscreen.tap(target!.x, target!.y);
    else await page.mouse.click(target!.x, target!.y);
    await expect(nav).toBeHidden();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/$/);
  });

  test('em 390 px, pelo teclado, o foco nunca vai para a página coberta pela folha aberta', async ({
    page,
  }, testInfo) => {
    // o pixel-7 e o iphone-15 são de toque (e o Tab do WebKit do Playwright não percorre links): o teclado é o do projeto desktop
    test.skip(testInfo.project.name !== 'desktop', 'o teclado é o do desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    const places: string[] = [];
    // os quatro links, o "Entrar", o "Fechar o menu" e a volta ao começo do cabeçalho
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
    expect(places.filter((place) => place === 'folha').length).toBeGreaterThanOrEqual(6);
  });

  // A partir de 1024 px os links e a pílula ficam na tela, com a pílula visível de 32 px dentro da caixa de 44 px: o laço de ROUTES mede os
  // alvos só em 360 px, onde eles não aparecem.
  test('em 1280 px os links aparecem sem o botão "Menu", e todo link do cabeçalho tem o alvo de 44 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/como-funciona');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link')).toHaveCount(
      5,
    );
    const links = await page.getByRole('banner').getByRole('link').all();
    expect(links).toHaveLength(6);
    for (const link of links) {
      const box = (await link.boundingBox())!;
      expect(box.width, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(1280);
    }
  });

  // O cabeçalho do site anda como o resto (o QA do fechamento, achado 13: os links e a pílula "Entrar" trocavam de cor na hora, e a pílula não
  // encolhia no toque): a cor dos links em 150 ms, o fundo da pílula em 150 ms, e o toque a encolhe a 0,96, como o botão.
  test('em 1280 px os links e a pílula "Entrar" do cabeçalho andam em 150 ms, e a pílula encolhe no toque', async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'o hover e o clique são do mouse');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/como-funciona');
    const banner = page.getByRole('banner');
    const link = banner.getByRole('navigation', { name: 'Principal' }).getByRole('link').first();
    const pill = banner.getByRole('link', { name: 'Entrar', exact: true });
    expect(
      await link.evaluate((el) => {
        const style = getComputedStyle(el);
        return `${style.transitionProperty} ${style.transitionDuration}`;
      }),
    ).toBe('color 0.15s');
    expect(
      await pill.evaluate((el) => getComputedStyle(el, '::before').transitionProperty),
    ).toContain('background-color');
    expect(await pill.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain('scale');
    const box = (await pill.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => pill.evaluate((el) => getComputedStyle(el).scale)).toBe('0.96');
    // solta fora da pílula: não navega
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });
});
