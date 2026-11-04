import { renderToStaticMarkup } from 'react-dom/server';
import { notFound } from 'next/navigation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { withApiDown } from './with-api-down';

// A página que lê a api e a leitura falha: a tela de erro sai do servidor, com texto, e não como um erro lançado (o React não renderiza o
// error.tsx no servidor, e a resposta seria um 500 com um corpo só de scripts). O que não é "a api não atendeu" continua subindo.
describe('withApiDown', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a página que deu certo sai como está', async () => {
    const page = withApiDown(({ n }: { n: number }) => Promise.resolve(<p>página {n}</p>));
    expect(renderToStaticMarkup(await page({ n: 7 }))).toBe('<p>página 7</p>');
  });

  it('todo ApiError vira a tela de erro, com texto fixo, "Tentar de novo" e noindex, e vai inteiro para o log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const failure of [
      new ApiError(500, 'INTERNAL_ERROR'),
      new ApiError(502, 'INVALID_RESPONSE'),
      new ApiError(503, 'UNAVAILABLE', { cause: new TypeError('fetch failed') }),
      new ApiError(403, 'FORBIDDEN'),
    ]) {
      const page = withApiDown(() => Promise.reject(failure));
      const out = renderToStaticMarkup(await page({}));
      expect(out).toContain('Não foi possível carregar os dados');
      expect(out).toContain('<meta name="robots" content="noindex"/>');
      // sem JavaScript: um link para a mesma URL (a query inclusive), e não um botão
      expect(out).toMatch(/<a href="" class="btn">Tentar de novo<\/a>/);
      expect(out).toContain('href="/"');
      // nenhum detalhe do erro na tela
      expect(out).not.toContain('API respondeu');
      expect(out).not.toContain(failure.code);
      expect(log).toHaveBeenLastCalledWith('[web] a api não atendeu a página:', failure);
    }
  });

  it('o notFound() da página passa: o 404 continua sendo 404', async () => {
    const page = withApiDown(() => Promise.resolve().then(() => notFound()));
    await expect(page({})).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('o que não é ApiError sobe para o error.tsx: um bug, ou o API_INTERNAL_URL ausente, não é "a arena não respondeu"', async () => {
    const boom = new TypeError('Cannot read properties of null');
    const page = withApiDown(() => Promise.reject(boom));
    await expect(page({})).rejects.toBe(boom);
  });
});
