import { QUEUES, type QueueMessage } from '@alvesting/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Delivery, QueueHandler } from '../modules/messaging/application/handle-delivery.js';
import { InProcessBus, createSimClock } from './bus.js';

const T0 = new Date('2026-11-03T11:00:30Z'); // 08:00:30 em Brasília
const minutes = (n: number) => n * 60_000;
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

const decide: QueueMessage = {
  type: 'decide',
  cycleId: '01J0000000000000000000000A',
  competitorId: '01J0000000000000000000000B',
};
const eod: QueueMessage = { type: 'eod', date: '2026-11-03' };
const settle: QueueMessage = {
  type: 'settle',
  seasonId: '01J0000000000000000000000C',
  date: '2026-11-03',
};

// um handler que anota quando e com que entrega foi chamado
function recorder(clock: ReturnType<typeof createSimClock>, fail: (call: number) => boolean) {
  const calls: Array<{ at: Date; delivery: Delivery | undefined }> = [];
  const handler: QueueHandler = (_message, delivery) => {
    calls.push({ at: clock.now(), delivery });
    return fail(calls.length) ? Promise.reject(new Error('provedor fora')) : Promise.resolve();
  };
  return { handler, calls };
}

describe('createSimClock', () => {
  it('só anda para a frente: marcar um instante anterior não volta o relógio', () => {
    const clock = createSimClock(T0);
    clock.set(at(minutes(5)));
    clock.set(at(minutes(1)));
    expect(clock.now()).toEqual(at(minutes(5)));
    expect(clock.now()).not.toBe(clock.now()); // uma cópia: quem mexe nela não mexe no relógio
  });
});

describe('InProcessBus: o barramento do ensaio (a mesma semântica do MessagingService e do handleDelivery)', () => {
  it('entrega cada mensagem publicada ao handler da fila dela, na ordem em que foram publicadas', async () => {
    const clock = createSimClock(T0);
    const seen: string[] = [];
    const bus = new InProcessBus(
      {
        market: (message) => (seen.push(`market:${message.type}`), Promise.resolve()),
        settlement: (message) => (seen.push(`settlement:${message.type}`), Promise.resolve()),
      },
      clock,
    );
    await bus.publish(eod);
    await bus.publish(settle);
    await bus.publish({ type: 'eod', date: '2026-11-04' });
    await bus.runUntil(at(minutes(1)));

    expect(seen).toEqual(['market:eod', 'settlement:settle', 'market:eod']);
    expect(bus.deliveries.map((d) => [d.queue, d.action])).toEqual([
      ['market', 'complete'],
      ['settlement', 'complete'],
      ['market', 'complete'],
    ]);
    expect(bus.deadLetters).toEqual([]);
    expect(bus.pending()).toBe(0);
  });

  it('respeita o horário da mensagem agendada: só sai quando o relógio chega nela, e o handler vê esse instante', async () => {
    const clock = createSimClock(T0);
    const { handler, calls } = recorder(clock, () => false);
    const bus = new InProcessBus({ market: handler }, clock);
    await bus.publishScheduled(eod, at(minutes(60)));

    await bus.runUntil(at(minutes(59)));
    expect(calls).toEqual([]);
    expect(bus.pending()).toBe(1);

    await bus.runUntil(at(minutes(61)));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.at).toEqual(at(minutes(60)));
    expect(clock.now()).toEqual(at(minutes(60)));
  });

  it('entrega por horário, não por ordem de publicação, e entre filas diferentes', async () => {
    const clock = createSimClock(T0);
    const seen: string[] = [];
    const bus = new InProcessBus(
      {
        market: () => (seen.push('market'), Promise.resolve()),
        settlement: () => (seen.push('settlement'), Promise.resolve()),
      },
      clock,
    );
    await bus.publishScheduled(eod, at(minutes(30)));
    await bus.publishScheduled(settle, at(minutes(10)));
    await bus.runUntil(at(minutes(40)));
    expect(seen).toEqual(['settlement', 'market']);
  });

  it('o que um handler publica durante a entrega (o eod pede o settle) sai na mesma passada, se já venceu', async () => {
    const clock = createSimClock(T0);
    const seen: string[] = [];
    // os handlers entram depois do barramento: o do eod publica nele
    const handlers: ConstructorParameters<typeof InProcessBus>[0] = {};
    const bus = new InProcessBus(handlers, clock);
    handlers.market = async () => {
      seen.push('eod');
      await bus.publish(settle);
    };
    handlers.settlement = () => (seen.push('settle'), Promise.resolve());
    await bus.publish(eod);
    await bus.runUntil(at(minutes(1)));
    expect(seen).toEqual(['eod', 'settle']);
  });

  describe('handler que falha: nova tentativa agendada e, na última, DLQ (ADR 0015)', () => {
    it('decisions: a 2ª entrega vem 10 minutos depois e a 3ª, 20 minutos depois da 2ª; a 3ª é a última e falhando vai para a DLQ', async () => {
      const clock = createSimClock(T0);
      const { handler, calls } = recorder(clock, () => true);
      const bus = new InProcessBus({ decisions: handler }, clock);
      await bus.publish(decide);
      await bus.runUntil(at(minutes(24 * 60)));

      expect(calls.map((c) => c.at)).toEqual([at(0), at(minutes(10)), at(minutes(30))]);
      expect(calls.map((c) => c.delivery)).toEqual([
        { attempt: 1, lastAttempt: false },
        { attempt: 2, lastAttempt: false },
        { attempt: 3, lastAttempt: true },
      ]);
      expect(QUEUES.decisions.maxDeliveryCount).toBe(3);
      expect(bus.deliveries.map((d) => d.action)).toEqual(['retry', 'retry', 'deadletter']);
      expect(bus.deadLetters).toEqual([
        expect.objectContaining({
          queue: 'decisions',
          reason: 'max_attempts_exceeded',
          description: 'O handler falhou em 3 tentativas',
        }),
      ]);
      expect(bus.pending()).toBe(0);
    });

    it('falhou uma vez e acertou na seguinte: duas entregas, nenhuma DLQ', async () => {
      const clock = createSimClock(T0);
      const { handler, calls } = recorder(clock, (call) => call === 1);
      const bus = new InProcessBus({ decisions: handler }, clock);
      await bus.publish(decide);

      // antes dos 10 minutos só a 1ª entrega aconteceu
      await bus.runUntil(at(minutes(9)));
      expect(calls).toHaveLength(1);
      expect(bus.pending()).toBe(1);

      await bus.runUntil(at(minutes(11)));
      expect(calls).toHaveLength(2);
      expect(bus.deliveries.map((d) => d.action)).toEqual(['retry', 'complete']);
      expect(bus.deadLetters).toEqual([]);
    });

    it('market tem 10 entregas, 1 minuto de espera por tentativa: a DLQ só na 10ª', async () => {
      const clock = createSimClock(T0);
      const { handler, calls } = recorder(clock, () => true);
      const bus = new InProcessBus({ market: handler }, clock);
      await bus.publish(eod);
      await bus.runUntil(at(minutes(24 * 60)));

      expect(QUEUES.market.maxDeliveryCount).toBe(10);
      expect(calls).toHaveLength(10);
      // a espera antes da tentativa n+1 é 1 min x n: 1, 2, 3... minutos
      const gaps = calls
        .slice(1)
        .map((call, i) => (call.at.getTime() - calls[i]!.at.getTime()) / 60_000);
      expect(gaps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(bus.deadLetters).toHaveLength(1);
    });
  });

  it('mensagem inválida vai para a DLQ na hora, sem chamar o handler nem gastar tentativa', async () => {
    const clock = createSimClock(T0);
    const handler = vi.fn(() => Promise.resolve());
    const bus = new InProcessBus({ market: handler }, clock);
    await bus.publish({ type: 'eod', date: 'ontem' } as unknown as QueueMessage);
    await bus.runUntil(at(minutes(1)));

    expect(handler).not.toHaveBeenCalled();
    expect(bus.deadLetters).toEqual([
      expect.objectContaining({ queue: 'market', reason: 'invalid_schema' }),
    ]);
    expect(bus.deliveries.map((d) => d.action)).toEqual(['deadletter']);
  });

  it('fila sem handler é erro de montagem, não mensagem perdida: falha alto', async () => {
    const clock = createSimClock(T0);
    const bus = new InProcessBus({}, clock);
    await bus.publish(eod);
    await expect(bus.runUntil(at(minutes(1)))).rejects.toThrow(/market/);
  });
});
