import { describe, expect, it } from 'vitest';
import { interest, parseCdi, rateOnOrBefore } from './cdi.js';

// O CDI vem do SGS 12 como texto decimal em % ao dia, com 6 casas (macro_daily.value é NUMERIC(18,8): no máximo 8).
// Aqui vira inteiro (% x 1e8) e a conta do caixa usa só inteiros.

describe('parseCdi', () => {
  it('lê o texto decimal sem passar por float', () => {
    const rates = parseCdi([
      { date: '2026-11-03', pct: '0.050788' },
      { date: '2026-11-04', pct: '0.05' },
      { date: '2026-11-05', pct: '13' },
      { date: '2026-11-06', pct: '0.00000001' },
      { date: '2026-11-09', pct: '0' },
    ]);
    expect(rates.map((r) => r.scaled)).toEqual([5_078_800n, 5_000_000n, 1_300_000_000n, 1n, 0n]);
  });

  it('ordena por data, qualquer que seja a ordem em que o banco devolve', () => {
    const rates = parseCdi([
      { date: '2026-11-05', pct: '0.3' },
      { date: '2026-11-03', pct: '0.1' },
      { date: '2026-11-04', pct: '0.2' },
    ]);
    expect(rates.map((r) => r.date)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
  });

  it.each(['0.123456789', '-0.1', 'abc', '', '1e-3', ' 0.05', '0,05', '.5', '5.'])(
    'recusa %j: taxa com mais casas que a série, negativa ou fora do formato',
    (pct) => {
      expect(() => parseCdi([{ date: '2026-11-03', pct }])).toThrow(RangeError);
    },
  );

  it('recusa data que não existe', () => {
    expect(() => parseCdi([{ date: '2026-02-30', pct: '0.05' }])).toThrow(RangeError);
    expect(() => parseCdi([{ date: '03/11/2026', pct: '0.05' }])).toThrow(RangeError);
  });

  it('não muda a lista de entrada', () => {
    const input = [
      { date: '2026-11-05', pct: '0.3' },
      { date: '2026-11-03', pct: '0.1' },
    ];
    const copy = structuredClone(input);
    parseCdi(input);
    expect(input).toEqual(copy);
  });
});

describe('rateOnOrBefore (o último CDI publicado até a data)', () => {
  const rates = parseCdi([
    { date: '2026-10-30', pct: '0.050001' },
    { date: '2026-11-03', pct: '0.050788' },
    { date: '2026-11-04', pct: '0.050812' },
    { date: '2026-11-09', pct: '0.050700' },
  ]);

  it('devolve a taxa da própria data quando ela existe', () => {
    expect(rateOnOrBefore(rates, '2026-11-04')?.date).toBe('2026-11-04');
    expect(rateOnOrBefore(rates, '2026-11-03')?.scaled).toBe(5_078_800n);
  });

  it('data sem taxa (ainda não publicada): vale a última anterior, e a data usada fica registrada', () => {
    const rate = rateOnOrBefore(rates, '2026-11-06');
    expect(rate).toEqual({ date: '2026-11-04', scaled: 5_081_200n });
    expect(rateOnOrBefore(rates, '2026-11-08')?.date).toBe('2026-11-04');
  });

  it('nunca olha para o futuro', () => {
    expect(rateOnOrBefore(rates, '2026-11-05')?.date).toBe('2026-11-04'); // a de 09/11 já existe e não entra
  });

  it('sem nenhuma taxa até a data: null', () => {
    expect(rateOnOrBefore(rates, '2026-10-29')).toBeNull();
    expect(rateOnOrBefore([], '2026-11-03')).toBeNull();
  });
});

describe('interest (juros do caixa por um dia útil)', () => {
  const rate = (pct: string) => {
    const [parsed] = parseCdi([{ date: '2026-11-03', pct }]);
    if (!parsed) throw new Error('taxa não lida');
    return parsed;
  };

  it.each([
    [1_000_000n, '0.050788', 508n], // 507,88
    [647_094n, '0.050788', 329n], // 328,646...
    [497_866n, '0.050812', 253n], // 252,975...
    [590n, '0.050640', 0n], // 0,2988: some no arredondamento
    [147_917n, '0.050640', 75n], // 74,905...
    [10_000_000n, '0.050788', 5_079n], // R$ 100 mil: R$ 50,79 (5.078,8)
    [0n, '0.050788', 0n],
    [1_000_000n, '0', 0n],
  ])('caixa de %s centavos a %s%% ao dia rende %s', (cash, pct, expected) => {
    expect(interest(cash, rate(pct))).toBe(expected);
  });

  it('o meio centavo sobe (0,5 vira 1)', () => {
    expect(interest(5_000n, rate('0.01'))).toBe(1n); // 5.000 x 0,0001 = 0,5
    expect(interest(4_999n, rate('0.01'))).toBe(0n); // 0,4999
  });
});
