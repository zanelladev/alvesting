import type { Metadata } from 'next';
import { tickerParamSchema } from '@alvesting/contracts';
import { BarraExplorar, EXPLORAR, lerPopulares } from '../../../../components/arena/explorar';
import { ComBarra, NavegacaoDaArea } from '../../../../components/arena/pagina';
import { NewsList } from '../../../../components/news-list';
import {
  BUTTON,
  CAIXA_ERRO,
  Empty,
  LINK,
  NavLink,
  PageHead,
  SearchForm,
  Section,
} from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { versoesDosLogos } from '../../../../lib/logos';
import { cursorOf, first, orNotFound, type SearchParams } from '../../../../lib/page';
import { withApiDown } from '../../../../lib/with-api-down';

// As notícias (plano §3; no desenho do Rallies, ADR 0035: cada notícia como item de feed, com a barra "Explorar"
// ao lado): título, fonte, hora, tickers (com o logo de cada ação; docs/TELAS.md, 4a) e o link para o site de origem, da mais nova à mais
// antiga, com filtro por ticker. O filtro e a paginação são links e um formulário GET, então funcionam sem JavaScript. O trecho nunca é
// mostrado.
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
  const [page, populares, logos] = await Promise.all([
    invalid ? null : orNotFound(api.news({ ticker, cursor, limit: LIMIT })),
    lerPopulares(),
    versoesDosLogos(),
  ]);

  const older = page?.nextCursor
    ? `/noticias?${new URLSearchParams({ ...(ticker ? { ticker } : {}), cursor: page.nextCursor }).toString()}`
    : null;

  return (
    <ComBarra largura={300} barra={<BarraExplorar rows={populares} />}>
      <NavegacaoDaArea label="Telas do explorar" area={EXPLORAR} trilha="Notícias" telas={[]} />
      <PageHead title="Notícias">
        <p className="max-w-prose text-15 text-pretty">
          Título, fonte, hora de Brasília e o link para o site de origem. O texto da notícia é do
          site que a publicou: aqui não há trecho nem cópia.
        </p>
        <SearchForm
          action="/noticias"
          name="ticker"
          label="Ticker"
          placeholder="Filtrar por ticker…"
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
        {/* o aviso fica junto do campo, no tom do erro de formulário (form-kit.tsx) */}
        {invalid ? (
          <p id="aviso-ticker" role="alert" className={`max-w-md ${CAIXA_ERRO}`}>
            Ticker inválido: use quatro letras ou números e o número da classe, como PETR4.
          </p>
        ) : null}
      </PageHead>

      {page ? (
        <Section id="lista" title={ticker ? `Notícias de ${ticker}` : 'Todas as notícias'}>
          {page.rows.length > 0 ? (
            <>
              <NewsList rows={page.rows} logos={logos} />
              {older ? (
                // a paginação é ação de apoio: a pílula cinza (a Regra da Voz Única)
                <NavLink href={older} className={BUTTON}>
                  Mais antigas
                </NavLink>
              ) : null}
            </>
          ) : (
            <Empty>
              {ticker ? `Nenhuma notícia encontrada com ${ticker}.` : 'Nenhuma notícia ainda.'}
            </Empty>
          )}
        </Section>
      ) : null}
    </ComBarra>
  );
});
