import type { Metadata } from 'next';
import type { CompetitorDetail, CompetitorType } from '@alvesting/contracts';
import { slugSchema } from '@alvesting/contracts';
import { EquityChart } from '../../../components/charts';
import { DecisionCard } from '../../../components/decisions';
import { PositionsTable } from '../../../components/tables';
import { Empty, Fact, Facts, Section } from '../../../components/ui';
import { api } from '../../../lib/api';
import { alignBand } from '../../../lib/chart';
import {
  formatBRL,
  formatBps,
  formatDate,
  formatPercentile,
  formatUsdMicro,
} from '../../../lib/format';
import { orNotFound } from '../../../lib/page';
import { withApiDown } from '../../../lib/with-api-down';

// A página de um competidor (plano §3): o modelo com o provedor e o ID fixados na criação da temporada, o resultado, a carteira do
// último pregão liquidado, a série de patrimônio e as decisões. O Sorteio e as referências também têm página, mas não decidem nem mostram a
// composição da carteira (só o patrimônio: NO_HOLDINGS).
export const dynamic = 'force-dynamic';

const KIND: Record<CompetitorType, string> = {
  MODEL: 'Modelo de linguagem',
  RANDOM: 'Controle aleatório',
  EQUAL_WEIGHT: 'Referência',
  CDI: 'Referência',
  BOVA11: 'Referência',
};
const DOES_NOT_DECIDE: Record<Exclude<CompetitorType, 'MODEL'>, string> = {
  RANDOM:
    'O Sorteio não decide: é o controle, que sorteia de 0 a 5 ordens por pregão com as mesmas regras e custos dos modelos.',
  EQUAL_WEIGHT:
    'Esta referência não decide: compra todas as ações do universo com pesos iguais no primeiro pregão e segura (só preço).',
  CDI: 'Esta referência não decide: deixa o caixa rendendo o CDI.',
  BOVA11:
    'Esta referência não decide: compra o BOVA11 no primeiro pregão e segura. É só contexto, porque inclui proventos que os modelos não recebem.',
};
const NO_RESULT =
  'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.';
// O Sorteio e as referências não trazem a composição da carteira (a api manda `holdings` nulo): o igual-peso tem o universo inteiro, e a lista
// de papéis dele seria o fechamento de todo papel, todo pregão (docs/API.md, seção 6; ADR 0033).
const NO_HOLDINGS =
  'O Sorteio e as referências mostram só o patrimônio: a lista de papéis deles repetiria as cotações da brapi.dev, e a licença não deixa redistribuí-las.';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  // o slug que não tem a forma de um slug nem chega à api (a página dá 404); a falha da api também não derruba o título
  if (!slugSchema.safeParse(slug).success) return { title: 'Modelo' };
  try {
    return { title: (await api.competitor(slug)).competitor.name };
  } catch {
    return { title: 'Modelo' };
  }
}

function Result({ stat }: { stat: NonNullable<CompetitorDetail['stat']> }) {
  return (
    <Facts dense>
      <Fact term="Posição">{stat.rank}</Fact>
      <Fact term="Patrimônio">{formatBRL(stat.equityCents)}</Fact>
      <Fact term="Retorno">{formatBps(stat.returnBps)}</Fact>
      <Fact term="Percentil">
        {stat.percentileBps === null ? 'sem dado' : formatPercentile(stat.percentileBps)}
      </Fact>
      <Fact term="vs igual-peso">
        {stat.excessEqualWeightBps === null ? 'sem dado' : formatBps(stat.excessEqualWeightBps)}
      </Fact>
      <Fact term="vs CDI">
        {stat.excessCdiBps === null ? 'sem dado' : formatBps(stat.excessCdiBps)}
      </Fact>
      <Fact term="Drawdown máximo">{formatBps(stat.maxDrawdownBps, { signed: false })}</Fact>
      <Fact term="Acerto">
        {stat.winRateBps === null
          ? 'sem venda'
          : `${formatBps(stat.winRateBps, { signed: false })} (${stat.winningSells}/${stat.sells})`}
      </Fact>
      <Fact term="Operações">{stat.trades}</Fact>
      <Fact term="Custo de LLM">{formatUsdMicro(stat.llmCostMicroUsd)}</Fact>
    </Facts>
  );
}

export default withApiDown(async function CompetitorPage({ params }: Props) {
  const { slug } = await params;
  const detail = await orNotFound(api.competitor(slug));
  const { competitor, stat, portfolio, series, decisions, season } = detail;
  const baseline = series.dates.length > 0 ? await api.randomBaseline(season.slug) : null;

  return (
    <>
      <header className="space-y-2">
        <h1 className="font-mono text-2xl font-semibold sm:text-3xl">{competitor.name}</h1>
        <p className="text-muted">
          {KIND[competitor.type]} · {season.name}
        </p>
        {competitor.provider && competitor.modelId ? (
          <Facts>
            <Fact term="Provedor">{competitor.provider}</Fact>
            <Fact term="Modelo (ID)">{competitor.modelId}</Fact>
          </Facts>
        ) : null}
      </header>

      <Section id="resultado" title="Resultado">
        {stat ? <Result stat={stat} /> : <Empty>{NO_RESULT}</Empty>}
      </Section>

      <Section
        id="carteira"
        title={portfolio ? `Carteira em ${formatDate(portfolio.date)}` : 'Carteira'}
      >
        {portfolio ? (
          <>
            <Facts dense>
              {portfolio.holdings ? (
                <>
                  <Fact term="Caixa">{formatBRL(portfolio.holdings.cashCents)}</Fact>
                  <Fact term="Em ações">{formatBRL(portfolio.holdings.positionsValueCents)}</Fact>
                </>
              ) : null}
              <Fact term="Patrimônio">{formatBRL(portfolio.equityCents)}</Fact>
            </Facts>
            {portfolio.holdings === null ? (
              <Empty>{NO_HOLDINGS}</Empty>
            ) : portfolio.holdings.positions.length > 0 ? (
              <PositionsTable
                first="Ação"
                label="Posições da carteira"
                rows={portfolio.holdings.positions.map((p) => ({
                  key: p.ticker,
                  label: p.ticker,
                  href: `/acoes/${p.ticker}`,
                  quantity: p.quantity,
                  avgPriceCents: p.avgPriceCents,
                  valueCents: p.valueCents,
                  pnlCents: p.pnlCents,
                  stale: p.stale,
                }))}
              />
            ) : (
              <Empty>Nenhuma posição: o patrimônio está todo em caixa.</Empty>
            )}
          </>
        ) : (
          <Empty>A carteira aparece depois da primeira liquidação.</Empty>
        )}
      </Section>

      <Section id="patrimonio" title="Patrimônio">
        {series.dates.length > 0 ? (
          <EquityChart
            id="modelo-patrimonio"
            dates={series.dates}
            series={[{ slug: competitor.slug, name: competitor.name, cents: series.equityCents }]}
            band={baseline ? alignBand(series.dates, baseline.rows) : null}
          />
        ) : (
          <Empty>{NO_RESULT}</Empty>
        )}
      </Section>

      <Section id="decisoes" title="Decisões">
        {competitor.type !== 'MODEL' ? (
          <Empty>{DOES_NOT_DECIDE[competitor.type]}</Empty>
        ) : decisions.length > 0 ? (
          <div className="space-y-3">
            {decisions.map((decision) => (
              <DecisionCard
                key={decision.date}
                decision={decision}
                date={decision.date}
                by="date"
              />
            ))}
          </div>
        ) : (
          <Empty>Nenhuma decisão ainda.</Empty>
        )}
      </Section>
    </>
  );
});
