import type { ReactElement, ReactNode } from 'react';
import type { InternalTape, LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { api } from '../../lib/api';
import { formatBRL, formatBps, formatDate, formatPercentile, variationBps } from '../../lib/format';
import { Competidor, Logo, NomeCurto } from '../competidor';
import { LogoDoPapel } from '../logo-do-papel';
import { Empty, LINK, NavLink, NotaSimulada, direction, isSimulated } from '../ui';

// O Explorar no desenho do Discover do Rallies (plano do redesenho, f.1): a barra com o acordeão "Populares" e os grupos, os cartões dos
// competidores e o universo da semana. Componentes de servidor: o acordeão é o `details` do navegador, sem JavaScript. O "simulado" vai uma
// vez por contexto (docs/DESIGN.md: a nota no cabeçalho dos populares e da grade dos modelos), e o nome curto fica à vista (o sufixo de versão
// vai para o leitor de tela e para o tooltip da página). O tooltip da Arc é de cliente: quem o põe é a página (`envolver`, `termo`), para
// as telas que só usam a barra (as ações, as notícias, a página da ação) não carregarem o Motion por ela.

// A barra "Explorar" (300 px; components/arena/pagina.tsx, ComBarra): os competidores da temporada pelo retorno, num `details` aberto, e os
// grupos (as duas grades do /explorar, as ações e as notícias), cada um com a seta.
export function BarraExplorar({ rows }: { rows: readonly LeaderboardRow[] }) {
  const grupos = [
    ['Modelos', '/explorar#modelos'],
    ['Controle e referências', '/explorar#referencias'],
    ['Ações', '/acoes'],
    ['Notícias', '/noticias'],
  ] as const;
  return (
    <nav aria-labelledby="explorar-titulo">
      {/* a partir de 1280 px, a linha de 45 px do topo da barra, com o fio de uma borda à outra (como a "Carteiras"; pagina.tsx, ComBarra) */}
      <h2
        id="explorar-titulo"
        className="mb-3 border-b border-hairline pb-3 text-15 font-medium text-ink xl:-mx-5 xl:flex xl:h-[45px] xl:items-center xl:px-5 xl:pb-0"
      >
        Explorar
      </h2>
      <details open className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg bg-surface-strong px-3 text-13 font-medium text-ink [&::-webkit-details-marker]:hidden">
          Populares
          <span
            aria-hidden="true"
            className="text-muted transition-[rotate] duration-150 ease-out-quart group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <NotaSimulada competitors={rows.map((row) => row.competitor)} className="px-3 pt-3 pb-1" />
        {rows.length > 0 ? (
          <ul className="mt-1 ml-3 border-l border-hairline pl-2">
            {rows.map((row) => (
              <li key={row.competitor.slug}>
                <NavLink
                  href={`/modelos/${row.competitor.slug}`}
                  className="linha-explorar flex min-h-11 items-center justify-between gap-3 rounded-lg px-2"
                >
                  {/* o nome curto numa linha (truncado, se faltar lugar); `relative`: o sufixo de versão é `sr-only` (absoluto) e fica preso
                      aqui dentro */}
                  <span className="relative min-w-0 truncate text-13 text-ink">
                    <Competidor competitor={row.competitor} link={false} etiqueta={false} curto />
                  </span>
                  <span
                    data-dir={direction(row.returnBps)}
                    className="shrink-0 text-xs font-medium text-ink tabular-nums"
                  >
                    {formatBps(row.returnBps)}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 px-3 muted">O retorno aparece depois da primeira liquidação.</p>
        )}
      </details>
      <ul className="mt-2">
        {grupos.map(([label, href]) => (
          <li key={href}>
            <NavLink
              href={href}
              className="linha-explorar flex min-h-11 items-center justify-between rounded-lg px-3 text-13 text-ink"
            >
              {label}
              <span aria-hidden="true" className="text-muted">
                ›
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// O ranking da barra nas telas de ações e de notícias, que leem outra coisa (a ação, as notícias): a barra é enfeite ali, como a fita da
// landing. A falha só dela vai para o log e a barra diz que ainda não há retorno, sem derrubar a tela.
export const EXPLORAR = { label: 'Explorar', href: '/explorar' };
export async function lerPopulares(): Promise<LeaderboardRow[]> {
  try {
    const { season } = await api.arenaCurrent();
    return season ? (await api.leaderboard(season.slug)).rows : [];
  } catch (error) {
    console.error('[web] barra do explorar sem o ranking:', error);
    return [];
  }
}

// O que o competidor é, em uma frase (a descrição do cartão, em até duas linhas). Os textos são os da página do competidor, encurtados.
export function descricao(competitor: PublicCompetitor): string {
  switch (competitor.type) {
    case 'MODEL':
      // o id da estratégia do provedor fake ("fake/hold-only") é técnico: no cartão vai a frase, e a página do modelo mostra o id, no par
      // "Estratégia simulada" (a revisão do fechamento, M19)
      return isSimulated(competitor)
        ? 'Decisões simuladas por uma estratégia fixa.'
        : `Modelo de linguagem${competitor.modelId ? `: ${competitor.modelId}` : ''}.`;
    case 'RANDOM':
      return 'Controle: sorteia de 0 a 5 ordens por pregão, com as regras e os custos dos modelos.';
    case 'EQUAL_WEIGHT':
      return 'Referência: todas as ações do universo com pesos iguais, compradas no primeiro pregão (só preço).';
    case 'CDI':
      return 'Referência: o caixa rendendo o CDI.';
    case 'BOVA11':
      return 'Referência: o BOVA11 comprado no primeiro pregão; inclui proventos, que os modelos não recebem.';
  }
}

// O cartão do Discover: o logo (ou a inicial), o nome curto, a descrição, o número de posições da carteira (só os modelos têm composição
// pública; nos outros, o traço), o retorno com o glifo e, embaixo dele, o percentil (quando há). O cartão inteiro é o link para a página do
// competidor; no hover ele acende e o conteúdo sobe 2 px, em 150 ms (o levantar discreto do Discover; globals.css, bloco do explorar), e no
// toque acende no cinza do trilho. `envolver`: a página põe o tooltip da Arc em volta do link (o nome inteiro e o que é o percentil).
export function CartaoCompetidor({
  row,
  posicoes,
  envolver,
}: {
  row: LeaderboardRow;
  posicoes: number | null;
  envolver?: (link: ReactElement) => ReactNode;
}) {
  const { competitor } = row;
  const link = (
    <NavLink
      href={`/modelos/${competitor.slug}`}
      className="cartao-explorar flex h-full min-h-11 flex-col rounded-lg px-4 pt-4 pb-5"
    >
      <span className="cartao-explorar-corpo flex flex-1 flex-col">
        <Logo competitor={competitor} className="size-10" />
        <span className="relative mt-3 text-15 font-semibold text-ink">
          <NomeCurto name={competitor.name} type={competitor.type} />
        </span>
        <span className="mt-1 line-clamp-2 text-13 text-muted">{descricao(competitor)}</span>
        {/* os rótulos numa linha e os valores na de baixo, como no Discover (`items-start`); o percentil fica embaixo do retorno */}
        <dl className="mt-auto flex items-start justify-between gap-4 pt-4">
          <div>
            <dt className="text-xs text-muted">Posições</dt>
            <dd className="text-sm text-ink tabular-nums">{posicoes ?? '—'}</dd>
          </div>
          <div className="text-right">
            <dt className="text-xs text-muted">Retorno</dt>
            <dd
              data-dir={direction(row.returnBps)}
              className="text-sm font-semibold text-ink tabular-nums"
            >
              {formatBps(row.returnBps)}
            </dd>
            {row.percentileBps === null ? null : (
              <dd className="text-xs text-muted tabular-nums">
                percentil {formatPercentile(row.percentileBps)}
              </dd>
            )}
          </div>
        </dl>
      </span>
    </NavLink>
  );
  return (
    <li data-cartao={competitor.slug} className="relative min-w-0 border-b border-hairline pb-3">
      {envolver ? envolver(link) : link}
    </li>
  );
}

// O que o universo da semana é (docs/METODOLOGIA.md, a tabela das regras), em texto à vista: no celular o tooltip não abre pelo toque (a
// revisão do fechamento, M9).
const REGRAS_DO_UNIVERSO =
  'O universo tem até 500 ações da B3 (ON, PN e unit) negociadas em pelo menos 90% dos últimos 60 pregões, sem FII, ETF nem BDR. É refeito todo domingo, é o mesmo para todos os modelos e vai do maior volume financeiro para o menor.';

// O universo da semana (os papéis que o briefing deu a todos os modelos no último ciclo, com o fechamento do pregão e a variação sobre o
// anterior), da rota interna da fita (src/lib/quotes.ts; o mesmo dado da fita da landing: um pregão por papel, sem série). É cotação da brapi:
// mostrada na tela, com o crédito, e nunca entregue por uma rota pública (ADR 0033). Cada papel numa linha com o logo à esquerda do ticker, o
// fechamento e a variação com o glifo (a Regra do Glifo), que acende no hover (globals.css, `.linha-papel`), e as regras do universo à vista.
export function UniversoDaSemana({
  tape,
  logos,
}: {
  tape: InternalTape;
  logos: ReadonlyMap<string, string>;
}) {
  if (tape.date === null || tape.rows.length === 0) {
    return <Empty>O universo da semana aparece depois do primeiro ciclo.</Empty>;
  }
  return (
    <>
      <p className="muted max-w-prose text-pretty">
        Os papéis que o briefing deu a todos os modelos no último ciclo, com o fechamento do pregão
        de {formatDate(tape.date)} e a variação sobre o anterior. Cotações: brapi.dev.
      </p>
      <p className="muted max-w-prose text-pretty">{REGRAS_DO_UNIVERSO}</p>
      <ul
        aria-label="Universo da semana"
        className="grid gap-x-8 border-t border-hairline sm:grid-cols-2 2xl:grid-cols-3"
      >
        {tape.rows.map((row) => {
          const change =
            row.previousCloseCents !== null && row.previousCloseCents > 0
              ? variationBps(row.closeCents, row.previousCloseCents)
              : null;
          return (
            <li key={row.ticker} className="linha-papel">
              <NavLink href={`/acoes/${row.ticker}`} className={LINK}>
                <LogoDoPapel
                  ticker={row.ticker}
                  versao={logos.get(row.ticker)}
                  className="mr-3.5"
                />
                {row.ticker}
              </NavLink>
              <span>{formatBRL(row.closeCents)}</span>
              {change === null ? (
                <span className="text-xs text-muted">sem o anterior</span>
              ) : (
                <span data-dir={direction(change)}>{formatBps(change)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
