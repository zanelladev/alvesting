import { describe, expect, it } from 'vitest';
import {
  INTERNAL_BARS_LIMIT,
  QUOTES_SECRET_MIN_LENGTH,
  QUOTES_SECRET_SHAPE,
  internalBarsSchema,
} from './internal.js';

// O contrato da rota interna do site (docs/API.md, seção 6; ADR 0033). É estrito como o público: campo a mais é erro, e as barras vêm
// no máximo 60 de cada vez.
const bar = (day: number) => ({
  date: `2026-11-${String(day).padStart(2, '0')}`,
  openCents: 3_660,
  highCents: 3_712,
  lowCents: 3_594,
  closeCents: 3_690,
});

describe('internalBarsSchema', () => {
  it('aceita as barras (data e os quatro preços em centavos) e a lista vazia', () => {
    expect(internalBarsSchema.parse({ bars: [bar(3), bar(4)] }).bars).toHaveLength(2);
    expect(internalBarsSchema.parse({ bars: [] })).toEqual({ bars: [] });
  });

  it('é estrito: campo a mais, na resposta ou na barra, e campo faltando são erro', () => {
    expect(internalBarsSchema.safeParse({ bars: [], extra: 1 }).success).toBe(false);
    expect(internalBarsSchema.safeParse({ bars: [{ ...bar(3), volumeCents: 1 }] }).success).toBe(
      false,
    );
    const { openCents: _open, ...withoutOpen } = bar(3);
    expect(internalBarsSchema.safeParse({ bars: [withoutOpen] }).success).toBe(false);
    expect(internalBarsSchema.safeParse({}).success).toBe(false);
  });

  it('centavo é inteiro seguro e a data é AAAA-MM-DD', () => {
    expect(internalBarsSchema.safeParse({ bars: [{ ...bar(3), closeCents: 36.9 }] }).success).toBe(
      false,
    );
    expect(
      internalBarsSchema.safeParse({ bars: [{ ...bar(3), closeCents: 2 ** 53 }] }).success,
    ).toBe(false);
    expect(
      internalBarsSchema.safeParse({ bars: [{ ...bar(3), date: '03/11/2026' }] }).success,
    ).toBe(false);
  });

  it('no máximo 60 barras', () => {
    const days = (n: number) => Array.from({ length: n }, (_, i) => bar((i % 28) + 1));
    expect(INTERNAL_BARS_LIMIT).toBe(60);
    expect(internalBarsSchema.safeParse({ bars: days(60) }).success).toBe(true);
    expect(internalBarsSchema.safeParse({ bars: days(61) }).success).toBe(false);
  });

  it('o segredo da rota tem pelo menos 32 caracteres (o seed gera 384 bits)', () => {
    expect(QUOTES_SECRET_MIN_LENGTH).toBe(32);
  });

  // O que o `openssl rand -base64 48` gera passa (letras, dígitos, + / =); espaço, quebra de linha, tab, controle e acento não: o `fetch` do
  // Node repetiria o valor inteiro na mensagem do erro de cabeçalho inválido, e o erro vai ao log.
  it('a forma do segredo: só ASCII visível, sem espaço, quebra de linha, controle nem acento', () => {
    expect(QUOTES_SECRET_SHAPE.test('dGVzdGU+L3NlZ3JlZG8vYmFzZTY0Zm9ybWF0bz09')).toBe(true);
    expect(QUOTES_SECRET_SHAPE.test('!"#$%&\'()*+,-./0123456789:;<=>?@AZaz[\\]^_`{|}~')).toBe(true);
    for (const bad of [
      '',
      'abc def',
      'abc\ndef',
      'abc\r',
      'abc\tdef',
      'abc\u0000def',
      'ação',
      'a\u007fb',
      ' x',
      'x ',
    ]) {
      expect(QUOTES_SECRET_SHAPE.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
