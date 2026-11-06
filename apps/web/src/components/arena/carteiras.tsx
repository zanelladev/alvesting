import type { CompetitorDetail, LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { api } from '../../lib/api';
import { ratioBps } from '../../lib/chart';
import { formatBRL, formatBRLSigned, formatBps, formatDate } from '../../lib/format';
import { Tooltip } from '../arc/tooltip/tooltip';
import { Logo, NomeCurto, partesDoNome } from '../competidor';
import { LogoDoPapel } from '../logo-do-papel';
import { Empty, LINK, NavLink, NotaSimulada, direction } from '../ui';

// A barra "Carteiras" da arena e do ranking (plano do redesenho, e.2; o Portfolios do Rallies): a carteira de cada modelo no último pregão
// liquidado, numa tabela curta (a ação com o logo da empresa, a alocação com o anel, o resultado e o resultado %), e no pé o resultado da
// temporada e o caixa. O nome do modelo é o curto (o sufixo de versão vai para o leitor de tela e para o tooltip da Arc), e o "simulado" vai
// uma vez, na nota do título da barra (docs/DESIGN.md), que a página que já avisa tira (`avisoNaPagina`, a arena). Só
// os modelos: o Sorteio e as referências não têm composição pública (a lista de papéis do igual-peso seria o fechamento de todo papel, todo
// pregão; ADR 0033). Os números são registros da arena, nunca cotação: o valor e o resultado de cada posição e o patrimônio.

// A leitura: `/competitors/:slug` de cada modelo do ranking, em paralelo e pelo cache de dados do site (plano, e.8). A barra é secundária:
// uma leitura que falha não derruba a página (o ranking, o gráfico e o feed chegaram), e aquela carteira diz que está indisponível; a falha
// vai para o log do servidor.
// ponytail: seis leituras a mais por página depois de cada revalidação; se pesar na api, a saída é uma rota pública com as carteiras dos
// modelos (mudança aditiva, com o Cache-Control e a lista do Front Door).
export type CarteiraLida = CompetitorDetail | { competitor: PublicCompetitor; indisponivel: true };
export function lerCarteiras(
  rows: readonly LeaderboardRow[],
  season: string,
): Promise<CarteiraLida[]> {
  return Promise.all(
    rows
      .filter((row) => row.competitor.type === 'MODEL')
      .map((row) =>
        api.competitor(row.competitor.slug, season).catch((error: unknown) => {
          console.error(`[web] carteira sem ${row.competitor.slug}:`, error);
          return { competitor: row.competitor, indisponivel: true as const };
        }),
      ),
  );
}

// O anel da alocação (o do Rallies): decorativo, o número vai ao lado em texto. O arco é a fração do círculo (`pathLength` de 100), a partir
// do topo; as cores por classe, que seguem o tema.
function Anel({ bps }: { bps: number }) {
  const filled = Math.min(100, Math.max(0, bps / 100));
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 @max-[21rem]:hidden"
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill="none"
        strokeWidth="1.5"
        className="stroke-hairline-strong"
      />
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill="none"
        strokeWidth="1.5"
        pathLength={100}
        strokeDasharray={`${filled} 100`}
        transform="rotate(-90 7 7)"
        className="stroke-ink"
      />
    </svg>
  );
}

// O cabeçalho de coluna em versalete, como o do Rallies: o e2e lê o texto do DOM (em caixa normal), nunca o innerText. Ele fica numa linha: o
// "Resultado %" mostra só o "%" ao lado do "Resultado" (o resto do nome vai para o leitor de tela, que ouve "Resultado %"), como o "P&L" e o
// "P&L %" do Rallies (o QA do fechamento, achado 16: ele quebrava em dois andares). As colunas têm a mesma largura em toda carteira (o
// `colgroup`; a largura que o conteúdo pedir a mais ainda alarga a coluna, sem encavalar), e os números vão alinhados à esquerda, como o P&L
// do Rallies: o glifo ▲ ▼ ■ fica no mesmo lugar de uma linha para a outra e de uma carteira para a outra. A Regra do Glifo (docs/DESIGN.md):
// ele vai só no resultado em reais, o número principal da linha; o resultado % leva o sinal, na cor do texto. A tabela cabe nos 320 px da
// coluna do celular em 360 px, com o resultado do tamanho de "-R$ 1.330,30" (o QA do fechamento, achado 1): o respiro entre as colunas é de
// 2 px de cada lado até 640 px, e na carteira mais estreita que 336 px o anel da alocação (decorativo: o número está ao lado) sai.
const TH =
  'px-0.5 pb-2 text-left align-bottom text-11 font-medium tracking-[0.04em] whitespace-nowrap text-muted uppercase sm:px-1.5';
const TD = 'px-0.5 whitespace-nowrap tabular-nums sm:px-1.5';

function Carteira({
  detail,
  capitalCents,
  logos,
}: {
  detail: CarteiraLida;
  capitalCents: number;
  logos: ReadonlyMap<string, string> | undefined;
}) {
  const { competitor } = detail;
  const portfolio = 'indisponivel' in detail ? null : detail.portfolio;
  const holdings = portfolio?.holdings;
  const link = (
    <NavLink href={`/modelos/${competitor.slug}`} className={LINK}>
      <NomeCurto name={competitor.name} type={competitor.type} />
    </NavLink>
  );
  return (
    <div
      data-carteira={competitor.slug}
      className="@container border-b border-hairline py-5 last:border-b-0 xl:-mx-5 xl:px-6"
    >
      {/* o nome curto; com o sufixo de versão, o tooltip da Arc mostra o nome inteiro no hover e no foco do teclado */}
      <h3 className="text-15 font-semibold text-ink">
        <Logo competitor={competitor} className="mr-2" />
        {partesDoNome(competitor.name, competitor.type).resto ? (
          <Tooltip content={competitor.name}>{link}</Tooltip>
        ) : (
          link
        )}
      </h3>
      {'indisponivel' in detail ? (
        <p className="mt-2 muted">Carteira indisponível agora.</p>
      ) : !portfolio || !holdings ? (
        <p className="mt-2 muted">A carteira aparece depois da primeira liquidação.</p>
      ) : (
        <>
          {holdings.positions.length > 0 ? (
            <table className="mt-2 w-full border-collapse text-13 text-ink">
              <caption className="sr-only">
                Carteira de {competitor.name} em {formatDate(portfolio.date)}
              </caption>
              <colgroup>
                <col className="w-1/5" />
                <col className="w-1/5" />
                <col className="w-3/10" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Ação
                  </th>
                  <th scope="col" className={TH}>
                    Alocação
                  </th>
                  <th scope="col" className={TH}>
                    Resultado
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Resultado </span>%
                  </th>
                </tr>
              </thead>
              <tbody>
                {holdings.positions.map((position) => {
                  const allocation = ratioBps(position.valueCents, portfolio.equityCents);
                  const result = ratioBps(position.pnlCents, position.costCents);
                  return (
                    <tr key={position.ticker} className="linha-carteira">
                      <th scope="row" className={`${TD} text-left font-normal`}>
                        <NavLink
                          href={`/acoes/${position.ticker}`}
                          className={`${LINK} text-sm font-medium no-underline hover:underline`}
                        >
                          <LogoDoPapel
                            ticker={position.ticker}
                            versao={logos?.get(position.ticker)}
                            className="mr-2.5"
                          />
                          {position.ticker}
                        </NavLink>
                      </th>
                      <td className={TD}>
                        {allocation === null ? (
                          '—'
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <Anel bps={allocation} />
                            {formatBps(allocation, { signed: false })}
                          </span>
                        )}
                      </td>
                      <td data-dir={direction(position.pnlCents)} className={TD}>
                        {formatBRLSigned(position.pnlCents)}
                      </td>
                      <td className={TD}>{result === null ? '—' : formatBps(result)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 muted">Nenhuma posição: o patrimônio está todo em caixa.</p>
          )}
          {/* o pé do Rallies (o resultado e o caixa), em versalete: o e2e o lê pelo termo, no texto do DOM */}
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-11 font-medium tabular-nums">
            <div className="flex gap-2">
              <dt className="tracking-[0.04em] text-muted uppercase">Resultado</dt>
              <dd data-dir={direction(portfolio.equityCents - capitalCents)} className="text-ink">
                {formatBRLSigned(portfolio.equityCents - capitalCents)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="tracking-[0.04em] text-muted uppercase">Caixa</dt>
              <dd className="text-ink">{formatBRL(holdings.cashCents)}</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}

// As linhas do Rallies a partir de 1280 px, com a barra ao lado do conteúdo: o título é a linha de 45 px do topo (o fio embaixo na altura do
// da linha de abas do principal), e os fios entre as carteiras vão de uma borda da barra à outra (eles comem o respiro dela, -mx-5; o
// conteúdo de cada carteira fica a 24 px da borda, como o do Rallies). Abaixo disso a barra desce para depois do conteúdo, no respiro dele.
export function BarraCarteiras({
  carteiras,
  capitalCents,
  logos,
  avisoNaPagina = false,
}: {
  carteiras: readonly CarteiraLida[];
  capitalCents: number;
  // a versão do logo de cada ticker (lib/logos.ts, versoesDosLogos); sem ela, o monograma
  logos?: ReadonlyMap<string, string>;
  // a página já avisa que as decisões são simuladas (a arena): a nota do título sai
  avisoNaPagina?: boolean;
}) {
  return (
    <section id="carteiras" aria-labelledby="carteiras-titulo">
      {/* o título é a linha de 45 px do topo a partir de 1280 px; a nota "simulado" (uma vez por contexto) vem logo embaixo, numa linha */}
      <h2
        id="carteiras-titulo"
        className="border-b border-hairline pb-3 text-15 font-medium text-ink xl:-mx-5 xl:flex xl:h-[45px] xl:items-center xl:px-5 xl:pb-0"
      >
        Carteiras
      </h2>
      {avisoNaPagina ? null : (
        <NotaSimulada competitors={carteiras.map((detail) => detail.competitor)} className="pt-4" />
      )}
      {carteiras.length > 0 ? (
        carteiras.map((detail) => (
          <Carteira
            key={detail.competitor.slug}
            detail={detail}
            capitalCents={capitalCents}
            logos={logos}
          />
        ))
      ) : (
        <div className="pt-5">
          <Empty>As carteiras aparecem depois da primeira liquidação.</Empty>
        </div>
      )}
    </section>
  );
}
