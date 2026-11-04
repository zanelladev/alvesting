import { Logger } from '@nestjs/common';
import type { QueueMessage } from '@alvesting/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { JobBusyError, type ClaimResult } from '../../messaging/infrastructure/job-run.store.js';
import { NEWS_SOURCES } from '../domain/sources.js';
import { FetchHandler } from './fetch.handler.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

const SLOT = '2026-11-01T17:30:00Z';
const NOW = new Date('2026-11-01T17:30:04Z');
const CLAIM: ClaimResult = { status: 'claimed', claim: { id: 'job-1', attempt: 1 } };
const message = (source: string) => ({ type: 'fetch', source, slot: SLOT }) as const;

function setup(claim: ClaimResult = CLAIM, clock?: () => Date) {
  const jobs = {
    claim: vi.fn((_message: QueueMessage) => Promise.resolve(claim)),
    succeed: vi.fn(() => Promise.resolve()),
    fail: vi.fn((_claim: unknown, _error: unknown) => Promise.resolve()),
  };
  const rss = {
    run: vi.fn((_source: unknown, _now: Date) =>
      Promise.resolve({ items: 1, usable: 1, created: 1 }),
    ),
  };
  const cvm = {
    run: vi.fn((_now: Date) =>
      Promise.resolve({ mappingChanged: 0, documents: 0, mapped: 0, created: 0 }),
    ),
  };
  const bcb = { run: vi.fn((_now: Date) => Promise.resolve({})) };
  return { handler: new FetchHandler(jobs, rss, cvm, bcb, clock), jobs, rss, cvm, bcb };
}

describe('FetchHandler', () => {
  it('a função da fila usa o relógio injetado: o ensaio simula a hora, e os buscadores recebem a dela', async () => {
    const t = setup(CLAIM, () => NOW);
    await t.handler.handle(message('agencia-brasil'));
    await t.handler.handle(message('bcb-sgs'));
    expect(t.rss.run).toHaveBeenCalledWith(
      NEWS_SOURCES.find((s) => s.id === 'agencia-brasil'),
      NOW,
    );
    expect(t.bcb.run).toHaveBeenCalledWith(NOW);
  });

  it('cada fonte da lista vai para o seu buscador, com a hora do processamento', async () => {
    for (const source of NEWS_SOURCES) {
      const t = setup();
      await expect(t.handler.execute(message(source.id), NOW)).resolves.toBe('fetched');
      expect(t.jobs.claim).toHaveBeenCalledWith(message(source.id));
      expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
      expect(t.rss.run).toHaveBeenCalledTimes(source.kind === 'rss' ? 1 : 0);
      expect(t.cvm.run).toHaveBeenCalledTimes(source.kind === 'cvm' ? 1 : 0);
      expect(t.bcb.run).toHaveBeenCalledTimes(source.kind === 'bcb' ? 1 : 0);
      if (source.kind === 'rss') expect(t.rss.run).toHaveBeenCalledWith(source, NOW);
      if (source.kind === 'cvm') expect(t.cvm.run).toHaveBeenCalledWith(NOW);
      if (source.kind === 'bcb') expect(t.bcb.run).toHaveBeenCalledWith(NOW);
    }
  });

  it('fonte que não está na lista fixa falha sem nem assumir a mensagem (nenhuma URL vem da fila)', async () => {
    const t = setup();
    await expect(t.handler.execute(message('atacante'), NOW)).rejects.toThrow(
      /Fonte desconhecida: atacante/,
    );
    await expect(t.handler.execute(message('constructor'), NOW)).rejects.toThrow(
      /Fonte desconhecida/,
    );
    expect(t.jobs.claim).not.toHaveBeenCalled();
    expect(t.rss.run).not.toHaveBeenCalled();
  });

  it('mensagem repetida depois de concluída não busca de novo', async () => {
    const t = setup({ status: 'done' });
    await expect(t.handler.execute(message('infomoney'), NOW)).resolves.toBe('already_done');
    expect(t.rss.run).not.toHaveBeenCalled();
    expect(t.jobs.succeed).not.toHaveBeenCalled();
  });

  it('outra entrega em andamento: falha com JobBusyError, para a fila tentar de novo', async () => {
    const t = setup({ status: 'busy' });
    await expect(t.handler.execute(message('infomoney'), NOW)).rejects.toBeInstanceOf(JobBusyError);
    expect(t.rss.run).not.toHaveBeenCalled();
  });

  it('se a busca falha, registra a falha no job e relança o erro original', async () => {
    const t = setup();
    const boom = new Error('HTTP 503 de www.infomoney.com.br');
    t.rss.run.mockRejectedValueOnce(boom);
    await expect(t.handler.execute(message('infomoney'), NOW)).rejects.toBe(boom);
    expect(t.jobs.fail).toHaveBeenCalledWith(
      CLAIM.status === 'claimed' ? CLAIM.claim : undefined,
      boom,
    );
    expect(t.jobs.succeed).not.toHaveBeenCalled();
  });

  it('handle trata só mensagens fetch', async () => {
    const t = setup();
    await t.handler.handle(message('bcb-sgs'));
    expect(t.bcb.run).toHaveBeenCalledTimes(1);
    await expect(t.handler.handle({ type: 'eod', date: '2026-10-30' })).rejects.toThrow(
      /fila news/,
    );
  });
});
