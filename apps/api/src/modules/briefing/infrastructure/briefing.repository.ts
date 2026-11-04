import { Injectable } from '@nestjs/common';
import { seasonParamsSchema, type SeasonParams } from '@alvesting/contracts';
import { newId } from '../../../common/id.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { MACRO_SERIES } from '../../news/domain/bcb.js';
import type { BarRow, MacroValue, NewsRow, UniverseRow } from '../domain/briefing.js';

const toDate = (day: IsoDate): Date => new Date(`${day}T00:00:00Z`);
const toIso = (date: Date): IsoDate => date.toISOString().slice(0, 10);

export interface StoredBriefing {
  date: IsoDate;
  sha256: string;
  uri: string;
}

// NUMERIC(18,8) sai com oito casas ("0.05078800"); a série publica com as dela. As casas a mais são zeros, porque o
// valor entrou com as da série (domain/bcb.ts).
function atScale(value: string, scale: number): string {
  const [whole = '', fraction = ''] = value.split('.');
  if (/[1-9]/.test(fraction.slice(scale))) {
    throw new Error(`macro_daily tem mais casas que as ${scale} da série`);
  }
  return scale > 0 ? `${whole}.${fraction.padEnd(scale, '0').slice(0, scale)}` : whole;
}

// Leituras que montam o retrato do briefing e a linha do briefing congelado. Só lê o que o freeze precisa; quem escreve
// universo, barras, macro e notícias são os outros módulos.
@Injectable()
export class BriefingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(date: IsoDate): Promise<StoredBriefing | null> {
    const row = await this.prisma.briefing.findUnique({ where: { date: toDate(date) } });
    return row ? { date: toIso(row.date), sha256: row.sha256, uri: row.uri } : null;
  }

  // O último briefing congelado antes de `date`: de onde as notícias do próximo começam.
  async latestBefore(date: IsoDate): Promise<IsoDate | null> {
    const row = await this.prisma.briefing.findFirst({
      where: { date: { lt: toDate(date) } },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    return row ? toIso(row.date) : null;
  }

  // O primeiro briefing congelado depois de `date`, se houver: congelar `date` depois dele repetiria as notícias dele.
  async firstAfter(date: IsoDate): Promise<IsoDate | null> {
    const row = await this.prisma.briefing.findFirst({
      where: { date: { gt: toDate(date) } },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    return row ? toIso(row.date) : null;
  }

  // Os parâmetros das temporadas RUNNING que já começaram no pregão: de onde saem as regras que o briefing anuncia. Validados
  // pelo schema da temporada: um JSON torto no banco derruba o freeze em vez de virar regra errada.
  async runningSeasons(date: IsoDate): Promise<SeasonParams[]> {
    const rows = await this.prisma.season.findMany({
      where: { status: 'RUNNING', startDate: { lte: toDate(date) } },
      orderBy: { createdAt: 'asc' },
      select: { params: true },
    });
    return rows.map((row) => seasonParamsSchema.parse(row.params));
  }

  // O universo congelado da semana; null se a semana não tem (não se usa o de outra semana).
  async universe(week: string): Promise<UniverseRow[] | null> {
    const snapshot = await this.prisma.universeSnapshot.findUnique({
      where: { week },
      select: {
        members: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            avgVolumeCents: true,
            instrument: { select: { ticker: true, name: true } },
          },
        },
      },
    });
    if (!snapshot) return null;
    return snapshot.members.map((member) => ({
      ticker: member.instrument.ticker,
      name: member.instrument.name,
      position: member.position,
      avgVolumeCents: member.avgVolumeCents,
    }));
  }

  // As barras dos tickers entre as duas datas (inclusive), por ticker. Qualquer origem (a BRAPI, e a barra
  // legada que o banco de dev ainda tem).
  async bars(
    tickers: readonly string[],
    from: IsoDate,
    to: IsoDate,
  ): Promise<Map<string, BarRow[]>> {
    const result = new Map<string, BarRow[]>();
    if (tickers.length === 0) return result;
    const rows = await this.prisma.dailyBar.findMany({
      where: {
        date: { gte: toDate(from), lte: toDate(to) },
        instrument: { ticker: { in: [...tickers] } },
      },
      select: {
        date: true,
        openCents: true,
        highCents: true,
        lowCents: true,
        closeCents: true,
        volumeCents: true,
        instrument: { select: { ticker: true } },
      },
    });
    for (const row of rows) {
      const list = result.get(row.instrument.ticker) ?? [];
      list.push({
        date: toIso(row.date),
        openCents: row.openCents,
        highCents: row.highCents,
        lowCents: row.lowCents,
        closeCents: row.closeCents,
        volumeCents: row.volumeCents,
      });
      result.set(row.instrument.ticker, list);
    }
    return result;
  }

  // O valor mais recente de cada série da lista fixa até a data (inclusive).
  async macro(asOf: IsoDate): Promise<MacroValue[]> {
    const rows = await this.prisma.$queryRaw<Array<{ series: string; date: Date; value: string }>>`
      SELECT DISTINCT ON (series) series, date, value::text AS value
      FROM macro_daily
      WHERE date <= ${asOf}::date
      ORDER BY series, date DESC`;
    const result: MacroValue[] = [];
    for (const row of rows) {
      const series = MACRO_SERIES.find((candidate) => candidate.id === row.series);
      if (series) {
        result.push({
          series: series.id,
          date: toIso(row.date),
          value: atScale(row.value, series.scale),
        });
      }
    }
    return result;
  }

  // As notícias vistas pela primeira vez em (after, until]: aberto no começo, fechado no fim. Dois intervalos
  // seguidos nunca repetem nem perdem uma notícia, e cada uma entra em exatamente um briefing.
  async news(after: Date, until: Date): Promise<NewsRow[]> {
    const rows = await this.prisma.newsItem.findMany({
      where: { firstSeenAt: { gt: after, lte: until } },
      select: {
        source: true,
        publishedAt: true,
        title: true,
        snippet: true,
        tickers: true,
        urlHash: true,
      },
    });
    return rows.map((row) => ({ ...row }));
  }

  // 'exists': já há briefing para o pregão (o congelado nunca é refeito).
  async save(input: {
    date: IsoDate;
    sha256: string;
    uri: string;
    bytes: number;
  }): Promise<'created' | 'exists'> {
    try {
      await this.prisma.briefing.create({
        data: {
          id: newId(),
          date: toDate(input.date),
          sha256: input.sha256,
          uri: input.uri,
          bytes: input.bytes,
        },
      });
      return 'created';
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'exists';
      }
      throw error;
    }
  }
}
