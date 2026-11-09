import {
  QUEUES,
  messageId,
  queueFor,
  type QueueMessage,
  type QueueName,
} from '@alvesting/contracts';
import {
  handleDelivery,
  type QueueHandler,
} from '../modules/messaging/application/handle-delivery.js';

// O relógio do ensaio: só anda para a frente. Os handlers recebem `() => clock.now()` no lugar do relógio da máquina.
export interface SimClock {
  now(): Date;
  set(at: Date): void;
}

export function createSimClock(start: Date): SimClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (at) => {
      current = Math.max(current, at.getTime());
    },
  };
}

export interface BusDelivery {
  queue: QueueName;
  messageId: string;
  attempt: number;
  at: Date;
  action: 'complete' | 'retry' | 'deadletter';
  // quanto o handler levou nesta máquina, em milissegundos (medida; muda a cada execução, por isso fica fora do relatório comparável)
  ms: number;
  // o que o handler lançou (só para quem investiga; pode ter ULID, por isso também fica fora do relatório)
  error?: string;
}

export interface BusDeadLetter {
  queue: QueueName;
  messageId: string;
  reason: string;
  description: string;
}

interface Pending {
  at: Date;
  seq: number;
  queue: QueueName;
  body: QueueMessage;
  attempt: number;
}

// O barramento do ensaio (arena:ensaio): no lugar do Service Bus, dentro do processo. Entrega as mensagens publicadas aos MESMOS
// handlers das filas, pelo mesmo handleDelivery do MessagingService, e repete a regra dele para o que o handler faz: concluir; falhar
// e agendar uma cópia com a tentativa seguinte para daqui a `retryDelayMs x tentativa` (QUEUES, ADR 0015); na última tentativa, DLQ.
// Mensagem inválida vai para a DLQ na hora. O tempo é o do relógio simulado: a mensagem agendada só sai quando o relógio chega nela.
//
// ponytail: entrega uma mensagem por vez, na ordem (horário, publicação). O Service Bus entrega em paralelo (concurrency de QUEUES);
// aqui a ordem é a mais estrita possível e a conta não depende de corrida. A concorrência de verdade (a trava consultiva do settle,
// as 10 execuções do job de decisões) é dos testes de integração de cada handler. A cópia agendada usa o relógio simulado; no
// MessagingService ela usa Date.now(), e a regra do atraso é a mesma.
export class InProcessBus {
  readonly deliveries: BusDelivery[] = [];
  readonly deadLetters: BusDeadLetter[] = [];
  private readonly queue: Pending[] = [];
  private seq = 0;

  constructor(
    private readonly handlers: Partial<Record<QueueName, QueueHandler>>,
    private readonly clock: SimClock,
  ) {}

  // as assinaturas são as que os agendadores e os handlers esperam do MessagingService (Pick<..., 'publish'> e 'publishScheduled')
  publish = (message: QueueMessage): Promise<void> =>
    this.publishScheduled(message, this.clock.now());

  publishScheduled = (message: QueueMessage, enqueueAt: Date): Promise<void> => {
    this.enqueue(queueFor(message), message, enqueueAt, 1);
    return Promise.resolve();
  };

  pending(): number {
    return this.queue.length;
  }

  // Entrega tudo o que venceu até `limit`, em ordem de horário. O que os handlers publicam no meio da passada entra na fila e sai na
  // mesma passada, se já venceu. O relógio fica na hora da última mensagem entregue. Com `signal` abortado (o Ctrl+C do arena:retroativo e
  // do operador), para ENTRE duas entregas: a que está em curso termina, e nada fica pela metade.
  async runUntil(limit: Date, signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) return;
      const next = this.nextDue(limit);
      if (!next) return;
      this.queue.splice(this.queue.indexOf(next), 1);
      await this.deliver(next);
    }
  }

  private enqueue(queue: QueueName, body: QueueMessage, at: Date, attempt: number): void {
    this.seq += 1;
    this.queue.push({ at, seq: this.seq, queue, body, attempt });
  }

  private nextDue(limit: Date): Pending | undefined {
    let best: Pending | undefined;
    for (const entry of this.queue) {
      if (entry.at > limit) continue;
      if (!best || entry.at < best.at || (+entry.at === +best.at && entry.seq < best.seq)) {
        best = entry;
      }
    }
    return best;
  }

  private async deliver(entry: Pending): Promise<void> {
    const handler = this.handlers[entry.queue];
    if (!handler) throw new Error(`O ensaio não tem handler para a fila ${entry.queue}`);
    this.clock.set(entry.at);
    const { queue, attempt } = entry;
    const started = performance.now();
    const outcome = await handleDelivery(queue, entry.body, handler, {
      attempt,
      lastAttempt: attempt >= QUEUES[queue].maxDeliveryCount,
    });
    const id = idOf(entry.body);
    const record = {
      queue,
      messageId: id,
      attempt,
      at: this.clock.now(),
      ms: Math.round(performance.now() - started),
    };

    if (outcome.action === 'complete') {
      this.deliveries.push({ ...record, action: 'complete' });
    } else if (outcome.action === 'deadletter') {
      this.deliveries.push({ ...record, action: 'deadletter' });
      this.deadLetters.push({
        queue,
        messageId: id,
        reason: outcome.reason,
        description: outcome.description,
      });
    } else if (attempt >= QUEUES[queue].maxDeliveryCount) {
      // sem o texto do erro na DLQ: a descrição dela é lida pelo admin (MessagingService.retryLater faz o mesmo)
      this.deliveries.push({ ...record, action: 'deadletter', error: errorText(outcome.error) });
      this.deadLetters.push({
        queue,
        messageId: id,
        reason: 'max_attempts_exceeded',
        description: `O handler falhou em ${attempt} tentativas`,
      });
    } else {
      this.deliveries.push({ ...record, action: 'retry', error: errorText(outcome.error) });
      const retryAt = new Date(this.clock.now().getTime() + QUEUES[queue].retryDelayMs * attempt);
      this.enqueue(queue, outcome.message, retryAt, attempt + 1);
    }
  }
}

const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

// o MessageId só para o registro (eod:2026-11-03); a mensagem inválida pode não ter chave natural
function idOf(body: QueueMessage): string {
  try {
    return messageId(body);
  } catch {
    return 'desconhecida';
  }
}
