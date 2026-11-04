import { cycleViewSchema, envelopeSchema, seasonFileSchema } from '@alvesting/contracts';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import { configureApp } from '../../../configure-app.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { DecisionRecord } from '../domain/decision-record.js';
import { ArenaRepository } from '../infrastructure/arena.repository.js';
import { CycleViewRepository } from '../infrastructure/cycle-view.repository.js';
import { appliedFixture, seasonFile } from '../testing/arena.fixture.js';
import { CyclesController } from './cycles.controller.js';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const BLOB_URL =
  'https://stalvesting.blob.core.windows.net/llm-io/2026-11-03/segredo-do-caminho.json';

describe.skipIf(!testDatabaseUrl)(integrationTitle('GET /api/v1/cycles/:id'), () => {
  // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api (ADR 0028), com o qual a api sob teste atende as rotas
  let prisma: PrismaService;
  let apiPrisma: PrismaService;
  let repo: ArenaRepository;
  let app: INestApplication;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    prisma = await openTestDatabase(testDatabaseUrl!);
    apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
    repo = new ArenaRepository(prisma);
    const moduleRef = await Test.createTestingModule({
      controllers: [CyclesController],
      providers: [CycleViewRepository, { provide: PrismaService, useValue: prisma }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  }, 120_000);

  beforeEach(async () => {
    await prisma.decisionItem.deleteMany();
    await prisma.decision.deleteMany();
    await prisma.cycle.deleteMany();
    await prisma.promptVersion.deleteMany();
    await prisma.competitor.deleteMany();
    await prisma.season.deleteMany();
    await prisma.briefing.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await apiPrisma.onModuleDestroy();
    await prisma.onModuleDestroy();
  });

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  async function closedCycle() {
    const seasonId = await repo.createSeason(seasonFileSchema.parse(seasonFile()));
    const briefing = await prisma.briefing.create({
      data: {
        id: newId(),
        date: day('2026-11-03'),
        sha256: 'a'.repeat(64),
        uri: 'https://stalvesting.blob.core.windows.net/briefings/segredo.json',
        bytes: 10,
      },
    });
    const pv = await repo.ensurePromptVersion('0123456789abcdef0123456789abcdef');
    await repo.registerPromptSha256(pv.id, 'b'.repeat(64), new Date());
    const { cycle } = await repo.upsertCycle({
      seasonId,
      date: '2026-11-03',
      decisionAt: new Date('2026-11-03T11:00:00Z'),
      deadlineAt: new Date('2026-11-03T12:30:00Z'),
      state: { status: 'OPEN', briefingId: briefing.id, promptVersionId: pv.id },
    });
    const [a, b, c] = await repo.modelCompetitors(seasonId);
    const base: Omit<DecisionRecord, 'competitorId'> = {
      cycleId: cycle.id,
      status: 'DECIDED',
      holdReason: null,
      marketView: 'otimista',
      summary: 'Cenário positivo.',
      usage: {
        calls: 1,
        promptTokens: 100,
        completionTokens: 50,
        reasoningTokens: 10,
        totalTokens: 150,
      },
      costMicroUsd: 12_345n,
      applied: appliedFixture(),
      inputSha256: 'c'.repeat(64),
      outputSha256: 'd'.repeat(64),
      metaSha256: 'e'.repeat(64),
      ioUris: { request: BLOB_URL, response: BLOB_URL, meta: BLOB_URL },
      leakFields: [],
      items: [
        {
          position: 0,
          action: 'BUY',
          ticker: 'WEGE3',
          percent: 7.5,
          confidence: 0.7,
          rationale: 'Resultado forte.',
          dropped: false,
          dropReason: null,
          dropDetail: null,
        },
        {
          position: 1,
          action: 'BUY',
          ticker: 'XPTO3',
          percent: 10,
          confidence: null,
          rationale: null,
          dropped: true,
          dropReason: 'not_in_universe',
          dropDetail: null,
        },
        {
          position: 2,
          action: null,
          ticker: null,
          percent: null,
          confidence: null,
          rationale: null,
          dropped: true,
          dropReason: 'invalid_item',
          dropDetail: 'percent_of_equity:too_big',
        },
      ],
    };
    await repo.saveDecision({ ...base, competitorId: a!.id });
    await repo.saveDecision({
      ...base,
      competitorId: b!.id,
      status: 'FORCED_HOLD',
      holdReason: 'prazo',
      marketView: null,
      summary: null,
      usage: null,
      costMicroUsd: 0n,
      applied: null,
      inputSha256: null,
      outputSha256: null,
      metaSha256: null,
      ioUris: null,
      items: [],
    });
    await repo.saveDecision({ ...base, competitorId: c!.id, items: [] });
    await repo.closeIfComplete(cycle.id, new Date('2026-11-03T11:30:00Z'));
    return { cycleId: cycle.id, seasonId };
  }

  it('devolve o ciclo no envelope, com os horários, os hashes e as decisões na ordem do elenco', async () => {
    const { cycleId, seasonId } = await closedCycle();
    const res = await http().get(`/api/v1/cycles/${cycleId}`);

    expect(res.status).toBe(200);
    const parsed = envelopeSchema(cycleViewSchema).parse(res.body);
    expect(parsed.success).toBe(true);
    const cycle = (res.body as { data: ReturnType<typeof cycleViewSchema.parse> }).data;
    expect(cycle).toMatchObject({
      id: cycleId,
      seasonId,
      date: '2026-11-03',
      status: 'CLOSED',
      skipReason: null,
      decisionAt: '2026-11-03T11:00:00.000Z',
      deadlineAt: '2026-11-03T12:30:00.000Z',
      prompt: { version: '0123456789abcdef0123456789abcdef', sha256: 'b'.repeat(64) },
      briefing: { sha256: 'a'.repeat(64) },
    });
    expect(cycle.decisions.map((d) => d.competitor.slug)).toEqual(['fake-a', 'fake-b', 'fake-c']);
    expect(cycle.decisions[0]).toMatchObject({
      status: 'DECIDED',
      marketView: 'otimista',
      summary: 'Cenário positivo.',
      inputSha256: 'c'.repeat(64),
      outputSha256: 'd'.repeat(64),
      costMicroUsd: 12_345,
      usage: { calls: 1, totalTokens: 150 },
      applied: appliedFixture(),
      items: [
        {
          position: 0,
          action: 'BUY',
          ticker: 'WEGE3',
          percent: 7.5,
          confidence: 0.7,
          rationale: 'Resultado forte.',
        },
      ],
      dropped: [
        { position: 1, reason: 'not_in_universe' },
        { position: 2, reason: 'invalid_item' },
      ],
    });
    expect(cycle.decisions[1]).toMatchObject({
      status: 'FORCED_HOLD',
      holdReason: 'prazo',
      summary: null,
      items: [],
    });
  });

  it('nunca devolve o endereço do Blob, o IO bruto, o texto de item descartado nem a coluna meta', async () => {
    const { cycleId } = await closedCycle();
    const res = await http().get(`/api/v1/cycles/${cycleId}`);
    const text = JSON.stringify(res.body);
    for (const forbidden of [
      'blob.core.windows.net',
      'llm-io',
      'segredo-do-caminho',
      'segredo.json',
      'ioUris',
      'io_uris',
      'metaSha256',
      'e'.repeat(64),
      '"uri"',
      'PROMPT',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('ciclo pulado: sem briefing, sem prompt e sem decisões', async () => {
    const seasonId = await repo.createSeason(seasonFileSchema.parse(seasonFile()));
    const { cycle } = await repo.upsertCycle({
      seasonId,
      date: '2026-11-03',
      decisionAt: new Date('2026-11-03T11:00:00Z'),
      deadlineAt: new Date('2026-11-03T12:30:00Z'),
      state: { status: 'SKIPPED', reason: 'sem_briefing', briefingId: null, promptVersionId: null },
    });
    const res = await http().get(`/api/v1/cycles/${cycle.id}`);
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown }).data).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'sem_briefing',
      prompt: null,
      briefing: null,
      decisions: [],
    });
  });

  it('ciclo que não existe é 404 no envelope', async () => {
    const res = await http().get(`/api/v1/cycles/${newId()}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'NOT_FOUND' } });
  });

  it.each(['abc', '123', '01K8Z3Q4M9X7R2T5V6W8Y0A1B', "'; DROP TABLE cycle; --"])(
    'id que não é ULID (%s) é 400 de validação, sem tocar no banco',
    async (id) => {
      const res = await http().get(`/api/v1/cycles/${encodeURIComponent(id)}`);
      expect(res.status).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('está no Swagger (/api/docs)', async () => {
    const res = await http().get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(Object.keys((res.body as { paths: Record<string, unknown> }).paths)).toContain(
      '/api/v1/cycles/{id}',
    );
  });
});
