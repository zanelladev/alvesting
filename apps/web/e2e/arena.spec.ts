import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  arenaCurrentSchema,
  competitorDetailSchema,
  cycleViewSchema,
  decisionsPageSchema,
  equitySchema,
  leaderboardSchema,
  newsPageSchema,
  randomBaselineSchema,
  stockDetailSchema,
  stockSearchSchema,
  type FeedDecision,
  type LeaderboardRow,
  type NewsItem,
} from '@alvesting/contracts';
import {
  CAST,
  CYCLE_DAY,
  FEED_PAGE,
  MODEL,
  SEASON,
  SIMULATED,
  TICKER,
  brl,
  brlSigned,
  brt,
  clean,
  dmy,
  fetchApi,
  fetchBars,
  fetchTape,
  itemText,
  pct,
  pctl,
  ratioBps,
  shownName,
  stockDecisionText,
  usd,
} from './data';
import { abrirMenu } from './menu';

// o h1 da landing (a /) é o título do hero (ADR 0034), que a navegação de ponta a ponta confere no fim
const HERO_TITLE = 'Modelos de linguagem investindo na B3';

// As telas da arena (etapa 9, parte 2) sobre o banco sintético do e2e: a mesma temporada inteira do ensaio (5 pregões, os 6 modelos
// do elenco com decisões simuladas do provedor fake, o Sorteio e 3 referências, nada de terceiro). Cada teste lê o dado da api e confere que a tela mostra o mesmo, valor a valor.
// Roda em pixel-7, iphone-15 e desktop (mobile é gate de merge). Não roda contra o site publicado (BASE_URL), que tem outro banco.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local com o banco sintético');

const region = (page: Page, name: string | RegExp): Locator =>
  page.getByRole('region', { name, exact: typeof name === 'string' });
// <dl> de fatos: o <dd> que vem logo depois do <dt> com este texto
const fact = (scope: Locator, term: string): Locator => scope.locator(`dt:text-is("${term}") + dd`);
const rowOf = (scope: Locator, name: string): Locator =>
  scope
    .getByRole('row')
    .filter({ has: scope.page().getByRole('rowheader', { name, exact: true }) });
const dash = (value: number | null, format: (n: number) => string) =>
  value === null ? '—' : format(value);

// as células de uma linha do ranking completo (a ordem das colunas da tabela: as quatro da home e mais sete)
const fullCells = (r: LeaderboardRow) => [
  String(r.rank),
  shownName(r.competitor),
  pct(r.returnBps),
  dash(r.percentileBps, pctl),
  brl(r.equityCents),
  dash(r.excessEqualWeightBps, pct),
  dash(r.excessCdiBps, pct),
  pct(r.maxDrawdownBps, false),
  r.winRateBps === null ? '—' : `${pct(r.winRateBps, false)} (${r.winningSells}/${r.sells})`,
  String(r.trades),
  usd(r.llmCostMicroUsd),
];

// Um cartão de decisão (o feed da home, o ciclo e a página do modelo usam o mesmo): o título e o endereço dele, a linha da data e da visão
// de mercado, o resumo do modelo e cada item (ação, ticker, percentual, confiança e justificativa), tudo por IGUALDADE: um dígito, uma
// palavra a mais ou um BUY trocado por SELL reprova. `by`: o que dá o título, o modelo (feed e ciclo) ou a data do ciclo (página do
// modelo); `date`: a data do pregão, quando o cartão a mostra; `simulated`: o nome do modelo leva a etiqueta "simulado". O banco
// sintético só tem decisões DECIDED, e um item descartado só no último pregão (o limite de 10 posições do Qwen3.8 Max, docs/ENSAIO.md):
// o HOLD forçado e os descartados, com o motivo, são de e2e/fixture.spec.ts.
type CardDecision = Pick<FeedDecision, 'summary' | 'marketView' | 'items'> & {
  competitor: { slug: string; name: string };
};
async function expectCard(
  card: Locator,
  decision: CardDecision,
  { by, date, simulated = false }: { by: 'model' | 'date'; date?: string; simulated?: boolean },
) {
  const model = {
    text: simulated ? `${decision.competitor.name} ${SIMULATED}` : decision.competitor.name,
    href: `/modelos/${decision.competitor.slug}`,
  };
  const day = date ? { text: dmy(date), href: `/ciclos/${date}` } : undefined;
  const title = by === 'model' ? model : day!;
  const heading = card.getByRole('heading', { level: 3 });
  await expect(heading).toHaveText(title.text);
  await expect(heading.getByRole('link')).toHaveAttribute('href', title.href);
  // a etiqueta fica fora do link: o nome do link é só o nome do modelo
  if (by === 'model') {
    await expect(heading.getByRole('link')).toHaveText(decision.competitor.name);
  }

  // a linha de baixo: a data, quando o título é o modelo, e a visão de mercado
  if (by === 'model' && day) {
    await expect(card.locator('header').getByRole('link', { name: day.text })).toHaveAttribute(
      'href',
      day.href,
    );
  }
  // "neutro" é o valor do contrato; a frase concorda com "visão" (otimista e pessimista servem aos dois gêneros)
  const view = decision.marketView === 'neutro' ? 'neutra' : decision.marketView;
  const sub = [
    ...(by === 'model' && day ? [day.text] : []),
    ...(view ? [`visão ${view}`] : []),
  ].join(' ');
  await expect(card.locator('header p')).toHaveText(sub, { useInnerText: true });

  // o resumo é o único parágrafo direto do cartão
  await expect(card.locator(':scope > p')).toHaveText(decision.summary ? [decision.summary] : []);

  const lines = card.locator('li').filter({ has: card.page().locator('[data-action]') });
  await expect(lines).toHaveCount(decision.items.length);
  for (const [i, item] of decision.items.entries()) {
    await expect(lines.nth(i)).toHaveText(itemText(item), { useInnerText: true });
    await expect(lines.nth(i).getByRole('link')).toHaveAttribute('href', `/acoes/${item.ticker}`);
  }
}

// a hora da notícia como a tela a escreve: o documento da CVM chega só com o dia (a api o guarda à meia-noite de Brasília)
const newsStamp = (n: NewsItem) =>
  n.source.startsWith('cvm') ? brt(n.publishedAt).slice(0, 10) : brt(n.publishedAt);

// A arena (/arena): o conteúdo que era da home, no desenho da Arena do Rallies (docs/redesign-rallies/plano.md, seção e). A landing da / não
// tem mais estas regiões.
test.describe('arena', () => {
  test('mostra a temporada, as cotações com a data, os ciclos e o ranking do banco sintético', async ({
    page,
    request,
  }) => {
    const current = await fetchApi(request, '/arena/current', arenaCurrentSchema);
    const season = current.season!;
    const last = current.lastCycle!;
    const macro = current.macro;
    await page.goto('/arena');
    await expect(page).toHaveTitle('Arena · Alvesting');
    await expect(page.getByRole('heading', { level: 1, name: 'Arena' })).toBeVisible();

    const seasonRegion = region(page, 'Temporada');
    await expect(fact(seasonRegion, 'Nome')).toHaveText(season.name);
    await expect(fact(seasonRegion, 'Situação')).toHaveText('Encerrada');
    await expect(fact(seasonRegion, 'Pregões')).toHaveText(String(season.params.sessions));
    await expect(fact(seasonRegion, 'Liquidado até')).toHaveText(dmy(season.settledThrough!));

    // cada valor da faixa de cotações leva a data do dado. O BOVA11 não vem da API pública (ela não entrega cotação bruta): o teste o lê da rota
    // interna, como o site, e confere o último fechamento, a variação sobre o anterior e o crédito da brapi
    const quotes = region(page, 'Cotações e macro');
    expect(macro).not.toHaveProperty('bova11');
    const bovaBars = await fetchBars(request, 'BOVA11');
    const bova = bovaBars.at(-1)!;
    const previousBar = bovaBars.at(-2)!;
    const change = Math.round(
      ((bova.closeCents - previousBar.closeCents) * 10_000) / previousBar.closeCents,
    );
    await expect(fact(quotes, 'BOVA11')).toContainText(`${brl(bova.closeCents)} (${pct(change)})`);
    await expect(fact(quotes, 'BOVA11')).toContainText(
      `brapi.dev, fechamento de ${dmy(bova.date)}`,
    );
    const decimal = (value: string) => value.replace('.', ',');
    await expect(fact(quotes, 'CDI')).toContainText(`${decimal(macro.cdi!.value)}% ao dia`);
    await expect(fact(quotes, 'CDI')).toContainText(dmy(macro.cdi!.date));
    await expect(fact(quotes, 'Selic (meta)')).toContainText(
      `${decimal(macro.selic!.value)}% ao ano`,
    );
    await expect(fact(quotes, 'IPCA no mês')).toContainText(`${decimal(macro.ipcaMonth!.value)}%`);
    await expect(fact(quotes, 'IPCA em 12 meses')).toContainText(
      `${decimal(macro.ipca12m!.value)}%`,
    );
    await expect(fact(quotes, 'Dólar (PTAX de venda)')).toContainText(
      `R$ ${decimal(macro.usd!.value)}`,
    );
    await expect(fact(quotes, 'Dólar (PTAX de venda)')).toContainText(dmy(macro.usd!.date));

    // o último ciclo, com a contagem de BUY, SELL e HOLD que valeram; a temporada acabou, então não há próximo
    const cycles = region(page, 'Ciclos');
    await expect(
      fact(cycles, 'Último ciclo').getByRole('link', { name: dmy(last.date) }),
    ).toHaveAttribute('href', `/ciclos/${last.date}`);
    // a data e a situação do ciclo (a palavra "fechado", e não "aberto"), por igualdade
    const cycleStatus = { OPEN: 'aberto', CLOSED: 'fechado', SKIPPED: 'pulado' } as const;
    await expect(fact(cycles, 'Último ciclo')).toHaveText(
      `${dmy(last.date)} ${cycleStatus[last.status]}`,
    );
    for (const action of ['BUY', 'SELL', 'HOLD'] as const) {
      await expect(fact(cycles, action)).toHaveText(String(last.counts[action]));
    }
    expect(last.counts.BUY + last.counts.SELL + last.counts.HOLD).toBeGreaterThan(0);
    await expect(fact(cycles, 'Próximo ciclo')).toContainText('a temporada acabou');
  });

  test('as telas da área: a arena, o ranking e o último ciclo, com a arena marcada, e as regras da arena', async ({
    page,
    request,
  }) => {
    const current = await fetchApi(request, '/arena/current', arenaCurrentSchema);
    await page.goto('/arena');
    // no celular é o segmentado, no desktop a linha de abas: o mesmo nome, um desenho em cada largura (o outro fica fora da tela)
    const screens = page.getByRole('navigation', { name: 'Telas da arena' });
    await expect(screens).toHaveCount(1);
    await expect(screens.getByRole('link')).toHaveText(['Arena', 'Ranking', 'Último ciclo']);
    await expect(screens.getByRole('link', { name: 'Arena' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(screens.getByRole('link', { name: 'Último ciclo' })).toHaveAttribute(
      'href',
      `/ciclos/${current.lastCycle!.date}`,
    );
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) {
      await expect(
        page.getByRole('main').getByRole('link', { name: 'Regras da arena' }),
      ).toHaveAttribute('href', '/como-funciona');
    } else {
      await expect(page.getByRole('navigation', { name: 'Trilha' })).toHaveText(
        /Início\s*›\s*Arena/,
      );
    }
  });

  test('o gráfico de patrimônio tem título, descrição, uma tabela com os mesmos valores e o rótulo no fim de cada linha', async ({
    page,
    request,
  }) => {
    const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
    const baseline = await fetchApi(
      request,
      `/seasons/${SEASON}/random-baseline`,
      randomBaselineSchema,
    );
    await page.goto('/arena');
    const chart = region(page, 'Patrimônio');

    const svg = chart.getByRole('img', { name: /Patrimônio/ });
    await expect(svg).toBeVisible();
    await expect(svg.locator('title')).toHaveCount(1);
    await expect(svg.locator('desc')).toHaveCount(1);
    await expect(svg.locator('desc')).toContainText(dmy(equity.dates[0]!));
    await expect(svg.locator('desc')).toContainText(dmy(equity.dates.at(-1)!));
    // uma linha por competidor que aparece no gráfico (modelos e Sorteio) e a faixa p5 a p95 do Monte Carlo
    const drawn = equity.series.filter(
      (s) => s.competitor.type === 'MODEL' || s.competitor.type === 'RANDOM',
    );
    await expect(svg.locator('path[data-series]')).toHaveCount(drawn.length);
    await expect(svg.locator('path[data-band]')).toHaveCount(1);

    // a tabela equivalente para leitor de tela: uma linha por pregão, uma coluna por linha do gráfico, mais p5 e p95
    const table = chart.getByRole('table', { name: /dados do gráfico/i });
    await expect(table.getByRole('row')).toHaveCount(1 + equity.dates.length);
    const headers = (await table.getByRole('columnheader').allInnerTexts()).map(clean);
    expect(headers).toEqual([
      'Data',
      ...drawn.map((s) => s.competitor.name),
      'Monte Carlo p5',
      'Monte Carlo p95',
    ]);
    for (const [i, date] of equity.dates.entries()) {
      const cells = await table
        .getByRole('row')
        .nth(i + 1)
        .locator('th, td')
        .allInnerTexts();
      expect(cells.map(clean)).toEqual([
        dmy(date),
        ...drawn.map((s) => brl(s.equityCents[i]!)),
        brl(baseline.rows[i]!.equityCents.p5),
        brl(baseline.rows[i]!.equityCents.p95),
      ]);
    }

    // no fim de cada linha, o logo do laboratório (o Sorteio, a inicial) e o patrimônio final numa pílula; decorativo para o leitor de tela,
    // que tem a tabela. Os rótulos não se encavalam: de cima para baixo, cada um começa depois de o de cima terminar.
    const boxes: { y: number; height: number }[] = [];
    for (const s of drawn) {
      const label = chart.locator(`[data-rotulo="${s.competitor.slug}"]`);
      await expect(label).toBeVisible();
      await expect(label).toHaveText(brl(s.equityCents.at(-1)!));
      await expect(
        label.locator(s.competitor.type === 'MODEL' ? '[data-lab]' : '[data-inicial]'),
      ).toHaveCount(1);
      boxes.push((await label.boundingBox())!);
    }
    await expect(chart.locator('ul[aria-hidden="true"] [data-rotulo]')).toHaveCount(drawn.length);
    const sorted = boxes.sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.height - 0.5);
    }
  });

  // A faixa dos modelos do Rallies (plano, e.3): um cartão por modelo e o Sorteio, na ordem do ranking, com o nome, o retorno e o percentil.
  test('a faixa traz os modelos e o Sorteio na ordem do ranking, com retorno e percentil', async ({
    page,
    request,
  }) => {
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    await page.goto('/arena');
    const ranking = region(page, 'Ranking');
    const shown = board.rows.filter(
      (r) => r.competitor.type === 'MODEL' || r.competitor.type === 'RANDOM',
    );
    expect(shown).toHaveLength(7);
    const items = ranking.getByRole('listitem');
    await expect(items).toHaveCount(shown.length);
    for (const [i, r] of shown.entries()) {
      const link = items.nth(i).getByRole('link');
      // O nome acessível do cartão, e não o innerText: no cartão de 160 px a etiqueta "simulado" desce para a linha de baixo, e o
      // innerText do WebKit apaga o espaço dessa quebra ("Gemini 4 Argonsimulado"); o nome acessível não depende de onde a linha quebra.
      await expect(link).toHaveAccessibleName(
        `${shownName(r.competitor)} ${pct(r.returnBps)} percentil ${pctl(r.percentileBps!)}`,
      );
      await expect(link).toHaveAttribute('href', `/modelos/${r.competitor.slug}`);
    }
    // as referências não entram na faixa
    await expect(ranking.getByText('CDI', { exact: true })).toHaveCount(0);
    await expect(ranking.getByRole('link', { name: 'Ranking completo' })).toHaveAttribute(
      'href',
      '/ranking',
    );
  });

  test('o feed mostra as decisões mais novas, com o retorno do modelo e o texto do modelo como texto', async ({
    page,
    request,
  }) => {
    const feed = await fetchApi(request, `/decisions?limit=${FEED_PAGE}`, decisionsPageSchema);
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    await page.goto('/arena');
    const cards = region(page, 'Decisões').getByRole('article');
    await expect(cards).toHaveCount(feed.rows.length);
    for (const [i, row] of feed.rows.entries()) {
      await expectCard(cards.nth(i), row, {
        by: 'model',
        date: row.date,
        simulated: row.competitor.provider === 'fake',
      });
      // o retorno do modelo na temporada, do ranking, no cabeçalho (o glifo da direção é do CSS)
      const ret = board.rows.find((r) => r.competitor.slug === row.competitor.slug)!.returnBps;
      await expect(cards.nth(i).locator('header [data-dir]')).toHaveText(pct(ret));
    }
  });

  // A barra "Carteiras" (plano, e.2): a carteira de cada modelo no último pregão liquidado, conferida contra /competitors/:slug, valor a valor:
  // a alocação é o valor da posição sobre o patrimônio, e o resultado % é o resultado sobre o custo.
  test('as carteiras dos modelos: a alocação, o resultado e o caixa de cada um, contra a api', async ({
    page,
    request,
  }) => {
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    const current = await fetchApi(request, '/arena/current', arenaCurrentSchema);
    const capital = current.season!.params.capitalCents;
    await page.goto('/arena');
    const wallets = region(page, 'Carteiras');
    const models = board.rows.filter((r) => r.competitor.type === 'MODEL');
    // só os modelos: o Sorteio e as referências não têm composição pública (ADR 0033)
    await expect(wallets.locator('[data-carteira]')).toHaveCount(models.length);
    for (const r of models) {
      const detail = await fetchApi(
        request,
        `/competitors/${r.competitor.slug}`,
        competitorDetailSchema,
      );
      const portfolio = detail.portfolio!;
      const holdings = portfolio.holdings!;
      const wallet = wallets.locator(`[data-carteira="${r.competitor.slug}"]`);
      await expect(wallet.getByRole('heading', { level: 3 })).toHaveText(shownName(r.competitor));
      await expect(wallet.getByRole('heading', { level: 3 }).getByRole('link')).toHaveAttribute(
        'href',
        `/modelos/${r.competitor.slug}`,
      );
      await expect(fact(wallet, 'Resultado')).toHaveText(
        brlSigned(portfolio.equityCents - capital),
      );
      await expect(fact(wallet, 'Caixa')).toHaveText(brl(holdings.cashCents));
      if (holdings.positions.length === 0) {
        await expect(wallet).toContainText('Nenhuma posição: o patrimônio está todo em caixa.');
        await expect(wallet.getByRole('table')).toHaveCount(0);
        continue;
      }
      const table = wallet.getByRole('table', {
        name: `Carteira de ${r.competitor.name} em ${dmy(portfolio.date)}`,
      });
      await expect(table.getByRole('columnheader')).toHaveText([
        'Ação',
        'Alocação',
        'Resultado',
        'Resultado %',
      ]);
      await expect(table.getByRole('row')).toHaveCount(1 + holdings.positions.length);
      for (const p of holdings.positions) {
        const row = rowOf(table, p.ticker);
        await expect(row.getByRole('link')).toHaveAttribute('href', `/acoes/${p.ticker}`);
        await expect(row.getByRole('cell')).toHaveText([
          pct(ratioBps(p.valueCents, portfolio.equityCents), false),
          brlSigned(p.pnlCents),
          pct(ratioBps(p.pnlCents, p.costCents)),
        ]);
      }
    }
  });
});

test.describe('filtro do feed por BUY, SELL e HOLD', () => {
  const ACTIONS = ['BUY', 'SELL', 'HOLD'] as const;
  const filter = (page: Page) => page.getByRole('navigation', { name: 'Filtrar decisões' });

  for (const action of ACTIONS) {
    test(`${action}: a URL guarda o filtro, só aparecem as decisões dele e a paginação não repete linha`, async ({
      page,
      request,
    }) => {
      const all = await fetchApi(
        request,
        `/decisions?action=${action}&limit=100`,
        decisionsPageSchema,
      );
      expect(all.rows.length, 'o banco sintético tem decisões de cada ação').toBeGreaterThan(0);

      await page.goto('/arena');
      await filter(page).getByRole('link', { name: action, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`[?&]filtro=${action}(&|#|$)`));
      await expect(filter(page).getByRole('link', { name: action, exact: true })).toHaveAttribute(
        'aria-current',
        'true',
      );
      await expect(filter(page).getByRole('link', { name: 'Todas' })).not.toHaveAttribute(
        'aria-current',
        'true',
      );

      const seen: string[] = [];
      for (;;) {
        const cards = region(page, 'Decisões').getByRole('article');
        const n = await cards.count();
        expect(n).toBeGreaterThan(0);
        for (let i = 0; i < n; i += 1) {
          const card = cards.nth(i);
          const badges = await card
            .locator('[data-action]')
            .evaluateAll((els) => els.map((e) => e.getAttribute('data-action')));
          if (action === 'HOLD') {
            // a decisão que só segurou: nenhum BUY nem SELL válido
            expect(badges, 'HOLD sem BUY nem SELL').not.toContain('BUY');
            expect(badges).not.toContain('SELL');
          } else {
            expect(badges, `uma decisão com ${action}`).toContain(action);
          }
          const model = (await card.getByRole('link').first().getAttribute('href'))!;
          const day = (await card
            .getByRole('link', { name: /^\d{2}\/\d{2}\/\d{4}$/ })
            .getAttribute('href'))!;
          seen.push(`${day}${model}`);
        }
        const older = region(page, 'Decisões').getByRole('link', { name: 'Mais antigas' });
        if ((await older.count()) === 0) break;
        const before = page.url();
        await older.click();
        await expect(page).not.toHaveURL(before);
        await expect(filter(page).getByRole('link', { name: action, exact: true })).toHaveAttribute(
          'aria-current',
          'true',
        );
      }
      // o total e a ordem são os da api, sem linha repetida entre as páginas
      expect(seen).toEqual(all.rows.map((r) => `/ciclos/${r.date}/modelos/${r.competitor.slug}`));
      expect(new Set(seen).size).toBe(seen.length);

      await filter(page).getByRole('link', { name: 'Todas' }).click();
      await expect(page).not.toHaveURL(/filtro=/);
    });
  }

  test('um filtro que não existe é ignorado, e um cursor torto é 404 (nunca 500)', async ({
    page,
  }) => {
    const ignored = await page.goto('/arena?filtro=hold');
    expect(ignored?.status()).toBe(200);
    await expect(filter(page).getByRole('link', { name: 'Todas' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // o modelo que não tem a forma de um slug também é ignorado
    expect((await page.goto('/arena?modelo=%00'))?.status()).toBe(200);
    await expect(region(page, 'Decisões').getByRole('article')).toHaveCount(FEED_PAGE);
    const bad = await page.goto('/arena?cursor=%00%00');
    expect(bad?.status()).toBe(404);
    const forged = await page.goto('/arena?cursor=AAAA');
    expect(forged?.status()).toBe(404);
  });

  // O feed era da home, e o `/?filtro=` e o `/?cursor=` de antes (links guardados, buscadores) levam ao mesmo feed na /arena, com 308 (o
  // src/proxy.ts, depois da trava de origem), e o `#feed` o navegador mantém.
  test('o /?filtro= e o /?cursor= de antes levam à /arena com 308, e a âncora fica', async ({
    page,
    request,
  }) => {
    for (const [from, to] of [
      ['/?filtro=SELL', '/arena?filtro=SELL'],
      ['/?cursor=AAAA', '/arena?cursor=AAAA'],
      ['/?filtro=BUY&cursor=AAAA', '/arena?filtro=BUY&cursor=AAAA'],
    ] as const) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(308);
      expect(new URL(response.headers()['location']!, 'http://x').pathname, from).toBe('/arena');
      expect(new URL(response.headers()['location']!, 'http://x').search, from).toBe(
        to.slice('/arena'.length),
      );
    }
    // a / sem o filtro é a landing, sem redirecionar
    expect((await request.get('/', { maxRedirects: 0 })).status()).toBe(200);
    await page.goto('/?filtro=SELL#feed');
    await expect(page).toHaveURL(/\/arena\?filtro=SELL#feed$/);
    await expect(filter(page).getByRole('link', { name: 'SELL', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

// O filtro do feed por modelo (o "Funds ▾" do Rallies; plano, c.4): um `details` com um link por modelo, sem JavaScript. Junta-se ao filtro
// por ação, e a paginação segue os dois.
test.describe('filtro do feed por modelo', () => {
  test('só as decisões do modelo, na ordem da api, e o filtro por ação junto', async ({
    page,
    request,
  }) => {
    const name = 'GPT-6.1 Sol';
    const all = await fetchApi(
      request,
      `/decisions?competitor=${MODEL}&limit=100`,
      decisionsPageSchema,
    );
    // no banco do e2e (5 pregões) o modelo tem uma página de decisões; o link "Mais antigas" com os dois filtros e o cursor é do teste de
    // unidade da página (app/(app)/(arena)/arena/page.spec.tsx). O laço abaixo segue as páginas que houver.
    expect(all.rows.length).toBeGreaterThan(0);
    await page.goto('/arena');
    const byModel = page.getByRole('navigation', { name: 'Filtrar por modelo' });
    await byModel.locator('summary').click();
    await byModel.getByRole('link', { name: new RegExp(`^${name.replace('.', '\\.')}`) }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]modelo=${MODEL}(&|#|$)`));
    await expect(byModel.locator('summary')).toHaveText(new RegExp(`^${name.replace('.', '\\.')}`));

    const seen: string[] = [];
    for (;;) {
      const cards = region(page, 'Decisões').getByRole('article');
      const n = await cards.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i += 1) {
        const card = cards.nth(i);
        await expect(card.getByRole('link').first()).toHaveAttribute('href', `/modelos/${MODEL}`);
        seen.push(
          (await card.getByRole('link', { name: /^\d{2}\/\d{2}\/\d{4}$/ }).getAttribute('href'))!,
        );
      }
      const older = region(page, 'Decisões').getByRole('link', { name: 'Mais antigas' });
      if ((await older.count()) === 0) break;
      const before = page.url();
      await older.click();
      await expect(page).not.toHaveURL(before);
      await expect(page).toHaveURL(new RegExp(`modelo=${MODEL}`));
    }
    expect(seen).toEqual(all.rows.map((r) => `/ciclos/${r.date}`));

    // o filtro por ação mantém o modelo, e "Todos os modelos" o tira
    const sells = await fetchApi(
      request,
      `/decisions?competitor=${MODEL}&action=SELL&limit=100`,
      decisionsPageSchema,
    );
    await page
      .getByRole('navigation', { name: 'Filtrar decisões' })
      .getByRole('link', { name: 'SELL', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`filtro=SELL&modelo=${MODEL}`));
    await expect(region(page, 'Decisões').getByRole('article')).toHaveCount(
      Math.min(FEED_PAGE, sells.rows.length),
    );
    await byModel.locator('summary').click();
    await byModel.getByRole('link', { name: 'Todos os modelos' }).click();
    await expect(page).not.toHaveURL(/modelo=/);
    await expect(page).toHaveURL(/filtro=SELL/);
  });
});

// O filtro é um link, então funciona sem JavaScript (o servidor monta a página).
test.describe('filtro do feed sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const action of ['BUY', 'SELL', 'HOLD'] as const) {
    test(`${action}: o filtro e todas as páginas de "Mais antigas" são links, e a lista é a da api`, async ({
      page,
      request,
    }) => {
      const all = await fetchApi(
        request,
        `/decisions?action=${action}&limit=100`,
        decisionsPageSchema,
      );
      await page.goto('/arena');
      await page
        .getByRole('navigation', { name: 'Filtrar decisões' })
        .getByRole('link', { name: action, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`filtro=${action}`));

      // percorre "Mais antigas" até acabar, e confere o total e a ordem com os da api
      const seen: string[] = [];
      let pages = 0;
      for (;;) {
        pages += 1;
        const cards = region(page, 'Decisões').getByRole('article');
        const n = await cards.count();
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(FEED_PAGE);
        for (let i = 0; i < n; i += 1) {
          const card = cards.nth(i);
          const model = (await card.getByRole('link').first().getAttribute('href'))!;
          const day = (await card
            .getByRole('link', { name: /^\d{2}\/\d{2}\/\d{4}$/ })
            .getAttribute('href'))!;
          seen.push(`${day}${model}`);
        }
        const older = region(page, 'Decisões').getByRole('link', { name: 'Mais antigas' });
        if ((await older.count()) === 0) break;
        const before = page.url();
        await older.click();
        await expect(page).not.toHaveURL(before);
        await expect(page).toHaveURL(new RegExp(`filtro=${action}`));
      }
      expect(seen).toEqual(all.rows.map((r) => `/ciclos/${r.date}/modelos/${r.competitor.slug}`));
      expect(pages).toBe(Math.ceil(all.rows.length / FEED_PAGE));
    });
  }
});

test.describe('ranking', () => {
  test('a tabela completa separa modelos, Sorteio e referências, com todas as métricas', async ({
    page,
    request,
  }) => {
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    await page.goto('/ranking');
    await expect(page.getByRole('heading', { level: 1, name: 'Ranking' })).toBeVisible();
    await expect(page).toHaveTitle('Ranking · Alvesting');

    const groups = [
      ['Modelos', ['MODEL']],
      ['Sorteio (controle)', ['RANDOM']],
      ['Referências', ['EQUAL_WEIGHT', 'CDI', 'BOVA11']],
    ] as const;
    for (const [name, types] of groups) {
      const group = region(page, name);
      const rows = board.rows.filter((r) =>
        (types as readonly string[]).includes(r.competitor.type),
      );
      expect(rows.length, name).toBeGreaterThan(0);
      await expect(group.getByRole('columnheader')).toHaveText([
        'Pos.',
        'Competidor',
        'Retorno',
        'Percentil',
        'Patrimônio',
        'vs igual-peso',
        'vs CDI',
        'Drawdown',
        'Acerto',
        'Operações',
        'Custo LLM',
      ]);
      await expect(group.getByRole('row')).toHaveCount(1 + rows.length);
      for (const r of rows) {
        await expect(rowOf(group, shownName(r.competitor)).locator('th, td')).toHaveText(
          fullCells(r),
        );
        await expect(rowOf(group, shownName(r.competitor)).getByRole('link')).toHaveAttribute(
          'href',
          `/modelos/${r.competitor.slug}`,
        );
        // o retorno leva o glifo da direção (▲ ▼ ■), desenhado pelo CSS antes do número: fora do texto, que a comparação acima lê por igualdade
        const glyph = r.returnBps > 0 ? '▲' : r.returnBps < 0 ? '▼' : '■';
        const returnCell = rowOf(group, shownName(r.competitor)).locator('td').nth(1);
        await expect(returnCell).toHaveAttribute(
          'data-dir',
          r.returnBps > 0 ? 'up' : r.returnBps < 0 ? 'down' : 'flat',
        );
        expect(
          await returnCell.evaluate((cell) => getComputedStyle(cell, '::before').content),
        ).toContain(glyph);
      }
    }
    // a posição é a geral (entre todos, por retorno), então a primeira linha dos modelos não precisa ser a 1ª
    expect(board.rows.map((r) => r.rank)).toEqual(board.rows.map((_, i) => i + 1));
    await expect(page.getByText('BOVA11 inclui proventos', { exact: false })).toBeVisible();
  });
});

// A arena simulada, até a integração (docs/ARENA.md, seções 1 e 8): o elenco é o da Temporada 1 e as decisões vêm do provedor fake. A tela
// marca cada modelo com a etiqueta "simulado" e a arena avisa; com o provedor de verdade, a etiqueta e o aviso somem sozinhos.
test.describe('arena simulada', () => {
  test('a arena avisa que as decisões são simuladas, e a faixa traz os seis do elenco, cada um com a etiqueta', async ({
    page,
    request,
  }) => {
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    const models = board.rows.filter((r) => r.competitor.type === 'MODEL');
    expect(models.map((r) => r.competitor.name).sort()).toEqual([...CAST].sort());
    expect(models.every((r) => r.competitor.provider === 'fake')).toBe(true);

    await page.goto('/arena');
    await expect(
      page.getByText('Decisões simuladas: os modelos ainda não estão conectados.'),
    ).toBeVisible();
    const ranking = region(page, 'Ranking');
    for (const name of CAST) {
      const item = ranking.getByRole('listitem').filter({ hasText: name });
      await expect(item).toHaveCount(1);
      // a etiqueta vem logo depois do nome, como em toda tela
      await expect(item).toContainText(`${name} ${SIMULATED}`);
      await expect(item.getByText(SIMULATED, { exact: true })).toBeVisible();
    }
    // o Sorteio não é modelo: fica sem etiqueta
    const draw = ranking.getByRole('listitem').filter({ hasText: 'Sorteio' });
    await expect(draw).toHaveCount(1);
    await expect(draw.getByText(SIMULATED, { exact: true })).toHaveCount(0);
    await expect(ranking.getByText(SIMULATED, { exact: true })).toHaveCount(CAST.length);
    // e as carteiras também: os seis, cada um com a etiqueta
    await expect(region(page, 'Carteiras').getByText(SIMULATED, { exact: true })).toHaveCount(
      CAST.length,
    );
  });

  test('o ranking completo marca só os modelos: o Sorteio e as referências ficam sem etiqueta', async ({
    page,
  }) => {
    await page.goto('/ranking');
    await expect(region(page, 'Modelos').getByText(SIMULATED, { exact: true })).toHaveCount(
      CAST.length,
    );
    for (const name of ['Sorteio (controle)', 'Referências']) {
      await expect(region(page, name).getByText(SIMULATED, { exact: true })).toHaveCount(0);
    }
  });
});

// O Explorar (plano, f.1), no desenho do Discover: um cartão por competidor (conferido contra o ranking e as carteiras), o universo da
// semana (contra a fita da rota interna, como o site a lê), a busca e a barra "Explorar".
test.describe('explorar', () => {
  test('um cartão por competidor, com o retorno do ranking e as posições da carteira (só os modelos)', async ({
    page,
    request,
  }) => {
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    await page.goto('/explorar');
    await expect(page).toHaveTitle('Explorar · Alvesting');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Explore as carteiras da arena' }),
    ).toBeVisible();
    const groups = [
      ['Modelos', board.rows.filter((r) => r.competitor.type === 'MODEL')],
      ['Controle e referências', board.rows.filter((r) => r.competitor.type !== 'MODEL')],
    ] as const;
    for (const [name, rows] of groups) {
      expect(rows.length, name).toBeGreaterThan(0);
      const cards = region(page, name).getByRole('listitem');
      await expect(cards).toHaveCount(rows.length);
      for (const [i, r] of rows.entries()) {
        const card = cards.nth(i);
        await expect(card.getByRole('link')).toHaveAttribute(
          'href',
          `/modelos/${r.competitor.slug}`,
        );
        await expect(card).toContainText(shownName(r.competitor));
        await expect(fact(card, 'Retorno')).toHaveText(pct(r.returnBps));
        if (r.competitor.type === 'MODEL') {
          const detail = await fetchApi(
            request,
            `/competitors/${r.competitor.slug}`,
            competitorDetailSchema,
          );
          await expect(fact(card, 'Posições')).toHaveText(
            String(detail.portfolio!.holdings!.positions.length),
          );
        } else {
          // o Sorteio e as referências não têm composição pública (ADR 0033)
          await expect(fact(card, 'Posições')).toHaveText('—');
        }
      }
    }
  });

  test('o universo da semana: os papéis da fita, com o fechamento, a variação e o crédito', async ({
    page,
    request,
  }) => {
    const tape = await fetchTape(request);
    expect(tape.rows.length).toBeGreaterThan(0);
    await page.goto('/explorar');
    const universe = region(page, 'Universo da semana');
    await expect(universe).toContainText(`fechamento do pregão de ${dmy(tape.date!)}`);
    await expect(universe).toContainText('Cotações: brapi.dev');
    const items = universe.getByRole('listitem');
    await expect(items).toHaveText(
      tape.rows.map((row) => {
        const change =
          row.previousCloseCents !== null && row.previousCloseCents > 0
            ? `(${pct(Math.round(((row.closeCents - row.previousCloseCents) * 10_000) / row.previousCloseCents))})`
            : '(sem o anterior)';
        return `${row.ticker} ${brl(row.closeCents)} ${change}`;
      }),
      { useInnerText: true },
    );
    for (const [i, row] of tape.rows.entries()) {
      await expect(items.nth(i).getByRole('link')).toHaveAttribute('href', `/acoes/${row.ticker}`);
    }
  });

  test('a busca leva à busca de ações, e a barra lista os competidores pelo retorno', async ({
    page,
    request,
  }) => {
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    await page.goto('/explorar');
    await page.getByLabel('Buscar ação pelo ticker ou pelo nome').fill('MO');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(page).toHaveURL(/\/acoes\?q=MO$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ações' })).toBeVisible();

    // a barra das telas da área (aqui, a da busca de ações): os populares abertos, na ordem do ranking, e os grupos
    const bar = page.getByRole('navigation', { name: 'Explorar', exact: true });
    await expect(bar.locator('details')).toHaveAttribute('open', '');
    const popular = bar.locator('details li');
    await expect(popular).toHaveCount(board.rows.length);
    for (const [i, r] of board.rows.entries()) {
      await expect(popular.nth(i).getByRole('link')).toHaveAttribute(
        'href',
        `/modelos/${r.competitor.slug}`,
      );
      await expect(popular.nth(i).locator('[data-dir]')).toHaveText(pct(r.returnBps));
    }
    for (const [name, href] of [
      ['Modelos', '/explorar#modelos'],
      ['Controle e referências', '/explorar#referencias'],
      ['Ações', '/acoes'],
      ['Notícias', '/noticias'],
    ] as const) {
      await expect(bar.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
  });
});

test.describe('modelo', () => {
  test('mostra o provedor e o ID, o resultado, a carteira, a série e as decisões', async ({
    page,
    request,
  }) => {
    const detail = await fetchApi(request, `/competitors/${MODEL}`, competitorDetailSchema);
    const baseline = await fetchApi(
      request,
      `/seasons/${SEASON}/random-baseline`,
      randomBaselineSchema,
    );
    const stat = detail.stat!;
    const portfolio = detail.portfolio!;
    await page.goto(`/modelos/${MODEL}`);
    await expect(page).toHaveTitle(`${detail.competitor.name} · Alvesting`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(shownName(detail.competitor));
    await expect(fact(page.locator('main'), 'Provedor')).toHaveText(detail.competitor.provider!);
    // o ensaio decide pelo provedor fake: o ID é a estratégia simulada que decide no lugar do modelo
    expect(detail.competitor.provider).toBe('fake');
    await expect(fact(page.locator('main'), 'Estratégia simulada')).toHaveText(
      detail.competitor.modelId!,
    );
    await expect(page.locator('dt:text-is("Modelo (ID)")')).toHaveCount(0);
    await expect(
      page.getByRole('main').getByText('Decisões simuladas: o modelo ainda não está conectado.'),
    ).toBeVisible();

    const result = region(page, 'Resultado');
    await expect(fact(result, 'Posição')).toHaveText(String(stat.rank));
    await expect(fact(result, 'Patrimônio')).toHaveText(brl(stat.equityCents));
    await expect(fact(result, 'Retorno')).toHaveText(pct(stat.returnBps));
    await expect(fact(result, 'Percentil')).toHaveText(pctl(stat.percentileBps!));
    await expect(fact(result, 'Drawdown máximo')).toHaveText(pct(stat.maxDrawdownBps, false));
    await expect(fact(result, 'Operações')).toHaveText(String(stat.trades));
    await expect(fact(result, 'Acerto')).toContainText(
      `${pct(stat.winRateBps!, false)} (${stat.winningSells}/${stat.sells})`,
    );

    // a composição da carteira (caixa e posições) é do modelo: o Sorteio e as referências não a trazem (o teste de baixo)
    const holdings = portfolio.holdings!;
    const wallet = region(page, `Carteira em ${dmy(portfolio.date)}`);
    await expect(fact(wallet, 'Caixa')).toHaveText(brl(holdings.cashCents));
    await expect(fact(wallet, 'Em ações')).toHaveText(brl(holdings.positionsValueCents));
    await expect(fact(wallet, 'Patrimônio')).toHaveText(brl(portfolio.equityCents));
    await expect(wallet.getByRole('columnheader')).toHaveText([
      'Ação',
      'Valor',
      'Resultado',
      'Quantidade',
      'Preço médio',
    ]);
    await expect(wallet.getByRole('row')).toHaveCount(1 + holdings.positions.length);
    for (const p of holdings.positions) {
      const row = rowOf(wallet, p.ticker);
      await expect(row.getByRole('link')).toHaveAttribute('href', `/acoes/${p.ticker}`);
      const cells = row.getByRole('cell');
      // as colunas: valor, resultado, quantidade e preço médio (a ação é o cabeçalho da linha)
      await expect(cells.nth(0)).toContainText(brl(p.valueCents));
      if (p.stale) await expect(cells.nth(0)).toContainText('sem negócio no dia');
      await expect(cells.nth(1)).toHaveText(`${p.pnlCents > 0 ? '+' : ''}${brl(p.pnlCents)}`);
      await expect(cells.nth(2)).toHaveText(String(p.quantity).replace(/\B(?=(\d{3})+$)/g, '.'));
      await expect(cells.nth(3)).toHaveText(brl(p.avgPriceCents));
    }

    const chart = region(page, 'Patrimônio');
    await expect(chart.getByRole('img', { name: /Patrimônio/ })).toBeVisible();
    // a tabela da série: todas as linhas (a data, o patrimônio do modelo e a faixa p5 a p95 do dia), e não só a última
    const table = chart.getByRole('table', { name: /dados do gráfico/i });
    await expect(table.getByRole('row')).toHaveCount(1 + detail.series.dates.length);
    for (const [i, date] of detail.series.dates.entries()) {
      const band = baseline.rows.find((r) => r.date === date)!;
      const cells = await table
        .getByRole('row')
        .nth(i + 1)
        .locator('th, td')
        .allInnerTexts();
      expect(cells.map(clean), date).toEqual([
        dmy(date),
        brl(detail.series.equityCents[i]!),
        brl(band.equityCents.p5),
        brl(band.equityCents.p95),
      ]);
    }

    // as decisões, uma a uma: o título é a data do ciclo, que leva ao ciclo
    const cards = region(page, 'Decisões').getByRole('article');
    await expect(cards).toHaveCount(detail.decisions.length);
    for (const [i, d] of detail.decisions.entries()) {
      await expectCard(cards.nth(i), d, { by: 'date', date: d.date });
    }
  });

  test('o Sorteio e as referências também têm página, sem provedor', async ({ page }) => {
    await page.goto('/modelos/sorteio');
    await expect(page.getByRole('heading', { level: 1, name: 'Sorteio' })).toBeVisible();
    await expect(page.locator('dt:text-is("Provedor")')).toHaveCount(0);
    await expect(page.getByText('não decide', { exact: false })).toBeVisible();
  });

  // O igual-peso segura o universo inteiro e o BOVA11 um papel só: a lista de papéis deles seria o fechamento de todo papel, todo pregão (a
  // base bruta que a licença da brapi proíbe entregar; docs/API.md, seção 6; ADR 0033). O Sorteio e as referências mostram só o patrimônio.
  test('o Sorteio e as referências mostram só o patrimônio da carteira, sem caixa, posições nem tabela', async ({
    page,
    request,
  }) => {
    for (const slug of ['sorteio', 'igual-peso', 'bova11', 'cdi']) {
      const detail = await fetchApi(request, `/competitors/${slug}`, competitorDetailSchema);
      const portfolio = detail.portfolio!;
      expect(portfolio.holdings, slug).toBeNull();
      await page.goto(`/modelos/${slug}`);
      const wallet = region(page, `Carteira em ${dmy(portfolio.date)}`);
      await expect(fact(wallet, 'Patrimônio')).toHaveText(brl(portfolio.equityCents));
      await expect(wallet.locator('dt:text-is("Caixa")')).toHaveCount(0);
      await expect(wallet.locator('dt:text-is("Em ações")')).toHaveCount(0);
      await expect(wallet.getByRole('table')).toHaveCount(0);
      await expect(wallet).toContainText('mostram só o patrimônio');
      // nenhum papel da carteira vira link para a página da ação, em lugar nenhum da página
      await expect(page.getByRole('main').locator('a[href^="/acoes/"]')).toHaveCount(0);
    }
  });
});

test.describe('ciclo', () => {
  test('mostra os horários de Brasília, a versão e o SHA-256 do prompt (nunca o texto), o do briefing e as decisões', async ({
    page,
    request,
  }) => {
    const cycle = await fetchApi(request, `/cycles/${CYCLE_DAY}`, cycleViewSchema);
    await page.goto(`/ciclos/${CYCLE_DAY}`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Ciclo de ${dmy(CYCLE_DAY)}` }),
    ).toBeVisible();

    const times = region(page, 'Horários');
    await expect(fact(times, 'Situação')).toHaveText('Fechado');
    await expect(fact(times, 'Decisão')).toHaveText(brt(cycle.decisionAt).slice(11));
    await expect(fact(times, 'Prazo')).toHaveText(brt(cycle.deadlineAt).slice(11));
    // o fechamento leva os segundos (a hora em que o último modelo respondeu)
    await expect(fact(times, 'Fechamento')).toHaveText(brt(cycle.closedAt!, true).slice(11));

    const hashes = region(page, 'Prompt e briefing');
    await expect(fact(hashes, 'Versão do prompt')).toHaveText(cycle.prompt!.version);
    await expect(fact(hashes, 'SHA-256 do prompt')).toHaveText(cycle.prompt!.sha256!);
    await expect(fact(hashes, 'SHA-256 do briefing')).toHaveText(cycle.briefing!.sha256);
    await expect(hashes).toContainText('oculto');

    const cards = region(page, 'Decisões').getByRole('article');
    await expect(cards).toHaveCount(cycle.decisions.length);
    for (const [i, d] of cycle.decisions.entries()) {
      await expectCard(cards.nth(i), d, {
        by: 'model',
        simulated: d.applied?.provider === 'fake',
      });
    }
    // o canário do ensaio e o texto do prompt não existem em página nenhuma
    const html = await page.content();
    expect(html).not.toContain('alv-canary');
    expect(html).not.toContain('Texto sintético do ensaio');
  });

  test('ciclo que não existe é 404', async ({ page }) => {
    expect((await page.goto('/ciclos/2020-01-01'))?.status()).toBe(404);
    expect((await page.goto('/ciclos/2026-02-30'))?.status()).toBe(404);
  });
});

test.describe('notícias', () => {
  test('lista título, fonte, hora e tickers, com o link externo seguro e sem o trecho', async ({
    page,
    request,
  }) => {
    const first = await fetchApi(request, '/news?limit=20', newsPageSchema);
    await page.goto('/noticias');
    await expect(page.getByRole('heading', { level: 1, name: 'Notícias' })).toBeVisible();
    const items = page.getByRole('list', { name: 'Notícias' }).getByRole('listitem');
    await expect(items).toHaveCount(first.rows.length);
    for (const [i, n] of first.rows.entries()) {
      const item = items.nth(i);
      const links = item.getByRole('link');
      // o título (com a dica de nova aba, que só o leitor de tela ouve) e depois cada ticker: por igualdade, na ordem da api
      await expect(links).toHaveText([`${n.title} (abre em outra aba)`, ...n.tickers]);
      const link = links.first();
      await expect(link).toHaveAttribute('href', n.url);
      await expect(link).toHaveAttribute('target', '_blank');
      const rel = (await link.getAttribute('rel'))!.split(/\s+/);
      expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer', 'nofollow']));
      for (const [j, ticker] of n.tickers.entries()) {
        await expect(links.nth(j + 1)).toHaveAttribute('href', `/acoes/${ticker}`);
      }
      // a fonte e a hora, uma linha só
      await expect(
        item.getByText(`${n.sourceName} · ${newsStamp(n)}`, { exact: true }),
      ).toBeVisible();
    }
    expect(await page.content()).not.toContain('Texto sintético do ensaio');
  });

  test('o filtro por ticker é um formulário GET: filtra, pagina e limpa', async ({
    page,
    request,
  }) => {
    const ticker = TICKER;
    const filtered = await fetchApi(request, `/news?ticker=${ticker}&limit=20`, newsPageSchema);
    expect(filtered.rows.length).toBeGreaterThan(0);
    await page.goto('/noticias');
    await page.getByLabel('Ticker').fill(ticker);
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(new RegExp(`/noticias\\?ticker=${ticker}$`));
    const items = page.getByRole('list', { name: 'Notícias' }).getByRole('listitem');
    await expect(items).toHaveCount(filtered.rows.length);
    await expect(items.first().getByRole('link', { name: filtered.rows[0]!.title })).toBeVisible();
    for (const text of await items.allInnerTexts()) expect(text).toContain(ticker);

    // o ticker em minúsculas na URL vale o mesmo
    await page.goto(`/noticias?ticker=${ticker.toLowerCase()}`);
    await expect(items).toHaveCount(filtered.rows.length);

    // "Limpar filtro" é uma navegação suave: o que o leitor digitou no campo não pode sobreviver a ela, com a lista já sem filtro
    await page.getByLabel('Ticker').fill('XYZ9');
    await page.getByRole('link', { name: 'Limpar filtro' }).click();
    await expect(page).toHaveURL(/\/noticias$/);
    await expect(page.getByLabel('Ticker')).toHaveValue('');
  });

  test('a paginação por cursor continua de onde parou, sem repetir', async ({ page, request }) => {
    const first = await fetchApi(request, '/news?limit=20', newsPageSchema);
    expect(first.nextCursor).not.toBeNull();
    const second = await fetchApi(
      request,
      `/news?limit=20&cursor=${first.nextCursor}`,
      newsPageSchema,
    );
    await page.goto('/noticias');
    await page.getByRole('link', { name: 'Mais antigas' }).click();
    await expect(page).toHaveURL(/cursor=/);
    const items = page.getByRole('list', { name: 'Notícias' }).getByRole('listitem');
    await expect(items).toHaveCount(second.rows.length);
    await expect(items.first().getByRole('link', { name: second.rows[0]!.title })).toBeVisible();
  });

  test('ticker torto é dito ao leitor, sem erro; cursor torto é 404', async ({ page }) => {
    const response = await page.goto('/noticias?ticker=abc%21');
    expect(response?.status()).toBe(200);
    // o anunciador de rotas do Next também tem role=alert: filtra pelo texto
    await expect(page.getByRole('alert').filter({ hasText: 'Ticker inválido' })).toBeVisible();
    expect((await page.goto('/noticias?cursor=%00'))?.status()).toBe(404);
  });
});

test.describe('ação', () => {
  test('mostra as barras em SVG com descrição, quem tem a ação, as decisões e as notícias', async ({
    page,
    request,
  }) => {
    const stock = await fetchApi(request, `/stocks/${TICKER}`, stockDetailSchema);
    // as barras não vêm da API pública (docs/API.md, seção 6): o teste as lê da rota interna, como o site
    expect(stock).not.toHaveProperty('bars');
    const bars = await fetchBars(request, TICKER);
    expect(bars.length).toBeGreaterThan(30);
    await page.goto(`/acoes/${TICKER}`);
    await expect(page).toHaveTitle(`${TICKER} · Alvesting`);
    await expect(page.getByRole('heading', { level: 1, name: TICKER })).toBeVisible();
    await expect(page.getByText(stock.name, { exact: true })).toBeVisible();

    // barras recentes: SVG com título e descrição, uma vela por barra; o texto resume a série
    const quotes = region(page, 'Cotações recentes');
    const chart = quotes.getByRole('img', { name: new RegExp(TICKER) });
    await expect(chart.locator('title')).toHaveCount(1);
    await expect(chart.locator('g[data-candle]')).toHaveCount(bars.length);
    const first = bars[0]!;
    const lastBar = bars.at(-1)!;
    const summary = quotes.getByTestId('resumo-barras');
    await expect(summary).toContainText(
      `${bars.length} pregões, de ${dmy(first.date)} a ${dmy(lastBar.date)}`,
    );
    await expect(summary).toContainText(
      `de ${brl(first.closeCents)} para ${brl(lastBar.closeCents)}`,
    );
    await expect(summary).toContainText(
      `mínima de ${brl(Math.min(...bars.map((b) => b.lowCents)))}`,
    );
    await expect(summary).toContainText(
      `máxima de ${brl(Math.max(...bars.map((b) => b.highCents)))}`,
    );
    await expect(quotes).toContainText(`Cotações: brapi.dev, pregão de ${dmy(lastBar.date)}`);
    // sem tabela de preços: o desenho e o resumo em texto bastam (docs/API.md, seção 6)
    await expect(
      page.getByRole('columnheader', { name: /abertura|fechamento|máxima|mínima|cotação/i }),
    ).toHaveCount(0);

    // só os modelos: o igual-peso também tem a ação, e a lista dos donos não pode entregar a marcação do universo (ADR 0033)
    expect(stock.holders.length).toBeGreaterThan(0);
    expect(stock.holders.every((h) => h.competitor.type === 'MODEL')).toBe(true);
    const holders = region(page, 'Quem tem a ação');
    await expect(holders.getByRole('row')).toHaveCount(1 + stock.holders.length);
    for (const h of stock.holders) {
      const cells = rowOf(holders, shownName(h.competitor)).getByRole('cell');
      await expect(cells.nth(0)).toContainText(brl(h.valueCents));
      await expect(cells.nth(1)).toHaveText(`${h.pnlCents > 0 ? '+' : ''}${brl(h.pnlCents)}`);
      await expect(cells.nth(2)).toHaveText(String(h.quantity).replace(/\B(?=(\d{3})+$)/g, '.'));
      await expect(cells.nth(3)).toHaveText(brl(h.avgPriceCents));
    }

    // cada decisão sobre a ação, por igualdade: a data, o modelo, a ação (BUY e SELL não se confundem), o percentual, a confiança e a justificativa
    const decisions = region(page, 'Decisões dos modelos').getByRole('listitem');
    expect(stock.decisions.length).toBeGreaterThan(0);
    await expect(decisions).toHaveText(stock.decisions.map(stockDecisionText), {
      useInnerText: true,
    });
    for (const [i, d] of stock.decisions.entries()) {
      await expect(decisions.nth(i).getByRole('link').nth(0)).toHaveAttribute(
        'href',
        `/ciclos/${d.date}`,
      );
      await expect(decisions.nth(i).getByRole('link').nth(1)).toHaveAttribute(
        'href',
        `/modelos/${d.competitor.slug}`,
      );
    }

    // as notícias da ação: título, fonte e hora de cada uma (a da CVM só com o dia)
    const news = region(page, 'Notícias');
    const newsItems = news.getByRole('list', { name: 'Notícias' }).getByRole('listitem');
    await expect(newsItems).toHaveCount(stock.news.length);
    for (const [i, n] of stock.news.entries()) {
      await expect(newsItems.nth(i).getByRole('link').first()).toHaveText(
        `${n.title} (abre em outra aba)`,
      );
      await expect(
        newsItems.nth(i).getByText(`${n.sourceName} · ${newsStamp(n)}`, { exact: true }),
      ).toBeVisible();
    }
    expect(stock.news.some((n) => n.source.startsWith('cvm'))).toBe(true);
    await expect(
      news.getByRole('link', { name: `Todas as notícias de ${TICKER}` }),
    ).toHaveAttribute('href', `/noticias?ticker=${TICKER}`);
  });

  test('a busca acha pelo ticker ou pelo nome e leva à página da ação', async ({
    page,
    request,
  }) => {
    const found = await fetchApi(request, '/stocks?q=MO', stockSearchSchema);
    expect(found.rows.map((r) => r.ticker)).toContain(TICKER);
    await page.goto(`/acoes/${TICKER}`);
    await page.getByLabel('Buscar outra ação').fill('MO');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page).toHaveURL(/\/acoes\?q=MO$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ações' })).toBeVisible();
    // a lista inteira, na ordem da api: ticker e nome de cada resultado, por igualdade
    await expect(
      page.getByRole('list', { name: 'Resultados da busca' }).getByRole('listitem'),
    ).toHaveText(
      found.rows.map((r) => `${r.ticker} ${r.name}`),
      { useInnerText: true },
    );
    await page.getByRole('link', { name: TICKER, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/acoes/${TICKER}$`));

    await page.goto('/acoes?q=zzzz');
    await expect(page.getByText('Nenhuma ação encontrada')).toBeVisible();
    await page.goto('/acoes');
    await expect(page.getByRole('button', { name: 'Buscar' })).toBeVisible();
  });

  test('o ticker em minúsculas vale, e o que não existe é 404', async ({ page }) => {
    await page.goto(`/acoes/${TICKER.toLowerCase()}`);
    await expect(page.getByRole('heading', { level: 1, name: TICKER })).toBeVisible();
    expect((await page.goto('/acoes/ZZZZ3'))?.status()).toBe(404);
    expect((await page.goto('/acoes/abc!'))?.status()).toBe(404);
  });
});

test.describe('como funciona', () => {
  test('traz as regras, o prompt oculto com o hash publicado, o Sorteio, o Monte Carlo, as referências, as fontes e as limitações', async ({
    page,
    request,
  }) => {
    const current = await fetchApi(request, '/arena/current', arenaCurrentSchema);
    const params = current.season!.params;
    await page.goto('/como-funciona');
    await expect(page.getByRole('heading', { level: 1, name: 'Como funciona' })).toBeVisible();
    for (const name of [
      'Regras da temporada',
      'O prompt oculto',
      'Igualdade das entradas',
      'Sorteio e Monte Carlo',
      'Referências',
      'De onde vêm os dados',
      'Limitações',
      'Aviso',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    const rules = region(page, 'Regras da temporada');
    await expect(fact(rules, 'Capital')).toContainText(brl(params.capitalCents));
    await expect(fact(rules, 'Duração')).toContainText(`${params.sessions} pregões`);
    await expect(fact(rules, 'Custo')).toContainText('0,03%');
    await expect(fact(rules, 'Decisão')).toContainText(`${params.decisionTimeBrt} (Brasília)`);
    await expect(fact(rules, 'Decisão')).toContainText(params.deadlineTimeBrt);

    const prompt = region(page, 'O prompt oculto');
    await expect(prompt).toContainText(current.lastCycle!.prompt!.version);
    await expect(prompt).toContainText(current.lastCycle!.prompt!.sha256!);
    await expect(prompt).not.toContainText('alv-canary');
    await expect(region(page, 'Sorteio e Monte Carlo')).toContainText(
      `${params.monteCarloRuns.toLocaleString('pt-BR')} carteiras`,
    );
    await expect(region(page, 'Aviso')).toContainText('não é recomendação de investimento');
  });
});

test.describe('404', () => {
  // O "%" que não é percent-encoding derrubava a decodificação do parâmetro no Next (500, sem corpo e sem log): o proxy o recusa antes
  // (src/proxy.ts), e um scanner que bate nisso não vira alerta de 5xx.
  test('percent-encoding inválido no caminho é 404, nunca 500', async ({ request }) => {
    for (const path of [
      '/acoes/%',
      '/modelos/%',
      '/ciclos/%',
      '/acoes/%zz',
      '/modelos/a%E0%A4%A',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()['cache-control'], path).toBe('no-store');
    }
    // "%25" é um "%" bem escrito: a rota decodifica, e o slug que sobra não existe (404 da página)
    expect((await request.get('/acoes/%25')).status()).toBe(404);
  });

  test('rota, modelo, ciclo e ação que não existem dizem o que fazer, com status 404', async ({
    page,
  }) => {
    for (const path of [
      '/rota-que-nao-existe',
      '/modelos/nao-existe',
      '/modelos/NAO_EXISTE',
      `/modelos/${'x'.repeat(300)}`,
      '/ciclos/abc',
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
      ).toBeVisible();
      await expect(
        page.getByRole('main').getByRole('link', { name: 'Voltar ao início' }),
      ).toHaveAttribute('href', '/');
      await expect(
        page.getByRole('main').getByRole('link', { name: 'Ver o ranking' }),
      ).toHaveAttribute('href', '/ranking');
      await expect(
        page.getByRole('main').getByRole('link', { name: 'Buscar uma ação' }),
      ).toHaveAttribute('href', '/acoes');
    }
  });
});

test.describe('navegação de ponta a ponta', () => {
  test('arena, modelo, ciclo, ação e notícias, só clicando', async ({ page }) => {
    await page.goto('/arena');
    // arena -> modelo, pela faixa dos modelos (o nome do cartão é o nome, a etiqueta, o retorno e o percentil)
    await region(page, 'Ranking')
      .getByRole('link', { name: /^GPT-6\.1 Sol simulado/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/modelos/${MODEL}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'GPT-6.1 Sol' })).toBeVisible();

    // modelo -> ciclo, pela data de uma decisão
    await region(page, 'Decisões')
      .getByRole('article')
      .first()
      .getByRole('link', { name: /^\d{2}\/\d{2}\/\d{4}$/ })
      .click();
    await expect(page).toHaveURL(/\/ciclos\/2026-11-\d{2}$/);
    await expect(
      page.getByRole('heading', { level: 1, name: /^Ciclo de \d{2}\/\d{2}\/\d{4}$/ }),
    ).toBeVisible();

    // ciclo -> ação, pelo ticker de um item
    const ticker = (
      await region(page, 'Decisões')
        .getByRole('link', { name: /^[A-Z][A-Z0-9]{3}\d{1,2}$/ })
        .first()
        .innerText()
    ).trim();
    await region(page, 'Decisões').getByRole('link', { name: ticker, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/acoes/${ticker}$`));
    await expect(page.getByRole('heading', { level: 1, name: ticker })).toBeVisible();

    // ação -> notícias da ação -> notícias -> a arena (pela navegação da casca do app: o trilho no desktop, a barra de abas no celular) ->
    // o início (pela marca)
    await page.getByRole('link', { name: `Todas as notícias de ${ticker}` }).click();
    await expect(page).toHaveURL(new RegExp(`/noticias\\?ticker=${ticker}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Notícias' })).toBeVisible();
    // na casca do app a navegação está sempre na tela (e2e/menu.ts)
    await abrirMenu(page);
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('link', { name: 'Arena', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Arena' })).toBeVisible();
    await page.getByRole('banner').getByRole('link', { name: 'Alvesting' }).click();
    await expect(page.getByRole('heading', { level: 1, name: HERO_TITLE })).toBeVisible();
  });
});
