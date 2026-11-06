import type { Metadata } from 'next';
import type { CompetitorDetail, CompetitorType } from '@alvesting/contracts';
import { slugSchema } from '@alvesting/contracts';
import { AREA_ARENA, NavegacaoDaArea, telasDaArena } from '../../../../../components/arena/pagina';
import { EquityChart } from '../../../../../components/charts';
import { Logo } from '../../../../../components/competidor';
import { DecisionCard } from '../../../../../components/decisions';
import { PositionsTable, direction } from '../../../../../components/tables';
import {
  Empty,
  Fact,
  Facts,
  PageHead,
  Section,
  SimulatedTag,
  Strip,
  StripItem,
  isSimulated,
} from '../../../../../components/ui';
import { api } from '../../../../../lib/api';
import { alignBand } from '../../../../../lib/chart';
import {
  formatBRL,
  formatBps,
  formatDate,
  formatPercentile,
  formatUsdMicro,
} from '../../../../../lib/format';
import { orNotFound } from '../../../../../lib/page';
import { withApiDown } from '../../../../../lib/with-api-down';

// A página de um competidor (plano §3; no desenho do Rallies, docs/redesign-rallies/plano.md, e.7): o cabeçalho com o logo do laboratório, o
// modelo com o provedor e o ID fixados na criação da temporada, o resultado, a carteira do último pregão liquidado, a série de patrimônio
// (uma linha, com o rótulo no fim e a faixa do Monte Carlo) e as decisões, em itens de feed. O Sorteio e as referências também têm página, mas não
// decidem nem mostram a composição da carteira (só o patrimônio: NO_HOLDINGS).
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

// o número com sinal leva o glifo da direção (▲ ▼ ■, por CSS); o que não existe ainda é "sem dado"
const Signed = ({ bps }: { bps: number | null }) =>
  bps === null ? 'sem dado' : <span data-dir={direction(bps)}>{formatBps(bps)}</span>;

// Os seis números que dizem como o competidor está vão na faixa dividida (a mesma da home), e o resto em pares termo/valor.
function Result({ stat }: { stat: NonNullable<CompetitorDetail['stat']> }) {
  return (
    <>
      <div className="overflow-hidden rounded-lg border border-hairline">
        <Strip columns={6}>
          <StripItem term="Posição">{stat.rank}</StripItem>
          <StripItem term="Patrimônio">{formatBRL(stat.equityCents)}</StripItem>
          <StripItem term="Retorno">
            <Signed bps={stat.returnBps} />
          </StripItem>
          <StripItem term="Percentil">
            {stat.percentileBps === null ? 'sem dado' : formatPercentile(stat.percentileBps)}
          </StripItem>
          <StripItem term="vs igual-peso">
            <Signed bps={stat.excessEqualWeightBps} />
          </StripItem>
          <StripItem term="vs CDI">
            <Signed bps={stat.excessCdiBps} />
          </StripItem>
        </Strip>
      </div>
      <Facts dense>
        <Fact term="Drawdown máximo">{formatBps(stat.maxDrawdownBps, { signed: false })}</Fact>
        <Fact term="Acerto">
          {stat.winRateBps === null
            ? 'sem venda'
            : `${formatBps(stat.winRateBps, { signed: false })} (${stat.winningSells}/${stat.sells})`}
        </Fact>
        <Fact term="Operações">{stat.trades}</Fact>
        <Fact term="Custo de LLM">{formatUsdMicro(stat.llmCostMicroUsd)}</Fact>
      </Facts>
    </>
  );
}

export default withApiDown(async function CompetitorPage({ params }: Props) {
  const { slug } = await params;
  const detail = await orNotFound(api.competitor(slug));
  const { competitor, stat, portfolio, series, decisions, season } = detail;
  // a faixa do Monte Carlo e o último ciclo (o segmentado da área) não dependem um do outro
  const [baseline, { lastCycle }] = await Promise.all([
    series.dates.length > 0 ? api.randomBaseline(season.slug) : null,
    api.arenaCurrent(),
  ]);
  // a arena simulada: o ID do provedor fake é a estratégia que decide no lugar do modelo (ui.tsx, SimulatedTag)
  const simulated = isSimulated(competitor);

  return (
    <>
      <NavegacaoDaArea
        label="Telas da arena"
        area={AREA_ARENA}
        trilha={competitor.name}
        telas={telasDaArena(null, lastCycle?.date ?? null)}
      />
      <PageHead
        title={
          <>
            {/* o logo é decorativo e não tem texto: o nome do h1 continua o do competidor */}
            <Logo competitor={competitor} className="mr-3 size-10" />
            {competitor.name}
            {simulated ? <SimulatedTag /> : null}
          </>
        }
      >
        <p className="muted">
          {KIND[competitor.type]} · {season.name}
        </p>
        {competitor.provider && competitor.modelId ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex min-w-0 gap-2">
              <dt className="text-muted">Provedor</dt>
              <dd className="font-mono text-ink">{competitor.provider}</dd>
            </div>
            <div className="flex min-w-0 gap-2">
              <dt className="text-muted">{simulated ? 'Estratégia simulada' : 'Modelo (ID)'}</dt>
              <dd className="min-w-0 font-mono text-ink">{competitor.modelId}</dd>
            </div>
          </dl>
        ) : null}
        {simulated ? (
          <p className="flex max-w-[560px] gap-2 text-xs text-muted">
            <span aria-hidden="true" className="font-mono">
              [!]
            </span>
            <span>
              <strong>Decisões simuladas: o modelo ainda não está conectado.</strong> Quem decide
              por ele é a estratégia acima, do provedor fake; o resultado não diz nada sobre o
              modelo de verdade.
            </span>
          </p>
        ) : null}
      </PageHead>

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
              <Fact term="Patrimônio" wide>
                {formatBRL(portfolio.equityCents)}
              </Fact>
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
            series={[
              {
                slug: competitor.slug,
                name: competitor.name,
                cents: series.equityCents,
                simulated,
                competitor,
              },
            ]}
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
          <div className="max-w-2xl">
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
