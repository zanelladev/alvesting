import { expect, test } from '@playwright/test';
import { envelopeSchema, healthResponseSchema, legalSchema } from '@alvesting/contracts';
import { API_URL } from './api-server';

// Smoke do deploy (docs/DEPLOY.md, seção 1). Roda contra qualquer BASE_URL: o deploy.yml o chama no Front Door VERDE (o endpoint que leva ao label
// green da revisão nova, ANTES de ela receber tráfego) e no de produção, em pixel-7 e iphone-15. No CI ele roda também no build local, nos três
// projetos.
//
// Só entra o que vale para um site de verdade e que a borda não muda: status, o envelope do health e a tela em 360 px.
// O que depende do servidor local (trava de origem, cabeçalhos, acessibilidade) fica em home.spec.ts e origin-lock.spec.ts.
//
// A ORDEM DO DEPLOY (ADR 0029): a api vira antes do web, e o web novo é provado contra a api nova. Por isso os testes que SÓ falam com a api levam
// a etiqueta `@api`: a prova da api (`--grep @api`) não abre página nenhuma, porque o web verde ainda é o do deploy anterior, e a prova do web e a
// de produção rodam o arquivo inteiro. Teste novo que só chama a api leva a etiqueta; o que abre página, não. Nenhum teste espera a virada: o
// código novo é provado antes dela, pelo mesmo Front Door, então não há teste "só depois".
const API_ONLY = { tag: '@api' };

// Atrás do Front Door o site e a api dividem a origem (/api/* vai para a api). No build local a api tem porta própria;
// E2E_API_URL cobre o resto (por exemplo, as duas imagens Docker em portas diferentes).
const apiBase = process.env.E2E_API_URL?.trim() || process.env.BASE_URL?.trim() || API_URL;

test.describe('smoke', () => {
  // O goto não falha com 403, 404 ou 502: a checagem do status é explícita. Um recurso com erro (JS, CSS ou fonte
  // barrado pela borda) deixaria a página sem estilo e sem hidratar, e o h1 do HTML sozinho não mostraria isso.
  test('a home responde 200, mostra o h1 e carrega todos os recursos', async ({ page }) => {
    const failures: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });

    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Alvesting');
    await expect(page.getByRole('heading', { level: 1, name: 'Alvesting' })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(failures).toEqual([]);
  });

  test('a home não rola na horizontal em 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    // Sem o h1 a medida não vale nada: uma página de erro curta também "não rola".
    await expect(page.getByRole('heading', { level: 1, name: 'Alvesting' })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  // A faixa de cotações da home lê o BOVA11 pela rota interna da api, com o segredo do site (docs/API.md, seção 6; ADR 0033). Se o segredo do
  // site não for o da api, a rota responde 404 e a home vira a tela "Não foi possível carregar os dados": sem o h1 do teste acima e sem esta
  // região. É o que a prova da revisão nova mostra antes de ela receber tráfego. Banco sem barra (o primeiro deploy) diz "sem dado": o que
  // conta é a faixa estar lá, e o crédito das cotações no rodapé.
  test('a home mostra a faixa de cotações (o BOVA11 pela rota interna) e o crédito da brapi', async ({
    page,
  }) => {
    await page.goto('/');
    const quotes = page.getByRole('region', { name: 'Cotações e macro', exact: true });
    await expect(quotes).toBeVisible();
    await expect(quotes.locator('dt:text-is("BOVA11")')).toBeVisible();
    await expect(
      page.getByRole('contentinfo').getByRole('link', { name: /^brapi\.dev/ }),
    ).toHaveAttribute('href', 'https://brapi.dev/');
  });

  test('o /health do site responde ok, com service web', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      success: true,
      data: { status: 'ok', service: 'web' },
      error: null,
    });
  });

  test('o /api/v1/health da api responde ok, com service api', API_ONLY, async ({ request }) => {
    const response = await request.get(new URL('/api/v1/health', apiBase).href);
    expect(response.status()).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      success: true,
      data: { status: 'ok', service: 'api' },
      error: null,
    });
  });

  // A rota interna de cotações não é para quem vem de fora: sem o segredo ela não entrega barra. Pelo endereço da api é o 404 dela (igual ao da
  // rota que não existe); pelo Front Door o WAF bloqueia todo caminho com `/interno/` (403) antes de chegar à api.
  test(
    'a rota interna de cotações, sem o segredo, não entrega barra',
    API_ONLY,
    async ({ request }) => {
      const response = await request.get(new URL('/api/v1/interno/barras/PETR4', apiBase).href);
      expect([403, 404]).toContain(response.status());
      expect(await response.text()).not.toMatch(/Cents|"bars"/);
    },
  );

  // A conta (etapa 11, parte 2): o que depende de a borda mandar `/api/*` para a api e o resto para o site, e do SSR chegar à api com o
  // X-Azure-FDID. Nada de cadastro nem e-mail: o smoke não cria conta num site de verdade. A tela de entrar lê a api (quais logins
  // ela oferece), então abri-la prova o caminho do site até a api; a conta sem sessão manda para ela.
  test('a tela de entrar abre, e a conta sem sessão manda para ela', async ({ page }) => {
    const response = await page.goto('/entrar');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();

    await page.goto('/conta');
    await expect(page).toHaveURL(/\/entrar\?proximo=%2Fconta$/);
  });

  test(
    'os textos legais saem da api pelo endereço dela, sem cache',
    API_ONLY,
    async ({ request }) => {
      const response = await request.get(new URL('/api/v1/legal', apiBase).href);
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');
      const body = envelopeSchema(legalSchema).parse(await response.json());
      expect(body.success && body.data.documents.map((d) => d.document)).toEqual([
        'TERMS',
        'PRIVACY',
      ]);
    },
  );

  // A carteira (etapa 12, parte 2): a página sem sessão manda para a entrada, com a volta para ela, sem chamar a api (sem cookie, o site nem a
  // procura). Nada de login nem de lançamento: o smoke não cria conta num site de verdade. (A api da carteira tem a sonda 401 mais abaixo.)
  test('a carteira sem sessão manda para a entrada, com a volta', async ({ page }) => {
    await page.goto('/carteira');
    await expect(page).toHaveURL(/\/entrar\?proximo=%2Fcarteira$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
  });

  // O painel de admin (etapa 10, parte 2): sem sessão a página manda para a entrada (o site não chama a api de admin). Nada de login nem de
  // conta de admin: o smoke não cria conta num site de verdade.
  test('o painel de admin sem sessão manda para a entrada', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/entrar\?proximo=%2Fadmin$/);
  });

  // E a rota da api de admin, pelo endereço dela, responde 401 e nunca é guardada (a borda não pode ter o `/api/v1/admin/*` na rota com cache).
  test('a api de admin sem sessão responde 401, sem cache', API_ONLY, async ({ request }) => {
    const response = await request.get(new URL('/api/v1/admin/jobs', apiBase).href);
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('no-store');
  });

  // A carteira do usuário (etapa 12) é dado pessoal: sem sessão a api responde 401 e a resposta nunca é guardada (a borda não pode ter o
  // `/api/v1/me/portfolio` na rota com cache). Sem login nem conta: o smoke não cria conta num site de verdade.
  test('a carteira da api sem sessão responde 401, sem cache', API_ONLY, async ({ request }) => {
    const response = await request.get(new URL('/api/v1/me/portfolio', apiBase).href);
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });

  // O POST do login pelo Front Door, o que os GETs acima não provam: `/api/auth/*` chega à api, o Content-Length passa pela borda (a api
  // recusa com 413 o corpo sem tamanho), o WAF e a trava de origem deixam o POST passar, e o PUBLIC_URL da api é a origem do site (o
  // Better Auth recusa com 403 um Origin que não seja ele). Um e-mail que não existe: 401, sem criar conta nem mandar e-mail. Só vale
  // com site e api na mesma origem (o Front Door); a api local do e2e tem outro PUBLIC_URL.
  // Pelo Front Door verde o pedido vai ao endereço do green, mas o Origin é o do site de produção (SITE_URL, que o deploy.yml já tem): é o
  // que um navegador no site de verdade manda, e o único que a api aceita. Sem SITE_URL, o Origin é o do próprio BASE_URL.
  test(
    'o login pelo Front Door chega ao Better Auth, que recusa um e-mail que não existe',
    API_ONLY,
    async ({ request }) => {
      const site = process.env.BASE_URL?.trim();
      test.skip(
        !site || Boolean(process.env.E2E_API_URL?.trim()),
        'só no site publicado, com a api na mesma origem (o Front Door)',
      );
      const origin = new URL(site!).origin;
      const publicOrigin = new URL(process.env.SITE_URL?.trim() || site!).origin;
      const response = await request.post(`${origin}/api/auth/sign-in/email`, {
        headers: { origin: publicOrigin },
        data: { email: 'smoke@example.test', password: 'senha-que-nao-existe-1' },
      });
      expect(response.status()).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' });
    },
  );
});
