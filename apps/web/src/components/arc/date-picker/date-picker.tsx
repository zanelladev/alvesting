// Adaptado da Arc (https://uiarc.dev/components/date-picker), componente "date-picker" (registro https://uiarc.dev/r/date-picker.json, lido
// em 06/11/2026). Copyright (c) 2026 Elia Kuratli, licença MIT (o texto inteiro em components/arc/LICENSE).
// O que mudou (ADR 0037): os textos em português e o idioma padrão pt-BR ("Limpar", "Escolha um dia", "Escolhida: 15 de out. de 2026",
// "Calendário: <rótulo>"); o gatilho com 44 px e o desenho do campo do site (o cinza do painel, o fio de controle, o anel de foco e o fio do
// erro), com os ícones nossos no lugar do lucide-react; o nome do gatilho é o rótulo e a data que ele mostra (pelo `aria-labelledby`: com o
// <label> só, o leitor de tela não ouviria a data); a dica embaixo do rótulo, como nos outros campos do site; dois props para o formulário do
// site, `invalid` e `describedBy` (o erro do campo). Dentro do modal do lançamento: o calendário que abre vem para a vista quando o corpo do
// modal rola (`scrollIntoView`), e o Esc dentro dele fecha SÓ o calendário (o `preventDefault` além do `stopPropagation`: o <dialog> não
// recebe o pedido de fechar). A espera antes de fechar depois do toque num dia é a de 250 ms do projeto (a Arc tinha 300). O comportamento é o
// da Arc: o gatilho que abre o calendário embaixo dele, o foco no dia que tem a parada de Tab, cada parte da data que rola quando muda, o
// toque fora e o Tab para fora que fecham, e o foco de volta ao gatilho.
'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { Variants } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, FocusEvent, KeyboardEvent } from 'react';
import { IconeCalendario, IconeSetaBaixo } from '../../icones';
import { Calendar, type CalendarDateMatcher } from '../calendar/calendar';
import { motionTokens } from '../lib/motion-tokens';
import styles from './date-picker.module.css';

export interface DatePickerProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value' | 'onChange'
> {
  label: string;
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  description?: string;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  disabledDates?: CalendarDateMatcher;
  locale?: string;
  format?: Intl.DateTimeFormatOptions;
  /** Adds a Today button to the calendar header. */
  showToday?: boolean;
  /** O erro do formulário: o gatilho fica inválido, e `describedBy` liga a frase dele. */
  invalid?: boolean;
  describedBy?: string;
}

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const { spring, duration, ease, blur } = motionTokens;
const instant = { duration: duration.instant };
/** Each part of the date rolls with time: a later date rises from below, an earlier one drops from above. Parts that did not change stay still. */
const valueRoll: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    y: `${direction * 0.35}em`,
    filter: `blur(${blur.soft}px)`,
  }),
  center: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: duration.standard, ease: ease.enter },
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: `${direction * -0.3}em`,
    filter: `blur(${blur.subtle}px)`,
    transition: { duration: duration.fast, ease: ease.standard },
  }),
};
/** Reduced motion keeps a short crossfade; resting values match the roll so server and client markup agree. */
const valueFade: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, y: 0, filter: 'blur(0px)', transition: instant },
  exit: { opacity: 0, transition: instant },
};
/** The footer confirms the pick: new copy rises in with a soft blur while the old line lifts away. */
const statusRise: Variants = {
  enter: { opacity: 0, y: '0.3em', filter: `blur(${blur.soft}px)` },
  center: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: duration.standard, ease: ease.enter },
  },
  exit: {
    opacity: 0,
    y: '-0.3em',
    filter: `blur(${blur.subtle}px)`,
    transition: { duration: duration.fast, ease: ease.standard },
  },
};

export function DatePicker({
  label,
  value,
  onChange,
  description,
  placeholder = 'Escolha uma data',
  minDate,
  maxDate,
  disabledDates,
  locale = 'pt-BR',
  format = { day: 'numeric', month: 'short', year: 'numeric' },
  showToday,
  id,
  className,
  disabled,
  invalid = false,
  describedBy,
  ...buttonProps
}: DatePickerProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-rotulo`;
  const valueId = `${controlId}-valor`;
  const hintId = description ? `${controlId}-description` : undefined;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthStart(value ?? new Date()));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const formatter = new Intl.DateTimeFormat(locale, format);
  const reduce = useReducedMotion() ?? false;
  const time = value?.getTime() ?? null;
  const [previousTime, setPreviousTime] = useState(time);
  const [direction, setDirection] = useState(1);
  if (previousTime !== time) {
    setPreviousTime(time);
    setDirection(time === null || previousTime === null || time >= previousTime ? 1 : -1);
  }
  const shown = value ? formatter.format(value) : placeholder;
  const parts = value ? formatter.formatToParts(value) : [];
  // Parts after a wider or narrower segment move on the same curve the new text arrives on, so they never overlap it.
  const partMotion = reduce ? { duration: 0 } : { duration: duration.standard, ease: ease.enter };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        window.clearTimeout(closeTimer.current);
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.clearTimeout(closeTimer.current);
    };
  }, []);

  /** Opening moves focus to the day that owns the tab stop, so arrows work at once; a pointer open shows no ring. Inside a scrolling body
   * (the modal), the calendar comes into view: once now, and again when it has grown to its full size (it measures shorter while it grows in). */
  const intoView = () => popoverRef.current?.scrollIntoView({ block: 'nearest' });
  useEffect(() => {
    if (!open) return;
    intoView();
    popoverRef.current
      ?.querySelector<HTMLButtonElement>('[data-present] [data-date][tabindex="0"]')
      ?.focus({ preventScroll: true });
  }, [open]);

  /** Closing hands focus back to the trigger when it was inside the calendar, so keyboard users never land on the page body. */
  const close = () => {
    window.clearTimeout(closeTimer.current);
    if (popoverRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    setOpen(false);
  };
  /** The calendar always opens on the month of the current value, or today's month. */
  const show = () => {
    window.clearTimeout(closeTimer.current);
    setMonth(monthStart(value ?? maxDate ?? new Date()));
    setOpen(true);
  };
  /** A picked day lets the highlight glide onto it and the footer confirm it, then the calendar returns to the field. */
  const selectDate = (date: Date | undefined) => {
    onChange?.(date);
    window.clearTimeout(closeTimer.current);
    if (reduce || !date) close();
    else closeTimer.current = window.setTimeout(close, duration.slow * 1000);
  };
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') && !open) {
      event.preventDefault();
      show();
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };
  /** Tabbing past the popover closes it; focus moving within the field keeps it open. */
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !rootRef.current?.contains(next)) {
      window.clearTimeout(closeTimer.current);
      setOpen(false);
    }
  };

  return (
    <div
      className={[styles.field, className].filter(Boolean).join(' ')}
      ref={rootRef}
      onBlur={onBlur}
    >
      <label id={labelId} className={styles.label} htmlFor={controlId}>
        {label}
      </label>
      {description && (
        <p id={hintId} className="muted">
          {description}
        </p>
      )}
      <div className={styles.anchor}>
        {/* o `aria-invalid` é global no ARIA que o axe confere (e o formulário leva o foco ao primeiro campo inválido por ele); o plugin do
            lint segue a lista da ARIA 1.2, que o tirou do botão */}
        {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props */}
        <button
          {...buttonProps}
          ref={triggerRef}
          id={controlId}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-labelledby={`${labelId} ${valueId}`}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(' ') || undefined}
          aria-invalid={invalid || undefined}
          className={styles.trigger}
          onClick={() => (open ? close() : show())}
          onKeyDown={onTriggerKeyDown}
        >
          <span className={styles.calendarIcon}>
            <IconeCalendario size={18} />
          </span>
          <span id={valueId} className={styles.srOnly}>
            {shown}
          </span>
          <span className={styles.valueText} aria-hidden="true">
            <AnimatePresence mode="popLayout" initial={false} custom={1}>
              {value ? (
                <motion.span
                  key="value"
                  className={styles.value}
                  custom={1}
                  variants={reduce ? valueFade : valueRoll}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  {parts.map((part, index) => (
                    <motion.span
                      key={`${index}-${part.type}`}
                      className={styles.part}
                      layout="position"
                      layoutDependency={time}
                      transition={partMotion}
                    >
                      {part.type === 'literal' ? (
                        <span className={styles.partValue}>{part.value}</span>
                      ) : (
                        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                          <motion.span
                            key={part.value}
                            className={styles.partValue}
                            custom={direction}
                            variants={reduce ? valueFade : valueRoll}
                            initial="enter"
                            animate="center"
                            exit="exit"
                          >
                            {part.value}
                          </motion.span>
                        </AnimatePresence>
                      )}
                    </motion.span>
                  ))}
                </motion.span>
              ) : (
                <motion.span
                  key="placeholder"
                  className={styles.placeholder}
                  custom={-1}
                  variants={reduce ? valueFade : valueRoll}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  {placeholder}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span className={styles.chevron}>
            <IconeSetaBaixo size={16} />
          </span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              ref={popoverRef}
              className={styles.popover}
              role="dialog"
              aria-label={`Calendário: ${label}`}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                }
              }}
              onAnimationComplete={(definition) => {
                if ((definition as { opacity?: number }).opacity === 1) intoView();
              }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.95 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                transition: reduce
                  ? instant
                  : { ...spring.snappy, opacity: { duration: duration.fast, ease: ease.enter } },
              }}
              exit={{
                opacity: 0,
                ...(reduce ? {} : { y: -6, scale: 0.97 }),
                transition: { duration: duration.fast, ease: ease.standard },
              }}
            >
              <Calendar
                value={value}
                onChange={selectDate}
                month={month}
                onMonthChange={setMonth}
                minDate={minDate}
                maxDate={maxDate}
                disabledDates={disabledDates}
                locale={locale}
                showToday={showToday}
              />
              <div className={styles.footer}>
                <button type="button" onClick={() => selectDate(undefined)} disabled={!value}>
                  Limpar
                </button>
                <span className={styles.status}>
                  <AnimatePresence initial={false}>
                    <motion.span
                      key={time ?? 'none'}
                      variants={reduce ? valueFade : statusRise}
                      initial="enter"
                      animate="center"
                      exit="exit"
                    >
                      {value ? `Escolhida: ${formatter.format(value)}` : 'Escolha um dia'}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
