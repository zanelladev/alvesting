import { describe, expect, it } from 'vitest';
import type { PublicCompetitor } from '@alvesting/contracts';
import { compararCarteira, fechamentoAte, noPeriodo } from './comparacao';

// A comparação da carteira com a arena (lib/comparacao.ts): o mesmo dinheiro, nas mesmas datas, em cada competidor. Os números são feitos à
// mão para cada regra: a entrada antes da abertura do dia da compra (o capital no primeiro pregão), o dia sem pregão, o arredondamento, a
// ordem e quem fica de fora.
const competitor = (slug: string, type: PublicCompetitor['type'] = 'MODEL'): PublicCompetitor => ({
  slug,
  name: slug,
  type,
  provider: type === 'MODEL' ? 'fake' : null,
  modelId: type === 'MODEL' ? `fake/${slug}` : null,
});

const DATES = ['2026-11-03', '2026-11-04', '2026-11-05'];
// todos ao vivo; o trecho retroativo tem o teste dele
const AO_VIVO = ['AO_VIVO', 'AO_VIVO', 'AO_VIVO'] as const;
const CAPITAL = 10_000_000;
const SERIES = [
  { competitor: competitor('sobe'), equityCents: [10_100_000, 10_200_000, 10_500_000] },
  { competitor: competitor('cdi', 'CDI'), equityCents: [10_004_000, 10_008_000, 10_012_000] },
];
const lot = (ticker: string, costCents: number, boughtOn: string | null, quantity = 100) => ({
  ticker,
  quantity,
  costCents,
  boughtOn,
});

describe('compararCarteira', () => {
  it('a compra do primeiro pregão entra pelo capital inicial, e a do último pelo fechamento da véspera', () => {
    const out = compararCarteira({
      lots: [lot('MOVE3', 100_000, '2026-11-03'), lot('SINA3', 100_000, '2026-11-05')],
      dates: DATES,
      modes: AO_VIVO,
      capitalCents: CAPITAL,
      series: SERIES,
      closes: new Map([
        ['MOVE3', 1_100],
        ['SINA3', 950],
      ]),
    });
    // "sobe": 100.000 × 10.500.000 ÷ 10.000.000 = 105.000 e 100.000 × 10.500.000 ÷ 10.200.000 = 102.941,18 → 102.941
    // CDI: 100.000 × 10.012.000 ÷ 10.000.000 = 100.120 e 100.000 × 10.012.000 ÷ 10.008.000 = 100.039,97 → 100.040
    expect(out).toEqual({
      inicio: '2026-11-03',
      ate: '2026-11-05',
      compras: 2,
      investidoCents: 200_000,
      fora: { semData: 0, antes: 0, depois: 0, semCotacao: 0 },
      // 100 × 1.100 + 100 × 950 = 205.000: +2,50%
      voce: { valorCents: 205_000, resultadoCents: 5_000, rendimentoBps: 250 },
      competidores: [
        {
          competitor: SERIES[0]!.competitor,
          valorCents: 207_941,
          resultadoCents: 7_941,
          rendimentoBps: 397,
        },
        {
          competitor: SERIES[1]!.competitor,
          valorCents: 200_160,
          resultadoCents: 160,
          rendimentoBps: 8,
        },
      ],
      retroativos: null,
    });
  });

  // O trecho retroativo da arena (ADR 0038) que o período cobre: do pregão da compra mais antiga (o primeiro em que o dinheiro rende) ao último
  // liquidado. A compra de depois do trecho não o cobre.
  it('os pregões retroativos que o período cobre, do pregão da compra mais antiga ao último liquidado', () => {
    const comparar = (...boughtOn: string[]) =>
      compararCarteira({
        lots: boughtOn.map((day) => lot('MOVE3', 100_000, day)),
        dates: DATES,
        modes: ['RETROATIVO', 'RETROATIVO', 'AO_VIVO'],
        capitalCents: CAPITAL,
        series: SERIES,
        closes: new Map([['MOVE3', 1_000]]),
      }).retroativos;
    expect(comparar('2026-11-03')).toEqual({ pregoes: 2, periodo: 'de 03/11 a 04/11' });
    expect(comparar('2026-11-05', '2026-11-04')).toEqual({ pregoes: 1, periodo: 'em 04/11' });
    expect(comparar('2026-11-05')).toBeNull();
    // sem o modo (a api de antes do campo, opcional no contrato), a comparação sai igual, sem o trecho
    const semModo = compararCarteira({
      lots: [lot('MOVE3', 100_000, '2026-11-03')],
      dates: DATES,
      capitalCents: CAPITAL,
      series: SERIES,
      closes: new Map([['MOVE3', 1_000]]),
    });
    expect(semModo.retroativos).toBeNull();
    expect(semModo.competidores).toHaveLength(SERIES.length);
  });

  it('a compra num dia sem pregão entra pelo fechamento do pregão anterior a ele', () => {
    const out = compararCarteira({
      // domingo, entre a sexta (06/11) e a segunda (09/11)
      lots: [lot('MOVE3', 100_000, '2026-11-08')],
      dates: ['2026-11-06', '2026-11-09'],
      modes: ['AO_VIVO', 'AO_VIVO'],
      capitalCents: CAPITAL,
      series: [{ competitor: competitor('sobe'), equityCents: [10_000_000, 11_000_000] }],
      closes: new Map([['MOVE3', 1_000]]),
    });
    expect(out.competidores[0]!.valorCents).toBe(110_000);
  });

  it('o centavo do meio vai para cima, e a ordem é do maior valor para o menor', () => {
    const out = compararCarteira({
      lots: [lot('MOVE3', 1, '2026-11-03', 1)],
      dates: ['2026-11-03', '2026-11-04'],
      modes: ['AO_VIVO', 'AO_VIVO'],
      capitalCents: 2,
      series: [
        { competitor: competitor('meio'), equityCents: [2, 3] },
        { competitor: competitor('dobro'), equityCents: [2, 4] },
      ],
      closes: new Map([['MOVE3', 1]]),
    });
    // 1 × 3 ÷ 2 = 1,5 → 2; 1 × 4 ÷ 2 = 2
    expect(out.competidores.map((c) => [c.competitor.slug, c.valorCents])).toEqual([
      ['meio', 2],
      ['dobro', 2],
    ]);
    // o empate fica na ordem da série (o sort é estável)
  });

  it('ficam de fora a compra sem data, a de antes do primeiro pregão, a de depois do último liquidado e a ação sem cotação', () => {
    const out = compararCarteira({
      lots: [
        lot('MOVE3', 100_000, null),
        lot('MOVE3', 100_000, '2026-11-02'),
        lot('MOVE3', 100_000, '2026-11-06'),
        lot('PAUS3', 100_000, '2026-11-04'),
        lot('MOVE3', 100_000, '2026-11-04'),
      ],
      dates: DATES,
      modes: AO_VIVO,
      capitalCents: CAPITAL,
      series: SERIES,
      closes: new Map([['MOVE3', 1_000]]),
    });
    expect(out.fora).toEqual({ semData: 1, antes: 1, depois: 1, semCotacao: 1 });
    expect(out.compras).toBe(1);
    expect(out.investidoCents).toBe(100_000);
  });

  it('sem compra que entre, não há resultado de ninguém', () => {
    const out = compararCarteira({
      lots: [lot('MOVE3', 100_000, null)],
      dates: DATES,
      modes: AO_VIVO,
      capitalCents: CAPITAL,
      series: SERIES,
      closes: new Map(),
    });
    expect(out).toMatchObject({
      compras: 0,
      investidoCents: 0,
      voce: null,
      competidores: [],
      retroativos: null,
    });
  });
});

describe('noPeriodo e fechamentoAte', () => {
  it('o período vai do primeiro pregão ao último liquidado, as duas pontas dentro', () => {
    expect(noPeriodo('2026-11-03', DATES)).toBe(true);
    expect(noPeriodo('2026-11-05', DATES)).toBe(true);
    expect(noPeriodo('2026-11-02', DATES)).toBe(false);
    expect(noPeriodo('2026-11-06', DATES)).toBe(false);
    expect(noPeriodo(null, DATES)).toBe(false);
  });

  it('o fechamento é o da última barra até o pregão; nenhum sem barra ou acima do teto, que não é cotação', () => {
    const bars = [
      { date: '2026-11-03', closeCents: 1_000 },
      { date: '2026-11-04', closeCents: 1_010 },
      { date: '2026-11-06', closeCents: 1_020 },
    ];
    expect(fechamentoAte(bars, '2026-11-05')).toBe(1_010);
    expect(fechamentoAte(bars, '2026-11-06')).toBe(1_020);
    expect(fechamentoAte(bars, '2026-11-02')).toBeNull();
    expect(fechamentoAte([], '2026-11-05')).toBeNull();
    expect(
      fechamentoAte([{ date: '2026-11-04', closeCents: 45_000_001 }], '2026-11-05'),
    ).toBeNull();
  });
});
