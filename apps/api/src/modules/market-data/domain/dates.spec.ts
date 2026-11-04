import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  brasiliaDate,
  brasiliaInstant,
  dayOfWeek,
  isIsoDate,
  isoWeek,
  isoWeekMonday,
  isWeekday,
  monthBounds,
} from './dates.js';

describe('isIsoDate', () => {
  it.each(['2026-10-30', '2028-02-29', '2026-01-01'])('aceita %s', (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each([
    '2026-02-29', // 2026 não é bissexto
    '2026-13-01',
    '2026-00-10',
    '2026-10-32',
    '2026-1-5',
    '20261030',
    '2026-10-30T00:00:00Z',
    '',
    ' 2026-10-30',
  ])('recusa %j', (value) => {
    expect(isIsoDate(value)).toBe(false);
  });
});

describe('addDays e dayOfWeek', () => {
  it('atravessa mês, ano e dia bissexto', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-30', 0)).toBe('2026-10-30');
  });

  it('dia da semana: domingo = 0', () => {
    expect(dayOfWeek('2026-11-01')).toBe(0); // domingo
    expect(dayOfWeek('2026-11-02')).toBe(1); // segunda
    expect(dayOfWeek('2026-10-30')).toBe(5); // sexta
    expect(dayOfWeek('2026-10-31')).toBe(6); // sábado
  });

  it('isWeekday: segunda a sexta', () => {
    expect(isWeekday('2026-10-30')).toBe(true);
    expect(isWeekday('2026-10-31')).toBe(false);
    expect(isWeekday('2026-11-01')).toBe(false);
  });

  it('recusa data inválida em vez de devolver NaN', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => dayOfWeek('amanhã')).toThrow(RangeError);
  });
});

describe('brasiliaDate e brasiliaInstant (UTC-3, sem horário de verão)', () => {
  it('o eod roda às 00:30 UTC e o pregão é a data de Brasília do dia anterior', () => {
    expect(brasiliaDate(new Date('2026-11-03T00:30:05Z'))).toBe('2026-11-02');
  });

  it('vira o dia em 03:00 UTC, não em 00:00 UTC', () => {
    expect(brasiliaDate(new Date('2026-11-02T02:59:59.999Z'))).toBe('2026-11-01');
    expect(brasiliaDate(new Date('2026-11-02T03:00:00.000Z'))).toBe('2026-11-02');
  });

  it('as 07:30 de Brasília (10:30 UTC) ainda é o mesmo dia', () => {
    expect(brasiliaDate(new Date('2026-11-03T10:30:00Z'))).toBe('2026-11-03');
  });

  it('monta o instante a partir de data e hora de Brasília', () => {
    expect(brasiliaInstant('2026-10-31', '00:30').toISOString()).toBe('2026-10-31T03:30:00.000Z');
    expect(brasiliaInstant('2026-10-30').toISOString()).toBe('2026-10-30T03:00:00.000Z');
  });

  it('ida e volta: o instante de uma data de Brasília cai na mesma data', () => {
    for (const date of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      expect(brasiliaDate(brasiliaInstant(date, '00:00'))).toBe(date);
      expect(brasiliaDate(brasiliaInstant(date, '23:59'))).toBe(date);
    }
  });
});

describe('semana ISO', () => {
  it('2 de novembro de 2026 (segunda-feira) abre a semana 45', () => {
    expect(isoWeek('2026-11-02')).toBe('2026-W45');
    expect(isoWeek('2026-11-01')).toBe('2026-W44'); // domingo ainda é da semana anterior
    expect(isoWeekMonday('2026-W45')).toBe('2026-11-02');
  });

  it('o ano ISO pode diferir do ano civil', () => {
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2025-12-29')).toBe('2026-W01');
    expect(isoWeekMonday('2026-W01')).toBe('2025-12-29');
    // 2026 começa numa quinta-feira e tem 53 semanas
    expect(isoWeek('2027-01-03')).toBe('2026-W53');
    expect(isoWeek('2027-01-04')).toBe('2027-W01');
    expect(isoWeekMonday('2026-W53')).toBe('2026-12-28');
  });

  it('isoWeekMonday e isoWeek são inversas para toda segunda de 2026 e 2027', () => {
    for (let date = '2026-01-05'; date < '2028-01-01'; date = addDays(date, 7)) {
      expect(isoWeekMonday(isoWeek(date))).toBe(date);
    }
  });

  it('recusa semana que não existe', () => {
    expect(() => isoWeekMonday('2026-W00')).toThrow(RangeError);
    expect(() => isoWeekMonday('2026-W54')).toThrow(RangeError);
    expect(() => isoWeekMonday('2027-W53')).toThrow(RangeError); // 2027 só tem 52
    expect(() => isoWeekMonday('2026-45')).toThrow(RangeError);
  });
});

// O mês do teto de custo (sched-cycle) e do painel de custos (GET /admin/costs): do primeiro ao último dia do mês da data, sem fuso.
describe('monthBounds', () => {
  it.each([
    ['2026-11-02', '2026-11-01', '2026-11-30'],
    ['2026-11-01', '2026-11-01', '2026-11-30'],
    ['2026-11-30', '2026-11-01', '2026-11-30'],
    ['2026-12-15', '2026-12-01', '2026-12-31'],
    ['2026-01-31', '2026-01-01', '2026-01-31'],
    ['2028-02-10', '2028-02-01', '2028-02-29'],
    ['2026-02-28', '2026-02-01', '2026-02-28'],
  ])('%s fica entre %s e %s', (date, first, last) => {
    expect(monthBounds(date)).toEqual({ first, last });
  });

  it('recusa data que não existe', () => {
    expect(() => monthBounds('2026-02-30')).toThrow(RangeError);
  });
});

describe('addMonths: o histórico de 3 meses da brapi', () => {
  it('soma e subtrai meses de calendário', () => {
    expect(addMonths('2026-11-03', -3)).toBe('2026-08-03');
    expect(addMonths('2026-01-15', -3)).toBe('2025-10-15');
    expect(addMonths('2026-11-03', 3)).toBe('2027-02-03');
    expect(addMonths('2026-11-03', 0)).toBe('2026-11-03');
  });

  it('o dia que não existe no mês de destino cai no último dia dele, bissexto inclusive', () => {
    expect(addMonths('2026-05-31', -3)).toBe('2026-02-28');
    expect(addMonths('2028-05-31', -3)).toBe('2028-02-29');
    expect(addMonths('2026-12-31', -1)).toBe('2026-11-30');
  });

  it('recusa data inválida', () => {
    expect(() => addMonths('2026-02-30', -3)).toThrow(RangeError);
  });
});
