import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';

// A leitura das cotações (lib/quotes.ts, com o `server-only` do Next e a rota interna da api) é trocada por um fake, e o `connection()` do Next,
// que só vale dentro de uma requisição, por uma promessa pronta.
// (O React 19 já começa a rodar o componente assíncrono do rodapé dentro do renderToStaticMarkup, antes dos testes: o padrão é "sem barra".)
const { readBars } = vi.hoisted(() => ({ readBars: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/quotes', () => ({ REFERENCE_TICKER: 'BOVA11', readBars }));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
const { QuotesDate, SiteFooter, SiteHeader } = await import('./site-chrome');

// O cabeçalho (etapa 12, parte 2): os links fixos, na ordem. Ele não lê a sessão (as páginas públicas da arena são estáticas, com cache de
// dados, e o LCP da home tem pouca folga contra o teto de 2,5 s), então a Carteira e a Conta são o mesmo link com ou sem login. O e2e
// (layout.spec.ts) confere que o menu cabe em 360 px em no máximo duas linhas.
describe('SiteHeader', () => {
  const out = renderToStaticMarkup(<SiteHeader />);
  // (a ordem dos atributos do <a> é do `Link` do Next: o endereço é lido pelo nome)
  const links = [...out.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map((m) => [
    m[2],
    /href="([^"]*)"/.exec(m[1]!)?.[1],
  ]);

  it('a marca e os sete links do menu, na ordem, com a Carteira antes da Conta', () => {
    expect(links).toEqual([
      ['Alvesting', '/'],
      ['Início', '/'],
      ['Ranking', '/ranking'],
      ['Notícias', '/noticias'],
      ['Ações', '/acoes'],
      ['Como funciona', '/como-funciona'],
      ['Carteira', '/carteira'],
      ['Conta', '/conta'],
    ]);
  });

  it('o menu tem nome e cada link é de 44 px (a classe `link`)', () => {
    expect(out).toContain('<nav aria-label="Principal">');
    expect(out.match(/class="link[^"]*"/g)).toHaveLength(8);
  });

  it('não lê a sessão nem o cookie: nada de login ou de nome de usuário no cabeçalho', () => {
    expect(out).not.toMatch(/cookie|sessão|session|Sair|Entrar/i);
  });
});

// O rodapé (docs/API.md, seção 6; ADR 0033): as cotações vêm da brapi, e o crédito é "Cotações: brapi.dev", com link. A data do pregão chega
// por streaming (lê a rota interna de cotações) e some se a leitura falhar; o e2e confere a frase inteira com a data (layout.spec.ts).
describe('SiteFooter', () => {
  const out = renderToStaticMarkup(<SiteFooter />);
  const links = [...out.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map((m) => [
    /href="([^"]*)"/.exec(m[1]!)?.[1],
    m[2]!.replace(/<[^>]+>/g, ''),
  ]);

  it('credita as cotações à brapi, com o link, e não à B3', () => {
    expect(out).toMatch(/Cotações:\s*<a [^>]*href="https:\/\/brapi\.dev\/"/);
    expect(links).toContainEqual(['https://brapi.dev/', 'brapi.dev']);
    expect(out).not.toMatch(/b3\.com\.br|>B3</i);
  });

  it('os links externos abrem em outra aba sem entregar a janela de origem', () => {
    const brapi = /<a [^>]*href="https:\/\/brapi\.dev\/"[^>]*>/.exec(out)?.[0] ?? '';
    expect(brapi).toContain('target="_blank"');
    expect(brapi).toContain('rel="noopener noreferrer"');
  });

  it('mantém o aviso fixo e as outras atribuições', () => {
    expect(out).toContain('Arena acadêmica com dinheiro fictício');
    expect(out).toContain('Contém dados da CVM');
    expect(out).toContain('Fonte: Banco Central do Brasil');
  });
});

// A data do último pregão no rodapé: a mesma leitura do BOVA11 da home, que chega por streaming e some se falhar. O aviso fixo não depende dela.
describe('QuotesDate', () => {
  const bar = (date: string) => ({
    date,
    openCents: 1,
    highCents: 1,
    lowCents: 1,
    closeCents: 1,
  });

  it('é a data do pregão da barra mais nova do BOVA11', async () => {
    readBars.mockResolvedValueOnce([bar('2026-11-03'), bar('2026-11-05')]);
    expect(await QuotesDate()).toBe(', pregão de 05/11/2026');
    expect(readBars).toHaveBeenLastCalledWith('BOVA11');
  });

  it('sem barra, sem data (e sem erro)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      readBars.mockResolvedValueOnce([]);
      expect(await QuotesDate()).toBeNull();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  // O segredo ausente, curto ou recusado derrubaria a data em silêncio em toda página que não lê cotação: a falta vai para o log do servidor.
  it('a leitura que falha tira só a data, e a falta fica no log (o erro, sem segredo nem corpo)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const error of [
        new ApiError(502, 'QUOTES_REFUSED'),
        new ApiError(503, 'QUOTES_UNCONFIGURED'),
        new ApiError(503, 'UNAVAILABLE'),
      ]) {
        readBars.mockRejectedValueOnce(error);
        expect(await QuotesDate()).toBeNull();
        expect(log).toHaveBeenLastCalledWith(
          expect.stringContaining('rodapé sem a data das cotações'),
          error,
        );
      }
      expect(log).toHaveBeenCalledTimes(3);
    } finally {
      log.mockRestore();
    }
  });
});
