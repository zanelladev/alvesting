import { describe, expect, it } from 'vitest';
import {
  INTERNAL_BARS_LIMIT,
  INTERNAL_TAPE_LIMIT,
  QUOTES_SECRET_MIN_LENGTH,
  QUOTES_SECRET_SHAPE,
  LOGO_HEADERS,
  LOGO_NOT_FOUND,
  LOGO_VERSION_LENGTH,
  internalBarsSchema,
  internalLogosSchema,
  internalTapeSchema,
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

// A fita da home (docs/API.md, seção 6): o universo da semana do último ciclo, com o fechamento do pregão `date` e o do pregão anterior.
// Estrita como as barras; a data existe só quando há linha (sem ciclo, sem universo ou sem barra, a resposta vazia é `{ date: null, rows: [] }`).
const row = (ticker: string, previousCloseCents: number | null = 3_690) => ({
  ticker,
  closeCents: 3_750,
  previousCloseCents,
});
const tape = (rows: unknown[]) => ({ date: '2026-11-04', rows });

describe('internalTapeSchema', () => {
  it('aceita a fita (data do pregão e, por papel, o fechamento e o anterior) e a resposta vazia', () => {
    expect(internalTapeSchema.parse(tape([row('PETR4'), row('VALE3', null)]))).toEqual({
      date: '2026-11-04',
      rows: [
        { ticker: 'PETR4', closeCents: 3_750, previousCloseCents: 3_690 },
        { ticker: 'VALE3', closeCents: 3_750, previousCloseCents: null },
      ],
    });
    expect(internalTapeSchema.parse({ date: null, rows: [] })).toEqual({ date: null, rows: [] });
  });

  it('é estrita: campo a mais, na resposta ou na linha, e campo faltando são erro', () => {
    expect(internalTapeSchema.safeParse({ ...tape([row('PETR4')]), extra: 1 }).success).toBe(false);
    expect(
      internalTapeSchema.safeParse(tape([{ ...row('PETR4'), openCents: 3_700 }])).success,
    ).toBe(false);
    const { previousCloseCents: _previous, ...withoutPrevious } = row('PETR4');
    expect(internalTapeSchema.safeParse(tape([withoutPrevious])).success).toBe(false);
    expect(internalTapeSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(internalTapeSchema.safeParse({ date: null }).success).toBe(false);
  });

  it('o fechamento nunca é nulo; só o anterior pode ser (o papel sem barra no pregão anterior)', () => {
    expect(
      internalTapeSchema.safeParse(tape([{ ...row('PETR4'), closeCents: null }])).success,
    ).toBe(false);
    expect(internalTapeSchema.safeParse(tape([row('PETR4', null)])).success).toBe(true);
  });

  it('centavo é inteiro seguro, a data é AAAA-MM-DD e o ticker tem o formato da B3', () => {
    for (const bad of [
      tape([{ ...row('PETR4'), closeCents: 37.5 }]),
      tape([{ ...row('PETR4'), previousCloseCents: 2 ** 53 }]),
      { ...tape([row('PETR4')]), date: '04/11/2026' },
      tape([row('petr4')]),
      tape([row('PETR')]),
      tape([row('PETR4; DROP')]),
    ]) {
      expect(internalTapeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  // A data é a do pregão das linhas: sem linha não há pregão (a legenda da home leria "pregão de null"), e linha sem pregão não diz de quando é.
  it('a data existe se e só se há linha', () => {
    expect(internalTapeSchema.safeParse({ date: '2026-11-04', rows: [] }).success).toBe(false);
    expect(internalTapeSchema.safeParse({ date: null, rows: [row('PETR4')] }).success).toBe(false);
  });

  // O universo tem no máximo 500 ações (UNIVERSE_RULES.maxMembers da api; o teste da rota confere que os dois números são o mesmo).
  it('no máximo o tamanho do universo (500 linhas)', () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => row(`A${String(i).padStart(3, '0')}3`));
    expect(INTERNAL_TAPE_LIMIT).toBe(500);
    expect(internalTapeSchema.safeParse(tape(rows(500))).success).toBe(true);
    expect(internalTapeSchema.safeParse(tape(rows(501))).success).toBe(false);
  });
});

// Os logos das ações (ADR 0036): a lista de quem tem logo guardado, com a versão do SVG, e os cabeçalhos com que ele sai.
describe('internalLogosSchema', () => {
  const logo = (ticker: string, version = '0123456789abcdef') => ({ ticker, version });

  it('o ticker e a versão (os 16 primeiros hex do SHA-256), em ordem de ticker; a lista vazia vale', () => {
    expect(LOGO_VERSION_LENGTH).toBe(16);
    const list = { logos: [logo('BBAS3'), logo('PETR4', 'f'.repeat(16))] };
    expect(internalLogosSchema.parse(list)).toEqual(list);
    expect(internalLogosSchema.parse({ logos: [] })).toEqual({ logos: [] });
  });

  it('estrito: nada além do ticker e da versão (nem o SVG, nem o endereço, nem o SHA-256 inteiro)', () => {
    for (const bad of [
      { logos: [{ ...logo('PETR4'), svg: '<svg/>' }] },
      { logos: [logo('PETR4')], extra: 1 },
      { logos: [logo('PETR4', 'a'.repeat(64))] },
      { logos: [logo('PETR4', 'ABCDEF0123456789')] },
      { logos: [logo('PETR4', 'g'.repeat(16))] },
      { logos: [logo('petr4')] },
      { logos: [{ ticker: 'PETR4' }] },
      {},
    ]) {
      expect(internalLogosSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('em ordem de ticker e sem repetir', () => {
    expect(internalLogosSchema.safeParse({ logos: [logo('PETR4'), logo('BBAS3')] }).success).toBe(
      false,
    );
    expect(internalLogosSchema.safeParse({ logos: [logo('PETR4'), logo('PETR4')] }).success).toBe(
      false,
    );
  });

  it('os cabeçalhos do SVG: imagem, nosniff e a CSP que o deixa inerte; o código do 404 de quem não tem logo', () => {
    expect(LOGO_HEADERS).toEqual({
      'Content-Type': 'image/svg+xml',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    });
    expect(LOGO_NOT_FOUND).toBe('LOGO_NOT_FOUND');
  });
});
