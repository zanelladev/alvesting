import { describe, expect, it } from 'vitest';
import { anomalousOpenings, type Opening } from './opening-anomaly.js';

// O fechamento anterior é 3.000 centavos: os limites são 9.000 (3 vezes) e 1.000 (1/3), e os dois são estritos.
const opening = (openCents: bigint, overrides: Partial<Opening> = {}): Opening => ({
  ticker: 'RAIZ4',
  date: '2026-11-03',
  openCents,
  previousCloseCents: 3_000n,
  exEvent: false,
  ...overrides,
});
const flagged = (openCents: bigint, overrides: Partial<Opening> = {}) =>
  anomalousOpenings([opening(openCents, overrides)]).length === 1;

describe('anomalousOpenings', () => {
  it('3 vezes: só acima dispara; 3 vezes em ponto e logo abaixo, não', () => {
    expect(flagged(9_001n)).toBe(true);
    expect(flagged(9_000n)).toBe(false);
    expect(flagged(8_999n)).toBe(false);
  });

  it('1/3: só abaixo dispara; 1/3 em ponto e logo acima, não', () => {
    expect(flagged(999n)).toBe(true);
    expect(flagged(1_000n)).toBe(false);
    expect(flagged(1_001n)).toBe(false);
  });

  it('o circuit breaker de 26/10 (abertura perto da metade) não dispara', () => {
    expect(flagged(1_500n)).toBe(false);
  });

  it('com evento corporativo do papel com data ex no dia, não dispara', () => {
    expect(flagged(300_000n, { exEvent: true })).toBe(false);
    expect(flagged(750n, { exEvent: true })).toBe(false);
  });

  it('sem fechamento anterior (a primeira barra do papel), não dispara', () => {
    expect(flagged(300_000n, { previousCloseCents: null })).toBe(false);
  });

  it('devolve o papel, a data e a razão com 3 algarismos significativos, sem preço', () => {
    // o RAIZ4: o preço do lote de 100 contra o preço por ação do pregão anterior
    expect(anomalousOpenings([opening(299_700n), opening(9_001n), opening(750n)])).toEqual([
      { ticker: 'RAIZ4', date: '2026-11-03', ratio: 99.9 },
      { ticker: 'RAIZ4', date: '2026-11-03', ratio: 3 },
      { ticker: 'RAIZ4', date: '2026-11-03', ratio: 0.25 },
    ]);
    expect(anomalousOpenings([opening(3n, { previousCloseCents: 3_000_000n })])).toEqual([
      { ticker: 'RAIZ4', date: '2026-11-03', ratio: 0.000001 },
    ]);
  });
});
