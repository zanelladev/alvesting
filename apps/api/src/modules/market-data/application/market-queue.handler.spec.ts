import type { QueueMessage } from '@alvesting/contracts';
import { describe, expect, it, vi } from 'vitest';
import { handleDelivery } from '../../messaging/application/handle-delivery.js';
import { MarketQueueHandler } from './market-queue.handler.js';

function setup() {
  const eod = { execute: vi.fn(() => Promise.resolve('complete' as const)) };
  const universe = { execute: vi.fn(() => Promise.resolve('created' as const)) };
  return { handler: new MarketQueueHandler(eod, universe), eod, universe };
}

describe('MarketQueueHandler', () => {
  it('roteia eod para o EodHandler com o pregão da mensagem', async () => {
    const t = setup();
    await t.handler.handle({ type: 'eod', date: '2026-10-30' });
    expect(t.eod.execute).toHaveBeenCalledWith('2026-10-30');
    expect(t.universe.execute).not.toHaveBeenCalled();
  });

  it('com relógio injetado, o eod e o universo recebem a hora dele (o ensaio simula o dia; sem relógio, usam o da máquina)', async () => {
    const eod = { execute: vi.fn(() => Promise.resolve('complete' as const)) };
    const universe = { execute: vi.fn(() => Promise.resolve('created' as const)) };
    const at = new Date('2026-11-04T00:30:20Z');
    const handler = new MarketQueueHandler(eod, universe, () => at);
    await handler.handle({ type: 'eod', date: '2026-11-03' });
    expect(eod.execute).toHaveBeenCalledWith('2026-11-03', at);
    // o universo também: a atualização semanal da brapi conta os 3 meses de histórico a partir do dia da execução
    await handler.handle({ type: 'universe', week: '2026-W45' });
    expect(universe.execute).toHaveBeenCalledWith('2026-W45', at);
  });

  it('roteia universe para o UniverseHandler com a semana da mensagem', async () => {
    const t = setup();
    await t.handler.handle({ type: 'universe', week: '2026-W45' });
    expect(t.universe.execute).toHaveBeenCalledWith('2026-W45');
    expect(t.eod.execute).not.toHaveBeenCalled();
  });

  it('mensagem de outra fila é erro (rede de segurança)', async () => {
    const t = setup();
    const foreign: QueueMessage = { type: 'freeze', date: '2026-10-30' };
    await expect(t.handler.handle(foreign)).rejects.toThrow(/market.*freeze/);
  });

  it('funciona dentro do handleDelivery da fila market: conclui, e a falha do handler vira nova tentativa', async () => {
    const t = setup();
    expect(
      await handleDelivery('market', { type: 'eod', date: '2026-10-30' }, t.handler.handle),
    ).toEqual({
      action: 'complete',
    });

    t.eod.execute.mockRejectedValueOnce(new Error('brapi fora'));
    const outcome = await handleDelivery(
      'market',
      { type: 'eod', date: '2026-10-30' },
      t.handler.handle,
    );
    expect(outcome).toMatchObject({
      action: 'retry',
      message: { type: 'eod', date: '2026-10-30' },
    });
  });

  it('mensagem inválida ou de outra fila nem chega ao handler: vai para a DLQ', async () => {
    const t = setup();
    expect(
      await handleDelivery('market', { type: 'eod', date: 'ontem' }, t.handler.handle),
    ).toMatchObject({
      action: 'deadletter',
      reason: 'invalid_schema',
    });
    expect(
      await handleDelivery('market', { type: 'freeze', date: '2026-10-30' }, t.handler.handle),
    ).toMatchObject({
      action: 'deadletter',
      reason: 'wrong_queue',
    });
    expect(t.eod.execute).not.toHaveBeenCalled();
  });
});
