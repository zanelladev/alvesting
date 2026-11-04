import { createHash } from 'node:crypto';
import { seasonFileSchema, type SeasonFile } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import type { ClientOptions } from 'openai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../common/id.js';
import { parseEnv } from '../../../config/env.js';
import { Secret } from '../../../config/secret.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { buildBriefing, type BuiltBriefing } from '../../briefing/domain/briefing.js';
import {
  BriefingArchive,
  BriefingIntegrityError,
} from '../../briefing/infrastructure/briefing.archive.js';
import { BriefingRepository } from '../../briefing/infrastructure/briefing.repository.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { JobBusyError, JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { forcedHold } from '../domain/decision-record.js';
import { LEAK_WARNING, createLeakFilter } from '../domain/leak-filter.js';
import { ArenaRepository } from '../infrastructure/arena.repository.js';
import { LlmCallError, LlmConfigError, LlmGateway } from '../infrastructure/llm-gateway.js';
import { LlmIoArchive } from '../infrastructure/llm-io.archive.js';
import {
  CANARY,
  PROMPT_VERSION,
  SESSIONS,
  TEST_PROMPT,
  buyItem,
  completionResponse,
  holdItem,
  memoryBlobClient,
  modelAnswer,
  scriptedFetch,
  seasonFile,
  sellItem,
  syntheticBriefing,
  syntheticSnapshot,
} from '../testing/arena.fixture.js';
import { DecideHandler } from './decide.handler.js';
import { readInitialPortfolio, settledPortfolioReader, type ReadPortfolio } from './portfolio.js';

// um ponto de dados das métricas em memória, só com o que os testes leem
type Point = { attributes: Record<string, unknown>; value: unknown };

beforeAll(() => {
  Logger.overrideLogger(false);
});

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
// 08:05 em Brasília de terça, 03/11/2026; o prazo é 09:30 (12:30Z)
const NOW = new Date('2026-11-03T11:05:00Z');
const DEADLINE = new Date('2026-11-03T12:30:00Z');
const FIRST = { attempt: 1, lastAttempt: false };
const LAST = { attempt: 3, lastAttempt: true };

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('DecideHandler (o job por evento da decisão)'),
  () => {
    let prisma: PrismaService;
    let repo: ArenaRepository;
    const calendar = loadTradingCalendar();

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      repo = new ArenaRepository(prisma);
    }, 120_000);

    beforeEach(async () => {
      // a carteira da última liquidação (etapa 7) aponta para o elenco
      await prisma.position.deleteMany();
      await prisma.equitySnapshot.deleteMany();
      await prisma.decisionItem.deleteMany();
      await prisma.decision.deleteMany();
      await prisma.cycle.deleteMany();
      await prisma.promptVersion.deleteMany();
      await prisma.competitor.deleteMany();
      await prisma.season.deleteMany();
      await prisma.briefing.deleteMany();
      await prisma.jobRun.deleteMany();
      // o universo de outro arquivo de teste (a ordem dos arquivos muda com o cache do Vitest) tem chave para o instrumento
      await prisma.universeMember.deleteMany();
      await prisma.universeSnapshot.deleteMany();
      await prisma.dailyBar.deleteMany();
      await prisma.instrument.deleteMany();
    });

    afterAll(async () => {
      await prisma.onModuleDestroy();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    interface WorldOptions {
      season?: Partial<SeasonFile>;
      fetch?: NonNullable<ClientOptions['fetch']>;
      readPortfolio?: ReadPortfolio;
      minCallMs?: number;
      clock?: () => Date;
      env?: { PROMPT_ARENA?: Secret | undefined; PROMPT_ARENA_VERSION?: string | undefined };
      gatewayEnv?: Record<string, string>;
      // o briefing congelado do pregão (o padrão é o sintético)
      briefing?: BuiltBriefing;
    }

    async function world(options: WorldOptions = {}) {
      const blobs = memoryBlobClient();
      const archive = new BriefingArchive(blobs.client);
      const seasonId = await repo.createSeason(seasonFileSchema.parse(seasonFile(options.season)));
      await repo.startSeason(seasonId, '2026-11-03', new Date('2026-11-01T18:00:00Z'));
      const built = options.briefing ?? syntheticBriefing();
      const uri = await archive.save('2026-11-03', built.bytes, built.sha256);
      const briefing = await prisma.briefing.create({
        data: {
          id: newId(),
          date: day('2026-11-03'),
          sha256: built.sha256,
          uri,
          bytes: built.bytes.length,
        },
      });
      const pv = await repo.ensurePromptVersion(PROMPT_VERSION);
      const { cycle } = await repo.upsertCycle({
        seasonId,
        date: '2026-11-03',
        decisionAt: new Date('2026-11-03T11:00:00Z'),
        deadlineAt: DEADLINE,
        state: { status: 'OPEN', briefingId: briefing.id, promptVersionId: pv.id },
      });
      const models = await repo.modelCompetitors(seasonId);

      const gatewayEnv = parseEnv({
        DATABASE_URL: 'postgresql://alvesting:alvesting@localhost:25432/alvesting_test',
        ...options.gatewayEnv,
      });
      const makeHandler = (
        overrides: { env?: WorldOptions['env']; fetch?: WorldOptions['fetch'] } = {},
      ) =>
        new DecideHandler({
          jobs: new JobRunStore(prisma),
          repo,
          briefings: archive,
          bars: new BriefingRepository(prisma),
          calendar,
          readPortfolio: options.readPortfolio ?? readInitialPortfolio,
          gateway: new LlmGateway(
            gatewayEnv,
            (overrides.fetch ?? options.fetch)
              ? { fetch: (overrides.fetch ?? options.fetch)! }
              : {},
          ),
          io: new LlmIoArchive(blobs.client),
          env: overrides.env ??
            options.env ?? {
              PROMPT_ARENA: new Secret(TEST_PROMPT),
              PROMPT_ARENA_VERSION: PROMPT_VERSION,
            },
          clock: options.clock ?? (() => NOW),
          ...(options.minCallMs === undefined ? {} : { minCallMs: options.minCallMs }),
        });
      return {
        seasonId,
        cycle,
        models,
        blobs,
        built,
        handler: makeHandler(),
        makeHandler,
        message: (index: number) => ({
          type: 'decide' as const,
          cycleId: cycle.id,
          competitorId: models[index]!.id,
        }),
      };
    }
    type World = Awaited<ReturnType<typeof world>>;

    const decisionOf = (w: World, index: number) =>
      prisma.decision.findFirstOrThrow({
        where: { cycleId: w.cycle.id, competitorId: w.models[index]!.id },
        include: { items: { orderBy: { position: 'asc' } } },
      });
    const ioFile = (w: World, index: number, kind: 'request' | 'response' | 'meta') => {
      const prefix = `llm-io/2026-11-03/${w.cycle.id}/${w.models[index]!.id}/${kind}-`;
      const key = [...w.blobs.files.keys()].find((k) => k.startsWith(prefix));
      expect(key, `blob ${kind}`).toBeDefined();
      return w.blobs.files.get(key!)!;
    };
    const withModel = (modelId: string, slug = 'fake-a'): Partial<SeasonFile> => ({
      competitors: seasonFile().competitors.map((c) =>
        c.kind === 'MODEL' && c.slug === slug ? { ...c, modelId } : c,
      ),
    });

    describe('o caminho feliz, com o provedor fake pelo SDK', () => {
      it('grava a decisão com itens, uso, o que o provedor aplicou e o SHA-256 de cada arquivo do IO bruto', async () => {
        const w = await world();
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');

        const decision = await decisionOf(w, 0);
        expect(decision).toMatchObject({
          status: 'DECIDED',
          holdReason: null,
          costMicroUsd: 0n,
          leakFields: [],
        });
        expect(decision.marketView).toMatch(/otimista|pessimista|neutro/);
        expect(decision.summary).toContain('fake/deterministic-a');
        expect(decision.items.length).toBeGreaterThan(0);
        expect(decision.items.every((i) => !i.dropped && i.rationale)).toBe(true);
        expect(decision.usage).toMatchObject({ calls: 1 });
        expect(decision.applied).toMatchObject({
          provider: 'fake',
          requestedModel: 'fake/deterministic-a',
          model: 'fake/deterministic-a',
          costSource: 'provider',
          calls: 1,
        });

        // os hashes da entrada e da saída são os dos bytes gravados no Blob, e os URIs apontam para eles
        expect(decision.inputSha256).toBe(sha(ioFile(w, 0, 'request')));
        expect(decision.outputSha256).toBe(sha(ioFile(w, 0, 'response')));
        expect(decision.metaSha256).toBe(sha(ioFile(w, 0, 'meta')));
        const uris = decision.ioUris as Record<string, string>;
        expect(Object.keys(uris).sort()).toEqual(['meta', 'request', 'response']);
        for (const uri of Object.values(uris)) expect(uri).toContain('/llm-io/2026-11-03/');

        const job = await prisma.jobRun.findFirstOrThrow({ where: { type: 'decide' } });
        expect(job.status).toBe('SUCCEEDED');
      });

      it('registra o SHA-256 do prompt na primeira execução e não deixa o texto em lugar nenhum do IO', async () => {
        const w = await world();
        await w.handler.execute(w.message(0));
        const pv = await prisma.promptVersion.findUniqueOrThrow({
          where: { version: PROMPT_VERSION },
        });
        expect(pv.sha256).toBe(sha(TEST_PROMPT));

        const request = JSON.parse(ioFile(w, 0, 'request').toString('utf8')) as {
          prompt: { version: string; sha256: string };
          calls: Array<{ messages: Array<{ role: string; content: string }> }>;
        };
        expect(request.prompt).toEqual({ version: PROMPT_VERSION, sha256: sha(TEST_PROMPT) });
        expect(request.calls[0]!.messages[0]).toEqual({
          role: 'system',
          content: `[prompt-arena versão ${PROMPT_VERSION} sha256 ${sha(TEST_PROMPT)}]`,
        });
        // o turno do usuário leva o briefing e a carteira como blocos com o SHA-256 no marcador
        const user = request.calls[0]!.messages[1]!.content;
        expect(user).toContain(`[[BRIEFING sha256=${w.built.sha256}]]`);
        expect(user).toMatch(/\[\[CARTEIRA sha256=[0-9a-f]{64}\]\]/);
        for (const file of w.blobs.files.values()) {
          expect(file.toString('utf8')).not.toContain(CANARY);
          expect(file.toString('utf8')).not.toContain('gestor fictício');
        }
      });

      it('o ciclo fecha quando todos os competidores MODEL têm decisão', async () => {
        const w = await world();
        await w.handler.execute(w.message(0));
        await w.handler.execute(w.message(1));
        expect((await repo.cycleById(w.cycle.id))!.status).toBe('OPEN');
        await w.handler.execute(w.message(2));
        expect(await repo.cycleById(w.cycle.id)).toMatchObject({ status: 'CLOSED' });
      });

      it('é idempotente: a mesma mensagem duas vezes chama o modelo uma vez só', async () => {
        const script = scriptedFetch([modelAnswer([buyItem('PETR4')])]);
        const w = await world({ fetch: script.fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        await expect(w.handler.execute(w.message(0))).resolves.toBe('already_done');
        expect(script.calls).toHaveLength(1);
        expect(await prisma.decision.count()).toBe(1);
      });

      it('execução repetida depois de um job FAILED, com a decisão já gravada, não chama o modelo de novo', async () => {
        const script = scriptedFetch([modelAnswer([holdItem('PETR4')])]);
        const w = await world({ fetch: script.fetch });
        await w.handler.execute(w.message(0));
        await prisma.jobRun.updateMany({ data: { status: 'FAILED' } });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('already_decided');
        expect(script.calls).toHaveLength(1);
      });

      it('outra entrega ainda dona da linha: JobBusyError, sem chamar o modelo', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({ fetch: script.fetch });
        // outra entrega assumiu a linha agora (08:05) e ainda está trabalhando
        await prisma.jobRun.create({
          data: {
            id: newId(),
            queue: 'decisions',
            type: 'decide',
            idempotencyKey: `${w.cycle.id}:${w.models[0]!.id}`,
            startedAt: NOW,
          },
        });
        await expect(w.handler.execute(w.message(0))).rejects.toBeInstanceOf(JobBusyError);
        expect(script.calls).toHaveLength(0);
      });

      it('duas entregas simultâneas da mesma mensagem: uma decide, a outra recebe JobBusyError, e o modelo é chamado uma vez só', async () => {
        // o relógio do teste (NOW, em 03/11) está no futuro do banco: a linha do job_run tem de nascer com o NOW, senão as duas
        // entregas veriam a linha como velha e as duas assumiriam a mensagem
        const slow = async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          return completionResponse(modelAnswer([buyItem('PETR4')]), 0.01);
        };
        const script = scriptedFetch([slow]);
        const w = await world({ fetch: script.fetch });
        const results = await Promise.allSettled([
          w.handler.execute(w.message(0)),
          w.handler.execute(w.message(0)),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(JobBusyError);
        expect(script.calls).toHaveLength(1);
        expect(await prisma.decision.count()).toBe(1);
        expect((await prisma.jobRun.findFirstOrThrow()).status).toBe('SUCCEEDED');
      });

      it('execução repetida com todas as decisões já gravadas e o ciclo ainda aberto (o processo caiu antes de fechar) fecha o ciclo', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({ fetch: script.fetch });
        for (const model of w.models) {
          await repo.saveDecision(forcedHold(w.cycle.id, model.id, 'falha'));
        }
        expect((await repo.cycleById(w.cycle.id))!.status).toBe('OPEN');
        await expect(w.handler.execute(w.message(0))).resolves.toBe('already_decided');
        expect(await repo.cycleById(w.cycle.id)).toMatchObject({ status: 'CLOSED' });
        expect(script.calls).toHaveLength(0);
      });

      it('outra execução gravou a decisão primeiro (a trava venceu com a dona viva): a desta não vale, e o aviso diz o custo que não entrou', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const w = await world({ fetch: scriptedFetch([modelAnswer([holdItem('PETR4')])]).fetch });
        vi.spyOn(repo, 'saveDecision').mockResolvedValueOnce('exists');
        await expect(w.handler.execute(w.message(0))).resolves.toBe('already_decided');
        const lost = warn.mock.calls.find(
          ([, text]) => typeof text === 'string' && text.includes('gravou a decisão primeiro'),
        );
        expect(lost?.[0]).toMatchObject({ calls: 1, costMicroUsd: '10000' });
        // a execução termina bem: a mensagem é concluída, sem nova tentativa
        expect((await prisma.jobRun.findFirstOrThrow()).status).toBe('SUCCEEDED');
      });
    });

    describe('o prazo das 09:30', () => {
      it('depois do prazo não chama o modelo e grava HOLD "prazo"', async () => {
        const script = scriptedFetch([modelAnswer([buyItem('PETR4')])]);
        const w = await world({ fetch: script.fetch });
        await expect(
          w.handler.execute(w.message(0), FIRST, new Date('2026-11-03T12:30:01Z')),
        ).resolves.toBe('hold:prazo');
        expect(script.calls).toHaveLength(0);
        expect(await decisionOf(w, 0)).toMatchObject({
          status: 'FORCED_HOLD',
          holdReason: 'prazo',
          summary: null,
          ioUris: null,
          inputSha256: null,
        });
        expect((await prisma.jobRun.findFirstOrThrow()).status).toBe('SUCCEEDED');
      });

      it('às 09:30:00 em ponto já é prazo', async () => {
        const w = await world();
        await expect(w.handler.execute(w.message(0), FIRST, DEADLINE)).resolves.toBe('hold:prazo');
      });

      it('com menos tempo que o mínimo útil para uma chamada, também é prazo, sem chamar', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({
          fetch: script.fetch,
          clock: () => new Date('2026-11-03T12:29:55Z'),
        });
        await expect(
          w.handler.execute(w.message(0), FIRST, new Date('2026-11-03T12:29:55Z')),
        ).resolves.toBe('hold:prazo');
        expect(script.calls).toHaveLength(0);
      });

      it('o prazo chega no meio da chamada: o modelo é abortado e a decisão vira HOLD "prazo"', async () => {
        const hanging = (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        const w = await world({ fetch: hanging, minCallMs: 50, clock: () => new Date() });
        // o prazo daqui a 400 ms, no relógio de verdade
        const soon = new Date(Date.now() + 400);
        await prisma.cycle.update({
          where: { id: w.cycle.id },
          data: { decisionAt: new Date(Date.now() - 1_000), deadlineAt: soon },
        });
        await expect(w.handler.execute(w.message(0), FIRST, new Date())).resolves.toBe(
          'hold:prazo',
        );
        expect(await decisionOf(w, 0)).toMatchObject({
          status: 'FORCED_HOLD',
          holdReason: 'prazo',
        });
      });

      it('o timer da chamada dispara um instante antes das 09:30 no relógio de parede: o limite era o prazo, então é HOLD "prazo", não falha', async () => {
        const hanging = (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        // o relógio fica parado 40 ms antes do prazo: depois do abort ele ainda diz "antes das 09:30"
        const before = new Date(DEADLINE.getTime() - 40);
        const w = await world({ fetch: hanging, minCallMs: 5, clock: () => before });
        await expect(w.handler.execute(w.message(0), FIRST, before)).resolves.toBe('hold:prazo');
        expect(await decisionOf(w, 0)).toMatchObject({
          status: 'FORCED_HOLD',
          holdReason: 'prazo',
        });
      });
    });

    describe('igualdade do prompt no ciclo', () => {
      it('versão do ambiente diferente da fixada no ciclo: HOLD "prompt_divergente", sem chamar o modelo', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({
          fetch: script.fetch,
          env: { PROMPT_ARENA: new Secret(TEST_PROMPT), PROMPT_ARENA_VERSION: 'f'.repeat(32) },
        });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('hold:prompt_divergente');
        expect(script.calls).toHaveLength(0);
        expect(await decisionOf(w, 0)).toMatchObject({
          status: 'FORCED_HOLD',
          holdReason: 'prompt_divergente',
        });
        // o hash de um prompt que não é o do ciclo nem chega a ser registrado
        expect(
          (await prisma.promptVersion.findUniqueOrThrow({ where: { version: PROMPT_VERSION } }))
            .sha256,
        ).toBeNull();
      });

      it('mesma versão, texto diferente do que a primeira execução registrou: HOLD "prompt_divergente"', async () => {
        const script = scriptedFetch([modelAnswer([buyItem('PETR4')])]);
        const w = await world({ fetch: script.fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        const other = w.makeHandler({
          env: {
            PROMPT_ARENA: new Secret(`${TEST_PROMPT} (editado)`),
            PROMPT_ARENA_VERSION: PROMPT_VERSION,
          },
        });
        await expect(other.execute(w.message(1))).resolves.toBe('hold:prompt_divergente');
        expect(script.calls).toHaveLength(1); // só a primeira chamou o modelo
        expect(await decisionOf(w, 1)).toMatchObject({ holdReason: 'prompt_divergente' });
      });

      it('sem PROMPT_ARENA no ambiente falha dizendo a variável (não é HOLD: é configuração)', async () => {
        const w = await world({
          env: { PROMPT_ARENA: undefined, PROMPT_ARENA_VERSION: PROMPT_VERSION },
        });
        const error = await w.handler.execute(w.message(0)).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(LlmConfigError);
        expect((error as Error).message).toMatch(/PROMPT_ARENA/);
      });

      it('prompt sem a linha de canário (um texto de marcação): erro de configuração antes de registrar o SHA-256 e de chamar o modelo', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({
          fetch: script.fetch,
          env: {
            PROMPT_ARENA: new Secret('TODO escrever o prompt de verdade antes de semear'),
            PROMPT_ARENA_VERSION: PROMPT_VERSION,
          },
        });
        const error = await w.handler.execute(w.message(0)).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(LlmConfigError);
        expect((error as Error).message).toMatch(/canário/);
        expect((error as Error).message).not.toContain('TODO');
        expect(script.calls).toHaveLength(0);
        expect(
          (await prisma.promptVersion.findUniqueOrThrow({ where: { version: PROMPT_VERSION } }))
            .sha256,
        ).toBeNull();
        // é erro, e não HOLD "prompt_divergente": o alerta da etapa 10 tem de enxergá-lo; na última entrega vira HOLD "falha"
        await expect(w.handler.execute(w.message(0), LAST)).resolves.toBe('hold:falha');
      });
    });

    describe('o briefing do Blob contra a linha de briefing', () => {
      it('conteúdo diferente do SHA-256 da linha: erro alto, o modelo não é chamado e não há decisão', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({ fetch: script.fetch });
        const key = `briefings/2026-11-03/${w.built.sha256}.json`;
        w.blobs.files.set(key, Buffer.from('{"adulterado":true}'));
        await expect(w.handler.execute(w.message(0))).rejects.toBeInstanceOf(
          BriefingIntegrityError,
        );
        expect(script.calls).toHaveLength(0);
        expect(await prisma.decision.count()).toBe(0);
        expect(await prisma.jobRun.findFirstOrThrow()).toMatchObject({ status: 'FAILED' });
      });

      it('briefing íntegro mas de outro pregão (a data de dentro não é a do ciclo): erro alto, o modelo não é chamado', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({ fetch: script.fetch });
        // o Blob do pregão 03/11 passa a guardar o briefing do 04/11, com o SHA-256 dele também na linha: a integridade fecha
        const other = syntheticBriefing('2026-11-04');
        w.blobs.files.set(`briefings/2026-11-03/${other.sha256}.json`, Buffer.from(other.bytes));
        await prisma.briefing.updateMany({ data: { sha256: other.sha256 } });
        const error = await w.handler.execute(w.message(0)).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BriefingIntegrityError);
        expect((error as Error).message).toMatch(/2026-11-03/);
        expect(script.calls).toHaveLength(0);
        expect(await prisma.decision.count()).toBe(0);
      });

      it('na última entrega a divergência vira HOLD "falha": o fluxo nunca seguiu e o ciclo não trava', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({ fetch: script.fetch });
        w.blobs.files.delete(`briefings/2026-11-03/${w.built.sha256}.json`);
        await expect(w.handler.execute(w.message(0), LAST)).resolves.toBe('hold:falha');
        expect(script.calls).toHaveLength(0);
        expect(await decisionOf(w, 0)).toMatchObject({
          status: 'FORCED_HOLD',
          holdReason: 'falha',
        });
      });
    });

    describe('JSON inválido e o reparo único', () => {
      it('JSON inválido ganha 1 reparo, uma segunda chamada ao mesmo modelo com o erro, e o custo é a soma', async () => {
        const script = scriptedFetch(['isto não é JSON', modelAnswer([buyItem('PETR4')])]);
        const w = await world({ fetch: script.fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');

        expect(script.calls).toHaveLength(2);
        expect(script.calls[1]!.body.model).toBe(script.calls[0]!.body.model);
        const turns = script.calls[1]!.body.messages as Array<{ role: string; content: string }>;
        expect(turns.map((t) => t.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(turns[2]!.content).toBe('isto não é JSON');
        expect(turns[3]!.content).toMatch(/JSON/);

        const decision = await decisionOf(w, 0);
        expect(decision.status).toBe('DECIDED');
        expect(decision.costMicroUsd).toBe(20_000n); // 2 x US$ 0,01
        expect(decision.usage).toMatchObject({
          calls: 2,
          promptTokens: 2_000,
          completionTokens: 400,
        });
        const request = JSON.parse(ioFile(w, 0, 'request').toString('utf8')) as {
          calls: unknown[];
        };
        const response = JSON.parse(ioFile(w, 0, 'response').toString('utf8')) as {
          calls: unknown[];
        };
        expect(request.calls).toHaveLength(2);
        expect(response.calls).toHaveLength(2);
      });

      it('fora do envelope (chave a mais) também ganha o reparo, com o erro sem repetir o que o modelo escreveu', async () => {
        const script = scriptedFetch([
          JSON.stringify({
            summary: 'x',
            market_view: 'neutro',
            decisions: [],
            'chave-SEGREDO': 1,
          }),
          modelAnswer([holdItem('PETR4')]),
        ]);
        const w = await world({ fetch: script.fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        const repair = (script.calls[1]!.body.messages as Array<{ content: string }>)[3]!.content;
        expect(repair).not.toContain('SEGREDO');
      });

      it('o reparo também falha: HOLD "resposta_invalida", com o IO e o custo das duas chamadas', async () => {
        const script = scriptedFetch(['lixo 1', 'lixo 2']);
        const w = await world({ fetch: script.fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('hold:resposta_invalida');
        expect(script.calls).toHaveLength(2); // um reparo e nada além
        const decision = await decisionOf(w, 0);
        expect(decision).toMatchObject({
          status: 'FORCED_HOLD',
          holdReason: 'resposta_invalida',
          costMicroUsd: 20_000n,
        });
        expect(decision.items).toEqual([]);
        expect(decision.usage).toMatchObject({ calls: 2 });
        expect(decision.inputSha256).toBe(sha(ioFile(w, 0, 'request')));
        expect((await prisma.jobRun.findFirstOrThrow()).status).toBe('SUCCEEDED');
      });

      it('o reparo não começa sem tempo: a primeira resposta, já paga, vira HOLD "resposta_invalida" com o IO e o custo, em vez de se perder', async () => {
        // depois da primeira chamada o relógio anda 21 minutos: sobram 2 do job (menos que o mínimo do reparo)
        let elapsed = false;
        const script = scriptedFetch([
          () => {
            elapsed = true;
            return completionResponse('isto não é JSON', 0.01);
          },
        ]);
        const w = await world({
          fetch: script.fetch,
          clock: () => new Date(NOW.getTime() + (elapsed ? 21 * 60_000 : 0)),
        });
        await expect(w.handler.execute(w.message(0), FIRST, NOW)).resolves.toBe(
          'hold:resposta_invalida',
        );
        expect(script.calls).toHaveLength(1); // sem reparo
        const decision = await decisionOf(w, 0);
        expect(decision).toMatchObject({
          status: 'FORCED_HOLD',
          holdReason: 'resposta_invalida',
          costMicroUsd: 10_000n,
          usage: { calls: 1 },
        });
        expect(decision.inputSha256).toBe(sha(ioFile(w, 0, 'request')));
        expect((await prisma.jobRun.findFirstOrThrow()).status).toBe('SUCCEEDED');
      });

      it('o reparo que não cabe antes das 09:30 também guarda a primeira chamada, como HOLD "prazo"', async () => {
        // 09:28: duas horas de job pela frente, mas só 2 minutos até o prazo (menos que o mínimo do reparo)
        const late = new Date(DEADLINE.getTime() - 2 * 60_000);
        const script = scriptedFetch(['isto não é JSON']);
        const w = await world({ fetch: script.fetch, clock: () => late });
        await expect(w.handler.execute(w.message(0), FIRST, late)).resolves.toBe('hold:prazo');
        expect(script.calls).toHaveLength(1);
        expect(await decisionOf(w, 0)).toMatchObject({
          holdReason: 'prazo',
          costMicroUsd: 10_000n,
          usage: { calls: 1 },
        });
      });

      it('primeira resposta vazia (o raciocínio gastou o limite de saída): o reparo leva um texto fixo no turno do assistente, nunca uma mensagem vazia', async () => {
        const script = scriptedFetch(['', modelAnswer([holdItem('PETR4')])]);
        const w = await world({ fetch: script.fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        const messages = script.calls[1]!.body.messages as Array<{ role: string; content: string }>;
        expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(messages[2]!.content).not.toBe('');
        expect(messages[2]!.content).toMatch(/sem texto/);
      });

      it('o job sem tempo para a primeira chamada (o replicaTimeout está perto): erro, o modelo não é chamado; na última entrega, HOLD "falha"', async () => {
        const script = scriptedFetch([modelAnswer([])]);
        const w = await world({
          fetch: script.fetch,
          clock: () => new Date(NOW.getTime() + 24 * 60_000),
        });
        await expect(w.handler.execute(w.message(0), FIRST, NOW)).rejects.toThrow(
          /Sem tempo no job/,
        );
        expect(script.calls).toHaveLength(0);
        await expect(w.handler.execute(w.message(0), LAST, NOW)).resolves.toBe('hold:falha');
      });

      it('com o provedor fake, fake/invalid-json-once repara no segundo turno', async () => {
        const w = await world({ season: withModel('fake/invalid-json-once') });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        expect(await decisionOf(w, 0)).toMatchObject({ usage: { calls: 2 } });
      });

      it('com o provedor fake, fake/invalid-json-always vira HOLD "resposta_invalida"', async () => {
        const w = await world({ season: withModel('fake/invalid-json-always') });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('hold:resposta_invalida');
      });
    });

    describe('validação semântica: item inválido é descartado, com o motivo', () => {
      it('universo, carteira, ticker repetido, 5 ordens (HOLD não conta) e item fora do schema', async () => {
        const answer = modelAnswer([
          buyItem('XPTO3'), //                0 fora do universo
          sellItem('VALE3'), //               1 não está na carteira
          buyItem('PETR4'), //                2 vale
          buyItem('PETR4', 12), //            3 repetido
          buyItem('VALE3'), //                4 vale
          buyItem('ITUB4'), //                5 vale
          buyItem('BBDC4'), //                6 vale
          buyItem('WEGE3'), //                7 vale (a 5ª ordem)
          buyItem('RENT3'), //                8 além da quinta
          holdItem('ABEV3'), //               9 HOLD não conta
          { ...buyItem('SUZB3'), percent_of_equity: 99 }, // 10 fora do schema
        ]);
        const w = await world({ fetch: scriptedFetch([answer]).fetch });
        await w.handler.execute(w.message(0));

        const { items } = await decisionOf(w, 0);
        expect(items.map((i) => [i.position, i.dropped ? i.dropReason : 'ok'])).toEqual([
          [0, 'not_in_universe'],
          [1, 'not_in_portfolio'],
          [2, 'ok'],
          [3, 'duplicate_ticker'],
          [4, 'ok'],
          [5, 'ok'],
          [6, 'ok'],
          [7, 'ok'],
          [8, 'over_order_limit'],
          [9, 'ok'],
          [10, 'invalid_item'],
        ]);
        // o descartado não guarda o texto; o de schema nem ticker, e leva só o código do campo
        expect(items[0]).toMatchObject({ action: 'BUY', ticker: 'XPTO3', rationale: null });
        expect(items[10]).toMatchObject({ action: null, ticker: null, rationale: null });
        expect(items[10]!.dropDetail).toBe('percent_of_equity:too_big');
        expect(items[2]).toMatchObject({
          action: 'BUY',
          ticker: 'PETR4',
          rationale: 'Compra de PETR4.',
        });
        expect(items[2]!.percent!.toString()).toBe('10');
        // os descartados também vão no meta do IO bruto (ADR 0016)
        const meta = JSON.parse(ioFile(w, 0, 'meta').toString('utf8')) as {
          dropped: Array<{ index: number; reason: string }>;
        };
        expect(meta.dropped.map((d) => [d.index, d.reason])).toEqual([
          [0, 'not_in_universe'],
          [1, 'not_in_portfolio'],
          [3, 'duplicate_ticker'],
          [8, 'over_order_limit'],
          [10, 'invalid_item'],
        ]);
      });

      it('com posições na carteira: o SELL vale, as barras delas vão na parte própria e o BUY respeita as 10 posições', async () => {
        // WEGE3 está na carteira com 100 ações; mais 9 posições fictícias já ocupam 10 vagas no total
        const filler = Array.from({ length: 9 }, (_, i) => `POS${i + 1}F3`);
        const portfolio: ReadPortfolio = () =>
          Promise.resolve({
            cashCents: 4_000_000n,
            positions: [
              { ticker: 'WEGE3', quantity: 100n, avgPriceCents: 4_000n },
              ...filler.map((ticker) => ({ ticker, quantity: 10n, avgPriceCents: 1_000n })),
            ],
          });
        const instrument = await prisma.instrument.create({
          data: {
            id: newId(),
            ticker: 'WEGE3',
            name: 'WEG',
            spec: 'ON',
            kind: 'STOCK',
            lastSeen: day('2026-10-30'),
          },
        });
        await prisma.dailyBar.createMany({
          data: SESSIONS.map((date, i) => ({
            id: newId(),
            instrumentId: instrument.id,
            date: day(date),
            openCents: 4_000n + BigInt(i),
            highCents: 4_100n,
            lowCents: 3_900n,
            closeCents: 4_050n,
            volumeCents: 1_000_000n,
            source: 'BRAPI' as const,
          })),
        });
        const script = scriptedFetch([
          modelAnswer([sellItem('WEGE3', 100), buyItem('PETR4'), buyItem('ITUB4')]),
        ]);
        const w = await world({ fetch: script.fetch, readPortfolio: portfolio });
        await w.handler.execute(w.message(0));

        // vender WEGE3 por inteiro libera uma vaga: a primeira compra de ação nova cabe, a segunda estoura as 10 posições
        const { items } = await decisionOf(w, 0);
        expect(items.map((i) => [i.ticker, i.dropped ? i.dropReason : 'ok'])).toEqual([
          ['WEGE3', 'ok'],
          ['PETR4', 'ok'],
          ['ITUB4', 'max_positions'],
        ]);
        const user = (script.calls[0]!.body.messages as Array<{ content: string }>)[1]!.content;
        const own = JSON.parse(
          /\[\[CARTEIRA sha256=[0-9a-f]{64}\]\]\n([\s\S]*?)\n\[\[\/CARTEIRA/.exec(user)![1]!,
        ) as {
          cash_cents: number;
          positions: Array<{ ticker: string; quantity: number }>;
          bars: { by_ticker: Record<string, unknown[]> };
        };
        expect(own.cash_cents).toBe(4_000_000);
        expect(own.positions.find((p) => p.ticker === 'WEGE3')).toMatchObject({ quantity: 100 });
        expect(own.bars.by_ticker.WEGE3).toHaveLength(30); // as barras de 30 pregões da ação da carteira
        expect(Object.keys(own.bars.by_ticker)).toContain('POS1F3'); // posição sem barra no banco: lista vazia
      });

      // O mesmo caso, agora pelo caminho de verdade (etapa 7): a carteira vem do último fechamento liquidado no banco.
      it('com a carteira da última liquidação, lida do banco: o SELL vale, a parte própria traz o preço médio e as barras de 30 pregões', async () => {
        const instrument = await prisma.instrument.create({
          data: {
            id: newId(),
            ticker: 'WEGE3',
            name: 'WEG',
            spec: 'ON',
            kind: 'STOCK',
            lastSeen: day('2026-10-30'),
          },
        });
        await prisma.dailyBar.createMany({
          data: SESSIONS.map((date, i) => ({
            id: newId(),
            instrumentId: instrument.id,
            date: day(date),
            openCents: 4_000n + BigInt(i),
            highCents: 4_100n,
            lowCents: 3_900n,
            closeCents: 4_050n,
            volumeCents: 1_000_000n,
            source: 'BRAPI' as const,
          })),
        });
        const script = scriptedFetch([
          modelAnswer([sellItem('WEGE3', 100), buyItem('PETR4'), buyItem('ITUB4')]),
        ]);
        const w = await world({
          fetch: script.fetch,
          readPortfolio: settledPortfolioReader({ repo, calendar }),
        });

        // o fechamento de 30/10 (o pregão anterior a 03/11): WEGE3 com 100 ações de custo total R$ 4.000,00 (preço médio R$ 40,00),
        // mais 9 posições que ocupam as 10 vagas. 100 x 40,50 + 9 x (10 x 10,00) = R$ 4.950,00 em posições
        const competitorId = w.models[0]!.id;
        const row = { seasonId: w.seasonId, competitorId, date: day('2026-10-30') };
        await prisma.equitySnapshot.create({
          data: {
            id: newId(),
            ...row,
            cashCents: 4_000_000n,
            positionsValueCents: 495_000n,
            equityCents: 4_495_000n,
            interestCents: 0n,
          },
        });
        await prisma.position.createMany({
          data: [
            { ticker: 'WEGE3', quantity: 100n, costCents: 400_000n, markCents: 4_050n },
            ...Array.from({ length: 9 }, (_, i) => ({
              ticker: `POS${i + 1}F3`,
              quantity: 10n,
              costCents: 10_000n,
              markCents: 1_000n,
            })),
          ].map((p) => ({
            id: newId(),
            ...row,
            ...p,
            valueCents: p.quantity * p.markCents,
            stale: false,
          })),
        });

        await w.handler.execute(w.message(0));

        const { items } = await decisionOf(w, 0);
        expect(items.map((i) => [i.ticker, i.dropped ? i.dropReason : 'ok'])).toEqual([
          ['WEGE3', 'ok'],
          ['PETR4', 'ok'],
          ['ITUB4', 'max_positions'],
        ]);
        const ownOf = (call: { body: Record<string, unknown> }) =>
          JSON.parse(
            /\[\[CARTEIRA sha256=[0-9a-f]{64}\]\]\n([\s\S]*?)\n\[\[\/CARTEIRA/.exec(
              (call.body.messages as Array<{ content: string }>)[1]!.content,
            )![1]!,
          ) as {
            cash_cents: number;
            positions: Array<{ ticker: string; quantity: number; avg_price_cents: number }>;
            bars: { by_ticker: Record<string, unknown[]> };
          };
        const own = ownOf(script.calls[0]!);
        expect(own.cash_cents).toBe(4_000_000);
        expect(own.positions).toHaveLength(10);
        expect(own.positions.find((p) => p.ticker === 'WEGE3')).toMatchObject({
          quantity: 100,
          avg_price_cents: 4_000, // custo total de 400.000 centavos / 100 ações
        });
        expect(own.bars.by_ticker.WEGE3).toHaveLength(30);

        // quem ainda não tem liquidação (o segundo modelo) decide com a carteira inicial: o caixa é o capital, sem posições
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        await w.handler.execute(w.message(1));
        expect(ownOf(script.calls[1]!)).toMatchObject({ cash_cents: 10_000_000, positions: [] });
        // 03/11 é o primeiro pregão da temporada (a data de início chega ao leitor da carteira): sem aviso de liquidação atrasada
        expect(warn).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('carteira da decisão'),
        );
      });
    });

    describe('o filtro de vazamento nos textos públicos', () => {
      it('summary e rationale que repetem o prompt são trocados por um aviso, e só o nome do campo é registrado', async () => {
        const w = await world({ season: withModel('fake/echo-prompt') });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');

        const decision = await decisionOf(w, 0);
        // o ponto final do prompt fica fora do trecho (o último n-grama termina na última palavra)
        expect(decision.summary).toBe(`${LEAK_WARNING}.`);
        expect(decision.items.map((i) => i.rationale)).toEqual([
          `${LEAK_WARNING}.`,
          `${LEAK_WARNING}.`,
        ]);
        expect(decision.leakFields.sort()).toEqual([
          'decisions.0.rationale',
          'decisions.1.rationale',
          'summary',
        ]);
        // a resposta crua no Blob também passou pelo filtro
        const response = ioFile(w, 0, 'response').toString('utf8');
        expect(response).not.toContain(CANARY);
        expect(response).not.toContain('gestor fictício');
        expect(response).toContain(LEAK_WARNING);
      });

      it('quando o filtro age, o log recebe um aviso só com os nomes dos campos, nunca o texto', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const w = await world({ season: withModel('fake/echo-prompt') });
        await w.handler.execute(w.message(0));
        const call = warn.mock.calls.find(
          ([, text]) => typeof text === 'string' && text.includes('filtro de vazamento agiu'),
        );
        expect(call).toBeDefined();
        const fields = call![0] as {
          leakFields: string[];
          ioLeakPaths: { request: string[]; response: string[] };
        };
        expect(fields.leakFields.sort()).toEqual([
          'decisions.0.rationale',
          'decisions.1.rationale',
          'summary',
        ]);
        expect(fields.ioLeakPaths).toEqual({
          request: [],
          response: ['calls.0.choices.0.message.content'],
        });
        const everything = JSON.stringify(warn.mock.calls);
        expect(everything).not.toContain(CANARY);
        expect(everything).not.toContain('gestor fictício');
      });

      it('sem vazamento, o filtro não avisa nada', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const w = await world();
        await w.handler.execute(w.message(0));
        expect(
          warn.mock.calls.some(
            ([, text]) => typeof text === 'string' && text.includes('filtro de vazamento'),
          ),
        ).toBe(false);
      });

      it('o prompt que descreve o formato de saída não marca a resposta comum: o Blob guarda a resposta como o provedor a mandou', async () => {
        const format = JSON.stringify(
          {
            summary: 'até 600 caracteres',
            market_view: 'neutro',
            decisions: [buyItem('WEGE3'), sellItem('VALE3'), holdItem('ITUB4')],
          },
          null,
          2,
        );
        const withFormat = `${TEST_PROMPT}\nResponda somente com este JSON:\n${format}`;
        const answer = modelAnswer([buyItem('PETR4'), holdItem('ITUB4')]);
        // a prova de que o teste não é vazio: o n-grama sobre o JSON cru marcaria esta resposta comum
        expect(createLeakFilter(withFormat).redact(answer).leaked).toBe(true);

        const w = await world({
          fetch: scriptedFetch([answer]).fetch,
          env: { PROMPT_ARENA: new Secret(withFormat), PROMPT_ARENA_VERSION: PROMPT_VERSION },
        });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        const response = JSON.parse(ioFile(w, 0, 'response').toString('utf8')) as {
          calls: Array<{ choices: Array<{ message: { content: string } }> }>;
        };
        expect(response.calls[0]!.choices[0]!.message.content).toBe(answer);
        const meta = JSON.parse(ioFile(w, 0, 'meta').toString('utf8')) as {
          ioLeakPaths: { request: string[]; response: string[] };
        };
        expect(meta.ioLeakPaths).toEqual({ request: [], response: [] });
        expect((await decisionOf(w, 0)).leakFields).toEqual([]);
      });

      it('o modelo que devolve o prompt como texto solto na primeira resposta: o turno do assistente no reparo também sai limpo do Blob', async () => {
        // a 1ª resposta é o prompt inteiro (não é JSON, ganha o reparo); a 2ª é uma decisão válida
        const script = scriptedFetch([TEST_PROMPT, modelAnswer([holdItem('PETR4')])]);
        const w = await world({ fetch: script.fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        // o provedor recebeu o turno do assistente como o modelo o escreveu (é a conversa dele)
        expect((script.calls[1]!.body.messages as Array<{ content: string }>)[2]!.content).toBe(
          TEST_PROMPT,
        );
        // mas o Blob não guarda o prompt: nem na requisição (o turno do assistente) nem na resposta crua
        for (const kind of ['request', 'response'] as const) {
          const text = ioFile(w, 0, kind).toString('utf8');
          expect(text, kind).not.toContain(CANARY);
          expect(text, kind).not.toContain('gestor fictício');
          expect(text, kind).toContain(LEAK_WARNING);
        }
        const meta = JSON.parse(ioFile(w, 0, 'meta').toString('utf8')) as {
          ioLeakPaths: { request: string[]; response: string[] };
        };
        expect(meta.ioLeakPaths).toEqual({
          request: ['calls.1.messages.2.content'],
          response: ['calls.0.choices.0.message.content'],
        });
      });

      it('o turno do usuário só passa pelo canário: o canário que vazou para dentro do briefing (um bug a montante) não vai ao Blob', async () => {
        // um briefing cuja notícia traz o canário (um bug a montante): o provedor o recebe, mas o IO bruto não o guarda
        const snapshot = syntheticSnapshot();
        const leaking = buildBriefing({
          ...snapshot,
          news: [{ ...snapshot.news[0]!, snippet: `vazou ${CANARY} aqui` }],
        });
        const w = await world({ briefing: leaking, fetch: scriptedFetch([modelAnswer([])]).fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        const request = ioFile(w, 0, 'request').toString('utf8');
        expect(request).not.toContain(CANARY);
        expect(request).toContain(LEAK_WARNING);
        const meta = JSON.parse(ioFile(w, 0, 'meta').toString('utf8')) as {
          ioLeakPaths: { request: string[]; response: string[] };
        };
        expect(meta.ioLeakPaths).toEqual({ request: ['calls.0.messages.1.content'], response: [] });
      });

      it('NUL, bidi, HTML, link e quebra de linha no summary e no rationale: a decisão é gravada limpa, sem derrubar o dia (o Postgres recusaria o NUL)', async () => {
        const answer = JSON.stringify({
          summary:
            'Cenário\u0000 calmo\u202E <img src=x onerror=alert(1)> veja https://exemplo.com/golpe',
          market_view: 'neutro',
          decisions: [
            {
              ...holdItem('PETR4'),
              rationale: 'Mantém\u200B PETR4\r\nsem <script>alert(1)</script> fato novo.',
            },
          ],
        });
        const script = scriptedFetch([answer]);
        const w = await world({ fetch: script.fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        expect(script.calls).toHaveLength(1); // sem nova chamada paga
        const decision = await decisionOf(w, 0);
        expect(decision.summary).toBe('Cenário calmo veja [link removido]');
        expect(decision.items[0]!.rationale).toBe('Mantém PETR4 sem fato novo.');
        expect(decision.leakFields).toEqual([]);
      });

      it('o prompt partido em pedaços de 7 palavras pelos itens (injeção): o conjunto é achado e todos os textos públicos viram o aviso', async () => {
        const words = TEST_PROMPT.split(/\s+/);
        expect(words.length).toBeGreaterThanOrEqual(30);
        const slices = Array.from({ length: Math.floor(words.length / 7) }, (_, i) =>
          words.slice(i * 7, i * 7 + 7).join(' '),
        );
        const attack = JSON.stringify({
          summary: slices[0],
          market_view: 'neutro',
          decisions: slices.slice(1).map((slice, i) => ({
            ...holdItem(`HOL${String.fromCharCode(65 + i)}1`),
            rationale: slice,
          })),
        });
        const w = await world({ fetch: scriptedFetch([attack]).fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        const decision = await decisionOf(w, 0);
        expect(decision.summary).toBe(LEAK_WARNING);
        expect(decision.items.every((item) => item.rationale === LEAK_WARNING)).toBe(true);
        expect(decision.leakFields).toHaveLength(slices.length);
        // os tickers e as ações (não são texto público) ficam
        expect(decision.items.map((item) => item.action)).toEqual(
          Array(slices.length - 1).fill('HOLD'),
        );
      });
    });

    describe('DLQ vira HOLD registrado: a última entrega', () => {
      it('falha nas duas primeiras entregas (a fila reagenda) e vira HOLD "falha" na terceira, sem ir para a DLQ', async () => {
        const w = await world({ season: withModel('fake/always-fail') });
        await expect(
          w.handler.execute(w.message(0), { attempt: 1, lastAttempt: false }),
        ).rejects.toBeInstanceOf(LlmCallError);
        await expect(
          w.handler.execute(w.message(0), { attempt: 2, lastAttempt: false }),
        ).rejects.toBeInstanceOf(LlmCallError);
        expect(await prisma.decision.count()).toBe(0);

        // a última entrega: o handler NÃO lança (a mensagem é concluída, não vai para a DLQ) e a decisão fica registrada
        await expect(w.handler.execute(w.message(0), LAST)).resolves.toBe('hold:falha');
        expect(await decisionOf(w, 0)).toMatchObject({
          status: 'FORCED_HOLD',
          holdReason: 'falha',
          summary: null,
        });

        const job = await prisma.jobRun.findFirstOrThrow();
        expect(job).toMatchObject({ status: 'FAILED', attempts: 3 });
        // o erro do job é o fixo do gateway: nada do corpo da resposta do provedor
        expect(job.error).toMatch(/fake falhou: http \(HTTP 500\)/);
        expect(job.error).not.toContain('falha simulada');
      });

      it('a mensagem na DLQ não trava o ciclo: com os três competidores resolvidos o ciclo fecha', async () => {
        // os três falham sempre; fake-a e fake-b chegam à última entrega, fake-c ainda decide normalmente
        const competitors = seasonFile().competitors.map((c) =>
          c.kind === 'MODEL' && c.slug !== 'fake-c' ? { ...c, modelId: 'fake/always-fail' } : c,
        );
        const w = await world({ season: { competitors } });
        await expect(w.handler.execute(w.message(2))).resolves.toBe('decided');
        await expect(w.handler.execute(w.message(1), LAST)).resolves.toBe('hold:falha');
        expect((await repo.cycleById(w.cycle.id))!.status).toBe('OPEN');
        await expect(w.handler.execute(w.message(0), LAST)).resolves.toBe('hold:falha');
        expect(await repo.cycleById(w.cycle.id)).toMatchObject({ status: 'CLOSED' });
      });

      it('erro de configuração (chave do OpenRouter ausente) segue a mesma regra', async () => {
        const competitors = seasonFile().competitors.map((c) =>
          c.kind === 'MODEL' && c.slug === 'fake-a'
            ? { ...c, provider: 'openrouter' as const, modelId: 'anthropic/claude-opus-5.5' }
            : c,
        );
        const w = await world({ season: { competitors } });
        await expect(w.handler.execute(w.message(0), FIRST)).rejects.toThrow(/OPENROUTER_API_KEY/);
        await expect(w.handler.execute(w.message(0), LAST)).resolves.toBe('hold:falha');
      });

      it('se nem o HOLD dá para gravar na última entrega, o erro sobe e a mensagem vai para a DLQ (a varredura fecha depois)', async () => {
        const w = await world({ season: withModel('fake/always-fail') });
        vi.spyOn(repo, 'saveDecision').mockRejectedValueOnce(new Error('banco fora'));
        await expect(w.handler.execute(w.message(0), LAST)).rejects.toBeInstanceOf(LlmCallError);
        expect(await prisma.decision.count()).toBe(0);
        vi.restoreAllMocks();
      });
    });

    // A telemetria da decisão (etapa 10, plano 5.9): as métricas próprias e as linhas de log que os alertas leem. Sem o SDK ligado
    // (todo teste, o ensaio) as chamadas ao OpenTelemetry são vazias; aqui um MeterProvider em memória as recebe.
    describe('telemetria e alertas', () => {
      const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
      const provider = new MeterProvider({
        readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 })],
      });
      beforeAll(() => {
        metrics.setGlobalMeterProvider(provider);
      });
      beforeEach(() => exporter.reset());

      async function points(name: string): Promise<Point[]> {
        await provider.forceFlush();
        return exporter
          .getMetrics()
          .flatMap((resource) => resource.scopeMetrics)
          .flatMap((scope) => scope.metrics)
          .filter((metric) => metric.descriptor.name === name)
          .flatMap((metric) => metric.dataPoints as unknown as Point[]);
      }
      const valueOf = (list: Point[], attributes: Record<string, string>) =>
        list.find((p) => Object.entries(attributes).every(([k, v]) => p.attributes[k] === v))
          ?.value as number | undefined;
      const lines = (spy: { mock: { calls: unknown[][] } }, text: string) =>
        spy.mock.calls.filter(([, message]) => message === text);

      it('uma decisão com o provedor fake gera llm.tokens (entrada e saída) e llm.cost_usd, por competidor e provedor', async () => {
        const w = await world();
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        const { usage } = await decisionOf(w, 0);
        const { promptTokens, completionTokens } = usage as {
          promptTokens: number;
          completionTokens: number;
        };
        const tokens = await points('llm.tokens');
        expect(valueOf(tokens, { type: 'input', competitor: 'fake-a', provider: 'fake' })).toBe(
          promptTokens,
        );
        expect(valueOf(tokens, { type: 'output', competitor: 'fake-a', provider: 'fake' })).toBe(
          completionTokens,
        );
        expect(promptTokens).toBeGreaterThan(0);
        // o fake custa zero, mas a série existe (o painel e o alerta de custo leem as duas)
        expect(
          valueOf(await points('llm.cost_usd'), { competitor: 'fake-a', provider: 'fake' }),
        ).toBe(0);
      });

      it('o custo da decisão (bigint em micro-dólares) vira dólares na métrica', async () => {
        const w = await world({ fetch: scriptedFetch([modelAnswer([holdItem('PETR4')])]).fetch });
        await w.handler.execute(w.message(0));
        const { costMicroUsd } = await decisionOf(w, 0);
        expect(costMicroUsd).toBe(10_000n);
        expect(valueOf(await points('llm.cost_usd'), { competitor: 'fake-a' })).toBeCloseTo(
          0.01,
          9,
        );
      });

      it('resposta inválida (o reparo também falha): decision.invalid por motivo, os dois pedidos nos tokens e a linha do alerta de HOLD', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const w = await world({ season: withModel('fake/invalid-json-always') });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('hold:resposta_invalida');
        expect(
          valueOf(await points('decision.invalid'), {
            reason: 'resposta_invalida',
            competitor: 'fake-a',
            provider: 'fake',
          }),
        ).toBe(1);
        expect((await decisionOf(w, 0)).usage).toMatchObject({ calls: 2 });
        const hold = lines(warn, ALERT_LOG.holdForced);
        expect(hold).toHaveLength(1);
        expect(hold[0]![0]).toMatchObject({ reason: 'resposta_invalida' });
      });

      it('a última entrega que falha vira HOLD "falha": decision.invalid e a linha do alerta de HOLD', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        const w = await world({ season: withModel('fake/always-fail') });
        await expect(w.handler.execute(w.message(0), LAST)).resolves.toBe('hold:falha');
        expect(
          valueOf(await points('decision.invalid'), { reason: 'falha', competitor: 'fake-a' }),
        ).toBe(1);
        expect(lines(warn, ALERT_LOG.holdForced)).toHaveLength(1);
      });

      it('o prazo conta em decision.invalid, mas não entra na conta do alerta de HOLD', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const late = new Date(DEADLINE.getTime() + 1_000);
        const w = await world({ clock: () => late });
        await expect(w.handler.execute(w.message(0), FIRST, late)).resolves.toBe('hold:prazo');
        expect(
          valueOf(await points('decision.invalid'), { reason: 'prazo', competitor: 'fake-a' }),
        ).toBe(1);
        expect(lines(warn, ALERT_LOG.holdForced)).toHaveLength(0);
        // sem chamada ao modelo não há token nem custo
        expect(await points('llm.tokens')).toEqual([]);
      });

      it('o prompt divergente também conta, e também não entra na conta do alerta de HOLD', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const w = await world({
          env: { PROMPT_ARENA: new Secret(TEST_PROMPT), PROMPT_ARENA_VERSION: 'f'.repeat(32) },
        });
        await expect(w.handler.execute(w.message(1))).resolves.toBe('hold:prompt_divergente');
        expect(
          valueOf(await points('decision.invalid'), {
            reason: 'prompt_divergente',
            competitor: 'fake-b',
          }),
        ).toBe(1);
        expect(lines(warn, ALERT_LOG.holdForced)).toHaveLength(0);
      });

      it('itens descartados da resposta contam um a um em decision.invalid', async () => {
        const answer = modelAnswer([buyItem('XPTO3'), buyItem('PETR4'), sellItem('VALE3')]);
        const w = await world({ fetch: scriptedFetch([answer]).fetch });
        await expect(w.handler.execute(w.message(0))).resolves.toBe('decided');
        expect(
          valueOf(await points('decision.invalid'), {
            reason: 'item_descartado',
            competitor: 'fake-a',
          }),
        ).toBe(2);
      });

      it('a decisão que perdeu a corrida (outra execução gravou antes) não conta em llm.tokens nem em decision.invalid', async () => {
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const answer = modelAnswer([buyItem('XPTO3')]); // um item descartado, se a decisão valesse
        const w = await world({ fetch: scriptedFetch([answer]).fetch });
        vi.spyOn(repo, 'saveDecision').mockResolvedValueOnce('exists');
        await expect(w.handler.execute(w.message(0))).resolves.toBe('already_decided');
        expect(await points('llm.tokens')).toEqual([]);
        expect(await points('decision.invalid')).toEqual([]);
      });

      it('quando o filtro de vazamento age, a linha do alerta sai com o texto da constante', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const w = await world({ season: withModel('fake/echo-prompt') });
        await w.handler.execute(w.message(0));
        expect(lines(warn, ALERT_LOG.leakFilter)).toHaveLength(1);
      });

      it('nenhuma métrica leva o texto do prompt, o canário, ULID nem dado pessoal', async () => {
        const w = await world({ season: withModel('fake/echo-prompt') });
        await w.handler.execute(w.message(0));
        await w.handler.execute(w.message(1));
        await provider.forceFlush();
        const dump = JSON.stringify(exporter.getMetrics());
        expect(dump).not.toContain(CANARY);
        expect(dump).not.toContain('gestor fictício');
        expect(dump).not.toContain(w.cycle.id);
        expect(dump).not.toContain(w.models[0]!.id);
        expect(dump).not.toMatch(/@example\./);
      });
    });

    describe('mensagem que não bate com o ciclo', () => {
      it('competidor que não é MODEL (o Sorteio) não recebe decide: erro, e nada é gravado mesmo na última entrega', async () => {
        const w = await world();
        const sorteio = await prisma.competitor.findFirstOrThrow({ where: { slug: 'sorteio' } });
        const message = { type: 'decide' as const, cycleId: w.cycle.id, competitorId: sorteio.id };
        await expect(w.handler.execute(message, FIRST)).rejects.toThrow(/Competidor inválido/);
        await expect(w.handler.execute(message, LAST)).rejects.toThrow(/Competidor inválido/);
        expect(await prisma.decision.count()).toBe(0);
      });

      it('competidor de outra temporada não recebe decide neste ciclo: erro, e nada é gravado mesmo na última entrega', async () => {
        const w = await world();
        const [foreign] = await repo.modelCompetitors(
          await repo.createSeason(seasonFileSchema.parse(seasonFile({ slug: 'outra-temporada' }))),
        );
        const message = {
          type: 'decide' as const,
          cycleId: w.cycle.id,
          competitorId: foreign!.id,
        };
        await expect(w.handler.execute(message, FIRST)).rejects.toThrow(/Competidor inválido/);
        await expect(w.handler.execute(message, LAST)).rejects.toThrow(/Competidor inválido/);
        expect(await prisma.decision.count()).toBe(0);
      });

      it('ciclo que não existe falha sem gravar nada', async () => {
        const w = await world();
        await expect(
          w.handler.execute(
            { type: 'decide', cycleId: newId(), competitorId: w.models[0]!.id },
            LAST,
          ),
        ).rejects.toThrow(/Ciclo inexistente/);
      });

      it('ciclo pulado não chama modelo nenhum', async () => {
        const w = await world();
        await prisma.cycle.update({
          where: { id: w.cycle.id },
          data: { status: 'SKIPPED', skipReason: 'orcamento' },
        });
        await expect(w.handler.execute(w.message(0), FIRST)).rejects.toThrow(/pulado/);
      });
    });

    it('o handler da fila só trata mensagens decide', async () => {
      const w = await world();
      await expect(w.handler.handle({ type: 'eod', date: '2026-11-03' })).rejects.toThrow(
        /decisions/,
      );
    });
  },
);
