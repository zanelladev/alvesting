import { describe, expect, it } from 'vitest';
import { healthResponseSchema, healthSchema } from './health.js';
import { fail, ok } from './envelope.js';

describe('healthSchema', () => {
  it.each(['api', 'web'])('aceita o serviço %s', (service) => {
    expect(healthSchema.safeParse({ status: 'ok', service }).success).toBe(true);
  });

  it.each([
    ['status diferente de ok', { status: 'down', service: 'api' }],
    ['serviço desconhecido', { status: 'ok', service: 'worker' }],
    ['sem serviço', { status: 'ok' }],
    ['vazio', {}],
  ])('rejeita %s', (_nome, valor) => {
    expect(healthSchema.safeParse(valor).success).toBe(false);
  });
});

describe('healthResponseSchema', () => {
  it('lê a resposta no envelope', () => {
    const parsed = healthResponseSchema.parse(ok({ status: 'ok', service: 'web' }));
    expect(parsed.success && parsed.data.service).toBe('web');
  });

  it('também aceita o envelope de erro', () => {
    expect(healthResponseSchema.safeParse(fail('INTERNAL_ERROR', 'Erro interno')).success).toBe(
      true,
    );
  });
});
