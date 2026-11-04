import { seasonFileSchema } from '@alvesting/contracts';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { seasonFile } from '../testing/arena.fixture.js';
import { ArenaRepository } from '../infrastructure/arena.repository.js';
import { CycleCloser, SWEEP_GRACE_MS } from './cycle-closer.js';

// um ponto de dados das métricas em memória, só com o que os testes leem
type Point = { attributes: Record<string, unknown>; value: unknown };

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const DEADLINE = new Date('2026-11-03T12:30:00Z');

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('CycleCloser (a varredura do ciclo vencido)'),
  () => {
    let prisma: PrismaService;
    let repo: ArenaRepository;
    let closer: CycleCloser;

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      repo = new ArenaRepository(prisma);
      closer = new CycleCloser(repo);
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
      await prisma.onModuleDestroy();
    });

    async function openCycle() {
      const seasonId = await repo.createSeason(seasonFileSchema.parse(seasonFile()));
      const b = await prisma.briefing.create({
        data: { id: newId(), date: day('2026-11-03'), sha256: 'a'.repeat(64), uri: 'x', bytes: 1 },
      });
      const pv = await repo.ensurePromptVersion('0123456789abcdef0123456789abcdef');
      const { cycle } = await repo.upsertCycle({
        seasonId,
        date: '2026-11-03',
        decisionAt: new Date('2026-11-03T11:00:00Z'),
        deadlineAt: DEADLINE,
        state: { status: 'OPEN', briefingId: b.id, promptVersionId: pv.id },
      });
      return { seasonId, cycle, models: await repo.modelCompetitors(seasonId) };
    }

    const afterGrace = new Date(DEADLINE.getTime() + SWEEP_GRACE_MS);

    it('depois do prazo e da folga, grava HOLD "sem_resposta" para quem não tem decisão e fecha o ciclo', async () => {
      const { cycle, models } = await openCycle();
      await prisma.decision.create({
        data: {
          id: newId(),
          cycleId: cycle.id,
          competitorId: models[0]!.id,
          status: 'DECIDED',
          marketView: 'neutro',
          summary: 'Já decidiu.',
        },
      });

      await expect(closer.closeOverdue(afterGrace)).resolves.toBe(1);

      const rows = await prisma.decision.findMany({
        where: { cycleId: cycle.id },
        orderBy: { competitorId: 'asc' },
      });
      expect(rows).toHaveLength(3);
      const forced = rows.filter((r) => r.status === 'FORCED_HOLD');
      expect(forced).toHaveLength(2);
      expect(forced.every((r) => r.holdReason === 'sem_resposta' && r.summary === null)).toBe(true);
      // a decisão que existia não foi tocada
      expect(rows.find((r) => r.competitorId === models[0]!.id)).toMatchObject({
        status: 'DECIDED',
        summary: 'Já decidiu.',
      });
      expect(await repo.cycleById(cycle.id)).toMatchObject({
        status: 'CLOSED',
        closedAt: afterGrace,
      });
    });

    it('cada HOLD "sem_resposta" que a varredura grava conta em decision.invalid (a decisão que perdeu a corrida não)', async () => {
      const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
      const provider = new MeterProvider({
        readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 })],
      });
      metrics.setGlobalMeterProvider(provider);
      const { models } = await openCycle();
      expect(models).toHaveLength(3);
      await expect(closer.closeOverdue(afterGrace)).resolves.toBe(1);
      await provider.forceFlush();
      const invalid = exporter
        .getMetrics()
        .flatMap((resource) => resource.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === 'decision.invalid')
        .flatMap((metric) => metric.dataPoints as unknown as Point[]);
      expect(invalid).toHaveLength(1);
      expect(invalid[0]).toMatchObject({ value: 3, attributes: { reason: 'sem_resposta' } });
      await provider.shutdown();
    });

    it('antes do prazo mais a folga não mexe em nada (as execuções em curso e as tentativas agendadas têm a vez)', async () => {
      const { cycle } = await openCycle();
      await expect(closer.closeOverdue(DEADLINE)).resolves.toBe(0);
      await expect(closer.closeOverdue(new Date(afterGrace.getTime() - 1))).resolves.toBe(0);
      expect(await prisma.decision.count()).toBe(0);
      expect((await repo.cycleById(cycle.id))!.status).toBe('OPEN');
    });

    it('é idempotente: rodar de novo não duplica nem reabre nada', async () => {
      const { cycle } = await openCycle();
      await closer.closeOverdue(afterGrace);
      await expect(closer.closeOverdue(new Date(afterGrace.getTime() + 3_600_000))).resolves.toBe(
        0,
      );
      expect(await prisma.decision.count({ where: { cycleId: cycle.id } })).toBe(3);
    });

    it('não toca no ciclo pulado nem no fechado', async () => {
      const seasonId = await repo.createSeason(seasonFileSchema.parse(seasonFile()));
      await repo.upsertCycle({
        seasonId,
        date: '2026-11-03',
        decisionAt: new Date('2026-11-03T11:00:00Z'),
        deadlineAt: DEADLINE,
        state: {
          status: 'SKIPPED',
          reason: 'sem_briefing',
          briefingId: null,
          promptVersionId: null,
        },
      });
      await expect(closer.closeOverdue(afterGrace)).resolves.toBe(0);
      expect(await prisma.decision.count()).toBe(0);
    });

    it('a decisão que chega durante a varredura (execução duplicada) não derruba: a primeira vale', async () => {
      const { cycle, models } = await openCycle();
      // o decide gravou entre a leitura dos pendentes e a gravação do HOLD
      await repo.saveDecision({
        cycleId: cycle.id,
        competitorId: models[1]!.id,
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
        leakFields: [],
        items: [],
      });
      await expect(closer.closeOverdue(afterGrace)).resolves.toBe(1);
      const reasons = (
        await prisma.decision.findMany({ where: { competitorId: models[1]!.id } })
      ).map((d) => d.holdReason);
      expect(reasons).toEqual(['prazo']);
    });
  },
);
