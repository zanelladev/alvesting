import { Suspense, type ReactNode } from 'react';
import { connection } from 'next/server';
import { formatDate } from '../lib/format';
import { REFERENCE_TICKER, readBars } from '../lib/quotes';
import { LINK, NavLink } from './ui';

// O menu principal (plano §9: as rotas do site que existem nesta etapa; o chat entra com a etapa 13). O painel de admin (/admin, etapa 10)
// não tem link aqui de propósito: o cabeçalho não lê a sessão, e o admin chega a ele pela /conta (docs/TELAS.md, seção 8). Os dois últimos
// são os links fixos da carteira (etapa 12) e da conta (etapa 11): o cabeçalho não lê a sessão (as páginas públicas da arena não a leem:
// protege o LCP da home e o cache de dados delas), então os links são os mesmos para quem entrou ou não, e a /carteira e a /conta mandam
// quem não entrou para a /entrar.
const NAV = [
  ['Início', '/'],
  ['Ranking', '/ranking'],
  ['Notícias', '/noticias'],
  ['Ações', '/acoes'],
  ['Como funciona', '/como-funciona'],
] as const;

// A marca: o ladrilho âmbar (a brasa da arte) com o glifo de alta vazado. SVG, e não glifo: ▲ e █ não estão no subset latino das fontes, e
// o desenho da fonte reserva muda em cada sistema.
const BrandMark = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <rect width="18" height="18" rx="5" className="fill-primary" />
    <path d="M4.75 12.75 9 5.25l4.25 7.5z" className="fill-canvas" />
  </svg>
);

// O cabeçalho de toda tela (ADR 0034): 64 px, preso no topo, com a linha de baixo (a primeira da moldura). Uma `nav` só, com os sete links na
// ordem: a partir de 1024 px, a cápsula centrada (as cinco telas da arena), a pílula branca "Carteira" e a ação quieta "Conta"; abaixo
// disso, uma folha `popover` aberta pelo botão "Menu" (que vira um ✕), sem JavaScript. A folha vai até o pé da tela, e o resto dela, embaixo
// dos links, é o botão "Fechar o menu": o toque ali fecha a folha e não chega à página de baixo, que sai de vista e da ordem do Tab enquanto a
// folha está aberta (globals.css). O Esc também fecha.
// Os links do menu são `<a>` comuns, e não o `Link` do Next: o cabeçalho é do layout, que não remonta numa navegação suave, e a folha
// aberta continuaria aberta sobre a página nova (fechá-la pediria JavaScript). A navegação inteira a fecha, e o leitor de tela anuncia a
// página nova. O cabeçalho não sabe a página atual (não lê o caminho), então a cápsula não marca o item ativo.
export function SiteHeader() {
  return (
    <header className="topo sticky top-0 z-30 border-b border-hairline bg-canvas">
      <div className="cabecalho mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-2 px-(--calha) lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <NavLink
          href="/"
          className="inline-flex min-h-11 items-center gap-2 justify-self-start font-display text-base font-medium text-ink"
        >
          <BrandMark />
          Alvesting
        </NavLink>
        <button
          type="button"
          popoverTarget="menu"
          className="btn-menu inline-flex size-11 items-center justify-center rounded-xl text-ink hover:bg-surface-strong lg:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              className="menu-abrir"
              d="M3 6h14M3 10h14M3 14h14"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              className="menu-x"
              d="M5 5l10 10M15 5 5 15"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          <span className="sr-only">Menu</span>
        </button>
        <nav id="menu" popover="auto" aria-label="Principal" className="menu">
          <ul className="capsule">
            {NAV.map(([label, href]) => (
              <li key={href}>
                <a href={href} className="capsule-item">
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <ul className="menu-acoes">
            <li>
              <a href="/carteira" className="acao acao-primaria">
                Carteira
              </a>
            </li>
            <li>
              <a href="/conta" className="acao">
                Conta
              </a>
            </li>
          </ul>
          <button
            type="button"
            popoverTarget="menu"
            popoverTargetAction="hide"
            aria-label="Fechar o menu"
            className="menu-fechar lg:hidden"
          />
        </nav>
      </div>
    </header>
  );
}

// O rodapé de toda tela (plano §12): o aviso fixo e as atribuições que as fontes pedem, na coluna da moldura (a linha de cima é a dela, no
// layout). Nada aqui depende da api, menos a data do dado das cotações, que chega por streaming e some (sem data) se a api falhar: o aviso
// não pode depender de dado.

// ponytail: as fontes de notícia estão escritas aqui à mão, e a lista de verdade é a da api (apps/api/src/modules/news/domain/sources.ts).
// Fonte nova no worker exige uma linha aqui. Se passar de umas poucas, a api passa a mandar a lista.
const NEWS_SOURCES = [
  ['InfoMoney', 'https://www.infomoney.com.br/'],
  ['Money Times', 'https://www.moneytimes.com.br/'],
  ['Seu Dinheiro', 'https://www.seudinheiro.com/'],
  ['Agência Brasil', 'https://agenciabrasil.ebc.com.br/'],
] as const;

// O pregão do último fechamento que a base tem (o mesmo do BOVA11 da home: a leitura é a mesma, da rota interna de cotações e do cache de
// dados do site, src/lib/quotes.ts). `connection()` tira o componente da pré-renderização: sem ele a página 404, estática, guardaria o rodapé
// do build, sem data. A data some se a leitura falhar (o aviso fixo não pode depender de dado), mas a falta vai para o log do servidor: sem
// ele, o segredo das cotações ausente, curto ou recusado derrubaria em silêncio a data do rodapé de toda página que não lê cotação
// (/ranking, /noticias, /termos...), que seguiriam 200. O erro não carrega o segredo nem o corpo da resposta.
export async function QuotesDate() {
  await connection();
  try {
    const last = (await readBars(REFERENCE_TICKER)).at(-1);
    return last ? `, pregão de ${formatDate(last.date)}` : null;
  } catch (error) {
    console.error('[web] rodapé sem a data das cotações:', error);
    return null;
  }
}

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;
const Source = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} className={LINK} {...external}>
    {children}
  </a>
);

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1200px] space-y-4 px-(--calha) pt-12 pb-16 text-sm">
      <p className="max-w-[72ch]">
        <strong>Aviso.</strong> Arena acadêmica com dinheiro fictício, projeto de TCC. Isto não é
        recomendação de investimento, consultoria nem análise de valores mobiliários, atividades
        reguladas pelas Resoluções CVM 19 e 20, que a Alvesting não presta. O software não se
        responsabiliza pelas decisões do usuário.
      </p>
      <h2 className="font-display text-sm font-medium">
        Fontes e atribuições
        <span className="sr-only"> (os links abrem em outra aba)</span>
      </h2>
      {/* O texto corre em linha (nada de item flex): a pontuação nunca fica sozinha na linha de baixo. Todo link tem 44 px de largura
          mínima com o texto à esquerda, então o link de uma palavra curta ("brapi.dev") deixaria um vão antes da vírgula: por isso o link é
          a frase inteira ("brapi.dev, pregão de 09/11/2026") ou fica no fim da linha. As frases das atribuições ("Fonte: Banco Central do
          Brasil", "Contém dados da CVM, licença ODbL") saem inteiras no texto. */}
      <ul className="space-y-1">
        <li>
          Cotações:{' '}
          <Source href="https://brapi.dev/">
            brapi.dev
            <Suspense fallback={null}>
              <QuotesDate />
            </Suspense>
          </Source>
        </li>
        <li>
          Macro (CDI, Selic, IPCA e dólar).{' '}
          <Source href="https://www.bcb.gov.br/">Fonte: Banco Central do Brasil</Source>
        </li>
        <li>
          Fatos relevantes e comunicados.{' '}
          <Source href="https://dados.cvm.gov.br/">Contém dados da CVM</Source>
          {', '}
          <Source href="https://opendatacommons.org/licenses/odbl/1-0/">licença ODbL</Source>
        </li>
        <li>
          {/* a margem fica depois de cada fonte: quando a linha quebra, a de baixo começa na margem do rodapé, e não 8 px para dentro */}
          Notícias (só título, fonte e link):{' '}
          {NEWS_SOURCES.map(([name, href]) => (
            <span key={name} className="mr-2">
              <Source href={href}>{name}</Source>
            </span>
          ))}
        </li>
      </ul>
    </footer>
  );
}
