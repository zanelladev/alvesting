import { Logger } from '@nestjs/common';
import type { CycleMode, QueueMessage } from '@alvesting/contracts';
import type { Env } from '../../../config/env.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import {
  brasiliaDate,
  brasiliaInstant,
  monthBounds,
  type IsoDate,
} from '../../market-data/domain/dates.js';
import type { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import type { MessagingService } from '../../messaging/infrastructure/messaging.service.js';
import { parseUsdToMicro } from '../domain/cost.js';
import type {
  ArenaRepository,
  CompetitorRow,
  CycleState,
  SeasonRow,
} from '../infrastructure/arena.repository.js';
import type { CycleCloser } from './cycle-closer.js';

export type SeasonCycleResult =
  | { season: string; result: 'published'; published: number }
  | { season: string; result: 'skipped'; reason: 'sem_briefing' | 'orcamento' }
  | {
      season: string;
      result:
        | 'not_started'
        | 'season_over'
        | 'already_closed'
        // só no reprocesso do admin (rerun): na margem final antes do prazo ou depois dele, antes da hora da decisão, ou todo modelo já
        // tem decisão
        | 'past_deadline'
        | 'not_open_yet'
        | 'no_pending';
    };

// A margem do reprocesso do admin antes do prazo (09:30): a rota só publica até 5 minutos antes dele. Uma `decide` publicada nos últimos
// instantes só começa a rodar depois que a KEDA acorda o job (até 30 s de consulta mais a partida) e, se começar depois do prazo, o
// DecideHandler grava um HOLD "prazo": uma linha de decisão depois das 09:30, pedida pelo admin. 5 minutos cobrem a partida com folga e
// ainda deixam o tempo de uma chamada de modelo (o reparo exige 3, MIN_REPAIR_MS). ponytail: constante só; se a prática pedir outra
// margem, é este número (e o texto de `past_deadline` do painel, apps/web/src/lib/admin-client.ts).
export const RERUN_MARGIN_MS = 5 * 60_000;

// Alguma mensagem `decide` não foi publicada (o Service Bus não respondeu). Repetir é seguro: o MessageId é determinístico. A rota de
// reprocesso do admin responde 502 por este tipo, sem repetir a mensagem do broker.
export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

export interface CycleSchedulersDeps {
  messaging: Pick<MessagingService, 'publish'>;
  calendar: Pick<TradingCalendar, 'isTradingDay' | 'tradingDaysBetween'>;
  repo: Pick<
    ArenaRepository,
    | 'runningSeasons'
    | 'modelCompetitors'
    | 'findBriefing'
    | 'ensurePromptVersion'
    | 'upsertCycle'
    | 'monthlySpendMicroUsd'
    | 'competitorIdsWithoutDecision'
  >;
  // O sched-cycle recebe só estas duas variáveis da arena: a identidade dele não lê o prompt nem a chave do OpenRouter (ADR 0020).
  env: Pick<Env, 'PROMPT_ARENA_VERSION' | 'ARENA_MONTHLY_COST_CAP_USD'>;
  closer: Pick<CycleCloser, 'closeOverdue'>;
  // O modo do ciclo que este agendador cria (ADR 0038). Sem ele, AO_VIVO: o sched-cycle de produção e o operador local só abrem ciclo na
  // janela do próprio pregão. O arena:retroativo passa RETROATIVO, e o ensaio o escolhe por pregão (--retroativos K).
  mode?: (date: IsoDate) => CycleMode;
}

// sched-cycle: 0 11 * * 1-5 UTC = 08:00 de seg a sex em Brasília (plano 6). Só publica mensagens (ADR 0007), uma `decide` por
// competidor MODEL de cada temporada RUNNING, e só se for pregão, houver o briefing do dia e o teto de custo do mês permitir.
// Sem briefing ou sem orçamento o ciclo fica registrado como pulado, com o motivo, e nenhum modelo é chamado. Idempotente: o
// ciclo é único por temporada e pregão, e o MessageId das mensagens é determinístico, então repetir o job (2 retentativas) é
// seguro. O prompt não passa por aqui: o ciclo fixa só a versão (PROMPT_ARENA_VERSION), e o SHA-256 do texto é registrado
// pelo primeiro decide.
export class CycleSchedulers {
  private readonly logger = new Logger(CycleSchedulers.name);

  constructor(private readonly deps: CycleSchedulersDeps) {}

  async cycle(now: Date): Promise<SeasonCycleResult[]> {
    const date = brasiliaDate(now);
    if (!this.deps.calendar.isTradingDay(date)) {
      this.logger.log({ date }, 'sched-cycle: não é pregão, nada a publicar');
      return [];
    }
    // Antes do ciclo de hoje, fecha os vencidos que a fila não fechou (DLQ do broker, processo que caiu). Melhor esforço: um
    // erro aqui não pode impedir o ciclo do dia.
    try {
      await this.deps.closer.closeOverdue(now);
    } catch (error) {
      this.logger.error({ err: error }, 'sched-cycle: a varredura dos ciclos vencidos falhou');
    }

    const seasons = await this.deps.repo.runningSeasons();
    if (seasons.length === 0) {
      this.logger.log({ date }, 'sched-cycle: nenhuma temporada RUNNING');
      return [];
    }
    const version = this.promptVersion();
    const results: SeasonCycleResult[] = [];
    for (const season of seasons) results.push(await this.season(season, date, version));
    return results;
  }

  // O reprocesso a pedido do admin (POST /admin/cycles/:date/rerun, docs/API.md, seção 8): o mesmo caminho do `cycle`, mais estrito.
  //  - NUNCA nos últimos RERUN_MARGIN_MS (5 minutos) antes do prazo (09:30 de Brasília do pregão) nem depois dele: um `decide` publicado
  //    tarde só começa depois do prazo (o worker leva a KEDA e a partida do job) e gravaria HOLD "prazo", ou seja, uma decisão depois do
  //    prazo. Também não antes da hora da decisão (08:00). Um pregão antigo é sempre depois do prazo.
  //  - Só publica para o MODEL que ainda não tem decisão gravada. A decisão gravada não muda nunca (a primeira vale, ARENA.md seção 3), e
  //    a mensagem repetida de quem ainda decide é barrada pelo job_run; publicar só para quem falta evita até o ruído.
  //  - Não varre os ciclos vencidos de outros dias: quem fecha ciclo é o agendador e a liquidação, não um pedido do admin.
  // Idempotente como o agendador: o ciclo é um só por temporada e pregão, e o MessageId das mensagens é determinístico. O ciclo aberto
  // continua com o briefing e a versão do prompt que fixou; o pulado (sem briefing, orçamento) é reavaliado, como no agendador.
  async rerun(date: IsoDate, now: Date): Promise<SeasonCycleResult[]> {
    if (!this.deps.calendar.isTradingDay(date)) {
      this.logger.log({ date }, 'reprocesso do ciclo: não é pregão, nada a publicar');
      return [];
    }
    const seasons = await this.deps.repo.runningSeasons();
    if (seasons.length === 0) return [];
    const version = this.promptVersion();
    const results: SeasonCycleResult[] = [];
    for (const season of seasons) results.push(await this.season(season, date, version, { now }));
    return results;
  }

  private promptVersion(): string {
    const version = this.deps.env.PROMPT_ARENA_VERSION;
    if (!version) {
      throw new Error(
        'PROMPT_ARENA_VERSION ausente: o ciclo não sabe qual versão do prompt fixar (docs/INFRA.md, 2.7)',
      );
    }
    return version;
  }

  private async season(
    season: SeasonRow,
    date: IsoDate,
    version: string,
    rerun?: { now: Date },
  ): Promise<SeasonCycleResult> {
    const { params } = season;
    const label = season.slug;
    if (!season.startDate || date < season.startDate)
      return { season: label, result: 'not_started' };
    // o n-ésimo pregão da temporada: depois do último, o ciclo não abre (a liquidação da etapa 7 a encerra)
    if (this.deps.calendar.tradingDaysBetween(season.startDate, date).length > params.sessions) {
      this.logger.warn(
        { date, season: label },
        'sched-cycle: a temporada já passou do último pregão',
      );
      return { season: label, result: 'season_over' };
    }

    const decisionAt = brasiliaInstant(date, params.decisionTimeBrt);
    const deadlineAt = brasiliaInstant(date, params.deadlineTimeBrt);
    // antes de tocar no banco: na margem final, depois do prazo (ou antes da hora) o reprocesso não cria ciclo, nem a versão do prompt
    if (rerun && rerun.now.getTime() >= deadlineAt.getTime() - RERUN_MARGIN_MS) {
      return { season: label, result: 'past_deadline' };
    }
    if (rerun && rerun.now < decisionAt) return { season: label, result: 'not_open_yet' };

    const models = await this.deps.repo.modelCompetitors(season.id);
    const briefing = await this.deps.repo.findBriefing(date);
    let state: CycleState;
    if (!briefing) {
      state = {
        status: 'SKIPPED',
        reason: 'sem_briefing',
        briefingId: null,
        promptVersionId: null,
      };
    } else {
      const promptVersion = await this.deps.repo.ensurePromptVersion(version);
      state = (await this.overBudget(models, date))
        ? {
            status: 'SKIPPED',
            reason: 'orcamento',
            briefingId: briefing.id,
            promptVersionId: promptVersion.id,
          }
        : { status: 'OPEN', briefingId: briefing.id, promptVersionId: promptVersion.id };
    }

    const { cycle } = await this.deps.repo.upsertCycle({
      seasonId: season.id,
      date,
      decisionAt,
      deadlineAt,
      state,
      mode: this.deps.mode?.(date) ?? 'AO_VIVO',
    });
    if (cycle.status === 'SKIPPED') {
      const reason = cycle.skipReason ?? 'sem_briefing';
      // a linha do sinal `ciclo-pulado` (telemetry/alert-logs.ts): alerta na primeira vez
      this.logger.warn({ date, season: label, reason }, ALERT_LOG.cycleSkipped);
      return { season: label, result: 'skipped', reason };
    }
    if (cycle.status === 'CLOSED') return { season: label, result: 'already_closed' };

    // O reprocesso só publica para quem ainda não tem decisão; o agendador, para todos (a mensagem repetida não faz nada).
    let targets = models;
    if (rerun) {
      const missing = new Set(await this.deps.repo.competitorIdsWithoutDecision(cycle.id));
      targets = models.filter((model) => missing.has(model.id));
      if (targets.length === 0) return { season: label, result: 'no_pending' };
    }

    // Publica todas, mesmo que uma falhe; no fim sobe o erro e o job tenta de novo (publicar de novo é seguro).
    const failures: unknown[] = [];
    for (const competitor of targets) {
      const message: QueueMessage = {
        type: 'decide',
        cycleId: cycle.id,
        competitorId: competitor.id,
      };
      try {
        await this.deps.messaging.publish(message);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new PublishError(
        `sched-cycle: ${failures.length} de ${targets.length} mensagens decide não foram publicadas ` +
          `(a primeira: ${first instanceof Error ? first.message : String(first)})`,
      );
    }
    this.logger.log(
      { date, season: label, cycleId: cycle.id, published: targets.length, rerun: Boolean(rerun) },
      'sched-cycle: decide publicado para cada modelo',
    );
    return { season: label, result: 'published', published: targets.length };
  }

  // Os fakes custam zero e não dependem do teto. Com modelo pago, o gasto do mês (todas as temporadas) tem de estar abaixo do
  // teto, e sem teto configurado não se gasta (fail closed). O teto vale antes do ciclo: um ciclo que começa abaixo dele pode
  // passar um pouco, no máximo o custo de um ciclo.
  private async overBudget(models: CompetitorRow[], date: IsoDate): Promise<boolean> {
    if (models.every((model) => model.provider === 'fake')) return false;
    const cap = this.deps.env.ARENA_MONTHLY_COST_CAP_USD;
    if (cap === undefined) {
      this.logger.error(
        { date },
        'ARENA_MONTHLY_COST_CAP_USD ausente: o ciclo com modelo pago é pulado (fail closed)',
      );
      return true;
    }
    const { first, last } = monthBounds(date);
    const spent = await this.deps.repo.monthlySpendMicroUsd(first, last);
    const over = spent >= parseUsdToMicro(cap);
    if (over) {
      // só números: o gasto e o teto em micro-dólares (texto, porque bigint não vai ao Pino)
      this.logger.warn(
        { date, spentMicroUsd: spent.toString(), capMicroUsd: parseUsdToMicro(cap).toString() },
        'teto de custo do mês atingido: o ciclo é pulado',
      );
    }
    return over;
  }
}
