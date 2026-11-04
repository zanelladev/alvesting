import { SpanKind } from '@opentelemetry/api';
import {
  messageId,
  parseQueueMessage,
  queueFor,
  type QueueMessage,
  type QueueName,
} from '@alvesting/contracts';
import type { z } from 'zod';
import { inSpan } from '../../../telemetry/instruments.js';

// A entrega que o handler está tratando: a tentativa (1 = a primeira) e se é a última da fila (QUEUES[fila].maxDeliveryCount).
// Quase todo handler a ignora. O da decisão a usa: na última entrega, falhar mandaria a mensagem para a DLQ, e a decisão
// vira HOLD registrado em vez disso (plano 5.5; docs/JOBS.md).
export interface Delivery {
  attempt: number;
  lastAttempt: boolean;
}

// Os handlers das filas são funções comuns: recebem a mensagem já validada (e, se quiserem, a entrega) e não conhecem o
// Service Bus. Assim cada um é testável sem fila; a fiação com o broker é o MessagingService.
export type QueueHandler = (message: QueueMessage, delivery?: Delivery) => Promise<void>;

export type DeliveryOutcome =
  | { action: 'complete' }
  // handler falhou: nova tentativa mais tarde ou, esgotadas as tentativas da fila, DLQ (quem decide é o
  // MessagingService, ADR 0015). Leva a mensagem já validada para a cópia agendada.
  | { action: 'retry'; message: QueueMessage; error: unknown }
  // mensagem que nunca vai dar certo (corpo inválido, fila errada): DLQ na hora, sem gastar tentativas
  | {
      action: 'deadletter';
      reason: 'invalid_json' | 'invalid_schema' | 'wrong_queue';
      description: string;
    };

// As issues do Zod trazem caminho e regra, nunca o valor recebido, então a descrição pode ir para a DLQ.
const describeIssues = (issues: z.core.$ZodIssue[]): string =>
  issues
    .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('; ')
    .slice(0, 500);

export async function handleDelivery(
  queue: QueueName,
  body: unknown,
  handler: QueueHandler,
  delivery?: Delivery,
): Promise<DeliveryOutcome> {
  const parsed = parseQueueMessage(body);
  if (!parsed.success) {
    return {
      action: 'deadletter',
      reason: parsed.reason,
      description:
        parsed.reason === 'invalid_json' ? 'O corpo não é JSON' : describeIssues(parsed.issues),
    };
  }
  if (queueFor(parsed.data) !== queue) {
    return {
      action: 'deadletter',
      reason: 'wrong_queue',
      description: `O tipo ${parsed.data.type} não pertence à fila ${queue}`,
    };
  }
  try {
    // O processamento da mensagem é um span de consumidor (plano 5.9): as consultas ao Postgres e as chamadas de saída do handler são
    // filhas dele no Application Insights. Os atributos são a fila, o tipo, a chave natural (`eod:2026-10-30`) e a tentativa.
    // sem a entrega, o handler é chamado só com a mensagem (a assinatura de antes das decisões)
    await inSpan(
      `process ${queue}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'servicebus',
          'messaging.destination.name': queue,
          'messaging.operation.type': 'process',
          'messaging.message.id': messageId(parsed.data),
          'alvesting.job.type': parsed.data.type,
          ...(delivery
            ? {
                'alvesting.delivery.attempt': delivery.attempt,
                'alvesting.delivery.last': delivery.lastAttempt,
              }
            : {}),
        },
      },
      () => (delivery ? handler(parsed.data, delivery) : handler(parsed.data)),
    );
    return { action: 'complete' };
  } catch (error) {
    return { action: 'retry', message: parsed.data, error };
  }
}
