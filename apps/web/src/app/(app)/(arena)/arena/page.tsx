import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import type { ArenaCurrent, InternalBar, PublicCompetitor } from '@alvesting/contracts';
import { slugSchema } from '@alvesting/contracts';
import { Tooltip } from '../../../../components/arc/tooltip/tooltip';
import { BarraCarteiras, lerCarteiras } from '../../../../components/arena/carteiras';
import {
  AREA_ARENA,
  AvisoSimulado,
  ComBarra,
  NavegacaoDaArea,
  REGRAS,
  telasDaArena,
} from '../../../../components/arena/pagina';
import { LineChart } from '../../../../components/beui/line-chart';
import { Competidor, FaixaDeModelos } from '../../../../components/competidor';
import { Countdown } from '../../../../components/countdown';
import { DecisionCard } from '../../../../components/decisions';
import {
  Empty,
  Fact,
  Facts,
  LINK,
  NavLink,
  NotaRetroativa,
  PageHead,
  RetroativoTag,
  Segmentado,
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
  formatPercentile,
  formatTime,
  formatWeekdayDate,
  variationBps,
} from '../../../../lib/format';
import { versoesDosLogos } from '../../../../lib/logos';
import { actionOf, cursorOf, first, orNotFound, type SearchParams } from '../../../../lib/page';
import { REFERENCE_TICKER, readBars } from '../../../../lib/quotes';
import { fraseDaSerie } from '../../../../lib/retroativo';
import { withApiDown } from '../../../../lib/with-api-down';

// A arena (ADR 0041; o conteúdo é o da home de antes, que virou a landing): o placar dos modelos no topo da coluna, a barra "Carteiras"
// (components/arena/carteiras.tsx) à direita do feed a partir de 1280 px (pagina.tsx, `junto`) e, na coluna, o gráfico do patrimônio (o Line Chart
// da beUI, com o rótulo no fim de cada linha), as cotações e o macro com a data de cada valor, os ciclos, o feed de decisões com o filtro por
// BUY, SELL e HOLD e por modelo, e a temporada. O e2e acha as regiões pelo nome ("Ranking", "Patrimônio", "Cotações e macro", "Ciclos",
// "Decisões", "Temporada" e "Carteiras"), não pela ordem. O "simulado" vai uma vez (docs/DESIGN.md): o aviso discreto no topo cobre a página
// inteira, e as peças tiram a nota delas (`avisoNaPagina`). O trecho retroativo da temporada (ADR 0038) também: a nota uma vez, embaixo do
// aviso (o resultado da faixa, do gráfico e das carteiras inclui os pregões dele), o fundo hachurado no gráfico e a etiqueta no item do feed
// e no último ciclo, que são de um pregão.
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

// A vista da arena abaixo de 1280 px (?vista=carteiras; o padrão, e o valor que não é um deles, é a das decisões): as abas "Decisões |
// Carteiras", do servidor, como o filtro do feed (o QA do fechamento, achado 7). O link da vista leva o filtro do feed junto, sem o cursor.
type Vista = 'decisoes' | 'carteiras';
const vistaOf = (value: string | undefined): Vista =>
  value === 'carteiras' ? 'carteiras' : 'decisoes';
function vistaHref(vista: Vista, { action, modelo }: Feed): string {
  const query = new URLSearchParams();
  if (vista === 'carteiras') query.set('vista', vista);
  if (action) query.set('filtro', action);
  if (modelo) query.set('modelo', modelo);
  const text = query.toString();
  return `/arena${text ? `?${text}` : ''}`;
}

// O modelo do filtro (?modelo=slug): o que não tem a forma de um slug é ignorado, como o filtro que não é uma ação; o slug que não é de
// nenhum modelo dá a lista vazia da api ("Nenhuma decisão com este filtro").
const modeloOf = (value: string | undefined) => {
  const parsed = value === undefined ? undefined : slugSchema.safeParse(value);
  return parsed?.success ? parsed.data : undefined;
};

// Uma seção da arena, numa faixa da coluna: o fio de 1 px em cima, de uma borda à outra dela (come o respiro da coluna), o título de 18 px
// na tinta (em caixa normal, porque é o nome da região que o e2e lê) e, à direita, o que a seção tiver de controle (o filtro do feed).
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
    <section id={id} aria-labelledby={`${id}-titulo`} className="secao">
      {/* `relative`: a lista do filtro por modelo se posiciona nesta linha inteira (no celular, da largura dela) */}
      <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-4">
        <h2 id={`${id}-titulo`} className="secao-titulo pb-0">
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

// A grade das cotações e do macro: os pares em células separadas pelos fios de 1 px (a folha nos vãos), em duas colunas no celular e três a
// partir de 640 px, de uma borda à outra da coluna. A linha dos ciclos, embaixo, usa as mesmas três colunas (o fio da esquerda da contagem é o
// mesmo da Selic e do Dólar).
const Celula = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1.5 bg-canvas px-5 py-4 lg:px-6">
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
  // A grade da página regrada (ADR 0041): as células separadas pelos fios de 1 px (a folha nos vãos), de uma borda à outra da coluna (come o
  // respiro dela), três por linha a partir de 640 px; a última linha encosta no fio da seção de baixo (o `-mb-8` desfaz o `mt-8` do Bloco
  // seguinte), e não fica uma linha solta a 32 px dele.
  return (
    <dl className="-mx-5 -mb-8 grid grid-cols-2 gap-px border-t border-folha bg-folha sm:grid-cols-3 lg:-mx-6">
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

// O filtro do feed por modelo: um `details` do navegador com um link por modelo, sem JavaScript. A chave é o modelo
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
                  <Competidor competitor={modelo} link={false} etiqueta={false} />
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
  const vista = vistaOf(first(query.vista));

  // a temporada atual, o feed, o BOVA11 e os logos das ações não dependem um do outro: as leituras saem juntas
  const [current, feed, bars, logos] = await orNotFound(
    Promise.all([
      api.arenaCurrent(),
      api.decisions({ action, competitor: modelo, cursor, limit: FEED_LIMIT }),
      readBars(REFERENCE_TICKER),
      versoesDosLogos(),
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

  // as referências (o CDI, o igual-peso e o BOVA11) começam escondidas no gráfico: a legenda as mostra, e a linha se desenha
  const referencias = equity?.series
    .filter((s) => s.competitor.type !== 'MODEL' && s.competitor.type !== 'RANDOM')
    .map((s) => s.competitor.slug);
  const ranked = ranking?.rows.filter(
    (row) => row.competitor.type === 'MODEL' || row.competitor.type === 'RANDOM',
  );
  const modelos = (ranking?.rows ?? [])
    .filter((row) => row.competitor.type === 'MODEL')
    .map((row) => row.competitor);
  // o retorno de cada modelo na temporada, no cabeçalho do item do feed
  const returnOf = new Map(ranking?.rows.map((row) => [row.competitor.slug, row.returnBps]));
  // o feed das decisões, com as carteiras ao lado a partir de 1280 px (pagina.tsx, ComBarra: `junto`)
  const decisoes = (
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
              avisoNaPagina
              returnBps={returnOf.get(row.competitor.slug) ?? null}
              logos={logos}
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
      {/* a paginação é ação de apoio: a pílula cinza (a primária fica na ação principal; a Regra da Voz Única) */}
      {feed.nextCursor ? (
        <NavLink href={feedHref({ action, modelo, cursor: feed.nextCursor })} className="btn">
          Mais antigas
        </NavLink>
      ) : null}
    </Bloco>
  );
  // A arena simulada (ui.tsx, quemSimula): algum modelo da temporada exibida decide pelo provedor fake. O elenco vem do ranking (a
  // temporada inteira, depois da primeira liquidação) ou do feed (as decisões do primeiro pregão, antes dela). O feed filtrado mostra só uma
  // parte do elenco: o aviso nomeia os simulados que vê, sem concluir que são todos.
  const elenco = ranking?.rows.length
    ? ranking.rows.map((row) => row.competitor)
    : feed.rows.map((row) => row.competitor);
  const parcial = !ranking?.rows.length && Boolean(action || modelo || cursor);
  // quantos dos pregões liquidados foram retroativos, e quando (lib/retroativo.ts): nenhum, nada
  const retroativos = equity ? fraseDaSerie(equity) : null;

  return (
    <ComBarra
      largura={400}
      vista={vista}
      junto={decisoes}
      barra={
        <BarraCarteiras
          carteiras={carteiras}
          capitalCents={season?.params.capitalCents ?? 0}
          logos={logos}
          avisoNaPagina
        />
      }
    >
      <NavegacaoDaArea
        label="Telas da arena"
        area={AREA_ARENA}
        trilha="Arena"
        telas={telasDaArena('arena', lastCycle?.date ?? null)}
        acao={REGRAS}
      />
      <PageHead
        title="Arena"
        sub={
          equity && equity.dates.length > 0
            ? `Quem está ganhando depois de ${equity.dates.length} ${equity.dates.length === 1 ? 'pregão' : 'pregões'}.`
            : undefined
        }
      >
        <p className="max-w-[60ch] text-sm text-pretty">
          Modelos de linguagem decidem BUY, SELL ou HOLD na B3 com o mesmo prompt, ao lado do
          Sorteio (o controle) e das referências: CDI, igual-peso e BOVA11. Dinheiro fictício.
        </p>
      </PageHead>
      <AvisoSimulado competitors={elenco} parcial={parcial} />
      {retroativos ? <NotaRetroativa className="mt-2">{retroativos}</NotaRetroativa> : null}
      {/* No celular e no tablet, uma vista por vez: as decisões (o conteúdo da arena) ou as carteiras, pelo segmentado.
          São links do servidor (a URL guarda a escolha), no desenho do segmentado, com a escolhida marcada; a partir de 1280 px as duas
          aparecem e as abas somem. */}
      <div className="mt-6 xl:hidden">
        <Segmentado
          label="Seções da arena"
          items={[
            {
              label: 'Decisões',
              href: vistaHref('decisoes', { action, modelo }),
              atual: vista === 'decisoes' ? 'page' : undefined,
            },
            {
              label: 'Carteiras',
              href: vistaHref('carteiras', { action, modelo }),
              atual: vista === 'carteiras' ? 'page' : undefined,
            },
          ]}
        />
      </div>

      <div className="vista-decisoes">
        <section id="ranking" aria-labelledby="ranking-titulo" className="mt-6">
          <h2 id="ranking-titulo" className="sr-only">
            Ranking
          </h2>
          {ranked && ranked.length > 0 ? (
            <>
              {/* o tooltip da Arc em cada cartão (o nome inteiro, com o sufixo de versão, e o que é o percentil): de cliente, só na arena */}
              <FaixaDeModelos
                rows={ranked}
                label="Modelos e Sorteio, por retorno"
                avisoNaPagina
                envolver={(cartao, row) => (
                  <Tooltip
                    side="bottom"
                    content={
                      <>
                        <span className="block font-medium">{row.competitor.name}</span>
                        {row.percentileBps === null ? null : (
                          <span className="block">
                            Percentil {formatPercentile(row.percentileBps)}: o retorno ficou acima
                            de {formatPercentile(row.percentileBps)}% das carteiras sorteadas do
                            Monte Carlo.
                          </span>
                        )}
                      </>
                    }
                  >
                    {cartao}
                  </Tooltip>
                )}
              />
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
          {equity && equity.dates.length > 0 ? (
            <LineChart
              id="arena-patrimonio"
              label="Patrimônio por pregão"
              dates={equity.dates}
              series={equity.series.map((s) => ({
                competitor: s.competitor,
                cents: s.equityCents,
              }))}
              band={baseline ? alignBand(equity.dates, baseline.rows) : null}
              capitalCents={equity.season.params.capitalCents}
              defaultHidden={referencias}
              modes={equity.modes}
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
            {/* Uma linha da grade das cotações acima (as três colunas, de uma borda à outra da coluna; o pedido do Artur em 18/11/2026: o
                fio da esquerda do BUY é o mesmo da Selic e do Dólar): o último e o próximo ciclo nas duas primeiras colunas, e a contagem de
                BUY, SELL e HOLD na terceira, dividida em três. No celular, uma embaixo da outra. A última linha encosta no fio da seção de
                baixo, como a das cotações. */}
            <div className="-mx-5 -mb-8 grid gap-px border-t border-folha bg-folha sm:grid-cols-3 lg:-mx-6">
              <div
                className={`min-w-0 bg-canvas px-5 pb-3 lg:px-6 [&_dl>div:last-child]:border-b-0 ${lastCycle ? 'sm:col-span-2' : 'sm:col-span-3'}`}
              >
                <Facts>
                  <Fact term="Último ciclo">
                    {lastCycle ? (
                      <>
                        <NavLink href={`/ciclos/${lastCycle.date}`} className={LINK}>
                          {formatDate(lastCycle.date)}
                        </NavLink>{' '}
                        <span className="text-sm text-body">{CYCLE_STATUS[lastCycle.status]}</span>
                        {lastCycle.mode === 'RETROATIVO' ? <RetroativoTag /> : null}
                      </>
                    ) : (
                      'Ainda não houve ciclo nesta temporada.'
                    )}
                  </Fact>
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
                {lastCycle ? (
                  <p className="muted text-xs">
                    BUY, SELL e HOLD: itens válidos de todas as decisões do último ciclo.
                  </p>
                ) : null}
              </div>
              {lastCycle ? (
                <dl className="grid grid-cols-3 gap-px">
                  {(['BUY', 'SELL', 'HOLD'] as const).map((name) => (
                    <div key={name} className="flex min-w-0 flex-col gap-2 bg-canvas px-5 py-4">
                      <dt className="text-13 text-muted">{name}</dt>
                      <dd className="text-26 leading-none text-ink tabular-nums">
                        {lastCycle.counts[name]}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </Bloco>
        ) : null}

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
      </div>
    </ComBarra>
  );
});
