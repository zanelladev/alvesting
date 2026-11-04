import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isWeekday } from './dates.js';
import {
  CalendarCoverageError,
  TradingCalendar,
  calendarFileSchema,
  loadTradingCalendar,
} from './trading-calendar.js';

// Os feriados de 2026 copiados da página da B3 em 01/11/2026 (b3-holidays.json). Escritos de novo aqui, de
// propósito: o teste trava o arquivo contra uma edição por engano.
const B3_2026 = [
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-04-03',
  '2026-04-21',
  '2026-05-01',
  '2026-06-04',
  '2026-09-07',
  '2026-10-12',
  '2026-11-02',
  '2026-11-20',
  '2026-12-24',
  '2026-12-25',
  '2026-12-31',
];

describe('arquivo de feriados da B3', () => {
  const calendar = loadTradingCalendar();
  // o arquivo em si, lido do disco: o calendário em código não expõe a lista nem a situação do ano
  const file = calendarFileSchema.parse(
    JSON.parse(readFileSync(new URL('./b3-holidays.json', import.meta.url), 'utf8')),
  );
  const holidaysOf = (year: number) => file.anos[String(year)]!.feriados.map((h) => h.data);
  const statusOf = (year: number) => file.anos[String(year)]!.situacao;

  it('2026 é igual à lista oficial e está marcado como oficial', () => {
    expect(holidaysOf(2026)).toEqual(B3_2026);
    expect(statusOf(2026)).toBe('oficial');
  });

  it('2027 está marcado como provisório (a B3 ainda não publicou)', () => {
    expect(statusOf(2027)).toBe('provisório');
    expect(holidaysOf(2027)).toHaveLength(12);
  });

  it('só tem feriados em dia útil, em ordem e sem repetição', () => {
    expect(calendar.years).toEqual([2026, 2027]);
    for (const year of calendar.years) {
      const holidays = holidaysOf(year);
      expect(holidays.filter((day) => !isWeekday(day))).toEqual([]);
      expect(holidays).toEqual([...new Set(holidays)].sort());
      expect(holidays.every((day) => day.startsWith(`${year}-`))).toBe(true);
    }
  });

  it('2026 tem 247 pregões e, até 30/10, 208 (os dias úteis fora da lista)', () => {
    expect(calendar.tradingDaysBetween('2026-01-01', '2026-12-31')).toHaveLength(247);
    expect(calendar.tradingDaysBetween('2026-01-01', '2026-10-30')).toHaveLength(208);
  });
});

describe('TradingCalendar', () => {
  const calendar = loadTradingCalendar();

  it.each([
    ['2026-10-30', true], // sexta-feira, último pregão conhecido
    ['2026-11-03', true], // terça-feira depois do feriado
    ['2026-02-18', true], // Quarta-feira de Cinzas: abre às 13h
    ['2026-10-31', false], // sábado
    ['2026-11-01', false], // domingo
    ['2026-11-02', false], // Finados, segunda-feira
    ['2026-12-24', false],
    ['2026-12-31', false],
    ['2027-01-01', false],
    ['2027-01-04', true],
    ['2027-02-08', false],
    ['2027-11-15', false],
  ])('isTradingDay(%s) = %s', (date, expected) => {
    expect(calendar.isTradingDay(date)).toBe(expected);
  });

  it('falha alto fora dos anos do arquivo, em vez de achar que não é pregão', () => {
    expect(() => calendar.isTradingDay('2025-12-30')).toThrow(CalendarCoverageError);
    expect(() => calendar.isTradingDay('2028-01-03')).toThrow(/2028/);
    expect(calendar.covers('2027-12-31')).toBe(true);
    expect(calendar.covers('2028-01-01')).toBe(false);
  });

  it('recusa data inválida', () => {
    expect(() => calendar.isTradingDay('2026-02-30')).toThrow(RangeError);
  });

  it('tradingDaysBetween devolve os pregões, com os extremos incluídos', () => {
    expect(calendar.tradingDaysBetween('2026-10-26', '2026-11-06')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-11-03', // 02/11 é Finados
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(calendar.tradingDaysBetween('2026-11-01', '2026-11-02')).toEqual([]);
    expect(calendar.tradingDaysBetween('2026-11-06', '2026-11-03')).toEqual([]);
  });

  it('lastDay é o último dia do último ano coberto', () => {
    expect(calendar.lastDay).toBe('2027-12-31');
  });

  it('tradingDaysBefore devolve os N pregões anteriores, sem a própria data', () => {
    expect(calendar.tradingDaysBefore('2026-11-03', 3)).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(calendar.tradingDaysBefore('2026-11-02', 2)).toEqual(['2026-10-29', '2026-10-30']);
    expect(calendar.tradingDaysBefore('2026-11-02', 0)).toEqual([]);
    // 60 pregões antes de segunda 02/11/2026: de 06/08 a 30/10 (nenhum feriado no meio, só o 07/09 e o 12/10)
    const window = calendar.tradingDaysBefore('2026-11-02', 60);
    expect(window).toHaveLength(60);
    expect(window[59]).toBe('2026-10-30');
    expect(window.every((day) => calendar.isTradingDay(day))).toBe(true);
  });

  it('tradingDaysBefore falha alto ao sair dos anos cobertos', () => {
    expect(() => calendar.tradingDaysBefore('2026-01-05', 5)).toThrow(CalendarCoverageError);
  });

  it('previousTradingDay pula fim de semana e feriado', () => {
    expect(calendar.previousTradingDay('2026-11-03')).toBe('2026-10-30');
    expect(calendar.previousTradingDay('2026-11-01')).toBe('2026-10-30');
    expect(calendar.previousTradingDay('2027-01-04')).toBe('2026-12-30');
  });

  // season:start fixa a data de início no próximo pregão (docs/ARENA.md)
  it('nextTradingDay é o primeiro pregão depois da data, que não entra (domingo e Finados pulam para a terça)', () => {
    expect(calendar.nextTradingDay('2026-11-01')).toBe('2026-11-03'); // domingo; 02/11 é Finados
    expect(calendar.nextTradingDay('2026-11-02')).toBe('2026-11-03');
    expect(calendar.nextTradingDay('2026-11-03')).toBe('2026-11-04'); // a data de hoje não conta
    expect(calendar.nextTradingDay('2026-10-30')).toBe('2026-11-03'); // sexta: fim de semana e feriado
  });

  it('nextTradingDay falha alto ao sair dos anos cobertos', () => {
    expect(() => calendar.nextTradingDay('2027-12-31')).toThrow(CalendarCoverageError);
  });
});

describe('calendarFileSchema', () => {
  const valid = {
    fonte: 'B3',
    url: 'https://www.b3.com.br/feriados',
    conferidoEm: '2026-11-01',
    anos: {
      '2026': {
        situacao: 'oficial',
        feriados: [{ data: '2026-01-01', nome: 'Confraternização Universal' }],
      },
    },
  };

  it('aceita um arquivo bem formado', () => {
    expect(calendarFileSchema.safeParse(valid).success).toBe(true);
  });

  it('recusa feriado de outro ano, data repetida e situação desconhecida', () => {
    const wrongYear = structuredClone(valid);
    wrongYear.anos['2026'].feriados[0]!.data = '2025-12-25';
    expect(calendarFileSchema.safeParse(wrongYear).success).toBe(false);

    const duplicated = structuredClone(valid);
    duplicated.anos['2026'].feriados.push({ data: '2026-01-01', nome: 'de novo' });
    expect(calendarFileSchema.safeParse(duplicated).success).toBe(false);

    const unknown = structuredClone(valid);
    unknown.anos['2026'].situacao = 'talvez';
    expect(calendarFileSchema.safeParse(unknown).success).toBe(false);

    expect(calendarFileSchema.safeParse({ ...valid, anos: {} }).success).toBe(false);
  });

  it('TradingCalendar monta a partir de dados válidos, sem ler o disco', () => {
    const calendar = new TradingCalendar(calendarFileSchema.parse(valid));
    expect(calendar.isTradingDay('2026-01-02')).toBe(true);
    expect(calendar.isTradingDay('2026-01-01')).toBe(false);
  });
});
