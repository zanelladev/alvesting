import type { InternalTape, LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { api } from '../../lib/api';
import { formatBRL, formatBps, formatDate, variationBps } from '../../lib/format';
import { Competidor, Logo } from '../competidor';
import { Empty, LINK, NavLink, SimulatedTag, direction, isSimulated } from '../ui';

// O Explorar no desenho do Discover do Rallies (plano do redesenho, f.1): a barra com o acordeão "Populares" e os grupos, os cartões dos
// competidores e o universo da semana. Componentes de servidor: o acordeão é o `details` do navegador, sem JavaScript.

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
      <h2
        id="explorar-titulo"
        className="mb-3 border-b border-hairline pb-3 text-15 font-medium text-ink"
      >
        Explorar
      </h2>
      <details open className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg bg-surface-strong px-3 text-13 font-medium text-ink [&::-webkit-details-marker]:hidden">
          Populares
          <span
            aria-hidden="true"
            className="text-muted transition-transform group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        {rows.length > 0 ? (
          <ul className="mt-1 ml-3 border-l border-hairline pl-2">
            {rows.map((row) => (
              <li key={row.competitor.slug}>
                <NavLink
                  href={`/modelos/${row.competitor.slug}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 hover:bg-surface-card"
                >
                  <span className="min-w-0 text-13 text-ink">
                    <Competidor competitor={row.competitor} link={false} />
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
              className="flex min-h-11 items-center justify-between rounded-lg px-3 text-13 text-ink hover:bg-surface-card"
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
      return isSimulated(competitor)
        ? `Decisões simuladas, pela estratégia ${competitor.modelId ?? 'sem registro'}.`
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

// O cartão do Discover: o logo (ou a inicial), o nome, a descrição, o número de posições da carteira (só os modelos têm composição pública;
// nos outros, o traço) e o retorno. O cartão inteiro é o link para a página do competidor.
export function CartaoCompetidor({
  row,
  posicoes,
}: {
  row: LeaderboardRow;
  posicoes: number | null;
}) {
  const { competitor } = row;
  return (
    <li data-cartao={competitor.slug} className="min-w-0">
      <NavLink
        href={`/modelos/${competitor.slug}`}
        className="group flex h-full min-h-11 flex-col border-b border-hairline px-1 pt-1 pb-5 hover:border-ink"
      >
        <Logo competitor={competitor} className="size-10" />
        <span className="mt-3 text-15 font-semibold text-ink group-hover:underline">
          {competitor.name}
          {isSimulated(competitor) ? <SimulatedTag /> : null}
        </span>
        <span className="mt-1 line-clamp-2 text-13 text-muted">{descricao(competitor)}</span>
        <dl className="mt-auto flex items-end justify-between gap-4 pt-4">
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
          </div>
        </dl>
      </NavLink>
    </li>
  );
}

// O universo da semana (os papéis que o briefing deu a todos os modelos no último ciclo, com o fechamento do pregão e a variação sobre o
// anterior), da rota interna da fita (src/lib/quotes.ts; o mesmo dado da fita da landing). É cotação da brapi: mostrada na tela, com o crédito,
// e nunca entregue por uma rota pública (ADR 0033).
export function UniversoDaSemana({ tape }: { tape: InternalTape }) {
  if (tape.date === null || tape.rows.length === 0) {
    return <Empty>O universo da semana aparece depois do primeiro ciclo.</Empty>;
  }
  return (
    <>
      <p className="muted">
        Os papéis que o briefing deu a todos os modelos no último ciclo, com o fechamento do pregão
        de {formatDate(tape.date)} e a variação sobre o anterior. Cotações: brapi.dev.
      </p>
      <ul
        aria-label="Universo da semana"
        className="grid gap-x-8 border-t border-hairline sm:grid-cols-2"
      >
        {tape.rows.map((row) => {
          const change =
            row.previousCloseCents !== null && row.previousCloseCents > 0
              ? variationBps(row.closeCents, row.previousCloseCents)
              : null;
          return (
            <li
              key={row.ticker}
              className="flex min-w-0 items-center justify-between gap-3 border-b border-hairline"
            >
              <NavLink
                href={`/acoes/${row.ticker}`}
                className={`${LINK} font-mono text-sm font-semibold no-underline hover:underline`}
              >
                {row.ticker}
              </NavLink>
              <span className="text-13 text-ink tabular-nums">
                {formatBRL(row.closeCents)}{' '}
                {change === null ? (
                  <span className="text-muted">(sem o anterior)</span>
                ) : (
                  <>
                    (<span data-dir={direction(change)}>{formatBps(change)}</span>)
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
