import { expect, test } from '@playwright/test';
import {
  envelopeSchema,
  lotSchema,
  meSchema,
  portfolioSchema,
  userExportSchema,
} from '@alvesting/contracts';
import { PASSWORD, email, fakeIp, legal as readLegal, mailCount, mailTo } from './account-support';
import { ACCOUNT_API_URL, ACCOUNT_SITE_URL } from './api-server';
import { FRONT_DOOR_ID } from './locked-server';

// A conta (etapa 11, docs/CONTA.md) contra o build de produção da api (apps/api/dist), na api da conta do e2e (porta 4308, NODE_ENV=test,
// remetente falso gravando em ACCOUNT_OUTBOX_DIR). Só HTTP, sem navegador: as telas têm o conta.spec.ts. Roda nos três projetos, como
// todo e2e (mobile é gate de merge). Nada vai à rede: o e-mail cai num arquivo e o Google não participa.
//
// Esta api roda atrás da trava de origem, como na Azure: toda chamada leva o X-Azure-FDID (o que o Front Door escreve) e o IP do
// limite de tentativas vai no X-Azure-SocketIP, que é de onde a api lê o IP atrás do Front Door.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local da conta (a segunda api do e2e)');
test.use({ extraHTTPHeaders: { 'x-azure-fdid': FRONT_DOOR_ID } });

const api = (route: string) => `${ACCOUNT_API_URL}${route}`;
const legal = (request: Parameters<typeof readLegal>[0]) => readLegal(request, ACCOUNT_API_URL);

const headers = (ip: string) => ({ origin: ACCOUNT_SITE_URL, 'x-azure-socketip': ip });

test.describe('a api da conta no build de produção', () => {
  test('atrás da trava de origem: sem o X-Azure-FDID do perfil, 403 no envelope, também nas rotas da conta e do Better Auth', async ({
    request,
  }) => {
    for (const route of ['/api/v1/legal', '/api/v1/me', '/api/auth/get-session']) {
      for (const forged of [{}, { 'x-azure-fdid': '11111111-2222-4333-8444-555555555555' }]) {
        const res = await request.get(api(route), { headers: { 'x-azure-fdid': '', ...forged } });
        expect(res.status(), route).toBe(403);
        expect(await res.json()).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
      }
    }
  });

  test('os textos legais e o que o site precisa antes do login, sem cache', async ({ request }) => {
    const res = await request.get(api('/api/v1/legal'));
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
    const data = await legal(request);
    expect(data.documents.map((d) => d.document)).toEqual(['TERMS', 'PRIVACY']);
    expect(data.controller).toEqual({
      name: 'Controlador do e2e',
      contact: 'privacidade@example.test',
    });
    for (const doc of data.documents) {
      expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.text).toContain('RASCUNHO');
    }

    const me = await request.get(api('/api/v1/me'));
    expect(me.status()).toBe(401);
    expect(me.headers()['cache-control']).toBe('no-store');
    expect(await me.json()).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });

    const session = await request.get(api('/api/auth/get-session'));
    expect(session.status()).toBe(200);
    expect(await session.json()).toBeNull();
    expect(session.headers()['cache-control']).toBe('no-store');
  });

  // O que a revisão de segurança da etapa 11 fechou, conferido no build de produção (o SWC compilado, não o vitest): o corpo de
  // /api/auth tem teto, a rota do Better Auth que o site não usa responde 404, e o cadastro recusa nome e imagem fora do que aceitamos.
  test('o teto do corpo, as rotas fechadas e a validação do cadastro valem no build de produção', async ({
    request,
  }) => {
    const big = await request.post(api('/api/auth/sign-in/email'), {
      headers: headers(fakeIp()),
      data: {
        email: email('grande'),
        password: PASSWORD,
        callbackURL: `/${'a'.repeat(17 * 1024)}`,
      },
    });
    expect(big.status()).toBe(413);
    expect(await big.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });

    for (const route of ['/api/auth/verify-password', '/api/auth/update-user']) {
      const res = await request.post(api(route), { headers: headers(fakeIp()), data: {} });
      expect(res.status(), route).toBe(404);
    }

    const docs = await legal(request);
    const consent = {
      terms: docs.documents.find((d) => d.document === 'TERMS')!.version,
      privacy: docs.documents.find((d) => d.document === 'PRIVACY')!.version,
    };
    for (const extra of [{ name: 'n'.repeat(101) }, { image: 'https://example.test/foto.png' }]) {
      const res = await request.post(api('/api/auth/sign-up/email'), {
        headers: headers(fakeIp()),
        data: {
          name: 'Pessoa do e2e',
          email: email('perfil'),
          password: PASSWORD,
          consent,
          ...extra,
        },
      });
      expect(res.status()).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_PROFILE' });
    }
  });

  test('o cadastro sem o aceite explícito é recusado: nenhum usuário nasce e nenhum e-mail sai', async ({
    request,
  }) => {
    const address = email('sem-aceite');
    const res = await request.post(api('/api/auth/sign-up/email'), {
      headers: headers(fakeIp()),
      data: { name: 'Pessoa do e2e', email: address, password: PASSWORD },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'CONSENT_REQUIRED' });

    // nenhum usuário nasceu: o login diz "incorreto" (um cadastro sem aceite que tivesse criado o usuário diria 403 "confirme o e-mail")
    const login = await request.post(api('/api/auth/sign-in/email'), {
      headers: headers(fakeIp()),
      data: { email: address, password: PASSWORD },
    });
    expect(login.status()).toBe(401);
    expect(await login.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' });
    // e a caixa de saída não tem nada para ele (o e-mail sairia em segundo plano, logo depois da resposta do cadastro)
    expect(await mailCount(address)).toBe(0);
  });

  test('cadastro, e-mail falso, verificação, login, aceite, exportação e exclusão, de ponta a ponta', async ({
    request,
  }) => {
    const ip = fakeIp();
    const address = email('ciclo');
    const docs = await legal(request);
    const consent = {
      terms: docs.documents.find((d) => d.document === 'TERMS')!.version,
      privacy: docs.documents.find((d) => d.document === 'PRIVACY')!.version,
    };

    // cadastro: sem sessão até verificar
    const signUp = await request.post(api('/api/auth/sign-up/email'), {
      headers: headers(ip),
      data: {
        name: 'Pessoa do e2e',
        email: address,
        password: PASSWORD,
        callbackURL: '/conta',
        consent,
      },
    });
    expect(signUp.status()).toBe(200);
    expect(await signUp.json()).toMatchObject({ token: null });
    expect(
      (
        await request.post(api('/api/auth/sign-in/email'), {
          headers: headers(ip),
          data: { email: address, password: PASSWORD },
        })
      ).status(),
    ).toBe(403);

    // o link do e-mail falso (absoluto pelo PUBLIC_URL) verifica o endereço
    const mail = await mailTo(address);
    expect(mail.subject).toMatch(/Confirme/);
    expect(mail.link.startsWith(`${ACCOUNT_SITE_URL}/api/auth/verify-email?token=`)).toBe(true);
    const link = new URL(mail.link);
    const verified = await request.get(api(link.pathname + link.search), {
      headers: { 'x-azure-socketip': ip },
      maxRedirects: 0,
    });
    expect(verified.status()).toBe(302);

    // login: o cookie fica no contexto da requisição
    const login = await request.post(api('/api/auth/sign-in/email'), {
      headers: headers(fakeIp()),
      data: { email: address, password: PASSWORD },
    });
    expect(login.status()).toBe(200);
    const setCookie = login.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    expect(setCookie.map((h) => h.value).join(';')).toMatch(/HttpOnly/i);
    expect(setCookie.map((h) => h.value).join(';')).toMatch(/SameSite=Lax/i);

    // /me: os dados mínimos e o aceite em dia
    const me = envelopeSchema(meSchema).parse(await (await request.get(api('/api/v1/me'))).json());
    expect(me.success && me.data).toMatchObject({
      email: address,
      emailVerified: true,
      role: 'USER',
      consent: { upToDate: true },
    });

    // aceitar de novo a versão vigente é inofensivo; uma versão que não é a vigente é 409
    expect(
      (
        await request.post(api('/api/v1/me/consents'), { headers: headers(ip), data: consent })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post(api('/api/v1/me/consents'), {
          headers: headers(ip),
          data: { terms: '9.9', privacy: '9.9' },
        })
      ).status(),
    ).toBe(409);

    // a carteira (etapa 12), pelo build de produção e com o login de menor privilégio do Postgres: os dois modos de preço dão o mesmo custo
    // total, a posição soma os dois lançamentos, e a resposta nunca é guardada
    const lotBody = { ticker: 'MOVE3', quantity: 100, boughtOn: '2026-10-15' };
    const created = [
      { mode: 'unit', valueCents: 3_550 },
      { mode: 'total', valueCents: 355_000 },
    ];
    for (const price of created) {
      const res = await request.post(api('/api/v1/me/portfolio/lots'), {
        headers: headers(ip),
        data: { ...lotBody, ...price },
      });
      expect(res.status()).toBe(201);
      expect(res.headers()['cache-control']).toBe('no-store');
      const lot = envelopeSchema(lotSchema).parse(await res.json());
      expect(lot.success && lot.data).toMatchObject({ ticker: 'MOVE3', costCents: 355_000 });
    }
    const wallet = await request.get(api('/api/v1/me/portfolio'));
    expect(wallet.status()).toBe(200);
    expect(wallet.headers()['cache-control']).toBe('no-store');
    const portfolio = envelopeSchema(portfolioSchema).parse(await wallet.json());
    expect(portfolio.success && portfolio.data.lots).toHaveLength(2);
    expect(portfolio.success && portfolio.data.positions).toMatchObject([
      { ticker: 'MOVE3', quantity: 200, costCents: 710_000, avgPriceCents: 3_550 },
    ]);

    // exportar: tudo do dono, sem segredo, a carteira inclusive
    const exported = await request.get(api('/api/v1/me/export'));
    expect(exported.status()).toBe(200);
    expect(exported.headers()['content-disposition']).toMatch(/^attachment;/);
    const exportText = await exported.text();
    const data = envelopeSchema(userExportSchema).parse(JSON.parse(exportText));
    expect(data.success && data.data.user.email).toBe(address);
    expect(data.success && data.data.portfolioLots.map((lot) => lot.costCents)).toEqual([
      355_000, 355_000,
    ]);
    expect(exportText).not.toMatch(/"(password|token|accessToken|refreshToken|idToken)"/);

    // excluir: a conta e o cookie vão embora (sem corpo nenhum, como o site faz: a sessão é recente)
    const deleted = await request.delete(api('/api/v1/me'), { headers: headers(ip) });
    expect(deleted.status()).toBe(200);
    expect(await deleted.json()).toMatchObject({ success: true, data: { deleted: true } });
    expect((await request.get(api('/api/v1/me'))).status()).toBe(401);
    expect(
      (
        await request.post(api('/api/auth/sign-in/email'), {
          headers: headers(fakeIp()),
          data: { email: address, password: PASSWORD },
        })
      ).status(),
    ).toBe(401);
  });
});
