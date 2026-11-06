import { Injectable } from '@nestjs/common';
import { newId } from '../../../common/id.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { IsoDate } from '../domain/dates.js';
import type { InstrumentSeed } from '../domain/instruments.js';
import type { BrapiBar } from './brapi.client.js';

// Instrumentos, barras diárias e calendário de pregões. A barra gravada nunca é sobrescrita, de nenhuma fonte (docs/DADOS.md, seção 6):
// só entra o que falta (INSERT ... ON CONFLICT DO NOTHING, que também serve a duas cargas ao mesmo tempo), e a barra que chega com valor
// diferente do gravado é devolvida em `divergent`, sem mudar nada. Correção de dado é pelo evento corporativo do admin.

const TRANSACTION = { timeout: 60_000 };

const toDate = (day: IsoDate): Date => new Date(`${day}T00:00:00Z`);
const toIso = (date: Date): IsoDate => date.toISOString().slice(0, 10);

// Os bigint vão como texto e voltam a bigint no SQL: o volume passa de 2^53.
const text = (values: bigint[]): string[] => values.map(String);

// Os campos de uma barra que a comparação confere (`source` não entra).
const FIELDS = [
  ['open', 'openCents'],
  ['high', 'highCents'],
  ['low', 'lowCents'],
  ['close', 'closeCents'],
  ['volume', 'volumeCents'],
] as const;

export interface BarDivergence {
  ticker: string;
  date: IsoDate;
  // quais campos têm valor diferente do gravado: open, high, low, close, volume
  fields: string[];
}

export interface InsertResult {
  inserted: number;
  divergent: BarDivergence[];
  // papéis sem linha em instrument: a barra deles não é gravada
  unknown: string[];
}

@Injectable()
export class MarketRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Os papéis novos da lista da brapi (ISIN nulo). Quem já existe fica como está: o nome, o ISIN e a classe gravados não são tocados.
  // Devolve os tickers que de fato foram criados.
  async insertInstruments(seeds: readonly InstrumentSeed[], lastSeen: IsoDate): Promise<string[]> {
    if (seeds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Array<{ ticker: string }>>`
      INSERT INTO instrument (id, ticker, name, isin, spec, kind, last_seen)
      SELECT t.id, t.ticker, t.name, NULL, t.spec, t.kind::instrument_kind, ${lastSeen}::date
      FROM unnest(
        ${seeds.map(() => newId())}::text[],
        ${seeds.map((s) => s.ticker)}::text[],
        ${seeds.map((s) => s.name)}::text[],
        ${seeds.map((s) => s.spec)}::text[],
        ${seeds.map((s) => s.kind)}::text[]
      ) AS t(id, ticker, name, spec, kind)
      ON CONFLICT (ticker) DO NOTHING
      RETURNING ticker`;
    return rows.map((row) => row.ticker);
  }

  // Os tickers das ações à vista (kind STOCK; o BOVA11 é referência e fica de fora).
  async stockTickers(): Promise<string[]> {
    const rows = await this.prisma.instrument.findMany({
      where: { kind: 'STOCK' },
      orderBy: { ticker: 'asc' },
      select: { ticker: true },
    });
    return rows.map((row) => row.ticker);
  }

  // Os pregões de [from, to] em que cada papel já tem barra. É daqui que sai a falta: o banco é o cache. Uma consulta só, com 3 binds: o
  // `select` aninhado do Prisma pedia o ticker numa segunda consulta com um bind por barra (37,9 mil na carga inicial).
  async barDates(
    tickers: readonly string[],
    from: IsoDate,
    to: IsoDate,
  ): Promise<Map<string, Set<IsoDate>>> {
    const have = new Map<string, Set<IsoDate>>();
    if (tickers.length === 0) return have;
    const rows = await this.prisma.$queryRaw<Array<{ ticker: string; date: Date }>>`
      SELECT i.ticker, b.date
      FROM daily_bar b
      JOIN instrument i ON i.id = b.instrument_id
      WHERE b.date BETWEEN ${from}::date AND ${to}::date
        AND i.ticker = ANY(${[...tickers]}::text[])`;
    for (const row of rows) {
      const days = have.get(row.ticker) ?? new Set<IsoDate>();
      days.add(toIso(row.date));
      have.set(row.ticker, days);
    }
    return have;
  }

  // Grava as barras que faltam. Só INSERT: a que já existe fica como está, e a que chegou com valor diferente é devolvida em `divergent`
  // (quem chama registra o sinal barras-divergentes). Um papel repetido no lote vale uma vez.
  async insertBars(bars: readonly BrapiBar[]): Promise<InsertResult> {
    if (bars.length === 0) return { inserted: 0, divergent: [], unknown: [] };
    const tickers = [...new Set(bars.map((bar) => bar.ticker))];
    return this.prisma.$transaction(async (tx) => {
      const ids = await this.instrumentIds(tx, tickers);
      const known = bars.filter((bar) => ids.has(bar.ticker));
      const existing =
        known.length === 0
          ? []
          : await tx.dailyBar.findMany({
              where: {
                instrumentId: { in: [...ids.values()] },
                date: { in: [...new Set(known.map((bar) => bar.date))].map(toDate) },
              },
              select: {
                instrumentId: true,
                date: true,
                openCents: true,
                highCents: true,
                lowCents: true,
                closeCents: true,
                volumeCents: true,
              },
            });
      const stored = new Map(
        existing.map((row) => [`${row.instrumentId}|${toIso(row.date)}`, row]),
      );

      const fresh = new Map<string, { instrumentId: string; bar: BrapiBar }>();
      const divergent: BarDivergence[] = [];
      for (const bar of known) {
        const instrumentId = ids.get(bar.ticker)!;
        const key = `${instrumentId}|${bar.date}`;
        const row = stored.get(key);
        if (row === undefined) {
          fresh.set(key, { instrumentId, bar });
          continue;
        }
        const fields = FIELDS.filter(([, column]) => row[column] !== bar[column]).map(
          ([field]) => field as string,
        );
        if (fields.length > 0) divergent.push({ ticker: bar.ticker, date: bar.date, fields });
      }

      const rows = [...fresh.values()].sort((a, b) =>
        `${a.instrumentId}${a.bar.date}` < `${b.instrumentId}${b.bar.date}` ? -1 : 1,
      );
      const inserted = await this.insertRows(tx, rows);
      await this.touchLastSeen(tx, rows);
      return { inserted, divergent, unknown: tickers.filter((ticker) => !ids.has(ticker)) };
    }, TRANSACTION);
  }

  private async instrumentIds(
    tx: Prisma.TransactionClient,
    tickers: string[],
  ): Promise<Map<string, string>> {
    const rows = await tx.instrument.findMany({
      where: { ticker: { in: tickers } },
      select: { id: true, ticker: true },
    });
    return new Map(rows.map((row) => [row.ticker, row.id]));
  }

  private async insertRows(
    tx: Prisma.TransactionClient,
    rows: Array<{ instrumentId: string; bar: BrapiBar }>,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    return tx.$executeRaw`
      INSERT INTO daily_bar (id, instrument_id, date, open_cents, high_cents, low_cents, close_cents, volume_cents, source)
      SELECT t.id, t.instrument_id, t.date, t.open_cents::bigint, t.high_cents::bigint, t.low_cents::bigint,
        t.close_cents::bigint, t.volume_cents::bigint, 'BRAPI'::bar_source
      FROM unnest(
        ${rows.map(() => newId())}::text[],
        ${rows.map((r) => r.instrumentId)}::text[],
        ${rows.map((r) => r.bar.date)}::date[],
        ${text(rows.map((r) => r.bar.openCents))}::text[],
        ${text(rows.map((r) => r.bar.highCents))}::text[],
        ${text(rows.map((r) => r.bar.lowCents))}::text[],
        ${text(rows.map((r) => r.bar.closeCents))}::text[],
        ${text(rows.map((r) => r.bar.volumeCents))}::text[]
      ) AS t(id, instrument_id, date, open_cents, high_cents, low_cents, close_cents, volume_cents)
      ON CONFLICT (instrument_id, date) DO NOTHING`;
  }

  // O último pregão em que o papel apareceu (só avança).
  private async touchLastSeen(
    tx: Prisma.TransactionClient,
    rows: Array<{ instrumentId: string; bar: BrapiBar }>,
  ): Promise<void> {
    const latest = new Map<string, IsoDate>();
    for (const { instrumentId, bar } of rows) {
      const seen = latest.get(instrumentId);
      if (seen === undefined || bar.date > seen) latest.set(instrumentId, bar.date);
    }
    if (latest.size === 0) return;
    await tx.$executeRaw`
      UPDATE instrument SET last_seen = t.day
      FROM unnest(${[...latest.keys()]}::text[], ${[...latest.values()]}::date[]) AS t(id, day)
      WHERE instrument.id = t.id AND instrument.last_seen < t.day`;
  }

  // Os pregões que já estão confirmados. O CALENDAR é só previsão.
  async confirmedDays(days: readonly IsoDate[]): Promise<Set<IsoDate>> {
    if (days.length === 0) return new Set();
    const rows = await this.prisma.tradingDay.findMany({
      where: { date: { in: days.map(toDate) }, source: { not: 'CALENDAR' } },
      select: { date: true },
    });
    return new Set(rows.map((row) => toIso(row.date)));
  }

  // Confirma os dias como pregão visto pela brapi. Só vale dia com barra gravada (o banco confere aqui: um dia sem nenhuma barra seria
  // "confirmado" sem dado e o universo o contaria), e nunca rebaixa nem reescreve dia já confirmado. Devolve os dias que foram confirmados
  // agora.
  async confirmTradingDays(days: readonly IsoDate[]): Promise<IsoDate[]> {
    if (days.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Array<{ date: Date }>>`
      INSERT INTO trading_day (date, source)
      SELECT d, 'BRAPI'::trading_day_source FROM unnest(${[...days]}::date[]) AS d
      WHERE EXISTS (SELECT 1 FROM daily_bar b WHERE b.date = d)
      ON CONFLICT (date) DO UPDATE SET source = 'BRAPI'
      WHERE trading_day.source = 'CALENDAR'
      RETURNING date`;
    return rows.map((row) => toIso(row.date)).sort();
  }

  // Dias previstos pela lista de feriados. Nunca rebaixa um dia já confirmado. Devolve quantos criou.
  async seedCalendar(days: IsoDate[]): Promise<number> {
    if (days.length === 0) return 0;
    return this.prisma.$executeRaw`
      INSERT INTO trading_day (date, source)
      SELECT d, 'CALENDAR'::trading_day_source FROM unnest(${days}::date[]) AS d
      ON CONFLICT (date) DO NOTHING`;
  }

  // Os papéis em posição na última liquidação das temporadas em andamento (modelos, Sorteio e referências): precisam de marcação mesmo
  // fora do universo da semana. A data mais nova sai uma vez por temporada (LATERAL): a subconsulta correlacionada por posição era
  // O(n²) e passava do statement_timeout do worker (60 s) com uns 20 mil registros (teste de integração).
  async heldTickers(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ ticker: string }>>`
      SELECT DISTINCT p.ticker
      FROM season s
      CROSS JOIN LATERAL (SELECT max(q.date) AS date FROM "position" q WHERE q.season_id = s.id) latest
      JOIN "position" p ON p.season_id = s.id AND p.date = latest.date
      WHERE s.status = 'RUNNING'
      ORDER BY p.ticker`;
    return rows.map((row) => row.ticker);
  }

  // Os papéis das carteiras dos usuários (portfolio_lot). Só o ticker: nenhum dado pessoal sai daqui. SQL cru porque o `distinct` do
  // Prisma 7 não vira DISTINCT: lê todos os lançamentos e deduplica no Node.
  async portfolioTickers(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ ticker: string }>>`
      SELECT DISTINCT ticker FROM portfolio_lot ORDER BY ticker`;
    return rows.map((row) => row.ticker);
  }
}
