// A regra de dinheiro da carteira (plano §11, etapa 12; docs/API.md, seção 9; ADR 0031): ler o valor digitado em reais, calcular o custo
// total de um lançamento nos dois modos e os tetos que mantêm toda soma da carteira em inteiro seguro.
//
// Este módulo NÃO importa nada, de propósito (nem o zod), pela mesma razão do account-constants.ts: o formulário do site o lê pelo subcaminho
// `@alvesting/contracts/portfolio-rules`, e pelo índice do pacote o bundler levaria o zod e os schemas ao navegador. A api (os schemas de
// portfolio.ts), o formulário e os testes usam estas mesmas funções, então "R$ 12,50" é 1.250 centavos nos dois lados.
//
// Dinheiro é centavo inteiro. Os valores daqui cabem em `number` com folga (o teto é 10^11, e o inteiro seguro vai a 9 × 10^15); a api
// faz as contas da carteira em BigInt (apps/api/.../portfolio/domain/positions.ts).

// Os tetos (ADR 0031). O PIOR CASO da carteira inteira: 200 lançamentos, cada um no teto de custo, soma 2 × 10^13 centavos (R$ 200 bilhões),
// 450 vezes abaixo do inteiro seguro; 200 lançamentos de 1.000.000 de ações somam 2 × 10^8, abaixo do INTEGER de 32 bits do banco. O valor
// de mercado (quantidade × último fechamento) de toda a carteira só cabe em inteiro seguro com um fechamento de até R$ 450.000,00 por ação
// (`maxCloseCents`): uma barra acima disso não é cotação, e a api deixa a posição "sem fechamento" em vez de perder precisão ou dar 500.
// O P&L percentual (em pontos-base) sai do inteiro seguro antes disso, com custo de centavos sobre valor alto (uns R$ 9.007 por ação com
// o menor custo que o banco aceita), e aí é nulo. Os CHECKs do banco (migration `20261103130000_portfolio`) repetem quantidade e custo.
// ponytail: tetos fixos. Subir exige conferir de novo a soma do pior caso acima (o teste portfolio-rules.spec.ts a faz) e a migration.
export const PORTFOLIO_LIMITS = {
  // ações por lançamento
  maxQuantity: 1_000_000,
  // custo total por lançamento, em centavos: R$ 1.000.000.000,00
  maxCostCents: 100_000_000_000,
  // lançamentos por carteira (por usuário)
  maxLots: 200,
  // o maior fechamento de uma ação que a carteira usa, em centavos por ação: R$ 450.000,00 (não é limite de lançamento: o banco não o repete)
  maxCloseCents: 45_000_000,
  // a data da compra não é anterior a esta (rede de segurança contra lixo como 0001-01-01; o banco repete)
  minBoughtOn: '1900-01-01',
} as const;

// Os dois modos do plano (§11): o valor digitado é o preço de UMA ação ("unit") ou o total pago no lançamento ("total").
export const PRICE_MODES = ['unit', 'total'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export type MoneyError = 'empty' | 'invalid' | 'ambiguous' | 'decimals' | 'zero' | 'too_large';
export type MoneyParse = { ok: true; cents: number } | { ok: false; reason: MoneyError };

const fail = (reason: MoneyError): { ok: false; reason: MoneyError } => ({ ok: false, reason });

// Parte inteira sem zero à esquerda: "0" ou "12" (e "007" não).
const PLAIN_INT = /^(?:0|[1-9]\d*)$/;
// Milhar em grupos de 3 depois do primeiro grupo de 1 a 3 dígitos, que não começa por zero: "1.234" e "12.345.678".
const GROUPED_INT = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const THOUSANDS_LEADING = /^[1-9]\d{0,2}$/;
// Dígitos da parte inteira em reais que ainda cabem no teto: R$ 1.000.000.000 tem 10.
const MAX_REAIS_DIGITS = String(PORTFOLIO_LIMITS.maxCostCents / 100).length;

// O valor digitado em reais, no jeito brasileiro, para centavos inteiros. Aceita "1.234,56", "1234,56", "0,5", "12" (e "R$" não: é texto).
//
// A vírgula manda: com ela, o ponto antes dela é milhar (grupos de 3) e depois dela vêm 1 ou 2 dígitos. Sem vírgula, o ponto:
//  - dois ou mais pontos, em grupos de 3, só podem ser milhar ("1.234.567");
//  - um ponto seguido de 1 ou 2 dígitos é o separador DECIMAL ("12.5" é R$ 12,50): é o que o teclado numérico de alguns Android manda;
//  - um ponto seguido de exatamente 3 dígitos ("1.234") é AMBÍGUO (milhar ou três casas?) e é recusado, em vez de adivinhar: R$ 1,234
//    lido como R$ 1.234,00 seria um erro de mil vezes sem aviso. Quem quer mil e duzentos escreve "1.234,00" ou "1234".
// Recusa vazio, negativo, expoente ("1e3"), hexadecimal, texto, espaço no meio, dígito de outro alfabeto, zero, mais de 2 casas e o que
// passa de R$ 1.000.000.000,00. O espaço nas pontas (e o NBSP de um valor colado) é aparado. As expressões são lineares: texto enorme só
// custa o tamanho dele.
export function parseBrl(input: string): MoneyParse {
  if (typeof input !== 'string') return fail('invalid');
  const text = input.trim();
  if (text === '') return fail('empty');
  if (!/^[0-9.,]+$/.test(text)) return fail('invalid');

  let integer: string;
  let fraction = '';
  const comma = text.indexOf(',');
  if (comma !== -1) {
    if (comma !== text.lastIndexOf(',')) return fail('invalid');
    integer = text.slice(0, comma);
    fraction = text.slice(comma + 1);
    if (!/^\d+$/.test(fraction)) return fail('invalid');
    if (fraction.length > 2) return fail('decimals');
    if (integer.includes('.')) {
      if (!GROUPED_INT.test(integer)) return fail('invalid');
      integer = integer.replaceAll('.', '');
    } else if (!PLAIN_INT.test(integer)) {
      return fail('invalid');
    }
  } else if (!text.includes('.')) {
    if (!PLAIN_INT.test(text)) return fail('invalid');
    integer = text;
  } else if (text.indexOf('.') !== text.lastIndexOf('.')) {
    if (!GROUPED_INT.test(text)) return fail('invalid');
    integer = text.replaceAll('.', '');
  } else {
    const dot = text.indexOf('.');
    integer = text.slice(0, dot);
    fraction = text.slice(dot + 1);
    if (!PLAIN_INT.test(integer) || !/^\d+$/.test(fraction)) return fail('invalid');
    if (fraction.length === 3 && THOUSANDS_LEADING.test(integer)) return fail('ambiguous');
    if (fraction.length > 2) return fail('decimals');
  }

  if (integer.length > MAX_REAIS_DIGITS) return fail('too_large');
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents === 0) return fail('zero');
  if (cents > PORTFOLIO_LIMITS.maxCostCents) return fail('too_large');
  return { ok: true, cents };
}

export type QuantityError = 'empty' | 'invalid' | 'zero' | 'too_large';
export type QuantityParse = { ok: true; quantity: number } | { ok: false; reason: QuantityError };

// A quantidade de ações digitada: só dígitos, inteira, de 1 a 1.000.000. Milhar com ponto ("1.000"), decimal, sinal e expoente são "invalid".
export function parseQuantity(input: string): QuantityParse {
  if (typeof input !== 'string') return { ok: false, reason: 'invalid' };
  const text = input.trim();
  if (text === '') return { ok: false, reason: 'empty' };
  if (/^0+$/.test(text)) return { ok: false, reason: 'zero' };
  if (!/^[1-9]\d*$/.test(text)) return { ok: false, reason: 'invalid' };
  if (text.length > String(PORTFOLIO_LIMITS.maxQuantity).length) {
    return { ok: false, reason: 'too_large' };
  }
  const quantity = Number(text);
  if (quantity > PORTFOLIO_LIMITS.maxQuantity) return { ok: false, reason: 'too_large' };
  return { ok: true, quantity };
}

export type LotCostError = 'quantity' | 'value' | 'cost';
export type LotCost = { ok: true; costCents: number } | { ok: false; reason: LotCostError };

// O custo total do lançamento em centavos: no modo "unit" é quantidade × preço de uma ação; no modo "total" é o próprio valor. Os dois modos
// geram o mesmo custo para os mesmos números (aceite da etapa 12). `reason` diz qual número está fora do que a api aceita.
//
// A comparação do produto com o teto é exata sem BigInt: quantidade e preço são inteiros dentro dos próprios tetos, e o produto exato passa
// de 2^53 (e o ponto flutuante o arredonda) só quando já é maior que o teto de 10^11. A multiplicação arredondada é monotônica e o teto é
// representável: o produto exato até o teto sai exato, e o que passa dele, mesmo arredondado, continua passando (a distância mínima é 1).
export function lotCostCents(mode: PriceMode, quantity: number, valueCents: number): LotCost {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > PORTFOLIO_LIMITS.maxQuantity) {
    return { ok: false, reason: 'quantity' };
  }
  if (
    !Number.isInteger(valueCents) ||
    valueCents < 1 ||
    valueCents > PORTFOLIO_LIMITS.maxCostCents
  ) {
    return { ok: false, reason: 'value' };
  }
  const costCents = mode === 'unit' ? quantity * valueCents : valueCents;
  if (costCents > PORTFOLIO_LIMITS.maxCostCents) return { ok: false, reason: 'cost' };
  return { ok: true, costCents };
}
