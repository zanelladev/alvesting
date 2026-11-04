import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { IsoDate } from '../../market-data/domain/dates.js';
import type { MacroPoint } from '../domain/bcb.js';

// macro_daily: uma linha por (série, data do valor). O valor é NUMERIC: o texto decimal do BCB entra e sai sem float.
@Injectable()
export class MacroRepository {
  constructor(private readonly prisma: PrismaService) {}

  // A última data guardada de cada série: o que falta buscar começa no dia seguinte.
  async lastDates(): Promise<Map<string, IsoDate>> {
    const rows = await this.prisma.macroDaily.groupBy({ by: ['series'], _max: { date: true } });
    const result = new Map<string, IsoDate>();
    for (const row of rows) {
      if (row._max.date) result.set(row.series, row._max.date.toISOString().slice(0, 10));
    }
    return result;
  }

  // Devolve quantas linhas foram criadas ou alteradas: 0 quando os mesmos pontos chegam de novo. O BCB pode revisar
  // um valor, e então a linha é atualizada.
  async savePoints(series: string, points: readonly MacroPoint[]): Promise<number> {
    if (points.length === 0) return 0;
    return this.prisma.$executeRaw`
      INSERT INTO macro_daily (series, date, value)
      SELECT ${series}, t.date, t.value::numeric
      FROM unnest(${points.map((p) => p.date)}::date[], ${points.map((p) => p.value)}::text[]) AS t(date, value)
      ON CONFLICT (series, date) DO UPDATE SET value = EXCLUDED.value
      WHERE macro_daily.value IS DISTINCT FROM EXCLUDED.value`;
  }
}
