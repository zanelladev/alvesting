import { messageId, parseQueueMessage, queueFor, type QueueMessage } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MaintenanceSchedulers } from './maintenance-schedulers.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// Os dois agendadores da fila maintenance (plano 5.5 e 6): `sched-retention` (0 13 * * 0, domingo 10:00 em Brasília) e `sched-backup`
// (0 6 1 * *, dia 1 às 03:00). Só publicam, com MessageId determinístico (a retentativa do job cai na mesma mensagem).
const setup = () => {
  const published: QueueMessage[] = [];
  const messaging = {
    publish: vi.fn((message: QueueMessage) => {
      published.push(message);
      return Promise.resolve();
    }),
  };
  return { schedulers: new MaintenanceSchedulers(messaging), messaging, published };
};

describe('MaintenanceSchedulers.retention', () => {
  it('publica retention com a data de Brasília de agora (domingo 08/11/2026, 10:00)', async () => {
    const { schedulers, published } = setup();
    await schedulers.retention(new Date('2026-11-08T13:00:07Z'));
    expect(published).toEqual([{ type: 'retention', date: '2026-11-08' }]);
    expect(messageId(published[0]!)).toBe('retention:2026-11-08');
    expect(queueFor(published[0]!)).toBe('maintenance');
  });

  it('a retentativa do job (o cron atrasa uns segundos) cai no mesmo MessageId', async () => {
    const { schedulers, published } = setup();
    await schedulers.retention(new Date('2026-11-08T13:00:02Z'));
    await schedulers.retention(new Date('2026-11-08T13:04:50Z'));
    expect(new Set(published.map((message) => messageId(message))).size).toBe(1);
  });

  it('a mensagem passa pelo contrato (é o que o worker valida)', async () => {
    const { schedulers, published } = setup();
    await schedulers.retention(new Date('2026-11-08T13:00:00Z'));
    expect(parseQueueMessage(published[0]).success).toBe(true);
  });

  it('a falha da publicação sobe: o job do Container Apps tenta de novo', async () => {
    const { schedulers, messaging } = setup();
    messaging.publish.mockRejectedValueOnce(new Error('Service Bus fora'));
    await expect(schedulers.retention(new Date('2026-11-08T13:00:00Z'))).rejects.toThrow(
      /Service Bus fora/,
    );
  });
});

describe('MaintenanceSchedulers.backup', () => {
  it('publica backup-verify com o mês de Brasília de agora (dia 1, 03:00)', async () => {
    const { schedulers, published } = setup();
    await schedulers.backup(new Date('2026-12-01T06:00:09Z'));
    expect(published).toEqual([{ type: 'backup-verify', month: '2026-12' }]);
    expect(messageId(published[0]!)).toBe('backup-verify:2026-12');
    expect(queueFor(published[0]!)).toBe('maintenance');
  });

  it('o mês é o de Brasília, e não o de UTC: 1º de dezembro às 02:59 UTC ainda é 30 de novembro às 23:59 em Brasília', async () => {
    const { schedulers, published } = setup();
    await schedulers.backup(new Date('2026-12-01T02:59:59Z'));
    expect(published).toEqual([{ type: 'backup-verify', month: '2026-11' }]);
  });

  it('a mensagem passa pelo contrato e a falha da publicação sobe', async () => {
    const { schedulers, published, messaging } = setup();
    await schedulers.backup(new Date('2026-11-01T06:00:00Z'));
    expect(parseQueueMessage(published[0]).success).toBe(true);
    messaging.publish.mockRejectedValueOnce(new Error('Service Bus fora'));
    await expect(schedulers.backup(new Date('2026-11-01T06:00:00Z'))).rejects.toThrow(
      /Service Bus fora/,
    );
  });
});
