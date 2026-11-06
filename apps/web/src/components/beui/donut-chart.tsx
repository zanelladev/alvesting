// Adaptado do Donut Chart da beUI (https://beui.dev/charts/donut-chart; registro https://beui.dev/r/donut-chart, lido em 05/11/2026, `updated_at`
// 18/10/2026). Copyright (c) 2026 Saurabh Chauhan, licença MIT (o texto inteiro em components/beui/LICENSE).
// O que veio de lá (os arquivos `donut-chart.tsx` e `donut-chart/{model,context,plot,center,legend}.ts(x)`, juntados num arquivo): as fatias de
// pontas redondas com o vão igual entre elas sobre o trilho (`buildDonut`, como está), o foco compartilhado entre o anel, o centro e a legenda
// (passar o ponteiro numa fatia ou focar a linha dela destaca a fatia e esmaece as outras), o anel de toque parado embaixo de cada fatia (a fatia
// que cresce nunca foge do ponteiro), a legenda em botões com as setas para cima e para baixo, a barra da parte em cada linha e a escolha que
// fixa uma fatia (`aria-pressed`).
// O que mudou (ADR 0037; docs/DEPENDENCIAS.md): nada anima na abertura da página (saíram o giro de entrada, o `useInView` e a barra que cresce
// ao aparecer: o anel sai do servidor já desenhado, e só o que muda depois anda); o centro é de quem usa (`children`, com o contador da Arc, o
// número que rola do vocabulário do site) e não é região viva (a linha da legenda já tem o nome, a parte e o valor: o leitor de tela não ouve
// duas vezes); as cores vêm de `var()` (os tokens, que seguem o tema) pelo `style`, nunca em atributo; as molas e as curvas do lib/motion.ts,
// sem quique, e com movimento reduzido tudo troca na hora; os botões da legenda nascem desativados até a hidratação (`disabled`), como os outros
// da tela; saíram o `cn`, o DigitSwap e o hook de hover num arquivo à parte (está aqui embaixo).

'use client';

import { motion, useReducedMotion } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { MOTION } from '../../lib/motion';

export interface DonutSegment {
  id: string;
  name: string;
  // uma cor de CSS que segue o tema: `var(--fatia-1)`
  color: string;
  // não negativo; o zero e o inválido ficam fora do anel
  value: number;
}

export type PlacedSegment = DonutSegment & {
  // a parte do total, de 0 a 1 (só para o desenho: o número que a tela mostra é de quem usa)
  share: number;
  // o arco no `viewBox` de 200 × 200
  path: string;
};

const SIZE = 200;
const CENTER = SIZE / 2;

const point = (radius: number, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return [CENTER + radius * Math.sin(radians), CENTER - radius * Math.cos(radians)];
};

// As fatias em sentido horário a partir das 12 horas, como arcos de ponta redonda. Cada arco encolhe o vão mais a própria ponta, para o vão
// entre duas fatias ser igual; o arco pequeno demais para as pontas vira um ponto.
export function buildDonut(
  segments: readonly DonutSegment[],
  { radius, thickness, gap }: { radius: number; thickness: number; gap: number },
) {
  const valid = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0);
  const total = valid.reduce((sum, segment) => sum + segment.value, 0);
  const capDegrees = (thickness / 2 / radius) * (180 / Math.PI);
  const single = valid.length === 1;
  let cursor = 0;
  const placed: PlacedSegment[] = valid.map((segment) => {
    const share = total ? segment.value / total : 0;
    const sweep = share * 360;
    const inset = single ? 0 : gap / 2 + capDegrees;
    const start = cursor + inset;
    const end = Math.max(start + 0.01, cursor + sweep - inset);
    cursor += sweep;
    let path: string;
    if (single) {
      // o anel inteiro pede dois meios arcos: um arco só não começa e termina no mesmo ponto
      const [x1, y1] = point(radius, 0);
      const [x2, y2] = point(radius, 180);
      path = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2} A ${radius} ${radius} 0 1 1 ${x1} ${y1}`;
    } else {
      const [x1, y1] = point(radius, start);
      const [x2, y2] = point(radius, end);
      path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2}`;
    }
    return { ...segment, share, path };
  });
  return { placed, total };
}

// Só o aparelho com hover de verdade (mouse, trackpad) liga o realce pelo ponteiro: no toque o :hover fantasma grudaria.
function useHoverCapable() {
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setCanHover(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return canHover;
}

export interface DonutChartProps {
  segments: readonly DonutSegment[];
  // a espessura do anel no `viewBox` de 200
  thickness?: number;
  // o vão entre as fatias, em graus
  gap?: number;
  // a fatia em foco, a mesma no anel, no centro e na legenda (controlado)
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  // o clique numa linha da legenda (fixar a fatia)
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  // o nome do anel para o leitor de tela (a imagem)
  label: string;
  // os botões da legenda antes da hidratação
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

function useDonutModel({
  segments,
  thickness = 18,
  gap = 3,
  activeId,
  onActiveChange,
  onSelect,
  selectedId = null,
  label,
  disabled = false,
}: Omit<DonutChartProps, 'className' | 'children'>) {
  const reduce = useReducedMotion() ?? false;
  const canHover = useHoverCapable();
  const radius = 100 - thickness / 2 - 8;
  const { placed, total } = buildDonut(segments, { radius, thickness, gap });

  const [internal, setInternal] = useState<string | null>(null);
  const raw = activeId === undefined ? internal : activeId;
  // a fatia que saiu do dado solta o foco
  const active = raw !== null && placed.some((segment) => segment.id === raw) ? raw : null;

  const latest = useRef({ controlled: activeId !== undefined, onActiveChange });
  useLayoutEffect(() => {
    latest.current = { controlled: activeId !== undefined, onActiveChange };
  });
  const setActive = useCallback(
    (id: string | null) => {
      if (!latest.current.controlled) setInternal(id);
      latest.current.onActiveChange?.(id);
    },
    [setInternal],
  );

  return {
    placed,
    total,
    radius,
    thickness,
    active,
    setActive,
    onSelect,
    selectedId,
    label,
    disabled,
    reduce,
    canHover,
  };
}

type DonutModel = ReturnType<typeof useDonutModel>;
const DonutContext = createContext<DonutModel | null>(null);

function useDonutChart() {
  const model = useContext(DonutContext);
  if (!model) throw new Error('As partes da rosca vão dentro de DonutChart.');
  return model;
}

export function DonutChart({ className, children, ...props }: DonutChartProps) {
  const model = useDonutModel(props);
  return (
    <DonutContext.Provider value={model}>
      <div className={className ? `rosca ${className}` : 'rosca'}>{children}</div>
    </DonutContext.Provider>
  );
}

// a escala e a opacidade giram em torno do centro do anel, e não da caixa de cada arco
const RING_ORIGIN = {
  transformBox: 'view-box',
  transformOrigin: `${CENTER}px ${CENTER}px`,
} as const;

export function DonutChartPlot({
  children,
  className,
}: {
  // o que fica no meio do anel (DonutChartCenter)
  children?: ReactNode;
  className?: string;
}) {
  const { placed, radius, thickness, active, setActive, label, reduce, canHover } = useDonutChart();
  return (
    <div className={`relative mx-auto aspect-square w-full${className ? ` ${className}` : ''}`}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={label}
        className="size-full overflow-visible"
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          style={{ stroke: 'var(--color-surface-strong)' }}
        />
        {placed.map((segment) => {
          const focused = active === segment.id;
          const dimmed = active !== null && !focused;
          return (
            <motion.path
              key={segment.id}
              data-fatia={segment.id}
              d={segment.path}
              fill="none"
              strokeWidth={thickness}
              strokeLinecap="round"
              style={{ ...RING_ORIGIN, stroke: segment.color }}
              initial={false}
              animate={{ opacity: dimmed ? 0.3 : 1, scale: focused ? 1.05 : 1 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : {
                      opacity: { duration: MOTION.duration.fast, ease: MOTION.ease.outQuart },
                      scale: MOTION.spring.base,
                    }
              }
              pointerEvents="none"
              aria-hidden="true"
            />
          );
        })}
        {/* o anel de toque, um pouco mais largo e parado: a fatia que cresce não sai de baixo do ponteiro (a imagem já esconde o que há
            dentro dela do leitor de tela; a legenda é o caminho do teclado) */}
        <g>
          {placed.map((segment) => (
            <path
              key={segment.id}
              d={segment.path}
              fill="none"
              stroke="transparent"
              strokeWidth={thickness + 8}
              strokeLinecap="round"
              pointerEvents={canHover ? 'stroke' : 'none'}
              onPointerEnter={canHover ? () => setActive(segment.id) : undefined}
              onPointerLeave={canHover ? () => setActive(null) : undefined}
            />
          ))}
        </g>
      </svg>
      {children ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}

// O meio do anel: o que `children` desenha com a fatia em foco (ou nada em foco) e o total. Decorativo para o leitor de tela: a legenda diz o
// mesmo em cada linha, e a imagem tem o nome com todas as partes.
export function DonutChartCenter({
  children,
  className,
}: {
  children: (segment: PlacedSegment | null, total: number) => ReactNode;
  className?: string;
}) {
  const { placed, active, total } = useDonutChart();
  const segment = placed.find((item) => item.id === active) ?? null;
  return (
    <div
      aria-hidden="true"
      data-rosca-centro={segment?.id ?? 'total'}
      className={`relative max-w-[60%]${className ? ` ${className}` : ''}`}
    >
      {children(segment, total)}
    </div>
  );
}

// A legenda: cada linha é um botão que destaca a fatia (no ponteiro e no foco) e, no clique, a fixa; as setas andam entre as linhas. A barra
// da parte anda quando o dado muda (depois de lançar, editar ou apagar), nunca na abertura.
export function DonutChartLegend({
  renderLabel,
  renderValue,
  className,
}: {
  renderLabel: (segment: PlacedSegment) => ReactNode;
  renderValue: (segment: PlacedSegment) => ReactNode;
  className?: string;
}) {
  const { placed, active, setActive, onSelect, selectedId, disabled, reduce, canHover } =
    useDonutChart();
  return (
    <ul className={`space-y-0.5${className ? ` ${className}` : ''}`}>
      {placed.map((segment, index) => (
        <li key={segment.id}>
          <button
            type="button"
            data-legenda={segment.id}
            disabled={disabled}
            aria-pressed={onSelect ? selectedId === segment.id : undefined}
            data-ativa={active === segment.id || undefined}
            onClick={() => onSelect?.(segment.id)}
            onPointerEnter={canHover ? () => setActive(segment.id) : undefined}
            onPointerLeave={canHover ? () => setActive(null) : undefined}
            onFocus={() => setActive(segment.id)}
            onBlur={() => setActive(null)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const rows = event.currentTarget
                .closest('ul')
                ?.querySelectorAll<HTMLButtonElement>('[data-legenda]');
              rows?.[(index + step + placed.length) % placed.length]?.focus();
            }}
            className="rosca-linha"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex min-w-0 flex-1 items-center">{renderLabel(segment)}</span>{' '}
              <span className="shrink-0 text-right tabular-nums">{renderValue(segment)}</span>
            </span>
            <span aria-hidden="true" className="rosca-barra">
              <motion.span
                className="block h-full origin-left rounded-full"
                style={{ backgroundColor: segment.color }}
                initial={false}
                animate={{ scaleX: segment.share }}
                transition={reduce ? { duration: 0 } : MOTION.spring.slow}
              />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
