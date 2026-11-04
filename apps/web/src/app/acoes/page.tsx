import type { Metadata } from 'next';
import { stocksQuerySchema } from '@alvesting/contracts';
import { Empty, LINK, NavLink, SearchForm } from '../../components/ui';
import { api } from '../../lib/api';
import { first, orNotFound, type SearchParams } from '../../lib/page';
import { withApiDown } from '../../lib/with-api-down';

// A busca de ações (plano §3): por ticker ou por nome, até 20 resultados. Formulário GET: funciona sem JavaScript.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ações' };

export default withApiDown(async function StocksPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const typed = first((await searchParams).q)?.trim() || undefined;
  // a mesma regra da api (até 40 caracteres, sem caractere de controle): o que não passa é dito ao leitor, não vira erro
  const parsed = typed === undefined ? undefined : stocksQuerySchema.shape.q.safeParse(typed);
  const found = parsed?.success ? await orNotFound(api.searchStocks(parsed.data)) : null;

  return (
    <>
      <header className="space-y-3">
        <h1 className="font-mono text-2xl font-semibold sm:text-3xl">Ações</h1>
        <p className="max-w-prose">
          Busque uma ação do universo da arena pelo ticker ou pelo nome. A página da ação mostra as
          velas recentes, quem a tem, o que os modelos decidiram sobre ela e as notícias.
        </p>
        <SearchForm
          action="/acoes"
          name="q"
          label="Ticker ou nome"
          button="Buscar"
          defaultValue={typed}
          maxLength={40}
          invalidId={parsed && !parsed.success ? 'aviso-busca' : undefined}
        />
      </header>

      {parsed && !parsed.success ? (
        <p
          id="aviso-busca"
          role="alert"
          className="border-2 border-ink p-3 font-mono font-semibold"
        >
          Busca inválida: use até 40 caracteres, sem caracteres de controle.
        </p>
      ) : found ? (
        found.rows.length > 0 ? (
          <ul aria-label="Resultados da busca" className="space-y-1">
            {found.rows.map((stock) => (
              <li key={stock.ticker} className="flex flex-wrap items-center gap-x-3">
                <NavLink
                  href={`/acoes/${stock.ticker}`}
                  className={`${LINK} font-mono font-semibold`}
                >
                  {stock.ticker}
                </NavLink>
                <span className="min-w-0">{stock.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nenhuma ação encontrada para “{typed}”.</Empty>
        )
      ) : null}
    </>
  );
});
