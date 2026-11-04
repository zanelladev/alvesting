import { INTERNAL_BARS_LIMIT, envelopeSchema, internalBarsSchema } from '@alvesting/contracts';
import { Global, Logger, Module, type INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import { ENV, type Env } from '../../../config/env.js';
import { Secret } from '../../../config/secret.js';
import { configureApp } from '../../../configure-app.js';
import { DatabaseModule } from '../../../infrastructure/database/database.module.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { QuotesModule } from '../quotes.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesSecretGuard } from './quotes-secret.guard.js';

// A rota interna de cotações (docs/API.md, seção 6; ADR 0033) sobre o Postgres: a api atende como o login de menor privilégio, e o ambiente
// leva um QUOTES_SECRET sintético. Nenhum dado de terceiro: as barras são inventadas aqui.
const SECRET = 'segredo-sintetico-das-cotacoes-0123456789abcdef';

// O ENV que a api tem em produção, só com o que a rota lê. @Global como o ConfigModule de verdade.
@Global()
@Module({
  providers: [
    { provide: ENV, useValue: { QUOTES_SECRET: new Secret(SECRET) } satisfies Partial<Env> },
  ],
  exports: [ENV],
})
class TestEnvModule {}

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const BASE = '/api/v1/interno/barras';

describe.skipIf(!testDatabaseUrl)(integrationTitle('A rota interna de cotações'), () => {
  let admin: PrismaService;
  let apiPrisma: PrismaService;
  let app: INestApplication;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    admin = await openTestDatabase(testDatabaseUrl!);
    apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
    const moduleRef = await Test.createTestingModule({
      imports: [TestEnvModule, DatabaseModule, QuotesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(apiPrisma)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await clean();
    await apiPrisma?.onModuleDestroy();
    await admin?.onModuleDestroy();
  });

  const clean = async () => {
    await admin.portfolioLot.deleteMany();
    await admin.portfolio.deleteMany();
    await admin.position.deleteMany();
    await admin.universeMember.deleteMany();
    await admin.universeSnapshot.deleteMany();
    await admin.dailyBar.deleteMany();
    await admin.instrument.deleteMany();
  };

  // 70 pregões de PETR4 (de 2026-08-03 em diante, dias corridos: o teste não precisa do calendário), com preços que crescem a cada dia
  // para a ordem e o corte aparecerem. O BOVA11 é a referência (REFERENCE), que a home usa.
  const DAYS = 70;
  const dateOf = (i: number) => new Date(Date.UTC(2026, 7, 3 + i)).toISOString().slice(0, 10);
  const barRow = (instrumentId: string, i: number) => ({
    id: newId(),
    instrumentId,
    date: day(dateOf(i)),
    openCents: BigInt(1000 + i),
    highCents: BigInt(1100 + i),
    lowCents: BigInt(900 + i),
    closeCents: BigInt(1050 + i),
    volumeCents: BigInt(1_000_000 + i),
    source: 'BRAPI' as const,
  });

  beforeEach(async () => {
    await clean();
    const petr = await admin.instrument.create({
      data: {
        id: newId(),
        ticker: 'PETR4',
        name: 'PETROBRAS',
        spec: 'PN',
        kind: 'STOCK',
        lastSeen: day('2026-10-30'),
      },
    });
    const bova = await admin.instrument.create({
      data: {
        id: newId(),
        ticker: 'BOVA11',
        name: 'ISHARES BOVA',
        spec: 'CI',
        kind: 'REFERENCE',
        lastSeen: day('2026-10-30'),
      },
    });
    await admin.instrument.create({
      data: {
        id: newId(),
        ticker: 'SEMB3',
        name: 'SEM BARRA',
        spec: 'ON',
        kind: 'STOCK',
        lastSeen: day('2026-10-30'),
      },
    });
    await admin.dailyBar.createMany({
      data: Array.from({ length: DAYS }, (_, i) => barRow(petr.id, i)),
    });
    await admin.dailyBar.createMany({
      data: [barRow(bova.id, DAYS - 2), barRow(bova.id, DAYS - 1)],
    });
  });

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
  const withSecret = (path: string, secret = SECRET) =>
    http().get(path).set('Authorization', `Bearer ${secret}`);

  describe('com o segredo', () => {
    it('200 no envelope, no-store, com as 60 barras mais recentes da mais antiga à mais nova', async () => {
      const res = await withSecret(`${BASE}/PETR4`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = envelopeSchema(internalBarsSchema).parse(res.body);
      expect(body.success).toBe(true);
      const bars = (res.body as { data: { bars: Array<Record<string, unknown>> } }).data.bars;
      expect(bars).toHaveLength(INTERNAL_BARS_LIMIT);
      // as 60 mais recentes de 70: do índice 10 ao 69
      expect(bars[0]).toEqual({
        date: dateOf(10),
        openCents: 1010,
        highCents: 1110,
        lowCents: 910,
        closeCents: 1060,
      });
      expect(bars.at(-1)).toEqual({
        date: dateOf(69),
        openCents: 1069,
        highCents: 1169,
        lowCents: 969,
        closeCents: 1119,
      });
      const dates = bars.map((bar) => bar.date as string);
      expect(dates).toEqual([...dates].sort());
      expect(new Set(dates).size).toBe(INTERNAL_BARS_LIMIT);
    });

    it('as barras são só data e os quatro preços: nada de volume, fonte nem identificador', async () => {
      const res = await withSecret(`${BASE}/PETR4`);
      const bars = (res.body as { data: { bars: Array<Record<string, unknown>> } }).data.bars;
      for (const bar of bars) {
        expect(Object.keys(bar).sort()).toEqual([
          'closeCents',
          'date',
          'highCents',
          'lowCents',
          'openCents',
        ]);
      }
      expect(JSON.stringify(res.body)).not.toMatch(/volume|source|instrument|"id"/i);
    });

    it('o BOVA11 (a referência) tem barras: a home tira dele o último fechamento e o anterior', async () => {
      const res = await withSecret(`${BASE}/BOVA11`);
      expect(res.status).toBe(200);
      const bars = (res.body as { data: { bars: Array<{ date: string; closeCents: number }> } })
        .data.bars;
      expect(bars.map((bar) => [bar.date, bar.closeCents])).toEqual([
        [dateOf(DAYS - 2), 1050 + DAYS - 2],
        [dateOf(DAYS - 1), 1050 + DAYS - 1],
      ]);
    });

    it('minúsculas valem; papel desconhecido ou sem barra é lista vazia (200), e nunca 404', async () => {
      const lower = await withSecret(`${BASE}/petr4`);
      expect(lower.status).toBe(200);
      expect((lower.body as { data: { bars: unknown[] } }).data.bars).toHaveLength(
        INTERNAL_BARS_LIMIT,
      );
      for (const ticker of ['SEMB3', 'ZZZZ3']) {
        const res = await withSecret(`${BASE}/${ticker}`);
        expect(res.status, ticker).toBe(200);
        expect(res.body, ticker).toEqual({ success: true, data: { bars: [] }, error: null });
      }
    });

    it('ticker fora do formato e parâmetro de query são 400 no envelope, nunca 404 nem 500', async () => {
      for (const path of [
        `${BASE}/PETR`,
        `${BASE}/PETR4XXXXXXXXXX`,
        `${BASE}/%00`,
        `${BASE}/P%20T4`,
        `${BASE}/PETR4?x=1`,
        `${BASE}/PETR4?a=1&a=2`,
      ]) {
        const res = await withSecret(path);
        expect(res.status, path).toBe(400);
        expect(res.headers['cache-control'], path).toBe('no-store');
        expect(res.body, path).toMatchObject({ success: false, data: null });
      }
    });

    it('só GET: o POST não acha a rota', async () => {
      const res = await http().post(`${BASE}/PETR4`).set('Authorization', `Bearer ${SECRET}`);
      expect(res.status).toBe(404);
    });
  });

  describe('sem o segredo, ou com o errado', () => {
    // A rota inexistente de verdade, no mesmo prefixo: o corpo e os cabeçalhos da recusa têm de ser os dela (o que muda é só o caminho no texto).
    const MISSING = '/api/v1/interno/nao-existe/PETR4';
    const refusals: Array<[string, (path: string) => request.Test]> = [
      ['sem cabeçalho', (path) => http().get(path)],
      [
        'com o segredo errado',
        (path) => withSecret(path, 'errado-0123456789abcdef0123456789abcdef'),
      ],
      ['com o segredo certo menos um caractere', (path) => withSecret(path, SECRET.slice(0, -1))],
      [
        'com o segredo certo em Basic',
        (path) => http().get(path).set('Authorization', `Basic ${SECRET}`),
      ],
      [
        'com o segredo certo em outro cabeçalho',
        (path) => http().get(path).set('X-Quotes-Secret', SECRET),
      ],
    ];

    // os cabeçalhos de resposta que dependem do tamanho e do instante do corpo
    const volatile = new Set(['content-length', 'etag', 'date']);
    const names = (res: request.Response) =>
      Object.keys(res.headers)
        .filter((name) => !volatile.has(name))
        .sort();

    it.each(refusals)('%s: 404 no-store, igual ao da rota que não existe', async (_name, ask) => {
      const refused = await ask(`${BASE}/PETR4`);
      const missing = await ask(MISSING);
      expect(refused.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(refused.headers['cache-control']).toBe('no-store');
      expect(refused.headers['content-type']).toBe(missing.headers['content-type']);
      // o corpo: o mesmo envelope, com o código NOT_FOUND e a frase do Nest ("Cannot GET <caminho>"); só o caminho muda
      expect(refused.body).toEqual({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: `Cannot GET ${BASE}/PETR4` },
      });
      expect(missing.body).toEqual({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: `Cannot GET ${MISSING}` },
      });
      // os mesmos cabeçalhos de resposta (helmet, no-store...)
      expect(names(refused)).toEqual(names(missing));
    });

    it('o segredo na query string não vale: 404, com a frase do Nest para o endereço pedido', async () => {
      const refused = await http().get(`${BASE}/PETR4?segredo=${SECRET}`);
      expect(refused.status).toBe(404);
      expect(refused.headers['cache-control']).toBe('no-store');
      const missing = await http().get(`${MISSING}?segredo=${SECRET}`);
      expect(refused.body).toEqual({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: `Cannot GET ${BASE}/PETR4?segredo=${SECRET}` },
      });
      expect(names(refused)).toEqual(names(missing));
    });

    it('o segredo certo não aparece em nenhuma resposta de recusa (corpo nem cabeçalho)', async () => {
      for (const [name, ask] of refusals) {
        const res = await ask(`${BASE}/PETR4`);
        expect(res.text, name).not.toContain(SECRET);
        expect(JSON.stringify(res.headers), name).not.toContain(SECRET);
      }
    });

    it('HEAD sem o segredo também é 404, e sem corpo', async () => {
      const res = await http().head(`${BASE}/PETR4`);
      expect(res.status).toBe(404);
      expect(res.text ?? '').toBe('');
    });

    it('recusa antes de validar: com o segredo errado nem o ticker torto vira 400', async () => {
      const res = await withSecret(`${BASE}/PETR`, 'errado-0123456789abcdef0123456789abcdef');
      expect(res.status).toBe(404);
    });
  });

  describe('fora do Swagger', () => {
    it('o documento da api não cita a rota interna', async () => {
      const doc = await http().get('/api/docs-json');
      expect(doc.status).toBe(200);
      expect(JSON.stringify((doc.body as { paths: unknown }).paths)).not.toContain('interno');
      expect(JSON.stringify(doc.body)).not.toMatch(/interno|barras|QUOTES/i);
    });
  });
});

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('A rota interna de cotações sem QUOTES_SECRET'),
  () => {
    let apiPrisma: PrismaService;
    let app: INestApplication;

    @Global()
    @Module({ providers: [{ provide: ENV, useValue: {} satisfies Partial<Env> }], exports: [ENV] })
    class NoSecretEnvModule {}

    beforeAll(async () => {
      Logger.overrideLogger(false);
      const admin = await openTestDatabase(testDatabaseUrl!);
      apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
      await admin.onModuleDestroy();
      const moduleRef = await Test.createTestingModule({
        imports: [NoSecretEnvModule, DatabaseModule, QuotesModule],
      })
        .overrideProvider(PrismaService)
        .useValue(apiPrisma)
        .compile();
      app = moduleRef.createNestApplication({ logger: false });
      configureApp(app);
      await app.init();
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await apiPrisma?.onModuleDestroy();
    });

    it('a rota está desligada: 404 para todos, até com um Bearer qualquer', async () => {
      const http = request(app.getHttpServer() as Parameters<typeof request>[0]);
      for (const auth of [undefined, `Bearer ${SECRET}`, 'Bearer undefined']) {
        const req = http.get(`${BASE}/PETR4`);
        const res = await (auth ? req.set('Authorization', auth) : req);
        expect(res.status, String(auth)).toBe(404);
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });
  },
);

// O que o controlador declara, sem banco: uma rota nova nasce atrás do segredo, sem cache e fora do Swagger.
describe('o controlador da rota interna de cotações', () => {
  const proto = QuotesController.prototype as unknown as Record<string, unknown>;
  const handlers = Object.getOwnPropertyNames(proto).filter(
    (name) => name !== 'constructor' && typeof proto[name] === 'function',
  );

  it('o guard do segredo está na classe e nenhuma rota sobrescreve a lista: rota nova nasce atrás dele', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, QuotesController)).toEqual([QuotesSecretGuard]);
    expect(handlers.length).toBeGreaterThanOrEqual(1);
    for (const name of handlers) {
      expect(Reflect.getMetadata(GUARDS_METADATA, proto[name] as object), name).toBeUndefined();
      expect(Reflect.getMetadata(PATH_METADATA, proto[name] as object), name).toBeDefined();
    }
  });

  it('o prefixo leva /interno/ (o WAF do Front Door bloqueia na borda todo caminho com essa pasta) e toda rota declara no-store', () => {
    expect(Reflect.getMetadata(PATH_METADATA, QuotesController)).toBe('interno');
    for (const name of handlers) {
      expect(Reflect.getMetadata(HEADERS_METADATA, proto[name] as object), name).toEqual([
        { name: 'Cache-Control', value: 'no-store' },
      ]);
    }
  });

  // a chave que o @ApiExcludeController escreve (node_modules/@nestjs/swagger/dist/constants.js, DECORATORS.API_EXCLUDE_CONTROLLER); o
  // teste com banco, acima, confere o efeito no documento do Swagger
  it('está fora do Swagger', () => {
    expect(Reflect.getMetadata('swagger/apiExcludeController', QuotesController)).toEqual([true]);
  });
});
