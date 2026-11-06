import { describe, expect, it } from 'vitest';
import { withViewBox } from './viewbox';

// 300 dos 357 logos guardados (ADR 0036) têm `width="56" height="56"` na raiz e nenhum `viewBox`: num <img> de 16 px o navegador desenha o SVG
// no tamanho dele e mostra só o canto, em vez de encolher o desenho. A rota do site (app/logos) põe o viewBox do tamanho da raiz. A função só
// mexe na tag raiz: o resto do documento sai igual, byte a byte.
const BRAPI_LIKE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><path fill="#00448C" d="M0 0h56v56H0z"/><path fill="#fff" d="M10 16h36v24H10z"/></svg>';

describe('withViewBox', () => {
  it('sem viewBox e com width e height numéricos na raiz: põe o viewBox="0 0 W H" na raiz, e só nela', () => {
    expect(withViewBox(BRAPI_LIKE)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><path fill="#00448C" d="M0 0h56v56H0z"/><path fill="#fff" d="M10 16h36v24H10z"/></svg>',
    );
  });

  it('com viewBox na raiz não muda nada', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="56" height="56"><path d="M0 0h32v32H0z"/></svg>';
    expect(withViewBox(svg)).toBe(svg);
  });

  it('os números como vieram: com casas decimais e com px (as unidades do usuário do SVG)', () => {
    expect(withViewBox('<svg width="56.5" height="20"></svg>')).toBe(
      '<svg width="56.5" height="20" viewBox="0 0 56.5 20"></svg>',
    );
    expect(withViewBox('<svg width="48px" height="24px"/>')).toBe(
      '<svg width="48px" height="24px" viewBox="0 0 48 24"/>',
    );
  });

  it.each([
    ['sem height', '<svg width="56"><path d="M0 0h1v1H0z"/></svg>'],
    [
      'sem width nem height',
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>',
    ],
    ['em porcentagem', '<svg width="100%" height="100%"></svg>'],
    ['em em', '<svg width="2em" height="2em"></svg>'],
    ['zero', '<svg width="0" height="56"></svg>'],
    ['negativo', '<svg width="-56" height="56"></svg>'],
    ['vazio', '<svg width="" height="56"></svg>'],
    ['com expoente', '<svg width="1e2" height="56"></svg>'],
  ])('width e height que não são números positivos (%s): não muda nada', (_name, svg) => {
    expect(withViewBox(svg)).toBe(svg);
  });

  it('a declaração XML, comentários e espaços antes da raiz ficam como estão', () => {
    const prolog = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- exportado -->\n';
    expect(withViewBox(`${prolog}<svg width="10" height="20"><g/></svg>`)).toBe(
      `${prolog}<svg width="10" height="20" viewBox="0 0 10 20"><g/></svg>`,
    );
  });

  it('um <svg> dentro de um comentário antes da raiz não é a raiz', () => {
    const svg = '<!-- <svg width="1" height="1"> --><svg width="10" height="10"></svg>';
    expect(withViewBox(svg)).toBe(
      '<!-- <svg width="1" height="1"> --><svg width="10" height="10" viewBox="0 0 10 10"></svg>',
    );
  });

  it('o <svg> de dentro (sem viewBox) não é tocado, só a raiz', () => {
    const svg =
      '<svg viewBox="0 0 8 8"><svg width="4" height="4"><path d="M0 0h4v4H0z"/></svg></svg>';
    expect(withViewBox(svg)).toBe(svg);
  });

  it('atributo entre aspas simples, com ">" no valor e com quebra de linha entre os atributos', () => {
    expect(withViewBox("<svg data-x='a>b'\n  width='12' height='6'>\n</svg>")).toBe(
      "<svg data-x='a>b'\n  width='12' height='6' viewBox=\"0 0 12 6\">\n</svg>",
    );
  });

  // O SVG é XML: o nome do atributo tem caixa, e o navegador ignora um `viewbox` em minúsculas (o desenho continua sem encolher).
  it('o viewbox em minúsculas não é o viewBox: a raiz ganha o de verdade', () => {
    expect(withViewBox('<svg viewbox="0 0 1 1" width="56" height="56"></svg>')).toBe(
      '<svg viewbox="0 0 1 1" width="56" height="56" viewBox="0 0 56 56"></svg>',
    );
  });

  it.each([
    ['raiz que não é svg', '<html width="56" height="56"></html>'],
    [
      'raiz com prefixo',
      '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="56" height="56"></svg:svg>',
    ],
    ['texto antes da raiz', 'oi<svg width="56" height="56"></svg>'],
    ['DOCTYPE antes da raiz', '<!DOCTYPE svg><svg width="56" height="56"></svg>'],
    ['tag torta', '<svg width="56" height="56"'],
    ['vazio', ''],
  ])('o que não é uma raiz <svg> que ela reconhece (%s): não muda nada', (_name, svg) => {
    expect(withViewBox(svg)).toBe(svg);
  });

  it('entrada grande e torta volta rápido (nenhuma expressão regular explode)', () => {
    const started = performance.now();
    withViewBox(`<svg ${'a="1" '.repeat(20_000)}`);
    withViewBox(`${'<!-- '.repeat(20_000)}<svg width="1" height="1">`);
    withViewBox(`<svg${' '.repeat(50_000)}width="1"`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
