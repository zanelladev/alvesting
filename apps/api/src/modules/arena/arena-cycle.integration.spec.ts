import { createHash } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { cycleViewSchema, type QueueMessage, type SeasonFile } from '@alvesting/contracts';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ClientOptions } from 'openai';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../config/env.js';
import { Secret } from '../../config/secret.js';
import { configureApp } from '../../configure-app.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../../infrastructure/database/test-database.fixture.js';
import { BriefingArchive } from '../briefing/infrastructure/briefing.archive.js';
import { BriefingRepository } from '../briefing/infrastructure/briefing.repository.js';
import { loadTradingCalendar } from '../market-data/domain/trading-calendar.js';
import { handleDelivery } from '../messaging/application/handle-delivery.js';
import { JobRunStore } from '../messaging/infrastructure/job-run.store.js';
import { MessagingService } from '../messaging/infrastructure/messaging.service.js';
import { CycleCloser } from './application/cycle-closer.js';
import { CycleSchedulers } from './application/cycle-schedulers.js';
import { DecideHandler } from './application/decide.handler.js';
import { readInitialPortfolio, type ReadPortfolio } from './application/portfolio.js';
import { SeasonService } from './application/season.service.js';
import { PublicModule } from '../public/public.module.js';
import { CyclesModule } from './cycles.module.js';
import { createLeakFilter } from './domain/leak-filter.js';
import { ArenaRepository } from './infrastructure/arena.repository.js';
import { createFakeFetch } from './infrastructure/fake-llm.js';
import { LlmGateway } from './infrastructure/llm-gateway.js';
import { LlmIoArchive } from './infrastructure/llm-io.archive.js';
import {
  CANARY,
  PROMPT_VERSION,
  TEST_PROMPT,
  requestBody,
  requestUrl,
  seasonFile,
  syntheticBriefing,
} from './testing/arena.fixture.js';

// Os critérios de aceite da etapa 6, de ponta a ponta: Postgres (alvesting_test) e Azurite de verdade, o SDK da OpenAI com o
// provedor fake no lugar da rede, e nenhuma chamada a LLM nenhum.
//   1. ciclo completo: do sched-cycle à última decision, com o IO bruto no Blob e os hashes na decision
//   2. a mensagem na DLQ vira HOLD registrado
//   3. nenhuma resposta da API (nem o Blob, o banco ou o log) contém o prompt: teste de canário
const storage = process.env.STORAGE_CONNECTION_STRING;
const ready = Boolean(testDatabaseUrl && storage);
const title = ready
  ? 'ciclo da arena de ponta a ponta (Postgres + Azurite)'
  : 'ciclo da arena de ponta a ponta (Postgres + Azurite) [pulado: defina TEST_DATABASE_URL e STORAGE_CONNECTION_STRING com o Postgres e o Azurite no ar, ver .env.example]';

type Fetch = NonNullable<ClientOptions['fetch']>;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const AT_0800 = new Date('2026-11-03T11:00:05Z'); // 08:00 em Brasília, terça 03/11/2026
const SECRET_KEY = 'sk-or-chave-canario-que-nao-pode-vazar';

describe.skipIf(!ready)(title, () => {
  // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api (ADR 0028), com o qual a api sob teste atende as rotas
  let prisma: PrismaService;
  let apiPrisma: PrismaService;
  let repo: ArenaRepository;
  let blob: BlobServiceClient;
  const calendar = loadTradingCalendar();
  const createdCycles: string[] = [];

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
    repo = new ArenaRepository(prisma);
    blob = BlobServiceClient.fromConnectionString(storage!);
  }, 120_000);

  beforeEach(async () => {
    await prisma.decisionItem.deleteMany();
    await prisma.decision.deleteMany();
    await prisma.cycle.deleteMany();
    await prisma.promptVersion.deleteMany();
    await prisma.competitor.deleteMany();
    await prisma.season.deleteMany();
    await prisma.briefing.deleteMany();
    await prisma.jobRun.deleteMany();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Logger.overrideLogger(false);
  });

  afterAll(async () => {
    // não deixa o IO bruto dos testes no Azurite
    const container = blob.getContainerClient('llm-io');
    for (const cycleId of createdCycles) {
      for await (const item of container.listBlobsFlat({ prefix: `2026-11-03/${cycleId}/` })) {
        await container.deleteBlob(item.name);
      }
    }
    await apiPrisma.onModuleDestroy();
    await prisma.onModuleDestroy();
  });

  // Tudo que o ciclo imprime passa por aqui: o Nest Logger (por onde o Pino entra em produção) e o console.
  function captureLogs() {
    const lines: string[] = [];
    const show = (value: unknown): string =>
      typeof value === 'string'
        ? value
        : (JSON.stringify(value, (_key, item: unknown) =>
            typeof item === 'bigint'
              ? item.toString()
              : item instanceof Error
                ? { ...item, name: item.name, message: item.message, stack: item.stack }
                : item,
          ) ?? String(value));
    const push = (...args: unknown[]) => void lines.push(args.map(show).join(' '));
    Logger.overrideLogger({
      log: push,
      error: push,
      warn: push,
      debug: push,
      verbose: push,
      fatal: push,
    });
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(push);
    }
    return lines;
  }

  async function world(
    options: {
      season?: Partial<SeasonFile>;
      fetch?: Fetch;
      readPortfolio?: ReadPortfolio;
    } = {},
  ) {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://alvesting:alvesting@localhost:25432/alvesting_test',
      OPENROUTER_API_KEY: SECRET_KEY,
    });
    const archive = new BriefingArchive(blob);
    const seasons = new SeasonService(repo, calendar);

    // a temporada, pelo mesmo caminho do season:create e do season:start (domingo 01/11 -> terça 03/11)
    const created = await seasons.create(seasonFile(options.season));
    await seasons.start(created.id, new Date('2026-11-01T18:00:00Z'));

    // o briefing congelado, no Blob e na linha de briefing (como o freeze das 07:30 deixa)
    const built = syntheticBriefing();
    const uri = await archive.save('2026-11-03', built.bytes, built.sha256);
    await new BriefingRepository(prisma).save({
      date: '2026-11-03',
      sha256: built.sha256,
      uri,
      bytes: built.bytes.length,
    });

    const published: QueueMessage[] = [];
    const scheduler = new CycleSchedulers({
      messaging: { publish: (message) => (published.push(message), Promise.resolve()) },
      calendar,
      repo,
      env: { PROMPT_ARENA_VERSION: PROMPT_VERSION, ARENA_MONTHLY_COST_CAP_USD: '40' },
      closer: new CycleCloser(repo),
    });
    const handler = new DecideHandler({
      jobs: new JobRunStore(prisma),
      repo,
      briefings: archive,
      bars: new BriefingRepository(prisma),
      calendar,
      readPortfolio: options.readPortfolio ?? readInitialPortfolio,
      gateway: new LlmGateway(env, options.fetch ? { fetch: options.fetch } : {}),
      io: new LlmIoArchive(blob),
      env: { PROMPT_ARENA: new Secret(TEST_PROMPT), PROMPT_ARENA_VERSION: PROMPT_VERSION },
      clock: () => new Date('2026-11-03T11:05:00Z'),
    });
    const result = await scheduler.cycle(AT_0800);
    expect(result).toEqual([{ season: 'temporada-teste', result: 'published', published: 3 }]);
    const cycle = await prisma.cycle.findFirstOrThrow();
    createdCycles.push(cycle.id);
    return {
      cycleId: cycle.id,
      published,
      handler,
      scheduler,
      models: await repo.modelCompetitors(created.id),
    };
  }
  type World = Awaited<ReturnType<typeof world>>;

  const withModels = (
    patch: (slug: string) => Record<string, unknown> | undefined,
  ): Partial<SeasonFile> => ({
    competitors: seasonFile().competitors.map((c) => {
      const change = c.kind === 'MODEL' ? patch(c.slug) : undefined;
      return change ? Object.assign({}, c, change) : c;
    }),
  });

  // O que a fila faz com cada mensagem: valida, chama o handler com a entrega e decide o destino.
  const deliver = (w: World, message: QueueMessage, attempt = 1) =>
    handleDelivery('decisions', message, w.handler.handle, { attempt, lastAttempt: attempt >= 3 });

  async function blobsOf(cycleId: string): Promise<Map<string, Buffer>> {
    const container = blob.getContainerClient('llm-io');
    const out = new Map<string, Buffer>();
    for await (const item of container.listBlobsFlat({ prefix: `2026-11-03/${cycleId}/` })) {
      out.set(item.name, await container.getBlockBlobClient(item.name).downloadToBuffer());
    }
    return out;
  }

  describe('critério 1: ciclo completo com provedor fake', () => {
    it('do sched-cycle à última decision gravada, com o IO bruto no Blob e os hashes na decision', async () => {
      const w = await world();

      // o sched-cycle publicou uma decide por competidor MODEL, e só por eles
      expect(w.published.map((m) => m.type)).toEqual(['decide', 'decide', 'decide']);
      const cycle = await prisma.cycle.findUniqueOrThrow({
        where: { id: w.cycleId },
        include: { promptVersion: true },
      });
      expect(cycle.status).toBe('OPEN');
      expect(cycle.promptVersion).toMatchObject({ version: PROMPT_VERSION, sha256: null });

      // cada mensagem passa pela fila (handleDelivery) e vira uma decisão
      for (const message of w.published) {
        expect(await deliver(w, message)).toEqual({ action: 'complete' });
      }

      // todos decidiram: o ciclo fecha, e o SHA-256 do prompt ficou registrado (o texto não)
      expect(await prisma.cycle.findUniqueOrThrow({ where: { id: w.cycleId } })).toMatchObject({
        status: 'CLOSED',
      });
      expect(
        (await prisma.promptVersion.findUniqueOrThrow({ where: { version: PROMPT_VERSION } }))
          .sha256,
      ).toBe(sha(TEST_PROMPT));

      const decisions = await prisma.decision.findMany({
        where: { cycleId: w.cycleId },
        include: { items: true },
      });
      expect(decisions).toHaveLength(3);
      const blobs = await blobsOf(w.cycleId);
      expect(blobs.size).toBe(9); // request, response e meta de cada decisão
      for (const decision of decisions) {
        expect(decision.status).toBe('DECIDED');
        expect(decision.items.length).toBeGreaterThan(0);
        const prefix = `2026-11-03/${w.cycleId}/${decision.competitorId}/`;
        const file = (kind: string) =>
          [...blobs.entries()].find(([name]) => name.startsWith(`${prefix}${kind}-`))![1];
        // os hashes da decision são os dos bytes que estão no Blob (Azurite)
        expect(decision.inputSha256).toBe(sha(file('request')));
        expect(decision.outputSha256).toBe(sha(file('response')));
        expect(decision.metaSha256).toBe(sha(file('meta')));
        for (const [kind, uri] of Object.entries(decision.ioUris as Record<string, string>)) {
          expect(uri).toContain(`/llm-io/${prefix}${kind}-`);
        }
        // a requisição gravada leva a versão e o SHA-256 do prompt no lugar do texto
        const recorded = JSON.parse(file('request').toString('utf8')) as {
          calls: Array<{ messages: Array<{ content: string }> }>;
        };
        expect(recorded.calls[0]!.messages[0]!.content).toBe(
          `[prompt-arena versão ${PROMPT_VERSION} sha256 ${sha(TEST_PROMPT)}]`,
        );
      }
    });

    it('rodar o ciclo e as decisões de novo não duplica nada (idempotência de ponta a ponta)', async () => {
      const w = await world();
      for (const message of w.published) await deliver(w, message);
      // o job tentou de novo: com o ciclo já fechado não publica nada outra vez
      expect(await w.scheduler.cycle(new Date(AT_0800.getTime() + 60_000))).toEqual([
        { season: 'temporada-teste', result: 'already_closed' },
      ]);
      expect(w.published).toHaveLength(3);
      // a fila entregou as mesmas mensagens de novo (duplicata do Basic): nada muda
      for (const message of w.published) {
        expect(await deliver(w, message)).toEqual({ action: 'complete' });
      }
      expect(await prisma.cycle.count()).toBe(1);
      expect(await prisma.decision.count()).toBe(3);
      expect((await blobsOf(w.cycleId)).size).toBe(9);
    });
  });

  describe('critério 2: a mensagem na DLQ vira HOLD registrado', () => {
    // O Service Bus falso: guarda a mensagem e o que o serviço faz com ela. O MessagingService de verdade, o handler de verdade.
    function fakeBus(message: QueueMessage, applicationProperties?: Record<string, unknown>) {
      const settle = {
        complete: vi.fn(),
        abandon: vi.fn(),
        deadLetter: vi.fn(),
        schedule: vi.fn(),
        close: vi.fn(),
      };
      const received = {
        messageId: 'decide:x',
        body: message,
        ...(applicationProperties ? { applicationProperties } : {}),
      };
      const client = {
        createReceiver: () => ({
          receiveMessages: () => Promise.resolve([received]),
          completeMessage: settle.complete,
          abandonMessage: settle.abandon,
          deadLetterMessage: settle.deadLetter,
          close: settle.close,
        }),
        createSender: () => ({
          scheduleMessages: settle.schedule,
          sendMessages: vi.fn(),
          close: vi.fn(),
        }),
        close: vi.fn(),
      };
      return { service: new MessagingService(client as never), settle };
    }

    it('competidor que sempre falha: as duas primeiras entregas reagendam e a terceira registra o HOLD, sem DLQ', async () => {
      Logger.overrideLogger(false);
      const w = await world({
        season: withModels((slug) =>
          slug === 'fake-a' ? { modelId: 'fake/always-fail' } : undefined,
        ),
      });
      const failing = w.published.find(
        (m) => m.type === 'decide' && m.competitorId === w.models[0]!.id,
      )!;

      // entregas 1 e 2: o handler falha, a fila agenda a cópia (10 e 20 minutos) e conclui a original
      for (const attempt of [undefined, 2]) {
        const bus = fakeBus(failing, attempt ? { attempt } : undefined);
        await expect(bus.service.receiveOne('decisions', w.handler.handle)).resolves.toBe('retry');
        expect(bus.settle.schedule).toHaveBeenCalledOnce();
        expect(bus.settle.deadLetter).not.toHaveBeenCalled();
      }
      expect(await prisma.decision.count()).toBe(0);

      // entrega 3 (a última): o handler grava o HOLD e a mensagem é concluída, não vai para a DLQ
      const last = fakeBus(failing, { attempt: 3 });
      await expect(last.service.receiveOne('decisions', w.handler.handle)).resolves.toBe(
        'complete',
      );
      expect(last.settle.deadLetter).not.toHaveBeenCalled();
      expect(last.settle.schedule).not.toHaveBeenCalled();
      expect(last.settle.complete).toHaveBeenCalledOnce();

      expect(
        await prisma.decision.findFirstOrThrow({ where: { competitorId: w.models[0]!.id } }),
      ).toMatchObject({
        status: 'FORCED_HOLD',
        holdReason: 'falha',
        summary: null,
      });
      expect(
        await prisma.jobRun.findFirstOrThrow({
          where: { type: 'decide', idempotencyKey: `${w.cycleId}:${w.models[0]!.id}` },
        }),
      ).toMatchObject({ status: 'FAILED', attempts: 3 });
    });

    it('o ciclo não trava: os outros decidem normalmente e, com o HOLD do que falhou, o ciclo fecha', async () => {
      Logger.overrideLogger(false);
      const w = await world({
        season: withModels((slug) =>
          slug === 'fake-a' ? { modelId: 'fake/always-fail' } : undefined,
        ),
      });
      for (const message of w.published) {
        const failing = message.type === 'decide' && message.competitorId === w.models[0]!.id;
        await deliver(w, message, failing ? 3 : 1); // a última entrega do que falha
      }
      expect(await prisma.cycle.findUniqueOrThrow({ where: { id: w.cycleId } })).toMatchObject({
        status: 'CLOSED',
      });
      const statuses = (await prisma.decision.findMany({ where: { cycleId: w.cycleId } }))
        .map((d) => d.status)
        .sort();
      expect(statuses).toEqual(['DECIDED', 'DECIDED', 'FORCED_HOLD']);
    });

    it('o que a fila não cobre (a DLQ do broker, processo que caiu): a varredura grava HOLD "sem_resposta" e fecha o ciclo', async () => {
      Logger.overrideLogger(false);
      const w = await world();
      await deliver(w, w.published[0]!);
      // as outras duas mensagens nunca foram tratadas; passou do prazo e da folga
      expect(await new CycleCloser(repo).closeOverdue(new Date('2026-11-03T13:00:00Z'))).toBe(1);
      const reasons = (await prisma.decision.findMany({ where: { cycleId: w.cycleId } }))
        .map((d) => d.holdReason)
        .sort();
      expect(reasons).toEqual([null, 'sem_resposta', 'sem_resposta']);
      expect(await prisma.cycle.findUniqueOrThrow({ where: { id: w.cycleId } })).toMatchObject({
        status: 'CLOSED',
      });
    });
  });

  describe('critério 3: nenhuma resposta da API contém o prompt (canário)', () => {
    // O que "limpo" quer dizer: nem o canário, nem a chave, nem qualquer trecho de 8 palavras do prompt.
    function expectClean(where: string, text: string) {
      expect(text, `${where}: canário`).not.toContain(CANARY);
      expect(text, `${where}: chave do OpenRouter`).not.toContain(SECRET_KEY);
      expect(text, `${where}: cabeçalho de autorização`).not.toMatch(/Bearer\s+sk-/);
      expect(createLeakFilter(TEST_PROMPT).redact(text).leaked, `${where}: trecho do prompt`).toBe(
        false,
      );
    }

    it('um modelo que devolve o prompt inteiro no summary e nos rationales: endpoint, Blob, banco e logs ficam limpos', async () => {
      const logs = captureLogs();
      // fake-a devolve o prompt inteiro nos textos públicos; fake-b é um OpenRouter cuja chamada falha com 500 e eco do pedido
      // (a chave e o prompt não podem vazar; 401 e 402 seriam erro de configuração, que não vira HOLD: llm-gateway.spec.ts); fake-c
      // falha lendo a carteira com um erro que carrega o prompt
      let echoedByProvider = '';
      const fake = createFakeFetch();
      const fetch: Fetch = async (input, init) => {
        if (requestUrl(input).includes('openrouter.ai')) {
          return new Response(
            JSON.stringify({ error: { message: `eco do pedido: ${requestBody(init)}` } }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          );
        }
        const response = await fake(input, init);
        const text = await response.clone().text();
        if (text.includes(CANARY)) echoedByProvider = text;
        return response;
      };
      let failsReadingPortfolio = '';
      const w = await world({
        season: withModels((slug) =>
          slug === 'fake-a'
            ? { modelId: 'fake/echo-prompt' }
            : slug === 'fake-b'
              ? { provider: 'openrouter', modelId: 'anthropic/claude-opus-5.5' }
              : undefined,
        ),
        fetch,
        readPortfolio: (query) =>
          query.competitorId === failsReadingPortfolio
            ? Promise.reject(new Error(`falha lendo a carteira, contexto: ${TEST_PROMPT}`))
            : readInitialPortfolio(query),
      });
      failsReadingPortfolio = w.models[2]!.id;

      const outcomes = [];
      for (const message of w.published) outcomes.push((await deliver(w, message)).action);
      expect(outcomes).toEqual(['complete', 'retry', 'retry']);
      // na última entrega, os dois que falharam viram HOLD
      for (const message of w.published) {
        if (message.type === 'decide' && message.competitorId !== w.models[0]!.id) {
          expect(await deliver(w, message, 3)).toEqual({ action: 'complete' });
        }
      }

      // o provedor devolveu o prompt inteiro, de verdade: a verificação abaixo não é vácua
      expect(echoedByProvider).toContain(CANARY);
      const echo = await prisma.decision.findFirstOrThrow({
        where: { competitorId: w.models[0]!.id },
      });
      expect(echo.status).toBe('DECIDED');
      expect(echo.summary).toContain('trecho removido');
      expect(echo.leakFields.length).toBeGreaterThan(0);

      // ---- o endpoint do item 9 e, desde a etapa 9, TODAS as rotas públicas ----
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, PublicModule, CyclesModule],
      })
        .overrideProvider(PrismaService)
        .useValue(apiPrisma)
        .compile();
      const app: INestApplication = moduleRef.createNestApplication({ logger: false });
      configureApp(app);
      await app.init();
      try {
        const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
        const res = await http().get(`/api/v1/cycles/${w.cycleId}`);
        expect(res.status).toBe(200);
        const view = cycleViewSchema.parse((res.body as { data: unknown }).data);
        expect(view.decisions.map((d) => d.status)).toEqual([
          'DECIDED',
          'FORCED_HOLD',
          'FORCED_HOLD',
        ]);
        expect(view.decisions[0]!.summary).toContain('trecho removido');
        expect(view.decisions[0]!.items.every((i) => i.rationale.includes('trecho removido'))).toBe(
          true,
        );
        expectClean('a resposta da API', JSON.stringify(res.body));

        // O mesmo modelo que devolveu o prompt inteiro, visto por cada rota pública: o feed (que mostra o resumo e as razões), o
        // ciclo por data, o ranking, o competidor, as notícias e a busca de ações. Nenhuma deixa passar o canário, a chave nem um
        // trecho do prompt, e o feed mostra o aviso no lugar do texto.
        const season = await prisma.season.findFirstOrThrow();
        const urls = [
          '/api/v1/arena/current',
          '/api/v1/seasons',
          `/api/v1/seasons/${season.id}/leaderboard`,
          `/api/v1/seasons/${season.slug}/equity`,
          `/api/v1/seasons/${season.slug}/random-baseline`,
          '/api/v1/competitors/fake-a',
          '/api/v1/competitors/fake-b',
          '/api/v1/competitors/fake-c',
          '/api/v1/cycles/2026-11-03',
          '/api/v1/decisions',
          '/api/v1/decisions?action=BUY',
          '/api/v1/decisions?action=HOLD',
          '/api/v1/decisions?competitor=fake-a',
          '/api/v1/news',
          '/api/v1/stocks?q=wege',
          '/api/v1/stocks/WEGE3',
        ];
        for (const url of urls) {
          const got = await http().get(url);
          // nenhuma notícia, barra nem ação neste mundo: as rotas da ação respondem 404 ou lista vazia, e todas são limpas
          expect([200, 404], url).toContain(got.status);
          expectClean(url, JSON.stringify(got.body));
        }
        const feed = await http().get('/api/v1/decisions');
        expect(feed.status).toBe(200);
        const rows = (feed.body as { data: { rows: Array<{ summary: string | null }> } }).data.rows;
        expect(rows.some((row) => row.summary?.includes('trecho removido'))).toBe(true);
      } finally {
        await app.close();
      }

      // ---- o Blob: requisição, resposta crua e metadados de cada decisão ----
      const files = await blobsOf(w.cycleId);
      expect(files.size).toBeGreaterThan(0);
      for (const [name, bytes] of files) expectClean(`o blob ${name}`, bytes.toString('utf8'));

      // ---- o banco: todo texto que as tabelas da arena e o job_run guardam ----
      const dump = JSON.stringify(
        {
          decisions: await prisma.decision.findMany(),
          items: await prisma.decisionItem.findMany(),
          cycles: await prisma.cycle.findMany(),
          prompts: await prisma.promptVersion.findMany(),
          jobs: await prisma.jobRun.findMany(),
          competitors: await prisma.competitor.findMany(),
        },
        (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      );
      expectClean('o banco', dump);
      // o job_run dos dois que falharam guarda o erro, sem o prompt nem a chave
      const failed = await prisma.jobRun.findMany({ where: { status: 'FAILED' } });
      expect(failed).toHaveLength(2);
      expect(failed.every((job) => (job.error ?? '').length > 0)).toBe(true);

      // ---- os logs capturados (Nest Logger e console) ----
      expect(logs.length).toBeGreaterThan(0);
      expectClean('os logs', logs.join('\n'));
    });
  });
});
