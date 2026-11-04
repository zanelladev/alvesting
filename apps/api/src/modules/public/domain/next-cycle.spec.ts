import { describe, expect, it } from 'vitest';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { nextCycle } from './next-cycle.js';

// O próximo ciclo da home (docs/API.md): o pregão seguinte ao último ciclo da temporada, dentro das sessões dela, às 08:00 de
// Brasília. Sobre o calendário de verdade (b3-holidays.json): em 2026, 02/11 (Finados) e 20/11 (Consciência Negra) são feriados.
const calendar = loadTradingCalendar();

const season = {
  status: 'RUNNING',
  startDate: '2026-11-03',
  sessions: 5,
  decisionTimeBrt: '08:00',
  lastCycleDate: null,
  calendar,
} as const;

describe('nextCycle', () => {
  it('antes de o primeiro ciclo abrir é o primeiro pregão da temporada, às 08:00 de Brasília (11:00 em UTC)', () => {
    expect(nextCycle(season)).toEqual({
      date: '2026-11-03',
      decisionAt: '2026-11-03T11:00:00.000Z',
    });
  });

  it('depois de um ciclo é o pregão seguinte', () => {
    expect(nextCycle({ ...season, lastCycleDate: '2026-11-03' })).toEqual({
      date: '2026-11-04',
      decisionAt: '2026-11-04T11:00:00.000Z',
    });
  });

  it('pula o fim de semana: depois da sexta 06/11, a segunda 09/11', () => {
    expect(nextCycle({ ...season, lastCycleDate: '2026-11-06' })?.date).toBe('2026-11-09');
  });

  it('pula o feriado da B3 no meio: depois da quinta 19/11 (sexta 20/11 é feriado), a segunda 23/11', () => {
    const started = { ...season, startDate: '2026-11-16' };
    expect(nextCycle({ ...started, lastCycleDate: '2026-11-19' })).toEqual({
      date: '2026-11-23',
      decisionAt: '2026-11-23T11:00:00.000Z',
    });
  });

  it('Finados (segunda 02/11/2026): depois da sexta 30/10 o próximo ciclo é a terça 03/11, e uma conta só por dia útil erraria um dia', () => {
    const october = { ...season, startDate: '2026-10-26', sessions: 20 };
    expect(nextCycle({ ...october, lastCycleDate: '2026-10-30' })).toEqual({
      date: '2026-11-03',
      decisionAt: '2026-11-03T11:00:00.000Z',
    });
  });

  it('o feriado conta como dia sem sessão: a quinta sessão da temporada que começa em 16/11 é a segunda 23/11', () => {
    const started = { ...season, startDate: '2026-11-16' };
    // as sessões são 16, 17, 18, 19 e 23: a quinta ainda cabe
    expect(nextCycle({ ...started, lastCycleDate: '2026-11-19' })?.date).toBe('2026-11-23');
    // depois dela (a terça 24/11 seria a sexta) não há próximo
    expect(nextCycle({ ...started, lastCycleDate: '2026-11-23' })).toBeNull();
  });

  it('usa a hora da decisão que a temporada fixou, em Brasília (UTC-3)', () => {
    expect(
      nextCycle({ ...season, decisionTimeBrt: '09:15', lastCycleDate: '2026-11-03' })?.decisionAt,
    ).toBe('2026-11-04T12:15:00.000Z');
  });

  it('a última sessão já abriu: não há próximo ciclo', () => {
    const two = { ...season, sessions: 2 };
    expect(nextCycle({ ...two, lastCycleDate: '2026-11-03' })?.date).toBe('2026-11-04');
    expect(nextCycle({ ...two, lastCycleDate: '2026-11-04' })).toBeNull();
  });

  it('temporada encerrada, ou ainda sem data de início, não tem próximo ciclo', () => {
    expect(nextCycle({ ...season, status: 'FINISHED', lastCycleDate: '2026-11-04' })).toBeNull();
    expect(nextCycle({ ...season, startDate: null })).toBeNull();
  });

  it('data de início que não é pregão vale o primeiro pregão depois dela, como no agendador', () => {
    // sábado 21/11
    expect(nextCycle({ ...season, startDate: '2026-11-21' })?.date).toBe('2026-11-23');
    // o feriado 20/11 e o fim de semana
    expect(nextCycle({ ...season, startDate: '2026-11-20' })?.date).toBe('2026-11-23');
  });

  it('o calendário não cobre o ano do próximo pregão: nulo, e a home não cai por isso', () => {
    // 31/12/2027 é feriado; o próximo pregão é de 2028, que o arquivo não cobre
    expect(
      nextCycle({
        ...season,
        startDate: '2027-12-20',
        sessions: 20,
        lastCycleDate: '2027-12-30',
      }),
    ).toBeNull();
  });

  it('outro erro do calendário não é engolido', () => {
    const broken = {
      isTradingDay: () => {
        throw new Error('arquivo corrompido');
      },
      nextTradingDay: () => '2026-11-04',
      tradingDaysBetween: () => [],
    };
    expect(() => nextCycle({ ...season, calendar: broken })).toThrow('arquivo corrompido');
  });
});
