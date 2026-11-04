import { describe, expect, it } from 'vitest';
import { PORTFOLIO_LIMITS } from './portfolio-rules.js';
import {
  lotBodySchema,
  lotIdParamSchema,
  lotSchema,
  portfolioSchema,
  positionSchema,
  totalsSchema,
} from './portfolio.js';

// Os contratos da carteira (etapa 12; docs/API.md, seção 9). Estritos de propósito, como os da conta: campo a mais é 400 na entrada, e o que
// não está aqui não sai.
const id = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const ok = {
  ticker: 'PETR4',
  quantity: 100,
  mode: 'unit',
  valueCents: 3_550,
  boughtOn: '2026-10-15',
};

describe('lotBodySchema (o corpo do POST e do PATCH)', () => {
  it('modo "por ação": o custo total é quantidade × preço', () => {
    expect(lotBodySchema.parse(ok)).toEqual({
      ticker: 'PETR4',
      quantity: 100,
      costCents: 355_000,
      boughtOn: '2026-10-15',
    });
  });

  it('modo "total pago": o custo total é o próprio valor, e os dois modos dão o mesmo lançamento para os mesmos números', () => {
    const total = lotBodySchema.parse({ ...ok, mode: 'total', valueCents: 355_000 });
    expect(total).toEqual(lotBodySchema.parse(ok));
  });

  it('o ticker vira maiúsculo (o site aceita "petr4"), e a data é opcional (nula quando falta)', () => {
    const { boughtOn: _omitted, ...withoutDate } = ok;
    expect(lotBodySchema.parse({ ...withoutDate, ticker: 'petr4' })).toMatchObject({
      ticker: 'PETR4',
      boughtOn: null,
    });
    expect(lotBodySchema.parse({ ...ok, boughtOn: null }).boughtOn).toBeNull();
  });

  it('é estrito: campo a mais é recusado, e nenhum campo de dono entra (o dono é a sessão)', () => {
    for (const extra of [
      { userId: id },
      { portfolioId: id },
      { id },
      { costCents: 355_000 },
      { createdAt: '2026-10-15T00:00:00.000Z' },
      { extra: 1 },
    ]) {
      expect(lotBodySchema.safeParse({ ...ok, ...extra }).success, JSON.stringify(extra)).toBe(
        false,
      );
    }
  });

  it.each([
    ['sem ticker', { ticker: undefined }],
    ['ticker vazio', { ticker: '' }],
    ['ticker com lixo', { ticker: 'PETR4; DROP TABLE' }],
    ['ticker curto', { ticker: 'AB1' }],
    ['ticker longo', { ticker: 'ABCDEFGHIJKLM4' }],
    ['ticker sem número', { ticker: 'PETRX' }],
    ['ticker que não é texto', { ticker: 4 }],
    ['quantidade zero', { quantity: 0 }],
    ['quantidade negativa', { quantity: -10 }],
    ['quantidade fracionada', { quantity: 1.5 }],
    ['quantidade acima do teto', { quantity: PORTFOLIO_LIMITS.maxQuantity + 1 }],
    ['quantidade em texto', { quantity: '100' }],
    ['quantidade NaN', { quantity: Number.NaN }],
    ['valor zero', { valueCents: 0 }],
    ['valor negativo', { valueCents: -1 }],
    ['valor fracionado', { valueCents: 35.5 }],
    ['valor em texto', { valueCents: '3550' }],
    ['valor acima do teto', { valueCents: PORTFOLIO_LIMITS.maxCostCents + 1 }],
    ['valor que perde precisão', { valueCents: 2 ** 53 }],
    ['modo desconhecido', { mode: 'both' }],
    ['sem o modo', { mode: undefined }],
    ['modo em maiúsculo', { mode: 'UNIT' }],
    ['data com hora', { boughtOn: '2026-10-15T10:00:00.000Z' }],
    ['data que não existe', { boughtOn: '2026-02-30' }],
    ['data do ano zero (o Postgres não tem)', { boughtOn: '0000-01-01' }],
    ['data antes do piso', { boughtOn: '1899-12-31' }],
    ['data em formato brasileiro', { boughtOn: '15/10/2026' }],
    ['data sem zeros', { boughtOn: '2026-1-5' }],
    ['data em texto vazio', { boughtOn: '' }],
  ])('recusa %s', (_what, change) => {
    const body = { ...ok, ...change };
    expect(lotBodySchema.safeParse(body).success).toBe(false);
  });

  it('no modo "por ação", o custo total acima do teto é recusado no campo do valor (os dois números estão dentro do teto sozinhos)', () => {
    const result = lotBodySchema.safeParse({
      ...ok,
      quantity: PORTFOLIO_LIMITS.maxQuantity,
      valueCents: 100_001,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['valueCents']]);
    // no limite exato passa; o mesmo número no modo "total" também
    expect(
      lotBodySchema.safeParse({
        ...ok,
        quantity: PORTFOLIO_LIMITS.maxQuantity,
        valueCents: 100_000,
      }).success,
    ).toBe(true);
    expect(
      lotBodySchema.safeParse({ ...ok, mode: 'total', valueCents: PORTFOLIO_LIMITS.maxCostCents })
        .success,
    ).toBe(true);
  });

  it('nenhuma mensagem de erro repete o que o cliente mandou', () => {
    const canary = 'SEGREDO-DO-CLIENTE-98765';
    const result = lotBodySchema.safeParse({ ...ok, ticker: canary, boughtOn: canary });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(canary);
  });

  it('só aceita objeto', () => {
    for (const body of [null, undefined, 'texto', 1, [], [ok]]) {
      expect(lotBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('lotIdParamSchema (o :id da rota)', () => {
  it('é um ULID', () => {
    expect(lotIdParamSchema.safeParse(id).success).toBe(true);
    for (const bad of ['', 'abc', id.toLowerCase(), `${id}x`, "1' OR '1'='1", '../me']) {
      expect(lotIdParamSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

const lot = {
  id,
  ticker: 'PETR4',
  quantity: 100,
  costCents: 355_000,
  boughtOn: '2026-10-15',
  createdAt: '2026-11-03T12:00:00.000Z',
  updatedAt: '2026-11-03T12:00:00.000Z',
};
const position = {
  ticker: 'PETR4',
  quantity: 100,
  costCents: 355_000,
  avgPriceCents: 3_550,
  closeCents: 3_800,
  closeDate: '2026-11-03',
  valueCents: 380_000,
  pnlCents: 25_000,
  pnlBps: 704,
};
const totals = {
  costCents: 355_000,
  pricedCostCents: 355_000,
  valueCents: 380_000,
  pnlCents: 25_000,
  pnlBps: 704,
  unpriced: 0,
};

describe('lotSchema, positionSchema, totalsSchema e portfolioSchema (a resposta)', () => {
  it('aceitam a resposta bem formada', () => {
    expect(lotSchema.safeParse(lot).success).toBe(true);
    expect(positionSchema.safeParse(position).success).toBe(true);
    expect(totalsSchema.safeParse(totals).success).toBe(true);
    expect(portfolioSchema.safeParse({ lots: [lot], positions: [position], totals }).success).toBe(
      true,
    );
    expect(
      portfolioSchema.safeParse({
        lots: [],
        positions: [],
        totals: {
          ...totals,
          costCents: 0,
          pricedCostCents: 0,
          valueCents: null,
          pnlCents: null,
          pnlBps: null,
        },
      }).success,
    ).toBe(true);
  });

  // A posição ou tem fechamento (data, valor e P&L são números) ou não tem (os cinco nulos). O percentual é a exceção: com fechamento ele
  // ainda pode ser nulo, quando passa do inteiro seguro (custo de centavos sobre valor alto). Um estado misturado é resposta ilegal.
  it('a posição sem fechamento tem tudo que depende dele nulo, e só isso', () => {
    const unpriced = {
      ...position,
      closeCents: null,
      closeDate: null,
      valueCents: null,
      pnlCents: null,
      pnlBps: null,
    };
    expect(positionSchema.safeParse(unpriced).success).toBe(true);
    // com fechamento, o percentual pode faltar, mas o valor e o P&L não
    expect(positionSchema.safeParse({ ...position, pnlBps: null }).success).toBe(true);
    // estados misturados não passam: um dos quatro nulo e os outros não, ou o percentual sem fechamento
    for (const mixed of [
      { closeCents: null },
      { closeDate: null },
      { valueCents: null },
      { pnlCents: null },
      { ...unpriced, closeCents: 3_800 },
      { ...unpriced, closeDate: '2026-11-03' },
      { ...unpriced, valueCents: 380_000 },
      { ...unpriced, pnlCents: 25_000 },
      { ...unpriced, pnlBps: 704 },
    ]) {
      expect(
        positionSchema.safeParse({ ...position, ...mixed }).success,
        JSON.stringify(mixed),
      ).toBe(false);
    }
  });

  it('os totais: valor e P&L vêm juntos (ou ambos nulos), e o percentual não existe sem eles', () => {
    expect(totalsSchema.safeParse({ ...totals, pnlBps: null }).success).toBe(true);
    for (const mixed of [
      { valueCents: null },
      { pnlCents: null },
      // o percentual sem valor nem P&L
      { valueCents: null, pnlCents: null },
    ]) {
      expect(totalsSchema.safeParse({ ...totals, ...mixed }).success, JSON.stringify(mixed)).toBe(
        false,
      );
    }
    expect(
      totalsSchema.safeParse({
        ...totals,
        valueCents: null,
        pnlCents: null,
        pnlBps: null,
        unpriced: 1,
      }).success,
    ).toBe(true);
  });

  it('o P&L pode ser negativo; dinheiro que perde precisão e campo a mais não passam', () => {
    expect(positionSchema.safeParse({ ...position, pnlCents: -25_000, pnlBps: -704 }).success).toBe(
      true,
    );
    expect(lotSchema.safeParse({ ...lot, costCents: 2 ** 53 }).success).toBe(false);
    expect(lotSchema.safeParse({ ...lot, costCents: 1.5 }).success).toBe(false);
    expect(lotSchema.safeParse({ ...lot, userId: id }).success).toBe(false);
    expect(lotSchema.safeParse({ ...lot, portfolioId: id }).success).toBe(false);
    expect(positionSchema.safeParse({ ...position, name: 'Petrobras' }).success).toBe(false);
    expect(totalsSchema.safeParse({ ...totals, extra: 1 }).success).toBe(false);
    expect(portfolioSchema.safeParse({ lots: [], positions: [], totals, userId: id }).success).toBe(
      false,
    );
  });

  it('a carteira não passa de 200 lançamentos', () => {
    const many = Array.from({ length: PORTFOLIO_LIMITS.maxLots + 1 }, () => lot);
    expect(portfolioSchema.safeParse({ lots: many, positions: [], totals }).success).toBe(false);
    expect(portfolioSchema.safeParse({ lots: many.slice(1), positions: [], totals }).success).toBe(
      true,
    );
  });
});
