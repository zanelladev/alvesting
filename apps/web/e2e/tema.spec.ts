import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// O seletor de tema (ADR 0037; components/beui/theme-selector.tsx): claro, escuro e sistema, guardado no navegador e aplicado por um script
// curto no <head>, antes da pintura. Todos os testes levam `@tema`: rodam nos seis projetos, os três claros e os três escuros
// (playwright.config.ts), porque o "sistema" de cada projeto é outro. Uma tela do site (a landing) e uma do app (o ranking).
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local com o banco sintético');

const SCREENS = ['/', '/ranking'] as const;
const LIGHT = 'rgb(255, 255, 255)';
const DARK = 'rgb(23, 23, 23)';

// o que o <html> e o fundo dizem do tema (o `data-theme` da Arc saiu no fechamento da onda: nenhuma peça o lia)
const look = (page: Page) =>
  page.evaluate(() => ({
    tema: document.documentElement.getAttribute('data-tema'),
    theme: document.documentElement.getAttribute('data-theme'),
    dark: document.documentElement.classList.contains('dark'),
    background: getComputedStyle(document.body).backgroundColor,
  }));
const expected = (tema: string, dark: boolean) => ({
  tema,
  theme: null,
  dark,
  background: dark ? DARK : LIGHT,
});
// dois quadros: o evento `change` do matchMedia roda na atualização da página, antes deles
const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

// O seletor visível: a partir de 1024 px, no cabeçalho do site e no pé do trilho do app; abaixo, numa folha (a do "Menu" no site, a do
// "Mais" no app). Os outros ficam escondidos e fora da árvore de acessibilidade.
async function selector(page: Page) {
  const group = page.getByRole('group', { name: 'Tema' });
  if (!(await group.isVisible())) {
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    if (await menu.isVisible()) await menu.click();
    else await page.getByRole('button', { name: 'Mais', exact: true }).click();
  }
  await expect(group).toBeVisible();
  return group;
}

const systemIsDark = (page: Page) =>
  page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);

for (const screen of SCREENS) {
  test.describe(`tema em ${screen}`, () => {
    test(
      'o seletor troca o tema, e o tema sobrevive ao recarregar',
      { tag: '@tema' },
      async ({ page }) => {
        await page.goto(screen);
        // sem escolha guardada, é o "sistema"
        const system = await systemIsDark(page);
        expect(await look(page)).toEqual(expected('sistema', system));
        await expect((await selector(page)).getByRole('radio', { name: 'Sistema' })).toBeChecked();

        await (await selector(page)).getByRole('radio', { name: 'Escuro' }).check();
        await expect.poll(() => look(page)).toEqual(expected('escuro', true));
        await page.reload();
        expect(await look(page)).toEqual(expected('escuro', true));
        await expect((await selector(page)).getByRole('radio', { name: 'Escuro' })).toBeChecked();

        await (await selector(page)).getByRole('radio', { name: 'Claro' }).check();
        await expect.poll(() => look(page)).toEqual(expected('claro', false));
        await page.reload();
        expect(await look(page)).toEqual(expected('claro', false));
        await expect((await selector(page)).getByRole('radio', { name: 'Claro' })).toBeChecked();

        // de volta ao sistema: a escolha sai do navegador
        await (await selector(page)).getByRole('radio', { name: 'Sistema' }).check();
        await expect.poll(() => look(page)).toEqual(expected('sistema', system));
        expect(await page.evaluate(() => localStorage.getItem('tema'))).toBeNull();
      },
    );

    test(
      '"sistema" segue o prefers-color-scheme, e muda junto com ele',
      { tag: '@tema' },
      async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(screen);
        expect(await look(page)).toEqual(expected('sistema', true));
        await page.emulateMedia({ colorScheme: 'light' });
        await expect.poll(() => look(page)).toEqual(expected('sistema', false));
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect.poll(() => look(page)).toEqual(expected('sistema', true));
        // com uma escolha guardada, o sistema não manda mais. O clique troca o tema pela View Transition, num quadro seguinte: espera a troca
        // (lê-la na hora dava a corrida que reprovava às vezes no e2e inteiro), e depois da troca do sistema espera os dois quadros em que
        // ela mudaria o tema, se mudasse
        await (await selector(page)).getByRole('radio', { name: 'Claro' }).check();
        await expect.poll(() => look(page)).toEqual(expected('claro', false));
        await page.emulateMedia({ colorScheme: 'light' });
        await page.emulateMedia({ colorScheme: 'dark' });
        await frames(page);
        expect(await look(page)).toEqual(expected('claro', false));
      },
    );

    // Sem piscar: o atributo já está no <html> quando o <body> começa a chegar (antes da primeira pintura), e não depende da hidratação. O
    // JavaScript do Next é bloqueado: o React nunca roda, e quem escreve o atributo é o script em linha do <head>.
    test(
      'o <html> já vem no tema guardado antes da hidratação',
      { tag: '@tema' },
      async ({ page }) => {
        await page.addInitScript(() => {
          localStorage.setItem('tema', 'escuro');
          new MutationObserver((_, observer) => {
            if (!document.body) return;
            (window as unknown as { primeiro: string | null }).primeiro =
              document.documentElement.getAttribute('data-tema');
            observer.disconnect();
          }).observe(document, { childList: true, subtree: true });
        });
        await page.route('**/_next/static/**/*.js', (route) => route.abort());
        await page.goto(screen);
        expect(
          await page.evaluate(() => (window as unknown as { primeiro: string }).primeiro),
        ).toBe('escuro');
        expect(await look(page)).toEqual(expected('escuro', true));
      },
    );

    // Sem JavaScript nada lê a escolha: o tema segue o sistema pela media query, e o seletor, que não faria nada, não aparece.
    test.describe('sem JavaScript', () => {
      test.use({ javaScriptEnabled: false });
      test('o tema segue o sistema, e o seletor some', { tag: '@tema' }, async ({ page }) => {
        await page.goto(screen);
        const system = await systemIsDark(page);
        const state = await page.evaluate(() => ({
          tema: document.documentElement.getAttribute('data-tema'),
          scheme: getComputedStyle(document.documentElement).colorScheme,
          background: getComputedStyle(document.body).backgroundColor,
          visible: [...document.querySelectorAll('.tema, .mais-tema, .app-tema')].filter(
            (element) => getComputedStyle(element).display !== 'none',
          ).length,
        }));
        expect(state).toEqual({
          tema: null,
          scheme: 'light dark',
          background: system ? DARK : LIGHT,
          visible: 0,
        });
      });
    });

    test(
      'o axe não acha violação em nenhum dos dois temas escolhidos',
      { tag: '@tema' },
      async ({ page }) => {
        await page.goto(screen);
        for (const [name, dark] of [
          ['Claro', false],
          ['Escuro', true],
        ] as const) {
          await (await selector(page)).getByRole('radio', { name }).check();
          await expect.poll(() => look(page)).toEqual(expected(name.toLowerCase(), dark));
          // a folha aberta cobre a página: o axe mede a página inteira, com a folha fechada
          await page.keyboard.press('Escape');
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
        }
      },
    );
  });
}

// Pelo teclado: o Tab chega ao grupo (no radio escolhido), as setas trocam a escolha e o tema na hora, e o anel de foco aparece. Só no
// desktop: o pixel-7 e o iphone-15 são de toque (e o Tab do WebKit do Playwright não percorre links).
test(
  'o seletor funciona pelo teclado, com o anel de foco',
  { tag: '@tema' },
  async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'o teclado é o do desktop');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/ranking');
    const system = await systemIsDark(page);
    await page.getByRole('link', { name: 'Buscar', exact: true }).focus();
    await page.keyboard.press('Tab');
    const focused = () =>
      page.evaluate(() => {
        const input = document.activeElement as HTMLInputElement;
        return {
          name: input.name,
          value: input.value,
          ring: getComputedStyle(input.closest('label')!).outlineStyle,
        };
      });
    expect(await focused()).toEqual({ name: 'tema-trilho', value: 'sistema', ring: 'solid' });
    await page.keyboard.press('ArrowUp');
    expect(await focused()).toMatchObject({ value: 'escuro', ring: 'solid' });
    await expect.poll(() => look(page)).toEqual(expected('escuro', true));
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => look(page)).toEqual(expected('claro', false));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => look(page)).toEqual(expected('sistema', system));
  },
);
