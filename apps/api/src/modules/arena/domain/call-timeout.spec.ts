import { QUEUES } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import {
  JOB_MARGIN_MS,
  MIN_CALL_MS,
  MIN_REPAIR_MS,
  REPLICA_TIMEOUT_MS,
  callBudget,
} from './call-timeout.js';

const at = (iso: string) => new Date(iso);

describe('callBudget: o menor entre o tempo até as 09:30 e o tempo que resta ao job', () => {
  const deadlineAt = at('2026-11-03T12:30:00Z'); // 09:30 em Brasília

  it('o replicaTimeout do job é o da infra: 1500 s', () => {
    expect(REPLICA_TIMEOUT_MS).toBe(1_500_000);
  });

  it('cedo, o limite é o do job: replicaTimeout menos a margem', () => {
    const start = at('2026-11-03T11:00:00Z');
    const budget = callBudget({ now: start, jobStartedAt: start, deadlineAt });
    expect(budget).toEqual({ ms: REPLICA_TIMEOUT_MS - JOB_MARGIN_MS, bound: 'job' });
  });

  it('perto do prazo, o limite é o que falta até as 09:30', () => {
    const now = at('2026-11-03T12:20:00Z');
    expect(callBudget({ now, jobStartedAt: now, deadlineAt })).toEqual({
      ms: 10 * 60_000,
      bound: 'deadline',
    });
  });

  it('o job já gastou tempo: a segunda chamada (o reparo) tem o que sobrou', () => {
    const jobStartedAt = at('2026-11-03T11:00:00Z');
    const now = at('2026-11-03T11:10:00Z'); // 10 min depois
    expect(callBudget({ now, jobStartedAt, deadlineAt })).toEqual({
      ms: REPLICA_TIMEOUT_MS - JOB_MARGIN_MS - 10 * 60_000,
      bound: 'job',
    });
  });

  it('passou do prazo: zero, limitado pelo prazo', () => {
    const now = at('2026-11-03T12:30:01Z');
    expect(callBudget({ now, jobStartedAt: now, deadlineAt })).toEqual({
      ms: 0,
      bound: 'deadline',
    });
  });

  it('o job quase sem tempo: zero, limitado pelo job', () => {
    const jobStartedAt = at('2026-11-03T11:00:00Z');
    const now = new Date(jobStartedAt.getTime() + REPLICA_TIMEOUT_MS);
    expect(callBudget({ now, jobStartedAt, deadlineAt })).toEqual({ ms: 0, bound: 'job' });
  });

  it('empate vai para o prazo (é o motivo que vira HOLD, e não falha)', () => {
    const jobStartedAt = at('2026-11-03T12:00:00Z');
    const edge = new Date(jobStartedAt.getTime() + REPLICA_TIMEOUT_MS - JOB_MARGIN_MS);
    const result = callBudget({ now: jobStartedAt, jobStartedAt, deadlineAt: edge });
    expect(result.bound).toBe('deadline');
  });

  it('abaixo do mínimo útil não vale a chamada', () => {
    expect(MIN_CALL_MS).toBe(10_000);
  });

  it('o reparo exige mais tempo que a primeira chamada: sem ele, a primeira resposta paga vira HOLD em vez de se perder', () => {
    expect(MIN_REPAIR_MS).toBe(180_000);
    expect(MIN_REPAIR_MS).toBeGreaterThan(MIN_CALL_MS);
    // e cabe folgado no orçamento de um job que acabou de começar
    expect(REPLICA_TIMEOUT_MS - JOB_MARGIN_MS).toBeGreaterThan(MIN_REPAIR_MS);
  });
});

// O replicaTimeout do job e a renovação da trava da fila vivem em pacotes diferentes (infra e contracts); a regra que as liga é
// esta, e é estrita: com lockRenewalMs igual ao replicaTimeout, a trava venceria junto com o job e outra réplica reassumiria a
// linha com a dona ainda viva (duas chamadas pagas, uma decisão).
describe('a trava da fila e o replicaTimeout do job de decisões', () => {
  it('a trava é renovada por MAIS tempo que o replicaTimeout', () => {
    expect(QUEUES.decisions.lockRenewalMs).toBeGreaterThan(REPLICA_TIMEOUT_MS);
  });
});
