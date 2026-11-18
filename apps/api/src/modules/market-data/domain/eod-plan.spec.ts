import { describe, expect, it } from 'vitest';
import { MISSING_ALERT_PERCENT, type FailCause } from './bar-plan.js';
import { RETRY_MINUTES, planMissingFile, reasonOf, type MissingReason } from './eod-plan.js';

// O pregão 2026-10-30. O sched-eod roda às 21:30 de Brasília (00:30 UTC do dia seguinte); o prazo é 00:30 de
// Brasília do dia 31 (03:30 UTC).
const DATE = '2026-10-30';
const at = (isoUtc: string) => new Date(isoUtc);
const FIRST = at('2026-10-31T00:30:00Z'); // 21:30
const RETRY = { action: 'retry', at: at('2026-10-31T01:30:00Z') }; // a nova tentativa das 22:30
const DEADLINE = at('2026-10-31T03:30:00Z'); // 00:30
const REQUIRED = 307; // o conjunto obrigatório das noites de 16 e 17/11/2026
const missing = (entries: Record<string, MissingReason>) => new Map(Object.entries(entries));
// uma falta passageira: segura o pregão até o prazo (os testes do horário)
const TRANSIENT = missing({ PETR4: 'transient' });
const plan = (now: Date, absent: ReadonlyMap<string, MissingReason>, required = REQUIRED) =>
  planMissingFile(DATE, now, absent, required);

describe('planMissingFile: a brapi ainda não tem todas as barras do pregão', () => {
  it('a nova tentativa é daqui a 60 minutos', () => {
    expect(RETRY_MINUTES).toBe(60);
    expect(plan(FIRST, TRANSIENT)).toEqual(RETRY); // 22:30 em Brasília
  });

  it('as tentativas de 21:30, 22:30 e 23:30 reagendam; a de 00:30 é a última e conclui com o que tem', () => {
    expect(plan(at('2026-10-31T01:30:00Z'), TRANSIENT)).toEqual({
      action: 'retry',
      at: at('2026-10-31T02:30:00Z'), // 23:30
    });
    expect(plan(at('2026-10-31T02:30:00Z'), TRANSIENT)).toEqual({
      action: 'retry',
      at: at('2026-10-31T03:30:00Z'), // 00:30, o prazo
    });
    expect(plan(DEADLINE, TRANSIENT)).toEqual({ action: 'deadline' });
  });

  it('com atraso na fila, a última tentativa cai no prazo e nunca depois dele', () => {
    // 23:31 + 60 min passaria de 00:30: agenda para 00:30 em ponto
    expect(plan(at('2026-10-31T02:31:20Z'), TRANSIENT)).toEqual({
      action: 'retry',
      at: at('2026-10-31T03:30:00Z'),
    });
  });

  it('depois do prazo conclui na hora', () => {
    expect(plan(at('2026-10-31T03:30:01Z'), TRANSIENT)).toEqual({ action: 'deadline' });
    expect(plan(at('2026-10-31T09:00:00Z'), TRANSIENT)).toEqual({ action: 'deadline' });
  });

  it('o prazo vale para o pregão pedido, não para o dia de hoje', () => {
    // sexta 30/10 reprocessada na segunda 02/11 às 10:00: já passou do prazo daquela noite
    expect(plan(at('2026-11-02T13:00:00Z'), TRANSIENT)).toEqual({ action: 'deadline' });
    // e uma segunda-feira 02/11 (pregão hipotético) ainda tem a noite inteira pela frente
    expect(planMissingFile('2026-11-02', at('2026-11-02T13:00:00Z'), TRANSIENT, REQUIRED)).toEqual({
      action: 'retry',
      at: at('2026-11-02T14:00:00Z'),
    });
  });
});

describe('planMissingFile: a falta definitiva conclui o pregão sem esperar o prazo', () => {
  it('com o BOVA11 gravado, a resposta boa sem a barra (sem negócio), o 404 e o ticker trocado são definitivos: conclui já na primeira tentativa', () => {
    for (const reason of ['no-bar', 'not-found', 'changed'] satisfies MissingReason[]) {
      expect(plan(FIRST, missing({ X: reason }))).toEqual({ action: 'definitive' });
    }
    // 16/11/2026: os quatro que faltavam às 21:35
    expect(
      plan(FIRST, missing({ RAIZ4: 'changed', MTSA4: 'no-bar', OSXB3: 'no-bar', NORD3: 'no-bar' })),
    ).toEqual({ action: 'definitive' });
  });

  it.each<MissingReason>(['refused', 'malformed', 'transient', 'not-asked'])(
    'a falta "%s" não é definitiva: reagenda, mesmo com as outras definitivas',
    (reason) => {
      expect(plan(FIRST, missing({ RAIZ4: 'changed', MTSA4: 'no-bar', X: reason }))).toEqual(RETRY);
    },
  );

  it('sem a barra do BOVA11 o dia pode não ter saído na brapi: reagenda, mesmo que o BOVA11 tenha respondido sem ela', () => {
    // a sonda: o BOVA11 respondeu bem e sem a barra do dia, e a passada parou antes dos outros
    expect(plan(FIRST, missing({ BOVA11: 'no-bar', PETR4: 'not-asked' }))).toEqual(RETRY);
    expect(plan(FIRST, missing({ BOVA11: 'no-bar' }))).toEqual(RETRY);
    expect(plan(FIRST, missing({ BOVA11: 'changed' }))).toEqual(RETRY);
  });

  it('a falta definitiva que passa do limite do alerta (MISSING_ALERT_PERCENT do obrigatório) espera o prazo, como antes', () => {
    const limit = Math.floor((REQUIRED * MISSING_ALERT_PERCENT) / 100); // 30 de 307
    const noBar = (n: number) =>
      missing(Object.fromEntries(Array.from({ length: n }, (_, i) => [`ACAO${i}3`, 'no-bar'])));
    expect(plan(FIRST, noBar(limit))).toEqual({ action: 'definitive' });
    expect(plan(FIRST, noBar(limit + 1))).toEqual(RETRY);
    // e no prazo conclui pelo prazo (onde o eod-barras-ausentes toca)
    expect(plan(DEADLINE, noBar(limit + 1))).toEqual({ action: 'deadline' });
    // o limite é sobre o obrigatório desta noite: 1 de 3 já passa dele
    expect(plan(FIRST, missing({ VALE3: 'no-bar' }), 3)).toEqual(RETRY);
  });

  it('na última tentativa: a falta toda definitiva conclui como definitiva; com uma passageira, pelo prazo; sem o BOVA11, pelo prazo', () => {
    expect(plan(DEADLINE, missing({ MTSA4: 'no-bar' }))).toEqual({ action: 'definitive' });
    expect(plan(DEADLINE, missing({ MTSA4: 'no-bar', VALE3: 'transient' }))).toEqual({
      action: 'deadline',
    });
    expect(plan(DEADLINE, missing({ BOVA11: 'no-bar' }))).toEqual({ action: 'deadline' });
  });
});

describe('reasonOf: o motivo da falta a partir do que a passada deu ao papel', () => {
  it('a resposta boa é "no-bar", o papel não alcançado é "not-asked", e a falha leva a causa', () => {
    expect(reasonOf('ok')).toBe('no-bar');
    expect(reasonOf(undefined)).toBe('not-asked');
    for (const cause of [
      'changed',
      'not-found',
      'refused',
      'malformed',
      'transient',
    ] satisfies FailCause[]) {
      expect(reasonOf(cause)).toBe(cause);
    }
  });
});
