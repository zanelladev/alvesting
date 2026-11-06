import { describe, expect, it } from 'vitest';
import { GLYPH, areaChart, glyphOf } from './ascii';

// O porte dos checks do `packages/config/ascii.test.mjs` da v1 para o que a v2 usa: o `areaChart` faz aritmética de índice e de
// saturação, que é onde o erro de um-a-mais mora.
const ink = (c: ReturnType<typeof areaChart>) => c.layers.find((l) => l.tone === 'ink')!.lines;
const soft = (c: ReturnType<typeof areaChart>) => c.layers.find((l) => l.tone === 'soft')!.lines;
// a coluna `i` de cima para baixo
const column = (lines: string[], i: number) => lines.map((line) => line[i]).join('');

describe('glyphOf', () => {
  it('a direção tem glifo para as três: alta, baixa e estável', () => {
    expect(glyphOf(12)).toBe(GLYPH.up);
    expect(glyphOf(-1)).toBe(GLYPH.down);
    expect(glyphOf(0)).toBe(GLYPH.flat);
    expect(Object.values(GLYPH)).toEqual(['▲', '▼', '■']);
  });
});

describe('areaChart', () => {
  it('as camadas têm a mesma grade, e o ponto fica no fim da linha do topo', () => {
    const c = areaChart([0, 1, 2, 3], 10, 4);
    for (const layer of c.layers) {
      expect(layer.lines).toHaveLength(4);
      for (const line of layer.lines) expect(line).toHaveLength(11);
    }
    expect(ink(c)[0]!.at(-1)).toBe('●');
  });

  it('o mínimo fica a 10% e o máximo a 90% da altura (a folga do Arc)', () => {
    const c = areaChart([0, 10], 2, 4);
    expect(column(ink(c), 0)).toBe('   ▃');
    expect(column(ink(c), 1)).toBe('▅   ');
  });

  it('a área fica um oitavo abaixo, e só a linha sobra', () => {
    const c = areaChart([0, 10], 2, 4);
    expect(column(soft(c), 0)).toBe('   ▂');
    expect(column(soft(c), 1)).toBe('▄███');
  });

  it('a série constante e a vazia não quebram', () => {
    const flat = areaChart([5, 5, 5], 6, 4);
    expect(ink(flat)[3]).toBe('▃▃▃▃▃▃●');
    expect(soft(flat)[3]).toBe('▂▂▂▂▂▂ ');
    expect(ink(areaChart([], 6, 4))).toEqual(['', '', '', '']);
  });

  it('uma série de um ponto só (o primeiro pregão) vira uma linha reta no piso de 10%', () => {
    expect(ink(areaChart([7], 3, 2))).toEqual(['    ', '▂▂▂●']);
  });
});
