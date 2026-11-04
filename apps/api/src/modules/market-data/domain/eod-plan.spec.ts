import { describe, expect, it } from 'vitest';
import { RETRY_MINUTES, planMissingFile } from './eod-plan.js';

// O pregão 2026-10-30. O sched-eod roda às 21:30 de Brasília (00:30 UTC do dia seguinte); o prazo é 00:30 de
// Brasília do dia 31 (03:30 UTC).
const DATE = '2026-10-30';
const at = (isoUtc: string) => new Date(isoUtc);

describe('planMissingFile: a brapi ainda não tem todas as barras do pregão', () => {
  it('a nova tentativa é daqui a 60 minutos', () => {
    expect(RETRY_MINUTES).toBe(60);
    expect(planMissingFile(DATE, at('2026-10-31T00:30:00Z'))).toEqual({
      action: 'retry',
      at: at('2026-10-31T01:30:00Z'), // 22:30 em Brasília
    });
  });

  it('as tentativas de 21:30, 22:30 e 23:30 reagendam; a de 00:30 é a última e conclui com o que tem', () => {
    expect(planMissingFile(DATE, at('2026-10-31T01:30:00Z'))).toEqual({
      action: 'retry',
      at: at('2026-10-31T02:30:00Z'), // 23:30
    });
    expect(planMissingFile(DATE, at('2026-10-31T02:30:00Z'))).toEqual({
      action: 'retry',
      at: at('2026-10-31T03:30:00Z'), // 00:30, o prazo
    });
    expect(planMissingFile(DATE, at('2026-10-31T03:30:00Z'))).toEqual({ action: 'deadline' });
  });

  it('com atraso na fila, a última tentativa cai no prazo e nunca depois dele', () => {
    // 23:31 + 60 min passaria de 00:30: agenda para 00:30 em ponto
    expect(planMissingFile(DATE, at('2026-10-31T02:31:20Z'))).toEqual({
      action: 'retry',
      at: at('2026-10-31T03:30:00Z'),
    });
  });

  it('depois do prazo conclui na hora', () => {
    expect(planMissingFile(DATE, at('2026-10-31T03:30:01Z'))).toEqual({ action: 'deadline' });
    expect(planMissingFile(DATE, at('2026-10-31T09:00:00Z'))).toEqual({ action: 'deadline' });
  });

  it('o prazo vale para o pregão pedido, não para o dia de hoje', () => {
    // sexta 30/10 reprocessada na segunda 02/11 às 10:00: já passou do prazo daquela noite
    expect(planMissingFile(DATE, at('2026-11-02T13:00:00Z'))).toEqual({ action: 'deadline' });
    // e uma segunda-feira 02/11 (pregão hipotético) ainda tem a noite inteira pela frente
    expect(planMissingFile('2026-11-02', at('2026-11-02T13:00:00Z'))).toEqual({
      action: 'retry',
      at: at('2026-11-02T14:00:00Z'),
    });
  });
});
