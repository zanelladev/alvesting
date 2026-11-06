import type { InternalBar } from '@alvesting/contracts';
import { xLabelsOf, yScale, type Plot } from '../lib/chart';
import { formatBRL, formatBps, formatDate, formatPrice, variationBps } from '../lib/format';
import { direction } from './ui';

// O desenho adaptado da beUI (https://beui.dev/charts/candlestick-chart; registro https://beui.dev/r/candlestick-chart, lido em 05/11/2026),
// Copyright (c) 2026 Saurabh Chauhan, licença MIT (o texto inteiro em components/beui/LICENSE): veio de lá o visual, nenhum código da peça
// (o dela é de cliente, com o Motion). O que mudou está em docs/DEPENDENCIAS.md, "Componentes copiados de registros".
//
// As velas da página da ação, no visual do Candlestick Chart da beUI (ADR 0037; o pavio fino, o corpo, a grade tracejada, os preços no eixo da
// direita e a linha do último preço com a etiqueta), desenhadas NO SERVIDOR. A regra das cotações (ADR 0033; docs/TELAS.md, seção 4): a
// série de preços nunca vai como dado para o navegador. O que sai é o desenho (as coordenadas do SVG), o resumo em texto (o primeiro e o
// último fechamento, a mínima e a máxima: a alternativa para o leitor de tela, sem tabela de preços), os marcos redondos do eixo e o último
// fechamento na etiqueta. Por isso este é um componente de servidor, sem 'use client': nada daqui chega ao navegador como prop. A leitura
// das quatro cotações de cada dia pelo cursor (o Candlestick da beUI como componente de cliente) ficou de fora, por decisão sobre o ADR
// 0033; o volume também (a rota interna não o entrega, e o do banco é estimado). O realce de um pregão é CSS (globals.css, bloco do
// explorar): uma coluna por vela, que só mostra a data, sem parada de Tab.

// O desenho: o viewBox de 1000 de largura estica só na horizontal (`preserveAspectRatio="none"`), na altura fixa em px, e o traço não escala
// (`vector-effect`); os rótulos são HTML por cima, em % da largura e em px da altura, como no gráfico do patrimônio.
const ALTURA_VELAS = 280;
const LARGURA = 1000;
// o respiro de cima e de baixo, dentro do desenho (a escala já tem a folga de 6%)
const RESPIRO = 8;
// o marco do eixo a menos que isto da etiqueta do último preço some (a linha da grade dele fica): a etiqueta tem uns 20 px de altura (o texto
// de 11 px com a entrelinha e o respiro) e o marco uns 16, centrados na mesma coluna, e mais perto que isso as duas caixas se tocam
const PERTO_DA_ETIQUETA = 20;
// as colunas das pontas: a data do realce se alinha para dentro (a etiqueta dela tem uns 80 px, e a coluna, uns 5 a 12)
const PONTA = 6;

const round1 = (n: number) => Math.round(n * 10) / 10;

interface VelasLayout {
  // a largura do corpo, nas unidades do viewBox
  corpo: number;
  velas: Array<{
    x: number;
    up: boolean;
    wickTop: number;
    wickBottom: number;
    bodyTop: number;
    bodyHeight: number;
  }>;
  yTicks: Array<{ value: number; y: number }>;
  ultimo: { cents: number; y: number };
  // as datas do eixo, em % da largura
  xLabels: ReturnType<typeof xLabelsOf>;
}

// A geometria (função pura): uma coluna por pregão, a vela no meio dela; a escala vai da menor mínima à maior máxima, na altura do desenho.
export function layoutVelas(bars: readonly InternalBar[]): VelasLayout {
  if (bars.length === 0) throw new RangeError('gráfico sem nenhuma barra');
  const plot: Plot = { left: 0, top: RESPIRO, right: LARGURA, bottom: ALTURA_VELAS - RESPIRO };
  const slot = LARGURA / bars.length;
  const xOf = (index: number) => (index + 0.5) * slot;
  const { yOf, yTicks } = yScale(
    bars.flatMap((bar) => [bar.highCents, bar.lowCents]),
    plot,
  );
  const last = bars.at(-1)!;
  return {
    corpo: round1(slot * 0.6),
    velas: bars.map((bar, i) => {
      const bodyTop = yOf(Math.max(bar.openCents, bar.closeCents));
      const bodyBottom = yOf(Math.min(bar.openCents, bar.closeCents));
      return {
        x: round1(xOf(i)),
        up: bar.closeCents >= bar.openCents,
        wickTop: round1(yOf(bar.highCents)),
        wickBottom: round1(yOf(bar.lowCents)),
        bodyTop: round1(bodyTop),
        // pelo menos 1 px: a vela sem variação (a abertura igual ao fechamento) continua visível
        bodyHeight: Math.max(1, round1(bodyBottom - bodyTop)),
      };
    }),
    yTicks,
    ultimo: { cents: last.closeCents, y: round1(yOf(last.closeCents)) },
    xLabels: xLabelsOf(
      bars.map((bar) => bar.date),
      xOf,
    ).map((label) => ({ ...label, x: round1(label.x / 10) })),
  };
}

// O resumo em texto (o que o leitor de tela lê no lugar do desenho, e o que a figura diz embaixo dele): o período, o primeiro e o último
// fechamento com a variação, a mínima e a máxima. Nunca a série.
function resumo(bars: readonly InternalBar[]): string {
  const first = bars[0]!;
  const last = bars.at(-1)!;
  const low = formatBRL(Math.min(...bars.map((bar) => bar.lowCents)));
  const high = formatBRL(Math.max(...bars.map((bar) => bar.highCents)));
  if (bars.length === 1) {
    return `1 pregão, em ${formatDate(first.date)}: fechamento de ${formatBRL(last.closeCents)}, mínima de ${low} e máxima de ${high}.`;
  }
  const variation =
    first.closeCents > 0 ? ` (${formatBps(variationBps(last.closeCents, first.closeCents))})` : '';
  return (
    `${bars.length} pregões, de ${formatDate(first.date)} a ${formatDate(last.date)}: ` +
    `fechamento de ${formatBRL(first.closeCents)} para ${formatBRL(last.closeCents)}${variation}, ` +
    `mínima de ${low} e máxima de ${high}.`
  );
}

const ANCORA = {
  start: '',
  middle: '-translate-x-1/2',
  end: '-translate-x-full',
} as const;

// As velas de uma ação. Cotação (brapi.dev): o desenho e o resumo em texto, e nenhuma tabela de preços (ela entregaria a série inteira a
// quem raspasse a página; docs/API.md, seção 6). A alta é vazada (fechou na abertura ou acima) e a queda é cheia, nas cores do dado: a forma
// diz a direção sem depender da cor (WCAG 1.4.1). A cor vai por classe, que lê o token do tema: o hexadecimal no atributo não seguiria o tema.
export function Velas({ ticker, bars }: { ticker: string; bars: readonly InternalBar[] }) {
  const layout = layoutVelas(bars);
  const summary = resumo(bars);
  const last = bars.at(-1)!;
  const titulo = `velas-${ticker}-titulo`;
  const descricao = `velas-${ticker}-resumo`;
  // os marcos do eixo, sem os que a etiqueta do último preço cobriria (a linha da grade de cada um fica)
  const marcos = layout.yTicks.filter(
    (tick) => Math.abs(tick.y - layout.ultimo.y) >= PERTO_DA_ETIQUETA,
  );
  // a coluna dos preços tem a largura do rótulo mais longo (algarismos tabulares: `ch` é a largura de um deles) e o respiro da etiqueta
  const rotulos = [...marcos.map((tick) => tick.value), layout.ultimo.cents].map(formatPrice);
  const eixo = `calc(${Math.max(...rotulos.map((rotulo) => rotulo.length))}ch + 0.875rem)`;
  return (
    <figure aria-label={`Velas diárias de ${ticker}`} className="min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2">
        {/* a altura em px, a da escala: em rem ela cresceria com a fonte padrão do navegador, e o desenho esticaria longe dos marcos do eixo,
            que ficam em px */}
        <div className="relative border-b border-hairline" style={{ height: ALTURA_VELAS }}>
          <svg
            viewBox={`0 0 ${LARGURA} ${ALTURA_VELAS}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${titulo} ${descricao}`}
            focusable="false"
            className="absolute inset-0 size-full overflow-visible"
          >
            <title id={titulo}>{`Velas diárias de ${ticker}`}</title>
            <desc id={descricao}>{summary}</desc>
            {layout.yTicks.map((tick, i) => (
              <line
                key={i}
                x1={0}
                x2={LARGURA}
                y1={tick.y}
                y2={tick.y}
                className="stroke-hairline-strong"
                strokeDasharray="2 6"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {layout.velas.map((vela, i) => (
              <g
                key={bars[i]!.date}
                data-candle
                className={
                  vela.up
                    ? 'vela-alta fill-canvas stroke-data-up'
                    : 'vela-baixa fill-data-down stroke-data-down'
                }
              >
                <line
                  x1={vela.x}
                  x2={vela.x}
                  y1={vela.wickTop}
                  y2={vela.wickBottom}
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={round1(vela.x - layout.corpo / 2)}
                  y={vela.bodyTop}
                  width={layout.corpo}
                  height={vela.bodyHeight}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
            {/* a linha do último preço, tracejada, na tinta a 45% (a da beUI) */}
            <line
              data-ultimo="true"
              x1={0}
              x2={LARGURA}
              y1={layout.ultimo.y}
              y2={layout.ultimo.y}
              className="stroke-ink"
              strokeOpacity={0.45}
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {/* o realce de um pregão (CSS, no hover): a coluna dele fica clara, as outras recuam, e a data aparece no eixo de baixo */}
          <div
            aria-hidden="true"
            className="velas-colunas absolute inset-0 grid"
            style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}
          >
            {bars.map((bar, i) => (
              <span
                key={bar.date}
                data-data={formatDate(bar.date)}
                // a metade de cá da ponta direita se alinha pelo fim (com poucos pregões, as duas pontas se encontram)
                data-ponta={
                  i >= bars.length - PONTA && i >= bars.length / 2
                    ? 'fim'
                    : i < PONTA
                      ? 'inicio'
                      : undefined
                }
              />
            ))}
          </div>
        </div>
        {/* o eixo dos preços, à direita, como o da beUI: os marcos e a etiqueta do último fechamento */}
        <div aria-hidden="true" className="relative text-11 tabular-nums" style={{ width: eixo }}>
          {marcos.map((tick, i) => (
            <span
              key={i}
              className="absolute right-0 -translate-y-1/2 text-muted"
              style={{ top: tick.y }}
            >
              {formatPrice(tick.value)}
            </span>
          ))}
          <span
            className="velas-etiqueta absolute right-0 -translate-y-1/2 rounded-md bg-ink px-1.5 py-0.5 font-medium text-canvas"
            style={{ top: layout.ultimo.y }}
          >
            {formatPrice(layout.ultimo.cents)}
          </span>
        </div>
        {/* as datas embaixo, em % da largura: no celular só a primeira, a do meio e a última */}
        <div aria-hidden="true" className="relative h-7 text-11 text-muted tabular-nums">
          {layout.xLabels.map((label) => (
            <span
              key={label.label}
              className={`absolute top-2 whitespace-nowrap ${ANCORA[label.anchor]} ${label.minor ? 'max-sm:hidden' : ''}`}
              style={{ left: `${label.x}%` }}
            >
              {label.label}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 space-y-1 text-13 text-body">
        <p data-testid="resumo-barras">{summary}</p>
        <p className="text-muted">
          Vela vazada: fechou na abertura ou acima; cheia: fechou abaixo. Preços em reais.
        </p>
        <p className="text-muted">Cotações: brapi.dev, pregão de {formatDate(last.date)}.</p>
      </figcaption>
    </figure>
  );
}

// O cabeçalho do terminal: o último fechamento e a variação sobre o pregão anterior, com o glifo (a Regra do Glifo: a cor vai só nele), a
// data do dado e o crédito. O fechamento anterior não aparece (só a variação): o resto da série fica no desenho.
export function UltimoFechamento({ bars }: { bars: readonly InternalBar[] }) {
  const last = bars.at(-1);
  if (!last) return null;
  const previous = bars.at(-2);
  const change =
    previous && previous.closeCents > 0 ? variationBps(last.closeCents, previous.closeCents) : null;
  return (
    <div className="min-w-0 space-y-1">
      <dl className="flex flex-wrap items-baseline gap-x-3">
        <dt className="sr-only">Último fechamento</dt>
        <dd className="font-display text-26 text-ink tabular-nums">{formatBRL(last.closeCents)}</dd>
        {change === null ? null : (
          <>
            <dt className="sr-only">Variação sobre o pregão anterior</dt>
            <dd data-dir={direction(change)} className="text-15 font-medium text-ink tabular-nums">
              {formatBps(change)}
            </dd>
          </>
        )}
      </dl>
      <p className="text-13 text-muted">
        Fechamento do pregão de {formatDate(last.date)}
        {change === null ? '.' : ', com a variação sobre o anterior.'} Cotações: brapi.dev.
      </p>
    </div>
  );
}
