import { Logger } from '@nestjs/common';
import { brasiliaDate } from '../../market-data/domain/dates.js';
import type { MessagingService } from '../../messaging/infrastructure/messaging.service.js';

// Os agendadores da fila `maintenance` só publicam (ADR 0007). O cron do Container Apps é em UTC; as datas são as de Brasília (UTC-3, sem
// horário de verão). O MessageId é determinístico (`retention:2026-11-08`, `backup-verify:2026-11`), então a retentativa do job é segura.
export class MaintenanceSchedulers {
  private readonly logger = new Logger(MaintenanceSchedulers.name);

  constructor(private readonly messaging: Pick<MessagingService, 'publish'>) {}

  // sched-retention: 0 13 * * * UTC = todo dia às 10:00 em Brasília. A limpeza que a política de privacidade promete (sessões vencidas,
  // pedidos de uso único vencidos, cadastros nunca confirmados) e a dos job_run do `fetch`: RetentionHandler. A cadência faz parte da
  // promessa (o corte do cadastro, 6 dias, mais a espera de 1 dia até a limpeza seguinte): mudar o cron é mudar a política.
  async retention(now: Date): Promise<void> {
    const date = brasiliaDate(now);
    await this.messaging.publish({ type: 'retention', date });
    this.logger.log({ date }, 'sched-retention: retention publicado');
  }

  // sched-backup: 0 6 1 * * UTC = dia 1, 03:00 em Brasília. O mês é o de Brasília: 1º de dezembro às 02:59 UTC ainda é novembro lá.
  async backup(now: Date): Promise<void> {
    const month = brasiliaDate(now).slice(0, 7);
    await this.messaging.publish({ type: 'backup-verify', month });
    this.logger.log({ month }, 'sched-backup: backup-verify publicado');
  }
}
