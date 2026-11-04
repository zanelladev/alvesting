import { BlobServiceClient } from '@azure/storage-blob';
import {
  PAGE_DEFAULT_LIMIT,
  PAGE_MAX_LIMIT,
  PUBLIC_CACHE_CONTROL,
  arenaCurrentSchema,
  competitorDetailSchema,
  cycleViewSchema,
  decisionsPageSchema,
  envelopeSchema,
  equitySchema,
  leaderboardSchema,
  newsPageSchema,
  randomBaselineSchema,
  seasonParamsSchema,
  seasonsPageSchema,
  stockDetailSchema,
  stockSearchSchema,
} from '@alvesting/contracts';
import { Logger, type INestApplication } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { newId } from '../../../common/id.js';
import { configureApp } from '../../../configure-app.js';
import { ENSAIO_CANARY, runEnsaio, truncateAll } from '../../../ensaio/driver.js';
import { ENSAIO_PROMPT, clearEnsaioBlobs } from '../../../ensaio/world.js';
import { DatabaseModule } from '../../../infrastructure/database/database.module.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { createLeakFilter } from '../../arena/domain/leak-filter.js';
import { CyclesModule } from '../../arena/cycles.module.js';
import { PublicModule } from '../public.module.js';
import { PublicController } from './public.controller.js';

// A API pública (plano §9, etapa 9) sobre uma temporada INTEIRA e sintética: o driver do ensaio (docs/ENSAIO.md) semeia o banco de
// teste com 3 pregões, o Monte Carlo, as notícias e as decisões dos quatro modelos fake, sem rede e sem dado de terceiro. As
// expectativas saem do banco por consultas do próprio teste, não do repositório que está sendo testado.
//
// O canário da etapa 6 vira uma varredura: antes de pedir qualquer rota, o teste PLANTA um marcador em cada coluna que nunca pode
// sair (trecho da notícia, endereços do Blob, campos do filtro de vazamento, erro do job, config do competidor) e depois confere
// que nenhuma rota pública o devolve, junto com o canário e as frases do prompt do ensaio.
const storage = process.env.STORAGE_CONNECTION_STRING;
const ready = Boolean(testDatabaseUrl && storage);
const title = ready
  ? 'API pública da arena sobre uma temporada sintética (Postgres + Azurite)'
  : 'API pública da arena sobre uma temporada sintética (Postgres + Azurite) [pulado: defina TEST_DATABASE_URL e STORAGE_CONNECTION_STRING com o Postgres e o Azurite no ar, ver .env.example]';

const SESSIONS = 3;
const FIRST = '2026-11-03';
const LAST = '2026-11-05';
const iso = (date: Date) => date.toISOString().slice(0, 10);
const day = (value: string) => new Date(`${value}T00:00:00Z`);

// os marcadores plantados nas colunas proibidas
const MARKERS = {
  snippet: 'MARCADOR-SNIPPET-PRIVADO',
  briefingUri: 'MARCADOR-URI-DO-BRIEFING',
  ioUri: 'MARCADOR-URI-DO-IO-BRUTO',
  leak: 'MARCADOR-CAMPO-DO-FILTRO',
  jobError: 'MARCADOR-ERRO-DO-JOB',
  config: 'MARCADOR-CONFIG-DO-COMPETIDOR',
  meta: 'b'.repeat(64),
};

describe.skipIf(!ready)(title, () => {
  // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api (ADR 0028), com o qual a api sob teste atende as rotas
  let prisma: PrismaService;
  let apiPrisma: PrismaService;
  let blob: BlobServiceClient;
  let app: INestApplication;
  let seasonId: string;
  let momentumId: string;
  let secondCycleId: string;
  // o ticker mais citado nas notícias do ensaio
  let newsTicker: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    prisma = await openTestDatabase(testDatabaseUrl!);
    apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
    blob = BlobServiceClient.fromConnectionString(storage!);
    const result = await runEnsaio({ prisma, blob, seed: 1, sessions: SESSIONS, stocks: 12 });
    expect(result.ok, 'o ensaio que semeia o banco tem de passar').toBe(true);

    seasonId = (await prisma.season.findFirstOrThrow({ where: { slug: 'ensaio' } })).id;
    momentumId = (await prisma.competitor.findFirstOrThrow({ where: { slug: 'fake-momentum' } }))
      .id;
    secondCycleId = (await prisma.cycle.findFirstOrThrow({ where: { date: day('2026-11-04') } }))
      .id;
    const cited = new Map<string, number>();
    for (const { tickers } of await prisma.newsItem.findMany({ select: { tickers: true } })) {
      for (const ticker of tickers) cited.set(ticker, (cited.get(ticker) ?? 0) + 1);
    }
    newsTicker = [...cited.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];

    // custo de LLM de verdade (o fake custa zero) e os marcadores nas colunas que nunca saem
    await prisma.decision.updateMany({
      where: { competitorId: momentumId },
      data: { costMicroUsd: 1_500_000n },
    });
    await prisma.decision.updateMany({
      data: {
        ioUris: { request: `https://conta.blob.core.windows.net/llm-io/${MARKERS.ioUri}.json` },
        leakFields: [MARKERS.leak],
        metaSha256: MARKERS.meta,
      },
    });
    await prisma.briefing.updateMany({
      data: { uri: `https://conta.blob.core.windows.net/briefings/${MARKERS.briefingUri}.json` },
    });
    await prisma.newsItem.updateMany({ data: { snippet: `${MARKERS.snippet} trecho do feed` } });
    await prisma.jobRun.updateMany({ data: { error: MARKERS.jobError } });
    await prisma.competitor.updateMany({
      where: { kind: 'MODEL' },
      data: { config: { pricingUsdPerMTok: { input: MARKERS.config, output: '1' } } },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, PublicModule, CyclesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(apiPrisma)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    // não deixa o mercado do ensaio no banco de teste nem os arquivos no Azurite: os outros testes começam do zero
    await truncateAll(prisma);
    await clearEnsaioBlobs(blob);
    await apiPrisma.onModuleDestroy();
    await prisma.onModuleDestroy();
  });

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
  const get = (url: string) => http().get(url);

  // Pede a rota, confere o 200 no envelope e valida o corpo com o schema do contrato (o mesmo que o site usa).
  async function ok<S extends z.ZodType>(url: string, schema: S): Promise<z.output<S>> {
    const res = await get(url);
    expect(res.status, `${url}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
    const envelope = envelopeSchema(schema).parse(res.body);
    expect(envelope.success).toBe(true);
    return (res.body as { data: z.output<S> }).data;
  }

  // Todas as páginas de uma lista, seguindo o cursor, com um limite pequeno.
  async function allPages<T>(
    url: string,
    schema: z.ZodType<{ rows: T[]; nextCursor: string | null }>,
    limit: number,
  ): Promise<{ rows: T[]; pages: number }> {
    const rows: T[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const sep = url.includes('?') ? '&' : '?';
      const page: { rows: T[]; nextCursor: string | null } = await ok(
        `${url}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
        schema,
      );
      rows.push(...page.rows);
      pages += 1;
      cursor = page.nextCursor;
      expect(pages, 'a paginação não pode girar para sempre').toBeLessThan(500);
    } while (cursor);
    return { rows, pages };
  }

  describe('GET /arena/current', () => {
    it('traz a temporada, o último ciclo com os hashes, o macro com a data de cada valor e o topo do ranking', async () => {
      const current = await ok('/api/v1/arena/current', arenaCurrentSchema);

      // a temporada encerrada, porque nenhuma está em andamento
      expect(current.season).toMatchObject({
        slug: 'ensaio',
        status: 'FINISHED',
        startDate: FIRST,
        settledThrough: LAST,
      });
      expect(current.season!.params.sessions).toBe(SESSIONS);
      expect(current.season!.params.monteCarloRuns).toBe(1000);
      // a temporada acabou: não há próximo ciclo
      expect(current.nextCycle).toBeNull();

      // o último ciclo: pregão, horários, versão e SHA-256 do prompt, SHA-256 do briefing e a contagem de BUY, SELL e HOLD
      const cycle = await prisma.cycle.findFirstOrThrow({
        where: { date: day(LAST) },
        include: { briefing: true, promptVersion: true },
      });
      expect(current.lastCycle).toMatchObject({
        date: LAST,
        status: 'CLOSED',
        decisionAt: cycle.decisionAt.toISOString(),
        deadlineAt: cycle.deadlineAt.toISOString(),
        closedAt: cycle.closedAt!.toISOString(),
        prompt: { version: cycle.promptVersion!.version, sha256: cycle.promptVersion!.sha256 },
        briefingSha256: cycle.briefing!.sha256,
      });
      const items = await prisma.decisionItem.findMany({
        where: { dropped: false, decision: { cycleId: cycle.id } },
      });
      const count = (action: string) => items.filter((i) => i.action === action).length;
      expect(current.lastCycle!.counts).toEqual({
        BUY: count('BUY'),
        SELL: count('SELL'),
        HOLD: count('HOLD'),
      });
      expect(current.lastCycle!.counts.BUY + current.lastCycle!.counts.HOLD).toBeGreaterThan(0);

      // o macro: o valor mais recente até o último pregão da base, cada um com a sua data
      const macro = current.macro;
      expect(macro.cdi).toMatchObject({ date: expect.stringMatching(/^2026-11-0\d$/) as string });
      for (const key of ['cdi', 'selic', 'ipcaMonth', 'ipca12m', 'usd'] as const) {
        const value = macro[key];
        expect(value, key).not.toBeNull();
        expect(value!.value, key).toMatch(/^-?\d+(\.\d+)?$/);
        // nunca um valor depois do último pregão da base: seria olhar para o futuro
        expect(value!.date <= LAST, key).toBe(true);
      }
      // sem o BOVA11: o fechamento dele é cotação bruta e só a rota interna do site o entrega (docs/API.md, seção 6; ADR 0033)
      expect(Object.keys(macro).sort()).toEqual(['cdi', 'ipca12m', 'ipcaMonth', 'selic', 'usd']);

      // o topo do ranking: maiores retornos primeiro
      expect(current.top).toHaveLength(5);
      expect(current.top.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
      const returns = current.top.map((r) => r.returnBps);
      expect(returns).toEqual([...returns].sort((a, b) => b - a));
    });
  });

  describe('a contagem do último ciclo', () => {
    it('conta só os itens que valeram: o descartado (BUY, SELL ou HOLD) fica de fora', async () => {
      const cycle = await prisma.cycle.findFirstOrThrow({ where: { date: day(LAST) } });
      const decision = await prisma.decision.findFirstOrThrow({ where: { cycleId: cycle.id } });
      const before = (await ok('/api/v1/arena/current', arenaCurrentSchema)).lastCycle!.counts;
      const ids = [newId(), newId(), newId()];
      await prisma.decisionItem.createMany({
        data: (['BUY', 'SELL', 'HOLD'] as const).map((action, index) => ({
          id: ids[index]!,
          decisionId: decision.id,
          position: 90 + index,
          action,
          ticker: 'XPTO3',
          percent: action === 'HOLD' ? null : 10,
          dropped: true,
          dropReason: 'not_in_universe' as const,
        })),
      });
      try {
        const after = (await ok('/api/v1/arena/current', arenaCurrentSchema)).lastCycle!.counts;
        expect(after).toEqual(before);
      } finally {
        await prisma.decisionItem.deleteMany({ where: { id: { in: ids } } });
      }
    });
  });

  describe('o próximo ciclo (a contagem da home)', () => {
    // temporada em andamento que começou na segunda 16/11; a sexta 20/11 é feriado da B3 (b3-holidays.json). Os ciclos são pulados
    // (SKIPPED) porque não precisam de briefing nem de prompt: o que importa aqui é só a data.
    async function seasonWithCycles(sessions: number, dates: string[]) {
      const season = await prisma.season.create({
        data: {
          id: newId(),
          slug: 'contagem',
          name: 'Contagem',
          status: 'RUNNING',
          startDate: day('2026-11-16'),
          startedAt: new Date('2026-11-13T21:00:00Z'),
          params: { randomSeed: 'a', monteCarloSeed: 'b', sessions },
        },
      });
      await prisma.cycle.createMany({
        data: dates.map((date) => ({
          id: newId(),
          seasonId: season.id,
          date: day(date),
          status: 'SKIPPED' as const,
          skipReason: 'sem_briefing',
          decisionAt: new Date(`${date}T11:00:00Z`),
          deadlineAt: new Date(`${date}T12:30:00Z`),
        })),
      });
      return season.id;
    }
    const drop = async (id: string) => {
      await prisma.cycle.deleteMany({ where: { seasonId: id } });
      await prisma.season.delete({ where: { id } });
    };

    it('é o pregão seguinte ao último ciclo, às 08:00 de Brasília, pulando o feriado e o fim de semana', async () => {
      const id = await seasonWithCycles(20, [
        '2026-11-16',
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
      ]);
      try {
        const current = await ok('/api/v1/arena/current', arenaCurrentSchema);
        expect(current.season?.slug).toBe('contagem');
        expect(current.lastCycle?.date).toBe('2026-11-19');
        // sexta 20/11 é feriado, depois vêm o sábado e o domingo
        expect(current.nextCycle).toEqual({
          date: '2026-11-23',
          decisionAt: '2026-11-23T11:00:00.000Z',
        });
      } finally {
        await drop(id);
      }
    });

    it('na última sessão da temporada não há próximo ciclo', async () => {
      // 16, 17, 18, 19 e 23: a quinta sessão já abriu
      const id = await seasonWithCycles(5, [
        '2026-11-16',
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
        '2026-11-23',
      ]);
      try {
        const current = await ok('/api/v1/arena/current', arenaCurrentSchema);
        expect(current.lastCycle?.date).toBe('2026-11-23');
        expect(current.nextCycle).toBeNull();
      } finally {
        await drop(id);
      }
    });
  });

  describe('GET /seasons', () => {
    it('lista as temporadas em andamento e encerradas, com os parâmetros públicos', async () => {
      const page = await ok('/api/v1/seasons', seasonsPageSchema);
      expect(page.rows.map((s) => s.slug)).toEqual(['ensaio']);
      expect(page.nextCursor).toBeNull();
      expect(page.rows[0]!.params.randomSeed).toEqual(expect.any(String));
    });

    it('a rascunho (DRAFT) não é pública: nem na lista, nem nas rotas da temporada', async () => {
      const draft = await prisma.season.create({
        data: {
          id: newId(),
          slug: 'rascunho',
          name: 'Rascunho secreto',
          status: 'DRAFT',
          params: { randomSeed: 'a', monteCarloSeed: 'b' },
        },
      });
      try {
        const page = await ok('/api/v1/seasons', seasonsPageSchema);
        expect(page.rows.map((s) => s.slug)).not.toContain('rascunho');
        expect((await get('/api/v1/seasons/rascunho/leaderboard')).status).toBe(404);
        expect((await get(`/api/v1/seasons/${draft.id}/equity`)).status).toBe(404);
        expect((await get('/api/v1/competitors/fake-momentum?season=rascunho')).status).toBe(404);
        expect(JSON.stringify((await get('/api/v1/arena/current')).body)).not.toContain(
          'Rascunho secreto',
        );
      } finally {
        await prisma.season.delete({ where: { id: draft.id } });
      }
    });

    it('a temporada em andamento vem antes da encerrada no arena/current', async () => {
      const running = await prisma.season.create({
        data: {
          id: newId(),
          slug: 'em-andamento',
          name: 'Em andamento',
          status: 'RUNNING',
          startDate: day('2026-11-10'),
          startedAt: new Date('2026-11-09T21:00:00Z'),
          params: { randomSeed: 'a', monteCarloSeed: 'b' },
        },
      });
      try {
        const current = await ok('/api/v1/arena/current', arenaCurrentSchema);
        expect(current.season).toMatchObject({ slug: 'em-andamento', status: 'RUNNING' });
        // ainda sem liquidação nem ciclo: o próximo é o primeiro pregão, às 08:00 de Brasília
        expect(current.season!.settledThrough).toBeNull();
        expect(current.lastCycle).toBeNull();
        expect(current.nextCycle).toEqual({
          date: '2026-11-10',
          decisionAt: '2026-11-10T11:00:00.000Z',
        });
        expect(current.top).toEqual([]);
        const page = await ok('/api/v1/seasons', seasonsPageSchema);
        expect(page.rows.map((s) => s.slug)).toEqual(['em-andamento', 'ensaio']);
        // a paginação por cursor: uma por página, sem repetir
        const { rows, pages } = await allPages('/api/v1/seasons', seasonsPageSchema, 1);
        expect(rows.map((s) => s.slug)).toEqual(['em-andamento', 'ensaio']);
        expect(pages).toBe(2);
      } finally {
        await prisma.season.delete({ where: { id: running.id } });
      }
    });
  });

  describe('a temporada de cada rota', () => {
    it('o slug do competidor é da temporada: sem ?season= vale a atual, e a de outro slug não aparece na errada', async () => {
      const running = await prisma.season.create({
        data: {
          id: newId(),
          slug: 'em-andamento',
          name: 'Em andamento',
          status: 'RUNNING',
          startDate: day('2026-11-10'),
          startedAt: new Date('2026-11-09T21:00:00Z'),
          params: { randomSeed: 'a', monteCarloSeed: 'b' },
        },
      });
      await prisma.competitor.create({
        data: {
          id: newId(),
          seasonId: running.id,
          slug: 'fake-momentum',
          name: 'Outro Momentum',
          kind: 'MODEL',
          provider: 'fake',
          modelId: 'fake/outro',
          position: 0,
        },
      });
      try {
        // a atual é a que está em andamento: o competidor dela, ainda sem liquidação
        const current = await ok('/api/v1/competitors/fake-momentum', competitorDetailSchema);
        expect(current.season.slug).toBe('em-andamento');
        expect(current.competitor).toMatchObject({ name: 'Outro Momentum', modelId: 'fake/outro' });
        expect(current.stat).toBeNull();
        expect(current.portfolio).toBeNull();
        // a da temporada encerrada, escolhida pelo slug ou pelo ULID
        for (const ref of ['ensaio', seasonId]) {
          const old = await ok(
            `/api/v1/competitors/fake-momentum?season=${ref}`,
            competitorDetailSchema,
          );
          expect(old.season.slug).toBe('ensaio');
          expect(old.competitor.modelId).toBe('fake/momentum');
          expect(old.portfolio).not.toBeNull();
        }
        // o igual-peso só existe na encerrada
        expect((await get('/api/v1/competitors/igual-peso')).status).toBe(404);
        expect((await get('/api/v1/competitors/igual-peso?season=ensaio')).status).toBe(200);
        // a página da ação lê os donos e as decisões da temporada atual: na que acabou de começar, nenhum
        const held = await prisma.position.findFirstOrThrow({ where: { date: day(LAST) } });
        const stock = await ok(`/api/v1/stocks/${held.ticker}`, stockDetailSchema);
        expect(stock.season?.slug).toBe('em-andamento');
        expect(stock.holders).toEqual([]);
        expect(stock.decisions).toEqual([]);
        // o feed e o ciclo seguem a mesma regra
        expect((await ok('/api/v1/decisions', decisionsPageSchema)).rows).toEqual([]);
        expect(
          (await ok('/api/v1/decisions?season=ensaio', decisionsPageSchema)).rows,
        ).toHaveLength(SESSIONS * 4);
        expect((await get('/api/v1/cycles/2026-11-04')).status).toBe(404);
        expect((await get('/api/v1/cycles/2026-11-04?season=ensaio')).status).toBe(200);
      } finally {
        await prisma.competitor.deleteMany({ where: { seasonId: running.id } });
        await prisma.season.delete({ where: { id: running.id } });
      }
    });

    it('o macro nunca é de depois do último pregão da base (a meta Selic vem projetada para os dias seguintes)', async () => {
      await prisma.macroDaily.create({
        data: { series: 'selic_target_pct_year', date: day('2026-12-31'), value: '99.50' },
      });
      try {
        const current = await ok('/api/v1/arena/current', arenaCurrentSchema);
        expect(current.macro.selic).not.toBeNull();
        expect(current.macro.selic!.date <= LAST).toBe(true);
        expect(current.macro.selic!.value).not.toBe('99.50');
      } finally {
        await prisma.macroDaily.deleteMany({ where: { date: day('2026-12-31') } });
      }
    });
  });

  describe('GET /seasons/:id/leaderboard', () => {
    it('um item por competidor, marcado pelo tipo, ordenado pelo retorno, com os números do banco', async () => {
      const board = await ok(`/api/v1/seasons/${seasonId}/leaderboard`, leaderboardSchema);
      expect(board.season.slug).toBe('ensaio');
      expect(board.asOf).toBe(LAST);
      expect(board.rows).toHaveLength(8);
      expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

      const types = Object.fromEntries(
        board.rows.map((r) => [r.competitor.slug, r.competitor.type]),
      );
      expect(types).toEqual({
        'fake-momentum': 'MODEL',
        'fake-contrarian': 'MODEL',
        'fake-hold': 'MODEL',
        'fake-flaky': 'MODEL',
        sorteio: 'RANDOM',
        'igual-peso': 'EQUAL_WEIGHT',
        cdi: 'CDI',
        bova11: 'BOVA11',
      });
      const returns = board.rows.map((r) => r.returnBps);
      expect(returns).toEqual([...returns].sort((a, b) => b - a));

      const stats = await prisma.seasonStat.findMany({ include: { competitor: true } });
      // o empate de retorno (o fake-hold e o CDI rendem igual) vale a ordem do elenco
      const expectedOrder = [...stats]
        .sort((a, b) => b.returnBps - a.returnBps || a.competitor.position - b.competitor.position)
        .map((stat) => stat.competitor.slug);
      expect(board.rows.map((r) => r.competitor.slug)).toEqual(expectedOrder);
      expect(new Set(returns).size).toBeLessThan(returns.length);
      const snapshots = await prisma.equitySnapshot.findMany({ where: { date: day(LAST) } });
      for (const row of board.rows) {
        const stat = stats.find((s) => s.competitor.slug === row.competitor.slug)!;
        const snapshot = snapshots.find((s) => s.competitorId === stat.competitorId)!;
        expect(row, row.competitor.slug).toMatchObject({
          equityCents: Number(snapshot.equityCents),
          returnBps: stat.returnBps,
          percentileBps: stat.percentileBps,
          excessEqualWeightBps: stat.excessEqualWeightBps,
          excessCdiBps: stat.excessCdiBps,
          maxDrawdownBps: stat.maxDrawdownBps,
          winRateBps: stat.winRateBps,
          sells: stat.sells,
          winningSells: stat.winningSells,
          trades: stat.trades,
        });
      }
      // o provedor e o ID do modelo fixados, só dos modelos
      const momentum = board.rows.find((r) => r.competitor.slug === 'fake-momentum')!;
      expect(momentum.competitor).toMatchObject({ provider: 'fake', modelId: 'fake/momentum' });
      expect(board.rows.find((r) => r.competitor.slug === 'cdi')!.competitor).toMatchObject({
        provider: null,
        modelId: null,
      });
      // o custo de LLM acumulado: 3 decisões de 1,5 dólar; os outros, zero
      expect(momentum.llmCostMicroUsd).toBe(4_500_000);
      expect(board.rows.filter((r) => r.llmCostMicroUsd > 0)).toHaveLength(1);
    });

    it('o empate no retorno desempata pela ordem do elenco, não pela ordem das linhas do banco', async () => {
      // o fake-hold e o CDI rendem igual; com o CDI antes no elenco, ele passa à frente
      const hold = await prisma.competitor.findFirstOrThrow({ where: { slug: 'fake-hold' } });
      const cdi = await prisma.competitor.findFirstOrThrow({ where: { slug: 'cdi' } });
      await prisma.competitor.update({ where: { id: hold.id }, data: { position: cdi.position } });
      await prisma.competitor.update({ where: { id: cdi.id }, data: { position: hold.position } });
      try {
        const board = await ok(`/api/v1/seasons/${seasonId}/leaderboard`, leaderboardSchema);
        const order = board.rows.map((r) => r.competitor.slug);
        expect(order.indexOf('cdi')).toBeLessThan(order.indexOf('fake-hold'));
      } finally {
        await prisma.competitor.update({
          where: { id: hold.id },
          data: { position: hold.position },
        });
        await prisma.competitor.update({ where: { id: cdi.id }, data: { position: cdi.position } });
      }
    });

    it('a temporada pode ser pedida pelo slug', async () => {
      const board = await ok('/api/v1/seasons/ensaio/leaderboard', leaderboardSchema);
      expect(board.season.id).toBe(seasonId);
    });

    it('o excesso é sobre o igual-peso e sobre o CDI; o CDI não tem excesso sobre si mesmo', async () => {
      const board = await ok(`/api/v1/seasons/${seasonId}/leaderboard`, leaderboardSchema);
      const cdi = board.rows.find((r) => r.competitor.slug === 'cdi')!;
      const equal = board.rows.find((r) => r.competitor.slug === 'igual-peso')!;
      expect(cdi.excessCdiBps).toBe(0);
      expect(equal.excessEqualWeightBps).toBe(0);
    });
  });

  describe('GET /seasons/:id/equity e /random-baseline', () => {
    it('a série de patrimônio de cada competidor, uma data por ponto', async () => {
      const equity = await ok(`/api/v1/seasons/${seasonId}/equity`, equitySchema);
      expect(equity.dates).toEqual([FIRST, '2026-11-04', LAST]);
      expect(equity.series).toHaveLength(8);
      const snapshots = await prisma.equitySnapshot.findMany({
        include: { competitor: true },
        orderBy: { date: 'asc' },
      });
      for (const series of equity.series) {
        const expected = snapshots
          .filter((s) => s.competitor.slug === series.competitor.slug)
          .map((s) => Number(s.equityCents));
        expect(series.equityCents, series.competitor.slug).toEqual(expected);
      }
    });

    it('os percentis 5, 25, 50, 75 e 95 das carteiras aleatórias, por pregão', async () => {
      const baseline = await ok(
        `/api/v1/seasons/${seasonId}/random-baseline`,
        randomBaselineSchema,
      );
      const rows = await prisma.randomBaseline.findMany({ orderBy: { date: 'asc' } });
      expect(baseline.rows.map((r) => r.date)).toEqual(rows.map((r) => iso(r.date)));
      expect(baseline.rows[2]).toEqual({
        date: LAST,
        equityCents: {
          p5: Number(rows[2]!.equityP5Cents),
          p25: Number(rows[2]!.equityP25Cents),
          p50: Number(rows[2]!.equityP50Cents),
          p75: Number(rows[2]!.equityP75Cents),
          p95: Number(rows[2]!.equityP95Cents),
        },
        returnBps: {
          p5: rows[2]!.returnP5Bps,
          p25: rows[2]!.returnP25Bps,
          p50: rows[2]!.returnP50Bps,
          p75: rows[2]!.returnP75Bps,
          p95: rows[2]!.returnP95Bps,
        },
      });
      for (const row of baseline.rows) {
        const p = row.equityCents;
        expect([p.p5, p.p25, p.p50, p.p75, p.p95]).toEqual(
          [p.p5, p.p25, p.p50, p.p75, p.p95].sort((a, b) => a - b),
        );
      }
    });

    it.each(['leaderboard', 'equity', 'random-baseline'])(
      '/%s: temporada que não existe é 404 e id torto é 400',
      async (route) => {
        expect((await get(`/api/v1/seasons/${newId()}/${route}`)).status).toBe(404);
        expect((await get(`/api/v1/seasons/nao-existe/${route}`)).status).toBe(404);
        for (const bad of ['Maiusculas', 'a_b', "'; DROP TABLE season; --"]) {
          const res = await get(`/api/v1/seasons/${encodeURIComponent(bad)}/${route}`);
          expect(res.status, bad).toBe(400);
          expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
        }
      },
    );
  });

  describe('GET /competitors/:slug', () => {
    it('o competidor, a carteira atual com preço médio e P&L, a série e as últimas decisões', async () => {
      const detail = await ok('/api/v1/competitors/fake-contrarian', competitorDetailSchema);
      expect(detail.competitor).toMatchObject({
        slug: 'fake-contrarian',
        type: 'MODEL',
        provider: 'fake',
        modelId: 'fake/contrarian',
      });
      expect(detail.season.slug).toBe('ensaio');
      expect(detail.stat).not.toBeNull();

      const contrarian = await prisma.competitor.findFirstOrThrow({
        where: { slug: 'fake-contrarian' },
      });
      const snapshot = await prisma.equitySnapshot.findFirstOrThrow({
        where: { competitorId: contrarian.id, date: day(LAST) },
      });
      const positions = await prisma.position.findMany({
        where: { competitorId: contrarian.id, date: day(LAST) },
      });
      expect(positions.length).toBeGreaterThan(0);
      expect(detail.portfolio).toMatchObject({
        date: LAST,
        equityCents: Number(snapshot.equityCents),
      });
      // a composição da carteira é do modelo (o Sorteio e as referências não a trazem: ADR 0033)
      expect(detail.portfolio!.holdings).toMatchObject({
        cashCents: Number(snapshot.cashCents),
        positionsValueCents: Number(snapshot.positionsValueCents),
      });
      const shown = detail.portfolio!.holdings!.positions;
      expect(shown).toHaveLength(positions.length);
      for (const view of shown) {
        const row = positions.find((p) => p.ticker === view.ticker)!;
        const cost = Number(row.costCents);
        const quantity = Number(row.quantity);
        expect(view).toEqual({
          ticker: row.ticker,
          quantity,
          costCents: cost,
          // preço médio no centavo mais próximo (o meio vai para longe do zero), em inteiros
          avgPriceCents: Number((2n * BigInt(cost) + BigInt(quantity)) / (2n * BigInt(quantity))),
          markCents: Number(row.markCents),
          valueCents: Number(row.valueCents),
          pnlCents: Number(row.valueCents) - cost,
          stale: row.stale,
        });
      }
      // maior posição primeiro
      const values = shown.map((p) => p.valueCents);
      expect(values).toEqual([...values].sort((a, b) => b - a));

      expect(detail.series.dates).toEqual([FIRST, '2026-11-04', LAST]);
      expect(detail.series.equityCents.at(-1)).toBe(Number(snapshot.equityCents));
      // as decisões mais novas primeiro, todas do competidor
      expect(detail.decisions.map((d) => d.date)).toEqual([LAST, '2026-11-04', FIRST]);
      expect(detail.decisions.every((d) => d.competitor.slug === 'fake-contrarian')).toBe(true);
    });

    it('o Sorteio e as referências não decidem: a lista de decisões é vazia', async () => {
      for (const slug of ['sorteio', 'cdi', 'bova11', 'igual-peso']) {
        const detail = await ok(`/api/v1/competitors/${slug}`, competitorDetailSchema);
        expect(detail.decisions, slug).toEqual([]);
      }
      const equal = await ok('/api/v1/competitors/igual-peso', competitorDetailSchema);
      expect(equal.competitor.type).toBe('EQUAL_WEIGHT');
      // o igual-peso tem a carteira do universo no banco, e a resposta pública não traz a composição dela (ADR 0033)
      expect(
        await prisma.position.count({
          where: { date: day(LAST), competitor: { slug: 'igual-peso' } },
        }),
      ).toBeGreaterThan(5);
      expect(equal.portfolio).toMatchObject({ date: LAST, holdings: null });
    });

    // O Sorteio e as referências mostram o patrimônio, e só: a composição (caixa, valor em ações e posições) não sai (ADR 0033).
    it('o Sorteio e as referências trazem o patrimônio do pregão e nada da composição da carteira', async () => {
      const kinds = {
        sorteio: 'RANDOM',
        cdi: 'CDI',
        bova11: 'BOVA11',
        'igual-peso': 'EQUAL_WEIGHT',
      };
      for (const [slug, type] of Object.entries(kinds)) {
        const detail = await ok(`/api/v1/competitors/${slug}`, competitorDetailSchema);
        expect(detail.competitor.type, slug).toBe(type);
        const snapshot = await prisma.equitySnapshot.findFirstOrThrow({
          where: { competitor: { slug }, date: day(LAST) },
        });
        expect(detail.portfolio, slug).toEqual({
          date: LAST,
          equityCents: Number(snapshot.equityCents),
          holdings: null,
        });
        // nenhum campo de posição na resposta inteira, em profundidade nenhuma
        expect(JSON.stringify(detail), slug).not.toMatch(
          /"(positions|cashCents|positionsValueCents|markCents|valueCents|avgPriceCents|costCents|pnlCents)"/,
        );
        // o patrimônio e o retorno seguem (indicador derivado)
        expect(detail.series.equityCents.at(-1), slug).toBe(Number(snapshot.equityCents));
        expect(detail.stat, slug).not.toBeNull();
      }
    });

    it('slug que não existe é 404; slug torto é 400; a temporada pode ser escolhida', async () => {
      expect((await get('/api/v1/competitors/nao-existe')).status).toBe(404);
      expect((await get('/api/v1/competitors/fake-momentum?season=outra')).status).toBe(404);
      expect((await get('/api/v1/competitors/Fake%20Momentum')).status).toBe(400);
      expect((await get('/api/v1/competitors/fake-momentum?extra=1')).status).toBe(400);
      const detail = await ok(
        `/api/v1/competitors/fake-momentum?season=ensaio`,
        competitorDetailSchema,
      );
      expect(detail.competitor.slug).toBe('fake-momentum');
    });
  });

  describe('GET /cycles/:date (a rota da etapa 6, agora por data)', () => {
    it('o pregão da temporada atual, igual ao do ciclo pelo ULID: uma lógica só', async () => {
      const byDate = await ok('/api/v1/cycles/2026-11-04', cycleViewSchema);
      const byId = await ok(`/api/v1/cycles/${secondCycleId}`, cycleViewSchema);
      expect(byDate).toEqual(byId);
      expect(byDate).toMatchObject({ date: '2026-11-04', status: 'CLOSED', seasonId });
      expect(byDate.prompt?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(byDate.briefing?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(byDate.decisions).toHaveLength(4);
    });

    it('?season= escolhe a temporada por slug ou ULID', async () => {
      const bySlug = await ok('/api/v1/cycles/2026-11-04?season=ensaio', cycleViewSchema);
      const byUlid = await ok(`/api/v1/cycles/2026-11-04?season=${seasonId}`, cycleViewSchema);
      expect(bySlug).toEqual(byUlid);
      expect((await get('/api/v1/cycles/2026-11-04?season=outra')).status).toBe(404);
    });

    it('data sem ciclo é 404; data que não existe no calendário ou texto torto é 400', async () => {
      expect((await get('/api/v1/cycles/2026-12-31')).status).toBe(404);
      // o ano 0000 passa no formato ISO e o Postgres o recusa (não há ano zero): sem a recusa na borda, sairia 500
      for (const bad of [
        '2026-02-30',
        '2026-13-01',
        '03-11-2026',
        'abc',
        '2026-11-04T10:00',
        '0000-01-01',
        '0000-12-31',
      ]) {
        const res = await get(`/api/v1/cycles/${encodeURIComponent(bad)}`);
        expect(res.status, bad).toBe(400);
        expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('GET /decisions', () => {
    it('o feed, do mais novo ao mais antigo, com resumo, visão de mercado e os itens públicos', async () => {
      const { rows } = await allPages('/api/v1/decisions', decisionsPageSchema, PAGE_MAX_LIMIT);
      expect(rows).toHaveLength(SESSIONS * 4);
      expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort().reverse());
      const first = rows[0]!;
      expect(first.status).toBe('DECIDED');
      expect(first.summary).toEqual(expect.any(String));
      expect(first.marketView).toMatch(/^(otimista|pessimista|neutro)$/);
      expect(first.competitor.type).toBe('MODEL');
      expect(first.items.length).toBeGreaterThan(0);
      expect(first.items[0]).toMatchObject({
        action: expect.stringMatching(/^(BUY|SELL|HOLD)$/) as string,
        ticker: expect.any(String) as string,
        rationale: expect.any(String) as string,
      });
    });

    it('a paginação por cursor entrega todas as linhas, na mesma ordem, sem repetir', async () => {
      const all = await allPages('/api/v1/decisions', decisionsPageSchema, PAGE_MAX_LIMIT);
      expect(all.pages).toBe(1);
      const paged = await allPages('/api/v1/decisions', decisionsPageSchema, 5);
      expect(paged.pages).toBe(3);
      expect(paged.rows).toEqual(all.rows);
      const one = await ok('/api/v1/decisions?limit=5', decisionsPageSchema);
      expect(one.rows).toHaveLength(5);
      expect(one.nextCursor).toEqual(expect.any(String));
      const last = await ok(
        `/api/v1/decisions?limit=5&cursor=${(await ok('/api/v1/decisions?limit=10', decisionsPageSchema)).nextCursor}`,
        decisionsPageSchema,
      );
      expect(last.rows).toHaveLength(2);
      expect(last.nextCursor).toBeNull();
    });

    it('filtra por ação: BUY e SELL pedem um item válido daquela ação; HOLD, a decisão que só segurou', async () => {
      const all = (await allPages('/api/v1/decisions', decisionsPageSchema, PAGE_MAX_LIMIT)).rows;
      const stance = (row: (typeof all)[number]) => ({
        buy: row.items.some((i) => i.action === 'BUY'),
        sell: row.items.some((i) => i.action === 'SELL'),
      });
      for (const action of ['BUY', 'SELL', 'HOLD'] as const) {
        const { rows } = await allPages(
          `/api/v1/decisions?action=${action}`,
          decisionsPageSchema,
          50,
        );
        const expected = all.filter((row) => {
          const { buy, sell } = stance(row);
          return action === 'BUY' ? buy : action === 'SELL' ? sell : !buy && !sell;
        });
        expect(rows, action).toEqual(expected);
      }
      expect(
        (await allPages('/api/v1/decisions?action=BUY', decisionsPageSchema, 50)).rows.length,
      ).toBeGreaterThan(0);
      expect(
        (await allPages('/api/v1/decisions?action=HOLD', decisionsPageSchema, 50)).rows.length,
      ).toBeGreaterThan(0);
    });

    it('filtra por competidor e por temporada', async () => {
      const { rows } = await allPages(
        '/api/v1/decisions?competitor=fake-hold',
        decisionsPageSchema,
        50,
      );
      expect(rows).toHaveLength(SESSIONS);
      expect(rows.every((r) => r.competitor.slug === 'fake-hold')).toBe(true);
      expect(
        (await allPages('/api/v1/decisions?competitor=nao-existe', decisionsPageSchema, 50)).rows,
      ).toEqual([]);
      const bySeason = await allPages('/api/v1/decisions?season=ensaio', decisionsPageSchema, 50);
      expect(bySeason.rows).toHaveLength(SESSIONS * 4);
      expect((await get('/api/v1/decisions?season=outra')).status).toBe(404);
    });

    it('o HOLD forçado aparece com o motivo, e o item descartado só com a posição e o motivo', async () => {
      const hold = await prisma.decision.findFirstOrThrow({
        where: { competitor: { slug: 'fake-hold' }, cycle: { date: day(LAST) } },
      });
      await prisma.decisionItem.deleteMany({ where: { decisionId: hold.id } });
      await prisma.decision.update({
        where: { id: hold.id },
        data: { status: 'FORCED_HOLD', holdReason: 'prazo', marketView: null, summary: null },
      });
      const sell = await prisma.decision.findFirstOrThrow({
        where: { competitor: { slug: 'fake-momentum' }, cycle: { date: day(LAST) } },
      });
      await prisma.decisionItem.create({
        data: {
          id: newId(),
          decisionId: sell.id,
          position: 99,
          action: 'BUY',
          ticker: 'XPTO3',
          percent: 10,
          dropped: true,
          dropReason: 'not_in_universe',
        },
      });
      const { rows } = await allPages('/api/v1/decisions', decisionsPageSchema, 50);
      const forced = rows.find((r) => r.competitor.slug === 'fake-hold' && r.date === LAST)!;
      expect(forced).toMatchObject({
        status: 'FORCED_HOLD',
        holdReason: 'prazo',
        summary: null,
        marketView: null,
        items: [],
      });
      const dropped = rows.find((r) => r.competitor.slug === 'fake-momentum' && r.date === LAST)!;
      expect(dropped.dropped).toContainEqual({ position: 99, reason: 'not_in_universe' });
      expect(JSON.stringify(dropped)).not.toContain('XPTO3');
      // o HOLD forçado conta como "só segurou"
      const holds = await allPages('/api/v1/decisions?action=HOLD', decisionsPageSchema, 50);
      expect(holds.rows.some((r) => r.status === 'FORCED_HOLD')).toBe(true);
    });

    it('o item descartado não conta no filtro: a decisão cujo único BUY foi descartado só segurou', async () => {
      const hold = await prisma.decision.findFirstOrThrow({
        where: { competitor: { slug: 'fake-hold' }, cycle: { date: day(FIRST) } },
      });
      await prisma.decisionItem.create({
        data: {
          id: newId(),
          decisionId: hold.id,
          position: 98,
          action: 'BUY',
          ticker: 'XPTO3',
          percent: 10,
          dropped: true,
          dropReason: 'not_in_universe',
        },
      });
      const mine = (rows: Array<{ date: string; competitor: { slug: string } }>) =>
        rows.some((row) => row.date === FIRST && row.competitor.slug === 'fake-hold');
      const buys = await allPages('/api/v1/decisions?action=BUY', decisionsPageSchema, 50);
      const holds = await allPages('/api/v1/decisions?action=HOLD', decisionsPageSchema, 50);
      expect(mine(buys.rows)).toBe(false);
      expect(mine(holds.rows)).toBe(true);
    });

    it('cursor com data que o Postgres recusa (ano 0000) é 400, não 500', async () => {
      const ulid = newId();
      for (const position of [
        ['0000-01-01', ulid],
        ['0000-12-31', ulid],
      ]) {
        const cursor = Buffer.from(JSON.stringify(position)).toString('base64url');
        const res = await get(`/api/v1/decisions?cursor=${cursor}`);
        expect(res.status, JSON.stringify(position)).toBe(400);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      // e o cursor de data boa, de um pregão que não existe, só dá a página vazia
      const early = Buffer.from(JSON.stringify(['0001-01-01', ulid])).toString('base64url');
      expect((await ok(`/api/v1/decisions?cursor=${early}`, decisionsPageSchema)).rows).toEqual([]);
    });

    it('limite, ação, cursor e parâmetro torto são 400 no envelope', async () => {
      for (const query of [
        `limit=${PAGE_MAX_LIMIT + 1}`,
        'limit=0',
        'limit=abc',
        'action=buy',
        'action=COMPRA',
        'cursor=%25%25%25',
        'cursor=bm90LWpzb24',
        'cursor=eyJhIjoxfQ',
        'competitor=Com%20Espa%C3%A7o',
        'extra=1',
        'limit=1&limit=2',
      ]) {
        const res = await get(`/api/v1/decisions?${query}`);
        expect(res.status, query).toBe(400);
        expect(res.body).toMatchObject({ success: false, data: null });
        expect((res.body as { error: { code: string } }).error.code, query).toMatch(
          /^(VALIDATION_ERROR|BAD_REQUEST)$/,
        );
      }
    });
  });

  describe('GET /news', () => {
    it('título, fonte, hora, tickers e link, do mais novo ao mais antigo; nunca o trecho', async () => {
      const { rows } = await allPages('/api/v1/news', newsPageSchema, PAGE_MAX_LIMIT);
      expect(rows.length).toBe(await prisma.newsItem.count());
      const times = rows.map((r) => r.publishedAt);
      expect(times).toEqual([...times].sort().reverse());
      const sample = rows[0]!;
      expect(Object.keys(sample).sort()).toEqual(
        ['publishedAt', 'source', 'sourceName', 'tickers', 'title', 'url'].sort(),
      );
      const names = new Set(rows.map((r) => `${r.source}:${r.sourceName}`));
      expect(names).toContain('agencia-brasil:Agência Brasil');
      expect(JSON.stringify(rows)).not.toContain(MARKERS.snippet);
    });

    it('a paginação por cursor entrega todas as notícias, na mesma ordem, sem repetir', async () => {
      const all = await allPages('/api/v1/news', newsPageSchema, PAGE_MAX_LIMIT);
      const paged = await allPages('/api/v1/news', newsPageSchema, 10);
      expect(paged.pages).toBeGreaterThan(2);
      expect(paged.rows).toEqual(all.rows);
      expect(new Set(paged.rows.map((r) => r.url)).size).toBe(paged.rows.length);
    });

    it('a paginação não perde nem repete notícia publicada no mesmo instante (o id desempata)', async () => {
      const at = new Date('2026-11-10T15:00:00Z');
      const ids = Array.from({ length: 5 }, () => newId());
      await prisma.newsItem.createMany({
        data: ids.map((id, index) => ({
          id,
          urlHash: String(index).repeat(64),
          url: `https://empate.invalid/${index}`,
          source: 'infomoney',
          title: `Empate ${index}`,
          snippet: 'x',
          tickers: ['EMPA3'],
          publishedAt: at,
          firstSeenAt: at,
        })),
      });
      try {
        const { rows, pages } = await allPages('/api/v1/news?ticker=EMPA3', newsPageSchema, 2);
        expect(pages).toBe(3);
        expect(rows.map((r) => r.url).sort()).toEqual(
          ids.map((_, index) => `https://empate.invalid/${index}`),
        );
      } finally {
        await prisma.newsItem.deleteMany({ where: { id: { in: ids } } });
      }
    });

    it('cursor com data que o Postgres recusa (ano 0000) é 400, não 500', async () => {
      const ulid = newId();
      for (const position of [
        ['0000-01-01T00:00:00.000Z', ulid],
        ['0000-12-31T23:59:59.999Z', ulid],
      ]) {
        const cursor = Buffer.from(JSON.stringify(position)).toString('base64url');
        const res = await get(`/api/v1/news?cursor=${cursor}`);
        expect(res.status, JSON.stringify(position)).toBe(400);
        expect(res.headers['cache-control']).toBe('no-store');
      }
      const early = Buffer.from(JSON.stringify(['0001-01-01T00:00:00.000Z', ulid])).toString(
        'base64url',
      );
      expect((await ok(`/api/v1/news?cursor=${early}`, newsPageSchema)).rows).toEqual([]);
    });

    it('sem limite a página tem o tamanho padrão e aponta a seguinte', async () => {
      expect(await prisma.newsItem.count()).toBeGreaterThan(PAGE_DEFAULT_LIMIT);
      const page = await ok('/api/v1/news', newsPageSchema);
      expect(page.rows).toHaveLength(PAGE_DEFAULT_LIMIT);
      expect(page.nextCursor).toEqual(expect.any(String));
    });

    it('filtra por ticker', async () => {
      const withTicker = await prisma.newsItem.findMany({
        where: { tickers: { has: newsTicker } },
      });
      expect(withTicker.length).toBeGreaterThan(0);
      const { rows } = await allPages(`/api/v1/news?ticker=${newsTicker}`, newsPageSchema, 10);
      expect(rows).toHaveLength(withTicker.length);
      expect(rows.every((r) => r.tickers.includes(newsTicker))).toBe(true);
      expect((await ok('/api/v1/news?ticker=ZZZZ3', newsPageSchema)).rows).toEqual([]);
      for (const bad of ['petr4', 'PETR', "PETR4';--"]) {
        expect((await get(`/api/v1/news?ticker=${encodeURIComponent(bad)}`)).status, bad).toBe(400);
      }
    });

    describe('uma notícia fora do contrato', () => {
      afterEach(() => vi.restoreAllMocks());

      // O worker não limita quantos tickers acha num título (findTickers), e o contrato aceita 50. Sem a guarda, o schema da página inteira
      // dava 500 em /news e em /stocks/:ticker enquanto a linha estivesse entre as mais novas.
      it('(mais de 50 tickers) fica de fora da página em vez de derrubá-la, e só o id vai ao log', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const id = newId();
        const total = await prisma.newsItem.count();
        await prisma.newsItem.create({
          data: {
            id,
            urlHash: 'c'.repeat(64),
            url: 'https://exemplo.invalid/muitos-tickers',
            source: 'infomoney',
            title: 'Notícia com tickers demais',
            snippet: 'x',
            tickers: Array.from({ length: 51 }, (_, i) => `X${String(i).padStart(3, '0')}3`),
            // a mais nova de todas: abriria a primeira página
            publishedAt: new Date('2026-11-11T12:00:00Z'),
            firstSeenAt: new Date('2026-11-11T12:00:00Z'),
          },
        });
        try {
          const page = await ok(`/api/v1/news?limit=${PAGE_MAX_LIMIT}`, newsPageSchema);
          expect(page.rows.some((r) => r.url.endsWith('/muitos-tickers'))).toBe(false);
          // a página tem o tamanho certo menos a linha pulada, e as outras seguem na ordem
          expect(page.rows).toHaveLength(Math.min(PAGE_MAX_LIMIT, total + 1) - 1);
          const logged = JSON.stringify(warn.mock.calls);
          expect(logged).toContain('noticia_fora_do_contrato');
          expect(logged).toContain(id);
          expect(logged).not.toContain('tickers demais');
          // a página seguinte continua de onde a linha lida parou: nada se perde nem se repete
          const paged = await allPages('/api/v1/news', newsPageSchema, 10);
          expect(paged.rows.map((r) => r.url)).toEqual(
            page.rows.map((r) => r.url).slice(0, paged.rows.length),
          );
          expect(paged.rows).toHaveLength(total);
        } finally {
          await prisma.newsItem.delete({ where: { id } });
        }
      });
    });

    it('título e link são dado de terceiro: o HTML sai do título e o link que não deve ser servido (com senha) fica de fora', async () => {
      // o banco já recusa "<tag" no título e o link que não é http(s) (news_item_values_check, news_item_text_check): o que passa por
      // ele e a API ainda limpa é a entidade ("&lt;b&gt;") e o link com usuário e senha
      const base = {
        source: 'infomoney',
        tickers: [newsTicker],
        snippet: 'x',
        firstSeenAt: new Date('2026-11-09T12:00:00Z'),
        publishedAt: new Date('2026-11-09T12:00:00Z'),
      };
      const ids = [newId(), newId()];
      await prisma.newsItem.createMany({
        data: [
          {
            ...base,
            id: ids[0]!,
            urlHash: 'a'.repeat(64),
            url: 'https://exemplo.invalid/ok',
            title:
              'Lucro &lt;b&gt;recorde&lt;/b&gt; e dividendos &lt;script&gt;alert(1)&lt;/script&gt;',
          },
          {
            ...base,
            id: ids[1]!,
            urlHash: 'b'.repeat(64),
            url: 'https://usuario:senha@exemplo.invalid/x',
            title: 'Link com senha',
          },
        ],
      });
      try {
        const { rows } = await allPages(`/api/v1/news?ticker=${newsTicker}`, newsPageSchema, 100);
        const text = JSON.stringify(rows);
        expect(text).not.toMatch(/<[a-z/!?]/i);
        expect(text).not.toContain('usuario:senha');
        expect(text).not.toContain('Link com senha');
        const clean = rows.find((r) => r.url === 'https://exemplo.invalid/ok')!;
        // o bloco <script> sai com o conteúdo, como no worker
        expect(clean.title).toBe('Lucro recorde e dividendos');
      } finally {
        await prisma.newsItem.deleteMany({ where: { id: { in: ids } } });
      }
    });
  });

  describe('GET /stocks e /stocks/:ticker', () => {
    it('a busca por ticker ou nome devolve até 20 resultados, o ticker exato primeiro', async () => {
      const found = await ok('/api/v1/stocks?q=sina3', stockSearchSchema);
      expect(found.rows[0]).toEqual({ ticker: 'SINA3', name: 'SINTETICA A' });
      const byName = await ok('/api/v1/stocks?q=sintetica', stockSearchSchema);
      expect(byName.rows.length).toBeGreaterThan(3);
      expect(byName.rows.length).toBeLessThanOrEqual(20);
      expect(
        byName.rows.every((r) => /sintetica/i.test(r.name) || /sintetica/i.test(r.ticker)),
      ).toBe(true);
      // o ticker que começa com o texto vem antes do que só o tem no nome, e cada grupo em ordem alfabética
      const prefix = await ok('/api/v1/stocks?q=SIN', stockSearchSchema);
      const starting = prefix.rows.filter((r) => r.ticker.startsWith('SIN')).map((r) => r.ticker);
      expect(starting.length).toBeGreaterThan(3);
      expect(prefix.rows.slice(0, starting.length).map((r) => r.ticker)).toEqual(
        [...starting].sort(),
      );
      expect((await ok('/api/v1/stocks?q=zzzzzz', stockSearchSchema)).rows).toEqual([]);
    });

    it('a busca não trata % nem _ como curinga, e só acha ação (o BOVA11 é referência)', async () => {
      for (const q of ['%', '_', 'S%', '%%%', '\\']) {
        const res = await ok(`/api/v1/stocks?q=${encodeURIComponent(q)}`, stockSearchSchema);
        expect(res.rows, q).toEqual([]);
      }
      expect((await ok('/api/v1/stocks?q=BOVA11', stockSearchSchema)).rows).toEqual([]);
      expect((await get('/api/v1/stocks/BOVA11')).status).toBe(404);
    });

    it('q é obrigatório, curto, sem parâmetro a mais e sem caractere de controle', async () => {
      for (const query of [
        '',
        'q=',
        'q=%20%20',
        `q=${'x'.repeat(41)}`,
        'q=a&q=b',
        'q=a&x=1',
        // o NUL o Postgres recusa em texto: sem a recusa na borda, sairia 500
        'q=%00',
        'q=a%00b',
        'q=%01',
        'q=a%0Ab',
      ]) {
        const res = await get(`/api/v1/stocks?${query}`);
        expect(res.status, query).toBe(400);
        expect(res.headers['cache-control'], query).toBe('no-store');
      }
    });

    it('a ação: quem a tem, as decisões e as notícias com ela, sem as barras de preço', async () => {
      const detail = await ok('/api/v1/stocks/SINA3', stockDetailSchema);
      expect(detail).toMatchObject({ ticker: 'SINA3', name: 'SINTETICA A' });
      expect(detail.season?.slug).toBe('ensaio');

      // sem as barras de preço: a série é cotação bruta e só a rota interna do site a entrega (docs/API.md, seção 6; ADR 0033). A ação
      // tem barras no banco (o ensaio as semeia), e mesmo assim a resposta não as traz
      expect(
        await prisma.dailyBar.count({ where: { instrument: { ticker: 'SINA3' } } }),
      ).toBeGreaterThan(30);
      expect(Object.keys(detail).sort()).toEqual([
        'decisions',
        'holders',
        'name',
        'news',
        'season',
        'ticker',
      ]);

      expect(detail.news.every((n) => n.tickers.includes('SINA3'))).toBe(true);
    });

    it('as notícias que citam a ação, as mais novas primeiro', async () => {
      const detail = await ok(`/api/v1/stocks/${newsTicker}`, stockDetailSchema);
      expect(detail.news.length).toBeGreaterThan(0);
      expect(detail.news.length).toBeLessThanOrEqual(10);
      expect(detail.news.every((n) => n.tickers.includes(newsTicker))).toBe(true);
      const times = detail.news.map((n) => n.publishedAt);
      expect(times).toEqual([...times].sort().reverse());
    });

    it('quem tem a ação (a posição do último pregão liquidado) e as decisões sobre ela', async () => {
      const held = await prisma.position.findFirstOrThrow({
        where: { date: day(LAST), competitor: { kind: 'MODEL' } },
        include: { competitor: true },
      });
      const detail = await ok(`/api/v1/stocks/${held.ticker}`, stockDetailSchema);
      const holders = await prisma.position.findMany({
        where: { date: day(LAST), ticker: held.ticker, competitor: { kind: 'MODEL' } },
        include: { competitor: true },
      });
      expect(detail.holders.map((h) => h.competitor.slug).sort()).toEqual(
        holders.map((h) => h.competitor.slug).sort(),
      );
      expect(detail.holders.every((h) => h.competitor.type === 'MODEL')).toBe(true);
      const mine = detail.holders.find((h) => h.competitor.slug === held.competitor.slug)!;
      expect(mine).toMatchObject({
        quantity: Number(held.quantity),
        markCents: Number(held.markCents),
        valueCents: Number(held.valueCents),
        pnlCents: Number(held.valueCents) - Number(held.costCents),
        stale: held.stale,
      });
      const values = detail.holders.map((h) => h.valueCents);
      expect(values).toEqual([...values].sort((a, b) => b - a));

      const items = await prisma.decisionItem.findMany({
        where: { ticker: held.ticker, dropped: false },
      });
      expect(items.length).toBeGreaterThan(0);
      expect(detail.decisions.length).toBe(Math.min(items.length, 20));
      expect(detail.decisions.map((d) => d.date)).toEqual(
        [...detail.decisions.map((d) => d.date)].sort().reverse(),
      );
    });

    // O igual-peso segura o universo inteiro e o Sorteio e o BOVA11 também têm posições: se "quem tem a ação" os listasse, a marcação deles
    // seria o fechamento do dia de toda ação (ADR 0033). Só os modelos aparecem; a ação que só uma referência segura sai sem ninguém.
    it('quem tem a ação: só os modelos entram; a ação que só o igual-peso tem sai sem donos', async () => {
      const stocks = await prisma.instrument.findMany({
        where: { kind: 'STOCK' },
        select: { ticker: true },
      });
      let cut = 0;
      for (const { ticker } of stocks) {
        const detail = await ok(`/api/v1/stocks/${ticker}`, stockDetailSchema);
        const rows = await prisma.position.findMany({
          where: { date: day(LAST), ticker },
          select: { competitor: { select: { kind: true } } },
        });
        // o banco tem o que a resposta poderia entregar: os donos de fora são cortados e os modelos ficam
        const models = rows.filter((r) => r.competitor.kind === 'MODEL').length;
        expect(
          detail.holders.map((h) => h.competitor.type),
          ticker,
        ).toEqual(Array<string>(models).fill('MODEL'));
        cut += rows.length - models;
      }
      // o igual-peso tem o universo todo no banco: sem donos de fora o teste não provaria o corte
      expect(cut).toBeGreaterThan(5);

      // uma ação que só o igual-peso segura (como o universo, em produção, quase todo): a resposta não a mostra a ninguém
      const equalWeight = await prisma.competitor.findFirstOrThrow({
        where: { slug: 'igual-peso' },
      });
      const instrument = await prisma.instrument.create({
        data: {
          id: newId(),
          ticker: 'SOLO3',
          name: 'SO REFERENCIA',
          spec: 'ON',
          kind: 'STOCK',
          lastSeen: day(LAST),
        },
      });
      const row = await prisma.position.create({
        data: {
          id: newId(),
          seasonId,
          competitorId: equalWeight.id,
          date: day(LAST),
          ticker: 'SOLO3',
          quantity: 100n,
          costCents: 100_000n,
          markCents: 1_234n,
          valueCents: 123_400n,
          stale: false,
        },
      });
      try {
        const detail = await ok('/api/v1/stocks/SOLO3', stockDetailSchema);
        expect(detail.holders).toEqual([]);
      } finally {
        await prisma.position.delete({ where: { id: row.id } });
        await prisma.instrument.delete({ where: { id: instrument.id } });
      }
    });

    it('quem tem a ação: no empate de valor vale a ordem do elenco, e a lista não depende da ordem das linhas do banco', async () => {
      const [first, second] = await prisma.competitor.findMany({
        where: { kind: 'MODEL' },
        orderBy: { position: 'asc' },
        take: 2,
      });
      // uma ação que ninguém tem, criada só para o teste
      const instrument = await prisma.instrument.create({
        data: {
          id: newId(),
          ticker: 'EMPA3',
          name: 'EMPATE',
          spec: 'ON',
          kind: 'STOCK',
          lastSeen: day(LAST),
        },
      });
      const ticker = instrument.ticker;
      // o elenco ao contrário da ordem de criação (e do id): sem o desempate, a ordem seria a do banco
      await prisma.competitor.update({ where: { id: first!.id }, data: { position: 90 } });
      await prisma.competitor.update({ where: { id: second!.id }, data: { position: 80 } });
      const rows = [first!, second!].map((competitor) => ({
        id: newId(),
        seasonId,
        competitorId: competitor.id,
        date: day(LAST),
        ticker,
        quantity: 100n,
        costCents: 100_000n,
        markCents: 1_100n,
        valueCents: 110_000n,
        stale: false,
      }));
      await prisma.position.createMany({ data: rows });
      try {
        for (let call = 0; call < 3; call += 1) {
          const detail = await ok(`/api/v1/stocks/${ticker}`, stockDetailSchema);
          expect(detail.holders.map((h) => h.competitor.slug)).toEqual([second!.slug, first!.slug]);
        }
      } finally {
        await prisma.position.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
        await prisma.instrument.delete({ where: { id: instrument.id } });
        await prisma.competitor.update({
          where: { id: first!.id },
          data: { position: first!.position },
        });
        await prisma.competitor.update({
          where: { id: second!.id },
          data: { position: second!.position },
        });
      }
    });

    it('ação que não existe é 404 e ticker fora do formato é 400; minúsculas valem', async () => {
      expect((await get('/api/v1/stocks/ZZZZ3')).status).toBe(404);
      for (const bad of ['PETR', 'PETR444', '1ETR4', "PETR4'--", '..%2Fetc']) {
        expect((await get(`/api/v1/stocks/${bad}`)).status, bad).toBe(400);
      }
      const lower = await ok('/api/v1/stocks/sina3', stockDetailSchema);
      expect(lower.ticker).toBe('SINA3');
    });
  });

  // O que cada rota pública manda no Cache-Control, e a varredura do que nunca sai. A lista cobre as rotas do §9, os filtros e as
  // duas formas da rota do ciclo.
  const publicUrls = () => [
    '/api/v1/arena/current',
    '/api/v1/seasons',
    '/api/v1/seasons?limit=1',
    `/api/v1/seasons/${seasonId}/leaderboard`,
    '/api/v1/seasons/ensaio/equity',
    '/api/v1/seasons/ensaio/random-baseline',
    '/api/v1/competitors/fake-momentum',
    '/api/v1/competitors/fake-contrarian',
    '/api/v1/competitors/sorteio',
    '/api/v1/competitors/igual-peso',
    '/api/v1/cycles/2026-11-03',
    '/api/v1/cycles/2026-11-05',
    `/api/v1/cycles/${secondCycleId}`,
    '/api/v1/decisions',
    '/api/v1/decisions?action=BUY',
    '/api/v1/decisions?action=SELL',
    '/api/v1/decisions?action=HOLD',
    '/api/v1/decisions?competitor=fake-flaky&limit=2',
    '/api/v1/news',
    `/api/v1/news?ticker=${newsTicker}`,
    '/api/v1/stocks?q=sin',
    '/api/v1/stocks/SINA3',
    '/api/v1/stocks/MOVE3',
  ];

  describe('cache: o Cache-Control de cada rota', () => {
    it('toda GET pública bem-sucedida manda o cache público com s-maxage e stale-while-revalidate', async () => {
      for (const url of publicUrls()) {
        const res = await get(url);
        expect(res.status, url).toBe(200);
        expect(res.headers['cache-control'], url).toBe(PUBLIC_CACHE_CONTROL);
        expect(res.headers['content-type'], url).toMatch(/application\/json/);
      }
    });

    it('erro nunca é cacheado: 400 e 404 saem com no-store', async () => {
      for (const url of [
        '/api/v1/seasons/nao-existe/leaderboard',
        '/api/v1/competitors/nao-existe',
        '/api/v1/cycles/2026-12-31',
        '/api/v1/cycles/abc',
        '/api/v1/decisions?action=buy',
        '/api/v1/news?ticker=x',
        '/api/v1/stocks?q=',
        '/api/v1/stocks/ZZZZ3',
        '/api/v1/stocks/xx',
      ]) {
        const res = await get(url);
        expect(res.status, url).toBeGreaterThanOrEqual(400);
        expect(res.headers['cache-control'], url).toBe('no-store');
      }
    });

    // O Front Door guarda a resposta com a query string na chave: um parâmetro que a API ignorasse (?x=<aleatório>) seria uma entrada
    // nova no cache da borda e uma ida à origem a cada valor. Vale para toda rota da lista, inclusive as que não têm parâmetro nenhum.
    it('parâmetro desconhecido ou repetido é 400 em toda rota pública, e erro nunca é cacheado', async () => {
      const urls = publicUrls();
      expect(urls.length).toBeGreaterThanOrEqual(20);
      for (const url of urls) {
        const sep = url.includes('?') ? '&' : '?';
        for (const extra of ['x=1', 'x=a&x=b', 'x[y]=1', 'utm_source=google', 'limit=1&limit=2']) {
          const res = await get(`${url}${sep}${extra}`);
          expect(res.status, `${url}${sep}${extra}`).toBe(400);
          expect(res.headers['cache-control'], `${url}${sep}${extra}`).toBe('no-store');
          expect(res.body, `${url}${sep}${extra}`).toMatchObject({ success: false, data: null });
        }
      }
    });

    it('manda ETag e responde 304 à requisição condicional, com o mesmo Cache-Control', async () => {
      const first = await get('/api/v1/arena/current');
      const etag = first.headers.etag;
      expect(etag).toEqual(expect.any(String));
      const again = await get('/api/v1/arena/current').set('If-None-Match', String(etag));
      expect(again.status).toBe(304);
      expect(again.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    });

    it('as rotas estão no Swagger (/api/docs)', async () => {
      const res = await get('/api/docs-json');
      expect(res.status).toBe(200);
      const paths = Object.keys((res.body as { paths: Record<string, unknown> }).paths);
      for (const expected of [
        '/api/v1/arena/current',
        '/api/v1/seasons',
        '/api/v1/seasons/{id}/leaderboard',
        '/api/v1/seasons/{id}/equity',
        '/api/v1/seasons/{id}/random-baseline',
        '/api/v1/competitors/{slug}',
        '/api/v1/cycles/{id}',
        '/api/v1/decisions',
        '/api/v1/news',
        '/api/v1/stocks',
        '/api/v1/stocks/{ticker}',
      ]) {
        expect(paths, expected).toContain(expected);
      }
    });

    it('o Swagger documenta os parâmetros de cada rota (caminho e query)', async () => {
      const res = await get('/api/docs-json');
      const doc = res.body as {
        paths: Record<
          string,
          { get: { parameters?: Array<{ name: string; in: string; required?: boolean }> } }
        >;
      };
      const parameters = (path: string) =>
        (doc.paths[path]?.get.parameters ?? []).map((p) => `${p.in}:${p.name}`).sort();
      expect({
        '/api/v1/arena/current': parameters('/api/v1/arena/current'),
        '/api/v1/seasons': parameters('/api/v1/seasons'),
        '/api/v1/seasons/{id}/leaderboard': parameters('/api/v1/seasons/{id}/leaderboard'),
        '/api/v1/seasons/{id}/equity': parameters('/api/v1/seasons/{id}/equity'),
        '/api/v1/seasons/{id}/random-baseline': parameters('/api/v1/seasons/{id}/random-baseline'),
        '/api/v1/competitors/{slug}': parameters('/api/v1/competitors/{slug}'),
        '/api/v1/cycles/{id}': parameters('/api/v1/cycles/{id}'),
        '/api/v1/decisions': parameters('/api/v1/decisions'),
        '/api/v1/news': parameters('/api/v1/news'),
        '/api/v1/stocks': parameters('/api/v1/stocks'),
        '/api/v1/stocks/{ticker}': parameters('/api/v1/stocks/{ticker}'),
      }).toEqual({
        '/api/v1/arena/current': [],
        '/api/v1/seasons': ['query:cursor', 'query:limit'],
        '/api/v1/seasons/{id}/leaderboard': ['path:id'],
        '/api/v1/seasons/{id}/equity': ['path:id'],
        '/api/v1/seasons/{id}/random-baseline': ['path:id'],
        '/api/v1/competitors/{slug}': ['path:slug', 'query:season'],
        '/api/v1/cycles/{id}': ['path:id', 'query:season'],
        '/api/v1/decisions': [
          'query:action',
          'query:competitor',
          'query:cursor',
          'query:limit',
          'query:season',
        ],
        '/api/v1/news': ['query:cursor', 'query:limit', 'query:ticker'],
        '/api/v1/stocks': ['query:q'],
        '/api/v1/stocks/{ticker}': ['path:ticker'],
      });
      // só o q é obrigatório; os outros parâmetros de query são opcionais
      const required = (path: string) =>
        (doc.paths[path]!.get.parameters ?? [])
          .filter((p) => p.in === 'query' && p.required)
          .map((p) => p.name);
      expect(required('/api/v1/stocks')).toEqual(['q']);
      expect(required('/api/v1/decisions')).toEqual([]);
    });
  });

  describe('o que nunca sai: o canário da etapa 6 sobre todas as rotas públicas', () => {
    // Nem o canário, nem a frase do prompt, nem trecho de 8 palavras dele; nem os marcadores plantados nas colunas proibidas; nem
    // endereço de Blob (o do Azurite também); nem os nomes dessas colunas.
    function expectClean(where: string, text: string) {
      expect(text, `${where}: canário`).not.toContain(ENSAIO_CANARY);
      expect(
        createLeakFilter(ENSAIO_PROMPT).redact(text).leaked,
        `${where}: trecho do prompt`,
      ).toBe(false);
      for (const marker of Object.values(MARKERS)) {
        expect(text, `${where}: ${marker}`).not.toContain(marker);
      }
      for (const forbidden of [
        'blob.core.windows.net',
        'devstoreaccount1',
        '127.0.0.1:25100',
        'llm-io',
        'ensaio-briefings',
        'trecho do feed',
        'pricingUsdPerMTok',
      ]) {
        expect(text, `${where}: ${forbidden}`).not.toContain(forbidden);
      }
      for (const key of [
        'snippet',
        'uri',
        'ioUris',
        'io_uris',
        'leakFields',
        'leak_fields',
        'metaSha256',
        'meta_sha256',
        'config',
        'job_run',
        'jobRun',
      ]) {
        expect(text, `${where}: chave ${key}`).not.toMatch(new RegExp(`"${key}"\\s*:`));
      }
      expect(text, `${where}: cabeçalho de autorização`).not.toMatch(/Bearer\s+\S/i);
    }

    it('nenhuma rota pública devolve o prompt, o IO bruto, endereço de Blob, trecho de notícia, config nem dado de job', async () => {
      const urls = publicUrls();
      expect(urls.length).toBeGreaterThanOrEqual(20);
      for (const url of urls) {
        const res = await get(url);
        expect(res.status, url).toBe(200);
        expectClean(url, JSON.stringify(res.body));
        expectClean(`${url} (cabeçalhos)`, JSON.stringify(res.headers));
      }
      // as páginas inteiras também (o feed e as notícias além da primeira página)
      const feed = (await allPages('/api/v1/decisions', decisionsPageSchema, 10)).rows;
      const news = (await allPages('/api/v1/news', newsPageSchema, 10)).rows;
      expectClean('/api/v1/decisions (todas as páginas)', JSON.stringify(feed));
      expectClean('/api/v1/news (todas as páginas)', JSON.stringify(news));
    });
  });

  // A cotação bruta (a barra de preço de um papel) não sai de rota pública: a licença da brapi proíbe entregar os Dados como feed, API ou base
  // bruta (docs/API.md, seção 6; ADR 0033). O contrato (packages/contracts/src/public-quotes.spec.ts) guarda os schemas; aqui, os corpos de
  // verdade das rotas da etapa 9 sobre a temporada do ensaio, cujas ações têm barras no banco (o ensaio as semeia).
  describe('cotação bruta: nenhuma rota pública a devolve (ADR 0033)', () => {
    // nome de campo de cotação bruta, em qualquer profundidade do corpo
    const RAW_FIELD =
      /^(open|high|low|close|previousClose|prevClose|volume|bid|ask)(Cents)?$|^(bars|bova11)$/i;
    function rawFields(value: unknown, path = '$', found: string[] = []): string[] {
      if (Array.isArray(value)) {
        value.forEach((item, index) => rawFields(item, `${path}[${index}]`, found));
      } else if (value !== null && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          if (RAW_FIELD.test(key)) found.push(`${path}.${key}`);
          rawFields(item, `${path}.${key}`, found);
        }
      }
      return found;
    }

    // a lista de rotas, mais cada ação e cada competidor do ensaio (não só duas ou três)
    const everyUrl = async () => {
      const tickers = await prisma.instrument.findMany({
        where: { kind: 'STOCK' },
        select: { ticker: true },
      });
      const slugs = await prisma.competitor.findMany({ select: { slug: true } });
      return [
        ...new Set([
          ...publicUrls(),
          ...tickers.map((row) => `/api/v1/stocks/${row.ticker}`),
          ...slugs.map((row) => `/api/v1/competitors/${row.slug}`),
        ]),
      ];
    };

    it('nenhuma resposta traz barra de preço, abertura, máxima, mínima, fechamento, fechamento anterior nem o BOVA11', async () => {
      const urls = await everyUrl();
      expect(urls.length).toBeGreaterThanOrEqual(30);
      // o banco tem as barras que a rota interna entregaria: sem elas o teste não provaria nada
      expect(await prisma.dailyBar.count()).toBeGreaterThan(300);
      for (const url of urls) {
        const res = await get(url);
        expect(res.status, url).toBe(200);
        expect(rawFields(res.body), url).toEqual([]);
      }
      // as páginas inteiras do feed e das notícias também
      expect(
        rawFields((await allPages('/api/v1/decisions', decisionsPageSchema, 10)).rows),
      ).toEqual([]);
      expect(rawFields((await allPages('/api/v1/news', newsPageSchema, 10)).rows)).toEqual([]);
    });

    it('o detector pega o campo se ele voltar: a mesma varredura reprova um corpo com barras e com o BOVA11', () => {
      const withBars = { data: { bars: [{ date: '2026-11-05', closeCents: 1 }] } };
      expect(rawFields(withBars)).toEqual(['$.data.bars', '$.data.bars[0].closeCents']);
      expect(rawFields({ macro: { bova11: { previousCloseCents: 1 } } })).toEqual([
        '$.macro.bova11',
        '$.macro.bova11.previousCloseCents',
      ]);
      expect(rawFields({ markCents: 1, avgPriceCents: 2, closedAt: 'x' })).toEqual([]);
    });

    it('a lista de URLs cobre toda rota pública do controlador (rota nova sem URL aqui reprova)', () => {
      const proto = PublicController.prototype as unknown as Record<string, unknown>;
      const paths = Object.getOwnPropertyNames(proto)
        .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
        .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name] as object) as string);
      expect(paths.length).toBeGreaterThanOrEqual(10);
      for (const path of paths) {
        const pattern = new RegExp(`^/api/v1/${path.replace(/:\w+/g, '[^/?]+')}(\\?.*)?$`);
        expect(
          publicUrls().some((url) => pattern.test(url)),
          path,
        ).toBe(true);
      }
    });

    // Os papéis com preço de uma resposta: o objeto com `ticker` e um campo de preço (marcação, valor, preço médio ou custo), ou a ação com
    // donos (`holders`, cujo preço é o da própria ação).
    const PRICE_KEYS = ['markCents', 'valueCents', 'avgPriceCents', 'costCents'];
    function pricedTickers(value: unknown, found = new Set<string>()): Set<string> {
      if (Array.isArray(value)) {
        for (const item of value) pricedTickers(item, found);
      } else if (value !== null && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        const priced =
          PRICE_KEYS.some((key) => key in object) ||
          (Array.isArray(object.holders) && object.holders.length > 0);
        if (typeof object.ticker === 'string' && priced) found.add(object.ticker);
        for (const item of Object.values(object)) pricedTickers(item, found);
      }
      return found;
    }

    // O igual-peso segura o universo da semana de início até o fim (settlement/domain/simulation.ts): em produção, uns 300 papéis. Se a
    // resposta de `/competitors/igual-peso` trouxesse as posições dele, ou se `/stocks/:ticker` o listasse entre os donos, UMA chamada por
    // pregão devolveria o fechamento do universo inteiro: a série de preços de que a licença da brapi proíbe a entrega (ADR 0033). O teto
    // de uma resposta é o que um modelo pode ter na carteira (`maxPositions`).
    it('nenhuma resposta entrega o preço de mais papéis do que um modelo pode ter na carteira, e o igual-peso tem muito mais no banco', async () => {
      const season = await prisma.season.findFirstOrThrow({ where: { slug: 'ensaio' } });
      const { maxPositions } = seasonParamsSchema.parse(season.params);
      const universe = await prisma.position.count({
        where: { date: day(LAST), competitor: { slug: 'igual-peso' } },
      });
      // sem isto o teste não provaria nada: o que a resposta poderia entregar está no banco, e passa do teto de um modelo
      expect(universe).toBeGreaterThan(maxPositions);
      let most = 0;
      for (const url of await everyUrl()) {
        const tickers = pricedTickers((await get(url)).body);
        expect(tickers.size, `${url}: ${[...tickers].join(',')}`).toBeLessThanOrEqual(maxPositions);
        most = Math.max(most, tickers.size);
      }
      // e o detector enxerga o que quer enxergar: a carteira de um modelo tem preço de vários papéis
      expect(most).toBeGreaterThan(0);
      const igualPeso = {
        positions: Array.from({ length: universe }, (_, i) => ({
          ticker: `UNI${i}`,
          markCents: 1,
        })),
      };
      expect(pricedTickers(igualPeso).size).toBe(universe);
      expect(pricedTickers({ ticker: 'PETR4', holders: [{ markCents: 1 }] })).toEqual(
        new Set(['PETR4']),
      );
      expect(pricedTickers({ ticker: 'PETR4', holders: [], decisions: [] }).size).toBe(0);
    });

    // O BOVA11 compra uma vez e segura: (patrimônio − caixa) ÷ quantidade é o fechamento dele, todo pregão. Com o caixa e a quantidade na
    // resposta, a série do patrimônio devolveria a cotação do BOVA11 (medido no banco do ensaio: erro de 1 centavo por causa do CDI no caixa).
    // A resposta não traz o caixa nem a quantidade, então a conta não fecha. O patrimônio e o retorno ficam (indicador derivado).
    it('o fechamento do BOVA11 não se recupera do patrimônio: a resposta não traz o caixa nem a quantidade dele', async () => {
      const dates = [FIRST, '2026-11-04', LAST];
      const bova = await prisma.competitor.findFirstOrThrow({ where: { slug: 'bova11' } });
      const closes = await prisma.dailyBar.findMany({
        where: { instrument: { ticker: 'BOVA11' }, date: { in: dates.map(day) } },
        orderBy: { date: 'asc' },
        select: { closeCents: true },
      });
      expect(closes).toHaveLength(dates.length);

      // o ataque existe: com o que o banco tem (patrimônio, o caixa e a quantidade do último pregão), a série de patrimônio vira o fechamento
      const last = await prisma.equitySnapshot.findFirstOrThrow({
        where: { competitorId: bova.id, date: day(LAST) },
      });
      const quantity = (
        await prisma.position.findFirstOrThrow({
          where: { competitorId: bova.id, date: day(LAST), ticker: 'BOVA11' },
        })
      ).quantity;
      const equity = (
        await prisma.equitySnapshot.findMany({
          where: { competitorId: bova.id, date: { in: dates.map(day) } },
          orderBy: { date: 'asc' },
          select: { equityCents: true },
        })
      ).map((row) => row.equityCents);
      const recovered = equity.map((value) =>
        Math.round(Number(value - last.cashCents) / Number(quantity)),
      );
      recovered.forEach((value, i) => {
        expect(Math.abs(value - Number(closes[i]!.closeCents)), dates[i]).toBeLessThanOrEqual(1);
      });

      // a resposta pública do BOVA11: o patrimônio por pregão, e nem o caixa nem a quantidade para a conta (nem a ação, que é referência)
      const detail = await ok('/api/v1/competitors/bova11', competitorDetailSchema);
      expect(detail.series.equityCents).toEqual(equity.map(Number));
      expect(detail.portfolio!.holdings).toBeNull();
      expect(JSON.stringify(detail)).not.toMatch(/"(quantity|cashCents|positions)"/);
      expect((await get('/api/v1/stocks/BOVA11')).status).toBe(404);
    });

    // O que fica é o registro da arena (docs/API.md, seção 6): a posição de um MODELO, com a marcação, o valor e o P&L. A marcação não
    // esconde nada que o valor não mostre: valor é quantidade × marcação, exato.
    it('os registros da arena ficam: marcação, valor, preço médio e P&L das posições do modelo, e a marcação é valor ÷ quantidade', async () => {
      const competitor = await ok('/api/v1/competitors/fake-momentum', competitorDetailSchema);
      const positions = competitor.portfolio!.holdings!.positions;
      expect(positions.length).toBeGreaterThan(0);
      for (const position of positions) {
        expect(Object.keys(position).sort(), position.ticker).toEqual(
          [
            'avgPriceCents',
            'costCents',
            'markCents',
            'pnlCents',
            'quantity',
            'stale',
            'ticker',
            'valueCents',
          ].sort(),
        );
        expect(position.valueCents, position.ticker).toBe(position.quantity * position.markCents);
        expect(position.pnlCents, position.ticker).toBe(position.valueCents - position.costCents);
      }
      const held = positions[0]!;
      const stock = await ok(`/api/v1/stocks/${held.ticker}`, stockDetailSchema);
      const holder = stock.holders.find((row) => row.competitor.slug === 'fake-momentum');
      expect(holder).toMatchObject({ markCents: held.markCents, valueCents: held.valueCents });
    });
  });

  describe('sem dados', () => {
    // o último: esvazia o banco para ver o que as rotas respondem antes da primeira temporada
    it('antes de qualquer temporada: o arena/current responde vazio e as listas, sem linhas', async () => {
      await truncateAll(prisma);
      const current = await ok('/api/v1/arena/current', arenaCurrentSchema);
      expect(current).toEqual({
        season: null,
        lastCycle: null,
        nextCycle: null,
        macro: { cdi: null, selic: null, ipcaMonth: null, ipca12m: null, usd: null },
        top: [],
      });
      expect((await ok('/api/v1/seasons', seasonsPageSchema)).rows).toEqual([]);
      expect((await ok('/api/v1/decisions', decisionsPageSchema)).rows).toEqual([]);
      expect((await ok('/api/v1/news', newsPageSchema)).rows).toEqual([]);
      expect((await ok('/api/v1/stocks?q=sin', stockSearchSchema)).rows).toEqual([]);
      expect((await get('/api/v1/competitors/fake-momentum')).status).toBe(404);
      expect((await get('/api/v1/cycles/2026-11-03')).status).toBe(404);
      expect((await get('/api/v1/stocks/SINA3')).status).toBe(404);
    });
  });
});
