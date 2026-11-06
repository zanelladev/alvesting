import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { envelopeSchema, internalBarsSchema } from '@alvesting/contracts';
import { ACCOUNT_API_URL, API_URL, QUOTES_SECRET } from './api-server';
import { TICKER, fetchBars } from './data';
import { FRONT_DOOR_ID } from './locked-server';

// A rota interna de cotações e o segredo do servidor (docs/API.md, seção 6; ADR 0033), no build de produção (apps/api/dist, NODE_ENV=production)
// sobre o banco sintético do ensaio, e o site (apps/web/.next) que a lê. Não roda contra o site publicado (BASE_URL): lá o banco e o segredo
// são os de verdade, e o smoke (smoke.spec.ts) cobre o que vale para ele.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api e do site locais');

const BARS = `${API_URL}/api/v1/interno/barras/${TICKER}`;
const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

test.describe('a rota interna da api', () => {
  test('sem o segredo é um 404 igual ao da rota que não existe, e nunca guardado', async ({
    request,
  }) => {
    const refused = await request.get(BARS);
    const missing = await request.get(`${API_URL}/api/v1/interno/nao-existe/${TICKER}`);
    expect(refused.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect(refused.headers()['cache-control']).toBe('no-store');
    expect(await refused.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: `Cannot GET /api/v1/interno/barras/${TICKER}` },
    });
    expect(await missing.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: `Cannot GET /api/v1/interno/nao-existe/${TICKER}` },
    });
    // nenhuma barra no corpo da recusa
    expect(await refused.text()).not.toMatch(/Cents|"bars"/);
  });

  test('com o segredo errado, ou o certo em outro esquema ou cabeçalho, é o mesmo 404', async ({
    request,
  }) => {
    const attempts = [
      { headers: bearer('segredo-errado-0123456789abcdef0123456789abcdef') },
      { headers: bearer(QUOTES_SECRET.slice(0, -1)) },
      { headers: { Authorization: `Basic ${QUOTES_SECRET}` } },
      { headers: { 'X-Quotes-Secret': QUOTES_SECRET } },
    ];
    for (const attempt of attempts) {
      const response = await request.get(BARS, attempt);
      expect(response.status(), JSON.stringify(Object.keys(attempt.headers))).toBe(404);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await response.text()).not.toContain(QUOTES_SECRET);
    }
    // o segredo na query string não vale
    expect((await request.get(`${BARS}?segredo=${QUOTES_SECRET}`)).status()).toBe(404);
  });

  test('com o segredo certo: 200, no-store, e as barras sintéticas do ensaio no contrato', async ({
    request,
  }) => {
    const response = await request.get(BARS, { headers: bearer(QUOTES_SECRET) });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = envelopeSchema(internalBarsSchema).parse(await response.json());
    expect(body.success && body.data.bars.length).toBeGreaterThan(30);
    // o BOVA11 (a referência) e o papel desconhecido
    expect((await fetchBars(request, 'BOVA11')).length).toBeGreaterThanOrEqual(2);
    expect(await fetchBars(request, 'ZZZZ3')).toEqual([]);
  });

  test('fora do Swagger', async ({ request }) => {
    const doc = await request.get(`${API_URL}/api/docs-json`);
    expect(doc.status()).toBe(200);
    expect(await doc.text()).not.toMatch(/interno|barras|QUOTES/i);
  });

  // A trava de origem (plano 5.4) vem antes do segredo: a api da conta roda como na Azure, com o X-Azure-FDID obrigatório. O segredo certo,
  // sem a origem, não abre nada; a origem, sem o segredo, só dá o 404.
  test('atrás da trava de origem: sem o X-Azure-FDID é 403 até com o segredo; com ele, o segredo decide', async ({
    request,
  }) => {
    const url = `${ACCOUNT_API_URL}/api/v1/interno/barras/${TICKER}`;
    const origin = { 'X-Azure-FDID': FRONT_DOOR_ID };
    expect((await request.get(url, { headers: bearer(QUOTES_SECRET) })).status()).toBe(403);
    expect((await request.get(url, { headers: origin })).status()).toBe(404);
    expect(
      (await request.get(url, { headers: { ...origin, ...bearer(QUOTES_SECRET) } })).status(),
    ).toBe(200);
  });
});

// Nenhuma rota pública devolve cotação bruta, na api de produção sobre o banco do ensaio (que tem barras para toda ação): a mesma varredura do
// teste de integração, agora no build que roda no e2e. O contrato (public-quotes.spec.ts) guarda os schemas.
test.describe('a API pública não entrega cotação bruta', () => {
  const RAW_FIELD =
    /^(open|high|low|close|previousClose|prevClose|volume|bid|ask)(Cents)?$|^(bars|bova11)$/i;
  function rawFields(value: unknown, where = '$', found: string[] = []): string[] {
    if (Array.isArray(value)) {
      value.forEach((item, index) => rawFields(item, `${where}[${index}]`, found));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (RAW_FIELD.test(key)) found.push(`${where}.${key}`);
        rawFields(item, `${where}.${key}`, found);
      }
    }
    return found;
  }

  test('nem o arena/current, nem a ação, nem o competidor, nem o ranking trazem barra, OHLC ou o BOVA11', async ({
    request,
  }) => {
    const urls = [
      '/arena/current',
      '/seasons',
      '/seasons/ensaio/leaderboard',
      '/seasons/ensaio/equity',
      '/seasons/ensaio/random-baseline',
      '/competitors/gpt-6-1-sol',
      '/competitors/igual-peso',
      '/cycles/2026-11-04',
      '/decisions?limit=100',
      '/news?limit=100',
      '/stocks?q=MO',
      `/stocks/${TICKER}`,
      '/stocks/SINA3',
    ];
    for (const url of urls) {
      const response = await request.get(`${API_URL}/api/v1${url}`);
      expect(response.status(), url).toBe(200);
      expect(rawFields(await response.json()), url).toEqual([]);
    }
    // o BOVA11 não é ação da API pública: a rota da ação o recusa, e a busca não o acha
    expect((await request.get(`${API_URL}/api/v1/stocks/BOVA11`)).status()).toBe(404);
  });

  // O igual-peso segura o universo inteiro e o BOVA11 um papel só: a composição da carteira deles (caixa e posições, com a marcação do dia) seria o
  // fechamento de todo papel, todo pregão, e `(patrimônio − caixa) ÷ quantidade` devolveria o do BOVA11 (ADR 0033). Só o modelo a traz.
  test('o Sorteio e as referências não trazem a composição da carteira, e a ação só lista os modelos entre os donos', async ({
    request,
  }) => {
    const composition =
      /"(positions|cashCents|positionsValueCents|markCents|valueCents|avgPriceCents|costCents|quantity)"/;
    for (const slug of ['igual-peso', 'bova11', 'sorteio', 'cdi']) {
      const body = (await (await request.get(`${API_URL}/api/v1/competitors/${slug}`)).json()) as {
        data: { portfolio: { holdings: unknown } };
      };
      expect(body.data.portfolio.holdings, slug).toBeNull();
      expect(JSON.stringify(body), slug).not.toMatch(composition);
    }
    const model = (await (
      await request.get(`${API_URL}/api/v1/competitors/gpt-6-1-sol`)
    ).json()) as { data: { portfolio: { holdings: { positions: unknown[] } } } };
    expect(model.data.portfolio.holdings.positions.length).toBeGreaterThan(0);
    const stock = (await (await request.get(`${API_URL}/api/v1/stocks/${TICKER}`)).json()) as {
      data: { holders: Array<{ competitor: { type: string } }> };
    };
    expect(stock.data.holders.length).toBeGreaterThan(0);
    expect(stock.data.holders.every((holder) => holder.competitor.type === 'MODEL')).toBe(true);
  });
});

// O segredo é só do servidor (src/lib/quotes.ts): não pode estar na página, no JavaScript que o navegador baixa, no estático do build nem no
// cache de dados do servidor. O valor é o do e2e (api-server.ts), conhecido: se aparecer em qualquer um, o teste diz onde.
test.describe('o segredo das cotações não vaza do servidor do site', () => {
  const WEB = path.resolve(process.cwd());
  const walk = (dir: string, found: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file, found);
      else found.push(file);
    }
    return found;
  };
  const scan = (dir: string): string[] =>
    walk(dir)
      .filter((file) => readFileSync(file).includes(QUOTES_SECRET))
      .map((file) => path.relative(WEB, file));

  async function assets(request: APIRequestContext, html: string): Promise<string[]> {
    const urls = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)].map(
      (match) => match[1]!,
    );
    return Promise.all(urls.map(async (url) => (await request.get(url)).text()));
  }

  test('nem na página, nem nos scripts e estilos que ela carrega', async ({ request }) => {
    for (const page of ['/', `/acoes/${TICKER}`, '/ranking', '/noticias', '/como-funciona']) {
      const response = await request.get(page);
      expect(response.status(), page).toBe(200);
      const html = await response.text();
      expect(html, page).not.toContain(QUOTES_SECRET);
      // o nome da variável também não: nenhum código de cliente a conhece
      expect(html, page).not.toContain('QUOTES_SECRET');
      const loaded = await assets(request, html);
      expect(loaded.length, `${page}: scripts carregados`).toBeGreaterThan(0);
      for (const [index, text] of loaded.entries()) {
        expect(text, `${page}: arquivo ${index}`).not.toContain(QUOTES_SECRET);
        expect(text, `${page}: arquivo ${index}`).not.toContain('QUOTES_SECRET');
      }
    }
  });

  test('nem no .next/static, nem no cache de dados em disco, nem no código do servidor', () => {
    const next = path.join(WEB, '.next');
    expect(statSync(path.join(next, 'static')).isDirectory()).toBe(true);
    // o que o navegador pode baixar: o valor e o nome da variável não estão em nenhum arquivo
    const staticFiles = walk(path.join(next, 'static'));
    expect(staticFiles.length).toBeGreaterThan(5);
    for (const file of staticFiles) {
      const content = readFileSync(file);
      expect(content.includes(QUOTES_SECRET), path.relative(WEB, file)).toBe(false);
      expect(content.includes('QUOTES_SECRET'), path.relative(WEB, file)).toBe(false);
    }
    // o servidor lê a variável do ambiente na hora: o valor nunca é gravado no build (.next/server), no standalone que sobe na imagem (o
    // código, o estático copiado e o cache de dados do Next) nem no cache de dados em disco (a chave é um hash e o corpo guardado é a
    // resposta da api, sem o cabeçalho da requisição)
    expect(scan(path.join(next, 'server'))).toEqual([]);
    const standalone = path.join(next, 'standalone', 'apps', 'web', '.next');
    expect(statSync(standalone).isDirectory()).toBe(true);
    expect(scan(standalone)).toEqual([]);
  });
});
