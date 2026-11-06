import { layoutCandles, layoutEquity, type Bar } from '../lib/chart';
import {
  formatBRL,
  formatBps,
  formatDate,
  formatPrice,
  formatReais,
  variationBps,
} from '../lib/format';
import { SimulatedTag } from './ui';

// Os gráficos SVG da arena, sem biblioteca (plano §3). A geometria vem de src/lib/chart.ts (testada); aqui só se desenha. Acessíveis: o
// SVG é uma imagem com título e descrição, e o mesmo dado vem em texto (a tabela do patrimônio, o resumo das barras). Monocromáticos:
// quem tem linha e quem tem vela cheia ou vazada se distingue sem cor.

const SIZE = { width: 360, height: 230 };
// O desenho escala o viewBox de 360 com a largura, e os rótulos junto: o teto de 24rem (384 px) segura o rótulo em uns 12,8 px no desktop
// (com os 32rem de antes ia a 17 px, maior que o texto ao lado), e no celular a figura entra 12 px no respiro do cartão de cada lado
// (FIGURE) para o desenho não encolher demais: 302 px de 360 de tela, o rótulo com uns 10 px (eram 9,3), e 11 px em 390.
const SVG_CLASS = 'h-auto w-full max-w-sm';
// O tamanho dos rótulos dos eixos, no sistema de coordenadas do viewBox. A margem esquerda de src/lib/chart.ts leva o maior rótulo do eixo
// y ("100.000") neste tamanho.
const LABEL_SIZE = 12;
// A figura: o desenho e, ao lado dele a partir de 1024 px, a legenda (ou o resumo das velas). Entre 768 e 1024 px a coluna ao lado ficava
// com uns 120 px e quebrava cada nome em duas linhas: ali a legenda fica embaixo, como no celular.
const FIGURE =
  'space-y-2 max-sm:-mx-3 lg:grid lg:grid-cols-[24rem_1fr] lg:items-start lg:gap-6 lg:space-y-0';

// Oito estilos de linha (a tinta e o cinza do texto, cheia, tracejada, pontilhada e traço-ponto): com cor só, não dá para ler o gráfico em
// preto e branco nem com daltonismo, e a v2 tem mais linhas que as cinco cores de série do sistema (docs/TELAS.md, "Sistema visual"). O
// texto da legenda e a tabela dizem quem é quem. Hexadecimal, e não a variável do tema: o atributo do SVG não passa pelo Tailwind.
const INK = '#f5f5f5';
const BODY = '#a3a3a3';
const LINE_STYLES = [
  { stroke: INK, width: 2.5, dash: undefined },
  { stroke: INK, width: 2, dash: '7 4' },
  { stroke: INK, width: 2.5, dash: '2 3' },
  { stroke: INK, width: 2, dash: '10 3 2 3' },
  { stroke: BODY, width: 1.5, dash: undefined },
  { stroke: BODY, width: 1.5, dash: '7 4' },
  { stroke: BODY, width: 1.5, dash: '2 3' },
  { stroke: BODY, width: 1.5, dash: '10 3 2 3' },
] as const;
const AXIS = '#2e2e2e';

const TEXT = 'fill-muted font-mono';

export interface EquityChartProps {
  // prefixo dos ids do título e da descrição: único na página
  id: string;
  dates: readonly string[];
  // `simulated`: o modelo da arena simulada leva a etiqueta na legenda, como no ranking (ui.tsx, SimulatedTag)
  series: ReadonlyArray<{
    slug: string;
    name: string;
    cents: readonly number[];
    simulated?: boolean;
  }>;
  band: { p5: readonly number[]; p95: readonly number[] } | null;
}

export function EquityChart({ id, dates, series, band }: EquityChartProps) {
  const layout = layoutEquity(
    { dates, series: series.map((s) => ({ key: s.slug, cents: s.cents })), band },
    SIZE,
  );
  const { plot } = layout;
  const description =
    `Patrimônio em reais por pregão, de ${formatDate(dates[0]!)} a ${formatDate(dates.at(-1)!)}. ` +
    series.map((s) => `${s.name} termina em ${formatBRL(s.cents.at(-1)!)}`).join('; ') +
    '.' +
    (band
      ? ' A faixa cinza vai do percentil 5 ao 95 das carteiras aleatórias do Monte Carlo.'
      : '');

  return (
    // aria-label: sem ele a figura tomaria o nome do figcaption, que traz a legenda inteira
    <figure aria-label="Patrimônio por pregão" className={FIGURE}>
      <svg
        viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
        focusable="false"
        className={SVG_CLASS}
      >
        <title id={`${id}-title`}>Patrimônio por pregão</title>
        <desc id={`${id}-desc`}>{description}</desc>
        {layout.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={tick.y}
              y2={tick.y}
              className="stroke-hairline-strong"
              strokeWidth={0.5}
              strokeDasharray="2 3"
            />
            <text
              x={plot.left - 6}
              y={tick.y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={LABEL_SIZE}
              className={TEXT}
            >
              {formatReais(tick.value)}
            </text>
          </g>
        ))}
        {layout.band ? <path data-band d={layout.band.d} className="fill-surface-strong" /> : null}
        {layout.lines.map((line, i) => {
          const style = LINE_STYLES[i % LINE_STYLES.length]!;
          return (
            <g key={line.key}>
              <path
                data-series={line.key}
                d={line.d}
                fill="none"
                stroke={style.stroke}
                strokeWidth={style.width}
                strokeDasharray={style.dash}
              />
              <circle cx={line.end.x} cy={line.end.y} r={3} fill={style.stroke} />
            </g>
          );
        })}
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke={AXIS} />
        {layout.xLabels.map((label) => (
          <text
            key={label.label}
            x={label.x}
            y={plot.bottom + 14}
            textAnchor={label.anchor}
            fontSize={LABEL_SIZE}
            className={TEXT}
          >
            {label.label}
          </text>
        ))}
      </svg>

      {/* a tabela equivalente do gráfico, para o leitor de tela. Dentro de um bloco sr-only: o sr-only direto na <table> não recorta
          (a tabela não encolhe abaixo do conteúdo) e alargaria a página. Vem antes da legenda: o figcaption só pode ser o primeiro ou
          o último filho do figure */}
      <div className="sr-only">
        <table>
          <caption>Dados do gráfico: patrimônio por pregão</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              {series.map((s) => (
                <th key={s.slug} scope="col">
                  {s.name}
                </th>
              ))}
              {band ? (
                <>
                  <th scope="col">Monte Carlo p5</th>
                  <th scope="col">Monte Carlo p95</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {dates.map((date, i) => (
              <tr key={date}>
                <th scope="row">{formatDate(date)}</th>
                {series.map((s) => (
                  <td key={s.slug}>{formatBRL(s.cents[i]!)}</td>
                ))}
                {band ? (
                  <>
                    <td>{formatBRL(band.p5[i]!)}</td>
                    <td>{formatBRL(band.p95[i]!)}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="space-y-2">
        <p className="muted">Patrimônio em R$, no fechamento de cada pregão.</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col">
          {series.map((s, i) => {
            const style = LINE_STYLES[i % LINE_STYLES.length]!;
            return (
              <li key={s.slug} className="flex items-center gap-2">
                <svg width="28" height="8" aria-hidden="true" focusable="false">
                  <line
                    x1="0"
                    x2="28"
                    y1="4"
                    y2="4"
                    stroke={style.stroke}
                    strokeWidth={style.width}
                    strokeDasharray={style.dash}
                  />
                </svg>
                {s.name}
                {s.simulated ? <SimulatedTag /> : null}
              </li>
            );
          })}
          {band ? (
            <li className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-7 border border-hairline-strong bg-surface-strong"
              />
              Faixa p5 a p95 do Monte Carlo
            </li>
          ) : null}
        </ul>
      </figcaption>
    </figure>
  );
}

// As barras recentes de uma ação, em velas. Cotação (brapi.dev): o desenho e o resumo em texto, e nenhuma tabela de preços (a tabela
// entregaria a série inteira a quem raspasse a página; docs/API.md, seção 6). Por isso o texto alternativo é um resumo, e não uma tabela
// como a do patrimônio. A partir de 1024 px, o resumo fica ao lado do desenho, como a legenda do patrimônio.
export function CandlesChart({ ticker, bars }: { ticker: string; bars: readonly Bar[] }) {
  const layout = layoutCandles(bars, SIZE);
  const { plot } = layout;
  const firstBar = bars[0]!;
  const lastBar = bars.at(-1)!;
  const low = Math.min(...bars.map((bar) => bar.lowCents));
  const high = Math.max(...bars.map((bar) => bar.highCents));
  const variation =
    firstBar.closeCents > 0
      ? ` (${formatBps(variationBps(lastBar.closeCents, firstBar.closeCents))})`
      : '';
  const summary =
    `${bars.length} pregões, de ${formatDate(firstBar.date)} a ${formatDate(lastBar.date)}: ` +
    `fechamento de ${formatBRL(firstBar.closeCents)} para ${formatBRL(lastBar.closeCents)}${variation}, ` +
    `mínima de ${formatBRL(low)} e máxima de ${formatBRL(high)}.`;

  return (
    <figure aria-label={`Velas diárias de ${ticker}`} className={FIGURE}>
      <svg
        viewBox={`0 0 ${SIZE.width} ${SIZE.height}`}
        role="img"
        aria-labelledby={`velas-${ticker}-title velas-${ticker}-desc`}
        focusable="false"
        className={SVG_CLASS}
      >
        <title id={`velas-${ticker}-title`}>{`Velas diárias de ${ticker}`}</title>
        <desc id={`velas-${ticker}-desc`}>{summary}</desc>
        {layout.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={tick.y}
              y2={tick.y}
              className="stroke-hairline-strong"
              strokeWidth={0.5}
              strokeDasharray="2 3"
            />
            <text
              x={plot.left - 6}
              y={tick.y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={LABEL_SIZE}
              className={TEXT}
            >
              {formatPrice(tick.value)}
            </text>
          </g>
        ))}
        {layout.candles.map((candle, i) => (
          <g key={bars[i]!.date} data-candle>
            <line
              x1={candle.x}
              x2={candle.x}
              y1={candle.wickTop}
              y2={candle.wickBottom}
              stroke={BODY}
              strokeWidth={1}
            />
            {/* alta vazada na tinta, baixa cheia no cinza do texto */}
            <rect
              x={candle.x - layout.candleWidth / 2}
              y={candle.bodyTop}
              width={layout.candleWidth}
              height={candle.bodyHeight}
              stroke={candle.up ? INK : BODY}
              strokeWidth={1}
              className={candle.up ? 'fill-canvas' : 'fill-body'}
            />
          </g>
        ))}
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke={AXIS} />
        {layout.xLabels.map((label) => (
          <text
            key={label.label}
            x={label.x}
            y={plot.bottom + 14}
            textAnchor={label.anchor}
            fontSize={LABEL_SIZE}
            className={TEXT}
          >
            {label.label}
          </text>
        ))}
      </svg>
      <figcaption className="space-y-1 text-sm">
        <p data-testid="resumo-barras">{summary}</p>
        <p className="text-muted">
          Vela vazada: fechou na abertura ou acima; cheia: fechou abaixo. Preços em reais.
        </p>
      </figcaption>
    </figure>
  );
}
