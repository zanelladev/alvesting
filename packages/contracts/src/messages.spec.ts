import { describe, expect, it } from 'vitest';
import {
  QUEUES,
  idempotencyKey,
  messageId,
  parseQueueMessage,
  queueFor,
  queueMessageSchema,
  type QueueMessage,
} from './messages.js';

const CYCLE = '01K8Z3Q4M9X7R2T5V6W8Y0A1B2';
const COMPETITOR = '01K8Z3Q4M9X7R2T5V6W8Y0A1B3';
const SEASON = '01K8Z3Q4M9X7R2T5V6W8Y0A1B4';

// uma mensagem válida de cada tipo, com o MessageId e a chave de idempotência esperados
const cases: Array<[QueueMessage, { queue: string; messageId: string; key: string }]> = [
  [
    { type: 'eod', date: '2026-10-30' },
    { queue: 'market', messageId: 'eod:2026-10-30', key: '2026-10-30' },
  ],
  [
    { type: 'universe', week: '2026-W44' },
    { queue: 'market', messageId: 'universe:2026-W44', key: '2026-W44' },
  ],
  [
    { type: 'fetch', source: 'cvm-ipe', slot: '2026-10-30T10:30:00Z' },
    {
      queue: 'news',
      messageId: 'fetch:cvm-ipe:2026-10-30T10:30:00Z',
      key: 'cvm-ipe:2026-10-30T10:30:00Z',
    },
  ],
  [
    { type: 'freeze', date: '2026-10-30' },
    { queue: 'briefing', messageId: 'freeze:2026-10-30', key: '2026-10-30' },
  ],
  [
    { type: 'decide', cycleId: CYCLE, competitorId: COMPETITOR },
    {
      queue: 'decisions',
      messageId: `decide:${CYCLE}:${COMPETITOR}`,
      key: `${CYCLE}:${COMPETITOR}`,
    },
  ],
  [
    { type: 'settle', seasonId: SEASON, date: '2026-10-30' },
    { queue: 'settlement', messageId: `settle:${SEASON}:2026-10-30`, key: `${SEASON}:2026-10-30` },
  ],
  [
    { type: 'retention', date: '2026-11-01' },
    { queue: 'maintenance', messageId: 'retention:2026-11-01', key: '2026-11-01' },
  ],
  [
    { type: 'backup-verify', month: '2026-11' },
    { queue: 'maintenance', messageId: 'backup-verify:2026-11', key: '2026-11' },
  ],
];

const MIN = 60_000;

describe('as 6 filas do plano (5.5)', () => {
  it('têm nome, entregas máximas e concorrência da tabela', () => {
    const table = Object.fromEntries(
      Object.entries(QUEUES).map(([name, q]) => [
        name,
        { maxDeliveryCount: q.maxDeliveryCount, concurrency: q.concurrency },
      ]),
    );
    expect(table).toEqual({
      market: { maxDeliveryCount: 10, concurrency: 1 },
      news: { maxDeliveryCount: 5, concurrency: 4 },
      briefing: { maxDeliveryCount: 5, concurrency: 1 },
      decisions: { maxDeliveryCount: 3, concurrency: 1 },
      settlement: { maxDeliveryCount: 5, concurrency: 1 },
      maintenance: { maxDeliveryCount: 3, concurrency: 1 },
    });
  });

  it('a trava do job de decisões é renovada por mais que o timeout de 25 min (plano 5.3)', () => {
    // estrito: com 25 min exatos a trava venceria junto com o replicaTimeout e outra réplica poderia reassumir a linha
    expect(QUEUES.decisions.lockRenewalMs).toBeGreaterThan(25 * MIN);
  });

  // O backup-verify (pg_dump, envio ao Blob e pg_restore, em fluxo) tem prazo de 20 min (apps/api, BackupVerifyHandler). Com a renovação
  // de 5 min do padrão, a trava venceria no meio, outra réplica receberia a mesma mensagem e o JobRunStore a reassumiria como "dona caiu".
  it('a trava da fila maintenance é renovada por mais que o prazo de 20 min do backup-verify', () => {
    expect(QUEUES.maintenance.lockRenewalMs).toBeGreaterThan(20 * MIN);
  });

  it('toda fila renova a trava além do LockDuration de 1 min e espera entre as tentativas', () => {
    for (const [name, queue] of Object.entries(QUEUES)) {
      expect(queue.lockRenewalMs, name).toBeGreaterThan(MIN);
      expect(queue.retryDelayMs, name).toBeGreaterThan(0);
    }
  });

  it('o job de decisões espera o bastante para um provedor voltar antes do prazo das 09:30', () => {
    // 3 tentativas, esperas de 1x e 2x a base: o retorno do provedor tem ~30 min dentro da janela de 90.
    expect(QUEUES.decisions.retryDelayMs).toBeGreaterThanOrEqual(5 * MIN);
  });

  // O JobRunStore.claim só reassume um job_run RUNNING (a dona caiu no meio) depois de lockRenewalMs. A espera entre as tentativas é
  // retryDelayMs x n (antes da tentativa n+1), então a última tentativa cai retryDelayMs x (1 + ... + (maxDeliveryCount - 1)) depois da
  // primeira entrega. Se isso não passar de lockRenewalMs, todas as tentativas veem `busy` e a mensagem vai para a DLQ sem ninguém retomar
  // o trabalho (foi o caso da maintenance com 1 min: 3 min < 25 min).
  it.each(Object.entries(QUEUES))(
    '%s: a última tentativa cai depois de a trava da dona vencer, para uma réplica caída ser reassumida antes da DLQ',
    (_name, queue) => {
      const lastAttemptAfterMs =
        queue.retryDelayMs * ((queue.maxDeliveryCount * (queue.maxDeliveryCount - 1)) / 2);
      expect(lastAttemptAfterMs).toBeGreaterThan(queue.lockRenewalMs);
    },
  );

  it('a maintenance (backup-verify de até 20 min) espera 10 e 20 minutos: a última tentativa cai aos 30 min, depois dos 25 da trava', () => {
    expect(QUEUES.maintenance.retryDelayMs).toBe(10 * MIN);
    expect(QUEUES.maintenance.retryDelayMs * (1 + 2)).toBe(30 * MIN);
  });
});

describe.each(cases)('mensagem %j', (message, expected) => {
  it('é válida e volta igual do schema', () => {
    expect(queueMessageSchema.parse(message)).toEqual(message);
  });

  it('tem fila, MessageId e chave de idempotência determinísticos', () => {
    expect(queueFor(message)).toBe(expected.queue);
    expect(messageId(message)).toBe(expected.messageId);
    expect(idempotencyKey(message)).toBe(expected.key);
    expect(messageId({ ...message })).toBe(expected.messageId);
  });

  it('chega como texto JSON ou como objeto', () => {
    expect(parseQueueMessage(JSON.stringify(message))).toEqual({ success: true, data: message });
    expect(parseQueueMessage(message)).toEqual({ success: true, data: message });
    expect(parseQueueMessage(Buffer.from(JSON.stringify(message)))).toEqual({
      success: true,
      data: message,
    });
  });

  it('o MessageId cabe nos 128 caracteres do Service Bus', () => {
    expect(messageId(message).length).toBeLessThanOrEqual(128);
  });
});

describe('mensagens diferentes geram MessageId diferentes', () => {
  it('muda o dia, muda o MessageId', () => {
    expect(messageId({ type: 'eod', date: '2026-10-30' })).not.toBe(
      messageId({ type: 'eod', date: '2026-11-03' }),
    );
  });

  it('o mesmo dia em tipos diferentes não colide', () => {
    expect(messageId({ type: 'eod', date: '2026-10-30' })).not.toBe(
      messageId({ type: 'freeze', date: '2026-10-30' }),
    );
  });

  it('cada busca de notícia (fonte e meia hora) tem o seu', () => {
    const a = messageId({ type: 'fetch', source: 'cvm-ipe', slot: '2026-10-30T10:30:00Z' });
    const b = messageId({ type: 'fetch', source: 'cvm-ipe', slot: '2026-10-30T11:00:00Z' });
    const c = messageId({ type: 'fetch', source: 'valor', slot: '2026-10-30T10:30:00Z' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('decisão: ciclo e competidor entram na chave', () => {
    const a = messageId({ type: 'decide', cycleId: CYCLE, competitorId: COMPETITOR });
    const b = messageId({ type: 'decide', cycleId: CYCLE, competitorId: SEASON });
    expect(a).not.toBe(b);
  });
});

describe('mensagens inválidas', () => {
  it.each([
    ['tipo desconhecido', { type: 'nope', date: '2026-10-30' }],
    ['sem tipo', { date: '2026-10-30' }],
    ['data em formato brasileiro', { type: 'eod', date: '30/10/2026' }],
    ['dia que não existe', { type: 'eod', date: '2026-02-30' }],
    ['mês 13', { type: 'eod', date: '2026-13-01' }],
    ['data com hora', { type: 'eod', date: '2026-10-30T10:00:00Z' }],
    ['eod sem data', { type: 'eod' }],
    ['campo a mais', { type: 'eod', date: '2026-10-30', extra: true }],
    ['semana 54', { type: 'universe', week: '2026-W54' }],
    ['semana sem W', { type: 'universe', week: '2026-44' }],
    ['fonte com maiúscula', { type: 'fetch', source: 'CVM-IPE', slot: '2026-10-30T10:30:00Z' }],
    ['fonte com espaço', { type: 'fetch', source: 'cvm ipe', slot: '2026-10-30T10:30:00Z' }],
    ['fonte vazia', { type: 'fetch', source: '', slot: '2026-10-30T10:30:00Z' }],
    ['fonte longa demais', { type: 'fetch', source: 'a'.repeat(65), slot: '2026-10-30T10:30:00Z' }],
    ['meia hora quebrada', { type: 'fetch', source: 'cvm-ipe', slot: '2026-10-30T10:15:00Z' }],
    [
      'slot com milissegundos',
      { type: 'fetch', source: 'cvm-ipe', slot: '2026-10-30T10:30:00.000Z' },
    ],
    ['slot com segundos', { type: 'fetch', source: 'cvm-ipe', slot: '2026-10-30T10:30:15Z' }],
    ['slot com fuso', { type: 'fetch', source: 'cvm-ipe', slot: '2026-10-30T07:30:00-03:00' }],
    ['ULID minúsculo', { type: 'decide', cycleId: CYCLE.toLowerCase(), competitorId: COMPETITOR }],
    ['ULID curto', { type: 'decide', cycleId: '01K8Z3Q4', competitorId: COMPETITOR }],
    [
      'ULID com letra proibida (U)',
      { type: 'decide', cycleId: 'U'.repeat(26), competitorId: COMPETITOR },
    ],
    ['decide sem competidor', { type: 'decide', cycleId: CYCLE }],
    ['settle sem temporada', { type: 'settle', date: '2026-10-30' }],
    ['mês de backup inválido', { type: 'backup-verify', month: '2026-13' }],
    ['mês de backup com dia', { type: 'backup-verify', month: '2026-11-01' }],
  ])('rejeita %s', (_nome, valor) => {
    expect(queueMessageSchema.safeParse(valor).success).toBe(false);
  });
});

describe('parseQueueMessage com entrada ruim', () => {
  it.each([
    ['JSON quebrado', '{"type": "eod", "date": '],
    ['texto solto', 'processa isso aí'],
    ['vazio', ''],
    ['bytes que não são JSON', Buffer.from([0xff, 0xfe, 0x00])],
  ])('marca invalid_json para %s', (_nome, corpo) => {
    expect(parseQueueMessage(corpo)).toEqual({ success: false, reason: 'invalid_json' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['número', 42],
    ['lista', []],
    ['objeto fora do contrato', { type: 'eod', date: 'ontem' }],
    ['JSON válido fora do contrato', '{"type":"eod","date":"ontem"}'],
  ])('marca invalid_schema para %s', (_nome, corpo) => {
    const result = parseQueueMessage(corpo);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('invalid_schema');
  });
});
