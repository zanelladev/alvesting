import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { addDays, isIsoDate, isWeekday, type IsoDate } from './dates.js';

// Calendário de pregões. Dia de pregão = dia útil que não está na lista de feriados da B3
// (b3-holidays.json, copiada da página oficial; docs/DADOS.md). Os agendadores usam isto às 07:30 e às 21:30,
// antes de as barras do dia existirem. Os dias passados confirmados pelas barras ficam na tabela trading_day.

const holiday = z.strictObject({ data: z.iso.date(), nome: z.string().min(1) });

const yearEntry = z.strictObject({
  situacao: z.enum(['oficial', 'provisório']),
  nota: z.string().optional(),
  feriados: z.array(holiday).min(1),
});

// Um arquivo vindo de fora do código: valida a forma, o ano de cada feriado e as repetições.
export const calendarFileSchema = z
  .strictObject({
    fonte: z.string().min(1),
    url: z.url(),
    conferidoEm: z.iso.date(),
    anos: z.record(z.string().regex(/^\d{4}$/), yearEntry),
  })
  .superRefine((file, ctx) => {
    const years = Object.keys(file.anos);
    if (years.length === 0) ctx.addIssue({ code: 'custom', message: 'nenhum ano no arquivo' });
    for (const [year, entry] of Object.entries(file.anos)) {
      const dates = entry.feriados.map((h) => h.data);
      if (dates.some((date) => !date.startsWith(`${year}-`))) {
        ctx.addIssue({ code: 'custom', message: `feriado fora de ${year}`, path: ['anos', year] });
      }
      if (new Set(dates).size !== dates.length) {
        ctx.addIssue({
          code: 'custom',
          message: `feriado repetido em ${year}`,
          path: ['anos', year],
        });
      }
    }
  });
export type CalendarFile = z.infer<typeof calendarFileSchema>;

// A data está num ano que o arquivo não cobre. Responder "não é pregão" aqui pararia o eod e o briefing
// em silêncio no dia 1º de janeiro do primeiro ano sem lista; melhor falhar e chamar a atenção.
export class CalendarCoverageError extends Error {
  constructor(year: number, covered: number[]) {
    super(
      `O calendário da B3 não cobre ${year} (cobre ${covered.join(', ')}); atualize b3-holidays.json`,
    );
    this.name = 'CalendarCoverageError';
  }
}

export class TradingCalendar {
  private readonly covered = new Set<number>();
  private readonly holidaySet = new Set<string>();

  constructor(file: CalendarFile) {
    for (const [year, entry] of Object.entries(file.anos)) {
      this.covered.add(Number(year));
      for (const holiday of entry.feriados) this.holidaySet.add(holiday.data);
    }
  }

  get years(): number[] {
    return [...this.covered].sort((a, b) => a - b);
  }

  covers(date: IsoDate): boolean {
    return this.covered.has(Number(date.slice(0, 4)));
  }

  isTradingDay(date: IsoDate): boolean {
    if (!isIsoDate(date)) throw new RangeError(`Data inválida: ${date}`);
    const year = Number(date.slice(0, 4));
    if (!this.covered.has(year)) throw new CalendarCoverageError(year, this.years);
    return isWeekday(date) && !this.holidaySet.has(date);
  }

  // Último dia coberto pelo arquivo (31 de dezembro do último ano).
  get lastDay(): IsoDate {
    return `${this.years[this.years.length - 1]}-12-31`;
  }

  // Os pregões de from a to, extremos incluídos.
  tradingDaysBetween(from: IsoDate, to: IsoDate): IsoDate[] {
    const days: IsoDate[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (this.isTradingDay(day)) days.push(day);
    }
    return days;
  }

  // Os `count` pregões anteriores a `date` (ele não entra), do mais antigo ao mais novo.
  tradingDaysBefore(date: IsoDate, count: number): IsoDate[] {
    const days: IsoDate[] = [];
    for (
      let day = this.previousTradingDay(date);
      days.length < count;
      day = this.previousTradingDay(day)
    ) {
      days.unshift(day);
    }
    return days;
  }

  previousTradingDay(date: IsoDate): IsoDate {
    let day = addDays(date, -1);
    while (!this.isTradingDay(day)) day = addDays(day, -1);
    return day;
  }

  // O primeiro pregão depois de `date` (ele não entra). O season:start fixa a data de início da temporada nele.
  nextTradingDay(date: IsoDate): IsoDate {
    let day = addDays(date, 1);
    while (!this.isTradingDay(day)) day = addDays(day, 1);
    return day;
  }
}

// O arquivo fica ao lado do módulo; o nest build o copia para o dist (nest-cli.json, assets).
export function loadTradingCalendar(): TradingCalendar {
  const text = readFileSync(new URL('./b3-holidays.json', import.meta.url), 'utf8');
  const parsed = calendarFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`b3-holidays.json inválido: ${problems}`);
  }
  return new TradingCalendar(parsed.data);
}
