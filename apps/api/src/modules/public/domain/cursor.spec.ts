import { cursorSchema as cursorQuery } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InvalidCursorError, decodeCursor, encodeCursor } from './cursor.js';

const dateAndId = z.tuple([z.iso.date(), z.string().regex(/^[0-9A-Z]{26}$/)]);
const ID = '01M6D0RFWKKZJBPTWNWN76J316';

describe('cursor de paginação (keyset)', () => {
  it('vai e volta: o que a página entrega é o que a próxima lê', () => {
    const cursor = encodeCursor(['2026-11-09', ID]);
    expect(decodeCursor(cursor, dateAndId)).toEqual(['2026-11-09', ID]);
  });

  it('é opaco e cabe na query string: base64url, sem preenchimento, dentro do limite do contrato', () => {
    const cursor = encodeCursor(['2026-11-09', ID]);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursorQuery.safeParse(cursor).success).toBe(true);
  });

  it.each([
    ['vazio', ''],
    ['base64 que não é JSON', Buffer.from('não é json').toString('base64url')],
    ['JSON que não é lista', Buffer.from('{"a":1}').toString('base64url')],
    ['lista com o tipo errado', Buffer.from('[1,2]').toString('base64url')],
    ['lista curta demais', Buffer.from(JSON.stringify(['2026-11-09'])).toString('base64url')],
    [
      'lista longa demais',
      Buffer.from(JSON.stringify(['2026-11-09', ID, 'sobra'])).toString('base64url'),
    ],
    ['data que não existe', Buffer.from(JSON.stringify(['2026-02-30', ID])).toString('base64url')],
    ['lista aninhada', Buffer.from(JSON.stringify([['2026-11-09'], ID])).toString('base64url')],
    ['lixo', '%%%%'],
    ['objeto com __proto__', Buffer.from('{"__proto__":{"x":1}}').toString('base64url')],
  ])('cursor inválido (%s) é erro de cursor, nunca uma exceção qualquer', (_nome, cursor) => {
    expect(() => decodeCursor(cursor, dateAndId)).toThrow(InvalidCursorError);
  });

  it('não repete o conteúdo do cursor na mensagem de erro', () => {
    const cursor = Buffer.from(JSON.stringify(['segredo-no-cursor', ID])).toString('base64url');
    try {
      decodeCursor(cursor, dateAndId);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('segredo-no-cursor');
    }
  });

  it('uma posição com 4 mil caracteres não vira cursor: o contrato limita a 256', () => {
    expect(() => encodeCursor(['x'.repeat(4000)])).toThrow(RangeError);
  });
});
