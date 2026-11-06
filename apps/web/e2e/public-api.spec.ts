import { expect, test } from '@playwright/test';
import {
  PUBLIC_CACHE_CONTROL,
  arenaCurrentSchema,
  decisionsPageSchema,
  envelopeSchema,
  equitySchema,
  leaderboardSchema,
  newsPageSchema,
  randomBaselineSchema,
  stockDetailSchema,
} from '@alvesting/contracts';
import { API_URL } from './api-server';

// A API pública (docs/API.md) no build de produção (apps/api/dist, NODE_ENV=production), sobre o banco do e2e semeado com uma
// temporada inteira e sintética pelo driver do ensaio (docs/ENSAIO.md): é o dado que as telas da arena vão ler. Nada de B3, CVM,
// BCB nem site de notícia. Roda nos três projetos (mobile é gate de merge). Não roda contra o site publicado (BASE_URL), que não
// tem este banco.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local com o banco semeado');

const api = (path: string) => `${API_URL}/api/v1${path}`;

test.describe('API pública sobre a temporada sintética', () => {
  test('o arena/current traz a temporada, o último ciclo, o macro e o topo do ranking, com cache público', async ({
    request,
  }) => {
    const response = await request.get(api('/arena/current'));
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    const current = envelopeSchema(arenaCurrentSchema).parse(await response.json());
    expect(current.success).toBe(true);
    const data = current.success ? current.data : undefined;
    expect(data?.season).toMatchObject({
      slug: 'ensaio',
      status: 'FINISHED',
      settledThrough: '2026-11-09',
    });
    expect(data?.season?.params.sessions).toBe(5);
    expect(data?.lastCycle?.date).toBe('2026-11-09');
    // a temporada acabou: não há próximo ciclo para contar
    expect(data?.nextCycle).toBeNull();
    expect(data?.lastCycle?.prompt?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data?.macro.cdi?.value).toMatch(/^\d+\.\d+$/);
    expect(data?.top).toHaveLength(5);
  });

  test('o ranking, o patrimônio e o Monte Carlo da temporada', async ({ request }) => {
    const board = envelopeSchema(leaderboardSchema).parse(
      await (await request.get(api('/seasons/ensaio/leaderboard'))).json(),
    );
    expect(board.success && board.data.rows.map((r) => r.competitor.type).sort()).toEqual([
      'BOVA11',
      'CDI',
      'EQUAL_WEIGHT',
      'MODEL',
      'MODEL',
      'MODEL',
      'MODEL',
      'MODEL',
      'MODEL',
      'RANDOM',
    ]);
    const equity = envelopeSchema(equitySchema).parse(
      await (await request.get(api('/seasons/ensaio/equity'))).json(),
    );
    expect(equity.success && equity.data.dates).toHaveLength(5);
    const baseline = envelopeSchema(randomBaselineSchema).parse(
      await (await request.get(api('/seasons/ensaio/random-baseline'))).json(),
    );
    expect(baseline.success && baseline.data.rows).toHaveLength(5);
  });

  test('o feed de decisões pagina por cursor, sem repetir linha, e filtra por ação', async ({
    request,
  }) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = api(`/decisions?limit=7${cursor ? `&cursor=${cursor}` : ''}`);
      const page = envelopeSchema(decisionsPageSchema).parse(await (await request.get(url)).json());
      if (!page.success) throw new Error('feed falhou');
      seen.push(...page.data.rows.map((r) => `${r.date}:${r.competitor.slug}`));
      cursor = page.data.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(30); // 5 pregões x 6 modelos
    expect(new Set(seen).size).toBe(30);
    const buys = envelopeSchema(decisionsPageSchema).parse(
      await (await request.get(api('/decisions?action=BUY&limit=100'))).json(),
    );
    expect(
      buys.success && buys.data.rows.every((r) => r.items.some((i) => i.action === 'BUY')),
    ).toBe(true);
  });

  test('notícias com título, fonte, hora e link; nunca o trecho', async ({ request }) => {
    const page = envelopeSchema(newsPageSchema).parse(
      await (await request.get(api('/news?limit=50'))).json(),
    );
    expect(page.success && page.data.rows.length).toBeGreaterThan(10);
    const text = JSON.stringify(page);
    expect(text).not.toContain('snippet');
    expect(page.success && page.data.rows.every((n) => /^https?:\/\//.test(n.url))).toBe(true);
  });

  test('a página da ação traz quem a tem, as decisões e as notícias, e nenhuma barra de preço', async ({
    request,
  }) => {
    const detail = envelopeSchema(stockDetailSchema).parse(
      await (await request.get(api('/stocks/MOVE3'))).json(),
    );
    expect(detail.success && detail.data.season?.slug).toBe('ensaio');
    // a cotação bruta saiu da API pública (docs/API.md, seção 6): as barras só pela rota interna do site
    expect(detail.success && 'bars' in detail.data).toBe(false);
  });

  test('nenhuma rota pública devolve o prompt, o IO bruto, endereço de Blob ou trecho de notícia', async ({
    request,
  }) => {
    for (const path of [
      '/arena/current',
      '/seasons',
      '/seasons/ensaio/leaderboard',
      '/competitors/gpt-6-1-sol',
      '/cycles/2026-11-04',
      '/decisions?limit=100',
      '/news?limit=100',
      '/stocks/MOVE3',
    ]) {
      const text = await (await request.get(api(path))).text();
      for (const forbidden of [
        'alv-canary',
        'blob.core.windows.net',
        'devstoreaccount1',
        '25100',
        '"snippet"',
        '"ioUris"',
        '"uri"',
        'pricingUsdPerMTok',
      ]) {
        expect(text, `${path}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  test('erro é 400 ou 404 no envelope, e nunca vai para o cache', async ({ request }) => {
    for (const [path, status] of [
      ['/seasons/nao-existe/leaderboard', 404],
      ['/decisions?action=buy', 400],
      ['/cycles/2026-02-30', 400],
      ['/stocks/ZZZZ3', 404],
      // o que o Zod aceitaria e o Postgres recusaria (NUL em texto, ano 0000) é recusado na borda, nunca 500
      ['/stocks?q=%00', 400],
      ['/cycles/0000-01-01', 400],
      // parâmetro desconhecido é 400 em toda rota: ?x=<aleatório> seria uma chave nova no cache da borda
      ['/arena/current?x=1', 400],
      ['/seasons/ensaio/leaderboard?utm_source=google', 400],
      ['/stocks/MOVE3?x=1&x=2', 400],
    ] as const) {
      const response = await request.get(api(path));
      expect(response.status(), path).toBe(status);
      expect(response.headers()['cache-control'], path).toBe('no-store');
      expect(await response.json()).toMatchObject({ success: false, data: null });
    }
  });
});
