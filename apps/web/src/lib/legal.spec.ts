import type { Legal } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { documentOf } from './legal';

// Um dos dois textos vigentes. O contrato garante dois documentos, mas não que sejam um de cada: o que faltar é resposta fora do contrato.
const doc = (document: 'TERMS' | 'PRIVACY'): Legal['documents'][number] => ({
  document,
  version: '0.1',
  effectiveDate: '2026-11-02',
  title: document === 'TERMS' ? 'Termos de uso' : 'Política de privacidade',
  sha256: 'a'.repeat(64),
  text: '# Título',
});

describe('documentOf', () => {
  const legal: Legal = { controller: null, documents: [doc('TERMS'), doc('PRIVACY')] };

  it('devolve o texto pedido', () => {
    expect(documentOf(legal, 'TERMS').title).toBe('Termos de uso');
    expect(documentOf(legal, 'PRIVACY').title).toBe('Política de privacidade');
  });

  it('dois documentos do mesmo tipo (o contrato deixa passar) deixam faltar o outro: erro de resposta fora do contrato, e não uma página vazia', () => {
    const twice: Legal = { controller: null, documents: [doc('TERMS'), doc('TERMS')] };
    expect(documentOf(twice, 'TERMS').document).toBe('TERMS');
    expect(() => documentOf(twice, 'PRIVACY')).toThrow(ApiError);
    expect(() => documentOf(twice, 'PRIVACY')).toThrow(/502/);
  });
});
