import { ADMIN_DLQ_LISTED, ADMIN_TEXT_MAX, QUEUES, adminJobsSchema } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeadLetter } from '../../messaging/infrastructure/messaging.service.js';
import { AdminReportsService, DLQ_READ_TIMEOUT_MS, toDeadLetter } from './admin-reports.service.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// As leituras do painel que não precisam de banco (docs/API.md, seção 8): o que da mensagem da DLQ sai para o painel, e a DLQ que não
// responde. O resto (os números de jobs e custos) é do admin.integration.spec.ts, com Postgres.
const ULID = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
const message = (overrides: Partial<DeadLetter> = {}): DeadLetter => ({
  messageId: 'eod:2026-11-03',
  sequenceNumber: '1',
  deliveryCount: 10,
  reason: undefined,
  description: undefined,
  enqueuedAt: undefined,
  body: { canario: 'CORPO-NAO-SAI' },
  ...overrides,
});

describe('toDeadLetter: o que de uma mensagem da DLQ chega ao painel', () => {
  it('o MessageId que a arena monta passa igual e é reenviável (o botão manda o id mostrado)', () => {
    for (const id of [
      'eod:2026-11-03',
      `decide:${ULID}:${ULID}`,
      `settle:${ULID}:2026-11-09`,
      'fetch:infomoney:2026-11-05T10:00:00Z',
      'freeze:2026-11-03',
    ]) {
      expect(toDeadLetter(message({ messageId: id })), id).toMatchObject({
        messageId: id,
        resubmittable: true,
      });
    }
  });

  it('o MessageId de outra ferramenta sai limpo de dado pessoal e não é reenviável (o id mostrado não é o de verdade)', () => {
    const out = toDeadLetter(message({ messageId: 'envio de pessoa@example.test' }));
    expect(out.messageId).not.toContain('pessoa@example.test');
    expect(out.resubmittable).toBe(false);
    // um e-mail sozinho: só letras, dígitos e @, ponto: nem a limpeza o deixa passar como id reenviável
    const alone = toDeadLetter(message({ messageId: 'pessoa@example.test' }));
    expect(alone.messageId).not.toContain('pessoa@example.test');
    expect(alone.resubmittable).toBe(false);
  });

  it('id fora da forma (espaço, barra, curto, quebra de linha) é listado sem o botão; o grande é cortado', () => {
    for (const id of ['mensagem de fora', 'a/b', 'ab', 'linha\nquebrada', ':comecaPorDoisPontos']) {
      expect(toDeadLetter(message({ messageId: id })).resubmittable, JSON.stringify(id)).toBe(
        false,
      );
    }
    const huge = toDeadLetter(message({ messageId: 'palavra '.repeat(100) }));
    expect(huge.messageId).toHaveLength(ADMIN_TEXT_MAX.messageId);
    expect(huge.resubmittable).toBe(false);
    // texto comprido sem espaço parece token, e a limpeza o troca: o id mostrado deixa de ser o de verdade
    const token = toDeadLetter(message({ messageId: `eod:${'1'.repeat(500)}` }));
    expect(token.messageId).not.toContain('1'.repeat(40));
    expect(token.resubmittable).toBe(false);
  });

  it('o motivo e a descrição saem limpos e cortados, a data em ISO, e o corpo nunca sai', () => {
    const out = toDeadLetter(
      message({
        reason: 'palavra '.repeat(100),
        description: `falhou para pessoa@example.test ${'palavra '.repeat(100)} alv-canary-0123456789abcdef0123`,
        enqueuedAt: new Date('2026-11-04T00:30:00Z'),
      }),
    );
    expect(out.reason).toHaveLength(ADMIN_TEXT_MAX.reason);
    expect(out.description!.length).toBeLessThanOrEqual(ADMIN_TEXT_MAX.description);
    expect(out.description).not.toContain('pessoa@example.test');
    expect(out.description).not.toContain('alv-canary-');
    expect(out.enqueuedAt).toBe('2026-11-04T00:30:00.000Z');
    expect(JSON.stringify(out)).not.toContain('CORPO-NAO-SAI');
    expect(Object.keys(out).sort()).toEqual([
      'deliveryCount',
      'description',
      'enqueuedAt',
      'messageId',
      'reason',
      'resubmittable',
    ]);
  });
});

describe('AdminReportsService.jobs: a DLQ que não responde', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const empty = () => Promise.resolve([]);
  function service(readDeadLetters: (queue: string, max: number) => Promise<DeadLetter[]>) {
    const repo = { latestJobs: empty, jobCounts: empty, recentFailures: empty, fetchStates: empty };
    return new AdminReportsService(
      repo as never,
      {} as never,
      { readDeadLetters } as never,
      {} as never,
      () => new Date('2026-11-03T11:00:00Z'),
    );
  }

  it(`sem resposta em ${DLQ_READ_TIMEOUT_MS / 1000} s a fila sai "unavailable", sem esperar o tempo de verdade (relógio falso)`, async () => {
    vi.useFakeTimers();
    const pending = service(() => new Promise<DeadLetter[]>(() => undefined)).jobs();
    // um segundo antes do prazo ainda espera; no prazo, desiste de todas as filas de uma vez
    await vi.advanceTimersByTimeAsync(DLQ_READ_TIMEOUT_MS - 1_000);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    expect(adminJobsSchema.parse(result).queues).toHaveLength(Object.keys(QUEUES).length);
    expect(result.queues.every((q) => q.deadLetters.status === 'unavailable')).toBe(true);
    // o timer de cada leitura foi solto (nada pendente que prenda o processo)
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a leitura que responde antes do prazo conta a fila, até o teto, e não deixa timer pendente', async () => {
    vi.useFakeTimers();
    const many = Array.from({ length: ADMIN_DLQ_LISTED }, (_, i) =>
      message({ messageId: `fetch:infomoney:2026-11-05T10:${String(i).padStart(2, '0')}:00Z` }),
    );
    const result = await service((queue, max) =>
      Promise.resolve(queue === 'news' ? many.slice(0, max) : []),
    ).jobs();
    const news = result.queues.find((q) => q.queue === 'news')!.deadLetters;
    expect(news).toMatchObject({ status: 'ok', count: ADMIN_DLQ_LISTED, capped: true });
    expect(result.queues.find((q) => q.queue === 'market')!.deadLetters).toMatchObject({
      status: 'ok',
      count: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
