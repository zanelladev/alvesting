import { queueMessageSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { newId } from './id.js';

describe('newId', () => {
  it('gera ULID que passa no contrato das mensagens das filas (o cycleId e o competitorId são ULID)', () => {
    for (let i = 0; i < 1_000; i += 1) {
      const message = { type: 'decide', cycleId: newId(), competitorId: newId() };
      expect(queueMessageSchema.safeParse(message).success, JSON.stringify(message)).toBe(true);
    }
  });

  it('tem 26 caracteres, que cabem na coluna VarChar(26) do banco', () => {
    expect(newId()).toHaveLength(26);
  });

  it('é monotônico e único, mesmo para IDs gerados no mesmo milissegundo', () => {
    const ids = Array.from({ length: 10_000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });
});
