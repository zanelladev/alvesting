import { ServiceBusClient, type ServiceBusReceiver } from '@azure/service-bus';
import Long from 'long';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { QUEUES, type QueueMessage, type QueueName } from '@alvesting/contracts';
import { MessagingService } from './messaging.service.js';

// Integração com o emulador oficial do Service Bus (docker compose --profile servicebus up -d).
// Roda no CI com SERVICEBUS_EMULATOR=1; sem isso aparece como pulado, com o motivo no nome.
// maintenance tem 3 tentativas (QUEUES e docker/servicebus/Config.json), o que mantém o teste de DLQ curto.
// RETRY_MS: espera base entre tentativas nos testes (a de produção é de minutos, ADR 0015).
const RETRY_MS = 2_000;
const enabled = process.env.SERVICEBUS_EMULATOR === '1';
const title = enabled
  ? 'MessagingService com o emulador do Service Bus'
  : 'MessagingService com o emulador do Service Bus [pulado: defina SERVICEBUS_EMULATOR=1 e SERVICEBUS_CONNECTION_STRING com o emulador no ar, ver docs/adr/0001-emulador-service-bus-em-profile.md]';

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condição não atendida em ${timeoutMs} ms`);
}

async function drain(receiver: ServiceBusReceiver) {
  for (;;) {
    const batch = await receiver.receiveMessages(50, { maxWaitTimeInMs: 1_000 });
    if (batch.length === 0) return;
    await Promise.all(batch.map((m) => receiver.completeMessage(m)));
  }
}

describe.skipIf(!enabled)(title, () => {
  let bus: ServiceBusClient;
  let service: MessagingService;
  const consumers: Array<{ close: () => Promise<void> }> = [];

  const retention = (date: string): QueueMessage => ({ type: 'retention', date });

  async function drainQueue(queue: QueueName) {
    for (const subQueueType of [undefined, 'deadLetter'] as const) {
      const receiver = bus.createReceiver(queue, subQueueType ? { subQueueType } : {});
      try {
        await drain(receiver);
      } finally {
        await receiver.close();
      }
    }
  }

  // Quantas mensagens a fila ainda tem. O peek enxerga até a mensagem travada por um receiver, então a
  // contagem só cai a zero depois do completeMessage. Do começo da fila, como o readDeadLetters: o SDK guarda o último número
  // espiado no cliente, e sem o fromSequenceNumber a contagem cairia a zero logo depois do primeiro peek que visse a mensagem.
  async function pending(queue: QueueName): Promise<number> {
    const receiver = bus.createReceiver(queue);
    try {
      return (await receiver.peekMessages(10, { fromSequenceNumber: Long.ONE })).length;
    } finally {
      await receiver.close();
    }
  }

  beforeAll(async () => {
    const connectionString = process.env.SERVICEBUS_CONNECTION_STRING;
    if (!connectionString)
      throw new Error('SERVICEBUS_EMULATOR=1 exige SERVICEBUS_CONNECTION_STRING');
    bus = new ServiceBusClient(connectionString);
    service = new MessagingService(bus);
    for (const queue of Object.keys(QUEUES) as QueueName[]) await drainQueue(queue);
  }, 120_000);

  afterEach(async () => {
    await Promise.all(consumers.splice(0).map((c) => c.close()));
    await drainQueue('maintenance');
    await drainQueue('market');
  });

  afterAll(async () => {
    await service.onApplicationShutdown();
  });

  it('entrega a mensagem validada ao handler e conclui', async () => {
    const received: QueueMessage[] = [];
    consumers.push(
      service.consume('market', (m) => {
        received.push(m);
        return Promise.resolve();
      }),
    );
    const message: QueueMessage = { type: 'eod', date: '2026-10-30' };
    await service.publish(message);
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual(message);
    // concluída de verdade: a mensagem some da fila (e não só deixou de ser entregue por uns segundos)
    await waitFor(async () => (await pending('market')) === 0);
    expect(received).toHaveLength(1);
  }, 60_000);

  it('handler que falha é tentado de novo depois de uma espera e, na última tentativa, vai para a DLQ', async () => {
    const calls: number[] = [];
    consumers.push(
      service.consume(
        'maintenance',
        () => {
          calls.push(Date.now());
          return Promise.reject(new Error('falha de propósito'));
        },
        RETRY_MS,
      ),
    );
    await service.publish(retention('2026-11-01'));
    await waitFor(async () => (await service.readDeadLetters('maintenance')).length === 1);
    // o handler rodou uma vez por tentativa e nenhuma a mais
    expect(calls).toHaveLength(QUEUES.maintenance.maxDeliveryCount);
    // não foi reentrega imediata (o abandon devolveria a mensagem em milissegundos): a espera antes da
    // tentativa n+1 é RETRY_MS * n. A margem cobre o relógio do contêiner do emulador.
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(RETRY_MS / 2);
    expect(calls[2]! - calls[1]!).toBeGreaterThanOrEqual(RETRY_MS);
    const [dead] = await service.readDeadLetters('maintenance');
    expect(dead).toMatchObject({
      messageId: 'retention:2026-11-01',
      reason: 'max_attempts_exceeded',
      body: retention('2026-11-01'),
    });
  }, 60_000);

  // O LockDuration das filas é de 1 min (Config.json). O handler demora mais que isso: sem a renovação
  // automática da trava (maxAutoLockRenewalDurationInMs) a mensagem voltaria a ser entregue no meio do
  // processamento e o complete falharia.
  it('renova a trava: um handler mais lento que o LockDuration não perde a mensagem', async () => {
    let calls = 0;
    let finished = false;
    consumers.push(
      service.consume('maintenance', async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 75_000));
        finished = true;
      }),
    );
    await service.publish(retention('2026-11-15'));
    await waitFor(() => finished, 100_000);
    await waitFor(async () => (await pending('maintenance')) === 0);
    expect(calls).toBe(1);
    expect(await service.readDeadLetters('maintenance')).toHaveLength(0);
  }, 150_000);

  it('reenviar da DLQ devolve a mensagem à fila com o mesmo MessageId e o handler conclui', async () => {
    let failing = true;
    const handled: QueueMessage[] = [];
    consumers.push(
      service.consume(
        'maintenance',
        (m) => {
          if (failing) return Promise.reject(new Error('falha de propósito'));
          handled.push(m);
          return Promise.resolve();
        },
        RETRY_MS,
      ),
    );
    await service.publish(retention('2026-11-08'));
    await waitFor(async () => (await service.readDeadLetters('maintenance')).length === 1);

    failing = false;
    await expect(service.resubmitDeadLetter('maintenance', 'retention:2026-11-08')).resolves.toBe(
      'resubmitted',
    );
    await waitFor(() => handled.length === 1);
    expect(handled[0]).toEqual(retention('2026-11-08'));
    expect(await service.readDeadLetters('maintenance')).toHaveLength(0);
    await expect(service.resubmitDeadLetter('maintenance', 'retention:2026-11-08')).resolves.toBe(
      'not_found',
    );
  }, 90_000);

  it('mensagem fora do contrato vai direto para a DLQ, sem chamar o handler', async () => {
    let called = false;
    consumers.push(
      service.consume('maintenance', () => {
        called = true;
        return Promise.resolve();
      }),
    );
    const sender = bus.createSender('maintenance');
    await sender.sendMessages({ messageId: 'lixo-1', body: { type: 'nope' } });
    await sender.close();
    await waitFor(async () => (await service.readDeadLetters('maintenance')).length === 1);
    const [dead] = await service.readDeadLetters('maintenance');
    expect(dead).toMatchObject({ messageId: 'lixo-1', reason: 'invalid_schema' });
    // o SDK repassa o delivery_count cru do AMQP, que na 1ª entrega pode ser 0 ou 1: o que importa é que
    // a mensagem não foi reentregue
    expect(dead!.deliveryCount).toBeLessThanOrEqual(1);
    expect(called).toBe(false);
  }, 60_000);

  it('publicação agendada só entrega depois do instante pedido', async () => {
    const received: QueueMessage[] = [];
    consumers.push(
      service.consume('market', (m) => {
        received.push(m);
        return Promise.resolve();
      }),
    );
    const startedAt = Date.now();
    await service.publishScheduled(
      { type: 'eod', date: '2026-11-03' },
      new Date(startedAt + 5_000),
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(received).toHaveLength(0);
    await waitFor(() => received.length === 1);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_500);
  }, 60_000);
});
