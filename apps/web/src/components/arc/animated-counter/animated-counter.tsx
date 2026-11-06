// Adaptado da Arc (https://uiarc.dev/components/animated-counter), componente "animated-counter" (registro https://uiarc.dev/r/animated-counter.json, lido em
// 05/11/2026). Copyright (c) 2026 Elia Kuratli, licença MIT (o texto inteiro em components/arc/LICENSE).
// O que mudou (ADR 0037): o padrão é o pt-BR (1.234,56), e o número herda a fonte, o tamanho e o peso de quem o usa (a sans com os
// algarismos tabulares do globals.css; a Arc punha a dela, de 36 px). O comportamento é o da Arc: cada algarismo é uma roda que gira para o
// lado em que o número andou, só quando ele muda (nada gira na abertura da página), o leitor de tela lê o número inteiro uma vez, e com
// movimento reduzido o algarismo troca na hora. Saíram o rótulo em cima do número e o giro do zero ao aparecer (`animateOnView`), que
// nenhuma tela usa (o fechamento da onda, 05/11/2026).

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { motionTokens } from '../lib/motion-tokens';
import styles from './animated-counter.module.css';

export interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** O idioma da formatação: fixo (pt-BR), para o servidor e o navegador escreverem os mesmos algarismos. */
  locale?: string;
}

type Part = { key: string; digit: number } | { key: string; text: string };

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/** Split a formatted number into columns keyed by place value, so 999 → 1,000 keeps the ones column the ones column. */
function partsFor(value: number, decimals: number, locale: string): Part[] {
  const parts = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    numberingSystem: 'latn',
  }).formatToParts(value);
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
              : `${part.type}${index}`,
        text: part.value,
      },
    ];
  });
}

/** One digit on the wheel. Its offset from the wheel position decides where it sits and how visible it is. */
function Glyph({ position, digit }: { position: MotionValue<number>; digit: number }) {
  const offset = useTransform(position, (current) => ((((digit - current) % 10) + 15) % 10) - 5);
  const y = useTransform(offset, (current) => `${current}em`);
  const opacity = useTransform(offset, (current) => Math.max(0, 1 - Math.abs(current)));
  const visibility = useTransform(offset, (current) =>
    Math.abs(current) >= 1 ? 'hidden' : 'visible',
  );
  const filter = useTransform(offset, (current) =>
    Math.abs(current) < 0.02 || Math.abs(current) >= 1
      ? 'none'
      : `blur(${(Math.abs(current) * motionTokens.blur.subtle).toFixed(2)}px)`,
  );
  return (
    <motion.span className={styles.glyph} style={{ y, opacity, filter, visibility }}>
      {digit}
    </motion.span>
  );
}

const presence = {
  initial: { width: 0, opacity: 0 },
  animate: { width: 'auto', opacity: 1 },
  exit: { width: 0, opacity: 0 },
};

/** A digit wheel. It always turns in the direction the whole number moved, wrapping 9 → 0 like an odometer. */
function Column({
  digit,
  direction,
  reduceMotion,
}: {
  digit: number;
  direction: number;
  reduceMotion: boolean;
}) {
  const position = useMotionValue(digit);
  const wheel = useRef({ digit, target: digit });
  useEffect(() => {
    const state = wheel.current;
    if (state.digit === digit) return;
    state.target +=
      direction < 0 ? -((state.digit - digit + 10) % 10) : (digit - state.digit + 10) % 10;
    state.digit = digit;
    if (reduceMotion) position.jump(state.target);
    else animate(position, state.target, motionTokens.spring.smooth);
  }, [digit, direction, position, reduceMotion]);
  return (
    <motion.span
      className={styles.column}
      {...presence}
      transition={reduceMotion ? { duration: 0 } : motionTokens.spring.morph}
    >
      <span className={styles.sizer}>0</span>
      {DIGITS.map((item) => (
        <Glyph key={item} position={position} digit={item} />
      ))}
    </motion.span>
  );
}

export function AnimatedCounter({
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
  locale = 'pt-BR',
}: AnimatedCounterProps) {
  const reduceMotion = !!useReducedMotion();
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState(1);
  if (value !== previous) {
    setPrevious(value);
    setDirection(value > previous ? 1 : -1);
  }
  const parts = partsFor(value, decimals, locale);
  const text = `${prefix}${parts.map((part) => ('text' in part ? part.text : part.digit)).join('')}${suffix}`;
  return (
    <span className={styles.counter}>
      <span className={styles.srOnly}>{text}</span>
      <span className={styles.value} aria-hidden="true">
        {prefix && <span className={styles.symbol}>{prefix}</span>}
        <AnimatePresence initial={false}>
          {parts.map((part) =>
            'digit' in part ? (
              <Column
                key={part.key}
                digit={part.digit}
                direction={direction}
                reduceMotion={reduceMotion}
              />
            ) : (
              <motion.span
                key={part.key}
                className={styles.symbol}
                {...presence}
                transition={reduceMotion ? { duration: 0 } : motionTokens.spring.morph}
              >
                {part.text}
              </motion.span>
            ),
          )}
        </AnimatePresence>
        {suffix && <span className={styles.symbol}>{suffix}</span>}
      </span>
    </span>
  );
}
