import { describe, expect, it } from 'vitest';
import { CACHE_TAGS, MIN_REVALIDATE_SECRET_LENGTH, hasValidRevalidateSecret } from './cache';

// O segredo da rota de revalidação (docs/INFRA.md, 3.3): a rota é alcançável da internet, então ele é a única defesa dela.
const SECRET = 'segredo-sintetico-de-revalidacao-0123456789';
const bearer = (value: string) => new Headers({ authorization: `Bearer ${value}` });

describe('hasValidRevalidateSecret', () => {
  it('aceita o segredo certo no Authorization: Bearer', () => {
    expect(hasValidRevalidateSecret(bearer(SECRET), SECRET)).toBe(true);
  });

  it.each([
    ['sem cabeçalho', new Headers()],
    ['segredo errado', bearer('errado')],
    ['o segredo mais um caractere', bearer(`${SECRET}x`)],
    ['o segredo menos um caractere', bearer(SECRET.slice(0, -1))],
    ['em outra caixa', bearer(SECRET.toUpperCase())],
    ['outro esquema', new Headers({ authorization: `Basic ${SECRET}` })],
    ['sem o esquema', new Headers({ authorization: SECRET })],
    ['com texto depois', new Headers({ authorization: `Bearer ${SECRET} extra` })],
    ['o segredo em outro cabeçalho', new Headers({ 'x-revalidate-secret': SECRET })],
  ])('recusa: %s', (_nome, headers) => {
    expect(hasValidRevalidateSecret(headers, SECRET)).toBe(false);
  });

  it('sem segredo configurado ninguém passa (fail closed), nem quem manda um vazio', () => {
    for (const expected of [undefined, '']) {
      expect(hasValidRevalidateSecret(bearer('qualquer'), expected)).toBe(false);
      expect(hasValidRevalidateSecret(new Headers(), expected)).toBe(false);
    }
  });

  it(`segredo configurado com menos de ${MIN_REVALIDATE_SECRET_LENGTH} caracteres vale como desligado: nem quem o conhece passa`, () => {
    const short = 'x'.repeat(MIN_REVALIDATE_SECRET_LENGTH - 1);
    expect(hasValidRevalidateSecret(bearer(short), short)).toBe(false);
    const enough = 'x'.repeat(MIN_REVALIDATE_SECRET_LENGTH);
    expect(hasValidRevalidateSecret(bearer(enough), enough)).toBe(true);
  });
});

describe('as tags de cache', () => {
  it('são as duas que o cliente de dados usa', () => {
    expect([...CACHE_TAGS]).toEqual(['arena', 'news']);
  });
});
