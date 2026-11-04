// Datas de pregão são texto 'AAAA-MM-DD' no calendário de Brasília. A aritmética roda em UTC puro, sem fuso
// e sem horário de verão, para um dia somar sempre 24 horas.
export type IsoDate = string;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // volta ao texto para pegar 2026-02-30, que alguns motores empurram para março
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toUtcDate(date: IsoDate): Date {
  if (!isIsoDate(date)) throw new RangeError(`Data inválida: ${date}`);
  return new Date(`${date}T00:00:00Z`);
}

const toIso = (date: Date): IsoDate => date.toISOString().slice(0, 10);

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIso(new Date(toUtcDate(date).getTime() + days * DAY_MS));
}

// 0 = domingo ... 6 = sábado
export const dayOfWeek = (date: IsoDate): number => toUtcDate(date).getUTCDay();

// O primeiro e o último dia do mês da data. O teto de custo do mês (sched-cycle) e o painel de custos (GET /admin/costs) somam o
// mesmo intervalo; o dia 0 do mês seguinte é o último deste, sem tabela de dias por mês nem ano bissexto.
export function monthBounds(date: IsoDate): { first: IsoDate; last: IsoDate } {
  const [year, month] = toUtcDate(date).toISOString().slice(0, 7).split('-').map(Number) as [
    number,
    number,
  ];
  return {
    first: toIso(new Date(Date.UTC(year, month - 1, 1))),
    last: toIso(new Date(Date.UTC(year, month, 0))),
  };
}

// Soma meses de calendário. O dia que não existe no mês de destino cai no último dia dele (31/05 menos 3 meses é 28/02 ou 29/02).
export function addMonths(date: IsoDate, months: number): IsoDate {
  const start = toUtcDate(date);
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return toIso(target);
}

export const isWeekday = (date: IsoDate): boolean => {
  const day = dayOfWeek(date);
  return day >= 1 && day <= 5;
};

// Horário sempre em America/Sao_Paulo (UTC-3; o Brasil não tem horário de verão desde 2019).
const BRASILIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function brasiliaDate(instant: Date): IsoDate {
  const part = (type: string) =>
    BRASILIA.formatToParts(instant).find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// O instante de uma data e hora de Brasília ('HH:MM'). Offset fixo: a regra acima.
export function brasiliaInstant(date: IsoDate, time = '00:00'): Date {
  return new Date(`${toIso(toUtcDate(date))}T${time}:00-03:00`);
}

const mondayOf = (date: Date): Date => {
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - sinceMonday * DAY_MS);
};

// Semana ISO 8601 ('2026-W45'): começa na segunda e pertence ao ano da sua quinta-feira.
export function isoWeek(date: IsoDate): string {
  const thursday = new Date(mondayOf(toUtcDate(date)).getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const dayOfYear = (thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1;
  const week = Math.floor((dayOfYear - 1) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// A segunda-feira que abre a semana ISO. Recusa semana que não existe (W00, W54 ou W53 de ano com 52).
export function isoWeekMonday(week: string): IsoDate {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) throw new RangeError(`Semana ISO inválida: ${week}`);
  const [year, number] = [Number(match[1]), Number(match[2])];
  // 4 de janeiro sempre cai na semana 1
  const firstMonday = mondayOf(new Date(Date.UTC(year, 0, 4)));
  const monday = toIso(new Date(firstMonday.getTime() + (number - 1) * 7 * DAY_MS));
  if (number < 1 || isoWeek(monday) !== week) {
    throw new RangeError(`Semana ISO inexistente: ${week}`);
  }
  return monday;
}
