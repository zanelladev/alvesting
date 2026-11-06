import type { PublicCompetitor } from '@alvesting/contracts';
import { layoutCandles, layoutEquity, spreadLabels, type Bar } from '../lib/chart';
import { formatBRL, formatBps, formatDate, formatPrice, variationBps } from '../lib/format';
import { labOf, type Laboratorio } from '../lib/laboratorio';
import { Logo } from './competidor';
import { SimulatedTag } from './ui';

// Os gráficos SVG da arena, sem biblioteca (plano §3). A geometria vem de src/lib/chart.ts (testada); aqui só se desenha. Acessíveis: o
// SVG é uma imagem com título e descrição, e o mesmo dado vem em texto (a tabela do patrimônio, o resumo das barras). A cor vai por
// classe, que lê a variável do tema (globals.css): o hexadecimal no atributo do SVG não segue o tema (no claro a linha ficaria branca no
// branco).

// As velas: o viewBox de 360 escala com a largura, e os rótulos junto: o teto de 24rem (384 px) segura o rótulo em uns 12,8 px no desktop,
// e no celular a figura entra 12 px no respiro do cartão de cada lado (FIGURE) para o desenho não encolher demais.
const SIZE = { width: 360, height: 230 };
const SVG_CLASS = 'h-auto w-full max-w-sm';
// O tamanho dos rótulos dos eixos das velas, no sistema de coordenadas do viewBox. A margem esquerda de src/lib/chart.ts leva o maior
// rótulo do eixo y ("100.000") neste tamanho.
const LABEL_SIZE = 12;
// A figura das velas: o desenho e, ao lado dele a partir de 1024 px, o resumo. Entre 768 e 1024 px a coluna ao lado ficava com uns 120 px:
// ali o resumo fica embaixo, como no celular.
const FIGURE =
  'space-y-2 max-sm:-mx-3 lg:grid lg:grid-cols-[24rem_1fr] lg:items-start lg:gap-6 lg:space-y-0';
const STROKE = { ink: 'stroke-ink', body: 'stroke-body' } as const;
const AXIS = 'stroke-hairline-strong';
const TEXT = 'fill-muted font-mono';

// --- patrimônio -----------------------------------------------------------------------------------------------------------------
// O gráfico do Rallies (plano do redesenho, e.4): uma linha por competidor na cor do laboratório, a grade tracejada, as datas embaixo e,
// no fim de cada linha, o logo num círculo com o anel da cor e o patrimônio final numa pílula da mesma cor. A ALTURA é fixa (280 px) e a
// largura acompanha a coluna: o SVG estica só na horizontal (preserveAspectRatio="none", com o traço que não escala), então a altura em
// px é a do viewBox, e os rótulos (o do fim da linha e as datas, em HTML por cima, posicionados em % da largura e em px da altura) caem
// onde a linha termina em qualquer largura, sem encavalar (spreadLabels, em lib/chart.ts). A identidade da linha não depende da cor: o
// logo no fim, o nome e o traço na legenda (o Sorteio, tracejado) e a tabela para o leitor de tela.
const VIEW = { width: 1000, height: 280 };
// sem rótulo dentro do SVG: a linha vai de uma borda à outra, com respiro de meia pílula em cima e embaixo
const PLOT_MARGIN = { left: 0, top: 14, right: 0, bottom: 14 };
// a altura da pílula do fim da linha (20 px) e o respiro entre duas
const LABEL_GAP = 24;
// a posição no desenho, em % da largura (o SVG estica na horizontal; o HTML por cima acompanha)
const pct = (x: number) => `${(x / VIEW.width) * 100}%`;

// As séries por laboratório (globals.css, `--color-serie-*`), escritas por inteiro para o Tailwind as achar. O Sorteio, as referências e
// o modelo sem laboratório conhecido ficam com a neutra.
type Serie = Laboratorio | 'neutra';
const SERIE: Record<Serie, { stroke: string; bg: string; border: string }> = {
  openai: { stroke: 'stroke-serie-openai', bg: 'bg-serie-openai', border: 'border-serie-openai' },
  anthropic: {
    stroke: 'stroke-serie-anthropic',
    bg: 'bg-serie-anthropic',
    border: 'border-serie-anthropic',
  },
  google: { stroke: 'stroke-serie-google', bg: 'bg-serie-google', border: 'border-serie-google' },
  xai: { stroke: 'stroke-serie-xai', bg: 'bg-serie-xai', border: 'border-serie-xai' },
  deepseek: {
    stroke: 'stroke-serie-deepseek',
    bg: 'bg-serie-deepseek',
    border: 'border-serie-deepseek',
  },
  qwen: { stroke: 'stroke-serie-qwen', bg: 'bg-serie-qwen', border: 'border-serie-qwen' },
  neutra: { stroke: 'stroke-serie-neutra', bg: 'bg-serie-neutra', border: 'border-serie-neutra' },
};

type CompetidorData = Pick<PublicCompetitor, 'slug' | 'name' | 'type' | 'provider' | 'modelId'>;

export interface EquityChartProps {
  // prefixo dos ids do título e da descrição: único na página
  id: string;
  dates: readonly string[];
  // `simulated`: o modelo da arena simulada leva a etiqueta na legenda, como no ranking (ui.tsx, SimulatedTag). `competitor`: o tipo e o
  // modelo, de onde saem o laboratório (a cor e o logo) e o traço do Sorteio; sem ele, o laboratório sai do slug
  series: ReadonlyArray<{
    slug: string;
    name: string;
    cents: readonly number[];
    simulated?: boolean;
    competitor?: CompetidorData;
  }>;
  band: { p5: readonly number[]; p95: readonly number[] } | null;
}

export function EquityChart({ id, dates, series, band }: EquityChartProps) {
  const layout = layoutEquity(
    { dates, series: series.map((s) => ({ key: s.slug, cents: s.cents })), band },
    VIEW,
    PLOT_MARGIN,
  );
  const lines = series.map((s, i) => {
    const who = s.competitor ?? {
      slug: s.slug,
      name: s.name,
      type: 'MODEL' as const,
      provider: null,
      modelId: null,
    };
    return {
      ...s,
      who,
      line: layout.lines[i]!,
      serie: SERIE[labOf(who) ?? 'neutra'],
      dashed: who.type === 'RANDOM',
    };
  });
  const labelY = spreadLabels(
    lines.map((l) => l.line.end.y),
    LABEL_GAP,
    0,
    VIEW.height,
  );
  const description =
    `Patrimônio em reais por pregão, de ${formatDate(dates[0]!)} a ${formatDate(dates.at(-1)!)}. ` +
    series.map((s) => `${s.name} termina em ${formatBRL(s.cents.at(-1)!)}`).join('; ') +
    '.' +
    (band
      ? ' A faixa cinza vai do percentil 5 ao 95 das carteiras aleatórias do Monte Carlo.'
      : '');

  return (
    // aria-label: sem ele a figura tomaria o nome do figcaption, que traz a legenda inteira
    <figure aria-label="Patrimônio por pregão" className="space-y-4">
      {/* a calha da direita é a das pílulas do fim da linha (o logo tem metade dentro do desenho) */}
      <div className="mr-30">
        <div className="relative h-70">
          <svg
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${id}-title ${id}-desc`}
            focusable="false"
            className="absolute inset-0 size-full overflow-visible"
          >
            <title id={`${id}-title`}>Patrimônio por pregão</title>
            <desc id={`${id}-desc`}>{description}</desc>
            {layout.yTicks.map((tick) => (
              <line
                key={tick.value}
                x1={0}
                x2={VIEW.width}
                y1={tick.y}
                y2={tick.y}
                className={AXIS}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1={0}
              x2={0}
              y1={0}
              y2={VIEW.height}
              className={AXIS}
              vectorEffect="non-scaling-stroke"
            />
            {layout.band ? (
              <path data-band d={layout.band.d} className="fill-surface-strong" />
            ) : null}
            {lines.map(({ slug, line, serie, dashed }) => (
              <path
                key={slug}
                data-series={slug}
                d={line.d}
                fill="none"
                className={serie.stroke}
                strokeWidth={2}
                strokeDasharray={dashed ? '6 4' : undefined}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {/* o ponto do fim de cada linha, em HTML (um círculo no SVG esticado viraria elipse): com uma data só a linha é só ele */}
          <div aria-hidden="true">
            {lines.map(({ slug, line, serie }) => (
              <span
                key={slug}
                data-ponto={slug}
                className={`absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${serie.bg}`}
                style={{ left: pct(line.end.x), top: `${line.end.y}px` }}
              />
            ))}
          </div>
          {/* o fim de cada linha: o logo e o patrimônio final. Decorativo para o leitor de tela, que tem o mesmo valor na descrição e na
              tabela. O logo fica centrado no fim da linha (na borda direita do desenho), e a pílula na calha; com uma data só, o rótulo fica
              logo depois do ponto. */}
          <ul aria-hidden="true">
            {lines.map(({ slug, who, cents, serie, line }, i) => (
              <li
                key={slug}
                data-rotulo={slug}
                className={`absolute flex -translate-y-1/2 items-center gap-1 ${dates.length === 1 ? 'translate-x-2' : '-translate-x-2.5'}`}
                style={{ left: pct(line.end.x), top: `${labelY[i]}px` }}
              >
                <Logo competitor={who} className={`size-5 border-2 bg-canvas ${serie.border}`} />
                <span
                  className={`rounded-full px-1.5 text-11 leading-5 font-medium whitespace-nowrap text-canvas tabular-nums ${serie.bg}`}
                >
                  {formatBRL(cents.at(-1)!)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {/* as datas, embaixo: a primeira e a última alinhadas para dentro; no celular, só a primeira, a do meio e a última */}
        <div aria-hidden="true" className="relative mt-2 h-5 text-13 text-muted">
          {layout.xLabels.map((label) => (
            <span
              key={label.label}
              className={`absolute whitespace-nowrap ${label.anchor === 'middle' ? '-translate-x-1/2' : label.anchor === 'end' ? '-translate-x-full' : ''} ${label.minor ? 'max-sm:hidden' : ''}`}
              style={{ left: pct(label.x) }}
            >
              {label.label}
            </span>
          ))}
        </div>
      </div>

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
        {/* o traço e o logo do fim da linha (o mesmo anel da cor da série) antes do nome: o elo entre a linha e o nome não depende só da cor */}
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-13">
          {lines.map(({ slug, name, who, simulated, serie, dashed }) => (
            <li key={slug} className="flex items-center gap-2">
              <svg width="20" height="8" aria-hidden="true" focusable="false">
                <line
                  x1="0"
                  x2="20"
                  y1="4"
                  y2="4"
                  className={serie.stroke}
                  strokeWidth={2}
                  strokeDasharray={dashed ? '6 4' : undefined}
                />
              </svg>
              <Logo competitor={who} className={`size-5 border-2 bg-canvas ${serie.border}`} />
              {name}
              {simulated ? <SimulatedTag /> : null}
            </li>
          ))}
          {band ? (
            <li className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-5 rounded-sm bg-surface-strong"
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
              className={STROKE.body}
              strokeWidth={1}
            />
            {/* alta vazada na tinta, baixa cheia no cinza do texto */}
            <rect
              x={candle.x - layout.candleWidth / 2}
              y={candle.bodyTop}
              width={layout.candleWidth}
              height={candle.bodyHeight}
              strokeWidth={1}
              className={candle.up ? 'fill-canvas stroke-ink' : 'fill-body stroke-body'}
            />
          </g>
        ))}
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} className={AXIS} />
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
