import type { Metadata } from 'next';
import { tickerParamSchema } from '@alvesting/contracts';
import { BarraExplorar, EXPLORAR, lerPopulares } from '../../../../../components/arena/explorar';
import { AvisoSimulado, ComBarra, NavegacaoDaArea } from '../../../../../components/arena/pagina';
import { Competidor } from '../../../../../components/competidor';
import { ActionBadge } from '../../../../../components/decisions';
import { LogoDoPapel } from '../../../../../components/logo-do-papel';
import { NewsList } from '../../../../../components/news-list';
import { BUTTON, Empty, LINK, NavLink, SearchForm, direction } from '../../../../../components/ui';
import { UltimoFechamento, Velas } from '../../../../../components/velas';
import { api } from '../../../../../lib/api';
import {
  formatBRL,
  formatBRLSigned,
  formatConfidence,
  formatDate,
  formatPercentValue,
  formatQuantity,
} from '../../../../../lib/format';
import { versoesDosLogos } from '../../../../../lib/logos';
import { orNotFound } from '../../../../../lib/page';
import { readBars } from '../../../../../lib/quotes';
import { withApiDown } from '../../../../../lib/with-api-down';

// A página de uma ação, montada como um terminal com peças grátis (ADR 0037: o market terminal da Arc é Pro e não foi lido nem refeito): o
// cabeçalho com o logo, o ticker, o nome, o último fechamento e a variação (a Regra do Glifo), a data do dado e o crédito; as velas no visual
// do Candlestick Chart da beUI (components/velas.tsx), num painel que fica preso no topo enquanto a coluna do lado rola; e, ao lado no
// desktop (abaixo no celular), quem tem a ação entre os modelos, o que eles decidiram sobre ela e as notícias dela. A barra "Explorar" fica
// ao lado (docs/redesign-rallies/plano.md, f.1). As colunas dependem do lugar que o principal tem (uma consulta de contêiner, e não da
// janela: a partir de 1280 px a barra come 300 px dele).
//
// As barras não vêm da API pública (ela não entrega cotação bruta; a licença da brapi proíbe): saem da rota interna, com o segredo do servidor
// (src/lib/quotes.ts; docs/API.md, seção 6; ADR 0033), pelo mesmo cache de dados, DEPOIS da leitura da ação. Em sequência de propósito: o
// ticker bem formado que não existe responde 404 na leitura da ação, e a rota interna devolve 200 com lista vazia para ele, que o cache de
// dados do Next gravaria em disco (sem expurgo) a cada ticker inventado por quem visita. A ação vem do cache (a leitura é a mesma das outras
// telas), então a espera é de microssegundos. A série nunca vai para o navegador como dado: as velas são desenho do servidor, com o resumo em
// texto, sem tabela de preços (e2e/quotes.spec.ts confere o HTML e o payload do React). O ticker da URL aceita minúsculas.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ ticker: string }> };

// o que a confiança é (o contrato da decisão: de 0 a 1, opcional; a liquidação não a usa), em texto, uma vez, no começo das decisões: no
// celular o tooltip não abre pelo toque (a revisão do fechamento, M9)
const CONFIANCA =
  'A confiança vai de 0 a 1 e é a que o próprio modelo declara na resposta. Ela não muda o tamanho da ordem.';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = tickerParamSchema.safeParse((await params).ticker);
  return { title: parsed.success ? parsed.data : 'Ação' };
}

export default withApiDown(async function StockPage({ params }: Props) {
  const { ticker: requested } = await params;
  // O 404 da ação que não existe (e o do ticker torto) vem da primeira leitura, sem tocar a rota interna nem o cache de dados; o segredo
  // recusado é 502 na segunda, que a página mostra como "a arena não respondeu".
  // A barra (o ranking) e o índice dos logos (sem parâmetro da URL) não dependem da ação e saem junto com ela; as barras do papel, só depois
  // (acima).
  const [stock, populares, logos] = await Promise.all([
    orNotFound(api.stock(requested)),
    lerPopulares(),
    versoesDosLogos(),
  ]);
  const { ticker } = stock;
  const bars = await readBars(ticker);
  // a confiança é explicada uma vez, no texto da seção, quando alguma decisão a tem
  const comConfianca = stock.decisions.some((decision) => decision.confidence !== null);

  return (
    <ComBarra largura={300} barra={<BarraExplorar rows={populares} />}>
      <NavegacaoDaArea label="Telas do explorar" area={EXPLORAR} trilha={ticker} telas={[]} />
      <header className="space-y-5 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0 space-y-1">
            <h1 className="font-display text-26 text-ink">
              {/* o logo é decorativo e não tem texto: o nome do h1 continua o ticker (docs/TELAS.md, "Logos das ações") */}
              <LogoDoPapel
                ticker={ticker}
                versao={logos.get(ticker)}
                tamanho="cabecalho"
                className="mr-3"
              />
              {ticker}
            </h1>
            <p className="max-w-prose text-15 text-pretty text-muted">{stock.name}</p>
          </div>
          <UltimoFechamento bars={bars} />
        </div>
        <SearchForm
          action="/acoes"
          name="q"
          label="Buscar outra ação"
          placeholder="Buscar outra ação…"
          button="Buscar"
          maxLength={40}
        />
      </header>
      {/* o "simulado" uma vez na página: quem tem a ação e quem decidiu são modelos, e nenhum nome leva a etiqueta (cada modelo uma vez:
          numa temporada mista o aviso diz o nome dos simulados) */}
      <AvisoSimulado
        competitors={[
          ...new Map(
            [...stock.holders, ...stock.decisions].map(({ competitor }) => [
              competitor.slug,
              competitor,
            ]),
          ).values(),
        ]}
      />

      <div className="@container mt-8">
        <div className="grid gap-x-8 gap-y-12 @[52rem]:grid-cols-[minmax(0,1fr)_22rem]">
          {/* o painel das velas: preso no topo quando há duas colunas (a coluna do lado é a que rola) */}
          <section
            id="cotacoes"
            aria-labelledby="cotacoes-titulo"
            className="card min-w-0 p-4 sm:p-5 @[52rem]:sticky @[52rem]:top-6 @[52rem]:self-start"
          >
            <h2 id="cotacoes-titulo" className="painel-titulo">
              Cotações recentes
            </h2>
            {bars.length > 0 ? (
              <Velas ticker={ticker} bars={bars} />
            ) : (
              <Empty>Sem cotações no banco para esta ação.</Empty>
            )}
          </section>

          <div className="min-w-0 space-y-12">
            {/* Quem tem a ação, só os modelos (o igual-peso tem o universo inteiro, e a marcação dele seria o fechamento de todo papel; ADR
                0033): o nome curto com o logo do laboratório, e o valor, o resultado (o glifo só nele), a quantidade e o preço médio pago,
                registros da arena (docs/API.md, seção 6). Uma linha por modelo, que acende no hover. */}
            <section id="donos" aria-labelledby="donos-titulo">
              <h2 id="donos-titulo" className="painel-titulo">
                Quem tem a ação
              </h2>
              {stock.holders.length > 0 ? (
                <ul aria-label={`Quem tem ${ticker}`}>
                  {stock.holders.map((holder) => (
                    <li key={holder.competitor.slug} className="linha-dono">
                      <p className="relative text-13 font-medium text-ink">
                        <Competidor competitor={holder.competitor} etiqueta={false} curto />
                      </p>
                      <dl>
                        <div>
                          <dt>Valor</dt>
                          <dd>
                            {formatBRL(holder.valueCents)}
                            {holder.stale ? (
                              <span className="block text-xs text-muted">sem negócio no dia</span>
                            ) : null}
                          </dd>
                        </div>
                        <div>
                          <dt>Resultado</dt>
                          <dd data-dir={direction(holder.pnlCents)}>
                            {formatBRLSigned(holder.pnlCents)}
                          </dd>
                        </div>
                        <div>
                          <dt>Quantidade</dt>
                          <dd>{formatQuantity(holder.quantity)}</dd>
                        </div>
                        <div>
                          <dt>Preço médio</dt>
                          <dd>{formatBRL(holder.avgPriceCents)}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Nenhum modelo tem esta ação no último pregão liquidado.</Empty>
              )}
            </section>

            {/* Cada decisão sobre a ação num item de feed: o pregão (o link para o ciclo), o modelo com o logo, a ordem (BUY, SELL ou HOLD),
                o percentual e a confiança (explicada uma vez, no texto antes da lista), e a justificativa do modelo, que é texto de terceiro e pode
                ter uma palavra sem espaço (min-w-0, para quebrar). A data vem antes do modelo no DOM e na tela. */}
            <section id="decisoes" aria-labelledby="decisoes-titulo">
              <h2 id="decisoes-titulo" className="painel-titulo">
                Decisões dos modelos
              </h2>
              {comConfianca ? <p className="muted pb-3 text-pretty">{CONFIANCA}</p> : null}
              {stock.decisions.length > 0 ? (
                <ul>
                  {stock.decisions.map((decision) => (
                    <li
                      key={`${decision.date}/${decision.competitor.slug}`}
                      className="min-w-0 space-y-1 border-t border-hairline py-4 first:border-t-0 first:pt-0"
                    >
                      <p>
                        <NavLink
                          href={`/ciclos/${decision.date}`}
                          className={`${LINK} text-xs text-muted no-underline hover:text-ink hover:underline`}
                        >
                          {formatDate(decision.date)}
                        </NavLink>
                      </p>
                      <p className="relative text-13 font-medium text-ink">
                        <Competidor competitor={decision.competitor} etiqueta={false} curto />
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2">
                        <ActionBadge action={decision.action} />
                        {decision.percent === null || decision.action === 'HOLD' ? null : (
                          <span className="text-sm text-ink tabular-nums">
                            {formatPercentValue(decision.percent)}{' '}
                            {decision.action === 'BUY' ? 'do patrimônio' : 'da posição'}
                          </span>
                        )}
                        {decision.confidence === null ? null : (
                          <span className="muted">
                            confiança {formatConfidence(decision.confidence)}
                          </span>
                        )}
                      </p>
                      <p className="min-w-0 text-13 leading-relaxed text-pretty text-body">
                        {decision.rationale}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Nenhum modelo decidiu sobre esta ação.</Empty>
              )}
            </section>

            <section id="noticias" aria-labelledby="noticias-titulo" className="space-y-4">
              <h2 id="noticias-titulo" className="painel-titulo">
                Notícias
              </h2>
              {stock.news.length > 0 ? (
                <NewsList rows={stock.news} logos={logos} />
              ) : (
                <Empty>Nenhuma notícia recente com {ticker}.</Empty>
              )}
              <NavLink href={`/noticias?ticker=${ticker}`} className={BUTTON}>
                Todas as notícias de {ticker}
              </NavLink>
            </section>
          </div>
        </div>
      </div>
    </ComBarra>
  );
});
