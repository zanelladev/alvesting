import { addDays, brasiliaInstant, type IsoDate } from './dates.js';

// A brapi ainda não tem a barra de todo papel do conjunto obrigatório (plano, 5.5 e 7): o eod publica a mesma mensagem agendada para daqui a
// 60 minutos, até 00:30 de Brasília do dia seguinte, e pede de novo só o que falta. Na tentativa que cai nesse prazo ou depois dele o pregão
// conclui com o que tem.
export const RETRY_MINUTES = 60;
const DEADLINE_TIME = '00:30';

export type MissingFilePlan = { action: 'retry'; at: Date } | { action: 'deadline' };

export function planMissingFile(date: IsoDate, now: Date): MissingFilePlan {
  const deadline = brasiliaInstant(addDays(date, 1), DEADLINE_TIME);
  if (now.getTime() >= deadline.getTime()) return { action: 'deadline' };
  const next = new Date(now.getTime() + RETRY_MINUTES * 60_000);
  // atraso na fila empurraria a tentativa final para depois do prazo: encaixa no prazo
  return { action: 'retry', at: next.getTime() <= deadline.getTime() ? next : deadline };
}
