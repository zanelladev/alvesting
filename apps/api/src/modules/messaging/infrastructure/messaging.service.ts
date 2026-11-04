import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type {
  ServiceBusClient,
  ServiceBusMessage,
  ServiceBusReceivedMessage,
  ServiceBusReceiver,
  ServiceBusSender,
} from '@azure/service-bus';
import {
  QUEUES,
  messageId,
  parseQueueMessage,
  queueFor,
  type QueueMessage,
  type QueueName,
} from '@alvesting/contracts';
import {
  handleDelivery,
  type Delivery,
  type DeliveryOutcome,
  type QueueHandler,
} from '../application/handle-delivery.js';

export const SERVICE_BUS_CLIENT = Symbol('SERVICE_BUS_CLIENT');

export type Consumer = { close(): Promise<void> };

export type DeadLetter = {
  messageId: string;
  sequenceNumber: string;
  deliveryCount: number;
  reason: string | undefined;
  description: string | undefined;
  enqueuedAt: Date | undefined;
  body: unknown;
};

export type ResubmitResult = 'resubmitted' | 'not_found' | 'invalid';

// O que foi feito com a mensagem de verdade: concluída; concluída com a cópia agendada (retry); DLQ (inválida, ou a última
// tentativa esgotada); ou devolvida ao broker porque nem o reagendamento deu certo (abandon).
export type SettleAction = 'complete' | 'retry' | 'deadletter' | 'abandon';

// Quanto o encerramento espera os handlers em curso (SIGTERM do Container Apps). Cobre os 4 min que a brapi pode
// levar no eod e fica abaixo do terminationGracePeriodSeconds de 300 s do worker-data (docs/JOBS.md): o que não
// terminar até aqui perde a trava e volta para a fila, e o processo ainda tem tempo de fechar tudo antes do SIGKILL.
export const DRAIN_TIMEOUT_MS = 270_000;

// Propriedade da mensagem que conta as tentativas do handler (ADR 0015). Ausente = 1ª tentativa.
const ATTEMPT = 'attempt';

const attemptOf = (m: ServiceBusReceivedMessage): number => {
  const value = m.applicationProperties?.[ATTEMPT];
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1;
};

// A tentativa que o handler está tratando e se é a última da fila (a mesma conta do retryLater: depois dela, DLQ).
const deliveryOf = (queue: QueueName, m: ServiceBusReceivedMessage): Delivery => {
  const attempt = attemptOf(m);
  return { attempt, lastAttempt: attempt >= QUEUES[queue].maxDeliveryCount };
};

// Quanto o job por evento espera uma mensagem aparecer. O KEDA só acorda a execução com a mensagem na fila, então ela já
// está lá; a espera cobre a corrida com outra execução (que pode levá-la antes) sem prender o job.
export const RECEIVE_ONE_WAIT_MS = 30_000;

const toServiceBusMessage = (message: QueueMessage): ServiceBusMessage => ({
  messageId: messageId(message),
  body: message,
  contentType: 'application/json',
});

const toDeadLetter = (m: ServiceBusReceivedMessage): DeadLetter => ({
  messageId: m.messageId === undefined ? '' : String(m.messageId),
  sequenceNumber: m.sequenceNumber?.toString() ?? '',
  deliveryCount: m.deliveryCount ?? 0,
  reason: m.deadLetterReason,
  description: m.deadLetterErrorDescription,
  enqueuedAt: m.enqueuedTimeUtc,
  body: m.body as unknown,
});

// Cliente fino sobre o @azure/service-bus: publica com MessageId determinístico, publica agendado,
// consome com complete/retry agendado/dead-letter e lê e reenvia a DLQ. Toda a lógica de decisão está em
// handleDelivery; aqui só entra o que fala com o SDK.
// O tier Basic não detecta duplicata: o MessageId identifica a mensagem, e quem impede o
// processamento em dobro é a chave única de job_run no banco.
@Injectable()
export class MessagingService implements OnApplicationShutdown {
  private readonly logger = new Logger(MessagingService.name);
  private readonly senders = new Map<QueueName, ServiceBusSender>();
  private readonly consumers = new Set<Consumer>();

  constructor(@Inject(SERVICE_BUS_CLIENT) private readonly client: ServiceBusClient | undefined) {}

  private get bus(): ServiceBusClient {
    if (!this.client) {
      throw new Error(
        'Service Bus não configurado: defina SERVICEBUS_CONNECTION_STRING (emulador) ou SERVICEBUS_FQDN (Azure)',
      );
    }
    return this.client;
  }

  private sender(queue: QueueName): ServiceBusSender {
    let sender = this.senders.get(queue);
    if (!sender) {
      sender = this.bus.createSender(queue);
      this.senders.set(queue, sender);
    }
    return sender;
  }

  async publish(message: QueueMessage): Promise<void> {
    await this.sender(queueFor(message)).sendMessages(toServiceBusMessage(message));
  }

  // Entrega só a partir de enqueueAt (ex.: o eod se reagenda em +60 min quando a brapi ainda não tem todas as barras do pregão).
  async publishScheduled(message: QueueMessage, enqueueAt: Date): Promise<void> {
    await this.sender(queueFor(message)).scheduleMessages(toServiceBusMessage(message), enqueueAt);
  }

  // retryDelayMs: espera base entre tentativas (a espera antes da tentativa n+1 é retryDelayMs * n). O padrão
  // é o da fila; só os testes de integração passam outro, para não esperar minutos.
  consume(
    queue: QueueName,
    handler: QueueHandler,
    retryDelayMs: number = QUEUES[queue].retryDelayMs,
  ): Consumer {
    const receiver = this.bus.createReceiver(queue, {
      receiveMode: 'peekLock',
      // A trava da fila é de 1 min e o SDK só a renova por 5 min (padrão). O job de decisões leva até 25 min:
      // sem isto outra réplica recebia a mesma mensagem (segunda chamada de LLM paga) e o complete falhava.
      maxAutoLockRenewalDurationInMs: QUEUES[queue].lockRenewalMs,
    });
    // As entregas em curso. O SDK não as espera ao fechar (subscription.close() só para de pedir mensagens e
    // receiver.close() fecha o link e para de renovar a trava), então o close daqui as espera.
    const inFlight = new Set<Promise<void>>();
    const subscription = receiver.subscribe(
      {
        processMessage: (message) => {
          const delivery = (async () => {
            const outcome = await handleDelivery(
              queue,
              message.body,
              handler,
              deliveryOf(queue, message),
            );
            await this.settle(receiver, message, queue, outcome, retryDelayMs);
          })();
          inFlight.add(delivery);
          const done = () => inFlight.delete(delivery);
          delivery.then(done, done); // a falha vai para o SDK, que abandona a mensagem; aqui só se anota o fim
          return delivery;
        },
        processError: (args) => {
          this.logger.error(
            { queue, errorSource: args.errorSource, entityPath: args.entityPath, err: args.error },
            'erro no receiver do Service Bus',
          );
          return Promise.resolve();
        },
      },
      { autoCompleteMessages: false, maxConcurrentCalls: QUEUES[queue].concurrency },
    );
    let closing: Promise<void> | undefined;
    const consumer: Consumer = {
      // Para de pedir mensagens, espera os handlers em curso (até DRAIN_TIMEOUT_MS) e só então fecha o receiver,
      // para o complete ou o reagendamento de cada um ainda achar o link aberto.
      close: () => {
        closing ??= (async () => {
          try {
            await subscription.close();
            await this.drain(queue, inFlight);
          } finally {
            this.consumers.delete(consumer);
            await receiver.close();
          }
        })();
        return closing;
      },
    };
    this.consumers.add(consumer);
    return consumer;
  }

  // O job por evento (job-worker-decisions): recebe UMA mensagem, trata e sai. O KEDA acorda uma execução por mensagem, mas é
  // o código que a busca. O tratamento é o do consume: conclui, agenda a nova tentativa ou manda para a DLQ (ADR 0015); o job
  // sai com 0 em qualquer um deles. Devolve o que aconteceu: 'empty' se outra execução já levou a mensagem. Só um erro de
  // verdade (broker, trava perdida) sobe, e então a mensagem volta quando a trava vence.
  async receiveOne(
    queue: QueueName,
    handler: QueueHandler,
    retryDelayMs: number = QUEUES[queue].retryDelayMs,
    maxWaitTimeInMs: number = RECEIVE_ONE_WAIT_MS,
  ): Promise<'empty' | SettleAction> {
    const receiver = this.bus.createReceiver(queue, {
      receiveMode: 'peekLock',
      // o receiveMessages também renova a trava (mesmo LockRenewer do subscribe) pelo tempo que o handler levar
      maxAutoLockRenewalDurationInMs: QUEUES[queue].lockRenewalMs,
    });
    try {
      const [message] = await receiver.receiveMessages(1, { maxWaitTimeInMs });
      if (!message) return 'empty';
      const outcome = await handleDelivery(
        queue,
        message.body,
        handler,
        deliveryOf(queue, message),
      );
      return await this.settle(receiver, message, queue, outcome, retryDelayMs);
    } finally {
      await receiver.close();
    }
  }

  private async drain(queue: QueueName, inFlight: Set<Promise<void>>): Promise<void> {
    if (inFlight.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, DRAIN_TIMEOUT_MS);
    });
    try {
      await Promise.race([Promise.allSettled([...inFlight]), deadline]);
    } finally {
      clearTimeout(timer);
    }
    if (inFlight.size > 0) {
      this.logger.warn(
        { queue, pending: inFlight.size },
        'prazo do encerramento esgotado com handler em curso; a trava expira e a mensagem volta para a fila',
      );
    }
  }

  private async settle(
    receiver: ServiceBusReceiver,
    message: ServiceBusReceivedMessage,
    queue: QueueName,
    outcome: DeliveryOutcome,
    retryDelayMs: number,
  ): Promise<SettleAction> {
    switch (outcome.action) {
      case 'complete':
        await receiver.completeMessage(message);
        return 'complete';
      case 'retry':
        return this.retryLater(receiver, message, queue, outcome, retryDelayMs);
      case 'deadletter':
        this.logger.warn(
          { queue, messageId: message.messageId, reason: outcome.reason },
          'mensagem inválida enviada para a DLQ',
        );
        await receiver.deadLetterMessage(message, {
          deadLetterReason: outcome.reason,
          deadLetterErrorDescription: outcome.description,
        });
        return 'deadletter';
    }
  }

  // O Service Bus não espera entre entregas: abandonMessage devolve a mensagem na hora, e um provedor de LLM
  // fora do ar gastaria as 3 entregas de `decisions` em segundos e mandaria o modelo para a DLQ (e para o
  // alerta) por uma falha passageira. Então a nova tentativa é uma cópia agendada, com a tentativa na
  // propriedade `attempt`. A entrega do broker (MaxDeliveryCount da fila) fica de rede de segurança para
  // processo que cai ou trava que expira. Detalhes e alternativas: ADR 0015.
  // Agenda antes de concluir a original (ao-menos-uma-vez): se o processo cair entre as duas, sobra uma
  // duplicata, que a chave única de job_run barra; o contrário perderia a mensagem.
  private async retryLater(
    receiver: ServiceBusReceiver,
    message: ServiceBusReceivedMessage,
    queue: QueueName,
    outcome: Extract<DeliveryOutcome, { action: 'retry' }>,
    retryDelayMs: number,
  ): Promise<SettleAction> {
    const attempt = attemptOf(message);
    const context = { queue, messageId: message.messageId, attempt };
    if (attempt >= QUEUES[queue].maxDeliveryCount) {
      this.logger.error(
        { ...context, err: outcome.error },
        'handler falhou na última tentativa; mensagem enviada para a DLQ',
      );
      // Sem o texto do erro: a descrição da DLQ é lida pelo admin e o erro pode carregar segredo.
      await receiver.deadLetterMessage(message, {
        deadLetterReason: 'max_attempts_exceeded',
        deadLetterErrorDescription: `O handler falhou em ${attempt} tentativas`,
      });
      return 'deadletter';
    }
    const retryAt = new Date(Date.now() + retryDelayMs * attempt);
    try {
      await this.sender(queue).scheduleMessages(
        {
          ...toServiceBusMessage(outcome.message),
          applicationProperties: { [ATTEMPT]: attempt + 1 },
        },
        retryAt,
      );
    } catch (scheduleError) {
      // Sem agendar não há como esperar. Devolver a mensagem na hora é pior que esperar, mas melhor que
      // perdê-la: a entrega do broker conta e, no limite, ela vai para a DLQ.
      this.logger.error(
        {
          ...context,
          err: scheduleError,
          handlerError:
            outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
        },
        'handler falhou e o reagendamento também; mensagem abandonada para nova entrega',
      );
      await receiver.abandonMessage(message);
      return 'abandon';
    }
    this.logger.warn(
      { ...context, retryAt, err: outcome.error },
      'handler falhou; nova tentativa agendada',
    );
    await receiver.completeMessage(message);
    return 'retry';
  }

  // Lê sem consumir (peek): as mensagens continuam na DLQ.
  async readDeadLetters(queue: QueueName, max = 20): Promise<DeadLetter[]> {
    const receiver = this.bus.createReceiver(queue, { subQueueType: 'deadLetter' });
    try {
      return (await receiver.peekMessages(max)).map(toDeadLetter);
    } finally {
      await receiver.close();
    }
  }

  // Devolve uma mensagem da DLQ à fila de origem, com o mesmo MessageId. Só tira da DLQ depois de
  // publicar (ao-menos-uma-vez: a duplicata, se houver, é barrada pela chave única do banco).
  // Mensagem que continua inválida ou é de outra fila fica onde está.
  async resubmitDeadLetter(queue: QueueName, id: string): Promise<ResubmitResult> {
    const receiver = this.bus.createReceiver(queue, {
      subQueueType: 'deadLetter',
      receiveMode: 'peekLock',
    });
    let batch: ServiceBusReceivedMessage[] = [];
    let resubmitted: ServiceBusReceivedMessage | undefined;
    try {
      // ponytail: examina as primeiras 100 mensagens da DLQ. Uma DLQ maior que isso é sintoma de
      // problema maior; se virar rotina, reenviar por lotes.
      batch = await receiver.receiveMessages(100, { maxWaitTimeInMs: 2_000 });
      const target = batch.find((m) => m.messageId !== undefined && String(m.messageId) === id);
      if (!target) return 'not_found';
      const parsed = parseQueueMessage(target.body);
      if (!parsed.success || queueFor(parsed.data) !== queue) return 'invalid';
      await this.publish(parsed.data);
      await receiver.completeMessage(target);
      resubmitted = target;
      return 'resubmitted';
    } finally {
      // o que não foi reenviado volta para a DLQ sem ficar preso ao bloqueio
      await Promise.allSettled(
        batch.filter((m) => m !== resubmitted).map((m) => receiver.abandonMessage(m)),
      );
      await receiver.close();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.consumers].map((c) => c.close()));
    await Promise.allSettled([...this.senders.values()].map((s) => s.close()));
    await this.client?.close();
  }
}
