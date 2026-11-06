import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';

// A leitura das cotações (lib/quotes.ts, com o `server-only` do Next e a rota interna da api) é trocada por um fake, e o `connection()` do Next,
// que só vale dentro de uma requisição, por uma promessa pronta.
// (O React 19 já começa a rodar o componente assíncrono do rodapé dentro do renderToStaticMarkup, antes dos testes: o padrão é "sem barra".)
const { readBars } = vi.hoisted(() => ({ readBars: vi.fn().mockResolvedValue([]) }));
vi.mock('../lib/quotes', () => ({ REFERENCE_TICKER: 'BOVA11', readBars }));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
const { SiteHeader } = await import('./site-chrome');
const { AppShell } = await import('./app-shell');
const { QuotesDate, Rodape } = await import('./rodape');

// os links de um pedaço de HTML: [texto sem as tags, endereço] (a ordem dos atributos do <a> do `Link` do Next é outra: o endereço é lido
// pelo nome)
const linksOf = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map((m) => [
    m[2]!.replace(/<[^>]+>/g, ''),
    /href="([^"]*)"/.exec(m[1]!)?.[1],
  ]);

// O cabeçalho do site (ADR 0035; o do Rallies): a marca, os links no meio e a pílula "Entrar". Ele não lê a sessão (as páginas públicas da
// arena são dinâmicas com cache de dados, e o LCP da home tem pouca folga contra o teto de 2,5 s): os links são os mesmos com ou sem login.
// O e2e (layout.spec.ts) confere a folha do menu em 360 px e os links em 1280 px.
describe('SiteHeader', () => {
  const out = renderToStaticMarkup(<SiteHeader />);

  it('a marca, os quatro links do site e a pílula "Entrar", na ordem', () => {
    expect(linksOf(out)).toEqual([
      ['Alvesting', '/'],
      ['Arena', '/arena'],
      ['Ranking', '/ranking'],
      ['Explorar', '/explorar'],
      ['Como funciona', '/como-funciona'],
      ['Entrar', '/entrar'],
    ]);
    expect(out).toContain('<a href="/entrar" class="pill">Entrar</a>');
  });

  // Abaixo de 1024 px o menu é uma folha `popover` aberta pelo botão "Menu", sem JavaScript; a partir de 1024 px, os links na linha.
  it('o menu tem nome e é a folha que o botão "Menu" abre, com o "Fechar o menu" que enche o resto', () => {
    expect(out).toContain('<nav id="menu" popover="auto" aria-label="Principal" class="menu">');
    expect(out).toMatch(
      /<button type="button" popoverTarget="menu"[^>]*>.*<span class="sr-only">Menu<\/span><\/button>/,
    );
    expect(out).toMatch(
      /<button type="button" popoverTarget="menu" popoverTargetAction="hide" aria-label="Fechar o menu"/,
    );
  });

  // Com o `Link` do Next a folha aberta ficaria aberta sobre a página nova numa navegação suave: os links do menu são `<a>` comuns (o do
  // Next leva o `prefetch` e vem com os atributos em outra ordem).
  it('os links do menu são <a> comuns: a navegação inteira fecha a folha', () => {
    const menu = /<nav id="menu"[^>]*>(.*)<\/nav>/.exec(out)![1]!;
    expect(menu.match(/<a href="[^"]+"( class="[^"]+")?>/g)).toHaveLength(5);
  });

  it('não lê a sessão nem o cookie: nada de nome de usuário nem de "Sair" no cabeçalho', () => {
    expect(out).not.toMatch(/cookie|sessão|session|Sair/i);
  });

  // O seletor de tema (ADR 0037) fica antes de "Entrar": na linha, a partir de 1024 px; na folha do "Menu", como a linha "Tema". É HTML do
  // servidor (o script do <head> faz o resto): a landing não carrega JavaScript de cliente por causa dele.
  it('o seletor de tema vem antes de "Entrar", dentro do menu', () => {
    const menu = /<nav id="menu"[^>]*>(.*)<\/nav>/.exec(out)![1]!;
    expect(menu).toMatch(
      /<div class="menu-acoes"><div class="tema-linha">.*<fieldset class="tema"><legend class="sr-only">Tema<\/legend>.*<\/fieldset><\/div><a href="\/entrar" class="pill">Entrar<\/a><\/div>/,
    );
    expect(menu.match(/<input type="radio" name="tema-site"/g)).toHaveLength(3);
  });
});

// A casca do app (ADR 0035): o trilho no desktop e a barra de abas no celular são a mesma `nav "Principal"`, dentro do `banner`; o item da
// área leva `aria-current="page"` sem JavaScript (cada área tem o seu layout). O "Mais" abre a folha das telas de apoio.
describe('AppShell', () => {
  const out = renderToStaticMarkup(
    <AppShell area="carteira">
      <p>conteúdo da tela</p>
    </AppShell>,
  );
  const header = /<header[^>]*>(.*)<\/header>/s.exec(out)![1]!;
  const nav = /<nav aria-label="Principal"[^>]*>(.*)<\/nav>/s.exec(header)![1]!;
  const sheet = nav.slice(nav.indexOf('<div id="mais"'));
  const items = nav.slice(0, nav.indexOf('<div id="mais"'));

  it('o banner tem a marca, e a navegação os itens na ordem do Rallies adaptada: Arena, Explorar, Carteira, Chat, Mais, Buscar e Conta', () => {
    expect(linksOf(header)[0]).toEqual(['Alvesting', '/']);
    expect(linksOf(items)).toEqual([
      ['Arena', '/arena'],
      ['Explorar', '/explorar'],
      ['Carteira', '/carteira'],
      ['Chat', '/chat'],
      ['Buscar', '/acoes'],
      ['Conta', '/conta'],
    ]);
    // o "Mais" é um botão que abre a folha, entre o Chat e o Buscar
    expect(items).toMatch(
      /Chat<\/a><\/li><li><button type="button" popoverTarget="mais" class="app-item app-mais">.*Mais<\/button><\/li><li class="app-buscar">/s,
    );
  });

  it('só o item da área leva aria-current="page", e cada área marca o seu', () => {
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
    expect(nav).toContain('<a href="/carteira" aria-current="page" class="app-item">');
    for (const area of ['arena', 'explorar', 'carteira', 'chat', 'conta'] as const) {
      const html = renderToStaticMarkup(<AppShell area={area}>x</AppShell>);
      expect(html).toContain(`<a href="/${area}" aria-current="page" class="app-item">`);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    }
  });

  // a folha é a do site (QA da onda Rallies, achado 1): o título e o ✕ na própria folha, antes dos links, e nada de botão vazio enchendo o
  // resto da tela
  it('a folha "Mais" é um popover com o título, o ✕ e as telas de apoio', () => {
    expect(sheet).toMatch(
      /^<div id="mais" popover="auto" class="mais"><div class="mais-topo"><p[^>]*>Mais<\/p><button type="button" popoverTarget="mais" popoverTargetAction="hide" aria-label="Fechar o menu"[^>]*>.*?<\/button><\/div><ul class="mais-folha">/s,
    );
    expect(linksOf(sheet)).toEqual([
      ['Como funciona', '/como-funciona'],
      ['Notícias', '/noticias'],
      ['Ações', '/acoes'],
      ['Termos de uso', '/termos'],
      ['Política de privacidade', '/privacidade'],
    ]);
    expect(sheet).not.toContain('mais-fechar');
  });

  // os itens e os links da folha são <a> comuns, como os do site: a folha aberta não fica aberta sobre a página nova (a marca e o "Buscar",
  // fora da folha, são o Link do Next)
  it('os itens da barra e os links da folha são <a> comuns, sem o Link do Next', () => {
    for (const href of ['/arena', '/explorar', '/carteira', '/chat', '/conta']) {
      expect(items).toMatch(
        new RegExp(`<a href="${href}"( aria-current="page")? class="app-item">`),
      );
    }
    expect(sheet.match(/<a href="[^"]+">/g)).toHaveLength(5);
  });

  // O seletor de tema (ADR 0037): no pé do trilho, em pé, entre o "Buscar" e a "Conta" (abaixo de 1024 px ele some da barra de abas); e na
  // folha "Mais", depois das telas de apoio, para o celular. Cada um com o seu nome de grupo.
  it('o seletor de tema fica no pé do trilho, perto de "Conta", e na folha "Mais"', () => {
    expect(items).toMatch(
      /Buscar<\/a><\/li><li class="app-tema"><div class="tema-linha">.*<fieldset class="tema tema-vertical">.*<\/fieldset><\/div><\/li><li><a href="\/conta"/s,
    );
    expect(items.match(/<input type="radio" name="tema-trilho"/g)).toHaveLength(3);
    expect(sheet).toMatch(
      /<\/ul><div class="mais-tema"><div class="tema-linha">.*<fieldset class="tema">/s,
    );
    expect(sheet.match(/<input type="radio" name="tema-mais"/g)).toHaveLength(3);
  });

  it('o conteúdo vai no main e o aviso fixo no rodapé, fora dele; nada lê a sessão', () => {
    expect(out).toMatch(/<main[^>]*><p>conteúdo da tela<\/p><\/main><footer/);
    expect(out).toContain('Arena acadêmica com dinheiro fictício');
    expect(header).not.toMatch(/cookie|sessão|session|Sair/i);
  });
});

// O rodapé das duas cascas (docs/API.md, seção 6; ADR 0033): as cotações vêm da brapi, e o crédito é "Cotações: brapi.dev", com link. A data
// do pregão chega por streaming (lê a rota interna de cotações) e some se a leitura falhar; o e2e confere a frase inteira com a data
// (layout.spec.ts).
describe('Rodape', () => {
  const out = renderToStaticMarkup(<Rodape className="rodape" />);
  const links = linksOf(out).map(([text, href]) => [href, text]);

  it('é o contentinfo da página, com a classe que a casca escolhe', () => {
    expect(out).toMatch(/^<footer class="rodape">/);
  });

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

  it('mantém o aviso fixo e as outras atribuições, e diz que as marcas dos modelos são dos donos', () => {
    expect(out).toContain('Arena acadêmica com dinheiro fictício');
    expect(out).toContain('Contém dados da CVM');
    expect(out).toContain('Fonte: Banco Central do Brasil');
    expect(out).toContain(
      'Os nomes e os logos dos modelos são marcas dos seus donos (OpenAI, Anthropic, Google, xAI, DeepSeek e Alibaba Cloud); a Alvesting não tem relação com eles.',
    );
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
