import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { idempotencyKey, type CompetitorSpec } from '@alvesting/contracts';
import type { ArenaWorld } from '../ensaio/world.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import { formatUsd, parseUsdToMicro } from '../modules/arena/domain/cost.js';
import type { SeasonRow } from '../modules/arena/infrastructure/arena.repository.js';
import {
  addDays,
  brasiliaDate,
  brasiliaInstant,
  isoWeek,
  isoWeekMonday,
  type IsoDate,
} from '../modules/market-data/domain/dates.js';
import { UNIVERSE_RULES } from '../modules/market-data/domain/universe.js';
import type { TradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import type { CvmBackfillWindow } from '../modules/news/application/cvm-fetcher.js';
import { runScheduler } from '../role.js';
import type { LoadedPrompt } from './pieces.js';
import { seasonSessions, sessionCostMicro, type DatedSeasonFile } from './plan.js';
import { cvmSeenAt } from './visibility.js';

// O arena:retroativo (ADR 0038; docs/METODOLOGIA.md, "Temporada 1"): roda, agora, os pregões da Temporada 1 que já passaram, um por um e em
// ordem, com o MESMO motor do ensaio (src/ensaio/world.ts) e as peças reais (pieces.ts). O relógio simulado manda no pregão: o universo do
// domingo, o briefing das 07:30, o ciclo das 08:00 (prazo 09:30) e o eod das 21:30, com a liquidação que ele pede. Cada ciclo nasce
// RETROATIVO, com a hora real em executed_at, e o briefing de D só vê o que o pipeline ao vivo teria visto às 07:30 de D (visibility.ts).
//
// Rodar de novo continua de onde parou: o pregão fechado e liquidado é pulado, e o par (ciclo, competidor) que já tem decisão não é decidido
// de novo (o job_run do decide barra, e o DecideHandler confere a decisão gravada). O Ctrl+C para entre duas entregas do barramento.

export interface RetroSources {
  // a carga de barras de uma janela (o market:backfill: só a falta, uma requisição por papel)
  bars: (from: IsoDate, to: IsoDate) => Promise<unknown>;
  bcb: { run(now: Date): Promise<unknown> };
  cvm: { backfill(window: CvmBackfillWindow, now: Date): Promise<unknown> };
}

export interface RetroOptions {
  prisma: PrismaService;
  // o motor montado com as peças do retroativo (relógio simulado, ciclo RETROATIVO, macro pela regra de visibilidade)
  world: ArenaWorld;
  calendar: TradingCalendar;
  dated: DatedSeasonFile;
  prompt: LoadedPrompt;
  // o último pregão que esta execução roda (inclusive)
  until: IsoDate;
  // o teto de custo desta execução, em dólares (texto decimal): antes de abrir um pregão, para se o pior caso dele passaria do teto
  capUsd: string;
  // as fontes que o retroativo lê de uma vez, antes dos pregões
  sources: RetroSources;
  // o relógio da máquina (as buscas e o executed_at); só os testes trocam
  wallClock?: () => Date;
  signal?: AbortSignal;
  log: (line: string) => void;
  // onde vão o relatório de cada pregão e o resumo (.data/temporada/); sem ele, nada é gravado em disco
  reportDir?: string;
}

// `incomplete`: um pregão terminou sem fechar e liquidar (o ciclo pulado por falta de briefing ou de orçamento, ou a liquidação que falhou): a
// execução para nele, para o pregão seguinte não seguir sobre um buraco (os briefings são congelados em ordem). Corrigida a causa, rodar de
// novo reavalia o pregão.
export type RetroOutcome = 'done' | 'cap_reached' | 'interrupted' | 'incomplete';

export interface RetroSession {
  date: IsoDate;
  // já estava fechado e liquidado (pulado) ou foi rodado agora
  status: 'already_done' | 'ran';
  cycle: string;
  costMicroUsd: bigint;
  decisions: Array<{
    slug: string;
    status: string;
    holdReason: string | null;
    costMicroUsd: bigint;
  }>;
}

export interface RetroSummary {
  outcome: RetroOutcome;
  seasonId: string;
  sessions: RetroSession[];
  // o que ESTA execução gastou (micro-dólares)
  spentMicroUsd: bigint;
  // o pregão em que o teto ou um pregão incompleto parou a execução, se parou
  stoppedAt?: IsoDate;
}

// O prompt é outro, ou a temporada do banco não é a do arquivo: nenhum ciclo abre.
export class RetroRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetroRefusedError';
  }
}

const CUTOFF_BRT = '07:30';
// a brapi aceita no máximo 90 dias entre o início e o fim de um pedido (docs/DADOS.md, seção 2): a carga vai em blocos menores
const BARS_CHUNK_DAYS = 85;
// a janela do briefing do primeiro pregão vai até o corte do pregão anterior, com no máximo 7 dias para trás (FreezeHandler); a CVM entra
// um dia antes disso, para o documento entregue na véspera do começo da janela
const CVM_LOOKBACK_DAYS = 8;

// hora de Brasília de um dia, com segundos (o cron chega alguns segundos depois da hora cheia, como no ensaio)
const brt = (date: IsoDate, hhmm: string, seconds = 0): Date =>
  new Date(brasiliaInstant(date, hhmm).getTime() + seconds * 1000);

export async function runRetro(options: RetroOptions): Promise<RetroSummary> {
  const { prisma, world, calendar, dated, prompt, log } = options;
  const wall = options.wallClock ?? (() => new Date());
  const sessions = seasonSessions(dated, calendar).filter((date) => date <= options.until);
  if (sessions.length === 0) {
    throw new RetroRefusedError(`Nenhum pregão da temporada até ${options.until}`);
  }
  const season = await ensureSeason(world, dated, prompt, wall(), log);
  const models = dated.file.competitors.filter((c) => c.kind === 'MODEL');
  const cap = parseUsdToMicro(options.capUsd);
  const costAtStart = await seasonCost(prisma, season.id);
  const summary: RetroSummary = {
    outcome: 'done',
    seasonId: season.id,
    sessions: [],
    spentMicroUsd: 0n,
  };

  const pending: IsoDate[] = [];
  for (const date of sessions) if (!(await isDone(prisma, season.id, date))) pending.push(date);
  if (pending.length > 0) await readSources(options, pending[0]!, wall);

  for (const date of sessions) {
    if (options.signal?.aborted) return { ...summary, outcome: 'interrupted' };
    if (!pending.includes(date)) {
      summary.sessions.push(await sessionReport(prisma, season.id, date, 'already_done'));
      continue;
    }
    // O teto da execução: o que esta execução já gastou mais o pior caso deste pregão (as duas chamadas de cada modelo que falta decidir).
    const spent = (await seasonCost(prisma, season.id)) - costAtStart;
    const worst = sessionCostMicro(await undecided(prisma, season.id, date, models), 'worst');
    if (spent + worst > cap) {
      log(
        `${date}: parado antes de abrir. Gasto desta execução US$ ${formatUsd(spent)} mais o pior caso do pregão US$ ` +
          `${formatUsd(worst)} passa do teto de US$ ${formatUsd(cap)} (--teto-usd)`,
      );
      return { ...summary, outcome: 'cap_reached', stoppedAt: date, spentMicroUsd: spent };
    }
    await assertPromptPinned(world, season.id, prompt);
    const finished = await runSession(options, season, date);
    const report = await sessionReport(prisma, season.id, date, 'ran');
    summary.sessions.push(report);
    log(sessionLine(report));
    if (options.reportDir) {
      await mkdir(options.reportDir, { recursive: true });
      await writeFile(
        path.join(options.reportDir, `pregao-${date}.txt`),
        `${sessionText(report)}\n`,
      );
    }
    if (finished === 'aborted') {
      summary.spentMicroUsd = (await seasonCost(prisma, season.id)) - costAtStart;
      return { ...summary, outcome: 'interrupted' };
    }
    if (finished === 'undecided') {
      log(
        `${date}: o pregão ficou com modelo sem decisão (a chamada falhou por configuração: a chave foi recusada ou está sem crédito; ` +
          'o log diz qual). A execução para antes da liquidação, para nenhum HOLD ocupar o lugar da decisão. Recarregue o crédito ou ' +
          'corrija a chave e rode de novo',
      );
      summary.spentMicroUsd = (await seasonCost(prisma, season.id)) - costAtStart;
      return { ...summary, outcome: 'incomplete', stoppedAt: date };
    }
    if (!(await isDone(prisma, season.id, date))) {
      log(
        `${date}: o pregão não fechou nem liquidou (ciclo ${report.cycle}); a execução para aqui. Corrija a causa (o log diz qual) e rode de novo`,
      );
      summary.spentMicroUsd = (await seasonCost(prisma, season.id)) - costAtStart;
      return { ...summary, outcome: 'incomplete', stoppedAt: date };
    }
  }
  summary.spentMicroUsd = (await seasonCost(prisma, season.id)) - costAtStart;
  if (options.reportDir) {
    await writeFile(
      path.join(options.reportDir, 'resumo.txt'),
      summaryText(summary, options.until),
    );
  }
  return summary;
}

// A temporada do arquivo: criada e iniciada na data dele, com o SHA-256 do prompt fixado, se ainda não existe; a que existe tem de ser a
// mesma (a data de início e o prompt). Temporada iniciada por outro caminho (season:start, painel) não tem o prompt fixado e é recusada.
async function ensureSeason(
  world: ArenaWorld,
  dated: DatedSeasonFile,
  prompt: LoadedPrompt,
  now: Date,
  log: (line: string) => void,
): Promise<SeasonRow> {
  let season = await world.arena.seasonBySlug(dated.file.slug);
  if (!season) {
    const created = await world.seasons.create(dated.file);
    log(`temporada ${created.slug} criada com ${created.models} modelos`);
    season = await world.arena.seasonById(created.id);
  }
  if (season!.status === 'DRAFT') {
    await world.seasons.start(season!.id, now, undefined, {
      startDate: dated.startDate,
      promptSha256: prompt.sha256,
    });
    log(`temporada ${dated.file.slug} iniciada em ${dated.startDate}, com o prompt fixado`);
    season = await world.arena.seasonById(season!.id);
  }
  if (season!.startDate !== dated.startDate) {
    throw new RetroRefusedError(
      `A temporada ${dated.file.slug} do banco começou em ${season!.startDate ?? '(sem data)'}, e o arquivo diz ${dated.startDate}`,
    );
  }
  await assertPromptPinned(world, season!.id, prompt);
  return season!;
}

// Nenhum ciclo abre com outro prompt: o SHA-256 do texto de agora tem de ser o que a temporada fixou ao começar. Diz só os hashes.
export async function assertPromptPinned(
  world: Pick<ArenaWorld, 'arena'>,
  seasonId: string,
  prompt: Pick<LoadedPrompt, 'sha256'>,
): Promise<void> {
  const season = await world.arena.seasonById(seasonId);
  if (!season?.promptSha256) {
    throw new RetroRefusedError(
      'A temporada não tem o prompt fixado (foi iniciada pelo season:start ou pelo painel): o retroativo e o operador só rodam a temporada que o arena:retroativo iniciou',
    );
  }
  if (season.promptSha256 !== prompt.sha256) {
    throw new RetroRefusedError(
      `O prompt de agora (SHA-256 ${prompt.sha256}) não é o que a temporada fixou ao começar (${season.promptSha256}): nenhum ciclo abre`,
    );
  }
}

// As fontes, de uma vez e com o relógio da máquina, antes do primeiro pregão que falta: as barras desde a janela do universo da semana dele
// (os 60 pregões antes da segunda-feira) até o último pregão desta execução, o BCB até hoje e a CVM com a hora em que o ao vivo teria visto
// cada documento, só os vistos até o corte do último pregão.
async function readSources(options: RetroOptions, first: IsoDate, wall: () => Date): Promise<void> {
  const { calendar, sources, until, log } = options;
  const windowStart = calendar.tradingDaysBefore(
    isoWeekMonday(isoWeek(first)),
    UNIVERSE_RULES.windowDays,
  )[0]!;
  for (let from = windowStart; from <= until; from = addDays(from, BARS_CHUNK_DAYS + 1)) {
    const to = addDays(from, BARS_CHUNK_DAYS) < until ? addDays(from, BARS_CHUNK_DAYS) : until;
    log(`barras de ${from} a ${to}: só o que falta no banco`);
    await sources.bars(from, to);
  }
  log('macro do BCB até hoje');
  await sources.bcb.run(wall());
  const window: CvmBackfillWindow = {
    from: addDays(first, -CVM_LOOKBACK_DAYS),
    to: until,
    horizon: brasiliaInstant(until, CUTOFF_BRT),
    seenAt: cvmSeenAt,
  };
  log(
    `documentos da CVM entregues de ${window.from} a ${window.to}, com a hora em que o ao vivo os veria`,
  );
  await sources.cvm.backfill(window, wall());
}

// Um pregão: os mesmos agendadores do ensaio (driver.ts), na hora de Brasília. Devolve 'aborted' se o Ctrl+C interrompeu e 'undecided' se o
// ciclo chegou ao eod ainda aberto, com modelo sem decisão.
async function runSession(
  options: RetroOptions,
  season: SeasonRow,
  date: IsoDate,
): Promise<'done' | 'aborted' | 'undecided'> {
  const { world, prisma, signal } = options;
  const steps: Array<{ at: Date; name: string }> = [];
  const week = isoWeek(date);
  if (!(await world.briefings.universe(week))) {
    steps.push({ at: brt(addDays(isoWeekMonday(week), -1), '09:00', 10), name: 'universe' });
  }
  steps.push({ at: brt(date, '07:30', 30), name: 'briefing' });
  steps.push({ at: brt(date, '08:00', 30), name: 'cycle' });
  steps.push({ at: brt(date, '21:30', 20), name: 'eod' });
  for (const step of steps) {
    await world.bus.runUntil(step.at, signal);
    if (signal?.aborted) return 'aborted';
    // Antes do eod, o ciclo ainda aberto é modelo sem decisão: a chamada falhou por configuração (chave recusada, sem crédito), que o
    // DecideHandler não transforma em HOLD. O eod liquidaria, e a varredura da liquidação gravaria HOLD "sem_resposta" no lugar da
    // decisão: a execução para aqui, e rodar de novo decide o que falta.
    if (step.name === 'eod' && (await cycleOpen(prisma, season.id, date))) return 'undecided';
    world.clock.set(step.at);
    // A liquidação de D que já rodou antes das decisões (o operador liquidou o dia sem ciclo, ou um retroativo parou no meio) é reaberta, para
    // a do eod refazer a conta com as decisões de agora (a liquidação refaz a temporada do zero; JobRunStore.reopen).
    if (step.name === 'eod') await reopenSettle(prisma, world, season.id, date);
    await runScheduler(step.name, world.schedulers, step.at);
  }
  // o que o eod pede (as novas tentativas até 00:30 e a liquidação) sai antes do pregão seguinte
  await world.bus.runUntil(brt(addDays(date, 1), '07:00'), signal);
  return signal?.aborted ? 'aborted' : 'done';
}

async function cycleOpen(prisma: PrismaService, seasonId: string, date: IsoDate): Promise<boolean> {
  const cycle = await prisma.cycle.findUnique({
    where: { seasonId_date: { seasonId, date: new Date(`${date}T00:00:00Z`) } },
    select: { status: true },
  });
  return cycle?.status === 'OPEN';
}

const settleKey = (seasonId: string, date: IsoDate) =>
  idempotencyKey({ type: 'settle', seasonId, date });

// Fechado e liquidado: o ciclo CLOSED e a liquidação do pregão concluída depois dele.
async function isDone(prisma: PrismaService, seasonId: string, date: IsoDate): Promise<boolean> {
  const cycle = await prisma.cycle.findUnique({
    where: { seasonId_date: { seasonId, date: new Date(`${date}T00:00:00Z`) } },
    select: { status: true, closedAt: true },
  });
  if (cycle?.status !== 'CLOSED' || !cycle.closedAt) return false;
  const settle = await prisma.jobRun.findUnique({
    where: { type_idempotencyKey: { type: 'settle', idempotencyKey: settleKey(seasonId, date) } },
    select: { status: true, finishedAt: true },
  });
  return settle?.status === 'SUCCEEDED';
}

async function reopenSettle(
  prisma: PrismaService,
  world: ArenaWorld,
  seasonId: string,
  date: IsoDate,
): Promise<void> {
  const settle = await prisma.jobRun.findUnique({
    where: { type_idempotencyKey: { type: 'settle', idempotencyKey: settleKey(seasonId, date) } },
    select: { status: true },
  });
  if (settle?.status === 'SUCCEEDED') {
    await world.jobs.reopen(
      { type: 'settle', seasonId, date },
      'decisões retroativas gravadas depois da liquidação do pregão',
    );
  }
}

// Os modelos que ainda não decidiram no pregão (todos, se o ciclo não existe): é o que a execução ainda pode gastar nele.
async function undecided(
  prisma: PrismaService,
  seasonId: string,
  date: IsoDate,
  models: readonly CompetitorSpec[],
): Promise<CompetitorSpec[]> {
  const decided = await prisma.decision.findMany({
    where: { cycle: { seasonId, date: new Date(`${date}T00:00:00Z`) } },
    select: { competitor: { select: { slug: true } } },
  });
  const done = new Set(decided.map((row) => row.competitor.slug));
  return models.filter((model) => !done.has(model.slug));
}

async function seasonCost(prisma: PrismaService, seasonId: string): Promise<bigint> {
  const sum = await prisma.decision.aggregate({
    where: { cycle: { seasonId } },
    _sum: { costMicroUsd: true },
  });
  return sum._sum.costMicroUsd ?? 0n;
}

async function sessionReport(
  prisma: PrismaService,
  seasonId: string,
  date: IsoDate,
  status: RetroSession['status'],
): Promise<RetroSession> {
  const cycle = await prisma.cycle.findUnique({
    where: { seasonId_date: { seasonId, date: new Date(`${date}T00:00:00Z`) } },
    select: {
      status: true,
      skipReason: true,
      mode: true,
      executedAt: true,
      decisions: {
        orderBy: { competitor: { position: 'asc' } },
        select: {
          status: true,
          holdReason: true,
          costMicroUsd: true,
          competitor: { select: { slug: true } },
        },
      },
    },
  });
  const decisions = (cycle?.decisions ?? []).map((decision) => ({
    slug: decision.competitor.slug,
    status: decision.status,
    holdReason: decision.holdReason,
    costMicroUsd: decision.costMicroUsd,
  }));
  return {
    date,
    status,
    cycle: cycle
      ? `${cycle.status}${cycle.skipReason ? ` (${cycle.skipReason})` : ''} ${cycle.mode}, rodado em ${cycle.executedAt.toISOString()}`
      : 'sem ciclo',
    costMicroUsd: decisions.reduce((total, decision) => total + decision.costMicroUsd, 0n),
    decisions,
  };
}

const sessionLine = (report: RetroSession): string =>
  `${report.date}: ciclo ${report.cycle} | ${report.decisions.length} decisões | US$ ${formatUsd(report.costMicroUsd)}`;

function sessionText(report: RetroSession): string {
  return [
    `PREGÃO ${report.date} (${report.status === 'ran' ? 'rodado agora' : 'já estava fechado'})`,
    `  ciclo ${report.cycle}`,
    `  custo US$ ${formatUsd(report.costMicroUsd)}`,
    ...report.decisions.map(
      (decision) =>
        `  ${decision.slug.padEnd(16)} ${decision.status}${decision.holdReason ? ` (${decision.holdReason})` : ''}` +
        `  US$ ${formatUsd(decision.costMicroUsd)}`,
    ),
  ].join('\n');
}

function summaryText(summary: RetroSummary, until: IsoDate): string {
  const ran = summary.sessions.filter((session) => session.status === 'ran');
  return [
    `RETROATIVO DA TEMPORADA (até ${until}), resumo de ${brasiliaDate(new Date())}`,
    `resultado: ${summary.outcome}${summary.stoppedAt ? ` (parado em ${summary.stoppedAt})` : ''}`,
    `pregões: ${summary.sessions.length} (${ran.length} rodados agora, ${summary.sessions.length - ran.length} já fechados)`,
    `gasto desta execução: US$ ${formatUsd(summary.spentMicroUsd)}`,
    '',
    ...summary.sessions.map(sessionLine),
    '',
  ].join('\n');
}

// --- o --dry-run ------------------------------------------------------------------------------------------------------------
// O que a execução faria: os pregões (fechados e a rodar), os competidores, as chamadas às LLMs e o custo estimado, típico e pior caso, pelos
// preços do arquivo. Só LÊ o banco (e nem isso, se ele ainda não existe): nenhuma chamada a LLM nem a fonte nenhuma, nenhuma escrita.
export interface RetroPlan {
  season: string;
  competitors: string[];
  sessions: Array<{ date: IsoDate; state: 'fechado' | 'a rodar'; pendingModels: number }>;
  // uma chamada por decisão que falta; até duas, com o reparo
  calls: { min: number; max: number };
  costMicroUsd: { typical: bigint; worst: bigint };
}

export async function planRetro(input: {
  prisma: PrismaService | null;
  calendar: TradingCalendar;
  dated: DatedSeasonFile;
  until: IsoDate;
}): Promise<RetroPlan> {
  const { prisma, calendar, dated, until } = input;
  const models = dated.file.competitors.filter((c) => c.kind === 'MODEL');
  const row = prisma
    ? await prisma.season.findUnique({
        where: { slug: dated.file.slug },
        select: { id: true, status: true },
      })
    : null;
  const plan: RetroPlan = {
    season: row ? `${dated.file.slug} (${row.status})` : `${dated.file.slug} (ainda não existe)`,
    competitors: dated.file.competitors.map((c) => `${c.slug} (${c.kind})`),
    sessions: [],
    calls: { min: 0, max: 0 },
    costMicroUsd: { typical: 0n, worst: 0n },
  };
  for (const date of seasonSessions(dated, calendar).filter((day) => day <= until)) {
    const done = row && prisma ? await isDone(prisma, row.id, date) : false;
    const pending = done
      ? []
      : row && prisma
        ? await undecided(prisma, row.id, date, models)
        : models;
    plan.sessions.push({
      date,
      state: done ? 'fechado' : 'a rodar',
      pendingModels: pending.length,
    });
    plan.calls.min += pending.length;
    plan.calls.max += pending.length * 2;
    plan.costMicroUsd.typical += sessionCostMicro(pending, 'typical');
    plan.costMicroUsd.worst += sessionCostMicro(pending, 'worst');
  }
  return plan;
}

export function planText(plan: RetroPlan): string {
  const pending = plan.sessions.filter((session) => session.state === 'a rodar');
  return [
    'RETROATIVO, SÓ O PLANO (--dry-run: nenhuma chamada a LLM nem a fonte, nenhuma escrita)',
    `temporada: ${plan.season}`,
    `competidores: ${plan.competitors.join(', ')}`,
    `pregões: ${plan.sessions.length} até o --ate (${pending.length} a rodar, ${plan.sessions.length - pending.length} fechados)`,
    ...plan.sessions.map(
      (session) =>
        `  ${session.date}  ${session.state}${session.state === 'a rodar' ? `  ${session.pendingModels} decisões` : ''}`,
    ),
    `chamadas às LLMs: ${plan.calls.min} (até ${plan.calls.max} com o reparo)`,
    `custo estimado, pelos preços do arquivo: típico US$ ${formatUsd(plan.costMicroUsd.typical)}, pior caso US$ ${formatUsd(plan.costMicroUsd.worst)}`,
  ].join('\n');
}
