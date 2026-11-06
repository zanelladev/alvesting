import type { CompetitorDetail, LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { api } from '../../lib/api';
import { formatBRL, formatBRLSigned, formatBps, formatDate } from '../../lib/format';
import { Competidor } from '../competidor';
import { Empty, LINK, NavLink, direction } from '../ui';

// A barra "Carteiras" da arena e do ranking (plano do redesenho, e.2; o Portfolios do Rallies): a carteira de cada modelo no último pregão
// liquidado, numa tabela curta (a ação, a alocação com o anel, o resultado e o resultado %), e no pé o resultado da temporada e o caixa. Só
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

// A parte sobre o todo, em pontos-base inteiros, com o meio para longe do zero (docs/METODOLOGIA.md). Em BigInt: o produto por 10.000 passaria
// do inteiro seguro com valores grandes. O todo que não é positivo não tem razão (nulo: a tela mostra o traço).
export function ratioBps(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  const abs = BigInt(Math.abs(part)) * 10_000n;
  const rounded = (2n * abs + BigInt(whole)) / (2n * BigInt(whole));
  return Number(part < 0 ? -rounded : rounded);
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
      className="shrink-0"
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

// O cabeçalho de coluna em versalete, como o do Rallies: o e2e lê o texto do DOM (em caixa normal), nunca o innerText. Ele pode quebrar
// ("Resultado %" em duas linhas): em 360 px as quatro colunas só cabem assim. As colunas têm a mesma largura em toda carteira (o `colgroup`;
// a largura que o conteúdo pedir a mais ainda alarga a coluna, sem encavalar), e os números vão alinhados à esquerda, como o P&L do Rallies:
// o glifo ▲ ▼ ■ fica no mesmo lugar de uma linha para a outra e de uma carteira para a outra.
const TH =
  'px-1 pb-2 text-left align-bottom text-11 font-medium tracking-[0.04em] text-muted uppercase sm:px-1.5';
const TD = 'px-1 whitespace-nowrap tabular-nums sm:px-1.5';

function Carteira({ detail, capitalCents }: { detail: CarteiraLida; capitalCents: number }) {
  const { competitor } = detail;
  const portfolio = 'indisponivel' in detail ? null : detail.portfolio;
  const holdings = portfolio?.holdings;
  return (
    <div data-carteira={competitor.slug} className="border-b border-hairline py-5 last:border-b-0">
      <h3 className="text-15 font-semibold text-ink">
        <Competidor competitor={competitor} />
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
                    Resultado %
                  </th>
                </tr>
              </thead>
              <tbody>
                {holdings.positions.map((position) => {
                  const allocation = ratioBps(position.valueCents, portfolio.equityCents);
                  const result = ratioBps(position.pnlCents, position.costCents);
                  return (
                    <tr key={position.ticker}>
                      <th scope="row" className={`${TD} text-left font-normal`}>
                        <NavLink
                          href={`/acoes/${position.ticker}`}
                          className={`${LINK} font-mono text-sm font-semibold no-underline hover:underline`}
                        >
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
                      {result === null ? (
                        <td className={TD}>—</td>
                      ) : (
                        <td data-dir={direction(result)} className={TD}>
                          {formatBps(result)}
                        </td>
                      )}
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

export function BarraCarteiras({
  carteiras,
  capitalCents,
}: {
  carteiras: readonly CarteiraLida[];
  capitalCents: number;
}) {
  return (
    <section id="carteiras" aria-labelledby="carteiras-titulo">
      <h2
        id="carteiras-titulo"
        className="border-b border-hairline pb-3 text-15 font-medium text-ink"
      >
        Carteiras
      </h2>
      {carteiras.length > 0 ? (
        carteiras.map((detail) => (
          <Carteira key={detail.competitor.slug} detail={detail} capitalCents={capitalCents} />
        ))
      ) : (
        <div className="pt-5">
          <Empty>As carteiras aparecem depois da primeira liquidação.</Empty>
        </div>
      )}
    </section>
  );
}
