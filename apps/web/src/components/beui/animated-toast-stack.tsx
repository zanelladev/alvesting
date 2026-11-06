// Adaptado do Animated Toast Stack da beUI (https://beui.dev/components/motion/animated-toast-stack; registro
// https://beui.dev/r/animated-toast-stack, lido em 05/11/2026, `updated_at` 18/10/2026). Copyright (c) 2026 Saurabh Chauhan, licença MIT (o
// texto inteiro em components/beui/LICENSE).
// O que veio de lá: a pilha numa lista ordenada com `aria-live="polite"` (o leitor de tela anuncia o aviso novo sem interromper), o fechar como
// botão com nome, o gancho que acrescenta, tira e some com o aviso depois do prazo, o limite da pilha, a entrada por mola, a pilha que se
// rearruma pelo `layout` quando um aviso chega ou sai, e o arrastar para o lado para fechar (desligado com movimento reduzido).
// O que mudou (ADR 0037; docs/DEPENDENCIAS.md): sem lucide-react, `cn`, clsx e tailwind-merge (os ícones são os nossos, `Icone`, e as classes
// juntam por texto); as cores são os tokens (o canvas com a sombra de elevação, sem o vidro e sem o fio junto da sombra larga); o texto em
// português e inteiro (o aviso não é cortado: o que o leitor de tela ouve é o que se vê); a mola e as curvas do lib/motion.ts, sem quique; a
// saída é curta e só desce 8 px; com movimento reduzido a troca é na hora (nada esmaece); a pilha mora no lugar do documento em que a página a
// põe (sem portal: fica dentro do `main`, na ordem do Tab), e o CSS a fixa no pé da tela (globals.css, `.aviso-pilha`). Acrescentado: o aviso
// recebe o foco quando a página manda (`tabIndex=-1`, `data-aviso`), o Esc o fecha, e o prazo para enquanto o ponteiro está sobre a pilha ou o
// foco está nela (WCAG 2.2.1), e a pausa sai com o aviso que deixa a tela com o ponteiro em cima; fechado pelo teclado com o foco dentro, o foco
// vai aonde a página diz (`onFocusLeave`). Saíram o estado
// "carregando", a ação, o `updateToast`, o portal e as posições que não usamos.

'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MOTION } from '../../lib/motion';
import { Icone } from '../icones';

export type ToastStatus = 'success' | 'error' | 'info';

export interface AnimatedToast {
  id: string;
  title: string;
  status: ToastStatus;
  // em ms; 0 deixa o aviso até alguém fechá-lo
  duration: number;
  createdAt: number;
}

export interface ToastInput {
  title: string;
  status?: ToastStatus;
  duration?: number;
}

// o que segura o prazo: o ponteiro sobre a pilha ou o foco dentro dela
export type ToastHold = 'hover' | 'focus';

let idSeed = 0;

export function useAnimatedToastStack({
  defaultDuration = 6_000,
  limit = 3,
}: { defaultDuration?: number; limit?: number } = {}) {
  const [toasts, setToasts] = useState<AnimatedToast[]>([]);
  const holds = useRef(new Set<ToastHold>());
  const [held, setHeld] = useState(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (input: ToastInput) => {
      idSeed += 1;
      const toast: AnimatedToast = {
        id: `aviso-${idSeed}`,
        title: input.title,
        status: input.status ?? 'success',
        duration: input.duration ?? defaultDuration,
        createdAt: Date.now(),
      };
      setToasts((current) => [...current, toast].slice(-limit));
      return toast.id;
    },
    [defaultDuration, limit],
  );

  // Ao soltar o último motivo de segurar, cada aviso ganha o prazo inteiro de novo: quem leu com o ponteiro em cima não perde o aviso no instante
  // em que tira o ponteiro.
  const hold = useCallback((why: ToastHold, on: boolean) => {
    const current = holds.current;
    if (current.has(why) === on) return;
    if (on) current.add(why);
    else current.delete(why);
    setHeld(current.size > 0);
    if (current.size === 0) {
      setToasts((list) => list.map((toast) => ({ ...toast, createdAt: Date.now() })));
    }
  }, []);

  useEffect(() => {
    if (held) return;
    const timers = toasts
      .filter((toast) => toast.duration > 0)
      .map((toast) =>
        window.setTimeout(
          () => dismissToast(toast.id),
          Math.max(toast.duration - (Date.now() - toast.createdAt), 0),
        ),
      );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismissToast, held, toasts]);

  return useMemo(
    () => ({ toasts, showToast, dismissToast, hold }),
    [dismissToast, hold, showToast, toasts],
  );
}

const STATUS_ICON: Record<ToastStatus, { path: string; className: string }> = {
  success: { path: 'M6 10.5l2.75 2.75L14 7.5', className: 'text-semantic-success' },
  error: { path: 'M10 6v4.5M10 13.75v.01', className: 'text-semantic-error' },
  info: { path: 'M10 9.25V14M10 6.25v.01', className: 'text-muted' },
};

export interface AnimatedToastStackProps {
  toasts: readonly AnimatedToast[];
  onDismiss: (id: string) => void;
  onHold?: (why: ToastHold, on: boolean) => void;
  // fechado pelo teclado com o foco dentro: para onde o foco vai (sem isto, ele cairia no <body>)
  onFocusLeave?: () => void;
  maxVisible?: number;
  label?: string;
  className?: string;
}

export function AnimatedToastStack({
  toasts,
  onDismiss,
  onHold,
  onFocusLeave,
  maxVisible = 3,
  label = 'Avisos',
  className,
}: AnimatedToastStackProps) {
  const visible = toasts.slice(-maxVisible);
  return (
    <ol
      aria-live="polite"
      aria-atomic="false"
      aria-label={label}
      className={className ? `aviso-pilha ${className}` : 'aviso-pilha'}
      onFocus={() => onHold?.('focus', true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onHold?.('focus', false);
        }
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={onDismiss}
            onHold={onHold}
            onFocusLeave={onFocusLeave}
          />
        ))}
      </AnimatePresence>
    </ol>
  );
}

const ToastItem = memo(function ToastItem({
  toast,
  onDismiss,
  onHold,
  onFocusLeave,
}: {
  toast: AnimatedToast;
  onDismiss: (id: string) => void;
  onHold?: (why: ToastHold, on: boolean) => void;
  onFocusLeave?: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const item = useRef<HTMLLIElement>(null);
  const icon = STATUS_ICON[toast.status];
  // O ponteiro sobre o aviso segura o prazo. O aviso que sai da tela com o ponteiro em cima (fechado pelo mouse, arrastado, empurrado pelo limite
  // da pilha) não recebe o `pointerleave`: a pausa sai com ele, senão os avisos seguintes não sumiriam mais.
  const hovering = useRef(false);
  useEffect(
    () => () => {
      if (hovering.current) onHold?.('hover', false);
    },
    [onHold],
  );

  // `keyboard`: o Esc, ou o Enter e o Espaço no botão (o clique do teclado chega com `detail` 0)
  const close = (keyboard: boolean) => {
    const hadFocus = item.current?.contains(document.activeElement) ?? false;
    onDismiss(toast.id);
    if (hadFocus) onHold?.('focus', false);
    if (hadFocus && keyboard) onFocusLeave?.();
  };

  return (
    <motion.li
      ref={item}
      tabIndex={-1}
      data-aviso={toast.id}
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.96, filter: 'blur(4px)' }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0 } }
          : {
              opacity: 0,
              y: 8,
              filter: 'blur(4px)',
              transition: { duration: MOTION.duration.fast, ease: MOTION.ease.outQuart },
            }
      }
      transition={reduce ? { duration: 0 } : MOTION.spring.base}
      drag={reduce ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.18}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) > 72 || Math.abs(info.velocity.x) > 520) close(false);
      }}
      onPointerEnter={() => {
        hovering.current = true;
        onHold?.('hover', true);
      }}
      onPointerLeave={() => {
        hovering.current = false;
        onHold?.('hover', false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close(true);
      }}
      className="aviso"
    >
      <span aria-hidden="true" className={`aviso-icone ${icon.className}`}>
        <Icone size={16}>
          {toast.status === 'success' ? null : <circle cx="10" cy="10" r="7" />}
          <path d={icon.path} />
        </Icone>
      </span>
      <p className="min-w-0 flex-1 py-2.5 text-sm font-medium text-pretty text-ink">
        {toast.title}
      </p>
      <button
        type="button"
        aria-label="Fechar aviso"
        className="aviso-fechar"
        onClick={(event) => close(event.detail === 0)}
      >
        <span aria-hidden="true">
          <Icone size={16}>
            <path d="M6 6l8 8M14 6l-8 8" />
          </Icone>
        </span>
      </button>
    </motion.li>
  );
});
