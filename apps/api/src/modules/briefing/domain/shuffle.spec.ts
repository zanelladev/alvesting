import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { shuffleBySeed } from './shuffle.js';

// A tabela do universo vai embaralhada, com a semente do pregão, igual para todos os modelos (plano 2 e 10). A regra é
// pública e conferível: a ordem é a do SHA-256 de "<semente>:<chave>".
const TICKERS = [
  'PETR4',
  'VALE3',
  'ITUB4',
  'BBDC4',
  'WEGE3',
  'ABEV3',
  'B3SA3',
  'BBAS3',
  'RENT3',
  'SUZB3',
];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('shuffleBySeed', () => {
  it('é a ordem do SHA-256 de "semente:chave", conferida por fora', () => {
    const expected = [...TICKERS].sort((a, b) => {
      const ha = sha(`2026-10-30:${a}`);
      const hb = sha(`2026-10-30:${b}`);
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    expect(shuffleBySeed(TICKERS, '2026-10-30', (t) => t)).toEqual(expected);
  });

  it('não depende da ordem em que a lista chega (a do banco)', () => {
    const forward = shuffleBySeed(TICKERS, '2026-10-30', (t) => t);
    expect(shuffleBySeed([...TICKERS].reverse(), '2026-10-30', (t) => t)).toEqual(forward);
    expect(shuffleBySeed([...TICKERS].sort(), '2026-10-30', (t) => t)).toEqual(forward);
  });

  it('é uma permutação: nenhum item some nem se repete', () => {
    const out = shuffleBySeed(TICKERS, '2026-10-30', (t) => t);
    expect([...out].sort()).toEqual([...TICKERS].sort());
  });

  it('a mesma semente dá a mesma ordem; outro pregão dá outra', () => {
    const a = shuffleBySeed(TICKERS, '2026-10-30', (t) => t);
    expect(shuffleBySeed(TICKERS, '2026-10-30', (t) => t)).toEqual(a);
    expect(shuffleBySeed(TICKERS, '2026-11-03', (t) => t)).not.toEqual(a);
  });

  it('de fato mistura: não devolve a ordem alfabética nem a de volume', () => {
    const out = shuffleBySeed(TICKERS, '2026-10-30', (t) => t);
    expect(out).not.toEqual([...TICKERS].sort());
    expect(out).not.toEqual(TICKERS);
  });

  it('serve para linhas (usa a chave, não o item) e não muda a lista de entrada', () => {
    const rows = TICKERS.map((ticker, index) => ({ ticker, index }));
    const copy = [...rows];
    const out = shuffleBySeed(rows, '2026-10-30', (row) => row.ticker);
    expect(rows).toEqual(copy);
    expect(out.map((row) => row.ticker)).toEqual(shuffleBySeed(TICKERS, '2026-10-30', (t) => t));
  });

  it('lista vazia e de um item', () => {
    expect(shuffleBySeed([], '2026-10-30', (t: string) => t)).toEqual([]);
    expect(shuffleBySeed(['PETR4'], '2026-10-30', (t) => t)).toEqual(['PETR4']);
  });

  it('chave repetida: os iguais ficam na ordem de entrada (o universo nunca tem ticker repetido)', () => {
    const items = [
      { k: 'A', v: 1 },
      { k: 'A', v: 2 },
      { k: 'B', v: 3 },
    ];
    const one = shuffleBySeed(items, 'x', (i) => i.k).map((i) => i.v);
    const two = shuffleBySeed([...items].reverse(), 'x', (i) => i.k).map((i) => i.v);
    expect(new Set(one).size).toBe(3);
    expect(one.filter((v) => v !== 3)).toEqual([1, 2]);
    expect(two.filter((v) => v !== 3)).toEqual([2, 1]);
  });
});
