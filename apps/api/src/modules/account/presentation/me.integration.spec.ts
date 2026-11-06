import {
  REAUTH_REQUIRED,
  authProvidersSchema,
  consentStatusSchema,
  envelopeSchema,
  legalSchema,
  meSchema,
  userExportSchema,
} from '@alvesting/contracts';
import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { newId } from '../../../common/id.js';
import { promoteToAdmin } from '../application/promote.js';
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
import { ConsentGuard } from './consent.guard.js';
import { Roles, RolesGuard } from './roles.guard.js';
import { SessionGuard } from './session.guard.js';

// Um controlador de mentira, só do teste: o jeito que as etapas 10 (admin), 12 (carteira) e 13 (chat) vão usar os guards. A etapa 11
// não tem rota de admin nem de carteira; isto prova que o guard de papel e o de aceite já funcionam quando elas chegarem.
@Controller('sonda')
class ProbeController {
  @Get('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles('ADMIN')
  admin() {
    return { ok: 'admin' };
  }

  @Get('recurso')
  @UseGuards(SessionGuard, ConsentGuard)
  recurso() {
    return { ok: 'recurso' };
  }

  // esquecer o SessionGuard antes do RolesGuard ou do ConsentGuard não pode abrir a rota
  @Get('sem-sessao-admin')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  semSessaoAdmin() {
    return { ok: 'nunca' };
  }

  @Get('sem-sessao-aceite')
  @UseGuards(ConsentGuard)
  semSessaoAceite() {
    return { ok: 'nunca' };
  }

  // esquecer o @Roles não pode virar uma porta aberta: nem o admin passa (as rotas /admin da etapa 10 dependem disto)
  @Get('sem-roles')
  @UseGuards(SessionGuard, RolesGuard)
  semRoles() {
    return { ok: 'nunca' };
  }
}

const anyEnvelope = envelopeSchema(z.unknown());

// O aceite só some junto com a conta (gatilho consent_no_delete, migration account_limits). Para simular "usuário sem aceite", o teste
// desliga o gatilho por um instante, como o dono da tabela.
async function removeConsent(prisma: PrismaService, userId: string): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE consent DISABLE TRIGGER consent_no_delete');
  try {
    await prisma.consent.deleteMany({ where: { userId } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE consent ENABLE TRIGGER consent_no_delete');
  }
}

// Uma carteira com lançamentos, gravada direto pelo administrador (o que a api grava pelas rotas tem o teste próprio, em
// modules/portfolio). Os números são sintéticos.
async function seedPortfolio(prisma: PrismaService, userId: string, tickers = ['PETR4', 'VALE3']) {
  const portfolioId = newId();
  await prisma.portfolio.create({ data: { id: portfolioId, userId } });
  const lotIds: string[] = [];
  for (const [index, ticker] of tickers.entries()) {
    const id = newId();
    lotIds.push(id);
    await prisma.portfolioLot.create({
      data: {
        id,
        portfolioId,
        ticker,
        quantity: 100 + index,
        costCents: 355_000n + BigInt(index),
        boughtOn: index === 0 ? new Date('2026-10-15T00:00:00Z') : null,
      },
    });
  }
  return { portfolioId, lotIds };
}

describe.skipIf(!testDatabaseUrl)(integrationTitle('As rotas /me'), () => {
  // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api (ADR 0028), com o qual a api sob teste atende as rotas
  let prisma: PrismaService;
  let apiPrisma: PrismaService;
  let account: AccountApp;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    prisma = await openTestDatabase(testDatabaseUrl!);
    apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
    account = await startAccountApp(apiPrisma, { extraControllers: [ProbeController] });
  }, 60_000);

  afterAll(async () => {
    await account?.stop();
    await prisma?.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
    await prisma?.verification.deleteMany();
    await prisma?.auditLog.deleteMany({ where: { action: { startsWith: 'account.' } } });
    await apiPrisma?.onModuleDestroy();
    await prisma?.onModuleDestroy();
  });

  describe('sessão obrigatória', () => {
    it.each([
      ['GET', '/api/v1/me'],
      ['POST', '/api/v1/me/consents'],
      ['GET', '/api/v1/me/export'],
      ['DELETE', '/api/v1/me'],
    ])('%s %s sem sessão: 401 no envelope, sem cache', async (method, path) => {
      const res = await asSite(account.http()[method.toLowerCase() as 'get'](path)).send({});
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        data: null,
        error: { code: 'UNAUTHORIZED' },
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('cookie inventado, adulterado ou de sessão que já saiu: 401', async () => {
      const { agent } = await createLoggedInUser(account, prisma);
      expect(
        (await account.http().get('/api/v1/me').set('Cookie', 'alvesting.session_token=inventado'))
          .status,
      ).toBe(401);
      expect(
        (await account.http().get('/api/v1/me').set('Authorization', 'Bearer inventado')).status,
      ).toBe(401);
      const before = await agent.get('/api/v1/me');
      expect(before.status).toBe(200);
      await agent
        .post('/api/auth/sign-out')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp())
        .send({});
      expect((await agent.get('/api/v1/me')).status).toBe(401);
    });

    it('usuário apagado com a sessão ainda na mão: 401, não 500', async () => {
      const { agent, userId } = await createLoggedInUser(account, prisma);
      await prisma.user.delete({ where: { id: userId } });
      expect((await agent.get('/api/v1/me')).status).toBe(401);
    });
  });

  describe('GET /api/v1/me', () => {
    it('devolve os dados mínimos e o estado do aceite, validados pelo contrato, sem cache', async () => {
      const { agent, email, userId } = await createLoggedInUser(account, prisma);
      const res = await agent.get('/api/v1/me');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = envelopeSchema(meSchema).parse(res.body);
      expect(parsed.success && parsed.data).toMatchObject({
        id: userId,
        email,
        emailVerified: true,
        role: 'USER',
        consent: { upToDate: true },
      });
      const data = (res.body as { data: Record<string, unknown> }).data;
      expect(Object.keys(data).sort()).toEqual([
        'consent',
        'email',
        'emailVerified',
        'id',
        'name',
        'role',
      ]);
      const docs = (
        data.consent as {
          documents: Array<{
            document: string;
            version: string;
            sha256: string;
            acceptedAt: string;
          }>;
        }
      ).documents;
      expect(docs.map((d) => d.document)).toEqual(['TERMS', 'PRIVACY']);
      for (const doc of docs) {
        const current = account.docs.find((d) => d.document === doc.document)!;
        expect(doc).toMatchObject({ version: current.version, sha256: current.sha256 });
        expect(doc.acceptedAt).toMatch(/Z$/);
      }
    });

    it('não aceita parâmetro nenhum: a query desconhecida é 400', async () => {
      const { agent, userId } = await createLoggedInUser(account, prisma);
      for (const query of ['?userId=' + userId, '?x=1', '?x=a&x=b']) {
        expect((await agent.get(`/api/v1/me${query}`)).status, query).toBe(400);
      }
    });
  });

  describe('o aceite (POST /api/v1/me/consents)', () => {
    it('versão nova pede novo aceite: a rota protegida pelo ConsentGuard fecha (403 CONSENT_REQUIRED), as rotas de direito do titular não, e o aceite novo reabre', async () => {
      const { agent, userId } = await createLoggedInUser(account, prisma);
      expect((await agent.get('/api/v1/sonda/recurso')).status).toBe(200);

      // o texto novo entra em vigor: a versão sobe e o hash muda
      const terms = account.docs.findIndex((d) => d.document === 'TERMS');
      const original = account.docs[terms]!;
      account.docs[terms] = { ...original, version: '9.9', sha256: 'f'.repeat(64) };
      try {
        const me = await agent.get('/api/v1/me');
        expect(me.status).toBe(200);
        expect(
          consentStatusSchema.parse((me.body as { data: { consent: unknown } }).data.consent)
            .upToDate,
        ).toBe(false);
        const pending = (
          me.body as {
            data: {
              consent: {
                documents: Array<{ document: string; version: string; acceptedAt: string | null }>;
              };
            };
          }
        ).data.consent.documents;
        expect(pending.find((d) => d.document === 'TERMS')).toMatchObject({
          version: '9.9',
          acceptedAt: null,
        });
        expect(pending.find((d) => d.document === 'PRIVACY')!.acceptedAt).not.toBeNull();

        const blocked = await agent.get('/api/v1/sonda/recurso');
        expect(blocked.status).toBe(403);
        expect(blocked.body).toMatchObject({ success: false, error: { code: 'CONSENT_REQUIRED' } });

        // exportar e excluir são direitos do titular (LGPD art. 18): não dependem de aceitar o texto novo
        expect((await agent.get('/api/v1/me/export')).status).toBe(200);

        // aceitar a versão antiga não vale
        const stale = await asSite(agent.post('/api/v1/me/consents')).send({
          terms: original.version,
          privacy: account.consent().privacy,
        });
        expect(stale.status).toBe(409);
        expect((await agent.get('/api/v1/sonda/recurso')).status).toBe(403);

        const accepted = await asSite(agent.post('/api/v1/me/consents')).send({
          terms: '9.9',
          privacy: account.consent().privacy,
        });
        expect(accepted.status).toBe(200);
        expect(consentStatusSchema.parse((accepted.body as { data: unknown }).data).upToDate).toBe(
          true,
        );
        expect((await agent.get('/api/v1/sonda/recurso')).status).toBe(200);

        // o histórico guarda as duas versões do mesmo documento
        const rows = await prisma.consent.findMany({
          where: { userId, document: 'TERMS' },
          orderBy: { acceptedAt: 'asc' },
        });
        expect(rows.map((r) => r.version)).toEqual([original.version, '9.9']);
        expect(rows.map((r) => r.sha256)).toEqual([original.sha256, 'f'.repeat(64)]);
      } finally {
        account.docs[terms] = original;
      }
    });

    // A política foi da 0.2 para a 0.3 em 04/11/2026 (o item 5 passou a prometer o pior caso da limpeza diária); os termos não mudaram e seguem na
    // 0.2. Quem aceitou a 0.2 precisa aceitar a 0.3 antes de usar a carteira e o resto que pede aceite; só a política volta a ser pedida.
    it('quem aceitou a política 0.2 (a anterior) precisa aceitar a 0.3: a rota protegida fecha, exportar não, só a política fica pendente, e o aceite reabre', async () => {
      const privacy = account.docs.findIndex((d) => d.document === 'PRIVACY');
      const current = account.docs[privacy]!;
      expect(current.version).toBe('0.3');
      // o usuário nasce quando a política vigente ainda era a 0.2 (o hash é o congelado em legal-documents.spec.ts)
      account.docs[privacy] = {
        ...current,
        version: '0.2',
        sha256: 'cef4099255991531928b40d9ec2afeeb628949f5cb14be31a5db51fdc717ef4c',
      };
      let user: Awaited<ReturnType<typeof createLoggedInUser>>;
      try {
        user = await createLoggedInUser(account, prisma);
      } finally {
        account.docs[privacy] = current;
      }
      const { agent, userId } = user;

      const me = (await agent.get('/api/v1/me')).body as {
        data: { consent: { upToDate: boolean; documents: Array<Record<string, unknown>> } };
      };
      expect(me.data.consent.upToDate).toBe(false);
      expect(me.data.consent.documents).toMatchObject([
        { document: 'TERMS', version: '0.2', acceptedAt: expect.any(String) as string },
        { document: 'PRIVACY', version: '0.3', acceptedAt: null },
      ]);
      const blocked = await agent.get('/api/v1/sonda/recurso');
      expect(blocked.status).toBe(403);
      expect(blocked.body).toMatchObject({ success: false, error: { code: 'CONSENT_REQUIRED' } });
      expect((await agent.get('/api/v1/me/export')).status).toBe(200);

      // aceitar a 0.2 de novo não vale: é a anterior
      const stale = await asSite(agent.post('/api/v1/me/consents')).send({
        terms: '0.2',
        privacy: '0.2',
      });
      expect(stale.status).toBe(409);
      expect((await agent.get('/api/v1/sonda/recurso')).status).toBe(403);

      const accepted = await asSite(agent.post('/api/v1/me/consents')).send(account.consent());
      expect(accepted.status).toBe(200);
      expect((await agent.get('/api/v1/sonda/recurso')).status).toBe(200);
      // o histórico guarda a 0.2 e a 0.3 da política, cada uma com o hash do texto que a pessoa viu
      const rows = await prisma.consent.findMany({
        where: { userId, document: 'PRIVACY' },
        orderBy: { acceptedAt: 'asc' },
      });
      expect(rows.map((r) => r.version)).toEqual(['0.2', '0.3']);
      expect(rows.map((r) => r.sha256)).toEqual([
        'cef4099255991531928b40d9ec2afeeb628949f5cb14be31a5db51fdc717ef4c',
        current.sha256,
      ]);
    });

    it('aceitar de novo a mesma versão é inofensivo (não duplica a linha)', async () => {
      const { agent, userId } = await createLoggedInUser(account, prisma);
      for (let i = 0; i < 2; i += 1) {
        const res = await asSite(agent.post('/api/v1/me/consents')).send(account.consent());
        expect(res.status).toBe(200);
      }
      expect(await prisma.consent.count({ where: { userId } })).toBe(2);
    });

    it.each([
      ['corpo vazio', {}],
      ['pré-marcado', { accept: true }],
      ['campo a mais', { terms: '0.1', privacy: '0.1', extra: 1 }],
      ['versão que não é texto', { terms: 1, privacy: 1 }],
      ['versão torta', { terms: 'v1', privacy: 'v1' }],
    ])('corpo inválido (%s): 400', async (_nome, body) => {
      const { agent } = await createLoggedInUser(account, prisma);
      expect((await asSite(agent.post('/api/v1/me/consents')).send(body)).status).toBe(400);
    });

    it('versões que não são as vigentes: 409 e nada é gravado', async () => {
      const { agent, userId } = await createLoggedInUser(account, prisma);
      const before = await prisma.consent.count({ where: { userId } });
      const res = await asSite(agent.post('/api/v1/me/consents')).send({
        terms: '7.7',
        privacy: '7.7',
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'CONFLICT' } });
      expect(await prisma.consent.count({ where: { userId } })).toBe(before);
    });

    // O aceite é dos DOIS documentos: o cliente que cita a versão velha de um só (a que o usuário não viu) não grava aceite nenhum
    // de uma versão que ele não citou. Cada documento é conferido sozinho, no cadastro e aqui.
    it.each([
      ['só a privacidade é a velha', { privacy: '0.0' }],
      ['só os termos são os velhos', { terms: '0.0' }],
    ])('%s: 409 e nada é gravado', async (_nome, override) => {
      const { agent, userId } = await createLoggedInUser(account, prisma);
      await removeConsent(prisma, userId);
      const res = await asSite(agent.post('/api/v1/me/consents')).send({
        ...account.consent(),
        ...override,
      });
      expect(res.status).toBe(409);
      expect(await prisma.consent.count({ where: { userId } })).toBe(0);
    });

    it('o histórico não se reescreve: o banco recusa alterar uma linha de aceite', async () => {
      const { userId } = await createLoggedInUser(account, prisma);
      await expect(
        prisma.consent.updateMany({ where: { userId }, data: { version: '1.0' } }),
      ).rejects.toThrow(/histórico|consent/i);
      await expect(
        prisma.consent.updateMany({ where: { userId }, data: { sha256: 'e'.repeat(64) } }),
      ).rejects.toThrow();
      // a mesma linha duas vezes (usuário, documento, versão) também não existe
      const row = await prisma.consent.findFirstOrThrow({ where: { userId } });
      await expect(
        prisma.consent.create({
          data: {
            id: '01JZZZZZZZZZZZZZZZZZZZZZZZ',
            userId,
            document: row.document,
            version: row.version,
            sha256: row.sha256,
          },
        }),
      ).rejects.toThrow();
    });

    it('as mutações pedem a origem do site: sem Origin ou com Origin de fora, 403 (defesa extra contra CSRF)', async () => {
      const { agent } = await createLoggedInUser(account, prisma);
      expect((await agent.post('/api/v1/me/consents').send(account.consent())).status).toBe(403);
      expect(
        (
          await agent
            .post('/api/v1/me/consents')
            .set('Origin', 'https://atacante.example.test')
            .send(account.consent())
        ).status,
      ).toBe(403);
      expect(
        (await agent.post('/api/v1/me/consents').set('Origin', 'null').send(account.consent()))
          .status,
      ).toBe(403);
      expect(
        (await agent.delete('/api/v1/me').set('Origin', 'https://atacante.example.test').send({}))
          .status,
      ).toBe(403);
      expect((await asSite(agent.post('/api/v1/me/consents')).send(account.consent())).status).toBe(
        200,
      );
      // ler não pede origem (o cookie é SameSite=Lax e a leitura não muda nada)
      expect((await agent.get('/api/v1/me')).status).toBe(200);
    });
  });

  describe('GET /api/v1/legal (público)', () => {
    it('devolve o controlador (da configuração) e os dois textos vigentes, sem sessão, sem cache', async () => {
      const res = await account.http().get('/api/v1/legal');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const parsed = envelopeSchema(legalSchema).parse(res.body);
      expect(parsed.success && parsed.data.controller).toEqual({
        name: 'Controlador de Teste',
        contact: 'privacidade@example.test',
      });
      expect(
        parsed.success && parsed.data.documents.map((d) => [d.document, d.version, d.sha256]),
      ).toEqual(account.docs.map((d) => [d.document, d.version, d.sha256]));
    });

    it('parâmetro desconhecido ou repetido é 400, como em toda rota pública', async () => {
      for (const query of ['?x=1', '?x=a&x=b', '?x[y]=1']) {
        expect((await account.http().get(`/api/v1/legal${query}`)).status, query).toBe(400);
      }
    });
  });

  // A tela de entrar oferece o botão do Google só se a api o tem: o ID e o segredo do cliente OAuth existem juntos (docs/CONTA.md, 6).
  describe('GET /api/v1/auth/providers (público)', () => {
    it('com o ID e o segredo do Google configurados: google true, sem sessão, sem cache e sem vazar o client ID', async () => {
      const res = await account.http().get('/api/v1/auth/providers');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(envelopeSchema(authProvidersSchema).parse(res.body)).toEqual({
        success: true,
        data: { google: true },
        error: null,
      });
      expect(JSON.stringify(res.body)).not.toContain(GOOGLE_CLIENT_ID);
    });

    it('sem o Google configurado: google false', async () => {
      const bare = await startAccountApp(apiPrisma, { withGoogle: false });
      try {
        const res = await bare.http().get('/api/v1/auth/providers');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { google: false }, error: null });
      } finally {
        await bare.stop();
      }
    });

    it('parâmetro desconhecido ou repetido é 400, como em toda rota pública', async () => {
      for (const query of ['?x=1', '?x=a&x=b', '?x[y]=1']) {
        expect((await account.http().get(`/api/v1/auth/providers${query}`)).status, query).toBe(
          400,
        );
      }
    });

    it('só lê: POST e DELETE não existem', async () => {
      for (const method of ['post', 'delete', 'put'] as const) {
        expect((await account.http()[method]('/api/v1/auth/providers')).status, method).toBe(404);
      }
    });
  });

  describe('GET /api/v1/me/export', () => {
    it('é um download em JSON com tudo do usuário e nada de segredo', async () => {
      const { agent, email, userId, password } = await createLoggedInUser(account, prisma);
      const res = await agent.get('/api/v1/me/export');

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[\w.-]+\.json"$/);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['cache-control']).toBe('no-store');

      const parsed = envelopeSchema(userExportSchema).parse(res.body);
      const data = parsed.success ? parsed.data : undefined;
      expect(data?.user).toMatchObject({ id: userId, email, emailVerified: true, role: 'USER' });
      expect(data?.accounts.map((a) => a.providerId)).toEqual(['credential']);
      expect(data?.sessions).toHaveLength(1);
      expect(data?.consents.map((c) => c.document).sort()).toEqual(['PRIVACY', 'TERMS']);
      // quem nunca lançou nada exporta a carteira vazia
      expect(data?.portfolios).toEqual([]);
      expect(data?.portfolioLots).toEqual([]);

      // o corpo inteiro, como texto: nem o hash da senha, nem a senha, nem token de sessão, de verificação ou de redefinição
      const raw = res.text;
      const stored = await prisma.account.findFirstOrThrow({ where: { userId } });
      const sessionToken = (await prisma.session.findFirstOrThrow({ where: { userId } })).token;
      expect(stored.password).toBeTruthy();
      for (const secret of [stored.password!, password, sessionToken]) {
        expect(raw).not.toContain(secret);
      }
      expect(raw).not.toMatch(/"(password|token|accessToken|refreshToken|idToken)"/);
    });

    // A carteira (etapa 12) sai no JSON de LGPD: a linha dela e os lançamentos, com o custo em centavos e a data da compra como DATA (o dia
    // que o dono digitou, e não uma meia-noite UTC que no fuso de Brasília cairia na véspera). Nada do lançamento de outro usuário.
    it('leva a carteira e os lançamentos do dono, com a data como dia e o custo em centavos, e nada de outro usuário', async () => {
      const a = await createLoggedInUser(account, prisma);
      const b = await createLoggedInUser(account, prisma);
      const seeded = await seedPortfolio(prisma, a.userId);
      const other = await seedPortfolio(prisma, b.userId, ['ITUB4']);

      const res = await a.agent.get('/api/v1/me/export');
      expect(res.status).toBe(200);
      const parsed = envelopeSchema(userExportSchema).parse(res.body);
      const data = parsed.success ? parsed.data : undefined;
      expect(data?.portfolios.map((p) => p.id)).toEqual([seeded.portfolioId]);
      expect(data?.portfolioLots).toMatchObject([
        {
          id: seeded.lotIds[0],
          ticker: 'PETR4',
          quantity: 100,
          costCents: 355_000,
          boughtOn: '2026-10-15',
        },
        {
          id: seeded.lotIds[1],
          ticker: 'VALE3',
          quantity: 101,
          costCents: 355_001,
          boughtOn: null,
        },
      ]);
      // só as colunas do contrato: nada de carteira dona nem de usuário
      for (const lot of data?.portfolioLots ?? []) {
        expect(Object.keys(lot).sort()).toEqual([
          'boughtOn',
          'costCents',
          'createdAt',
          'id',
          'quantity',
          'ticker',
          'updatedAt',
        ]);
      }
      // o corpo cru: o custo é número (e não texto de bigint), e a carteira do outro não aparece
      expect(res.text).toContain('"costCents":355000');
      expect(res.text).not.toMatch(/"portfolioId"|"userId"/);
      for (const fromB of [other.portfolioId, ...other.lotIds, 'ITUB4']) {
        expect(res.text).not.toContain(fromB);
      }
    });

    it('com pedido de redefinição pendente, o token dele também não sai', async () => {
      const { agent, email, userId } = await createLoggedInUser(account, prisma);
      await account
        .http()
        .post('/api/auth/request-password-reset')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp())
        .send({ email, redirectTo: `${ORIGIN}/redefinir-senha` });
      const token = new URL((await account.mailTo(email, /senha/i)).link).searchParams.get(
        'token',
      )!;
      expect(await prisma.verification.count({ where: { value: userId } })).toBeGreaterThan(0);
      expect((await agent.get('/api/v1/me/export')).text).not.toContain(token);
    });
  });

  describe('DELETE /api/v1/me', () => {
    const ageSession = (userId: string, ms: number) =>
      prisma.session.updateMany({
        where: { userId },
        data: { createdAt: new Date(Date.now() - ms) },
      });
    const rowsOf = async (userId: string, email: string) => ({
      user: await prisma.user.count({ where: { id: userId } }),
      sessions: await prisma.session.count({ where: { userId } }),
      accounts: await prisma.account.count({ where: { userId } }),
      consents: await prisma.consent.count({ where: { userId } }),
      verifications: await prisma.verification.count({
        where: { OR: [{ value: userId }, { identifier: email }] },
      }),
      portfolios: await prisma.portfolio.count({ where: { userId } }),
      lots: await prisma.portfolioLot.count({ where: { portfolio: { userId } } }),
    });

    it('com a sessão recente apaga a conta e tudo dela (sessões, contas, verificações, aceites e a carteira com os lançamentos) e limpa o cookie', async () => {
      const { agent, email, userId } = await createLoggedInUser(account, prisma);
      // a carteira e os lançamentos (etapa 12) somem na mesma transação, pela cascata: o login da api não tem DELETE em `portfolio`
      await seedPortfolio(prisma, userId);
      // um pedido de redefinição pendente deixa uma linha em `verification`
      await account
        .http()
        .post('/api/auth/request-password-reset')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp())
        .send({ email, redirectTo: `${ORIGIN}/redefinir-senha` });
      await account.mailTo(email, /senha/i);
      const before = await rowsOf(userId, email);
      expect(before).toMatchObject({
        user: 1,
        sessions: 1,
        accounts: 1,
        consents: 2,
        portfolios: 1,
        lots: 2,
      });
      expect(before.verifications).toBeGreaterThan(0);

      const res = await asSite(agent.delete('/api/v1/me')).send({});
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({ success: true, data: { deleted: true } });
      const setCookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
      expect(setCookie).toMatch(/alvesting\.session_token=;/);
      expect(setCookie).toMatch(/Max-Age=0/i);

      expect(await rowsOf(userId, email)).toEqual({
        user: 0,
        sessions: 0,
        accounts: 0,
        consents: 0,
        verifications: 0,
        portfolios: 0,
        lots: 0,
      });
      expect((await getSession(agent)).body).toBeNull();
      expect((await agent.get('/api/v1/me')).status).toBe(401);
      expect((await signIn(account.agent(), email)).status).toBe(401);
    });

    it('sem corpo nenhum (um DELETE puro do navegador): a sessão recente basta', async () => {
      const { agent, userId } = await createLoggedInUser(account, prisma);
      const res = await asSite(agent.delete('/api/v1/me'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: { deleted: true } });
      expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
    });

    // A política promete apagar tudo "no mesmo ato": a exclusão é UMA transação (usuário, em cascata sessões, contas e aceites, os
    // pedidos pendentes e a linha de auditoria). Uma falha no meio (queda de conexão, SIGTERM do blue/green) não pode deixar a pessoa
    // sem credencial mas com o cadastro vivo, nem apagada sem o rastro. A falha aqui é de verdade, no banco: um gatilho recusa a linha
    // de auditoria da exclusão, depois de o DELETE do usuário já ter rodado na mesma transação.
    it('se a auditoria da exclusão falha, NADA é apagado e o cookie não é limpo (uma transação só)', async () => {
      const { agent, email, userId } = await createLoggedInUser(account, prisma);
      await account
        .http()
        .post('/api/auth/request-password-reset')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp())
        .send({ email, redirectTo: `${ORIGIN}/redefinir-senha` });
      await account.mailTo(email, /senha/i);
      await seedPortfolio(prisma, userId);
      const before = await rowsOf(userId, email);
      expect(before).toMatchObject({
        user: 1,
        sessions: 1,
        accounts: 1,
        consents: 2,
        portfolios: 1,
        lots: 2,
      });
      expect(before.verifications).toBeGreaterThan(0);

      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION test_deny_deletion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha injetada pelo teste'; END; $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER test_deny_deletion_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.action = 'account.deleted') EXECUTE FUNCTION test_deny_deletion_audit()`,
      );
      try {
        const res = await asSite(agent.delete('/api/v1/me')).send({});
        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(await rowsOf(userId, email)).toEqual(before);
        expect(await prisma.auditLog.count({ where: { target: userId } })).toBe(0);
        expect((await agent.get('/api/v1/me')).status).toBe(200);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS test_deny_deletion_audit ON audit_log',
        );
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_deny_deletion_audit()');
      }
      // sem a falha, a mesma conta se apaga por inteiro
      expect((await asSite(agent.delete('/api/v1/me')).send({})).status).toBe(200);
      expect(await rowsOf(userId, email)).toEqual({
        user: 0,
        sessions: 0,
        accounts: 0,
        consents: 0,
        verifications: 0,
        portfolios: 0,
        lots: 0,
      });
      expect(await prisma.auditLog.count({ where: { target: userId } })).toBe(1);
    });

    it('deixa uma linha de auditoria só com o ULID, sem e-mail nem nome', async () => {
      const { agent, email, userId } = await createLoggedInUser(account, prisma);
      await asSite(agent.delete('/api/v1/me')).send({});
      const audit = await prisma.auditLog.findMany({ where: { target: userId } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: `user:${userId}`, action: 'account.deleted' });
      expect(JSON.stringify(audit)).not.toContain(email);
      expect(JSON.stringify(audit)).not.toContain('Pessoa de Teste');
    });

    it('sessão antiga sem a senha: 403 REAUTH_REQUIRED e nada é apagado; com a senha certa apaga', async () => {
      const { agent, email, userId, password } = await createLoggedInUser(account, prisma);
      await ageSession(userId, 60 * 60 * 1000);

      const old = await asSite(agent.delete('/api/v1/me')).send({});
      expect(old.status).toBe(403);
      expect(old.body).toMatchObject({ success: false, error: { code: REAUTH_REQUIRED } });
      expect((await rowsOf(userId, email)).user).toBe(1);

      const ok = await asSite(agent.delete('/api/v1/me')).send({ password });
      expect(ok.status).toBe(200);
      expect((await rowsOf(userId, email)).user).toBe(0);
    });

    it('senha errada: 403 INVALID_PASSWORD, nada é apagado, e depois de 5 erros o usuário espera (429)', async () => {
      const { agent, email, userId } = await createLoggedInUser(account, prisma);
      await ageSession(userId, 60 * 60 * 1000);
      const attempt = () =>
        asSite(agent.delete('/api/v1/me')).send({ password: 'senha-errada-qualquer' });
      for (let i = 0; i < 5; i += 1) {
        const res = await attempt();
        expect(res.status, `tentativa ${i + 1}`).toBe(403);
        expect(res.body).toMatchObject({ error: { code: 'INVALID_PASSWORD' } });
      }
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      // com a senha certa, mas já bloqueado, continua bloqueado
      expect((await asSite(agent.delete('/api/v1/me')).send({ password: PASSWORD })).status).toBe(
        429,
      );
      expect((await rowsOf(userId, email)).user).toBe(1);
    });

    it('a rota de exclusão do Better Auth não está aberta ao HTTP: só o DELETE /api/v1/me apaga conta', async () => {
      const { agent, userId } = await createLoggedInUser(account, prisma);
      const post = await agent
        .post('/api/auth/delete-user')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', nextIp())
        .send({});
      const callback = await agent
        .get('/api/auth/delete-user/callback?token=x')
        .set('X-Forwarded-For', nextIp());
      expect(post.status).toBe(404);
      expect(callback.status).toBe(404);
      expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
    });

    it('corpo inválido: 400 (senha vazia, comprida demais, campo a mais)', async () => {
      const { agent } = await createLoggedInUser(account, prisma);
      for (const body of [
        { password: '' },
        { password: 'x'.repeat(129) },
        { password: 'x', userId: 'outro' },
      ]) {
        expect((await asSite(agent.delete('/api/v1/me')).send(body)).status).toBe(400);
      }
    });
  });

  describe('o dono: A nunca lê nem apaga nada de B', () => {
    it('cada um vê só os próprios dados; excluir A não toca B; nenhuma rota aceita o id de outro', async () => {
      const a = await createLoggedInUser(account, prisma);
      const b = await createLoggedInUser(account, prisma);
      await seedPortfolio(prisma, a.userId, ['PETR4']);
      const lotsOfB = await seedPortfolio(prisma, b.userId, ['VALE3', 'ITUB4']);

      const meA = (await a.agent.get('/api/v1/me')).body as { data: { id: string; email: string } };
      const meB = (await b.agent.get('/api/v1/me')).body as { data: { id: string; email: string } };
      expect(meA.data).toMatchObject({ id: a.userId, email: a.email });
      expect(meB.data).toMatchObject({ id: b.userId, email: b.email });

      const exportA = (await a.agent.get('/api/v1/me/export')).text;
      expect(exportA).toContain(a.userId);
      for (const fromB of [b.userId, b.email]) expect(exportA).not.toContain(fromB);
      const sessionOfB = await prisma.session.findFirstOrThrow({ where: { userId: b.userId } });
      const accountOfB = await prisma.account.findFirstOrThrow({ where: { userId: b.userId } });
      const consentOfB = await prisma.consent.findFirstOrThrow({ where: { userId: b.userId } });
      for (const fromB of [
        sessionOfB.id,
        accountOfB.id,
        consentOfB.id,
        sessionOfB.token,
        lotsOfB.portfolioId,
        ...lotsOfB.lotIds,
      ]) {
        expect(exportA).not.toContain(fromB);
      }

      // o id do outro não abre nada: a rota não existe, e a query com o id é recusada
      for (const path of [
        `/api/v1/me/${b.userId}`,
        `/api/v1/users/${b.userId}`,
        `/api/v1/me/export/${b.userId}`,
      ]) {
        expect([404, 400].includes((await a.agent.get(path)).status), path).toBe(true);
        expect((await asSite(a.agent.delete(path)).send({})).status, path).toBe(404);
      }
      expect((await a.agent.get(`/api/v1/me?userId=${b.userId}`)).status).toBe(400);
      // o cookie de B não vale como A, e o de A não vale como B
      expect((await a.agent.get('/api/v1/me')).body).not.toEqual(
        (await b.agent.get('/api/v1/me')).body,
      );

      // A se apaga: tudo de A some e tudo de B continua
      expect((await asSite(a.agent.delete('/api/v1/me')).send({})).status).toBe(200);
      expect(await prisma.user.count({ where: { id: a.userId } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: a.userId } })).toBe(0);
      expect(await prisma.user.count({ where: { id: b.userId } })).toBe(1);
      expect(await prisma.session.count({ where: { userId: b.userId } })).toBe(1);
      expect(await prisma.account.count({ where: { userId: b.userId } })).toBe(1);
      expect(await prisma.consent.count({ where: { userId: b.userId } })).toBe(2);
      // a carteira de A foi com ele; a de B, com os dois lançamentos, continua
      expect(await prisma.portfolio.count({ where: { userId: a.userId } })).toBe(0);
      expect(await prisma.portfolioLot.count({ where: { portfolio: { userId: a.userId } } })).toBe(
        0,
      );
      expect(await prisma.portfolioLot.count({ where: { portfolioId: lotsOfB.portfolioId } })).toBe(
        2,
      );
      expect((await b.agent.get('/api/v1/me')).status).toBe(200);
    });
  });

  describe('o aceite também é do dono', () => {
    it('o aceite de A não vale para B: B sem aceite continua fechado enquanto A está em dia', async () => {
      const a = await createLoggedInUser(account, prisma);
      const b = await createLoggedInUser(account, prisma);
      await removeConsent(prisma, b.userId);

      const meB = (await b.agent.get('/api/v1/me')).body as {
        data: { consent: { upToDate: boolean } };
      };
      expect(meB.data.consent.upToDate).toBe(false);
      expect((await b.agent.get('/api/v1/sonda/recurso')).status).toBe(403);
      expect((await a.agent.get('/api/v1/sonda/recurso')).status).toBe(200);
      // aceitar como B grava para B, e só para B
      expect(
        (await asSite(b.agent.post('/api/v1/me/consents')).send(account.consent())).status,
      ).toBe(200);
      expect(await prisma.consent.count({ where: { userId: b.userId } })).toBe(2);
      expect(await prisma.consent.count({ where: { userId: a.userId } })).toBe(2);
    });
  });

  describe('papéis e guards (para a etapa 10)', () => {
    it('a rota de admin: sem sessão 401, usuário comum 403, admin 200; o guard de papel sozinho nunca abre a rota', async () => {
      const user = await createLoggedInUser(account, prisma);
      expect((await account.http().get('/api/v1/sonda/admin')).status).toBe(401);
      const forbidden = await user.agent.get('/api/v1/sonda/admin');
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });

      // sem o SessionGuard na frente, os dois guards falham fechado
      expect((await user.agent.get('/api/v1/sonda/sem-sessao-admin')).status).toBe(401);
      expect((await user.agent.get('/api/v1/sonda/sem-sessao-aceite')).status).toBe(401);
      // rota sem @Roles: 403 para o usuário comum e, depois da promoção, também para o admin
      expect((await user.agent.get('/api/v1/sonda/sem-roles')).status).toBe(403);

      await promoteToAdmin(prisma, user.email);
      expect((await user.agent.get('/api/v1/sonda/sem-roles')).status).toBe(403);
      // o papel é lido do banco a cada requisição: a promoção vale na hora, sem sair e entrar
      const allowed = await user.agent.get('/api/v1/sonda/admin');
      expect(allowed.status).toBe(200);
      expect((await user.agent.get('/api/v1/me')).body).toMatchObject({ data: { role: 'ADMIN' } });
    });
  });

  describe('promoteToAdmin (o comando account:promote)', () => {
    it('promove pelo e-mail, grava a auditoria só com o ULID e é idempotente', async () => {
      const { email, userId } = await createLoggedInUser(account, prisma);
      const first = await promoteToAdmin(prisma, email.toUpperCase());
      expect(first).toEqual({ userId, changed: true });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('ADMIN');

      const again = await promoteToAdmin(prisma, email);
      expect(again).toEqual({ userId, changed: false });

      const audit = await prisma.auditLog.findMany({
        where: { target: userId, action: 'account.promoted' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: 'cli' });
      expect(JSON.stringify(audit)).not.toContain(email);
    });

    it('e-mail ainda não verificado não vira admin (um pré-cadastro com o e-mail do operador não ganha o papel)', async () => {
      const email = newEmail();
      await signUp(account.agent(), { email, consent: account.consent() });
      await expect(promoteToAdmin(prisma, email)).rejects.toThrow(/verificado/i);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.role).toBe('USER');
      expect(await prisma.auditLog.count({ where: { target: user.id } })).toBe(0);
    });

    it('e-mail que não existe: erro claro, sem repetir o endereço, e nada muda', async () => {
      const error = await promoteToAdmin(prisma, 'ninguem@example.test').catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/não encontrado/i);
      expect((error as Error).message).not.toContain('ninguem@example.test');
    });

    it.each(['', 'sem-arroba', 'a@b'])('argumento inválido (%j): erro', async (value) => {
      await expect(promoteToAdmin(prisma, value)).rejects.toThrow(/e-mail/i);
    });
  });

  // O invariante "excluir a conta apaga tudo" tem duas pontas. O user-data.spec.ts lê o schema.prisma; esta lê o CATÁLOGO do Postgres,
  // o que as migrations de fato criaram: uma migration escrita à mão com ON DELETE RESTRICT passaria pelo schema e travaria a exclusão.
  describe('o catálogo do banco', () => {
    const owned = `
      WITH RECURSIVE owned(oid) AS (
        SELECT 'public."user"'::regclass::oid
        UNION
        SELECT c.conrelid FROM pg_constraint c JOIN owned o ON c.confrelid = o.oid WHERE c.contype = 'f'
      )
      SELECT conrelid::regclass::text AS "table", conname AS name, confdeltype::text AS "onDelete"
      FROM pg_constraint
      WHERE contype = 'f' AND confrelid IN (SELECT oid FROM owned)`;

    it('toda chave estrangeira que parte do usuário (direta ou por outra tabela dele) apaga em cascata', async () => {
      const rows =
        await prisma.$queryRawUnsafe<Array<{ table: string; name: string; onDelete: string }>>(
          owned,
        );
      // a consulta enxerga as tabelas da conta e as da carteira (não passa em vazio); as do chat entram na lista quando chegarem
      expect(rows.map((r) => r.table)).toEqual(
        expect.arrayContaining(['account', 'consent', 'session', 'portfolio', 'portfolio_lot']),
      );
      // 'c' é CASCADE no catálogo do Postgres
      expect(rows.filter((r) => r.onDelete !== 'c')).toEqual([]);
    });
  });

  // As guardas da migration account_limits: o código já valida tudo isto na entrada; o banco é a última barreira para o dia em que um
  // caminho novo esquecer.
  describe('as guardas do banco', () => {
    const insertUser = (over: { name?: string; email?: string; image?: string | null } = {}) =>
      prisma.user.create({
        data: { id: newId(), name: 'Pessoa de Teste', email: newEmail(), image: null, ...over },
      });

    it('nome, e-mail e imagem têm teto: no limite passa, um a mais é recusado', async () => {
      const edge = await insertUser({
        name: 'n'.repeat(200),
        email: `${'a'.repeat(241)}@example.test`, // 254 caracteres
        image: `https://example.test/${'i'.repeat(2048 - 21)}`, // 2048 caracteres
      });
      expect(edge.email).toHaveLength(254);
      await expect(insertUser({ name: 'n'.repeat(201) })).rejects.toThrow(/user_name_len/);
      await expect(insertUser({ email: `${'a'.repeat(242)}@example.test` })).rejects.toThrow(
        /user_email_len/,
      );
      await expect(
        insertUser({ image: `https://example.test/${'i'.repeat(2048 - 20)}` }),
      ).rejects.toThrow(/user_image_len/);
    });

    it('o pedido de uso único aceita um estado comprido (o índice é hash: o btree recusava linha acima de 2704 bytes)', async () => {
      const row = await prisma.verification.create({
        data: {
          id: newId(),
          identifier: 'estado-comprido-de-teste',
          value: 'v'.repeat(6_000),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      expect(
        await prisma.verification.count({ where: { value: 'v'.repeat(6_000) } }),
      ).toBeGreaterThanOrEqual(1);
      await prisma.verification.delete({ where: { id: row.id } });
    });

    it('o aceite só some junto com a conta: o DELETE direto é recusado, e excluir o usuário leva o aceite em cascata', async () => {
      const { userId } = await createLoggedInUser(account, prisma);
      await expect(prisma.consent.deleteMany({ where: { userId } })).rejects.toThrow(/aceite/i);
      expect(await prisma.consent.count({ where: { userId } })).toBe(2);
      await prisma.user.delete({ where: { id: userId } });
      expect(await prisma.consent.count({ where: { userId } })).toBe(0);
    });
  });

  describe('Swagger e o envelope', () => {
    it('toda rota nova está no Swagger, com tag e resposta documentada', async () => {
      const res = await account.http().get('/api/docs-json');
      expect(res.status).toBe(200);
      const paths = (
        res.body as {
          paths: Record<string, Record<string, { tags?: string[]; responses: object }>>;
        }
      ).paths;
      for (const [path, method] of [
        ['/api/v1/me', 'get'],
        ['/api/v1/me', 'delete'],
        ['/api/v1/me/consents', 'post'],
        ['/api/v1/me/export', 'get'],
        ['/api/v1/legal', 'get'],
        ['/api/v1/auth/providers', 'get'],
      ] as const) {
        const operation = paths[path]?.[method];
        expect(operation, `${method} ${path}`).toBeDefined();
        expect(operation!.tags, `${method} ${path}`).toContain('conta');
        expect(Object.keys(operation!.responses).length).toBeGreaterThan(0);
      }
    });

    it('o esquema de autenticação por cookie está declarado (as rotas /me o citam; sem ele o OpenAPI fica inválido)', async () => {
      const doc = (await account.http().get('/api/docs-json')).body as {
        components?: { securitySchemes?: Record<string, unknown> };
        paths: Record<string, Record<string, { security?: Array<Record<string, unknown>> }>>;
      };
      const used = new Set(
        Object.values(doc.paths)
          .flatMap((methods) => Object.values(methods))
          .flatMap((operation) => operation.security ?? [])
          .flatMap((requirement) => Object.keys(requirement)),
      );
      expect(used.has('cookie')).toBe(true);
      for (const name of used) {
        expect(doc.components?.securitySchemes?.[name], `esquema "${name}"`).toBeDefined();
      }
      expect(doc.components?.securitySchemes?.cookie).toMatchObject({
        type: 'apiKey',
        in: 'cookie',
        name: 'alvesting.session_token',
      });
    });

    it('erro de rota da conta continua no envelope', async () => {
      const res = await account.http().get('/api/v1/me/nao-existe');
      expect(anyEnvelope.safeParse(res.body).success).toBe(true);
      expect(res.status).toBe(404);
    });
  });
});
