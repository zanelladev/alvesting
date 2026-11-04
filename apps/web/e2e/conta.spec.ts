import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { REAUTH_REQUIRED, envelopeSchema, meSchema, userExportSchema } from '@alvesting/contracts';
import {
  NAME,
  PASSWORD,
  consentOf,
  contextOptions,
  email,
  fakeIp,
  legal,
  mailTo,
  registerUnverifiedUser,
  registerVerifiedUser,
  signInViaApi,
  test,
} from './account-support';
import { ACCOUNT_API_URL, ACCOUNT_WEB_URL, FRONT_DOOR_URL } from './api-server';

// As telas da conta (etapa 11, parte 2; docs/CONTA.md, seção 9), em pixel-7, iphone-15 (WebKit) e desktop, como todo e2e. O navegador
// fala com UMA origem só, o Front Door imitado (e2e/front-door.ts, porta 4311): `/api/*` vai para a api da conta (4308) e o resto para o
// site da conta (4309), cada um atrás da trava de origem, como na Azure. Ele serve https (certificado autoassinado), então a api emite o
// cookie de produção, `Secure` e com o prefixo `__Secure-`, e é ele que o Chromium e o WebKit guardam e devolvem aqui. O e-mail cai numa
// pasta (nada sai da máquina), o Google não participa, e todo dado pessoal é sintético (@example.test). Cada teste tem o e-mail e o IP
// dele: os três projetos rodam juntos.
test.skip(Boolean(process.env.BASE_URL), 'precisa do Front Door imitado e dos servidores da conta');
test.use({ baseURL: FRONT_DOOR_URL });

const dmy = (iso: string) => iso.split('-').reverse().join('/');
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const alertWith = (page: Page, text: string | RegExp) =>
  // o anunciador de rotas do Next também tem role=alert: filtra pelo texto
  page.getByRole('alert').filter({ hasText: text });

async function signIn(page: Page, address: string, password: string) {
  await field(page, 'E-mail').fill(address);
  await field(page, 'Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test.describe('o Front Door imitado', () => {
  test('manda /api/* para a api e o resto para o site, escreve o X-Azure-FDID e deixa as duas origens travadas', async ({
    request,
  }) => {
    const api = await request.get('/api/v1/health');
    expect(await api.json()).toMatchObject({ data: { service: 'api' } });
    const web = await request.get('/health');
    expect(await web.json()).toMatchObject({ data: { service: 'web' } });
    // o cliente não escolhe o X-Azure-FDID: o que ele manda é descartado e o do perfil é escrito
    for (const route of ['/api/v1/legal', '/entrar']) {
      const forged = await request.get(route, { headers: { 'x-azure-fdid': 'forjado' } });
      expect(forged.status(), route).toBe(200);
    }
    // sem passar por ele, direto nas origens, a trava de origem recusa (a api e o site da conta)
    expect((await request.get(`${ACCOUNT_API_URL}/api/v1/legal`)).status()).toBe(403);
    expect((await request.get(`${ACCOUNT_WEB_URL}/entrar`)).status()).toBe(403);
  });
});

test.describe('cadastro, verificação, entrar, conta, exportar, sair e excluir', () => {
  test('o fluxo completo pelas telas: cadastro com aceite, link do e-mail, verificação, entrar, conta, exportar, sair, entrar de novo, excluir e não entrar mais', async ({
    page,
    request,
  }) => {
    const docs = await legal(request);
    const terms = docs.documents.find((d) => d.document === 'TERMS')!;
    const privacy = docs.documents.find((d) => d.document === 'PRIVACY')!;
    const address = email('fluxo');

    // sem sessão, o link fixo do cabeçalho leva à entrada (com o caminho de volta) e dela ao cadastro
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Conta', exact: true }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?proximo=%2Fconta`);
    await page.getByRole('link', { name: 'Criar conta' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeVisible();

    // o aceite é explícito: duas caixas, com a versão vigente de cada texto, e nada vem marcado
    const acceptTerms = page.getByRole('checkbox', {
      name: `Li e aceito os termos de uso (versão ${terms.version}).`,
    });
    const acceptPrivacy = page.getByRole('checkbox', {
      name: new RegExp(`^Li e aceito a política de privacidade \\(versão ${privacy.version}\\)`),
    });
    await expect(acceptTerms).not.toBeChecked();
    await expect(acceptPrivacy).not.toBeChecked();
    await field(page, 'Nome').fill(NAME);
    await field(page, 'E-mail').fill(address);
    await field(page, 'Senha').fill(PASSWORD);
    await acceptTerms.check();
    await acceptPrivacy.check();
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/verificar-email`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Confirme o seu e-mail' }),
    ).toBeVisible();

    // o e-mail falso leva o link absoluto pelo Front Door; abri-lo confirma o endereço e termina na tela de verificação
    const mail = await mailTo(address, /Confirme/);
    expect(mail.link.startsWith(`${FRONT_DOOR_URL}/api/auth/verify-email?token=`)).toBe(true);
    await page.goto(mail.link);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/verificar-email?retorno=1`);
    await expect(page.getByRole('heading', { level: 1, name: 'E-mail confirmado' })).toBeVisible();

    // entrar leva à conta
    await page.getByRole('link', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar`);
    await signIn(page, address, PASSWORD);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);
    await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();

    // o cookie que o NAVEGADOR guardou ao entrar pela tela (Chromium ou WebKit): o de produção, Secure e com o prefixo __Secure- (que o
    // WebKit só aceita em https), HttpOnly (o JavaScript da página não o lê), SameSite=Lax e de 7 dias. A /conta acima só mostrou os dados
    // porque o servidor leu esse cookie com o prefixo e o repassou à api.
    const jar = (await page.context().cookies()).filter((c) => c.name.endsWith('session_token'));
    expect(jar).toHaveLength(1);
    expect(jar[0]).toMatchObject({
      name: '__Secure-alvesting.session_token',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(jar[0]!.expires).toBeGreaterThan(Date.now() / 1000 + 6 * 24 * 3600);
    expect(await page.evaluate(() => document.cookie)).toBe('');

    // os dados mínimos e os aceites, com a versão e a data
    const data = page.getByRole('region', { name: 'Dados', exact: true });
    await expect(data).toContainText(NAME);
    await expect(data).toContainText(address);
    const accepted = page.getByRole('region', { name: 'Termos e privacidade' });
    await expect(accepted).toContainText(
      new RegExp(
        `Termos de uso, versão ${terms.version}: aceito em \\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}`,
      ),
    );
    await expect(accepted).toContainText(
      new RegExp(
        `Política de privacidade, versão ${privacy.version}: aceito em \\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}`,
      ),
    );

    // a carteira (etapa 12; a tela tem o carteira.spec.ts): um lançamento pela api, com a sessão que o navegador guardou, para a exportação
    // abaixo levá-lo e a exclusão da conta, no fim, apagá-lo junto
    const lot = await page.request.post('/api/v1/me/portfolio/lots', {
      headers: { origin: FRONT_DOOR_URL },
      data: {
        ticker: 'MOVE3',
        quantity: 100,
        mode: 'unit',
        valueCents: 3_550,
        boughtOn: '2026-10-15',
      },
    });
    expect(lot.status()).toBe(201);

    // exportar: a tela diz que a carteira vai no arquivo (a política 0.2 promete isso), e o arquivo baixado é o JSON do dono, sem segredo
    await expect(page.getByRole('region', { name: 'Meus dados' })).toContainText(
      'os aceites e a carteira com os lançamentos',
    );
    const downloading = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Baixar meus dados (JSON)' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('alvesting-meus-dados.json');
    const raw = await readFile(await download.path(), 'utf8');
    const exported = envelopeSchema(userExportSchema).parse(JSON.parse(raw));
    if (!exported.success) throw new Error('a exportação veio com erro');
    expect(exported.data.user).toMatchObject({
      email: address,
      name: NAME,
      emailVerified: true,
      role: 'USER',
      image: null,
    });
    expect(exported.data.accounts.map((a) => a.providerId)).toEqual(['credential']);
    expect(exported.data.sessions).toHaveLength(1);
    expect(exported.data.portfolioLots).toMatchObject([
      { ticker: 'MOVE3', quantity: 100, costCents: 355_000, boughtOn: '2026-10-15' },
    ]);
    expect(
      exported.data.consents
        .map((c) => ({ document: c.document, version: c.version, sha256: c.sha256 }))
        .sort((a, b) => a.document.localeCompare(b.document)),
    ).toEqual([
      { document: 'PRIVACY', version: privacy.version, sha256: privacy.sha256 },
      { document: 'TERMS', version: terms.version, sha256: terms.sha256 },
    ]);
    expect(raw).not.toContain(PASSWORD);
    expect(raw).not.toMatch(/"(password|token|accessToken|refreshToken|idToken)"/);

    // sair: a sessão acaba, e a conta volta a mandar para a entrada
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?aviso=saiu`);
    // o aviso sai do servidor, logo abaixo do título: texto simples, e não uma região viva que já nasce com o texto
    await expect(page.getByText('Você saiu da conta.', { exact: true })).toBeVisible();
    await page.goto('/conta');
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?proximo=%2Fconta`);

    // entrar de novo: o caminho de volta leva direto à conta
    await signIn(page, address, PASSWORD);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);

    // excluir: a tela diz o que apaga e o que fica, e só exclui com a confirmação marcada
    const danger = page.getByRole('region', { name: 'Excluir a conta' });
    await expect(danger).toContainText('o seu cadastro (nome e e-mail)');
    await expect(danger).toContainText('o histórico de aceites');
    // a carteira vai junto (a política 0.2, item 5): a tela que exclui diz isso antes do botão
    await expect(danger).toContainText('a sua carteira, com todos os lançamentos');
    await expect(danger).toContainText('As cópias de segurança do banco');
    const confirm = danger.getByRole('checkbox', { name: /exclusão é definitiva/ });
    await expect(confirm).not.toBeChecked();
    await danger.getByRole('button', { name: 'Excluir minha conta' }).click();
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveAccessibleDescription(/Marque a caixa para confirmar/);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);
    await confirm.check();
    await danger.getByRole('button', { name: 'Excluir minha conta' }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?aviso=conta-excluida`);
    await expect(
      page.getByText('Sua conta foi excluída. Os dados foram apagados.', { exact: true }),
    ).toBeVisible();

    // a conta e a sessão sumiram: não entra mais, e a conta continua pedindo a entrada. O limite de tentativas do Better Auth é de 3
    // logins por 10 s, por IP: este teste já fez dois, e o terceiro (este) usa um IP novo, para acrescentar um quarto não virar 429.
    await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': fakeIp() });
    await signIn(page, address, PASSWORD);
    const refused = alertWith(page, 'E-mail ou senha incorretos.');
    await expect(refused).toBeVisible();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?aviso=conta-excluida`);
    await page.goto('/conta');
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?proximo=%2Fconta`);
  });

  test('entrar com a senha errada, ou com o e-mail ainda não confirmado, diz o que houve, no campo certo e com o foco nele', async ({
    page,
    request,
    ip,
  }) => {
    const user = await registerVerifiedUser(request, ip, 'senha-errada');
    const pending = await registerUnverifiedUser(request, ip, 'pendente');

    await page.goto('/entrar');
    await signIn(page, user.email, `${PASSWORD}-errada`);
    const wrong = alertWith(page, 'E-mail ou senha incorretos.');
    await expect(wrong).toBeVisible();
    await expect(wrong).toBeFocused();

    await signIn(page, pending.email, PASSWORD);
    const unverified = alertWith(page, 'Confirme o seu e-mail antes de entrar');
    await expect(unverified).toBeVisible();
    await expect(unverified).toBeFocused();
    await expect(unverified).toContainText('espere 1 minuto');
    await unverified.getByRole('link', { name: 'Reenviar o link de confirmação' }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/verificar-email`);
  });

  // A sessão acaba de nascer, então a api não pede a senha para excluir (ela só pede com mais de 5 minutos, e o e2e não espera isso nem
  // tem como envelhecer a sessão: o banco é da api). A PRIMEIRA ida do DELETE é respondida no navegador com o REAUTH_REQUIRED que a api
  // devolve para a sessão antiga (docs/CONTA.md); as seguintes vão à api de verdade, que confere a senha que a tela mandou: errada é 403
  // INVALID_PASSWORD, certa exclui. O código é o do pacote de contratos, o mesmo que a api devolve e a tela entende; a api devolvendo-o de
  // verdade para a sessão envelhecida no banco é o teste de integração de DELETE /api/v1/me (me.integration.spec.ts).
  test('excluir com a sessão antiga: a tela pede a senha, a errada é recusada e a certa exclui', async ({
    page,
    request,
    ip,
  }) => {
    const user = await registerVerifiedUser(request, ip, 'sessao-antiga');
    await signInViaApi(page.request, user);
    await page.goto('/conta');

    let deletes = 0;
    await page.route('**/api/v1/me', async (route) => {
      if (route.request().method() !== 'DELETE' || ++deletes > 1) return route.continue();
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          data: null,
          error: { code: REAUTH_REQUIRED, message: 'A sessão é antiga' },
        }),
      });
    });

    const danger = page.getByRole('region', { name: 'Excluir a conta' });
    await expect(danger.getByLabel('Senha', { exact: true })).toHaveCount(0);
    await danger.getByRole('checkbox', { name: /exclusão é definitiva/ }).check();
    await danger.getByRole('button', { name: 'Excluir minha conta' }).click();

    // a api pediu a senha: o campo aparece, com o foco e o motivo ligado a ele
    const password = danger.getByLabel('Senha', { exact: true });
    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(password).toHaveAccessibleDescription(/Sua sessão tem mais de 5 minutos/);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);

    // sem a senha, nada vai à api
    await danger.getByRole('button', { name: 'Excluir minha conta' }).click();
    await expect(password).toHaveAccessibleDescription(/Informe a senha para excluir a conta/);
    expect(deletes).toBe(1);

    // a senha errada: a api recusa, a conta fica
    await password.fill(`${PASSWORD}-errada`);
    await danger.getByRole('button', { name: 'Excluir minha conta' }).click();
    await expect(password).toHaveAccessibleDescription(/Senha incorreta\./);
    await expect(password).toBeFocused();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);

    // a senha certa exclui
    await password.fill(PASSWORD);
    await danger.getByRole('button', { name: 'Excluir minha conta' }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?aviso=conta-excluida`);
  });

  test('a tela de verificação: sem o link, com o link vencido e o pedido de um link novo (a resposta é a mesma para qualquer e-mail)', async ({
    page,
  }) => {
    await page.goto('/verificar-email?retorno=1&error=TOKEN_EXPIRED');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Não foi possível confirmar o e-mail' }),
    ).toBeVisible();
    await expect(page.getByRole('main')).toContainText('O link venceu');
    await field(page, 'E-mail do cadastro').fill(email('sem-conta'));
    await page.getByRole('button', { name: 'Reenviar o link' }).click();
    // não diz se existe cadastro com esse e-mail
    await expect(page.getByRole('status')).toContainText(
      'Se existir um cadastro ainda não confirmado com esse e-mail, enviamos um novo link.',
    );
    await expect(page.getByRole('status')).toContainText('espere 1 minuto');
  });
});

test.describe('esqueci a senha', () => {
  test('o link do e-mail leva a uma senha nova, que entra; o link não vale duas vezes e a página dele não entrega a URL', async ({
    page,
    request,
    ip,
  }) => {
    const user = await registerVerifiedUser(request, ip, 'esqueci');
    const nova = 'outra-senha-de-e2e-longa-2';

    await page.goto('/entrar');
    await page.getByRole('link', { name: 'Esqueci a senha' }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/esqueci-senha`);
    await field(page, 'E-mail').fill(user.email);
    await page.getByRole('button', { name: 'Enviar o link' }).click();
    const sent = page.getByRole('status');
    await expect(sent).toContainText(
      'Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.',
    );
    // o foco vai ao aviso (que também rola a tela até ele no celular): o botão que enviou ficou desativado durante o envio
    await expect(sent).toBeFocused();

    const mail = await mailTo(user.email, /Redefina/);
    expect(mail.link.startsWith(`${FRONT_DOOR_URL}/redefinir-senha?token=`)).toBe(true);
    const response = await page.goto(mail.link);
    // o token vai na URL: a página não o entrega a quem ela carregar (Referer) nem o guarda em cache
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await field(page, 'Nova senha').fill(nova);
    await page.getByRole('button', { name: 'Salvar a nova senha' }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?aviso=senha-redefinida`);
    await expect(
      page.getByText('Senha redefinida. Entre com a nova senha.', { exact: true }),
    ).toBeVisible();

    // o "voltar" não devolve a página do token: a entrada /redefinir-senha?token=… foi trocada (replace), e não empilhada; num computador
    // compartilhado, o link aberto e abandonado (vale 30 minutos) não fica no histórico
    await page.goBack();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/esqueci-senha`);
    expect(page.url()).not.toContain('token=');

    // a nova senha entra
    await page.goto('/entrar');
    await signIn(page, user.email, nova);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);

    // o mesmo link não vale duas vezes
    await page.goto(mail.link);
    await field(page, 'Nova senha').fill(`${nova}-3`);
    await page.getByRole('button', { name: 'Salvar a nova senha' }).click();
    const used = alertWith(page, 'Este link venceu ou já foi usado.');
    await expect(used).toBeVisible();
    await expect(used).toBeFocused();
  });

  test('sem o token na URL a tela diz que o link está incompleto e manda pedir outro', async ({
    page,
  }) => {
    await page.goto('/redefinir-senha');
    await expect(page.getByRole('main')).toContainText('Este link está incompleto');
    await page.getByRole('link', { name: 'Pedir um link novo' }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/esqueci-senha`);
  });
});

test.describe('o aceite dos termos e da privacidade', () => {
  test('sem o aceite não há cadastro: cada erro fica ligado ao campo, o foco vai ao primeiro e nada é criado', async ({
    page,
    request,
    ip,
  }) => {
    const address = email('sem-aceite');
    await page.goto('/cadastro');

    // tudo vazio: um erro por campo, e o foco no primeiro
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(field(page, 'Nome')).toBeFocused();
    await expect(field(page, 'Nome')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page, 'Nome')).toHaveAccessibleDescription(/Informe o seu nome/);
    await expect(field(page, 'E-mail')).toHaveAccessibleDescription(/Informe um e-mail válido/);
    await expect(field(page, 'Senha')).toHaveAccessibleDescription(/pelo menos 10 caracteres/);

    // corrigir o campo apaga o erro dele na hora, sem reenviar: o leitor de tela não segue anunciando "inválido" para um campo já
    // corrigido, e a frase velha não contradiz o que a pessoa acabou de fazer. Os outros dois seguem com o erro.
    await field(page, 'Nome').fill(NAME);
    await expect(field(page, 'Nome')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(/Informe o seu nome/)).toHaveCount(0);
    await expect(field(page, 'E-mail')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page, 'Senha')).toHaveAttribute('aria-invalid', 'true');

    // os campos certos e nenhuma caixa marcada: o foco vai à primeira caixa, com o erro ligado a ela
    await field(page, 'Nome').fill(NAME);
    await field(page, 'E-mail').fill(address);
    await field(page, 'Senha').fill(PASSWORD);
    const terms = page.getByRole('checkbox', { name: /^Li e aceito os termos de uso/ });
    const privacy = page.getByRole('checkbox', { name: /^Li e aceito a política de privacidade/ });
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(terms).toBeFocused();
    await expect(terms).toHaveAccessibleDescription(/Marque a caixa para aceitar os termos de uso/);
    await expect(privacy).toHaveAccessibleDescription(
      /Marque a caixa para aceitar a política de privacidade/,
    );
    await expect(field(page, 'Nome')).not.toHaveAttribute('aria-invalid', 'true');

    // só uma das duas: o erro da caixa marcada some na hora, o da outra fica, e o foco vai à que falta
    await terms.check();
    await expect(terms).not.toHaveAttribute('aria-invalid', 'true');
    await expect(privacy).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(privacy).toBeFocused();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/cadastro`);

    // nenhum usuário nasceu: entrar com esse e-mail diz "incorreto" (e não "confirme o e-mail", que só existe para quem se cadastrou)
    const login = await request.post('/api/auth/sign-in/email', {
      headers: { origin: FRONT_DOOR_URL, 'x-forwarded-for': ip },
      data: { email: address, password: PASSWORD },
    });
    expect(login.status()).toBe(401);
  });

  test('termos e privacidade mostram o texto inteiro, a versão, a vigência e o SHA-256 iguais aos da api', async ({
    page,
    request,
  }) => {
    const docs = await legal(request);
    // as linhas do texto sem a marcação (o título, a versão e a vigência estão nos dados acima do texto)
    const plain = (line: string) =>
      line
        .replace(/^#{1,6} |^> |^- /, '')
        .replaceAll('**', '')
        .trim();

    for (const [route, id] of [
      ['/termos', 'TERMS'],
      ['/privacidade', 'PRIVACY'],
    ] as const) {
      const doc = docs.documents.find((d) => d.document === id)!;
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: doc.title })).toBeVisible();
      await expect(page.getByText(doc.version, { exact: true })).toBeVisible();
      await expect(page.getByText(dmy(doc.effectiveDate), { exact: true })).toBeVisible();
      await expect(page.getByText(doc.sha256, { exact: true })).toBeVisible();

      const shown = (await page.getByRole('main').textContent()) ?? '';
      const lines = doc.text
        .split('\n')
        .map(plain)
        .filter((line) => line && line !== doc.title && !/^(Versão|Vigência): /.test(line));
      expect(lines.length).toBeGreaterThan(10);
      for (const line of lines) expect(shown, line).toContain(line);
      // o rascunho avisa que não é texto final
      await expect(page.getByText(/^RASCUNHO para revisão/)).toBeVisible();
    }

    // o controlador e o contato da política vêm da configuração da api
    await page.goto('/privacidade');
    expect(docs.controller).toEqual({
      name: 'Controlador do e2e',
      contact: 'privacidade@example.test',
    });
    await expect(page.getByText(docs.controller!.name, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: docs.controller!.contact })).toHaveAttribute(
      'href',
      `mailto:${docs.controller!.contact}`,
    );
  });

  test('o login com o Google só aparece com a api configurada para ele: aqui não está, e a tela não o oferece', async ({
    page,
    request,
  }) => {
    const providers = await request.get('/api/v1/auth/providers');
    expect(await providers.json()).toMatchObject({ success: true, data: { google: false } });
    for (const route of ['/entrar', '/cadastro']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('main').getByText(/google/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0);
    }
  });
});

test.describe('quem pode ver o quê', () => {
  test('dois usuários em contextos separados: A não vê nada de B, nem o exporta, nem o apaga', async ({
    page,
    request,
    browser,
    ip,
  }, testInfo) => {
    const ipB = fakeIp();
    const a = await registerVerifiedUser(request, ip, 'a', 'Ana do e2e');
    const b = await registerVerifiedUser(request, ipB, 'b', 'Beto do e2e');
    const contextB = await browser.newContext(contextOptions(testInfo, ipB));
    const pageB = await contextB.newPage();

    try {
      for (const [who, user] of [
        [page, a],
        [pageB, b],
      ] as const) {
        await who.goto('/entrar');
        await signIn(who, user.email, user.password);
        await expect(who).toHaveURL(`${FRONT_DOOR_URL}/conta`);
      }

      // cada um vê só o que é seu
      await expect(page.getByRole('region', { name: 'Dados', exact: true })).toContainText(a.email);
      await expect(page.getByRole('main')).not.toContainText(b.email);
      await expect(page.getByRole('main')).not.toContainText('Beto do e2e');
      await expect(pageB.getByRole('region', { name: 'Dados', exact: true })).toContainText(
        b.email,
      );
      await expect(pageB.getByRole('main')).not.toContainText(a.email);
      await expect(pageB.getByRole('main')).not.toContainText('Ana do e2e');

      // a sessão de cada navegador é a dele: os cookies são outros
      const sessionOf = async (p: Page) =>
        (await p.context().cookies()).find((c) => c.name.endsWith('session_token'))!.value;
      expect(await sessionOf(page)).not.toBe(await sessionOf(pageB));

      // pela api, com o cookie de A, só existe A: o id de B não abre nada (o /me é sempre o da sessão)
      const meOf = async (p: Page) => {
        const body = envelopeSchema(meSchema).parse(
          await (await p.request.get('/api/v1/me')).json(),
        );
        if (!body.success) throw new Error('GET /api/v1/me falhou');
        return body.data;
      };
      const meA = await meOf(page);
      const meB = await meOf(pageB);
      expect(meA.email).toBe(a.email);
      expect(meB.email).toBe(b.email);
      expect(meA.id).not.toBe(meB.id);
      expect((await page.request.get(`/api/v1/me?userId=${meB.id}`)).status()).toBe(400);
      expect((await page.request.get(`/api/v1/me/${meB.id}`)).status()).toBe(404);

      // a exportação de A só tem A
      const exportA = await (await page.request.get('/api/v1/me/export')).text();
      expect(exportA).toContain(a.email);
      expect(exportA).not.toContain(b.email);
      expect(exportA).not.toContain(meB.id);

      // A exclui a própria conta (pela tela) e B segue de pé
      await page
        .getByRole('region', { name: 'Excluir a conta' })
        .getByRole('checkbox', { name: /exclusão é definitiva/ })
        .check();
      await page
        .getByRole('region', { name: 'Excluir a conta' })
        .getByRole('button', { name: 'Excluir minha conta' })
        .click();
      await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?aviso=conta-excluida`);
      await pageB.reload();
      await expect(pageB.getByRole('region', { name: 'Dados', exact: true })).toContainText(
        b.email,
      );
      expect((await meOf(pageB)).id).toBe(meB.id);
    } finally {
      await contextB.close();
    }
  });

  test('/conta é privada: sem sessão manda para a entrada, com sessão não vai a cache nenhum e não entrega o token', async ({
    page,
    request,
    ip,
  }) => {
    const anonymous = await request.get('/conta', { maxRedirects: 0 });
    expect(anonymous.status()).toBe(307);
    // a mesma origem do navegador: o endereço da origem (4309) nunca aparece
    expect(new URL(anonymous.headers().location!, FRONT_DOOR_URL).href).toBe(
      `${FRONT_DOOR_URL}/entrar?proximo=%2Fconta`,
    );
    expect(anonymous.headers()['cache-control']).toContain('no-store');

    const user = await registerVerifiedUser(request, ip, 'privada');
    await signInViaApi(page.request, user);
    const session = (await page.context().cookies()).find((c) => c.name.endsWith('session_token'))!;
    expect(session).toMatchObject({
      name: '__Secure-alvesting.session_token',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });

    const own = await page.request.get('/conta');
    expect(own.status()).toBe(200);
    const cacheControl = own.headers()['cache-control']!;
    expect(cacheControl).toContain('private');
    expect(cacheControl).toContain('no-store');
    expect(own.headers().etag).toBeUndefined();
    expect(own.headers()['set-cookie']).toBeUndefined();
    const html = await own.text();
    expect(html).toContain(user.email);
    expect(html).not.toContain(session.value);
  });

  test('depois de entrar só se vai para caminho interno: o endereço de fora no "proximo" é ignorado', async ({
    page,
    request,
    ip,
  }) => {
    const user = await registerVerifiedUser(request, ip, 'redirecionamento');

    await page.goto(`/entrar?proximo=${encodeURIComponent('//example.test/golpe')}`);
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);

    // um caminho do site vale
    await page.context().clearCookies();
    await page.goto(`/entrar?proximo=${encodeURIComponent('/termos')}`);
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/termos`);
  });

  // O botão "voltar" pode devolver a página do cache de ida e volta do navegador no estado em que ela saiu (o formulário desativado, com
  // "Enviando…" e a senha na tela). Restaurada ou recarregada, a entrada volta pronta e sem a senha que a pessoa digitou.
  test('voltar depois de entrar não deixa o formulário travado nem com a senha na tela', async ({
    page,
    request,
    ip,
  }) => {
    const user = await registerVerifiedUser(request, ip, 'voltar');
    await page.goto('/entrar');
    await signIn(page, user.email, user.password);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);

    await page.goBack();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar`);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
    await expect(field(page, 'Senha')).toHaveValue('');
  });

  // A /entrar sai com `Cache-Control: no-store`, e o navegador não a guarda no cache de ida e volta: o `goBack` acima RECARREGA a página
  // (medido em Chromium e WebKit), e o formulário volta limpo por ser uma página nova, sem passar pelo tratamento do `pageshow`
  // (form-kit.tsx). Este teste exercita o tratamento sozinho, para o navegador que restaura a página mesmo assim: o envio fica preso na
  // rede (o botão em "Enviando…", o formulário desativado, a senha na tela) e o evento chega como o navegador o manda ao restaurar
  // (`persisted`). A página volta pronta e sem a senha.
  test('a página restaurada do cache de ida e volta destrava o formulário e esquece a senha', async ({
    page,
  }) => {
    // nunca responde: o pedido fica pendente até o teste acabar (a página fecha)
    await page.route('**/api/auth/sign-in/email', () => undefined);
    await page.goto('/entrar');
    await signIn(page, email('restaurada'), PASSWORD);
    await expect(page.getByRole('button', { name: 'Enviando…' })).toBeDisabled();

    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
    await expect(field(page, 'Senha')).toHaveValue('');
    await expect(field(page, 'E-mail')).toHaveValue('');

    // um pageshow que NÃO é de uma restauração (a carga normal) não mexe em nada
    await field(page, 'Senha').fill(PASSWORD);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })),
    );
    await expect(field(page, 'Senha')).toHaveValue(PASSWORD);
  });
});

// Mobile é gate de merge, e o toque não é o clique: nos dois projetos de toque, e no desktop com um contexto que tem toque, o fluxo da conta se
// faz com `.tap()`. O toque no TEXTO da caixa de marcar (o rótulo inteiro é o alvo), nos botões e nos links.
test.describe('por toque', () => {
  test.use({ hasTouch: true });

  test('cadastro, entrar e sair tocando: o texto da caixa a marca, e os botões e os links respondem ao toque', async ({
    page,
  }) => {
    const address = email('toque');
    await page.goto('/cadastro');

    // tudo vazio, e o botão tocado: os erros aparecem nos campos
    await page.getByRole('button', { name: 'Criar conta' }).tap();
    await expect(field(page, 'Nome')).toBeFocused();
    await expect(field(page, 'Nome')).toHaveAttribute('aria-invalid', 'true');

    // o toque no texto do rótulo (e não na caixa) marca a caixa, e o erro dela some
    const terms = page.getByRole('checkbox', { name: /^Li e aceito os termos de uso/ });
    const privacy = page.getByRole('checkbox', { name: /^Li e aceito a política de privacidade/ });
    await page.getByText(/^Li e aceito os termos de uso/).tap();
    await expect(terms).toBeChecked();
    await expect(terms).not.toHaveAttribute('aria-invalid', 'true');
    // marcada, a caixa é um quadrado preto com um X (não depende da cor para dizer que está marcada): o que uma medida de DOM não vê e o
    // projeto não confere por captura de tela (a linha de base de uma plataforma não vale em outra)
    const painted = await terms.evaluate((box) => ({
      mark: getComputedStyle(box, '::before').content,
      background: getComputedStyle(box).backgroundColor,
    }));
    expect(painted).toEqual({ mark: '"✕"', background: 'rgb(0, 0, 0)' });
    await page.getByText(/^Li e aceito a política de privacidade/).tap();
    await expect(privacy).toBeChecked();

    await field(page, 'Nome').fill(NAME);
    await field(page, 'E-mail').fill(address);
    await field(page, 'Senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Criar conta' }).tap();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/verificar-email`);

    // o link do e-mail, a entrada por toque e a saída por toque
    const mail = await mailTo(address, /Confirme/);
    await page.goto(mail.link);
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/verificar-email?retorno=1`);
    await page.getByRole('link', { name: 'Entrar', exact: true }).tap();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar`);
    await field(page, 'E-mail').fill(address);
    await field(page, 'Senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).tap();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/conta`);
    await page.getByRole('button', { name: 'Sair', exact: true }).tap();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?aviso=saiu`);
  });
});

test.describe('sem JavaScript', () => {
  test('as telas de formulário avisam que precisam dele e não deixam enviar nada; os textos e o redirecionamento seguem', async ({
    browser,
    ip,
  }, testInfo) => {
    const context = await browser.newContext({
      ...contextOptions(testInfo, ip),
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    try {
      for (const route of [
        '/entrar',
        '/cadastro',
        '/esqueci-senha',
        '/redefinir-senha?token=token-sintetico',
        '/verificar-email',
      ]) {
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // (o Playwright pula o <noscript> na busca por texto: o aviso é buscado pelo elemento e lido pelo textContent)
        const notice = page.locator('noscript p');
        await expect(notice, route).toBeVisible();
        expect(await notice.textContent(), route).toContain('precisa de JavaScript');
        // o formulário não se envia sozinho: um envio sem JavaScript poria a senha na URL
        const buttons = await page.getByRole('main').getByRole('button').all();
        expect(buttons.length, route).toBeGreaterThan(0);
        for (const button of buttons) await expect(button, route).toBeDisabled();
      }

      // o que é só texto não depende dele
      await page.goto('/termos');
      await expect(page.getByRole('heading', { level: 1, name: 'Termos de uso' })).toBeVisible();
      // e a conta, sem sessão, é um redirecionamento do servidor
      await page.goto('/conta');
      await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?proximo=%2Fconta`);
    } finally {
      await context.close();
    }
  });
});

// O aceite que muda de versão (docs/CONTA.md): a tela da conta mostra o texto novo e pede o aceite de novo. A api do e2e tem uma versão
// só, então aqui entra o que ela garante e a tela não esconde: o aceite em dia não mostra o pedido.
test('com o aceite em dia a conta não pede aceite novo', async ({ page, request, ip }) => {
  const user = await registerVerifiedUser(request, ip, 'em-dia');
  await signInViaApi(page.request, user);
  const me = envelopeSchema(meSchema).parse(await (await page.request.get('/api/v1/me')).json());
  expect(me.success && me.data.consent.upToDate).toBe(true);
  expect(me.success && me.data.consent.documents.map((d) => d.version)).toEqual(
    Object.values(consentOf(await legal(request))),
  );
  await page.goto('/conta');
  await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aceitar as versões novas' })).toHaveCount(0);
});
