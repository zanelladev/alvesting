import { expect, test } from '@playwright/test';

// O chat desligado (ADR 0035): o desenho do Chat do Rallies, pronto e sem nenhuma chamada. O chat é a etapa 13 e só
// começa depois do aval do orientador (CLAUDE.md). O que este spec prova é o que NÃO acontece: a caixa não aceita texto, nenhum botão responde,
// não há formulário, e nada do que a pessoa faça sai da página (nenhum pedido à api, nenhum envio, nada fora da origem). Os 360 px sem rolagem,
// os alvos de 44 px e o axe nos dois temas estão no laço de ROUTES do layout.spec.ts, que tem o /chat.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local com o banco sintético');

const AVISO =
  'O chat está desligado: ele entra na etapa 13, depois do aval do orientador. Nada aqui chama um modelo nem dá conselho.';
const SUGESTOES = [
  'Resumir o pregão',
  'Comparar os modelos',
  'Explicar uma decisão',
  'Minha carteira',
];

test('a saudação fixa, as abas, a caixa e as sugestões aparecem desligadas, com o aviso', async ({
  page,
}) => {
  await page.goto('/chat');
  await expect(
    page.getByRole('heading', { level: 1, name: 'O que vamos olhar hoje?' }),
  ).toBeVisible();
  const main = page.getByRole('main');
  await expect(main).toContainText(AVISO);

  const chat = main.getByRole('group', { name: 'O chat, desligado' });
  const box = chat.getByRole('textbox', { name: 'Pergunta para o chat' });
  await expect(box).toBeDisabled();
  await expect(box).toHaveAttribute('placeholder', 'O chat ainda não está ligado.');
  await expect(chat.getByRole('button', { name: 'Perguntar' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(chat.getByRole('button', { name: 'Conversas' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(chat.getByRole('button', { name: 'Anexar' })).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Enviar' })).toBeVisible();
  await expect(chat.getByRole('list', { name: 'Sugestões' }).getByRole('button')).toHaveText(
    SUGESTOES,
  );

  // todo controle da tela está desativado (as duas abas, os dois botões da caixa e as quatro sugestões), e não há formulário a enviar
  const buttons = await main.getByRole('button').all();
  expect(buttons).toHaveLength(8);
  for (const button of buttons) await expect(button).toBeDisabled();
  await expect(main.locator('form')).toHaveCount(0);
});

test('nada do que a pessoa faça sai da página: a caixa não aceita texto, os botões não respondem e nenhum pedido vai à api', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (request) => asked.push(`${request.method()} ${request.url()}`));
  await page.goto('/chat');
  await page.waitForLoadState('networkidle');
  const loaded = asked.length;

  // o clique e o teclado vão até a caixa (com `force`: o Playwright não clica em controle desativado por conta própria), e ela segue vazia
  const box = page.getByRole('textbox', { name: 'Pergunta para o chat' });
  await box.click({ force: true });
  await page.keyboard.type('Devo comprar PETR4?');
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue('');
  for (const button of await page.getByRole('main').getByRole('button').all()) {
    await button.click({ force: true });
  }
  await page.waitForLoadState('networkidle');
  // um pedido que saísse de um clique sairia logo: o tempo de ele ter saído, se fosse sair
  await page.waitForTimeout(1_000);

  // nenhum pedido depois da carga; e, desde o começo, só GET da própria origem (o documento e os arquivos dele), nada à api
  expect(asked.slice(loaded)).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(asked.length).toBeGreaterThan(0);
  for (const line of asked) {
    const [method, url] = line.split(' ') as [string, string];
    expect(method, line).toBe('GET');
    expect(new URL(url).origin, line).toBe(origin);
    expect(new URL(url).pathname, line).not.toMatch(/^\/api\//);
  }
  await expect(page).toHaveURL(/\/chat$/);
});

// A tela não tem JavaScript próprio (é de servidor), e o que a casca leva não traz o zod: a mesma conferência das telas da conta e da carteira.
test('o JavaScript da tela não leva o zod ao navegador', async ({ page }) => {
  const scripts: Array<Promise<string>> = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') {
      scripts.push(response.text().catch(() => ''));
    }
  });
  await page.goto('/chat');
  await page.waitForLoadState('networkidle');
  const bodies = await Promise.all(scripts);
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) expect(body).not.toContain('ZodError');
});
