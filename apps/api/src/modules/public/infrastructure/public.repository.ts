import {
  STOCK_SEARCH_LIMIT,
  TOP_RANKING,
  newsItemSchema,
  seasonParamsSchema,
  type ArenaCurrent,
  type CompetitorDetail,
  type CycleMode,
  type Equity,
  type FeedDecision,
  type LastCycle,
  type Leaderboard,
  type LeaderboardRow,
  type LlmProvider,
  type Macro,
  type NewsItem,
  type PositionView,
  type PublicCompetitor,
  type RandomBaseline,
  type SeasonSummary,
  type StockDetail,
  type StockSearch,
} from '@alvesting/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import {
  PUBLIC_SEASON_SELECT,
  findPublicSeason,
} from '../../arena/infrastructure/cycle-view.repository.js';
import { MACRO_SERIES } from '../../news/domain/bcb.js';
import { NEWS_SOURCES } from '../../news/domain/sources.js';
import { TITLE_MAX, cleanText } from '../../news/domain/text.js';
import { normalizeUrl } from '../../news/domain/url.js';
import { divRound, safeNumber } from '../../settlement/domain/money.js';
import { nextCycle } from '../domain/next-cycle.js';

// As consultas da API pública (plano §9, etapa 9). Só leitura. Cada consulta escolhe as colunas que sai: nunca `select *` nem
// `include` de tabela inteira, para que uma coluna nova (o trecho da notícia, o endereço do Blob, a config do competidor) não
// vire resposta por descuido nem seja lida à toa. O que sai é montado em objetos simples; quem valida o formato é o schema do
// contrato, no controller.
//
// ponytail: leitura sem foto única. Cada rota faz várias consultas em READ COMMITTED, e uma liquidação pode confirmar no meio (ela
// troca as tabelas derivadas numa transação só, então cada consulta vê o antes ou o depois, nunca meio a meio). O pior caso é uma
// resposta que mistura dois pregões vizinhos por milissegundos; a liquidação nunca encolhe a temporada, então não há 500, e o purge
// e a revalidação que vêm depois do commit tiram a mistura do cache (docs/API.md, "Limites conhecidos"). Se pesar: as consultas
// da rota dentro de `prisma.$transaction(..., { isolationLevel: 'RepeatableRead' })`, só leitura.
//
// Ordem e posição das listas: o cursor é a chave da última linha (keyset), nunca um deslocamento. As linhas derivadas da
// liquidação são identificadas pela chave natural (slug do competidor, pregão, ticker): o `id` delas muda a cada liquidação e
// nunca sai (docs/adr/0022).

const day = (date: Date): IsoDate => date.toISOString().slice(0, 10);
const startOf = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

type PublicSeasonRow = NonNullable<Awaited<ReturnType<typeof findPublicSeason>>>;

function seasonSummary(row: PublicSeasonRow, settledThrough: IsoDate | null): SeasonSummary {
  if (row.status === 'DRAFT') throw new Error('Temporada rascunho não é pública');
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    startDate: row.startDate ? day(row.startDate) : null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    settledThrough,
    // os mesmos parâmetros que a liquidação lê; torto no banco é erro, nunca um padrão no lugar
    params: seasonParamsSchema.parse(row.params),
  };
}

interface CompetitorFields {
  slug: string;
  name: string;
  kind: 'MODEL' | 'RANDOM' | 'BENCHMARK';
  benchmark: 'EQUAL_WEIGHT' | 'CDI' | 'BOVA11' | null;
  provider: string | null;
  modelId: string | null;
}

const COMPETITOR_SELECT = {
  id: true,
  slug: true,
  name: true,
  kind: true,
  benchmark: true,
  provider: true,
  modelId: true,
  position: true,
} as const;

// As colunas de uma posição que a API lê (positionView).
const POSITION_SELECT = {
  ticker: true,
  quantity: true,
  costCents: true,
  markCents: true,
  valueCents: true,
  stale: true,
} as const;

// O competidor como o público o vê. Nunca a config (recursos do provedor e preços).
function publicCompetitor(row: CompetitorFields): PublicCompetitor {
  let type: PublicCompetitor['type'];
  if (row.kind === 'BENCHMARK') {
    if (!row.benchmark) throw new Error(`Referência ${row.slug} sem o tipo no banco`);
    type = row.benchmark;
  } else {
    type = row.kind;
  }
  return {
    slug: row.slug,
    name: row.name,
    type,
    provider: row.provider as LlmProvider | null,
    modelId: row.modelId,
  };
}

interface PositionFields {
  ticker: string;
  quantity: bigint;
  costCents: bigint;
  markCents: bigint;
  valueCents: bigint;
  stale: boolean;
}

function positionView(row: PositionFields): PositionView {
  return {
    ticker: row.ticker,
    quantity: safeNumber(row.quantity),
    costCents: safeNumber(row.costCents),
    // o preço médio no centavo mais próximo, com o meio indo para longe do zero (a regra do domínio, docs/METODOLOGIA.md)
    avgPriceCents: row.quantity > 0n ? safeNumber(divRound(row.costCents, row.quantity)) : 0,
    markCents: safeNumber(row.markCents),
    valueCents: safeNumber(row.valueCents),
    pnlCents: safeNumber(row.valueCents - row.costCents),
    stale: row.stale,
  };
}

interface FeedRow {
  id: string;
  date: Date;
  mode: CycleMode;
  executedAt: Date;
  status: 'DECIDED' | 'FORCED_HOLD';
  holdReason: string | null;
  marketView: string | null;
  summary: string | null;
  slug: string;
  name: string;
  kind: CompetitorFields['kind'];
  benchmark: CompetitorFields['benchmark'];
  provider: string | null;
  modelId: string | null;
}

interface NewsRow {
  id: string;
  source: string;
  title: string;
  url: string;
  tickers: string[];
  publishedAt: Date;
}

export type KeyPage<T> = { rows: T[]; next: string[] | null };

@Injectable()
export class PublicRepository {
  private readonly logger = new Logger(PublicRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: TradingCalendar,
  ) {}

  // --- temporadas ----------------------------------------------------------------------------------------------------------

  // O último pregão liquidado de cada temporada (nulo antes da primeira liquidação).
  private async settledThrough(seasonIds: string[]): Promise<Map<string, IsoDate>> {
    const groups = await this.prisma.seasonStat.groupBy({
      by: ['seasonId'],
      where: { seasonId: { in: seasonIds } },
      _max: { asOf: true },
    });
    const result = new Map<string, IsoDate>();
    for (const group of groups)
      if (group._max.asOf) result.set(group.seasonId, day(group._max.asOf));
    return result;
  }

  private async summary(row: PublicSeasonRow): Promise<SeasonSummary> {
    const settled = await this.settledThrough([row.id]);
    return seasonSummary(row, settled.get(row.id) ?? null);
  }

  async seasons(args: { after?: string[]; limit: number }): Promise<KeyPage<SeasonSummary>> {
    const [afterId] = args.after ?? [];
    const rows = await this.prisma.season.findMany({
      where: {
        status: { in: ['RUNNING', 'FINISHED'] },
        ...(afterId === undefined ? {} : { id: { lt: afterId } }),
      },
      // o ULID cresce com a criação: a mais nova primeiro
      orderBy: { id: 'desc' },
      take: args.limit + 1,
      select: PUBLIC_SEASON_SELECT,
    });
    const page = rows.slice(0, args.limit);
    const settled = await this.settledThrough(page.map((row) => row.id));
    return {
      rows: page.map((row) => seasonSummary(row, settled.get(row.id) ?? null)),
      next: rows.length > args.limit ? [page[page.length - 1]!.id] : null,
    };
  }

  // --- ranking, patrimônio e Monte Carlo ----------------------------------------------------------------------------------

  // O ranking de uma temporada: um item por competidor com métrica, do maior retorno ao menor (o empate vale a ordem do elenco).
  private async standings(
    seasonId: string,
  ): Promise<{ asOf: IsoDate | null; rows: LeaderboardRow[] }> {
    const [competitors, stats, costs] = await Promise.all([
      this.prisma.competitor.findMany({
        where: { seasonId },
        orderBy: { position: 'asc' },
        select: COMPETITOR_SELECT,
      }),
      this.prisma.seasonStat.findMany({
        where: { seasonId },
        select: {
          competitorId: true,
          asOf: true,
          returnBps: true,
          percentileBps: true,
          excessEqualWeightBps: true,
          excessCdiBps: true,
          maxDrawdownBps: true,
          winRateBps: true,
          sells: true,
          winningSells: true,
          trades: true,
        },
      }),
      this.prisma.decision.groupBy({
        by: ['competitorId'],
        where: { cycle: { seasonId } },
        _sum: { costMicroUsd: true },
      }),
    ]);
    if (stats.length === 0) return { asOf: null, rows: [] };
    const asOf = stats.reduce((max, stat) => (stat.asOf > max ? stat.asOf : max), stats[0]!.asOf);
    const snapshots = await this.prisma.equitySnapshot.findMany({
      where: { seasonId, date: asOf },
      select: { competitorId: true, equityCents: true },
    });
    const equity = new Map(snapshots.map((s) => [s.competitorId, s.equityCents]));
    const cost = new Map(costs.map((c) => [c.competitorId, c._sum.costMicroUsd ?? 0n]));
    const order = new Map(competitors.map((c, index) => [c.id, index]));

    const ranked = stats
      .filter((stat) => order.has(stat.competitorId))
      .sort(
        (a, b) =>
          b.returnBps - a.returnBps || order.get(a.competitorId)! - order.get(b.competitorId)!,
      );
    const rows = ranked.map((stat, index): LeaderboardRow => {
      const competitor = competitors[order.get(stat.competitorId)!]!;
      const equityCents = equity.get(stat.competitorId);
      // a liquidação grava a métrica e o patrimônio na mesma transação: faltar um dos dois é defeito, não "sem dado"
      if (equityCents === undefined)
        throw new Error(`Sem patrimônio de ${competitor.slug} em ${day(asOf)}`);
      return {
        rank: index + 1,
        competitor: publicCompetitor(competitor),
        equityCents: safeNumber(equityCents),
        returnBps: stat.returnBps,
        percentileBps: stat.percentileBps,
        excessEqualWeightBps: stat.excessEqualWeightBps,
        excessCdiBps: stat.excessCdiBps,
        maxDrawdownBps: stat.maxDrawdownBps,
        winRateBps: stat.winRateBps,
        sells: stat.sells,
        winningSells: stat.winningSells,
        trades: stat.trades,
        llmCostMicroUsd: safeNumber(cost.get(stat.competitorId) ?? 0n),
      };
    });
    return { asOf: day(asOf), rows };
  }

  async leaderboard(ref: string | undefined): Promise<Leaderboard | null> {
    const season = await findPublicSeason(this.prisma, ref);
    if (!season) return null;
    const { asOf, rows } = await this.standings(season.id);
    return {
      season: seasonSummary(season, asOf),
      asOf,
      cyclesByMode: await this.cyclesByMode(season.id, asOf),
      rows,
    };
  }

  // Quantos pregões do ranking (os ciclos até o último liquidado) foram rodados retroativos e quantos ao vivo (ADR 0038). Antes da primeira
  // liquidação o ranking não tem pregão nenhum, e os dois são zero. O pregão sem ciclo (nenhum dos dois) conta como HOLD de todos na
  // liquidação e fica de fora das duas contas.
  private async cyclesByMode(
    seasonId: string,
    asOf: IsoDate | null,
  ): Promise<Leaderboard['cyclesByMode']> {
    const counts: Leaderboard['cyclesByMode'] = { RETROATIVO: 0, AO_VIVO: 0 };
    if (asOf === null) return counts;
    const groups = await this.prisma.cycle.groupBy({
      by: ['mode'],
      where: { seasonId, date: { lte: startOf(asOf) } },
      _count: { _all: true },
    });
    for (const group of groups) counts[group.mode] = group._count._all;
    return counts;
  }

  async equity(ref: string | undefined): Promise<Equity | null> {
    const season = await findPublicSeason(this.prisma, ref);
    if (!season) return null;
    const [summary, competitors, snapshots] = await Promise.all([
      this.summary(season),
      this.prisma.competitor.findMany({
        where: { seasonId: season.id },
        orderBy: { position: 'asc' },
        select: COMPETITOR_SELECT,
      }),
      this.prisma.equitySnapshot.findMany({
        where: { seasonId: season.id },
        orderBy: { date: 'asc' },
        select: { competitorId: true, date: true, equityCents: true },
      }),
    ]);
    const dates = [...new Set(snapshots.map((s) => day(s.date)))];
    const byCompetitor = new Map<string, Map<IsoDate, number>>();
    for (const s of snapshots) {
      const values = byCompetitor.get(s.competitorId) ?? new Map<IsoDate, number>();
      values.set(day(s.date), safeNumber(s.equityCents));
      byCompetitor.set(s.competitorId, values);
    }
    return {
      season: summary,
      dates,
      // um valor por data para cada competidor; quem não tem snapshot nenhum fica de fora
      series: competitors
        .filter((c) => byCompetitor.has(c.id))
        .map((c) => ({
          competitor: publicCompetitor(c),
          equityCents: dates.map((date) => {
            const value = byCompetitor.get(c.id)!.get(date);
            if (value === undefined) throw new Error(`Sem patrimônio de ${c.slug} em ${date}`);
            return value;
          }),
        })),
    };
  }

  async randomBaseline(ref: string | undefined): Promise<RandomBaseline | null> {
    const season = await findPublicSeason(this.prisma, ref);
    if (!season) return null;
    const [summary, rows] = await Promise.all([
      this.summary(season),
      this.prisma.randomBaseline.findMany({
        where: { seasonId: season.id },
        orderBy: { date: 'asc' },
        select: {
          date: true,
          equityP5Cents: true,
          equityP25Cents: true,
          equityP50Cents: true,
          equityP75Cents: true,
          equityP95Cents: true,
          returnP5Bps: true,
          returnP25Bps: true,
          returnP50Bps: true,
          returnP75Bps: true,
          returnP95Bps: true,
        },
      }),
    ]);
    return {
      season: summary,
      rows: rows.map((row) => ({
        date: day(row.date),
        equityCents: {
          p5: safeNumber(row.equityP5Cents),
          p25: safeNumber(row.equityP25Cents),
          p50: safeNumber(row.equityP50Cents),
          p75: safeNumber(row.equityP75Cents),
          p95: safeNumber(row.equityP95Cents),
        },
        returnBps: {
          p5: row.returnP5Bps,
          p25: row.returnP25Bps,
          p50: row.returnP50Bps,
          p75: row.returnP75Bps,
          p95: row.returnP95Bps,
        },
      })),
    };
  }

  // --- o competidor --------------------------------------------------------------------------------------------------------

  async competitor(slug: string, ref: string | undefined): Promise<CompetitorDetail | null> {
    const season = await findPublicSeason(this.prisma, ref);
    if (!season) return null;
    const competitor = await this.prisma.competitor.findUnique({
      where: { seasonId_slug: { seasonId: season.id, slug } },
      select: COMPETITOR_SELECT,
    });
    if (!competitor) return null;

    const { asOf, rows } = await this.standings(season.id);
    // A composição da carteira (o caixa e as posições) é só do MODELO. O igual-peso segura o universo inteiro e o BOVA11 um papel só, então
    // a marcação das posições e o caixa deles seriam o fechamento de todo papel, todo pregão: a base bruta que a licença da brapi proíbe
    // entregar (docs/API.md, seção 6; ADR 0033). O Sorteio e as referências ficam com o patrimônio e o retorno, que são derivados.
    const isModel = competitor.kind === 'MODEL';
    const [snapshot, positions, series, feed] = await Promise.all([
      asOf
        ? this.prisma.equitySnapshot.findUnique({
            where: { competitorId_date: { competitorId: competitor.id, date: startOf(asOf) } },
            select: { cashCents: true, positionsValueCents: true, equityCents: true },
          })
        : null,
      asOf && isModel
        ? this.prisma.position.findMany({
            where: { competitorId: competitor.id, date: startOf(asOf) },
            orderBy: [{ valueCents: 'desc' }, { ticker: 'asc' }],
            select: POSITION_SELECT,
          })
        : [],
      this.prisma.equitySnapshot.findMany({
        where: { competitorId: competitor.id },
        orderBy: { date: 'asc' },
        select: { date: true, equityCents: true },
      }),
      this.feed({ seasonId: season.id, competitor: slug, limit: 10 }),
    ]);
    return {
      season: seasonSummary(season, asOf),
      competitor: publicCompetitor(competitor),
      stat: rows.find((row) => row.competitor.slug === slug) ?? null,
      portfolio:
        asOf && snapshot
          ? {
              date: asOf,
              equityCents: safeNumber(snapshot.equityCents),
              holdings: isModel
                ? {
                    cashCents: safeNumber(snapshot.cashCents),
                    positionsValueCents: safeNumber(snapshot.positionsValueCents),
                    positions: positions.map(positionView),
                  }
                : null,
            }
          : null,
      series: {
        dates: series.map((s) => day(s.date)),
        equityCents: series.map((s) => safeNumber(s.equityCents)),
      },
      decisions: feed.rows,
    };
  }

  // --- decisões ------------------------------------------------------------------------------------------------------------

  // O feed: uma linha por decisão (modelo e pregão), do pregão mais novo ao mais antigo. O filtro de ação olha os itens que
  // valeram (os descartados não contam): BUY e SELL pedem um item válido da ação; HOLD pede a decisão que só segurou, isto é,
  // sem nenhum BUY nem SELL válido (HOLD explícito, lista vazia ou HOLD forçado). `after` é [pregão, id da decisão].
  async decisions(args: {
    seasonRef: string | undefined;
    action?: 'BUY' | 'SELL' | 'HOLD' | undefined;
    competitor?: string | undefined;
    after?: string[] | undefined;
    limit: number;
  }): Promise<KeyPage<FeedDecision> | null> {
    const season = await findPublicSeason(this.prisma, args.seasonRef);
    // temporada pedida que não existe: 404. Nenhuma temporada ainda: a lista é vazia
    if (!season) return args.seasonRef === undefined ? { rows: [], next: null } : null;
    return this.feed({ ...args, seasonId: season.id });
  }

  private async feed(args: {
    seasonId: string;
    action?: 'BUY' | 'SELL' | 'HOLD' | undefined;
    competitor?: string | undefined;
    after?: string[] | undefined;
    limit: number;
  }): Promise<KeyPage<FeedDecision>> {
    const { seasonId, action, competitor, after, limit } = args;
    const ownValid = Prisma.sql`i.decision_id = d.id AND NOT i.dropped`;
    const actionFilter =
      action === undefined
        ? Prisma.empty
        : action === 'HOLD'
          ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM decision_item i WHERE ${ownValid} AND i.action IN ('BUY', 'SELL'))`
          : Prisma.sql`AND EXISTS (SELECT 1 FROM decision_item i WHERE ${ownValid} AND i.action = ${action}::decision_action)`;
    const competitorFilter =
      competitor === undefined ? Prisma.empty : Prisma.sql`AND k.slug = ${competitor}`;
    const afterFilter =
      after === undefined
        ? Prisma.empty
        : Prisma.sql`AND (c.date, d.id) < (${after[0]}::date, ${after[1]})`;
    const rows = await this.prisma.$queryRaw<FeedRow[]>(Prisma.sql`
      SELECT d.id, c.date, c.mode, c.executed_at AS "executedAt", d.status, d.hold_reason AS "holdReason",
             d.market_view AS "marketView", d.summary,
             k.slug, k.name, k.kind, k.benchmark, k.provider, k.model_id AS "modelId"
      FROM decision d
      JOIN cycle c ON c.id = d.cycle_id
      JOIN competitor k ON k.id = d.competitor_id
      WHERE c.season_id = ${seasonId} ${competitorFilter} ${actionFilter} ${afterFilter}
      ORDER BY c.date DESC, d.id DESC
      LIMIT ${limit + 1}`);
    const page = rows.slice(0, limit);

    const items = await this.prisma.decisionItem.findMany({
      where: { decisionId: { in: page.map((row) => row.id) } },
      orderBy: [{ decisionId: 'asc' }, { position: 'asc' }],
      select: {
        decisionId: true,
        position: true,
        action: true,
        ticker: true,
        percent: true,
        confidence: true,
        rationale: true,
        dropped: true,
        dropReason: true,
      },
    });
    const byDecision = new Map<string, typeof items>();
    for (const item of items) {
      byDecision.set(item.decisionId, [...(byDecision.get(item.decisionId) ?? []), item]);
    }

    const last = page[page.length - 1];
    return {
      rows: page.map((row): FeedDecision => {
        const own = byDecision.get(row.id) ?? [];
        return {
          date: day(row.date),
          mode: row.mode,
          executedAt: row.executedAt.toISOString(),
          competitor: publicCompetitor(row),
          status: row.status,
          holdReason: row.holdReason as FeedDecision['holdReason'],
          marketView: row.marketView as FeedDecision['marketView'],
          summary: row.summary,
          items: own.flatMap((item) =>
            // o item que valeu tem ação, ticker e texto (CHECK do banco); o descartado nunca guarda texto
            !item.dropped && item.action && item.ticker && item.rationale !== null
              ? [
                  {
                    position: item.position,
                    action: item.action,
                    ticker: item.ticker,
                    percent: item.percent?.toNumber() ?? null,
                    confidence: item.confidence?.toNumber() ?? null,
                    rationale: item.rationale,
                  },
                ]
              : [],
          ),
          // do descartado, só a posição e o motivo
          dropped: own.flatMap((item) =>
            item.dropped
              ? [
                  {
                    position: item.position,
                    reason: item.dropReason as FeedDecision['dropped'][number]['reason'],
                  },
                ]
              : [],
          ),
        };
      }),
      next: rows.length > limit && last ? [day(last.date), last.id] : null,
    };
  }

  // --- notícias ------------------------------------------------------------------------------------------------------------

  // As notícias, da mais nova à mais antiga. Título, fonte, hora, tickers e link; o trecho (snippet) nem é lido. `after` é
  // [hora de publicação, id]. Título e link são dado de terceiro: o título passa pela limpeza do worker de novo (sem HTML) e o
  // link que não é http(s) não é servido (a linha é pulada).
  //
  // ponytail: o filtro por ticker usa o GIN quando o planejador acha que compensa e, para o ticker concentrado no passado (milhares
  // de notícias todas entre as mais antigas), varre o btree (published_at DESC, id DESC) e descarta o resto: 34 ms em 250 mil linhas,
  // linear no tamanho da tabela (docs/API.md, seção 4). Notícia de ticker é recente por natureza, então hoje não acontece. Se
  // `news_item` passar de uns 1 milhão de linhas: limitar a consulta por uma janela de tempo ou forçar o caminho do GIN.
  async news(args: {
    ticker?: string | undefined;
    after?: string[] | undefined;
    limit: number;
  }): Promise<KeyPage<NewsItem>> {
    const { ticker, after, limit } = args;
    const tickerFilter =
      ticker === undefined ? Prisma.empty : Prisma.sql`AND tickers @> ARRAY[${ticker}]::text[]`;
    const afterFilter =
      after === undefined
        ? Prisma.empty
        : Prisma.sql`AND (published_at, id) < (${after[0]}::timestamptz, ${after[1]})`;
    const rows = await this.prisma.$queryRaw<NewsRow[]>(Prisma.sql`
      SELECT id, source, title, url, tickers, published_at AS "publishedAt"
      FROM news_item
      WHERE TRUE ${tickerFilter} ${afterFilter}
      ORDER BY published_at DESC, id DESC
      LIMIT ${limit + 1}`);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page.flatMap((row) => {
        const url = normalizeUrl(row.url);
        if (url === null) return [];
        const title = cleanText(row.title, TITLE_MAX);
        if (title === '') return [];
        // Dado de terceiro: uma linha fora do contrato (mais tickers do que o teto, por exemplo) fica de fora da página em vez de
        // derrubá-la (o schema da página inteira daria 500 enquanto a linha estivesse entre as mais novas). A posição do cursor
        // vem das linhas lidas, então pular uma não repete nem perde as outras. Só o id vai ao log.
        const item = newsItemSchema.safeParse({
          title,
          source: row.source,
          sourceName: NEWS_SOURCES.find((s) => s.id === row.source)?.name ?? row.source,
          publishedAt: row.publishedAt.toISOString(),
          tickers: row.tickers,
          url,
        });
        if (!item.success) {
          this.logger.warn(
            { evento: 'noticia_fora_do_contrato', id: row.id },
            'notícia fora do contrato da API: a linha não foi servida',
          );
          return [];
        }
        return [item.data];
      }),
      next: rows.length > limit && last ? [last.publishedAt.toISOString(), last.id] : null,
    };
  }

  // --- ações ---------------------------------------------------------------------------------------------------------------

  // Busca por ticker ou nome, sem curinga de LIKE: o texto vai para starts_with/strpos, e "%" e "_" são só caracteres. O ticker
  // exato vem primeiro, depois o que começa com o texto, depois o resto, cada grupo em ordem de ticker.
  async searchStocks(q: string): Promise<StockSearch> {
    const rows = await this.prisma.$queryRaw<Array<{ ticker: string; name: string }>>`
      SELECT ticker, name FROM instrument
      WHERE kind = 'STOCK'
        AND (starts_with(lower(ticker), lower(${q})) OR strpos(lower(name), lower(${q})) > 0)
      ORDER BY (lower(ticker) = lower(${q})) DESC, starts_with(lower(ticker), lower(${q})) DESC, ticker ASC
      LIMIT ${STOCK_SEARCH_LIMIT}`;
    return { rows };
  }

  async stock(ticker: string): Promise<StockDetail | null> {
    const instrument = await this.prisma.instrument.findFirst({
      where: { ticker, kind: 'STOCK' },
      select: { ticker: true, name: true },
    });
    if (!instrument) return null;

    const season = await findPublicSeason(this.prisma);
    const summary = season ? await this.summary(season) : null;
    const asOf = summary?.settledThrough ?? null;
    // Sem as barras de preço: cotação bruta não sai de rota pública. O site as lê da rota interna (modules/quotes; ADR 0033).
    // Os donos são só os MODELOS: o igual-peso segura o universo inteiro (uns 300 papéis em produção), e a marcação dele seria o fechamento
    // do dia de toda ação. O Sorteio e o BOVA11 também ficam de fora, como na carteira do competidor (competitor(), acima).
    const [holders, decisions, news] = await Promise.all([
      season && asOf
        ? this.prisma.position.findMany({
            where: {
              seasonId: season.id,
              date: startOf(asOf),
              ticker,
              competitor: { kind: 'MODEL' },
            },
            // no empate de valor, a ordem do elenco: sem ela a ordem (e o ETag) seria a que o banco devolvesse
            orderBy: [{ valueCents: 'desc' }, { competitor: { position: 'asc' } }],
            select: { ...POSITION_SELECT, competitor: { select: COMPETITOR_SELECT } },
          })
        : [],
      season ? this.stockDecisions(season.id, ticker) : [],
      this.news({ ticker, limit: 10 }),
    ]);
    return {
      ticker: instrument.ticker,
      name: instrument.name,
      season: summary,
      holders: holders.map((holder) => {
        const view = positionView(holder);
        return {
          competitor: publicCompetitor(holder.competitor),
          quantity: view.quantity,
          avgPriceCents: view.avgPriceCents,
          markCents: view.markCents,
          valueCents: view.valueCents,
          pnlCents: view.pnlCents,
          stale: view.stale,
        };
      }),
      decisions,
      news: news.rows,
    };
  }

  // O que os modelos decidiram sobre a ação: os itens válidos, do pregão mais novo ao mais antigo (até 20).
  private async stockDecisions(
    seasonId: string,
    ticker: string,
  ): Promise<StockDetail['decisions']> {
    const rows = await this.prisma.$queryRaw<
      Array<
        CompetitorFields & {
          date: Date;
          mode: CycleMode;
          executedAt: Date;
          action: 'BUY' | 'SELL' | 'HOLD';
          percent: Prisma.Decimal | null;
          confidence: Prisma.Decimal | null;
          rationale: string;
        }
      >
    >`
      SELECT c.date, c.mode, c.executed_at AS "executedAt", k.slug, k.name, k.kind, k.benchmark, k.provider,
             k.model_id AS "modelId", i.action, i.percent, i.confidence, i.rationale
      FROM decision_item i
      JOIN decision d ON d.id = i.decision_id
      JOIN cycle c ON c.id = d.cycle_id
      JOIN competitor k ON k.id = d.competitor_id
      WHERE c.season_id = ${seasonId} AND i.ticker = ${ticker} AND NOT i.dropped
      ORDER BY c.date DESC, d.id DESC, i.position ASC
      LIMIT 20`;
    return rows.map((row) => ({
      date: day(row.date),
      mode: row.mode,
      executedAt: row.executedAt.toISOString(),
      competitor: publicCompetitor(row),
      action: row.action,
      percent: row.percent?.toNumber() ?? null,
      confidence: row.confidence?.toNumber() ?? null,
      rationale: row.rationale,
    }));
  }

  // --- a arena agora -------------------------------------------------------------------------------------------------------

  async arenaCurrent(): Promise<ArenaCurrent> {
    const [season, macro] = await Promise.all([findPublicSeason(this.prisma), this.macro()]);
    if (!season) return { season: null, lastCycle: null, nextCycle: null, macro, top: [] };
    const [standings, lastCycle] = await Promise.all([
      this.standings(season.id),
      this.lastCycle(season.id),
    ]);
    const summary = seasonSummary(season, standings.asOf);
    return {
      season: summary,
      lastCycle,
      nextCycle: nextCycle({
        status: summary.status,
        startDate: summary.startDate,
        sessions: summary.params.sessions,
        decisionTimeBrt: summary.params.decisionTimeBrt,
        lastCycleDate: lastCycle?.date ?? null,
        calendar: this.calendar,
      }),
      macro,
      top: standings.rows.slice(0, TOP_RANKING),
    };
  }

  private async lastCycle(seasonId: string): Promise<LastCycle | null> {
    const cycle = await this.prisma.cycle.findFirst({
      where: { seasonId },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        date: true,
        status: true,
        skipReason: true,
        decisionAt: true,
        deadlineAt: true,
        closedAt: true,
        mode: true,
        executedAt: true,
        briefing: { select: { sha256: true } },
        promptVersion: { select: { version: true, sha256: true } },
      },
    });
    if (!cycle) return null;
    const grouped = await this.prisma.decisionItem.groupBy({
      by: ['action'],
      where: { dropped: false, decision: { cycleId: cycle.id } },
      _count: { _all: true },
    });
    const count = (action: 'BUY' | 'SELL' | 'HOLD') =>
      grouped.find((group) => group.action === action)?._count._all ?? 0;
    return {
      date: day(cycle.date),
      status: cycle.status,
      skipReason: cycle.skipReason as LastCycle['skipReason'],
      decisionAt: cycle.decisionAt.toISOString(),
      deadlineAt: cycle.deadlineAt.toISOString(),
      closedAt: cycle.closedAt?.toISOString() ?? null,
      mode: cycle.mode,
      executedAt: cycle.executedAt.toISOString(),
      prompt: cycle.promptVersion
        ? { version: cycle.promptVersion.version, sha256: cycle.promptVersion.sha256 }
        : null,
      briefingSha256: cycle.briefing?.sha256 ?? null,
      counts: { BUY: count('BUY'), SELL: count('SELL'), HOLD: count('HOLD') },
    };
  }

  // O macro: o valor mais recente de cada série até o último pregão da base (o de depois dele seria olhar para o futuro, e a meta
  // Selic vem projetada), cada um com a data do dado. Sem o BOVA11: o fechamento dele é cotação bruta e sai pela rota interna do site
  // (modules/quotes; docs/API.md, seção 6; ADR 0033).
  private async macro(): Promise<Macro> {
    const none: Macro = { cdi: null, selic: null, ipcaMonth: null, ipca12m: null, usd: null };
    // O último dia com barra. Não é `aggregate({ _max })`: o Prisma o escreve com um OFFSET que impede o plano de índice do MAX e
    // varre a tabela inteira (9,8 ms com 71 mil barras, e cresce com a carga histórica); a ordem decrescente lê uma entrada do índice.
    const lastBar = await this.prisma.dailyBar.findFirst({
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    const last = lastBar?.date;
    if (!last) return none;
    const rows = await this.prisma.$queryRaw<
      Array<{ series: string; date: Date; value: Prisma.Decimal }>
    >`
      SELECT DISTINCT ON (series) series, date, value
      FROM macro_daily
      WHERE series IN (${Prisma.join(MACRO_SERIES.map((s) => s.id))}) AND date <= ${day(last)}::date
      ORDER BY series, date DESC`;
    const pick = (id: string) => {
      const row = rows.find((r) => r.series === id);
      const series = MACRO_SERIES.find((s) => s.id === id);
      // o texto decimal com as casas da série, como o BCB publica
      return row && series ? { date: day(row.date), value: row.value.toFixed(series.scale) } : null;
    };
    return {
      cdi: pick('cdi_daily_pct'),
      selic: pick('selic_target_pct_year'),
      ipcaMonth: pick('ipca_month_pct'),
      ipca12m: pick('ipca_12m_pct'),
      usd: pick('usd_brl_ptax_sell'),
    };
  }
}
