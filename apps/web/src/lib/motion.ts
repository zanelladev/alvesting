// Os tokens de movimento para as peças com o Motion (docs/DESIGN.md; ADR 0037), os mesmos do globals.css (--duration-*, --ease-out-*): o
// motion.spec.ts prende os dois. Movimento de 150 a 250 ms, só para explicar uma mudança de estado; saída forte (quart, quint ou expo) e
// molas sem quique. As durações em segundos, a unidade do Motion. Com movimento reduzido a peça troca na hora (cada uma tem o ramo dela).
export const MOTION = {
  duration: { fast: 0.15, base: 0.2, slow: 0.25 },
  ease: {
    outQuart: [0.25, 1, 0.5, 1],
    outQuint: [0.22, 1, 0.36, 1],
    outExpo: [0.16, 1, 0.3, 1],
  },
  spring: {
    fast: { type: 'spring', visualDuration: 0.15, bounce: 0 },
    base: { type: 'spring', visualDuration: 0.2, bounce: 0 },
    slow: { type: 'spring', visualDuration: 0.25, bounce: 0 },
  },
} as const;
