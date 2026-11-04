import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURE_API_URL, FIXTURE_WEB_URL, QUOTES_SECRET, REVALIDATE_SECRET } from './api-server';

// O que o banco sintético do ensaio não tem: o site lendo a api falsa (e2e/fixture-api.ts), que responde no formato do contrato a
// temporada sem ciclo (com o próximo ciclo para a contagem), a ação sem notícia, o ciclo com HOLD forçado e itens descartados, o
// ciclo pulado, o erro 500, a notícia com caracteres especiais e uma notícia que muda. Roda em pixel-7, iphone-15 e desktop. Não roda
// contra o site publicado (BASE_URL).
test.skip(Boolean(process.env.BASE_URL), 'precisa do site e da api falsa locais');

const region = (page: Page, name: string): Locator =>
  page.getByRole('region', { name, exact: true });
const fact = (scope: Locator, term: string): Locator => scope.locator(`dt:text-is("${term}") + dd`);
const WEEKDAY = '(domingo|segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado)';

test.describe('temporada que ainda não teve ciclo', () => {
  test('a home diz o que falta, em vez de uma tela quebrada: sem ciclo, sem resultado, sem decisão e sem macro', async ({
    page,
  }) => {
    await page.goto(`${FIXTURE_WEB_URL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Alvesting' })).toBeVisible();
    await expect(fact(region(page, 'Temporada'), 'Nome')).toHaveText('Temporada de teste');
    await expect(fact(region(page, 'Temporada'), 'Situação')).toHaveText('Em andamento');
    await expect(fact(region(page, 'Temporada'), 'Liquidado até')).toHaveText('ainda não');

    const quotes = region(page, 'Cotações e macro');
    for (const term of [
      'BOVA11',
      'CDI',
      'Selic (meta)',
      'IPCA no mês',
      'IPCA em 12 meses',
      'Dólar (PTAX de venda)',
    ]) {
      await expect(fact(quotes, term)).toHaveText('sem dado');
    }

    const cycles = region(page, 'Ciclos');
    await expect(fact(cycles, 'Último ciclo')).toHaveText('Ainda não houve ciclo nesta temporada.');
    await expect(fact(cycles, 'Próximo ciclo')).toContainText('às 08:00 (Brasília)');
    await expect(fact(cycles, 'Próximo ciclo')).toContainText(
      new RegExp(`${WEEKDAY}, \\d{2}/\\d{2}/\\d{4}`),
    );

    const noResult =
      'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.';
    await expect(region(page, 'Patrimônio')).toContainText(noResult);
    await expect(region(page, 'Ranking')).toContainText(noResult);
    await expect(region(page, 'Decisões')).toContainText('Nenhuma decisão ainda.');
    await expect(region(page, 'Decisões').getByRole('article')).toHaveCount(0);
  });

  test('a contagem para o próximo ciclo anda sozinha: passou um dia, ela mostra um dia a menos', async ({
    page,
  }) => {
    await page.clock.install({ time: Date.now() });
    await page.goto(`${FIXTURE_WEB_URL}/`);
    const countdown = page.getByTestId('contagem');
    await expect(countdown).toHaveText(/^Faltam \d+ dias?( e \d+ horas?)?\.$/);
    const before = (await countdown.innerText()).trim();
    // O setInterval da contagem nasce no efeito do componente, depois da hidratação: um salto de relógio dado antes dele não dispara
    // nada (num runner lento a hidratação demora mais que o `goto`). Repete o salto até a frase mudar.
    await expect(async () => {
      await page.clock.fastForward('24:00:00');
      await expect(countdown).not.toHaveText(before, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(countdown).toHaveText(/^(Faltam .+|O ciclo está abrindo agora)\.$/);
  });

  test('o modelo sem resultado diz que a primeira liquidação ainda não aconteceu', async ({
    page,
  }) => {
    await page.goto(`${FIXTURE_WEB_URL}/modelos/fixture-model`);
    await expect(page.getByRole('heading', { level: 1, name: 'Modelo de teste' })).toBeVisible();
    const noResult =
      'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.';
    await expect(region(page, 'Resultado')).toContainText(noResult);
    await expect(region(page, 'Carteira')).toContainText(
      'A carteira aparece depois da primeira liquidação.',
    );
    await expect(region(page, 'Patrimônio')).toContainText(noResult);
    await expect(region(page, 'Decisões')).toContainText('Nenhuma decisão ainda.');
  });
});

test.describe('ação sem dado', () => {
  test('a ação sem barra, dono, decisão nem notícia mostra cada seção vazia, com texto', async ({
    page,
  }) => {
    await page.goto(`${FIXTURE_WEB_URL}/acoes/SEMN3`);
    await expect(page.getByRole('heading', { level: 1, name: 'SEMN3' })).toBeVisible();
    await expect(region(page, 'Cotações recentes')).toContainText(
      'Sem cotações no banco para esta ação.',
    );
    await expect(region(page, 'Quem tem a ação')).toContainText(
      'Nenhum modelo tem esta ação no último pregão liquidado.',
    );
    await expect(region(page, 'Decisões dos modelos')).toContainText(
      'Nenhum modelo decidiu sobre esta ação.',
    );
    await expect(region(page, 'Notícias')).toContainText('Nenhuma notícia recente com SEMN3.');
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});

// As cotações vêm da rota interna da api, com o segredo do servidor (docs/API.md, seção 6; ADR 0033). A api falsa responde a essa rota como a de
// verdade: só com o segredo certo em `Authorization: Bearer`, e senão um 404 igual ao da rota que não existe.
test.describe('cotações pela rota interna', () => {
  test('a página da ação lê as barras com o segredo: as velas aparecem, com o crédito da brapi', async ({
    page,
  }) => {
    await page.goto(`${FIXTURE_WEB_URL}/acoes/COTA3`);
    await expect(page.getByRole('heading', { level: 1, name: 'COTA3' })).toBeVisible();
    const quotes = region(page, 'Cotações recentes');
    await expect(quotes.locator('g[data-candle]')).toHaveCount(3);
    await expect(quotes.getByTestId('resumo-barras')).toContainText(
      '3 pregões, de 03/11/2026 a 05/11/2026',
    );
    await expect(quotes).toContainText('Cotações: brapi.dev, pregão de 05/11/2026.');
    // o rodapé também: a data do último pregão do BOVA11 vem da mesma rota, e a api falsa não tem barra dele
    await expect(page.getByRole('contentinfo')).toContainText('Cotações:');
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: /^brapi\.dev/ }),
    ).toHaveAttribute('href', 'https://brapi.dev/');
  });

  // A rota responde 404 quando o segredo do site não é o da api (a RECU3 simula isso). Para o leitor é "a arena não respondeu" (200, com a tela
  // de erro montada no servidor), e não "ação não encontrada": o 404 da página é só do ticker que não existe. Nenhum detalhe interno na tela.
  test('o segredo recusado pela api vira "a arena não respondeu", e nunca "página não encontrada"', async ({
    page,
    request,
  }) => {
    const response = await page.goto(`${FIXTURE_WEB_URL}/acoes/RECU3`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expectApiDown(page);
    const html = await (await request.get(`${FIXTURE_WEB_URL}/acoes/RECU3`)).text();
    for (const detail of [
      'QUOTES_REFUSED',
      'QUOTES_SECRET',
      QUOTES_SECRET,
      'Bearer',
      '/interno/',
    ]) {
      expect(html, detail).not.toContain(detail);
    }
    // a ação que não existe continua sendo 404 (a leitura da ação, e não a das barras, decide)
    expect((await page.goto(`${FIXTURE_WEB_URL}/acoes/ZZZZ3`))?.status()).toBe(404);
  });

  test('a rota interna da api falsa recusa quem não traz o segredo, como a de verdade', async ({
    request,
  }) => {
    const url = `${FIXTURE_API_URL}/api/v1/interno/barras/COTA3`;
    expect((await request.get(url)).status()).toBe(404);
    expect((await request.get(url, { headers: { Authorization: 'Bearer errado' } })).status()).toBe(
      404,
    );
    const right = await request.get(url, { headers: { Authorization: `Bearer ${QUOTES_SECRET}` } });
    expect(right.status()).toBe(200);
  });

  // O cache de dados do Next guarda a leitura das barras com a tag `arena` e 300 s, como as da API pública: a segunda visita não vai à api, e
  // o POST /interno/revalidar que o worker faz depois da liquidação a leva de novo. Sem as tags, a barra nova só apareceria em 5 minutos.
  test.describe('cache e revalidação das barras', () => {
    test.setTimeout(120_000);

    test('uma leitura só por 5 minutos, e a revalidação do worker vence a tag', async ({
      page,
      request,
    }) => {
      // os três projetos rodam este teste ao mesmo tempo e ele zera e conta as leituras: um de cada vez
      await request.post(`${FIXTURE_API_URL}/__test/lock`, { timeout: 100_000 });
      try {
        const reads = async () =>
          (
            (await (
              await request.get(`${FIXTURE_API_URL}/__test/leituras?ticker=CACH3`)
            ).json()) as {
              leituras: number;
            }
          ).leituras;
        const revalidate = () =>
          request.post(`${FIXTURE_WEB_URL}/interno/revalidar`, {
            headers: { Authorization: `Bearer ${REVALIDATE_SECRET}` },
          });

        expect((await revalidate()).status()).toBe(200);
        await request.post(`${FIXTURE_API_URL}/__test/zerar`);
        await page.goto(`${FIXTURE_WEB_URL}/acoes/CACH3`);
        await expect(region(page, 'Cotações recentes')).toContainText('1 pregões');
        expect(await reads()).toBe(1);

        // a segunda visita sai do cache de dados: a api não é consultada
        await page.reload();
        await expect(region(page, 'Cotações recentes')).toContainText('1 pregões');
        expect(await reads()).toBe(1);

        // depois da revalidação, a primeira leitura vai buscar
        expect((await revalidate()).status()).toBe(200);
        await page.reload();
        await expect(region(page, 'Cotações recentes')).toContainText('1 pregões');
        expect(await reads()).toBe(2);
      } finally {
        await request.post(`${FIXTURE_API_URL}/__test/unlock`);
      }
    });
  });
});

test.describe('ciclo', () => {
  test('HOLD forçado e itens descartados aparecem com o motivo; o texto do modelo é texto', async ({
    page,
  }) => {
    await page.goto(`${FIXTURE_WEB_URL}/ciclos/2026-11-04`);
    const decisions = region(page, 'Decisões');
    const cards = decisions.getByRole('article');
    await expect(cards).toHaveCount(2);

    const decided = cards.nth(0);
    await expect(decided.getByRole('heading', { level: 3 })).toHaveText('Modelo de teste');
    // o resumo do modelo traz <, & e aspas: aparece como veio, uma vez só
    await expect(decided).toContainText('Resumo do modelo de teste com <3 e "aspas" & mais.');
    await expect(decided.locator('[data-action="BUY"]')).toHaveCount(1);
    await expect(
      decided.getByRole('listitem').filter({ hasText: 'Compra de teste.' }),
    ).toContainText('10% do patrimônio');
    await expect(
      decided.getByRole('list', { name: 'Itens descartados' }).getByRole('listitem'),
    ).toHaveText(['Item 2: acima do limite de ordens por ciclo', 'Item 3: ação fora do universo']);

    const late = cards.nth(1);
    await expect(late.getByRole('heading', { level: 3 })).toHaveText('Modelo atrasado');
    await expect(late).toContainText('HOLD forçado: fora do prazo');
    await expect(late.locator('[data-action]')).toHaveCount(0);
  });

  test('o ciclo pulado diz por quê e que nenhum modelo foi chamado', async ({ page }) => {
    await page.goto(`${FIXTURE_WEB_URL}/ciclos/2026-11-05`);
    await expect(fact(region(page, 'Horários'), 'Situação')).toHaveText(
      'Pulado: o briefing não foi congelado',
    );
    await expect(region(page, 'Prompt e briefing')).toContainText(
      'Sem prompt nem briefing registrados.',
    );
    await expect(region(page, 'Decisões')).toContainText('Nenhum modelo foi chamado neste ciclo.');
  });
});

test.describe('notícias', () => {
  test('título com caracteres especiais aparece como texto, sem virar HTML', async ({ page }) => {
    await page.goto(`${FIXTURE_WEB_URL}/noticias?ticker=ESPC3`);
    const item = page.getByRole('list', { name: 'Notícias' }).getByRole('listitem');
    await expect(item).toHaveCount(1);
    const link = item.getByRole('link', { name: /Fed/ });
    await expect(link).toContainText('Fed & "juros" <3 &amp; mais');
    await expect(link).toHaveAttribute('href', 'https://noticias.invalid/fixture/especial');
  });
});

// A leitura da api que falha vira uma tela montada NO SERVIDOR (src/lib/with-api-down.tsx), com o cabeçalho e o rodapé, o aviso fixo
// inclusive. O React não renderiza o error.tsx no servidor: uma página que lançasse responderia 500 com um corpo só de scripts, em
// branco para quem não roda JavaScript, um rastreador ou a prévia de um link (docs/TELAS.md, seção 2). O preço é a resposta 200
// (o Next não deixa a página escolher o status), com `noindex` na tela.
const API_DOWN = 'Não foi possível carregar os dados';
const NOTICE = 'não se responsabiliza pelas decisões do usuário';

async function expectApiDown(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: API_DOWN })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  await expect(main.getByRole('link', { name: 'Tentar de novo' })).toBeVisible();
  // o cabeçalho e o aviso fixo estão na tela, como em todas
  await expect(page.getByRole('banner').getByRole('link', { name: 'Alvesting' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText(NOTICE);
  // a tela de erro não vale como página
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  // nenhum detalhe interno chega a quem lê
  const html = await page.content();
  for (const detail of ['falha simulada da api', 'INTERNAL_ERROR', FIXTURE_API_URL, 'ApiError']) {
    expect(html, detail).not.toContain(detail);
  }
}

test.describe('erro', () => {
  test('a api fora do ar vira uma tela de erro com texto útil, o aviso fixo e nenhum detalhe interno', async ({
    page,
  }) => {
    const response = await page.goto(`${FIXTURE_WEB_URL}/acoes/ERRO3`);
    expect(response?.status()).toBe(200);
    // uma resposta 200 com a tela de erro nunca pode ficar guardada por um cache no caminho
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expectApiDown(page);
  });
});

// A tela de erro existe sem JavaScript: o servidor a monta, e o "Tentar de novo" é um link que recarrega a página.
test.describe('erro sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('a tela de erro, o aviso fixo e o link para tentar de novo estão no HTML', async ({
    page,
    request,
  }) => {
    await page.goto(`${FIXTURE_WEB_URL}/acoes/ERRO3`);
    await expectApiDown(page);

    // o que um rastreador ou a prévia de um link recebe: o texto está na resposta, não depende de script
    const html = await (await request.get(`${FIXTURE_WEB_URL}/acoes/ERRO3`)).text();
    expect(html).toContain(API_DOWN);
    expect(html).toContain(NOTICE);
    expect(html).toContain('noindex');
  });
});

test.describe('erro passageiro', () => {
  test('"Tentar de novo" recarrega a página, e os dados voltam', async ({ page }, testInfo) => {
    // Cada tentativa usa um ticker novo: a api falsa falha a primeira leitura de cada um, e a segunda vai para o cache de dados do
    // site (300 s). Com um ticker fixo o teste só passaria uma vez por servidor, e `--repeat-each` e as novas tentativas do CI o
    // reprovariam. A letra do projeto separa os três, que rodam ao mesmo tempo; a da tentativa, as repetições.
    const project = { 'pixel-7': 'K', 'iphone-15': 'L', desktop: 'M' }[testInfo.project.name]!;
    const attempt = String.fromCharCode(
      65 + ((testInfo.repeatEachIndex * 3 + testInfo.retry) % 26),
    );
    const ticker = `FL${project}${attempt}3`;

    const response = await page.goto(`${FIXTURE_WEB_URL}/acoes/${ticker}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: API_DOWN })).toBeVisible();
    await page.getByRole('link', { name: 'Tentar de novo' }).click();
    await expect(page.getByRole('heading', { level: 1, name: ticker })).toBeVisible();
    await expect(page.getByRole('heading', { name: API_DOWN })).toHaveCount(0);
  });
});

// Texto de terceiro (o resumo e a justificativa do modelo, o título da notícia) pode ter uma palavra longa sem espaço: uma hashtag, uma
// URL colada. A página a quebra em vez de rolar na horizontal, em 360 e 320 px. A api falsa traz uma palavra de 100 caracteres.
test.describe('texto de terceiro sem espaço', () => {
  for (const width of [360, 320]) {
    for (const path of ['/ciclos/2026-11-06', '/acoes/LONG3', '/noticias?ticker=LONG3']) {
      test(`${path} em ${width} px não rola na horizontal`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${FIXTURE_WEB_URL}${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // a palavra longa está na tela (sem ela a medida não vale nada)
        await expect(page.getByText('W'.repeat(100)).first()).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      });
    }
  }
});

test.describe('cache de dados e revalidação', () => {
  test.setTimeout(120_000);

  test('a página só muda depois do POST /interno/revalidar, o que o worker chama depois da liquidação', async ({
    page,
    request,
  }) => {
    // os três projetos rodam este teste ao mesmo tempo, e ele troca o dado e revalida: um de cada vez
    await request.post(`${FIXTURE_API_URL}/__test/lock`, { timeout: 100_000 });
    try {
      const setTitle = (valor: string) =>
        request.post(`${FIXTURE_API_URL}/__test/titulo?valor=${encodeURIComponent(valor)}`);
      const revalidate = () =>
        request.post(`${FIXTURE_WEB_URL}/interno/revalidar`, {
          headers: { Authorization: `Bearer ${REVALIDATE_SECRET}` },
        });
      const title = page
        .getByRole('list', { name: 'Notícias' })
        .getByRole('link', { name: /Versão/ });

      await setTitle('Versão A');
      expect((await revalidate()).status()).toBe(200);
      await page.goto(`${FIXTURE_WEB_URL}/noticias?ticker=CACH3`);
      await expect(title).toContainText('Versão A');

      // a api já mudou, e a página continua com o dado do cache (300 s)
      await setTitle('Versão B');
      await page.reload();
      await expect(title).toContainText('Versão A');

      // depois da revalidação, a primeira leitura traz o dado novo
      expect((await revalidate()).status()).toBe(200);
      await page.reload();
      await expect(title).toContainText('Versão B');
    } finally {
      await request.post(`${FIXTURE_API_URL}/__test/unlock`);
    }
  });
});
