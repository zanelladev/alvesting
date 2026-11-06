import type { Metadata } from 'next';
import { tickerParamSchema } from '@alvesting/contracts';
import { BarraExplorar, EXPLORAR, lerPopulares } from '../../../../../components/arena/explorar';
import { ComBarra, NavegacaoDaArea } from '../../../../../components/arena/pagina';
import { CandlesChart } from '../../../../../components/charts';
import { Competidor } from '../../../../../components/competidor';
import { ActionBadge } from '../../../../../components/decisions';
import { NewsList } from '../../../../../components/news-list';
import { PositionsTable } from '../../../../../components/tables';
import {
  BUTTON,
  Empty,
  LINK,
  NavLink,
  PageHead,
  Section,
  SearchForm,
  isSimulated,
} from '../../../../../components/ui';
import { api } from '../../../../../lib/api';
import { formatConfidence, formatDate, formatPercentValue } from '../../../../../lib/format';
import { orNotFound } from '../../../../../lib/page';
import { readBars } from '../../../../../lib/quotes';
import { withApiDown } from '../../../../../lib/with-api-down';

// A página de uma ação (plano §3; no desenho do Rallies, docs/redesign-rallies/plano.md, f.1, com a barra "Explorar" ao lado): as barras
// recentes em SVG, quem tem a ação no último pregão liquidado, o
// que os modelos decidiram sobre ela e as notícias. As barras não vêm da API pública (ela não entrega cotação bruta; a licença da brapi
// proíbe): saem da rota interna, com o segredo do servidor (src/lib/quotes.ts; docs/API.md, seção 6; ADR 0033), pelo mesmo cache de dados,
// DEPOIS da leitura da ação. Em sequência de propósito: o ticker bem formado que não existe responde 404 na leitura da ação, e a rota interna
// devolve 200 com lista vazia para ele, que o cache de dados do Next gravaria em disco (sem expurgo) a cada ticker inventado por quem visita.
// A ação vem do cache (a leitura é a mesma das outras telas), então a espera é de microssegundos.
// Mostram-se como desenho e resumo em texto, sem tabela de preços. O ticker da URL aceita minúsculas.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = tickerParamSchema.safeParse((await params).ticker);
  return { title: parsed.success ? parsed.data : 'Ação' };
}

export default withApiDown(async function StockPage({ params }: Props) {
  const { ticker: requested } = await params;
  // O 404 da ação que não existe (e o do ticker torto) vem da primeira leitura, sem tocar a rota interna nem o cache de dados; o segredo
  // recusado é 502 na segunda, que a página mostra como "a arena não respondeu".
  // A barra (o ranking) não depende da ação e sai junto com ela; as barras do papel, só depois (acima).
  const [stock, populares] = await Promise.all([orNotFound(api.stock(requested)), lerPopulares()]);
  const { ticker } = stock;
  const bars = await readBars(ticker);
  const lastBar = bars.at(-1);

  return (
    <ComBarra largura={300} barra={<BarraExplorar rows={populares} />}>
      <NavegacaoDaArea label="Telas do explorar" area={EXPLORAR} trilha={ticker} telas={[]} />
      <PageHead title={ticker}>
        <p className="max-w-prose text-15 text-pretty">{stock.name}</p>
        <SearchForm
          action="/acoes"
          name="q"
          label="Buscar outra ação"
          placeholder="Buscar outra ação…"
          button="Buscar"
          maxLength={40}
        />
      </PageHead>

      <Section id="cotacoes" title="Cotações recentes">
        {bars.length > 0 ? (
          <div className="card space-y-4">
            <CandlesChart ticker={ticker} bars={bars} />
            <p className="muted">Cotações: brapi.dev, pregão de {formatDate(lastBar!.date)}.</p>
          </div>
        ) : (
          <Empty>Sem cotações no banco para esta ação.</Empty>
        )}
      </Section>

      <Section id="donos" title="Quem tem a ação">
        {stock.holders.length > 0 ? (
          <PositionsTable
            first="Competidor"
            label={`Quem tem ${ticker}`}
            rows={stock.holders.map((holder) => ({
              key: holder.competitor.slug,
              label: holder.competitor.name,
              href: `/modelos/${holder.competitor.slug}`,
              quantity: holder.quantity,
              avgPriceCents: holder.avgPriceCents,
              valueCents: holder.valueCents,
              pnlCents: holder.pnlCents,
              stale: holder.stale,
              simulated: isSimulated(holder.competitor),
              competitor: holder.competitor,
            }))}
          />
        ) : (
          <Empty>Nenhum modelo tem esta ação no último pregão liquidado.</Empty>
        )}
      </Section>

      {/* Cada decisão sobre a ação num item de feed, como os da arena: o pregão (o link para o ciclo), o modelo com o logo, a ordem (BUY, SELL
          ou HOLD), o percentual e a confiança, e a justificativa do modelo, que é texto de terceiro e pode ter uma palavra sem espaço
          (min-w-0, para quebrar). A data vem antes do modelo no DOM e na tela. */}
      <Section id="decisoes" title="Decisões dos modelos">
        {stock.decisions.length > 0 ? (
          <ul className="max-w-2xl">
            {stock.decisions.map((decision) => (
              <li
                key={`${decision.date}/${decision.competitor.slug}`}
                className="min-w-0 space-y-1 border-t border-hairline py-5 first:border-t-0 first:pt-0"
              >
                <p>
                  <NavLink
                    href={`/ciclos/${decision.date}`}
                    className={`${LINK} text-xs text-muted no-underline hover:text-ink hover:underline`}
                  >
                    {formatDate(decision.date)}
                  </NavLink>
                </p>
                <p className="text-15 font-semibold text-ink">
                  <Competidor competitor={decision.competitor} />
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
                    <span className="muted">confiança {formatConfidence(decision.confidence)}</span>
                  )}
                </p>
                <p className="min-w-0 text-sm leading-relaxed">{decision.rationale}</p>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nenhum modelo decidiu sobre esta ação.</Empty>
        )}
      </Section>

      <Section id="noticias" title="Notícias">
        {stock.news.length > 0 ? (
          <NewsList rows={stock.news} />
        ) : (
          <Empty>Nenhuma notícia recente com {ticker}.</Empty>
        )}
        <NavLink href={`/noticias?ticker=${ticker}`} className={BUTTON}>
          Todas as notícias de {ticker}
        </NavLink>
      </Section>
    </ComBarra>
  );
});
