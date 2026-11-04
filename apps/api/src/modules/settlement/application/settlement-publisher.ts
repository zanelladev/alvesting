import { Logger } from '@nestjs/common';
import type { QueueMessage } from '@alvesting/contracts';
import type { ArenaRepository } from '../../arena/infrastructure/arena.repository.js';
import type { IsoDate } from '../../market-data/domain/dates.js';
import type { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import type { JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import type { MessagingService } from '../../messaging/infrastructure/messaging.service.js';

type SettleMessage = Extract<QueueMessage, { type: 'settle' }>;

// Alguma mensagem `settle` não foi publicada (o Service Bus não respondeu, ou não deu para reabrir o job). Repetir é seguro: o MessageId é
// determinístico e o job reaberto é reassumido. A rota do evento corporativo responde 502 por este tipo.
export class SettlementPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementPublishError';
  }
}

export interface SettlementPublisherDeps {
  seasons: Pick<ArenaRepository, 'seasonsInPlay'>;
  jobs: Pick<JobRunStore, 'reopen'>;
  messaging: Pick<MessagingService, 'publish'>;
  calendar: Pick<TradingCalendar, 'tradingDaysBetween'>;
}

// O encadeamento eod -> settle (plano 5.5 e 7). Quando o eod conclui, ele avisa aqui os pregões que acabaram de ser confirmados: o do
// próprio eod e os anteriores da janela de 5 pregões que a brapi só entregou agora (a noite em que ela esteve fora). Para cada temporada em
// andamento (ou já encerrada, se o pregão é dela) que tem algum deles, publica uma `settle`. Uma só por temporada, com o pregão mais
// novo entre os que ela tem: a liquidação refaz a temporada do zero até esse pregão, então liquida os anteriores em ordem de data. Nunca
// reabre uma liquidação (docs/DADOS.md, seção 6): o que já foi liquidado não muda sozinho, e refazê-lo é decisão do admin (RUNBOOK).
// Só publica (ADR 0007); quem liquida é o SettleHandler, no worker-data.
export class SettlementPublisher {
  private readonly logger = new Logger(SettlementPublisher.name);

  constructor(private readonly deps: SettlementPublisherDeps) {}

  // O eod repetido (a mensagem já estava concluída) também chama: se a liquidação já foi feita, a repetição é barrada pelo job_run, e se a
  // publicação anterior se perdeu, esta a repõe.
  async afterEod(days: readonly IsoDate[]): Promise<SettleMessage[]> {
    const { seasons, calendar } = this.deps;
    const messages: SettleMessage[] = [];
    for (const season of await seasons.seasonsInPlay()) {
      const { startDate, params } = season;
      if (startDate === null) continue;
      // os pregões da lista que são da temporada: do primeiro ao n-ésimo pregão dela
      const inside = days
        .filter(
          (day) =>
            day >= startDate &&
            calendar.tradingDaysBetween(startDate, day).length <= params.sessions,
        )
        .sort();
      const date = inside[inside.length - 1];
      if (date === undefined) continue;
      messages.push({ type: 'settle', seasonId: season.id, date });
    }
    const published = await this.send(messages, undefined);
    if (published.length > 0) {
      this.logger.log(
        { days, seasons: published.length },
        'eod concluído: liquidação publicada para as temporadas que têm o pregão',
      );
    }
    return published;
  }

  // O evento corporativo registrado pela api (POST /admin/corporate-events, docs/API.md, seção 8): o fator mudou o resultado de toda
  // temporada que já liquidou até a data ex, então cada uma é liquidada DE NOVO, até o pregão que ela tinha liquidado (a liquidação do zero
  // aplica o evento). A api não liquida: o papel do Postgres dela não escreve nas tabelas de resultado (ADR 0028). Ela reabre o job (a
  // mensagem repetida seria barrada) e publica; quem liquida é o worker, que depois revalida o site e limpa a borda como em toda liquidação.
  resettle(
    targets: ReadonlyArray<{ seasonId: string; date: IsoDate }>,
    reason: string,
  ): Promise<SettleMessage[]> {
    return this.send(
      targets.map(({ seasonId, date }) => ({ type: 'settle', seasonId, date })),
      reason,
    );
  }

  // Reabre (se há motivo) e publica cada mensagem, UMA POR VEZ e nesta ordem; publica todas mesmo que uma falhe e sobe o erro no fim.
  private async send(
    messages: readonly SettleMessage[],
    reopenReason: string | undefined,
  ): Promise<SettleMessage[]> {
    const { jobs, messaging } = this.deps;
    const published: SettleMessage[] = [];
    const failures: unknown[] = [];
    for (const message of messages) {
      try {
        if (reopenReason !== undefined) await jobs.reopen(message, reopenReason);
        await messaging.publish(message);
        published.push(message);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new SettlementPublishError(
        `Liquidação: ${failures.length} de ${messages.length} mensagens settle não foram publicadas ` +
          `(a primeira: ${first instanceof Error ? first.message : String(first)})`,
      );
    }
    return published;
  }
}
