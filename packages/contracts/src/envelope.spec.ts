import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { envelopeSchema, fail, ok } from './envelope.js';

const schema = envelopeSchema(z.strictObject({ id: z.string() }));

describe('ok e fail', () => {
  it('ok embrulha o dado e zera o erro', () => {
    expect(ok({ id: 'a' })).toEqual({ success: true, data: { id: 'a' }, error: null });
  });

  it('fail embrulha o erro e zera o dado', () => {
    expect(fail('NOT_FOUND', 'Recurso não encontrado')).toEqual({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Recurso não encontrado' },
    });
  });

  it('fail só inclui details quando existem', () => {
    expect(fail('X', 'y')).not.toHaveProperty('error.details');
    expect(fail('X', 'y', [{ path: ['a'] }]).error.details).toEqual([{ path: ['a'] }]);
  });
});

describe('envelopeSchema', () => {
  it('aceita o envelope de sucesso', () => {
    expect(schema.safeParse(ok({ id: 'a' })).success).toBe(true);
  });

  it('aceita o envelope de erro', () => {
    expect(schema.safeParse(fail('NOT_FOUND', 'não achei')).success).toBe(true);
  });

  it.each([
    [
      'sucesso com erro preenchido',
      { success: true, data: { id: 'a' }, error: { code: 'X', message: 'y' } },
    ],
    [
      'erro com dado preenchido',
      { success: false, data: { id: 'a' }, error: { code: 'X', message: 'y' } },
    ],
    ['sucesso sem dado', { success: true, data: null, error: null }],
    ['erro sem erro', { success: false, data: null, error: null }],
    ['dado fora do schema', { success: true, data: { id: 1 }, error: null }],
    ['erro sem code', { success: false, data: null, error: { message: 'y' } }],
    ['campos faltando', { success: true }],
    ['null', null],
    ['string', 'ok'],
  ])('rejeita %s', (_nome, valor) => {
    expect(schema.safeParse(valor).success).toBe(false);
  });
});
