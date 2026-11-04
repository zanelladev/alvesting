import { describe, expect, it } from 'vitest';
import { alignBand, layoutCandles, layoutEquity, niceTicks, type Bar } from './chart';

// A geometria dos gráficos SVG (sem biblioteca): escalas, rótulos de eixo e caminhos. Função pura: o componente só desenha o que
// sai daqui. Valores em centavo inteiro; a coordenada y cresce para baixo, então quem tem mais patrimônio tem y menor.

describe('niceTicks', () => {
  it('escolhe um passo redondo (1, 2 ou 5 vezes uma potência de 10) e fica dentro do domínio', () => {
    expect(niceTicks(9_800_000, 10_100_000, 4)).toEqual([
      9_800_000, 9_900_000, 10_000_000, 10_100_000,
    ]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    for (const [min, max] of [
      [9_873_211, 10_020_198],
      [1, 7],
      [-5_000, 12_000],
    ] as const) {
      const ticks = niceTicks(min, max, 4);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.every((t) => t >= min && t <= max)).toBe(true);
      expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    }
  });

  it('o passo nunca é menor que 1 centavo e domínio sem largura ainda dá um marco', () => {
    expect(niceTicks(5, 5, 4)).toEqual([5]);
    expect(niceTicks(0, 2, 10).every(Number.isInteger)).toBe(true);
  });
});

const dates = ['2026-11-03', '2026-11-04', '2026-11-05'];
const size = { width: 400, height: 240 };

describe('layoutEquity', () => {
  const input = {
    dates,
    series: [
      { key: 'a', cents: [10_000_000, 10_100_000, 10_050_000] },
      { key: 'b', cents: [10_000_000, 9_900_000, 9_800_000] },
    ],
    band: { p5: [9_900_000, 9_850_000, 9_750_000], p95: [10_100_000, 10_150_000, 10_200_000] },
  };

  it('uma linha por competidor com um ponto por data; x cresce e quem tem mais patrimônio fica mais acima', () => {
    const layout = layoutEquity(input, size);
    expect(layout.lines.map((l) => l.key)).toEqual(['a', 'b']);
    const points = (d: string) =>
      [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const [a, b] = layout.lines.map((l) => points(l.d));
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a![0]![0]).toBeLessThan(a![1]![0]!);
    expect(a![1]![0]).toBeLessThan(a![2]![0]!);
    // no último pregão a vence b: y menor
    expect(a![2]![1]).toBeLessThan(b![2]![1]!);
    // o fim da linha é o último ponto
    expect(layout.lines[0]!.end).toEqual({ x: a![2]![0], y: a![2]![1] });
  });

  it('as coordenadas saem com uma casa decimal, também as da grade (o SVG vai duas vezes no documento)', () => {
    const layout = layoutEquity(input, size);
    for (const tick of layout.yTicks) expect(Math.round(tick.y * 10) / 10).toBe(tick.y);
  });

  it('tudo cabe na área do desenho, a faixa inclusive', () => {
    const layout = layoutEquity(input, size);
    const numbers = [...layout.lines.map((l) => l.d), layout.band!.d]
      .flatMap((d) => [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)])
      .map((m) => [Number(m[1]), Number(m[2])] as const);
    for (const [x, y] of numbers) {
      expect(x).toBeGreaterThanOrEqual(layout.plot.left);
      expect(x).toBeLessThanOrEqual(layout.plot.right);
      expect(y).toBeGreaterThanOrEqual(layout.plot.top);
      expect(y).toBeLessThanOrEqual(layout.plot.bottom);
    }
    for (const tick of layout.yTicks) {
      expect(tick.y).toBeGreaterThanOrEqual(layout.plot.top);
      expect(tick.y).toBeLessThanOrEqual(layout.plot.bottom);
    }
  });

  it('a faixa é um polígono fechado (p5 na ida, p95 na volta) e some sem faixa', () => {
    const layout = layoutEquity(input, size);
    expect(layout.band!.d.startsWith('M')).toBe(true);
    expect(layout.band!.d.endsWith('Z')).toBe(true);
    expect((layout.band!.d.match(/[ML]/g) ?? []).length).toBe(6);
    expect(layoutEquity({ ...input, band: null }, size).band).toBeNull();
  });

  it('rótulos do eixo x: primeira e última data nas pontas, sem repetir', () => {
    const layout = layoutEquity(input, size);
    expect(layout.xLabels[0]).toMatchObject({ label: '03/11', anchor: 'start' });
    expect(layout.xLabels.at(-1)).toMatchObject({ label: '05/11', anchor: 'end' });
    const labels = layout.xLabels.map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
    const many = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const wide = layoutEquity(
      {
        dates: many,
        series: [{ key: 'a', cents: many.map((_, i) => 10_000_000 + i) }],
        band: null,
      },
      size,
    );
    expect(wide.xLabels.length).toBeLessThanOrEqual(5);
    expect(wide.xLabels[0]!.label).toBe('01/11');
    expect(wide.xLabels.at(-1)!.label).toBe('20/11');
  });

  it('uma data só (a primeira liquidação): um ponto por linha, no meio, e a faixa vira uma barra', () => {
    const one = layoutEquity(
      {
        dates: ['2026-11-03'],
        series: [{ key: 'a', cents: [10_000_000] }],
        band: { p5: [9_900_000], p95: [10_100_000] },
      },
      size,
    );
    expect(one.lines[0]!.d).toMatch(/^M[\d.]+ [\d.]+$/);
    expect(one.lines[0]!.end.x).toBeCloseTo((one.plot.left + one.plot.right) / 2, 0);
    expect(one.band!.d.endsWith('Z')).toBe(true);
    expect(one.xLabels).toHaveLength(1);
  });

  it('série constante não quebra a escala (domínio sem largura)', () => {
    const flat = layoutEquity(
      { dates, series: [{ key: 'a', cents: [10_000_000, 10_000_000, 10_000_000] }], band: null },
      size,
    );
    expect(flat.yTicks.length).toBeGreaterThanOrEqual(1);
    expect(flat.lines[0]!.d).not.toMatch(/NaN|Infinity/);
  });

  it('sem nenhuma data não há o que desenhar', () => {
    expect(() => layoutEquity({ dates: [], series: [], band: null }, size)).toThrow(RangeError);
  });

  it('recusa série de tamanho diferente do das datas', () => {
    expect(() =>
      layoutEquity({ dates, series: [{ key: 'a', cents: [1, 2] }], band: null }, size),
    ).toThrow(RangeError);
  });
});

const bars: Bar[] = [
  { date: '2026-11-03', openCents: 1000, highCents: 1100, lowCents: 950, closeCents: 1050 },
  { date: '2026-11-04', openCents: 1050, highCents: 1060, lowCents: 900, closeCents: 920 },
  { date: '2026-11-05', openCents: 920, highCents: 920, lowCents: 920, closeCents: 920 },
];

describe('layoutCandles', () => {
  it('uma vela por barra; alta (fecha acima da abertura) é vazada e baixa é cheia', () => {
    const layout = layoutCandles(bars, size);
    expect(layout.candles).toHaveLength(3);
    expect(layout.candles.map((c) => c.up)).toEqual([true, false, true]);
    // o pavio vai da mínima à máxima: y da máxima é menor que o da mínima
    for (const c of layout.candles) expect(c.wickTop).toBeLessThanOrEqual(c.wickBottom);
    // o corpo da vela sem variação ainda aparece (pelo menos 1 px)
    expect(layout.candles[2]!.bodyHeight).toBeGreaterThanOrEqual(1);
    // x cresce
    expect(layout.candles[0]!.x).toBeLessThan(layout.candles[1]!.x);
    expect(layout.candles[1]!.x).toBeLessThan(layout.candles[2]!.x);
  });

  it('a escala vai da menor mínima à maior máxima e tudo cabe na área do desenho', () => {
    const layout = layoutCandles(bars, size);
    for (const c of layout.candles) {
      expect(c.wickTop).toBeGreaterThanOrEqual(layout.plot.top);
      expect(c.wickBottom).toBeLessThanOrEqual(layout.plot.bottom);
      expect(c.x - layout.candleWidth / 2).toBeGreaterThanOrEqual(layout.plot.left);
      expect(c.x + layout.candleWidth / 2).toBeLessThanOrEqual(layout.plot.right);
    }
    expect(layout.xLabels[0]).toMatchObject({ label: '03/11', anchor: 'start' });
    expect(layout.xLabels.at(-1)).toMatchObject({ label: '05/11', anchor: 'end' });
  });

  it('sessenta barras cabem sem sobrepor', () => {
    const many: Bar[] = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      openCents: 6000 + i,
      highCents: 6100 + i,
      lowCents: 5900 + i,
      closeCents: 6050 + i,
    }));
    const layout = layoutCandles(many, size);
    const xs = layout.candles.map((c) => c.x);
    for (let i = 1; i < xs.length; i += 1)
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(layout.candleWidth);
  });

  it('sem barra não há o que desenhar', () => {
    expect(() => layoutCandles([], size)).toThrow(RangeError);
  });
});

describe('alignBand', () => {
  const row = (date: string, p5: number, p95: number) => ({
    date,
    equityCents: { p5, p25: p5, p50: p5, p75: p95, p95 },
  });

  it('alinha a faixa do Monte Carlo com as datas do gráfico, pela data', () => {
    const band = alignBand(dates, [
      row('2026-11-05', 3, 30),
      row('2026-11-03', 1, 10),
      row('2026-11-04', 2, 20),
    ]);
    expect(band).toEqual({ p5: [1, 2, 3], p95: [10, 20, 30] });
  });

  it('data sem linha no Monte Carlo (ou nenhuma linha) = sem faixa, nunca uma faixa torta', () => {
    expect(alignBand(dates, [row('2026-11-03', 1, 10), row('2026-11-04', 2, 20)])).toBeNull();
    expect(alignBand(dates, [])).toBeNull();
    expect(alignBand([], [row('2026-11-03', 1, 10)])).toBeNull();
  });
});
