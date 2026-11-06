import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { envelopeSchema, meSchema, type Position, type Totals } from '@alvesting/contracts';
import {
  contextOptions,
  fakeIp,
  registerVerifiedUser,
  signInViaApi,
  test,
  type User,
} from './account-support';
import { FRONT_DOOR_URL } from './api-server';
import { ORIGIN, addLot, wallet } from './carteira-support';
import { abrirMenu } from './menu';
import { brl, dmy, pct, ratioBps } from './data';

// A tela da carteira (etapa 12, parte 2; docs/TELAS.md, seção 9), em pixel-7, iphone-15 (WebKit) e desktop, como todo e2e. O navegador fala com
// UMA origem só, o Front Door imitado (e2e/front-door.ts): `/api/*` vai para a api da conta, que roda no login de menor privilégio do Postgres
// (alvesting_api), e o resto para o site, atrás da trava de origem. Dado e pessoa são sintéticos: os tickers são os do mercado do ensaio (MOVE3,
// SINA3, PAUS3...), os e-mails são @example.test, e nada vai à rede. Cada teste tem o usuário e o IP dele: os três projetos rodam juntos.
//
// O que a tela mostra é conferido contra o que a PRÓPRIA api diz (`GET /api/v1/me/portfolio`), reescrito por um formatador do teste (e2e/data.ts), e
// o que a regra de dinheiro faz (os dois modos dão o mesmo custo) é conferido com números escritos aqui, à mão. O que a api do e2e não produz (o
// ticker sem barra, o aceite vencido) fica nos testes de unidade da página e no carteira-layout.spec.ts (api falsa).
test.skip(Boolean(process.env.BASE_URL), 'precisa do Front Door imitado e dos servidores da conta');
test.use({ baseURL: FRONT_DOOR_URL });

// --- o que a api diz, e o que a tela tem de dizer ------------------------------------------------------------------------------
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, '.');
const signed = (cents: number) => (cents > 0 ? `+${brl(cents)}` : brl(cents));
// pontos-base -> "+1.767,24%" (com o ponto de milhar: o `pct` de data.ts não agrupa, e um resultado de mais de 1.000% existe)
const percent = (bps: number) => {
  const abs = Math.abs(bps);
  const sign = bps < 0 ? '-' : bps > 0 ? '+' : '';
  return `${sign}${group(Math.floor(abs / 100))},${String(abs % 100).padStart(2, '0')}%`;
};
const pnlWord = (cents: number) => (cents > 0 ? 'ganho' : cents < 0 ? 'perda' : 'sem variação');

function positionCells(p: Position): string[] {
  const priced = p.closeCents !== null;
  return [
    p.ticker,
    priced ? brl(p.valueCents!) : 'sem cotação',
    priced
      ? `${signed(p.pnlCents!)} ${p.pnlBps === null ? 'sem percentual' : percent(p.pnlBps)} · ${pnlWord(p.pnlCents!)}`
      : '—',
    group(p.quantity),
    brl(p.avgPriceCents),
    priced ? `${brl(p.closeCents!)} em ${dmy(p.closeDate!)}` : '—',
  ];
}

// a coluna da carteira, na ordem do Today do Rallies (docs/redesign-rallies/plano.md, f.3): o valor estimado, o resultado e o custo total
function summaryValues(t: Totals): string[] {
  const priced = t.valueCents !== null;
  return [
    priced ? brl(t.valueCents!) : 'sem cotação',
    priced
      ? `${signed(t.pnlCents!)} (${t.pnlBps === null ? 'sem percentual' : percent(t.pnlBps)}, ${pnlWord(t.pnlCents!)})`
      : 'sem cotação',
    brl(t.costCents),
  ];
}

// --- a página ------------------------------------------------------------------------------------------------------------------
// Depois de lançar, editar ou apagar a tela espera o servidor refazer a página (a api, o Next e a renderização): numa máquina carregada isso passa
// dos 5 s padrão do `expect`, e o que o teste quer provar não é a pressa. Só as esperas que vêm depois de uma mutação usam este prazo.
const settled = expect.configure({ timeout: 15_000 });

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const lotCards = (page: Page) => region(page, 'Lançamentos').getByRole('listitem');
// O aviso do que acabou de acontecer é o da pilha de avisos da página (o Animated Toast Stack da beUI, components/avisos.tsx): a lista "Avisos",
// com aria-live polite, fixa no pé da tela. Até a design premium era um parágrafo `role="status"` no topo da seção; o texto e o foco são os mesmos.
// Dois avisos iguais seguidos podem estar juntos na pilha: o que vale é o mais novo, o último.
const avisos = (page: Page) => page.getByRole('list', { name: 'Avisos', exact: true });
const notice = (page: Page, text: string) =>
  avisos(page).getByRole('listitem').filter({ hasText: text }).last();
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Minha carteira' });
// O texto que o leitor de tela lê em cada elemento: sem o que está em aria-hidden (as rodas dos algarismos do contador da Arc, que levam o número
// inteiro num sr-only), com os espaços juntos (o sem quebra do "R$ " vira espaço comum, como no `toHaveText`).
const readText = (locator: Locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const copy = element.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    }),
  );

// Os campos do formulário (o de lançar e o de editar são o mesmo): o escopo é o formulário.
const fields = (scope: Locator) => ({
  ticker: scope.getByLabel('Ticker', { exact: true }),
  quantity: scope.getByLabel('Quantidade', { exact: true }),
  unit: scope.getByRole('radio', { name: 'Preço por ação' }),
  total: scope.getByRole('radio', { name: 'Valor total pago' }),
  // o rótulo troca com o modo ("Preço por ação (R$)" / "Valor total pago (R$)")
  value: scope.getByRole('textbox', { name: /^(Preço por ação|Valor total pago) \(R\$\)$/ }),
  date: scope.getByLabel('Data da compra (opcional)', { exact: true }),
});

const createForm = (page: Page) => page.getByRole('form', { name: 'Lançar uma compra' });

interface Typed {
  ticker: string;
  quantity: string;
  mode?: 'unit' | 'total';
  value: string;
  boughtOn?: string;
}

// O modo vem ANTES do valor: trocar de modo apaga o que foi digitado no valor (o mesmo número quer dizer outra coisa no outro modo).
async function fill(scope: Locator, lot: Typed): Promise<void> {
  const f = fields(scope);
  await f.ticker.fill(lot.ticker);
  await f.quantity.fill(lot.quantity);
  if (lot.mode === 'total') await f.total.check();
  if (lot.mode === 'unit') await f.unit.check();
  await f.value.fill(lot.value);
  if (lot.boughtOn !== undefined) await f.date.fill(lot.boughtOn);
}

async function expectPositions(page: Page, request: APIRequestContext): Promise<void> {
  const { positions } = await wallet(request);
  const rows = region(page, 'Posições').getByRole('row');
  await settled(rows).toHaveCount(positions.length + 1);
  for (const p of positions) {
    const row = rows.filter({ has: page.getByRole('rowheader', { name: p.ticker, exact: true }) });
    await settled(row.locator('th, td')).toHaveText(positionCells(p));
  }
}

async function expectSummary(page: Page, request: APIRequestContext): Promise<void> {
  const { totals } = await wallet(request);
  await expect
    .poll(() => readText(region(page, 'Resumo').locator('dd')), { timeout: 15_000 })
    .toEqual(summaryValues(totals));
}

async function signedIn(
  page: Page,
  request: APIRequestContext,
  ip: string,
  label: string,
): Promise<User> {
  const user = await registerVerifiedUser(request, ip, label);
  await signInViaApi(page.request, user);
  return user;
}

// Percorre o teclado até o elemento: a pessoa que não usa o mouse chega a ele por Tab, e o teste prova que existe esse caminho.
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 80; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('o teclado não chegou ao elemento');
}

// Segura a resposta de um pedido até o teste liberá-la: é como se vê a tela ENQUANTO a api ainda não respondeu (o envio duplo, o que mais dá para
// tocar). Sem espera fixa: o pedido sai para a api de verdade quando o teste manda, e `calls()` diz quantos desse método chegaram à rede.
async function hold(page: Page, url: string, method: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    calls += 1;
    await gate;
    await route.continue();
  });
  return { release, calls: () => calls };
}

test.describe('quem pode abrir a carteira', () => {
  test('sem sessão, o link do cabeçalho leva à entrada com a volta, e depois de entrar a carteira abre', async ({
    page,
    request,
    ip,
  }) => {
    const user = await registerVerifiedUser(request, ip, 'carteira-entrar');
    await page.goto('/ranking');
    // a casca do app não lê a sessão: o link é o mesmo com ou sem login (o trilho no desktop, a barra de abas no pé no celular)
    await abrirMenu(page);
    await page.getByRole('banner').getByRole('link', { name: 'Carteira', exact: true }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?proximo=%2Fcarteira`);

    await page.getByLabel('E-mail', { exact: true }).fill(user.email);
    await page.getByLabel('Senha', { exact: true }).fill(user.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/carteira`);
    await expect(heading(page)).toBeVisible();
  });

  test('a página é privada: 307 para a entrada sem sessão, e com sessão não vai a cache nenhum, não é indexada e não entrega o token', async ({
    page,
    request,
    ip,
  }) => {
    const anonymous = await request.get('/carteira', { maxRedirects: 0 });
    expect(anonymous.status()).toBe(307);
    expect(new URL(anonymous.headers().location!, FRONT_DOOR_URL).href).toBe(
      `${FRONT_DOOR_URL}/entrar?proximo=%2Fcarteira`,
    );
    expect(anonymous.headers()['cache-control']).toContain('no-store');

    await signedIn(page, request, ip, 'carteira-privada');
    await addLot(page.request, {
      ticker: 'MOVE3',
      quantity: 12,
      mode: 'unit',
      valueCents: 1_234,
    });
    const session = (await page.context().cookies()).find((c) => c.name.endsWith('session_token'))!;
    const own = await page.request.get('/carteira');
    expect(own.status()).toBe(200);
    const cacheControl = own.headers()['cache-control']!;
    expect(cacheControl).toContain('private');
    expect(cacheControl).toContain('no-store');
    expect(own.headers().etag).toBeUndefined();
    expect(own.headers()['set-cookie']).toBeUndefined();
    const html = await own.text();
    expect(html).toContain('MOVE3');
    // o que vai ao navegador junto com a lista (o payload do React) é só o que a tela usa de cada lançamento: os instantes de criação e de
    // edição ficam no servidor (testado com a regex, e não com `not.toContain`, para a falha não despejar a página inteira no relatório)
    expect(
      /createdAt|updatedAt/.test(html),
      'o payload do React leva os instantes de criação ou de edição do lançamento',
    ).toBe(false);
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(html).not.toContain(session.value);
  });

  test('uma sessão que a api não reconhece também manda para a entrada (e não mostra erro)', async ({
    page,
  }) => {
    await page.context().addCookies([
      {
        name: '__Secure-alvesting.session_token',
        value: 'sessao-que-nao-existe.assinatura',
        url: FRONT_DOOR_URL,
        secure: true,
        httpOnly: true,
      },
    ]);
    await page.goto('/carteira');
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?proximo=%2Fcarteira`);
  });
});

test.describe('lançar uma compra', () => {
  test('a carteira vazia explica o que é e mostra o formulário, o aviso e nenhuma tabela', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-vazia');
    await page.goto('/carteira');
    await expect(heading(page)).toBeVisible();

    const main = page.getByRole('main');
    // o aviso da carteira (a tela diz que o valor é estimado e que não é recomendação) e o aviso fixo do site, no rodapé
    await expect(main).toContainText(
      'Valores estimados pelo último fechamento disponível; não é recomendação de investimento.',
    );
    await expect(page.getByRole('contentinfo')).toContainText(
      'O software não se responsabiliza pelas decisões do usuário',
    );
    await expect(region(page, 'Lançamentos')).toContainText(
      'Você ainda não lançou nenhuma compra.',
    );
    await settled(lotCards(page)).toHaveCount(0);
    await settled(region(page, 'Resumo')).toHaveCount(0);
    await settled(region(page, 'Posições')).toHaveCount(0);
    // sem lançamentos o formulário está logo abaixo: não há atalho para ele
    await expect(region(page, 'Lançamentos').getByRole('link')).toHaveCount(0);

    // o painel "Perguntar" (o chat desligado; docs/redesign-rallies/plano.md, f.3): a frase e o link para o /chat, e nada para digitar nem tocar
    const ask = region(page, 'Perguntar');
    await expect(ask).toContainText('O chat sobre a sua carteira ainda está desligado');
    await expect(ask.getByRole('link', { name: 'Abrir o chat' })).toHaveAttribute('href', '/chat');
    await expect(ask.getByRole('button')).toHaveCount(0);
    await expect(ask.getByRole('textbox')).toHaveCount(0);

    // o formulário: o modo "preço por ação" já vem marcado, a data é opcional e o campo de valor diz o que pede
    const f = fields(createForm(page));
    await expect(createForm(page)).toBeVisible();
    await expect(f.unit).toBeChecked();
    await expect(f.total).not.toBeChecked();
    // trocar a opção apaga o valor digitado, e o grupo avisa (o leitor de tela lê a dica ao entrar no grupo)
    await expect(
      createForm(page).getByRole('group', { name: 'Como você vai informar o valor?' }),
    ).toHaveAccessibleDescription('Ao trocar a opção, o valor digitado é apagado.');
    await expect(f.quantity).toHaveAttribute('inputmode', 'numeric');
    await expect(f.value).toHaveAttribute('inputmode', 'decimal');
    await expect(f.date).toHaveAttribute('type', 'date');
    await expect(f.value).toHaveAccessibleDescription(/O preço de uma ação/);
    await f.total.check();
    await expect(f.value).toHaveAccessibleName('Valor total pago (R$)');
    await expect(f.value).toHaveAccessibleDescription(/O total que você pagou/);

    // quem não sabe o código da ação busca na lista da arena, noutra aba (o formulário preenchido não se perde)
    const search = region(page, 'Lançar uma compra').getByRole('link', {
      name: /^Buscar uma ação/,
    });
    await expect(search).toHaveAttribute('href', '/acoes');
    await expect(search).toHaveAttribute('target', '_blank');
    await expect(search).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('os dois modos de preço dão o mesmo custo total, e a posição soma os dois lançamentos', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-modos');
    await page.goto('/carteira');
    const form = createForm(page);
    const f = fields(form);

    // por ação: 100 ações a R$ 35,50
    await fill(form, {
      ticker: 'move3',
      quantity: '100',
      mode: 'unit',
      value: '35,50',
      boughtOn: '2026-10-15',
    });
    await form.getByRole('button', { name: 'Lançar compra' }).click();
    const first = notice(page, 'Compra lançada: 100 MOVE3, custo total R$ 3.550,00.');
    await settled(first).toBeVisible();
    // o aviso recebe o foco: o botão que enviou ficou desativado, e no celular o aviso fica longe do formulário
    await settled(first).toBeFocused();
    await settled(lotCards(page)).toHaveCount(1);
    await expect(lotCards(page).first().locator('dd')).toHaveText([
      '100',
      'R$ 3.550,00',
      '15/10/2026',
    ]);
    // com lançamentos há um atalho para o formulário, que fica depois da lista inteira
    await expect(
      region(page, 'Lançamentos').getByRole('link', { name: 'Ir para o formulário de lançar' }),
    ).toHaveAttribute('href', '#lancar');
    // o formulário volta limpo, pronto para o próximo
    await expect(f.ticker).toHaveValue('');
    await expect(f.quantity).toHaveValue('');
    await expect(f.value).toHaveValue('');
    await expect(f.unit).toBeChecked();

    // valor total: os mesmos 100 MOVE3 com o total de R$ 3.550,00
    await fill(form, {
      ticker: 'MOVE3',
      quantity: '100',
      mode: 'total',
      value: '3.550,00',
      boughtOn: '2026-10-15',
    });
    await form.getByRole('button', { name: 'Lançar compra' }).click();
    await settled(
      notice(page, 'Compra lançada: 100 MOVE3, custo total R$ 3.550,00.'),
    ).toBeFocused();
    await settled(lotCards(page)).toHaveCount(2);
    for (const card of await lotCards(page).all()) {
      await expect(card.locator('dt')).toHaveText(['Quantidade', 'Custo total', 'Data da compra']);
      await settled(card.locator('dd')).toHaveText(['100', 'R$ 3.550,00', '15/10/2026']);
    }

    // a api guardou o mesmo custo nos dois, em centavos
    const saved = await wallet(page.request);
    expect(saved.lots.map((lot) => lot.costCents)).toEqual([355_000, 355_000]);

    // a posição soma: 200 ações, R$ 7.100,00 de custo e preço médio de R$ 35,50
    await expect(region(page, 'Posições').getByRole('row')).toHaveCount(2);
    expect(saved.positions).toMatchObject([
      { ticker: 'MOVE3', quantity: 200, costCents: 710_000, avgPriceCents: 3_550 },
    ]);
    await expectPositions(page, page.request);
    await expectSummary(page, page.request);
    // o custo total é o último par da coluna (o valor estimado vem primeiro, como no Today)
    expect((await readText(region(page, 'Resumo').locator('dd'))).at(-1)).toBe('R$ 7.100,00');
  });

  // O mesmo custo para os mesmos números, com valores que pedem milhar e centavos: o produto é feito em centavos inteiros, nunca em float.
  for (const pair of [
    { quantity: 7, unit: '1.234,56', total: '8.641,92', cost: 'R$ 8.641,92' },
    { quantity: 250, unit: '0,07', total: '17,50', cost: 'R$ 17,50' },
  ]) {
    test(`${pair.quantity} ações a R$ ${pair.unit} e o total de R$ ${pair.total} mostram o mesmo custo (${pair.cost})`, async ({
      page,
      request,
      ip,
    }) => {
      await signedIn(page, request, ip, 'carteira-par');
      await page.goto('/carteira');
      const form = createForm(page);
      let saved = 0;
      for (const [mode, value] of [
        ['unit', pair.unit],
        ['total', pair.total],
      ] as const) {
        await fill(form, { ticker: 'SINA3', quantity: String(pair.quantity), mode, value });
        await form.getByRole('button', { name: 'Lançar compra' }).click();
        // os dois avisos são iguais (é o ponto do teste): espera a lista ter mais um cartão antes de olhar o foco do aviso
        saved += 1;
        await settled(lotCards(page)).toHaveCount(saved);
        await expect(
          notice(page, `Compra lançada: ${pair.quantity} SINA3, custo total ${pair.cost}.`),
        ).toBeFocused();
      }
      await settled(lotCards(page)).toHaveCount(2);
      for (const card of await lotCards(page).all()) {
        await settled(card.locator('dd').nth(1)).toHaveText(pair.cost);
        await expect(card.locator('dd').nth(2)).toHaveText('sem data');
      }
      const costs = (await wallet(page.request)).lots.map((lot) => lot.costCents);
      expect(costs[0]).toBe(costs[1]);
    });
  }

  test('os erros ficam no campo, em português, com o foco no primeiro e nada é enviado', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-erros');
    await page.goto('/carteira');
    const form = createForm(page);
    const f = fields(form);
    const submit = form.getByRole('button', { name: 'Lançar compra' });
    // "nada é enviado": nenhum pedido de lançamento sai do navegador (a api também recusaria estes valores, então só a contagem prova)
    let posts = 0;
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && sent.url().endsWith('/api/v1/me/portfolio/lots')) posts += 1;
    });

    // tudo vazio: um erro por campo, o foco no primeiro
    await submit.click();
    await expect(f.ticker).toBeFocused();
    await expect(f.ticker).toHaveAttribute('aria-invalid', 'true');
    await expect(f.ticker).toHaveAccessibleDescription(/Informe o ticker/);
    await expect(f.quantity).toHaveAccessibleDescription(/Informe a quantidade/);
    await expect(f.value).toHaveAccessibleDescription(/Informe o valor/);
    expect((await wallet(page.request)).lots).toEqual([]);

    // corrigir o campo apaga o erro dele na hora; os outros ficam
    await f.ticker.fill('MOVE3');
    await expect(f.ticker).not.toHaveAttribute('aria-invalid', 'true');
    await expect(f.quantity).toHaveAttribute('aria-invalid', 'true');

    // a quantidade é inteira (o ponto de milhar não vale), e o valor não adivinha o que "1.234" quer dizer
    await f.quantity.fill('1.000');
    await f.value.fill('1.234');
    await submit.click();
    await expect(f.quantity).toBeFocused();
    await expect(f.quantity).toHaveAccessibleDescription(/Use só números inteiros/);
    await expect(f.value).toHaveAccessibleDescription(/Escreva 1\.234,00 ou 1234/);

    await f.quantity.fill('100');
    await f.value.fill('12,345');
    await submit.click();
    await expect(f.value).toBeFocused();
    await expect(f.value).toHaveAccessibleDescription(/no máximo 2 casas/);
    // no modo "por ação", a saída para um preço com mais casas é o total
    await expect(f.value).toHaveAccessibleDescription(/Valor total pago/);

    // o produto passa do teto: 1.000.000 de ações a R$ 100.000,00 (R$ 100 bilhões)
    await f.quantity.fill('1000000');
    await f.value.fill('100.000,00');
    await submit.click();
    await expect(f.value).toHaveAccessibleDescription(
      /O custo total passa de R\$\s1\.000\.000\.000,00/,
    );
    expect(posts).toBe(0);
    expect((await wallet(page.request)).lots).toEqual([]);
  });

  test('o que só a api sabe (ação desconhecida, data futura) também sai no campo certo, e o formulário segue usável', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-api');
    await page.goto('/carteira');
    const form = createForm(page);
    const f = fields(form);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    await fill(form, {
      ticker: 'ZZZZ9',
      quantity: '10',
      mode: 'unit',
      value: '10,00',
      boughtOn: future,
    });
    await form.getByRole('button', { name: 'Lançar compra' }).click();
    // dois campos recusados pela api; o foco vai ao primeiro, e o formulário volta a poder ser enviado
    await settled(f.ticker).toBeFocused();
    await expect(f.ticker).toHaveAccessibleDescription(/Não encontramos esta ação/);
    await expect(f.date).toHaveAccessibleDescription(/não pode ser no futuro/);
    await expect(form.getByRole('button', { name: 'Lançar compra' })).toBeEnabled();
    expect((await wallet(page.request)).lots).toEqual([]);

    // a pessoa corrige os dois e o lançamento entra, sem recarregar a página
    await f.ticker.fill('SINA3');
    await f.date.fill('');
    await form.getByRole('button', { name: 'Lançar compra' }).click();
    await settled(notice(page, 'Compra lançada: 10 SINA3, custo total R$ 100,00.')).toBeVisible();
    await settled(lotCards(page)).toHaveCount(1);
  });

  // O que o navegador faz com as respostas que a api do e2e não produz de propósito (o teto, o aceite, a sessão): a resposta é fingida no
  // caminho, e a tela tem de dizer o que fazer, em português, sem repetir a mensagem da api e sem perder o que foi digitado.
  test('as falhas do envio dizem o que fazer, sem perder o que foi digitado', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-falhas');
    await page.goto('/carteira');
    const form = createForm(page);
    const f = fields(form);
    await fill(form, { ticker: 'MOVE3', quantity: '5', mode: 'unit', value: '10,00' });

    type Fake = { status: number; code?: string } | 'rede';
    let reply = { status: 500 } as Fake;
    // todo envio é fingido no caminho: a conta de pedidos prova que cada um saiu do navegador (a lista da api, vazia, não prova nada aqui)
    let posts = 0;
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && sent.url().endsWith('/api/v1/me/portfolio/lots')) posts += 1;
    });
    await page.route('**/api/v1/me/portfolio/lots', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      if (reply === 'rede') return route.abort('connectionreset');
      return route.fulfill({
        status: reply.status,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: { code: reply.code ?? 'INTERNAL_ERROR', message: 'mensagem crua da api' },
        }),
      });
    });

    const cases: Array<[Fake, RegExp, string?]> = [
      [{ status: 409, code: 'LOT_LIMIT' }, /máximo de 200 lançamentos/],
      [{ status: 403, code: 'CONSENT_REQUIRED' }, /Os termos mudaram/, '/conta'],
      [{ status: 401, code: 'UNAUTHORIZED' }, /Sua sessão acabou/, '/entrar?proximo=%2Fcarteira'],
      [{ status: 500 }, /Não foi possível concluir agora/],
      ['rede', /Sem conexão com o servidor/],
    ];
    for (const [response, text, link] of cases) {
      reply = response;
      await form.getByRole('button', { name: 'Lançar compra' }).click();
      const alert = form.getByRole('alert');
      await expect(alert).toContainText(text);
      await expect(alert).toBeFocused();
      // nunca a mensagem crua da api
      await expect(alert).not.toContainText('mensagem crua');
      if (link) await expect(alert.getByRole('link')).toHaveAttribute('href', link);
      // nada se perdeu, e dá para tentar de novo
      await expect(f.ticker).toHaveValue('MOVE3');
      await expect(f.value).toHaveValue('10,00');
      await expect(form.getByRole('button', { name: 'Lançar compra' })).toBeEnabled();
    }
    expect(posts).toBe(cases.length);
  });

  // O envio duplo (docs/TELAS.md, seção 9): o duplo clique em "Lançar compra" com a api ainda sem responder manda UM pedido só, o formulário
  // fica desativado em "Enviando…", e o lançamento entra uma vez.
  test('o duplo clique em Lançar compra manda um pedido só', async ({ page, request, ip }) => {
    await signedIn(page, request, ip, 'carteira-duplo');
    await page.goto('/carteira');
    const form = createForm(page);
    const f = fields(form);
    const held = await hold(page, '**/api/v1/me/portfolio/lots', 'POST');
    await fill(form, { ticker: 'MOVE3', quantity: '5', mode: 'unit', value: '10,00' });

    await form.getByRole('button', { name: 'Lançar compra' }).dblclick();
    await expect(form.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    await expect(f.ticker).toBeDisabled();
    expect(held.calls()).toBe(1);

    held.release();
    await settled(notice(page, 'Compra lançada: 5 MOVE3, custo total R$ 50,00.')).toBeVisible();
    await settled(lotCards(page)).toHaveCount(1);
    expect(held.calls()).toBe(1);
    expect((await wallet(page.request)).lots).toHaveLength(1);
  });

  // A página restaurada do cache de ida e volta (o botão "voltar"; o mesmo evento que o conta.spec.ts dispara na conta): o formulário volta ao
  // começo, e o modo, que mora no React e não no DOM, volta junto. Sem isso o rótulo diria "total" com o radio "por ação" marcado.
  test('a página restaurada do cache de ida e volta devolve o formulário ao começo, com o modo igual ao rótulo', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-restaurada');
    await page.goto('/carteira');
    const form = createForm(page);
    const f = fields(form);
    await fill(form, { ticker: 'MOVE3', quantity: '5', mode: 'total', value: '100,00' });
    await expect(f.value).toHaveAccessibleName('Valor total pago (R$)');

    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await expect(f.ticker).toHaveValue('');
    await expect(f.value).toHaveValue('');
    await expect(f.unit).toBeChecked();
    await expect(f.total).not.toBeChecked();
    await expect(f.value).toHaveAccessibleName('Preço por ação (R$)');
    await expect(f.value).toHaveAccessibleDescription(/O preço de uma ação/);

    // um pageshow que NÃO é de uma restauração (a carga normal) não mexe em nada
    await f.total.check();
    await f.value.fill('100,00');
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })),
    );
    await expect(f.total).toBeChecked();
    await expect(f.value).toHaveValue('100,00');
    await expect(f.value).toHaveAccessibleName('Valor total pago (R$)');
  });
});

test.describe('editar e apagar', () => {
  const seed = async (page: Page) => {
    await addLot(page.request, {
      ticker: 'MOVE3',
      quantity: 100,
      mode: 'unit',
      valueCents: 3_550,
      boughtOn: '2026-10-15',
    });
    await addLot(page.request, {
      ticker: 'SINA3',
      quantity: 10,
      mode: 'total',
      valueCents: 20_000,
      boughtOn: '2026-10-10',
    });
  };

  test('editar usa o mesmo formulário, já preenchido, e a posição acompanha', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-editar');
    await seed(page);
    await page.goto('/carteira');
    const card = lotCards(page).filter({ hasText: 'MOVE3' });
    await settled(lotCards(page)).toHaveCount(2);

    await card.getByRole('button', { name: /^Editar/ }).click();
    const form = page.getByRole('form', { name: 'Editar lançamento de 100 MOVE3' });
    const f = fields(form);
    // o foco vai ao primeiro campo, e o custo guardado volta como "valor total pago"
    await expect(f.ticker).toBeFocused();
    await expect(f.ticker).toHaveValue('MOVE3');
    await expect(f.quantity).toHaveValue('100');
    await expect(f.total).toBeChecked();
    await expect(f.value).toHaveAccessibleName('Valor total pago (R$)');
    await expect(f.value).toHaveValue('3550,00');
    // o custo guardado é o total de TODAS as ações: quem muda só a quantidade é lembrado de conferi-lo
    await expect(f.value).toHaveAccessibleDescription(/Mudou a quantidade\? Confira este total\./);
    await expect(f.date).toHaveValue('2026-10-15');
    // o outro lançamento segue como estava, sem formulário
    await expect(lotCards(page).filter({ hasText: 'SINA3' }).getByRole('form')).toHaveCount(0);

    await f.quantity.fill('50');
    await f.value.fill('1.775,00');
    await form.getByRole('button', { name: 'Salvar alterações' }).click();

    await settled(
      notice(page, 'Lançamento salvo: 50 MOVE3, custo total R$ 1.775,00.'),
    ).toBeVisible();
    await settled(page.getByRole('form', { name: /^Editar lançamento/ })).toHaveCount(0);
    await settled(card.locator('dd')).toHaveText(['50', 'R$ 1.775,00', '15/10/2026']);
    // o foco volta ao botão que abriu a edição: a pessoa continua onde estava
    await settled(card.getByRole('button', { name: /^Editar/ })).toBeFocused();

    const saved = (await wallet(page.request)).lots.find((lot) => lot.ticker === 'MOVE3')!;
    expect(saved).toMatchObject({ quantity: 50, costCents: 177_500, boughtOn: '2026-10-15' });
    await expectPositions(page, page.request);
    await expectSummary(page, page.request);
  });

  test('trocar o modo na edição apaga o valor (o mesmo número quer dizer outra coisa), e o custo sai da conta do modo novo', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-modo-edicao');
    await seed(page);
    await page.goto('/carteira');
    const card = lotCards(page).filter({ hasText: 'MOVE3' });
    await card.getByRole('button', { name: /^Editar/ }).click();
    const form = page.getByRole('form', { name: 'Editar lançamento de 100 MOVE3' });
    const f = fields(form);
    await expect(f.value).toHaveValue('3550,00');

    await f.unit.check();
    await expect(f.value).toHaveAccessibleName('Preço por ação (R$)');
    await expect(f.value).toHaveValue('');
    // em "preço por ação" a dica do total não vale mais
    await expect(f.value).not.toHaveAccessibleDescription(/Mudou a quantidade/);
    // sem o valor novo, o envio é recusado: o total antigo não vira preço por ação em silêncio
    await form.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(f.value).toHaveAccessibleDescription(/Informe o valor/);

    await f.value.fill('40');
    await form.getByRole('button', { name: 'Salvar alterações' }).click();
    // 100 ações a R$ 40,00 = R$ 4.000,00
    await settled(
      notice(page, 'Lançamento salvo: 100 MOVE3, custo total R$ 4.000,00.'),
    ).toBeVisible();
    await settled(card.locator('dd').nth(1)).toHaveText('R$ 4.000,00');
    expect((await wallet(page.request)).lots.find((lot) => lot.ticker === 'MOVE3')!.costCents).toBe(
      400_000,
    );
  });

  test('cancelar a edição não muda nada e devolve o foco', async ({ page, request, ip }) => {
    await signedIn(page, request, ip, 'carteira-cancelar-edicao');
    await seed(page);
    await page.goto('/carteira');
    const card = lotCards(page).filter({ hasText: 'MOVE3' });
    await card.getByRole('button', { name: /^Editar/ }).click();
    const form = page.getByRole('form', { name: 'Editar lançamento de 100 MOVE3' });
    await fields(form).quantity.fill('99');
    await form.getByRole('button', { name: 'Cancelar edição' }).click();

    await settled(page.getByRole('form', { name: /^Editar lançamento/ })).toHaveCount(0);
    await settled(card.locator('dd')).toHaveText(['100', 'R$ 3.550,00', '15/10/2026']);
    await settled(card.getByRole('button', { name: /^Editar/ })).toBeFocused();
    expect((await wallet(page.request)).lots.map((lot) => lot.quantity).sort()).toEqual([10, 100]);
  });

  test('apagar pede a confirmação na própria página (nenhuma janela do navegador), e só apaga com ela', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-apagar');
    await seed(page);
    await page.goto('/carteira');
    // window.confirm, alert e prompt chegam como evento de diálogo: nenhum pode abrir
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    const card = lotCards(page).filter({ hasText: 'MOVE3' });
    await card.getByRole('button', { name: /^Apagar/ }).click();
    const question = card.getByRole('group', {
      name: 'Apagar o lançamento de 100 MOVE3, custo total R$ 3.550,00? Não dá para desfazer.',
    });
    await expect(question).toBeVisible();
    // a pergunta recebe o foco (o leitor de tela a lê), e nada foi apagado ainda
    await expect(question.getByText(/^Apagar o lançamento/)).toBeFocused();
    expect((await wallet(page.request)).lots).toHaveLength(2);

    // "Não, manter": a pergunta some, o lançamento fica e o foco volta ao botão de apagar
    await question.getByRole('button', { name: 'Não, manter' }).click();
    await settled(question).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^Apagar/ })).toBeFocused();
    expect((await wallet(page.request)).lots).toHaveLength(2);

    // "Sim, apagar": some o lançamento, a posição e o resumo acompanham
    await card.getByRole('button', { name: /^Apagar/ }).click();
    await question.getByRole('button', { name: 'Sim, apagar' }).click();
    const done = notice(page, 'Lançamento apagado: 100 MOVE3.');
    await settled(done).toBeVisible();
    await settled(done).toBeFocused();
    await settled(lotCards(page)).toHaveCount(1);
    await expect(card).toHaveCount(0);
    expect((await wallet(page.request)).lots.map((lot) => lot.ticker)).toEqual(['SINA3']);
    await expectPositions(page, page.request);
    await expectSummary(page, page.request);

    // o último: a carteira volta ao estado vazio, sem resumo nem posições
    await lotCards(page)
      .first()
      .getByRole('button', { name: /^Apagar/ })
      .click();
    await lotCards(page).first().getByRole('button', { name: 'Sim, apagar' }).click();
    await settled(notice(page, 'Lançamento apagado: 10 SINA3.')).toBeFocused();
    await expect(region(page, 'Lançamentos')).toContainText(
      'Você ainda não lançou nenhuma compra.',
    );
    await settled(region(page, 'Resumo')).toHaveCount(0);
    await settled(region(page, 'Posições')).toHaveCount(0);
    expect((await wallet(page.request)).lots).toEqual([]);
    expect(dialogs).toEqual([]);
  });

  test('o apagar que a api recusa mostra o motivo na pergunta e deixa tentar de novo', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-apagar-falha');
    await seed(page);
    await page.goto('/carteira');
    let calls = 0;
    await page.route('**/api/v1/me/portfolio/lots/*', (route) => {
      if (route.request().method() !== 'DELETE' || ++calls > 1) return route.continue();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: { code: 'INTERNAL_ERROR', message: 'mensagem crua da api' },
        }),
      });
    });

    const card = lotCards(page).filter({ hasText: 'MOVE3' });
    await card.getByRole('button', { name: /^Apagar/ }).click();
    const question = card.getByRole('group', { name: /^Apagar o lançamento de 100 MOVE3/ });
    await question.getByRole('button', { name: 'Sim, apagar' }).click();
    await settled(question.getByRole('alert')).toContainText('Não foi possível concluir agora');
    await expect(question.getByRole('alert')).not.toContainText('mensagem crua');
    expect((await wallet(page.request)).lots).toHaveLength(2);

    // a segunda tentativa vai à api de verdade
    await question.getByRole('button', { name: 'Sim, apagar' }).click();
    await settled(notice(page, 'Lançamento apagado: 100 MOVE3.')).toBeVisible();
    expect((await wallet(page.request)).lots).toHaveLength(1);
  });

  // Uma ação de cada vez (docs/TELAS.md, seção 9): enquanto a api não respondeu a um salvar ou a um apagar, nenhum outro cartão abre edição nem
  // pergunta. Sem isso o fim da ação fecharia o cartão que a pessoa abriu no meio do caminho, com o que ela já tinha digitado, e puxaria o foco.
  test('enquanto a api não responde a um salvar ou a um apagar, os outros cartões ficam parados, e voltam depois', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-uma-de-cada-vez');
    await seed(page);
    await page.goto('/carteira');
    const first = lotCards(page).filter({ hasText: 'MOVE3' });
    const second = lotCards(page).filter({ hasText: 'SINA3' });
    const buttonsOf = (card: Locator) => [
      card.getByRole('button', { name: /^Editar/ }),
      card.getByRole('button', { name: /^Apagar/ }),
    ];

    // salvar uma edição (só a quantidade muda: o total guardado segue o mesmo)
    const saving = await hold(page, '**/api/v1/me/portfolio/lots/*', 'PATCH');
    await first.getByRole('button', { name: /^Editar/ }).click();
    const form = page.getByRole('form', { name: 'Editar lançamento de 100 MOVE3' });
    await fields(form).quantity.fill('90');
    await form.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(form.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    for (const button of buttonsOf(second)) await expect(button).toBeDisabled();
    saving.release();
    await settled(
      notice(page, 'Lançamento salvo: 90 MOVE3, custo total R$ 3.550,00.'),
    ).toBeVisible();
    for (const button of buttonsOf(second)) await settled(button).toBeEnabled();

    // apagar
    const removing = await hold(page, '**/api/v1/me/portfolio/lots/*', 'DELETE');
    await first.getByRole('button', { name: /^Apagar/ }).click();
    await first.getByRole('button', { name: 'Sim, apagar' }).click();
    await expect(first.getByRole('button', { name: 'Apagando…' })).toBeDisabled();
    for (const button of buttonsOf(second)) await expect(button).toBeDisabled();
    removing.release();
    await settled(notice(page, 'Lançamento apagado: 90 MOVE3.')).toBeVisible();
    for (const button of buttonsOf(second)) await settled(button).toBeEnabled();

    expect([saving.calls(), removing.calls()]).toEqual([1, 1]);
    expect((await wallet(page.request)).lots.map((lot) => lot.ticker)).toEqual(['SINA3']);
  });

  // A prova do que a tela promete sobre ganho, perda e data: uma perda de verdade (o sinal e a palavra), e dois papéis com datas de fechamento
  // diferentes (a PAUS3 parou de negociar antes, como no carteira-layout.spec.ts). Os números são os da PRÓPRIA api; o teste só exige que
  // existam as duas situações, e falha com a frase certa se o mercado sintético mudar.
  test('uma perda e papéis com datas de fechamento diferentes: o sinal, a palavra e a data de cada posição', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-perda');
    // 100 MOVE3 a R$ 35,50 (ganho), 10 SINA3 por R$ 1.500,00 no total (perda: R$ 150,00 cada) e 50 PAUS3 a R$ 10,00 (fechamento mais antigo)
    await addLot(page.request, { ticker: 'MOVE3', quantity: 100, mode: 'unit', valueCents: 3_550 });
    await addLot(page.request, {
      ticker: 'SINA3',
      quantity: 10,
      mode: 'total',
      valueCents: 150_000,
    });
    await addLot(page.request, { ticker: 'PAUS3', quantity: 50, mode: 'unit', valueCents: 1_000 });
    await page.goto('/carteira');

    const { positions } = await wallet(page.request);
    expect(positions.map((p) => p.ticker)).toEqual(['MOVE3', 'PAUS3', 'SINA3']);
    expect(
      positions.find((p) => p.ticker === 'SINA3')!.pnlCents,
      'a SINA3 comprada a R$ 150,00 tem de estar em perda',
    ).toBeLessThan(0);
    expect(positions.find((p) => p.ticker === 'MOVE3')!.pnlCents).toBeGreaterThan(0);
    expect(
      new Set(positions.map((p) => p.closeDate)).size,
      'o fechamento da PAUS3 é de uma data mais antiga que o da MOVE3 e o da SINA3',
    ).toBe(2);

    await expectPositions(page, page.request);
    await expectSummary(page, page.request);
    const table = region(page, 'Posições');
    await expect(table).toContainText('· ganho');
    await expect(table).toContainText('· perda');
  });
});

test.describe('quem pode ver o quê', () => {
  test('o usuário A não vê a carteira do B: nem na tela, nem pela api com o cookie dele', async ({
    page,
    request,
    browser,
    ip,
  }, testInfo) => {
    const ipB = fakeIp();
    const a = await registerVerifiedUser(request, ip, 'carteira-a', 'Ana do e2e');
    const b = await registerVerifiedUser(request, ipB, 'carteira-b', 'Beto do e2e');
    await signInViaApi(page.request, a);
    const contextB = await browser.newContext(contextOptions(testInfo, ipB));
    const pageB = await contextB.newPage();
    try {
      await signInViaApi(contextB.request, b);
      await addLot(page.request, {
        ticker: 'MOVE3',
        quantity: 111,
        mode: 'unit',
        valueCents: 3_000,
      });
      await addLot(contextB.request, {
        ticker: 'SINA3',
        quantity: 222,
        mode: 'total',
        valueCents: 100_000,
      });

      // cada um vê só o que é seu
      await page.goto('/carteira');
      await pageB.goto('/carteira');
      await settled(lotCards(page)).toHaveCount(1);
      await expect(lotCards(page).first()).toContainText('MOVE3');
      await expect(page.getByRole('main')).not.toContainText('SINA3');
      await settled(lotCards(pageB)).toHaveCount(1);
      await expect(lotCards(pageB).first()).toContainText('SINA3');
      await expect(pageB.getByRole('main')).not.toContainText('MOVE3');
      await expectPositions(page, page.request);
      await expectPositions(pageB, contextB.request);

      // pela api, com o cookie de A: só os lançamentos de A, e o id do lançamento de B não abre nada (404, igual a um id que não existe)
      const lotOfB = (await wallet(contextB.request)).lots[0]!;
      const seenByA = await page.request.get('/api/v1/me/portfolio');
      expect(await seenByA.text()).not.toContain(lotOfB.id);
      expect((await wallet(page.request)).lots.map((lot) => lot.ticker)).toEqual(['MOVE3']);

      const edit = await page.request.patch(`/api/v1/me/portfolio/lots/${lotOfB.id}`, {
        headers: ORIGIN,
        data: { ticker: 'MOVE3', quantity: 1, mode: 'total', valueCents: 100 },
      });
      expect(edit.status()).toBe(404);
      expect(await edit.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      const removal = await page.request.delete(`/api/v1/me/portfolio/lots/${lotOfB.id}`, {
        headers: ORIGIN,
      });
      expect(removal.status()).toBe(404);
      expect(await removal.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      // o dono do lançamento não é escolha do cliente: nem pela query nem pelo corpo (o A, com a sessão dele, tenta lançar na carteira do B
      // dizendo o id do B no corpo: a api recusa, e nada é gravado em nome de ninguém)
      expect((await page.request.get(`/api/v1/me/portfolio?userId=${a.email}`)).status()).toBe(400);
      const meOfB = envelopeSchema(meSchema).parse(
        await (await contextB.request.get('/api/v1/me')).json(),
      );
      if (!meOfB.success) throw new Error('GET /api/v1/me do B falhou');
      const forged = await page.request.post('/api/v1/me/portfolio/lots', {
        headers: ORIGIN,
        data: {
          ticker: 'MOVE3',
          quantity: 1,
          mode: 'total',
          valueCents: 100,
          userId: meOfB.data.id,
        },
      });
      expect(forged.status()).toBe(400);
      expect(await forged.json()).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_ERROR' },
      });
      expect((await wallet(page.request)).lots.map((lot) => lot.ticker)).toEqual(['MOVE3']);

      // o lançamento de B está exatamente como estava, na api e na tela dele
      expect((await wallet(contextB.request)).lots).toEqual([lotOfB]);
      await pageB.reload();
      await settled(lotCards(pageB)).toHaveCount(1);
      await expect(lotCards(pageB).first().locator('dd')).toHaveText([
        '222',
        'R$ 1.000,00',
        'sem data',
      ]);

      // A apaga o dela pela tela, e o de B continua lá
      const own = lotCards(page).first();
      await own.getByRole('button', { name: /^Apagar/ }).click();
      await own.getByRole('button', { name: 'Sim, apagar' }).click();
      await settled(notice(page, 'Lançamento apagado: 111 MOVE3.')).toBeVisible();
      expect((await wallet(contextB.request)).lots).toEqual([lotOfB]);
    } finally {
      await contextB.close();
    }
  });
});

// Mobile é gate de merge, e o toque não é o clique: nos dois projetos de toque, e no desktop com um contexto que tem toque, lançar, editar e apagar
// se fazem com `.tap()`. O toque no TEXTO do rótulo do radio (o rótulo inteiro é o alvo), nos botões e na confirmação.
test.describe('por toque', () => {
  test.use({ hasTouch: true });

  test('lançar, editar e apagar tocando: o texto do radio o marca, e os botões respondem ao toque', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-toque');
    await page.goto('/carteira');
    const form = createForm(page);
    const f = fields(form);

    await f.ticker.fill('MOVE3');
    await f.quantity.fill('100');
    await form.getByText('Valor total pago', { exact: true }).tap();
    await expect(f.total).toBeChecked();
    await expect(f.unit).not.toBeChecked();
    // O radio visível de 20 px, o desenho do radio nativo (a decisão que a T2b deixou, tomada no fechamento da onda): o estado é a espessura da
    // borda, que sobrevive ao alto contraste do sistema em todo navegador (a cor vira a do sistema, a espessura fica), sem pseudo-elemento nem
    // fundo (o `::before` num <input> o Firefox não desenha). Desmarcado, a borda de 2 px no fio de controle; marcado, a de 6 px na tinta, com o
    // miolo no canvas. Os dois redondos, para não se confundir com a caixa de marcar (o quadrado com o X). O alvo de 44 px é o rótulo inteiro da
    // opção (o radio e o texto), que marca o radio no toque. O e2e roda no tema claro (ADR 0035): a tinta é a quase preta, o fio de controle o
    // cinza #8a8a90 e o fundo, o branco.
    const look = (radio: Element) => {
      const style = getComputedStyle(radio);
      return {
        mark: getComputedStyle(radio, '::before').content,
        border: style.borderTopWidth,
        color: style.borderTopColor,
        background: style.backgroundColor,
        radius: style.borderTopLeftRadius,
        size: radio.getBoundingClientRect().width,
        target: radio.closest('label')!.getBoundingClientRect().height,
      };
    };
    const painted = await f.total.evaluate(look);
    const empty = await f.unit.evaluate(look);
    expect(painted).toMatchObject({
      mark: 'none',
      border: '6px',
      color: 'rgb(10, 10, 10)',
      background: 'rgb(255, 255, 255)',
      size: 20,
    });
    expect(empty).toMatchObject({
      mark: 'none',
      border: '2px',
      color: 'rgb(138, 138, 144)',
      background: 'rgb(255, 255, 255)',
      size: 20,
    });
    expect(painted.radius).not.toBe('0px');
    expect(empty.radius).not.toBe('0px');
    expect(painted.target).toBeGreaterThanOrEqual(43.95);
    expect(empty.target).toBeGreaterThanOrEqual(43.95);
    await f.value.fill('3550');
    await form.getByRole('button', { name: 'Lançar compra' }).tap();
    await settled(
      notice(page, 'Compra lançada: 100 MOVE3, custo total R$ 3.550,00.'),
    ).toBeVisible();

    // o MESMO lançamento, que acabou de chegar pelo servidor (router.refresh), é editado por toque e só depois apagado
    const card = lotCards(page).first();
    await card.getByRole('button', { name: /^Editar/ }).tap();
    const editForm = page.getByRole('form', { name: 'Editar lançamento de 100 MOVE3' });
    await fields(editForm).quantity.fill('40');
    await fields(editForm).value.fill('1420');
    await editForm.getByRole('button', { name: 'Salvar alterações' }).tap();
    await settled(
      notice(page, 'Lançamento salvo: 40 MOVE3, custo total R$ 1.420,00.'),
    ).toBeVisible();
    expect((await wallet(page.request)).lots[0]).toMatchObject({
      quantity: 40,
      costCents: 142_000,
    });

    await card.getByRole('button', { name: /^Apagar/ }).tap();
    await card.getByRole('button', { name: 'Sim, apagar' }).tap();
    await settled(notice(page, 'Lançamento apagado: 40 MOVE3.')).toBeVisible();
    await settled(lotCards(page)).toHaveCount(0);
    expect((await wallet(page.request)).lots).toEqual([]);
  });
});

// Sem JavaScript (como as telas da conta, conta.spec.ts): lançar, editar e apagar precisam dele. O formulário e os botões nascem desativados (um
// envio nativo faria um GET com os dados na URL), o <noscript> diz por quê, e o que é só leitura segue na página.
test.describe('sem JavaScript', () => {
  test('a carteira avisa que precisa dele, não deixa enviar nem apagar nada, e a leitura segue na página', async ({
    browser,
    request,
    ip,
  }, testInfo) => {
    const user = await registerVerifiedUser(request, ip, 'carteira-sem-js');
    const context = await browser.newContext({
      ...contextOptions(testInfo, ip),
      javaScriptEnabled: false,
    });
    try {
      await signInViaApi(context.request, user);
      await addLot(context.request, {
        ticker: 'MOVE3',
        quantity: 12,
        mode: 'unit',
        valueCents: 1_234,
      });
      const page = await context.newPage();
      await page.goto('/carteira');
      await expect(heading(page)).toBeVisible();
      // (o Playwright pula o <noscript> na busca por texto: o aviso é buscado pelo elemento e lido pelo textContent)
      const warning = page.locator('noscript p');
      await expect(warning).toBeVisible();
      expect(await warning.textContent()).toContain('precisam de JavaScript');
      const buttons = await page.getByRole('main').getByRole('button').all();
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) await expect(button).toBeDisabled();
      // o que é só leitura não depende dele: o resumo e a posição vêm no HTML do servidor
      await expect(region(page, 'Resumo')).toBeVisible();
      await expect(
        region(page, 'Posições').getByRole('rowheader', { name: 'MOVE3', exact: true }),
      ).toBeVisible();
      expect((await wallet(context.request)).lots).toHaveLength(1);
    } finally {
      await context.close();
    }
  });
});

// O fluxo inteiro sem o mouse, no desktop: do primeiro Tab ao último lançamento apagado. O foco precisa chegar a cada controle, na ordem da
// página, e mostrar onde está.
test.describe('só com o teclado', () => {
  test('lançar, editar e apagar sem o mouse', async ({ page, request, ip }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'o teclado é o do desktop');
    await signedIn(page, request, ip, 'carteira-teclado');
    await page.goto('/carteira');
    await expect(heading(page)).toBeVisible();
    const form = createForm(page);
    const f = fields(form);
    // a hidratação: o formulário nasce desativado
    await expect(form.getByRole('button', { name: 'Lançar compra' })).toBeEnabled();

    // lançar: do cabeçalho ao ticker por Tab, digitando; as setas trocam o radio; Enter no último campo envia
    await tabTo(page, f.ticker);
    await page.keyboard.type('move3');
    await page.keyboard.press('Tab');
    await expect(f.quantity).toBeFocused();
    await page.keyboard.type('100');
    await page.keyboard.press('Tab');
    await expect(f.unit).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(f.total).toBeChecked();
    await expect(f.total).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(f.value).toBeFocused();
    await page.keyboard.type('3550,00');
    await page.keyboard.press('Enter');
    const created = notice(page, 'Compra lançada: 100 MOVE3, custo total R$ 3.550,00.');
    await settled(created).toBeFocused();
    await settled(lotCards(page)).toHaveCount(1);

    // o foco é visível (contorno de 2 px) onde a pessoa chega por Tab
    const edit = lotCards(page)
      .first()
      .getByRole('button', { name: /^Editar/ });
    await tabTo(page, edit);
    await expect(edit).toHaveCSS('outline-style', 'solid');
    await expect(edit).toHaveCSS('outline-width', '2px');

    // editar: Enter abre o formulário no ticker; a quantidade, o valor e o envio, tudo por Tab
    await page.keyboard.press('Enter');
    const editForm = page.getByRole('form', { name: 'Editar lançamento de 100 MOVE3' });
    const e = fields(editForm);
    await expect(e.ticker).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(e.quantity).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('40');
    await tabTo(page, e.value);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('1.420,00');
    await tabTo(page, editForm.getByRole('button', { name: 'Salvar alterações' }));
    await page.keyboard.press('Space');
    await settled(
      notice(page, 'Lançamento salvo: 40 MOVE3, custo total R$ 1.420,00.'),
    ).toBeVisible();
    await settled(edit).toBeFocused();
    expect((await wallet(page.request)).lots[0]).toMatchObject({
      quantity: 40,
      costCents: 142_000,
    });

    // apagar: Enter abre a pergunta (que recebe o foco), Tab leva a "Sim, apagar", Enter confirma
    const remove = lotCards(page)
      .first()
      .getByRole('button', { name: /^Apagar/ });
    await tabTo(page, remove);
    await page.keyboard.press('Enter');
    const question = lotCards(page)
      .first()
      .getByRole('group', { name: /^Apagar o lançamento de 40 MOVE3/ });
    await expect(question.getByText(/^Apagar o lançamento/)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(question.getByRole('button', { name: 'Sim, apagar' })).toBeFocused();
    await page.keyboard.press('Enter');
    await settled(notice(page, 'Lançamento apagado: 40 MOVE3.')).toBeFocused();
    await expect(region(page, 'Lançamentos')).toContainText(
      'Você ainda não lançou nenhuma compra.',
    );
    expect((await wallet(page.request)).lots).toEqual([]);
  });
});

// --- o design premium da carteira (docs/TELAS.md, seção 9; ADR 0037) --------------------------------------------------------------------
// As peças vivas: o logo de cada ação (o da T0b) à esquerda do ticker, a rosca da alocação (a beUI) com a legenda ligada ao centro, o aviso na
// pilha (o toast da beUI) e o contador da Arc no resumo, que só rola quando o número muda. O e2e semeia o logo sintético do MOVE3 e do SINA3; o
// PAUS3 não tem logo (o monograma).

// Quantos algarismos do contador estão no meio da roda agora (opacidade fora de 0 e 1), e o maior número disso visto em `ms` milissegundos, a
// cada quadro: começa ANTES da ação, para ver a roda girar (ou não) quando o servidor refaz a página.
const sampleRolls = (page: Page, ms: number) =>
  page.evaluate(
    (duration) =>
      new Promise<{ moving: number; firstToast: Record<string, string> | null }>((resolve) => {
        const start = performance.now();
        let moving = 0;
        let firstToast: Record<string, string> | null = null;
        const tick = () => {
          const glyphs = [
            ...document.querySelectorAll<HTMLElement>('#resumo [data-contador] [class*="glyph"]'),
          ];
          moving = Math.max(
            moving,
            glyphs.filter((g) => !['', '0', '1'].includes(g.style.opacity)).length,
          );
          const toast = document.querySelector<HTMLElement>('[data-aviso]');
          if (toast && !firstToast) {
            const style = getComputedStyle(toast);
            firstToast = {
              opacity: style.opacity,
              transform: style.transform,
              filter: style.filter,
            };
          }
          if (performance.now() - start > duration) resolve({ moving, firstToast });
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    ms,
  );

test.describe('as peças vivas da carteira', () => {
  test('o logo de cada ação fica à esquerda do ticker, ligado à página dela, nas posições, na legenda e nos lançamentos', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-logos');
    await addLot(page.request, { ticker: 'MOVE3', quantity: 10, mode: 'unit', valueCents: 1_000 });
    await addLot(page.request, { ticker: 'PAUS3', quantity: 10, mode: 'unit', valueCents: 1_000 });
    await page.goto('/carteira');

    // o logo à esquerda do texto e no meio da linha dele, dentro do link para a página da ação
    const beside = (link: Locator) =>
      link.evaluate((a) => {
        const logo = a.querySelector('[data-logo]')!.getBoundingClientRect();
        const text = [...a.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!;
        const range = document.createRange();
        range.selectNodeContents(text);
        const box = range.getBoundingClientRect();
        return {
          left: logo.right <= box.left + 0.5,
          middle: Math.abs(logo.top + logo.height / 2 - (box.top + box.height / 2)) < 4,
        };
      });
    const places = [region(page, 'Posições'), ...(await lotCards(page).all())];
    for (const place of places) {
      for (const [ticker, kind] of [
        ['MOVE3', 'imagem'],
        ['PAUS3', 'monograma'],
      ] as const) {
        const link = place.getByRole('link', { name: ticker, exact: true });
        if ((await link.count()) === 0) continue;
        await expect(link).toHaveAttribute('href', `/acoes/${ticker}`);
        const logo = link.locator('[data-logo]');
        await expect(logo).toHaveAttribute('data-logo', kind);
        if (kind === 'imagem') {
          await expect(logo).toHaveAttribute('src', /^\/logos\/MOVE3\.svg\?v=[0-9a-f]+$/);
          await expect(logo).toHaveAttribute('alt', '');
        } else {
          await expect(logo).toHaveAttribute('data-inicial', 'P');
        }
        expect(await beside(link)).toEqual({ left: true, middle: true });
      }
    }
    // nas posições os dois têm a linha; nos lançamentos, um cada
    await expect(region(page, 'Posições').getByRole('link')).toHaveCount(2);
    await expect(lotCards(page).getByRole('link', { name: /^(MOVE3|PAUS3)$/ })).toHaveCount(2);
    // a legenda da rosca: o logo do MOVE3 e o monograma do PAUS3, à esquerda do ticker
    const legend = region(page, 'Alocação').getByRole('button');
    await expect(
      legend.filter({ hasText: 'MOVE3' }).locator('img[data-logo="imagem"]'),
    ).toHaveCount(1);
    await expect(
      legend.filter({ hasText: 'PAUS3' }).locator('[data-logo="monograma"]'),
    ).toHaveCount(1);
  });

  test('a rosca mostra a alocação de cada posição contra a api, e a legenda liga a fatia ao centro (o foco, as setas e o clique que fixa)', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-rosca');
    await addLot(page.request, { ticker: 'MOVE3', quantity: 100, mode: 'unit', valueCents: 3_550 });
    await addLot(page.request, {
      ticker: 'SINA3',
      quantity: 10,
      mode: 'total',
      valueCents: 20_000,
    });
    await addLot(page.request, {
      ticker: 'PAUS3',
      quantity: 2_500,
      mode: 'unit',
      valueCents: 1_275,
    });
    await page.goto('/carteira');
    const { positions, totals } = await wallet(page.request);
    const priced = positions
      .filter((p) => p.valueCents !== null && p.valueCents > 0)
      .sort((a, b) => b.valueCents! - a.valueCents! || a.ticker.localeCompare(b.ticker));
    expect(priced).toHaveLength(3);
    const share = (cents: number) => pct(ratioBps(cents, totals.valueCents!), false);

    const alloc = region(page, 'Alocação');
    await expect(alloc.getByRole('img')).toHaveAttribute(
      'aria-label',
      `Alocação da carteira pelo valor estimado: ${priced.map((p) => `${p.ticker}, ${share(p.valueCents!)}`).join('; ')}.`,
    );
    // uma fatia por posição, da maior para a menor
    await expect(alloc.locator('[data-fatia]')).toHaveCount(3);
    const rows = alloc.getByRole('button');
    await expect(rows).toHaveText(
      priced.map((p) => `${p.ticker} ${share(p.valueCents!)} ${brl(p.valueCents!)}`),
    );
    for (const row of await rows.all()) await expect(row).toBeEnabled();

    // o centro: o valor estimado e quantas ações; o foco numa linha leva o valor e a parte dela ao centro, e a fatia dela fica na frente
    const center = alloc.locator('[data-rosca-centro]');
    const centerValue = center.locator('[class*="srOnly"]');
    await expect(center).toHaveAttribute('data-rosca-centro', 'total');
    await expect(center).toContainText('3 ações');
    await expect(centerValue).toHaveText(brl(totals.valueCents!));
    await rows.nth(1).focus();
    await expect(center).toHaveAttribute('data-rosca-centro', priced[1]!.ticker);
    await expect(center).toContainText(`${priced[1]!.ticker} · ${share(priced[1]!.valueCents!)}`);
    await expect(centerValue).toHaveText(brl(priced[1]!.valueCents!));
    await expect
      .poll(() =>
        alloc
          .locator('[data-fatia]')
          .evaluateAll((paths) => paths.map((path) => getComputedStyle(path).opacity)),
      )
      .toEqual(['0.3', '1', '0.3']);
    // as setas andam entre as linhas
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(2)).toBeFocused();
    await expect(center).toHaveAttribute('data-rosca-centro', priced[2]!.ticker);

    // o clique fixa a fatia (aria-pressed), e ela fica no centro quando o foco sai
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await heading(page).click();
    await page.mouse.move(0, 0);
    await expect(center).toHaveAttribute('data-rosca-centro', priced[0]!.ticker);
    // outro clique solta
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'false');
  });

  test('o aviso do lançamento chega na pilha anunciada (aria-live polite), com o foco, fixo no pé da tela, e fecha pelo teclado', async ({
    page,
    request,
    ip,
  }, testInfo) => {
    await signedIn(page, request, ip, 'carteira-aviso');
    await page.goto('/carteira');
    const pilha = avisos(page);
    // a região viva existe desde o começo, vazia (o leitor de tela anuncia o que chega depois)
    await expect(pilha).toHaveAttribute('aria-live', 'polite');
    await expect(pilha.getByRole('listitem')).toHaveCount(0);

    const form = createForm(page);
    await fill(form, { ticker: 'MOVE3', quantity: '10', mode: 'unit', value: '10,00' });
    await form.getByRole('button', { name: 'Lançar compra' }).click();
    const aviso = notice(page, 'Compra lançada: 10 MOVE3, custo total R$ 100,00.');
    await settled(aviso).toBeFocused();
    // fixo no pé da tela, na largura dela, acima da barra de abas do celular
    const viewport = page.viewportSize()!;
    const box = (await aviso.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    const bar = await page.getByRole('navigation', { name: 'Principal' }).boundingBox();
    const floor = viewport.width < 1024 && bar ? bar.y : viewport.height;
    expect(box.y + box.height).toBeLessThanOrEqual(floor);
    expect(box.y + box.height).toBeGreaterThan(floor - 120);
    // o fechar é um botão com nome, na caixa de 44 px (a medida sem a escala da entrada, que ainda pode estar no fim)
    const close = aviso.getByRole('button', { name: 'Fechar aviso' });
    const closeBox = await close.evaluate((button: HTMLElement) => [
      button.offsetWidth,
      button.offsetHeight,
    ]);
    expect(Math.min(...closeBox)).toBeGreaterThanOrEqual(44);

    if (testInfo.project.name.startsWith('desktop')) {
      // o teclado: o Tab chega ao fechar, o Enter fecha, e o foco vai ao título dos lançamentos (e não ao <body>)
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(pilha.getByRole('listitem')).toHaveCount(0);
      await expect(page.locator('#lancamentos-titulo')).toBeFocused();
      // o Esc também fecha o aviso em que está o foco
      await fill(form, { ticker: 'MOVE3', quantity: '20', mode: 'unit', value: '10,00' });
      await form.getByRole('button', { name: 'Lançar compra' }).click();
      const second = notice(page, 'Compra lançada: 20 MOVE3, custo total R$ 200,00.');
      await settled(second).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(pilha.getByRole('listitem')).toHaveCount(0);
      await expect(page.locator('#lancamentos-titulo')).toBeFocused();
    } else {
      // no toque, o fechar responde ao toque
      await close.tap();
      await expect(pilha.getByRole('listitem')).toHaveCount(0);
    }
  });

  test('o aviso sem o foco some sozinho depois de uns segundos', async ({ page, request, ip }) => {
    await signedIn(page, request, ip, 'carteira-aviso-some');
    await addLot(page.request, { ticker: 'MOVE3', quantity: 10, mode: 'unit', valueCents: 1_000 });
    await page.goto('/carteira');
    // salvar devolve o foco ao Editar: o aviso fica na pilha sem o foco, e sai sozinho
    const card = lotCards(page).first();
    await card.getByRole('button', { name: /^Editar/ }).click();
    const form = page.getByRole('form', { name: 'Editar lançamento de 10 MOVE3' });
    await fields(form).quantity.fill('11');
    await form.getByRole('button', { name: 'Salvar alterações' }).click();
    const saved = notice(page, 'Lançamento salvo: 11 MOVE3, custo total R$ 100,00.');
    await settled(saved).toBeVisible();
    await settled(card.getByRole('button', { name: /^Editar/ })).toBeFocused();
    await expect(saved).toHaveCount(0, { timeout: 12_000 });
  });

  // O prazo para com o ponteiro sobre o aviso (WCAG 2.2.1). O aviso que sai da tela com o ponteiro em cima (fechado pelo mouse, arrastado) não
  // recebe o `pointerleave`: sem soltar a pausa quando ele sai, os avisos seguintes ficavam na tela para sempre (a revisão do fechamento, I2).
  test('o aviso fechado com o ponteiro em cima não prende os seguintes: o próximo some sozinho', async ({
    page,
    request,
    ip,
  }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'o ponteiro em cima é o do mouse');
    await signedIn(page, request, ip, 'carteira-aviso-ponteiro');
    await addLot(page.request, { ticker: 'MOVE3', quantity: 10, mode: 'unit', valueCents: 1_000 });
    await page.goto('/carteira');
    const card = lotCards(page).first();
    const salvar = async (quantity: string, from: string) => {
      await card.getByRole('button', { name: /^Editar/ }).click();
      const form = page.getByRole('form', { name: `Editar lançamento de ${from} MOVE3` });
      await fields(form).quantity.fill(quantity);
      await form.getByRole('button', { name: 'Salvar alterações' }).click();
    };
    await salvar('11', '10');
    const first = notice(page, 'Lançamento salvo: 11 MOVE3, custo total R$ 100,00.');
    await settled(first).toBeVisible();
    // o ponteiro sobre o aviso, e o clique no fechar: o aviso sai com o ponteiro em cima
    await first.hover();
    await first.getByRole('button', { name: 'Fechar aviso' }).click();
    await expect(avisos(page).getByRole('listitem')).toHaveCount(0);
    await page.mouse.move(8, 8, { steps: 5 });
    await salvar('12', '11');
    const second = notice(page, 'Lançamento salvo: 12 MOVE3, custo total R$ 100,00.');
    await settled(second).toBeVisible();
    await expect(second).toHaveCount(0, { timeout: 12_000 });
  });

  test('o contador do resumo rola quando o número muda depois de lançar, e nada rola na abertura', async ({
    page,
    request,
    ip,
  }) => {
    await signedIn(page, request, ip, 'carteira-contador');
    await addLot(page.request, { ticker: 'MOVE3', quantity: 100, mode: 'unit', valueCents: 3_550 });
    await page.goto('/carteira');
    await expect(region(page, 'Resumo')).toBeVisible();
    // a abertura: os três números no contador (a roda de cada algarismo), e nenhum no meio do giro
    await expect(region(page, 'Resumo').locator('[data-contador]')).toHaveCount(3);
    expect((await sampleRolls(page, 600)).moving).toBe(0);

    const form = createForm(page);
    await fill(form, { ticker: 'MOVE3', quantity: '100', mode: 'unit', value: '35,50' });
    const rolling = sampleRolls(page, 4_000);
    await form.getByRole('button', { name: 'Lançar compra' }).click();
    expect((await rolling).moving).toBeGreaterThan(0);
    await expectSummary(page, page.request);
  });
});

// O movimento reduzido (docs/DESIGN.md, 5): com `prefers-reduced-motion: reduce`, o contador troca o número sem girar, o aviso aparece inteiro no
// primeiro quadro (sem subir nem esmaecer) e a rosca destaca a fatia na hora, sem a mola.
test.describe('movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('o contador, a rosca e o aviso trocam na hora', async ({ page, request, ip }) => {
    await signedIn(page, request, ip, 'carteira-reduzido');
    await addLot(page.request, { ticker: 'MOVE3', quantity: 100, mode: 'unit', valueCents: 3_550 });
    await addLot(page.request, {
      ticker: 'SINA3',
      quantity: 10,
      mode: 'total',
      valueCents: 20_000,
    });
    await page.goto('/carteira');

    const form = createForm(page);
    await fill(form, { ticker: 'MOVE3', quantity: '100', mode: 'unit', value: '35,50' });
    const sample = sampleRolls(page, 4_000);
    await form.getByRole('button', { name: 'Lançar compra' }).click();
    const { moving, firstToast } = await sample;
    // nenhum algarismo no meio da roda, e o aviso inteiro desde o primeiro quadro em que existe
    expect(moving).toBe(0);
    expect(firstToast).toEqual({ opacity: '1', transform: 'none', filter: 'none' });
    await expectSummary(page, page.request);

    // a rosca: o foco numa linha da legenda destaca a fatia no quadro seguinte, e nada anda
    const rows = region(page, 'Alocação').getByRole('button');
    await rows.nth(1).focus();
    const ring = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const paths = [...document.querySelectorAll<SVGPathElement>('[data-fatia]')];
      const glyphs = [
        ...document.querySelectorAll<HTMLElement>('[data-rosca-centro] [class*="glyph"]'),
      ];
      return {
        opacities: paths.map((path) => getComputedStyle(path).opacity),
        moving: glyphs.filter((g) => !['', '0', '1'].includes(g.style.opacity)).length,
        // a pista da tabela que rola (o esmaecer da borda, ui.tsx TableScroll) é uma animação ligada à rolagem e não ao tempo: nada anda sozinho,
        // e ela fica fora da conta
        running: document
          .getAnimations()
          .filter((a) => a.playState === 'running' && !(a.timeline && 'source' in a.timeline))
          .length,
      };
    });
    expect(ring).toEqual({ opacities: ['0.3', '1'], moving: 0, running: 0 });
  });
});

// Os termos que pedem explicação (o tooltip da Arc): o preço médio e o resultado, no cabeçalho da tabela e no resumo, e o "valor total pago"
// no radio do formulário. Abrem no hover do mouse e no foco do teclado (o leitor de tela ouve a explicação como a descrição); no toque, a mesma
// explicação está em texto na tela (o parágrafo das posições, a dica do campo).
test.describe('os termos com explicação', () => {
  test('o preço médio, o resultado e o valor total pago explicam-se no tooltip, pelo ponteiro e pelo teclado', async ({
    page,
    request,
    ip,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('desktop'),
      'o tooltip abre no hover do mouse e no foco do teclado',
    );
    await signedIn(page, request, ip, 'carteira-termos');
    await addLot(page.request, { ticker: 'MOVE3', quantity: 10, mode: 'unit', valueCents: 1_000 });
    await page.goto('/carteira');
    const tooltip = page.getByRole('tooltip');

    const precoMedio = region(page, 'Posições').getByRole('button', {
      name: 'Preço médio',
      exact: true,
    });
    await expect(precoMedio).toBeEnabled();
    await precoMedio.hover();
    await expect(tooltip).toContainText('dividido pela quantidade');
    // o ponteiro sai em passos, como um mouse de verdade: a Radix deixa passar para o balão (WCAG 1.4.13) e só fecha num movimento depois
    // da saída e fora dessa área; o salto de uma vez manda um movimento só, o do ponto de saída, e o balão fica aberto
    await page.mouse.move(0, 0, { steps: 10 });
    await expect(tooltip).toHaveCount(0);
    // o foco do teclado abre, e o leitor de tela ouve a explicação como a descrição; o Esc fecha
    await precoMedio.focus();
    await expect(precoMedio).toHaveAccessibleDescription(/dividido pela quantidade/);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);

    for (const place of ['Posições', 'Resumo']) {
      const resultado = region(page, place).getByRole('button', { name: 'Resultado', exact: true });
      await resultado.hover();
      await expect(tooltip).toContainText('O valor estimado menos o custo');
      await page.mouse.move(0, 0, { steps: 10 });
      await expect(tooltip).toHaveCount(0);
    }

    // o radio "Valor total pago": a explicação é a descrição dele, e o tooltip abre no rótulo
    const form = createForm(page);
    await expect(fields(form).total).toHaveAccessibleDescription(/O total da nota desta compra/);
    await form.getByText('Valor total pago', { exact: true }).hover();
    await expect(tooltip).toContainText('O total da nota desta compra');
  });
});
