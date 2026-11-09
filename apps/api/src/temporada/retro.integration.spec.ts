import { readFileSync } from 'node:fs';
import { BlobServiceClient } from '@azure/storage-blob';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Secret } from '../config/secret.js';
import { FIRST_DAY, truncateAll } from '../ensaio/driver.js';
import { ENSAIO_CANARY, ENSAIO_PROMPT } from '../ensaio/world.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import {
  openTestDatabase,
  testDatabaseUrl,
} from '../infrastructure/database/test-database.fixture.js';
import { brasiliaInstant } from '../modules/market-data/domain/dates.js';
import { loadPrompt, type LoadedPrompt } from './pieces.js';
import { parseDatedSeasonFile } from './plan.js';
import { RetroRefusedError, planRetro, runRetro } from './retro.js';
import {
  LAST,
  PREFIX,
  calendar,
  clearTestBlobs,
  countingLlm,
  localWorld,
  market,
  seasonFile,
} from './testing/local-world.fixture.js';

// O arena:retroativo (ADR 0038) de verdade, com o motor do ensaio e as peças do retroativo (localPieces), trocando só o que sairia da máquina:
// a brapi pela falsa do ensaio, o OpenRouter pelo provedor fake, o BCB pelo SGS sintético e a CVM pelos documentos sintéticos. Postgres e
// Azurite de verdade (os arquivos em containers "rt-<banco de teste>-"). Nenhuma rede.
const storage = process.env.STORAGE_CONNECTION_STRING;
const ready = Boolean(testDatabaseUrl && storage);
const title = ready
  ? 'arena:retroativo (Postgres + Azurite)'
  : 'arena:retroativo (Postgres + Azurite) [pulado: defina TEST_DATABASE_URL e STORAGE_CONNECTION_STRING]';

describe.skipIf(!ready)(title, () => {
  let prisma: PrismaService;
  let blob: BlobServiceClient;
  let prompt: LoadedPrompt;
  const logs: string[] = [];

  const retroWorld = (llm: typeof fetch, used: LoadedPrompt = prompt, env = {}) =>
    localWorld({ prisma, blob, prompt: used, llm, mode: 'retroativo', env });

  const run = (
    built: ReturnType<typeof retroWorld>,
    overrides: Partial<Parameters<typeof runRetro>[0]> = {},
  ) =>
    runRetro({
      prisma,
      world: built.world,
      calendar,
      dated: seasonFile(),
      prompt,
      until: LAST,
      capUsd: '30',
      sources: built.sources,
      log: (line) => logs.push(line),
      ...overrides,
    });

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    blob = BlobServiceClient.fromConnectionString(storage!);
    prompt = await loadPrompt({
      env: { PROMPT_ARENA: new Secret(ENSAIO_PROMPT), PROMPT_ARENA_VERSION: undefined },
      file: undefined,
      repoRoot: '/nao-usado',
    });
    const line =
      (level: string) =>
      (message: unknown, ...rest: unknown[]) =>
        logs.push(
          `${level} ${JSON.stringify([message, ...rest], (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))}`,
        );
    Logger.overrideLogger({
      log: line('log'),
      warn: line('warn'),
      error: line('error'),
      debug: line('debug'),
      verbose: line('verbose'),
      fatal: line('fatal'),
    });
  }, 120_000);

  beforeEach(async () => {
    await truncateAll(prisma);
    await clearTestBlobs(blob);
    logs.length = 0;
  });

  afterAll(async () => {
    Logger.overrideLogger(false);
    await truncateAll(prisma);
    await clearTestBlobs(blob);
    await prisma.onModuleDestroy();
  });

  it('5 pregões viram 5 ciclos RETROATIVO com a hora real; interrompido no 3º e rodado de novo, nenhuma decisão nem chamada se repete', async () => {
    const startedAt = new Date();
    const abort = new AbortController();
    // o Ctrl+C no meio do 3º pregão: depois da 2ª decisão dele (12 do 1º e do 2º, mais 2)
    const first = countingLlm({ onCall: (count) => count === 14 && abort.abort() });
    const interrupted = await run(retroWorld(first.fetchFn), { signal: abort.signal });
    expect(interrupted.outcome).toBe('interrupted');
    expect(first.calls).toHaveLength(14);
    expect(await prisma.decision.count()).toBe(14);

    const second = countingLlm();
    const done = await run(retroWorld(second.fetchFn));
    expect(done.outcome).toBe('done');
    // os 4 modelos que faltavam no 3º pregão e os 6 do 4º e do 5º
    expect(second.calls).toHaveLength(16);
    expect(first.calls.length + second.calls.length).toBe(30);

    const cycles = await prisma.cycle.findMany({
      orderBy: { date: 'asc' },
      include: { decisions: { include: { competitor: true } } },
    });
    expect(cycles.map((c) => c.date.toISOString().slice(0, 10))).toEqual(market.sessionDays);
    for (const cycle of cycles) {
      expect(cycle.mode).toBe('RETROATIVO');
      expect(cycle.status).toBe('CLOSED');
      // a hora real é a desta execução; a da decisão e o prazo seguem o pregão simulado
      expect(cycle.executedAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime() - 1000);
      expect(cycle.executedAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(cycle.decisionAt).toEqual(
        brasiliaInstant(cycle.date.toISOString().slice(0, 10), '08:00'),
      );
      expect(cycle.decisions.map((d) => d.competitor.slug).sort()).toEqual([
        'claude-opus-5-5',
        'deepseek-v4-pro',
        'gemini-4-argon',
        'gpt-6-1-sol',
        'grok-4-7',
        'qwen3-8-max',
      ]);
      expect(cycle.decisions.every((d) => d.status === 'DECIDED')).toBe(true);
    }
    // uma decisão por par (ciclo, competidor), e o Sorteio operou na liquidação de cada pregão
    expect(await prisma.decision.count()).toBe(30);
    const sorteio = await prisma.competitor.findFirstOrThrow({ where: { slug: 'sorteio' } });
    expect(await prisma.equitySnapshot.count({ where: { competitorId: sorteio.id } })).toBe(5);
    expect(await prisma.order.count({ where: { competitorId: sorteio.id } })).toBeGreaterThan(0);
    const season = await prisma.season.findFirstOrThrow({ where: { slug: 'temporada-teste' } });
    expect(season.status).toBe('FINISHED');
    expect(season.promptSha256).toBe(prompt.sha256);
    expect(season.startDate?.toISOString().slice(0, 10)).toBe(FIRST_DAY);

    // rodar de novo com tudo fechado não chama nada
    const third = countingLlm();
    const again = await run(retroWorld(third.fetchFn));
    expect(again.sessions.every((s) => s.status === 'already_done')).toBe(true);
    expect(third.calls).toHaveLength(0);
  }, 120_000);

  it('o canário do prompt só vai no pedido ao LLM: nem no banco, nem no Blob, nem no log', async () => {
    const llm = countingLlm();
    await run(retroWorld(llm.fetchFn), { until: market.sessionDays[1]! });
    expect(llm.calls.length).toBeGreaterThan(0);
    expect(llm.calls.every((call) => call.system.includes(ENSAIO_CANARY))).toBe(true);
    let blobs = 0;
    for await (const container of blob.listContainers({ prefix: PREFIX })) {
      const client = blob.getContainerClient(container.name);
      for await (const item of client.listBlobsFlat()) {
        blobs += 1;
        const text = (await client.getBlobClient(item.name).downloadToBuffer()).toString('utf8');
        expect(text, item.name).not.toContain(ENSAIO_CANARY);
      }
    }
    expect(blobs).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(ENSAIO_CANARY);
    const texts = await prisma.decision.findMany({ select: { summary: true } });
    expect(JSON.stringify(texts)).not.toContain(ENSAIO_CANARY);
  }, 120_000);

  it('o prompt diferente do que a temporada fixou recusa abrir o ciclo, e nada é chamado', async () => {
    await run(retroWorld(countingLlm().fetchFn), { until: FIRST_DAY });
    const other = await loadPrompt({
      env: {
        PROMPT_ARENA: new Secret(`${ENSAIO_PROMPT}\nUma linha a mais muda o SHA-256.`),
        PROMPT_ARENA_VERSION: undefined,
      },
      file: undefined,
      repoRoot: '/nao-usado',
    });
    const llm = countingLlm();
    await expect(run(retroWorld(llm.fetchFn, other), { prompt: other })).rejects.toThrow(
      RetroRefusedError,
    );
    expect(llm.calls).toHaveLength(0);
    expect(await prisma.cycle.count()).toBe(1);
  }, 120_000);

  it('--teto-usd: para antes de abrir o pregão cujo pior caso passaria do teto', async () => {
    // os seis modelos pagos da Temporada 1 (os preços do arquivo), com o provedor fake custando US$ 0,10 por chamada
    const paid = JSON.parse(
      readFileSync(new URL('../../seasons/temporada-1.json', import.meta.url), 'utf8'),
    ) as { competitors: unknown };
    const dated = seasonFile({ competitors: paid.competitors });
    const env = { ARENA_MONTHLY_COST_CAP_USD: '1000' };
    // o pior caso de um pregão com os seis é US$ 2,66 (plan.spec.ts): um teto de US$ 2 não abre nem o primeiro
    const none = countingLlm({ costUsd: 0.1 });
    const stopped = await run(retroWorld(none.fetchFn, prompt, env), { dated, capUsd: '2' });
    expect(stopped).toMatchObject({ outcome: 'cap_reached', stoppedAt: FIRST_DAY });
    expect(none.calls).toHaveLength(0);
    expect(await prisma.cycle.count()).toBe(0);

    // com US$ 3,30: o 1º pregão abre (0 + 2,66 cabe) e gasta 6 x 0,10 = 0,60; o 2º também (0,60 + 2,66 = 3,26 cabe); o 3º não
    // (1,20 + 2,66 = 3,86 passa)
    const some = countingLlm({ costUsd: 0.1 });
    const partial = await run(retroWorld(some.fetchFn, prompt, env), { dated, capUsd: '3.3' });
    expect(partial).toMatchObject({ outcome: 'cap_reached', stoppedAt: market.sessionDays[2] });
    expect(some.calls).toHaveLength(12);
    expect(partial.spentMicroUsd).toBe(1_200_000n);
  }, 120_000);

  it('o pregão que não fecha (o ciclo pulado: modelo pago sem o teto do mês) para a execução nele, em vez de seguir sobre o buraco', async () => {
    const paid = JSON.parse(
      readFileSync(new URL('../../seasons/temporada-1.json', import.meta.url), 'utf8'),
    ) as { competitors: unknown };
    const llm = countingLlm();
    // sem ARENA_MONTHLY_COST_CAP_USD o ciclo com modelo pago é pulado (fail closed, como em produção)
    const summary = await run(retroWorld(llm.fetchFn), {
      dated: seasonFile({ competitors: paid.competitors }),
    });
    expect(summary).toMatchObject({ outcome: 'incomplete', stoppedAt: FIRST_DAY });
    expect(llm.calls).toHaveLength(0);
    const cycles = await prisma.cycle.findMany();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'orcamento',
      mode: 'RETROATIVO',
    });
    // com o teto, a execução seguinte reavalia o pregão pulado e continua
    const again = countingLlm();
    const done = await run(
      retroWorld(again.fetchFn, prompt, { ARENA_MONTHLY_COST_CAP_USD: '1000' }),
      {
        dated: seasonFile({ competitors: paid.competitors }),
      },
    );
    expect(done.outcome).toBe('done');
    expect(again.calls).toHaveLength(30);
  }, 120_000);

  it('o crédito acaba no meio (HTTP 402): o pregão fica sem decisão e a execução para antes da liquidação, sem HOLD; recarregado, continua', async () => {
    // as 6 primeiras chamadas (o 1º pregão) respondem; dali em diante o provedor diz 402, como o OpenRouter sem crédito
    const ok = countingLlm();
    let calls = 0;
    const broke: typeof fetch = (input, init) => {
      calls += 1;
      if (calls <= 6) return ok.fetchFn(input, init);
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } }), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const noHold = { holdReason: { in: ['falha', 'sem_resposta'] } };
    const stopped = await run(retroWorld(broke));
    expect(stopped).toMatchObject({ outcome: 'incomplete', stoppedAt: market.sessionDays[1] });
    const second = await prisma.cycle.findFirstOrThrow({
      where: { date: new Date(`${market.sessionDays[1]}T00:00:00Z`) },
    });
    expect(second).toMatchObject({ status: 'OPEN', mode: 'RETROATIVO' });
    expect(await prisma.decision.count({ where: { cycleId: second.id } })).toBe(0);
    expect(await prisma.decision.count({ where: noHold })).toBe(0);
    expect(await prisma.cycle.count()).toBe(2);
    expect(logs.some((line) => line.includes('o pregão ficou com modelo sem decisão'))).toBe(true);

    // recarregado: a execução seguinte decide o 2º pregão (os 6 que faltavam) e os 3 seguintes, e nenhum HOLD ocupou lugar de decisão
    const again = countingLlm();
    const done = await run(retroWorld(again.fetchFn));
    expect(done.outcome).toBe('done');
    expect(again.calls).toHaveLength(24);
    expect(await prisma.decision.count()).toBe(30);
    expect(await prisma.decision.count({ where: noHold })).toBe(0);
  }, 120_000);

  it('--dry-run: mostra os pregões, as chamadas e o custo, sem nenhuma chamada e sem escrever nada', async () => {
    // metade da temporada já rodada, para o plano ter pregão fechado e pregão a rodar
    await run(retroWorld(countingLlm().fetchFn), { until: market.sessionDays[1]! });
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const counts = async () => {
      const result: Record<string, number> = {};
      for (const { tablename } of tables) {
        const [row] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM "${tablename}"`,
        );
        result[tablename] = row!.n;
      }
      return result;
    };
    const before = await counts();
    const llm = countingLlm();
    const built = retroWorld(llm.fetchFn);
    const plan = await planRetro({ prisma, calendar, dated: seasonFile(), until: LAST });
    expect(plan.sessions.map((s) => s.state)).toEqual([
      'fechado',
      'fechado',
      'a rodar',
      'a rodar',
      'a rodar',
    ]);
    expect(plan.calls).toEqual({ min: 18, max: 36 });
    // os modelos do ensaio são fake: custo zero
    expect(plan.costMicroUsd).toEqual({ typical: 0n, worst: 0n });
    expect(await counts()).toEqual(before);
    expect(llm.calls).toHaveLength(0);
    expect(built.brapi.requests).toHaveLength(0);
    // sem banco (a primeira vez), o plano é a temporada inteira, e com os preços da Temporada 1
    const t1 = parseDatedSeasonFile(
      JSON.parse(readFileSync(new URL('../../seasons/temporada-1.json', import.meta.url), 'utf8')),
    );
    const fresh = await planRetro({ prisma: null, calendar, dated: t1, until: '2026-11-05' });
    expect(fresh.sessions).toHaveLength(17);
    expect(fresh.calls).toEqual({ min: 102, max: 204 });
    expect(fresh.costMicroUsd).toEqual({ typical: 17n * 582_290n, worst: 17n * 2_661_276n });
  }, 120_000);
});
