import { randomInt } from 'node:crypto';
import { expect, test as base, type Page } from '@playwright/test';
import { PASSWORD, NAME, email, legal, mailTo } from './account-support';
import { ECO_API_URL, ECO_OUTBOX_DIR, ECO_SITE_URL, QUOTES_SECRET } from './api-server';

// O perfil econômico, sem Front Door (ADR 0039; docs/INFRA.md, 2.7): o navegador fala com UMA origem só, o site, e o site repassa /api/* à api
// (API_PROXY=on, src/lib/api-proxy.ts), que nada mais alcança. Na frente do site, um ingress imitado do Container Apps (e2e/ingress.ts, porta
// 4314), em https: ele termina o TLS (então a api emite o cookie de produção, `Secure` e com o prefixo `__Secure-`) e acrescenta o IP do cliente
// à direita do X-Forwarded-For, como o de verdade. Nenhum Front Door imitado: o que o padrão faz na borda, aqui é o site. Tudo sintético
// (@example.test), e o e-mail cai numa pasta.
//
// O IP de cada teste é público (198.18.0.0/15, a faixa de testes de rede, RFC 2544): a api do econômico pula, no X-Forwarded-For, os saltos de
// endereço privado (o ingress interno da api, entre o site e ela: auth.ts, trustedProxies), então um IP de cliente 10.x seria pulado também.
const clientIp = () => `198.${18 + randomInt(2)}.${randomInt(256)}.${randomInt(1, 255)}`;

const test = base.extend<{ ip: string }>({
  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o objeto de dependências, mesmo vazio
  ip: async ({}, provide) => {
    await provide(clientIp());
  },
  // o IP que o ingress imitado acrescenta (o desvio dele: o de verdade usa o do soquete)
  extraHTTPHeaders: async ({ ip }, provide) => {
    await provide({ 'x-e2e-client-ip': ip });
  },
  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o objeto de dependências, mesmo vazio
  ignoreHTTPSErrors: async ({}, provide) => {
    await provide(true);
  },
});

test.skip(
  Boolean(process.env.BASE_URL),
  'precisa do site com o repasse, da api e do ingress imitado',
);
test.use({ baseURL: ECO_SITE_URL });

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const settled = expect.configure({ timeout: 15_000 });

// Roda nos seis projetos (a etiqueta @tema leva também os três escuros): é o fluxo de quem usa o site no perfil em que a produção nasce.
test(
  'o fluxo inteiro pelo repasse do site: cadastro, link do e-mail, entrar, lançar na carteira e sair',
  { tag: '@tema' },
  async ({ page, request }, info) => {
    const docs = await legal(request, ECO_SITE_URL);
    const terms = docs.documents.find((d) => d.document === 'TERMS')!;
    const privacy = docs.documents.find((d) => d.document === 'PRIVACY')!;
    const address = email('economico');

    await page.goto('/entrar');
    // o tema do aparelho vale na tela que o site serve (o escuro nos projetos `-escuro`): o ingress e o repasse não mexem no HTML
    const dark = info.project.use.colorScheme === 'dark';
    await expect(page.locator('html')).toHaveClass(dark ? /\bdark\b/ : /^(?![\s\S]*\bdark\b)/);

    // cadastrar: o POST /api/auth/sign-up/email do navegador vai ao site, e o site o leva à api
    await page.getByRole('main').getByRole('link', { name: 'Criar conta' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeVisible();
    await field(page, 'Nome').fill(NAME);
    await field(page, 'E-mail').fill(address);
    await field(page, 'Senha').fill(PASSWORD);
    await page
      .getByRole('checkbox', { name: `Li e aceito os termos de uso (versão ${terms.version}).` })
      .check();
    await page
      .getByRole('checkbox', {
        name: new RegExp(`^Li e aceito a política de privacidade \\(versão ${privacy.version}\\)`),
      })
      .check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page).toHaveURL(`${ECO_SITE_URL}/verificar-email`);

    // o link do e-mail é PUBLIC_URL/api/auth/...: o 302 da api volta pelo site como veio
    const mail = await mailTo(address, /Confirme/, ECO_OUTBOX_DIR);
    expect(mail.link.startsWith(`${ECO_SITE_URL}/api/auth/verify-email?token=`)).toBe(true);
    await page.goto(mail.link);
    await expect(page).toHaveURL(`${ECO_SITE_URL}/verificar-email?retorno=1`);
    await expect(page.getByRole('heading', { level: 1, name: 'E-mail confirmado' })).toBeVisible();

    // entrar: o Set-Cookie da api passa pelo site, e o navegador guarda o cookie de produção
    await page.getByRole('main').getByRole('link', { name: 'Entrar', exact: true }).click();
    await field(page, 'E-mail').fill(address);
    await field(page, 'Senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(`${ECO_SITE_URL}/conta`);
    await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
    const jar = (await page.context().cookies()).filter((c) => c.name.endsWith('session_token'));
    expect(jar).toHaveLength(1);
    expect(jar[0]).toMatchObject({
      name: '__Secure-alvesting.session_token',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });

    // lançar na carteira, pelo modal: o POST /api/v1/me/portfolio/lots do navegador, com o Origin do site, pelo repasse
    await page.goto('/carteira');
    await expect(page.getByRole('heading', { level: 1, name: 'Minha carteira' })).toBeVisible();
    const lots = page.getByRole('region', { name: 'Lançamentos', exact: true });
    await lots.getByRole('button', { name: 'Lançar compra', exact: true }).click();
    const form = page.getByRole('form', { name: 'Lançar uma compra' });
    await expect(form).toBeVisible();
    await form.getByLabel('Ticker', { exact: true }).fill('MOVE3');
    await form.getByRole('spinbutton', { name: 'Quantidade', exact: true }).fill('100');
    await form.getByRole('textbox', { name: 'Preço por ação em reais' }).fill('35,50');
    await form.getByRole('button', { name: 'Lançar compra' }).click();
    await settled(
      page
        .getByRole('list', { name: 'Avisos', exact: true })
        .getByRole('listitem')
        .filter({ hasText: 'Compra lançada: 100 MOVE3, custo total R$ 3.550,00.' }),
    ).toBeVisible();
    await settled(lots.getByRole('listitem')).toHaveCount(1);

    // sair: a sessão acaba, e a conta volta a mandar para a entrada
    await page.goto('/conta');
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(`${ECO_SITE_URL}/entrar?aviso=saiu`);
    await page.goto('/conta');
    await expect(page).toHaveURL(`${ECO_SITE_URL}/entrar?proximo=%2Fconta`);
  },
);

// O limite de tentativas do login conta o IP que o ingress escreveu (a entrada da direita), e não o que o cliente escreveu à esquerda: o site
// regrava o X-Forwarded-For com um valor só antes de repassar (src/lib/api-proxy.ts), e a api pula os saltos privados (auth.ts).
test('um X-Forwarded-For forjado pelo cliente não escapa do limite do login passando pelo site', async ({
  request,
}) => {
  const signIn = (headers: Record<string, string>) =>
    request.post('/api/auth/sign-in/email', {
      headers: { origin: ECO_SITE_URL, ...headers },
      data: { email: email('limite'), password: 'senha-errada-do-teste' },
    });
  const statuses: number[] = [];
  // cada tentativa com um X-Forwarded-For forjado diferente: sem a regravação, cada uma cairia num balde novo
  for (let i = 0; i < 4; i++) {
    statuses.push((await signIn({ 'x-forwarded-for': `${clientIp()}, ${clientIp()}` })).status());
  }
  expect(statuses).toEqual([401, 401, 401, 429]);
  // o mesmo cliente sem forjar nada segue no limite
  expect((await signIn({})).status()).toBe(429);
  // outro cliente (outro IP no ingress) não é afetado
  expect((await signIn({ 'x-e2e-client-ip': clientIp() })).status()).toBe(401);
});

// O repasse nunca leva /api/v1/interno/* (as cotações e os logos que só o SSR do site lê): 404 igual ao da rota que não existe, como o WAF do
// padrão faz na borda. A rota existe e o segredo é o certo: direto na api (o que só os apps do ambiente alcançam na Azure), ela responde.
test('o site nunca repassa /api/v1/interno/*, nem com o segredo certo, e repassa o resto da api', async ({
  request,
}) => {
  const auth = { authorization: `Bearer ${QUOTES_SECRET}` };
  expect(
    (await request.get(`${ECO_API_URL}/api/v1/interno/fita`, { headers: auth })).status(),
  ).toBe(200);
  for (const path of [
    '/api/v1/interno/fita',
    '/api/v1/INTERNO/fita',
    '/api/v1/%69nterno/fita',
    '/api/v1/interno/barras/PETR4',
    '/api/v1/interno/logos',
  ]) {
    const viaSite = await request.get(path, { headers: auth });
    expect(viaSite.status(), path).toBe(404);
    expect(viaSite.headers()['cache-control'], path).toBe('no-store');
    expect(await viaSite.json(), path).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  }
  // o resto chega à api: o health dela (e não o do site) e os textos legais sem cache
  const health = await request.get('/api/v1/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ data: { service: 'api' } });
  const site = await request.get('/health');
  expect(await site.json()).toMatchObject({ data: { service: 'web' } });
  const legalText = await request.get('/api/v1/legal');
  expect(legalText.status()).toBe(200);
  expect(legalText.headers()['cache-control']).toBe('no-store');
});
