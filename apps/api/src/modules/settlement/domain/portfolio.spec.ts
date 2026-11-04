import type { DecisionItem } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { PLAN_RULES } from './fixtures/rules.fixture.js';
import {
  equityAtOpen,
  executeSession,
  markToMarket,
  type Bar,
  type Portfolio,
  type Position,
  type SettlementRules,
} from './portfolio.js';

// Um pregão de um competidor (plano, 2): execução no preço oficial de abertura de D, vendas antes das compras, ações
// inteiras, custo de 0,03%, sem alavancagem, até 10 posições, patrimônio do BUY medido na abertura. Os números
// esperados foram contados à mão (ver docs/METODOLOGIA.md) ou numa calculadora, nunca com este código.

const D = '2026-11-04';
const bar = (open: number, close = open): Bar => ({
  openCents: BigInt(open),
  closeCents: BigInt(close),
});
const bars = (entries: Record<string, Bar>) => new Map(Object.entries(entries));
const pos = (quantity: number, cost: number, mark: number): Position => ({
  quantity: BigInt(quantity),
  costCents: BigInt(cost),
  markCents: BigInt(mark),
});
const folio = (cash: number, positions: Record<string, Position> = {}): Portfolio => ({
  cashCents: BigInt(cash),
  positions: new Map(Object.entries(positions)),
});
const buy = (ticker: string, percent: number): DecisionItem => ({
  ticker,
  action: 'BUY',
  percent_of_equity: percent,
  rationale: 'teste',
});
const sell = (ticker: string, percent: number): DecisionItem => ({
  ticker,
  action: 'SELL',
  percent_of_position: percent,
  rationale: 'teste',
});
const hold = (ticker: string): DecisionItem => ({ ticker, action: 'HOLD', rationale: 'teste' });
const run = (
  portfolio: Portfolio,
  items: DecisionItem[],
  market: Map<string, Bar>,
  rules: SettlementRules = PLAN_RULES,
) => executeSession({ date: D, portfolio, items, bars: market, rules });

describe('execução no preço de abertura', () => {
  it('compra ao preço de abertura de D, em ações inteiras, com o custo de 0,03% por cima', () => {
    // patrimônio 1.000.000 x 20% = 200.000; a R$ 23,00 cabem 86 ações (87 passariam de 200.000)
    const result = run(folio(1_000_000), [buy('AAA3', 20)], bars({ AAA3: bar(2300, 2400) }));
    expect(result.fills).toEqual([
      {
        date: D,
        itemIndex: 0,
        ticker: 'AAA3',
        action: 'BUY',
        quantity: 86n,
        priceCents: 2300n, // a abertura, nunca o fechamento
        notionalCents: 197_800n,
        costCents: 59n, // 59,34
        realizedCents: null,
      },
    ]);
    expect(result.orders).toEqual([
      {
        date: D,
        itemIndex: 0,
        ticker: 'AAA3',
        action: 'BUY',
        status: 'FILLED',
        reason: null,
        requestedQuantity: 86n,
        filledQuantity: 86n,
        priceCents: 2300n,
      },
    ]);
    expect(result.portfolio.cashCents).toBe(1_000_000n - 197_859n);
    expect(result.portfolio.positions.get('AAA3')).toEqual(pos(86, 197_859, 2300));
  });

  it('vende ao preço de abertura e o custo sai do valor recebido', () => {
    const result = run(
      folio(0, { AAA3: pos(86, 197_859, 2300) }),
      [sell('AAA3', 51)],
      bars({ AAA3: bar(2420, 2500) }),
    );
    // 51% de 86 = 43,86: só ações inteiras, 43. 43 x 24,20 = 104.060; custo 31,218 -> 31
    expect(result.fills[0]).toMatchObject({
      action: 'SELL',
      quantity: 43n,
      priceCents: 2420n,
      notionalCents: 104_060n,
      costCents: 31n,
    });
    expect(result.portfolio.cashCents).toBe(104_029n);
  });

  it('a venda parcial baixa o custo na proporção (custo médio) e informa o resultado realizado', () => {
    const result = run(
      folio(0, { AAA3: pos(86, 197_859, 2300) }),
      [sell('AAA3', 51)],
      bars({ AAA3: bar(2420, 2500) }),
    );
    // custo das 43 vendidas: 197.859 x 43 / 86 = 98.929,5 -> 98.930 (o meio sobe); sobram 98.929
    expect(result.portfolio.positions.get('AAA3')).toEqual(pos(43, 98_929, 2300));
    // resultado: 104.029 recebidos - 98.930 de custo
    expect(result.fills[0]?.realizedCents).toBe(5_099n);
  });

  it('a venda total tira a posição e leva o custo todo, sem resto', () => {
    const result = run(
      folio(590, { BBB4: pos(309, 395_619, 1280) }),
      [sell('BBB4', 100)],
      bars({ BBB4: bar(1280, 1400) }),
    );
    // 309 x 12,80 = 395.520; custo 118,656 -> 119; recebe 395.401; custo da posição 395.619: perda de 218
    expect(result.portfolio.positions.has('BBB4')).toBe(false);
    expect(result.portfolio.cashCents).toBe(590n + 395_401n);
    expect(result.fills[0]?.realizedCents).toBe(-218n);
  });

  it('o custo vem das regras da temporada: 0,10%, 10% e sem custo', () => {
    const start = folio(1_000_000);
    const market = bars({ AAA3: bar(2300, 2400) });
    // 86 ações a R$ 23,00 = 197.800; a 0,10% o custo é 197,8 -> 198
    const dear = run(start, [buy('AAA3', 20)], market, { tradeCostBps: 10n, maxPositions: 10 });
    expect(dear.fills[0]).toMatchObject({
      quantity: 86n,
      notionalCents: 197_800n,
      costCents: 198n,
    });
    expect(dear.portfolio.cashCents).toBe(1_000_000n - 197_800n - 198n);
    const free = run(start, [buy('AAA3', 20)], market, { tradeCostBps: 0n, maxPositions: 10 });
    expect(free.fills[0]?.costCents).toBe(0n);
    expect(free.portfolio.cashCents).toBe(1_000_000n - 197_800n);
    // custo alto também tira ação do que o caixa paga: 10.000 de caixa compram 19 ações a R$ 5,00 com 0,03% e 18 com 10%
    const poor = folio(10_000, { Z: pos(100, 100_000, 1000) });
    const small = bars({ Z: bar(1000), Q: bar(500) });
    expect(run(poor, [buy('Q', 25)], small).fills[0]?.quantity).toBe(19n);
    const tenPercent = { tradeCostBps: 1000n, maxPositions: 10 };
    expect(run(poor, [buy('Q', 25)], small, tenPercent).fills[0]?.quantity).toBe(18n);
  });

  it('percentual com casas decimais vale (15,5%)', () => {
    // 1.000.000 x 15,5% = 155.000; a R$ 25,00 são 62 ações; 155.000 x 0,0003 = 46,5 -> 47
    const result = run(folio(1_000_000), [buy('BBB4', 15.5)], bars({ BBB4: bar(2500, 2600) }));
    expect(result.fills[0]).toMatchObject({
      quantity: 62n,
      notionalCents: 155_000n,
      costCents: 47n,
    });
  });
});

describe('vendas antes das compras', () => {
  it('a venda libera o caixa da compra mesmo listada depois dela', () => {
    // caixa 590 não compra nada; a venda de BBB4 (395.401 líquidos) vem primeiro e paga a compra de CCC3
    const result = run(
      folio(590, { BBB4: pos(309, 395_619, 1280) }),
      [buy('CCC3', 25), sell('BBB4', 100)],
      bars({ BBB4: bar(1280, 1400), CCC3: bar(2480, 2550) }),
    );
    // patrimônio na abertura: 590 + 309 x 12,80 = 396.110; 25% = 99.027,5 -> 99.027; a R$ 24,80 são 39 ações
    expect(result.orders.map((o) => [o.itemIndex, o.action, o.status])).toEqual([
      [1, 'SELL', 'FILLED'],
      [0, 'BUY', 'FILLED'],
    ]);
    expect(result.fills.map((f) => [f.ticker, f.quantity])).toEqual([
      ['BBB4', 309n],
      ['CCC3', 39n],
    ]);
    // 590 + 395.401 - (39 x 24,80 = 96.720 + 29 de custo)
    expect(result.portfolio.cashCents).toBe(590n + 395_401n - 96_749n);
  });

  it('entre vendas e entre compras vale a ordem em que o modelo listou', () => {
    const market = bars({ A: bar(1000), B: bar(1000), C: bar(1000), D: bar(1000) });
    const result = run(
      folio(1_000_000, { A: pos(100, 100_000, 1000), B: pos(100, 100_000, 1000) }),
      [buy('C', 5), sell('B', 10), buy('D', 5), sell('A', 10)],
      market,
    );
    expect(result.orders.map((o) => o.ticker)).toEqual(['B', 'A', 'C', 'D']);
    expect(result.orders.map((o) => o.itemIndex)).toEqual([1, 3, 0, 2]);
  });

  it('o patrimônio do BUY é o da abertura de D, antes das vendas e não pelo fechamento de ontem', () => {
    // caixa 100.000 + P (100 ações; fechou ontem a 9,00 e abre a 10,00) = 200.000 na abertura; 25% = 50.000
    const result = run(
      folio(100_000, { P: pos(100, 90_000, 900) }),
      [sell('P', 100), buy('Q', 25)],
      bars({ P: bar(1000), Q: bar(500) }),
    );
    // pelo fechamento de ontem seria 190.000 (95 ações); pelo caixa depois da venda, 199.970 (99 ações)
    expect(result.fills.find((f) => f.ticker === 'Q')?.quantity).toBe(100n);
    // venda: 100.000 - 30 de custo = 99.970; compra: 50.000 + 15 de custo
    expect(result.portfolio.cashCents).toBe(100_000n + 99_970n - 50_015n);
  });
});

describe('sem alavancagem: a compra cabe no caixa', () => {
  it('se não couber, reduz a quantidade', () => {
    // patrimônio 10.000 + 100.000 = 110.000; 25% = 27.500 pediriam 55 ações a R$ 5,00, mas o caixa de 10.000 só paga 19
    const result = run(
      folio(10_000, { Z: pos(100, 100_000, 1000) }),
      [buy('Q', 25)],
      bars({ Z: bar(1000), Q: bar(500) }),
    );
    expect(result.orders[0]).toMatchObject({
      status: 'REDUCED',
      reason: null,
      requestedQuantity: 55n,
      filledQuantity: 19n,
    });
    // 19 x 5,00 = 9.500 e custo 2,85 -> 3: sobram 497 e o caixa nunca fica negativo
    expect(result.portfolio.cashCents).toBe(497n);
  });

  it('se der menos de 1 ação por falta de caixa, não executa e registra o motivo', () => {
    const result = run(
      folio(300, { Z: pos(100, 100_000, 1000) }),
      [buy('Q', 5)],
      bars({ Z: bar(1000), Q: bar(400) }),
    );
    expect(result.fills).toEqual([]);
    expect(result.orders[0]).toMatchObject({
      status: 'NOT_EXECUTED',
      reason: 'insufficient_cash',
      requestedQuantity: 12n, // 5% de 100.300 = 5.015: 12 ações a R$ 4,00
      filledQuantity: 0n,
      priceCents: 400n,
    });
    expect(result.portfolio.cashCents).toBe(300n);
  });

  it('se o percentual não paga nem 1 ação, não executa e registra o motivo', () => {
    // 5% de 1.000.000 = 50.000 e a ação custa R$ 4.000,00
    const result = run(folio(1_000_000), [buy('Q', 5)], bars({ Q: bar(400_000) }));
    expect(result.fills).toEqual([]);
    expect(result.orders[0]).toMatchObject({
      status: 'NOT_EXECUTED',
      reason: 'below_one_share',
      requestedQuantity: 0n,
    });
  });

  it('venda de menos de 1 ação não executa (a quantidade é sempre para baixo)', () => {
    const market = bars({ P: bar(1000) });
    const one = run(folio(0, { P: pos(3, 3000, 1000) }), [sell('P', 1)], market);
    expect(one.orders[0]).toMatchObject({ status: 'NOT_EXECUTED', reason: 'below_one_share' });
    const third = run(folio(0, { P: pos(3, 3000, 1000) }), [sell('P', 33)], market); // 0,99
    expect(third.orders[0]).toMatchObject({ status: 'NOT_EXECUTED', reason: 'below_one_share' });
    const half = run(folio(0, { P: pos(3, 3000, 1000) }), [sell('P', 34)], market); // 1,02
    expect(half.orders[0]).toMatchObject({ status: 'FILLED', filledQuantity: 1n });
  });

  it('o caixa nunca fica negativo, mesmo com várias compras de 25%', () => {
    const market = bars({ A: bar(1000), B: bar(1000), C: bar(1000), D: bar(1000), E: bar(1000) });
    const result = run(
      folio(1_000_000),
      [buy('A', 25), buy('B', 25), buy('C', 25), buy('D', 25), buy('E', 25)],
      market,
    );
    expect(result.portfolio.cashCents >= 0n).toBe(true);
    // cada uma pede 250 ações (250.000 + 75 de custo). As três primeiras passam e deixam 249.775; a quarta cabe só
    // em 249 ações (249.000 + 75) e sai reduzida; sobram 700, que não pagam nem 1 ação, e a quinta não executa
    expect(result.orders.map((o) => [o.status, o.filledQuantity])).toEqual([
      ['FILLED', 250n],
      ['FILLED', 250n],
      ['FILLED', 250n],
      ['REDUCED', 249n],
      ['NOT_EXECUTED', 0n],
    ]);
    expect(result.orders[4]?.reason).toBe('insufficient_cash');
    expect(result.portfolio.cashCents).toBe(700n);
  });
});

describe('até 10 posições', () => {
  const tens = (n: number): Record<string, Position> =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        `T${String(i).padStart(2, '0')}`,
        pos(10, 10_000, 1000),
      ]),
    );
  const market = bars({
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`T${String(i).padStart(2, '0')}`, bar(1000)]),
    ),
    N1: bar(1000),
    N2: bar(1000),
  });

  it('o limite vem das regras da temporada: com 2, a terceira ação nova não entra', () => {
    const two = { tradeCostBps: 3n, maxPositions: 2 };
    const start = folio(1_000_000, { T00: pos(10, 10_000, 1000), T01: pos(10, 10_000, 1000) });
    const refused = run(start, [buy('N1', 5)], market, two);
    expect(refused.orders[0]).toMatchObject({ status: 'NOT_EXECUTED', reason: 'max_positions' });
    // com o limite de 10 do plano a mesma ordem executa
    expect(run(start, [buy('N1', 5)], market).orders[0]?.status).toBe('FILLED');
    // e o limite de 2 deixa comprar mais de uma ação que já está na carteira
    expect(run(start, [buy('T01', 5)], market, two).orders[0]?.status).toBe('FILLED');
  });

  it('BUY de ação nova com 10 posições não executa', () => {
    const result = run(folio(1_000_000, tens(10)), [buy('N1', 5)], market);
    expect(result.fills).toEqual([]);
    expect(result.orders[0]).toMatchObject({ status: 'NOT_EXECUTED', reason: 'max_positions' });
    expect(result.portfolio.positions.size).toBe(10);
  });

  it('BUY de ação que já está na carteira executa mesmo com 10 posições', () => {
    const result = run(folio(1_000_000, tens(10)), [buy('T03', 5)], market);
    expect(result.orders[0]?.status).toBe('FILLED');
    expect(result.portfolio.positions.size).toBe(10);
    expect(result.portfolio.positions.get('T03')?.quantity).toBeGreaterThan(10n);
  });

  it('a venda total do pregão libera a vaga para a compra nova (vendas primeiro)', () => {
    const result = run(folio(1_000_000, tens(10)), [buy('N1', 5), sell('T00', 100)], market);
    expect(result.orders.map((o) => [o.ticker, o.status])).toEqual([
      ['T00', 'FILLED'],
      ['N1', 'FILLED'],
    ]);
    expect(result.portfolio.positions.has('T00')).toBe(false);
    expect(result.portfolio.positions.has('N1')).toBe(true);
    expect(result.portfolio.positions.size).toBe(10);
  });

  it('a venda parcial não libera vaga', () => {
    const result = run(folio(1_000_000, tens(10)), [buy('N1', 5), sell('T00', 50)], market);
    expect(result.orders.find((o) => o.ticker === 'N1')?.reason).toBe('max_positions');
  });

  it('com 9 posições, a primeira compra nova ocupa a 10ª vaga e a segunda não executa', () => {
    const result = run(folio(1_000_000, tens(9)), [buy('N1', 5), buy('N2', 5)], market);
    expect(result.orders.map((o) => [o.ticker, o.status, o.reason])).toEqual([
      ['N1', 'FILLED', null],
      ['N2', 'NOT_EXECUTED', 'max_positions'],
    ]);
    expect(result.portfolio.positions.size).toBe(10);
  });
});

describe('ação sem barra em D: nunca usa preço anterior', () => {
  it('a ordem não executa, fica registrada com o motivo e a posição segue marcada em ontem', () => {
    const start = folio(500_000, { P: pos(100, 250_000, 2500) }); // fechou ontem a R$ 25,00
    const result = run(start, [sell('P', 100), buy('P', 10)], bars({ OUTRA: bar(1000) }));
    expect(result.fills).toEqual([]);
    expect(result.orders.map((o) => [o.action, o.status, o.reason, o.priceCents])).toEqual([
      ['SELL', 'NOT_EXECUTED', 'no_bar', null],
      ['BUY', 'NOT_EXECUTED', 'no_bar', null],
    ]);
    expect(result.orders.map((o) => o.requestedQuantity)).toEqual([null, null]);
    expect(result.portfolio.cashCents).toBe(500_000n);
    expect(result.portfolio.positions.get('P')).toEqual(pos(100, 250_000, 2500));
  });

  it('o preço de D-1 não entra na execução de D: a ordem sai pela abertura de D', () => {
    // P fechou ontem a R$ 25,00 (mark) e abre hoje a R$ 10,00
    const result = run(
      folio(0, { P: pos(100, 250_000, 2500) }),
      [sell('P', 100)],
      bars({ P: bar(1000, 1100) }),
    );
    expect(result.fills[0]?.priceCents).toBe(1000n);
    expect(result.portfolio.cashCents).toBe(100_000n - 30n);
  });

  it('o patrimônio da abertura marca a posição sem barra pelo último fechamento conhecido', () => {
    const portfolio = folio(1_000, { P: pos(100, 80_000, 900), Q: pos(10, 4_000, 500) });
    // P sem barra em D: 100 x 9,00 (último fechamento); Q abre a 5,20: 10 x 5,20
    expect(equityAtOpen(portfolio, bars({ Q: bar(520, 530) }))).toBe(1_000n + 90_000n + 5_200n);
  });
});

describe('ordens que não fazem sentido', () => {
  it('venda de ação que não está na carteira não executa', () => {
    const result = run(folio(1_000_000), [sell('Z', 50)], bars({ Z: bar(1000) }));
    expect(result.orders[0]).toMatchObject({ status: 'NOT_EXECUTED', reason: 'no_position' });
    expect(result.fills).toEqual([]);
  });

  it('HOLD não vira ordem, mas ocupa o índice do item', () => {
    const result = run(
      folio(1_000_000, { D: pos(100, 100_000, 1000) }),
      [hold('A'), buy('B', 10), hold('C'), sell('D', 50)],
      bars({ A: bar(1000), B: bar(1000), C: bar(1000), D: bar(1000) }),
    );
    expect(result.orders.map((o) => [o.itemIndex, o.ticker])).toEqual([
      [3, 'D'],
      [1, 'B'],
    ]);
  });

  it('só HOLD (ou nenhuma decisão) deixa tudo como está', () => {
    const start = folio(1_000_000, { A: pos(10, 10_000, 1000) });
    for (const items of [[], [hold('A')]]) {
      const result = run(start, items, bars({ A: bar(1000) }));
      expect(result.orders).toEqual([]);
      expect(result.fills).toEqual([]);
      expect(result.portfolio.cashCents).toBe(1_000_000n);
      expect(result.portfolio.positions.get('A')).toEqual(pos(10, 10_000, 1000));
    }
  });

  it('ordens repetidas no mesmo ticker executam em sequência (quem filtra repetição é o validador)', () => {
    const result = run(folio(1_000_000), [buy('A', 10), buy('A', 10)], bars({ A: bar(1000) }));
    expect(result.fills.map((f) => f.quantity)).toEqual([100n, 100n]);
    expect(result.portfolio.positions.get('A')?.quantity).toBe(200n);
    expect(result.portfolio.positions.size).toBe(1);
  });

  it('o limite de 5 ordens e as faixas de percentual são a última barreira', () => {
    const market = bars({ A: bar(1000) });
    const six = Array.from({ length: 6 }, () => buy('A', 5));
    expect(() => run(folio(1_000_000), six, market)).toThrow(RangeError);
    // seis itens com HOLD no meio de cinco ordens passam
    expect(() => run(folio(1_000_000), [...six.slice(0, 5), hold('A')], market)).not.toThrow();
    for (const percent of [4.99, 25.01, 0, Number.NaN]) {
      expect(() => run(folio(1_000_000), [buy('A', percent)], market)).toThrow(RangeError);
    }
    for (const percent of [0.99, 100.01, 0, Number.NaN]) {
      expect(() =>
        run(folio(0, { A: pos(10, 10_000, 1000) }), [sell('A', percent)], market),
      ).toThrow(RangeError);
    }
    // as bordas valem
    expect(() => run(folio(1_000_000), [buy('A', 5)], market)).not.toThrow();
    expect(() => run(folio(1_000_000), [buy('A', 25)], market)).not.toThrow();
    expect(() => run(folio(0, { A: pos(10, 10_000, 1000) }), [sell('A', 1)], market)).not.toThrow();
    expect(() =>
      run(folio(0, { A: pos(10, 10_000, 1000) }), [sell('A', 100)], market),
    ).not.toThrow();
  });
});

describe('pureza', () => {
  it('não muda o estado de entrada nem a lista de itens', () => {
    const start = folio(1_000_000, { A: pos(100, 100_000, 1000) });
    const items = [sell('A', 50), buy('B', 10)];
    const before = structuredClone({ cash: start.cashCents, positions: [...start.positions] });
    const itemsBefore = structuredClone(items);
    const result = run(start, items, bars({ A: bar(1000), B: bar(500) }));
    expect({ cash: start.cashCents, positions: [...start.positions] }).toEqual(before);
    expect(items).toEqual(itemsBefore);
    expect(result.portfolio).not.toBe(start);
    expect(result.portfolio.positions).not.toBe(start.positions);
  });

  it('o mesmo estado e os mesmos itens dão sempre o mesmo resultado', () => {
    const start = folio(1_000_000, { A: pos(100, 100_000, 1000) });
    const items = [sell('A', 50), buy('B', 10)];
    const market = bars({ A: bar(1000), B: bar(500) });
    expect(run(start, items, market)).toEqual(run(start, items, market));
  });
});

describe('marcação no fechamento', () => {
  it('posição com barra vale o fechamento de D; sem barra, o último fechamento conhecido', () => {
    const portfolio = folio(1_000, {
      QQQ3: pos(10, 4_000, 500),
      PPP3: pos(100, 80_000, 900),
    });
    const marked = markToMarket(portfolio, bars({ QQQ3: bar(520, 530) }));
    expect(marked.positions).toEqual([
      // em ordem de ticker
      {
        ticker: 'PPP3',
        quantity: 100n,
        costCents: 80_000n,
        markCents: 900n,
        valueCents: 90_000n,
        stale: true,
      },
      {
        ticker: 'QQQ3',
        quantity: 10n,
        costCents: 4_000n,
        markCents: 530n,
        valueCents: 5_300n,
        stale: false,
      },
    ]);
    expect(marked.positionsValueCents).toBe(95_300n);
    expect(marked.equityCents).toBe(96_300n);
    // a marcação fica no estado: amanhã, sem barra, a posição segue no último fechamento conhecido
    expect(marked.portfolio.positions.get('QQQ3')?.markCents).toBe(530n);
    expect(marked.portfolio.positions.get('PPP3')?.markCents).toBe(900n);
  });

  it('carteira só de caixa vale o caixa', () => {
    const marked = markToMarket(folio(12_345), new Map());
    expect(marked).toMatchObject({ positionsValueCents: 0n, equityCents: 12_345n, positions: [] });
  });
});
