// A agenda do operador local (ADR 0038): os mesmos horários dos agendadores de produção, a fonte única deles no código. O Bicep
// (infra/modules/containerapps.bicep, vetor `schedulers`) tem os mesmos crons, e o agenda.spec.ts compara os dois: mudou um, muda o outro. Cron
// em UTC, como no Container Apps; Brasília é UTC-3, sem horário de verão.
//
// O que fica de fora, de propósito: o `backup` (dia 1, 03:00). O backup-verify pede o pg_dump e o pg_restore da versão do servidor e um
// servidor onde restaurar; é da Azure. No Mac a cópia do banco da temporada é o pg_dump do RUNBOOK (a seção do operador).
export const AGENDA = {
  // a cada 30 min: uma `fetch` por fonte (RSS, CVM, BCB)
  news: '*/30 * * * *',
  // 07:30 de seg a sex: o briefing
  briefing: '30 10 * * 1-5',
  // 08:00 de seg a sex: o ciclo (prazo às 09:30)
  cycle: '0 11 * * 1-5',
  // 21:30 de seg a sex (00:30 UTC de ter a sáb): o eod, que se reagenda até 00:30 e pede a liquidação
  eod: '30 0 * * 2-6',
  // domingo 09:00: o universo da semana seguinte, com a atualização semanal da brapi e os logos
  universe: '0 12 * * 0',
  // todo dia 10:00: a limpeza dos dados pessoais vencidos
  retention: '0 13 * * *',
} as const;
export type AgendaJob = keyof typeof AGENDA;

// Um campo do cron: `*`, `*/n`, `a`, `a-b` e listas com vírgula. É tudo o que os crons da agenda usam.
function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((part) => {
    const step = /^\*\/(\d+)$/.exec(part);
    if (part === '*') return true;
    if (step) return value % Number(step[1]) === 0;
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    if (/^\d+$/.test(part)) return value === Number(part);
    throw new RangeError(`Campo de cron que a agenda não usa: ${part}`);
  });
}

// O cron casa com o minuto do instante (UTC): minuto, hora, dia do mês, mês e dia da semana (0 = domingo).
export function cronMatches(expression: string, at: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new RangeError(`Cron com ${fields.length} campos: ${expression}`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  // os cinco campos são lidos sempre (sem parar no primeiro que não casa): o campo que a agenda não sabe ler é erro em qualquer minuto
  return [
    fieldMatches(minute, at.getUTCMinutes()),
    fieldMatches(hour, at.getUTCHours()),
    fieldMatches(dayOfMonth, at.getUTCDate()),
    fieldMatches(month, at.getUTCMonth() + 1),
    fieldMatches(dayOfWeek, at.getUTCDay()),
  ].every(Boolean);
}

// Os minutos em que o cron dispara entre `after` (exclusivo) e `until` (inclusivo), em ordem.
// ponytail: anda minuto a minuto; uma semana de atraso são 10 mil passos, coisa de milissegundos. Se a janela crescer, pular para a próxima hora.
export function occurrences(expression: string, after: Date, until: Date): Date[] {
  const found: Date[] = [];
  const first = Math.floor(after.getTime() / 60_000) + 1;
  for (let minute = first; minute * 60_000 <= until.getTime(); minute += 1) {
    const at = new Date(minute * 60_000);
    if (cronMatches(expression, at)) found.push(at);
  }
  return found;
}
