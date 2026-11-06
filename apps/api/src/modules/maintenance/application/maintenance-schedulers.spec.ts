import { messageId, parseQueueMessage, queueFor, type QueueMessage } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MaintenanceSchedulers } from './maintenance-schedulers.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// Os dois agendadores da fila maintenance (plano 5.5 e 6): `sched-retention` (0 13 * * *, todo dia às 10:00 em Brasília) e `sched-backup`
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
  it('publica retention com a data de Brasília de agora (quarta 04/11/2026, 10:00)', async () => {
    const { schedulers, published } = setup();
    await schedulers.retention(new Date('2026-11-04T13:00:07Z'));
    expect(published).toEqual([{ type: 'retention', date: '2026-11-04' }]);
    expect(messageId(published[0]!)).toBe('retention:2026-11-04');
    expect(queueFor(published[0]!)).toBe('maintenance');
  });

  // A limpeza é diária: cada dia da semana tem a sua mensagem (e o seu job_run). Se o MessageId fosse o da semana, a limpeza de terça seria a
  // mesma de segunda e a promessa de 7 dias da política (o corte de 6 dias mais a espera de 1 dia) não se cumpriria.
  it('roda todo dia: sete dias seguidos, às 13:00 UTC, publicam sete mensagens diferentes, uma por data de Brasília', async () => {
    const { schedulers, published } = setup();
    for (let day = 2; day <= 8; day += 1) {
      await schedulers.retention(new Date(`2026-11-0${day}T13:00:03Z`)); // segunda 02/11 a domingo 08/11
    }
    expect(published.map((message) => messageId(message))).toEqual([
      'retention:2026-11-02',
      'retention:2026-11-03',
      'retention:2026-11-04',
      'retention:2026-11-05',
      'retention:2026-11-06',
      'retention:2026-11-07',
      'retention:2026-11-08',
    ]);
  });

  it('a retentativa do job (o cron atrasa uns segundos) cai no mesmo MessageId', async () => {
    const { schedulers, published } = setup();
    await schedulers.retention(new Date('2026-11-04T13:00:02Z'));
    await schedulers.retention(new Date('2026-11-04T13:04:50Z'));
    expect(new Set(published.map((message) => messageId(message))).size).toBe(1);
  });

  it('a mensagem passa pelo contrato (é o que o worker valida)', async () => {
    const { schedulers, published } = setup();
    await schedulers.retention(new Date('2026-11-04T13:00:00Z'));
    expect(parseQueueMessage(published[0]).success).toBe(true);
  });

  it('a falha da publicação sobe: o job do Container Apps tenta de novo', async () => {
    const { schedulers, messaging } = setup();
    messaging.publish.mockRejectedValueOnce(new Error('Service Bus fora'));
    await expect(schedulers.retention(new Date('2026-11-04T13:00:00Z'))).rejects.toThrow(
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
