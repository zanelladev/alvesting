import { Logger } from '@nestjs/common';
import { queueMessageSchema, messageId, type QueueMessage } from '@alvesting/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NEWS_SOURCES } from '../domain/sources.js';
import { NewsSchedulers, halfHourSlot } from './news-schedulers.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

describe('halfHourSlot', () => {
  it('arredonda para baixo, para :00 ou :30 UTC, sem milissegundos', () => {
    expect(halfHourSlot(new Date('2026-11-01T17:00:00Z'))).toBe('2026-11-01T17:00:00Z');
    expect(halfHourSlot(new Date('2026-11-01T17:00:07.123Z'))).toBe('2026-11-01T17:00:00Z');
    expect(halfHourSlot(new Date('2026-11-01T17:29:59.999Z'))).toBe('2026-11-01T17:00:00Z');
    expect(halfHourSlot(new Date('2026-11-01T17:30:00Z'))).toBe('2026-11-01T17:30:00Z');
    expect(halfHourSlot(new Date('2026-11-01T23:59:59Z'))).toBe('2026-11-01T23:30:00Z');
    expect(halfHourSlot(new Date('2026-12-31T00:00:01Z'))).toBe('2026-12-31T00:00:00Z');
  });
});

describe('NewsSchedulers.news (sched-news, cron */30 * * * * em UTC)', () => {
  const setup = () => {
    const messaging = { publish: vi.fn((_message: QueueMessage) => Promise.resolve()) };
    return { schedulers: new NewsSchedulers(messaging), messaging };
  };

  it('publica uma fetch por fonte, todas com o mesmo slot', async () => {
    const t = setup();
    await expect(t.schedulers.news(new Date('2026-11-01T17:30:06Z'))).resolves.toBe(
      NEWS_SOURCES.length,
    );
    const published = t.messaging.publish.mock.calls.map(([m]) => m);
    expect(published).toEqual(
      NEWS_SOURCES.map((source) => ({
        type: 'fetch',
        source: source.id,
        slot: '2026-11-01T17:30:00Z',
      })),
    );
    for (const message of published)
      expect(queueMessageSchema.safeParse(message).success).toBe(true);
  });

  it('o MessageId é o mesmo nas duas execuções do mesmo slot (o retry do job não duplica)', async () => {
    const t = setup();
    await t.schedulers.news(new Date('2026-11-01T17:30:06Z'));
    await t.schedulers.news(new Date('2026-11-01T17:31:40Z'));
    const ids = t.messaging.publish.mock.calls.map(([m]) => messageId(m));
    expect(ids.slice(0, NEWS_SOURCES.length)).toEqual(ids.slice(NEWS_SOURCES.length));
    expect(ids[0]).toBe('fetch:infomoney:2026-11-01T17:30:00Z');
  });

  it('uma publicação que falha não impede as outras; o job falha no fim e o retry republica tudo', async () => {
    const t = setup();
    t.messaging.publish.mockRejectedValueOnce(new Error('Service Bus fora'));
    await expect(t.schedulers.news(new Date('2026-11-01T17:30:06Z'))).rejects.toThrow(
      /infomoney.*Service Bus fora/,
    );
    expect(t.messaging.publish).toHaveBeenCalledTimes(NEWS_SOURCES.length);
  });
});
