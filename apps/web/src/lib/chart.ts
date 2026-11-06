import { formatShortDate } from './format';
import { labOf, type Laboratorio } from './laboratorio';

// A geometria dos gráficos SVG, sem biblioteca (plano §3): escalas, rótulos de eixo e caminhos. Função pura, testada em chart.spec.ts; os
// componentes (components/beui/*; as velas, components/velas.tsx, com a geometria delas) só desenham o que sai daqui. Valores em centavo
// inteiro. A coordenada y cresce para baixo, então quem tem mais patrimônio tem y menor. Coordenadas com uma casa decimal: o SVG fica pequeno
// e o olho não vê o resto.

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

// a área do desenho dentro do tamanho, menos a margem de cada borda (a margem tem o mesmo formato: a distância de cada lado)
function plotOf({ width, height }: Size, margin: Plot): Plot {
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
// a primeira, a do meio nem a última, que o desenho estreito (o celular) esconde para as datas não encostarem. Também das velas
// (components/velas.tsx).
export function xLabelsOf(
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
// Também das velas (components/velas.tsx).
export function yScale(values: readonly number[], plot: Plot) {
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
export interface Point {
  x: number;
  y: number;
}
export interface EquityInput {
  dates: readonly string[];
  // um valor por data, alinhado com `dates`; o nulo é o dado que falta, e a linha quebra nele
  series: ReadonlyArray<{ key: string; cents: readonly (number | null)[] }>;
  // a faixa p5 a p95 das carteiras aleatórias do Monte Carlo, também alinhada com `dates`
  band: { p5: readonly number[]; p95: readonly number[] } | null;
  // as séries que a legenda escondeu: ficam fora da escala (o eixo se ajusta ao que sobrou), mas com os pontos, para a linha voltar se
  // desenhando do lugar certo
  hidden?: readonly string[];
}
export interface EquityLayout {
  plot: Plot;
  // o x de cada data (o cursor do gráfico gruda nele)
  xs: number[];
  yTicks: Array<{ value: number; y: number }>;
  xLabels: ReturnType<typeof xLabelsOf>;
  // um ponto por data (nulo no dado que falta) e o último que existe, onde o logo e o valor do fim da linha ficam
  lines: Array<{ key: string; points: Array<Point | null>; end: Point | null }>;
  // as bordas da faixa: a de cima (p95) e a de baixo (p5), um ponto por data
  band: { upper: Point[]; lower: Point[] } | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// `margin`: a distância de cada borda do desenho (o gráfico do patrimônio desenha os rótulos em HTML, fora do SVG, e passa a dele). Os
// caminhos saem dos pontos no componente (components/beui/line-chart.tsx), que os anima quando a escala muda.
export function layoutEquity(input: EquityInput, size: Size, margin: Plot): EquityLayout {
  const { dates, series, band, hidden = [] } = input;
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
  const shown = series.filter((s) => !hidden.includes(s.key));
  const values = [
    ...shown.flatMap((s) => s.cents.filter((c): c is number => c !== null)),
    ...(band ? [...band.p5, ...band.p95] : []),
  ];
  // sem valor nenhum à vista (tudo escondido, ou só lacunas), a escala é a do capital de qualquer série: o desenho não fica sem eixo
  const fallback = series.flatMap((s) => s.cents.filter((c): c is number => c !== null));
  const { yOf, yTicks } = yScale(
    values.length > 0 ? values : fallback.length > 0 ? fallback : [0],
    plot,
  );
  const point = (index: number, cents: number): Point => ({
    x: round1(xOf(index)),
    y: round1(yOf(cents)),
  });

  return {
    plot,
    xs: dates.map((_, i) => round1(xOf(i))),
    yTicks,
    xLabels: xLabelsOf(dates, xOf),
    lines: series.map((s) => {
      const points = s.cents.map((cents, i) => (cents === null ? null : point(i, cents)));
      return { key: s.key, points, end: points.findLast((p) => p !== null) ?? null };
    }),
    band: band
      ? {
          upper: band.p95.map((cents, i) => point(i, cents)),
          lower: band.p5.map((cents, i) => point(i, cents)),
        }
      : null,
  };
}

// A parte sobre o todo, em pontos-base inteiros, com o meio para longe do zero (docs/METODOLOGIA.md): a regra do retorno da api
// (settlement/domain/season-stats.ts) e da alocação das carteiras. Em BigInt: o produto por 10.000 passaria do inteiro seguro com valores
// grandes. O todo que não é positivo não tem razão (nulo: a tela mostra o traço).
export function ratioBps(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  const abs = BigInt(Math.abs(part)) * 10_000n;
  const rounded = (2n * abs + BigInt(whole)) / (2n * BigInt(whole));
  return Number(part < 0 ? -rounded : rounded);
}

// A posição de cada competidor em cada pregão (o Bump Chart do ranking): a regra do ranking da api, o maior retorno em pontos-base primeiro
// (o patrimônio menos o capital, sobre o capital) e, no empate, a ordem do elenco, que é a ordem das séries. O dia sem patrimônio é uma lacuna
// (nulo), e quem tem dado sobe. Devolve uma linha por série, uma posição por data (1 é o primeiro).
export function rankByDay(
  equities: ReadonlyArray<readonly (number | null)[]>,
  capitalCents: number,
): Array<Array<number | null>> {
  const days = equities[0]?.length ?? 0;
  const ranks = equities.map(() => new Array<number | null>(days).fill(null));
  for (let day = 0; day < days; day += 1) {
    equities
      .flatMap((series, order) => {
        const cents = series[day];
        return cents === null || cents === undefined
          ? []
          : [{ order, bps: ratioBps(cents - capitalCents, capitalCents) ?? 0 }];
      })
      .sort((a, b) => b.bps - a.bps || a.order - b.order)
      .forEach(({ order }, i) => (ranks[order]![day] = i + 1));
  }
  return ranks;
}

// A cor e o traço de cada série dos gráficos (o de linhas, o de posição e a sparkline): a cor do laboratório pelos nomes do shadcn, que apontam
// para os tokens nos dois temas (`--chart-1` a `--chart-7`, globals.css; hexadecimal no atributo não seguiria o tema), e o traço que diz o
// tipo sem depender da cor: o Sorteio tracejado e as referências pontilhadas (a identidade da linha também vem do logo e do nome).
const CHART: Record<Laboratorio, string> = {
  openai: 'var(--chart-1)',
  anthropic: 'var(--chart-2)',
  google: 'var(--chart-3)',
  xai: 'var(--chart-4)',
  deepseek: 'var(--chart-5)',
  qwen: 'var(--chart-6)',
};
export function serieDe(competitor: { slug: string; type: string; modelId: string | null }): {
  cor: string;
  traco: '6 4' | '2 3' | undefined;
} {
  const lab = labOf(competitor);
  return {
    cor: lab ? CHART[lab] : 'var(--chart-7)',
    traco: competitor.type === 'RANDOM' ? '6 4' : competitor.type === 'MODEL' ? undefined : '2 3',
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

// A data do eixo que a pílula do cursor cobriria (o gráfico do patrimônio esconde o rótulo enquanto o cursor está à vista): as duas caixas em
// px, a do rótulo pela âncora dele (o começo, o meio ou o fim: as pontas se alinham para dentro do desenho) e a da pílula centrada no cursor.
// Elas se tocam quando ficam a menos da folga uma da outra. A distância entre os pontos de âncora não basta: o rótulo da ponta direita vai de
// x − largura a x.
export function rotuloCoberto(
  rotulo: { x: number; anchor: 'start' | 'middle' | 'end'; largura: number },
  pilula: { x: number; largura: number },
  folga = 4,
): boolean {
  const left =
    rotulo.anchor === 'start'
      ? rotulo.x
      : rotulo.anchor === 'middle'
        ? rotulo.x - rotulo.largura / 2
        : rotulo.x - rotulo.largura;
  return (
    left < pilula.x + pilula.largura / 2 + folga &&
    left + rotulo.largura > pilula.x - pilula.largura / 2 - folga
  );
}
