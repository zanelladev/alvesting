import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Inject, Logger, Param } from '@nestjs/common';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../common/id.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../infrastructure/database/test-database.fixture.js';
import {
  ORIGIN,
  PASSWORD,
  asSite,
  createLoggedInUser,
  newEmail,
  nextIp,
  signIn,
  signUp,
  startAccountApp,
  type AccountApp,
} from '../modules/account/testing/account-app.fixture.js';
import { PortfolioModule } from '../modules/portfolio/portfolio.module.js';
import { inSpan } from './instruments.js';
import { SanitizingSpanProcessor } from './sanitize.js';
import {
  httpInstrumentationOptions,
  pgInstrumentationOptions,
  undiciInstrumentationOptions,
} from './telemetry.js';

// Os canários desta suíte são sintéticos (RFC 5737 para o IP, example.test para o e-mail). Nenhum pode sair em span, evento,
// exceção, nome de operação nem atributo.
const PROMPT_CANARY = 'alv-canary-9f8e7d6c5b4a39281706f5e4';
const RESET_TOKEN = 'rst9Zx4Kq7Lm2Vb8Np5Rs1Wd6Fh3Jc0TyAeBu';
const CLIENT_IP = '203.0.113.77';
const COOKIE_VALUE = 'ck0Zx4Kq7Lm2Vb8Np5Rs1Wd6Fh3Jc0TyAeBuQq';

@Controller('probe')
class ProbeController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('erro/:id')
  erro(): never {
    throw new Error(`falha da sonda com ${PROMPT_CANARY} para pessoa.sonda@example.test`);
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    await this.prisma.jobRun.count();
    return { id };
  }
}

// A telemetria como a produção a monta, menos o exportador: o SDK, o sanitizador e as mesmas opções das instrumentações (as funções
// de telemetry.ts que a distribuição da Azure também usa). O exportador é em memória: nada sai do processo.
// Em produção os ganchos de módulo (o `--import` do loader) rodam antes de tudo. Aqui o Vitest já carregou http e pg antes deste
// arquivo, então o `require` abaixo faz o ganho de instrumentação do módulo já carregado, que é só o que o teste precisa.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SanitizingSpanProcessor(), new SimpleSpanProcessor(exporter)],
});
provider.register();
// O servidor "remoto" das chamadas de saída vive neste mesmo processo: sem isto o http instrumentaria também o lado dele.
let remotePort = 0;
const httpOptions = httpInstrumentationOptions();
registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation({
      ...httpOptions,
      ignoreIncomingRequestHook: (request) =>
        request.socket.localPort === remotePort ||
        httpOptions.ignoreIncomingRequestHook?.(request) === true,
    }),
    new PgInstrumentation(pgInstrumentationOptions()),
    new UndiciInstrumentation(undiciInstrumentationOptions()),
  ],
});
const nodeRequire = createRequire(import.meta.url);
nodeRequire('node:http');
nodeRequire('pg');

const spans = (): ReadableSpan[] => exporter.getFinishedSpans();
// O @opentelemetry/api 1.10 publica tipos em separado para CJS e ESM, e o ReadableSpan do SDK (CJS) enxerga outro `SpanKind` que o
// deste arquivo (ESM): o número é o mesmo, e o lint não deixa comparar os dois enums.
const isKind = (span: ReadableSpan, kind: SpanKind): boolean => Number(span.kind) === Number(kind);
const idOf = (span: ReadableSpan): string => span.spanContext().spanId;
const everything = (): string =>
  JSON.stringify(
    spans().map((span) => ({
      name: span.name,
      kind: span.kind,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
      links: span.links,
    })),
  );

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('Telemetria: requisição, banco e dado pessoal'),
  () => {
    // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api (ADR 0028), com o qual a api sob teste atende as rotas
    let prisma: PrismaService;
    let apiPrisma: PrismaService;
    let account: AccountApp;

    beforeAll(async () => {
      Logger.overrideLogger(false);
      prisma = await openTestDatabase(testDatabaseUrl!);
      apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
      account = await startAccountApp(apiPrisma, {
        extraControllers: [ProbeController],
        extraImports: [PortfolioModule],
      });
    }, 60_000);

    afterAll(async () => {
      await account?.stop();
      await prisma?.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
      await prisma?.verification.deleteMany();
      await prisma?.auditLog.deleteMany({ where: { action: { startsWith: 'account.' } } });
      await apiPrisma?.onModuleDestroy();
      await prisma?.onModuleDestroy();
      await provider.shutdown();
    });

    beforeEach(() => exporter.reset());

    it('uma requisição gera o span da rota com o span filho da consulta ao Postgres', async () => {
      const res = await account
        .http()
        .get(`/api/v1/probe/um-id?token=${RESET_TOKEN}&email=pessoa.sonda@example.test`)
        .set('X-Forwarded-For', CLIENT_IP)
        .set('Cookie', `sessao=${COOKIE_VALUE}`)
        .set('Authorization', `Bearer ${COOKIE_VALUE}`);
      expect(res.status).toBe(200);

      const server = spans().find((s) => isKind(s, SpanKind.SERVER));
      expect(server, 'span da requisição').toBeDefined();
      expect(server!.name).toBe('GET /api/v1/probe/:id');
      expect(server!.attributes).toMatchObject({
        'http.request.method': 'GET',
        'http.route': '/api/v1/probe/:id',
        'http.response.status_code': 200,
      });
      const query = spans().find(
        (s) => isKind(s, SpanKind.CLIENT) && s.attributes['db.system.name'] === 'postgresql',
      );
      expect(query, 'span da consulta').toBeDefined();
      expect(query!.parentSpanContext?.spanId).toBe(idOf(server!));
      expect(String(query!.attributes['db.query.text'])).toContain('job_run');

      const out = everything();
      for (const canary of [RESET_TOKEN, CLIENT_IP, COOKIE_VALUE, 'pessoa.sonda@example.test']) {
        expect(out, canary).not.toContain(canary);
      }
      expect(server!.attributes).not.toHaveProperty('client.address');
      expect(server!.attributes).not.toHaveProperty('url.query');
    });

    // O SessionGuard roda ANTES do EnvelopeInterceptor: a requisição que ele barra (401) só chega ao filtro de exceções. A superfície
    // autenticada (/me, depois /admin, carteira e chat) é onde há 401 e 403, e não pode virar "GET (sem rota)".
    it('a requisição barrada pelo guard (401) leva a rota no nome da operação', async () => {
      const res = await account.http().get('/api/v1/me?token=' + RESET_TOKEN);
      expect(res.status).toBe(401);
      const server = spans().find((s) => isKind(s, SpanKind.SERVER));
      expect(server, 'span da requisição').toBeDefined();
      expect(server!.name).toBe('GET /api/v1/me');
      expect(server!.attributes['http.route']).toBe('/api/v1/me');
      expect(everything()).not.toContain(RESET_TOKEN);
    });

    it('o erro 500 vira exceção no span da requisição, sem o canário do prompt nem o e-mail', async () => {
      const res = await account.http().get('/api/v1/probe/erro/x');
      expect(res.status).toBe(500);
      const server = spans().find((s) => isKind(s, SpanKind.SERVER))!;
      expect(server.status.code).toBe(SpanStatusCode.ERROR);
      const exception = server.events.find((event) => event.name === 'exception');
      expect(exception, 'evento de exceção').toBeDefined();
      expect(String(exception!.attributes?.['exception.message'])).toContain('falha da sonda');
      const out = everything();
      expect(out).not.toContain(PROMPT_CANARY);
      expect(out).not.toContain('pessoa.sonda@example.test');
    });

    it('o login do Better Auth: e-mail, senha, IP, token de verificação e cookie de sessão não saem', async () => {
      const email = newEmail();
      const ip = nextIp();
      const agent = account.agent();
      const created = await signUp(agent, { email, consent: account.consent() }, ip);
      expect(created.status).toBe(200);
      const mail = await account.mailTo(email, /Confirme/);
      const verificationToken = new URL(mail.link).searchParams.get('token')!;
      const verified = await agent
        .get(new URL(mail.link).pathname + new URL(mail.link).search)
        .set('X-Forwarded-For', ip);
      expect(verified.status).toBeLessThan(400);
      const login = await signIn(agent, email, PASSWORD, ip);
      expect(login.status).toBe(200);
      const sessionCookie = String(
        (login.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '',
      )
        .split(';')[0]!
        .split('=')[1]!;
      await agent.get('/api/auth/get-session').set('X-Forwarded-For', ip);
      await agent
        .get(
          `/api/auth/reset-password/${RESET_TOKEN}?callbackURL=${encodeURIComponent(`${ORIGIN}/x`)}`,
        )
        .set('X-Forwarded-For', ip);

      // o Better Auth não cria span próprio (auth.ts: experimental.instrumentation desligado)
      expect(spans().filter((s) => s.instrumentationScope.name === 'better-auth')).toEqual([]);
      const servers = spans().filter((s) => isKind(s, SpanKind.SERVER));
      expect(servers.length).toBeGreaterThanOrEqual(5);
      // toda requisição tem nome "MÉTODO rota", e a do Better Auth é uma rota só
      expect(servers.map((s) => s.name)).toContain('POST /api/auth/*');
      expect(servers.map((s) => s.name)).toContain('GET /api/auth/*');
      for (const server of servers)
        expect(server.name).toMatch(/^[A-Z]+ (\/[\w/:*.-]*|\(sem rota\))$/);

      const out = everything();
      for (const canary of [
        email,
        PASSWORD,
        ip,
        verificationToken,
        sessionCookie,
        RESET_TOKEN,
        'Pessoa de Teste',
      ]) {
        expect(canary.length).toBeGreaterThan(8);
        expect(out, canary).not.toContain(canary);
      }
      // o SQL das consultas da conta tem o e-mail como parâmetro ($1), nunca no texto
      const sql = spans()
        .map((s) => s.attributes['db.query.text'])
        .filter((value): value is string => typeof value === 'string');
      expect(sql.length).toBeGreaterThan(0);
      expect(sql.join('\n')).not.toContain('@example.test');
    });

    // A carteira (etapa 12) é dado financeiro pessoal. O span da rota leva o padrão (`/api/v1/me/portfolio/lots/:id`), e o do Postgres, o SQL com
    // os valores como parâmetro ($1): nem o ticker, nem a quantidade, o custo ou a data do lançamento, nem o corpo da requisição saem. O caminho
    // leva o ULID do lançamento (um código opaco, como o slug e a data das rotas públicas), e nunca o do usuário.
    it('a carteira: quantidade, custo e data do lançamento não saem em span, em SQL nem no nome da operação', async () => {
      const user = await createLoggedInUser(account, prisma);
      const instrumentId = newId();
      await prisma.instrument.create({
        data: {
          id: instrumentId,
          ticker: 'TLMA3',
          name: 'EMPRESA TLMA3',
          spec: 'ON',
          kind: 'STOCK',
          lastSeen: new Date('2026-11-03T00:00:00Z'),
        },
      });
      try {
        // números e data que só existem aqui: se algum aparecer na telemetria, vazou da carteira
        const canaries = ['424242', '987654321', '313131', '123456789', '2019-03-07', '2018-02-06'];
        const body = (quantity: number, valueCents: number, boughtOn: string) => ({
          ticker: 'TLMA3',
          quantity,
          mode: 'total',
          valueCents,
          boughtOn,
        });
        exporter.reset();
        const created = await asSite(user.agent.post('/api/v1/me/portfolio/lots')).send(
          body(424_242, 987_654_321, '2019-03-07'),
        );
        expect(created.status).toBe(201);
        const lotId = (created.body as { data: { id: string } }).data.id;
        expect((await user.agent.get('/api/v1/me/portfolio')).status).toBe(200);
        expect(
          (
            await asSite(user.agent.patch(`/api/v1/me/portfolio/lots/${lotId}`)).send(
              body(313_131, 123_456_789, '2018-02-06'),
            )
          ).status,
        ).toBe(200);
        expect((await asSite(user.agent.delete(`/api/v1/me/portfolio/lots/${lotId}`))).status).toBe(
          200,
        );

        const servers = spans().filter((s) => isKind(s, SpanKind.SERVER));
        expect(servers.map((s) => s.name).sort()).toEqual([
          'DELETE /api/v1/me/portfolio/lots/:id',
          'GET /api/v1/me/portfolio',
          'PATCH /api/v1/me/portfolio/lots/:id',
          'POST /api/v1/me/portfolio/lots',
        ]);
        const out = everything();
        for (const canary of canaries) expect(out, canary).not.toContain(canary);
        expect(out).not.toContain(user.userId);
        expect(out).not.toContain(user.email);
        // o SQL das consultas da carteira existe e tem os valores como parâmetro
        const sql = spans()
          .map((s) => s.attributes['db.query.text'])
          .filter((value): value is string => typeof value === 'string');
        expect(sql.join('\n')).toMatch(/portfolio_lot/);
        expect(sql.join('\n')).toMatch(/\$\d/);
      } finally {
        await prisma.user.delete({ where: { id: user.userId } });
        await prisma.instrument.delete({ where: { id: instrumentId } });
      }
    });

    it('requisição sem rota (robô) tem nome fixo e não leva o caminho cru', async () => {
      await account.http().get(`/wp-login.php/${RESET_TOKEN}?x=1`);
      const server = spans().find((s) => isKind(s, SpanKind.SERVER))!;
      expect(server.name).toBe('GET (sem rota)');
      expect(everything()).not.toContain(RESET_TOKEN);
    });

    it('a sonda de saúde não vira telemetria', async () => {
      await account.http().get('/health');
      await account.http().get('/api/v1/health');
      expect(spans()).toEqual([]);
    });

    describe('chamadas de saída', () => {
      let remote: Server;
      let base: string;
      beforeAll(async () => {
        remote = createServer((_req, res) => res.end('ok'));
        await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve));
        remotePort = (remote.address() as AddressInfo).port;
        base = `http://127.0.0.1:${remotePort}`;
      });
      afterAll(() => {
        remote.close();
      });

      it('o fetch dentro de uma mensagem vira span de dependência, sem query nem chave', async () => {
        await inSpan('process news', { kind: SpanKind.CONSUMER }, async () => {
          const res = await fetch(`${base}/feed.xml?key=${RESET_TOKEN}`);
          await res.text();
        });
        const client = spans().find((s) => isKind(s, SpanKind.CLIENT));
        expect(client, 'span da chamada de saída').toBeDefined();
        expect(client!.attributes['http.request.method']).toBe('GET');
        expect(String(client!.attributes['url.full'])).toBe(`${base}/feed.xml`);
        expect(everything()).not.toContain(RESET_TOKEN);
      });

      it('o fetch fora de qualquer requisição ou mensagem não gera span órfão', async () => {
        const res = await fetch(`${base}/solto`);
        await res.text();
        expect(spans()).toEqual([]);
      });
    });
  },
);
