import { portfolioSchema, positionSchema, totalsSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { consolidate, type CloseRow, type LotRecord } from './positions.js';

// As posições consolidadas por ticker (plano §11, etapa 12; docs/API.md, seção 9): quantidade, custo total, preço médio (Σ custo ÷ Σ
// quantidade), último fechamento, valor de mercado (quantidade × fechamento) e P&L (valor − custo), em centavos exatos (bigint) e, o P&L
// sobre o custo, em pontos-base. O arredondamento só existe em dois lugares, e é o do domínio: o centavo mais próximo no preço médio e o
// ponto-base mais próximo no percentual, com o meio indo para longe do zero (settlement/domain/money.ts, `divRound`).
const lot = (ticker: string, quantity: number, costCents: number): LotRecord => ({
  id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  ticker,
  quantity,
  costCents: BigInt(costCents),
  boughtOn: null,
  createdAt: new Date('2026-11-03T12:00:00Z'),
  updatedAt: new Date('2026-11-03T12:00:00Z'),
});
const close = (ticker: string, closeCents: number, date = '2026-11-03'): CloseRow => ({
  ticker,
  date,
  closeCents: BigInt(closeCents),
});
const only = (result: ReturnType<typeof consolidate>) => result.positions[0]!;

describe('consolidate: uma posição', () => {
  it('um lançamento: custo, preço médio, valor de mercado e P&L (conferido à mão)', () => {
    // 100 ações por R$ 3.550,00 no total (R$ 35,50 cada); fecha a R$ 38,00: valor R$ 3.800,00, ganho R$ 250,00, 7,04% do custo
    const result = consolidate([lot('PETR4', 100, 355_000)], [close('PETR4', 3_800)]);
    expect(only(result)).toEqual({
      ticker: 'PETR4',
      quantity: 100,
      costCents: 355_000,
      avgPriceCents: 3_550,
      closeCents: 3_800,
      closeDate: '2026-11-03',
      valueCents: 380_000,
      pnlCents: 25_000,
      // 25.000 × 10.000 ÷ 355.000 = 704,22...: 704 pontos-base (7,04%)
      pnlBps: 704,
    });
    expect(result.totals).toEqual({
      costCents: 355_000,
      pricedCostCents: 355_000,
      valueCents: 380_000,
      pnlCents: 25_000,
      pnlBps: 704,
      unpriced: 0,
    });
  });

  it('vários lançamentos do mesmo ticker somam: o preço médio é Σ custo ÷ Σ quantidade, e não a média dos preços', () => {
    // 100 ações a R$ 35,50 (R$ 3.550,00) e 50 a R$ 40,00 (R$ 2.000,01 no total): 150 ações, custo R$ 5.550,01
    const result = consolidate(
      [lot('PETR4', 100, 355_000), lot('PETR4', 50, 200_001)],
      [close('PETR4', 3_800)],
    );
    expect(result.positions).toHaveLength(1);
    expect(only(result)).toMatchObject({
      quantity: 150,
      costCents: 555_001,
      // 555.001 ÷ 150 = 3.700,0066...: R$ 37,00
      avgPriceCents: 3_700,
      valueCents: 570_000,
      // R$ 5.700,00 − R$ 5.550,01 = R$ 149,99
      pnlCents: 14_999,
      // 14.999 × 10.000 ÷ 555.001 = 270,25...
      pnlBps: 270,
    });
  });

  it('o preço médio arredonda para o centavo mais próximo, com o meio indo para cima', () => {
    const avg = (quantity: number, cost: number) =>
      only(consolidate([lot('PETR4', quantity, cost)], [])).avgPriceCents;
    expect(avg(2, 5)).toBe(3); // 2,5 -> 3
    expect(avg(2, 7)).toBe(4); // 3,5 -> 4
    expect(avg(3, 10)).toBe(3); // 3,33 -> 3
    expect(avg(3, 11)).toBe(4); // 3,67 -> 4
    expect(avg(3, 1)).toBe(0); // 0,33 -> 0 (um centavo dividido em 3 ações)
    expect(avg(7, 1_000_000)).toBe(142_857); // 142.857,14
  });

  it('o P&L percentual arredonda para o ponto-base mais próximo, com o meio indo para longe do zero (ganho e perda)', () => {
    // custo R$ 0,32: o ganho de 1 centavo é 312,5 pontos-base
    expect(only(consolidate([lot('PETR4', 1, 32)], [close('PETR4', 33)])).pnlBps).toBe(313);
    expect(only(consolidate([lot('PETR4', 1, 32)], [close('PETR4', 31)])).pnlBps).toBe(-313);
    // exatos: -5% e +10%
    expect(only(consolidate([lot('PETR4', 1, 1_000)], [close('PETR4', 950)])).pnlBps).toBe(-500);
    expect(only(consolidate([lot('PETR4', 1, 1_000)], [close('PETR4', 1_100)])).pnlBps).toBe(1_000);
    // sem ganho nem perda: zero, e não nulo
    expect(only(consolidate([lot('PETR4', 1, 1_000)], [close('PETR4', 1_000)]))).toMatchObject({
      pnlCents: 0,
      pnlBps: 0,
    });
  });

  it('o P&L em centavos é exato (sem arredondar), também com perda', () => {
    const result = consolidate([lot('PETR4', 3, 9_999)], [close('PETR4', 3_000)]);
    expect(only(result)).toMatchObject({ valueCents: 9_000, pnlCents: -999, pnlBps: -999 });
  });

  it('fechamento zero (a barra do banco aceita) vale: o valor é zero e a perda é o custo todo', () => {
    const result = consolidate([lot('PETR4', 10, 5_000)], [close('PETR4', 0)]);
    expect(only(result)).toMatchObject({
      closeCents: 0,
      valueCents: 0,
      pnlCents: -5_000,
      pnlBps: -10_000,
    });
  });
});

describe('consolidate: sem fechamento', () => {
  it('o ticker sem barra tem fechamento, data, valor e P&L nulos, e o custo e o preço médio continuam', () => {
    const result = consolidate([lot('ITUB4', 10, 3_000)], []);
    expect(only(result)).toEqual({
      ticker: 'ITUB4',
      quantity: 10,
      costCents: 3_000,
      avgPriceCents: 300,
      closeCents: null,
      closeDate: null,
      valueCents: null,
      pnlCents: null,
      pnlBps: null,
    });
    expect(result.totals).toEqual({
      costCents: 3_000,
      pricedCostCents: 0,
      valueCents: null,
      pnlCents: null,
      pnlBps: null,
      unpriced: 1,
    });
  });

  it('os totais de valor e P&L só contam as posições com fechamento, e dizem quantas ficaram de fora', () => {
    const result = consolidate(
      [lot('PETR4', 100, 355_000), lot('ITUB4', 10, 3_000), lot('VALE3', 5, 40_000)],
      [close('PETR4', 3_800), close('VALE3', 7_000)],
    );
    expect(result.positions.map((p) => p.ticker)).toEqual(['ITUB4', 'PETR4', 'VALE3']);
    expect(result.totals).toEqual({
      // o custo de TODOS os lançamentos
      costCents: 398_000,
      // o das posições com fechamento: PETR4 e VALE3
      pricedCostCents: 395_000,
      valueCents: 380_000 + 35_000,
      pnlCents: 380_000 + 35_000 - 395_000,
      // 20.000 × 10.000 ÷ 395.000 = 506,3...
      pnlBps: 506,
      unpriced: 1,
    });
  });

  it('o fechamento de um ticker que ninguém tem é ignorado', () => {
    const result = consolidate(
      [lot('PETR4', 1, 100)],
      [close('VALE3', 9_999), close('PETR4', 200)],
    );
    expect(result.positions.map((p) => p.ticker)).toEqual(['PETR4']);
    expect(only(result).closeCents).toBe(200);
  });

  it('cada ticker usa a data do próprio fechamento (um papel parado tem data mais antiga)', () => {
    const result = consolidate(
      [lot('PETR4', 1, 100), lot('VALE3', 1, 100)],
      [close('PETR4', 110, '2026-11-03'), close('VALE3', 90, '2026-10-20')],
    );
    expect(result.positions.map((p) => p.closeDate)).toEqual(['2026-11-03', '2026-10-20']);
  });
});

describe('consolidate: a carteira inteira', () => {
  it('sem lançamentos: nada, e o custo zero', () => {
    expect(consolidate([], [])).toEqual({
      positions: [],
      totals: {
        costCents: 0,
        pricedCostCents: 0,
        valueCents: null,
        pnlCents: null,
        pnlBps: null,
        unpriced: 0,
      },
    });
  });

  it('as posições saem em ordem alfabética de ticker, qualquer que seja a ordem dos lançamentos', () => {
    const result = consolidate(
      [lot('VALE3', 1, 1), lot('B3SA3', 1, 1), lot('PETR4', 1, 1), lot('ABEV3', 1, 1)],
      [],
    );
    expect(result.positions.map((p) => p.ticker)).toEqual(['ABEV3', 'B3SA3', 'PETR4', 'VALE3']);
  });

  // O pior caso: 200 lançamentos no teto de ações e de custo, do mesmo papel, e o fechamento mais alto que ainda cabe em inteiro seguro.
  it('o pior caso (200 lançamentos no teto) cabe em inteiro seguro e sai exato', () => {
    const lots = Array.from({ length: 200 }, () => lot('PETR4', 1_000_000, 100_000_000_000));
    const result = consolidate(lots, [close('PETR4', 45_000_000)]);
    expect(only(result)).toMatchObject({
      quantity: 200_000_000,
      costCents: 20_000_000_000_000,
      avgPriceCents: 100_000,
      // 2 × 10^8 ações a R$ 450.000,00 = 9 × 10^15 centavos (inteiro seguro vai a 9,007 × 10^15)
      valueCents: 9_000_000_000_000_000,
      pnlCents: 9_000_000_000_000_000 - 20_000_000_000_000,
    });
    expect(Number.isSafeInteger(only(result).valueCents!)).toBe(true);
    expect(Number.isSafeInteger(result.totals.costCents)).toBe(true);
  });

  // Uma barra ruim (o `daily_bar` só exige close_cents >= 0, sem teto) não pode derrubar o GET com um 500, que cairia em todo detentor do
  // ticker: acima de R$ 450.000,00 (PORTFOLIO_LIMITS.maxCloseCents) o fechamento não é cotação, e a posição sai "sem fechamento", como a sem barra.
  it('um fechamento acima do teto (R$ 450.000,00) deixa a posição sem fechamento, em vez de estourar o inteiro seguro', () => {
    const lots = Array.from({ length: 200 }, () => lot('PETR4', 1_000_000, 100_000_000_000));
    for (const absurd of [45_000_001, 50_000_000, 10 ** 15, Number.MAX_SAFE_INTEGER]) {
      const result = consolidate(lots, [close('PETR4', absurd)]);
      expect(only(result), String(absurd)).toEqual({
        ticker: 'PETR4',
        quantity: 200_000_000,
        costCents: 20_000_000_000_000,
        avgPriceCents: 100_000,
        closeCents: null,
        closeDate: null,
        valueCents: null,
        pnlCents: null,
        pnlBps: null,
      });
      expect(result.totals, String(absurd)).toEqual({
        costCents: 20_000_000_000_000,
        pricedCostCents: 0,
        valueCents: null,
        pnlCents: null,
        pnlBps: null,
        unpriced: 1,
      });
    }
  });

  it('a barra absurda de um ticker não leva o resto da carteira junto: as outras posições seguem com fechamento', () => {
    const result = consolidate(
      [lot('PETR4', 100, 355_000), lot('VALE3', 5, 40_000)],
      [close('PETR4', 3_800), close('VALE3', 10 ** 15)],
    );
    expect(result.positions.map((p) => [p.ticker, p.closeCents])).toEqual([
      ['PETR4', 3_800],
      ['VALE3', null],
    ]);
    expect(result.totals).toMatchObject({
      costCents: 395_000,
      pricedCostCents: 355_000,
      valueCents: 380_000,
      pnlCents: 25_000,
      unpriced: 1,
    });
  });

  it('o fechamento exatamente no teto vale, e um centavo acima não', () => {
    const lots = [lot('PETR4', 1, 100)];
    expect(only(consolidate(lots, [close('PETR4', 45_000_000)]))).toMatchObject({
      closeCents: 45_000_000,
      valueCents: 45_000_000,
    });
    expect(only(consolidate(lots, [close('PETR4', 45_000_001)])).closeCents).toBeNull();
  });

  // O percentual (P&L × 10.000 ÷ custo) sai do inteiro seguro muito antes do valor: com o menor custo que o banco aceita (1 centavo por
  // 1.000.000 de ações) a partir de um fechamento de uns R$ 9.007 por ação. O resto da posição continua, e só o percentual sai nulo.
  it('o percentual que passa do inteiro seguro sai nulo, e o valor e o P&L em centavos continuam exatos', () => {
    // 1.000.000 de ações por R$ 0,01 no total; fecha a R$ 10.000,00: valor 10^12 centavos, P&L 10^12 − 1, e o percentual passaria de 10^16
    const result = consolidate([lot('PETR4', 1_000_000, 1)], [close('PETR4', 1_000_000)]);
    expect(only(result)).toEqual({
      ticker: 'PETR4',
      quantity: 1_000_000,
      costCents: 1,
      avgPriceCents: 0,
      closeCents: 1_000_000,
      closeDate: '2026-11-03',
      valueCents: 1_000_000_000_000,
      pnlCents: 999_999_999_999,
      pnlBps: null,
    });
    expect(result.totals).toEqual({
      costCents: 1,
      pricedCostCents: 1,
      valueCents: 1_000_000_000_000,
      pnlCents: 999_999_999_999,
      pnlBps: null,
      unpriced: 0,
    });
    // o contrato aceita o percentual nulo com fechamento
    expect(positionSchema.safeParse(only(result)).success).toBe(true);
    expect(totalsSchema.safeParse(result.totals).success).toBe(true);
  });

  it('a fronteira do percentual é o inteiro seguro: R$ 9.000,00 por ação passa, R$ 9.008,00 não', () => {
    const lots = [lot('PETR4', 1_000_000, 1)];
    // P&L = 10^6 ações × 900.000 centavos − 1 = 899.999.999.999; × 10.000 = 8.999.999.999.990.000, abaixo de 2^53 − 1
    expect(only(consolidate(lots, [close('PETR4', 900_000)])).pnlBps).toBe(8_999_999_999_990_000);
    // P&L = 900.799.999.999; × 10.000 = 9.007.999.999.990.000, acima de 2^53 − 1 (9.007.199.254.740.991)
    expect(only(consolidate(lots, [close('PETR4', 900_800)])).pnlBps).toBeNull();
  });

  it('o percentual nulo de uma posição não anula o do total, quando o total cabe', () => {
    const result = consolidate(
      [lot('PETR4', 1_000_000, 1), lot('VALE3', 1_000, 100_000_000_000)],
      [close('PETR4', 1_000_000), close('VALE3', 45_000_000)],
    );
    expect(result.positions.map((p) => p.pnlBps)).toEqual([null, -5_500]);
    // P&L total = (10^12 + 4,5 × 10^10) − (10^11 + 1) = 944.999.999.999; sobre o custo de 100.000.000.001: 94.500 pontos-base
    expect(result.totals).toMatchObject({ pnlCents: 944_999_999_999, pnlBps: 94_500 });
  });

  it('a resposta passa pelo contrato estrito da API', () => {
    const lots = [lot('PETR4', 100, 355_000), lot('ITUB4', 10, 3_000)];
    const { positions, totals } = consolidate(lots, [close('PETR4', 3_800)]);
    expect(
      portfolioSchema.safeParse({
        lots: lots.map((l) => ({
          id: l.id,
          ticker: l.ticker,
          quantity: l.quantity,
          costCents: Number(l.costCents),
          boughtOn: null,
          createdAt: l.createdAt.toISOString(),
          updatedAt: l.updatedAt.toISOString(),
        })),
        positions,
        totals,
      }).success,
    ).toBe(true);
  });
});

// Gerador pseudoaleatório com semente (mulberry32): o teste sorteia 3 mil carteiras e, se falhar, falha do mesmo jeito de novo.
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

describe('consolidate: propriedades (carteiras sorteadas contra um oráculo em bigint)', () => {
  it('a soma, o valor e o P&L batem com um laço simples, e o arredondamento nunca passa de meio centavo nem de meio ponto-base', () => {
    const next = seeded(20261103);
    const pick = (n: number) => Math.floor(next() * n);
    const TICKERS = ['ABEV3', 'B3SA3', 'ITUB4', 'PETR4', 'VALE3', 'WEGE3'];
    let priced = 0;
    let unpriced = 0;
    let nulls = 0;
    // O percentual (P&L × 10.000 ÷ custo, no ponto-base mais próximo): sai nulo exatamente quando passa de 2^53 − 1 (o oráculo compara 2 × P&L
    // × 10.000 com custo × (2 × (2^53 − 1) + 1), sem dividir), e senão fica a menos de meio ponto-base (2 × |bps × custo − P&L × 10.000| ≤ custo).
    const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
    const checkBps = (got: number | null, pnl: bigint, positionCost: bigint, label: string) => {
      const overflows = (pnl < 0n ? -pnl : pnl) * 20_000n >= positionCost * (2n * SAFE + 1n);
      if (got === null) {
        nulls += 1;
        expect(overflows, `${label}: P&L % nulo só quando passa do inteiro seguro`).toBe(true);
        return;
      }
      expect(overflows, `${label}: P&L % fora do inteiro seguro tinha de ser nulo`).toBe(false);
      const gap = BigInt(got) * positionCost - pnl * 10_000n;
      expect((gap < 0n ? -gap : gap) * 2n, `${label}: P&L %`).toBeLessThanOrEqual(positionCost);
    };
    for (let round = 0; round < 3_000; round += 1) {
      const lots = Array.from({ length: pick(31) }, () =>
        lot(
          TICKERS[pick(TICKERS.length)]!,
          1 + pick(10 ** (1 + pick(6))),
          1 + pick(10 ** (1 + pick(9))),
        ),
      );
      const closes = TICKERS.filter(() => next() < 0.7).map((ticker) =>
        close(ticker, pick(10 ** (1 + pick(6)))),
      );
      const { positions, totals } = consolidate(lots, closes);

      // o oráculo: um laço por ticker, em ordem alfabética, sem Map nem ordenação do código testado
      let cost = 0n;
      let pricedCost = 0n;
      let value = 0n;
      let pricedCount = 0;
      const expected = TICKERS.flatMap((ticker) => {
        const mine = lots.filter((l) => l.ticker === ticker);
        if (mine.length === 0) return [];
        const quantity = mine.reduce((sum, l) => sum + BigInt(l.quantity), 0n);
        const positionCost = mine.reduce((sum, l) => sum + l.costCents, 0n);
        cost += positionCost;
        const found = closes.find((c) => c.ticker === ticker);
        if (found) {
          pricedCost += positionCost;
          value += quantity * found.closeCents;
          pricedCount += 1;
        }
        return [{ ticker, quantity, positionCost, close: found }];
      });

      expect(positions.map((p) => p.ticker)).toEqual(expected.map((e) => e.ticker));
      for (const [index, want] of expected.entries()) {
        const got = positions[index]!;
        expect(BigInt(got.quantity), want.ticker).toBe(want.quantity);
        expect(BigInt(got.costCents), want.ticker).toBe(want.positionCost);
        // o preço médio: a menos de meio centavo por ação (2 × |médio × quantidade − custo| ≤ quantidade)
        const gap = BigInt(got.avgPriceCents) * want.quantity - want.positionCost;
        expect((gap < 0n ? -gap : gap) * 2n, `${want.ticker}: preço médio`).toBeLessThanOrEqual(
          want.quantity,
        );
        if (!want.close) {
          unpriced += 1;
          expect(got.valueCents, want.ticker).toBeNull();
          expect(got.pnlCents, want.ticker).toBeNull();
          continue;
        }
        priced += 1;
        const wantValue = want.quantity * want.close.closeCents;
        const wantPnl = wantValue - want.positionCost;
        expect(BigInt(got.valueCents!), want.ticker).toBe(wantValue);
        expect(BigInt(got.pnlCents!), want.ticker).toBe(wantPnl);
        checkBps(got.pnlBps, wantPnl, want.positionCost, want.ticker);
      }
      expect(BigInt(totals.costCents)).toBe(cost);
      expect(BigInt(totals.pricedCostCents)).toBe(pricedCost);
      expect(totals.unpriced).toBe(expected.length - pricedCount);
      if (pricedCount === 0) {
        expect([totals.valueCents, totals.pnlCents, totals.pnlBps]).toEqual([null, null, null]);
      } else {
        expect(BigInt(totals.valueCents!)).toBe(value);
        expect(BigInt(totals.pnlCents!)).toBe(value - pricedCost);
        checkBps(totals.pnlBps, value - pricedCost, pricedCost, 'total');
      }
    }
    // a amostra tem posições com e sem fechamento (senão o teste passaria à toa)
    expect(priced).toBeGreaterThan(3_000);
    expect(unpriced).toBeGreaterThan(1_000);

    // O sorteio acima quase nunca chega ao percentual fora do inteiro seguro (pede custo de 1 centavo sobre uns R$ 9.000 por ação). Estas
    // rodadas ficam em volta da fronteira de propósito: 1 lançamento de ~10^6 ações por 1 centavo, fechamento entre R$ 8.000 e R$ 10.000.
    nulls = 0;
    let inside = 0;
    for (let round = 0; round < 500; round += 1) {
      const quantity = 999_000 + pick(1_001);
      const closeCents = 800_000 + pick(200_001);
      const [position] = consolidate(
        [lot('PETR4', quantity, 1)],
        [close('PETR4', closeCents)],
      ).positions;
      const pnl = BigInt(quantity) * BigInt(closeCents) - 1n;
      expect(BigInt(position!.pnlCents!)).toBe(pnl);
      checkBps(position!.pnlBps, pnl, 1n, `fronteira ${quantity} × ${closeCents}`);
      if (position!.pnlBps !== null) inside += 1;
    }
    expect(nulls).toBeGreaterThan(100);
    expect(inside).toBeGreaterThan(100);
  });
});
