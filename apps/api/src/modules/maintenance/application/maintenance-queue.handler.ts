import type { QueueMessage } from '@alvesting/contracts';

// O handler da fila `maintenance` (worker-data, 3 entregas, concorrência 1; plano 5.5): despacha `retention {data}` para a retenção e
// `backup-verify {mês}` para o backup-verify. Cada executor assume a própria linha de job_run (idempotência pelo MessageId) e é o que
// escreve a linha do alerta de job falho.
export class MaintenanceQueueHandler {
  constructor(
    private readonly retention: { execute(date: string): Promise<unknown> },
    private readonly backup: { execute(month: string): Promise<unknown> },
  ) {}

  readonly handle = async (message: QueueMessage): Promise<void> => {
    switch (message.type) {
      case 'retention':
        await this.retention.execute(message.date);
        return;
      case 'backup-verify':
        await this.backup.execute(message.month);
        return;
      default:
        // handleDelivery já manda para a DLQ o que é de outra fila; isto é só a rede de segurança
        throw new Error(`A fila maintenance não trata mensagens ${message.type}`);
    }
  };
}
