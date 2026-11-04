import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { actionOf, cursorOf, first, orNotFound } from './page';

// Os ajudantes das páginas: o que vem da URL é do leitor (e pode ser qualquer coisa), e o erro da api vira a página certa.
const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };

describe('orNotFound', () => {
  it('devolve o dado', async () => {
    await expect(orNotFound(Promise.resolve(7))).resolves.toBe(7);
  });

  it('404 da api vira a página 404', async () => {
    await expect(orNotFound(Promise.reject(new ApiError(404, 'NOT_FOUND')))).rejects.toMatchObject(
      NOT_FOUND,
    );
  });

  it('400 da api também: o pedido foi montado com o que o leitor digitou (um cursor forjado)', async () => {
    await expect(
      orNotFound(Promise.reject(new ApiError(400, 'VALIDATION_ERROR'))),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it('qualquer outro erro sobe como está, para a página de erro', async () => {
    const outage = new ApiError(502, 'INVALID_RESPONSE');
    await expect(orNotFound(Promise.reject(outage))).rejects.toBe(outage);
    const boom = new Error('rede');
    await expect(orNotFound(Promise.reject(boom))).rejects.toBe(boom);
  });
});

describe('o que vem da URL', () => {
  it('first pega o primeiro de um parâmetro repetido', () => {
    expect(first('a')).toBe('a');
    expect(first(['a', 'b'])).toBe('a');
    expect(first([])).toBeUndefined();
    expect(first(undefined)).toBeUndefined();
  });

  it('actionOf aceita só BUY, SELL e HOLD em maiúsculas; o resto é sem filtro', () => {
    expect(actionOf('BUY')).toBe('BUY');
    expect(actionOf('SELL')).toBe('SELL');
    expect(actionOf('HOLD')).toBe('HOLD');
    for (const bad of ['hold', 'Buy', '', 'BUY ', 'ALL', undefined])
      expect(actionOf(bad)).toBeUndefined();
  });

  it('cursorOf deixa passar o cursor opaco e dá 404 ao que não tem a forma', () => {
    expect(cursorOf(undefined)).toBeUndefined();
    expect(cursorOf('WyIyMDI2LTExLTA4Il0')).toBe('WyIyMDI2LTExLTA4Il0');
    for (const bad of ['', '%00', 'a b', 'a'.repeat(300), '<script>', 'a/b']) {
      expect(() => cursorOf(bad), bad).toThrow(expect.objectContaining(NOT_FOUND) as Error);
    }
  });
});
