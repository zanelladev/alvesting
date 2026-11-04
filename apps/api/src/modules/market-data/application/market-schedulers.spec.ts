import { Logger } from '@nestjs/common';
import type { QueueMessage } from '@alvesting/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTradingCalendar } from '../domain/trading-calendar.js';
import { MarketSchedulers } from './market-schedulers.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

function setup() {
  const messaging = { publish: vi.fn((_message: QueueMessage) => Promise.resolve()) };
  return { schedulers: new MarketSchedulers(messaging, loadTradingCalendar()), messaging };
}

describe('MarketSchedulers.eod (sched-eod, cron 30 0 * * 2-6 em UTC)', () => {
  it('o pregão é a data de Brasília do fechamento: terça 00:30 UTC é segunda 21:30', async () => {
    const t = setup();
    await expect(t.schedulers.eod(new Date('2026-11-04T00:30:07Z'))).resolves.toBe('published');
    expect(t.messaging.publish).toHaveBeenCalledWith({ type: 'eod', date: '2026-11-03' });
  });

  it('sexta 30/10/2026: o job de sábado 00:30 UTC publica o pregão de sexta', async () => {
    const t = setup();
    await t.schedulers.eod(new Date('2026-10-31T00:30:00Z'));
    expect(t.messaging.publish).toHaveBeenCalledWith({ type: 'eod', date: '2026-10-30' });
  });

  it('só publica se for pregão: Finados (02/11/2026) não publica', async () => {
    const t = setup();
    // terça 03/11 00:30 UTC = segunda 02/11 21:30 em Brasília
    await expect(t.schedulers.eod(new Date('2026-11-03T00:30:00Z'))).resolves.toBe('skipped');
    expect(t.messaging.publish).not.toHaveBeenCalled();
  });

  it('feriado nacional no meio da semana também não publica (Natal, 25/12/2026)', async () => {
    const t = setup();
    await expect(t.schedulers.eod(new Date('2026-12-26T00:30:00Z'))).resolves.toBe('skipped');
  });

  it('o MessageId é determinístico: a mesma mensagem nas duas execuções do mesmo dia', async () => {
    const t = setup();
    await t.schedulers.eod(new Date('2026-11-04T00:30:00Z'));
    await t.schedulers.eod(new Date('2026-11-04T00:31:40Z')); // retry do job
    const [first, second] = t.messaging.publish.mock.calls as unknown as [[unknown], [unknown]];
    expect(first[0]).toEqual(second[0]);
  });

  it('falha de publicação sobe (o job do Container Apps tenta de novo)', async () => {
    const t = setup();
    t.messaging.publish.mockRejectedValue(new Error('Service Bus fora'));
    await expect(t.schedulers.eod(new Date('2026-11-04T00:30:00Z'))).rejects.toThrow(
      /Service Bus fora/,
    );
  });

  it('data fora da lista de feriados falha alto em vez de calar o eod', async () => {
    const t = setup();
    await expect(t.schedulers.eod(new Date('2028-01-05T00:30:00Z'))).rejects.toThrow(
      /não cobre 2028/,
    );
    expect(t.messaging.publish).not.toHaveBeenCalled();
  });
});

describe('MarketSchedulers.universe (sched-universe, domingo 12:00 UTC)', () => {
  it('domingo 01/11/2026 publica a semana que começa amanhã: 2026-W45', async () => {
    const t = setup();
    await t.schedulers.universe(new Date('2026-11-01T12:00:03Z'));
    expect(t.messaging.publish).toHaveBeenCalledWith({ type: 'universe', week: '2026-W45' });
  });

  it('domingo 8/11 publica a W46 e o último domingo do ano ISO publica a semana 1 do seguinte', async () => {
    const t = setup();
    await t.schedulers.universe(new Date('2026-11-08T12:00:00Z'));
    await t.schedulers.universe(new Date('2027-01-03T12:00:00Z')); // domingo; amanhã é 04/01/2027, W01 de 2027
    expect(t.messaging.publish.mock.calls.map(([m]) => m)).toEqual([
      { type: 'universe', week: '2026-W46' },
      { type: 'universe', week: '2027-W01' },
    ]);
  });

  it('o universo não depende de ser pregão: roda no domingo', async () => {
    const t = setup();
    await expect(t.schedulers.universe(new Date('2026-11-01T12:00:00Z'))).resolves.toBe(
      'published',
    );
  });
});
