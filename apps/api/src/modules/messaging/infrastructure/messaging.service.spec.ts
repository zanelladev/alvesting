import { Logger } from '@nestjs/common';
import type { ServiceBusClient } from '@azure/service-bus';
import Long from 'long';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUES, messageId, type QueueMessage } from '@alvesting/contracts';
import { DRAIN_TIMEOUT_MS, MessagingService, RECEIVE_ONE_WAIT_MS } from './messaging.service.js';

// Service Bus falso: guarda o que o serviço manda e deixa o teste disparar as entregas.
// A fiação com o SDK de verdade é coberta pelo teste de integração com o emulador.
const eod: QueueMessage = { type: 'eod', date: '2026-10-30' };
const retention: QueueMessage = { type: 'retention', date: '2026-11-01' };

type Received = {
  messageId?: string;
  body: unknown;
  deliveryCount?: number;
  applicationProperties?: Record<string, unknown>;
  sequenceNumber?: { toString(): string };
};

function makeBus(received: Received[] = []) {
  const senders = new Map<
    string,
    {
      sendMessages: ReturnType<typeof vi.fn>;
      scheduleMessages: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }
  >();
  const receivers: Array<{
    queue: string;
    options: Record<string, unknown> | undefined;
    receiver: ReturnType<typeof makeReceiver>;
  }> = [];
  const bus = {
    createSender: vi.fn((queue: string) => {
      if (!senders.has(queue)) {
        senders.set(queue, { sendMessages: vi.fn(), scheduleMessages: vi.fn(), close: vi.fn() });
      }
      return senders.get(queue)!;
    }),
    createReceiver: vi.fn((queue: string, options?: Record<string, unknown>) => {
      const receiver = makeReceiver(received);
      receivers.push({ queue, options, receiver });
      return receiver;
    }),
    close: vi.fn(),
  };
  return { bus, senders, receivers, client: bus as unknown as ServiceBusClient };
}

function makeReceiver(received: Received[] = []) {
  return {
    subscribe: vi.fn((_handlers: unknown, _options?: unknown) => ({ close: vi.fn() })),
    completeMessage: vi.fn(),
    abandonMessage: vi.fn(),
    deadLetterMessage: vi.fn(),
    peekMessages: vi.fn<(n: number, o?: unknown) => Promise<Received[]>>(() => Promise.resolve([])),
    receiveMessages: vi.fn<(n: number, o?: unknown) => Promise<Received[]>>(() =>
      Promise.resolve(received),
    ),
    close: vi.fn(),
  };
}

type Handlers = {
  processMessage: (message: Received) => Promise<void>;
  processError: (args: { error: Error; errorSource: string; entityPath: string }) => Promise<void>;
};

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('publish', () => {
  it('manda para a fila certa com MessageId determinístico e corpo JSON', async () => {
    const { client, senders } = makeBus();
    await new MessagingService(client).publish(eod);
    expect(senders.get('market')!.sendMessages).toHaveBeenCalledExactlyOnceWith({
      messageId: 'eod:2026-10-30',
      body: eod,
      contentType: 'application/json',
    });
  });

  it('a mesma mensagem publicada duas vezes leva o mesmo MessageId', async () => {
    const { client, senders } = makeBus();
    const service = new MessagingService(client);
    await service.publish(eod);
    await service.publish({ ...eod });
    const ids = senders
      .get('market')!
      .sendMessages.mock.calls.map(([m]) => (m as { messageId: string }).messageId);
    expect(ids).toEqual(['eod:2026-10-30', 'eod:2026-10-30']);
  });

  it('reaproveita o sender da fila e abre outro para outra fila', async () => {
    const { client, bus } = makeBus();
    const service = new MessagingService(client);
    await service.publish(eod);
    await service.publish({ type: 'eod', date: '2026-11-03' });
    await service.publish(retention);
    expect(bus.createSender.mock.calls.map(([queue]) => queue)).toEqual(['market', 'maintenance']);
  });

  it('não esconde a falha do broker', async () => {
    const { client, senders } = makeBus();
    const service = new MessagingService(client);
    await service.publish(eod);
    senders.get('market')!.sendMessages.mockRejectedValueOnce(new Error('broker fora'));
    await expect(service.publish({ type: 'eod', date: '2026-11-03' })).rejects.toThrow(
      'broker fora',
    );
  });
});

describe('publishScheduled', () => {
  it('agenda a entrega no instante pedido, com o mesmo MessageId', async () => {
    const { client, senders } = makeBus();
    const at = new Date('2026-10-30T22:30:00Z');
    await new MessagingService(client).publishScheduled(eod, at);
    expect(senders.get('market')!.scheduleMessages).toHaveBeenCalledExactlyOnceWith(
      { messageId: messageId(eod), body: eod, contentType: 'application/json' },
      at,
    );
    expect(senders.get('market')!.sendMessages).not.toHaveBeenCalled();
  });
});

describe('consume', () => {
  function start(
    handler: (message: QueueMessage) => Promise<void>,
    queue: keyof typeof QUEUES = 'market',
    retryDelayMs?: number,
  ) {
    const { client, receivers, senders } = makeBus();
    const consumer = new MessagingService(client).consume(queue, handler, retryDelayMs);
    const { receiver, options } = receivers[0]!;
    const [handlers, subscribeOptions] = receiver.subscribe.mock.calls[0] as unknown as [
      Handlers,
      Record<string, unknown>,
    ];
    const subscription = receiver.subscribe.mock.results[0]!.value as {
      close: ReturnType<typeof vi.fn>;
    };
    return { consumer, receiver, subscription, options, handlers, subscribeOptions, senders };
  }

  it('assina em peekLock, sem concluir sozinho e com a concorrência da fila', () => {
    for (const queue of Object.keys(QUEUES) as Array<keyof typeof QUEUES>) {
      const { options, subscribeOptions } = start(vi.fn(), queue);
      expect(options).toMatchObject({ receiveMode: 'peekLock' });
      expect(subscribeOptions).toMatchObject({
        autoCompleteMessages: false,
        maxConcurrentCalls: QUEUES[queue].concurrency,
      });
    }
  });

  it('renova a trava pelo tempo da fila (o padrão do SDK, 5 min, não cobre uma decisão)', () => {
    for (const queue of Object.keys(QUEUES) as Array<keyof typeof QUEUES>) {
      const { options } = start(vi.fn(), queue);
      expect(options, queue).toMatchObject({
        maxAutoLockRenewalDurationInMs: QUEUES[queue].lockRenewalMs,
      });
    }
    // JOBS.md: o job de decisões pode levar 25 min; a trava de 1 min precisa ser renovada por todo esse tempo
    const { options } = start(vi.fn(), 'decisions');
    expect(options!.maxAutoLockRenewalDurationInMs).toBeGreaterThanOrEqual(25 * 60_000);
  });

  it('conclui a mensagem quando o handler termina bem', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const { handlers, receiver, senders } = start(handler);
    const message = { messageId: 'eod:2026-10-30', body: eod };
    await handlers.processMessage(message);
    // o 2º argumento é o contexto da entrega (a tentativa e se é a última): ADR 0015
    expect(handler).toHaveBeenCalledExactlyOnceWith(eod, { attempt: 1, lastAttempt: false });
    expect(receiver.completeMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(receiver.abandonMessage).not.toHaveBeenCalled();
    expect(senders.size).toBe(0);
  });

  // O handler da decisão precisa saber que esta é a última entrega: se falhar de novo a mensagem iria para a DLQ, e a
  // decisão vira HOLD registrado em vez disso (plano 5.5; docs/JOBS.md).
  it('entrega ao handler a tentativa e se é a última da fila', async () => {
    const decide = (attempt?: number): Received => ({
      messageId: 'decide:x',
      body: {
        type: 'decide',
        cycleId: '01K8Z3Q4M9X7R2T5V6W8Y0A1B2',
        competitorId: '01K8Z3Q4M9X7R2T5V6W8Y0A1B3',
      },
      ...(attempt === undefined ? {} : { applicationProperties: { attempt } }),
    });
    const seen: unknown[] = [];
    const handler = vi.fn((_message: QueueMessage, delivery?: unknown) => {
      seen.push(delivery);
      return Promise.resolve();
    });
    const { handlers } = start(handler, 'decisions');
    for (const attempt of [undefined, 2, 3]) await handlers.processMessage(decide(attempt));
    expect(seen).toEqual([
      { attempt: 1, lastAttempt: false },
      { attempt: 2, lastAttempt: false },
      { attempt: 3, lastAttempt: true }, // decisions tem 3 entregas
    ]);
    // a mesma tentativa 3 numa fila de 10 entregas não é a última
    const market = start(handler, 'market');
    seen.length = 0;
    await market.handlers.processMessage({
      messageId: 'eod:x',
      body: eod,
      applicationProperties: { attempt: 3 },
    });
    expect(seen).toEqual([{ attempt: 3, lastAttempt: false }]);
  });

  it('manda para a DLQ, com motivo, a mensagem que não passa no contrato', async () => {
    const handler = vi.fn();
    const { handlers, receiver, senders } = start(handler);
    const message = { messageId: 'x', body: '{"type": "eod", "date": ' };
    await handlers.processMessage(message);
    expect(handler).not.toHaveBeenCalled();
    expect(receiver.deadLetterMessage).toHaveBeenCalledExactlyOnceWith(message, {
      deadLetterReason: 'invalid_json',
      deadLetterErrorDescription: 'O corpo não é JSON',
    });
    expect(senders.size).toBe(0);
  });

  it('loga o erro do SDK sem derrubar o processo', async () => {
    const { handlers } = start(vi.fn());
    await expect(
      handlers.processError({
        error: new Error('conexão caiu'),
        errorSource: 'receive',
        entityPath: 'market',
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
  });

  it('close encerra a assinatura e o receiver', async () => {
    const { consumer, receiver, subscription } = start(vi.fn());
    await consumer.close();
    expect(subscription.close).toHaveBeenCalledOnce();
    expect(receiver.close).toHaveBeenCalledOnce();
  });

  it('close duas vezes fecha o receiver uma vez só', async () => {
    const { consumer, receiver } = start(vi.fn());
    await Promise.all([consumer.close(), consumer.close()]);
    await consumer.close();
    expect(receiver.close).toHaveBeenCalledOnce();
  });
});

// O SDK não espera o processMessage em curso: subscription.close() só para de pedir mensagens e receiver.close()
// fecha o link e para de renovar a trava. Sem esperar, o SIGTERM no meio de um eod (a brapi leva até 4 min)
// derrubava o complete da mensagem, e ela só voltava depois da trava, com 6 minutos de atraso.
describe('consume: encerramento com handler em curso', () => {
  const message = { messageId: 'eod:2026-10-30', body: eod };

  function startBlocked() {
    let finish!: () => void;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { client, receivers } = makeBus();
    const service = new MessagingService(client);
    const consumer = service.consume('market', handler);
    const { receiver } = receivers[0]!;
    const [handlers] = receiver.subscribe.mock.calls[0] as unknown as [Handlers];
    const subscription = receiver.subscribe.mock.results[0]!.value as {
      close: ReturnType<typeof vi.fn>;
    };
    return { consumer, service, receiver, subscription, handlers, handler, finish: () => finish() };
  }

  const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

  it('para de pedir mensagens, espera o handler terminar e conclui a mensagem antes de fechar o receiver', async () => {
    const t = startBlocked();
    const processing = t.handlers.processMessage(message);
    await vi.waitFor(() => expect(t.handler).toHaveBeenCalledOnce());

    const closing = t.consumer.close();
    await vi.waitFor(() => expect(t.subscription.close).toHaveBeenCalledOnce());
    await settleMicrotasks();
    expect(t.receiver.close).not.toHaveBeenCalled(); // o handler ainda roda

    t.finish();
    await processing;
    await closing;
    expect(t.receiver.completeMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(t.receiver.completeMessage.mock.invocationCallOrder[0]!).toBeLessThan(
      t.receiver.close.mock.invocationCallOrder[0]!,
    );
  });

  it('handler que falha durante o encerramento também é esperado, e a nova tentativa é agendada', async () => {
    let fail!: (error: Error) => void;
    const { client, receivers, senders } = makeBus();
    const consumer = new MessagingService(client).consume(
      'market',
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const { receiver } = receivers[0]!;
    const [handlers] = receiver.subscribe.mock.calls[0] as unknown as [Handlers];
    const processing = handlers.processMessage(message);
    const closing = consumer.close();
    await settleMicrotasks();
    expect(receiver.close).not.toHaveBeenCalled();

    fail(new Error('B3 fora'));
    await processing;
    await closing;
    expect(senders.get('market')!.scheduleMessages).toHaveBeenCalledOnce();
    expect(receiver.completeMessage).toHaveBeenCalledOnce();
    expect(receiver.close).toHaveBeenCalledOnce();
  });

  it('sem handler em curso fecha na hora, sem esperar prazo nenhum', async () => {
    vi.useFakeTimers();
    const { consumer, receiver } = startBlocked();
    await consumer.close();
    expect(receiver.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('o prazo não fica pendurado quando o handler termina antes dele', async () => {
    vi.useFakeTimers();
    const t = startBlocked();
    const processing = t.handlers.processMessage(message);
    const closing = t.consumer.close();
    t.finish();
    await processing;
    await closing;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handler que não termina no prazo não prende o encerramento: fecha o receiver e avisa', async () => {
    vi.useFakeTimers();
    const t = startBlocked();
    void t.handlers.processMessage(message); // nunca termina
    const closing = t.consumer.close();
    await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS - 1);
    expect(t.receiver.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(t.receiver.close).toHaveBeenCalledOnce();
    expect(warnLog).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'market', pending: 1 }),
      expect.stringContaining('prazo'),
    );
  });

  it('o encerramento do serviço também espera o handler em curso', async () => {
    const t = startBlocked();
    const processing = t.handlers.processMessage(message);
    const shutdown = t.service.onApplicationShutdown();
    await settleMicrotasks();
    expect(t.receiver.close).not.toHaveBeenCalled();

    t.finish();
    await processing;
    await shutdown;
    expect(t.receiver.completeMessage).toHaveBeenCalledOnce();
    expect(t.receiver.close).toHaveBeenCalledOnce();
  });

  it('o prazo cabe no terminationGracePeriodSeconds de 300 s e cobre os 4 min da brapi (docs/JOBS.md)', () => {
    expect(DRAIN_TIMEOUT_MS).toBeGreaterThan(4 * 60_000);
    expect(DRAIN_TIMEOUT_MS).toBeLessThan(300_000);
  });
});

// ADR 0015: o Service Bus não espera entre entregas (abandon devolve a mensagem na hora), então um provedor
// fora do ar gastaria todas as entregas da fila em segundos. A nova tentativa é uma cópia agendada, que
// leva o número da tentativa na propriedade `attempt`.
describe('consume: handler que falha', () => {
  const NOW = new Date('2026-10-30T11:00:00Z');
  const failing = () => Promise.reject(new Error('provedor fora do ar'));

  function start(
    handler: (message: QueueMessage) => Promise<void>,
    queue: keyof typeof QUEUES = 'market',
    retryDelayMs?: number,
  ) {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const { client, receivers, senders } = makeBus();
    new MessagingService(client).consume(queue, handler, retryDelayMs);
    const { receiver } = receivers[0]!;
    const [handlers] = receiver.subscribe.mock.calls[0] as unknown as [Handlers];
    return { receiver, handlers, senders };
  }

  const delivery = (attempt?: number, body: unknown = eod): Received => ({
    messageId: 'eod:2026-10-30',
    body,
    ...(attempt === undefined ? {} : { applicationProperties: { attempt } }),
  });

  it('agenda a mesma mensagem como 2ª tentativa e conclui a original, sem abandonar', async () => {
    const { handlers, receiver, senders } = start(failing);
    const message = delivery();
    await handlers.processMessage(message);

    const schedule = senders.get('market')!.scheduleMessages;
    expect(schedule).toHaveBeenCalledExactlyOnceWith(
      {
        messageId: 'eod:2026-10-30',
        body: eod,
        contentType: 'application/json',
        applicationProperties: { attempt: 2 },
      },
      new Date(NOW.getTime() + QUEUES.market.retryDelayMs),
    );
    expect(receiver.completeMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(receiver.abandonMessage).not.toHaveBeenCalled();
    expect(receiver.deadLetterMessage).not.toHaveBeenCalled();
    // agenda antes de concluir: se o processo cair no meio sobra uma duplicata (barrada pela chave única
    // de job_run) em vez de a mensagem se perder
    expect(schedule.mock.invocationCallOrder[0]!).toBeLessThan(
      receiver.completeMessage.mock.invocationCallOrder[0]!,
    );
  });

  it('a espera cresce com a tentativa: a 2ª falha espera o dobro e agenda a 3ª', async () => {
    const { handlers, senders } = start(failing, 'market');
    await handlers.processMessage(delivery(2));
    expect(senders.get('market')!.scheduleMessages).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ applicationProperties: { attempt: 3 } }),
      new Date(NOW.getTime() + 2 * QUEUES.market.retryDelayMs),
    );
  });

  it('usa a espera informada em consume no lugar da padrão da fila', async () => {
    const { handlers, senders } = start(failing, 'decisions', 250);
    await handlers.processMessage({
      messageId: 'x',
      body: {
        type: 'decide',
        cycleId: '01K8Z3Q4M9X7R2T5V6W8Y0A1B2',
        competitorId: '01K8Z3Q4M9X7R2T5V6W8Y0A1B3',
      },
    });
    expect(senders.get('decisions')!.scheduleMessages).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      new Date(NOW.getTime() + 250),
    );
  });

  it('a cópia agendada leva a mensagem validada, mesmo que o corpo tenha chegado como texto', async () => {
    const { handlers, senders } = start(failing);
    await handlers.processMessage(delivery(undefined, JSON.stringify(eod)));
    expect(senders.get('market')!.scheduleMessages).toHaveBeenCalledWith(
      expect.objectContaining({ body: eod, messageId: 'eod:2026-10-30' }),
      expect.any(Date),
    );
  });

  it('na última tentativa vai para a DLQ com motivo, sem agendar nem concluir', async () => {
    const { handlers, receiver, senders } = start(() =>
      Promise.reject(new Error('senha=hunter2 no erro')),
    );
    const message = delivery(QUEUES.market.maxDeliveryCount);
    await handlers.processMessage(message);

    expect(receiver.deadLetterMessage).toHaveBeenCalledExactlyOnceWith(message, {
      deadLetterReason: 'max_attempts_exceeded',
      deadLetterErrorDescription: `O handler falhou em ${QUEUES.market.maxDeliveryCount} tentativas`,
    });
    expect(senders.size).toBe(0);
    expect(receiver.completeMessage).not.toHaveBeenCalled();
    expect(receiver.abandonMessage).not.toHaveBeenCalled();
    // a descrição da DLQ é lida pelo admin: nada do texto do erro vai para lá (só para o log)
    const [, settings] = receiver.deadLetterMessage.mock.calls[0] as unknown as [
      unknown,
      { deadLetterErrorDescription: string },
    ];
    expect(settings.deadLetterErrorDescription).not.toContain('hunter2');
    expect(errorLog).toHaveBeenCalled();
  });

  it('ida e volta: o que a nova tentativa grava é o que a próxima entrega lê, até a DLQ na última', async () => {
    const queue = 'maintenance';
    let delivery: Received = { messageId: 'retention:2026-11-01', body: retention };
    const outcomes: string[] = [];
    for (let n = 1; n <= QUEUES[queue].maxDeliveryCount; n += 1) {
      const { handlers, receiver, senders } = start(failing, queue);
      await handlers.processMessage(delivery);
      if (receiver.deadLetterMessage.mock.calls.length > 0) {
        outcomes.push('dlq');
        break;
      }
      outcomes.push('retry');
      // o broker entrega a cópia agendada como está, com as propriedades de aplicação
      const [copy] = senders.get(queue)!.scheduleMessages.mock.calls[0] as [Received];
      delivery = copy;
    }
    // o handler roda maxDeliveryCount vezes: tentativas 1 e 2 reagendam, a 3ª vai para a DLQ
    expect(outcomes).toEqual([
      ...Array<string>(QUEUES[queue].maxDeliveryCount - 1).fill('retry'),
      'dlq',
    ]);
  });

  it('se não consegue agendar, abandona a mensagem em vez de perdê-la', async () => {
    const { handlers, receiver, senders } = start(failing);
    senders.set('market', {
      sendMessages: vi.fn(),
      scheduleMessages: vi.fn().mockRejectedValue(new Error('broker fora')),
      close: vi.fn(),
    });
    const message = delivery();
    await handlers.processMessage(message);
    expect(receiver.abandonMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(receiver.completeMessage).not.toHaveBeenCalled();
    expect(receiver.deadLetterMessage).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });

  it.each([
    ['texto', 'dois'],
    ['zero', 0],
    ['negativa', -3],
    ['fracionária', 1.5],
    ['NaN', Number.NaN],
    ['nula', null],
  ])('propriedade attempt %s vale como 1ª tentativa', async (_nome, attempt) => {
    const { handlers, senders } = start(failing);
    await handlers.processMessage({
      messageId: 'eod:2026-10-30',
      body: eod,
      applicationProperties: { attempt: attempt as unknown as number },
    });
    expect(senders.get('market')!.scheduleMessages).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ applicationProperties: { attempt: 2 } }),
      new Date(NOW.getTime() + QUEUES.market.retryDelayMs),
    );
  });

  it('mensagem sem propriedades de aplicação (publicada por outra ferramenta) é a 1ª tentativa', async () => {
    const { handlers, senders } = start(failing);
    await handlers.processMessage({ messageId: 'eod:2026-10-30', body: eod });
    expect(senders.get('market')!.scheduleMessages).toHaveBeenCalledOnce();
  });
});

describe('DLQ', () => {
  const dead = (
    id: string | undefined,
    body: unknown,
    sequence = '1',
  ): Received & Record<string, unknown> => ({
    messageId: id,
    body,
    deliveryCount: 3,
    sequenceNumber: { toString: () => sequence },
    deadLetterReason: 'MaxDeliveryCountExceeded',
    deadLetterErrorDescription: 'excedeu',
    enqueuedTimeUtc: new Date('2026-10-30T23:30:00Z'),
  });

  // todo receiver criado enxerga as mesmas mensagens mortas
  function busWithDeadLetters(messages: Array<Received & Record<string, unknown>>) {
    const made = makeBus();
    made.bus.createReceiver.mockImplementation(
      (queue: string, options?: Record<string, unknown>) => {
        const receiver = makeReceiver();
        receiver.peekMessages.mockResolvedValue(messages);
        receiver.receiveMessages.mockResolvedValue(messages);
        made.receivers.push({ queue, options, receiver });
        return receiver;
      },
    );
    return { ...made, service: new MessagingService(made.client) };
  }

  it('lê a DLQ sem consumir (peek) e devolve dados serializáveis', async () => {
    const { service, receivers } = busWithDeadLetters([dead('eod:2026-10-30', eod, '42')]);
    const letters = await service.readDeadLetters('market', 5);
    expect(receivers[0]!.options).toMatchObject({ subQueueType: 'deadLetter' });
    // sempre do começo: sem o fromSequenceNumber, o SDK continua do último número espiado, que ele guarda no cliente (por fila) e não
    // no receiver, e a segunda leitura voltaria vazia (o teste de integração com o emulador pegou)
    expect(receivers[0]!.receiver.peekMessages).toHaveBeenCalledWith(5, {
      fromSequenceNumber: Long.ONE,
    });
    expect(receivers[0]!.receiver.close).toHaveBeenCalled();
    expect(letters).toEqual([
      {
        messageId: 'eod:2026-10-30',
        sequenceNumber: '42',
        deliveryCount: 3,
        reason: 'MaxDeliveryCountExceeded',
        description: 'excedeu',
        enqueuedAt: new Date('2026-10-30T23:30:00Z'),
        body: eod,
      },
    ]);
    expect(() => JSON.stringify(letters)).not.toThrow();
  });

  it('reenvia a mensagem pedida para a fila de origem com o mesmo MessageId e a tira da DLQ', async () => {
    const target = dead('eod:2026-10-30', eod);
    const other = dead('retention:2026-11-01', retention, '2');
    const { service, receivers, senders } = busWithDeadLetters([other, target]);
    await expect(service.resubmitDeadLetter('market', 'eod:2026-10-30')).resolves.toBe(
      'resubmitted',
    );
    expect(senders.get('market')!.sendMessages).toHaveBeenCalledExactlyOnceWith({
      messageId: 'eod:2026-10-30',
      body: eod,
      contentType: 'application/json',
    });
    const { receiver, options } = receivers[0]!;
    expect(options).toMatchObject({ subQueueType: 'deadLetter', receiveMode: 'peekLock' });
    expect(receiver.completeMessage).toHaveBeenCalledExactlyOnceWith(target);
    expect(receiver.abandonMessage).toHaveBeenCalledExactlyOnceWith(other);
    expect(receiver.close).toHaveBeenCalled();
  });

  it('só tira da DLQ depois de publicar: se o envio falha, a mensagem continua lá', async () => {
    const target = dead('eod:2026-10-30', eod);
    const { service, receivers, senders } = busWithDeadLetters([target]);
    senders.set('market', {
      sendMessages: vi.fn().mockRejectedValue(new Error('broker fora')),
      scheduleMessages: vi.fn(),
      close: vi.fn(),
    });
    await expect(service.resubmitDeadLetter('market', 'eod:2026-10-30')).rejects.toThrow(
      'broker fora',
    );
    expect(receivers[0]!.receiver.completeMessage).not.toHaveBeenCalled();
    expect(receivers[0]!.receiver.abandonMessage).toHaveBeenCalledWith(target);
    expect(receivers[0]!.receiver.close).toHaveBeenCalled();
  });

  it('devolve not_found e solta o bloqueio de todas quando o id não está na DLQ', async () => {
    const a = dead('eod:2026-10-30', eod);
    const { service, receivers } = busWithDeadLetters([a]);
    await expect(service.resubmitDeadLetter('market', 'eod:2099-01-01')).resolves.toBe('not_found');
    expect(receivers[0]!.receiver.abandonMessage).toHaveBeenCalledWith(a);
    expect(receivers[0]!.receiver.completeMessage).not.toHaveBeenCalled();
  });

  it('não reenvia mensagem que continua inválida: fica na DLQ', async () => {
    const broken = dead('lixo', { type: 'nope' });
    const { service, receivers, senders } = busWithDeadLetters([broken]);
    await expect(service.resubmitDeadLetter('market', 'lixo')).resolves.toBe('invalid');
    expect(senders.size).toBe(0);
    expect(receivers[0]!.receiver.completeMessage).not.toHaveBeenCalled();
    expect(receivers[0]!.receiver.abandonMessage).toHaveBeenCalledWith(broken);
  });

  it('não reenvia para a fila errada: tipo eod não volta para a fila news', async () => {
    const target = dead('eod:2026-10-30', eod);
    const { service, receivers, senders } = busWithDeadLetters([target]);
    await expect(service.resubmitDeadLetter('news', 'eod:2026-10-30')).resolves.toBe('invalid');
    expect(senders.size).toBe(0);
    expect(receivers[0]!.receiver.completeMessage).not.toHaveBeenCalled();
  });
});

// O job de decisões é por evento (plano 5.3): cada execução recebe UMA mensagem da fila, trata e sai. O KEDA acorda a execução
// quando há mensagem, mas é o código que a busca. Tratar e concluir/reagendar/DLQ é o mesmo que o consume faz.
describe('receiveOne (job por evento)', () => {
  const NOW = new Date('2026-11-03T11:00:00Z');
  const decide = {
    type: 'decide' as const,
    cycleId: '01K8Z3Q4M9X7R2T5V6W8Y0A1B2',
    competitorId: '01K8Z3Q4M9X7R2T5V6W8Y0A1B3',
  };
  const message = (applicationProperties?: Record<string, unknown>): Received => ({
    messageId: 'decide:x',
    body: decide,
    ...(applicationProperties ? { applicationProperties } : {}),
  });

  function start(received: Received[]) {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const { client, receivers, senders } = makeBus(received);
    return { service: new MessagingService(client), receivers, senders };
  }

  it('recebe uma mensagem só, em peekLock, renovando a trava pelo tempo da fila', async () => {
    const t = start([message()]);
    await t.service.receiveOne('decisions', vi.fn().mockResolvedValue(undefined));
    const { queue, options, receiver } = t.receivers[0]!;
    expect(queue).toBe('decisions');
    expect(options).toMatchObject({
      receiveMode: 'peekLock',
      maxAutoLockRenewalDurationInMs: QUEUES.decisions.lockRenewalMs,
    });
    expect(receiver.receiveMessages).toHaveBeenCalledExactlyOnceWith(
      1,
      expect.objectContaining({ maxWaitTimeInMs: RECEIVE_ONE_WAIT_MS }),
    );
    expect(receiver.subscribe).not.toHaveBeenCalled();
  });

  it('trata, conclui a mensagem e fecha o receiver; devolve "complete"', async () => {
    const t = start([message()]);
    const handler = vi.fn().mockResolvedValue(undefined);
    await expect(t.service.receiveOne('decisions', handler)).resolves.toBe('complete');
    const { receiver } = t.receivers[0]!;
    expect(handler).toHaveBeenCalledExactlyOnceWith(decide, { attempt: 1, lastAttempt: false });
    expect(receiver.completeMessage).toHaveBeenCalledOnce();
    expect(receiver.close).toHaveBeenCalledOnce();
  });

  it('fila vazia (outra execução já levou a mensagem): devolve "empty" e fecha o receiver', async () => {
    const t = start([]);
    const handler = vi.fn();
    await expect(t.service.receiveOne('decisions', handler)).resolves.toBe('empty');
    expect(handler).not.toHaveBeenCalled();
    expect(t.receivers[0]!.receiver.close).toHaveBeenCalledOnce();
  });

  it('handler que falha agenda a nova tentativa (10 min) e conclui a original; sai sem erro', async () => {
    const t = start([message()]);
    await expect(
      t.service.receiveOne('decisions', () => Promise.reject(new Error('provedor fora'))),
    ).resolves.toBe('retry');
    expect(t.senders.get('decisions')!.scheduleMessages).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ applicationProperties: { attempt: 2 } }),
      new Date(NOW.getTime() + QUEUES.decisions.retryDelayMs),
    );
    expect(t.receivers[0]!.receiver.completeMessage).toHaveBeenCalledOnce();
    expect(t.receivers[0]!.receiver.close).toHaveBeenCalledOnce();
  });

  it('a última entrega chega ao handler marcada como última, e é ele quem decide (HOLD) em vez da DLQ', async () => {
    const t = start([message({ attempt: QUEUES.decisions.maxDeliveryCount })]);
    const handler = vi.fn().mockResolvedValue(undefined); // grava o HOLD e não lança
    await expect(t.service.receiveOne('decisions', handler)).resolves.toBe('complete');
    expect(handler).toHaveBeenCalledWith(decide, {
      attempt: QUEUES.decisions.maxDeliveryCount,
      lastAttempt: true,
    });
    expect(t.receivers[0]!.receiver.deadLetterMessage).not.toHaveBeenCalled();
  });

  it('se ainda assim o handler falhar na última entrega, a mensagem vai para a DLQ', async () => {
    const t = start([message({ attempt: QUEUES.decisions.maxDeliveryCount })]);
    await expect(
      t.service.receiveOne('decisions', () => Promise.reject(new Error('banco fora'))),
    ).resolves.toBe('deadletter');
    expect(t.receivers[0]!.receiver.deadLetterMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deadLetterReason: 'max_attempts_exceeded' }),
    );
  });

  it('mensagem inválida vai para a DLQ sem chamar o handler', async () => {
    const t = start([{ messageId: 'lixo', body: { type: 'nope' } }]);
    const handler = vi.fn();
    await expect(t.service.receiveOne('decisions', handler)).resolves.toBe('deadletter');
    expect(handler).not.toHaveBeenCalled();
  });

  it('falha ao concluir sobe (o job sai com 1) e o receiver é fechado do mesmo jeito', async () => {
    const bus = makeBus([message()]);
    const original = bus.bus.createReceiver.getMockImplementation()!;
    bus.bus.createReceiver.mockImplementation((queue, options) => {
      const created = original(queue, options);
      created.completeMessage.mockRejectedValue(new Error('trava perdida'));
      return created;
    });
    await expect(
      new MessagingService(bus.client).receiveOne(
        'decisions',
        vi.fn().mockResolvedValue(undefined),
      ),
    ).rejects.toThrow(/trava perdida/);
    expect(bus.receivers[0]!.receiver.close).toHaveBeenCalledOnce();
  });

  it('sem Service Bus configurado falha dizendo o que falta', async () => {
    await expect(new MessagingService(undefined).receiveOne('decisions', vi.fn())).rejects.toThrow(
      /SERVICEBUS_CONNECTION_STRING/,
    );
  });
});

describe('sem Service Bus configurado', () => {
  it('falha com mensagem clara em vez de conectar em lugar nenhum', async () => {
    const service = new MessagingService(undefined);
    await expect(service.publish(eod)).rejects.toThrow(/SERVICEBUS_CONNECTION_STRING/);
    await expect(service.publishScheduled(eod, new Date())).rejects.toThrow(
      /SERVICEBUS_CONNECTION_STRING/,
    );
    expect(() => service.consume('market', vi.fn())).toThrow(/SERVICEBUS_CONNECTION_STRING/);
    await expect(service.readDeadLetters('market')).rejects.toThrow(/SERVICEBUS_CONNECTION_STRING/);
    await expect(service.resubmitDeadLetter('market', 'x')).rejects.toThrow(
      /SERVICEBUS_CONNECTION_STRING/,
    );
  });

  it('encerrar sem cliente não falha', async () => {
    await expect(new MessagingService(undefined).onApplicationShutdown()).resolves.toBeUndefined();
  });
});

describe('encerramento', () => {
  it('fecha senders, receivers e o cliente', async () => {
    const { client, bus, senders, receivers } = makeBus();
    const service = new MessagingService(client);
    await service.publish(eod);
    service.consume('market', vi.fn());
    await service.onApplicationShutdown();
    expect(senders.get('market')!.close).toHaveBeenCalled();
    expect(receivers[0]!.receiver.close).toHaveBeenCalled();
    expect(bus.close).toHaveBeenCalled();
  });
});
