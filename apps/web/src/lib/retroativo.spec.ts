import { describe, expect, it } from 'vitest';
import {
  contagemDosModos,
  faixasRetroativas,
  fraseDaSerie,
  fraseRetroativa,
  periodoDosTrechos,
  trechosRetroativos,
  type Modo,
} from './retroativo';

// O trecho retroativo da temporada (lib/retroativo.ts; ADR 0038): os trechos seguidos, a contagem do ranking, o período e a frase da nota, e o
// fundo do gráfico. A temporada de verdade: de 13/10 a 13/11 retroativos, e ao vivo a partir de 16/11.
const DATES = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18'];
const R = 'RETROATIVO';
const V = 'AO_VIVO';

describe('trechosRetroativos', () => {
  it('junta os retroativos seguidos; o ao vivo e o pregão sem ciclo cortam o trecho', () => {
    expect(trechosRetroativos([R, R, R, V, V, V])).toEqual([{ inicio: 0, fim: 2 }]);
    // o pregão que perdeu a janela ao vivo e foi coberto depois, como retroativo (ADR 0038), no meio do ao vivo
    expect(trechosRetroativos([R, R, V, R, V, R])).toEqual([
      { inicio: 0, fim: 1 },
      { inicio: 3, fim: 3 },
      { inicio: 5, fim: 5 },
    ]);
    expect(trechosRetroativos([R, null, R] satisfies Modo[])).toEqual([
      { inicio: 0, fim: 0 },
      { inicio: 2, fim: 2 },
    ]);
    expect(trechosRetroativos([V, V, null])).toEqual([]);
    expect(trechosRetroativos([])).toEqual([]);
  });
});

describe('contagemDosModos', () => {
  it('conta como o cyclesByMode do ranking: o pregão sem ciclo fica de fora das duas contas', () => {
    expect(contagemDosModos([R, R, null, V])).toEqual({ RETROATIVO: 2, AO_VIVO: 1 });
    expect(contagemDosModos([])).toEqual({ RETROATIVO: 0, AO_VIVO: 0 });
  });
});

describe('periodoDosTrechos', () => {
  it('diz o primeiro e o último dia de cada trecho, e o dia do trecho de um pregão só', () => {
    expect(periodoDosTrechos(DATES, trechosRetroativos([R, R, R, V, V, V]))).toBe(
      'de 11/11 a 13/11',
    );
    expect(periodoDosTrechos(DATES, trechosRetroativos([V, V, V, R, V, V]))).toBe('em 16/11');
    expect(periodoDosTrechos(DATES, trechosRetroativos([R, R, V, R, V, R]))).toBe(
      'de 11/11 a 12/11, em 16/11 e em 18/11',
    );
    expect(periodoDosTrechos(DATES, [])).toBe('');
  });
});

describe('fraseRetroativa', () => {
  it('quantos dos pregões, quando e o que quer dizer; nenhum retroativo, nada', () => {
    expect(fraseRetroativa({ RETROATIVO: 24, AO_VIVO: 3 }, 'de 13/10 a 13/11')).toBe(
      '24 dos 27 pregões, de 13/10 a 13/11, foram rodados depois, e não ao vivo.',
    );
    // a página que não lê a série (a landing) diz só a conta
    expect(fraseRetroativa({ RETROATIVO: 24, AO_VIVO: 3 })).toBe(
      '24 dos 27 pregões foram rodados depois, e não ao vivo.',
    );
    expect(fraseRetroativa({ RETROATIVO: 1, AO_VIVO: 26 }, 'em 18/11')).toBe(
      '1 dos 27 pregões, em 18/11, foi rodado depois, e não ao vivo.',
    );
    // antes da virada, todos são retroativos
    expect(fraseRetroativa({ RETROATIVO: 24, AO_VIVO: 0 }, 'de 13/10 a 13/11')).toBe(
      'Os 24 pregões, de 13/10 a 13/11, foram rodados depois, e não ao vivo.',
    );
    expect(fraseRetroativa({ RETROATIVO: 1, AO_VIVO: 0 })).toBe(
      'O pregão foi rodado depois, e não ao vivo.',
    );
    expect(fraseRetroativa({ RETROATIVO: 0, AO_VIVO: 27 })).toBeNull();
  });
});

describe('fraseDaSerie', () => {
  it('a conta e o período saem das mesmas datas da série', () => {
    expect(fraseDaSerie({ dates: DATES, modes: [R, R, R, V, V, V] })).toBe(
      '3 dos 6 pregões, de 11/11 a 13/11, foram rodados depois, e não ao vivo.',
    );
    expect(fraseDaSerie({ dates: DATES, modes: [V, V, V, V, V, V] })).toBeNull();
  });
  it('sem o modo (a api de antes do campo, opcional no contrato), nada', () => {
    expect(fraseDaSerie({ dates: DATES })).toBeNull();
    expect(fraseDaSerie({ dates: DATES, modes: undefined })).toBeNull();
  });
});

describe('faixasRetroativas', () => {
  // seis datas de 0 a 1000: o passo é 200, e o meio passo, 100
  const XS = [0, 200, 400, 600, 800, 1000];
  it('vai de meio passo antes do primeiro pregão a meio passo depois do último, sem passar das bordas', () => {
    expect(faixasRetroativas(XS, trechosRetroativos([R, R, R, V, V, V]), 1000)).toEqual([
      { x: 0, largura: 500 },
    ]);
    expect(faixasRetroativas(XS, trechosRetroativos([V, V, V, R, V, R]), 1000)).toEqual([
      { x: 500, largura: 200 },
      { x: 900, largura: 100 },
    ]);
  });
  it('com uma data só, o desenho inteiro', () => {
    expect(faixasRetroativas([500], [{ inicio: 0, fim: 0 }], 1000)).toEqual([
      { x: 0, largura: 1000 },
    ]);
  });
});
