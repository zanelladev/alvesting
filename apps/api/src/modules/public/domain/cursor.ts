import { cursorSchema } from '@alvesting/contracts';
import type { z } from 'zod';

// Cursor da paginação por posição (keyset): a chave da última linha da página, em texto, guardada como lista JSON em base64url.
// É opaco para quem lê: quem pede a página seguinte devolve o que recebeu, e o texto da posição não é contrato.
// ponytail: o cursor não é assinado. Os dados são públicos e qualquer posição é uma página legítima, então forjar um cursor só
// escolhe outro ponto da lista. Se um dia o cursor carregar algo privado, assinar com HMAC.

// Cursor que não decodifica, ou que não tem o formato da lista. A mensagem não repete o cursor.
export class InvalidCursorError extends Error {
  constructor() {
    super('Cursor inválido');
    this.name = 'InvalidCursorError';
  }
}

export function encodeCursor(parts: readonly string[]): string {
  const cursor = Buffer.from(JSON.stringify(parts)).toString('base64url');
  // o mesmo teto do parâmetro da query: um cursor que a rota não aceitaria de volta é erro de programa
  if (!cursorSchema.safeParse(cursor).success) throw new RangeError('cursor fora do limite');
  return cursor;
}

// `shape` é a tupla que a rota espera (por exemplo [data, id]); qualquer outra coisa é InvalidCursorError.
export function decodeCursor<S extends z.ZodType>(cursor: string, shape: S): z.output<S> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  const parsed = shape.safeParse(value);
  if (!parsed.success) throw new InvalidCursorError();
  return parsed.data;
}
