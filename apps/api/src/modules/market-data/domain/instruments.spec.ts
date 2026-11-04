import { describe, expect, it } from 'vitest';
import { REFERENCE_SEED, REFERENCE_TICKER, REFERENCE_TICKERS, seedOf } from './instruments.js';

describe('seedOf: uma linha da lista da brapi vira o papel a semear', () => {
  it.each([
    ['PETR4', 'PN'],
    ['VALE3', 'ON'],
    ['B3SA3', 'ON'],
    ['ALPA4', 'PN'],
    ['ELET6', 'PNB'],
    ['CMIG5', 'PNA'],
    ['XXXX7', 'PNC'],
    ['XXXX8', 'PND'],
  ])('%s é ação à vista de classe %s', (ticker, spec) => {
    expect(seedOf({ ticker, name: 'NOME', subType: 'stock' })).toEqual({
      ticker,
      name: 'NOME',
      spec,
      kind: 'STOCK',
    });
  });

  it('o código com 11 só é papel quando a brapi diz que é unit (ETF e FII também terminam em 11)', () => {
    expect(seedOf({ ticker: 'TAEE11', subType: 'unit' })?.spec).toBe('UNT');
    expect(seedOf({ ticker: 'BPAC11', subType: 'unit' })?.spec).toBe('UNT');
    expect(seedOf({ ticker: 'HGLG11', subType: 'fii' })).toBeUndefined();
    expect(seedOf({ ticker: 'IVVB11', subType: 'etf' })).toBeUndefined();
    expect(seedOf({ ticker: 'HGLG11', subType: 'stock' })).toBeUndefined();
  });

  it('na lista, o 11 sem subtipo (o campo é nulo para alguns ativos) não é papel: um FII ou ETF seria semeado como ação', () => {
    expect(seedOf({ ticker: 'TAEE11' })).toBeUndefined();
    expect(seedOf({ ticker: 'TAEE11', subType: null })).toBeUndefined();
    // os outros sufixos valem pelo código, mesmo sem subtipo
    expect(seedOf({ ticker: 'PETR4' })?.spec).toBe('PN');
    expect(seedOf({ ticker: 'PETR4', subType: null })?.spec).toBe('PN');
  });

  it('o código dado à mão (market:backfill --papeis) vale sem subtipo, mas não contra o subtipo da lista', () => {
    expect(seedOf({ ticker: 'TAEE11' }, true)?.spec).toBe('UNT');
    expect(seedOf({ ticker: 'PETR4' }, true)?.spec).toBe('PN');
    expect(seedOf({ ticker: 'HGLG11', subType: 'fii' }, true)).toBeUndefined();
    expect(seedOf({ ticker: 'TAEE11', subType: 'stock' }, true)).toBeUndefined();
  });

  it('direito, recibo, BDR e código torto ficam de fora', () => {
    for (const ticker of [
      'PETR1',
      'PETR2',
      'PETR9',
      'PETR10',
      'AAPL34',
      'PETR',
      'PETR45',
      '3PETR',
      'petr@4',
      '',
    ]) {
      expect(seedOf({ ticker, subType: 'stock' }), ticker).toBeUndefined();
    }
    expect(seedOf({ ticker: 'AAPL34', subType: 'bdr' })).toBeUndefined();
    expect(seedOf({ ticker: 'PETR4', subType: 'fii' })).toBeUndefined();
  });

  it('a referência não é semeada como ação (BOVA11 vai por REFERENCE_SEED)', () => {
    expect(seedOf({ ticker: REFERENCE_TICKER, subType: 'unit' })).toBeUndefined();
    expect(REFERENCE_TICKERS.has('BOVA11')).toBe(true);
    expect(REFERENCE_SEED).toMatchObject({ ticker: 'BOVA11', kind: 'REFERENCE', spec: 'CI' });
  });

  it('o nome é dado de terceiro: sem caractere de controle, com teto, e sem nome vale o código', () => {
    expect(seedOf({ ticker: 'PETR4', name: '  PETRO\u0000BRAS‮  ' })?.name).toBe('PETRO BRAS');
    expect(seedOf({ ticker: 'PETR4', name: 'x'.repeat(200) })?.name).toHaveLength(60);
    expect(seedOf({ ticker: 'PETR4', name: '   ' })?.name).toBe('PETR4');
    expect(seedOf({ ticker: 'PETR4', name: null })?.name).toBe('PETR4');
  });

  it('o código em minúsculas é normalizado', () => {
    expect(seedOf({ ticker: ' petr4 ' })?.ticker).toBe('PETR4');
  });
});
