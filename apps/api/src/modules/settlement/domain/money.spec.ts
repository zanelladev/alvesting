import { describe, expect, it } from 'vitest';
import { divRound, maxShares, percentToBps, safeNumber, tradeCost } from './money.js';

// Os números esperados saem das regras (0,03% por operação; o meio do centavo sobe) e foram contados à mão ou numa
// calculadora, nunca com o código do projeto. A taxa é parâmetro da temporada (tradeCostBps, 3 no plano); os testes
// usam 3 e conferem que outras taxas valem.
const BPS_3 = 3n;

describe('divRound', () => {
  it('arredonda para o mais próximo; o meio vai para longe do zero', () => {
    expect(divRound(7n, 2n)).toBe(4n); // 3,5
    expect(divRound(5n, 2n)).toBe(3n); // 2,5
    expect(divRound(4n, 3n)).toBe(1n); // 1,33
    expect(divRound(2n, 3n)).toBe(1n); // 0,67
    expect(divRound(1n, 3n)).toBe(0n); // 0,33
    expect(divRound(0n, 7n)).toBe(0n);
  });

  it('é simétrico nos negativos (mesma regra do changeBps do briefing)', () => {
    expect(divRound(-7n, 2n)).toBe(-4n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(-4n, 3n)).toBe(-1n);
    expect(divRound(-1n, 3n)).toBe(0n);
  });

  it('não perde precisão com valores grandes', () => {
    const big = 10n ** 30n;
    expect(divRound(big * 3n + 1n, 3n)).toBe(big);
    expect(divRound(big * 3n + 2n, 3n)).toBe(big + 1n);
  });

  it('divisor zero ou negativo é erro de programa', () => {
    expect(() => divRound(1n, 0n)).toThrow(RangeError);
    expect(() => divRound(1n, -2n)).toThrow(RangeError);
  });
});

describe('tradeCost (0,03% por operação, o meio do centavo sobe)', () => {
  it.each([
    [0n, 0n], // nada negociado
    [100n, 0n], // R$ 1,00 x 0,0003 = 0,03 centavo
    [3333n, 1n], // 0,9999
    [15_000n, 5n], // 4,5: o meio sobe (arredondar para baixo daria 4)
    [155_000n, 47n], // 46,5
    [197_800n, 59n], // 59,34
    [248_000n, 74n], // 74,4
    [250_000n, 75n], // 75 exato
    [395_520n, 119n], // 118,656
    [10_000_000n, 3_000n], // R$ 100 mil: R$ 30,00
  ])('notional %s centavos custa %s', (notional, cost) => {
    expect(tradeCost(notional, BPS_3)).toBe(cost);
  });

  it('nunca decresce com o valor negociado', () => {
    let last = 0n;
    for (let n = 0n; n <= 40_000n; n += 1n) {
      const cost = tradeCost(n, BPS_3);
      expect(cost >= last).toBe(true);
      last = cost;
    }
  });

  it('a taxa é parâmetro da temporada: 10 pontos-base (0,10%) e zero', () => {
    expect([15_000n, 155_000n, 1_234n, 1_500n, 100_000n].map((n) => tradeCost(n, 10n))).toEqual([
      15n,
      155n,
      1n,
      2n, // 1,5: o meio sobe
      100n,
    ]);
    expect([15_000n, 155_000n].map((n) => tradeCost(n, 0n))).toEqual([0n, 0n]);
  });
});

describe('maxShares (maior quantidade inteira cujo valor mais o custo cabe no limite)', () => {
  it.each([
    [1_000_000n, 2000n, 499n],
    [333_333n, 2300n, 144n],
    [333_333n, 2500n, 133n],
    [333_333n, 1000n, 333n],
    [1_000_000n, 13_000n, 76n],
    [241_162n, 1300n, 185n],
    [590n, 1000n, 0n], // não cabe nem uma ação
  ])('limite %s a %s centavos por ação: %s ações', (limit, price, expected) => {
    expect(maxShares(limit, price, BPS_3)).toBe(expected);
  });

  it('a fronteira é exata: R$ 100,00 por ação custa 3 centavos', () => {
    expect(maxShares(10_003n, 10_000n, BPS_3)).toBe(1n);
    expect(maxShares(10_002n, 10_000n, BPS_3)).toBe(0n);
    expect(maxShares(20_006n, 10_000n, BPS_3)).toBe(2n); // 20.000 + 6
    expect(maxShares(20_005n, 10_000n, BPS_3)).toBe(1n);
  });

  it('limite ou preço sem sentido não compra nada', () => {
    expect(maxShares(0n, 100n, BPS_3)).toBe(0n);
    expect(maxShares(-5n, 100n, BPS_3)).toBe(0n);
    expect(maxShares(100n, 0n, BPS_3)).toBe(0n);
    expect(maxShares(100n, -1n, BPS_3)).toBe(0n);
  });

  it('confere com a conta por força bruta numa grade de limites, preços e taxas', () => {
    for (const bps of [0n, 3n, 10n, 1000n]) {
      const outlay = (quantity: bigint, price: bigint) =>
        quantity * price + tradeCost(quantity * price, bps);
      for (let price = 1n; price <= 130n; price += 3n) {
        for (let limit = 0n; limit <= 4_000n; limit += 37n) {
          let expected = 0n;
          while (outlay(expected + 1n, price) <= limit) expected += 1n;
          expect(maxShares(limit, price, bps)).toBe(expected);
          // a quantidade devolvida cabe, e uma a mais não cabe
          expect(outlay(expected, price) <= limit).toBe(true);
          expect(outlay(expected + 1n, price) > limit).toBe(true);
        }
      }
    }
  });

  it('a taxa da temporada vale: 0,10% e sem custo', () => {
    expect(maxShares(100_100n, 10_000n, 10n)).toBe(10n); // 100.000 + 100
    expect(maxShares(100_099n, 10_000n, 10n)).toBe(9n);
    expect(maxShares(1_000n, 100n, 0n)).toBe(10n);
    expect(maxShares(999n, 100n, 0n)).toBe(9n);
    expect(maxShares(11_000n, 1_000n, 1000n)).toBe(10n); // 10%: 10.000 + 1.000
    expect(maxShares(10_999n, 1_000n, 1000n)).toBe(9n);
  });

  it('serve para quantidades enormes sem laço longo (papel de centavos)', () => {
    // R$ 100 mil em ações de R$ 0,01: 9.997.001 ações custam 9.997.001 + 2.999 = 10.000.000 (o 2.999,1003 desce);
    // mais uma já passa de R$ 100 mil
    const quantity = maxShares(10_000_000n, 1n, BPS_3);
    expect(quantity).toBe(9_997_001n);
    expect(quantity + tradeCost(quantity, BPS_3)).toBe(10_000_000n);
    expect(tradeCost(quantity, BPS_3)).toBe(2_999n);
  });
});

describe('percentToBps (centésimos de ponto percentual, sem float no dinheiro)', () => {
  it.each([
    [5, 500n],
    [25, 2500n],
    [1, 100n],
    [100, 10_000n],
    [12.5, 1250n],
    [15.5, 1550n],
    [7.25, 725n],
    [12.345, 1235n], // o terceiro decimal decide: 5 sobe
    [12.344, 1234n],
    [0.005, 1n], // 0,005 pp = meio ponto-base: sobe
    [0.004, 0n],
  ])('%s%% é %s bps', (percent, bps) => {
    expect(percentToBps(percent)).toBe(bps);
  });

  it('não se deixa enganar pela representação binária (1.005 é 1.00499999...)', () => {
    expect(percentToBps(1.005)).toBe(101n);
    expect(percentToBps(20.15)).toBe(2015n);
  });

  it('recusa o que não é percentual', () => {
    expect(() => percentToBps(Number.NaN)).toThrow(RangeError);
    expect(() => percentToBps(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => percentToBps(-1)).toThrow(RangeError);
    expect(() => percentToBps(1e21)).toThrow(RangeError);
  });
});

describe('safeNumber', () => {
  it('converte o que cabe e recusa o que perderia precisão', () => {
    expect(safeNumber(1234n)).toBe(1234);
    expect(safeNumber(-1234n)).toBe(-1234);
    expect(() => safeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });
});
