import type { Metadata } from 'next';
import { tickerParamSchema } from '@alvesting/contracts';
import { NewsList } from '../../components/news-list';
import { Empty, LINK, NavLink, SearchForm } from '../../components/ui';
import { api } from '../../lib/api';
import { cursorOf, first, orNotFound, type SearchParams } from '../../lib/page';
import { withApiDown } from '../../lib/with-api-down';

// As notícias (plano §3): título, fonte, hora, tickers e o link para o site de origem, da mais nova à mais antiga, com filtro por
// ticker. O filtro e a paginação são links e um formulário GET, então funcionam sem JavaScript. O trecho nunca é mostrado.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Notícias' };

const LIMIT = 20;

export default withApiDown(async function NewsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const typed = first(query.ticker)?.trim() || undefined;
  const cursor = cursorOf(first(query.cursor));

  // ticker torto é dito ao leitor, não vira erro: ele digitou, não clicou
  const parsed = typed === undefined ? undefined : tickerParamSchema.safeParse(typed);
  const ticker = parsed?.success ? parsed.data : undefined;
  const invalid = parsed !== undefined && !parsed.success;
  const page = invalid ? null : await orNotFound(api.news({ ticker, cursor, limit: LIMIT }));

  const older = page?.nextCursor
    ? `/noticias?${new URLSearchParams({ ...(ticker ? { ticker } : {}), cursor: page.nextCursor }).toString()}`
    : null;

  return (
    <>
      <header className="space-y-3">
        <h1 className="font-mono text-2xl font-semibold sm:text-3xl">Notícias</h1>
        <p className="max-w-prose">
          Título, fonte, hora de Brasília e o link para o site de origem. O texto da notícia é do
          site que a publicou: aqui não há trecho nem cópia.
        </p>
        <SearchForm
          action="/noticias"
          name="ticker"
          label="Ticker"
          button="Filtrar"
          defaultValue={typed}
          maxLength={12}
          capitalize="characters"
          invalidId={invalid ? 'aviso-ticker' : undefined}
        />
        {typed ? (
          <NavLink href="/noticias" className={LINK}>
            Limpar filtro
          </NavLink>
        ) : null}
      </header>

      {invalid ? (
        <p
          id="aviso-ticker"
          role="alert"
          className="border-2 border-ink p-3 font-mono font-semibold"
        >
          Ticker inválido: use quatro letras ou números e o número da classe, como PETR4.
        </p>
      ) : page && page.rows.length > 0 ? (
        <>
          <NewsList rows={page.rows} />
          {older ? (
            <NavLink href={older} className={LINK}>
              Mais antigas
            </NavLink>
          ) : null}
        </>
      ) : (
        <Empty>
          {ticker ? `Nenhuma notícia encontrada com ${ticker}.` : 'Nenhuma notícia ainda.'}
        </Empty>
      )}
    </>
  );
});
