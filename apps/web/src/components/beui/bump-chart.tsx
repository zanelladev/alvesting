// Adaptado do Bump Chart da beUI (https://beui.dev/charts/bump-chart; registro https://beui.dev/r/bump-chart, lido em 05/11/2026; os arquivos
// `bump-chart.tsx` e `bump-chart/{context,model,plot,series,point,legend}.tsx`). Copyright (c) 2026 Saurabh Chauhan, licença MIT (o texto
// inteiro em components/beui/LICENSE).
// O que veio de lá: a posição de cada série em cada período, com a curva entre as posições (a cúbica com os pontos de controle no meio, do
// `bumpPath`), a escala que guarda a distância entre as posições, o número da posição em cada ponto, o nome no fim da linha, a legenda que
// fixa uma série (o botão com `aria-pressed`; o Esc solta), o realce da série sob o ponteiro e no foco do teclado (as outras recuam) e a tabela
// escondida com a posição de cada uma em cada período; o período que falta quebra a linha.
// O que mudou (ADR 0037): o desenho sai do servidor (o SVG no `viewBox` que estica só na horizontal, com o traço que não escala, e os pontos,
// os nomes e as datas em HTML por cima), e nada anda na abertura (a beUI desenha as curvas e cresce os pontos ao aparecer); o ponto de cada
// posição é decorativo, e não um botão (seriam dezenas de paradas de Tab de 28 px, abaixo dos 44 px do projeto): a legenda fixa a série e a
// tabela dá a posição exata; saíram o tooltip da beUI (o floating-ui), o Motion (o realce é uma transição de opacidade de 150 ms, do CSS) e o
// `cn`; as cores são as das séries (os `--chart-*`, com o Sorteio tracejado e as referências pontilhadas, lib/chart.ts) e os textos, em
// português; a caixa abre nos pregões mais novos (`dir="rtl"`), e o nome do fim é o curto (o das referências também), inteiro, numa calha
// dentro da área que rola. Com movimento reduzido, a regra global zera a transição.
'use client';

import { useState } from 'react';
import type { PublicCompetitor } from '@alvesting/contracts';
import { serieDe } from '../../lib/chart';
import { formatDate, formatShortDate } from '../../lib/format';
import { partesDoNome } from '../competidor';

type Competidor = Pick<PublicCompetitor, 'slug' | 'name' | 'type' | 'provider' | 'modelId'>;
export interface BumpChartSeries {
  competitor: Competidor;
  // uma posição por data (1 é o primeiro); o nulo é o pregão sem dado
  ranks: readonly (number | null)[];
}

// a largura do desenho no viewBox (estica só na horizontal) e a altura de cada posição, em px
const WIDTH = 1000;
const ROW = 32;
const PAD = 14;
const pct = (x: number) => `${(x / WIDTH) * 100}%`;
const ordinal = (rank: number) => `${rank}º`;

// A curva da beUI (`bumpPath`): de um ponto ao outro, os pontos de controle no meio do caminho, na altura de cada ponta; o período sem posição
// quebra a curva em vez de inventar a continuidade.
function bumpPath(points: ReadonlyArray<{ x: number; y: number } | null>): string {
  let path = '';
  let previous: { x: number; y: number } | null = null;
  for (const point of points) {
    if (!point) {
      previous = null;
      continue;
    }
    if (previous) {
      const middle = (previous.x + point.x) / 2;
      path += ` C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
    } else path += ` M ${point.x} ${point.y}`;
    previous = point;
  }
  return path.trim();
}

export function BumpChart({
  id,
  label,
  dates,
  series,
}: {
  id: string;
  label: string;
  dates: readonly string[];
  series: readonly BumpChartSeries[];
}) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const highlighted = hovered ?? pinned;

  const n = dates.length;
  const maxRank = Math.max(1, ...series.flatMap((s) => s.ranks.filter((r) => r !== null)));
  const plotHeight = Math.max(1, maxRank - 1) * ROW;
  const height = plotHeight + PAD * 2;
  const x = (i: number) => (n <= 1 ? WIDTH / 2 : (i / (n - 1)) * WIDTH);
  const y = (rank: number) =>
    maxRank === 1 ? PAD + plotHeight / 2 : PAD + ((rank - 1) / (maxRank - 1)) * plotHeight;
  const rows = series.map((s) => ({
    ...s,
    key: s.competitor.slug,
    ...serieDe(s.competitor),
    ...partesDoNome(s.competitor.name, s.competitor.type),
    points: s.ranks.map((rank, i) => (rank === null ? null : { x: x(i), y: y(rank), rank })),
    last: s.ranks.at(-1) ?? null,
  }));
  const finalOrder = rows
    .filter((r) => r.last !== null)
    .sort((a, b) => a.last! - b.last!)
    .map((r) => `${ordinal(r.last!)} ${r.competitor.name}`)
    .join(', ');
  const dim = (key: string) => (highlighted !== null && highlighted !== key ? 'opacity-25' : '');
  const clear = (event: { key: string }) => {
    if (event.key === 'Escape') {
      setPinned(null);
      setHovered(null);
    }
  };

  return (
    <figure aria-label={label} className="space-y-4">
      {/* A rolagem é da própria caixa (com nome e foco de teclado), nunca da página: com muitos pregões, o desenho passa da coluna. Ela abre
          no fim, nos pregões mais novos, como diz o nome dela: a caixa é `rtl` (a rolagem começa na ponta direita) e o conteúdo volta ao `ltr`.
          Só CSS. */}
      <div
        role="region"
        aria-label={`${label}: role para os pregões mais antigos`}
        tabIndex={0}
        dir="rtl"
        className="overflow-x-auto focus-visible:-outline-offset-2"
      >
        {/* 40 px por pregão no mínimo, mais o respiro de 20 px da esquerda e a calha de 128 px dos nomes na direita, que é respiro de dentro (a
            área que rola a inclui, e o nome do fim nunca fica cortado): cinco pregões cabem em 360 px sem rolar; com mais, a caixa rola */}
        <div
          dir="ltr"
          className="relative pr-32 pb-7 pl-5"
          style={{ minWidth: `calc(${Math.max(0, n * 40)}px + 9.25rem)` }}
        >
          <div className="relative" style={{ height }}>
            <svg
              viewBox={`0 0 ${WIDTH} ${height}`}
              preserveAspectRatio="none"
              role="img"
              aria-labelledby={`${id}-title ${id}-desc`}
              focusable="false"
              className="absolute inset-0 size-full overflow-visible"
            >
              <title id={`${id}-title`}>{label}</title>
              <desc id={`${id}-desc`}>
                {`A posição de cada competidor em cada pregão, do 1º (em cima) ao último (embaixo), de ${formatDate(dates[0]!)} a ${formatDate(dates.at(-1)!)}. No último pregão: ${finalOrder}.`}
              </desc>
              {Array.from({ length: maxRank }, (_, i) => (
                <line
                  key={i}
                  x1={0}
                  x2={WIDTH}
                  y1={y(i + 1)}
                  y2={y(i + 1)}
                  className="stroke-hairline"
                  strokeDasharray="2 5"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {rows.map((r) => (
                <g
                  key={r.key}
                  className={`transition-opacity duration-150 ease-out-quart ${dim(r.key)}`}
                  onPointerEnter={() => setHovered(r.key)}
                  onPointerLeave={() => setHovered(null)}
                >
                  <path
                    data-serie={r.key}
                    d={bumpPath(r.points)}
                    fill="none"
                    style={{ stroke: r.cor }}
                    strokeWidth={2}
                    strokeDasharray={r.traco}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* a área que o ponteiro acerta, mais larga que o traço */}
                  <path
                    d={bumpPath(r.points)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
            </svg>
            {/* o número da posição em cada ponto, em HTML (um círculo no SVG esticado viraria elipse); decorativo: a tabela tem o mesmo */}
            <div aria-hidden="true" data-pontos>
              {rows.flatMap((r) =>
                r.points.map((p, i) =>
                  p ? (
                    <span
                      key={`${r.key}-${dates[i]}`}
                      data-posicao={p.rank}
                      className={`bump-ponto transition-opacity duration-150 ease-out-quart ${dim(r.key)}`}
                      style={{ left: pct(p.x), top: p.y, borderColor: r.cor }}
                    >
                      {p.rank}
                    </span>
                  ) : null,
                ),
              )}
            </div>
            {/* o nome no fim de cada linha, na calha da direita */}
            <ul aria-hidden="true">
              {rows.map((r) => {
                const end = r.points.findLast((p) => p !== null);
                return end ? (
                  <li
                    key={r.key}
                    className={`absolute translate-x-4 -translate-y-1/2 text-xs font-medium whitespace-nowrap text-ink transition-opacity duration-150 ease-out-quart ${dim(r.key)}`}
                    style={{ left: pct(end.x), top: end.y }}
                  >
                    {r.curto}
                  </li>
                ) : null;
              })}
            </ul>
          </div>
          {/* as datas embaixo de cada coluna, na largura do desenho (dentro dos respiros) */}
          <div
            aria-hidden="true"
            className="absolute right-32 bottom-0 left-5 h-5 text-xs text-muted"
          >
            {dates.map((date, i) => (
              <span
                key={date}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: pct(x(i)) }}
              >
                {formatShortDate(date)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="sr-only">
        <table>
          <caption>Dados do gráfico: {label.charAt(0).toLowerCase() + label.slice(1)}</caption>
          <thead>
            <tr>
              <th scope="col">Competidor</th>
              {dates.map((date) => (
                <th key={date} scope="col">
                  {formatDate(date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.competitor.name}</th>
                {r.ranks.map((rank, i) => (
                  <td key={dates[i]}>{rank === null ? 'sem dado' : ordinal(rank)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="space-y-1">
        <p className="muted">
          Do 1º, em cima, ao último. Toque num nome para destacar a linha dele; o Esc solta.
        </p>
        <ul
          aria-label="Séries do gráfico"
          className="grid grid-cols-2 gap-x-4 sm:grid-cols-3 xl:grid-cols-4"
        >
          {rows.map((r) => (
            <li key={r.key} className="min-w-0">
              <button
                type="button"
                aria-pressed={pinned === r.key}
                onClick={() => setPinned(pinned === r.key ? null : r.key)}
                onPointerEnter={() => setHovered(r.key)}
                onPointerLeave={() => setHovered(null)}
                // o realce pelo foco é o do teclado: o foco que o toque dá ao botão não apaga as outras linhas (o toque fixa e solta)
                onFocus={(event) =>
                  event.currentTarget.matches(':focus-visible') && setHovered(r.key)
                }
                onBlur={() => setHovered(null)}
                onKeyDown={clear}
                className="legenda-serie w-full"
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: r.cor }}
                />
                <span className="min-w-0 truncate">
                  {r.curto}
                  {r.resto ? <span className="sr-only">{r.resto}</span> : null}
                </span>
                <span className="ml-auto pl-2 text-ink tabular-nums">
                  {r.last === null ? '—' : ordinal(r.last)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
