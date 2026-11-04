import type { IsoDate } from '../../market-data/domain/dates.js';
import { MACRO_SERIES } from '../../news/domain/bcb.js';
import { excerptAllowed, sourceName } from '../../news/domain/sources.js';
import { SNIPPET_MAX, TITLE_MAX, cleanText } from '../../news/domain/text.js';
import { isTickerShape } from '../../news/domain/tickers.js';
import { divRound } from '../../settlement/domain/money.js';
import { canonicalBytes, sha256Hex } from './canonical-json.js';
import { ARENA_RULES, type ArenaRules } from './rules.js';
import { SCREENING, screen } from './screening.js';
import { shuffleBySeed } from './shuffle.js';

// O briefing congelado às 07:30: a entrada comum a todos os modelos (plano 10; docs/DADOS.md, seção 18). Aqui só a
// montagem, uma função pura de um retrato do banco: a mesma entrada dá os mesmos bytes e o mesmo SHA-256, em qualquer
// ordem em que o banco devolva as linhas. Nada de relógio, de acaso nem de leitura do ambiente.
//
// Texto de terceiro (título e trecho de notícia, nome de empresa) é DADO: passa de novo por cleanText, só aparece
// como valor de um campo de item de notícia ou de linha da tabela, e é escapado na serialização (canonical-json.ts).
// Nada de fonte externa é interpolado em texto de instrução: o briefing não tem texto de instrução.

export const BRIEFING_FORMAT = 'alvesting-briefing/1';

export const LIMITS = {
  // pregões de barras por ação
  sessions: 30,
  // notícias por fonte: as mais recentes. Teto de tamanho, não de relevância
  newsPerSource: 100,
  // ações citadas nas notícias que ganham barras, as mais citadas primeiro
  citedTickers: 40,
  // mínimo do universo com fechamento do último pregão; abaixo disso o eod do dia falhou e o briefing não congela
  coverageMinPercent: 80,
} as const;

export interface BarRow {
  date: IsoDate;
  openCents: bigint;
  highCents: bigint;
  lowCents: bigint;
  closeCents: bigint;
  volumeCents: bigint;
}

export interface UniverseRow {
  ticker: string;
  name: string;
  // 1 = maior volume médio do universo
  position: number;
  avgVolumeCents: bigint;
}

export interface MacroValue {
  series: string;
  date: IsoDate;
  // texto decimal fixo, como o BCB publica
  value: string;
}

export interface NewsRow {
  // id da fonte (infomoney, cvm-ipe...)
  source: string;
  publishedAt: Date;
  title: string;
  snippet: string;
  tickers: string[];
  // SHA-256 da URL: desempata notícias da mesma hora sem depender da ordem em que o banco as devolve
  urlHash: string;
}

export interface BriefingSnapshot {
  // o pregão do briefing (D); os modelos decidem às 08:00 de D com dados até o fechamento anterior
  date: IsoDate;
  // os 30 pregões até o fechamento anterior a D, em ordem crescente
  sessions: readonly IsoDate[];
  // a semana ISO do universo
  week: string;
  universe: readonly UniverseRow[];
  // barras por ticker (as do universo e a do BOVA11), qualquer ordem
  bars: ReadonlyMap<string, readonly BarRow[]>;
  macro: readonly MacroValue[];
  news: readonly NewsRow[];
  // de onde até onde as notícias foram vistas (o congelamento anterior até este)
  newsWindow: { from: Date; until: Date };
  // as regras que o briefing anuncia (rulesOfSeasons); sem elas valem as da Temporada 1
  rules?: ArenaRules;
}

export interface BuiltBriefing {
  bytes: Buffer;
  sha256: string;
  stats: {
    bytes: number;
    universeRows: number;
    screening: number;
    citedTickers: number;
    barsTickers: number;
    barRows: number;
    newsItems: number;
  };
}

// O eod do pregão anterior não gravou barras suficientes: congelar assim daria aos modelos um dia de dado velho sem
// ninguém saber. Falha, e a fila tenta de novo (o eod pode estar só atrasado).
export class IncompleteMarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteMarketDataError';
  }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const toInt = (value: bigint): number => {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new RangeError('valor fora do intervalo seguro');
  return Number(value);
};

// Variação percentual em pontos-base (1 bp = 0,01%), só com inteiros: arredonda para o mais próximo e o meio para
// longe do zero, igual nas altas e nas baixas (divRound, a regra única de arredondamento do dinheiro e das razões). Sem
// fechamento anterior válido, não há variação.
export function changeBps(close: bigint, previous: bigint): number | null {
  if (previous <= 0n) return null;
  return toInt(divRound((close - previous) * 10_000n, previous));
}

const iso = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function buildBriefing(snapshot: BriefingSnapshot): BuiltBriefing {
  const { date, sessions } = snapshot;
  const last = sessions[sessions.length - 1];
  if (last === undefined) throw new Error('Sem pregões de dados para o briefing');
  if (!(last < date)) {
    throw new Error(
      `O último pregão com dados (${last}) tem de ser anterior ao do briefing (${date})`,
    );
  }
  if (!WEEK.test(snapshot.week)) throw new Error(`Semana ISO inválida: ${snapshot.week}`);
  const previous = sessions.length > 1 ? sessions[sessions.length - 2]! : null;
  const inWindow = new Set(sessions);

  // só as barras dos pregões da janela: nenhuma barra de depois do último pregão entra, por mais que o banco já tenha
  const barsOf = (ticker: string): Map<IsoDate, BarRow> => {
    const byDate = new Map<IsoDate, BarRow>();
    for (const bar of snapshot.bars.get(ticker) ?? []) {
      if (inWindow.has(bar.date)) byDate.set(bar.date, bar);
    }
    return byDate;
  };

  // --- universo ---------------------------------------------------------------------------------------------
  if (snapshot.universe.length === 0) throw new Error('Universo vazio: sem ação para o briefing');
  const seen = new Set<string>();
  const universe = snapshot.universe.map((member) => {
    if (!isTickerShape(member.ticker)) {
      // diz qual, para quem opera achar a linha: curto e entre aspas (JSON.stringify), porque vem do banco
      throw new Error(
        `ticker fora do formato da B3 no universo: ${JSON.stringify(member.ticker.slice(0, 12))}`,
      );
    }
    if (seen.has(member.ticker)) throw new Error(`ticker repetido no universo: ${member.ticker}`);
    seen.add(member.ticker);
    const bars = barsOf(member.ticker);
    const close = bars.get(last);
    const before = previous === null ? undefined : bars.get(previous);
    return {
      ticker: member.ticker,
      name: cleanText(member.name, 60) || member.ticker,
      position: member.position,
      avgVolumeCents: member.avgVolumeCents,
      closeCents: close?.closeCents ?? null,
      changeBps: close && before ? changeBps(close.closeCents, before.closeCents) : null,
      lastVolumeCents: close?.volumeCents ?? 0n,
    };
  });
  const withClose = universe.filter((row) => row.closeCents !== null).length;
  if (withClose * 100 < universe.length * LIMITS.coverageMinPercent) {
    throw new IncompleteMarketDataError(
      `Dados de mercado incompletos: ${withClose} de ${universe.length} ações do universo têm fechamento de ${last} ` +
        `(mínimo ${LIMITS.coverageMinPercent}%)`,
    );
  }
  const table = shuffleBySeed(universe, date, (row) => row.ticker);
  const screened = screen(universe);

  // --- notícias ---------------------------------------------------------------------------------------------
  const cleaned = snapshot.news.flatMap((item) => {
    if (item.publishedAt > snapshot.newsWindow.until) return [];
    const title = cleanText(item.title, TITLE_MAX);
    if (title === '') return [];
    return [
      {
        source: item.source,
        publishedAt: item.publishedAt,
        urlHash: item.urlHash,
        title,
        // o trecho vai ao provedor da LLM: só se os termos da fonte deixam (domain/sources.ts); senão, só o título
        snippet: excerptAllowed(item.source) ? cleanText(item.snippet, SNIPPET_MAX) : '',
        // só ação do universo: o modelo não opera as outras. O ticker vem gravado, nunca se deduz do texto
        tickers: [...new Set(item.tickers)].filter((ticker) => seen.has(ticker)).sort(),
      },
    ];
  });
  const newest = (a: (typeof cleaned)[number], b: (typeof cleaned)[number]): number =>
    b.publishedAt.getTime() - a.publishedAt.getTime() || compare(b.urlHash, a.urlHash);
  const perSource = new Map<string, typeof cleaned>();
  for (const item of [...cleaned].sort(newest)) {
    const list = perSource.get(item.source) ?? [];
    if (list.length < LIMITS.newsPerSource) list.push(item);
    perSource.set(item.source, list);
  }
  const items = [...perSource.values()]
    .flat()
    .sort(
      (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || compare(a.urlHash, b.urlHash),
    );

  const mentions = new Map<string, number>();
  for (const item of items) {
    for (const ticker of item.tickers) mentions.set(ticker, (mentions.get(ticker) ?? 0) + 1);
  }
  const cited = [...mentions]
    .sort(([tickerA, countA], [tickerB, countB]) => countB - countA || compare(tickerA, tickerB))
    .slice(0, LIMITS.citedTickers)
    .map(([ticker]) => ticker);

  // --- barras: triagem e citadas ----------------------------------------------------------------------------
  const barTickers = [...new Set([...screened, ...cited])].sort();
  let barRows = 0;
  const byTicker: Record<string, Array<Array<string | number>>> = {};
  for (const ticker of barTickers) {
    const rows = [...barsOf(ticker).values()]
      .sort((a, b) => compare(a.date, b.date))
      .map((bar) => [
        bar.date,
        toInt(bar.openCents),
        toInt(bar.highCents),
        toInt(bar.lowCents),
        toInt(bar.closeCents),
        toInt(bar.volumeCents),
      ]);
    barRows += rows.length;
    byTicker[ticker] = rows;
  }

  // --- macro ------------------------------------------------------------------------------------------------
  const macro: Record<string, unknown> = {};
  for (const series of MACRO_SERIES) {
    // o valor mais recente até o último pregão: o macro de depois dele seria olhar para o futuro
    let latest: MacroValue | null = null;
    for (const value of snapshot.macro) {
      if (value.series !== series.id || value.date > last) continue;
      if (!DECIMAL.test(value.value))
        throw new Error(`Valor fora do formato na série ${series.id}`);
      if (latest === null || value.date > latest.date) latest = value;
    }
    macro[series.id] = latest === null ? null : { date: latest.date, value: latest.value };
  }
  const bova = barsOf('BOVA11');
  const bovaClose = bova.get(last);
  const bovaBefore = previous === null ? undefined : bova.get(previous);
  macro.bova11 = bovaClose
    ? {
        date: last,
        close_cents: toInt(bovaClose.closeCents),
        change_bps: bovaBefore ? changeBps(bovaClose.closeCents, bovaBefore.closeCents) : null,
      }
    : null;

  const document = {
    format: BRIEFING_FORMAT,
    date,
    data_through: last,
    rules: snapshot.rules ?? ARENA_RULES,
    macro,
    universe: {
      week: snapshot.week,
      // a regra de ordem é pública: a posição de cada ação é a ordem do SHA-256 de "<pregão>:<ticker>"
      shuffle: 'sha256_of_date_colon_ticker',
      columns: ['ticker', 'name', 'close_cents', 'change_bps', 'avg_volume_cents'],
      rows: table.map((row) => [
        row.ticker,
        row.name,
        row.closeCents === null ? null : toInt(row.closeCents),
        row.changeBps,
        toInt(row.avgVolumeCents),
      ]),
    },
    screening: {
      rule: { pool: SCREENING.pool, rank_by: 'abs_change_bps_last_session', size: SCREENING.size },
      tickers: screened,
    },
    bars: {
      sessions: sessions.length,
      columns: ['date', 'open_cents', 'high_cents', 'low_cents', 'close_cents', 'volume_cents'],
      by_ticker: byTicker,
    },
    news: {
      from: iso(snapshot.newsWindow.from),
      until: iso(snapshot.newsWindow.until),
      items: items.map((item) => ({
        source: sourceName(item.source),
        published_at: iso(item.publishedAt),
        title: item.title,
        snippet: item.snippet,
        tickers: item.tickers,
      })),
    },
  };

  const bytes = canonicalBytes(document);
  return {
    bytes,
    sha256: sha256Hex(bytes),
    stats: {
      bytes: bytes.length,
      universeRows: table.length,
      screening: screened.length,
      citedTickers: cited.length,
      barsTickers: barTickers.length,
      barRows,
      newsItems: items.length,
    },
  };
}
