import { expect, test, type Locator, type Page } from '@playwright/test';
import { arenaCurrentSchema, decisionsPageSchema, leaderboardSchema } from '@alvesting/contracts';
import { SEASON, SIMULATED, dmy, fetchApi, pct, pctl } from './data';

// A landing (ADR 0035) sobre o banco sintético: a faixa dos seis laboratórios, o cartão "Arena
// agora" por cima da moldura, os quatro painéis com recortes de UI de verdade (conferidos contra a api, nunca um número inventado), o FAQ, o
// CTA e o rodapé grande do site. O hero, a arte e a fita estão em hero.spec.ts; a rolagem, os alvos de toque e o axe nos dois temas, em
// layout.spec.ts. Roda em pixel-7, iphone-15 e desktop; o que leva `@tema` roda também nos projetos `-escuro`.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local com o banco sintético');

const region = (page: Page, name: string): Locator =>
  page.getByRole('region', { name, exact: true });
const fact = (scope: Locator, term: string): Locator => scope.locator(`dt:text-is("${term}") + dd`);

// o laboratório de cada ladrilho, na ordem da faixa, e o começo do slug do modelo do elenco que é dele (src/lib/laboratorio.ts)
const LABS = [
  ['openai', 'gpt'],
  ['anthropic', 'claude'],
  ['google', 'gemini'],
  ['xai', 'grok'],
  ['deepseek', 'deepseek'],
  ['qwen', 'qwen'],
] as const;
const BRAND_NOTICE =
  'Os nomes e os logos dos modelos são marcas dos seus donos (OpenAI, Anthropic, Google, xAI, DeepSeek e Alibaba Cloud); a Alvesting não tem relação com eles.';
const SIMULATED_NOTICE =
  'Nesta temporada as decisões são simuladas: o resultado não diz nada sobre os modelos de verdade.';

// os modelos e o Sorteio, na ordem do ranking (o que a landing mostra no cartão e no painel do Sorteio)
async function ranked(request: Parameters<typeof fetchApi>[0]) {
  const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
  return board.rows.filter((r) => r.competitor.type === 'MODEL' || r.competitor.type === 'RANDOM');
}

// O "simulado" uma vez por contexto (docs/DESIGN.md): uma etiqueta no cabeçalho da faixa, e não uma em cada ladrilho. O ladrilho é lugar
// apertado: o nome sai sem o sufixo de versão ("(0813)"), que fica na arena e na página do modelo.
test('a faixa dos seis laboratórios: o logo, o nome do modelo sem o sufixo de versão, a etiqueta uma vez no cabeçalho e o aviso de marca inteiro', async ({
  page,
  request,
}) => {
  const models = (await ranked(request))
    .filter((r) => r.competitor.type === 'MODEL')
    .map((r) => r.competitor);
  await page.goto('/');
  const strip = region(page, 'Seis laboratórios, o mesmo prompt');
  const tiles = strip.getByRole('listitem');
  await expect(tiles).toHaveCount(LABS.length);
  await expect(strip.getByText(SIMULATED, { exact: true })).toHaveCount(1);
  await expect(strip.getByText(SIMULATED, { exact: true })).toBeVisible();
  // o banco sintético tem nome com sufixo de versão: o teste prova o corte
  expect(models.some((m) => /\(\d+\)$/.test(m.name))).toBe(true);
  for (const [i, [lab, prefix]] of LABS.entries()) {
    const model = models.find((m) => m.slug.startsWith(prefix))!;
    const tile = tiles.nth(i);
    // o logo é decorativo (o nome vem ao lado, em texto)
    await expect(tile.locator(`[data-lab="${lab}"]`)).toHaveAttribute('aria-hidden', 'true');
    await expect(tile).toHaveText(model.name.replace(/\s+\(\d+\)$/, ''));
  }
  await expect(strip).toContainText(`${BRAND_NOTICE} ${SIMULATED_NOTICE}`);
});

// A Regra da Sans Única (docs/DESIGN.md): no que é da landing, tudo é a sans, com algarismos tabulares. A mono fica só na grade da arte (a
// célula do ASCII) e no hash; os recortes das peças da arena (a faixa dos modelos, a decisão e o ranking) têm o teste da tela delas.
test('a landing é toda na sans: a mono só na grade da arte e no SHA-256', async ({ page }) => {
  await page.goto('/');
  const mono = await page.getByRole('main').evaluate((main) =>
    [...main.querySelectorAll<HTMLElement>('*')]
      .filter(
        (element) =>
          !element.closest('.arte, .hash, [role="region"][aria-label^="Retorno"], article, table'),
      )
      .filter((element) =>
        [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '',
        ),
      )
      .filter((element) => /mono/i.test(getComputedStyle(element).fontFamily))
      .map(
        (element) => `${element.tagName.toLowerCase()}: ${element.textContent.trim().slice(0, 40)}`,
      ),
  );
  expect(mono).toEqual([]);
});

// A Regra da Voz Única (docs/DESIGN.md): no principal da landing a primária pinta só a ação principal, o "Abrir a arena" do hero e o do fim.
test(
  'a primária só nos dois botões "Abrir a arena", nos dois temas',
  { tag: '@tema' },
  async ({ page }) => {
    await page.goto('/');
    const primary = await page
      .locator('main .btn-primary')
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    const painted = await page.getByRole('main').evaluate(
      (main, color) =>
        [...main.querySelectorAll<HTMLElement>('*')]
          .filter((element) => {
            const style = getComputedStyle(element);
            return [style.backgroundColor, style.color, style.borderTopColor].includes(color);
          })
          .map((element) => element.textContent.trim()),
      primary,
    );
    expect(painted).toEqual(['Abrir a arena', 'Abrir a arena']);
  },
);

test('o cartão "Arena agora": a faixa dos modelos e do Sorteio na ordem do ranking, com o retorno e o percentil, e o link para a arena', async ({
  page,
  request,
}) => {
  const rows = await ranked(request);
  await page.goto('/');
  const card = region(page, 'Arena agora');
  const links = card
    .getByRole('region', { name: 'Retorno na temporada: modelos e Sorteio' })
    .getByRole('link');
  await expect(links).toHaveCount(rows.length);
  for (const [i, row] of rows.entries()) {
    await expect(links.nth(i)).toHaveAttribute('href', `/modelos/${row.competitor.slug}`);
    await expect(links.nth(i)).toContainText(row.competitor.name);
    await expect(links.nth(i)).toContainText(pct(row.returnBps));
    if (row.percentileBps !== null) {
      await expect(links.nth(i)).toContainText(`percentil ${pctl(row.percentileBps)}`);
    }
  }
  await expect(card.getByRole('link', { name: 'Abrir a arena', exact: true })).toHaveAttribute(
    'href',
    '/arena',
  );
});

// A arte nunca fica atrás de texto: a partir de 1024 px o cartão cobre o lado esquerdo da moldura (o vazio preto da arte), acima do pé com a
// legenda e a fita; no celular ele desce para depois dela.
test('a partir de 1024 px o cartão fica por cima da moldura, à esquerda e acima do pé; no celular, embaixo dela', async ({
  page,
}) => {
  for (const [width, over] of [
    [1440, true],
    [390, false],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const frame = (await page.locator('.moldura').boundingBox())!;
    const card = (await region(page, 'Arena agora').boundingBox())!;
    const caption = (await page
      .getByText(/Cotações: brapi\.dev, pregão de/)
      .first()
      .boundingBox())!;
    if (over) {
      expect(card.x).toBeGreaterThan(frame.x);
      expect(card.x + card.width).toBeLessThan(frame.x + frame.width / 2);
      expect(card.y).toBeGreaterThan(frame.y);
      expect(card.y + card.height).toBeLessThan(caption.y);
    } else {
      expect(card.y).toBeGreaterThanOrEqual(frame.y + frame.height);
    }
  }
});

test('os painéis mostram recortes de UI com o dado da api: o último ciclo, a última decisão, o ranking e a carteira sem número', async ({
  page,
  request,
}) => {
  const current = await fetchApi(request, '/arena/current', arenaCurrentSchema);
  const last = current.lastCycle!;
  const decision = (await fetchApi(request, '/decisions?limit=1', decisionsPageSchema)).rows[0]!;
  const rows = await ranked(request);
  await page.goto('/');

  // o mesmo prompt: a contagem de BUY, SELL e HOLD do último ciclo e o hash publicado (nunca o texto)
  const cycle = region(page, 'Todo pregão, a mesma pergunta');
  await expect(cycle).toContainText(`Ciclo de ${dmy(last.date)}`);
  for (const action of ['BUY', 'SELL', 'HOLD'] as const) {
    await expect(fact(cycle, action)).toHaveText(String(last.counts[action]));
  }
  await expect(fact(cycle, 'Versão do prompt')).toHaveText(last.prompt!.version);
  await expect(fact(cycle, 'SHA-256 do prompt')).toHaveText(last.prompt!.sha256!);
  await expect(cycle).not.toContainText('alv-canary');
  await expect(cycle.getByRole('link', { name: 'Ver o último ciclo' })).toHaveAttribute(
    'href',
    `/ciclos/${last.date}`,
  );

  // a justificativa: a decisão mais nova do feed, inteira, como o feed da arena a mostra
  const why = region(page, 'A justificativa fica aberta');
  const card = why.getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { level: 3 })).toContainText(decision.competitor.name);
  if (decision.summary) await expect(card).toContainText(decision.summary);
  // o logo de cada ação ao lado do ticker, como no feed da arena (os dois papéis com logo do seed do e2e; os outros, o monograma)
  for (const { ticker } of decision.items) {
    await expect(
      card.getByRole('link', { name: ticker, exact: true }).locator('[data-logo]'),
    ).toHaveAttribute('data-logo', ['MOVE3', 'SINA3'].includes(ticker) ? 'imagem' : 'monograma');
  }
  await expect(why.getByRole('link', { name: 'Ver o feed' })).toHaveAttribute(
    'href',
    '/arena#feed',
  );

  // sorte ou habilidade: a tabela compacta do ranking, os modelos e o Sorteio na ordem dele, com o retorno
  const luck = region(page, 'Sorte ou habilidade?');
  const headers = luck.getByRole('rowheader');
  await expect(headers).toHaveCount(rows.length);
  for (const [i, row] of rows.entries()) {
    await expect(headers.nth(i)).toContainText(row.competitor.name);
    await expect(luck.getByRole('row').nth(i + 1)).toContainText(pct(row.returnBps));
  }
  await expect(luck.getByRole('link', { name: 'Ver o ranking' })).toHaveAttribute(
    'href',
    '/ranking',
  );

  // a carteira: só texto e o link (a landing não lê a sessão, então nenhum número)
  const wallet = region(page, 'Sua carteira, anotada por você');
  await expect(wallet).not.toContainText(/\d/);
  await expect(wallet.getByRole('link', { name: 'Abrir a carteira' })).toHaveAttribute(
    'href',
    '/carteira',
  );
});

// A tabela compacta do "Sorte ou habilidade?" cabe no celular sem rolar, com o nome curto e o Percentil à vista: o painel é sobre o percentil,
// e antes ele era a coluna que ficava escondida à direita (o QA do fechamento, achado 4).
for (const width of [360, 390]) {
  test(`em ${width} px a tabela do "Sorte ou habilidade?" cabe inteira, com o Percentil`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const luck = region(page, 'Sorte ou habilidade?');
    const scroller = luck.getByRole('region', { name: /ranking/i });
    await scroller.scrollIntoViewIfNeeded();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const fit = await scroller.evaluate((box) => ({
      overflow: box.scrollWidth - box.clientWidth,
      percentil: (() => {
        const header = [...box.querySelectorAll('th')].find(
          (th) => th.textContent === 'Percentil',
        )!;
        return (
          Math.round(header.getBoundingClientRect().right - box.getBoundingClientRect().right) <= 0
        );
      })(),
    }));
    expect(fit).toEqual({ overflow: 0, percentil: true });
  });
}

test('o FAQ tem as seis perguntas tiradas do Como funciona, e o CTA leva à arena e às regras', async ({
  page,
}) => {
  await page.goto('/');
  const faq = region(page, 'Perguntas frequentes');
  await expect(faq.getByRole('heading', { level: 3 })).toHaveText([
    'O que é a arena?',
    'Os modelos são de verdade?',
    'De onde vêm os preços?',
    'O prompt é igual para todos?',
    'Isto é recomendação de investimento?',
    'Dá para acompanhar a minha carteira?',
  ]);
  // a arena do banco sintético é simulada: a resposta diz isso
  await expect(faq).toContainText('Ainda não. Os nomes são os do elenco da temporada');
  const cta = region(page, 'Veja a arena agora.');
  await expect(cta.getByRole('link', { name: 'Abrir a arena', exact: true })).toHaveAttribute(
    'href',
    '/arena',
  );
  await expect(cta.getByRole('link', { name: 'Regras da arena', exact: true })).toHaveAttribute(
    'href',
    '/como-funciona',
  );
});

test('o rodapé grande: as colunas de links, o aviso, o © e o nome gigante decorativo, que cabe em 360 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const map = page.getByRole('navigation', { name: 'Mapa do site' });
  const links = [
    ['Arena', '/arena'],
    ['Ranking', '/ranking'],
    ['Explorar', '/explorar'],
    ['Ações', '/acoes'],
    ['Notícias', '/noticias'],
    ['Como funciona', '/como-funciona'],
    ['Chat', '/chat'],
    ['Entrar', '/entrar'],
    ['Criar conta', '/cadastro'],
    ['Carteira', '/carteira'],
    ['Minha conta', '/conta'],
    ['Termos de uso', '/termos'],
    ['Política de privacidade', '/privacidade'],
  ] as const;
  await expect(map.getByRole('link')).toHaveText(links.map(([name]) => name));
  for (const [name, href] of links) {
    await expect(map.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  await expect(map.getByRole('heading', { level: 2 })).toHaveText([
    'Arena',
    'Projeto',
    'Conta',
    'Legal',
  ]);
  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('© 2026 Alvesting · projeto de TCC');
  // o nome gigante é enfeite: fora do que o leitor de tela lê (o texto mora no CSS) e dentro da largura
  const giant = footer.locator('.nome-gigante');
  await expect(giant).toHaveAttribute('aria-hidden', 'true');
  expect(await giant.evaluate((element) => element.textContent)).toBe('');
  expect(await giant.evaluate((element) => getComputedStyle(element, '::before').content)).toBe(
    '"Alvesting"',
  );
  const { scrollWidth, clientWidth } = await giant.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

// O tema segue o sistema (ADR 0035): a moldura da arte é escura nos dois, e o cartão e os ladrilhos seguem o da página. O logo do
// laboratório é o desenho da marca (colorido, ou a máscara preta da OpenAI e da xAI) num círculo branco nos dois temas (06/11/2026; antes
// ele era a máscara pintada na tinta, que seguia o tema).
test(
  'a moldura é escura nos dois temas, o cartão e os ladrilhos seguem o tema, e o logo fica no círculo branco',
  { tag: '@tema' },
  async ({ page }) => {
    await page.goto('/');
    const dark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    const background = (locator: Locator) =>
      locator.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await background(page.locator('.moldura'))).toBe('rgb(0, 0, 0)');
    expect(await background(region(page, 'Arena agora'))).toBe(
      dark ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)',
    );
    const tile = region(page, 'Seis laboratórios, o mesmo prompt').getByRole('listitem').first();
    expect(await background(tile)).toBe(dark ? 'rgb(31, 31, 31)' : 'rgb(245, 245, 245)');
    const logo = tile.locator('.logo');
    expect(await background(logo)).toBe('rgb(255, 255, 255)');
    const desenho = await logo.evaluate((element) => {
      const style = getComputedStyle(element, '::before');
      return `${style.backgroundImage} ${style.maskImage}`;
    });
    expect(desenho).toMatch(/\/laboratorios\/[a-z]+\.svg/);
  },
);
