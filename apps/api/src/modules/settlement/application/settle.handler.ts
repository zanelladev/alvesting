import { Logger } from '@nestjs/common';
import type { QueueMessage } from '@alvesting/contracts';
import { isoWeek, type IsoDate } from '../../market-data/domain/dates.js';
import type { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { JobBusyError, type JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import type { CycleCloser } from '../../arena/application/cycle-closer.js';
import type { ArenaRepository } from '../../arena/infrastructure/arena.repository.js';
import { monteCarlo } from '../domain/monte-carlo.js';
import { seasonStats } from '../domain/season-stats.js';
import { simulateSeason } from '../domain/simulation.js';
import type { SettlementRepository } from '../infrastructure/settlement.repository.js';
import type { CacheRefresher } from './cache-refresher.js';
import { buildPlan, derivedRows } from './settlement-plan.js';

type SettleMessage = Extract<QueueMessage, { type: 'settle' }>;

export type SettleOutcome =
  // a mensagem repetida de uma liquidação já feita: nada mudou
  | { status: 'already_done' }
  // `through`: até que pregão a temporada foi recalculada; `finished`: esta liquidação encerrou a temporada
  | { status: 'settled'; through: IsoDate; sessions: number; finished: boolean };
type Settled = Extract<SettleOutcome, { status: 'settled' }>;

export interface SettleDeps {
  jobs: Pick<JobRunStore, 'claim' | 'succeed' | 'fail'>;
  arena: Pick<ArenaRepository, 'seasonById'>;
  closer: Pick<CycleCloser, 'closeOverdue'>;
  repo: Pick<
    SettlementRepository,
    | 'locked'
    | 'lastSettledDate'
    | 'competitors'
    | 'decisionItems'
    | 'bars'
    | 'universes'
    | 'cdi'
    | 'events'
    | 'replace'
    | 'finishSeason'
  >;
  calendar: Pick<TradingCalendar, 'tradingDaysBetween'>;
  clock?: () => Date;
  // Depois de uma liquidação concluída: revalida o site e limpa o cache do Front Door (etapa 9). Só o worker o liga; o comando
  // settle:event e o ensaio não passam por ele.
  cache?: Pick<CacheRefresher, 'afterSettle'>;
}

// A mensagem `settle {temporada, pregão}` (plano 5.5, 6 e 7): recalcula a temporada do zero até o pregão e grava o resultado.
// Passos: job_run (a idempotência da mensagem); a varredura dos ciclos vencidos (quem não decidiu ganha HOLD); a trava consultiva
// da temporada; ler decisões, barras, universo, CDI e eventos; simular os competidores, o Sorteio e as referências; rodar o
// Monte Carlo; calcular as métricas; substituir as linhas derivadas e, no último pregão, encerrar a temporada. Tudo de ler a
// gravar acontece numa transação só, dentro da trava. Docs: docs/METODOLOGIA.md ("Liquidação, referências e métricas") e
// docs/JOBS.md.
//
// Até onde a conta vai: até o maior entre o pregão da mensagem e o último já liquidado. Uma liquidação de pregão antigo (uma
// cópia que chega tarde, a reliquidação de um dia cujas barras mudaram) refaz também os pregões seguintes, em vez de deixar o
// resultado de depois calculado sobre o dado velho; e nunca encolhe a temporada.
export class SettleHandler {
  private readonly logger = new Logger(SettleHandler.name);
  private readonly clock: () => Date;

  constructor(private readonly deps: SettleDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  // A função da fila: o MessagingService passa a mensagem já validada.
  readonly handle = async (message: QueueMessage): Promise<void> => {
    if (message.type !== 'settle') {
      // handleDelivery já manda para a DLQ o que é de outra fila; isto é só a rede de segurança
      throw new Error(`A fila settlement não trata mensagens ${message.type}`);
    }
    await this.execute(message);
  };

  async execute(message: SettleMessage, now: Date = this.clock()): Promise<SettleOutcome> {
    const claimed = await this.deps.jobs.claim(message, now);
    if (claimed.status === 'done') return { status: 'already_done' };
    if (claimed.status === 'busy') throw new JobBusyError(message);

    let outcome: Settled;
    try {
      outcome = await this.settle(message, now);
      await this.deps.jobs.succeed(claimed.claim);
    } catch (error) {
      await this.deps.jobs.fail(claimed.claim, error);
      throw error;
    }
    // Fora do try de propósito: o resultado já está gravado e o job, concluído. Se o site ou a borda não atenderem, o
    // tempo de vida do cache público limita o atraso; falhar aqui só faria a fila repetir uma liquidação que já foi feita.
    await this.refreshCache();
    return outcome;
  }

  private async refreshCache(): Promise<void> {
    if (!this.deps.cache) return;
    try {
      await this.deps.cache.afterSettle();
    } catch (error) {
      // o CacheRefresher não lança; isto é só a rede de segurança de quem o troque. Só o nome do erro: a mensagem pode ter segredo.
      this.logger.warn(
        { erro: error instanceof Error ? error.name : 'desconhecido' },
        'a revalidação do cache público falhou depois da liquidação: o tempo de vida do cache limita o atraso',
      );
    }
  }

  private async settle(message: SettleMessage, now: Date): Promise<Settled> {
    const { arena, closer, repo, calendar } = this.deps;
    const season = await arena.seasonById(message.seasonId);
    if (!season) throw new Error('Temporada inexistente');
    const { startDate, params } = season;
    if (season.status === 'DRAFT' || startDate === null) {
      throw new Error(`A temporada ${season.slug} ainda não começou (DRAFT): nada a liquidar`);
    }

    // Antes de ler as decisões do dia: o ciclo vencido que a fila não fechou fecha agora, e quem não decidiu ganha HOLD
    // "sem_resposta" (docs/ARENA.md, seção 5). Fora da trava: é do ciclo, não do resultado da temporada.
    await closer.closeOverdue(now);

    const started = performance.now();
    // Tudo abaixo lê e grava pelo `db` da transação. Usar o repositório de fora seguraria outra conexão do pool (de 4) enquanto
    // esta espera a trava, e duas liquidações da mesma temporada travariam uma à outra.
    const outcome = await repo.locked(season.id, async (db): Promise<Settled> => {
      const settled = await repo.lastSettledDate(db, season.id);
      const end = settled !== null && settled > message.date ? settled : message.date;
      const sessions = calendar.tradingDaysBetween(startDate, end);
      if (sessions[sessions.length - 1] !== end) {
        throw new RangeError(
          `${end} não é um pregão da temporada ${season.slug} (que começa em ${startDate})`,
        );
      }
      if (sessions.length > params.sessions) {
        throw new RangeError(
          `${end} é depois do último pregão da temporada ${season.slug} (${sessions[params.sessions - 1]})`,
        );
      }

      const plan = buildPlan({
        params,
        sessions,
        competitors: await repo.competitors(db, season.id),
        items: await repo.decisionItems(db, season.id, end),
        bars: await repo.bars(db, startDate, end),
        universes: await repo.universes(db, [...new Set(sessions.map(isoWeek))]),
        cdi: await repo.cdi(db, end),
        events: await repo.events(db, startDate, end),
      });
      const startingCashCents = BigInt(params.capitalCents);
      const rules = {
        tradeCostBps: BigInt(params.tradeCostBps),
        maxPositions: params.maxPositions,
      };
      const runs = simulateSeason({
        market: plan.market,
        startingCashCents,
        rules,
        competitors: plan.competitors,
      });
      const mc = monteCarlo({
        market: plan.market,
        startingCashCents,
        rules,
        seed: params.monteCarloSeed,
        runs: params.monteCarloRuns,
        competitors: runs,
      });
      const stats = seasonStats({ startingCashCents, runs, monteCarlo: mc });
      await repo.replace(
        db,
        season.id,
        derivedRows({ seasonId: season.id, plan, runs, mc, stats }),
      );

      // O último pregão encerra a temporada na mesma transação da última liquidação: sem isso ela ficaria RUNNING para sempre e
      // o freeze e o sched-cycle a tratariam como em andamento (docs/ARENA.md, seção 10).
      const finished =
        sessions.length === params.sessions && (await repo.finishSeason(db, season.id, now));
      return { status: 'settled', through: end, sessions: sessions.length, finished };
    });

    this.logger.log(
      {
        season: season.slug,
        requested: message.date,
        through: outcome.through,
        sessions: outcome.sessions,
        finished: outcome.finished,
        ms: Math.round(performance.now() - started),
      },
      'temporada liquidada do zero',
    );
    return outcome;
  }
}
