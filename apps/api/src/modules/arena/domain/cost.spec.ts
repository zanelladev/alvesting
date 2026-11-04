import { describe, expect, it } from 'vitest';
import { formatUsd, parseUsdToMicro, pricedCostMicro, reportedCostMicro } from './cost.js';

describe('parseUsdToMicro: dólares em texto viram micro-dólares inteiros', () => {
  it.each([
    ['5', 5_000_000n],
    ['0', 0n],
    ['0.115', 115_000n],
    ['12.345678', 12_345_678n],
    ['4.0', 4_000_000n],
    ['100', 100_000_000n],
  ])('%s -> %s', (text, micro) => {
    expect(parseUsdToMicro(text)).toBe(micro);
  });

  it.each(['', ' 5', '5 ', '-1', '1e3', '0.0000001', '1,5', '$5', 'cinco', '1.', '.5'])(
    'recusa %j (sem float, sem notação científica, até 6 casas)',
    (text) => {
      expect(() => parseUsdToMicro(text)).toThrow(/dólares/);
    },
  );
});

describe('reportedCostMicro: o custo que o provedor informou (usage.cost do OpenRouter)', () => {
  it.each([
    [0, 0n],
    [0.0123, 12_300n],
    [1.5, 1_500_000n],
    [12, 12_000_000n],
    [1e-7, 0n],
  ])('%s -> %s', (cost, micro) => {
    expect(reportedCostMicro(cost)).toBe(micro);
  });

  it.each([null, undefined, '0.01', -0.5, Number.NaN, Number.POSITIVE_INFINITY, 1e9, {}])(
    'valor que não é um custo plausível (%j) vira null: quem chama usa a tabela de preços',
    (cost) => {
      expect(reportedCostMicro(cost)).toBeNull();
    },
  );
});

describe('pricedCostMicro: tokens x preço por milhão, em inteiros', () => {
  it('18 mil tokens de entrada a US$ 4 e 8 mil de saída a US$ 20 custam US$ 0,232', () => {
    expect(
      pricedCostMicro(
        { promptTokens: 18_000, completionTokens: 8_000 },
        { input: '4', output: '20' },
      ),
    ).toBe(232_000n);
  });

  it('arredonda para cima: nunca subestima o gasto do teto', () => {
    expect(
      pricedCostMicro({ promptTokens: 1, completionTokens: 0 }, { input: '0.115', output: '0' }),
    ).toBe(1n);
  });

  it('zero token custa zero', () => {
    expect(
      pricedCostMicro({ promptTokens: 0, completionTokens: 0 }, { input: '4', output: '20' }),
    ).toBe(0n);
  });

  it('um milhão de tokens custa o preço da tabela', () => {
    expect(
      pricedCostMicro(
        { promptTokens: 1_000_000, completionTokens: 1_000_000 },
        { input: '2', output: '10' },
      ),
    ).toBe(12_000_000n);
  });
});

describe('formatUsd', () => {
  it.each([
    [0n, '0.000000'],
    [232_000n, '0.232000'],
    [5_000_000n, '5.000000'],
    [12_345_678n, '12.345678'],
  ])('%s -> %s', (micro, text) => {
    expect(formatUsd(micro)).toBe(text);
  });
});
