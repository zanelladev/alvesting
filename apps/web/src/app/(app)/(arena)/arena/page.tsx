import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import type { ArenaCurrent, InternalBar, PublicCompetitor } from '@alvesting/contracts';
import { slugSchema } from '@alvesting/contracts';
import { BarraCarteiras, lerCarteiras } from '../../../../components/arena/carteiras';
import {
  AREA_ARENA,
  ComBarra,
  NavegacaoDaArea,
  REGRAS,
  telasDaArena,
} from '../../../../components/arena/pagina';
import { EquityChart } from '../../../../components/charts';
import { Competidor, FaixaDeModelos } from '../../../../components/competidor';
import { Countdown } from '../../../../components/countdown';
import { DecisionCard } from '../../../../components/decisions';
import {
  Abas,
  Aviso,
  Empty,
  Fact,
  Facts,
  LINK,
  NavLink,
  PageHead,
  Segmentado,
  Strip,
  StripItem,
  direction,
  isSimulated,
} from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { alignBand } from '../../../../lib/chart';
import {
  countdownText,
  formatBRL,
  formatBps,
  formatDate,
  formatDecimalString,
  formatTime,
  formatWeekdayDate,
  variationBps,
} from '../../../../lib/format';
import { actionOf, cursorOf, first, orNotFound, type SearchParams } from '../../../../lib/page';
import { REFERENCE_TICKER, readBars } from '../../../../lib/quotes';
import { withApiDown } from '../../../../lib/with-api-down';

// A arena (docs/redesign-rallies/plano.md, seção e; o conteúdo é o da home de antes, que virou a landing): no desenho da Arena do Rallies,
// a barra "Carteiras" à esquerda (components/arena/carteiras.tsx), e no principal a faixa dos modelos, o gráfico do patrimônio com o
// rótulo no fim de cada linha, as cotações e o macro com a data de cada valor, os ciclos, o feed de decisões com o filtro por BUY, SELL e
// HOLD e por modelo, e a temporada. O e2e acha as regiões pelo nome ("Ranking", "Patrimônio", "Cotações e macro", "Ciclos", "Decisões",
// "Temporada" e "Carteiras"), não pela ordem.
// A página lê a api pelo cache de dados do site (src/lib/api.ts) e é dinâmica: o `next build` da imagem não tem api para chamar. O BOVA11
// da faixa de cotações não vem da API pública (ela não entrega cotação bruta): sai da rota interna, com o segredo do servidor
// (src/lib/quotes.ts; docs/API.md, seção 6), lido em paralelo com as outras e pelo mesmo cache de dados.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Arena' };

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

// O feed é uma lista por cursor com filtro, tudo na URL (?filtro=BUY&modelo=gpt-6-1-sol&cursor=...), então cada página dele é um link e
// funciona sem JavaScript. O `#feed` leva o leitor de volta à lista depois de clicar. (O `/?filtro=` de antes, da home, vira este endereço no
// src/proxy.ts, com 308.)
type Feed = { action?: string | undefined; modelo?: string | undefined; cursor?: string | null };
function feedHref({ action, modelo, cursor }: Feed): string {
  const query = new URLSearchParams();
  if (action) query.set('filtro', action);
  if (modelo) query.set('modelo', modelo);
  if (cursor) query.set('cursor', cursor);
  const text = query.toString();
  return `/arena${text ? `?${text}` : ''}#feed`;
}

// O modelo do filtro (?modelo=slug): o que não tem a forma de um slug é ignorado, como o filtro que não é uma ação; o slug que não é de
// nenhum modelo dá a lista vazia da api ("Nenhuma decisão com este filtro").
const modeloOf = (value: string | undefined) => {
  const parsed = value === undefined ? undefined : slugSchema.safeParse(value);
  return parsed?.success ? parsed.data : undefined;
};

// Uma seção da arena com o rótulo pequeno do Rallies (o "FEED" deles, na mono do sistema; em caixa normal, porque é o nome da região que o
// e2e lê) e, à direita, o que a seção tiver de controle (o filtro do feed).
function Bloco({
  id,
  title,
  extra,
  children,
}: {
  id: string;
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="mt-10">
      {/* `relative`: a lista do filtro por modelo se posiciona nesta linha inteira (no celular, da largura dela) */}
      <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-4">
        <h2 id={`${id}-titulo`} className="font-mono text-13 font-medium text-muted">
          {title}
        </h2>
        {extra}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
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

// A faixa de cotações e macro: os pares em células separadas por fio (o vão de 1 px sobre o fundo do fio), em duas colunas no celular e três
// a partir de 640 px. A `Strip` de ui.tsx põe seis colunas a partir de 1280 px de TELA, e ao lado das carteiras a coluna do conteúdo tem uns
// 720 px: seis não cabem.
const Celula = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1.5 bg-canvas p-4">
    <dt className="text-13 text-muted">{term}</dt>
    <dd className="font-display text-base text-ink tabular-nums">{children}</dd>
  </div>
);

function Quotes({ macro, bova11 }: { macro: ArenaCurrent['macro']; bova11: Bova11 | null }) {
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
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-3">
      <Celula term="BOVA11">
        {bova11 ? (
          <Dated date={`brapi.dev, fechamento de ${formatDate(bova11.date)}`}>
            {formatBRL(bova11.closeCents)}
            {change === null ? null : (
              <>
                {' ('}
                <span data-dir={direction(change)}>{formatBps(change)}</span>)
              </>
            )}
          </Dated>
        ) : (
          NO_DATA
        )}
      </Celula>
      <Celula term="CDI">{point(macro.cdi, '% ao dia')}</Celula>
      <Celula term="Selic (meta)">{point(macro.selic, '% ao ano')}</Celula>
      <Celula term="IPCA no mês">{point(macro.ipcaMonth, '%')}</Celula>
      <Celula term="IPCA em 12 meses">{point(macro.ipca12m, '%')}</Celula>
      <Celula term="Dólar (PTAX de venda)">
        {macro.usd ? (
          <Dated date={formatDate(macro.usd.date)}>R$ {formatDecimalString(macro.usd.value)}</Dated>
        ) : (
          NO_DATA
        )}
      </Celula>
    </dl>
  );
}

// O filtro do feed por modelo (o "Funds ▾" do Rallies): um `details` do navegador com um link por modelo, sem JavaScript. A chave é o modelo
// escolhido: a lista fecha depois da escolha (a navegação suave reaproveitaria o elemento aberto).
function FiltroModelo({
  modelos,
  atual,
  action,
}: {
  modelos: readonly PublicCompetitor[];
  atual: string | undefined;
  action: string | undefined;
}) {
  const escolhido = modelos.find((m) => m.slug === atual);
  const item = 'flex min-h-11 items-center rounded-md px-3 text-sm text-ink hover:bg-surface-card';
  return (
    <nav aria-label="Filtrar por modelo">
      <details key={atual ?? 'todos'}>
        <summary className="pill cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          {escolhido ? escolhido.name : 'Todos os modelos'}
          <span aria-hidden="true" className="text-muted">
            ▾
          </span>
        </summary>
        <ul className="absolute inset-x-0 top-full z-20 rounded-lg border border-hairline bg-canvas p-1 sm:left-auto sm:w-80">
          <li>
            <NavLink
              href={feedHref({ action })}
              aria-current={atual ? undefined : 'true'}
              className={`${item} aria-[current=true]:font-semibold`}
            >
              Todos os modelos
            </NavLink>
          </li>
          {modelos.map((modelo) => (
            <li key={modelo.slug}>
              <NavLink
                href={feedHref({ action, modelo: modelo.slug })}
                aria-current={modelo.slug === atual ? 'true' : undefined}
                className={`${item} aria-[current=true]:font-semibold`}
              >
                <span className="min-w-0">
                  <Competidor competitor={modelo} link={false} />
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}

export default withApiDown(async function ArenaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const action = actionOf(first(query.filtro));
  const modelo = modeloOf(first(query.modelo));
  const cursor = cursorOf(first(query.cursor));

  // a temporada atual, o feed e o BOVA11 não dependem um do outro: as três leituras saem juntas
  const [current, feed, bars] = await orNotFound(
    Promise.all([
      api.arenaCurrent(),
      api.decisions({ action, competitor: modelo, cursor, limit: FEED_LIMIT }),
      readBars(REFERENCE_TICKER),
    ]),
  );
  const { season, lastCycle, nextCycle, macro } = current;
  // sem ciclo não há liquidação, então não há resultado para pedir. As carteiras saem do ranking (os modelos dele), em paralelo com o resto.
  const board = season && lastCycle ? api.leaderboard(season.slug) : null;
  const [ranking, equity, baseline, carteiras] =
    season && board
      ? await Promise.all([
          board,
          api.equity(season.slug),
          api.randomBaseline(season.slug),
          board.then((b) => lerCarteiras(b.rows, season.slug)),
        ])
      : [null, null, null, []];

  // A hora do pedido: a página é dinâmica (force-dynamic), então este "agora" é o de quem a abriu. O Countdown, no navegador, o refaz.
  const now = Date.now();

  const drawn = equity?.series.filter(
    (s) => s.competitor.type === 'MODEL' || s.competitor.type === 'RANDOM',
  );
  const ranked = ranking?.rows.filter(
    (row) => row.competitor.type === 'MODEL' || row.competitor.type === 'RANDOM',
  );
  const modelos = (ranking?.rows ?? [])
    .filter((row) => row.competitor.type === 'MODEL')
    .map((row) => row.competitor);
  // o retorno de cada modelo na temporada, no cabeçalho do item do feed
  const returnOf = new Map(ranking?.rows.map((row) => [row.competitor.slug, row.returnBps]));
  // A arena simulada (ui.tsx, SimulatedTag): algum modelo da temporada exibida decide pelo provedor fake. O elenco vem do ranking (a
  // temporada inteira, depois da primeira liquidação) e do feed (as decisões do primeiro pregão, antes dela).
  const simulated = [...(ranking?.rows ?? []), ...feed.rows].some((row) =>
    isSimulated(row.competitor),
  );

  return (
    <ComBarra
      largura={400}
      barra={
        <BarraCarteiras carteiras={carteiras} capitalCents={season?.params.capitalCents ?? 0} />
      }
    >
      <NavegacaoDaArea
        label="Telas da arena"
        area={AREA_ARENA}
        trilha="Arena"
        telas={telasDaArena('arena', lastCycle?.date ?? null)}
        acao={REGRAS}
      />
      <PageHead title="Arena">
        <p className="max-w-[60ch] text-sm text-pretty">
          Modelos de linguagem decidem BUY, SELL ou HOLD na B3 com o mesmo prompt, ao lado do
          Sorteio (o controle) e das referências: CDI, igual-peso e BOVA11. Dinheiro fictício.
        </p>
      </PageHead>
      {simulated ? (
        <Aviso>
          <strong>Decisões simuladas: os modelos ainda não estão conectados.</strong> Os nomes são
          os do elenco, mas quem decide por cada modelo marcado como simulado é uma estratégia fixa
          e simples. O resultado não diz nada sobre os modelos de verdade.
        </Aviso>
      ) : null}
      {/* no celular e no tablet as carteiras descem para depois do conteúdo: os títulos de aba grandes do Rallies levam a elas */}
      <div className="mt-6 xl:hidden">
        <Abas
          grandes
          label="Seções da arena"
          items={[
            { label: 'Decisões', href: '#feed' },
            { label: 'Carteiras', href: '#carteiras' },
          ]}
        />
      </div>

      <section id="ranking" aria-labelledby="ranking-titulo" className="mt-6">
        <h2 id="ranking-titulo" className="sr-only">
          Ranking
        </h2>
        {ranked && ranked.length > 0 ? (
          <>
            <FaixaDeModelos rows={ranked} label="Modelos e Sorteio, por retorno" />
            <p className="flex justify-end">
              <NavLink href="/ranking" className={`${LINK} text-sm`}>
                Ranking completo
              </NavLink>
            </p>
          </>
        ) : (
          <Empty>{NO_RESULT}</Empty>
        )}
      </section>

      <Bloco id="patrimonio" title="Patrimônio">
        {equity && drawn && equity.dates.length > 0 ? (
          <EquityChart
            id="arena-patrimonio"
            dates={equity.dates}
            series={drawn.map((s) => ({
              slug: s.competitor.slug,
              name: s.competitor.name,
              cents: s.equityCents,
              simulated: isSimulated(s.competitor),
              competitor: s.competitor,
            }))}
            band={baseline ? alignBand(equity.dates, baseline.rows) : null}
          />
        ) : (
          <Empty>{NO_RESULT}</Empty>
        )}
      </Bloco>

      <Bloco id="cotacoes" title="Cotações e macro">
        <Quotes macro={macro} bova11={bova11Of(bars)} />
      </Bloco>

      {season ? (
        <Bloco id="ciclos" title="Ciclos">
          <Facts>
            <Fact term="Último ciclo">
              {lastCycle ? (
                <>
                  <NavLink href={`/ciclos/${lastCycle.date}`} className={LINK}>
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
              <div className="overflow-hidden rounded-lg border border-hairline">
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
        </Bloco>
      ) : null}

      <Bloco
        id="feed"
        title="Decisões"
        extra={
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <Segmentado
              preto
              label="Filtrar decisões"
              items={FILTERS.map(([label, value]) => ({
                label,
                href: feedHref({ action: value, modelo }),
                atual: action === value ? 'true' : undefined,
              }))}
            />
            {modelos.length > 0 ? (
              <FiltroModelo modelos={modelos} atual={modelo} action={action} />
            ) : null}
          </div>
        }
      >
        {feed.rows.length > 0 ? (
          <div className="max-w-2xl">
            {feed.rows.map((row) => (
              <DecisionCard
                key={`${row.date}/${row.competitor.slug}`}
                decision={row}
                date={row.date}
                by="model"
                simulated={isSimulated(row.competitor)}
                returnBps={returnOf.get(row.competitor.slug) ?? null}
              />
            ))}
          </div>
        ) : (
          <Empty>
            {action || modelo || cursor
              ? 'Nenhuma decisão com este filtro.'
              : 'Nenhuma decisão ainda.'}
          </Empty>
        )}
        {feed.nextCursor ? (
          <NavLink
            href={feedHref({ action, modelo, cursor: feed.nextCursor })}
            className="btn btn-primary"
          >
            Mais antigas
          </NavLink>
        ) : null}
      </Bloco>

      <Bloco id="temporada" title="Temporada">
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
      </Bloco>
    </ComBarra>
  );
});
