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
// o texto de um atributo é comparado byte a byte: o site escreve "R$" e o número com o espaço que não quebra (src/lib/format.ts)
const nb = (text: string) => text.replace(/R\$ /g, 'R$\u00a0');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// as células de uma linha do ranking completo (a ordem das colunas da tabela: as quatro da landing e mais oito). O nome é o inteiro: o curto
// fica à vista e o sufixo de versão vai para o leitor de tela; a "Tendência" é a sparkline, uma imagem sem texto (o resumo vai no nome dela).
const fullCells = (r: LeaderboardRow) => [
  String(r.rank),
  r.competitor.name,
  pct(r.returnBps),
  dash(r.percentileBps, pctl),
  brl(r.equityCents),
  '',
  dash(r.excessEqualWeightBps, pct),
  dash(r.excessCdiBps, pct),
  pct(r.maxDrawdownBps, false),
  r.winRateBps === null ? '—' : `${pct(r.winRateBps, false)} (${r.winningSells}/${r.sells})`,
  String(r.trades),
  usd(r.llmCostMicroUsd),
];

// Um cartão de decisão (o feed da arena, o ciclo e a página do modelo usam o mesmo): o título e o endereço dele, a linha da data e da visão
// de mercado, o resumo do modelo e cada item (ação, ticker, percentual, confiança e justificativa), tudo por IGUALDADE: um dígito, uma
// palavra a mais ou um BUY trocado por SELL reprova. `by`: o que dá o título, o modelo (feed e ciclo) ou a data do ciclo (página do
// modelo); `date`: a data do pregão, quando o cartão a mostra. O "simulado" vai uma vez por contexto (docs/DESIGN.md): no feed e no ciclo, a
// página tem o aviso, e o cartão fica sem a etiqueta (o teste "arena simulada" confere). Cada ordem leva o logo da ação à esquerda do ticker,
// dentro do link (o <img> da rota do site para os dois papéis com logo do seed, o monograma para os outros; ADR 0036). O banco sintético só
// tem decisões DECIDED, e um item descartado só no último pregão (o limite de 10 posições do Qwen3.8 Max, docs/ENSAIO.md): o HOLD forçado e
// os descartados, com o motivo, são de e2e/fixture.spec.ts.
type CardDecision = Pick<FeedDecision, 'summary' | 'marketView' | 'items'> & {
  competitor: { slug: string; name: string };
};
// os papéis com logo no seed do e2e (e2e/logos.spec.ts; apps/api/src/ensaio/synthetic-logos.ts)
const WITH_LOGO = ['MOVE3', 'SINA3'];
async function expectTickerLogo(link: Locator, ticker: string) {
  await expect(link.locator('[data-logo]')).toHaveAttribute(
    'data-logo',
    WITH_LOGO.includes(ticker) ? 'imagem' : 'monograma',
  );
}
async function expectCard(
  card: Locator,
  decision: CardDecision,
  { by, date }: { by: 'model' | 'date'; date?: string },
) {
  const model = { text: decision.competitor.name, href: `/modelos/${decision.competitor.slug}` };
  const day = date ? { text: dmy(date), href: `/ciclos/${date}` } : undefined;
  const title = by === 'model' ? model : day!;
  const heading = card.getByRole('heading', { level: 3 });
  await expect(heading).toHaveText(title.text);
  await expect(heading.getByRole('link')).toHaveAttribute('href', title.href);

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
    await expectTickerLogo(lines.nth(i).getByRole('link'), item.ticker);
  }
  // o ticker na sans, como todo rótulo (a mono é só para hash e código)
  await expect
    .poll(() =>
      card
        .locator('[data-action], a[href^="/acoes/"]')
        .evaluateAll((els) =>
          els
            .filter((el) => /mono/i.test(getComputedStyle(el).fontFamily))
            .map((el) => el.textContent),
        ),
    )
    .toEqual([]);
}

// a hora da notícia como a tela a escreve: o documento da CVM chega só com o dia (a api o guarda à meia-noite de Brasília)
const newsStamp = (n: NewsItem) =>
  n.source.startsWith('cvm') ? brt(n.publishedAt).slice(0, 10) : brt(n.publishedAt);

// A arena (/arena): o conteúdo que era da home, no desenho da Arena do Rallies (ADR 0035). A landing da / não
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

  // O Line Chart da beUI (components/beui/line-chart.tsx): o desenho sai do servidor, as referências começam escondidas (a legenda as mostra,
  // e a linha se desenha), e a tabela escondida tem todas as séries.
  test('o gráfico de patrimônio tem título, descrição, uma tabela com todos os valores e o rótulo no fim de cada linha', async ({
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
    // uma linha por competidor: os modelos e o Sorteio à vista, as referências escondidas; e a faixa p5 a p95 do Monte Carlo
    const drawn = equity.series.filter(
      (s) => s.competitor.type === 'MODEL' || s.competitor.type === 'RANDOM',
    );
    await expect(svg.locator('path[data-series]')).toHaveCount(equity.series.length);
    await expect(svg.locator('g:not([data-oculta]) > path[data-series]')).toHaveCount(drawn.length);
    await expect(svg.locator('path[data-band]')).toHaveCount(1);

    // a tabela equivalente para leitor de tela: uma linha por pregão, uma coluna por série (as escondidas também), mais p5 e p95
    const table = chart.getByRole('table', { name: /dados do gráfico/i });
    await expect(table.getByRole('row')).toHaveCount(1 + equity.dates.length);
    const headers = (await table.getByRole('columnheader').allInnerTexts()).map(clean);
    expect(headers).toEqual([
      'Data',
      ...equity.series.map((s) => s.competitor.name),
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
        ...equity.series.map((s) => brl(s.equityCents[i]!)),
        brl(baseline.rows[i]!.equityCents.p5),
        brl(baseline.rows[i]!.equityCents.p95),
      ]);
    }

    // no fim de cada linha à vista, o logo do laboratório (o Sorteio e as referências, o ícone de cada uma; nenhuma inicial) e o patrimônio
    // final numa pílula; decorativo para o leitor de tela, que tem a tabela. Os rótulos não se encavalam: de cima para baixo, cada um começa
    // depois de o de cima terminar.
    const icone: Record<string, string> = {
      RANDOM: 'sorteio',
      CDI: 'cdi',
      BOVA11: 'bova11',
      EQUAL_WEIGHT: 'igual-peso',
    };
    const boxes: { y: number; height: number }[] = [];
    for (const s of drawn) {
      const label = chart.locator(`[data-rotulo="${s.competitor.slug}"]`);
      await expect(label).toBeVisible();
      await expect(label).toHaveText(brl(s.equityCents.at(-1)!));
      await expect(
        label.locator(
          s.competitor.type === 'MODEL' ? '[data-lab]' : `[data-ref="${icone[s.competitor.type]}"]`,
        ),
      ).toHaveCount(1);
      await expect(label.locator('[data-inicial]')).toHaveCount(0);
      boxes.push((await label.boundingBox())!);
    }
    await expect(chart.locator('ul[aria-hidden="true"] [data-rotulo]')).toHaveCount(drawn.length);
    const sorted = boxes.sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.height - 0.5);
    }
  });

  // A leitura pelo teclado (a peça da beUI): um controle deslizante nativo e invisível sobre o desenho, uma parada de Tab; as setas, o Home e o
  // End andam entre os pregões, o leitor de tela ouve a data e o valor de cada série à vista, e o painel mostra o mesmo; o Esc o fecha.
  test('o gráfico se lê pelo teclado: o controle diz a data e o valor de cada série, e o painel mostra o mesmo', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('desktop'),
      'o teclado é do desktop; o toque tem o teste dele',
    );
    const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
    const shown = equity.series.filter(
      (s) => s.competitor.type === 'MODEL' || s.competitor.type === 'RANDOM',
    );
    const reading = (i: number) =>
      nb(
        [
          dmy(equity.dates[i]!),
          ...shown.map((s) => `${s.competitor.name} ${brl(s.equityCents[i]!)}`),
        ].join('. '),
      );
    await page.goto('/arena');
    const chart = region(page, 'Patrimônio');
    const slider = chart.getByRole('slider', { name: 'Patrimônio por pregão: ler os valores' });
    await expect(slider).toHaveAttribute('aria-valuetext', reading(equity.dates.length - 1));
    // o Tab chega a ele (uma parada só no desenho)
    await chart.getByRole('img', { name: /Patrimônio/ }).scrollIntoViewIfNeeded();
    await slider.focus();
    const panel = chart.getByRole('tooltip');
    await expect(panel).toBeVisible();
    await expect(slider).toHaveAttribute('aria-describedby', (await panel.getAttribute('id'))!);
    await page.keyboard.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', reading(0));
    await expect(panel).toContainText(dmy(equity.dates[0]!));
    for (const s of shown) await expect(panel).toContainText(brl(s.equityCents[0]!));
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', reading(1));
    await expect(panel).toContainText(dmy(equity.dates[1]!));
    await page.keyboard.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', reading(equity.dates.length - 1));
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  // No celular o dedo lê o gráfico: tocar no desenho abre o painel no pregão mais perto do toque.
  test('o gráfico se lê pelo toque no celular: o toque abre o painel do pregão', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('desktop'), 'o toque é do celular');
    const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
    await page.goto('/arena');
    const chart = region(page, 'Patrimônio');
    const slider = chart.getByRole('slider', { name: 'Patrimônio por pregão: ler os valores' });
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    // o primeiro pregão fica na borda esquerda do desenho
    await page.touchscreen.tap(box.x + 4, box.y + box.height / 2);
    const panel = chart.getByRole('tooltip');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(dmy(equity.dates[0]!));
  });

  // O celular não tem Esc: o toque fora da figura e a rolagem da página fecham a leitura (antes o painel ficava cobrindo o gráfico; o QA do
  // fechamento, achado 2, no Pixel 7 e no iPhone 15).
  test('no celular a leitura fecha com o toque fora do gráfico e com a rolagem', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('desktop'), 'o toque é do celular');
    await page.goto('/arena');
    const chart = region(page, 'Patrimônio');
    const slider = chart.getByRole('slider', { name: 'Patrimônio por pregão: ler os valores' });
    const panel = chart.getByRole('tooltip');
    const tapChart = async () => {
      await slider.scrollIntoViewIfNeeded();
      const box = (await slider.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect(panel).toBeVisible();
    };
    await tapChart();
    // o toque fora: no título da seção, acima da figura
    const title = (await page.locator('#patrimonio-titulo').boundingBox())!;
    await page.touchscreen.tap(title.x + 4, title.y + title.height / 2);
    await expect(panel).toHaveCount(0);
    // a rolagem da página
    await tapChart();
    await page.evaluate(() => window.scrollBy(0, 120));
    await expect(panel).toHaveCount(0);
  });

  // A legenda mostra e esconde cada série (a peça da beUI): a referência escondida aparece, com o rótulo do fim, e o eixo se ajusta; o modelo
  // escondido some, e a leitura deixa de falar dele.
  test('a legenda mostra a referência escondida e esconde um modelo', async ({ page, request }) => {
    const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
    const cdi = equity.series.find((s) => s.competitor.type === 'CDI')!;
    const model = equity.series.find((s) => s.competitor.type === 'MODEL')!;
    await page.goto('/arena');
    const chart = region(page, 'Patrimônio');
    const legend = chart.getByRole('list', { name: 'Séries do gráfico' });
    const slider = chart.getByRole('slider', { name: 'Patrimônio por pregão: ler os valores' });
    const show = legend.getByRole('button', { name: cdi.competitor.name, exact: true });
    await expect(show).toHaveAttribute('aria-pressed', 'false');
    await expect(chart.locator(`[data-rotulo="${cdi.competitor.slug}"]`)).toHaveCount(0);
    await show.click();
    await expect(show).toHaveAttribute('aria-pressed', 'true');
    await expect(chart.locator(`[data-rotulo="${cdi.competitor.slug}"]`)).toHaveText(
      brl(cdi.equityCents.at(-1)!),
    );
    await expect(slider).toHaveAttribute(
      'aria-valuetext',
      new RegExp(escape(nb(`CDI ${brl(cdi.equityCents.at(-1)!)}`))),
    );
    const hide = legend.getByRole('button', { name: model.competitor.name, exact: true });
    await hide.click();
    await expect(hide).toHaveAttribute('aria-pressed', 'false');
    await expect(chart.locator(`[data-rotulo="${model.competitor.slug}"]`)).toHaveCount(0);
    await expect(slider).not.toHaveAttribute(
      'aria-valuetext',
      new RegExp(escape(model.competitor.name)),
    );
    // o ponteiro (ou o foco) ficou no botão da série que sumiu: ela não realça mais nada, e as linhas à vista seguem inteiras (antes ficavam
    // todas a 25%; a revisão do fechamento, I5)
    await expect
      .poll(() =>
        chart.locator('path[data-series]').evaluateAll((paths) => [
          ...new Set(
            paths
              .map((path) => path.parentElement!)
              .filter((group) => !group.hasAttribute('data-oculta'))
              .map((group) => getComputedStyle(group).opacity),
          ),
        ]),
      )
      .toEqual(['1']);
  });

  // O "i" da faixa do Monte Carlo explica a faixa (o pedido do Artur em 06/11/2026): o tooltip da Arc não abre no toque, e o popover nativo
  // abre no toque (celular), no clique e no Enter (desktop). O balão fica inteiro na tela e fecha com o toque fora (celular) e com o Esc.
  test('o "i" da faixa do Monte Carlo abre a explicação no toque e no clique, inteira na tela', async ({
    page,
  }, testInfo) => {
    const celular = !testInfo.project.name.startsWith('desktop');
    await page.goto('/arena');
    const chart = region(page, 'Patrimônio');
    const info = chart.getByRole('button', { name: 'O que é a faixa p5 a p95 do Monte Carlo' });
    const balao = page.locator('#faixa-explicada');
    await info.scrollIntoViewIfNeeded();
    await expect(balao).toBeHidden();
    const alvo = (await info.boundingBox())!;
    expect(Math.min(alvo.width, alvo.height)).toBeGreaterThanOrEqual(44);
    if (celular) await page.touchscreen.tap(alvo.x + alvo.width / 2, alvo.y + alvo.height / 2);
    else await info.click();
    await expect(balao).toBeVisible();
    await expect(balao).toContainText('São 1.000 carteiras sorteadas');
    const caixa = (await balao.boundingBox())!;
    const tela = page.viewportSize()!;
    expect(caixa.x).toBeGreaterThanOrEqual(0);
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(tela.width);
    expect(caixa.y).toBeGreaterThanOrEqual(0);
    if (celular) {
      // o toque fora: na amostra da faixa, no começo do mesmo item da legenda (não é controle, e o balão fica acima dela)
      const item = (await chart.locator('.mc-amostra').boundingBox())!;
      await page.touchscreen.tap(item.x + item.width / 2, item.y + item.height / 2);
    } else {
      await page.keyboard.press('Escape');
      await expect(balao).toBeHidden();
      await info.focus();
      await page.keyboard.press('Enter');
      await expect(balao).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await expect(balao).toBeHidden();
  });

  // A série que a legenda mostra de novo se desenha da esquerda para a direita, num recorte que cresce em 250 ms (o "dado que muda" que o
  // docs/DESIGN.md promete; antes ela só esmaecia, o achado 11 do QA). Nada se desenha na abertura da página.
  test('a série que a legenda mostra se desenha da esquerda para a direita, em 250 ms', async ({
    page,
    request,
  }) => {
    const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
    const cdi = equity.series.find((s) => s.competitor.type === 'CDI')!;
    await page.goto('/arena');
    const chart = region(page, 'Patrimônio');
    // as animações que começam no gráfico, desde já (a abertura não desenha nada)
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { desenhos: string[] }).desenhos = seen;
      document.addEventListener(
        'animationstart',
        (event) => {
          const target = event.target as Element;
          const animation = target
            .getAnimations()
            .find((a) => (a as CSSAnimation).animationName === event.animationName);
          const frames = (animation?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? [];
          seen.push(
            JSON.stringify({
              serie: target.getAttribute('data-series'),
              duracao: animation?.effect?.getComputedTiming().duration,
              de: frames[0]?.clipPath,
              ate: frames.at(-1)?.clipPath,
            }),
          );
        },
        true,
      );
    });
    expect(
      await page.evaluate(() => (window as unknown as { desenhos: string[] }).desenhos),
    ).toEqual([]);
    await chart.getByRole('button', { name: cdi.competitor.name, exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { desenhos: string[] }).desenhos))
      .toHaveLength(1);
    const [desenho] = (
      await page.evaluate(() => (window as unknown as { desenhos: string[] }).desenhos)
    ).map(
      (text) => JSON.parse(text) as { serie: string; duracao: number; de: string; ate: string },
    );
    expect(desenho).toMatchObject({ serie: cdi.competitor.slug, duracao: 250 });
    // o recorte começa fechado na direita (100% de recuo) e termina aberto
    expect(desenho!.de).toMatch(/^inset\(.* 100% .*\)$/);
    expect(desenho!.ate).not.toMatch(/100%/);
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
      // O nome acessível do cartão é o nome inteiro (o curto à vista, o sufixo de versão para o leitor de tela), o retorno e o percentil, sem a
      // etiqueta "simulado" (a página tem o aviso: uma vez por contexto)
      await expect(link).toHaveAccessibleName(
        `${r.competitor.name} ${pct(r.returnBps)} percentil ${pctl(r.percentileBps!)}`,
      );
      await expect(link).toHaveAttribute('href', `/modelos/${r.competitor.slug}`);
      // o nome numa linha só (o pedido do Artur: o "(0902)" e a etiqueta quebravam o nome em duas e três linhas)
      const name = link.locator('.truncate');
      expect((await name.boundingBox())!.height).toBeLessThan(24);
      await expect(name).toHaveText(r.competitor.name);
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
      await expectCard(cards.nth(i), row, { by: 'model', date: row.date });
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
    // abaixo de 1280 px a arena mostra uma vista por vez (Decisões ou Carteiras, ?vista=); a partir dela, as duas
    await page.goto('/arena?vista=carteiras');
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
      // o nome inteiro (o curto à vista, o sufixo para o leitor de tela), sem a etiqueta: a página tem o aviso
      await expect(wallet.getByRole('heading', { level: 3 })).toHaveText(r.competitor.name);
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
        await expectTickerLogo(row.getByRole('link'), p.ticker);
        await expect(row.getByRole('cell')).toHaveText([
          pct(ratioBps(p.valueCents, portfolio.equityCents), false),
          brlSigned(p.pnlCents),
          pct(ratioBps(p.pnlCents, p.costCents)),
        ]);
      }
    }
  });
});

// Abaixo de 1280 px a arena mostra uma vista por vez: as decisões (o padrão) ou as carteiras, como as abas "Feed | Portfolios" do Rallies.
// São abas de verdade, do servidor (`?vista=`, links com o `aria-current`, no desenho do segmentado), sem JavaScript; a partir de 1280 px as
// duas ficam lado a lado e as abas somem (o QA do fechamento, achado 7: antes eram âncoras que pareciam abas e nenhuma ficava marcada).
test.describe('a arena no celular: Decisões ou Carteiras', () => {
  test('as abas mostram uma vista por vez pela URL, e a partir de 1280 px as duas', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/arena');
    const tabs = page.getByRole('navigation', { name: 'Seções da arena' });
    const decisoes = tabs.getByRole('link', { name: 'Decisões', exact: true });
    const carteiras = tabs.getByRole('link', { name: 'Carteiras', exact: true });
    await expect(decisoes).toHaveAttribute('aria-current', 'page');
    await expect(carteiras).not.toHaveAttribute('aria-current');
    await expect(region(page, 'Decisões')).toBeVisible();
    await expect(region(page, 'Patrimônio')).toBeVisible();
    await expect(region(page, 'Carteiras')).toBeHidden();
    // o desenho do segmentado: o trilho cinza e a pílula do canvas na escolhida
    await expect(tabs.locator('ul')).toHaveClass(/segmentado/);

    await carteiras.click();
    await expect(page).toHaveURL(/\/arena\?vista=carteiras$/);
    await expect(carteiras).toHaveAttribute('aria-current', 'page');
    await expect(decisoes).not.toHaveAttribute('aria-current');
    await expect(region(page, 'Carteiras')).toBeVisible();
    await expect(region(page, 'Decisões')).toBeHidden();
    await expect(region(page, 'Patrimônio')).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(region(page, 'Carteiras')).toBeVisible();
    await expect(region(page, 'Decisões')).toBeVisible();
    await expect(tabs).toBeHidden();

    // a vista que não existe é a de sempre (as decisões)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/arena?vista=outra');
    await expect(region(page, 'Decisões')).toBeVisible();
    await expect(region(page, 'Carteiras')).toBeHidden();
  });

  test.describe('sem JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('as abas são links, e a vista vem pronta do servidor', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/arena?vista=carteiras');
      await expect(region(page, 'Carteiras')).toBeVisible();
      await expect(region(page, 'Decisões')).toBeHidden();
      await page
        .getByRole('navigation', { name: 'Seções da arena' })
        .getByRole('link', { name: 'Decisões', exact: true })
        .click();
      await expect(page).toHaveURL(/\/arena$/);
      await expect(region(page, 'Decisões')).toBeVisible();
      await expect(region(page, 'Carteiras')).toBeHidden();
    });
  });
});

// Em 360 px a arena e o ranking rolavam de lado (366 px): a tabela de cada carteira não cabia nos 320 px da coluna com um resultado do
// tamanho de "-R$ 1.330,30", e o "Resultado %" do cabeçalho quebrava em duas linhas (o QA do fechamento, achados 1 e 16). O banco do e2e
// tem valores curtos: o teste põe em cada linha o texto mais comprido que a carteira mostra (o ticker de seis letras, a alocação de 100%, o
// resultado de quatro dígitos e o percentual de dois, com o sinal) e mede a página e cada tabela, depois de descer até as carteiras.
for (const path of ['/arena?vista=carteiras', '/ranking']) {
  test(`em 360 px a carteira com o resultado de "-R$ 1.330,30" cabe na coluna (${path})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(path);
    const wallets = region(page, 'Carteiras');
    await wallets.getByRole('table').first().scrollIntoViewIfNeeded();
    const rows = await wallets.evaluate((section) => {
      const last = (element: Element, text: string) => {
        const nodes = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
        nodes.at(-1)!.textContent = text;
      };
      const body = [...section.querySelectorAll('tbody tr')];
      for (const row of body) {
        const [ticker, allocation, result, percent] = [...row.children];
        last(ticker!.querySelector('a')!, 'BOVA11');
        last(allocation!.querySelector('span') ?? allocation!, '100,00%');
        last(result!, '-R$\u00a01.330,30');
        result!.setAttribute('data-dir', 'down');
        last(percent!, '-12,34%');
      }
      return body.length;
    });
    expect(rows).toBeGreaterThan(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const measure = await wallets.evaluate((section) => {
      const right = section.getBoundingClientRect().right;
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tables: [...section.querySelectorAll('table')].map((table) =>
          Math.round(table.getBoundingClientRect().right - right),
        ),
        // o cabeçalho numa linha: o texto de 11 px com a entrelinha dele, e não dois andares
        headers: [...section.querySelectorAll('thead th')].map((th) => {
          const style = getComputedStyle(th);
          return Math.round(
            (th.getBoundingClientRect().height -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom)) /
              parseFloat(style.lineHeight),
          );
        }),
      };
    });
    expect(measure.page).toBeLessThanOrEqual(0);
    for (const overflow of measure.tables) expect(overflow).toBeLessThanOrEqual(0);
    expect(new Set(measure.headers)).toEqual(new Set([1]));
  });
}

// A Regra da Voz Única (docs/DESIGN.md): a primária pinta a ação principal, a escolha atual, o foco e a marca. A paginação "Mais antigas" é
// ação de apoio, a pílula cinza (o QA do fechamento, achado 8: era a única primária da arena e das notícias).
test('a paginação "Mais antigas" é a pílula cinza, e não a primária', async ({ page }) => {
  for (const path of ['/arena', '/noticias']) {
    await page.goto(path);
    const more = page.getByRole('link', { name: 'Mais antigas', exact: true });
    await expect(more, path).toBeVisible();
    await expect(more, path).not.toHaveClass(/btn-primary/);
    await expect(more, path).toHaveClass(/\bbtn\b/);
  }
});

// A Regra da Sans Única (docs/DESIGN.md): nas quatro telas da arena, tudo é a sans com os algarismos tabulares, os tickers, os títulos das
// colunas, os rótulos e os selos inclusive; a mono fica só no hash (o SHA-256 do prompt e do briefing, na página do ciclo).
test('as telas da arena são todas na sans: a mono só no SHA-256 do ciclo', async ({ page }) => {
  for (const route of ['/arena', '/ranking', `/modelos/${MODEL}`, `/ciclos/${CYCLE_DAY}`]) {
    await page.goto(route);
    const mono = await page.locator('body').evaluate((body) =>
      [...body.querySelectorAll<HTMLElement>('*')]
        .filter((element) =>
          [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== '',
          ),
        )
        .filter((element) => /mono/i.test(getComputedStyle(element).fontFamily))
        .filter((element) => !element.closest('.hash'))
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}: ${element.textContent.trim().slice(0, 30)}`,
        ),
    );
    expect(mono, route).toEqual([]);
  }
  await expect(page.locator('.hash')).toHaveCount(3);
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
        'Tendência',
        'vs igual-peso',
        'vs CDI',
        'Drawdown',
        'Acerto',
        'Operações',
        'Custo LLM',
      ]);
      await expect(group.getByRole('row')).toHaveCount(1 + rows.length);
      for (const r of rows) {
        await expect(rowOf(group, r.competitor.name).locator('th, td')).toHaveText(fullCells(r));
        await expect(rowOf(group, r.competitor.name).getByRole('link')).toHaveAttribute(
          'href',
          `/modelos/${r.competitor.slug}`,
        );
        // a sparkline do patrimônio: uma imagem com o resumo no nome
        await expect(rowOf(group, r.competitor.name).getByRole('img')).toHaveAccessibleName(
          new RegExp(`^Patrimônio de ${escape(r.competitor.name)}: de R\\$`),
        );
        // o retorno leva o glifo da direção (▲ ▼ ■), desenhado pelo CSS antes do número: fora do texto, que a comparação acima lê por igualdade
        const glyph = r.returnBps > 0 ? '▲' : r.returnBps < 0 ? '▼' : '■';
        const returnCell = rowOf(group, r.competitor.name).locator('td').nth(1);
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

  // O Bump Chart da beUI: a posição de cada competidor em cada pregão, pela regra do ranking (o retorno em pontos-base, o empate na ordem do
  // elenco): no último pregão, a posição é a do ranking da api. A legenda fixa uma série (o Esc solta), e a tabela escondida tem todas.
  test('o gráfico de posições mostra a posição de cada um em cada pregão, e a do último é a do ranking', async ({
    page,
    request,
  }, testInfo) => {
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
    await page.goto('/ranking');
    const positions = region(page, 'Posição por pregão');
    await expect(positions.getByRole('img', { name: 'Posição por pregão' })).toBeVisible();
    const table = positions.getByRole('table', { name: /dados do gráfico/i });
    await expect(table.getByRole('row')).toHaveCount(1 + equity.series.length);
    for (const s of equity.series) {
      const rank = board.rows.find((r) => r.competitor.slug === s.competitor.slug)!.rank;
      const cells = table.getByRole('row').filter({
        has: page.getByRole('rowheader', { name: s.competitor.name, exact: true }),
      });
      await expect(cells.locator('td')).toHaveCount(equity.dates.length);
      await expect(cells.locator('td').last()).toHaveText(`${rank}º`);
    }
    // os pontos e as curvas são desenho: uma curva por competidor, e os pontos fora da árvore de acessibilidade
    await expect(positions.locator('path[data-serie]')).toHaveCount(equity.series.length);
    await expect(positions.locator('[data-pontos]')).toHaveAttribute('aria-hidden', 'true');
    const legend = positions.getByRole('list', { name: 'Séries do gráfico' });
    await expect(legend.getByRole('button')).toHaveCount(equity.series.length);
    const first = legend.getByRole('button').first();
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    if (testInfo.project.name.startsWith('desktop')) {
      await first.focus();
      await page.keyboard.press('Escape');
      await expect(first).toHaveAttribute('aria-pressed', 'false');
    } else {
      // no toque: o primeiro toque fixa a série e o segundo a solta, e nenhuma linha fica apagada (o foco que o toque dá ao botão não realça;
      // só o do teclado; a revisão do fechamento, M12)
      await first.click();
      await expect(first).toHaveAttribute('aria-pressed', 'false');
      await first.tap();
      await expect(first).toHaveAttribute('aria-pressed', 'true');
      await first.tap();
      await expect(first).toHaveAttribute('aria-pressed', 'false');
      await expect(positions.locator('.opacity-25')).toHaveCount(0);
    }
  });
});

// Com a fonte padrão maior no navegador (a "Grande" do Chrome, 20 px: o `rem` cresce e o px não), o desenho dos gráficos continuava na altura
// em px e as caixas iam a 350 px: os marcos do eixo das velas saíam até uns 70 px da linha da grade deles, e o ponto do fim de cada linha do
// patrimônio ficava longe do fim do traço (a revisão do fechamento, I3). A altura das caixas é a da escala, em px.
test('com a fonte padrão de 20 px, o eixo das velas e o fim das linhas do patrimônio ficam no lugar', async ({
  page,
}) => {
  const big = () =>
    page.evaluate(() => {
      document.documentElement.style.fontSize = '20px';
    });
  await page.goto(`/acoes/${TICKER}`);
  await big();
  const figure = page.getByRole('figure', { name: `Velas diárias de ${TICKER}` });
  await figure.scrollIntoViewIfNeeded();
  const off = await figure.evaluate((element) => {
    const grid = [...element.querySelectorAll('svg line[stroke-dasharray="2 6"]')].map(
      (line) => line.getBoundingClientRect().top,
    );
    const labels = [...element.querySelectorAll('[aria-hidden="true"] > span.text-muted')].map(
      (label) => {
        const rect = label.getBoundingClientRect();
        return rect.top + rect.height / 2;
      },
    );
    return labels.map((y) => Math.min(...grid.map((g) => Math.abs(g - y))));
  });
  expect(off.length).toBeGreaterThan(0);
  for (const distance of off) expect(distance).toBeLessThanOrEqual(2);

  await page.goto('/arena');
  await big();
  const chart = region(page, 'Patrimônio');
  await chart.getByRole('img', { name: /Patrimônio/ }).scrollIntoViewIfNeeded();
  const ends = await chart.evaluate((element) =>
    [...element.querySelectorAll<SVGPathElement>('path[data-series]')]
      .filter((path) => !path.closest('[data-oculta]'))
      .map((path) => {
        const end = path.getPointAtLength(path.getTotalLength());
        const m = path.getScreenCTM()!;
        const dot = element
          .querySelector(`[data-ponto="${path.getAttribute('data-series')}"]`)!
          .getBoundingClientRect();
        return Math.abs(end.x * m.b + end.y * m.d + m.f - (dot.top + dot.height / 2));
      }),
  );
  expect(ends.length).toBeGreaterThan(0);
  for (const distance of ends) expect(distance).toBeLessThanOrEqual(2);
});

// As tabelas do ranking (o QA do fechamento, achados 4 e 17): as três (modelos, Sorteio e referências) têm as mesmas larguras de coluna (a
// coluna de uma fica embaixo da mesma coluna da outra), a tabela que passa da coluna dá a pista de que há mais à direita (o esmaecimento na
// borda, que some no fim da rolagem; com o mouse, também o "›" redondo da faixa), e o nome do competidor fica numa linha.
test.describe('as tabelas do ranking', () => {
  test('as três tabelas têm as mesmas colunas, e a que passa da coluna esmaece na borda até o fim da rolagem', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/ranking');
    const scrollers = page.getByRole('region', { name: /^Ranking: / });
    await expect(scrollers).toHaveCount(3);
    const columns = await scrollers.evaluateAll((boxes) =>
      boxes.map((box) => {
        const table = box.querySelector('table')!;
        const left = table.getBoundingClientRect().left;
        return {
          layout: getComputedStyle(table).tableLayout,
          edges: [...table.querySelectorAll('thead th')].map((th) =>
            Math.round(th.getBoundingClientRect().left - left),
          ),
        };
      }),
    );
    expect(columns[0]!.layout).toBe('fixed');
    expect(columns[1]).toEqual(columns[0]);
    expect(columns[2]).toEqual(columns[0]);

    // a pista: a borda da direita esmaece enquanto há mais à direita, e para de esmaecer no fim
    const models = scrollers.first();
    const fade = () =>
      models.evaluate((box) => ({
        more: box.scrollWidth - box.clientWidth - box.scrollLeft > 1,
        fade: getComputedStyle(box).getPropertyValue('--mais-a-direita').trim(),
      }));
    const start = await fade();
    expect(start.more).toBe(true);
    expect(start.fade).not.toBe('0px');
    await models.evaluate((box) => box.scrollTo({ left: box.scrollWidth, behavior: 'instant' }));
    await expect.poll(fade).toEqual({ more: false, fade: '0px' });
  });

  test('em 390 px o nome de cada competidor fica numa linha, inclusive o das referências', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ranking');
    const names = page
      .getByRole('region', { name: /^Ranking: / })
      .getByRole('rowheader')
      .getByRole('link');
    await expect(names.first()).toBeVisible();
    const lines = await names.evaluateAll((links) =>
      links.map((link) => {
        // o texto à vista: os nós de texto fora do `sr-only` (o resto do nome, que só o leitor de tela ouve, quebra dentro da caixa de 1 px dele)
        const visible = [...link.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
        const tops = new Set(
          visible.flatMap((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].map((r) => Math.round(r.top));
          }),
        );
        return {
          text: visible
            .map((node) => node.textContent)
            .join('')
            .trim(),
          lines: tops.size,
        };
      }),
    );
    for (const line of lines) expect(line, line.text).toMatchObject({ lines: 1 });
    // o nome curto à vista nas referências (o resto do nome vai para o leitor de tela)
    expect(lines.map((l) => l.text)).toEqual(
      expect.arrayContaining(['Igual-peso', 'BOVA11', 'CDI']),
    );
  });

  // O gráfico de posições abre nos pregões mais novos (a rolagem começa no fim, como diz o nome da região), e o nome no fim de cada linha
  // aparece inteiro, o curto (antes eles saíam cortados, "BOVA11 (con", e a caixa abria nos pregões antigos; a revisão, I4, e o QA, achado 3).
  for (const width of [320, 1440]) {
    test(`em ${width} px o gráfico de posições abre no último pregão, com os nomes do fim inteiros`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/ranking');
      const positions = region(page, 'Posição por pregão');
      const scroller = positions.getByRole('region', { name: /role para os pregões mais antigos/ });
      await scroller.scrollIntoViewIfNeeded();
      const view = await scroller.evaluate((box) => {
        const frame = box.getBoundingClientRect();
        const inside = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= frame.left - 0.5 && rect.right <= frame.right + 0.5;
        };
        const dates = [...box.querySelectorAll('[aria-hidden="true"] > span')].filter((span) =>
          /^\d{2}\/\d{2}$/.test(span.textContent ?? ''),
        );
        const labels = [...box.querySelectorAll('ul[aria-hidden="true"] > li')];
        return {
          lastDate: inside(dates.at(-1)!),
          labels: labels.map((li) => ({
            text: li.textContent,
            whole: li.scrollWidth <= li.clientWidth,
            inside: inside(li),
          })),
        };
      });
      expect(view.lastDate).toBe(true);
      for (const label of view.labels)
        expect(label, label.text ?? '').toMatchObject({ whole: true, inside: true });
      expect(view.labels.map((l) => l.text)).toEqual(
        expect.arrayContaining(['Igual-peso', 'BOVA11']),
      );
    });
  }
});

// A arena simulada, até a integração (docs/ARENA.md, seções 1 e 8): o elenco é o da Temporada 1 e as decisões vêm do provedor fake. O
// "simulado" fica visível, discreto e uma vez por contexto (docs/DESIGN.md; o pedido do Artur de 05/11/2026): na arena e no ciclo, o aviso do
// topo cobre a página inteira, e as peças (a faixa, o gráfico, o feed, as carteiras) ficam sem etiqueta; no ranking, a nota no cabeçalho da
// tabela dos modelos e a do título da barra; na página do modelo, a etiqueta junto do título. Com o provedor de verdade, tudo some sozinho.
test.describe('arena simulada', () => {
  const NOTICE = 'Decisões simuladas: os modelos ainda não estão conectados.';

  test('a arena avisa uma vez, numa linha discreta sem caixa, e nenhum nome leva a etiqueta', async ({
    page,
    request,
  }) => {
    const board = await fetchApi(request, `/seasons/${SEASON}/leaderboard`, leaderboardSchema);
    const models = board.rows.filter((r) => r.competitor.type === 'MODEL');
    expect(models.map((r) => r.competitor.name).sort()).toEqual([...CAST].sort());
    expect(models.every((r) => r.competitor.provider === 'fake')).toBe(true);

    await page.goto('/arena');
    const notice = page.getByText(NOTICE);
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeVisible();
    // a linha discreta: sem o fundo cinza nem a borda da caixa de antes, e o [!] fora do que o leitor de tela lê
    const box = await notice.locator('xpath=ancestor::p[1]').evaluate((p) => {
      const style = getComputedStyle(p);
      return { background: style.backgroundColor, border: style.borderTopWidth };
    });
    expect(box).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px' });
    await expect(page.getByText(SIMULATED, { exact: true })).toHaveCount(0);
    // a faixa traz os seis do elenco e o Sorteio, sem etiqueta
    const ranking = region(page, 'Ranking');
    for (const name of CAST)
      await expect(ranking.getByRole('listitem').filter({ hasText: name })).toHaveCount(1);
  });

  test('o ranking anota uma vez na tabela dos modelos e uma no título da barra; o Sorteio e as referências, não', async ({
    page,
  }) => {
    await page.goto('/ranking');
    const models = region(page, 'Modelos');
    await expect(models.getByText(SIMULATED, { exact: true })).toHaveCount(1);
    await expect(models.getByText(SIMULATED, { exact: true })).toBeVisible();
    await expect(models.getByRole('rowheader').getByText(SIMULATED, { exact: true })).toHaveCount(
      0,
    );
    for (const name of ['Sorteio (controle)', 'Referências']) {
      await expect(region(page, name).getByText(SIMULATED, { exact: true })).toHaveCount(0);
    }
    const wallets = region(page, 'Carteiras');
    await expect(wallets.getByText(SIMULATED, { exact: true })).toHaveCount(1);
    await expect(wallets.getByRole('heading', { level: 3 }).getByText(SIMULATED)).toHaveCount(0);
  });

  test('a página do modelo leva a etiqueta junto do título, e o ciclo, o aviso uma vez', async ({
    page,
  }) => {
    await page.goto(`/modelos/${MODEL}`);
    const title = page.getByRole('heading', { level: 1 });
    await expect(title.getByText(SIMULATED, { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText(SIMULATED, { exact: true })).toHaveCount(1);
    await page.goto(`/ciclos/${CYCLE_DAY}`);
    await expect(page.getByText(NOTICE)).toHaveCount(1);
    await expect(page.getByText(SIMULATED, { exact: true })).toHaveCount(0);
  });
});

// O movimento reduzido (docs/DESIGN.md, 5): com `prefers-reduced-motion: reduce`, nada anda. O gráfico troca de pregão na hora (o painel e o
// contador da Arc, que rola só quando o ponteiro muda de pregão, saltam para o valor), e a legenda esconde e mostra a linha na hora, sem o
// desenho da linha e sem a mola da escala. O teste lê o quadro seguinte à troca: com o movimento, ele ainda estaria no meio do caminho.
test.describe('movimento reduzido', () => {
  test.use({ reducedMotion: 'reduce' });

  test('o gráfico e o contador trocam na hora', async ({ page, request }, testInfo) => {
    test.skip(
      !testInfo.project.name.startsWith('desktop'),
      'o ponteiro que passa por cima é do mouse',
    );
    const equity = await fetchApi(request, `/seasons/${SEASON}/equity`, equitySchema);
    await page.goto('/arena');
    const chart = region(page, 'Patrimônio');
    const slider = chart.getByRole('slider', { name: 'Patrimônio por pregão: ler os valores' });
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    const at = (i: number) =>
      box.x +
      (box.width * i) / (equity.dates.length - 1) +
      (i === 0 ? 2 : i === equity.dates.length - 1 ? -2 : 0);
    // o quadro seguinte à troca: todo algarismo do contador está inteiro (opacidade 0 ou 1, sem o meio da roda) e nada anima
    const settled = () =>
      page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        const tooltip = document.querySelector('[role="tooltip"]');
        const glyphs = [...(tooltip?.querySelectorAll<HTMLElement>('[class*="glyph"]') ?? [])];
        return {
          digits: glyphs.length,
          moving: glyphs.filter((g) => !['', '0', '1'].includes(g.style.opacity)).length,
          // a animação ligada à rolagem (a pista das tabelas) não anda no tempo e fica fora da conta
          animations: document
            .getAnimations()
            .filter((a) => a.playState === 'running' && !(a.timeline && 'source' in a.timeline))
            .length,
        };
      });
    await page.mouse.move(at(0), box.y + box.height / 2);
    await expect(chart.getByRole('tooltip')).toContainText(dmy(equity.dates[0]!));
    await page.mouse.move(at(equity.dates.length - 1), box.y + box.height / 2);
    const after = await settled();
    expect(after.digits).toBeGreaterThan(0);
    expect(after).toMatchObject({ moving: 0, animations: 0 });
    await expect(chart.getByRole('tooltip')).toContainText(dmy(equity.dates.at(-1)!));

    // a legenda: a linha volta inteira na hora (a opacidade no fim e nenhum recorte), e as etiquetas do fim das linhas, que se rearrumam para
    // abrir lugar para a dela (molas do Motion, que correm em JavaScript e não aparecem no `getAnimations()`), saltam: a posição de cada uma é
    // a mesma em dois quadros seguidos, e alguma mudou de lugar (a revisão do fechamento, M11; a escala do eixo não muda com o banco do e2e,
    // porque a faixa do Monte Carlo cobre todas as séries, e o salto dela fica no teste de unidade do line-chart)
    await page.mouse.move(0, 0);
    const cdi = equity.series.find((s) => s.competitor.type === 'CDI')!;
    const labels = () =>
      chart
        .locator('[data-rotulo]')
        .evaluateAll((items): Record<string, string> =>
          Object.fromEntries(
            items.map((item) => [
              item.getAttribute('data-rotulo') ?? '',
              getComputedStyle(item).transform,
            ]),
          ),
        );
    const before = await labels();
    await chart.getByRole('button', { name: cdi.competitor.name, exact: true }).click();
    const line = chart.locator(`path[data-series="${cdi.competitor.slug}"]`);
    const state = await line.evaluate(async (path) => {
      const read = () =>
        [...document.querySelectorAll('[data-rotulo]')]
          .map((item) => `${item.getAttribute('data-rotulo')}:${getComputedStyle(item).transform}`)
          .join('|');
      await new Promise(requestAnimationFrame);
      const first = read();
      await new Promise(requestAnimationFrame);
      return {
        opacity: getComputedStyle(path.parentElement!).opacity,
        clip: getComputedStyle(path).clipPath,
        running: path.getAnimations().filter((a) => a.playState === 'running').length,
        settled: first === read(),
      };
    });
    expect(state).toEqual({ opacity: '1', clip: 'none', running: 0, settled: true });
    const now = await labels();
    const moved = Object.keys(before).filter((key) => before[key] !== now[key]);
    expect(moved.length, 'alguma etiqueta abriu lugar para a do CDI').toBeGreaterThan(0);
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
        // o nome inteiro (o curto à vista e o sufixo de versão para o leitor de tela), sem a etiqueta "simulado": a nota vai uma vez, no
        // cabeçalho da grade (o "simulado" uma vez por contexto; e2e/explorar.spec.ts)
        await expect(card).toContainText(r.competitor.name);
        await expect(fact(card, 'Retorno')).toHaveText(pct(r.returnBps));
        // o percentil embaixo do retorno, quando há
        await expect(card.locator('dt:text-is("Retorno") ~ dd')).toHaveText(
          r.percentileBps === null
            ? [pct(r.returnBps)]
            : [pct(r.returnBps), `percentil ${pctl(r.percentileBps)}`],
        );
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
    // cada papel numa linha: o ticker (com o logo, sem texto), o fechamento e a variação, em colunas (sem os parênteses de antes)
    await expect(items).toHaveText(
      tape.rows.map((row) => {
        const change =
          row.previousCloseCents !== null && row.previousCloseCents > 0
            ? pct(
                Math.round(
                  ((row.closeCents - row.previousCloseCents) * 10_000) / row.previousCloseCents,
                ),
              )
            : 'sem o anterior';
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
      await expectTickerLogo(row.getByRole('link'), p.ticker);
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

// O título da página do modelo (o QA do fechamento, achado 5): o "DeepSeek V4 Pro (0813)" quebrava em duas linhas até em 1440 px (o teto de
// 24 ch), e a segunda começava embaixo do logo, que morava dentro do h1. O logo fica ao lado do título, fora do texto: a linha que quebrar no
// celular começa embaixo do nome.
test('o título da página do modelo cabe numa linha no desktop, e o logo fica ao lado dele', async ({
  page,
}) => {
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/modelos/deepseek-v4-pro');
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toContainText('DeepSeek V4 Pro (0813)');
    const shape = await title.evaluate((h1) => {
      const logo = h1.parentElement!.querySelector('[data-lab]');
      const style = getComputedStyle(h1);
      return {
        lines: Math.round(h1.getBoundingClientRect().height / parseFloat(style.lineHeight)),
        logoInside: h1.contains(logo),
        logoBeside: logo
          ? logo.getBoundingClientRect().right <= h1.getBoundingClientRect().left
          : false,
      };
    });
    expect(shape, `${width} px`).toMatchObject({ logoInside: false, logoBeside: true });
    if (width === 1440) expect(shape.lines).toBe(1);
  }
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
      await expectCard(cards.nth(i), d, { by: 'model' });
    }
    // o canário do ensaio e o texto do prompt não existem em página nenhuma
    const html = await page.content();
    expect(html).not.toContain('alv-canary');
    expect(html).not.toContain('Texto sintético do ensaio');
  });

  // a situação do ciclo é a etiqueta cinza sem borda, com o texto na tinta: o colchete diz o estado, e a cor do dado fica só no glifo ▲ ▼ ■ (a
  // Regra do Glifo; o QA do fechamento, achado 12: era o verde do dado, com borda)
  test('a situação do ciclo é a pílula cinza sem borda, com o texto na tinta', async ({ page }) => {
    await page.goto(`/ciclos/${CYCLE_DAY}`);
    const flag = page.getByText('[ok] fechado', { exact: true });
    await expect(flag).toBeVisible();
    const style = await flag.evaluate((element) => {
      const own = getComputedStyle(element);
      return {
        border: own.borderTopWidth,
        color: own.color,
        ink: getComputedStyle(document.querySelector('h1')!).color,
      };
    });
    expect(style.border).toBe('0px');
    expect(style.color).toBe(style.ink);
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

    // o cabeçalho do terminal: o último fechamento e a variação sobre o pregão anterior (o glifo só nela), a data e o crédito; o fechamento
    // anterior não aparece (só a variação)
    const [previous, latest] = bars.slice(-2) as [(typeof bars)[number], (typeof bars)[number]];
    const header = page.getByRole('main').locator('header').first();
    await expect(fact(header, 'Último fechamento')).toHaveText(brl(latest.closeCents));
    const change = Math.round(
      ((latest.closeCents - previous.closeCents) * 10_000) / previous.closeCents,
    );
    const variation = fact(header, 'Variação sobre o pregão anterior');
    await expect(variation).toHaveText(pct(change));
    await expect(variation).toHaveAttribute(
      'data-dir',
      change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    );
    await expect(header).toContainText(
      `Fechamento do pregão de ${dmy(latest.date)}, com a variação sobre o anterior. Cotações: brapi.dev.`,
    );

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

    // só os modelos: o igual-peso também tem a ação, e a lista dos donos não pode entregar a marcação do universo (ADR 0033). No terminal, a
    // coluna do lado é estreita: cada modelo é um item da lista com os quatro números em pares (era uma tabela de cinco colunas, que rolaria
    // dentro da caixa); o nome sem a etiqueta "simulado" (a página avisa uma vez)
    expect(stock.holders.length).toBeGreaterThan(0);
    expect(stock.holders.every((h) => h.competitor.type === 'MODEL')).toBe(true);
    const holders = region(page, 'Quem tem a ação')
      .getByRole('list', { name: `Quem tem ${TICKER}` })
      .getByRole('listitem');
    await expect(holders).toHaveCount(stock.holders.length);
    for (const [i, h] of stock.holders.entries()) {
      const holder = holders.nth(i);
      await expect(
        holder.getByRole('link', { name: h.competitor.name, exact: true }),
      ).toHaveAttribute('href', `/modelos/${h.competitor.slug}`);
      await expect(fact(holder, 'Valor')).toContainText(brl(h.valueCents));
      await expect(fact(holder, 'Resultado')).toHaveText(
        `${h.pnlCents > 0 ? '+' : ''}${brl(h.pnlCents)}`,
      );
      await expect(fact(holder, 'Quantidade')).toHaveText(
        String(h.quantity).replace(/\B(?=(\d{3})+$)/g, '.'),
      );
      await expect(fact(holder, 'Preço médio')).toHaveText(brl(h.avgPriceCents));
    }

    // cada decisão sobre a ação, por igualdade: a data, o modelo, a ação (BUY e SELL não se confundem), o percentual, a confiança e a
    // justificativa. O nome sem a etiqueta "simulado": a página avisa uma vez (o `provider: null` só tira a etiqueta do texto esperado)
    const decisions = region(page, 'Decisões dos modelos').getByRole('listitem');
    expect(stock.decisions.length).toBeGreaterThan(0);
    await expect(decisions).toHaveText(
      stock.decisions.map((d) =>
        stockDecisionText({ ...d, competitor: { ...d.competitor, provider: null } }),
      ),
      { useInnerText: true },
    );
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
      .getByRole('link', { name: /^GPT-6\.1 Sol / })
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
