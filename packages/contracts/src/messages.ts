import { z } from 'zod';
import { safeParseJson, safeParseValue, type ParseResult } from './json.js';

const MIN = 60_000;

// As 6 filas do plano (5.5). Os nomes são os das filas no Service Bus (e no Config.json do emulador).
// maxDeliveryCount: tentativas do handler; depois da última a mensagem vai para a DLQ (ADR 0015).
// concurrency: mensagens simultâneas por processo.
// lockRenewalMs: por quanto tempo o SDK renova a trava da mensagem enquanto o handler roda. A trava da
//   fila é de 1 min (LockDuration PT1M no Config.json e no Bicep); sem renovação, o handler que passa de
//   1 min perde a mensagem para outra réplica. 5 min é o padrão do SDK. decisions: o job tem timeout de
//   25 min (plano 5.3), então 26 min. maintenance: o backup-verify (dump, envio e restauração em fluxo) tem prazo de 20 min, então 25.
// retryDelayMs: espera base entre tentativas; a espera antes da tentativa n+1 é retryDelayMs * n. decisions
//   espera mais porque a falha típica é provedor de LLM fora: 10 min e 20 min cobrem uma queda de ~30 min
//   dentro da janela de 90 min até o prazo das 09:30. maintenance espera 10 min por outro motivo: se a réplica morre no meio do
//   backup-verify, o job_run fica RUNNING e só é reassumido depois de lockRenewalMs (JobRunStore.claim). A última tentativa tem de
//   cair depois desse prazo (10 min + 20 min = 30 min > 25 min); com 1 min, as três entregas veriam `busy` e a mensagem iria para a
//   DLQ uns 4 minutos depois da queda, sem ninguém retomar o trabalho. Vale para toda fila (provado no messages.spec.ts):
//   retryDelayMs * (1 + ... + (maxDeliveryCount - 1)) > lockRenewalMs.
// decisions: as 10 execuções em paralelo são réplicas do job (etapa 2), cada uma trata 1 mensagem.
export const QUEUES = {
  market: { maxDeliveryCount: 10, concurrency: 1, lockRenewalMs: 5 * MIN, retryDelayMs: MIN },
  news: { maxDeliveryCount: 5, concurrency: 4, lockRenewalMs: 5 * MIN, retryDelayMs: MIN },
  briefing: { maxDeliveryCount: 5, concurrency: 1, lockRenewalMs: 5 * MIN, retryDelayMs: MIN },
  decisions: {
    maxDeliveryCount: 3,
    concurrency: 1,
    lockRenewalMs: 26 * MIN,
    retryDelayMs: 10 * MIN,
  },
  settlement: { maxDeliveryCount: 5, concurrency: 1, lockRenewalMs: 5 * MIN, retryDelayMs: MIN },
  maintenance: {
    maxDeliveryCount: 3,
    concurrency: 1,
    lockRenewalMs: 25 * MIN,
    retryDelayMs: 10 * MIN,
  },
} as const;
export type QueueName = keyof typeof QUEUES;

// Os IDs das tabelas são ULID (apps/api/src/common/id.ts); as rotas e os contratos de leitura validam com este.
export const ulidSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const ulid = ulidSchema;
// Pregão ou dia da carga, no calendário de Brasília.
const date = z.iso.date();
// Semana ISO a que o universo se aplica, ex.: 2026-W44.
const week = z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const source = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
// Meia hora em UTC, numa única grafia (sem milissegundos): duas grafias do mesmo instante dariam dois
// MessageId e quebrariam a idempotência.
const slot = z.iso.datetime({ precision: 0 }).regex(/:(00|30):00Z$/);

export const queueMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('eod'), date }),
  z.strictObject({ type: z.literal('universe'), week }),
  z.strictObject({ type: z.literal('fetch'), source, slot }),
  z.strictObject({ type: z.literal('freeze'), date }),
  z.strictObject({ type: z.literal('decide'), cycleId: ulid, competitorId: ulid }),
  z.strictObject({ type: z.literal('settle'), seasonId: ulid, date }),
  z.strictObject({ type: z.literal('retention'), date }),
  z.strictObject({ type: z.literal('backup-verify'), month }),
]);
export type QueueMessage = z.infer<typeof queueMessageSchema>;
export type MessageType = QueueMessage['type'];

const QUEUE_OF: Record<MessageType, QueueName> = {
  eod: 'market',
  universe: 'market',
  fetch: 'news',
  freeze: 'briefing',
  decide: 'decisions',
  settle: 'settlement',
  retention: 'maintenance',
  'backup-verify': 'maintenance',
};

export const queueFor = (message: Pick<QueueMessage, 'type'>): QueueName => QUEUE_OF[message.type];

// Chave natural de cada mensagem (pregão, ciclo + competidor...). É única no banco: mensagem repetida
// não faz nada.
export function idempotencyKey(message: QueueMessage): string {
  switch (message.type) {
    case 'eod':
    case 'freeze':
    case 'retention':
      return message.date;
    case 'universe':
      return message.week;
    case 'fetch':
      return `${message.source}:${message.slot}`;
    case 'decide':
      return `${message.cycleId}:${message.competitorId}`;
    case 'settle':
      return `${message.seasonId}:${message.date}`;
    case 'backup-verify':
      return message.month;
  }
}

// MessageId determinístico (ex.: eod:2026-10-30). O Basic não detecta duplicata: quem garante a
// idempotência é a chave única no banco, o MessageId só identifica a mensagem e a reenvia igual da DLQ.
export const messageId = (message: QueueMessage): string =>
  `${message.type}:${idempotencyKey(message)}`;

// O corpo chega como objeto, texto JSON ou bytes (mensagem enviada por outra ferramenta).
export function parseQueueMessage(body: unknown): ParseResult<QueueMessage> {
  if (typeof body === 'string') return safeParseJson(queueMessageSchema, body);
  if (body instanceof Uint8Array) {
    return safeParseJson(queueMessageSchema, new TextDecoder().decode(body));
  }
  return safeParseValue(queueMessageSchema, body);
}
