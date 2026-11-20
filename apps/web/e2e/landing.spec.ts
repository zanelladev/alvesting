import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  arenaCurrentSchema,
  decisionsPageSchema,
  equitySchema,
  leaderboardSchema,
  randomBaselineSchema,
} from '@alvesting/contracts';
import { SEASON, SIMULATED, dmy, fetchApi, pct, pctl } from './data';

// A landing (ADR 0041) sobre o banco sintético, na página regrada: o elenco dos seis laboratórios, o método em seis cenas com o dado do
// último ciclo, a justificativa de um modelo, o placar "Arena agora" com o gráfico, a carteira, o FAQ, o convite e o rodapé na faixa escura,
// tudo conferido contra a api (nunca um número inventado). O topo, a arte e a fita estão em hero.spec.ts; a rolagem, os alvos de toque e o
// axe nos dois temas, em layout.spec.ts. Roda em pixel-7, iphone-15 e desktop; o que leva `@tema` roda também nos projetos `-escuro`.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local com o banco sintético');

const region = (page: Page, name: string): Locator =>
  page.getByRole('region', { name, exact: true });

// o laboratório de cada célula do elenco, na ordem dele, o começo do slug do modelo que é dele (src/lib/laboratorio.ts) e o nome da empresa
const LABS = [
  ['openai', 'gpt', 'OpenAI'],
  ['anthropic', 'claude', 'Anthropic'],
  ['google', 'gemini', 'Google'],
  ['xai', 'grok', 'xAI'],
  ['deepseek', 'deepseek', 'DeepSeek'],
  ['qwen', 'qwen', 'Alibaba Cloud'],
] as const;
const BRAND_NOTICE =
  'Os nomes e os logos dos modelos são marcas dos seus donos (OpenAI, Anthropic, Google, xAI, DeepSeek e Alibaba Cloud); a Alvesting não tem relação com eles.';
const SIMULATED_NOTICE =
  'Nesta temporada as decisões são simuladas: o resultado não diz nada sobre os modelos de verdade.';

// os modelos e o Sorteio, na ordem do ranking (o que a landing mostra no elenco, no método e no placar)
async function ranked(request: Parameters<typeof fetchApi>[0]) {
  const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
  return board.rows.filter((r) => r.competitor.type === 'MODEL' || r.competitor.type === 'RANDOM');
}

// O "simulado" uma vez por contexto (docs/DESIGN.md): uma etiqueta no cabeçalho do elenco, e não uma em cada célula. A célula é lugar
// apertado: o nome sai sem o sufixo de versão ("(0813)"), que fica na arena e na página do modelo.
test('o elenco: os seis laboratórios, o nome do modelo sem o sufixo de versão, a etiqueta uma vez no cabeçalho e o aviso de marca inteiro', async ({
  page,
  request,
}) => {
  const models = (await ranked(request)).filter((r) => r.competitor.type === 'MODEL');
  await page.goto('/');
  const strip = region(page, 'Seis laboratórios, o mesmo prompt.');
  const tiles = strip.getByRole('listitem');
  await expect(tiles).toHaveCount(LABS.length);
  await expect(strip.getByText(SIMULATED, { exact: true })).toHaveCount(1);
  await expect(strip.getByText(SIMULATED, { exact: true })).toBeVisible();
  // o banco sintético tem nome com sufixo de versão: o teste prova o corte
  expect(models.some((m) => /\(\d+\)$/.test(m.competitor.name))).toBe(true);
  for (const [i, [lab, prefix, company]] of LABS.entries()) {
    const row = models.find((m) => m.competitor.slug.startsWith(prefix))!;
    const tile = tiles.nth(i);
    // o logo é decorativo (o nome vem ao lado, em texto)
    await expect(tile.locator(`[data-lab="${lab}"]`)).toHaveAttribute('aria-hidden', 'true');
    // o nome curto, o laboratório e o retorno na temporada, o do ranking
    const short = row.competitor.name.replace(/\s+\(\d+\)$/, '');
    await expect(tile).toHaveText(`${short}${company}${pct(row.returnBps)}`);
  }
  await expect(strip).toContainText(`${BRAND_NOTICE} ${SIMULATED_NOTICE}`);
});

// A Regra da Sans Única (docs/DESIGN.md): no que é da landing, tudo é a sans, com algarismos tabulares. A mono fica só na grade da arte (a
// célula do ASCII) e no hash; a tabela do placar é a do ranking, que tem o teste da tela dela.
test('a landing é toda na sans: a mono só na grade da arte e no hash', async ({ page }) => {
  await page.goto('/');
  const mono = await page.getByRole('main').evaluate((main) =>
    [...main.querySelectorAll<HTMLElement>('*')]
      .filter((element) => !element.closest('.arte, .hash, table'))
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

// A Regra da Voz Única (docs/DESIGN.md): no principal da landing a primária pinta só a ação principal (o "Abrir a arena" do topo e, no claro,
// o texto do botão claro do convite), a escolha atual (o item da arena na janela em miniatura), o estado atual (o ponto da temporada em
// andamento, que a temporada encerrada do banco sintético não tem) e a marca. Nenhum enfeite. O que herda a cor de quem já foi contado (a
// seta, o desenho do ícone) não conta de novo.
test(
  'a primária só na ação principal, na escolha atual e na marca, nos dois temas',
  { tag: '@tema' },
  async ({ page }) => {
    await page.goto('/');
    const primary = await page
      .locator('main .btn-primary')
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    const painted = await page.getByRole('main').evaluate((main, color) => {
      const paints = (element: Element) => {
        const style = getComputedStyle(element);
        return [style.backgroundColor, style.color, style.borderTopColor].includes(color);
      };
      return [...main.querySelectorAll('*')]
        .filter((element) => paints(element))
        .filter((element) => !element.parentElement?.closest('.btn, .marca, .janela-item > svg'))
        .map((element) => {
          if (element.matches('.btn-primary, .btn-claro')) return `botão: ${element.textContent}`;
          if (element.matches('.marca')) return 'marca';
          if (element.matches('.janela-item[data-atual] > svg')) return 'item atual';
          if (element.matches('.selo-vivo')) return 'ao vivo';
          return `outro: ${element.outerHTML.slice(0, 80)}`;
        });
    }, primary);
    expect(painted.filter((place) => place.startsWith('outro'))).toEqual([]);
    expect(new Set(painted.filter((place) => place.startsWith('botão')))).toEqual(
      new Set(['botão: Abrir a arena']),
    );
    expect(painted).toContain('marca');
    expect(painted).toContain('item atual');
  },
);

test('o placar "Arena agora": o ranking dos modelos e do Sorteio com o retorno e o percentil, o gráfico do patrimônio e o link para a arena', async ({
  page,
  request,
}) => {
  const rows = await ranked(request);
  const current = await fetchApi(request, '/arena/current', arenaCurrentSchema);
  const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
  const settled = equity.dates.length;
  await page.goto('/');
  const board = region(
    page,
    `Quem está ganhando depois de ${settled} ${settled === 1 ? 'pregão' : 'pregões'}.`,
  );
  await expect(board).toContainText(`Dados até o pregão de ${dmy(current.lastCycle!.date)}.`);
  const table = board.getByRole('table', { name: 'Ranking por retorno: modelos e Sorteio' });
  const headers = table.getByRole('rowheader');
  await expect(headers).toHaveCount(rows.length);
  for (const [i, row] of rows.entries()) {
    await expect(headers.nth(i)).toContainText(row.competitor.name);
    await expect(headers.nth(i).getByRole('link')).toHaveAttribute(
      'href',
      `/modelos/${row.competitor.slug}`,
    );
    const line = table.getByRole('row').nth(i + 1);
    await expect(line).toContainText(pct(row.returnBps));
    if (row.percentileBps !== null) await expect(line).toContainText(pctl(row.percentileBps));
  }
  await expect(board.getByRole('heading', { level: 3, name: 'Patrimônio' })).toBeVisible();
  await expect(board.getByRole('link', { name: 'Abrir a arena', exact: true })).toHaveAttribute(
    'href',
    '/arena',
  );
});

// O topo: a partir de 1024 px a janela da arena em miniatura fica à direita do título, na altura dele; no celular ela desce para depois dos
// botões. A arte nunca fica atrás de texto: a legenda e a fita ficam embaixo dela, no pé da moldura.
test('a janela da arena fica ao lado do título a partir de 1024 px e embaixo dos botões no celular, e a legenda fica embaixo da arte', async ({
  page,
}) => {
  for (const [width, beside] of [
    [1440, true],
    [390, false],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    const rules = (await page
      .getByRole('region', { name: 'Modelos de linguagem investindo na B3' })
      .getByRole('link', { name: 'Regras da arena', exact: true })
      .boundingBox())!;
    const window = (await page.locator('.janela').boundingBox())!;
    if (beside) {
      expect(window.x).toBeGreaterThan(title.x + title.width);
      expect(window.y).toBeLessThan(rules.y + rules.height);
    } else {
      expect(window.y).toBeGreaterThanOrEqual(rules.y + rules.height);
    }
    const art = (await page.locator('[data-arte="escadaria"]').boundingBox())!;
    const caption = (await page.getByText(/^Os mesmos \d+ papéis da B3/).boundingBox())!;
    expect(caption.y).toBeGreaterThanOrEqual(art.y + art.height - 1);
  }
});

test('o método mostra o dado do último ciclo: o briefing, a versão do prompt (nunca o texto), a decisão mais nova, a régua do Monte Carlo e as referências', async ({
  page,
  request,
}) => {
  const current = await fetchApi(request, '/arena/current', arenaCurrentSchema);
  const last = current.lastCycle!;
  const decision = (await fetchApi(request, '/decisions?limit=1', decisionsPageSchema)).rows[0]!;
  const rows = await ranked(request);
  const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
  const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
  const baseline = await fetchApi(
    request,
    `/seasons/${SEASON}/random-baseline`,
    randomBaselineSchema,
  );
  await page.goto('/');
  const method = region(page, 'Todo pregão, a mesma pergunta para todos os modelos.');
  // seis cenas, uma por passo do pregão, cada uma com o título e o texto embaixo: a cena é decorativa, e o texto diz o mesmo
  await expect(method.getByRole('heading', { level: 3 })).toHaveText([
    `${current.season!.params.decisionTimeBrt} · O briefing`,
    'O prompt oculto',
    'A decisão aberta',
    'Na abertura',
    'Sorte ou habilidade?',
    'As referências',
  ]);
  const scenes = method.locator('.cena');
  await expect(scenes).toHaveCount(6);
  for (const scene of await scenes.all())
    await expect(scene).toHaveAttribute('aria-hidden', 'true');
  await expect(scenes.nth(0)).toContainText(`Briefing de ${dmy(last.date)}`);
  if (last.briefingSha256) {
    await expect(scenes.nth(0)).toContainText(last.briefingSha256.slice(0, 24));
  }
  // o prompt: a versão publicada, e o texto nunca (o canário dos testes não aparece em lugar nenhum da página)
  await expect(scenes.nth(1)).toContainText(`versão ${last.prompt!.version.slice(0, 8)}`);
  await expect(page.locator('body')).not.toContainText('alv-canary');
  // a decisão mais nova do feed: as primeiras ordens dela
  for (const { ticker } of decision.items.slice(0, 3)) {
    await expect(scenes.nth(2)).toContainText(ticker);
  }
  // a régua do Monte Carlo, como no desenho: o retorno das carteiras sorteadas no pregão do ranking (o p5, a mediana e o p95, com as duas
  // faixas) e um logo por competidor do placar, no retorno dele
  const sorteadas = baseline.rows.find((row) => row.date === board.asOf)!;
  const regua = scenes.nth(4);
  await expect(regua.locator('.cena-faixa')).toHaveCount(2);
  await expect(regua.locator('.cena-marcador')).toHaveCount(rows.length);
  for (const text of [
    `p5 ${pct(sorteadas.returnBps.p5)}`,
    `mediana ${pct(sorteadas.returnBps.p50)}`,
    `p95 ${pct(sorteadas.returnBps.p95)}`,
    `carteiras sorteadas no pregão de ${dmy(sorteadas.date)}`,
  ]) {
    await expect(regua).toContainText(text);
  }
  // a escala põe a mediana no meio da régua e cabe todo mundo: cada logo fica dentro dela
  const escala = await regua.evaluate((cena) => {
    const linha = cena.querySelector('.cena-regua')!.getBoundingClientRect();
    const mediana = cena.querySelector('.w-px')!.getBoundingClientRect();
    return {
      mediana: mediana.left - (linha.left + linha.width / 2),
      dentro: [...cena.querySelectorAll('.cena-marcador')].every((marcador) => {
        const r = marcador.getBoundingClientRect();
        return r.left + r.width / 2 >= linha.left && r.left + r.width / 2 <= linha.right;
      }),
    };
  });
  expect(Math.abs(escala.mediana)).toBeLessThanOrEqual(1);
  expect(escala.dentro).toBe(true);
  // as referências: a faixa p5 a p95 das carteiras sorteadas atrás das linhas, e o período desde o início da temporada
  await expect(scenes.nth(5).locator('path.banda')).toHaveCount(1);
  await expect(scenes.nth(5)).toContainText(
    new RegExp(
      `${dmy(current.season!.startDate!).slice(0, 5)} a ${dmy(equity.dates.at(-1)!)}, R\\$ \\d.* no início`,
    ),
  );
});

test('a justificativa em destaque: o resumo da decisão mais nova, quem disse, a data e o link para o feed', async ({
  page,
  request,
}) => {
  const decision = (await fetchApi(request, '/decisions?limit=1', decisionsPageSchema)).rows[0]!;
  // o banco sintético tem resumo em toda decisão: sem ele, a landing não mostraria a citação
  expect(decision.summary).toBeTruthy();
  await page.goto('/');
  const quote = page.getByRole('main').locator('figure.citacao');
  await expect(quote.locator('blockquote')).toHaveText(decision.summary!);
  const caption = quote.locator('figcaption');
  await expect(caption).toContainText(decision.competitor.name);
  await expect(caption).toContainText(`Decisão de ${dmy(decision.date)}`);
  await expect(quote.getByRole('link', { name: 'Ler o feed' })).toHaveAttribute(
    'href',
    '/arena#feed',
  );
});

test('a carteira: só texto e o link (a landing não lê a sessão, então nenhum número)', async ({
  page,
}) => {
  await page.goto('/');
  const wallet = region(page, 'Anote as suas ações e compare com a arena.');
  await expect(wallet).not.toContainText(/\d/);
  await expect(wallet.getByRole('link', { name: 'Abrir a carteira' })).toHaveAttribute(
    'href',
    '/carteira',
  );
});

// A tabela do placar cabe no celular sem rolar, com o nome e o Percentil à vista: o placar é sobre o percentil, e ele não pode ficar
// escondido à direita (o QA do fechamento, achado 4).
for (const width of [360, 390]) {
  test(`em ${width} px a tabela do placar cabe inteira, com o Percentil`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const scroller = page.getByRole('region', {
      name: 'Ranking por retorno: modelos e Sorteio',
      exact: true,
    });
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

test('o FAQ tem as seis perguntas tiradas do Como funciona, e o convite leva à arena e às regras', async ({
  page,
}) => {
  await page.goto('/');
  const faq = region(page, 'Perguntas frequentes sobre a arena.');
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
  const cta = region(page, 'Veja a arena agora. O mesmo prompt para todos, todo pregão.');
  await expect(cta.getByRole('link', { name: 'Abrir a arena', exact: true })).toHaveAttribute(
    'href',
    '/arena',
  );
  await expect(cta.getByRole('link', { name: 'Regras da arena', exact: true })).toHaveAttribute(
    'href',
    '/como-funciona',
  );
});

test('o rodapé na faixa escura: as colunas de links, o aviso e o ©', async ({ page }) => {
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
  await expect(footer).toContainText('Arena acadêmica com dinheiro fictício');
});

// O tema segue o sistema (ADR 0041): a moldura da arte e a faixa escura do fim são escuras nos dois temas, e as células seguem o da página. O
// logo do laboratório é o desenho da marca (colorido, ou a máscara preta da OpenAI e da xAI) num quadrado branco nos dois temas.
test(
  'a moldura e a faixa do fim são escuras nos dois temas, as células seguem o tema, e o logo fica no quadrado branco',
  { tag: '@tema' },
  async ({ page }) => {
    await page.goto('/');
    const dark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    const background = (locator: Locator) =>
      locator.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await background(page.locator('.moldura'))).toBe('rgb(0, 0, 0)');
    expect(await background(page.locator('.rodape-site'))).toBe(
      dark ? 'rgb(7, 8, 24)' : 'rgb(11, 12, 36)',
    );
    const tile = region(page, 'Seis laboratórios, o mesmo prompt.').getByRole('listitem').first();
    expect(await background(tile)).toBe(dark ? 'rgb(11, 13, 32)' : 'rgb(255, 255, 255)');
    const logo = tile.locator('.logo');
    expect(await background(logo)).toBe('rgb(255, 255, 255)');
    const desenho = await logo.evaluate((element) => {
      const style = getComputedStyle(element, '::before');
      return `${style.backgroundImage} ${style.maskImage}`;
    });
    expect(desenho).toMatch(/\/laboratorios\/[a-z]+\.svg/);
  },
);
