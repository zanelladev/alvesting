import { formatShortDate } from './format';

// A geometria dos gráficos SVG, sem biblioteca (plano §3): escalas, rótulos de eixo e caminhos. Função pura, testada em chart.spec.ts;
// os componentes (src/components/charts.tsx) só desenham o que sai daqui. Valores em centavo inteiro. A coordenada y cresce para
// baixo, então quem tem mais patrimônio tem y menor. Coordenadas com uma casa decimal: o SVG fica pequeno e o olho não vê o resto.

export interface Size {
  width: number;
  height: number;
}
export interface Plot {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Margens para os rótulos (de 12 de tamanho, em charts.tsx): à esquerda os do eixo y (até "100.000": 7 caracteres da Plex Mono, uns 50 de
// largura, mais 6 de folga do eixo), embaixo os do eixo x.
const MARGIN = { left: 58, top: 8, right: 10, bottom: 22 };

const fix = (n: number): string => String(Math.round(n * 10) / 10);

function plotOf({ width, height }: Size, margin = MARGIN): Plot {
  return {
    left: margin.left,
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
  };
}

// Marcos "redondos" (1, 2 ou 5 vezes uma potência de 10, como o d3) entre min e max, para cerca de `count` intervalos. O passo nunca é
// menor que 1 centavo: os valores são inteiros. Domínio sem largura devolve o próprio valor.
export function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / count;
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor =
    error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1;
  const step = Math.max(1, factor * 10 ** power);
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push(value);
  return ticks;
}

// Até 5 rótulos de data, a primeira e a última nas pontas (alinhadas para dentro, para o texto não sair do desenho). `minor`: o que não é
// a primeira, a do meio nem a última, que o desenho estreito (o celular) esconde para as datas não encostarem.
function xLabelsOf(
  dates: readonly string[],
  xOf: (index: number) => number,
): Array<{ label: string; x: number; anchor: 'start' | 'middle' | 'end'; minor: boolean }> {
  const shown = Math.min(dates.length, 5);
  if (shown === 1) {
    return [{ label: formatShortDate(dates[0]!), x: xOf(0), anchor: 'middle', minor: false }];
  }
  return Array.from({ length: shown }, (_, i) => {
    const index = Math.round((i * (dates.length - 1)) / (shown - 1));
    return {
      label: formatShortDate(dates[index]!),
      x: xOf(index),
      anchor:
        i === 0 ? ('start' as const) : i === shown - 1 ? ('end' as const) : ('middle' as const),
      minor: i !== 0 && i !== shown - 1 && i * 2 !== shown - 1,
    };
  });
}

// O eixo y: do menor ao maior valor com folga de 6% (e um piso de 0,2% do valor para série constante), e os marcos dentro do domínio.
function yScale(values: readonly number[], plot: Plot) {
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = Math.max(Math.round((max - min) * 0.06), Math.round(Math.abs(max) * 0.002), 1);
  min -= pad;
  max += pad;
  const yOf = (value: number) =>
    plot.bottom - ((value - min) / (max - min)) * (plot.bottom - plot.top);
  return {
    yOf,
    yTicks: niceTicks(min, max, 4).map((value) => ({ value, y: Math.round(yOf(value) * 10) / 10 })),
  };
}

// --- patrimônio ----------------------------------------------------------------------------------------------------------------
export interface EquityInput {
  dates: readonly string[];
  // um valor por data, alinhado com `dates`
  series: ReadonlyArray<{ key: string; cents: readonly number[] }>;
  // a faixa p5 a p95 das carteiras aleatórias do Monte Carlo, também alinhada com `dates`
  band: { p5: readonly number[]; p95: readonly number[] } | null;
}
export interface EquityLayout {
  plot: Plot;
  yTicks: Array<{ value: number; y: number }>;
  xLabels: ReturnType<typeof xLabelsOf>;
  lines: Array<{ key: string; d: string; end: { x: number; y: number } }>;
  band: { d: string } | null;
}

// `margin`: a dos rótulos de eixo dentro do SVG (o padrão, das velas); o gráfico da arena desenha os rótulos em HTML e passa a dele.
export function layoutEquity(
  input: EquityInput,
  size: Size,
  margin: typeof MARGIN = MARGIN,
): EquityLayout {
  const { dates, series, band } = input;
  if (dates.length === 0) throw new RangeError('gráfico sem nenhuma data');
  for (const s of series) {
    if (s.cents.length !== dates.length)
      throw new RangeError(`série ${s.key} fora do tamanho das datas`);
  }
  if (band && (band.p5.length !== dates.length || band.p95.length !== dates.length)) {
    throw new RangeError('faixa fora do tamanho das datas');
  }

  const plot = plotOf(size, margin);
  const xOf = (index: number) =>
    dates.length === 1
      ? (plot.left + plot.right) / 2
      : plot.left + (index / (dates.length - 1)) * (plot.right - plot.left);
  const { yOf, yTicks } = yScale(
    [...series.flatMap((s) => s.cents), ...(band ? [...band.p5, ...band.p95] : [])],
    plot,
  );
  const point = (index: number, cents: number): [number, number] => [xOf(index), yOf(cents)];
  const move = (points: Array<[number, number]>) =>
    points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fix(x)} ${fix(y)}`).join(' ');

  // A faixa é um polígono: ida pelo p5, volta pelo p95. Com uma data só vira uma barra estreita, porque largura zero não aparece.
  let bandPath: string | null = null;
  if (band) {
    const lower = band.p5.map((cents, i) => point(i, cents));
    const upper = band.p95.map((cents, i) => point(i, cents));
    const edge = 6;
    bandPath = `${move(
      dates.length === 1
        ? [
            [lower[0]![0] - edge, upper[0]![1]],
            [lower[0]![0] + edge, upper[0]![1]],
            [lower[0]![0] + edge, lower[0]![1]],
            [lower[0]![0] - edge, lower[0]![1]],
          ]
        : [...lower, ...upper.reverse()],
    )} Z`;
  }

  return {
    plot,
    yTicks,
    xLabels: xLabelsOf(dates, xOf),
    lines: series.map((s) => {
      const points = s.cents.map((cents, i) => point(i, cents));
      const last = points.at(-1)!;
      return {
        key: s.key,
        d: move(points),
        end: { x: Math.round(last[0] * 10) / 10, y: Math.round(last[1] * 10) / 10 },
      };
    }),
    band: bandPath ? { d: bandPath } : null,
  };
}

// A faixa do Monte Carlo (os percentis 5 e 95 do patrimônio, por pregão) alinhada com as datas do gráfico, pela data. Faltar uma data é
// faixa nenhuma: uma faixa com buraco desenharia uma região que não existe.
export function alignBand(
  dates: readonly string[],
  rows: ReadonlyArray<{ date: string; equityCents: { p5: number; p95: number } }>,
): { p5: number[]; p95: number[] } | null {
  if (dates.length === 0) return null;
  const byDate = new Map(rows.map((row) => [row.date, row.equityCents]));
  const aligned = dates.map((date) => byDate.get(date));
  if (aligned.some((row) => row === undefined)) return null;
  return { p5: aligned.map((row) => row!.p5), p95: aligned.map((row) => row!.p95) };
}

// Os rótulos do fim das linhas do patrimônio (o logo e a pílula com o valor; plano do redesenho, e.4): cada um na altura em que a sua linha
// termina, sem encavalar. Na ordem da altura, o que ficaria a menos de `gap` do de cima desce até caber; se o último passar de `bottom`, ele
// fica no pé e empurra para cima os de cima dele. Devolve as alturas na ordem da entrada. `ys`, `gap`, `top` e `bottom` na mesma unidade
// (o px do desenho: a altura do gráfico é fixa). O empate fica na ordem da entrada.
// ponytail: mais rótulos que cabem na altura (uns 13 de 20 px em 280) passam do topo; a saída é um gráfico mais alto ou a legenda só.
export function spreadLabels(
  ys: readonly number[],
  gap: number,
  top: number,
  bottom: number,
): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const placed = order.map((label) => label.y);
  for (let k = 0; k < placed.length; k += 1) {
    placed[k] = Math.max(placed[k]!, k === 0 ? top : placed[k - 1]! + gap);
  }
  for (let k = placed.length - 1; k >= 0; k -= 1) {
    placed[k] = Math.min(placed[k]!, k === placed.length - 1 ? bottom : placed[k + 1]! - gap);
  }
  const out = new Array<number>(ys.length);
  order.forEach((label, k) => (out[label.i] = placed[k]!));
  return out;
}

// --- barras (velas) ------------------------------------------------------------------------------------------------------------
export interface Bar {
  date: string;
  openCents: number;
  highCents: number;
  lowCents: number;
  closeCents: number;
}
export interface CandlesLayout {
  plot: Plot;
  yTicks: Array<{ value: number; y: number }>;
  xLabels: ReturnType<typeof xLabelsOf>;
  candleWidth: number;
  candles: Array<{
    x: number;
    up: boolean;
    wickTop: number;
    wickBottom: number;
    bodyTop: number;
    bodyHeight: number;
  }>;
}

export function layoutCandles(bars: readonly Bar[], size: Size): CandlesLayout {
  if (bars.length === 0) throw new RangeError('gráfico sem nenhuma barra');
  const plot = plotOf(size);
  const slot = (plot.right - plot.left) / bars.length;
  const xOf = (index: number) => plot.left + (index + 0.5) * slot;
  const { yOf, yTicks } = yScale(
    bars.flatMap((bar) => [bar.highCents, bar.lowCents]),
    plot,
  );
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    plot,
    yTicks,
    xLabels: xLabelsOf(
      bars.map((bar) => bar.date),
      xOf,
    ),
    candleWidth: round(slot * 0.6),
    candles: bars.map((bar, i) => {
      const bodyTop = yOf(Math.max(bar.openCents, bar.closeCents));
      const bodyBottom = yOf(Math.min(bar.openCents, bar.closeCents));
      return {
        x: round(xOf(i)),
        up: bar.closeCents >= bar.openCents,
        wickTop: round(yOf(bar.highCents)),
        wickBottom: round(yOf(bar.lowCents)),
        bodyTop: round(bodyTop),
        // pelo menos 1 px: a vela sem variação (abertura igual ao fechamento) continua visível
        bodyHeight: Math.max(1, round(bodyBottom - bodyTop)),
      };
    }),
  };
}
