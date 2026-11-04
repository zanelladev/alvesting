import { describe, expect, it } from 'vitest';
import { redactPii } from './redact.js';

// ReDoS (revisão de segurança da etapa 11): o redactPii roda sobre texto do atacante (o Better Auth loga o `callbackURL` e o `Origin`
// inválidos, e o filtro de erros loga a pilha), e a regra do e-mail era quadrática em qualquer sequência de letras, dígitos ou
// pontos sem "@": 60 KB de callbackURL travavam a api por 1,6 s. Cada regra tem de ser linear por conta própria, e o corte de tamanho
// é a segunda barreira. Os testes usam 64 KB (o quadrático leva uns 2 s ali; o linear, poucos milissegundos).
const SIZE = 64 * 1024;
const LIMIT_MS = 50;

const ADVERSARIAL: ReadonlyArray<readonly [string, string]> = [
  ['letras do trecho local de um e-mail', 'a'.repeat(SIZE)],
  ['pares "1."', '1.'.repeat(SIZE / 2)],
  ['hífens', '-'.repeat(SIZE)],
  ['o início de um JWT repetido', 'eyJ'.repeat(SIZE / 3)],
  ['o início de uma URL repetido', 'http://'.repeat(SIZE / 7)],
  ['um domínio com muitos rótulos', `x@${'a.'.repeat(SIZE / 2)}`],
  ['muitas arrobas', 'a@'.repeat(SIZE / 2)],
  ['dois pontos', ':'.repeat(SIZE)],
  ['um token comprido solto', 'abcdefghijklmnopqrstuvwxyz01234'.repeat(SIZE / 31)],
];

const elapsed = (run: () => unknown): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe('redactPii é linear (sem ReDoS)', () => {
  // `Infinity` tira o corte de tamanho: aqui quem tem de ser linear são as regras, sozinhas.
  it.each(ADVERSARIAL)('as regras sozinhas: %s', (_nome, input) => {
    expect(elapsed(() => redactPii(input, Infinity))).toBeLessThan(LIMIT_MS);
  });

  // o padrão: o corte de tamanho segura até o que as regras não segurariam
  it.each(ADVERSARIAL)('com o corte de tamanho: %s', (_nome, input) => {
    expect(elapsed(() => redactPii(input))).toBeLessThan(LIMIT_MS);
  });
});

describe('redactPii: o corte de tamanho', () => {
  it('texto grande demais é cortado no último espaço, com o aviso, e nada do que passou do corte aparece', () => {
    const head = 'falhou ';
    const text = `${head}${'x '.repeat(SIZE)}pessoa@example.test`;
    const out = redactPii(text);
    expect(out.length).toBeLessThan(10_000);
    expect(out.startsWith(head)).toBe(true);
    expect(out).toMatch(/\[cortado\]$/);
    expect(out).not.toContain('pessoa');
  });

  it('sem espaço para cortar, não sobra nada além do aviso (uma ponta de e-mail ou de token não vaza)', () => {
    expect(redactPii('a'.repeat(SIZE))).toBe('[cortado]');
  });

  it('texto pequeno passa inteiro', () => {
    expect(redactPii('falhou para pessoa@example.test')).toBe('falhou para [e-mail]');
  });
});

describe('redactPii: as regras ainda pegam o que pegavam', () => {
  it.each([
    ['e-mail com o trecho local comprido', `${'a'.repeat(100)}@example.test`, '[e-mail]'],
    ['e-mail depois de dois pontos', 'erro:pessoa.nome+tag@sub.example.test!', 'erro:[e-mail]!'],
    ['vários e-mails', 'a@example.test, b@example.test', '[e-mail], [e-mail]'],
    [
      'JWT depois de "token="',
      'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.assinatura-do-jwt fim',
      'token=[token] fim',
    ],
    ['JWT com Bearer', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.assinatura-do-jwt', '[token]'],
  ])('%s', (_nome, input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });
});
