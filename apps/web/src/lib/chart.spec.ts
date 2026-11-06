import { describe, expect, it } from 'vitest';
import {
  alignBand,
  layoutEquity,
  niceTicks,
  rankByDay,
  rotuloCoberto,
  serieDe,
  spreadLabels,
} from './chart';

// A geometria dos gráficos SVG (sem biblioteca): escalas, rótulos de eixo e caminhos. Função pura: o componente só desenha o que
// sai daqui. Valores em centavo inteiro; a coordenada y cresce para baixo, então quem tem mais patrimônio tem y menor.

// a margem dos rótulos de eixo dentro do SVG (de 12 de tamanho: à esquerda os do eixo y, uns 50 de largura e 6 de folga; embaixo os do x), a
// que estes testes usam; o gráfico do patrimônio passa a dele (os rótulos em HTML)
const MARGIN = { left: 58, top: 8, right: 10, bottom: 22 };
const desenhar = (
  input: Parameters<typeof layoutEquity>[0],
  size: Parameters<typeof layoutEquity>[1],
  margin = MARGIN,
) => layoutEquity(input, size, margin);

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
  // os pontos de todas as linhas (e da faixa), sem as lacunas
  const allPoints = (layout: ReturnType<typeof layoutEquity>) => [
    ...layout.lines.flatMap((l) => l.points.filter((p) => p !== null)),
    ...(layout.band ? [...layout.band.upper, ...layout.band.lower] : []),
  ];

  it('uma linha por competidor com um ponto por data; x cresce e quem tem mais patrimônio fica mais acima', () => {
    const layout = desenhar(input, size);
    expect(layout.lines.map((l) => l.key)).toEqual(['a', 'b']);
    const [a, b] = layout.lines.map((l) => l.points);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a![0]!.x).toBeLessThan(a![1]!.x);
    expect(a![1]!.x).toBeLessThan(a![2]!.x);
    // o x de cada data é o mesmo em todas as linhas (o cursor do gráfico gruda nele)
    expect(layout.xs).toEqual(a!.map((p) => p!.x));
    // no último pregão a vence b: y menor
    expect(a![2]!.y).toBeLessThan(b![2]!.y);
    // o fim da linha é o último ponto
    expect(layout.lines[0]!.end).toEqual(a![2]);
  });

  it('as coordenadas saem com uma casa decimal, também as da grade (o SVG vai duas vezes no documento)', () => {
    const layout = desenhar(input, size);
    for (const value of [
      ...layout.yTicks.map((t) => t.y),
      ...layout.xs,
      ...allPoints(layout).flatMap((p) => [p.x, p.y]),
    ])
      expect(Math.round(value * 10) / 10).toBe(value);
  });

  it('tudo cabe na área do desenho, a faixa inclusive', () => {
    const layout = desenhar(input, size);
    for (const { x, y } of allPoints(layout)) {
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

  it('a faixa tem a borda de cima (p95) e a de baixo (p5), um ponto por data, e some sem faixa', () => {
    const layout = desenhar(input, size);
    expect(layout.band!.upper).toHaveLength(3);
    expect(layout.band!.lower).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) {
      expect(layout.band!.upper[i]!.x).toBe(layout.xs[i]);
      expect(layout.band!.upper[i]!.y).toBeLessThan(layout.band!.lower[i]!.y);
    }
    expect(desenhar({ ...input, band: null }, size).band).toBeNull();
  });

  // A linha quebra no dado que falta (a peça da beUI): o ponto que falta é nulo, fica fora da escala, e o fim da linha é o último que existe.
  it('o valor que falta é uma lacuna: ponto nulo, fora da escala, e o fim é o último ponto que existe', () => {
    const layout = desenhar(
      {
        dates,
        series: [
          { key: 'a', cents: [10_000_000, null, 10_050_000] },
          { key: 'b', cents: [10_000_000, 9_900_000, null] },
        ],
        band: null,
      },
      size,
    );
    expect(layout.lines[0]!.points[1]).toBeNull();
    expect(layout.lines[1]!.points[2]).toBeNull();
    expect(layout.lines[1]!.end).toEqual(layout.lines[1]!.points[1]);
    const only = desenhar(
      { dates: ['2026-11-03'], series: [{ key: 'a', cents: [null] }], band: null },
      size,
    );
    expect(only.lines[0]!.end).toBeNull();
    expect(JSON.stringify(only)).not.toMatch(/NaN|Infinity|null,"y"/);
  });

  // A legenda esconde uma série: ela fica fora da escala (o eixo se ajusta ao que sobrou), mas continua com os pontos, para a linha voltar se
  // desenhando quando for mostrada de novo.
  it('a série escondida sai da escala, mas continua com os pontos', () => {
    const far = {
      dates,
      series: [
        { key: 'a', cents: [10_000_000, 10_100_000, 10_050_000] },
        { key: 'longe', cents: [10_000_000, 20_000_000, 30_000_000] },
      ],
      band: null,
    };
    const all = desenhar(far, size);
    const shown = desenhar({ ...far, hidden: ['longe'] }, size);
    expect(shown.lines[1]!.points.every((p) => p !== null)).toBe(true);
    // sem a série de cima, a linha "a" ocupa a altura do desenho
    const spread = (l: typeof all) => l.lines[0]!.points.map((p) => p!.y);
    const height = (ys: number[]) => Math.max(...ys) - Math.min(...ys);
    expect(height(spread(shown))).toBeGreaterThan(height(spread(all)) * 5);
    // escondida, ela pode sair da área do desenho: o desenho a corta (e ela está invisível)
    expect(Math.min(...shown.lines[1]!.points.map((p) => p!.y))).toBeLessThan(shown.plot.top);
  });

  it('rótulos do eixo x: primeira e última data nas pontas, sem repetir', () => {
    const layout = desenhar(input, size);
    expect(layout.xLabels[0]).toMatchObject({ label: '03/11', anchor: 'start' });
    expect(layout.xLabels.at(-1)).toMatchObject({ label: '05/11', anchor: 'end' });
    const labels = layout.xLabels.map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
    const many = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const wide = desenhar(
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

  // Em 360 px o desenho do patrimônio tem uns 200 px: cinco datas encostam umas nas outras ("03/11 10/11"). As que não são a primeira, a do
  // meio nem a última levam `minor`, e o gráfico as esconde no celular (components/beui/line-chart.tsx).
  it('rótulos do eixo x: no desenho estreito ficam a primeira, a do meio e a última; as outras levam `minor`', () => {
    const minors = (n: number) =>
      desenhar(
        {
          dates: Array.from({ length: n }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`),
          series: [{ key: 'a', cents: Array.from({ length: n }, () => 10_000_000) }],
          band: null,
        },
        size,
      ).xLabels.map((l) => l.minor);
    expect(minors(20)).toEqual([false, true, false, true, false]);
    // sem data no meio (quatro), ficam só as pontas
    expect(minors(4)).toEqual([false, true, true, false]);
    expect(minors(3)).toEqual([false, false, false]);
    expect(minors(2)).toEqual([false, false]);
    expect(minors(1)).toEqual([false]);
  });

  it('uma data só (a primeira liquidação): um ponto por linha, no meio, e a faixa, um par de pontos', () => {
    const one = desenhar(
      {
        dates: ['2026-11-03'],
        series: [{ key: 'a', cents: [10_000_000] }],
        band: { p5: [9_900_000], p95: [10_100_000] },
      },
      size,
    );
    expect(one.lines[0]!.points).toHaveLength(1);
    expect(one.lines[0]!.end!.x).toBeCloseTo((one.plot.left + one.plot.right) / 2, 0);
    expect(one.band!.upper).toHaveLength(1);
    expect(one.band!.upper[0]!.y).toBeLessThan(one.band!.lower[0]!.y);
    expect(one.xLabels).toHaveLength(1);
  });

  it('série constante não quebra a escala (domínio sem largura)', () => {
    const flat = desenhar(
      { dates, series: [{ key: 'a', cents: [10_000_000, 10_000_000, 10_000_000] }], band: null },
      size,
    );
    expect(flat.yTicks.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(flat)).not.toMatch(/NaN|Infinity/);
  });

  it('sem nenhuma data não há o que desenhar', () => {
    expect(() => desenhar({ dates: [], series: [], band: null }, size)).toThrow(RangeError);
  });

  it('recusa série de tamanho diferente do das datas', () => {
    expect(() =>
      desenhar({ dates, series: [{ key: 'a', cents: [1, 2] }], band: null }, size),
    ).toThrow(RangeError);
  });

  // O gráfico da arena (components/beui/line-chart.tsx) não tem rótulo de eixo dentro do SVG (as datas vão em HTML, embaixo): a margem é a
  // dele, e a linha vai até a borda direita, onde o logo do fim da linha fica.
  it('a margem pode ser outra: a área do desenho segue ela, e a linha termina na borda direita', () => {
    const margin = { left: 0, top: 12, right: 0, bottom: 12 };
    const layout = desenhar(input, { width: 1000, height: 280 }, margin);
    expect(layout.plot).toEqual({ left: 0, top: 12, right: 1000, bottom: 268 });
    for (const line of layout.lines) expect(line.end!.x).toBe(1000);
    for (const tick of layout.yTicks) {
      expect(tick.y).toBeGreaterThanOrEqual(12);
      expect(tick.y).toBeLessThanOrEqual(268);
    }
  });
});

// A posição de cada competidor em cada pregão, para o Bump Chart do ranking: a mesma regra do ranking da api (o retorno em pontos-base, o
// patrimônio menos o capital sobre o capital, com o meio para longe do zero; o empate vale a ordem do elenco, que é a das séries).
describe('rankByDay', () => {
  const capital = 10_000_000;

  it('o maior retorno é o 1º, em cada pregão, entre todos os competidores', () => {
    expect(
      rankByDay(
        [
          [10_000_000, 10_200_000, 9_900_000],
          [10_000_000, 10_100_000, 10_300_000],
          [10_000_000, 9_800_000, 10_000_000],
        ],
        capital,
      ),
    ).toEqual([
      [1, 1, 3],
      [2, 2, 1],
      [3, 3, 2],
    ]);
  });

  it('o empate vale a ordem do elenco, e o empate é no retorno em pontos-base, não no centavo', () => {
    // R$ 1,00 e R$ 4,00 a mais sobre R$ 100.000 dão 0,1 e 0,4 bp: os dois arredondam para 0 bp, empatam, e vale a ordem
    expect(rankByDay([[10_000_100], [10_000_400], [9_990_000]], capital)).toEqual([[1], [2], [3]]);
    // R$ 5,00 é meio ponto-base: o meio vai para longe do zero (1 bp), e passa à frente; o -0,5 bp vai a -1
    expect(rankByDay([[10_000_100], [10_000_500]], capital)).toEqual([[2], [1]]);
    expect(rankByDay([[9_999_500], [10_000_000]], capital)).toEqual([[2], [1]]);
  });

  it('o dia sem patrimônio é uma lacuna (posição nula), e os outros sobem', () => {
    expect(
      rankByDay(
        [
          [10_100_000, null],
          [10_000_000, 10_000_000],
        ],
        capital,
      ),
    ).toEqual([
      [1, null],
      [2, 1],
    ]);
  });

  it('valores no teto do inteiro seguro não perdem precisão', () => {
    const big = Number.MAX_SAFE_INTEGER;
    // os dois retornos arredondam para 0 bp: empatam, e vale a ordem
    expect(rankByDay([[big - 1], [big]], big)).toEqual([[1], [2]]);
  });
});

describe('spreadLabels', () => {
  // os rótulos do fim das linhas: 20 de altura, a área de 0 a 280
  const spread = (ys: number[]) => spreadLabels(ys, 20, 0, 280);

  it('rótulos longe um do outro ficam onde a linha termina', () => {
    expect(spread([40, 120, 200])).toEqual([40, 120, 200]);
  });

  it('o que fica a menos de uma altura do de cima desce até caber, na ordem da altura (não na da lista)', () => {
    // a lista vem na ordem das séries: o segundo é o de cima, e o primeiro desce
    expect(spread([110, 100])).toEqual([120, 100]);
    // três empatados viram uma escada
    expect(spread([50, 50, 50])).toEqual([50, 70, 90]);
  });

  it('nenhum par fica a menos de uma altura, com qualquer entrada', () => {
    const ys = [12, 15, 15.5, 90, 91, 92, 270];
    const out = spread(ys);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(20);
    }
  });

  it('o que passaria do pé sobe, e empurra para cima os de cima dele', () => {
    expect(spread([260, 275, 280])).toEqual([240, 260, 280]);
    // e o de cima não sai do topo
    expect(spread([0, 5])).toEqual([0, 20]);
  });

  it('sem rótulo, nada; um só fica onde está, preso à área', () => {
    expect(spread([])).toEqual([]);
    expect(spread([130])).toEqual([130]);
    expect(spread([-8])).toEqual([0]);
    expect(spread([290])).toEqual([280]);
  });
});

// A geometria das velas (layoutVelas) mora com elas, em components/velas.tsx, e os testes dela em components.spec.tsx ("velas").

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

// A cor e o traço de cada série (os gráficos de linhas e de posição e a sparkline): a cor do laboratório pelos nomes do shadcn que apontam
// para os tokens (`--chart-1` a `--chart-7`, globals.css; nunca hexadecimal, que não segue o tema), e o traço que diz o tipo sem depender da
// cor: o Sorteio tracejado, as referências pontilhadas.
describe('serieDe', () => {
  const model = (slug: string, modelId: string | null = null) => ({
    slug,
    type: 'MODEL',
    modelId,
  });
  it('cada laboratório tem a sua cor, e a linha do modelo é cheia', () => {
    expect(serieDe(model('gpt-6-1-sol'))).toEqual({ cor: 'var(--chart-1)', traco: undefined });
    expect(serieDe(model('claude-opus-5-5')).cor).toBe('var(--chart-2)');
    expect(serieDe(model('gemini-4-argon')).cor).toBe('var(--chart-3)');
    expect(serieDe(model('grok-4-7')).cor).toBe('var(--chart-4)');
    expect(serieDe(model('deepseek-v4-pro')).cor).toBe('var(--chart-5)');
    expect(serieDe(model('qwen3-8-max')).cor).toBe('var(--chart-6)');
    expect(serieDe(model('x', 'anthropic/claude-opus-5.5')).cor).toBe('var(--chart-2)');
  });

  it('o Sorteio é neutro e tracejado; as referências, neutras e pontilhadas; o laboratório sem cor, neutro e cheio', () => {
    expect(serieDe({ slug: 'sorteio', type: 'RANDOM', modelId: null })).toEqual({
      cor: 'var(--chart-7)',
      traco: '6 4',
    });
    for (const type of ['CDI', 'EQUAL_WEIGHT', 'BOVA11'])
      expect(serieDe({ slug: 'x', type, modelId: null })).toEqual({
        cor: 'var(--chart-7)',
        traco: '2 3',
      });
    expect(serieDe(model('modelo-novo'))).toEqual({ cor: 'var(--chart-7)', traco: undefined });
  });
});

// A data do eixo que a pílula do cursor cobriria some enquanto o cursor está à vista (o QA do fechamento, achado 10: a pílula "30/11" ficava por
// cima do "01/12", que fica alinhado pelo fim na ponta direita). As caixas em px: a do rótulo pela âncora dele, a da pílula no meio do cursor.
describe('rotuloCoberto', () => {
  const rotulo = (x: number, anchor: 'start' | 'middle' | 'end') => ({ x, anchor, largura: 38 });
  const pilula = (x: number) => ({ x, largura: 52 });

  it('o rótulo da ponta direita, alinhado pelo fim, some quando a pílula do pregão de antes encosta nele', () => {
    expect(rotuloCoberto(rotulo(800, 'end'), pilula(780))).toBe(true);
    // a distância entre os pontos de âncora não diz nada: com 50 px (a regra de antes escondia a menos de 48) a pílula de 724 a 776 ainda
    // cobre o rótulo, que vai de 762 a 800
    expect(rotuloCoberto(rotulo(800, 'end'), pilula(750))).toBe(true);
    expect(rotuloCoberto(rotulo(800, 'end'), pilula(700))).toBe(false);
  });

  it('o do começo, alinhado pelo começo, e o do meio, centrado', () => {
    expect(rotuloCoberto(rotulo(0, 'start'), pilula(60))).toBe(true);
    expect(rotuloCoberto(rotulo(0, 'start'), pilula(100))).toBe(false);
    expect(rotuloCoberto(rotulo(400, 'middle'), pilula(440))).toBe(true);
    // com a folga de 4 px: a pílula de 424 a 476 fica a mais de 4 px do rótulo, que vai de 381 a 419
    expect(rotuloCoberto(rotulo(400, 'middle'), pilula(450))).toBe(false);
  });
});
