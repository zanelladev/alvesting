import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOTION } from './motion';

// Os tokens de movimento existem em dois lugares, porque o CSS e o Motion não leem o mesmo arquivo: as variáveis do globals.css (as
// transições de CSS) e o MOTION (as peças com o Motion). Este teste prende os dois aos mesmos valores (docs/DESIGN.md).
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const variable = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe('os tokens de movimento', () => {
  it('as três durações (150, 200 e 250 ms) são as mesmas no CSS e no Motion', () => {
    expect([MOTION.duration.fast, MOTION.duration.base, MOTION.duration.slow]).toEqual([
      0.15, 0.2, 0.25,
    ]);
    expect(variable('--duration-fast')).toBe('150ms');
    expect(variable('--duration-base')).toBe('200ms');
    expect(variable('--duration-slow')).toBe('250ms');
  });

  it('as curvas de saída forte (quart, quint e expo) são as mesmas no CSS e no Motion', () => {
    const bezier = (points: readonly number[]) => `cubic-bezier(${points.join(', ')})`;
    expect(variable('--ease-out-quart')).toBe(bezier(MOTION.ease.outQuart));
    expect(variable('--ease-out-quint')).toBe(bezier(MOTION.ease.outQuint));
    expect(variable('--ease-out-expo')).toBe(bezier(MOTION.ease.outExpo));
  });

  // mola sem quique: o valor chega e para, nunca passa do ponto (animation-best-practices, better-ui)
  it('as molas não quicam e duram o que as durações dizem', () => {
    for (const [name, spring] of Object.entries(MOTION.spring)) {
      expect(spring.type, name).toBe('spring');
      expect(spring.bounce, name).toBe(0);
      expect(spring.visualDuration, name).toBe(
        MOTION.duration[name as keyof typeof MOTION.duration],
      );
    }
  });
});
