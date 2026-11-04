import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  corporateEventResultSchema,
  cycleRerunSchema,
  type CorporateEventBody,
  type CorporateEventResult,
  type CycleRerun,
  type DlqResubmit,
  type DlqResubmitBody,
  type QueueName,
} from '@alvesting/contracts';
import { AUDIT_ACTIONS } from '../../../common/audit.js';
import { redactPii } from '../../../common/redact.js';
import { ENV, type Env } from '../../../config/env.js';
import {
  PublishError,
  CycleSchedulers,
  type SeasonCycleResult,
} from '../../arena/application/cycle-schedulers.js';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { MessagingService } from '../../messaging/infrastructure/messaging.service.js';
import {
  CorporateEventInputError,
  recordCorporateEvent,
} from '../../settlement/application/corporate-event.service.js';
import {
  SettlementPublishError,
  SettlementPublisher,
} from '../../settlement/application/settlement-publisher.js';
import { SettlementRepository } from '../../settlement/infrastructure/settlement.repository.js';
import { ADMIN_CLOCK, type AdminClock } from '../admin.tokens.js';
import { AdminAudit } from './admin-audit.js';

const toRerunResult = (result: SeasonCycleResult): CycleRerun['seasons'][number] => ({
  season: result.season,
  result: result.result,
  ...(result.result === 'published' ? { published: result.published } : {}),
  ...(result.result === 'skipped' ? { reason: result.reason } : {}),
});

// As três operações do admin que mexem com o Service Bus (POST /admin/cycles/:date/rerun, /admin/dlq/:queue/resubmit e
// /admin/corporate-events; docs/API.md, seção 8). Cada uma grava a trilha de auditoria ANTES (admin-audit.ts) e é idempotente.
@Injectable()
export class AdminOpsService {
  private readonly logger = new Logger(AdminOpsService.name);

  constructor(
    private readonly schedulers: CycleSchedulers,
    private readonly messaging: MessagingService,
    private readonly settlementRepo: SettlementRepository,
    private readonly settlePublisher: SettlementPublisher,
    private readonly calendar: TradingCalendar,
    private readonly audit: AdminAudit,
    @Inject(ENV) private readonly env: Env,
    @Inject(ADMIN_CLOCK) private readonly clock: AdminClock,
  ) {}

  // O reprocesso do ciclo: o mesmo caminho do agendador, só até 5 minutos antes do prazo das 09:30 (RERUN_MARGIN_MS) e só para quem ainda
  // não decidiu (CycleSchedulers.rerun).
  async rerunCycle(date: IsoDate, actor: string): Promise<CycleRerun> {
    // A api não tem o prompt (só a versão, que não é segredo): o ciclo fixa a versão, e o job de decisões confere o texto.
    if (!this.env.PROMPT_ARENA_VERSION) {
      throw new ServiceUnavailableException({
        code: 'NOT_CONFIGURED',
        message:
          'A api não tem PROMPT_ARENA_VERSION: sem a versão do prompt o ciclo não pode ser reprocessado (docs/INFRA.md, 2.7).',
      });
    }
    if (!this.calendar.covers(date) || !this.calendar.isTradingDay(date)) {
      throw new ConflictException({
        code: 'NOT_A_TRADING_DAY',
        message: `${date} não é pregão (ou está fora do calendário da B3 que a api tem): não há ciclo a reprocessar.`,
      });
    }
    await this.audit.record({ actor, action: AUDIT_ACTIONS.cycleRerun, detail: { date } }, date);
    try {
      const results = await this.schedulers.rerun(date, this.clock());
      return cycleRerunSchema.parse({ date, seasons: results.map(toRerunResult) });
    } catch (error) {
      if (!(error instanceof PublishError)) throw error;
      this.logger.error({ date }, redactPii(error.message));
      throw new BadGatewayException({
        code: 'PUBLISH_FAILED',
        message:
          'Nem todas as mensagens foram publicadas no Service Bus. Repita o reprocesso: é seguro, o MessageId é o mesmo.',
      });
    }
  }

  // O reenvio da DLQ: cada MessageId volta à fila de origem (MessagingService.resubmitDeadLetter, que só tira da DLQ depois de publicar).
  // Idempotente: o que já saiu da DLQ responde not_found, sem publicar de novo.
  async resubmit(queue: QueueName, body: DlqResubmitBody, actor: string): Promise<DlqResubmit> {
    await this.audit.record(
      {
        actor,
        action: AUDIT_ACTIONS.dlqResubmit,
        detail: { queue, messageIds: body.messageIds },
      },
      queue,
    );
    const results: DlqResubmit['results'] = [];
    try {
      for (const messageId of body.messageIds) {
        results.push({
          messageId,
          result: await this.messaging.resubmitDeadLetter(queue, messageId),
        });
      }
    } catch (error) {
      // o erro do SDK pode trazer o endereço do namespace: vai ao log, limpo, e não à resposta
      this.logger.error(
        { queue },
        redactPii(String(error instanceof Error ? error.message : error)),
      );
      throw new ServiceUnavailableException({
        code: 'SERVICE_BUS_UNAVAILABLE',
        message:
          'O Service Bus não respondeu. O reenvio é idempotente: o que já saiu da DLQ não sai de novo, então repita.',
      });
    }
    return { queue, results };
  }

  // O evento corporativo: registra o evento (com a auditoria no mesmo passo), reabre o job da liquidação de cada temporada que já liquidou
  // até a data ex e PUBLICA a `settle` dela na fila; o worker liquida. A api não reliquida na requisição: o papel do Postgres dela não
  // escreve nas tabelas de resultado da arena (ADR 0028), e uma temporada de 20 pregões em 0,25 vCPU nem caberia com folga nos 60 s do Front
  // Door. A resposta diz o que ficou ENFILEIRADO. Idempotente: repetir não muda o evento e enfileira de novo (reabre o job outra vez).
  async registerCorporateEvent(
    body: CorporateEventBody,
    actor: string,
  ): Promise<CorporateEventResult> {
    await this.audit.record(
      { actor, action: AUDIT_ACTIONS.corporateEvent, detail: { ...body } },
      `${body.ticker}:${body.exDate}`,
    );
    try {
      const { event, due, pending } = await recordCorporateEvent(this.settlementRepo, body, actor);
      await this.settlePublisher.resettle(
        due.map(({ seasonId, through }) => ({ seasonId, date: through })),
        `evento corporativo ${event.ticker} (${event.exDate}): liquidar de novo`,
      );
      return corporateEventResultSchema.parse({
        event: {
          ticker: event.ticker,
          exDate: event.exDate,
          kind: event.kind,
          ratioFrom: event.ratioFrom,
          ratioTo: event.ratioTo,
          change: event.change,
        },
        queued: due.map(({ slug, through }) => ({ season: slug, through })),
        pending,
      });
    } catch (error) {
      if (error instanceof CorporateEventInputError) {
        throw new BadRequestException({ code: 'INVALID_EVENT', message: error.message });
      }
      if (error instanceof SettlementPublishError) {
        // o erro do SDK pode trazer o endereço do namespace: vai ao log, limpo, e não à resposta
        this.logger.error({ ticker: body.ticker, exDate: body.exDate }, redactPii(error.message));
        throw new BadGatewayException({
          code: 'PUBLISH_FAILED',
          message:
            'O evento ficou registrado, mas nem toda liquidação foi enfileirada no Service Bus. Repita: é seguro, o evento não muda e o MessageId é o mesmo.',
        });
      }
      throw error;
    }
  }
}
