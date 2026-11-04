import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { QueueMessage } from '@alvesting/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeServiceBus } from './fake-service-bus.js';
import { MessagingService } from './messaging.service.js';
import { createServiceBusClient } from './service-bus-client.js';

// O Service Bus falso do e2e e dos testes das rotas /admin (etapa 10, parte 2): a DLQ e a publicação, numa pasta. O MessagingService de
// verdade roda por cima dele, então o que se prova aqui é o mesmo código que roda na Azure, só com o cliente do SDK trocado. Cada
// mensagem é um arquivo, para o teste (que roda noutro processo) semear a DLQ e conferir o que foi publicado sem disputar um arquivo só.
const eod: QueueMessage = { type: 'eod', date: '2026-11-03' };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'alvesting-bus-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const seedDead = async (queue: string, name: string, record: Record<string, unknown>) => {
  await mkdir(path.join(dir, queue, 'dead'), { recursive: true });
  await writeFile(path.join(dir, queue, 'dead', `${name}.json`), JSON.stringify(record));
};
const files = (queue: string, box: 'dead' | 'active') =>
  readdir(path.join(dir, queue, box)).catch(() => [] as string[]);

describe('FakeServiceBus com o MessagingService de verdade', () => {
  it('lê a DLQ sem consumir: messageId, tentativas, motivo, descrição e hora, na ordem dos arquivos', async () => {
    await seedDead('market', '1', {
      messageId: 'eod:2026-11-03',
      body: eod,
      deliveryCount: 10,
      deadLetterReason: 'max_attempts_exceeded',
      deadLetterErrorDescription: 'O handler falhou em 10 tentativas',
      enqueuedTimeUtc: '2026-11-03T00:30:00.000Z',
    });
    await seedDead('market', '2', {
      messageId: 'universe:2026-W45',
      body: { type: 'universe', week: '2026-W45' },
    });
    const service = new MessagingService(new FakeServiceBus(dir) as never);

    const dead = await service.readDeadLetters('market');
    expect(dead.map((m) => m.messageId)).toEqual(['eod:2026-11-03', 'universe:2026-W45']);
    expect(dead[0]).toMatchObject({
      deliveryCount: 10,
      reason: 'max_attempts_exceeded',
      description: 'O handler falhou em 10 tentativas',
      enqueuedAt: new Date('2026-11-03T00:30:00.000Z'),
    });
    // ler não consome
    expect(await files('market', 'dead')).toHaveLength(2);
    expect(await service.readDeadLetters('news')).toEqual([]);
  });

  it('respeita o máximo pedido na leitura', async () => {
    for (const n of [1, 2, 3])
      await seedDead('news', String(n), { messageId: `eod:2026-11-0${n}`, body: eod });
    const service = new MessagingService(new FakeServiceBus(dir) as never);
    expect(await service.readDeadLetters('news', 2)).toHaveLength(2);
  });

  it('reenvia: a mensagem sai da DLQ e vai para a fila com o mesmo MessageId; repetir não publica de novo', async () => {
    await seedDead('market', '1', { messageId: 'eod:2026-11-03', body: eod });
    const service = new MessagingService(new FakeServiceBus(dir) as never);

    expect(await service.resubmitDeadLetter('market', 'eod:2026-11-03')).toBe('resubmitted');
    expect(await files('market', 'dead')).toEqual([]);
    const active = await files('market', 'active');
    expect(active).toHaveLength(1);
    const published = JSON.parse(
      await readFile(path.join(dir, 'market', 'active', active[0]!), 'utf8'),
    ) as {
      messageId: string;
      body: unknown;
    };
    expect(published).toMatchObject({ messageId: 'eod:2026-11-03', body: eod });

    expect(await service.resubmitDeadLetter('market', 'eod:2026-11-03')).toBe('not_found');
    expect(await files('market', 'active')).toHaveLength(1);
  });

  it('a mensagem que continua inválida, ou é de outra fila, fica na DLQ', async () => {
    await seedDead('market', '1', { messageId: 'lixo:1', body: 'isto nao e json' });
    await seedDead('market', '2', {
      messageId: 'freeze:2026-11-03',
      body: { type: 'freeze', date: '2026-11-03' },
    });
    const service = new MessagingService(new FakeServiceBus(dir) as never);
    expect(await service.resubmitDeadLetter('market', 'lixo:1')).toBe('invalid');
    expect(await service.resubmitDeadLetter('market', 'freeze:2026-11-03')).toBe('invalid');
    expect(await files('market', 'dead')).toHaveLength(2);
    expect(await files('market', 'active')).toEqual([]);
  });

  it('publica e agenda na pasta da fila certa', async () => {
    const service = new MessagingService(new FakeServiceBus(dir) as never);
    await service.publish(eod);
    await service.publishScheduled(
      { type: 'retention', date: '2026-11-08' },
      new Date('2026-11-08T13:00:00Z'),
    );
    expect(await files('market', 'active')).toHaveLength(1);
    expect(await files('maintenance', 'active')).toHaveLength(1);
  });

  it('o que o fake não faz (consumir a fila) falha alto, em vez de fingir', () => {
    const service = new MessagingService(new FakeServiceBus(dir) as never);
    expect(() => service.consume('market', () => Promise.resolve())).toThrow(/falso/);
  });
});

describe('createServiceBusClient escolhe o falso só fora de produção', () => {
  it('com SERVICEBUS_FAKE_DIR e fora de produção devolve o falso', () => {
    expect(createServiceBusClient({ NODE_ENV: 'test', SERVICEBUS_FAKE_DIR: dir })).toBeInstanceOf(
      FakeServiceBus,
    );
    expect(
      createServiceBusClient({ NODE_ENV: 'development', SERVICEBUS_FAKE_DIR: dir }),
    ).toBeInstanceOf(FakeServiceBus);
  });

  it('em produção recusa: o falso nunca fala no lugar do Service Bus de verdade', () => {
    expect(() =>
      createServiceBusClient({ NODE_ENV: 'production', SERVICEBUS_FAKE_DIR: dir }),
    ).toThrow(/produção/);
  });

  it('sem a variável nada muda: sem connection string nem FQDN o cliente fica desligado', () => {
    expect(createServiceBusClient({ NODE_ENV: 'test' })).toBeUndefined();
  });
});
