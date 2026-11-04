import { createHash } from 'node:crypto';
import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../config/env.js';
import { Secret } from '../../../config/secret.js';

// O que o guard usa para comparar o segredo é o `timingSafeEqual` do Node: o teste o espia (o módulo `node:crypto` é trocado por uma cópia
// que o conta, sem mudar o comportamento) para provar que toda comparação passa por ele, com o segredo certo, o errado e o de outro tamanho.
const compared = vi.hoisted(() => [] as Array<[Buffer, Buffer]>);
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const timingSafeEqual = (a: Buffer, b: Buffer): boolean => {
    compared.push([a, b]);
    return actual.timingSafeEqual(a, b);
  };
  return { ...actual, default: actual, timingSafeEqual };
});

const { QuotesSecretGuard } = await import('./quotes-secret.guard.js');

const SECRET = 'segredo-sintetico-das-cotacoes-0123456789abcdef';
const env = (secret?: string) =>
  ({ QUOTES_SECRET: secret ? new Secret(secret) : undefined }) as Env;

// Só o que o guard lê da requisição: o método, o endereço e o cabeçalho.
function context(headers: Record<string, string>, method = 'GET', url = '/api/v1/interno/x') {
  const request = {
    method,
    originalUrl: url,
    header: (name: string) => headers[name.toLowerCase()],
  };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}
const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

describe('QuotesSecretGuard', () => {
  beforeEach(() => {
    compared.length = 0;
  });

  it('deixa passar quem traz o segredo certo em Authorization: Bearer', () => {
    expect(new QuotesSecretGuard(env(SECRET)).canActivate(context(bearer(SECRET)))).toBe(true);
  });

  it.each([
    ['sem cabeçalho', {}],
    ['cabeçalho vazio', { authorization: '' }],
    ['Bearer sem valor', { authorization: 'Bearer ' }],
    ['segredo errado', bearer('segredo-errado-0123456789abcdef0123456789')],
    ['o segredo certo menos o último caractere', bearer(SECRET.slice(0, -1))],
    ['o segredo certo mais um caractere', bearer(`${SECRET}x`)],
    ['o segredo certo em outro esquema', { authorization: `Basic ${SECRET}` }],
    ['o segredo certo sem esquema', { authorization: SECRET }],
    ['o segredo certo com espaço no meio', { authorization: `Bearer ${SECRET} extra` }],
    ['o segredo em outro cabeçalho', { 'x-quotes-secret': SECRET }],
  ])('recusa com 404: %s', (_name, headers) => {
    expect(() => new QuotesSecretGuard(env(SECRET)).canActivate(context(headers))).toThrow(
      NotFoundException,
    );
  });

  // A rota desligada (a api sem QUOTES_SECRET) é fail closed: nem o segredo "certo" de quem a configurou errado a abre.
  it('sem QUOTES_SECRET no ambiente, a rota está fechada para todos', () => {
    const guard = new QuotesSecretGuard(env());
    for (const value of [SECRET, '', 'undefined', 'null']) {
      expect(() => guard.canActivate(context(bearer(value)))).toThrow(NotFoundException);
    }
    expect(() => guard.canActivate(context({}))).toThrow(NotFoundException);
  });

  // O corpo da recusa é o do Nest para a rota que não existe: "Cannot <método> <endereço>", o mesmo que o filtro de erros põe no envelope.
  it('o 404 tem a mensagem da rota que não existe, com o método e o endereço pedidos', () => {
    const guard = new QuotesSecretGuard(env(SECRET));
    const refused = (method: string, url: string) => {
      try {
        guard.canActivate(context({}, method, url));
      } catch (error) {
        return error as NotFoundException;
      }
      throw new Error('o guard deixou passar');
    };
    const get = refused('GET', '/api/v1/interno/barras/PETR4?x=1');
    expect(get.getStatus()).toBe(404);
    expect(get.message).toBe('Cannot GET /api/v1/interno/barras/PETR4?x=1');
    expect(refused('HEAD', '/api/v1/interno/barras/PETR4').message).toBe(
      'Cannot HEAD /api/v1/interno/barras/PETR4',
    );
  });

  it('o 404 não repete o segredo, nem o certo nem o errado que veio no cabeçalho', () => {
    const wrong = 'segredo-errado-0123456789abcdef0123456789';
    try {
      new QuotesSecretGuard(env(SECRET)).canActivate(context(bearer(wrong)));
    } catch (error) {
      const text = JSON.stringify([(error as NotFoundException).message, String(error)]);
      expect(text).not.toContain(wrong);
      expect(text).not.toContain(SECRET);
      return;
    }
    throw new Error('o guard deixou passar');
  });

  // A comparação é em tempo constante: os dois lados passam por SHA-256 (tamanho igual, sem revelar o tamanho do segredo) e vão para o
  // `timingSafeEqual`, mesmo quando o tamanho do que veio é outro (o `timingSafeEqual` lançaria se os tamanhos diferissem).
  it('compara por timingSafeEqual, dos SHA-256 dos dois lados, com qualquer tamanho de entrada', () => {
    const guard = new QuotesSecretGuard(env(SECRET));
    for (const value of [SECRET, 'a', 'x'.repeat(5000)]) {
      compared.length = 0;
      try {
        guard.canActivate(context(bearer(value)));
      } catch {
        // recusado, como esperado, menos o certo
      }
      expect(compared).toHaveLength(1);
      const [candidate, expected] = compared[0]!;
      const sha = (text: string) => createHash('sha256').update(text).digest();
      expect(candidate.equals(sha(value))).toBe(true);
      expect(expected.equals(sha(SECRET))).toBe(true);
    }
  });
});
