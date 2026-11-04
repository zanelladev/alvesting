import { Logger } from '@nestjs/common';
import type { MessagingService } from '../../messaging/infrastructure/messaging.service.js';
import { NEWS_SOURCES } from '../domain/sources.js';

const HALF_HOUR_MS = 30 * 60_000;

// O slot da mensagem: a meia hora UTC a que o cron pertence, numa grafia só (sem milissegundos). Duas grafias do
// mesmo instante dariam dois MessageId e dois job_run (contracts/messages.ts). O cron dispara em :00 e :30 mas
// atrasa alguns segundos; arredondar para baixo faz a execução de retry do job cair no mesmo slot.
export function halfHourSlot(now: Date): string {
  const slot = new Date(Math.floor(now.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS);
  return slot.toISOString().replace('.000Z', 'Z');
}

// sched-news: a cada 30 minutos (*/30 * * * *, UTC), todos os dias. Só publica, uma `fetch` por fonte da lista fixa
// (ADR 0007). Notícia não depende de pregão, então não consulta o calendário.
export class NewsSchedulers {
  private readonly logger = new Logger(NewsSchedulers.name);

  constructor(private readonly messaging: Pick<MessagingService, 'publish'>) {}

  async news(now: Date): Promise<number> {
    const slot = halfHourSlot(now);
    const failed: string[] = [];
    let firstError: unknown;
    for (const source of NEWS_SOURCES) {
      try {
        await this.messaging.publish({ type: 'fetch', source: source.id, slot });
      } catch (error) {
        this.logger.warn({ source: source.id, err: error }, 'sched-news: não publicou');
        failed.push(source.id);
        firstError ??= error;
      }
    }
    // O job do Container Apps tenta de novo (2 retentativas) e a publicação é idempotente: o MessageId é o mesmo.
    // A causa da primeira falha vai na mensagem: sem ela o log do job só diria quais fontes ficaram sem publicar.
    if (failed.length > 0) {
      const cause = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(`sched-news: não publicou ${failed.join(', ')} (${cause})`);
    }
    this.logger.log({ slot, sources: NEWS_SOURCES.length }, 'sched-news: fetch publicadas');
    return NEWS_SOURCES.length;
  }
}
