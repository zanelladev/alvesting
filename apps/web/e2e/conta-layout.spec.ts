import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { FRONT_DOOR_URL } from './api-server';
import { registerVerifiedUser, signInViaApi, test } from './account-support';
import { abrirMenu } from './menu';

// Mobile primeiro (plano §13) nas telas da conta (etapa 11, parte 2): em pixel-7, iphone-15 e desktop, sem rolagem horizontal em
// 360 px, alvos de toque de pelo menos 44 px (os campos e as caixas de marcar também), nenhum erro no console e acessibilidade (axe) sem
// violação séria ou crítica, e sem nenhuma violação de qualquer impacto em 360 px. Cada tela vale também no estado de erro (os erros ligados
// aos campos, o aviso de status): é onde a tela mais muda. O desktop também roda em 360 px: o que conta é a largura, não o aparelho.
test.skip(Boolean(process.env.BASE_URL), 'precisa do Front Door imitado e dos servidores da conta');
test.use({ baseURL: FRONT_DOOR_URL });

interface Screen {
  name: string;
  route: string;
  // o título (h1) que a tela tem de mostrar: sem ele a medição passaria também numa página 404
  heading: string;
  // a tela só existe com sessão (a conta)
  session?: true;
  // a conta com o maior nome (100 caracteres, uma palavra só) e um e-mail comprido: texto do usuário não alarga a página
  longProfile?: true;
  // leva a tela ao estado que se quer medir (um erro, um aviso)
  prepare?: (page: Page) => Promise<void>;
}

const submit = (name: string) => (page: Page) =>
  page.getByRole('main').getByRole('button', { name, exact: true }).click();

const SCREENS: Screen[] = [
  { name: 'entrar', route: '/entrar', heading: 'Entrar' },
  { name: 'entrar com aviso', route: '/entrar?aviso=senha-redefinida', heading: 'Entrar' },
  { name: 'entrar com erro do Google', route: '/entrar?error=signup_disabled', heading: 'Entrar' },
  {
    name: 'entrar com erro de campo',
    route: '/entrar',
    heading: 'Entrar',
    prepare: submit('Entrar'),
  },
  { name: 'cadastro', route: '/cadastro', heading: 'Criar conta' },
  {
    name: 'cadastro com todos os erros',
    route: '/cadastro',
    heading: 'Criar conta',
    prepare: submit('Criar conta'),
  },
  { name: 'verificar e-mail', route: '/verificar-email', heading: 'Confirme o seu e-mail' },
  { name: 'e-mail confirmado', route: '/verificar-email?retorno=1', heading: 'E-mail confirmado' },
  {
    name: 'link de verificação vencido',
    route: '/verificar-email?retorno=1&error=TOKEN_EXPIRED',
    heading: 'Não foi possível confirmar o e-mail',
  },
  { name: 'esqueci a senha', route: '/esqueci-senha', heading: 'Esqueci a senha' },
  {
    name: 'esqueci a senha com erro',
    route: '/esqueci-senha',
    heading: 'Esqueci a senha',
    prepare: submit('Enviar o link'),
  },
  {
    name: 'redefinir a senha',
    route: '/redefinir-senha?token=token-sintetico',
    heading: 'Redefinir a senha',
  },
  {
    name: 'redefinir a senha com erro',
    route: '/redefinir-senha?token=token-sintetico',
    heading: 'Redefinir a senha',
    prepare: submit('Salvar a nova senha'),
  },
  { name: 'redefinir sem o token', route: '/redefinir-senha', heading: 'Redefinir a senha' },
  { name: 'termos de uso', route: '/termos', heading: 'Termos de uso' },
  { name: 'política de privacidade', route: '/privacidade', heading: 'Política de privacidade' },
  { name: 'conta', route: '/conta', heading: 'Minha conta', session: true },
  {
    name: 'conta com nome e e-mail compridos',
    route: '/conta',
    heading: 'Minha conta',
    session: true,
    longProfile: true,
  },
  {
    name: 'conta com o erro da exclusão',
    route: '/conta',
    heading: 'Minha conta',
    session: true,
    prepare: submit('Excluir minha conta'),
  },
];

// Duas cascas (ADR 0035): os textos legais moram na do site; a conta e as telas de entrar e criar conta, na do app (o trilho e a barra de
// abas), na área "conta" (desde 06/11/2026; antes, entrar e criar conta eram a tela dividida do cadastro do Rallies).
type Casca = 'app' | 'site';
const shellOf = (screen: Screen): Casca =>
  /^\/(termos|privacidade)$/.test(screen.route) ? 'site' : 'app';

// A fonte carregada muda a largura do texto: só mede depois dela. O formulário só vale depois da hidratação (os campos nascem
// desativados, e o que o teste faz com eles precisa do JavaScript).
async function loaded(page: Page, heading: string) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const buttons = page.getByRole('main').getByRole('button');
  for (const button of await buttons.all()) await expect(button).toBeEnabled();
}

async function open(page: Page, screen: Screen, who: { request: APIRequestContext; ip: string }) {
  if (screen.session) {
    const user = screen.longProfile
      ? await registerVerifiedUser(who.request, who.ip, 'x'.repeat(40), 'N'.repeat(100))
      : await registerVerifiedUser(who.request, who.ip, 'layout');
    await signInViaApi(page.request, user);
  }
  await page.goto(screen.route);
  await loaded(page, screen.heading);
  if (screen.prepare) {
    await screen.prepare(page);
    // o erro aparece (o foco foi para o primeiro campo ou para o aviso)
    await expect(
      page.locator('[aria-invalid="true"], [role="alert"][tabindex="-1"]').first(),
    ).toBeVisible();
  }
  // A cor do botão anda por 150 ms depois que ele fica habilitado (a hidratação, o envio): o axe mede o estado final, e não o meio da
  // transição (no pixel-7 ele pegou o "Entrar" a meio caminho do cinza do desabilitado para o preto, com 1,6:1).
  await page.waitForFunction(
    () => !document.getAnimations().some((animation) => animation instanceof CSSTransition),
  );
}

for (const screen of SCREENS) {
  test.describe(`tela ${screen.name} (${screen.route})`, () => {
    test(
      'em 360 px não rola na horizontal, o cabeçalho cabe e os alvos de toque têm pelo menos 44 px',
      { tag: '@tema' },
      async ({ page, request, ip }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await open(page, screen, { request, ip });

        const { scrollWidth, clientWidth, bodyWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyWidth: document.body.scrollWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
        expect(bodyWidth).toBeLessThanOrEqual(clientWidth);

        // a navegação cabe na largura, cada link com 44 px de altura (ADR 0035). Na conta e nas telas de entrar e criar conta (a casca do app) a
        // barra de abas está sempre na tela: a marca e os cinco links (o sexto alvo é o botão "Mais"). Nos textos legais (a casca do site), a
        // folha que o botão "Menu" abre: a marca, os quatro links e o "Entrar", e o Esc a fecha. A contagem vem antes das medidas: sem ela o
        // laço passaria em vazio se o cabeçalho sumisse
        const shell = shellOf(screen);
        await abrirMenu(page);
        const bannerLinks = await page.getByRole('banner').getByRole('link').all();
        expect(bannerLinks.length).toBeGreaterThanOrEqual(6);
        for (const link of bannerLinks) {
          const box = (await link.boundingBox())!;
          expect(box.x, await link.innerText()).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(360);
          expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
        }
        if (shell === 'site') {
          await page.keyboard.press('Escape');
          await expect(page.getByRole('navigation', { name: 'Principal' })).toBeHidden();
        }

        // a medida crua, sem arredondar (43,6 px não vira 44): só uma folga de 0,05 px para o ruído da conta de ponto flutuante. A caixa de
        // marcar mede pelo rótulo: o desenho dela é a caixa nativa de 20 px, e o alvo de 44 px é o <label> inteiro (a caixa e o texto), que a
        // marca (desde 06/11/2026; antes a própria caixa tinha 44 px, como o radio da carteira-layout.spec.ts)
        const small = await page.evaluate(() => {
          const selector =
            'a[href], button, input:not([type="hidden"]):not([type="checkbox"]), select, textarea, summary, [role="button"], label:has(> input[type="checkbox"])';
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

    test('não deixa erro no console nem exceção na página (hidratação, recurso que falha)', async ({
      page,
      request,
      ip,
    }) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`exceção: ${error.message}`));
      page.on('requestfailed', (failed) => problems.push(`pedido falhou: ${failed.url()}`));
      await open(page, screen, { request, ip });
      // dá tempo de a hidratação acontecer e de o rodapé (que chega por streaming) terminar
      const footer = page.getByRole('contentinfo');
      await expect(footer).toContainText('brapi.dev, pregão de');
      await page.waitForLoadState('networkidle');
      expect(problems).toEqual([]);

      // o aviso fixo (regra do Artur: o software é educacional e não se responsabiliza pelas decisões do usuário) e as atribuições estão
      // em TODA tela da conta, e o caminho fixo para a conta no cabeçalho também: a "Conta" na casca do app e o "Entrar" na do site
      await expect(footer).toContainText('Arena acadêmica com dinheiro fictício');
      await expect(footer).toContainText('não se responsabiliza pelas decisões do usuário');
      await expect(footer).toContainText('Fonte: Banco Central do Brasil');
      await expect(footer).toContainText('Contém dados da CVM');
      // abaixo de 1024 px, na casca do site, o link está na folha que o botão "Menu" abre (e2e/menu.ts)
      await abrirMenu(page);
      const [name, href] = shellOf(screen) === 'app' ? ['Conta', '/conta'] : ['Entrar', '/entrar'];
      await expect(
        page.getByRole('banner').getByRole('link', { name, exact: true }),
      ).toHaveAttribute('href', href);
    });

    // O JavaScript que o navegador baixa nesta tela não leva o zod. Pelo índice do pacote de contratos o bundler levava os schemas (uns
    // 36 KB comprimidos) só para ler seis números, e o formulário só vale depois de hidratar: cada KB atrasa o momento em que a pessoa
    // pode digitar no celular. Os módulos que vão ao navegador leem `@alvesting/contracts/account-constants`.
    test('o JavaScript da tela não leva o zod ao navegador', async ({ page, request, ip }) => {
      const scripts: Array<Promise<string>> = [];
      page.on('response', (response) => {
        if (response.request().resourceType() === 'script') {
          scripts.push(response.text().catch(() => ''));
        }
      });
      await open(page, screen, { request, ip });
      await page.waitForLoadState('networkidle');
      const bodies = await Promise.all(scripts);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) expect(body).not.toContain('ZodError');
    });

    test(
      'acessibilidade (axe): nenhuma violação séria ou crítica',
      { tag: '@tema' },
      async ({ page, request, ip }) => {
        await open(page, screen, { request, ip });
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

    test(
      'acessibilidade (axe) em 360 px: nenhuma violação, de qualquer impacto',
      { tag: '@tema' },
      async ({ page, request, ip }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await open(page, screen, { request, ip });
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
  });
}

// Nenhuma rolagem horizontal da página de 360 a 1920 px nas telas da conta (a conta, entrar e criar conta na casca do app; os textos legais na
// do site), e nenhuma barra de rolagem à vista.
test.describe('as telas da conta de 360 a 1920 px', () => {
  for (const screen of SCREENS.filter((s) =>
    ['entrar', 'cadastro com todos os erros', 'termos de uso', 'conta'].includes(s.name),
  )) {
    test(
      `${screen.name}: nenhuma largura rola na horizontal`,
      { tag: '@tema' },
      async ({ page, request, ip }) => {
        await open(page, screen, { request, ip });
        for (const width of [360, 390, 412, 768, 1024, 1280, 1440, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          const sizes = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
            body: document.body.scrollWidth,
            bar: window.innerWidth - document.documentElement.clientWidth,
          }));
          expect(sizes.scroll, `${width} px`).toBeLessThanOrEqual(sizes.client);
          expect(sizes.body, `${width} px`).toBeLessThanOrEqual(sizes.client);
          expect(sizes.bar, `${width} px`).toBe(0);
        }
      },
    );
  }
});

// O sumário "Nesta página" dos textos legais (components/legal-text.tsx): a partir de 1280 px, preso à direita da coluna de leitura, com um link
// por seção do texto (o id do h2 que ele abre); abaixo disso some, e o texto segue numa coluna só. Só HTML e CSS.
// O formulário nasce desativado até a hidratação (sem JavaScript ele não pode se enviar), e o botão desativado é o cinza: na hidratação ele virava
// a primária pela transição de 150 ms, um esmaecer da ação principal na abertura (o QA do fechamento, achado 6). Nada transiciona na hidratação;
// o hover continua a andar em 150 ms, na ida e na volta.
test.describe('o botão do formulário na abertura', () => {
  test('nada transiciona quando o formulário fica ativo, e o hover ainda anda nos dois sentidos', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      const runs: string[] = [];
      (window as unknown as { transicoes: string[] }).transicoes = runs;
      document.addEventListener(
        'transitionrun',
        (event) => {
          const target = event.target as Element;
          if (target.closest?.('form')) runs.push(`${target.tagName}:${event.propertyName}`);
        },
        true,
      );
    });
    await page.goto('/entrar');
    const button = page.getByRole('button', { name: 'Entrar', exact: true });
    await expect(button).toBeEnabled();
    // o tempo de qualquer transição da abertura acabar (as do botão são de 150 ms)
    await page.waitForTimeout(400);
    const runs = () =>
      page.evaluate(() => (window as unknown as { transicoes: string[] }).transicoes);
    expect(await runs()).toEqual([]);
    if (!testInfo.project.name.startsWith('desktop')) return;
    await button.hover();
    await expect.poll(runs).toContain('BUTTON:background-color');
    const count = (await runs()).filter((run) => run === 'BUTTON:background-color').length;
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => (await runs()).filter((run) => run === 'BUTTON:background-color').length)
      .toBeGreaterThan(count);
  });
});

test.describe('o sumário "Nesta página" dos textos legais', () => {
  for (const route of ['/termos', '/privacidade']) {
    test(`em 1440 px fica à direita do texto e leva a cada seção; em 390 px some (${route})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route);
      const nav = page.getByRole('navigation', { name: 'Nesta página' });
      await expect(nav).toBeVisible();
      const sections = page.getByRole('article').getByRole('heading', { level: 2 });
      const titles = await sections.allInnerTexts();
      expect(titles.length).toBeGreaterThanOrEqual(9);
      const links = nav.getByRole('link');
      await expect(links).toHaveText(titles);
      // cada link aponta para o id do h2 da seção dele
      for (const [i, link] of (await links.all()).entries()) {
        const id = await sections.nth(i).getAttribute('id');
        expect(id).toMatch(/^secao-/);
        await expect(link).toHaveAttribute('href', `#${id}`);
      }
      // à direita da coluna de leitura, sem cobrir o texto
      const text = (await page.getByRole('article').boundingBox())!;
      const box = (await nav.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(text.x + text.width);
      expect(box.x + box.width).toBeLessThanOrEqual(1440);
      // o link leva à seção, e o sumário vai junto: o miolo fica preso no topo enquanto a página rola pelo texto
      await links.nth(4).click();
      await expect(page).toHaveURL(new RegExp(`#${await sections.nth(4).getAttribute('id')}$`));
      await expect(sections.nth(4)).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(900);
      await expect(nav.getByRole('link').first()).toBeInViewport();

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(nav).toBeHidden();
    });
  }
});

// Entrar e criar conta na casca do app (a pedido do Artur, 06/11/2026; antes, a tela dividida com a escadaria à direita): em 1440 px o trilho
// com a "Conta" marcada, o formulário no centro do principal numa coluna de até 448 px, e nenhuma arte na tela nem pedida; em 390 px, a barra
// de abas no pé, com a "Conta" marcada.
test.describe('entrar e criar conta na casca do app', () => {
  for (const route of ['/entrar', '/cadastro']) {
    test(`em 1440 px o trilho marca a "Conta", e o formulário fica no centro, sem arte (${route})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const asked: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/ascii/arte/')) asked.push(request.url());
      });
      await page.goto(route);
      const nav = page.getByRole('navigation', { name: 'Principal' });
      await expect(nav.locator('[aria-current="page"]')).toHaveText(['Conta']);
      const main = (await page.getByRole('main').boundingBox())!;
      const form = (await page.getByRole('main').locator('form').boundingBox())!;
      expect(form.width).toBeLessThanOrEqual(448);
      expect(Math.abs(form.x + form.width / 2 - (main.x + main.width / 2))).toBeLessThan(2);
      await expect(page.locator('[data-arte]')).toHaveCount(0);
      await page.waitForLoadState('networkidle');
      expect(asked).toEqual([]);
    });
  }

  test('em 390 px a barra de abas no pé marca a "Conta"', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/cadastro');
    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeVisible();
    const current = page
      .getByRole('navigation', { name: 'Principal' })
      .locator('[aria-current="page"]');
    await expect(current).toHaveText(['Conta']);
    expect((await current.boundingBox())!.y).toBeGreaterThan(844 - 80);
  });
});
