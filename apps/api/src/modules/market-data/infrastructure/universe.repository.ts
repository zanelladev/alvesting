import { Injectable } from '@nestjs/common';
import { newId } from '../../../common/id.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { IsoDate } from '../domain/dates.js';
import type { UniverseSelection, VolumeStat } from '../domain/universe.js';

const toDate = (day: IsoDate): Date => new Date(`${day}T00:00:00Z`);
const toIso = (date: Date): IsoDate => date.toISOString().slice(0, 10);

export interface SnapshotInput {
  week: string; // 2026-W45
  windowStart: IsoDate;
  windowEnd: IsoDate;
  windowDays: number;
  selection: UniverseSelection;
}

@Injectable()
export class UniverseRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Os pregões confirmados (pela brapi, ou os legados que o banco de dev já traz) em [from, before) (before não entra), do mais antigo
  // ao mais novo. Dia só previsto pela lista de feriados (CALENDAR) não conta: ainda não tem cotação. É um intervalo e não "os N mais
  // recentes" porque, com um buraco na janela, os N mais recentes puxariam para dentro um dia mais velho.
  async confirmedDaysBetween(from: IsoDate, before: IsoDate): Promise<IsoDate[]> {
    const rows = await this.prisma.tradingDay.findMany({
      where: { source: { not: 'CALENDAR' }, date: { gte: toDate(from), lt: toDate(before) } },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    return rows.map((row) => toIso(row.date));
  }

  // Volume somado e pregões com negócio de cada ação na janela. Só entram ações (a referência BOVA11 não) e só cotadas por unidade
  // (quote_factor = 1: GOLL54 e AZUL53 ficaram no banco de dev, de antes da brapi, com preço truncado). Vale a barra de qualquer origem: o
  // volume da brapi é estimado (quantidade x fechamento, docs/DADOS.md, seção 6) e o das barras legadas que o dev ainda traz é o financeiro.
  async volumeStats(days: IsoDate[]): Promise<VolumeStat[]> {
    if (days.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{ instrumentId: string; ticker: string; total: string; presence: number }>
    >`
      SELECT i.id AS "instrumentId", i.ticker, SUM(b.volume_cents)::text AS total, COUNT(*)::int AS presence
      FROM daily_bar b
      JOIN instrument i ON i.id = b.instrument_id
      WHERE b.date = ANY(${days}::date[])
        AND i.kind = 'STOCK'
        AND i.quote_factor = 1
      GROUP BY i.id, i.ticker`;
    return rows.map((row) => ({
      instrumentId: row.instrumentId,
      ticker: row.ticker,
      totalVolumeCents: BigInt(row.total),
      presenceDays: row.presence,
    }));
  }

  // O universo da semana é congelado: week é único, e quem chega depois de a semana já ter snapshot só o reconhece.
  async saveSnapshot(input: SnapshotInput): Promise<'created' | 'exists'> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const snapshotId = newId();
          await tx.universeSnapshot.create({
            data: {
              id: snapshotId,
              week: input.week,
              windowStart: toDate(input.windowStart),
              windowEnd: toDate(input.windowEnd),
              windowDays: input.windowDays,
              candidates: input.selection.candidates,
              eligible: input.selection.eligible,
            },
          });
          await tx.universeMember.createMany({
            data: input.selection.members.map((member) => ({
              id: newId(),
              snapshotId,
              instrumentId: member.instrumentId,
              position: member.position,
              avgVolumeCents: member.avgVolumeCents,
              presenceDays: member.presenceDays,
            })),
          });
        },
        { timeout: 60_000 },
      );
      return 'created';
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return 'exists';
      }
      throw error;
    }
  }

  // Os tickers do universo que vale na semana: o dela ou, se ainda não existe, o da última semana anterior.
  async tickersOf(week: string): Promise<string[]> {
    const snapshot = await this.prisma.universeSnapshot.findFirst({
      where: { week: { lte: week } },
      orderBy: { week: 'desc' },
      select: {
        members: {
          orderBy: { position: 'asc' },
          select: { instrument: { select: { ticker: true } } },
        },
      },
    });
    return snapshot?.members.map((member) => member.instrument.ticker) ?? [];
  }
}
