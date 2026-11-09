import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { missingEnv, report } from './coverage.mjs';

// o pedaço do coverage-summary.json (reporter json-summary do Vitest) que o script lê
const summary = (lines, statements) => ({
  total: { lines: { pct: lines }, statements: { pct: statements } },
});

describe('ambiente', () => {
  test('sem as variáveis de integração, lista as que faltam', () => {
    assert.deepEqual(missingEnv({}), ['TEST_DATABASE_URL', 'STORAGE_CONNECTION_STRING']);
    assert.deepEqual(missingEnv({ TEST_DATABASE_URL: 'postgresql://x' }), [
      'STORAGE_CONNECTION_STRING',
    ]);
  });

  test('variável vazia conta como ausente', () => {
    assert.deepEqual(missingEnv({ TEST_DATABASE_URL: '', STORAGE_CONNECTION_STRING: 'b' }), [
      'TEST_DATABASE_URL',
    ]);
  });

  test('com as duas, não falta nada', () => {
    assert.deepEqual(missingEnv({ TEST_DATABASE_URL: 'a', STORAGE_CONNECTION_STRING: 'b' }), []);
  });
});

describe('tabela', () => {
  const ok = {
    'apps/api': summary(93.62, 93.1),
    'packages/contracts': summary(100, 100),
    'apps/web': summary(69.63, 67.85),
  };

  test('backend, contratos e frontend, com linhas e instruções em pt-BR e o mínimo do Playbook', () => {
    const text = report(ok);
    assert.match(text, /backend\s+apps\/api\s+linhas\s+93,62%\s+instruções\s+93,10%\s+mínimo 75%/);
    assert.match(
      text,
      /contratos\s+packages\/contracts\s+linhas\s+100,00%\s+instruções\s+100,00%\s+mínimo 75%/,
    );
    assert.match(text, /frontend\s+apps\/web\s+linhas\s+69,63%\s+instruções\s+67,85%\s+mínimo 25%/);
    assert.doesNotMatch(text, /abaixo/);
  });

  test('marca o pacote abaixo do mínimo, nas linhas ou nas instruções', () => {
    assert.match(report({ ...ok, 'apps/web': summary(30, 24.99) }), /frontend.*abaixo do mínimo/);
    assert.match(report({ ...ok, 'apps/api': summary(74.99, 80) }), /backend.*abaixo do mínimo/);
    assert.doesNotMatch(report({ ...ok, 'apps/web': summary(25, 25) }), /abaixo/);
  });

  test('pacote sem relatório aparece como tal, sem número', () => {
    const text = report({ ...ok, 'apps/api': undefined });
    assert.match(text, /backend\s+apps\/api\s+sem relatório/);
    assert.doesNotMatch(text, /93,62/);
  });
});
