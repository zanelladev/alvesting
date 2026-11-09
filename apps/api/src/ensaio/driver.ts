import { readFile } from 'node:fs/promises';
import type { BlobServiceClient } from '@azure/storage-blob';
import { Logger } from '@nestjs/common';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import {
  addDays,
  brasiliaDate,
  brasiliaInstant,
  isoWeek,
  isoWeekMonday,
  type IsoDate,
} from '../modules/market-data/domain/dates.js';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { runScheduler } from '../role.js';
import { buildMarket } from './market.js';
import { installNetworkGuard } from './network-guard.js';
import { buildReport, type EnsaioCheck } from './report.js';
import { clearEnsaioBlobs, createWorld, ENSAIO_CANARY } from './world.js';

export { ENSAIO_CANARY };

// O ensaio da Temporada 0 (etapa 8, a parte local; docs/ENSAIO.md): a arena rodando sozinha por N pregões seguidos, com provedores
// fake (a brapi falsa serve o mercado sintético), os handlers de verdade, o Postgres e o Azurite de verdade, o relógio simulado e
// nenhuma rede. O comando é
// `pnpm --filter @alvesting/api arena:ensaio [--pregoes 5] [--semente N]` (src/ensaio-cli.ts); o teste de integração usa este mesmo
// driver em escala menor.

// O primeiro pregão do ensaio é o mesmo da Temporada 0 em produção (terça 03/11/2026, depois do Finados): o mercado, o histórico e as
// datas são função da semente e dele, e nunca do dia em que o ensaio roda.
export const FIRST_DAY: IsoDate = '2026-11-03';
export const SEASON_SLUG = 'ensaio';

// O ensaio esvazia o banco inteiro: só roda em banco descartável. O nome vem do próprio servidor (current_database), não da URL.
export async function assertDisposableDatabase(
  prisma: Pick<PrismaService, '$queryRaw'>,
): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  const name = rows[0]?.name ?? '';
  if (!/_(ensaio|test)$/.test(name)) {
    throw new Error(
      `O ensaio esvazia o banco e só roda em banco que termina em _ensaio ou _test (veio "${name}")`,
    );
  }
}

// Esvazia todas as tabelas (menos o controle das migrations). Só depois de assertDisposableDatabase.
export async function truncateAll(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${rows.map((row) => `"${row.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

export interface EnsaioOptions {
  // um banco descartável (_ensaio ou _test), com as migrations aplicadas; o driver o esvazia
  prisma: PrismaService;
  // o Azurite (os arquivos do ensaio ficam em containers com o prefixo "ensaio-")
  blob: BlobServiceClient;
  seed: number;
  sessions: number;
  stocks: number;
  // os K primeiros pregões abrem o ciclo como RETROATIVO (--retroativos K); padrão 0
  retroactiveSessions?: number;
  // o arquivo da temporada (padrão: apps/api/seasons/ensaio.json)
  seasonFile?: string;
  // uma linha por passo, para quem acompanha
  log?: (line: string) => void;
}

export interface EnsaioResult {
  ok: boolean;
  checks: EnsaioCheck[];
  // o relatório (o mesmo texto vai para .data/ensaio/) e a versão estruturada
  text: string;
  json: string;
  bus: {
    delivered: number;
    retried: number;
    deadLettered: number;
    byQueue: Record<string, number>;
  };
  // o que o guarda de rede barrou; tem de ser vazio
  blockedNetwork: string[];
  // medidas desta máquina, FORA do relatório (mudam a cada execução): quanto cada fila levou
  measures: Record<string, { count: number; totalMs: number; maxMs: number }>;
  // avisos e erros dos handlers (também fora do relatório: o texto tem ULID)
  logLines: string[];
}

const DEFAULT_SEASON_FILE = new URL('../../seasons/ensaio.json', import.meta.url);

// hora de Brasília de um pregão, com segundos (o cron e o contêiner chegam alguns segundos depois da hora cheia)
const brt = (date: IsoDate, hhmm: string, seconds = 0): Date =>
  new Date(brasiliaInstant(date, hhmm).getTime() + seconds * 1000);

// Os avisos e erros dos handlers ficam anotados, não impressos: o Nest Logger escreveria uma linha por mensagem. Todos contam: nenhuma
// falha é injetada no elenco (docs/ENSAIO.md, seção 3), então a linha de alerta (job falho, HOLD forçado, barras ausentes) é erro de verdade.
function captureLogs() {
  const counts = { warn: 0, error: 0 };
  const lines: string[] = [];
  const show = (message: unknown, rest: unknown[]) =>
    [message, ...rest]
      .map((part) =>
        typeof part === 'string'
          ? part
          : JSON.stringify(part, (_key, value: unknown) =>
              typeof value === 'bigint'
                ? value.toString()
                : value instanceof Error
                  ? value.message
                  : value,
            ),
      )
      .join(' ');
  const none = () => undefined;
  Logger.overrideLogger({
    log: none,
    debug: none,
    verbose: none,
    warn: (message: unknown, ...rest: unknown[]) => {
      counts.warn += 1;
      lines.push(`aviso: ${show(message, rest)}`);
    },
    error: (message: unknown, ...rest: unknown[]) => {
      counts.error += 1;
      lines.push(`erro: ${show(message, rest)}`);
    },
    fatal: (message: unknown, ...rest: unknown[]) => {
      counts.error += 1;
      lines.push(`erro: ${show(message, rest)}`);
    },
  });
  return { counts, lines, restore: () => void Logger.overrideLogger(false) };
}

export async function runEnsaio(options: EnsaioOptions): Promise<EnsaioResult> {
  const { prisma, blob, seed, sessions, stocks } = options;
  const log = options.log ?? (() => undefined);
  await assertDisposableDatabase(prisma);

  const calendar = loadTradingCalendar();
  const market = buildMarket({ seed, stocks, firstDay: FIRST_DAY, sessions, calendar });
  const { sessionDays } = market;
  await truncateAll(prisma);
  await clearEnsaioBlobs(blob);

  const guard = installNetworkGuard();
  const logs = captureLogs();
  const measures: EnsaioResult['measures'] = {};
  try {
    // o relógio começa no sábado antes da semana do primeiro pregão
    const week1Monday = isoWeekMonday(isoWeek(FIRST_DAY));
    const world = createWorld({
      prisma,
      blob,
      seed,
      market,
      calendar,
      start: brt(addDays(week1Monday, -2), '12:00'),
      ...(options.retroactiveSessions ? { retroactiveSessions: options.retroactiveSessions } : {}),
    });

    // 1. a carga histórica, pelo caminho de verdade (market:backfill, só que na brapi falsa), e a temporada (season:create)
    const history = await world.backfill.run({
      to: market.historyDays.at(-1)!,
      today: brasiliaDate(world.clock.now()),
      fetch: true,
    });
    log(
      `carga histórica: ${history.confirmedDays} pregões, ${history.inserted} barras, ${history.requestsMade} requisições`,
    );
    const raw = JSON.parse(await readFile(options.seasonFile ?? DEFAULT_SEASON_FILE, 'utf8')) as {
      slug: string;
      params: Record<string, unknown>;
    };
    raw.params.sessions = sessions;
    const season = await world.seasons.create(raw);
    log(`temporada ${season.slug} criada (${season.models} modelos)`);

    // 2. a linha do tempo: cada passo é um agendador (o cron de produção) ou um ato do admin, no horário de Brasília. Entre dois passos
    // o barramento entrega o que venceu, com o relógio na hora de cada mensagem.
    const steps: Array<{ at: Date; label: string; run: () => Promise<unknown> }> = [];
    const schedule = (name: string, at: Date) =>
      steps.push({
        at,
        label: `sched-${name}`,
        run: () => runScheduler(name, world.schedulers, at),
      });
    // domingo 09:00, o universo da semana seguinte
    for (const week of new Set(sessionDays.map(isoWeek))) {
      schedule('universe', brt(addDays(isoWeekMonday(week), -1), '09:00', 10));
    }
    const startAt = brt(addDays(FIRST_DAY, -1), '18:00');
    steps.push({
      at: startAt,
      label: 'season:start',
      run: async () => {
        const started = await world.seasons.start(season.id, startAt);
        log(`temporada em andamento: primeiro pregão ${started.startDate}`);
      },
    });
    for (const day of sessionDays) {
      schedule('news', brt(day, '07:00', 5));
      schedule('briefing', brt(day, '07:30', 30));
      // depois do corte das 07:30: entra no briefing do dia seguinte
      schedule('news', brt(day, '07:30', 45));
      schedule('cycle', brt(day, '08:00', 30));
      schedule('eod', brt(day, '21:30', 20));
    }
    // O admin registra o desdobramento na noite do 2º pregão, antes da data ex (o 3º): a prática, e o que `settle:event` faz.
    const registerAt = brt(sessionDays[1]!, '23:30');
    steps.push({
      at: registerAt,
      label: 'settle:event',
      run: async () => {
        const result = await world.events.register(
          {
            ticker: market.split.ticker,
            exDate: market.split.exDate,
            kind: market.split.kind,
            factor: market.split.factor,
          },
          registerAt,
          'ensaio',
        );
        log(`evento ${market.split.ticker} ${market.split.exDate}: ${result.event.change}`);
      },
    });
    steps.sort((a, b) => a.at.getTime() - b.at.getTime());

    for (const step of steps) {
      await world.bus.runUntil(step.at);
      world.clock.set(step.at);
      log(`${step.at.toISOString()} ${step.label}`);
      await step.run();
    }
    // o que ficou na fila depois do último passo: o eod do último pregão e o settle que ele pede
    await world.bus.runUntil(new Date(steps.at(-1)!.at.getTime() + 24 * 3_600_000));
    if (world.bus.pending() > 0)
      throw new Error(`Sobraram ${world.bus.pending()} mensagens na fila`);

    for (const delivery of world.bus.deliveries) {
      const entry = (measures[delivery.queue] ??= { count: 0, totalMs: 0, maxMs: 0 });
      entry.count += 1;
      entry.totalMs += delivery.ms;
      entry.maxMs = Math.max(entry.maxMs, delivery.ms);
    }

    const report = await buildReport({
      prisma,
      seasonSlug: SEASON_SLUG,
      seed,
      market,
      deliveries: world.bus.deliveries,
      deadLetters: world.bus.deadLetters,
      blockedNetwork: guard.blocked,
      logs: logs.counts,
      canary: ENSAIO_CANARY,
      brapiRequests: world.brapi.requests,
      lateDay: world.lateDay,
    });
    return {
      ok: report.ok,
      checks: report.checks,
      text: report.text,
      json: report.json,
      bus: report.bus,
      blockedNetwork: [...guard.blocked],
      measures,
      logLines: logs.lines,
    };
  } finally {
    guard.restore();
    logs.restore();
  }
}
