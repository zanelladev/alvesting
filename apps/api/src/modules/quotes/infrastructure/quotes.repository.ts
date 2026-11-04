import { INTERNAL_BARS_LIMIT, type InternalBars } from '@alvesting/contracts';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { safeNumber } from '../../settlement/domain/money.js';

// As barras de preço de um papel, para a rota interna do site (docs/API.md, seção 6). Só leitura, com as colunas listadas (nunca o volume, a
// fonte nem o id). Vale para qualquer papel de `instrument`, o BOVA11 (a referência) inclusive. O ticker é único, então a consulta entra
// pelo índice dele e depois pelo de (papel, pregão): 60 linhas.
@Injectable()
export class QuotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // As 60 mais recentes, da mais antiga à mais nova. Papel desconhecido ou sem barra: lista vazia.
  // ponytail: a junção com o ticker ordena as barras de UM papel (uns 65 com a janela de 3 meses; 0,28 ms medido, docs/API.md, seção 4). Com alguns
  // milhares de barras por papel e a consulta pesando: buscar o id do papel primeiro e ordenar por (instrument_id, date DESC), que o índice único atende.
  async bars(ticker: string): Promise<InternalBars> {
    const rows = await this.prisma.dailyBar.findMany({
      where: { instrument: { ticker } },
      orderBy: { date: 'desc' },
      take: INTERNAL_BARS_LIMIT,
      select: { date: true, openCents: true, highCents: true, lowCents: true, closeCents: true },
    });
    return {
      bars: rows.reverse().map((bar) => ({
        date: bar.date.toISOString().slice(0, 10),
        openCents: safeNumber(bar.openCents),
        highCents: safeNumber(bar.highCents),
        lowCents: safeNumber(bar.lowCents),
        closeCents: safeNumber(bar.closeCents),
      })),
    };
  }
}
