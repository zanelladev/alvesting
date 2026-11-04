import { Suspense, type ReactNode } from 'react';
import { connection } from 'next/server';
import { formatDate } from '../lib/format';
import { REFERENCE_TICKER, readBars } from '../lib/quotes';
import { LINK, NavLink } from './ui';

// O menu principal (plano §9: as rotas do site que existem nesta etapa; o chat entra com a etapa 13). O painel de admin (/admin, etapa 10) não
// tem link aqui de propósito: o cabeçalho não lê a sessão, e o admin chega a ele pela /conta (docs/TELAS.md, seção 8). Cabe em 360 px: a marca em
// cima e os links em até duas linhas (o e2e confere, layout.spec.ts), cada um com alvo de toque de 44 px. Os dois últimos são os links fixos da
// carteira (etapa 12) e da conta (etapa 11): o cabeçalho não lê a sessão (as páginas públicas da arena não a leem: protege o LCP da home e o cache
// de dados delas), então os links são os mesmos para quem entrou ou não, e a /carteira e a /conta mandam quem não entrou para a /entrar.
const NAV = [
  ['Início', '/'],
  ['Ranking', '/ranking'],
  ['Notícias', '/noticias'],
  ['Ações', '/acoes'],
  ['Como funciona', '/como-funciona'],
  ['Carteira', '/carteira'],
  ['Conta', '/conta'],
] as const;

export function SiteHeader() {
  return (
    <header className="border-b-2 border-ink">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 px-4">
        <NavLink href="/" className={`${LINK} font-mono text-xl font-semibold`}>
          Alvesting
        </NavLink>
        <nav aria-label="Principal">
          <ul className="flex flex-wrap -mx-2">
            {NAV.map(([label, href]) => (
              <li key={href}>
                <NavLink href={href} className={`${LINK} px-2 font-mono text-sm uppercase`}>
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

// O rodapé de toda tela (plano §12): o aviso fixo e as atribuições que as fontes pedem. Nada aqui depende da api, menos a data do dado
// das cotações, que chega por streaming e some (sem data) se a api falhar: o aviso não pode depender de dado.

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
    <footer className="mt-12 border-t-2 border-ink">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 text-sm">
        <p>
          <strong className="font-mono font-semibold">Aviso.</strong> Arena acadêmica com dinheiro
          fictício, projeto de TCC. Isto não é recomendação de investimento, consultoria nem análise
          de valores mobiliários, atividades reguladas pelas Resoluções CVM 19 e 20, que a Alvesting
          não presta. O software não se responsabiliza pelas decisões do usuário.
        </p>
        <h2 className="font-mono text-sm font-semibold">
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
            Notícias (só título, fonte e link):
            {NEWS_SOURCES.map(([name, href]) => (
              <span key={name} className="ml-2">
                <Source href={href}>{name}</Source>
              </span>
            ))}
          </li>
        </ul>
      </div>
    </footer>
  );
}
