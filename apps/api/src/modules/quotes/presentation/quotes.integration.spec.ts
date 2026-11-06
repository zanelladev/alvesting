import {
  INTERNAL_BARS_LIMIT,
  INTERNAL_TAPE_LIMIT,
  envelopeSchema,
  internalBarsSchema,
  internalLogosSchema,
  internalTapeSchema,
} from '@alvesting/contracts';
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
import { UNIVERSE_RULES } from '../../market-data/domain/universe.js';
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
const TAPE = '/api/v1/interno/fita';
const LOGOS = '/api/v1/interno/logos';
// os cabeçalhos com que o SVG sai (ADR 0036), escritos aqui à mão: o teste prende os valores, e não a constante do contrato
const LOGO_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";
const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><title>Petrobras</title><rect width="8" height="8" fill="#0a0"/></svg>';
const EMPTY_TAPE = { success: true, data: { date: null, rows: [] }, error: null };

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
    await admin.cycle.deleteMany();
    await admin.season.deleteMany();
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

  // A fita da home (docs/API.md, seção 6): o universo da semana do último ciclo da temporada atual, com o fechamento do pregão mais recente
  // com barra até o pregão do ciclo e o do pregão anterior. Cada teste parte do banco vazio (o cenário das barras, acima, sai antes).
  describe('a fita, com o segredo', () => {
    const ids = new Map<string, string>();
    const instrument = async (ticker: string, kind: 'STOCK' | 'REFERENCE' = 'STOCK') => {
      const row = await admin.instrument.create({
        data: { id: newId(), ticker, name: ticker, spec: 'ON', kind, lastSeen: day('2026-11-05') },
      });
      ids.set(ticker, row.id);
    };
    // as barras de um papel: pregão -> fechamento (abertura, máxima e mínima diferentes, para nenhuma delas passar por fechamento)
    const bars = (ticker: string, closes: Record<string, number>) =>
      admin.dailyBar.createMany({
        data: Object.entries(closes).map(([date, close]) => ({
          id: newId(),
          instrumentId: ids.get(ticker)!,
          date: day(date),
          openCents: BigInt(close - 7),
          highCents: BigInt(close + 11),
          lowCents: BigInt(close - 13),
          closeCents: BigInt(close),
          volumeCents: 1_000_000n,
          source: 'BRAPI' as const,
        })),
      });
    // o universo congelado da semana, na ordem dada (posição 1 primeiro)
    const universe = async (week: string, tickers: string[]) => {
      const snapshot = await admin.universeSnapshot.create({
        data: {
          id: newId(),
          week,
          windowStart: day('2026-08-03'),
          windowEnd: day('2026-10-30'),
          windowDays: 60,
          candidates: tickers.length,
          eligible: tickers.length,
        },
      });
      await admin.universeMember.createMany({
        data: tickers.map((ticker, i) => ({
          id: newId(),
          snapshotId: snapshot.id,
          instrumentId: ids.get(ticker)!,
          position: i + 1,
          avgVolumeCents: BigInt(1_000_000 - i),
          presenceDays: 60,
        })),
      });
    };
    // a temporada e os ciclos dela (pulados: o ciclo pulado não precisa de briefing nem de prompt, e a fita não olha o estado)
    const season = async (
      slug: string,
      status: 'DRAFT' | 'RUNNING' | 'FINISHED',
      cycles: string[],
    ) => {
      const row = await admin.season.create({
        data: {
          id: newId(),
          slug,
          name: slug,
          status,
          startDate: status === 'DRAFT' ? null : day('2026-10-26'),
          finishedAt: status === 'FINISHED' ? new Date('2026-11-06T21:00:00Z') : null,
          params: {},
        },
      });
      for (const date of cycles) {
        await admin.cycle.create({
          data: {
            id: newId(),
            seasonId: row.id,
            date: day(date),
            status: 'SKIPPED',
            skipReason: 'sem_briefing',
            decisionAt: new Date(`${date}T11:00:00Z`),
            deadlineAt: new Date(`${date}T12:30:00Z`),
          },
        });
      }
    };
    const tape = async () => {
      const res = await withSecret(TAPE);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      return envelopeSchema(internalTapeSchema).parse(res.body).data!;
    };
    // a fita do pregão de 03/11 (o anterior ao ciclo de 04/11): o anterior de cada papel é o de 30/10, e quem não tem barra nele fica nulo
    const ON_NOV_3 = {
      date: '2026-11-03',
      rows: [
        { ticker: 'PETR4', closeCents: 3_100, previousCloseCents: 3_000 },
        { ticker: 'ITUB4', closeCents: 4_000, previousCloseCents: null },
        { ticker: 'WEGE3', closeCents: 5_000, previousCloseCents: null },
        { ticker: 'BBAS3', closeCents: 2_000, previousCloseCents: null },
      ],
    };

    // A semana 2026-W45 (02/11 é Finados): o último ciclo é o de 04/11. O pregão anterior com barra é 03/11, e o 05/11 já tem barra, mas é
    // depois do ciclo. O universo da W44 (a semana anterior) e o BOVA11 (a referência, fora do universo) também têm barras, e não entram.
    // A fita só usa um pregão com a cobertura mínima do briefing (80% do universo com barra, LIMITS.coverageMinPercent): o universo da W45
    // tem cinco papéis, e 03/11 e 04/11 têm barra de quatro (80%, o limite, vale); o da W44 tem os dois com barra em 30/10.
    beforeEach(async () => {
      await clean();
      ids.clear();
      for (const ticker of ['VALE3', 'PETR4', 'ITUB4', 'WEGE3', 'ABEV3', 'BBAS3']) {
        await instrument(ticker);
      }
      await instrument('BOVA11', 'REFERENCE');
      await bars('PETR4', {
        '2026-10-30': 3_000,
        '2026-11-03': 3_100,
        '2026-11-04': 3_200,
        '2026-11-05': 3_300,
      });
      // sem barra no pregão anterior (03/11), só numa mais antiga: o anterior é nulo, e não o de 30/10
      await bars('VALE3', { '2026-10-30': 6_000, '2026-11-04': 6_100 });
      // sem barra no pregão da fita (04/11): fica de fora, e não entra com o fechamento velho
      await bars('ITUB4', { '2026-11-03': 4_000 });
      await bars('WEGE3', { '2026-11-03': 5_000, '2026-11-04': 5_100 });
      await bars('BBAS3', { '2026-11-03': 2_000, '2026-11-04': 2_100 });
      await bars('ABEV3', { '2026-10-30': 1_400, '2026-11-03': 1_500, '2026-11-04': 1_600 });
      await bars('BOVA11', { '2026-11-03': 15_000, '2026-11-04': 15_100 });
      await universe('2026-W44', ['ABEV3', 'PETR4']);
      await universe('2026-W45', ['VALE3', 'PETR4', 'ITUB4', 'WEGE3', 'BBAS3']);
    });

    it('200 no-store: o universo da semana do último ciclo, na ordem do universo, com o fechamento do pregão e o anterior', async () => {
      await season('em-andamento', 'RUNNING', ['2026-10-30', '2026-11-03', '2026-11-04']);
      expect(await tape()).toEqual({
        date: '2026-11-04',
        rows: [
          { ticker: 'VALE3', closeCents: 6_100, previousCloseCents: null },
          { ticker: 'PETR4', closeCents: 3_200, previousCloseCents: 3_100 },
          { ticker: 'WEGE3', closeCents: 5_100, previousCloseCents: 5_000 },
          { ticker: 'BBAS3', closeCents: 2_100, previousCloseCents: 2_000 },
        ],
      });
    });

    it('cada linha é só o ticker, o fechamento e o anterior: nada de abertura, máxima, mínima, volume, nome, posição nem id', async () => {
      await season('em-andamento', 'RUNNING', ['2026-11-04']);
      const res = await withSecret(TAPE);
      const rows = (res.body as { data: { rows: Array<Record<string, unknown>> } }).data.rows;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(['closeCents', 'previousCloseCents', 'ticker']);
      }
      expect(Object.keys((res.body as { data: object }).data).sort()).toEqual(['date', 'rows']);
      expect(JSON.stringify(res.body)).not.toMatch(/open|high|low|volume|name|position|"id"/i);
    });

    // O ciclo de hoje abre às 08:00 e a barra de hoje só chega depois do fechamento: até lá, a fita é o pregão anterior (o que o briefing deu).
    it('antes da barra do pregão do ciclo, a fita é a do pregão anterior com barra', async () => {
      await season('em-andamento', 'RUNNING', ['2026-11-03', '2026-11-04']);
      await admin.dailyBar.deleteMany({ where: { date: day('2026-11-04') } });
      expect(await tape()).toEqual(ON_NOV_3);
    });

    // A partir das 21:30 o eod grava as barras do dia papel a papel (e se reagenda de hora em hora se falta papel): no meio da carga, o
    // pregão do ciclo tem barra de só parte do universo. A fita (e a legenda, que conta as linhas) não mostra esse pregão pela metade:
    // fica no último com a cobertura do briefing até a carga passar dela.
    it('no meio da carga do fim do dia (o pregão do ciclo com barra de só parte do universo), a fita fica no último pregão com a cobertura do briefing', async () => {
      await season('em-andamento', 'RUNNING', ['2026-11-03', '2026-11-04']);
      // 04/11 com 2 de 5 (40%): o VALE3 e o WEGE3 ainda não chegaram
      await admin.dailyBar.deleteMany({
        where: {
          date: day('2026-11-04'),
          instrumentId: { in: [ids.get('VALE3')!, ids.get('WEGE3')!] },
        },
      });
      expect(await tape()).toEqual(ON_NOV_3);
      // a carga chega a 3 de 5 (60%): ainda não
      await bars('WEGE3', { '2026-11-04': 5_100 });
      expect((await tape()).date).toBe('2026-11-03');
      // e a 4 de 5 (80%, a cobertura mínima, que vale): a fita passa para 04/11
      await bars('VALE3', { '2026-11-04': 6_100 });
      expect((await tape()).date).toBe('2026-11-04');
    });

    it('a temporada atual é a em andamento (a encerrada e o rascunho, mesmo com ciclo mais novo, não contam)', async () => {
      await season('encerrada', 'FINISHED', ['2026-10-30']);
      await season('rascunho', 'DRAFT', ['2026-11-05']);
      await season('em-andamento', 'RUNNING', ['2026-11-04']);
      expect((await tape()).date).toBe('2026-11-04');
    });

    it('sem temporada em andamento, a última encerrada: a fita para no último pregão dela, e o universo é o da semana dele', async () => {
      await season('encerrada', 'FINISHED', ['2026-10-29', '2026-10-30']);
      expect(await tape()).toEqual({
        date: '2026-10-30',
        rows: [
          { ticker: 'ABEV3', closeCents: 1_400, previousCloseCents: null },
          { ticker: 'PETR4', closeCents: 3_000, previousCloseCents: null },
        ],
      });
    });

    it.each([
      ['sem temporada', () => Promise.resolve()],
      ['só com rascunho', () => season('rascunho', 'DRAFT', ['2026-11-04'])],
      ['temporada sem ciclo (antes do primeiro pregão)', () => season('nova', 'RUNNING', [])],
      // a W46 não tem universo congelado: não se usa o da semana anterior
      [
        'a semana do último ciclo sem universo',
        () => season('em-andamento', 'RUNNING', ['2026-11-04', '2026-11-09']),
      ],
      // o universo da W44 só tem barra de 30/10 em diante: nada até 27/10
      [
        'o universo sem barra até o pregão do ciclo',
        () => season('em-andamento', 'RUNNING', ['2026-10-27']),
      ],
      // sem o ITUB4, o WEGE3 e o BBAS3, nenhum pregão até 04/11 tem 80% da W45 com barra (2, 1 e 2 de 5): a fita não inventa um pregão
      [
        'nenhum pregão com a cobertura do briefing (80% do universo com barra)',
        async () => {
          await season('em-andamento', 'RUNNING', ['2026-11-04']);
          await admin.dailyBar.deleteMany({
            where: { instrumentId: { in: ['ITUB4', 'WEGE3', 'BBAS3'].map((t) => ids.get(t)!) } },
          });
        },
      ],
    ])('%s: a resposta vazia (200, no-store), nunca 404 nem 500', async (_name, arrange) => {
      await arrange();
      const res = await withSecret(TAPE);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual(EMPTY_TAPE);
    });

    it('parâmetro de query é 400 no envelope, no-store; o POST não acha a rota', async () => {
      await season('em-andamento', 'RUNNING', ['2026-11-04']);
      for (const path of [`${TAPE}?x=1`, `${TAPE}?a=1&a=2`, `${TAPE}?limite=2`]) {
        const res = await withSecret(path);
        expect(res.status, path).toBe(400);
        expect(res.headers['cache-control'], path).toBe('no-store');
        expect(res.body, path).toMatchObject({ success: false, data: null });
      }
      const post = await http().post(TAPE).set('Authorization', `Bearer ${SECRET}`);
      expect(post.status).toBe(404);
    });
  });

  // Os logos das ações (ADR 0036): o SVG que a atualização semanal guardou, servido como imagem, fora do envelope, com os cabeçalhos que o
  // deixam inerte até aberto direto na aba; e a lista de quem tem logo, com a versão. Sem logo, 404 com o código próprio (o 404 da rota que
  // não existe é só o do segredo). As duas leem o banco como está: a passada dos logos só deixa nele o que passa no validador de hoje.
  describe('os logos, com o segredo', () => {
    const store = async (ticker: string, svg: string, sha256 = 'a'.repeat(64)) => {
      const { id } = await admin.instrument.findUniqueOrThrow({ where: { ticker } });
      await admin.instrumentLogo.create({
        data: {
          instrumentId: id,
          sourceUrl: `https://icons.brapi.dev/icons/${ticker}.svg`,
          svg,
          sha256,
          bytes: Buffer.byteLength(svg),
          fetchedAt: new Date('2026-11-01T12:00:00Z'),
        },
      });
    };
    // o corpo como texto, seja qual for o tipo que o supertest viu
    const text = (res: request.Response) =>
      Buffer.isBuffer(res.body) ? res.body.toString('utf8') : res.text;

    beforeEach(async () => {
      await store('PETR4', LOGO_SVG);
    });

    it('200 com o SVG guardado, byte a byte, como image/svg+xml, nosniff, a CSP que o deixa inerte e no-store', async () => {
      const res = await withSecret(`${LOGOS}/PETR4`).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/svg+xml');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe(LOGO_CSP);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(text(res)).toBe(LOGO_SVG);
      // fora do envelope: o corpo é a imagem, sem success, data nem error
      expect(text(res)).not.toMatch(/"success"/);
    });

    it('minúsculas valem, como nas barras', async () => {
      const res = await withSecret(`${LOGOS}/petr4`).buffer(true);
      expect(res.status).toBe(200);
      expect(text(res)).toBe(LOGO_SVG);
    });

    it('sem logo (o papel sem logo guardado e o papel que não existe): 404 no envelope, LOGO_NOT_FOUND, no-store, nunca o SVG de outro', async () => {
      for (const ticker of ['SEMB3', 'ZZZZ3', 'BOVA11']) {
        const res = await withSecret(`${LOGOS}/${ticker}`);
        expect(res.status, ticker).toBe(404);
        expect(res.headers['cache-control'], ticker).toBe('no-store');
        expect(res.headers['content-type'], ticker).toMatch(/^application\/json/);
        expect(res.body, ticker).toEqual({
          success: false,
          data: null,
          error: { code: 'LOGO_NOT_FOUND', message: 'Este papel não tem logo' },
        });
      }
    });

    it('a lista: no envelope, no-store, só os papéis com logo, em ordem de ticker, com a versão (os 16 primeiros hex do SHA-256)', async () => {
      await store('BOVA11', LOGO_SVG, `${'0123456789abcdef'}${'f'.repeat(48)}`);
      const res = await withSecret(LOGOS);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(envelopeSchema(internalLogosSchema).parse(res.body).data).toEqual({
        logos: [
          { ticker: 'BOVA11', version: '0123456789abcdef' },
          { ticker: 'PETR4', version: 'a'.repeat(16) },
        ],
      });
      // o SEMB3 não tem logo: fora da lista; e nada além do ticker e da versão sai (nem o SVG, nem o endereço de origem, nem o SHA-256 inteiro)
      expect(JSON.stringify(res.body)).not.toMatch(/SEMB3|svg|icons|https|a{17}/);
    });

    it('a lista na ordem dos bytes do ticker (a mesma do JavaScript), e a lista vazia sem logo nenhum', async () => {
      for (const ticker of ['B3SA3', 'BBAS3', 'ABEV3']) {
        await admin.instrument.create({
          data: {
            id: newId(),
            ticker,
            name: ticker,
            spec: 'ON',
            kind: 'STOCK',
            lastSeen: day('2026-10-30'),
          },
        });
        await store(ticker, LOGO_SVG);
      }
      const tickers = (
        (await withSecret(LOGOS)).body as { data: { logos: Array<{ ticker: string }> } }
      ).data.logos.map((logo) => logo.ticker);
      expect(tickers).toEqual(['ABEV3', 'B3SA3', 'BBAS3', 'PETR4']);
      expect(tickers).toEqual([...tickers].sort());
      await admin.instrumentLogo.deleteMany();
      expect((await withSecret(LOGOS)).body).toEqual({
        success: true,
        data: { logos: [] },
        error: null,
      });
    });

    it('a lista com parâmetro de query é 400 no envelope, no-store', async () => {
      for (const path of [`${LOGOS}?x=1`, `${LOGOS}?ticker=PETR4`]) {
        const res = await withSecret(path);
        expect(res.status, path).toBe(400);
        expect(res.headers['cache-control'], path).toBe('no-store');
      }
    });

    it('ticker torto e parâmetro de query são 400 no envelope, no-store, nunca 404 nem 500', async () => {
      for (const path of [
        `${LOGOS}/PETR`,
        `${LOGOS}/PETR4XXXXXXXXXX`,
        `${LOGOS}/PETR4.svg`,
        `${LOGOS}/%00`,
        `${LOGOS}/P%20T4`,
        `${LOGOS}/..%2FPETR4`,
        `${LOGOS}/PETR4?x=1`,
        `${LOGOS}/PETR4?a=1&a=2`,
      ]) {
        const res = await withSecret(path);
        expect(res.status, path).toBe(400);
        expect(res.headers['cache-control'], path).toBe('no-store');
        expect(res.body, path).toMatchObject({ success: false, data: null });
      }
    });

    it('só GET (e o HEAD que vem com ele, sem corpo): o POST não acha a rota', async () => {
      const head = await http().head(`${LOGOS}/PETR4`).set('Authorization', `Bearer ${SECRET}`);
      expect(head.status).toBe(200);
      expect(head.headers['content-security-policy']).toBe(LOGO_CSP);
      const post = await http().post(`${LOGOS}/PETR4`).set('Authorization', `Bearer ${SECRET}`);
      expect(post.status).toBe(404);
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

    // A fita, com o mesmo guard: a recusa é a da rota que não existe, sem parâmetro no caminho.
    it.each(refusals)(
      'a fita %s: 404 no-store, igual ao da rota que não existe',
      async (_name, ask) => {
        const missingTape = '/api/v1/interno/nao-existe';
        const refused = await ask(TAPE);
        const missing = await ask(missingTape);
        expect(refused.status).toBe(404);
        expect(refused.headers['cache-control']).toBe('no-store');
        expect(refused.headers['content-type']).toBe(missing.headers['content-type']);
        expect(refused.body).toEqual({
          success: false,
          data: null,
          error: { code: 'NOT_FOUND', message: `Cannot GET ${TAPE}` },
        });
        expect(missing.body).toEqual({
          success: false,
          data: null,
          error: { code: 'NOT_FOUND', message: `Cannot GET ${missingTape}` },
        });
        expect(names(refused)).toEqual(names(missing));
      },
    );

    // A lista dos logos, com o mesmo guard: a recusa é a da rota que não existe, sem parâmetro no caminho.
    it.each(refusals)(
      'a lista dos logos %s: 404 no-store, igual ao da rota que não existe',
      async (_name, ask) => {
        const missingList = '/api/v1/interno/nao-existe';
        const refused = await ask(LOGOS);
        const missing = await ask(missingList);
        expect(refused.status).toBe(404);
        expect(refused.headers['cache-control']).toBe('no-store');
        expect(refused.body).toEqual({
          success: false,
          data: null,
          error: { code: 'NOT_FOUND', message: `Cannot GET ${LOGOS}` },
        });
        expect(names(refused)).toEqual(names(missing));
      },
    );

    // Os logos, com o mesmo guard: a recusa é a da rota que não existe, e o logo guardado nunca sai.
    it.each(refusals)(
      'os logos %s: 404 no-store, igual ao da rota que não existe, sem o SVG',
      async (_name, ask) => {
        const { id } = await admin.instrument.findUniqueOrThrow({ where: { ticker: 'PETR4' } });
        await admin.instrumentLogo.create({
          data: {
            instrumentId: id,
            sourceUrl: 'https://icons.brapi.dev/icons/PETR4.svg',
            svg: LOGO_SVG,
            sha256: 'a'.repeat(64),
            bytes: Buffer.byteLength(LOGO_SVG),
            fetchedAt: new Date('2026-11-01T12:00:00Z'),
          },
        });
        const refused = await ask(`${LOGOS}/PETR4`);
        const missing = await ask(MISSING);
        expect(refused.status).toBe(404);
        expect(refused.headers['cache-control']).toBe('no-store');
        expect(refused.headers['content-type']).toBe(missing.headers['content-type']);
        expect(refused.headers['content-security-policy']).toBe(
          missing.headers['content-security-policy'],
        );
        expect(refused.body).toEqual({
          success: false,
          data: null,
          error: { code: 'NOT_FOUND', message: `Cannot GET ${LOGOS}/PETR4` },
        });
        expect(names(refused)).toEqual(names(missing));
        expect(refused.text).not.toContain('<svg');
      },
    );

    it('o segredo certo não aparece em nenhuma resposta de recusa (corpo nem cabeçalho)', async () => {
      for (const [name, ask] of refusals) {
        for (const path of [`${BASE}/PETR4`, TAPE, `${LOGOS}/PETR4`, LOGOS]) {
          const res = await ask(path);
          expect(res.text, `${name} ${path}`).not.toContain(SECRET);
          expect(JSON.stringify(res.headers), `${name} ${path}`).not.toContain(SECRET);
        }
      }
    });

    it('HEAD sem o segredo também é 404, e sem corpo', async () => {
      for (const path of [`${BASE}/PETR4`, TAPE, `${LOGOS}/PETR4`, LOGOS]) {
        const res = await http().head(path);
        expect(res.status, path).toBe(404);
        expect(res.text ?? '', path).toBe('');
      }
    });

    it('recusa antes de validar: com o segredo errado nem o ticker torto nem a query viram 400', async () => {
      for (const path of [
        `${BASE}/PETR`,
        `${TAPE}?x=1`,
        `${LOGOS}/PETR`,
        `${LOGOS}/SEMB3`,
        `${LOGOS}?x=1`,
      ]) {
        const res = await withSecret(path, 'errado-0123456789abcdef0123456789abcdef');
        expect(res.status, path).toBe(404);
      }
    });
  });

  describe('fora do Swagger', () => {
    it('o documento da api não cita as rotas internas', async () => {
      const doc = await http().get('/api/docs-json');
      expect(doc.status).toBe(200);
      expect(JSON.stringify((doc.body as { paths: unknown }).paths)).not.toContain('interno');
      expect(JSON.stringify(doc.body)).not.toMatch(/interno|barras|fita|logos|QUOTES/i);
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

    it('as rotas estão desligadas: 404 para todos, até com um Bearer qualquer', async () => {
      const http = request(app.getHttpServer() as Parameters<typeof request>[0]);
      for (const path of [`${BASE}/PETR4`, TAPE, `${LOGOS}/PETR4`, LOGOS]) {
        for (const auth of [undefined, `Bearer ${SECRET}`, 'Bearer undefined']) {
          const req = http.get(path);
          const res = await (auth ? req.set('Authorization', auth) : req);
          expect(res.status, `${path} ${String(auth)}`).toBe(404);
          expect(res.headers['cache-control']).toBe('no-store');
        }
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

  // O contrato não importa da api: o teto da fita é escrito lá à mão, e este teste prende os dois números (o universo maior caberia no
  // banco e reprovaria na saída, com 500).
  it('a fita cabe o universo inteiro: o teto do contrato é o do universo', () => {
    expect(INTERNAL_TAPE_LIMIT).toBe(UNIVERSE_RULES.maxMembers);
  });
});
