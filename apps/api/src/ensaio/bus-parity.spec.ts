import { QUEUES, type QueueMessage, type QueueName } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MessagingService } from '../modules/messaging/infrastructure/messaging.service.js';
import { InProcessBus, createSimClock } from './bus.js';

// A paridade que o ensaio promete: o barramento em processo faz com uma falha o MESMO que o MessagingService de verdade (nova tentativa
// agendada para daqui a retryDelayMs x tentativa e, na última entrega, DLQ). Aqui o MessagingService roda com um ServiceBusClient falso
// que só anota o que ele pede ao broker, e o barramento roda a mesma falha. Se uma das duas contas mudar, este teste cai.

// o MessagingService registra cada falha no log; aqui a falha é o assunto, e o log só atrapalha
beforeAll(() => {
  Logger.overrideLogger(false);
});

// uma mensagem válida de cada fila
const MESSAGES: Record<QueueName, QueueMessage> = {
  market: { type: 'eod', date: '2026-11-03' },
  news: { type: 'fetch', source: 'infomoney', slot: '2026-11-03T10:00:00Z' },
  briefing: { type: 'freeze', date: '2026-11-03' },
  decisions: {
    type: 'decide',
    cycleId: '01J0000000000000000000000A',
    competitorId: '01J0000000000000000000000B',
  },
  settlement: { type: 'settle', seasonId: '01J0000000000000000000000C', date: '2026-11-03' },
  maintenance: { type: 'retention', date: '2026-11-03' },
};

interface ServiceStep {
  attempt: number;
  // o que o serviço pediu ao broker: uma cópia agendada para daqui a `delayMs` com a tentativa seguinte, ou a DLQ
  action: 'retry' | 'deadletter';
  delayMs?: number;
  nextAttempt?: number;
  reason?: string;
  description?: string;
}

// O MessagingService de verdade, entrega a entrega: a mensagem chega com a propriedade `attempt`, o handler falha, e o serviço
// decide. O broker é falso e só anota.
async function viaService(queue: QueueName): Promise<ServiceStep[]> {
  const steps: ServiceStep[] = [];
  for (let attempt = 1; attempt <= QUEUES[queue].maxDeliveryCount; attempt += 1) {
    const received = {
      messageId: 'x',
      body: MESSAGES[queue],
      applicationProperties: attempt === 1 ? undefined : { attempt },
    };
    const step: ServiceStep = { attempt, action: 'retry' };
    const client = {
      createReceiver: () => ({
        receiveMessages: () => Promise.resolve([received]),
        completeMessage: () => Promise.resolve(),
        abandonMessage: vi.fn(),
        deadLetterMessage: (
          _message: unknown,
          options: { deadLetterReason: string; deadLetterErrorDescription: string },
        ) => {
          step.action = 'deadletter';
          step.reason = options.deadLetterReason;
          step.description = options.deadLetterErrorDescription;
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      }),
      createSender: () => ({
        scheduleMessages: (
          message: { applicationProperties: { attempt: number } },
          retryAt: Date,
        ) => {
          step.delayMs = retryAt.getTime() - Date.now();
          step.nextAttempt = message.applicationProperties.attempt;
          return Promise.resolve([1]);
        },
        sendMessages: vi.fn(),
        close: () => Promise.resolve(),
      }),
      close: () => Promise.resolve(),
    };
    const service = new MessagingService(client as never);
    await service.receiveOne(queue, () => Promise.reject(new Error('provedor fora')));
    steps.push(step);
  }
  return steps;
}

describe('InProcessBus faz com a falha o mesmo que o MessagingService, em cada fila', () => {
  it.each(Object.keys(QUEUES) as QueueName[])('%s', async (queue) => {
    const real = await viaService(queue);

    const clock = createSimClock(new Date('2026-11-03T11:00:30Z'));
    const bus = new InProcessBus(
      { [queue]: () => Promise.reject(new Error('provedor fora')) },
      clock,
    );
    await bus.publish(MESSAGES[queue]);
    await bus.runUntil(new Date('2027-01-01T00:00:00Z'));

    // as mesmas entregas, na mesma numeração
    expect(bus.deliveries.map((d) => d.attempt)).toEqual(real.map((s) => s.attempt));
    expect(real).toHaveLength(QUEUES[queue].maxDeliveryCount);

    real.forEach((step, i) => {
      const delivery = bus.deliveries[i]!;
      if (step.action === 'deadletter') {
        // a última entrega: DLQ, com o mesmo motivo e a mesma descrição
        expect(delivery.action).toBe('deadletter');
        expect(bus.deadLetters).toEqual([
          expect.objectContaining({
            queue,
            reason: step.reason,
            description: step.description,
          }),
        ]);
        return;
      }
      // as outras: cópia agendada, com a tentativa seguinte, para daqui a retryDelayMs x tentativa (o serviço usa Date.now(), então
      // a conta dele tem uns milissegundos de folga)
      expect(delivery.action).toBe('retry');
      expect(step.nextAttempt).toBe(step.attempt + 1);
      const busDelay = bus.deliveries[i + 1]!.at.getTime() - delivery.at.getTime();
      expect(busDelay).toBe(QUEUES[queue].retryDelayMs * step.attempt);
      expect(Math.abs((step.delayMs ?? 0) - busDelay)).toBeLessThan(1_000);
    });
  });
});
