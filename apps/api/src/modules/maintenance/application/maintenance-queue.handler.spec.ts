import { describe, expect, it, vi } from 'vitest';
import { MaintenanceQueueHandler } from './maintenance-queue.handler.js';

// A fila maintenance tem duas mensagens (plano 5.5): `retention {data}` e `backup-verify {mês}`. O handler da fila só despacha cada uma para o
// executor dela; o job_run, a idempotência e o alerta de job falho são de cada executor.
const setup = () => {
  const retention = { execute: vi.fn(() => Promise.resolve()) };
  const backup = { execute: vi.fn(() => Promise.resolve()) };
  return { retention, backup, handler: new MaintenanceQueueHandler(retention, backup) };
};

describe('MaintenanceQueueHandler', () => {
  it('retention vai para a retenção, com a data da mensagem', async () => {
    const { handler, retention, backup } = setup();
    await handler.handle({ type: 'retention', date: '2026-11-08' });
    expect(retention.execute).toHaveBeenCalledWith('2026-11-08');
    expect(backup.execute).not.toHaveBeenCalled();
  });

  it('backup-verify vai para o backup-verify, com o mês da mensagem', async () => {
    const { handler, retention, backup } = setup();
    await handler.handle({ type: 'backup-verify', month: '2026-11' });
    expect(backup.execute).toHaveBeenCalledWith('2026-11');
    expect(retention.execute).not.toHaveBeenCalled();
  });

  it('o que não é da fila maintenance falha dizendo qual fila é a certa (rede de segurança: o handleDelivery já manda para a DLQ)', async () => {
    const { handler, retention, backup } = setup();
    await expect(handler.handle({ type: 'eod', date: '2026-11-03' })).rejects.toThrow(
      /maintenance não trata mensagens eod/,
    );
    expect(retention.execute).not.toHaveBeenCalled();
    expect(backup.execute).not.toHaveBeenCalled();
  });

  it('a falha do executor sobe (a fila repete, e depois da última entrega vai para a DLQ)', async () => {
    const { handler, backup } = setup();
    backup.execute.mockRejectedValueOnce(new Error('pg_dump falhou'));
    await expect(handler.handle({ type: 'backup-verify', month: '2026-11' })).rejects.toThrow(
      /pg_dump falhou/,
    );
  });
});
