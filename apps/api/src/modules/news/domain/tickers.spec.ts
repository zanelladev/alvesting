import { describe, expect, it } from 'vitest';
import { findTickers, isTickerShape } from './tickers.js';

// Ticker se acha pelo padrão da B3 e só vale se for de um instrumento conhecido (etapa 4). Nunca por nome de
// empresa: "Petrobras" não vira PETR4.
const KNOWN = new Set(['PETR3', 'PETR4', 'VALE3', 'B3SA3', 'BPAC11', 'BOVA11', 'ITUB4', 'WEGE3']);

describe('findTickers', () => {
  it('acha o ticker no texto, com pontuação e parênteses em volta', () => {
    expect(findTickers('Petrobras (PETR4) sobe; VALE3, ITUB4: em alta.', KNOWN)).toEqual([
      'ITUB4',
      'PETR4',
      'VALE3',
    ]);
  });

  it('acha os que têm dígito no meio (B3SA3) e as units (BPAC11)', () => {
    expect(findTickers('B3SA3 e BPAC11 e BOVA11', KNOWN)).toEqual(['B3SA3', 'BOVA11', 'BPAC11']);
  });

  it('devolve cada ticker uma vez e em ordem alfabética', () => {
    expect(findTickers('WEGE3 PETR4 WEGE3 PETR4 PETR3', KNOWN)).toEqual([
      'PETR3',
      'PETR4',
      'WEGE3',
    ]);
  });

  it('ticker com formato certo mas desconhecido é ignorado', () => {
    expect(findTickers('XPTO3 e ZZZZ9 e COP30', KNOWN)).toEqual([]);
  });

  it('nome de empresa não vira ticker', () => {
    expect(findTickers('A Petrobras e a Vale subiram; o Itaú e a WEG caíram', KNOWN)).toEqual([]);
  });

  it('só em maiúsculas: "petr4" e "Petr4" não contam', () => {
    expect(findTickers('petr4 Petr4 pEtR4', KNOWN)).toEqual([]);
  });

  it('não acha ticker dentro de palavra maior', () => {
    expect(findTickers('PETR4F XPETR4 PETR44 PETR4X PETR4_1 aPETR4 PETR4ç', KNOWN)).toEqual([]);
    expect(findTickers('ÇPETR4', KNOWN)).toEqual([]);
  });

  it('o ticker colado em pontuação e em hífen vale', () => {
    expect(findTickers('PETR4-ON, "VALE3"/ITUB4 [WEGE3]', KNOWN)).toEqual([
      'ITUB4',
      'PETR4',
      'VALE3',
      'WEGE3',
    ]);
  });

  it('texto vazio e conjunto vazio', () => {
    expect(findTickers('', KNOWN)).toEqual([]);
    expect(findTickers('PETR4', new Set())).toEqual([]);
  });

  it('texto enorme é varrido em tempo curto', () => {
    const started = Date.now();
    const found = findTickers(`${'A1B2C3 XYZW9 '.repeat(100_000)} PETR4`, KNOWN);
    expect(found).toEqual(['PETR4']);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('isTickerShape', () => {
  it('é o formato da B3: letra, três letras ou dígitos, um ou dois dígitos', () => {
    for (const ok of ['PETR4', 'B3SA3', 'BPAC11', 'AXIA3', 'AZUL54'])
      expect(isTickerShape(ok)).toBe(true);
    for (const bad of [
      '',
      'PETR',
      'petr4',
      '1ETR4',
      'PETR444',
      'PE4',
      'PETR4F',
      'NÃO HÁ',
      '000000',
    ]) {
      expect(isTickerShape(bad), bad).toBe(false);
    }
  });
});
