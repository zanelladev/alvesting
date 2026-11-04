import { Logger } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { createServer, request as httpRequest, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { httpLogOptions } from '../../../common/http-log.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { createAuth } from '../infrastructure/auth.js';
import { accountConfig } from '../infrastructure/account-config.js';
import { ConsentService } from '../application/consent.service.js';
import { AccountMailer } from '../infrastructure/email/account-mailer.js';
import { OutboxEmailSender, readOutbox } from '../infrastructure/email/outbox-email-sender.js';
import { parseEnv } from '../../../config/env.js';
import {
  GOOGLE_CLIENT_ID,
  ORIGIN,
  PASSWORD,
  asSite,
  createLoggedInUser,
  getSession,
  newEmail,
  nextIp,
  signIn,
  signUp,
  startAccountApp,
  type AccountApp,
} from '../testing/account-app.fixture.js';

// O Better Auth montado na API (etapa 11, docs/CONTA.md): cadastro com aceite explícito, e-mail falso, verificação obrigatória,
// login, sessão, logout, redefinição de senha, limite de tentativas, o Google com um provedor falso e papel admin impossível pelo
// HTTP. Sem rede: o e-mail cai numa pasta temporária e o Google responde por um fetch falso que recusa qualquer outro endereço.
describe.skipIf(!testDatabaseUrl)(
  integrationTitle('A conta: cadastro, login e redefinição'),
  () => {
    // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api (ADR 0028), com o qual a api sob teste atende as rotas
    let prisma: PrismaService;
    let apiPrisma: PrismaService;
    let account: AccountApp;

    beforeAll(async () => {
      Logger.overrideLogger(false);
      prisma = await openTestDatabase(testDatabaseUrl!);
      apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
      account = await startAccountApp(apiPrisma);
    }, 60_000);

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    afterAll(async () => {
      await account?.stop();
      await prisma?.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
      await prisma?.verification.deleteMany();
      await prisma?.auditLog.deleteMany({ where: { action: { startsWith: 'account.' } } });
      await apiPrisma?.onModuleDestroy();
      await prisma?.onModuleDestroy();
    });

    const userByEmail = (email: string) => prisma.user.findUnique({ where: { email } });

    describe('cadastro', () => {
      it('com o aceite explícito: 200 sem sessão, usuário criado como USER e e-mail de verificação com link absoluto pelo PUBLIC_URL', async () => {
        const email = newEmail();
        const res = await signUp(account.agent(), { email, consent: account.consent() });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ token: null, user: { email, emailVerified: false } });
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(res.headers['cache-control']).toBe('no-store');

        const user = await userByEmail(email);
        expect(user).toMatchObject({ role: 'USER', emailVerified: false, name: 'Pessoa de Teste' });
        expect(user!.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);

        const mail = await account.mailTo(email, /Confirme/);
        expect(mail.link.startsWith(`${ORIGIN}/api/auth/verify-email?token=`)).toBe(true);
        expect(mail.plainText).toMatch(/60 minutos/);
        expect(mail.subject).toMatch(/Alvesting/);
        // o e-mail promete 60 minutos: o token vale exatamente isso (a validade vem da mesma constante do texto)
        const token = new URL(mail.link).searchParams.get('token')!;
        const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
          iat: number;
          exp: number;
        };
        expect(claims.exp - claims.iat).toBe(60 * 60);
      });

      it('registra o aceite com o documento, a versão, o SHA-256 e a data de cada texto', async () => {
        const email = newEmail();
        await signUp(account.agent(), { email, consent: account.consent() });
        const user = await userByEmail(email);

        const rows = await prisma.consent.findMany({ where: { userId: user!.id } });
        expect(rows.map((r) => r.document).sort()).toEqual(['PRIVACY', 'TERMS']);
        for (const row of rows) {
          const doc = account.docs.find((d) => d.document === row.document)!;
          expect(row).toMatchObject({ version: doc.version, sha256: doc.sha256 });
          expect(row.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
          expect(Date.now() - row.acceptedAt.getTime()).toBeLessThan(10_000);
        }
      });

      // O Better Auth grava o aceite DEPOIS do commit do usuário (hook de create.after). Se essa gravação falhar, o cadastro devolve 500,
      // mas não há perda: o usuário existe sem aceite, o ConsentGuard mantém fechadas as rotas que o exigem, e POST /me/consents regulariza.
      it('se o aceite não grava (falha depois de o usuário nascer): o usuário fica sem aceite, a rota protegida fecha e o aceite posterior regulariza', async () => {
        const email = newEmail();
        const record = vi
          .spyOn(account.app.get(ConsentService), 'record')
          .mockRejectedValueOnce(new Error(`o banco caiu para ${email}`));
        const res = await signUp(account.agent(), { email, consent: account.consent() });
        record.mockRestore();
        expect(res.status).toBeGreaterThanOrEqual(500);

        const user = await userByEmail(email);
        expect(user).not.toBeNull();
        expect(await prisma.consent.count({ where: { userId: user!.id } })).toBe(0);

        const agent = account.agent();
        const mail = await account.mailTo(email, /Confirme/);
        const url = new URL(mail.link);
        await agent.get(url.pathname + url.search).set('X-Forwarded-For', nextIp());
        expect((await signIn(agent, email)).status).toBe(200);
        const me = await agent.get('/api/v1/me');
        expect(me.body).toMatchObject({ data: { consent: { upToDate: false } } });

        const accepted = await asSite(agent.post('/api/v1/me/consents')).send(account.consent());
        expect(accepted.status).toBe(200);
        expect(await prisma.consent.count({ where: { userId: user!.id } })).toBe(2);
      });

      type Current = { terms: string; privacy: string };
      it.each<[string, unknown]>([
        ['sem o aceite', undefined],
        ['com o aceite vazio', {}],
        ['pré-marcado (true)', true],
        ['só os termos', { terms: '0.1' }],
        ['com a versão antiga', { terms: '0.0', privacy: '0.0' }],
        ['com a versão como número', { terms: 0.1, privacy: 0.1 }],
        // cada documento é conferido sozinho: citar a versão vigente de um e a velha do outro não vale
        ['só a privacidade velha', (c: Current) => ({ ...c, privacy: '0.0' })],
        ['só os termos velhos', (c: Current) => ({ ...c, terms: '0.0' })],
      ])('%s: 400 CONSENT_REQUIRED e nenhum usuário nasce', async (_nome, proof) => {
        const consent =
          typeof proof === 'function'
            ? (proof as (c: Current) => unknown)(account.consent())
            : proof;
        const email = newEmail();
        const res = await signUp(account.agent(), { email, consent });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'CONSENT_REQUIRED' });
        expect(await userByEmail(email)).toBeNull();
        expect(res.headers['set-cookie']).toBeUndefined();
      });

      // o que a resposta do cadastro mostra de quem pediu, sem o que muda a cada chamada por natureza (o id e as datas)
      type SignUpBody = { token: unknown; user: Record<string, unknown> };
      const shape = (body: unknown) => {
        const { user, token } = body as SignUpBody;
        const { id, createdAt, updatedAt, ...stable } = user;
        expect(String(id)).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
        expect(Number.isNaN(Date.parse(String(createdAt)))).toBe(false);
        expect(Number.isNaN(Date.parse(String(updatedAt)))).toBe(false);
        return { token, user: stable, keys: Object.keys(user).sort() };
      };

      it('a mesma resposta para e-mail novo e e-mail já cadastrado (não revela quem tem conta)', async () => {
        const email = newEmail();
        const first = await signUp(account.agent(), { email, consent: account.consent() });
        const again = await signUp(account.agent(), { email, consent: account.consent() });

        expect(again.status).toBe(first.status);
        // os VALORES iguais, não só os nomes dos campos
        expect(shape(again.body)).toEqual(shape(first.body));
        expect(shape(again.body)).toMatchObject({
          token: null,
          user: { name: 'Pessoa de Teste', email, emailVerified: false, image: null },
        });
        expect(again.headers['set-cookie']).toBeUndefined();
        expect(await prisma.user.count({ where: { email } })).toBe(1);
      });

      it('cadastros simultâneos do mesmo e-mail novo: todos 200 e iguais (a corrida na criação não vira um 422 que denuncia o e-mail livre)', async () => {
        const email = newEmail();
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            signUp(account.agent(), { email, consent: account.consent() }),
          ),
        );
        expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
        const [first, ...rest] = results.map((r) => shape(r.body));
        for (const other of rest) expect(other).toEqual(first);
        expect(await prisma.user.count({ where: { email } })).toBe(1);
        expect(await prisma.consent.count({ where: { user: { email } } })).toBe(2);
      });

      it.each([
        ['nome vazio', { name: '' }],
        ['nome só de espaços', { name: '   ' }],
        ['nome com 101 caracteres', { name: 'n'.repeat(101) }],
        ['nome com NUL (o Postgres não guarda)', { name: 'Fulana\u0000' }],
        ['nome com quebra de linha', { name: 'Fulana\nSobrenome' }],
        ['e-mail com mais de 254 caracteres', { email: `${'a'.repeat(250)}@example.test` }],
        ['imagem (não temos foto)', { image: 'https://example.test/foto.png' }],
      ])('%s: 400 e nada nasce', async (_nome, extra) => {
        const email = (extra as { email?: string }).email ?? newEmail();
        const res = await signUp(account.agent(), {
          email,
          consent: account.consent(),
          ...extra,
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'INVALID_PROFILE' });
        expect(await userByEmail(email)).toBeNull();
        expect(res.headers['set-cookie']).toBeUndefined();
      });

      it('nome no limite (100 caracteres, com acento e emoji) passa; a recusa é a mesma para e-mail novo e já cadastrado', async () => {
        const name = `${'é'.repeat(98)}🙂`;
        const ok = await signUp(account.agent(), {
          email: newEmail(),
          name,
          consent: account.consent(),
        });
        expect(ok.status).toBe(200);

        const existing = newEmail();
        await signUp(account.agent(), { email: existing, consent: account.consent() });
        const refusedOld = await signUp(account.agent(), {
          email: existing,
          name: 'n'.repeat(101),
          consent: account.consent(),
        });
        const refusedNew = await signUp(account.agent(), {
          email: newEmail(),
          name: 'n'.repeat(101),
          consent: account.consent(),
        });
        expect(refusedOld.status).toBe(400);
        expect(refusedOld.body).toEqual(refusedNew.body);
      });

      it('sem o aceite a resposta é a mesma para e-mail cadastrado ou não (o aceite é conferido antes de olhar o e-mail)', async () => {
        const existing = newEmail();
        await signUp(account.agent(), { email: existing, consent: account.consent() });
        const a = await signUp(account.agent(), { email: existing });
        const b = await signUp(account.agent(), { email: newEmail() });
        expect(a.status).toBe(400);
        expect(b.status).toBe(400);
        expect(a.body).toEqual(b.body);
      });

      it('senha com mais de 128 caracteres é recusada (não se hasheia senha enorme); com 128 passa', async () => {
        const long = await signUp(account.agent(), {
          email: newEmail(),
          password: 'p'.repeat(129),
          consent: account.consent(),
        });
        expect(long.status).toBe(400);
        const edge = await signUp(account.agent(), {
          email: newEmail(),
          password: 'p'.repeat(128),
          consent: account.consent(),
        });
        expect(edge.status).toBe(200);
      });

      it('senha com menos de 10 caracteres é recusada; com 10 passa', async () => {
        const short = await signUp(account.agent(), {
          email: newEmail(),
          password: '123456789',
          consent: account.consent(),
        });
        expect(short.status).toBe(400);
        const ok = await signUp(account.agent(), {
          email: newEmail(),
          password: '1234567890',
          consent: account.consent(),
        });
        expect(ok.status).toBe(200);
      });

      it('papel admin é impossível pelo cadastro: o campo role do corpo é ignorado', async () => {
        for (const role of ['admin', 'ADMIN', 'USER']) {
          const email = newEmail();
          const res = await signUp(account.agent(), { email, role, consent: account.consent() });
          expect(res.status, role).toBe(200);
          expect((await userByEmail(email))!.role).toBe('USER');
          expect(JSON.stringify(res.body)).not.toMatch(/role/i);
        }
      });
    });

    describe('verificação, login, sessão e logout', () => {
      it('antes de verificar o e-mail, o login é 403 e um novo e-mail de verificação sai', async () => {
        const email = newEmail();
        const agent = account.agent();
        await signUp(agent, { email, consent: account.consent() });
        await account.mailTo(email, /Confirme/);
        const sent = async () =>
          (await readOutbox(account.outboxDir)).filter((m) => m.to === email).length;
        expect(await sent()).toBe(1);

        // dentro de 60 s do primeiro o AccountMailer descarta o segundo (o mesmo tipo para o mesmo destinatário; o primeiro segue valendo)
        const early = await signIn(agent, email);
        expect(early.status).toBe(403);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(await sent()).toBe(1);

        // passados os 60 s (o relógio adianta; só o Date é falso): o login de e-mail não verificado manda o link de novo
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61_000 });
        try {
          const res = await signIn(agent, email);
          expect(res.status).toBe(403);
          expect(res.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
          expect(res.headers['set-cookie']).toBeUndefined();
          expect((await getSession(agent)).body).toBeNull();
          // o reenvio é o único caminho de quem não recebeu o primeiro e-mail (sendOnSignIn); o e-mail sai em segundo plano
          // (o vi.waitFor não serve aqui: com o relógio falso ele não espera de verdade)
          for (let i = 0; i < 100 && (await sent()) < 2; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          expect(await sent()).toBe(2);
        } finally {
          vi.useRealTimers();
        }
      });

      it('o link do e-mail verifica o endereço; só então o login entra, com o cookie HttpOnly e SameSite=Lax', async () => {
        const email = newEmail();
        const agent = account.agent();
        await signUp(agent, { email, consent: account.consent() });
        const mail = await account.mailTo(email, /Confirme/);

        const link = new URL(mail.link);
        const verified = await agent
          .get(link.pathname + link.search)
          .set('X-Forwarded-For', nextIp());
        expect(verified.status).toBe(302);
        expect(verified.headers.location).toBe('/conta');
        expect((await userByEmail(email))!.emailVerified).toBe(true);
        // O clique no link NÃO abre sessão (`autoSignInAfterVerification: false`, auth.ts): quem cadastra o e-mail de outra pessoa e a leva a
        // clicar no link não entra na conta dela por isso. É um dos ajustes que seguram o pré-sequestro por cadastro, agora que a conta guarda
        // uma carteira (docs/CONTA.md, seção 11).
        expect(verified.headers['set-cookie']).toBeUndefined();
        expect((await getSession(agent)).body).toBeNull();

        const login = await signIn(agent, email);
        expect(login.status).toBe(200);
        const cookie = (login.headers['set-cookie'] as unknown as string[]).join('; ');
        expect(cookie).toMatch(/alvesting\.session_token=/);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
        expect(cookie).not.toMatch(/Secure/i); // só em produção (https)

        const session = await getSession(agent);
        expect(session.status).toBe(200);
        expect(session.body).toMatchObject({ user: { email } });
        expect(session.headers['cache-control']).toBe('no-store');
      });

      it('o token de verificação adulterado não verifica nada', async () => {
        const email = newEmail();
        await signUp(account.agent(), { email, consent: account.consent() });
        const mail = await account.mailTo(email, /Confirme/);
        const link = new URL(mail.link);
        link.searchParams.set('token', `${link.searchParams.get('token')}x`);

        const res = await account
          .http()
          .get(link.pathname + link.search)
          .set('X-Forwarded-For', nextIp());
        expect(res.status === 302 ? String(res.headers.location) : '').toMatch(/error=/i);
        expect((await userByEmail(email))!.emailVerified).toBe(false);
      });

      it('a sessão não guarda o IP nem o navegador (dados mínimos)', async () => {
        const { userId } = await createLoggedInUser(account, prisma);
        const sessions = await prisma.session.findMany({ where: { userId } });
        expect(sessions).toHaveLength(1);
        // NULL diz "não coletado" (a string vazia deixaria a coluna parecer em uso)
        expect(sessions[0]).toMatchObject({ ipAddress: null, userAgent: null });
      });

      it('logout: a sessão deixa de existir e o cookie é limpo', async () => {
        const { agent, email } = await createLoggedInUser(account, prisma);
        expect((await getSession(agent)).body).toMatchObject({ user: { email } });

        const out = await agent
          .post('/api/auth/sign-out')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({});
        expect(out.status).toBe(200);
        expect((out.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/Max-Age=0/i);
        expect((await getSession(agent)).body).toBeNull();
        expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);
      });

      it('senha errada e e-mail que não existe têm a mesma resposta', async () => {
        const { email } = await createLoggedInUser(account, prisma);
        const wrong = await signIn(account.agent(), email, 'senha-errada-qualquer');
        const unknown = await signIn(account.agent(), newEmail(), 'senha-errada-qualquer');

        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(wrong.status);
        expect(unknown.body).toEqual(wrong.body);
        expect(wrong.body).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' });
      });

      it('o limite de tentativas está ligado: a 4ª tentativa de login do mesmo IP em 10 s recebe 429', async () => {
        const ip = nextIp();
        const email = newEmail();
        const statuses: number[] = [];
        for (let i = 0; i < 4; i += 1) {
          statuses.push((await signIn(account.agent(), email, 'senha-errada-qualquer', ip)).status);
        }
        expect(statuses).toEqual([401, 401, 401, 429]);
        const blocked = await signIn(account.agent(), email, 'senha-errada-qualquer', ip);
        expect(blocked.headers['x-retry-after']).toBeDefined();
        // outro IP não é afetado
        expect(
          (await signIn(account.agent(), email, 'senha-errada-qualquer', nextIp())).status,
        ).toBe(401);
      });
    });

    describe('redefinição de senha', () => {
      it('a resposta é a mesma para e-mail cadastrado ou não, e só o cadastrado recebe o e-mail, com link para o site', async () => {
        const { email } = await createLoggedInUser(account, prisma);
        const unknown = newEmail();
        const ask = (to: string) =>
          account
            .http()
            .post('/api/auth/request-password-reset')
            .set('Origin', ORIGIN)
            .set('X-Forwarded-For', nextIp())
            .send({ email: to, redirectTo: `${ORIGIN}/redefinir-senha` });

        const known = await ask(email);
        const none = await ask(unknown);
        expect(known.status).toBe(200);
        expect(none.status).toBe(known.status);
        expect(none.body).toEqual(known.body);

        const mail = await account.mailTo(email, /senha/i);
        expect(mail.link.startsWith(`${ORIGIN}/redefinir-senha?token=`)).toBe(true);
        expect(mail.plainText).toMatch(/30 minutos/);
        // o e-mail promete 30 minutos: o pedido guardado vence exatamente em 30 (a validade vem da mesma constante do texto)
        const pending = await prisma.verification.findFirstOrThrow({
          where: { value: (await userByEmail(email))!.id },
        });
        const minutes = (pending.expiresAt.getTime() - Date.now()) / 60_000;
        expect(minutes).toBeGreaterThan(29);
        expect(minutes).toBeLessThanOrEqual(30);
        // o desconhecido não recebe nada (o envio é em segundo plano: dá um instante antes de olhar a pasta)
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect((await readOutbox(account.outboxDir)).filter((m) => m.to === unknown)).toEqual([]);
      });

      it('o token redefine a senha: a nova entra, a antiga não, as sessões velhas caem e o token não vale duas vezes', async () => {
        const { agent, email } = await createLoggedInUser(account, prisma);
        const newPassword = 'outra-senha-bem-longa-2';
        await account
          .http()
          .post('/api/auth/request-password-reset')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ email, redirectTo: `${ORIGIN}/redefinir-senha` });
        const token = new URL((await account.mailTo(email, /senha/i)).link).searchParams.get(
          'token',
        )!;

        const reset = await account
          .http()
          .post('/api/auth/reset-password')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ newPassword, token });
        expect(reset.status).toBe(200);

        expect((await getSession(agent)).body).toBeNull(); // a sessão antiga foi revogada
        expect((await signIn(account.agent(), email, PASSWORD)).status).toBe(401);
        expect((await signIn(account.agent(), email, newPassword)).status).toBe(200);

        const again = await account
          .http()
          .post('/api/auth/reset-password')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ newPassword: 'mais-uma-senha-longa-3', token });
        expect(again.status).toBe(400);
      });

      it('o pedido de redefinição guarda só o resumo do token no banco (um vazamento do banco não entrega token vivo)', async () => {
        const { email, userId } = await createLoggedInUser(account, prisma);
        await account
          .http()
          .post('/api/auth/request-password-reset')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({ email, redirectTo: `${ORIGIN}/redefinir-senha` });
        const token = new URL((await account.mailTo(email, /senha/i)).link).searchParams.get(
          'token',
        )!;

        const rows = await prisma.verification.findMany({ where: { value: userId } });
        expect(rows.length).toBeGreaterThan(0);
        expect(JSON.stringify(rows)).not.toContain(token);
      });

      it('token inventado e senha nova curta são recusados', async () => {
        const post = (body: object) =>
          account
            .http()
            .post('/api/auth/reset-password')
            .set('Origin', ORIGIN)
            .set('X-Forwarded-For', nextIp())
            .send(body);
        expect(
          (await post({ newPassword: 'senha-nova-bem-longa', token: 'inventado' })).status,
        ).toBe(400);
        expect((await post({ newPassword: 'curta', token: 'inventado' })).status).toBe(400);
      });
    });

    describe('o papel admin não existe pelo HTTP', () => {
      it('a atualização do perfil não existe (404): nem o papel, nem o nome, nem a imagem mudam por HTTP', async () => {
        const { agent, userId } = await createLoggedInUser(account, prisma);
        const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        const update = (body: object) =>
          agent
            .post('/api/auth/update-user')
            .set('Origin', ORIGIN)
            .set('X-Forwarded-For', nextIp())
            .send(body);

        for (const body of [
          { role: 'ADMIN' },
          { role: 'admin' },
          { name: 'Nome novo', role: 'ADMIN' },
          { name: 'Nome novo' },
          { image: 'javascript:alert(1)' },
          { name: 'n'.repeat(10_000) },
        ]) {
          expect((await update(body)).status, JSON.stringify(body).slice(0, 40)).toBe(404);
        }
        const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
        expect(after).toMatchObject({ role: 'USER', name: before.name, image: null });
      });

      it('o Better Auth está sem plugin (o do admin, por exemplo, abriria rotas que trocam papel) e o e-mail não muda por HTTP', async () => {
        expect((account.auth.options as { plugins?: unknown[] }).plugins ?? []).toEqual([]);
        const { agent, userId, email } = await createLoggedInUser(account, prisma);
        for (const [path, body] of [
          ['/api/auth/update-user', { email: 'outro@example.test' }],
          ['/api/auth/change-email', { newEmail: 'outro@example.test' }],
        ] as const) {
          const res = await agent
            .post(path)
            .set('Origin', ORIGIN)
            .set('X-Forwarded-For', nextIp())
            .send(body);
          expect(res.status, path).toBe(404);
        }
        expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(email);
      });

      it('a imagem do usuário é sempre nula, também quando o código atualiza o usuário (defesa em profundidade)', async () => {
        const { userId } = await createLoggedInUser(account, prisma);
        const { internalAdapter } = await account.auth.$context;
        await internalAdapter.updateUser(userId, { image: 'https://example.test/foto.png' });
        expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).image).toBeNull();
      });
    });

    // A rota do Better Auth que o site não usa é superfície de ataque: o /verify-password, por exemplo, é um oráculo de senha sem o
    // freio do login, e o /update-user grava nome e imagem sem teto. Tudo nasce fechado (`disabledPaths`, auth.ts); este teste lista as
    // rotas que o Better Auth tem NESTA versão e reprova a rota que não está aqui nem fechada, para uma atualização do pacote não abrir
    // nada em silêncio: decida (abrir aqui, com limite próprio, ou fechar no auth.ts).
    describe('só as rotas do Better Auth que o site usa estão abertas', () => {
      const OPEN = [
        '/ok',
        '/error',
        '/sign-up/email',
        '/sign-in/email',
        '/sign-in/social',
        '/callback/:id',
        '/get-session',
        '/sign-out',
        '/verify-email',
        '/send-verification-email',
        '/request-password-reset',
        '/reset-password',
        '/reset-password/:token',
      ];
      type Endpoint = { path?: string; options: { method?: string | string[] } };
      const endpoints = (): Array<Required<Pick<Endpoint, 'path'>> & { method: string }> =>
        (Object.values(account.auth.api) as unknown as Endpoint[])
          .filter((e): e is Endpoint & { path: string } => typeof e.path === 'string')
          .map((e) => ({
            path: e.path,
            method: [e.options.method ?? 'GET'].flat()[0]!,
          }));

      it('toda rota fora da lista do site responde 404 pela HTTP', async () => {
        const { agent } = await createLoggedInUser(account, prisma);
        const closed = endpoints().filter((e) => !OPEN.includes(e.path));
        expect(closed.length).toBeGreaterThan(10);
        for (const { path, method } of closed) {
          const res =
            method === 'GET'
              ? await agent.get(`/api/auth${path}`).set('X-Forwarded-For', nextIp())
              : await agent
                  .post(`/api/auth${path}`)
                  .set('Origin', ORIGIN)
                  .set('X-Forwarded-For', nextIp())
                  .send({});
          expect(res.status, `${method} ${path} deveria estar fechada`).toBe(404);
        }
      });

      it('a lista do site não tem rota que o Better Auth já não tem (entrada velha esconde uma rota nova)', () => {
        const known = endpoints().map((e) => e.path);
        for (const path of OPEN) expect(known, path).toContain(path);
      });

      it('as rotas da lista funcionam (a lista não está fechando o que o site usa)', async () => {
        expect((await account.http().get('/api/auth/ok')).status).toBe(200);
        expect((await account.http().get('/api/auth/get-session')).status).toBe(200);
      });
    });

    describe('o login com o Google (provedor falso, sem rede)', () => {
      const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const idToken = (claims: object) =>
        `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
          iss: 'https://accounts.google.com',
          aud: GOOGLE_CLIENT_ID,
          sub: `google-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          email_verified: true,
          name: 'Pessoa do Google',
          picture: 'https://lh3.example.test/avatar.jpg',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          ...claims,
        })}.assinatura-falsa`;

      // O único endereço que o fluxo pode tocar é o da troca do código; qualquer outro derruba o teste.
      function fakeGoogle(claims: object) {
        const calls: string[] = [];
        vi.stubGlobal(
          'fetch',
          vi.fn((input: string | URL | Request) => {
            const url = String(input instanceof Request ? input.url : input);
            calls.push(url);
            if (url !== 'https://oauth2.googleapis.com/token') {
              return Promise.reject(new Error(`chamada de rede inesperada no teste: ${url}`));
            }
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  access_token: 'ya29.token-de-acesso-falso',
                  refresh_token: 'token-de-refresh-falso',
                  id_token: idToken(claims),
                  token_type: 'Bearer',
                  expires_in: 3599,
                  scope: 'openid email profile',
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
              ),
            );
          }),
        );
        return calls;
      }

      const start = (agent: ReturnType<AccountApp['agent']>, body: object) =>
        agent
          .post('/api/auth/sign-in/social')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({
            provider: 'google',
            callbackURL: '/conta',
            ...body,
          });
      const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
      const callback = (agent: ReturnType<AccountApp['agent']>, state: string) =>
        agent
          .get(`/api/auth/callback/google?code=codigo-falso&state=${state}`)
          .set('X-Forwarded-For', nextIp());

      it('o início do fluxo manda para o Google com o client id, o redirect para a API, PKCE e o escopo mínimo', async () => {
        const res = await start(account.agent(), {
          requestSignUp: true,
          additionalData: { consent: account.consent() },
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ redirect: true });
        const url = new URL((res.body as { url: string }).url);
        expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(url.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID);
        expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/google`);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual([
          'email',
          'openid',
          'profile',
        ]);
        expect(url.searchParams.get('state')).toBeTruthy();
      });

      it('cadastro pelo Google sem o aceite explícito: 400 CONSENT_REQUIRED, sem URL', async () => {
        for (const body of [
          { requestSignUp: true },
          { requestSignUp: true, additionalData: { consent: { terms: '0.0', privacy: '0.0' } } },
        ]) {
          const res = await start(account.agent(), body);
          expect(res.status).toBe(400);
          expect(res.body).toMatchObject({ code: 'CONSENT_REQUIRED' });
        }
      });

      it('o callback cria a conta (e-mail verificado, sem tokens do Google), registra o aceite e abre a sessão', async () => {
        const email = newEmail();
        const calls = fakeGoogle({ email });
        const agent = account.agent();
        const begun = await start(agent, {
          requestSignUp: true,
          additionalData: { consent: account.consent() },
        });
        const res = await callback(agent, stateOf((begun.body as { url: string }).url));

        expect(calls).toEqual(['https://oauth2.googleapis.com/token']);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/conta');
        expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(
          /alvesting\.session_token=/,
        );

        const user = await prisma.user.findUniqueOrThrow({
          where: { email },
          include: { accounts: true, consents: true },
        });
        expect(user).toMatchObject({ emailVerified: true, role: 'USER', image: null });
        expect(user.accounts).toHaveLength(1);
        expect(user.accounts[0]).toMatchObject({
          providerId: 'google',
          accessToken: null,
          refreshToken: null,
          idToken: null,
          password: null,
        });
        expect(user.consents.map((c) => c.document).sort()).toEqual(['PRIVACY', 'TERMS']);
        expect((await getSession(agent)).body).toMatchObject({ user: { email } });
      });

      it('quem já tem conta entra pelo Google sem repetir o aceite; quem não tem não ganha conta por tentar entrar', async () => {
        const email = newEmail();
        fakeGoogle({ email, sub: `sub-fixo-${email}` });
        const signUpAgent = account.agent();
        const begun = await start(signUpAgent, {
          requestSignUp: true,
          additionalData: { consent: account.consent() },
        });
        await callback(signUpAgent, stateOf((begun.body as { url: string }).url));
        await signUpAgent
          .post('/api/auth/sign-out')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({});

        // entrar de novo: sem requestSignUp e sem aceite, e funciona
        const again = account.agent();
        const second = await start(again, {});
        const entered = await callback(again, stateOf((second.body as { url: string }).url));
        expect(entered.status).toBe(302);
        expect((await getSession(again)).body).toMatchObject({ user: { email } });
        // o Better Auth reescreve os tokens da conta a cada login novo (updateAccountOnSignIn): o hook de update os zera também
        const google = await prisma.account.findFirstOrThrow({
          where: { providerId: 'google', user: { email } },
        });
        expect(google).toMatchObject({
          accessToken: null,
          refreshToken: null,
          idToken: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          scope: null,
        });

        // um Google novo que só tenta entrar não cria conta
        const stranger = newEmail();
        fakeGoogle({ email: stranger });
        const tourist = account.agent();
        const third = await start(tourist, {});
        const denied = await callback(tourist, stateOf((third.body as { url: string }).url));
        expect(String(denied.headers.location)).toMatch(/error=/i);
        expect(await userByEmail(stranger)).toBeNull();
        expect((await getSession(tourist)).body).toBeNull();
      });

      // O corpo que as telas mandam (apps/web/src/lib/account-client.ts, `googleBody`): os caminhos de volta são caminhos do site,
      // relativos. A tela de entrar traduz o `?error=` que o Better Auth acrescenta ao `errorCallbackURL` (a lista fechada de
      // apps/web/src/app/entrar/page.tsx): estes são os códigos de verdade, e a tela que errar um deles mostra a frase geral.
      it('com o corpo que as telas mandam, o cadastro novo vai para /conta e os erros voltam para /entrar?error=', async () => {
        const screens = (consent?: object) => ({
          callbackURL: '/conta',
          newUserCallbackURL: '/conta',
          errorCallbackURL: '/entrar',
          ...(consent ? { requestSignUp: true, additionalData: { consent } } : {}),
        });

        // cadastro novo, com o aceite: abre a sessão e vai para a conta
        const email = newEmail();
        fakeGoogle({ email });
        const agent = account.agent();
        const begun = await start(agent, screens(account.consent()));
        expect(begun.status).toBe(200);
        const done = await callback(agent, stateOf((begun.body as { url: string }).url));
        expect(done.headers.location).toBe('/conta');

        // quem tenta só entrar, sem conta: signup_disabled
        fakeGoogle({ email: newEmail() });
        const tourist = account.agent();
        const second = await start(tourist, screens());
        const denied = await callback(tourist, stateOf((second.body as { url: string }).url));
        expect(denied.headers.location).toBe('/entrar?error=signup_disabled');

        // quem tem conta por senha com o mesmo e-mail: account_not_linked
        const { email: withPassword } = await createLoggedInUser(account, prisma);
        fakeGoogle({ email: withPassword });
        const linker = account.agent();
        const third = await start(linker, screens(account.consent()));
        const notLinked = await callback(linker, stateOf((third.body as { url: string }).url));
        expect(notLinked.headers.location).toBe('/entrar?error=account_not_linked');

        // e-mail que o Google não confirma: email_not_verified
        fakeGoogle({ email: newEmail(), email_verified: false });
        const unverified = account.agent();
        const fifth = await start(unverified, screens(account.consent()));
        const refused = await callback(unverified, stateOf((fifth.body as { url: string }).url));
        expect(refused.headers.location).toBe('/entrar?error=email_not_verified');

        // o Google devolve o erro (a pessoa cancelou a tela de consentimento): o código dele chega à tela
        const canceller = account.agent();
        const fourth = await start(canceller, screens());
        const cancelled = await canceller
          .get(
            `/api/auth/callback/google?error=access_denied&state=${stateOf((fourth.body as { url: string }).url)}`,
          )
          .set('X-Forwarded-For', nextIp());
        expect(cancelled.headers.location).toBe('/entrar?error=access_denied');
      });

      it('quem já tem conta por senha com o mesmo e-mail não é ligado ao Google sozinho (contra o sequestro de cadastro)', async () => {
        const { email, userId } = await createLoggedInUser(account, prisma);
        fakeGoogle({ email });
        const agent = account.agent();
        const begun = await start(agent, {
          requestSignUp: true,
          additionalData: { consent: account.consent() },
        });
        const res = await callback(agent, stateOf((begun.body as { url: string }).url));

        expect(String(res.headers.location)).toMatch(/error=/i);
        expect(await prisma.account.count({ where: { userId, providerId: 'google' } })).toBe(0);
        expect((await getSession(agent)).body).toBeNull();
      });

      it('o login com o id_token mandado pelo cliente está desligado: só o fluxo por redirecionamento, que conduz o aceite', async () => {
        const email = newEmail();
        const calls = fakeGoogle({ email });
        const res = await account
          .http()
          .post('/api/auth/sign-in/social')
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({
            provider: 'google',
            idToken: { token: idToken({ email }) },
            requestSignUp: true,
            additionalData: { consent: account.consent() },
          });
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'ID_TOKEN_NOT_SUPPORTED' });
        expect(calls).toEqual([]);
        expect(await userByEmail(email)).toBeNull();
      });

      it('e-mail que o Google não confirma não entra', async () => {
        const email = newEmail();
        fakeGoogle({ email, email_verified: false });
        const agent = account.agent();
        const begun = await start(agent, {
          requestSignUp: true,
          additionalData: { consent: account.consent() },
        });
        const res = await callback(agent, stateOf((begun.body as { url: string }).url));
        expect(String(res.headers.location)).toMatch(/error=/);
        expect((await getSession(agent)).body).toBeNull();
        // sem sessão e sem e-mail verificado (se o cadastro nasceu, ele é como um cadastro por e-mail ainda por confirmar)
        expect((await userByEmail(email))?.emailVerified ?? false).toBe(false);
      });

      it('sem GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET o login por Google não existe, e o resto continua de pé', async () => {
        const bare = await startAccountApp(apiPrisma, { withGoogle: false });
        try {
          expect(bare.auth.options.socialProviders ?? {}).toEqual({});
          const res = await bare
            .http()
            .post('/api/auth/sign-in/social')
            .set('Origin', ORIGIN)
            .set('X-Forwarded-For', nextIp())
            .send({ provider: 'google', callbackURL: '/conta' });
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(res.status).toBeLessThan(500);
          expect((await bare.http().get('/api/auth/ok')).status).toBe(200);
          expect((await bare.http().get('/api/v1/legal')).status).toBe(200);
        } finally {
          await bare.stop();
        }
      });
    });

    // O alerta "aceite não gravado" (infra/modules/alerts.bicep) procura esta linha: o usuário foi criado e o aceite dos termos, não.
    describe('a linha de log do alerta de aceite não gravado', () => {
      it('sai com o ULID do usuário (e nenhum dado pessoal) quando a gravação do aceite falha', async () => {
        const lines: string[] = [];
        const consent = new ConsentService(prisma, account.docs);
        vi.spyOn(consent, 'record').mockRejectedValue(new Error('banco fora'));
        const auth = createAuth({
          prisma,
          config: accountConfig(
            parseEnv({
              DATABASE_URL: testDatabaseUrl!,
              NODE_ENV: 'test',
              PUBLIC_URL: ORIGIN,
              EMAIL_OUTBOX_DIR: account.outboxDir,
            }),
          ),
          mailer: new AccountMailer(new OutboxEmailSender(account.outboxDir), () => undefined),
          consent,
          log: (_level, line) => lines.push(line),
        });
        const email = newEmail();
        // o erro sobe (`onAPIError.throw`): é a rota AuthRoute que o transforma em 500 no envelope
        await expect(
          auth.handler(
            new Request(`${ORIGIN}/api/auth/sign-up/email`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', origin: ORIGIN },
              body: JSON.stringify({
                name: 'Pessoa de Teste',
                email,
                password: PASSWORD,
                consent: account.consent(),
              }),
            }),
          ),
        ).rejects.toThrow('banco fora');
        const line = lines.find((l) => l.startsWith(ALERT_LOG.consentNotRecorded));
        expect(line).toBeDefined();
        const user = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(line).toBe(`${ALERT_LOG.consentNotRecorded} ${user.id}`);
        expect(lines.join('\n')).not.toContain(email);
      });
    });

    // Produção não roda em http, então o supertest não a alcança: aqui o Better Auth de produção é montado com a configuração de produção de
    // verdade (accountConfig, https, atrás do Front Door) e chamado pelo handler com uma Request, no mesmo banco.
    describe('em produção (https, atrás do Front Door)', () => {
      const publicUrl = 'https://alvesting.example.test';
      const productionAuth = () =>
        createAuth({
          prisma,
          config: accountConfig(
            parseEnv({
              DATABASE_URL: testDatabaseUrl!,
              NODE_ENV: 'production',
              PUBLIC_URL: publicUrl,
              BETTER_AUTH_SECRET: 'k9Zq4Wm7Xr2Pv8Ls5Nd3Hb6Ty1Fc0GjQe7Ua4Ro2Ki9Mz3',
              ACS_CONNECTION_STRING:
                'endpoint=https://acs-teste.communication.azure.com/;accesskey=c2VtLXZhbG9y',
              EMAIL_SENDER_ADDRESS: 'DoNotReply@0123abcd.azurecomm.net',
              LEGAL_CONTROLLER_NAME: 'Controlador de Teste',
              LEGAL_CONTACT_EMAIL: 'privacidade@example.test',
              ORIGIN_LOCK: 'front-door',
              FRONT_DOOR_ID: 'c0ffee00-1234-4abc-8def-0123456789ab',
            }),
          ),
          mailer: new AccountMailer(new OutboxEmailSender(account.outboxDir), () => undefined),
          consent: new ConsentService(prisma, account.docs),
          log: () => undefined,
        });
      const signInRequest = (body: object, headers: Record<string, string>) =>
        new Request(`${publicUrl}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: publicUrl, ...headers },
          body: JSON.stringify(body),
        });

      it('o cookie da sessão é Secure, HttpOnly e SameSite=Lax, com o prefixo __Secure-', async () => {
        const auth = productionAuth();
        const { sessionToken } = (await auth.$context).authCookies;
        expect(sessionToken.name).toBe('__Secure-alvesting.session_token');
        expect(sessionToken.attributes).toMatchObject({
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        });

        const { email, password } = await createLoggedInUser(account, prisma);
        const res = await auth.handler(
          signInRequest({ email, password }, { 'x-azure-socketip': '203.0.113.50' }),
        );
        expect(res.status).toBe(200);
        const cookie = res.headers.getSetCookie().join(';');
        expect(cookie).toMatch(/__Secure-alvesting\.session_token=/);
        expect(cookie).toMatch(/;\s*Secure/i);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
      });

      // O Secure e o prefixo __Secure- saem do esquema da PUBLIC_URL, e não do NODE_ENV (o padrão do próprio Better Auth). É o que faz o e2e,
      // que roda com NODE_ENV=test atrás de um Front Door imitado em https, exercitar o cookie de produção em Chromium e WebKit; e o que
      // deixa o dev em http sem o prefixo (um __Secure- vindo de http o WebKit descarta).
      it.each([
        ['https', 'https://alvesting.example.test', '__Secure-alvesting.session_token', true],
        ['http', 'http://127.0.0.1:4300', 'alvesting.session_token', false],
      ])(
        'fora de produção, com a PUBLIC_URL em %s, o cookie da sessão é %s (Secure: %s)',
        async (_scheme, publicUrl, name, secure) => {
          const auth = createAuth({
            prisma,
            config: accountConfig(
              parseEnv({
                DATABASE_URL: testDatabaseUrl!,
                NODE_ENV: 'test',
                PUBLIC_URL: publicUrl,
                EMAIL_OUTBOX_DIR: account.outboxDir,
              }),
            ),
            mailer: new AccountMailer(new OutboxEmailSender(account.outboxDir), () => undefined),
            consent: new ConsentService(prisma, account.docs),
            log: () => undefined,
          });
          const { sessionToken } = (await auth.$context).authCookies;
          expect(sessionToken.name).toBe(name);
          expect(sessionToken.attributes).toMatchObject({
            secure,
            httpOnly: true,
            sameSite: 'lax',
          });
        },
      );

      it('atrás do Front Door o limite de tentativas conta pelo IP do soquete: o X-Forwarded-For que o cliente escreve não escapa dele', async () => {
        const auth = productionAuth();
        const email = newEmail();
        const statuses: number[] = [];
        for (let i = 0; i < 4; i += 1) {
          const res = await auth.handler(
            signInRequest(
              { email, password: 'senha-errada-qualquer' },
              { 'x-azure-socketip': '203.0.113.51', 'x-forwarded-for': `198.51.100.${200 + i}` },
            ),
          );
          statuses.push(res.status);
        }
        expect(statuses).toEqual([401, 401, 401, 429]);
      });
    });

    // O Better Auth entra antes dos body parsers do Nest (o limite de 100 KB deles não vale em /api/auth) e o handler dele lê o corpo
    // inteiro para a memória. Sem teto, uma requisição anônima de 100 MB levava a api de 205 MB a 603 MB (o ca-api tem 0,5 GiB).
    describe('o corpo de /api/auth tem teto (16 KB)', () => {
      const MAX = 16 * 1024;
      const post = (path: string) =>
        account.http().post(path).set('Origin', ORIGIN).set('X-Forwarded-For', nextIp());

      it('corpo declarado acima do teto: 413 no envelope, e nada é criado', async () => {
        const email = newEmail();
        const res = await post('/api/auth/sign-up/email').send({
          name: 'Pessoa de Teste',
          email,
          password: PASSWORD,
          consent: account.consent(),
          callbackURL: `/${'a'.repeat(MAX)}`,
        });
        expect(res.status).toBe(413);
        expect(res.body).toMatchObject({
          success: false,
          data: null,
          error: { code: 'PAYLOAD_TOO_LARGE' },
        });
        expect(res.headers['cache-control']).toBe('no-store');
        expect(await userByEmail(email)).toBeNull();
      });

      // 200 KB: a recusa vem do tamanho declarado, sem ler o corpo. Corpo maior que os buffers do soquete (alguns MB) faria o supertest, que
      // fecha o servidor assim que a resposta chega, tomar EPIPE no meio do envio: ruído do teste, não da rota.
      it('200 KB também: a recusa vem do tamanho declarado, sem ler o corpo', async () => {
        const res = await post('/api/auth/sign-in/email').send({
          email: newEmail(),
          password: PASSWORD,
          callbackURL: 'a'.repeat(200 * 1024),
        });
        expect(res.status).toBe(413);
      });

      it('corpo dentro do teto segue para o Better Auth', async () => {
        const res = await post('/api/auth/sign-in/email').send({
          email: newEmail(),
          password: PASSWORD,
          callbackURL: `/${'a'.repeat(MAX - 1024)}`,
        });
        expect(res.status).not.toBe(413);
      });

      it('corpo sem tamanho declarado (Transfer-Encoding: chunked) é recusado: não há como conferir antes de ler', async () => {
        // o supertest sempre declara o tamanho: aqui a requisição é montada à mão, em pedaços, num servidor de verdade
        const server = createServer(account.app.getHttpAdapter().getInstance() as RequestListener);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
          const { port } = server.address() as AddressInfo;
          const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
            const req = httpRequest(
              {
                host: '127.0.0.1',
                port,
                method: 'POST',
                path: '/api/auth/sign-in/email',
                headers: {
                  'content-type': 'application/json',
                  origin: ORIGIN,
                  'x-forwarded-for': nextIp(),
                  'transfer-encoding': 'chunked',
                },
              },
              (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => (body += chunk.toString()));
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
              },
            );
            req.on('error', reject);
            req.write('{"email":"a@example.test",');
            req.end('"password":"senha-qualquer-1"}');
          });
          expect(result.status).toBe(413);
          expect(JSON.parse(result.body)).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      });

      it('a rota /api/v1 continua com o teto do Nest (100 KB)', async () => {
        const { agent } = await createLoggedInUser(account, prisma);
        const res = await asSite(agent.post('/api/v1/me/consents')).send({
          terms: 'x'.repeat(200 * 1024),
        });
        expect(res.status).toBe(413);
      });
    });

    // Em teste o Better Auth, por padrão, desliga a conferência de origem e de callbackURL (NODE_ENV=test): o `advanced` explícito
    // as liga em todo ambiente, e estes testes são os que garantem que o CSRF e o redirecionamento aberto continuam fechados.
    describe('a origem e o callbackURL são conferidos (CSRF e redirecionamento aberto)', () => {
      const evil = 'https://evil.example.test';

      it('login com Origin de outro site: 403', async () => {
        const res = await account
          .http()
          .post('/api/auth/sign-in/email')
          .set('Origin', evil)
          .set('X-Forwarded-For', nextIp())
          .send({ email: newEmail(), password: PASSWORD });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ code: 'INVALID_ORIGIN' });
      });

      it('com a sessão aberta, uma mutação com Origin de outro site (ou com "null") é 403', async () => {
        const { agent } = await createLoggedInUser(account, prisma);
        for (const origin of [evil, 'null', `${ORIGIN}.evil.example.test`]) {
          const res = await agent
            .post('/api/auth/sign-out')
            .set('Origin', origin)
            .set('X-Forwarded-For', nextIp())
            .send({});
          expect(res.status, origin).toBe(403);
        }
        expect((await getSession(agent)).status).toBe(200);
        expect((await getSession(agent)).body).not.toBeNull();
      });

      it.each([
        ['/api/auth/sign-up/email', 'callbackURL'],
        ['/api/auth/request-password-reset', 'redirectTo'],
        ['/api/auth/sign-in/social', 'callbackURL'],
      ])('%s com %s de outro site: 403, sem e-mail', async (path, field) => {
        const email = newEmail();
        const res = await account
          .http()
          .post(path)
          .set('Origin', ORIGIN)
          .set('X-Forwarded-For', nextIp())
          .send({
            name: 'Pessoa de Teste',
            email,
            password: PASSWORD,
            provider: 'google',
            consent: account.consent(),
            [field]: `${evil}/roubo`,
          });
        expect(res.status).toBe(403);
        expect(await userByEmail(email)).toBeNull();
      });

      it('o link de verificação com callbackURL de outro site: 403 e o e-mail não é verificado', async () => {
        const email = newEmail();
        await signUp(account.agent(), { email, consent: account.consent() });
        const mail = await account.mailTo(email, /Confirme/);
        const url = new URL(mail.link);
        url.searchParams.set('callbackURL', `${evil}/roubo`);
        const res = await account.http().get(url.pathname + url.search);
        expect(res.status).toBe(403);
        expect((await userByEmail(email))!.emailVerified).toBe(false);
      });
    });

    describe('a rota nova já nasce atrás da trava de origem', () => {
      it('com FRONT_DOOR_ID, /api/auth/* sem o X-Azure-FDID é 403; com ele passa', async () => {
        const fdid = 'c0ffee00-1234-4abc-8def-0123456789ab';
        const locked = await startAccountApp(apiPrisma, { frontDoorId: fdid });
        try {
          const denied = await locked.http().get('/api/auth/get-session');
          expect(denied.status).toBe(403);
          expect(denied.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
          const ok = await locked.http().get('/api/auth/get-session').set('X-Azure-FDID', fdid);
          expect(ok.status).toBe(200);
          expect((await locked.http().get('/api/v1/me')).status).toBe(403);
        } finally {
          await locked.stop();
        }
      });
    });
  },
);

// LGPD nos logs: nenhum e-mail, nome, IP, cookie ou token em lugar nenhum do que a aplicação escreve (o log de requisição, o do
// Nest e o do Better Auth), nem quando o envio do e-mail falha ou o banco devolve erro. Só o ULID do usuário pode aparecer.
describe.skipIf(!testDatabaseUrl)(integrationTitle('A conta: nada de dado pessoal no log'), () => {
  // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api (ADR 0028), com o qual a api sob teste atende as rotas
  let prisma: PrismaService;
  let apiPrisma: PrismaService;
  let account: AccountApp;
  const pino: string[] = [];
  const nest: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      pino.push(chunk.toString());
      callback();
    },
  });
  const failing = {
    send: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('falhou para o destinatario'), { code: 'ACS_FALHOU' }),
      ),
  };

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
    account = await startAccountApp(apiPrisma, {
      extraImports: [LoggerModule.forRoot({ pinoHttp: [httpLogOptions('info'), stream] })],
    });
    const capture = (...parts: unknown[]) => void nest.push(parts.map(String).join(' '));
    Logger.overrideLogger({
      log: capture,
      error: capture,
      warn: capture,
      debug: capture,
      verbose: capture,
      fatal: capture,
    });
  }, 60_000);

  afterAll(async () => {
    Logger.overrideLogger(false);
    await account?.stop();
    await prisma?.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
    await prisma?.verification.deleteMany();
    await prisma?.auditLog.deleteMany({ where: { action: { startsWith: 'account.' } } });
    await apiPrisma?.onModuleDestroy();
    await prisma?.onModuleDestroy();
  });

  it('percorre o cadastro, a verificação, o login, o erro, a redefinição e a exclusão sem deixar dado pessoal em log', async () => {
    const ip = '203.0.113.201';
    const email = newEmail();
    const agent = account.agent();
    const sensitive: string[] = [email, ip, PASSWORD];

    const created = await signUp(
      agent,
      { email, consent: account.consent(), name: 'Fulana Sobrenome Rara' },
      ip,
    );
    expect(created.status).toBe(200);
    sensitive.push('Fulana Sobrenome Rara');
    const verification = await account.mailTo(email, /Confirme/);
    const verifyUrl = new URL(verification.link);
    sensitive.push(verifyUrl.searchParams.get('token')!);
    await agent.get(verifyUrl.pathname + verifyUrl.search).set('X-Forwarded-For', ip);

    await signIn(agent, email, 'senha-errada-qualquer', ip);
    await signUp(account.agent(), { email, consent: account.consent() }, ip); // e-mail repetido
    const login = await signIn(agent, email, PASSWORD, ip);
    for (const cookie of login.headers['set-cookie'] as unknown as string[]) {
      sensitive.push(/=([^;]+)/.exec(cookie)![1]!);
    }
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true, sessions: true },
    });
    sensitive.push(user.accounts[0]!.password!, user.sessions[0]!.token);

    await account
      .http()
      .post('/api/auth/request-password-reset')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({ email, redirectTo: `${ORIGIN}/redefinir-senha` });
    const resetMail = await account.mailTo(email, /senha/i);
    const resetToken = new URL(resetMail.link).searchParams.get('token')!;
    sensitive.push(resetToken);
    await account
      .http()
      .get(
        `/api/auth/reset-password/${resetToken}?callbackURL=${encodeURIComponent('/redefinir-senha')}`,
      )
      .set('X-Forwarded-For', ip);
    await account
      .http()
      .post('/api/auth/reset-password')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({ newPassword: 'x', token: resetToken });
    // as rotas /api/v1 passam pelo log de requisição do pino; as de /api/auth, por uma linha do Nest (auth-route.ts)
    const relogin = await signIn(agent, email, 'senha-nova-que-nao-existe', ip);
    expect(relogin.status).toBe(401);
    await agent.get('/api/v1/me').set('X-Forwarded-For', ip);
    await agent.get(`/api/v1/me?token=${resetToken}&code=${PASSWORD}`).set('X-Forwarded-For', ip);
    await agent.get('/api/v1/nao-existe').set('X-Forwarded-For', ip);
    await agent.get('/api/v1/me/export').set('X-Forwarded-For', ip);
    await agent.delete('/api/v1/me').set('Origin', ORIGIN).set('X-Forwarded-For', ip).send({});
    await agent
      .post('/api/auth/sign-out')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send({});

    // erro de envio: o remetente falha, e o log tem o código do erro mas não o endereço
    const mailer = new AccountMailer(failing, (line) => void nest.push(line));
    mailer.sendVerification(email, `${ORIGIN}/api/auth/verify-email?token=${resetToken}`);
    await mailer.idle();

    await vi.waitFor(() => expect(pino.length).toBeGreaterThanOrEqual(5));
    const everything = [...pino, ...nest].join('\n');
    expect(everything.length).toBeGreaterThan(200);
    for (const secret of sensitive) {
      expect(everything, `vazou: ${secret.slice(0, 8)}…`).not.toContain(secret);
    }
    expect(everything).toContain('ACS_FALHOU');
    // o caminho com o token da redefinição saiu como :token
    expect(everything).toContain('/api/auth/reset-password/:token');
  });

  // O Better Auth tem DOIS caminhos de log fora do `logger` que a API configura: o roteador escreve `ERROR [Better Auth]: <mensagem>`
  // pelo logger padrão (console) a cada erro de usuário, e o better-call faz `console.error('# SERVER_ERROR:', erro)` com o erro e a
  // pilha crus quando a exceção não é dele (o Prisma, por exemplo). Nenhum dos dois passa pelo redactPii nem pelo formato do pino.
  // `onAPIError: { throw: true }` os desliga: o erro de usuário vira a resposta 4xx e o inesperado cai no AuthRoute, que o loga limpo.
  it('nada escapa pelo console do Better Auth: nem o erro de usuário (4xx), nem a exceção inesperada (500, logada limpa pela API)', async () => {
    const consoleCalls: string[] = [];
    const spies = (['error', 'warn', 'log', 'info'] as const).map((method) =>
      vi
        .spyOn(console, method)
        .mockImplementation(
          (...args: unknown[]) => void consoleCalls.push(args.map(String).join(' ')),
        ),
    );
    const email = newEmail();
    nest.length = 0;
    try {
      // erros de usuário: aceite ausente, tipo de conteúdo que o Better Auth não aceita (a mensagem repete o cabeçalho do cliente),
      // JSON torto e Origin de outro site
      await signUp(account.agent(), { email });
      await account
        .http()
        .post('/api/auth/sign-in/email')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp())
        .set('Content-Type', `text/plain; x=${email}`)
        .send('email=1');
      await account
        .http()
        .post('/api/auth/sign-in/email')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp())
        .set('Content-Type', 'application/json')
        .send('{"email":');
      await account
        .http()
        .post('/api/auth/sign-in/email')
        .set('Origin', 'https://evil.example.test')
        .set('X-Forwarded-For', nextIp())
        .send({ email, password: PASSWORD });

      // exceção que não é do Better Auth (o banco, por exemplo, devolve um erro com o e-mail digitado na mensagem)
      const boom = vi
        .spyOn(account.app.get(ConsentService), 'isCurrent')
        .mockImplementationOnce(() => {
          throw new Error(`falha do banco para ${email}`);
        });
      const res = await signUp(account.agent(), { email, consent: account.consent() });
      boom.mockRestore();
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        data: null,
        error: expect.objectContaining({ code: 'INTERNAL_ERROR' }) as unknown,
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(consoleCalls.filter((line) => /Better Auth|SERVER_ERROR/.test(line))).toEqual([]);
    expect(consoleCalls.join('\n')).not.toContain(email);
    // a exceção inesperada saiu pelo log da API, sem o e-mail
    const logged = nest.join('\n');
    expect(logged).toContain('falha do banco para [e-mail]');
    expect(logged).not.toContain(email);
  });

  it('o logger do Better Auth montado pela API não passa dado pessoal nem objeto de usuário', () => {
    const lines: string[] = [];
    const config = accountConfig(
      parseEnv({
        DATABASE_URL: testDatabaseUrl!,
        EMAIL_OUTBOX_DIR: account.outboxDir,
      }),
    );
    const auth = createAuth({
      prisma,
      config,
      mailer: new AccountMailer(new OutboxEmailSender(account.outboxDir), () => undefined),
      consent: new ConsentService(prisma, account.docs),
      log: (level, line) => void lines.push(`${level} ${line}`),
    });
    const logger = auth.options.logger;
    logger.log('error', 'falha com pessoa@example.test', new Error('segredo pessoa@example.test'), {
      email: 'pessoa@example.test',
    });
    expect(lines.join('\n')).toBe('error falha com [e-mail] [Error]');
    // o nome do campo que muda o nível de log sai do contrato do Better Auth: só aviso e erro
    expect(logger.level).toBe('warn');
    void GOOGLE_CLIENT_ID;
  });
});
