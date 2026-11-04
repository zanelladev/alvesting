import { Logger } from '@nestjs/common';
import type { MessagingService } from '../../messaging/infrastructure/messaging.service.js';
import { addDays, brasiliaDate, isoWeek } from '../domain/dates.js';
import type { TradingCalendar } from '../domain/trading-calendar.js';

export type ScheduleOutcome = 'published' | 'skipped';

// Os agendadores do mercado só publicam mensagens (ADR 0007). O cron do Container Apps é em UTC; as datas são as
// de Brasília (UTC-3, sem horário de verão). O MessageId é determinístico, então repetir a publicação é seguro.
export class MarketSchedulers {
  private readonly logger = new Logger(MarketSchedulers.name);

  constructor(
    private readonly messaging: Pick<MessagingService, 'publish'>,
    private readonly calendar: Pick<TradingCalendar, 'isTradingDay'>,
  ) {}

  // sched-eod: 30 0 * * 2-6 UTC = 21:30 de seg a sex em Brasília. O pregão é a data de Brasília do fechamento,
  // e só publica se for pregão. O reagendamento (+60 min) fica com o worker.
  async eod(now: Date): Promise<ScheduleOutcome> {
    const date = brasiliaDate(now);
    if (!this.calendar.isTradingDay(date)) {
      this.logger.log({ date }, 'sched-eod: não é pregão, nada a publicar');
      return 'skipped';
    }
    await this.messaging.publish({ type: 'eod', date });
    this.logger.log({ date }, 'sched-eod: eod publicado');
    return 'published';
  }

  // sched-universe: 0 12 * * 0 UTC = domingo 09:00 em Brasília. O universo refeito no domingo vale para a
  // semana que começa amanhã: a semana ISO de segunda-feira.
  async universe(now: Date): Promise<ScheduleOutcome> {
    const week = isoWeek(addDays(brasiliaDate(now), 1));
    await this.messaging.publish({ type: 'universe', week });
    this.logger.log({ week }, 'sched-universe: universe publicado');
    return 'published';
  }
}
