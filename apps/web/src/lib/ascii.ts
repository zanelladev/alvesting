// O ASCII que carrega dado (ADR 0034): o porte do `packages/config/ascii.ts` da v1 (código do Artur), só com o que a v2 usa. Decorativo
// por definição: quem desenha marca `aria-hidden` e dá o mesmo dado em texto ao lado.
// ponytail: da v1 ficaram de fora o `sparkline`, o `uptimeBars`, o `allocationBar` e o cubo isométrico (nenhuma tela da v2 os usa); vêm
// com a tela que precisar deles, com os testes da v1 (ascii.test.mjs).

// A direção de um valor, sempre com o glifo: sob protanopia o verde e o vermelho convergem, e a cor sozinha não diz nada.
export const GLYPH = { up: '▲', down: '▼', flat: '■' } as const;
export const glyphOf = (value: number): string =>
  value > 0 ? GLYPH.up : value < 0 ? GLYPH.down : GLYPH.flat;

// Os oito níveis de uma célula, do mais baixo ao cheio.
const SPARK = '▁▂▃▄▅▆▇█';

// Um gráfico em blocos: camadas na mesma grade, um tom cada; quem desenha empilha na ordem, e a de cima cobre a de baixo.
export interface BlockChart {
  layers: { tone: 'ink' | 'soft'; lines: string[] }[];
}

// O glifo da linha `r` (0 em cima) de uma coluna cheia até `level` oitavos.
function cell(level: number, r: number, rows: number): string {
  const fill = level - (rows - 1 - r) * 8;
  return fill >= 8 ? SPARK[7]! : fill > 0 ? SPARK[fill - 1]! : ' ';
}

// A linha onde mora o topo de uma coluna cheia até `level` oitavos (≥ 1).
const crest = (level: number, rows: number) => rows - 1 - Math.floor((level - 1) / 8);

// A curva com área (o `trend` da faixa de números do Arc): a série reamostrada em `cols` colunas com 8 níveis por linha, do mínimo ao
// máximo entre 10% e 90% da altura, e o ponto ● depois da última coluna. A tinta leva só a célula do topo de cada coluna; a área, no tom
// fraco, vem um oitavo abaixo e deixa de fora só o oitavo de cima: a linha sai com espessura constante, como o traço de um SVG.
export function areaChart(series: readonly number[], cols = 34, rows = 4): BlockChart {
  const n = series.length;
  const all = [...Array(rows).keys()];
  if (n === 0) {
    return {
      layers: [
        { tone: 'ink', lines: all.map(() => '') },
        { tone: 'soft', lines: all.map(() => '') },
      ],
    };
  }
  const lo = Math.min(...series);
  const span = Math.max(...series) - lo || 1;
  const levels = Array.from({ length: cols }, (_, i) => {
    const x = n > 1 ? (i * (n - 1)) / (cols - 1) : 0;
    const a = Math.floor(x);
    const v = series[a]! + (series[Math.min(a + 1, n - 1)]! - series[a]!) * (x - a);
    return Math.max(1, Math.round(rows * 8 * (0.1 + 0.8 * ((v - lo) / span))));
  });
  const end = crest(levels[cols - 1]!, rows);
  return {
    layers: [
      {
        tone: 'ink',
        lines: all.map(
          (r) =>
            levels.map((l) => (r === crest(l, rows) ? cell(l, r, rows) : ' ')).join('') +
            (r === end ? '●' : ' '),
        ),
      },
      {
        tone: 'soft',
        lines: all.map((r) => levels.map((l) => cell(l - 1, r, rows)).join('') + ' '),
      },
    ],
  };
}
