import type { ReactNode } from 'react';
import type { ArenaCurrent, InternalBar } from '@alvesting/contracts';
import { Countdown } from '../components/countdown';
import { EquityChart } from '../components/charts';
import { DecisionCard } from '../components/decisions';
import { Hero, heroPill } from '../components/hero';
import { LeaderboardTable, direction } from '../components/tables';
import {
  AsciiChart,
  BUTTON,
  Empty,
  Fact,
  Facts,
  NavLink,
  Rule,
  Section,
  Strip,
  StripItem,
  isSimulated,
} from '../components/ui';
import { api } from '../lib/api';
import { areaChart } from '../lib/ascii';
import { alignBand } from '../lib/chart';
import { heroTape } from '../lib/fita';
import {
  countdownText,
  formatBRL,
  formatBps,
  formatDate,
  formatDecimalString,
  formatTime,
  formatWeekdayDate,
  variationBps,
} from '../lib/format';
import { actionOf, cursorOf, first, orNotFound, type SearchParams } from '../lib/page';
import { REFERENCE_TICKER, readBars, readTape } from '../lib/quotes';
import { withApiDown } from '../lib/with-api-down';

// A home (plano §3; o desenho é o da v1, ADR 0034): o hero com a escadaria, a faixa de cotações e macro com a data de cada valor, e na
// coluna o ranking com o Sorteio e o percentil, os ciclos (o último, com a contagem de BUY, SELL e HOLD, e o próximo), o gráfico do
// patrimônio, o feed de decisões com o filtro por BUY, SELL e HOLD e a temporada. O ranking vem antes, como na v1: quem está ganhando não
// fica na quarta dobra (o e2e acha as regiões pelo nome, não pela ordem).
// A página lê a api pelo cache de dados do site (src/lib/api.ts) e é dinâmica: o `next build` da imagem não tem api para chamar. O BOVA11
// da faixa de cotações não vem da API pública (ela não entrega cotação bruta): sai da rota interna, com o segredo do servidor
// (src/lib/quotes.ts; docs/API.md, seção 6), lida em paralelo com as outras e pelo mesmo cache de dados; a fita do hero também, da rota
// interna do universo da semana.
export const dynamic = 'force-dynamic';

const FEED_LIMIT = 5;
const NO_RESULT =
  'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.';
const NO_DATA = 'sem dado';
const CYCLE_STATUS = { OPEN: 'aberto', CLOSED: 'fechado', SKIPPED: 'pulado' } as const;
const FILTERS = [
  ['Todas', undefined],
  ['BUY', 'BUY'],
  ['SELL', 'SELL'],
  ['HOLD', 'HOLD'],
] as const;

// O feed é uma lista por cursor com filtro, tudo na URL (?filtro=BUY&cursor=...), então cada página dele é um link e funciona sem
// JavaScript. O `#feed` leva o leitor de volta à lista depois de clicar.
function feedHref(action: string | undefined, cursor?: string | null): string {
  const query = new URLSearchParams();
  if (action) query.set('filtro', action);
  if (cursor) query.set('cursor', cursor);
  const text = query.toString();
  return `/${text ? `?${text}` : ''}#feed`;
}

const Dated = ({ date, children }: { date: string; children: ReactNode }) => (
  <>
    {children}
    <span className="block font-sans text-xs font-normal text-muted">{date}</span>
  </>
);

// O BOVA11: o último fechamento e o anterior, tirados das duas barras mais recentes (a rota interna as dá da mais antiga à mais nova)
type Bova11 = { date: string; closeCents: number; previousCloseCents: number | null };
const bova11Of = (bars: readonly InternalBar[]): Bova11 | null => {
  const latest = bars.at(-1);
  if (!latest) return null;
  return {
    date: latest.date,
    closeCents: latest.closeCents,
    previousCloseCents: bars.at(-2)?.closeCents ?? null,
  };
};

function Quotes({
  macro,
  bova11,
  closes,
}: {
  macro: ArenaCurrent['macro'];
  bova11: Bova11 | null;
  closes: readonly number[];
}) {
  // a variação sobre o pregão anterior, com o glifo ▲ ▼ ■ do CSS (`[data-dir]`, como nas tabelas: fora do texto)
  const change =
    bova11 && bova11.previousCloseCents !== null && bova11.previousCloseCents > 0
      ? variationBps(bova11.closeCents, bova11.previousCloseCents)
      : null;
  const point = (value: ArenaCurrent['macro']['cdi'], unit: string) =>
    value ? (
      <Dated date={formatDate(value.date)}>
        {formatDecimalString(value.value)}
        {unit}
      </Dated>
    ) : (
      NO_DATA
    );
  return (
    <Strip columns={6}>
      <StripItem term="BOVA11">
        {bova11 ? (
          <>
            <Dated date={`brapi.dev, fechamento de ${formatDate(bova11.date)}`}>
              {formatBRL(bova11.closeCents)}
              {change === null ? null : (
                <>
                  {' ('}
                  <span data-dir={direction(change)}>{formatBps(change)}</span>)
                </>
              )}
            </Dated>
            {/* a curva dos últimos fechamentos (as barras que a home já lê), em blocos; o número está ao lado, em texto */}
            <span className="mt-3 block">
              <AsciiChart chart={areaChart(closes)} />
            </span>
          </>
        ) : (
          NO_DATA
        )}
      </StripItem>
      <StripItem term="CDI">{point(macro.cdi, '% ao dia')}</StripItem>
      <StripItem term="Selic (meta)">{point(macro.selic, '% ao ano')}</StripItem>
      <StripItem term="IPCA no mês">{point(macro.ipcaMonth, '%')}</StripItem>
      <StripItem term="IPCA em 12 meses">{point(macro.ipca12m, '%')}</StripItem>
      <StripItem term="Dólar (PTAX de venda)">
        {macro.usd ? (
          <Dated date={formatDate(macro.usd.date)}>R$ {formatDecimalString(macro.usd.value)}</Dated>
        ) : (
          NO_DATA
        )}
      </StripItem>
    </Strip>
  );
}

export default withApiDown(async function Home({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const action = actionOf(first(query.filtro));
  const cursor = cursorOf(first(query.cursor));

  // a temporada atual, o feed, o BOVA11 e a fita não dependem um do outro: as quatro leituras saem juntas. A fita é enfeite: a falha só da
  // rota dela (um 5xx, o prazo, o banco sem o GRANT do universo) cai na fita do BOVA11 e do macro e vai para o log, sem derrubar a home. O
  // portão do segredo das cotações continua no BOVA11 (o smoke do deploy reprova a revisão que não lê a rota interna).
  const [current, feed, bars, universe] = await orNotFound(
    Promise.all([
      api.arenaCurrent(),
      api.decisions({ action, cursor, limit: FEED_LIMIT }),
      readBars(REFERENCE_TICKER),
      readTape().catch((error: unknown) => {
        console.error('[web] home sem a fita:', error);
        return { date: null, rows: [] };
      }),
    ]),
  );
  const { season, lastCycle, nextCycle, macro } = current;
  // sem ciclo não há liquidação, então não há resultado para pedir
  const [board, equity, baseline] =
    season && lastCycle
      ? await Promise.all([
          api.leaderboard(season.slug),
          api.equity(season.slug),
          api.randomBaseline(season.slug),
        ])
      : [null, null, null];

  // A hora do pedido: a página é dinâmica (force-dynamic), então este "agora" é o de quem a abriu. O Countdown, no navegador, o refaz.
  const now = Date.now();

  const drawn = equity?.series.filter(
    (s) => s.competitor.type === 'MODEL' || s.competitor.type === 'RANDOM',
  );
  const ranked = board?.rows.filter(
    (row) => row.competitor.type === 'MODEL' || row.competitor.type === 'RANDOM',
  );
  // A arena simulada (ui.tsx, SimulatedTag): algum modelo da temporada exibida decide pelo provedor fake. O elenco vem do ranking (a
  // temporada inteira, depois da primeira liquidação) e do feed (as decisões do primeiro pregão, antes dela).
  const simulated = [...(board?.rows ?? []), ...feed.rows].some((row) =>
    isSimulated(row.competitor),
  );

  const bova11 = bova11Of(bars);
  const tape = heroTape(universe, bova11, macro);

  return (
    <div>
      <Hero
        pill={heroPill(current, equity?.dates.length ?? 0)}
        lastCycleDate={lastCycle?.date ?? null}
        simulated={simulated}
        caption={tape.caption}
        tape={tape}
      />

      {/* a moldura: a linha do hero, a faixa vazia e a de cotações entre duas linhas, na coluna inteira (sem a calha) */}
      <Rule />
      <div className="h-12" />
      <Rule />
      <section id="cotacoes" aria-labelledby="cotacoes-titulo" className="-mx-(--calha)">
        <h2 id="cotacoes-titulo" className="sr-only">
          Cotações e macro
        </h2>
        <Quotes macro={macro} bova11={bova11} closes={bars.map((bar) => bar.closeCents)} />
      </section>
      <Rule />

      <Section id="ranking" title="Ranking">
        {ranked && ranked.length > 0 ? (
          <>
            <div className="max-w-2xl">
              <LeaderboardTable
                rows={ranked}
                label="Ranking por retorno: modelos e Sorteio"
                compact
              />
            </div>
            <p className="muted">
              A posição vale entre todos os competidores, referências incluídas (CDI, igual-peso e
              BOVA11): por isso a tabela pode pular números.
            </p>
            <NavLink href="/ranking" className={BUTTON}>
              Ranking completo
            </NavLink>
          </>
        ) : (
          <Empty>{NO_RESULT}</Empty>
        )}
      </Section>

      {season ? (
        <Section id="ciclos" title="Ciclos">
          <Facts>
            <Fact term="Último ciclo">
              {lastCycle ? (
                <>
                  <NavLink href={`/ciclos/${lastCycle.date}`} className="link">
                    {formatDate(lastCycle.date)}
                  </NavLink>{' '}
                  <span className="text-sm text-body">{CYCLE_STATUS[lastCycle.status]}</span>
                </>
              ) : (
                'Ainda não houve ciclo nesta temporada.'
              )}
            </Fact>
          </Facts>
          {lastCycle ? (
            <>
              <div className="overflow-hidden rounded-panel border border-hairline">
                <Strip columns={3}>
                  {(['BUY', 'SELL', 'HOLD'] as const).map((name) => (
                    <StripItem key={name} term={name}>
                      {lastCycle.counts[name]}
                    </StripItem>
                  ))}
                </Strip>
              </div>
              <p className="muted">
                BUY, SELL e HOLD: itens válidos de todas as decisões do último ciclo.
              </p>
            </>
          ) : null}
          <Facts>
            <Fact term="Próximo ciclo">
              {nextCycle ? (
                <>
                  {formatWeekdayDate(nextCycle.date)}, às {formatTime(nextCycle.decisionAt)}{' '}
                  (Brasília).{' '}
                  <Countdown
                    at={nextCycle.decisionAt}
                    initial={countdownText(nextCycle.decisionAt, now)}
                  />
                </>
              ) : season.status === 'FINISHED' ? (
                'Nenhum: a temporada acabou.'
              ) : (
                'Nenhum: o último pregão da temporada já abriu.'
              )}
            </Fact>
          </Facts>
        </Section>
      ) : null}

      <Section id="patrimonio" title="Patrimônio">
        {equity && drawn && equity.dates.length > 0 ? (
          <div className="card">
            <EquityChart
              id="home-patrimonio"
              dates={equity.dates}
              series={drawn.map((s) => ({
                slug: s.competitor.slug,
                name: s.competitor.name,
                cents: s.equityCents,
                simulated: isSimulated(s.competitor),
              }))}
              band={baseline ? alignBand(equity.dates, baseline.rows) : null}
            />
          </div>
        ) : (
          <Empty>{NO_RESULT}</Empty>
        )}
      </Section>

      <Section id="feed" title="Decisões">
        <nav aria-label="Filtrar decisões">
          <ul className="flex flex-wrap gap-2">
            {FILTERS.map(([label, value]) => (
              <li key={label}>
                <NavLink
                  href={feedHref(value)}
                  aria-current={action === value ? 'true' : undefined}
                  className="chip"
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {feed.rows.length > 0 ? (
          <div className="space-y-3">
            {feed.rows.map((row) => (
              <DecisionCard
                key={`${row.date}/${row.competitor.slug}`}
                decision={row}
                date={row.date}
                by="model"
                simulated={isSimulated(row.competitor)}
              />
            ))}
          </div>
        ) : (
          <Empty>
            {action || cursor ? 'Nenhuma decisão com este filtro.' : 'Nenhuma decisão ainda.'}
          </Empty>
        )}
        {feed.nextCursor ? (
          <NavLink href={feedHref(action, feed.nextCursor)} className={BUTTON}>
            Mais antigas
          </NavLink>
        ) : null}
      </Section>

      <Section id="temporada" title="Temporada">
        {season ? (
          <Facts dense>
            <Fact term="Nome" wide>
              {season.name}
            </Fact>
            <Fact term="Situação">
              {season.status === 'FINISHED' ? 'Encerrada' : 'Em andamento'}
            </Fact>
            <Fact term="Pregões">{season.params.sessions}</Fact>
            <Fact term="Liquidado até" wide>
              {season.settledThrough ? formatDate(season.settledThrough) : 'ainda não'}
            </Fact>
          </Facts>
        ) : (
          <Empty>Nenhuma temporada em andamento ou encerrada ainda.</Empty>
        )}
      </Section>
    </div>
  );
});
