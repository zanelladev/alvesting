import type { Metadata } from 'next';
import { stocksQuerySchema } from '@alvesting/contracts';
import { BarraExplorar, EXPLORAR, lerPopulares } from '../../../../components/arena/explorar';
import { ComBarra, NavegacaoDaArea } from '../../../../components/arena/pagina';
import { LogoDoPapel } from '../../../../components/logo-do-papel';
import {
  CAIXA_ERRO,
  Empty,
  LINK,
  NavLink,
  PageHead,
  ROW,
  SearchForm,
  Section,
} from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { versoesDosLogos } from '../../../../lib/logos';
import { first, orNotFound, type SearchParams } from '../../../../lib/page';
import { withApiDown } from '../../../../lib/with-api-down';

// A busca de ações (plano §3; no desenho do Rallies, docs/redesign-rallies/plano.md, f.1): por ticker ou por nome, até 20 resultados, um por
// linha numa lista com fio (o logo e o ticker na sans 500 com algarismos tabulares, e o nome em muted; a linha acende no hover), com a barra
// "Explorar" ao lado. Formulário GET: funciona sem JavaScript. O logo (components/logo-do-papel.tsx; docs/TELAS.md, "Logos das ações") vai
// dentro do link, à esquerda do ticker, a 14 px dele.
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
  const [found, populares, logos] = await Promise.all([
    parsed?.success ? orNotFound(api.searchStocks(parsed.data)) : null,
    lerPopulares(),
    versoesDosLogos(),
  ]);

  return (
    <ComBarra largura={300} barra={<BarraExplorar rows={populares} />}>
      <NavegacaoDaArea label="Telas do explorar" area={EXPLORAR} trilha="Ações" telas={[]} />
      <PageHead title="Ações">
        <p className="max-w-prose text-15 text-pretty">
          Busque uma ação do universo da arena pelo ticker ou pelo nome. A página da ação mostra as
          velas recentes, quem a tem, o que os modelos decidiram sobre ela e as notícias.
        </p>
        <SearchForm
          action="/acoes"
          name="q"
          label="Ticker ou nome"
          placeholder="Buscar ação…"
          button="Buscar"
          defaultValue={typed}
          maxLength={40}
          invalidId={parsed && !parsed.success ? 'aviso-busca' : undefined}
        />
        {/* o aviso fica junto do campo, no tom do erro de formulário (form-kit.tsx) */}
        {parsed && !parsed.success ? (
          <p id="aviso-busca" role="alert" className={`max-w-md ${CAIXA_ERRO}`}>
            Busca inválida: use até 40 caracteres, sem caracteres de controle.
          </p>
        ) : null}
      </PageHead>

      {found ? (
        <Section id="resultados" title="Resultados">
          {found.rows.length > 0 ? (
            <ul aria-label="Resultados da busca" className="max-w-2xl border-b border-hairline">
              {found.rows.map((stock) => (
                <li key={stock.ticker} className={`${ROW} flex flex-wrap items-center gap-x-4`}>
                  {/* min-w-24: o logo (16 px e os 14 até o ticker) e o ticker mais longo, para o nome começar no mesmo lugar */}
                  <NavLink
                    href={`/acoes/${stock.ticker}`}
                    className={`${LINK} min-w-24 text-sm font-medium no-underline hover:underline`}
                  >
                    <LogoDoPapel
                      ticker={stock.ticker}
                      versao={logos.get(stock.ticker)}
                      className="mr-3.5"
                    />
                    {stock.ticker}
                  </NavLink>
                  <span className="min-w-0 text-13 text-muted">{stock.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nenhuma ação encontrada para “{typed}”.</Empty>
          )}
        </Section>
      ) : null}
    </ComBarra>
  );
});
