import { Logger } from '@nestjs/common';
import type { QueueMessage } from '@alvesting/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { BriefingSchedulers } from './briefing-schedulers.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

function setup() {
  const messaging = { publish: vi.fn((_message: QueueMessage) => Promise.resolve()) };
  return { schedulers: new BriefingSchedulers(messaging, loadTradingCalendar()), messaging };
}

describe('BriefingSchedulers.briefing (sched-briefing, cron 30 10 * * 1-5 em UTC)', () => {
  it('10:30 UTC é 07:30 em Brasília: publica o freeze do dia', async () => {
    const t = setup();
    await expect(t.schedulers.briefing(new Date('2026-10-30T10:30:04Z'))).resolves.toBe(
      'published',
    );
    expect(t.messaging.publish).toHaveBeenCalledWith({ type: 'freeze', date: '2026-10-30' });
  });

  it('só publica se for pregão: Finados (02/11/2026), segunda, não publica', async () => {
    const t = setup();
    await expect(t.schedulers.briefing(new Date('2026-11-02T10:30:00Z'))).resolves.toBe('skipped');
    expect(t.messaging.publish).not.toHaveBeenCalled();
  });

  it('feriado nacional no meio da semana também não publica (Natal, 25/12/2026)', async () => {
    const t = setup();
    await expect(t.schedulers.briefing(new Date('2026-12-25T10:30:00Z'))).resolves.toBe('skipped');
  });

  it('o MessageId é o mesmo nas duas execuções do dia (o retry do job não duplica)', async () => {
    const t = setup();
    await t.schedulers.briefing(new Date('2026-10-30T10:30:04Z'));
    await t.schedulers.briefing(new Date('2026-10-30T10:31:50Z'));
    const [first, second] = t.messaging.publish.mock.calls.map(([message]) => message);
    expect(first).toEqual(second);
  });

  it('falha de publicação sobe, para o job do Container Apps tentar de novo', async () => {
    const t = setup();
    t.messaging.publish.mockRejectedValue(new Error('Service Bus fora'));
    await expect(t.schedulers.briefing(new Date('2026-10-30T10:30:00Z'))).rejects.toThrow(
      /Service Bus fora/,
    );
  });

  it('data fora da lista de feriados falha alto em vez de calar o briefing', async () => {
    const t = setup();
    await expect(t.schedulers.briefing(new Date('2028-01-05T10:30:00Z'))).rejects.toThrow(
      /não cobre 2028/,
    );
    expect(t.messaging.publish).not.toHaveBeenCalled();
  });
});
