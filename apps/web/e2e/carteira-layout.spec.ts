import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';
import { registerVerifiedUser, signInViaApi, test } from './account-support';
import { FIXTURE_WEB_URL, FRONT_DOOR_URL } from './api-server';
import { addLot, type NewLot } from './carteira-support';
import { abrirMenu } from './menu';

// Mobile primeiro (plano §13) na tela da carteira (etapa 12, parte 2; docs/TELAS.md, seção 9), com o molde do conta-layout.spec.ts: em pixel-7,
// iphone-15 e desktop, sem rolagem horizontal em 360 px, a folha do menu dentro da largura, alvos de toque de pelo menos 44 px (os campos, os
// radios e os botões de cada lançamento também), nenhum erro no console, o zod fora do JavaScript da tela e acessibilidade (axe) sem violação
// séria ou crítica, e sem nenhuma violação de qualquer impacto em 360 px. Cada estado vale por si, porque é onde a tela mais muda: vazia, com
// lançamentos, com os erros do formulário, editando, confirmando o apagar e com os valores nos tetos. O desktop também roda em 360 px: o que
// conta é a largura, não o aparelho.
//
// Dois estados vêm da api FALSA (e2e/fixture-api.ts, o site da porta 4305), porque o banco sintético não os produz: o ticker sem barra ("sem
// cotação"), o percentual que não cabe no inteiro seguro e uma posição de R$ 450.000.000.000,00. Ali o navegador não fala com a api (o site da
// api falsa não tem o Front Door), então só a leitura vale: nada é enviado.
test.skip(Boolean(process.env.BASE_URL), 'precisa do Front Door imitado e dos servidores da conta');

const LOTS: NewLot[] = [
  { ticker: 'MOVE3', quantity: 100, mode: 'unit', valueCents: 3_550, boughtOn: '2026-10-15' },
  { ticker: 'MOVE3', quantity: 100, mode: 'total', valueCents: 355_000 },
  // a PAUS3 parou de negociar no 3º pregão: o fechamento dela é de uma data mais antiga que o da MOVE3
  { ticker: 'PAUS3', quantity: 2_500, mode: 'unit', valueCents: 1_275, boughtOn: '2026-09-01' },
  { ticker: 'SINA3', quantity: 10, mode: 'total', valueCents: 20_000, boughtOn: '2026-10-10' },
];
// dois lançamentos no teto: 1.000.000 de ações e R$ 1.000.000.000,00 de custo cada um
const CAP: NewLot[] = [
  {
    ticker: 'MOVE3',
    quantity: 1_000_000,
    mode: 'total',
    valueCents: 100_000_000_000,
    boughtOn: '2026-10-15',
  },
  {
    ticker: 'SINA3',
    quantity: 1_000_000,
    mode: 'total',
    valueCents: 100_000_000_000,
    boughtOn: '2026-10-10',
  },
];

interface Screen {
  name: string;
  // os lançamentos que a conta tem (pela api, antes de abrir a página); a api falsa tem os dela
  lots: NewLot[];
  fixture?: true;
  // leva a tela ao estado que se quer medir, e o que tem de aparecer para ele valer
  prepare?: (page: Page) => Promise<void>;
  ready?: (page: Page) => Locator;
}

const firstCard = (page: Page) =>
  page.getByRole('region', { name: 'Lançamentos', exact: true }).getByRole('listitem').first();
const submit = (page: Page) =>
  page.getByRole('main').getByRole('button', { name: 'Lançar compra', exact: true }).click();
const openEdit = (page: Page) =>
  firstCard(page)
    .getByRole('button', { name: /^Editar/ })
    .click();
const openRemove = (page: Page) =>
  firstCard(page)
    .getByRole('button', { name: /^Apagar/ })
    .click();
const editing = (page: Page) => page.getByRole('form', { name: /^Editar lançamento/ });

const SCREENS: Screen[] = [
  { name: 'vazia', lots: [] },
  { name: 'com lançamentos e posições', lots: LOTS },
  {
    name: 'com todos os erros do formulário',
    lots: LOTS,
    prepare: submit,
    ready: (page) => page.locator('[aria-invalid="true"]').first(),
  },
  { name: 'editando um lançamento', lots: LOTS, prepare: openEdit, ready: editing },
  {
    name: 'confirmando o apagar',
    lots: LOTS,
    prepare: openRemove,
    ready: (page) => page.getByRole('group', { name: /^Apagar o lançamento/ }),
  },
  { name: 'com os valores nos tetos', lots: CAP },
  { name: 'sem cotação e com valores gigantes (api falsa)', lots: [], fixture: true },
  {
    name: 'editando o lançamento de valores gigantes (api falsa)',
    lots: [],
    fixture: true,
    prepare: openEdit,
    ready: editing,
  },
];

// A fonte carregada muda a largura do texto: só mede depois dela. O formulário e os botões de cada lançamento só valem depois da hidratação
// (nascem desativados), e o que o teste faz com eles precisa do JavaScript.
async function loaded(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Minha carteira' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const buttons = page.getByRole('main').getByRole('button');
  for (const button of await buttons.all()) await expect(button).toBeEnabled();
}

async function open(
  page: Page,
  screen: Screen,
  who: { request: Parameters<typeof registerVerifiedUser>[0]; ip: string },
) {
  if (screen.fixture) {
    // a api falsa não confere a sessão: qualquer cookie com o prefixo do Better Auth faz a página ler a carteira dela
    await page
      .context()
      .addCookies([{ name: 'alvesting.session_token', value: 'fixture', url: FIXTURE_WEB_URL }]);
  } else {
    const user = await registerVerifiedUser(who.request, who.ip, 'carteira-layout');
    await signInViaApi(page.request, user);
    for (const lot of screen.lots) await addLot(page.request, lot);
  }
  await page.goto('/carteira');
  await loaded(page);
  if (screen.prepare) {
    await screen.prepare(page);
    await expect(
      (screen.ready ?? (() => page.locator('[aria-invalid="true"]').first()))(page),
    ).toBeVisible();
  }
}

for (const screen of SCREENS) {
  test.describe(`carteira ${screen.name}`, () => {
    test.use({ baseURL: screen.fixture ? FIXTURE_WEB_URL : FRONT_DOOR_URL });

    test('em 360 px não rola na horizontal, a folha do menu cabe na largura e os alvos de toque têm pelo menos 44 px', async ({
      page,
      request,
      ip,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await open(page, screen, { request, ip });

      const { scrollWidth, clientWidth, bodyWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      expect(bodyWidth).toBeLessThanOrEqual(clientWidth);

      // o cabeçalho cabe na largura, e a folha do menu (com o link "Carteira") abre com os sete links dentro dela (ADR 0034: em 360 px o
      // menu é a folha que o botão "Menu" abre, uma linha por tela). As contagens vêm antes das medidas: sem elas os laços passariam em
      // vazio se o cabeçalho sumisse (o endereço de cada link é conferido no layout.spec.ts)
      await abrirMenu(page);
      const bannerLinks = await page.getByRole('banner').getByRole('link').all();
      expect(bannerLinks.length).toBeGreaterThanOrEqual(8);
      for (const link of bannerLinks) {
        const box = (await link.boundingBox())!;
        expect(box.x, await link.innerText()).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(360);
        expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      }
      await expect(
        page.getByRole('navigation', { name: 'Principal' }).getByRole('link'),
      ).toHaveCount(7);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('navigation', { name: 'Principal' })).toBeHidden();

      // o Safari do iPhone dá zoom na página ao focar um campo de texto com fonte menor que 16 px, e o WebKit do Playwright não reproduz isso: a
      // medida é o que protege
      const inputs = await page.getByRole('main').locator('input:not([type="radio"])').all();
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) {
        const size = await input.evaluate((element) =>
          parseFloat(getComputedStyle(element).fontSize),
        );
        expect(size, `${await input.getAttribute('name')}`).toBeGreaterThanOrEqual(16);
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

    test('não deixa erro no console nem exceção na página (hidratação, recurso que falha), e o aviso fixo está no rodapé', async ({
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
      const footer = page.getByRole('contentinfo');
      // a data do pregão no rodapé chega por streaming; a api falsa não tem barra do BOVA11, então o rodapé dela fica sem a data
      if (!screen.fixture) await expect(footer).toContainText('brapi.dev, pregão de');
      await page.waitForLoadState('networkidle');
      expect(problems).toEqual([]);

      // o aviso fixo do site (o software é educacional e não se responsabiliza pelas decisões do usuário) e o aviso da carteira
      await expect(footer).toContainText('Arena acadêmica com dinheiro fictício');
      await expect(footer).toContainText('não se responsabiliza pelas decisões do usuário');
      await expect(page.getByRole('main')).toContainText(
        'Valores estimados pelo último fechamento disponível; não é recomendação de investimento.',
      );
      await abrirMenu(page);
      await expect(
        page.getByRole('banner').getByRole('link', { name: 'Carteira', exact: true }),
      ).toHaveAttribute('href', '/carteira');
    });

    // O JavaScript que o navegador baixa nesta tela não leva o zod: o formulário lê a regra do dinheiro de
    // `@alvesting/contracts/portfolio-rules`, um módulo sem imports (CLAUDE.md), e cada KB atrasa o momento em que a pessoa pode digitar.
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

    test('acessibilidade (axe): nenhuma violação séria ou crítica', async ({
      page,
      request,
      ip,
    }) => {
      await open(page, screen, { request, ip });
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        serious,
        JSON.stringify(
          serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })),
        ),
      ).toEqual([]);
    });

    test('acessibilidade (axe) em 360 px: nenhuma violação, de qualquer impacto', async ({
      page,
      request,
      ip,
    }) => {
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
    });
  });
}
