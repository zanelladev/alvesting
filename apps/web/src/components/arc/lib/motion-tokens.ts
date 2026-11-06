// Adaptado da Arc (https://uiarc.dev), item "arc-motion-tokens" (registro https://uiarc.dev/r/arc-motion-tokens.json, lido em 05/11/2026).
// Copyright (c) 2026 Elia Kuratli, licença MIT (o texto inteiro em components/arc/LICENSE).
// O que mudou: os nomes são os da Arc (as peças copiadas os leem), e os valores são os nossos (lib/motion.ts; ADR 0037): 150, 200 e 250 ms,
// saída forte (quart, quint e expo) e molas sem quique. A Arc tinha 120 a 480 ms e uma curva de entrada para a saída. Ficam só as chaves que o
// tooltip e o contador leem; a peça nova que pedir outra a traz do registro.
import { MOTION } from '../../../lib/motion';

export const motionTokens = {
  duration: {
    instant: MOTION.duration.fast,
    standard: MOTION.duration.base,
  },
  ease: {
    enter: MOTION.ease.outExpo,
    standard: MOTION.ease.outQuart,
  },
  spring: {
    /** Painéis e mudanças de altura. */
    smooth: MOTION.spring.base,
    /** Formas que mudam e a pílula que anda entre opções. */
    morph: MOTION.spring.slow,
  },
  /** Desfoque em px nas trocas de texto, pequeno e breve. */
  blur: { subtle: 2, soft: 4 },
} as const;
