// Adaptado do Line Chart da beUI (https://beui.dev/charts/line-chart; registro https://beui.dev/r/line-chart, lido em 05/11/2026; os
// arquivos `line-chart.tsx`, `line-chart/{context,plot,tooltip,legend}.tsx` e `xy/{inspector,use-inspection,use-points,use-width,legend,
// data-table,tooltip-content}.tsx`). Copyright (c) 2026 Saurabh Chauhan, licença MIT (o texto inteiro em components/beui/LICENSE).
// O que veio de lá: cada ponto é uma mola (a linha, a faixa e a grade se movem juntas quando a escala muda); a linha que se desenha da
// esquerda para a direita por um recorte; o cursor que gruda no pregão mais perto, com o ponto de cada série e o painel com o valor de cada
// uma, e a linha depois do cursor que recua; um controle deslizante nativo e invisível sobre o desenho (uma parada de Tab: as setas, o Home
// e o End andam entre os pregões, e o leitor de tela ouve a data e o valor de cada série); a legenda em botões que mostram e escondem cada
// série (o eixo se ajusta ao que sobrou); a tabela escondida com todos os valores; e a linha que quebra no dado que falta.
// O que mudou (ADR 0037; docs/TELAS.md, seção 10): o desenho sai do servidor (o SVG no `viewBox` de 1000 × 280 que estica só na horizontal,
// com o traço que não escala, e o fim de cada linha, as datas e o cursor em HTML por cima), então o gráfico existe antes do JavaScript e sem
// ele; nada se desenha na abertura da página: a linha se desenha quando o dado muda (a série que a legenda mostra de novo), e a escala anda
// por molas sem quique (as do lib/motion.ts) quando a legenda esconde ou mostra uma série; ficaram a faixa p5 a p95 do Monte Carlo (num tom
// que não compete com as linhas), as cores dos laboratórios (os `--chart-*`, que apontam para os tokens), o Sorteio tracejado, as
// referências pontilhadas e o logo no fim de cada linha (com o anel da cor dela) e o valor ao lado; o valor do painel é o contador da Arc, que rola
// só quando o ponteiro muda de pregão (pelo teclado e pelo toque ele troca na hora, como o cursor: animação no teclado cansa, e o deslize sob
// o dedo parece atraso), e o dinheiro é o de lib/format.ts; a série que volta se desenha por um recorte do CSS (globals.css, `.linha-desenha`);
// no celular, o toque fora da figura e a rolagem fecham a leitura (não há Esc); a leitura (o painel e o leitor de tela) lista as séries do
// maior patrimônio do pregão para o menor, e não na ordem das séries (15/11/2026); o segmentado "R$ | %" (o RadioField do form-kit) troca os
// valores do patrimônio pelo rendimento sobre o capital inicial, sem mexer no desenho (17/11/2026); o trecho retroativo da temporada (ADR
// 0038) ganhou o fundo hachurado atrás das linhas, a amostra na legenda e o modo na descrição, na tabela, no controle e no painel
// (18/11/2026); saíram o estado de carregamento, a área, o esmaecer das pontas, o eixo de valores, o `cn` (clsx e tailwind-merge) e o
// NumberTicker da beUI; os textos em português. Com movimento reduzido, nada anda: a escala, a linha e o cursor trocam na hora.
'use client';

import {
  AnimatePresence,
  animate,
  motion,
  motionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'motion/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PublicCompetitor } from '@alvesting/contracts';
import { layoutEquity, rotuloCoberto, serieDe, spreadLabels } from '../../lib/chart';
import { formatBRL, formatBps, formatDate, variationBps } from '../../lib/format';
import { MOTION } from '../../lib/motion';
import {
  faixasRetroativas,
  periodoDosTrechos,
  trechosRetroativos,
  type Modo,
} from '../../lib/retroativo';
import { RadioField, useHydrated } from '../form-kit';
import { IconeInfo } from '../icones';
import { AnimatedCounter } from '../arc/animated-counter/animated-counter';
import { Logo, partesDoNome } from '../competidor';
import { linePath } from './xy-path';

type Competidor = Pick<PublicCompetitor, 'slug' | 'name' | 'type' | 'provider' | 'modelId'>;
export interface LineChartSeries {
  competitor: Competidor;
  // um valor por data, em centavos; o nulo é o dado que falta, e a linha quebra nele
  cents: readonly (number | null)[];
}
export interface LineChartProps {
  // prefixo dos ids do título e da descrição: único na página
  id: string;
  // o nome do gráfico ("Patrimônio por pregão")
  label: string;
  dates: readonly string[];
  series: readonly LineChartSeries[];
  band: { p5: readonly number[]; p95: readonly number[] } | null;
  // o capital inicial da temporada, em centavos: a base do rendimento em %, a outra escala dos valores
  capitalCents: number;
  // as séries que começam escondidas (as referências da arena): a legenda as mostra, e a linha se desenha
  defaultHidden?: readonly string[];
  // o modo do ciclo de cada data (a série do patrimônio, `modes`): o trecho retroativo ganha o fundo hachurado e é dito na descrição, na tabela,
  // no controle e no painel (lib/retroativo.ts; ADR 0038). Sem ele, nada é marcado
  modes?: readonly Modo[];
}

// As escalas dos valores: o patrimônio em reais e o rendimento sobre o capital inicial.
type Escala = 'saldo' | 'rendimento';
const ESCALAS = [
  ['saldo', 'R$'],
  ['rendimento', '%'],
] as const;

// a altura é fixa (280 px) e a largura acompanha a coluna: o SVG estica só na horizontal, e um px da altura é uma unidade do desenho
const VIEW = { width: 1000, height: 280 };
// sem rótulo dentro do SVG: a linha vai de uma borda à outra, com respiro de meia pílula em cima e embaixo
const MARGIN = { left: 0, top: 14, right: 0, bottom: 14 };
// a altura do rótulo do fim da linha (o logo de 20 px) e o respiro entre dois
const LABEL_GAP = 22;
// a largura da data do eixo ("dd/mm" em 13 px) e a da pílula da data do cursor ("dd/mm" em 12 px, com 8 px de cada lado), em px: o rótulo
// que a pílula cobriria sai da frente
const ROTULO = 38;
const PILULA = 52;
// quanto a linha depois do cursor recua (a escuridão da máscara, de 0 a 1)
const RECEDE = 0.6;
const pct = (x: number) => `${(x / VIEW.width) * 100}%`;
const QUART = { duration: MOTION.duration.fast, ease: [...MOTION.ease.outQuart] } as const;
const NO_TIME = { duration: 0 } as const;

// O dinheiro do contador: a Arc formata um número pelo Intl, e o centavo inteiro vira reais só aqui, para o desenho dos algarismos (o texto
// para o leitor de tela e toda outra cifra são o formatBRL, sem float).
// ponytail: exato até 2^53 centavos (a divisão por 100 erra menos de meio centavo); acima disso, um contador que receba o texto pronto.
const reais = (cents: number) => cents / 100;

// A largura do desenho em px, para o cursor e o painel (o SVG usa o viewBox e não precisa dela): zero antes da primeira medida.
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

// O dispositivo tem hover de verdade (mouse ou trackpad): o toque não abre o painel só de passar o dedo.
function useHoverCapable() {
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    const query = matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setCanHover(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return canHover;
}

// A mola de uma coordenada: com movimento reduzido ela salta para o alvo (nada anda); sem ele, anda pela mola sem quique (components.spec.tsx).
export function moverMola(value: MotionValue<number>, target: number, reduce: boolean) {
  if (reduce) {
    value.jump(target);
    return null;
  }
  return animate(value, target, MOTION.spring.base);
}

// Uma mola por coordenada y, pela chave (a série e a data, ou a borda da faixa): a linha, a faixa e o fim dela leem os mesmos valores, então
// a escala que muda move tudo junto. O primeiro desenho nasce no lugar (nada anda na abertura); a escala que muda anda; com movimento
// reduzido, salta.
function useSprings(targets: ReadonlyMap<string, number>, reduce: boolean) {
  const [values] = useState(() => new Map<string, MotionValue<number>>());
  for (const [key, target] of targets) if (!values.has(key)) values.set(key, motionValue(target));
  const snapshot = JSON.stringify([...targets]);
  useLayoutEffect(() => {
    const controls: Array<{ stop: () => void }> = [];
    for (const [key, target] of JSON.parse(snapshot) as Array<[string, number]>) {
      const value = values.get(key)!;
      if (value.get() === target) continue;
      const control = moverMola(value, target, reduce);
      if (control) controls.push(control);
    }
    return () => controls.forEach((control) => control.stop());
  }, [snapshot, reduce, values]);
  return values;
}

type Via = 'ponteiro' | 'teclado' | 'toque';

export function LineChart({
  id,
  label,
  dates,
  series,
  band,
  capitalCents,
  defaultHidden = [],
  modes,
}: LineChartProps) {
  const reduce = useReducedMotion() ?? false;
  const canHover = useHoverCapable();
  const hydrated = useHydrated();
  const uid = useId();
  // A escala dos valores (o pedido do Artur em 17/11/2026): o patrimônio em R$ ou o rendimento em % sobre o capital inicial, em pontos-base
  // inteiros (o variationBps, a regra de arredondamento do projeto). O desenho não muda: todo competidor começa do mesmo capital, então o
  // rendimento é o patrimônio na mesma régua, e a ordem da leitura é a mesma.
  const [escala, setEscala] = useState<Escala>('saldo');
  const rendimento = escala === 'rendimento';
  const valor = (cents: number) =>
    rendimento ? formatBps(variationBps(cents, capitalCents)) : formatBRL(cents);
  // o número do contador da Arc na leitura pelo ponteiro: os reais, ou o rendimento em %, com o sinal do ganho (o do formatBps)
  const numero = (cents: number) => {
    if (!rendimento) return { value: reais(cents), prefix: 'R$\u00a0', suffix: '' };
    const bps = variationBps(cents, capitalCents);
    return { value: bps / 100, prefix: bps > 0 ? '+' : '', suffix: '%' };
  };
  const [hidden, setHidden] = useState<readonly string[]>(defaultHidden);
  const [hovered, setHovered] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [via, setVia] = useState<Via>('ponteiro');
  const { ref: plotRef, width } = useWidth();
  const figureRef = useRef<HTMLElement>(null);

  // No celular não há Esc: com a leitura aberta, o toque fora da figura a fecha, e a rolagem (de qualquer caixa) também, quando quem a abriu
  // foi o dedo (pelo teclado, o foco que rola a página até o gráfico não pode fechá-la).
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!figureRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const scroll = () => {
      if (via === 'toque') setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scroll, { capture: true });
    };
  }, [open, via]);

  // o trecho retroativo: o pregão retroativo é dito junto da data (a tabela, o controle e o painel), e o fundo hachurado o mostra no desenho
  const trechos = modes ? trechosRetroativos(modes) : [];
  const retroativo = (i: number) => modes?.[i] === 'RETROATIVO';
  const dataDe = (i: number) => `${formatDate(dates[i]!)}${retroativo(i) ? ', retroativo' : ''}`;

  const keys = series.map((s) => s.competitor.slug);
  const layout = layoutEquity(
    { dates, series: series.map((s, i) => ({ key: keys[i]!, cents: s.cents })), band, hidden },
    VIEW,
    MARGIN,
  );
  const lines = series.map((s, i) => {
    const line = layout.lines[i]!;
    return {
      ...s,
      key: keys[i]!,
      line,
      ...serieDe(s.competitor),
      ...partesDoNome(s.competitor.name, s.competitor.type),
      oculta: hidden.includes(keys[i]!),
    };
  });
  const visible = lines.filter((l) => !l.oculta);
  // o realce da série sob o ponteiro ou o foco do teclado na legenda: a série escondida não realça nada (o clique que a esconde deixa o
  // ponteiro em cima do botão dela)
  const realce = hovered !== null && !hidden.includes(hovered) ? hovered : null;

  // as molas: o y de cada ponto de cada série, as bordas da faixa
  const targets = new Map<string, number>();
  for (const l of lines) l.line.points.forEach((p, i) => p && targets.set(`${l.key}|${i}`, p.y));
  layout.band?.upper.forEach((p, i) => targets.set(`p95|${i}`, p.y));
  layout.band?.lower.forEach((p, i) => targets.set(`p5|${i}`, p.y));
  const springs = useSprings(targets, reduce);

  // os rótulos do fim das linhas que estão à vista, sem encavalar (lib/chart.ts)
  const ends = visible.filter((l) => l.line.end !== null);
  const labelY = spreadLabels(
    ends.map((l) => l.line.end!.y),
    LABEL_GAP,
    0,
    VIEW.height,
  );

  // o pregão do cursor, só com a leitura aberta
  const act = open ? active : null;
  const inspecting = act !== null;
  const crossVb = act === null ? 0 : layout.xs[act]!;
  const crossPx = (crossVb / VIEW.width) * width;
  // pelo ponteiro, o cursor desliza até o pregão; pelo teclado e pelo dedo, salta (o deslize sob o dedo parece atraso)
  const glide = reduce || via !== 'ponteiro' ? NO_TIME : MOTION.spring.fast;
  // o esmaecer de 150 ms; com movimento reduzido, nada anda nem esmaece: a troca é na hora
  const fade = reduce ? NO_TIME : QUART;
  const toggle = (key: string) =>
    setHidden((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );

  const description =
    `${label} ${rendimento ? `em rendimento sobre o capital inicial de ${formatBRL(capitalCents)}` : 'em reais'}, ` +
    `de ${formatDate(dates[0]!)} a ${formatDate(dates.at(-1)!)}. ` +
    visible
      .filter((l) => l.line.end !== null)
      .map((l) => `${l.competitor.name} termina em ${valor(lastValue(l.cents)!)}`)
      .join('; ') +
    '.' +
    (band ? ' A faixa vai do percentil 5 ao 95 das carteiras aleatórias do Monte Carlo.' : '') +
    (trechos.length > 0
      ? ` Pregões retroativos, rodados depois e não ao vivo: ${periodoDosTrechos(dates, trechos)}.`
      : '');
  // Quem estava ganhando primeiro (o pedido do Artur em 15/11/2026): as séries à vista do maior patrimônio do pregão para o menor, o "sem
  // dado" no fim. O painel e o leitor de tela leem a mesma ordem; no empate (o primeiro pregão, todos com o capital inicial), a das séries
  // (o sort é estável, e dois "sem dado" dão NaN, que o `|| 0` faz empate).
  const rankedAt = (i: number) =>
    [...visible].sort((a, b) => (b.cents[i] ?? -Infinity) - (a.cents[i] ?? -Infinity) || 0);
  const valueText = (i: number) =>
    [
      dataDe(i),
      ...rankedAt(i).map((l) => {
        const cents = l.cents[i];
        return `${l.competitor.name} ${cents === null || cents === undefined ? 'sem dado' : valor(cents)}`;
      }),
    ].join('. ');
  const maskId = `${uid}-recuo`;
  const tooltipId = `${uid}-leitura`;

  return (
    // aria-label: sem ele a figura tomaria o nome do figcaption, que traz a legenda inteira
    <figure ref={figureRef} aria-label={label} className="space-y-4">
      {/* a escala dos valores, no segmentado da carteira (o RadioField: radios nativos, as setas trocam, a pílula desliza só por CSS; ADR
          0037). Desativada até a hidratação: sem JavaScript o gráfico fica em R$, e a troca não faria nada */}
      <div className="flex justify-end">
        <div className="w-28">
          <RadioField
            name={`${uid}-escala`}
            legend="Mostrar os valores em"
            legendHidden
            disabled={!hydrated}
            value={escala}
            options={ESCALAS}
            describe={{
              saldo: 'reais: o patrimônio',
              rendimento: 'rendimento sobre o capital inicial',
            }}
            onChange={(value) => setEscala(value === 'rendimento' ? 'rendimento' : 'saldo')}
          />
        </div>
      </div>
      {/* a calha da direita é a dos rótulos do fim da linha (o logo tem metade dentro do desenho) */}
      <div className="mr-30">
        {/* a altura em px, a da escala: em rem ela cresceria com a fonte padrão do navegador, e o desenho esticaria longe dos rótulos e dos
            pontos, que ficam em px */}
        <div
          ref={plotRef}
          className="relative rounded-sm outline-offset-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ring"
          style={{ height: VIEW.height }}
        >
          {/* o trecho retroativo, atrás das linhas: o fundo hachurado do pregão de cada trecho (de meio passo antes a meio passo depois), em
              HTML, porque a hachura no SVG esticado entortaria; decorativo para o leitor de tela, que tem o modo na descrição e na tabela */}
          {faixasRetroativas(layout.xs, trechos, VIEW.width).map((faixa) => (
            <span
              key={faixa.x}
              aria-hidden="true"
              data-retroativo
              className="trecho-retroativo absolute inset-y-0"
              style={{ left: pct(faixa.x), width: pct(faixa.largura) }}
            />
          ))}
          <svg
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${id}-title ${id}-desc`}
            focusable="false"
            className="absolute inset-0 size-full overflow-visible"
          >
            <title id={`${id}-title`}>{label}</title>
            <desc id={`${id}-desc`}>{description}</desc>
            <defs>
              {/* a linha depois do cursor recua: a máscara é branca (mostra) e um retângulo escuro desliza do cursor até o fim */}
              <mask
                id={maskId}
                maskUnits="userSpaceOnUse"
                x={0}
                y={-VIEW.height}
                width={VIEW.width}
                height={VIEW.height * 3}
              >
                <rect
                  x={0}
                  y={-VIEW.height}
                  width={VIEW.width}
                  height={VIEW.height * 3}
                  fill="white"
                />
                <motion.rect
                  y={-VIEW.height}
                  width={VIEW.width}
                  height={VIEW.height * 3}
                  fill="black"
                  initial={false}
                  animate={{ x: crossVb, opacity: inspecting ? RECEDE : 0 }}
                  transition={{ x: glide, opacity: fade }}
                />
              </mask>
            </defs>
            <AnimatePresence initial={false}>
              {layout.yTicks.map((tick) => (
                <motion.line
                  key={tick.value}
                  x1={0}
                  x2={VIEW.width}
                  y1={0}
                  y2={0}
                  className="stroke-hairline-strong"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  initial={{ opacity: 0, y: tick.y }}
                  animate={{ opacity: 1, y: tick.y }}
                  exit={{ opacity: 0, transition: fade }}
                  transition={{ opacity: fade, y: reduce ? NO_TIME : MOTION.spring.base }}
                />
              ))}
            </AnimatePresence>
            <line
              x1={0}
              x2={0}
              y1={0}
              y2={VIEW.height}
              className="stroke-hairline-strong"
              vectorEffect="non-scaling-stroke"
            />
            {layout.band ? <Faixa xs={layout.xs} springs={springs} /> : null}
            <g mask={`url(#${maskId})`}>
              {lines.map((l) => (
                <Linha
                  key={l.key}
                  id={l.key}
                  xs={layout.xs}
                  ys={l.line.points.map((p, i) => (p ? springs.get(`${l.key}|${i}`)! : null))}
                  cor={l.cor}
                  traco={l.traco}
                  oculta={l.oculta}
                  apagada={realce !== null && realce !== l.key}
                  reduce={reduce}
                />
              ))}
            </g>
          </svg>

          {/* o ponto do fim de cada linha, em HTML (um círculo no SVG esticado viraria elipse): com uma data só a linha é só ele */}
          <div aria-hidden="true">
            {ends.map((l) => (
              <motion.span
                key={l.key}
                data-ponto={l.key}
                className="absolute top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: pct(l.line.end!.x), backgroundColor: l.cor }}
                initial={false}
                animate={{ y: l.line.end!.y }}
                transition={reduce ? NO_TIME : MOTION.spring.base}
              />
            ))}
          </div>
          {/* o fim de cada linha: o logo e o patrimônio final. Decorativo para o leitor de tela, que tem o mesmo valor na descrição e na
              tabela. O logo fica centrado no fim da linha (na borda direita do desenho), e o valor na calha; com uma data só, o rótulo fica
              logo depois do ponto. */}
          <ul aria-hidden="true">
            {ends.map((l, i) => (
              <motion.li
                key={l.key}
                data-rotulo={l.key}
                className={`absolute top-0 flex -translate-y-1/2 items-center gap-1 ${dates.length === 1 ? 'translate-x-2' : '-translate-x-2.5'}`}
                style={{ left: pct(l.line.end!.x) }}
                initial={false}
                animate={{ y: labelY[i]! }}
                transition={reduce ? NO_TIME : MOTION.spring.base}
              >
                <Logo
                  competitor={l.competitor}
                  className="size-5 border-[1.5px] bg-canvas"
                  style={{ borderColor: l.cor }}
                />
                <span className="text-xs leading-[18px] font-semibold whitespace-nowrap text-ink tabular-nums">
                  {valor(lastValue(l.cents)!)}
                </span>
              </motion.li>
            ))}
          </ul>

          {/* o cursor: a linha vertical que some nas pontas e o ponto de cada série no pregão escolhido */}
          {act !== null && width > 0 ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <motion.span
                className="cursor-grafico absolute inset-y-0 left-0 w-px"
                initial={{ x: crossPx, opacity: 0 }}
                animate={{ x: crossPx, opacity: 1 }}
                transition={{ x: glide, opacity: fade }}
              />
              {visible.map((l) => {
                const point = l.line.points[act];
                return point ? (
                  <motion.span
                    key={l.key}
                    className="absolute top-0 left-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-canvas"
                    style={{ backgroundColor: l.cor }}
                    initial={{ x: crossPx, y: point.y, opacity: 0 }}
                    animate={{ x: crossPx, y: point.y, opacity: 1 }}
                    transition={{ x: glide, y: glide, opacity: fade }}
                  />
                ) : null;
              })}
            </div>
          ) : null}
          {act !== null && width > 0 ? (
            <Leitura
              id={tooltipId}
              date={dates[act]!}
              retroativo={retroativo(act)}
              rows={rankedAt(act).map((l) => {
                const cents = l.cents[act] ?? null;
                return {
                  key: l.key,
                  curto: l.curto,
                  cor: l.cor,
                  valor: cents === null ? null : { texto: valor(cents), numero: numero(cents) },
                  y: l.line.points[act]?.y ?? null,
                };
              })}
              x={crossPx}
              width={width}
              glide={glide}
              fade={fade}
              contador={via === 'ponteiro'}
            />
          ) : null}

          <Inspetor
            count={dates.length}
            active={active}
            onActive={setActive}
            label={`${label}: ler os valores`}
            valueText={valueText}
            open={open}
            setOpen={setOpen}
            setVia={setVia}
            tooltipId={tooltipId}
            canHover={canHover}
          />
        </div>

        {/* as datas, embaixo: a primeira e a última alinhadas para dentro; no celular, só a primeira, a do meio e a última. O pregão do
            cursor ganha a pílula na tinta, e as datas que ela cobriria saem da frente. */}
        <div aria-hidden="true" className="relative mt-2 h-5 text-13 text-muted">
          {layout.xLabels.map((xl) => (
            <span
              key={xl.label}
              className={`absolute whitespace-nowrap transition-opacity duration-150 ${xl.anchor === 'middle' ? '-translate-x-1/2' : xl.anchor === 'end' ? '-translate-x-full' : ''} ${xl.minor ? 'max-sm:hidden' : ''}`}
              style={{
                left: pct(xl.x),
                opacity:
                  inspecting &&
                  rotuloCoberto(
                    { x: (xl.x / VIEW.width) * width, anchor: xl.anchor, largura: ROTULO },
                    { x: crossPx, largura: PILULA },
                  )
                    ? 0
                    : 1,
              }}
            >
              {xl.label}
            </span>
          ))}
          {act !== null && width > 0 ? (
            <motion.span
              className="absolute top-0 left-0"
              initial={{ x: crossPx, opacity: 0 }}
              animate={{ x: crossPx, opacity: 1 }}
              transition={{ x: glide, opacity: fade }}
            >
              <span className="block -translate-x-1/2 rounded-full bg-ink px-2 text-xs leading-5 font-medium whitespace-nowrap text-canvas">
                {formatDate(dates[act]!).slice(0, 5)}
              </span>
            </motion.span>
          ) : null}
        </div>
      </div>

      {/* a tabela equivalente do gráfico, para o leitor de tela, com todas as séries (as escondidas também). Dentro de um bloco sr-only: o
          sr-only direto na <table> não recorta (a tabela não encolhe abaixo do conteúdo) e alargaria a página. Vem antes da legenda: o
          figcaption só pode ser o primeiro ou o último filho do figure */}
      <div className="sr-only">
        <table>
          <caption>Dados do gráfico: {label.charAt(0).toLowerCase() + label.slice(1)}</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              {lines.map((l) => (
                <th key={l.key} scope="col">
                  {l.competitor.name}
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
                <th scope="row">{dataDe(i)}</th>
                {lines.map((l) => {
                  const cents = l.cents[i];
                  return (
                    <td key={l.key}>
                      {cents === null || cents === undefined ? 'sem dado' : valor(cents)}
                    </td>
                  );
                })}
                {band ? (
                  <>
                    <td>{valor(band.p5[i]!)}</td>
                    <td>{valor(band.p95[i]!)}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="space-y-1">
        <p className="muted">
          {rendimento
            ? `Rendimento sobre o capital inicial de ${formatBRL(capitalCents)}, no fechamento de cada pregão.`
            : 'Patrimônio em R$, no fechamento de cada pregão.'}
        </p>
        {/* a legenda: com mais de uma série, cada uma é um botão que a mostra ou esconde (o eixo se ajusta ao que sobrou, e a linha que volta
            se desenha); o traço antes do nome liga a linha ao nome sem depender só da cor */}
        <ul aria-label="Séries do gráfico" className="flex flex-wrap items-center gap-x-1 text-xs">
          {lines.map((l) =>
            lines.length > 1 ? (
              <li key={l.key}>
                <button
                  type="button"
                  aria-pressed={!l.oculta}
                  onClick={() => toggle(l.key)}
                  onPointerEnter={() => canHover && !l.oculta && setHovered(l.key)}
                  onPointerLeave={() => setHovered(null)}
                  // o realce pelo foco é o do teclado: o foco que o toque dá ao botão não apaga as outras linhas
                  onFocus={(event) =>
                    !l.oculta && event.currentTarget.matches(':focus-visible') && setHovered(l.key)
                  }
                  onBlur={() => setHovered(null)}
                  className="legenda-serie"
                >
                  <Traco cor={l.cor} traco={l.traco} oculta={l.oculta} />
                  {l.curto}
                  {l.resto ? <span className="sr-only">{l.resto}</span> : null}
                </button>
              </li>
            ) : (
              <li key={l.key} className="legenda-serie">
                <Traco cor={l.cor} traco={l.traco} oculta={false} />
                {l.competitor.name}
              </li>
            ),
          )}
          {band ? (
            <li className="legenda-serie">
              <span aria-hidden="true" className="mc-amostra" />
              Faixa p5 a p95 do Monte Carlo
              {/* o "i" abre a explicação: o popover nativo (o clique, o toque e o teclado abrem; o Esc e o toque fora fecham), que funciona
                  antes da hidratação. O id é fixo: um gráfico com a faixa por página. */}
              <button
                type="button"
                popoverTarget="faixa-explicada"
                className="info"
                aria-label="O que é a faixa p5 a p95 do Monte Carlo"
              >
                <IconeInfo size={16} />
              </button>
              <div id="faixa-explicada" popover="auto" className="info-balao">
                {FAIXA_EXPLICADA}
              </div>
            </li>
          ) : null}
          {/* o fundo hachurado do desenho: a amostra no desenho da do Monte Carlo, com a hachura no lugar do cinza liso */}
          {trechos.length > 0 ? (
            <li className="legenda-serie">
              <span
                aria-hidden="true"
                className="trecho-retroativo inline-block h-2.5 w-5 shrink-0 rounded-sm border border-hairline-strong"
              />
              Pregões retroativos
            </li>
          ) : null}
        </ul>
      </figcaption>
    </figure>
  );
}

// O que é a faixa (o balão do "i" da legenda), em português simples: o Monte Carlo da liquidação (apps/api, settlement/domain/monte-carlo.ts)
// sorteia 1.000 carteiras com as regras e os custos dos modelos, e a faixa vai do percentil 5 ao 95 do patrimônio delas em cada pregão.
const FAIXA_EXPLICADA =
  'São 1.000 carteiras sorteadas, com as mesmas regras e custos dos modelos. Em cada pregão, 90% delas fecharam dentro desta faixa: a borda de baixo é o p5 (5% ficaram abaixo dela) e a de cima, o p95 (5% ficaram acima). Uma linha acima da faixa foi melhor que 95% das carteiras sorteadas; abaixo, pior que 95% delas; dentro, o resultado não se distingue da sorte.';

const lastValue = (cents: readonly (number | null)[]) =>
  cents.findLast((c): c is number => c !== null) ?? null;

// O traço da série na legenda: cheio, tracejado (o Sorteio) ou pontilhado (as referências); vazado quando a série está escondida.
function Traco({
  cor,
  traco,
  oculta,
}: {
  cor: string;
  traco: string | undefined;
  oculta: boolean;
}) {
  return (
    <svg width="20" height="8" aria-hidden="true" focusable="false" className="shrink-0">
      <line
        x1="1"
        x2="19"
        y1="4"
        y2="4"
        style={{ stroke: cor }}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={traco}
        opacity={oculta ? 0.35 : 1}
      />
    </svg>
  );
}

// Uma série: o caminho sai das molas a cada quadro. Escondida, ela some em 150 ms; mostrada de novo, ela se desenha da esquerda para a
// direita, pelo recorte que cresce (a animação `linha-desenha` do CSS, 250 ms, num caminho novo a cada volta; com movimento reduzido, a regra
// global a troca na hora). Na abertura, nasce desenhada.
function Linha({
  id,
  xs,
  ys,
  cor,
  traco,
  oculta,
  apagada,
  reduce,
}: {
  id: string;
  xs: readonly number[];
  ys: ReadonlyArray<MotionValue<number> | null>;
  cor: string;
  traco: string | undefined;
  oculta: boolean;
  apagada: boolean;
  reduce: boolean;
}) {
  const present = ys.filter((v): v is MotionValue<number> => v !== null);
  const d = useTransform(present, (current: number[]) => {
    let k = 0;
    return linePath(ys.map((v, i) => (v ? { x: xs[i]!, y: current[k++]! } : null)));
  });
  // cada volta da série é um caminho novo (a chave), com a animação do recorte; o primeiro desenho não anima (nada anda na abertura). A volta
  // é lida durante a renderização (o estado da renderização de antes), e não num efeito: assim nenhum quadro mostra a linha inteira antes de
  // ela começar a se desenhar
  const [antes, setAntes] = useState(oculta);
  const [voltas, setVoltas] = useState(0);
  if (antes !== oculta) {
    setAntes(oculta);
    if (antes) setVoltas(voltas + 1);
  }
  return (
    <motion.g
      initial={false}
      animate={{ opacity: oculta ? 0 : apagada ? 0.25 : 1 }}
      transition={reduce ? NO_TIME : QUART}
      data-oculta={oculta || undefined}
    >
      <motion.path
        key={voltas}
        className={voltas > 0 ? 'linha-desenha' : undefined}
        data-series={id}
        d={d}
        fill="none"
        style={{ stroke: cor }}
        strokeWidth={2}
        strokeDasharray={traco}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </motion.g>
  );
}

// A faixa p5 a p95 do Monte Carlo: a borda de cima (p95) e a de baixo (p5), das mesmas molas das linhas. Com uma data só, uma barra estreita.
function Faixa({
  xs,
  springs,
}: {
  xs: readonly number[];
  springs: ReadonlyMap<string, MotionValue<number>>;
}) {
  const n = xs.length;
  const values = [
    ...xs.map((_, i) => springs.get(`p95|${i}`)!),
    ...xs.map((_, i) => springs.get(`p5|${i}`)!),
  ];
  const d = useTransform(values, (current: number[]) => {
    if (n === 1) {
      const x = xs[0]!;
      const [top, bottom] = [current[0]!, current[1]!];
      return `M${x - 6},${top}L${x + 6},${top}L${x + 6},${bottom}L${x - 6},${bottom}Z`;
    }
    const upper = xs.map((x, i) => ({ x, y: current[i]! }));
    const lower = xs.map((x, i) => ({ x, y: current[n + i]! })).reverse();
    return `${linePath(upper)}L${linePath(lower).slice(1)}Z`;
  });
  return <motion.path data-band d={d} className="mc-faixa" />;
}

// O painel da leitura: a data e o valor de cada série no pregão do cursor, ao lado do ponto mais alto, sem cobrir os pontos que ele descreve
// (à direita do cursor; perto da borda, à esquerda). Pelo ponteiro, ele segue o cursor numa mola e os valores rolam (o contador da Arc);
// pelo teclado e pelo dedo, troca na hora (o valor é o texto do formatBRL, ou o do formatBps na escala do rendimento).
function Leitura({
  id,
  date,
  retroativo,
  rows,
  x,
  width,
  glide,
  fade,
  contador,
}: {
  id: string;
  date: string;
  // o pregão retroativo leva a palavra junto da data (ADR 0038)
  retroativo: boolean;
  rows: Array<{
    key: string;
    curto: string;
    cor: string;
    valor: { texto: string; numero: { value: number; prefix: string; suffix: string } } | null;
    y: number | null;
  }>;
  x: number;
  width: number;
  glide: typeof NO_TIME | (typeof MOTION.spring)['fast'];
  fade: typeof NO_TIME | typeof QUART;
  contador: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 208, height: 40 + rows.length * 20 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () =>
      setSize((previous) =>
        previous.width === node.offsetWidth && previous.height === node.offsetHeight
          ? previous
          : { width: node.offsetWidth, height: node.offsetHeight },
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const tops = rows.flatMap((row) => (row.y === null ? [] : [row.y]));
  const py = tops.length > 0 ? Math.min(...tops) : VIEW.height / 2;
  // o painel pode entrar na calha da direita (os 120 px das pílulas)
  const right = x + 16 + size.width <= width + 120;
  const left = right ? x + 16 : Math.max(-8, x - 16 - size.width);
  const top = Math.min(Math.max(py - size.height / 2, -8), VIEW.height + 8 - size.height);
  return (
    <motion.div
      ref={ref}
      id={id}
      role="tooltip"
      className="pointer-events-none absolute top-0 left-0 z-10 w-max min-w-44 rounded-lg bg-canvas px-3 py-2 shadow-(--shadow-raised)"
      initial={{ x: left, y: top, opacity: 0 }}
      animate={{ x: left, y: top, opacity: 1 }}
      transition={{ x: glide, y: glide, opacity: fade }}
    >
      <p className="mb-1.5 text-xs font-medium text-muted">
        {formatDate(date)}
        {retroativo ? ' · retroativo' : ''}
      </p>
      <ul className="grid gap-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="h-2.5 w-1 shrink-0 rounded-full"
              style={{ backgroundColor: row.cor }}
            />
            <span className="min-w-0 flex-1 truncate pr-3 text-muted">{row.curto}</span>
            <span className="shrink-0 text-13 font-medium text-ink tabular-nums">
              {row.valor === null ? (
                'sem dado'
              ) : contador ? (
                // o espaço do "R$ " é o que não quebra (o do formatBRL): o comum some no fim do item flex do contador
                <AnimatedCounter
                  value={row.valor.numero.value}
                  decimals={2}
                  prefix={row.valor.numero.prefix}
                  suffix={row.valor.numero.suffix}
                />
              ) : (
                row.valor.texto
              )}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

// O controle deslizante nativo e invisível sobre o desenho (o XYInspector da beUI): uma parada de Tab para o teclado e o leitor de tela, e o
// acerto do ponteiro no pregão mais perto. O foco pelo clique não prende o painel aberto; o do teclado prende até o Esc ou a saída.
function Inspetor({
  count,
  active,
  onActive,
  label,
  valueText,
  open,
  setOpen,
  setVia,
  tooltipId,
  canHover,
}: {
  count: number;
  active: number | null;
  onActive: (index: number) => void;
  label: string;
  valueText: (index: number) => string;
  open: boolean;
  setOpen: (open: boolean) => void;
  setVia: (via: Via) => void;
  tooltipId: string;
  canHover: boolean;
}) {
  const pointerDriven = useRef(false);
  const focused = useRef(false);
  const mouseFocus = useRef(false);
  const last = useRef<number | null>(null);
  const index = active ?? count - 1;
  const inspectPointer = (event: ReactPointerEvent<HTMLInputElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !count) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const next = Math.round(fraction * (count - 1));
    setVia(event.pointerType === 'touch' ? 'toque' : 'ponteiro');
    onActive(next);
    if (last.current !== next) setOpen(true);
    last.current = next;
  };
  const step = (next: number) => {
    onActive(Math.min(count - 1, Math.max(0, next)));
    setOpen(true);
  };
  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={count - 1}
      step={1}
      value={index}
      aria-valuetext={valueText(index)}
      aria-describedby={open && active !== null ? tooltipId : undefined}
      className="absolute inset-0 m-0 size-full cursor-crosshair touch-pan-y appearance-none opacity-0"
      onFocus={() => {
        focused.current = true;
        if (!pointerDriven.current) {
          setVia('teclado');
          step(index);
        }
      }}
      onBlur={() => {
        focused.current = false;
        mouseFocus.current = false;
        pointerDriven.current = false;
        setOpen(false);
      }}
      onPointerEnter={(event) => {
        if (canHover && event.pointerType !== 'touch') inspectPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === 'touch' ? event.buttons === 1 : canHover || event.buttons === 1)
          inspectPointer(event);
      }}
      onPointerLeave={(event) => {
        last.current = null;
        // o toque solta um "leave" logo depois de cada toque (antes do foco): a leitura pelo toque fica aberta até o toque fora (a saída
        // do foco) ou o Esc
        if (event.pointerType === 'touch') return;
        if (!focused.current || pointerDriven.current || mouseFocus.current) setOpen(false);
      }}
      onPointerDown={(event) => {
        pointerDriven.current = true;
        if (event.pointerType !== 'touch') mouseFocus.current = true;
        last.current = null;
        inspectPointer(event);
      }}
      onPointerCancel={() => {
        pointerDriven.current = false;
        setOpen(false);
      }}
      onClick={() => {
        // a troca do controle nativo termina antes do clique: solta a trava do ponteiro para as trocas da tecnologia assistiva
        pointerDriven.current = false;
      }}
      onKeyDown={(event) => {
        pointerDriven.current = false;
        mouseFocus.current = false;
        setVia('teclado');
        if (event.key === 'Escape') setOpen(false);
        else if (
          [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End',
            'PageUp',
            'PageDown',
          ].includes(event.key)
        )
          setOpen(true);
      }}
      onChange={(event) => {
        // o deslocamento do botão nativo não é o do desenho: o ponteiro é do acerto acima, e o controle fica com o teclado e a tecnologia
        // assistiva
        if (pointerDriven.current) return;
        step(Number(event.target.value));
      }}
    />
  );
}
