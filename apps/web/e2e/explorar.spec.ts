import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  envelopeSchema,
  internalLogosSchema,
  leaderboardSchema,
  stockDetailSchema,
} from '@alvesting/contracts';
import { API_URL, QUOTES_SECRET } from './api-server';
import { SEASON, SIMULATED, TICKER, brl, dmy, fetchApi, fetchBars, pctl } from './data';

// O Explorar, a busca de ações, o terminal de cada ação e as notícias no design premium (a tarefa T2a; docs/TELAS.md, seções 1, 4 e 10; ADR
// 0037): o "simulado" uma vez por contexto, o tooltip da Arc onde explicar ajuda, o logo à esquerda do ticker em toda linha com ticker, a sans,
// o terminal (o cabeçalho, as velas com a linha do último preço, o realce de um pregão, as colunas e o painel preso no topo) e o movimento (o
// cartão que levanta, o véu das velas), com e sem movimento reduzido. Os valores de cada tela, por igualdade, estão no arena.spec.ts; os 360 a
// 1920 px sem rolagem, os alvos de 44 px e o axe nos dois temas, no laço de ROUTES do layout.spec.ts (as quatro telas estão nele); a regra das
// cotações (o HTML e o payload do React sem a série), no quotes.spec.ts.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api e do site locais');

const region = (page: Page, name: string): Locator =>
  page.getByRole('region', { name, exact: true });
const desktop = (project: string) => project.startsWith('desktop');
const transparent = 'rgba(0, 0, 0, 0)';
// o preço como o eixo e a etiqueta das velas o escrevem: "71,47", sem o R$
const price = (cents: number) => brl(cents).replace('R$ ', '');

// quem tem logo no banco do e2e (os dois sintéticos do seed), pelo índice da rota interna, como o site o lê
async function comLogo(request: APIRequestContext): Promise<Set<string>> {
  const response = await request.get(`${API_URL}/api/v1/interno/logos`, {
    headers: { Authorization: `Bearer ${QUOTES_SECRET}` },
  });
  expect(response.status()).toBe(200);
  const body = envelopeSchema(internalLogosSchema).parse(await response.json());
  if (!body.success) throw new Error(`logos: ${body.error.code}`);
  return new Set(body.data.logos.map((logo) => logo.ticker));
}

// cada link de ticker: o logo é o primeiro filho (à esquerda do texto), a imagem para quem tem logo e o monograma para quem não tem
async function expectLogos(links: Locator, withLogo: ReadonlySet<string>): Promise<string[]> {
  const tickers: string[] = [];
  for (const link of await links.all()) {
    const ticker = (await link.innerText()).trim();
    tickers.push(ticker);
    expect(
      await link.evaluate((a) => a.firstElementChild?.getAttribute('data-logo') ?? null),
      ticker,
    ).toBe(withLogo.has(ticker) ? 'imagem' : 'monograma');
    await expect(link.locator('[data-logo]'), ticker).toHaveCount(1);
  }
  expect(tickers.length).toBeGreaterThan(0);
  return tickers;
}

test.describe('explorar', () => {
  test('o "simulado" uma vez por contexto: a nota na grade dos modelos e nos populares, nenhuma etiqueta nos nomes, nada nas referências', async ({
    page,
  }) => {
    await page.goto('/explorar');
    const models = region(page, 'Modelos');
    await expect(models.getByText(SIMULATED, { exact: true })).toHaveCount(1);
    await expect(models.getByText(SIMULATED, { exact: true })).toBeVisible();
    await expect(models.getByRole('listitem').getByText(SIMULATED, { exact: true })).toHaveCount(0);
    await expect(
      region(page, 'Controle e referências').getByText(SIMULATED, { exact: true }),
    ).toHaveCount(0);
    const bar = page.getByRole('navigation', { name: 'Explorar', exact: true });
    await expect(bar.getByText(SIMULATED, { exact: true })).toHaveCount(1);
    await expect(bar.locator('details li').getByText(SIMULATED, { exact: true })).toHaveCount(0);
    // o nome de cada popular e de cada cartão numa linha só (o curto à vista; o sufixo de versão vai para o leitor de tela)
    for (const name of [
      ...(await bar.locator('details li a > span:first-child').all()),
      ...(await models.locator('.cartao-explorar-corpo > span:nth-child(2)').all()),
    ]) {
      // uma linha: a altura não passa de uma vez e meia a altura da linha (o cartão é de 15 px em 24, o popular de 13 em 20)
      const lines = await name.evaluate(
        (el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
      );
      expect(lines, await name.innerText()).toBeLessThan(1.5);
    }
  });

  test('o tooltip da Arc: o nome inteiro e o percentil no cartão do modelo, no ponteiro', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !desktop(testInfo.project.name),
      'o tooltip abre no ponteiro e no foco do teclado, não no toque',
    );
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    const model = board.rows.find(
      (r) => r.competitor.type === 'MODEL' && r.percentileBps !== null,
    )!;
    await page.goto('/explorar');
    const card = region(page, 'Modelos')
      .locator(`[data-cartao="${model.competitor.slug}"]`)
      .getByRole('link');
    await card.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText(model.competitor.name);
    const p = pctl(model.percentileBps!);
    await expect(tip).toContainText(
      `Percentil ${p}: o retorno ficou acima de ${p}% das carteiras sorteadas do Monte Carlo.`,
    );
    // o ponteiro sai em passos: o tooltip da Radix deixa passar para o balão (WCAG 1.4.13) e só fecha num movimento fora dessa área; o
    // salto de uma vez só deixa o ponteiro parado na ponta dela
    await page.mouse.move(0, 0, { steps: 10 });
    await expect(tip).toHaveCount(0);
  });

  // O que é o universo da semana e o que é a confiança ficam à vista, em texto, e não só no balão: no celular o tooltip não abre pelo toque
  // (a revisão do fechamento, M9). O balão que repetia o texto saiu.
  test('as regras do universo e o que é a confiança estão no texto da página, também no celular', async ({
    page,
  }) => {
    await page.goto('/explorar');
    const universe = region(page, 'Universo da semana');
    await expect(universe).toContainText(
      'até 500 ações da B3 (ON, PN e unit) negociadas em pelo menos 90% dos últimos 60 pregões, sem FII, ETF nem BDR',
    );
    await expect(universe.locator('[tabindex="0"]')).toHaveCount(0);
    await page.goto(`/acoes/${TICKER}`);
    const decisions = region(page, 'Decisões dos modelos');
    await expect(decisions).toContainText(
      'A confiança vai de 0 a 1 e é a que o próprio modelo declara na resposta. Ela não muda o tamanho da ordem.',
    );
  });

  test('o cartão acende e o conteúdo sobe 2 px no hover, em 150 ms', async ({ page }, testInfo) => {
    test.skip(!desktop(testInfo.project.name), 'o hover é do mouse');
    await page.goto('/explorar');
    const card = region(page, 'Modelos').getByRole('listitem').first().getByRole('link');
    const body = card.locator('.cartao-explorar-corpo');
    expect(await body.evaluate((el) => getComputedStyle(el).translate)).toBe('none');
    expect(await body.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0.15s');
    await card.hover();
    await expect.poll(() => body.evaluate((el) => getComputedStyle(el).translate)).toBe('0px -2px');
    await expect
      .poll(() => card.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(transparent);
  });
});

test('o logo de cada ação à esquerda do ticker, em toda linha com ticker das quatro telas', async ({
  page,
  request,
}) => {
  const withLogo = await comLogo(request);
  // o universo da semana
  await page.goto('/explorar');
  await expectLogos(
    region(page, 'Universo da semana').getByRole('listitem').getByRole('link'),
    withLogo,
  );
  // a busca (o MOVE3, que tem logo, e os outros, com o monograma)
  await page.goto('/acoes?q=MO');
  expect(
    await expectLogos(
      page.getByRole('list', { name: 'Resultados da busca' }).getByRole('link'),
      withLogo,
    ),
  ).toContain(TICKER);
  // as notícias: cada chip de ticker
  await page.goto('/noticias');
  await expectLogos(
    page.getByRole('list', { name: 'Notícias' }).locator('a[href^="/acoes/"]'),
    withLogo,
  );
  // o terminal: o cabeçalho e os chips das notícias da ação
  await page.goto(`/acoes/${TICKER}`);
  await expect(page.getByRole('heading', { level: 1 }).locator('[data-logo]')).toHaveAttribute(
    'data-logo',
    withLogo.has(TICKER) ? 'imagem' : 'monograma',
  );
  expect(
    await expectLogos(
      region(page, 'Notícias')
        .getByRole('list', { name: 'Notícias' })
        .locator('a[href^="/acoes/"]'),
      withLogo,
    ),
  ).toContain(TICKER);
});

test('as quatro telas são todas na sans: nenhuma mono', async ({ page }) => {
  for (const route of ['/explorar', '/acoes?q=MO', `/acoes/${TICKER}`, '/noticias']) {
    await page.goto(route);
    const mono = await page.locator('body').evaluate((body) =>
      [...body.querySelectorAll<HTMLElement>('*')]
        .filter((element) =>
          [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '',
          ),
        )
        .filter((element) => /mono/i.test(getComputedStyle(element).fontFamily))
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}: ${element.textContent.trim().slice(0, 30)}`,
        ),
    );
    expect(mono, route).toEqual([]);
  }
});

test.describe('o terminal da ação', () => {
  test('o desenho: uma vela por pregão (a alta vazada, a queda cheia), a linha do último preço com a etiqueta, e nenhuma parada de Tab', async ({
    page,
    request,
  }) => {
    const bars = await fetchBars(request, TICKER);
    await page.goto(`/acoes/${TICKER}`);
    const figure = page.getByRole('figure', { name: `Velas diárias de ${TICKER}` });
    await expect(figure.locator('g[data-candle]')).toHaveCount(bars.length);
    expect(
      await figure
        .locator('g[data-candle]')
        .evaluateAll((groups) => groups.map((group) => group.getAttribute('class'))),
    ).toEqual(
      bars.map((bar) =>
        bar.closeCents >= bar.openCents
          ? 'vela-alta fill-canvas stroke-data-up'
          : 'vela-baixa fill-data-down stroke-data-down',
      ),
    );
    await expect(figure.locator('line[data-ultimo]')).toHaveCount(1);
    await expect(figure.locator('.velas-etiqueta')).toHaveText(price(bars.at(-1)!.closeCents));
    // o realce é uma coluna por pregão, fora da árvore de acessibilidade, e nada no desenho recebe o foco
    await expect(figure.locator('.velas-colunas > span')).toHaveCount(bars.length);
    await expect(figure.locator('.velas-colunas')).toHaveAttribute('aria-hidden', 'true');
    await expect(figure.locator('a, button, input, [tabindex]')).toHaveCount(0);
  });

  test('o realce de um pregão: a coluna dele fica limpa com a data no eixo, e as outras recuam', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(!desktop(testInfo.project.name), 'o realce é do ponteiro do mouse');
    const bars = await fetchBars(request, TICKER);
    await page.goto(`/acoes/${TICKER}`);
    const columns = page.locator('.velas-colunas > span');
    const i = 20;
    await columns.nth(i).hover();
    const state = () =>
      page.locator('.velas-colunas').evaluate((element, index) => {
        const spans = [...element.children] as HTMLElement[];
        return {
          date: getComputedStyle(spans[index]!, '::after').content,
          cursor: getComputedStyle(spans[index]!, '::before').width,
          hovered: getComputedStyle(spans[index]!).backgroundColor,
          other: getComputedStyle(spans[0]!).backgroundColor,
        };
      }, i);
    await expect.poll(async () => (await state()).other).not.toBe(transparent);
    // só a data, nenhum preço
    expect(await state()).toMatchObject({
      date: `"${dmy(bars[i]!.date)}"`,
      cursor: '1px',
      hovered: transparent,
    });
    // a etiqueta da data fica dentro da figura (as colunas das pontas a alinham para dentro)
    await columns.last().hover();
    const edge = await page.locator('.velas-colunas').evaluate((element) => {
      const figure = element.closest('figure')!.getBoundingClientRect();
      const last = element.lastElementChild!.getBoundingClientRect();
      return { figureRight: figure.right, lastRight: last.right };
    });
    expect(edge.lastRight).toBeLessThanOrEqual(edge.figureRight);
  });

  test('a confiança é explicada uma vez, no texto da seção, e cada decisão que a tem a mostra, sem parada de Tab a mais', async ({
    page,
    request,
  }) => {
    const stock = await fetchApi(request, `/stocks/${TICKER}`, stockDetailSchema);
    const withConfidence = stock.decisions.filter((d) => d.confidence !== null).length;
    // o seed tem mais de uma decisão com confiança: senão o "uma vez" não seria provado
    expect(withConfidence).toBeGreaterThan(1);
    await page.goto(`/acoes/${TICKER}`);
    const decisions = region(page, 'Decisões dos modelos');
    // cada decisão com confiança a mostra ("confiança 0,80"); a explicação vem uma vez, no texto da seção
    await expect(decisions.locator('span', { hasText: /^confiança \d/ })).toHaveCount(
      withConfidence,
    );
    await expect(decisions.getByText(/A confiança vai de 0 a 1/)).toHaveCount(1);
    await expect(decisions.locator('[tabindex="0"]')).toHaveCount(0);
  });

  test('no desktop as velas ficam à esquerda, presas no topo, com a coluna dos donos, das decisões e das notícias ao lado; no celular, uma embaixo da outra', async ({
    page,
  }, testInfo) => {
    await page.goto(`/acoes/${TICKER}`);
    const chart = region(page, 'Cotações recentes');
    const side = [
      region(page, 'Quem tem a ação'),
      region(page, 'Decisões dos modelos'),
      region(page, 'Notícias'),
    ];
    const box = (await chart.boundingBox())!;
    const boxes = await Promise.all(side.map(async (s) => (await s.boundingBox())!));
    // a ordem da leitura: as velas, os donos, as decisões, as notícias
    for (let k = 1; k < boxes.length; k += 1) expect(boxes[k]!.y).toBeGreaterThan(boxes[k - 1]!.y);
    if (desktop(testInfo.project.name)) {
      for (const b of boxes) expect(b.x).toBeGreaterThanOrEqual(box.x + box.width);
      expect(Math.abs(boxes[0]!.y - box.y)).toBeLessThan(2);
      // a coluna do lado rola, e o painel das velas fica a 24 px do topo
      await page.evaluate(() => window.scrollBy(0, 600));
      await expect.poll(async () => Math.round((await chart.boundingBox())!.y)).toBe(24);
      const after = (await side[1]!.boundingBox())!;
      expect(after.y).toBeLessThan(boxes[1]!.y - 500);
    } else {
      expect(boxes[0]!.y).toBeGreaterThanOrEqual(box.y + box.height);
      for (const b of boxes) expect(Math.abs(b.x - box.x)).toBeLessThan(16);
    }
  });

  test('no celular as velas cabem na largura e ficam legíveis: o corpo de cada vela tem pelo menos 2 px', async ({
    page,
  }, testInfo) => {
    test.skip(desktop(testInfo.project.name), 'a largura do celular');
    await page.goto(`/acoes/${TICKER}`);
    const figure = page.getByRole('figure', { name: `Velas diárias de ${TICKER}` });
    const box = (await figure.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const widths = await figure
      .locator('g[data-candle] rect')
      .evaluateAll((rects) => rects.map((rect) => rect.getBoundingClientRect().width));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(2);
  });
});

test.describe('movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('o cartão não sobe e o véu das velas troca na hora', async ({ page }, testInfo) => {
    test.skip(!desktop(testInfo.project.name), 'o hover é do mouse');
    await page.goto('/explorar');
    const card = region(page, 'Modelos').getByRole('listitem').first().getByRole('link');
    await card.hover();
    // o fundo acende sem transição (a regra global zera a duração), e o conteúdo não sobe
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(transparent);
    expect(
      await card.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration)),
    ).toBeLessThan(0.01);
    expect(
      await card.locator('.cartao-explorar-corpo').evaluate((el) => getComputedStyle(el).translate),
    ).toBe('none');

    await page.goto(`/acoes/${TICKER}`);
    const columns = page.locator('.velas-colunas > span');
    await columns.nth(10).hover();
    const veil = await columns.nth(0).evaluate((el) => ({
      duration: parseFloat(getComputedStyle(el).transitionDuration),
      background: getComputedStyle(el).backgroundColor,
    }));
    expect(veil.duration).toBeLessThan(0.01);
    expect(veil.background).not.toBe(transparent);
    // nada anima na página
    expect(
      await page.evaluate(
        // a animação ligada à rolagem (a pista das tabelas) não anda no tempo e fica fora da conta
        () =>
          document
            .getAnimations()
            .filter((a) => a.playState === 'running' && !(a.timeline && 'source' in a.timeline))
            .length,
      ),
    ).toBe(0);
  });
});
