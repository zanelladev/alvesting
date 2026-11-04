import { Logger } from '@nestjs/common';
import { brasiliaDate } from '../../market-data/domain/dates.js';
import type { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import type { MessagingService } from '../../messaging/infrastructure/messaging.service.js';

export type BriefingScheduleOutcome = 'published' | 'skipped';

// sched-briefing: 30 10 * * 1-5 UTC = 07:30 de seg a sex em Brasília (plano 6). Só publica `freeze {pregão}`, e só se
// o dia for pregão: o cron não sabe de feriado. O pregão é a data de Brasília de agora. O MessageId é determinístico
// (freeze:2026-10-30), então repetir a publicação é seguro.
export class BriefingSchedulers {
  private readonly logger = new Logger(BriefingSchedulers.name);

  constructor(
    private readonly messaging: Pick<MessagingService, 'publish'>,
    private readonly calendar: Pick<TradingCalendar, 'isTradingDay'>,
  ) {}

  async briefing(now: Date): Promise<BriefingScheduleOutcome> {
    const date = brasiliaDate(now);
    if (!this.calendar.isTradingDay(date)) {
      this.logger.log({ date }, 'sched-briefing: não é pregão, nada a publicar');
      return 'skipped';
    }
    await this.messaging.publish({ type: 'freeze', date });
    this.logger.log({ date }, 'sched-briefing: freeze publicado');
    return 'published';
  }
}
