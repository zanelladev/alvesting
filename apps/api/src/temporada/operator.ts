import type { ArenaWorld } from '../ensaio/world.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import { RERUN_MARGIN_MS } from '../modules/arena/application/cycle-schedulers.js';
import { formatUsd } from '../modules/arena/domain/cost.js';
import {
  addDays,
  brasiliaDate,
  brasiliaInstant,
  type IsoDate,
} from '../modules/market-data/domain/dates.js';
import type { TradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { runScheduler } from '../role.js';
import { AGENDA, occurrences, type AgendaJob } from './agenda.js';
import type { LoadedPrompt } from './pieces.js';
import { assertPromptPinned } from './retro.js';

// O operador local (arena:operar; ADR 0038): enquanto a Azure não existe, o Mac roda a arena AO VIVO nos horários de produção (agenda.ts),
// com o mesmo motor do ensaio, as peças reais e o barramento do processo. Cada volta (`tick`) roda o que venceu desde a anterior, em ordem
// de horário, e entrega o que a fila tem. Se o Mac dormiu ou desligou, a volta seguinte vê o buraco e roda o que ainda está na janela.
//
// As regras do ciclo ao vivo, nesta ordem (cada recusa vai para o log e não abre nada):
//  1. NUNCA abre "ao vivo" atrasado: passado o prazo das 09:30, menos a margem do reprocesso (5 min), o pregão não ganha ciclo ao vivo; o dia
//     fica para o arena:retroativo, que o marca como retroativo;
//  2. o prompt é o que a temporada fixou ao começar;
//  3. todo pregão anterior da temporada tem ciclo resolvido (fechado ou pulado): o retroativo alcançou o presente;
//  4. o pregão que já tem ciclo não ganha outro: o ciclo ao vivo aberto (o operador reiniciou no meio dele) é retomado só para quem não decidiu;
//  5. o saldo do provedor cobre o pior caso do pregão (credit.ts): sem crédito a chamada falha, a decisão fica por fazer e a varredura do
//     prazo gravaria HOLD "sem_resposta"; sem ciclo ao vivo, o dia fica para o arena:retroativo. Saldo que não pôde ser lido também não abre.
// No `--so-dados` não há briefing nem ciclo (nem liquidação: localPieces), só a coleta (notícias, eod, universo com os logos e limpeza).

const HEARTBEAT_MS = 30 * 60_000;
// o que a primeira volta olha para trás: a noite em que o Mac dormiu; o universo, a semana inteira
const LOOKBACK_MS = 26 * 3_600_000;
const UNIVERSE_LOOKBACK_MS = 7 * 86_400_000;
const ORDER: readonly AgendaJob[] = ['universe', 'eod', 'retention', 'news', 'briefing', 'cycle'];

export interface OperatorOptions {
  prisma: PrismaService;
  // o motor montado com as peças do operador (localPieces, modo ao-vivo ou so-dados)
  world: ArenaWorld;
  calendar: TradingCalendar;
  seasonSlug: string;
  prompt: Pick<LoadedPrompt, 'sha256'>;
  dataOnly: boolean;
  log: (line: string) => void;
  // a regra 5: o saldo do provedor e o pior caso de um pregão; sem isto (a temporada só com o fake, os testes do ensaio), não confere
  credit?: { remainingMicroUsd: () => Promise<bigint>; worstMicroUsd: bigint };
}

export interface Operator {
  tick(now: Date, signal?: AbortSignal): Promise<void>;
}

export function createOperator(options: OperatorOptions): Operator {
  const { world, log } = options;
  let last: Date | undefined;
  let lastBeat: Date | undefined;

  const due = (now: Date): Array<{ job: AgendaJob; at: Date }> => {
    const list: Array<{ job: AgendaJob; at: Date }> = [];
    for (const job of ORDER) {
      if (options.dataOnly && (job === 'briefing' || job === 'cycle')) continue;
      const from =
        last ?? new Date(now.getTime() - (job === 'universe' ? UNIVERSE_LOOKBACK_MS : LOOKBACK_MS));
      let found = occurrences(AGENDA[job], from, now);
      // a fonte de notícia devolve o que tem agora: rodar as meias-horas perdidas uma por uma buscaria o mesmo feed de novo
      if (job === 'news') found = found.slice(-1);
      for (const at of found) list.push({ job, at });
    }
    return list.sort(
      (a, b) => a.at.getTime() - b.at.getTime() || ORDER.indexOf(a.job) - ORDER.indexOf(b.job),
    );
  };

  return {
    async tick(now, signal) {
      world.clock.set(now);
      for (const { job, at } of due(now)) {
        if (signal?.aborted) return;
        try {
          if (job === 'cycle') await liveCycle(options, brasiliaDate(at), now);
          else if (job === 'briefing') await liveBriefing(options, brasiliaDate(at), at, now);
          else await runScheduler(job, world.schedulers, at);
        } catch (error) {
          log(
            `erro em ${job} de ${at.toISOString()}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        // o que o passo publicou sai antes do passo seguinte (o eod da véspera antes do briefing do dia)
        await world.bus.runUntil(now, signal);
      }
      await world.bus.runUntil(now, signal);
      last = now;
      if (!lastBeat || now.getTime() - lastBeat.getTime() >= HEARTBEAT_MS) {
        lastBeat = now;
        log(
          `batimento: ${options.dataOnly ? 'só dados' : 'ao vivo'}, temporada ${options.seasonSlug}, ${world.bus.pending()} mensagens agendadas na fila`,
        );
      }
    },
  };
}

// O briefing ao vivo só até o prazo do dia: depois, quem congela o pregão é o retroativo, com a regra de visibilidade.
async function liveBriefing(
  options: OperatorOptions,
  date: IsoDate,
  at: Date,
  now: Date,
): Promise<void> {
  const season = await options.world.arena.seasonBySlug(options.seasonSlug);
  const deadline = brasiliaInstant(date, season?.params.deadlineTimeBrt ?? '09:30');
  if (now >= deadline) {
    options.log(
      `${date}: o briefing não foi congelado ao vivo (passou do prazo); o arena:retroativo o congela`,
    );
    return;
  }
  await runScheduler('briefing', options.world.schedulers, at);
}

async function liveCycle(options: OperatorOptions, date: IsoDate, now: Date): Promise<void> {
  const { world, prisma, calendar, log } = options;
  if (!calendar.isTradingDay(date)) return;
  const season = await world.arena.seasonBySlug(options.seasonSlug);
  if (!season || season.status !== 'RUNNING' || !season.startDate || date < season.startDate) {
    log(`${date}: nenhuma temporada ${options.seasonSlug} em andamento neste pregão; nada a abrir`);
    return;
  }
  // 1. nunca ao vivo atrasado
  const deadline = brasiliaInstant(date, season.params.deadlineTimeBrt);
  if (now.getTime() >= deadline.getTime() - RERUN_MARGIN_MS) {
    log(
      `${date}: a janela da decisão passou (prazo ${deadline.toISOString()}, agora ${now.toISOString()}): o pregão NÃO ganha ` +
        'ciclo ao vivo. Cubra o dia com o arena:retroativo (RUNBOOK, operador local)',
    );
    return;
  }
  // 2. o prompt fixado pela temporada
  try {
    await assertPromptPinned(world, season.id, options.prompt);
  } catch (error) {
    log(`${date}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  // 3. todo pregão anterior resolvido
  const previous = calendar.tradingDaysBetween(season.startDate, addDays(date, -1));
  const cycles = await prisma.cycle.findMany({
    where: { seasonId: season.id, date: { lte: new Date(`${date}T00:00:00Z`) } },
    select: { date: true, status: true, mode: true },
  });
  const byDate = new Map(cycles.map((cycle) => [cycle.date.toISOString().slice(0, 10), cycle]));
  const open = previous.filter((day) => (byDate.get(day)?.status ?? 'OPEN') === 'OPEN');
  if (open.length > 0) {
    log(
      `${date}: não abre ao vivo: ${open.length} pregão(ões) anterior(es) da temporada sem ciclo fechado (o primeiro: ${open[0]}). ` +
        'Rode o arena:retroativo até o pregão anterior',
    );
    return;
  }
  // 4. o pregão que já tem ciclo não ganha outro (o ciclo ao vivo aberto é retomado para quem não decidiu)
  const existing = byDate.get(date);
  const resume = existing?.mode === 'AO_VIVO' && existing.status === 'OPEN';
  if (existing && !resume) {
    log(`${date}: o pregão já tem ciclo (${existing.mode}, ${existing.status}); nada a abrir`);
    return;
  }
  // 5. o saldo do provedor cobre o pior caso do pregão
  if (!(await creditCovers(options, date))) return;
  if (resume) {
    const results = await world.cycles.rerun(date, now);
    log(`${date}: ciclo ao vivo aberto retomado para quem não decidiu: ${JSON.stringify(results)}`);
    return;
  }
  await runScheduler('cycle', world.schedulers, now);
  log(`${date}: ciclo ao vivo aberto`);
}

async function creditCovers(options: OperatorOptions, date: IsoDate): Promise<boolean> {
  const { credit, log } = options;
  if (!credit) return true;
  let remaining: bigint;
  try {
    remaining = await credit.remainingMicroUsd();
  } catch (error) {
    log(
      `${date}: não abre ao vivo: o saldo do provedor não pôde ser lido (${error instanceof Error ? error.message : String(error)}). ` +
        'Cubra o dia com o arena:retroativo',
    );
    return false;
  }
  if (remaining < credit.worstMicroUsd) {
    log(
      `${date}: não abre ao vivo: o saldo do provedor (US$ ${formatUsd(remaining)}) não cobre o pior caso do pregão ` +
        `(US$ ${formatUsd(credit.worstMicroUsd)}). Recarregue e cubra o dia com o arena:retroativo`,
    );
    return false;
  }
  return true;
}

// O laço do processo: uma volta a cada `everyMs`, até o pedido de parada. A volta que falha vai para o log e a seguinte tenta de novo.
export async function runOperator(
  operator: Operator,
  options: { signal: AbortSignal; everyMs?: number; log: (line: string) => void },
): Promise<void> {
  const everyMs = options.everyMs ?? 20_000;
  while (!options.signal.aborted) {
    try {
      await operator.tick(new Date(), options.signal);
    } catch (error) {
      options.log(`erro na volta: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, everyMs);
      options.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
        once: true,
      });
    });
  }
}
