import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as rulesModule from './portfolio-rules.js';
import {
  PORTFOLIO_LIMITS,
  PRICE_MODES,
  lotCostCents,
  parseBrl,
  parseQuantity,
} from './portfolio-rules.js';

// A regra de dinheiro da carteira (etapa 12; docs/API.md, seção 9): ler o valor digitado em reais, o custo total do lançamento nos dois
// modos e os tetos. A api e o formulário do site usam este mesmo módulo.

// Gerador pseudoaleatório com semente (mulberry32): o teste de propriedade sorteia 20 mil casos e, se falhar, falha do mesmo jeito de novo.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// inteiro em [min, max], com max até 10^11 (o sorteio em ponto flutuante é exato nesta faixa)
const between = (next: () => number, min: number, max: number) =>
  min + Math.floor(next() * (max - min + 1));
// Os testes de propriedade rodam 20 mil casos com várias asserções cada um: uns 2 s numa máquina parada, mas os 5 s padrão do vitest estouravam
// numa máquina carregada (o turbo roda os pacotes em paralelo; visto com a carga acima de 100 na revisão da tela da carteira). O prazo maior só
// afasta o falso vermelho: uma propriedade que falha de verdade falha na hora, com o caso sorteado na mensagem.
const PROPERTY_TIMEOUT = { timeout: 60_000 };

describe('PORTFOLIO_LIMITS (os tetos e o pior caso)', () => {
  it('são os que o plano e o ADR 0031 fixam', () => {
    expect(PORTFOLIO_LIMITS).toEqual({
      maxQuantity: 1_000_000,
      maxCostCents: 100_000_000_000,
      maxLots: 200,
      maxCloseCents: 45_000_000,
      minBoughtOn: '1900-01-01',
    });
  });

  // O teto do fechamento (R$ 450.000,00 por ação) é o que mantém o VALOR DE MERCADO da carteira inteira em inteiro seguro: o pior caso é
  // toda a quantidade possível (200 lançamentos de 1.000.000 de ações) ao fechamento máximo, e toda soma de valores é menor ou igual a ele.
  // A api trata a barra acima do teto como "sem fechamento" (uma barra absurda não derruba o GET com 500).
  it('o teto do fechamento é de R$ 450.000,00 e mantém o valor de mercado da carteira inteira em inteiro seguro', () => {
    const { maxQuantity, maxLots, maxCloseCents } = PORTFOLIO_LIMITS;
    const worstShares = BigInt(maxLots) * BigInt(maxQuantity);
    const safe = BigInt(Number.MAX_SAFE_INTEGER);
    expect(worstShares * BigInt(maxCloseCents)).toBeLessThanOrEqual(safe);
    // o máximo exato é 45.035.996 centavos; o teto é o valor redondo logo abaixo, e um pouco acima dele o pior caso já estoura
    expect(safe / worstShares).toBe(45_035_996n);
    expect(worstShares * 45_036_000n).toBeGreaterThan(safe);
  });

  // O pior caso da carteira: 200 lançamentos, cada um no teto de ações e de custo. Toda soma que a api faz tem de caber em inteiro seguro (o
  // JSON leva centavos como número exato) e a soma de quantidades, no INTEGER de 32 bits do banco.
  it('a soma de toda a carteira no pior caso cabe em inteiro seguro (e a de quantidades, em 32 bits)', () => {
    const { maxQuantity, maxCostCents, maxLots } = PORTFOLIO_LIMITS;
    const worstCost = BigInt(maxLots) * BigInt(maxCostCents);
    expect(worstCost).toBe(20_000_000_000_000n);
    expect(worstCost).toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(Number.isSafeInteger(maxLots * maxCostCents)).toBe(true);
    expect(maxLots * maxQuantity).toBe(200_000_000);
    expect(maxLots * maxQuantity).toBeLessThan(2 ** 31);
  });
});

describe('parseBrl (o valor em reais, no jeito brasileiro, para centavos)', () => {
  it.each([
    ['1.234,56', 123_456],
    ['1234,56', 123_456],
    ['0,5', 50],
    ['0,05', 5],
    ['0,01', 1],
    ['12', 1_200],
    ['1', 100],
    ['12,5', 1_250],
    ['12,50', 1_250],
    ['12,05', 1_205],
    ['1.234,5', 123_450],
    ['10.000,00', 1_000_000],
    ['1.234.567,89', 123_456_789],
    ['999.999.999,99', 99_999_999_999],
    ['1.000.000.000,00', 100_000_000_000],
    ['1000000000', 100_000_000_000],
    ['1.234.567', 123_456_700],
    ['  12,50  ', 1_250],
  ])('%j vira %j centavos', (text, cents) => {
    expect(parseBrl(text)).toEqual({ ok: true, cents });
  });

  // O teclado numérico de alguns Android só tem o ponto. Decisão (ADR 0031): um ponto único seguido de 1 ou 2 dígitos é o separador decimal
  // ("12.5" é R$ 12,50), e o ponto seguido de exatamente 3 dígitos é ambíguo (milhar ou três casas?) e é recusado, em vez de adivinhar:
  // R$ 1,234 lido como R$ 1.234,00 seria um erro de mil vezes sem aviso.
  describe('o ponto', () => {
    it.each([
      ['12.5', 1_250],
      ['12.50', 1_250],
      ['0.5', 50],
      ['0.35', 35],
      ['1234.56', 123_456],
      ['3.14', 314],
    ])('um ponto com 1 ou 2 dígitos depois é decimal: %j vale %j centavos', (text, cents) => {
      expect(parseBrl(text)).toEqual({ ok: true, cents });
    });

    it.each(['1.234', '12.345', '999.999', '100.000'])(
      'um ponto com exatamente 3 dígitos depois, sem vírgula, é ambíguo e é recusado: %j',
      (text) => {
        expect(parseBrl(text)).toEqual({ ok: false, reason: 'ambiguous' });
      },
    );

    it.each(['1234.567', '0.500', '1.2345', '12.3456'])(
      'um ponto com 3 dígitos ou mais depois que não é milhar tem casas demais: %j',
      (text) => {
        expect(parseBrl(text)).toEqual({ ok: false, reason: 'decimals' });
      },
    );

    it.each(['1.234.567', '12.345.678', '1.000.000'])(
      'mais de um ponto, em grupos de 3, só pode ser milhar: %j',
      (text) => {
        expect(parseBrl(text).ok).toBe(true);
      },
    );

    it.each(['1.23.456', '1.2.3', '12.345.67', '1234.567.890', '..5', '1..000'])(
      'ponto fora do lugar de milhar é recusado: %j',
      (text) => {
        expect(parseBrl(text)).toEqual({ ok: false, reason: 'invalid' });
      },
    );

    it('o milhar com vírgula decimal confere os grupos (a vírgula manda: o ponto antes dela é sempre milhar)', () => {
      expect(parseBrl('1.234,56')).toEqual({ ok: true, cents: 123_456 });
      for (const text of ['1.23,56', '12.3456,78', '1234.567,89', '.234,56', '1.2345,6']) {
        expect(parseBrl(text), text).toEqual({ ok: false, reason: 'invalid' });
      }
    });
  });

  it('recusa o que não é número: texto, sinal, expoente, hexadecimal, moeda, espaço e dígitos de outros alfabetos', () => {
    for (const text of [
      'abc',
      '-5',
      '+5',
      '-0,50',
      '1e3',
      '1E3',
      '1e-3',
      '0x10',
      'Infinity',
      'NaN',
      'R$ 12,50',
      'R$12,50',
      '12 50',
      '12,50 reais',
      '1 234,56',
      '1 234,56',
      '١٢',
      '１２',
      '12,5​',
      '1_000',
      '12,50;',
      '(12,50)',
      '1,234.56',
      '1,5,0',
      '12,',
      ',5',
      '.5',
      '5.',
      '.',
      ',',
      '007',
      '00,50',
      '01,50',
    ]) {
      expect(parseBrl(text), JSON.stringify(text)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('vazio e só espaços são "empty"', () => {
    expect(parseBrl('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseBrl('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('mais de duas casas depois da vírgula é "decimals"', () => {
    for (const text of ['12,345', '12,555', '0,001', '1.234,567']) {
      expect(parseBrl(text), text).toEqual({ ok: false, reason: 'decimals' });
    }
  });

  it('zero não é valor: "zero"', () => {
    for (const text of ['0', '0,0', '0,00', '0.0', '0.00']) {
      expect(parseBrl(text), text).toEqual({ ok: false, reason: 'zero' });
    }
  });

  it('acima de R$ 1.000.000.000,00 é "too_large", sem perder precisão nem lançar com texto enorme', () => {
    for (const text of [
      '1.000.000.000,01',
      '10000000000',
      '1.000.000.001',
      '99999999999999999999',
      '9'.repeat(500),
      `${'9'.repeat(300)},99`,
    ]) {
      expect(parseBrl(text), text.slice(0, 30)).toEqual({ ok: false, reason: 'too_large' });
    }
  });

  it('texto que não é texto não derruba: null, número e objeto são "invalid"', () => {
    for (const value of [null, undefined, 12.5, 1n, {}, []]) {
      expect(parseBrl(value as never)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  // Propriedade: o que o próprio site mostra ("1.234,56", e a forma sem milhar e a do teclado só com ponto) volta ao mesmo centavo.
  it(
    'propriedade: o valor formatado em reais lê de volta o mesmo centavo (com milhar, sem milhar e com ponto decimal)',
    PROPERTY_TIMEOUT,
    () => {
      const next = seeded(20261103);
      const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      for (let i = 0; i < 20_000; i += 1) {
        // mistura valores pequenos e grandes: o expoente sorteado muda a ordem de grandeza
        const cents = between(next, 1, 10 ** between(next, 0, 11));
        const reais = String(Math.floor(cents / 100));
        const frac = String(cents % 100).padStart(2, '0');
        expect(parseBrl(`${group(reais)},${frac}`), `${cents} com milhar`).toEqual({
          ok: true,
          cents,
        });
        expect(parseBrl(`${reais},${frac}`), `${cents} sem milhar`).toEqual({ ok: true, cents });
        expect(parseBrl(`${reais}.${frac}`), `${cents} com ponto decimal`).toEqual({
          ok: true,
          cents,
        });
      }
    },
  );

  it(
    'propriedade: lixo aleatório nunca lança e sempre devolve um resultado completo',
    PROPERTY_TIMEOUT,
    () => {
      const next = seeded(7);
      const alphabet = '0123456789.,.,  -+eExR$ abc';
      for (let i = 0; i < 20_000; i += 1) {
        const text = Array.from(
          { length: between(next, 0, 24) },
          () => alphabet[between(next, 0, alphabet.length - 1)],
        ).join('');
        const result = parseBrl(text);
        if (result.ok) {
          expect(Number.isSafeInteger(result.cents), text).toBe(true);
          expect(result.cents, text).toBeGreaterThan(0);
          expect(result.cents, text).toBeLessThanOrEqual(PORTFOLIO_LIMITS.maxCostCents);
        } else {
          expect(['empty', 'invalid', 'ambiguous', 'decimals', 'zero', 'too_large']).toContain(
            result.reason,
          );
        }
      }
    },
  );
});

describe('parseQuantity (a quantidade de ações, inteira)', () => {
  it.each([
    ['1', 1],
    ['100', 100],
    ['  100  ', 100],
    ['1000000', 1_000_000],
  ])('%j vale %j', (text, quantity) => {
    expect(parseQuantity(text)).toEqual({ ok: true, quantity });
  });

  it('recusa vazio, zero, acima do teto, decimal, sinal, expoente, milhar e texto', () => {
    expect(parseQuantity('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseQuantity('0')).toEqual({ ok: false, reason: 'zero' });
    expect(parseQuantity('1000001')).toEqual({ ok: false, reason: 'too_large' });
    expect(parseQuantity('9'.repeat(400))).toEqual({ ok: false, reason: 'too_large' });
    for (const text of [
      '1,5',
      '1.5',
      '1.000',
      '-1',
      '+1',
      '1e3',
      '0x10',
      '010',
      'cem',
      '1 0',
      '１',
    ]) {
      expect(parseQuantity(text), text).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(parseQuantity(100 as never)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('lotCostCents (o custo total do lançamento, nos dois modos)', () => {
  it('modo "por ação" é quantidade vezes o preço; modo "total pago" é o próprio valor', () => {
    expect(lotCostCents('unit', 100, 3_550)).toEqual({ ok: true, costCents: 355_000 });
    expect(lotCostCents('total', 100, 355_000)).toEqual({ ok: true, costCents: 355_000 });
    expect(lotCostCents('unit', 3, 3_333)).toEqual({ ok: true, costCents: 9_999 });
    expect(lotCostCents('total', 3, 9_999)).toEqual({ ok: true, costCents: 9_999 });
    expect(lotCostCents('unit', 1, 1)).toEqual({ ok: true, costCents: 1 });
    expect(lotCostCents('total', 1, 1)).toEqual({ ok: true, costCents: 1 });
  });

  it('os modos são os dois do plano', () => {
    expect([...PRICE_MODES]).toEqual(['unit', 'total']);
  });

  it('quantidade fora do que a api aceita é "quantity"', () => {
    for (const quantity of [0, -1, 1.5, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(lotCostCents('unit', quantity, 100), String(quantity)).toEqual({
        ok: false,
        reason: 'quantity',
      });
      expect(lotCostCents('total', quantity, 100), String(quantity)).toEqual({
        ok: false,
        reason: 'quantity',
      });
    }
    expect(lotCostCents('unit', '10' as never, 100)).toEqual({ ok: false, reason: 'quantity' });
  });

  it('valor fora do que a api aceita é "value"', () => {
    for (const value of [
      0,
      -1,
      0.5,
      100_000_000_001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
    ]) {
      expect(lotCostCents('unit', 1, value), String(value)).toEqual({ ok: false, reason: 'value' });
      expect(lotCostCents('total', 1, value), String(value)).toEqual({
        ok: false,
        reason: 'value',
      });
    }
  });

  // O pior caso do produto: com a quantidade e o preço cada um dentro do próprio teto, quantidade × preço chega a 10^17, acima do inteiro
  // seguro (9 × 10^15). O ponto flutuante arredonda esse produto, mas o arredondamento é monotônico: quem passa de 10^11 continua passando,
  // e quem fica até 10^11 é exato. Por isso a comparação com o teto é correta sem BigInt (e sem o módulo importar nada).
  it('o teto do custo do lançamento vale nos dois modos, exato no limite e com o produto acima do inteiro seguro', () => {
    const { maxQuantity, maxCostCents } = PORTFOLIO_LIMITS;
    expect(lotCostCents('unit', maxQuantity, 100_000)).toEqual({
      ok: true,
      costCents: maxCostCents,
    });
    expect(lotCostCents('unit', maxQuantity, 100_001)).toEqual({ ok: false, reason: 'cost' });
    expect(lotCostCents('unit', 1, maxCostCents)).toEqual({ ok: true, costCents: maxCostCents });
    expect(lotCostCents('unit', 2, maxCostCents)).toEqual({ ok: false, reason: 'cost' });
    expect(lotCostCents('total', maxQuantity, maxCostCents)).toEqual({
      ok: true,
      costCents: maxCostCents,
    });
    // 10^6 × 10^11 = 10^17: o produto exato não cabe em inteiro seguro e mesmo assim é recusado, sem virar um número "bom" por arredondamento
    expect(Number.isSafeInteger(maxQuantity * maxCostCents)).toBe(false);
    expect(lotCostCents('unit', maxQuantity, maxCostCents)).toEqual({ ok: false, reason: 'cost' });
    // operandos grandes dos dois lados do teto
    expect(lotCostCents('unit', 999_999, 100_001)).toEqual({ ok: false, reason: 'cost' });
    expect(lotCostCents('unit', 100_000, 1_000_000)).toEqual({ ok: true, costCents: maxCostCents });
    expect(lotCostCents('unit', 100_000, 1_000_001)).toEqual({ ok: false, reason: 'cost' });
    expect(lotCostCents('unit', 99_999, 1_000_000)).toEqual({
      ok: true,
      costCents: 99_999_000_000,
    });
  });

  // Aceite da etapa 12: os dois modos geram o mesmo custo total para os mesmos números.
  it(
    'propriedade: "por ação" com o preço p e "total pago" com quantidade × p dão o mesmo custo, e é o produto exato (conferido em BigInt)',
    PROPERTY_TIMEOUT,
    () => {
      const next = seeded(12);
      const cap = BigInt(PORTFOLIO_LIMITS.maxCostCents);
      let accepted = 0;
      let refused = 0;
      for (let i = 0; i < 20_000; i += 1) {
        const quantity = between(next, 1, PORTFOLIO_LIMITS.maxQuantity);
        // o preço sorteado sobe de R$ 0,01 até o teto, em ordens de grandeza diferentes, para sobrar caso dos dois lados do teto
        const price = between(next, 1, 10 ** between(next, 0, 11));
        const exact = BigInt(quantity) * BigInt(price);
        const unit = lotCostCents('unit', quantity, price);
        if (exact > cap) {
          refused += 1;
          expect(unit, `${quantity} × ${price}`).toEqual({ ok: false, reason: 'cost' });
          continue;
        }
        accepted += 1;
        const total = lotCostCents('total', quantity, Number(exact));
        expect(unit, `${quantity} × ${price}`).toEqual({ ok: true, costCents: Number(exact) });
        expect(total, `${quantity} total ${exact}`).toEqual(unit);
      }
      // a amostra tem os dois lados (senão o teste passaria à toa)
      expect(accepted).toBeGreaterThan(2_000);
      expect(refused).toBeGreaterThan(2_000);
    },
  );
});

// O site lê o módulo pelo subcaminho `@alvesting/contracts/portfolio-rules` nos módulos que vão ao navegador. Se ele passar a importar algo
// (o zod, ou os schemas), o bundler volta a levar o zod à tela da carteira. Mesma regra do account-constants.
describe('portfolio-rules (o que vai ao navegador)', () => {
  it('mora num módulo sem imports', async () => {
    const source = await readFile(new URL('./portfolio-rules.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*(import|export)\b[^\n]*\bfrom\b/m);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
    expect(Object.keys(rulesModule).sort()).toEqual([
      'PORTFOLIO_LIMITS',
      'PRICE_MODES',
      'lotCostCents',
      'parseBrl',
      'parseQuantity',
    ]);
  });
});
