// Adaptado da Arc (https://uiarc.dev/components/number-field), componente "number-field" (registro https://uiarc.dev/r/number-field.json,
// lido em 06/11/2026). Copyright (c) 2026 Elia Kuratli, licença MIT (o texto inteiro em components/arc/LICENSE).
// O que mudou (ADR 0037): os textos em português e o idioma padrão pt-BR ("1.000"; "Aumentar quantidade", "Diminuir quantidade", "Mín." e
// "Máx.", e o "mínimo" e o "máximo" que a região viva anuncia); os botões − e + com 44 px (a Arc ia até 40) e o nosso desenho (o campo do
// projeto: 44 px, raio 8, o cinza do painel, o fio de controle, o anel de foco do site e o fio do erro), com os ícones nossos no lugar do
// lucide-react; a dica embaixo do rótulo, como nos outros campos do site, e sem a animação de texto que troca (a dica não muda); dois props
// para o formulário do site, `invalid` e `describedBy` (o erro do campo, ligado por aria-describedby). Saíram o que nenhuma tela usa: o
// arrastar o rótulo (`scrub`), o prefixo e o sufixo, os tamanhos, o `formatOptions` e o `disabled` (o <fieldset> desativado do formulário
// desativa o campo e os botões). O comportamento é o da Arc: os algarismos rolam no − e no + (uma roda por algarismo, para o lado em que o
// número andou), segurar repete e acelera, as setas, o PageUp, o PageDown, o Home e o End, e no limite o número faz força e volta (com
// movimento reduzido, só a cor muda); o que se digita vale enquanto está dentro dos limites, e o Enter e o sair do campo o confirmam.
'use client';

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type Variants,
} from 'motion/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { IconeAdicionar, IconeSubtrair } from '../../icones';
import { motionTokens } from '../lib/motion-tokens';
import styles from './number-field.module.css';

export interface NumberFieldProps {
  label: string;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** PageUp, PageDown, and Shift with an arrow move this far. Defaults to ten steps. */
  largeStep?: number;
  description?: string;
  /** Formatting locale. Fixed by default so server and client render the same digits. */
  locale?: string;
  /** A short note beside the label when a press meets a limit or a typed value passes one. `false` hides it; a function writes the copy. */
  limitHint?: boolean | ((edge: 'min' | 'max', limit: number) => string);
  /** O erro do formulário: o campo fica inválido, e `describedBy` liga a frase dele. */
  invalid?: boolean;
  describedBy?: string;
}

type Source = 'button' | 'key' | 'type';
type Part = { key: string; digit: number } | { key: string; text: string };

const { spring, duration, blur } = motionTokens;
const exitEase = [...motionTokens.ease.standard] as [number, number, number, number];
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/** The pause before a held control repeats, and the fastest repeat. */
const HOLD_DELAY = 400,
  HOLD_FASTEST = 40;
/** A held press keeps leaning on a limit at this cadence, how long the limit note stays, and how long an under-minimum draft waits
 * before it warns (a short draft is often on its way to a larger number). */
const LIMIT_PUSH = 240,
  LIMIT_HINT_MS = 1500,
  UNDER_WARN_MS = 700;
/** Pushes that arrive within this window count as one continued effort, so each strains a little further, up to the cap. */
const PUSH_WINDOW = 700,
  PUSH_GAIN = 0.22,
  PUSH_CAP = 4;
/** A velocity kick on the value at a limit: it strains a few pixels toward the press and springs home. Motion drops velocity on
 * time-defined springs, so the kick runs the morph spring expressed as stiffness and damping. */
const BUMP_VELOCITY = 130;
const kick = (() => {
  const root = (2 * Math.PI) / (spring.morph.visualDuration * 1.2);
  return {
    type: 'spring' as const,
    stiffness: root * root,
    damping: 2 * (1 - spring.morph.bounce) * root,
  };
})();

const decimalsOf = (value: number) => (String(value).split('.')[1] ?? '').length;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
// "Quantidade" -> "quantidade": o nome dos botões ("Aumentar quantidade")
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Split a formatted number into columns keyed by place value, so 9 → 10 keeps the ones column the ones column. */
function partsOf(value: number, format: Intl.NumberFormat): Part[] {
  const parts = format.formatToParts(value);
  let place = parts.reduce(
    (count, part) => count + (part.type === 'integer' ? part.value.length : 0),
    0,
  );
  let fraction = 0;
  return parts.flatMap((part, index): Part[] => {
    if (part.type === 'integer')
      return [...part.value].map((char) => ({ key: `i${--place}`, digit: Number(char) }));
    if (part.type === 'fraction')
      return [...part.value].map((char) => ({ key: `f${fraction++}`, digit: Number(char) }));
    return [
      {
        key:
          part.type === 'group'
            ? `g${place}`
            : part.type === 'decimal'
              ? 'd'
              : part.type === 'minusSign'
                ? 'm'
                : `${part.type}${index}`,
        text: part.value,
      },
    ];
  });
}

/* A column or character opens its width while it rises in the direction of change, and closes on a critically damped spring so it never passes zero.
   Scale and opacity ride the same spring as width, so a digit grows with its slot instead of landing on its neighbours. */
const slot: Variants = {
  enter: (direction: number) => ({
    width: 0,
    scale: 0.6,
    opacity: 0,
    y: `${direction * 0.3}em`,
    filter: `blur(${blur.soft}px)`,
  }),
  center: {
    width: 'auto',
    scale: 1,
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transitionEnd: { filter: 'none' },
    transition: {
      width: spring.morph,
      scale: spring.morph,
      opacity: spring.morph,
      y: spring.snappy,
      filter: { duration: duration.slow, ease: exitEase },
    },
  },
  exit: (direction: number) => ({
    width: 0,
    scale: 0.6,
    opacity: 0,
    y: `${direction * -0.3}em`,
    filter: `blur(${blur.subtle}px)`,
    transition: {
      width: spring.smooth,
      scale: spring.smooth,
      y: { duration: duration.fast, ease: exitEase },
      opacity: { duration: duration.instant },
      filter: { duration: duration.instant },
    },
  }),
};
/* Reduced motion keeps a short fade and no travel. While typing, columns follow the draft at once so they never lag the caret.
   Every resting state matches `slot`, so a page hydrated with reduced motion renders the same styles as the server. */
const rest = (opacity: number) => ({ width: 'auto', scale: 1, opacity, y: 0, filter: 'none' });
const still: Variants = {
  enter: rest(0),
  center: { ...rest(1), transition: { duration: duration.instant } },
  exit: { width: 0, opacity: 0, transition: { duration: 0 } },
};
const cut: Variants = {
  enter: rest(1),
  center: { ...rest(1), transition: { duration: 0 } },
  exit: { width: 0, opacity: 0, transition: { duration: 0 } },
};

/** One digit on the wheel. Its distance from the wheel position sets where it sits, how clear it is, and whether it shows. */
function Glyph({ position, digit }: { position: MotionValue<number>; digit: number }) {
  // Every style reads the wheel directly: a chained transform can update a frame late and leave the wheel blank on a jump.
  const offset = (current: number) => ((((digit - current) % 10) + 15) % 10) - 5;
  const y = useTransform(position, (current) => `${offset(current) * 1.05}em`);
  // An eased falloff keeps a turning digit legible through the middle of the roll instead of washing out.
  const opacity = useTransform(position, (current) =>
    Math.max(0, 1 - Math.abs(offset(current)) ** 1.5 * 1.1),
  );
  const visibility = useTransform(position, (current) =>
    Math.abs(offset(current)) >= 1 ? 'hidden' : 'visible',
  );
  const filter = useTransform(position, (current) => {
    const distance = Math.abs(offset(current));
    return distance < 0.02 || distance >= 1
      ? 'none'
      : `blur(${(distance * blur.soft * 0.75).toFixed(2)}px)`;
  });
  return (
    <motion.span className={styles.glyph} style={{ y, opacity, filter, visibility }}>
      {digit}
    </motion.span>
  );
}

/** An odometer wheel. It turns the way the whole number moved, wraps 9 → 0, and retargets mid spin when steps arrive quickly. */
function Wheel({
  digit,
  direction,
  instant,
}: {
  digit: number;
  direction: number;
  instant: boolean;
}) {
  const reduced = useReducedMotion();
  const position = useMotionValue(digit);
  const wheel = useRef({ digit, target: digit });
  useLayoutEffect(() => {
    const state = wheel.current;
    if (state.digit === digit) return;
    // Turn the way the number moved, unless that is more than half a turn; then take the short way, so a big clamp never spins.
    let delta =
      direction > 0 ? (digit - state.digit + 10) % 10 : -((state.digit - digit + 10) % 10);
    if (Math.abs(delta) > 5) delta -= Math.sign(delta) * 10;
    state.target += delta;
    state.digit = digit;
    if (instant || reduced) position.jump(state.target);
    else animate(position, state.target, spring.snappy);
  }, [digit, direction, instant, position, reduced]);
  return (
    <>
      <span className={styles.sizer}>0</span>
      {DIGITS.map((item) => (
        <Glyph key={item} position={position} digit={item} />
      ))}
    </>
  );
}

function Digits({
  value,
  format,
  direction,
  instant,
}: {
  value: number;
  format: Intl.NumberFormat;
  direction: number;
  instant: boolean;
}) {
  const reduced = useReducedMotion();
  const variants = instant ? cut : reduced ? still : slot;
  return (
    <AnimatePresence initial={false} custom={direction}>
      {partsOf(value, format).map((part) => (
        <motion.span
          key={part.key}
          className={'digit' in part ? styles.column : styles.symbol}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          {'digit' in part ? (
            <Wheel digit={part.digit} direction={direction} instant={instant} />
          ) : (
            part.text
          )}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** The limit note rises in from the side it guards (up for a maximum, down for a minimum) and fades out in place. */
function LimitNote({ id, edge, text }: { id: string; edge: 1 | -1 | 0; text: string }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {edge !== 0 && (
        <motion.span
          key="limit"
          id={id}
          className={styles.limit}
          initial={
            reduced
              ? { opacity: 0 }
              : { opacity: 0, y: `${edge * 0.45}em`, filter: `blur(${blur.subtle}px)` }
          }
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
          exit={{
            opacity: 0,
            transition: {
              duration: reduced ? duration.instant : duration.standard,
              ease: exitEase,
            },
          }}
          transition={
            reduced
              ? { duration: duration.instant }
              : {
                  y: spring.snappy,
                  opacity: { duration: duration.fast },
                  filter: { duration: duration.fast },
                }
          }
        >
          {text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** Pointer presses hold to repeat; keyboard and assistive clicks (detail 0) take one step. */
function StepButton({
  toward,
  label,
  controls,
  limit,
  pressed,
  iconRef,
  onPress,
  onRelease,
  onActivate,
}: {
  toward: 1 | -1;
  label: string;
  controls: string;
  limit: boolean;
  pressed: boolean;
  iconRef: Ref<HTMLSpanElement>;
  onPress: () => void;
  onRelease: () => void;
  onActivate: () => void;
}) {
  // A limit dims the button but keeps it focusable, so a press there strains the value instead of dropping focus.
  // Mouse presses keep focus where it was: an open draft commits with the step, and the stepper never steals the ring.
  return (
    <button
      type="button"
      className={styles.step}
      aria-controls={controls}
      aria-label={`${toward > 0 ? 'Aumentar' : 'Diminuir'} ${lower(label)}`}
      aria-disabled={limit || undefined}
      data-pressed={pressed || undefined}
      onPointerDown={(event) => {
        if (event.button === 0) onPress();
      }}
      onPointerUp={onRelease}
      onPointerLeave={onRelease}
      onPointerCancel={onRelease}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.detail === 0) onActivate();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span ref={iconRef} className={styles.icon}>
        {toward > 0 ? <IconeAdicionar size={18} /> : <IconeSubtrair size={18} />}
      </span>
    </button>
  );
}

/**
 * A bounded number with odometer digits. Buttons and arrow keys repeat and speed up while held, PageUp and PageDown take
 * large steps, and Home and End jump to the limits. Typing edits a plain draft that applies live while valid; the rolling
 * digits return once it commits on Enter, blur, or the next step.
 */
export function NumberField({
  label,
  value,
  defaultValue = 0,
  onValueChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step: stepProp = 1,
  largeStep,
  description,
  locale = 'pt-BR',
  limitHint = true,
  invalid = false,
  describedBy: extraDescribedBy,
}: NumberFieldProps) {
  const reduced = useReducedMotion();
  const inputId = useId();
  const hintId = description ? `${inputId}-description` : undefined;
  const limitId = `${inputId}-limit`;
  const step = stepProp > 0 ? stepProp : 1;
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [pressed, setPressed] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  /** The limit a press just met, shown for a moment; and whether a draft under the minimum has sat long enough to warn. */
  const [pushed, setPushed] = useState<1 | -1 | 0>(0);
  const [underWarn, setUnderWarn] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const minusIcon = useRef<HTMLSpanElement>(null);
  const plusIcon = useRef<HTMLSpanElement>(null);
  const pushedTimer = useRef<number | undefined>(undefined);
  const underTimer = useRef<number | undefined>(undefined);
  const strainTimer = useRef<number | undefined>(undefined);
  const effort = useRef({ edge: 0, count: 0, at: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const latest = useRef(current);
  const editStart = useRef(current);
  const hold = useRef<number | undefined>(undefined);
  const shiftFrom = useRef<number | null>(null);
  const selectNext = useRef(false);
  const live = useRef<(direction: 1 | -1, steps: number, source: Source) => boolean>(() => false);
  const bumpY = useMotionValue(0);
  const shiftX = useMotionValue(0);

  const base = Number.isFinite(min) ? min : 0;
  const decimals = Math.max(decimalsOf(step), decimalsOf(base));
  const format = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        numberingSystem: 'latn',
      }),
    [locale, decimals],
  );
  const symbols = useMemo(() => {
    const parts = new Intl.NumberFormat(locale).formatToParts(-1234.5);
    return {
      group: parts.find((part) => part.type === 'group')?.value ?? ',',
      decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    };
  }, [locale]);
  const round = (next: number) => Number(next.toFixed(decimals)) || 0;
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const snap = (next: number) => round(base + Math.round((next - base) / step) * step);
  /** Off-grid values move to the next grid line in the direction of travel, then whole steps from there. */
  const stepFrom = (from: number, steps: number) => {
    const index = (from - base) / step;
    return round(
      base + ((steps > 0 ? Math.floor(index + 1e-7) : Math.ceil(index - 1e-7)) + steps) * step,
    );
  };
  const spoken = (next: number) => format.format(next);
  function parse(text: string) {
    const normalized = text
      .split(symbols.group)
      .join('')
      .replace(symbols.decimal, '.')
      .replace(/[^\d.-]/g, '');
    if (!/\d/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const typed = editing ? parse(draft) : null;
  const shown = typed ?? current;
  const [trail, setTrail] = useState({ value: shown, direction: 1 as 1 | -1 });
  if (trail.value !== shown) setTrail({ value: shown, direction: shown > trail.value ? 1 : -1 });
  const direction = trail.value === shown ? trail.direction : shown > trail.value ? 1 : -1;

  useEffect(
    () => () => {
      window.clearTimeout(hold.current);
      window.clearTimeout(pushedTimer.current);
      window.clearTimeout(underTimer.current);
      window.clearTimeout(strainTimer.current);
    },
    [],
  );

  /** A press past a limit. The value strains toward it and springs home, a little further with each push in a row (capped, like
   * overscroll); the refused button shakes once; the note names the limit. Reduced motion keeps only a brief color change. */
  function strain(edge: 1 | -1, source: Source) {
    const now = performance.now(),
      push = effort.current;
    push.count = push.edge === edge && now - push.at < PUSH_WINDOW ? push.count + 1 : 1;
    push.edge = edge;
    push.at = now;
    const control = controlRef.current;
    if (control) {
      control.dataset.strain = edge > 0 ? 'max' : 'min';
      window.clearTimeout(strainTimer.current);
      strainTimer.current = window.setTimeout(() => {
        delete control.dataset.strain;
      }, 420);
    }
    if (!reduced) {
      animate(bumpY, 0, {
        ...kick,
        velocity: -edge * BUMP_VELOCITY * (1 + Math.min(push.count - 1, PUSH_CAP) * PUSH_GAIN),
      });
      const icon = (edge > 0 ? plusIcon : minusIcon).current;
      if (icon && source !== 'type')
        animate(
          icon,
          { x: [0, -2.5, 2.5, -1.5, 1, 0] },
          { duration: duration.slow, ease: 'easeOut' },
        );
    }
    if (limitHint) {
      setPushed(edge);
      window.clearTimeout(pushedTimer.current);
      pushedTimer.current = window.setTimeout(() => setPushed(0), LIMIT_HINT_MS);
    }
  }
  /** Every change lands here. A value past a limit clamps, strains toward it, and says which limit it met. */
  function commitValue(next: number, source: Source) {
    if (!Number.isFinite(next)) return false;
    const clamped = clamp(next);
    const limit = Math.sign(next - clamped);
    if (limit) {
      strain(limit > 0 ? 1 : -1, source);
      setAnnouncement(`${spoken(clamped)}, ${limit > 0 ? 'máximo' : 'mínimo'}`);
    } else if (source === 'button' && clamped !== latest.current) setAnnouncement(spoken(clamped));
    if (clamped === latest.current) return false;
    latest.current = clamped;
    if (value === undefined) setInternal(clamped);
    onValueChange?.(clamped);
    return true;
  }
  const nudge = (toward: 1 | -1, steps: number, source: Source) =>
    commitValue(stepFrom(latest.current, toward * steps), source);
  useLayoutEffect(() => {
    latest.current = current;
    live.current = nudge;
  });

  /** The group glides back to center when typing changes its width, instead of hopping half a character per key. */
  function captureShift() {
    const group = groupRef.current;
    if (group && shiftFrom.current === null)
      shiftFrom.current = group.getBoundingClientRect().left - shiftX.get();
  }
  useLayoutEffect(() => {
    const from = shiftFrom.current,
      group = groupRef.current;
    shiftFrom.current = null;
    // After a commit the caret collapses to the end, so no selection box sits over the rolling digits.
    if (selectNext.current) {
      selectNext.current = false;
      const input = inputRef.current;
      if (input && document.activeElement === input) {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }
    }
    if (from === null || !group) return;
    const delta = from - (group.getBoundingClientRect().left - shiftX.get());
    if (Math.abs(delta) < 0.5) return;
    shiftX.set(shiftX.get() + delta);
    if (reduced) shiftX.jump(0);
    else animate(shiftX, 0, spring.morph);
  });

  function clearUnder() {
    window.clearTimeout(underTimer.current);
    setUnderWarn(false);
  }
  function commitDraft() {
    if (!editing) return;
    captureShift();
    setEditing(false);
    clearUnder();
    const parsed = parse(draft);
    if (parsed !== null) commitValue(snap(parsed), 'type');
  }
  function stopHold() {
    window.clearTimeout(hold.current);
    hold.current = undefined;
    setPressed(0);
  }
  /** One step now; after a pause, repeats that speed up gently until release. Held into a limit, it keeps leaning on it at a
   * steady cadence, each push straining a little further, until the press lets go. */
  function startHold(toward: 1 | -1, amount: number, source: Source) {
    stopHold();
    commitDraft();
    const steps = Math.max(1, Math.round(amount / step));
    if (source === 'button') setPressed(toward);
    let count = 0;
    const tick = () => {
      const moved = live.current(toward, steps, source);
      hold.current = window.setTimeout(
        tick,
        moved ? Math.max(HOLD_FASTEST, 150 * 0.86 ** ++count) : LIMIT_PUSH,
      );
    };
    hold.current = window.setTimeout(
      tick,
      nudge(toward, steps, source) ? HOLD_DELAY : LIMIT_PUSH + 120,
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const large = largeStep ?? step * 10;
    const move = (
      {
        ArrowUp: [1, event.shiftKey ? large : step],
        ArrowDown: [-1, event.shiftKey ? large : step],
        PageUp: [1, large],
        PageDown: [-1, large],
      } as Record<string, [1 | -1, number]>
    )[event.key];
    if (move) {
      event.preventDefault();
      if (!event.repeat) startHold(move[0], move[1], 'key');
      return;
    }
    // Home and End reach the limits; while a draft is open they move the caret as in any text field.
    if (
      !editing &&
      ((event.key === 'Home' && Number.isFinite(min)) ||
        (event.key === 'End' && max < Number.MAX_SAFE_INTEGER))
    ) {
      event.preventDefault();
      commitValue(event.key === 'Home' ? min : max, 'key');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (editing) {
        selectNext.current = true;
        commitDraft();
      } else event.currentTarget.select();
    }
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      captureShift();
      setEditing(false);
      clearUnder();
      selectNext.current = true;
      commitValue(editStart.current, 'type');
    }
  }
  function onChange(text: string) {
    const allowed = new RegExp(
      `[^0-9${escape(symbols.group)}${decimals ? escape(symbols.decimal) : ''}${min < 0 ? '\\-' : ''}]`,
      'g',
    );
    const next = text.replace(allowed, '');
    if (!editing) editStart.current = current;
    captureShift();
    setDraft(next);
    setEditing(true);
    // Valid drafts apply as they are typed, so anything that depends on the value follows along.
    const parsed = parse(next);
    if (parsed !== null && parsed >= min && parsed <= max && snap(parsed) === parsed)
      commitValue(parsed, 'type');
    // Past the maximum warns at once; under the minimum waits, since "1" is often the start of "12".
    clearUnder();
    if (parsed !== null && parsed < min)
      underTimer.current = window.setTimeout(() => setUnderWarn(true), UNDER_WARN_MS);
  }

  const stepper = (toward: 1 | -1) => ({
    toward,
    label,
    controls: inputId,
    limit: toward > 0 ? shown >= max : shown <= min,
    pressed: pressed === toward,
  });
  /** A typed value past a limit holds a calm warning until it commits and springs back. */
  const outside: 1 | -1 | 0 =
    typed === null ? 0 : typed > max ? 1 : typed < min && underWarn ? -1 : 0;
  const noteEdge = limitHint ? outside || pushed : 0;
  const noteLimit = noteEdge > 0 ? max : min;
  const noteText = !noteEdge
    ? ''
    : typeof limitHint === 'function'
      ? limitHint(noteEdge > 0 ? 'max' : 'min', noteLimit)
      : `${noteEdge > 0 ? 'Máx.' : 'Mín.'} ${spoken(noteLimit)}`;
  const describedBy =
    [hintId, outside && limitHint ? limitId : undefined, extraDescribedBy]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        <LimitNote id={limitId} edge={noteEdge} text={noteText} />
      </div>
      {description ? (
        <p id={hintId} className="muted">
          {description}
        </p>
      ) : null}
      <div ref={controlRef} className={styles.control} data-warn={outside ? true : undefined}>
        <StepButton
          {...stepper(-1)}
          iconRef={minusIcon}
          onPress={() => startHold(-1, step, 'button')}
          onRelease={stopHold}
          onActivate={() => {
            commitDraft();
            nudge(-1, 1, 'button');
          }}
        />
        <div
          className={styles.valueWrap}
          onMouseDown={(event) => {
            if (event.target !== inputRef.current) event.preventDefault();
          }}
          onClick={(event) => {
            if (event.target !== inputRef.current && !inputRef.current?.disabled) {
              inputRef.current?.focus();
              inputRef.current?.select();
            }
          }}
        >
          <motion.span ref={groupRef} className={styles.value} style={{ x: shiftX, y: bumpY }}>
            <span className={styles.number}>
              <span
                className={styles.display}
                data-hidden={editing || undefined}
                aria-hidden="true"
              >
                <Digits value={shown} format={format} direction={direction} instant={editing} />
              </span>
              {editing && (
                <span className={styles.mirror} aria-hidden="true">
                  {draft}
                </span>
              )}
              <input
                ref={inputRef}
                id={inputId}
                className={styles.input}
                type="text"
                role="spinbutton"
                inputMode={min < 0 ? 'text' : decimals ? 'decimal' : 'numeric'}
                autoComplete="off"
                spellCheck={false}
                value={editing ? draft : format.format(current)}
                aria-describedby={describedBy}
                aria-invalid={outside || invalid ? true : undefined}
                aria-valuenow={current}
                aria-valuetext={spoken(current)}
                aria-valuemin={Number.isFinite(min) ? min : undefined}
                aria-valuemax={max < Number.MAX_SAFE_INTEGER ? max : undefined}
                onChange={(event) => onChange(event.currentTarget.value)}
                onKeyDown={onKeyDown}
                onKeyUp={(event) => {
                  if (/^(Arrow(Up|Down)|Page(Up|Down))$/.test(event.key)) stopHold();
                }}
                onBlur={() => {
                  stopHold();
                  commitDraft();
                }}
              />
            </span>
          </motion.span>
        </div>
        <StepButton
          {...stepper(1)}
          iconRef={plusIcon}
          onPress={() => startHold(1, step, 'button')}
          onRelease={stopHold}
          onActivate={() => {
            commitDraft();
            nudge(1, 1, 'button');
          }}
        />
      </div>
      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
}
