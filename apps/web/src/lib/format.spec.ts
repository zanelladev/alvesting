import { describe, expect, it } from 'vitest';
import {
  countdownText,
  formatBRL,
  formatBRLSigned,
  formatBps,
  formatConfidence,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatDay,
  formatDecimalString,
  formatPercentValue,
  formatPercentile,
  formatPrice,
  formatQuantity,
  formatReais,
  formatShortDate,
  formatTime,
  formatUsdMicro,
  formatWeekdayDate,
  variationBps,
} from './format';

// Formatação das telas: R$ e % em pt-BR, horários de Brasília. Dinheiro chega em centavo inteiro e taxa em ponto-base inteiro (os
// contratos recusam o que perderia precisão), e a conta nunca passa por float: o centavo de um valor grande não pode mudar.
const NB = ' ';

describe('formatBRL', () => {
  it.each([
    [0, `R$${NB}0,00`],
    [5, `R$${NB}0,05`],
    [100, `R$${NB}1,00`],
    [99, `R$${NB}0,99`],
    [10_000_000, `R$${NB}100.000,00`],
    [123_456_789, `R$${NB}1.234.567,89`],
    [-5, `-R$${NB}0,05`],
    [-123_456, `-R$${NB}1.234,56`],
    // o maior inteiro seguro: a divisão por 100 em float arredondaria para cima (90.071.992.547.410,00)
    [Number.MAX_SAFE_INTEGER, `R$${NB}90.071.992.547.409,91`],
  ])('formata %d centavos', (cents, expected) => {
    expect(formatBRL(cents)).toBe(expected);
  });

  it('recusa o que não é inteiro seguro: quem chama já validou pelo contrato', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => formatBRL(bad)).toThrow(RangeError);
    }
  });
});

describe('formatPrice', () => {
  it('o preço sem o símbolo, para o rótulo do eixo (a moeda está no título do gráfico)', () => {
    expect(formatPrice(6_690)).toBe('66,90');
    expect(formatPrice(5)).toBe('0,05');
    expect(formatPrice(123_456_789)).toBe('1.234.567,89');
    expect(formatPrice(-150)).toBe('-1,50');
  });
});

describe('formatBRLSigned', () => {
  it('põe + no ganho e - na perda (resultado da posição); o zero fica sem sinal', () => {
    expect(formatBRLSigned(44_712)).toBe(`+R$${NB}447,12`);
    expect(formatBRLSigned(-10_000)).toBe(`-R$${NB}100,00`);
    expect(formatBRLSigned(0)).toBe(`R$${NB}0,00`);
  });
});

describe('variationBps', () => {
  it('a variação entre dois fechamentos em pontos-base inteiros, o meio para longe do zero', () => {
    expect(variationBps(6_962, 7_010)).toBe(-68); // -0,6847%
    expect(variationBps(101, 100)).toBe(100);
    expect(variationBps(100, 100)).toBe(0);
    // 4999,5 e 5000,5 pontos-base: o meio sobe em valor absoluto, nos dois sentidos
    expect(variationBps(10_001, 20_000)).toBe(-5_000);
    expect(variationBps(30_001, 20_000)).toBe(5_001);
  });

  it('sem fechamento anterior não há variação', () => {
    expect(() => variationBps(100, 0)).toThrow(RangeError);
  });
});

describe('formatReais', () => {
  it('arredonda para o real, sem símbolo, com ponto de milhar (rótulo de eixo)', () => {
    expect(formatReais(10_000_000)).toBe('100.000');
    expect(formatReais(9_950_049)).toBe('99.500');
    expect(formatReais(9_950_050)).toBe('99.501');
    expect(formatReais(-150)).toBe('-2');
    expect(formatReais(0)).toBe('0');
  });
});

describe('formatBps', () => {
  it('põe sinal no que sobe ou desce e nenhum no zero', () => {
    expect(formatBps(20)).toBe('+0,20%');
    expect(formatBps(-26)).toBe('-0,26%');
    expect(formatBps(0)).toBe('0,00%');
    expect(formatBps(12_345)).toBe('+123,45%');
    expect(formatBps(-1)).toBe('-0,01%');
  });

  it('sem sinal, para o que não é variação (drawdown, acerto)', () => {
    expect(formatBps(3_333, { signed: false })).toBe('33,33%');
    expect(formatBps(70, { signed: false })).toBe('0,70%');
  });
});

describe('formatPercentile', () => {
  it('mostra o percentil de 0 a 100 com uma casa, meio para cima', () => {
    expect(formatPercentile(7_200)).toBe('72,0');
    expect(formatPercentile(9_650)).toBe('96,5');
    expect(formatPercentile(5_745)).toBe('57,5');
    expect(formatPercentile(0)).toBe('0,0');
    expect(formatPercentile(10_000)).toBe('100,0');
  });
});

describe('datas', () => {
  it('formatDate vira dd/mm/aaaa sem passar por Date (nenhum fuso mexe no dia)', () => {
    expect(formatDate('2026-11-09')).toBe('09/11/2026');
    expect(formatShortDate('2026-11-09')).toBe('09/11');
  });

  it('recusa o que não é AAAA-MM-DD', () => {
    for (const bad of ['', '2026-11-9', '09/11/2026', '2026-11-09T00:00:00Z', '<script>']) {
      expect(() => formatDate(bad)).toThrow(RangeError);
    }
  });

  it('formatWeekdayDate dá o dia da semana (Finados, 02/11/2026, é segunda; o pregão é terça)', () => {
    expect(formatWeekdayDate('2026-11-02')).toBe('segunda-feira, 02/11/2026');
    expect(formatWeekdayDate('2026-11-03')).toBe('terça-feira, 03/11/2026');
    expect(formatWeekdayDate('2026-11-08')).toBe('domingo, 08/11/2026');
    expect(formatWeekdayDate('2026-11-07')).toBe('sábado, 07/11/2026');
  });

  it('o horário é o de Brasília (UTC-3), em qualquer fuso do servidor', () => {
    expect(formatTime('2026-11-09T11:00:00.000Z')).toBe('08:00');
    expect(formatTime('2026-11-09T12:30:00.000Z')).toBe('09:30');
    expect(formatTime('2026-11-09T11:10:30.000Z', true)).toBe('08:10:30');
    // 02:30Z ainda é o dia anterior em Brasília
    expect(formatDateTime('2026-11-10T02:30:00.000Z')).toBe('09/11/2026 23:30');
    expect(formatDateTime('2026-11-09T11:00:00.000Z')).toBe('09/11/2026 08:00');
  });

  it('meia-noite sai 00:00, não 24:00', () => {
    expect(formatTime('2026-11-09T03:00:00.000Z')).toBe('00:00');
  });

  it('formatDay é só o dia, em Brasília: o documento sem hora (CVM) fica à meia-noite de Brasília', () => {
    expect(formatDay('2026-11-04T03:00:00.000Z')).toBe('04/11/2026');
    // 02:59Z ainda é o dia anterior em Brasília; 03:00Z, o seguinte
    expect(formatDay('2026-11-04T02:59:00.000Z')).toBe('03/11/2026');
    expect(formatDay('2026-11-10T02:30:00.000Z')).toBe('09/11/2026');
    expect(() => formatDay('amanhã')).toThrow(RangeError);
  });
});

describe('outros números', () => {
  it('quantidade inteira com ponto de milhar', () => {
    expect(formatQuantity(0)).toBe('0');
    expect(formatQuantity(130)).toBe('130');
    expect(formatQuantity(1_234_567)).toBe('1.234.567');
  });

  it('custo de LLM em micro-dólares, com quatro casas', () => {
    expect(formatUsdMicro(0)).toBe(`US$${NB}0,0000`);
    expect(formatUsdMicro(12_345_678)).toBe(`US$${NB}12,3457`);
    expect(formatUsdMicro(49)).toBe(`US$${NB}0,0000`);
    expect(formatUsdMicro(50)).toBe(`US$${NB}0,0001`);
  });

  it('valor do BCB é texto decimal exato: só troca o ponto pela vírgula', () => {
    expect(formatDecimalString('0.050762')).toBe('0,050762');
    expect(formatDecimalString('14.50')).toBe('14,50');
    expect(formatDecimalString('-0.31')).toBe('-0,31');
    expect(formatDecimalString('5')).toBe('5');
    expect(() => formatDecimalString('1e3')).toThrow(RangeError);
  });

  it('percentual e confiança do modelo', () => {
    expect(formatPercentValue(10)).toBe('10%');
    expect(formatPercentValue(12.5)).toBe('12,5%');
    expect(formatPercentValue(100)).toBe('100%');
    expect(formatConfidence(0.6)).toBe('0,60');
    expect(formatConfidence(1)).toBe('1,00');
  });
});

describe('countdownText', () => {
  const now = Date.parse('2026-11-02T20:00:00.000Z');
  it('diz quanto falta, e que o ciclo está abrindo quando a hora já passou', () => {
    expect(countdownText('2026-11-03T11:00:00.000Z', now)).toBe('Faltam 15 horas.');
    expect(countdownText('2026-11-04T14:00:00.000Z', now)).toBe('Faltam 1 dia e 18 horas.');
    expect(countdownText('2026-11-02T20:00:00.000Z', now)).toBe('O ciclo está abrindo agora.');
    expect(countdownText('2026-11-01T11:00:00.000Z', now)).toBe('O ciclo está abrindo agora.');
  });
});

describe('formatCountdown', () => {
  const minute = 60_000;
  const hour = 60 * minute;
  it.each([
    [-5 * minute, 'agora'],
    [0, 'agora'],
    [30_000, 'menos de 1 minuto'],
    [minute, '1 minuto'],
    [12 * minute, '12 minutos'],
    [hour, '1 hora'],
    [3 * hour + 12 * minute, '3 horas e 12 minutos'],
    [24 * hour, '1 dia'],
    [27 * hour + 5 * minute, '1 dia e 3 horas'],
    [50 * hour, '2 dias e 2 horas'],
  ])('%d ms -> %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});
