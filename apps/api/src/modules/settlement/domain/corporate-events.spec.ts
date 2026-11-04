import { describe, expect, it } from 'vitest';
import { applyCorporateEvent, validateEvent } from './corporate-events.js';
import type { Portfolio, Position } from './portfolio.js';

// Desdobramento, grupamento e bonificação em ações, na data ex (plano, 16, etapa 7): a quantidade muda pelo fator e o
// custo total da posição fica (o preço por ação é que muda). Fração de ação vira dinheiro ao preço de abertura do dia.
// Proventos em dinheiro estão fora. Números contados à mão.

const pos = (quantity: number, cost: number, mark: number): Position => ({
  quantity: BigInt(quantity),
  costCents: BigInt(cost),
  markCents: BigInt(mark),
});
const folio = (cash: number, positions: Record<string, Position>): Portfolio => ({
  cashCents: BigInt(cash),
  positions: new Map(Object.entries(positions)),
});
const event = (from: number, to: number) => ({
  ticker: 'XXX3',
  from: BigInt(from),
  to: BigInt(to),
});

describe('applyCorporateEvent', () => {
  it('desdobramento de 1 para 2: dobra a quantidade, mantém o custo total e remarca na abertura nova', () => {
    const after = applyCorporateEvent(
      folio(1_000, { XXX3: pos(62, 155_047, 2600) }),
      event(1, 2),
      1300n,
    );
    expect(after.positions.get('XXX3')).toEqual(pos(124, 155_047, 1300));
    expect(after.cashCents).toBe(1_000n);
    // o valor da posição não muda: 62 x 26,00 antes = 124 x 13,00 depois
    expect(62n * 2600n).toBe(124n * 1300n);
  });

  it('bonificação de 10% (cada 10 viram 11): 100 viram 110 e o custo fica', () => {
    const after = applyCorporateEvent(
      folio(0, { XXX3: pos(100, 50_000, 500) }),
      event(10, 11),
      455n,
    );
    expect(after.positions.get('XXX3')).toEqual(pos(110, 50_000, 455));
    expect(after.cashCents).toBe(0n);
  });

  it('grupamento de 10 para 1: 100 viram 10 e o custo fica', () => {
    const after = applyCorporateEvent(
      folio(0, { XXX3: pos(100, 50_000, 500) }),
      event(10, 1),
      5000n,
    );
    expect(after.positions.get('XXX3')).toEqual(pos(10, 50_000, 5000));
    expect(after.cashCents).toBe(0n);
  });

  it('fração de ação: paga em dinheiro ao preço de abertura e leva o custo na proporção', () => {
    // grupamento 10 para 1 sobre 25 ações = 2,5. Ficam 2 ações; a meia ação paga 0,5 x R$ 13,00 = 650
    // o custo das 2 ações: 50.000 x 2 / 2,5 = 40.000
    const after = applyCorporateEvent(
      folio(100, { XXX3: pos(25, 50_000, 500) }),
      event(10, 1),
      1300n,
    );
    expect(after.positions.get('XXX3')).toEqual(pos(2, 40_000, 1300));
    expect(after.cashCents).toBe(100n + 650n);
  });

  it('fração com arredondamento: bonificação de 10% sobre 15 ações = 16,5', () => {
    // 16 ações; meia ação a R$ 4,80 = 240; custo 50.000 x 16 / 16,5 = 48.484,85 -> 48.485
    const after = applyCorporateEvent(
      folio(0, { XXX3: pos(15, 50_000, 500) }),
      event(10, 11),
      480n,
    );
    expect(after.positions.get('XXX3')).toEqual(pos(16, 48_485, 480));
    expect(after.cashCents).toBe(240n);
  });

  it('o dinheiro da fração arredonda para o centavo mais próximo (o meio sobe)', () => {
    // 7 ações no grupamento 4 para 1 = 1,75: fica 1 ação e os 0,75 pagam 0,75 x R$ 10,10 = R$ 7,575 = 757,5 centavos -> 758
    const after = applyCorporateEvent(folio(0, { XXX3: pos(7, 7_000, 1000) }), event(4, 1), 1010n);
    expect(after.cashCents).toBe(758n);
    expect(after.positions.get('XXX3')?.quantity).toBe(1n);
  });

  it('se não sobra nenhuma ação inteira, a posição some e a fração vira dinheiro', () => {
    // 5 ações no grupamento 10 para 1 = 0,5 ação, a R$ 10,00 = 500
    const after = applyCorporateEvent(folio(0, { XXX3: pos(5, 3_000, 500) }), event(10, 1), 1000n);
    expect(after.positions.has('XXX3')).toBe(false);
    expect(after.cashCents).toBe(500n);
  });

  it('quem não tem a ação não é afetado, e as outras posições ficam como estão', () => {
    const start = folio(7, { YYY3: pos(10, 1_000, 100) });
    const after = applyCorporateEvent(start, event(1, 2), 1300n);
    expect(after.cashCents).toBe(7n);
    expect([...after.positions]).toEqual([['YYY3', pos(10, 1_000, 100)]]);
  });

  it('não muda o estado de entrada', () => {
    const start = folio(0, { XXX3: pos(25, 50_000, 500) });
    applyCorporateEvent(start, event(10, 1), 1300n);
    expect(start.positions.get('XXX3')).toEqual(pos(25, 50_000, 500));
    expect(start.cashCents).toBe(0n);
  });

  it('fator zero ou negativo é erro', () => {
    const start = folio(0, { XXX3: pos(25, 50_000, 500) });
    expect(() => applyCorporateEvent(start, event(0, 2), 1300n)).toThrow(RangeError);
    expect(() => applyCorporateEvent(start, event(1, 0), 1300n)).toThrow(RangeError);
    expect(() => applyCorporateEvent(start, event(-1, 2), 1300n)).toThrow(RangeError);
  });
});

describe('validateEvent', () => {
  const ok = {
    id: '01JCZ6S8Y0000000000000000A',
    ticker: 'XXX3',
    exDate: '2026-11-05',
    from: 1n,
    to: 2n,
  };

  it('aceita um evento bem formado', () => {
    expect(() => validateEvent(ok)).not.toThrow();
  });

  it('recusa data ex que não existe, fator sem sentido e fator que não muda nada', () => {
    expect(() => validateEvent({ ...ok, exDate: '2026-02-30' })).toThrow(RangeError);
    expect(() => validateEvent({ ...ok, from: 0n })).toThrow(RangeError);
    expect(() => validateEvent({ ...ok, to: -2n })).toThrow(RangeError);
    expect(() => validateEvent({ ...ok, from: 3n, to: 3n })).toThrow(RangeError);
    expect(() => validateEvent({ ...ok, ticker: '' })).toThrow(RangeError);
  });
});
