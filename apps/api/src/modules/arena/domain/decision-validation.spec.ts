import type { DecisionItem } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import {
  validateSemantics,
  type IndexedItem,
  type SemanticContext,
} from './decision-validation.js';

const buy = (ticker: string, percent = 10): DecisionItem => ({
  ticker,
  action: 'BUY',
  percent_of_equity: percent,
  rationale: 'compra',
});
const sell = (ticker: string, percent = 50): DecisionItem => ({
  ticker,
  action: 'SELL',
  percent_of_position: percent,
  rationale: 'venda',
});
const hold = (ticker: string): DecisionItem => ({ ticker, action: 'HOLD', rationale: 'mantém' });

const indexed = (items: DecisionItem[]): IndexedItem[] =>
  items.map((item, index) => ({ index, item }));

const UNIVERSE = ['WEGE3', 'PETR4', 'ITUB4', 'BBDC4', 'ABEV3', 'RENT3', 'SUZB3', 'RADL3', 'B3SA3'];
const context = (overrides: Partial<SemanticContext> = {}): SemanticContext => ({
  universe: new Set(UNIVERSE),
  holdings: new Map([['VALE3', 100n]]),
  maxPositions: 10,
  maxOrders: 5,
  ...overrides,
});
const run = (items: DecisionItem[], ctx = context()) => validateSemantics(indexed(items), ctx);
const droppedOf = (result: ReturnType<typeof run>) =>
  result.dropped.map((d) => [d.index, d.reason] as const);

describe('validateSemantics: universo e carteira', () => {
  it('BUY de ação do universo fica; fora do universo é descartado com o motivo', () => {
    const result = run([buy('WEGE3'), buy('XPTO3')]);
    expect(result.kept.map((k) => k.item.ticker)).toEqual(['WEGE3']);
    expect(droppedOf(result)).toEqual([[1, 'not_in_universe']]);
  });

  it('SELL de ação da carteira fica; SELL de ação que não está na carteira é descartado', () => {
    const result = run([sell('VALE3'), sell('WEGE3')]);
    expect(result.kept.map((k) => k.item.ticker)).toEqual(['VALE3']);
    expect(droppedOf(result)).toEqual([[1, 'not_in_portfolio']]);
  });

  it('o SELL vale mesmo que a ação tenha saído do universo da semana (a carteira é que conta)', () => {
    expect(run([sell('VALE3')]).kept).toHaveLength(1);
  });

  it('posição com quantidade zero não é carteira', () => {
    const result = run([sell('VALE3')], context({ holdings: new Map([['VALE3', 0n]]) }));
    expect(droppedOf(result)).toEqual([[0, 'not_in_portfolio']]);
  });

  it('BUY de ação que já está na carteira, mas saiu do universo, é descartado (compra só do universo)', () => {
    expect(droppedOf(run([buy('VALE3')]))).toEqual([[0, 'not_in_universe']]);
  });

  it('HOLD não passa por universo nem carteira, e nunca conta ordem', () => {
    const result = run([hold('QUALQ3'), hold('WEGE3')]);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toEqual([]);
  });
});

describe('validateSemantics: ticker repetido', () => {
  it('o primeiro vale e os seguintes são descartados, qualquer que seja a ação', () => {
    const result = run([buy('WEGE3'), buy('WEGE3', 20), sell('WEGE3'), hold('WEGE3')]);
    expect(result.kept.map((k) => k.index)).toEqual([0]);
    expect(droppedOf(result)).toEqual([
      [1, 'duplicate_ticker'],
      [2, 'duplicate_ticker'],
      [3, 'duplicate_ticker'],
    ]);
  });

  it('HOLD primeiro e BUY depois: o BUY é o repetido', () => {
    expect(droppedOf(run([hold('WEGE3'), buy('WEGE3')]))).toEqual([[1, 'duplicate_ticker']]);
  });

  it('o item descartado por outro motivo não "reserva" o ticker para os seguintes', () => {
    const result = run([sell('WEGE3'), buy('WEGE3')]);
    expect(result.kept.map((k) => k.index)).toEqual([1]);
    expect(droppedOf(result)).toEqual([[0, 'not_in_portfolio']]);
  });
});

describe('validateSemantics: as 5 ordens, na ordem listada', () => {
  const orders = (n: number) => UNIVERSE.slice(0, n).map((ticker) => buy(ticker));

  it('a 6ª ordem é descartada com over_order_limit, e as 5 primeiras ficam', () => {
    const result = run(orders(6));
    expect(result.kept.map((k) => k.index)).toEqual([0, 1, 2, 3, 4]);
    expect(droppedOf(result)).toEqual([[5, 'over_order_limit']]);
  });

  it('HOLD não conta: 5 ordens e 4 HOLD ficam todos', () => {
    const result = run([hold('B3SA3'), ...orders(5), hold('RADL3'), hold('SUZB3'), hold('QUALQ3')]);
    expect(result.kept).toHaveLength(9);
  });

  it('ordem inválida não gasta o limite (ADR 0016): as 5 válidas depois dela ficam', () => {
    const result = run([buy('XPTO3'), ...orders(5)]);
    expect(result.kept.map((k) => k.index)).toEqual([1, 2, 3, 4, 5]);
    expect(droppedOf(result)).toEqual([[0, 'not_in_universe']]);
  });

  it('o corte conta SELL e BUY juntos', () => {
    const result = run(
      [sell('VALE3'), buy('WEGE3'), buy('PETR4'), buy('ITUB4'), buy('BBDC4'), buy('ABEV3')],
      context(),
    );
    expect(droppedOf(result)).toEqual([[5, 'over_order_limit']]);
  });

  it('o teto vem do contexto (parâmetro da temporada)', () => {
    const result = run(orders(3), context({ maxOrders: 2 }));
    expect(droppedOf(result)).toEqual([[2, 'over_order_limit']]);
  });
});

describe('validateSemantics: até 10 posições', () => {
  const holdings = (n: number) =>
    new Map(Array.from({ length: n }, (_, i) => [`POS${i + 1}F3`, 100n] as const));

  it('com 9 posições, a primeira compra de ação nova fica e a segunda é descartada', () => {
    const result = run([buy('WEGE3'), buy('PETR4')], context({ holdings: holdings(9) }));
    expect(result.kept.map((k) => k.index)).toEqual([0]);
    expect(droppedOf(result)).toEqual([[1, 'max_positions']]);
  });

  it('comprar mais de uma ação que já está na carteira não cria posição nova', () => {
    const full = new Map([...holdings(9), ['WEGE3', 10n] as const]);
    expect(run([buy('WEGE3'), buy('PETR4')], context({ holdings: full })).dropped).toMatchObject([
      { index: 1, reason: 'max_positions' },
    ]);
    expect(run([buy('WEGE3')], context({ holdings: full })).kept).toHaveLength(1);
  });

  it('vender 100% de uma posição libera a vaga (as vendas rodam antes das compras)', () => {
    const result = run([buy('WEGE3'), sell('POS1F3', 100)], context({ holdings: holdings(10) }));
    expect(result.dropped).toEqual([]);
  });

  it('vender menos de 100% não libera vaga', () => {
    const result = run([sell('POS1F3', 99), buy('WEGE3')], context({ holdings: holdings(10) }));
    expect(droppedOf(result)).toEqual([[1, 'max_positions']]);
  });

  it('a compra descartada por posições libera a vaga de ordem para a seguinte', () => {
    const result = run(
      [buy('WEGE3'), buy('PETR4'), buy('ITUB4'), buy('BBDC4'), buy('ABEV3'), buy('RENT3')],
      context({ holdings: holdings(9) }),
    );
    // só uma ação nova cabe; as demais caem por posições, e nenhuma chega ao corte das 5 ordens
    expect(result.kept.map((k) => k.index)).toEqual([0]);
    expect(result.dropped.every((d) => d.reason === 'max_positions')).toBe(true);
  });

  it('o teto vem do contexto', () => {
    const result = run(
      [buy('WEGE3'), buy('PETR4')],
      context({ holdings: new Map(), maxPositions: 1 }),
    );
    expect(droppedOf(result)).toEqual([[1, 'max_positions']]);
  });

  describe('a venda total cortada pelo limite de ordens não libera a vaga', () => {
    // 10 posições; quatro delas estão no universo (reforço de posição não cria vaga nova)
    const full = new Map([
      ...holdings(6),
      ['WEGE3', 10n] as const,
      ['PETR4', 10n] as const,
      ['ITUB4', 10n] as const,
      ['BBDC4', 10n] as const,
    ]);
    const topUps = [buy('WEGE3'), buy('PETR4'), buy('ITUB4'), buy('BBDC4')];

    it('o SELL de 100% listado em 6º é cortado, e a compra de ação nova que contava com a vaga cai (max_positions)', () => {
      const result = run(
        [buy('RENT3'), ...topUps, sell('POS1F3', 100)],
        context({ holdings: full }),
      );
      expect(result.kept.map((k) => k.index)).toEqual([1, 2, 3, 4]);
      expect(droppedOf(result)).toEqual([
        [0, 'max_positions'],
        [5, 'over_order_limit'],
      ]);
    });

    it('com o SELL dentro das 5 ordens a vaga vale e nada cai', () => {
      const result = run(
        [sell('POS1F3', 100), buy('RENT3'), ...topUps.slice(0, 3)],
        context({ holdings: full }),
      );
      expect(result.dropped).toEqual([]);
      expect(result.kept).toHaveLength(5);
    });

    it('com o SELL parcial a compra já cai na passada 2 e não gasta o limite: o SELL cabe nas 5 ordens', () => {
      const result = run(
        [buy('RENT3'), ...topUps, sell('POS1F3', 40)],
        context({ holdings: full }),
      );
      expect(droppedOf(result)).toEqual([[0, 'max_positions']]);
      expect(result.kept.map((k) => k.index)).toEqual([1, 2, 3, 4, 5]);
    });
  });
});

describe('validateSemantics: forma do resultado', () => {
  it('o descartado leva o índice original e o item (para gravar ação, ticker e percentual)', () => {
    const result = run([hold('WEGE3'), buy('XPTO3', 12.5)]);
    expect(result.dropped).toEqual([
      { index: 1, reason: 'not_in_universe', item: buy('XPTO3', 12.5) },
    ]);
  });

  it('mantém os índices originais mesmo quando o parser já tirou itens inválidos de schema', () => {
    const result = validateSemantics(
      [
        { index: 0, item: buy('WEGE3') },
        { index: 3, item: buy('PETR4') },
      ],
      context(),
    );
    expect(result.kept.map((k) => k.index)).toEqual([0, 3]);
  });

  it('lista vazia não descarta nada', () => {
    expect(run([])).toEqual({ kept: [], dropped: [] });
  });
});
