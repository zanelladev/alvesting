import { BlobServiceClient } from '@azure/storage-blob';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Secret } from '../config/secret.js';
import { createSimClock } from '../ensaio/bus.js';
import { truncateAll } from '../ensaio/driver.js';
import { ENSAIO_PROMPT } from '../ensaio/world.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import {
  openTestDatabase,
  testDatabaseUrl,
} from '../infrastructure/database/test-database.fixture.js';
import { createOperator } from './operator.js';
import { loadPrompt, type LoadedPrompt } from './pieces.js';
import { runRetro } from './retro.js';
import {
  brt,
  calendar,
  clearTestBlobs,
  countingLlm,
  localWorld,
  market,
  seasonFile,
} from './testing/local-world.fixture.js';

// O operador local (arena:operar; ADR 0038) com o relógio na mão: cada volta recebe a hora, e o motor anda com ela. A temporada e os pregões
// anteriores saem do arena:retroativo (sintético, como no retro.integration.spec.ts); o operador só abre o ciclo ao vivo quando todas as regras
// deixam. Postgres e Azurite de verdade, nenhuma rede.
const storage = process.env.STORAGE_CONNECTION_STRING;
const ready = Boolean(testDatabaseUrl && storage);
const title = ready
  ? 'arena:operar (Postgres + Azurite)'
  : 'arena:operar (Postgres + Azurite) [pulado: defina TEST_DATABASE_URL e STORAGE_CONNECTION_STRING]';

const [D1, D2, D3] = market.sessionDays as [string, string, string];
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe.skipIf(!ready)(title, () => {
  let prisma: PrismaService;
  let blob: BlobServiceClient;
  let prompt: LoadedPrompt;
  const lines: string[] = [];

  // a temporada sintética pelo retroativo, até o pregão `until` (inclusive)
  async function retroUntil(until: string) {
    const built = localWorld({
      prisma,
      blob,
      prompt,
      llm: countingLlm().fetchFn,
      mode: 'retroativo',
    });
    const summary = await runRetro({
      prisma,
      world: built.world,
      calendar,
      dated: seasonFile(),
      prompt,
      until,
      capUsd: '30',
      sources: built.sources,
      log: () => undefined,
    });
    expect(summary.outcome).toBe('done');
  }

  // um processo do operador, com o relógio simulado que cada volta anda
  function operator(
    options: {
      dataOnly?: boolean;
      prompt?: LoadedPrompt;
      credit?: Parameters<typeof createOperator>[0]['credit'];
    } = {},
  ) {
    const llm = countingLlm();
    const { world } = localWorld({
      prisma,
      blob,
      prompt: options.prompt ?? prompt,
      llm: llm.fetchFn,
      mode: options.dataOnly ? 'so-dados' : 'ao-vivo',
      clock: createSimClock(new Date(0)),
    });
    const op = createOperator({
      prisma,
      world,
      calendar,
      seasonSlug: 'temporada-teste',
      prompt: options.prompt ?? prompt,
      dataOnly: options.dataOnly ?? false,
      log: (line) => lines.push(line),
      ...(options.credit ? { credit: options.credit } : {}),
    });
    return { op, llm };
  }
  const cycleOf = (date: string) =>
    prisma.cycle.findFirst({ where: { date: day(date) }, include: { decisions: true } });

  beforeAll(async () => {
    Logger.overrideLogger(false);
    prisma = await openTestDatabase(testDatabaseUrl!);
    blob = BlobServiceClient.fromConnectionString(storage!);
    prompt = await loadPrompt({
      env: { PROMPT_ARENA: new Secret(ENSAIO_PROMPT), PROMPT_ARENA_VERSION: undefined },
      file: undefined,
      repoRoot: '/nao-usado',
    });
  }, 120_000);

  beforeEach(async () => {
    await truncateAll(prisma);
    await clearTestBlobs(blob);
    lines.length = 0;
  });

  afterAll(async () => {
    await truncateAll(prisma);
    await clearTestBlobs(blob);
    await prisma.onModuleDestroy();
  });

  it('com o retroativo em dia e o relógio às 08:00, congela o briefing e abre o ciclo AO_VIVO, e os modelos decidem', async () => {
    await retroUntil(D2);
    const { op, llm } = operator();
    await op.tick(brt(D3, '08:00', 30));
    const cycle = await cycleOf(D3);
    expect(cycle).toMatchObject({ mode: 'AO_VIVO', status: 'CLOSED' });
    expect(cycle!.decisions).toHaveLength(6);
    expect(llm.calls).toHaveLength(6);
    expect(await prisma.briefing.count({ where: { date: day(D3) } })).toBe(1);
    expect(lines.some((line) => line.startsWith('batimento:'))).toBe(true);
  }, 120_000);

  it('com o relógio às 09:40 (o Mac acordou depois do prazo), não abre ciclo ao vivo nem congela o briefing atrasado', async () => {
    await retroUntil(D2);
    const { op, llm } = operator();
    await op.tick(brt(D3, '09:40'));
    expect(await cycleOf(D3)).toBeNull();
    expect(await prisma.briefing.count({ where: { date: day(D3) } })).toBe(0);
    expect(llm.calls).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/janela da decisão passou/);
    // também a 5 minutos do prazo (a margem do reprocesso): um ciclo aberto às 09:26 decidiria depois do prazo
    const late = operator();
    await late.op.tick(brt(D3, '09:26'));
    expect(await cycleOf(D3)).toBeNull();
  }, 120_000);

  it('não abre ciclo para pregão que já tem um (o retroativo o rodou)', async () => {
    await retroUntil(D3);
    const before = await cycleOf(D3);
    const { op, llm } = operator();
    await op.tick(brt(D3, '08:00', 30));
    expect(await cycleOf(D3)).toMatchObject({ id: before!.id, mode: 'RETROATIVO' });
    expect(llm.calls).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/já tem ciclo \(RETROATIVO, CLOSED\)/);
  }, 120_000);

  it('não abre ciclo ao vivo com pregão anterior da temporada sem ciclo fechado (o retroativo não alcançou o presente)', async () => {
    await retroUntil(D1);
    const { op, llm } = operator();
    await op.tick(brt(D3, '08:00', 30));
    expect(await cycleOf(D3)).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(lines.join('\n')).toMatch(new RegExp(`sem ciclo fechado \\(o primeiro: ${D2}\\)`));
  }, 120_000);

  it('com outro prompt, não abre ciclo ao vivo', async () => {
    await retroUntil(D2);
    const other = await loadPrompt({
      env: {
        PROMPT_ARENA: new Secret(`${ENSAIO_PROMPT}\nOutra linha.`),
        PROMPT_ARENA_VERSION: undefined,
      },
      file: undefined,
      repoRoot: '/nao-usado',
    });
    const { op, llm } = operator({ prompt: other });
    await op.tick(brt(D3, '08:00', 30));
    expect(await cycleOf(D3)).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/não é o que a temporada fixou/);
  }, 120_000);

  it('regra 5: com o saldo do provedor abaixo do pior caso do pregão, ou sem conseguir lê-lo, não abre ciclo ao vivo; com saldo, abre', async () => {
    await retroUntil(D2);
    const worstMicroUsd = 2_661_000n;
    const short = operator({
      credit: { remainingMicroUsd: () => Promise.resolve(2_000_000n), worstMicroUsd },
    });
    await short.op.tick(brt(D3, '08:00', 30));
    expect(await cycleOf(D3)).toBeNull();
    expect(short.llm.calls).toHaveLength(0);
    expect(lines.join('\n')).toMatch(
      /saldo do provedor \(US\$ 2\.000000\) não cobre o pior caso do pregão \(US\$ 2\.661000\)/,
    );

    const unreadable = operator({
      credit: {
        remainingMicroUsd: () => Promise.reject(new Error('OpenRouter /key: HTTP 401')),
        worstMicroUsd,
      },
    });
    await unreadable.op.tick(brt(D3, '08:00', 30));
    expect(await cycleOf(D3)).toBeNull();
    expect(unreadable.llm.calls).toHaveLength(0);
    expect(lines.join('\n')).toMatch(
      /o saldo do provedor não pôde ser lido \(OpenRouter \/key: HTTP 401\)/,
    );

    const enough = operator({
      credit: { remainingMicroUsd: () => Promise.resolve(20_000_000n), worstMicroUsd },
    });
    await enough.op.tick(brt(D3, '08:00', 30));
    expect(await cycleOf(D3)).toMatchObject({ mode: 'AO_VIVO', status: 'CLOSED' });
    expect(enough.llm.calls).toHaveLength(6);
  }, 120_000);

  it('--so-dados: nem briefing nem ciclo, e o eod confirma o pregão sem pedir a liquidação', async () => {
    await retroUntil(D2);
    const { op, llm } = operator({ dataOnly: true });
    await op.tick(brt(D3, '08:00', 30));
    await op.tick(brt(D3, '21:30', 30));
    // o mercado sintético tem papel sem negócio no dia: o eod se reagenda pela fila (22:30, 23:30 e 00:30) e conclui na última, como na noite
    // de verdade; a volta depois da meia-noite entrega as cópias agendadas
    await op.tick(brt(market.sessionDays[3]!, '00:45'));
    expect(await cycleOf(D3)).toBeNull();
    expect(await prisma.briefing.count({ where: { date: day(D3) } })).toBe(0);
    expect(llm.calls).toHaveLength(0);
    const eod = await prisma.jobRun.findFirst({ where: { type: 'eod', idempotencyKey: D3 } });
    expect(eod?.status).toBe('SUCCEEDED');
    expect(
      await prisma.jobRun.count({ where: { type: 'settle', idempotencyKey: { endsWith: D3 } } }),
    ).toBe(0);
  }, 120_000);
});
