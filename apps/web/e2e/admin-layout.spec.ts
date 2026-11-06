import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { signInViaApi } from './account-support';
import { registerAdmin, seasonFile, test } from './admin-support';
import { FRONT_DOOR_URL } from './api-server';
import { abrirMenu } from './menu';

// Mobile primeiro (plano §13) no painel de admin (etapa 10, parte 2; docs/TELAS.md, seção 8): em pixel-7, iphone-15 e desktop, sem rolagem
// horizontal em 360 px, alvos de toque de pelo menos 44 px (os campos, a lista, a área de texto e as caixas de marcar também), nenhum erro no
// console, o zod fora do JavaScript da tela e acessibilidade (axe) sem violação séria ou crítica, e sem nenhuma violação de qualquer impacto em
// 360 px. O painel vale também com os erros de confirmação à mostra (onde a tela mais muda). O desktop também roda em 360 px: o que conta
// é a largura, não o aparelho. Mesma montagem de e2e/conta-layout.spec.ts (Front Door imitado, api da conta, DLQ falsa).
test.skip(Boolean(process.env.BASE_URL), 'precisa do Front Door imitado e dos servidores da conta');
test.use({ baseURL: FRONT_DOOR_URL });

interface Screen {
  name: string;
  // leva a tela ao estado que se quer medir (os erros de confirmação)
  prepare?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  { name: 'painel' },
  {
    name: 'painel com os erros de confirmação',
    prepare: async (page) => {
      // cada ação sem a caixa marcada: todas as DLQ (a de 60 caracteres inclusive), o rascunho, o reprocesso e o evento corporativo.
      // (Nunca o botão de iniciar a temporada: o e2e não inicia temporada, nem sem querer.)
      const main = page.getByRole('main');
      for (const button of await main.getByRole('button', { name: 'Reenviar para a fila' }).all()) {
        await button.click();
      }
      for (const button of await main.getByRole('button', { name: 'Salvar o rascunho' }).all()) {
        await button.click();
      }
      await main.getByRole('button', { name: 'Reprocessar o ciclo' }).click();
      await main.getByRole('button', { name: 'Registrar o evento' }).click();
    },
  },
];

// A fonte carregada muda a largura do texto: só mede depois dela. Os formulários só valem depois da hidratação.
async function loaded(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Painel da arena' })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  for (const button of await page.getByRole('main').getByRole('button').all()) {
    await expect(button).toBeEnabled();
  }
}

// O rascunho que faz a tela ser medida COM os formulários de editar e iniciar (os maiores da tela), em qualquer ordem de execução: criado
// pela api, com o admin do teste, e não por outro spec que talvez ainda não tenha rodado. O slug tem 64 caracteres SEM hífen (o máximo
// que o contrato aceita: a palavra mais larga que a caixa "Confirmo: iniciar a temporada <slug>" já terá de mostrar). Um por projeto
// (os três rodam juntos no mesmo banco): o segundo teste do projeto recebe 409 e segue. O banco do e2e é recriado a cada execução.
async function ensureLongDraft(page: Page) {
  const project = test.info().project.name.replace(/[^a-z0-9]/g, '');
  const slug = `e2elayout${project}${'x'.repeat(64)}`.slice(0, 64);
  const response = await page.request.post('/api/v1/admin/seasons', {
    headers: { origin: FRONT_DOOR_URL },
    data: seasonFile(slug, 'Rascunho do layout'),
  });
  expect([201, 409], await response.text()).toContain(response.status());
}

async function open(
  page: Page,
  screen: Screen,
  who: {
    request: APIRequestContext;
    ip: string;
    deadLetter: { messageId: string };
    longDeadLetter: { messageId: string };
  },
) {
  const admin = await registerAdmin(who.request, who.ip, 'layout');
  await signInViaApi(page.request, admin);
  await ensureLongDraft(page);
  await page.goto('/admin');
  await loaded(page);
  // as mensagens na DLQ falsa (semeadas antes do teste e removidas depois): a tela é medida com a lista de filas e os formulários de
  // reenvio, o do MessageId curto (`eod:2143-03-14`) e o do de verdade da fila `decisions` (`decide:<ULID>:<ULID>`, 60 caracteres)
  const queues = page.getByRole('region', { name: 'Filas e DLQ', exact: true });
  await expect(queues).toContainText(who.deadLetter.messageId);
  await expect(queues).toContainText(who.longDeadLetter.messageId);
  if (screen.prepare) {
    await screen.prepare(page);
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
  }
}

for (const screen of SCREENS) {
  test.describe(`tela ${screen.name} (/admin)`, () => {
    test('em 360 px não rola na horizontal, o cabeçalho cabe e os alvos de toque têm pelo menos 44 px', async ({
      page,
      request,
      ip,
      deadLetter,
      longDeadLetter,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await open(page, screen, { request, ip, deadLetter, longDeadLetter });

      const { scrollWidth, clientWidth, bodyWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      expect(bodyWidth).toBeLessThanOrEqual(clientWidth);

      // o cabeçalho cabe na largura, e a folha do menu abre com os sete links dentro dela, cada um com 44 px de altura (ADR 0034: em 360 px o
      // menu é a folha que o botão "Menu" abre, uma linha por tela; o mesmo do carteira-layout.spec.ts). A contagem vem antes das medidas: sem
      // ela o laço passaria em vazio se o cabeçalho sumisse
      await abrirMenu(page);
      const bannerLinks = await page.getByRole('banner').getByRole('link').all();
      expect(bannerLinks.length).toBeGreaterThanOrEqual(8);
      for (const link of bannerLinks) {
        const box = (await link.boundingBox())!;
        expect(box.x, await link.innerText()).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, await link.innerText()).toBeLessThanOrEqual(360);
        expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.95);
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('navigation', { name: 'Principal' })).toBeHidden();

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

    test('não deixa erro no console nem exceção na página, e leva o aviso fixo e as atribuições', async ({
      page,
      request,
      ip,
      deadLetter,
      longDeadLetter,
    }) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`exceção: ${error.message}`));
      page.on('requestfailed', (failed) => problems.push(`pedido falhou: ${failed.url()}`));
      await open(page, screen, { request, ip, deadLetter, longDeadLetter });
      // dá tempo de a hidratação acontecer e de o rodapé (que chega por streaming) terminar
      const footer = page.getByRole('contentinfo');
      await expect(footer).toContainText('brapi.dev, pregão de');
      await page.waitForLoadState('networkidle');
      expect(problems).toEqual([]);

      // o aviso fixo (regra do Artur: o software é educacional e não se responsabiliza pelas decisões do usuário) e as atribuições
      await expect(footer).toContainText('Arena acadêmica com dinheiro fictício');
      await expect(footer).toContainText('não se responsabiliza pelas decisões do usuário');
      await expect(footer).toContainText('Fonte: Banco Central do Brasil');
      await expect(footer).toContainText('Contém dados da CVM');
    });

    // O JavaScript que o navegador baixa nesta tela não leva o zod: o painel usa só o que o cliente do navegador precisa (admin-client.ts), e
    // os schemas do contrato ficam no servidor, que valida a resposta da api antes de montar o HTML.
    test('o JavaScript da tela não leva o zod ao navegador', async ({
      page,
      request,
      ip,
      deadLetter,
      longDeadLetter,
    }) => {
      const scripts: Array<Promise<string>> = [];
      page.on('response', (response) => {
        if (response.request().resourceType() === 'script') {
          scripts.push(response.text().catch(() => ''));
        }
      });
      await open(page, screen, { request, ip, deadLetter, longDeadLetter });
      await page.waitForLoadState('networkidle');
      const bodies = await Promise.all(scripts);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) expect(body).not.toContain('ZodError');
    });

    test('acessibilidade (axe): nenhuma violação séria ou crítica', async ({
      page,
      request,
      ip,
      deadLetter,
      longDeadLetter,
    }) => {
      await open(page, screen, { request, ip, deadLetter, longDeadLetter });
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
      deadLetter,
      longDeadLetter,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await open(page, screen, { request, ip, deadLetter, longDeadLetter });
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
