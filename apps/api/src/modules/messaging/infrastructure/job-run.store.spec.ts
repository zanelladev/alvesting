import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { JobRunStore } from './job-run.store.js';

// O que muda com o banco fora do ar. A idempotência com o Postgres de verdade (claim, reassumir, dono antigo) está
// em job-run.store.integration.spec.ts.
const claim = { id: 'job-1', attempt: 1 };

function storeWith(updateMany: (args: unknown) => Promise<unknown>) {
  return new JobRunStore({ jobRun: { updateMany } } as unknown as PrismaService);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JobRunStore.fail', () => {
  // Todo handler faz `catch (error) { await jobs.fail(claim, error); throw error; }`. Se o banco que derrubou o
  // handler também derrubar o fail, o erro do fail tomaria o lugar do original, e o motivo real sumiria do log, da
  // DLQ e do alerta.
  it('não troca o erro do handler pelo do banco: a falha de gravar só é avisada', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const store = storeWith(() => Promise.reject(new Error('banco fora')));
    await expect(store.fail(claim, new Error('B3 fora'))).resolves.toBeUndefined();
    const [context, message] = warn.mock.calls[0] as unknown as [
      { jobId: string; err: Error },
      string,
    ];
    expect(context.jobId).toBe('job-1');
    expect(context.err.message).toBe('banco fora');
    expect(message).toContain('FAILED');
  });

  it('o handler vê o erro original, não o do banco', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const store = storeWith(() => Promise.reject(new Error('banco fora')));
    const handler = async () => {
      try {
        throw new Error('B3 fora');
      } catch (error) {
        await store.fail(claim, error);
        throw error;
      }
    };
    await expect(handler()).rejects.toThrow('B3 fora');
  });

  it('grava FAILED com o motivo, só para o dono da tentativa que ainda está RUNNING', async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    await storeWith(updateMany).fail(claim, new Error('brapi ausente'));
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'job-1', attempts: 1, status: 'RUNNING' },
      data: { status: 'FAILED', error: 'brapi ausente', finishedAt: expect.any(Date) as Date },
    });
  });

  it('corta o motivo para caber na coluna', async () => {
    const updateMany = vi.fn((_args: unknown) => Promise.resolve({ count: 1 }));
    await storeWith(updateMany).fail(claim, new Error('x'.repeat(5000)));
    const [args] = updateMany.mock.calls[0] as unknown as [{ data: { error: string } }];
    expect(args.data.error).toHaveLength(2000);
  });
});

// O alerta "job_run FAILED" (infra/modules/alerts.bicep) procura esta linha. Quem escreve o FAILED é o fail(): a espera do eod pelo
// arquivo do pregão passa pelo wait() e não entra na conta.
describe('JobRunStore: a linha de log do alerta de job falho', () => {
  const labeled = {
    id: 'job-9',
    attempt: 2,
    label: { queue: 'market', type: 'eod', key: 'eod:2026-11-03' },
  };
  const errorLine = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.find((call) => call[1] === ALERT_LOG.jobFailed) as
      [Record<string, unknown>, string] | undefined;

  it('fail() escreve a linha com a fila, o tipo, a chave e a tentativa, e o motivo sem dado pessoal', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await storeWith(() => Promise.resolve({ count: 1 })).fail(
      labeled,
      new Error('violação para pessoa@example.test de 203.0.113.9 ?token=abc123'),
    );
    const [context] = errorLine(error)!;
    expect(context).toMatchObject({
      queue: 'market',
      type: 'eod',
      key: 'eod:2026-11-03',
      attempt: 2,
      jobId: 'job-9',
    });
    expect(String(context.reason)).toContain('violação para');
    expect(JSON.stringify(context)).not.toMatch(/pessoa@example|203\.0\.113|abc123/);
  });

  it('a linha sai mesmo com o banco fora (o alerta não depende de gravar o FAILED)', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await storeWith(() => Promise.reject(new Error('banco fora'))).fail(labeled, new Error('x'));
    expect(errorLine(error)).toBeDefined();
  });

  it('wait() grava WAITING com o motivo para o dono da tentativa e NÃO escreve a linha do alerta', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const updateMany = vi.fn((_args: unknown) => Promise.resolve({ count: 1 }));
    await storeWith(updateMany).wait(labeled, 'brapi sem todas as barras; nova tentativa às 22:30');
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'job-9', attempts: 2, status: 'RUNNING' },
      data: {
        status: 'WAITING',
        error: 'brapi sem todas as barras; nova tentativa às 22:30',
        finishedAt: expect.any(Date) as Date,
      },
    });
    expect(errorLine(error)).toBeUndefined();
  });
});

describe('JobRunStore.succeed', () => {
  // Concluir a mensagem sem a linha do job concluída perderia o trabalho se a dona caísse: aqui a falha sobe.
  it('segue falhando alto quando o banco cai', async () => {
    const store = storeWith(() => Promise.reject(new Error('banco fora')));
    await expect(store.succeed(claim)).rejects.toThrow('banco fora');
  });
});
