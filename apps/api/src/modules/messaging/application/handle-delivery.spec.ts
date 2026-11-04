import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { QueueMessage } from '@alvesting/contracts';
import { SanitizingSpanProcessor } from '../../../telemetry/sanitize.js';
import { handleDelivery } from './handle-delivery.js';

const eod: QueueMessage = { type: 'eod', date: '2026-10-30' };

describe('handleDelivery: o handler roda sem fila nenhuma', () => {
  it('conclui quando o handler termina bem e entrega a mensagem já validada', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    await expect(handleDelivery('market', eod, handler)).resolves.toEqual({ action: 'complete' });
    expect(handler).toHaveBeenCalledExactlyOnceWith(eod);
  });

  it('entrega ao handler também a tentativa e se é a última, quando quem chama a informa', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const delivery = { attempt: 3, lastAttempt: true };
    await handleDelivery('market', eod, handler, delivery);
    expect(handler).toHaveBeenCalledExactlyOnceWith(eod, delivery);
  });

  it('aceita o corpo como objeto, texto JSON ou bytes', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    for (const body of [eod, JSON.stringify(eod), Buffer.from(JSON.stringify(eod))]) {
      await expect(handleDelivery('market', body, handler)).resolves.toEqual({
        action: 'complete',
      });
    }
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('pede nova tentativa quando o handler falha, levando a mensagem validada e o erro', async () => {
    const error = new Error('brapi fora do ar');
    const outcome = await handleDelivery('market', eod, () => Promise.reject(error));
    expect(outcome).toEqual({ action: 'retry', message: eod, error });
  });

  it('a mensagem da nova tentativa é a validada, mesmo que o corpo tenha chegado como texto', async () => {
    const outcome = await handleDelivery('market', JSON.stringify(eod), () =>
      Promise.reject(new Error('falhou')),
    );
    expect(outcome).toMatchObject({ action: 'retry', message: eod });
  });

  it('pede nova tentativa também quando o handler lança de forma síncrona', async () => {
    const outcome = await handleDelivery('market', eod, () => {
      throw new Error('boom');
    });
    expect(outcome.action).toBe('retry');
  });

  it('pede nova tentativa quando o handler rejeita com algo que não é Error', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- o caso testado é justamente rejeitar sem Error
    const outcome = await handleDelivery('market', eod, () => Promise.reject('texto solto'));
    expect(outcome).toEqual({ action: 'retry', message: eod, error: 'texto solto' });
  });
});

describe('handleDelivery: mensagem que nunca vai dar certo vai direto para a DLQ', () => {
  it.each([
    ['JSON quebrado', '{"type": "eod", "date": ', 'invalid_json'],
    ['bytes que não são JSON', Buffer.from([0xff, 0xfe, 0x00]), 'invalid_json'],
    ['tipo desconhecido', { type: 'nope' }, 'invalid_schema'],
    ['data inexistente', { type: 'eod', date: '2026-02-30' }, 'invalid_schema'],
    ['corpo nulo', null, 'invalid_schema'],
  ])('%s', async (_nome, body, reason) => {
    const handler = vi.fn();
    const outcome = await handleDelivery('market', body, handler);
    expect(outcome).toMatchObject({ action: 'deadletter', reason });
    expect(handler).not.toHaveBeenCalled();
  });

  it('mensagem válida na fila errada também vai para a DLQ', async () => {
    const handler = vi.fn();
    const outcome = await handleDelivery('news', eod, handler);
    expect(outcome).toMatchObject({ action: 'deadletter', reason: 'wrong_queue' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('a descrição aponta o campo e não repete o valor recebido', async () => {
    const outcome = await handleDelivery('market', { type: 'eod', date: 'segredo-123' }, vi.fn());
    expect(outcome.action).toBe('deadletter');
    if (outcome.action === 'deadletter') {
      expect(outcome.description).toContain('date');
      expect(outcome.description).not.toContain('segredo-123');
      expect(outcome.description.length).toBeLessThanOrEqual(500);
    }
  });
});

// O processamento da mensagem da fila no Application Insights (plano 5.9): um span de consumidor por entrega, com a fila, o tipo, a
// chave natural e a tentativa. As consultas ao banco e as chamadas de saída do handler viram filhas dele.
describe('handleDelivery: o span da mensagem', () => {
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    new NodeTracerProvider({
      spanProcessors: [new SanitizingSpanProcessor(), new SimpleSpanProcessor(exporter)],
    }).register();
  });
  afterEach(() => exporter.reset());

  it('uma entrega que dá certo gera um span CONSUMER "process <fila>", OK, com a mensagem e a tentativa', async () => {
    await handleDelivery('market', eod, () => Promise.resolve(), {
      attempt: 2,
      lastAttempt: false,
    });
    const [span] = exporter.getFinishedSpans();
    expect(span).toMatchObject({ name: 'process market', kind: SpanKind.CONSUMER });
    expect(span?.status.code).toBe(SpanStatusCode.OK);
    expect(span?.attributes).toMatchObject({
      'messaging.system': 'servicebus',
      'messaging.destination.name': 'market',
      'messaging.operation.type': 'process',
      'messaging.message.id': 'eod:2026-10-30',
      'alvesting.job.type': 'eod',
      'alvesting.delivery.attempt': 2,
      'alvesting.delivery.last': false,
      'ai.operation.name': 'process market',
    });
  });

  it('a falha do handler marca o span ERROR, registra a exceção sem dado pessoal e continua devolvendo o retry', async () => {
    const error = new Error('falhou para pessoa@example.test de 203.0.113.9');
    const outcome = await handleDelivery('market', eod, () => Promise.reject(error));
    expect(outcome).toEqual({ action: 'retry', message: eod, error });
    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(JSON.stringify(span?.events)).not.toMatch(/pessoa@example|203\.0\.113/);
    expect(span?.events.map((event) => event.name)).toEqual(['exception']);
  });

  it('a mensagem inválida e a de outra fila não chegam ao handler e não geram span', async () => {
    await handleDelivery('market', { type: 'nada' }, () => Promise.resolve());
    await handleDelivery('news', eod, () => Promise.resolve());
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});
