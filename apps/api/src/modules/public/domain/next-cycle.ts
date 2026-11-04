import type { NextCycle } from '@alvesting/contracts';
import { brasiliaInstant, type IsoDate } from '../../market-data/domain/dates.js';
import {
  CalendarCoverageError,
  type TradingCalendar,
} from '../../market-data/domain/trading-calendar.js';

// O próximo ciclo de uma temporada, para a contagem da home (docs/API.md). Segue o agendador (sched-cycle): o ciclo abre nos
// pregões do calendário da B3, a partir da data de início, e a temporada para na sessão `sessions`. Por isso a conta é da API:
// o site não tem o calendário de feriados.
//
// Não depende do relógio, de propósito: a resposta é cacheada por até 300 s. O próximo é o pregão seguinte ao último ciclo que
// existe (ou, sem ciclo, o primeiro da temporada). Se o horário dele já passou, o ciclo está abrindo, e quem desenha a contagem decide.
export function nextCycle(args: {
  status: 'RUNNING' | 'FINISHED';
  startDate: IsoDate | null;
  sessions: number;
  decisionTimeBrt: string;
  lastCycleDate: IsoDate | null;
  calendar: Pick<TradingCalendar, 'isTradingDay' | 'nextTradingDay' | 'tradingDaysBetween'>;
}): NextCycle | null {
  const { status, startDate, sessions, decisionTimeBrt, lastCycleDate, calendar } = args;
  if (status !== 'RUNNING' || startDate === null) return null;
  try {
    const date =
      lastCycleDate !== null
        ? calendar.nextTradingDay(lastCycleDate)
        : calendar.isTradingDay(startDate)
          ? startDate
          : calendar.nextTradingDay(startDate);
    // a mesma conta do agendador: depois da última sessão o ciclo não abre
    if (calendar.tradingDaysBetween(startDate, date).length > sessions) return null;
    return { date, decisionAt: brasiliaInstant(date, decisionTimeBrt).toISOString() };
  } catch (error) {
    // ponytail: o arquivo de feriados cobre 2026 e 2027. Além dele a conta é desconhecida, e a home mostra "sem próximo ciclo" em
    // vez de cair; o agendador, que precisa do calendário, falha e chama a atenção (CalendarCoverageError). Evolução: ampliar o arquivo.
    if (error instanceof CalendarCoverageError) return null;
    throw error;
  }
}
