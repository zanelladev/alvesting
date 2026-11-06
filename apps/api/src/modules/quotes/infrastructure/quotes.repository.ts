import {
  INTERNAL_BARS_LIMIT,
  type InternalBars,
  type InternalTape,
  type InternalTapeRow,
} from '@alvesting/contracts';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { findPublicSeason } from '../../arena/infrastructure/cycle-view.repository.js';
import { LIMITS } from '../../briefing/domain/briefing.js';
import { isoWeek } from '../../market-data/domain/dates.js';
import { safeNumber } from '../../settlement/domain/money.js';

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

// Até onde a fita olha para trás atrás de um pregão com a cobertura do briefing: a semana de calendário até o pregão do ciclo (até 5 pregões).
// ponytail: uma semana. Na operação normal o único pregão pela metade é o da carga do dia; uma semana inteira abaixo da cobertura é o eod
// quebrado (o briefing também não congela), e a fita vazia (o BOVA11 e o macro, no site) é o que há para mostrar. A janela de datas também
// limita a contagem: nunca passa de uma semana de barras do universo, por maior que fique o histórico.
const TAPE_LOOKBACK_MS = 7 * 86_400_000;

// As cotações das rotas internas do site (docs/API.md, seção 6). Só leitura, com as colunas listadas (nunca o volume, a fonte nem o id).
@Injectable()
export class QuotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // As barras de preço de um papel: as 60 mais recentes, da mais antiga à mais nova. Vale para qualquer papel de `instrument`, o BOVA11 (a
  // referência) inclusive. Papel desconhecido ou sem barra: lista vazia. O ticker é único, então a consulta entra pelo índice dele e depois
  // pelo de (papel, pregão): 60 linhas.
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
        date: isoDay(bar.date),
        openCents: safeNumber(bar.openCents),
        highCents: safeNumber(bar.highCents),
        lowCents: safeNumber(bar.lowCents),
        closeCents: safeNumber(bar.closeCents),
      })),
    };
  }

  // A fita da home: o universo da semana do último ciclo da temporada atual (a mesma da home: a em andamento, ou a última encerrada), na
  // ordem do universo, com o fechamento do pregão `date` e o do pregão anterior com barra (nulo para o papel sem barra nele). `date` é o
  // pregão mais recente até o do ciclo com a cobertura mínima do briefing (LIMITS.coverageMinPercent do universo com barra): de manhã, o
  // anterior ao ciclo, que é o do briefing; depois da carga do fim do dia, o do ciclo. No meio da carga (o eod grava papel a papel e se
  // reagenda de hora em hora se falta papel) o pregão do ciclo tem barra de só parte do universo, e a fita e a legenda, que conta as linhas,
  // mostrariam esse pedaço: ficam no anterior até a carga passar da cobertura. O papel sem barra no pregão `date` fica de fora. Sem
  // temporada, ciclo, universo ou pregão com a cobertura: a resposta vazia.
  // ponytail: seis consultas pequenas (a contagem de barras por pregão de uma semana, até 2.500 linhas agrupadas, e no máximo 2 barras por
  // papel do universo, umas 1.000), uma vez a cada 5 minutos por réplica do site (o cache de dados dele). Se pesar: uma consulta só, com o
  // LATERAL do anterior.
  async tape(): Promise<InternalTape> {
    const empty: InternalTape = { date: null, rows: [] };
    const season = await findPublicSeason(this.prisma);
    if (!season) return empty;
    const cycle = await this.prisma.cycle.findFirst({
      where: { seasonId: season.id },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    if (!cycle) return empty;
    const snapshot = await this.prisma.universeSnapshot.findUnique({
      where: { week: isoWeek(isoDay(cycle.date)) },
      select: {
        members: {
          orderBy: { position: 'asc' },
          select: { instrumentId: true, instrument: { select: { ticker: true } } },
        },
      },
    });
    const members = snapshot?.members ?? [];
    if (members.length === 0) return empty;
    const ids = members.map((member) => member.instrumentId);
    // quantos papéis do universo têm barra em cada pregão da semana até o do ciclo (o índice de daily_bar.date, no intervalo)
    const sessions = await this.prisma.dailyBar.groupBy({
      by: ['date'],
      where: {
        instrumentId: { in: ids },
        date: { gt: new Date(cycle.date.getTime() - TAPE_LOOKBACK_MS), lte: cycle.date },
      },
      orderBy: { date: 'desc' },
      _count: { _all: true },
    });
    const last = sessions.find(
      (session) => session._count._all * 100 >= ids.length * LIMITS.coverageMinPercent,
    );
    if (!last) return empty;
    // o pregão anterior com barra de algum papel do universo
    const previous = await this.prisma.dailyBar.findFirst({
      where: { instrumentId: { in: ids }, date: { lt: last.date } },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    const bars = await this.prisma.dailyBar.findMany({
      where: {
        instrumentId: { in: ids },
        date: { in: previous ? [last.date, previous.date] : [last.date] },
      },
      select: { instrumentId: true, date: true, closeCents: true },
    });
    const closesOn = (date: Date | undefined) =>
      new Map(
        bars
          .filter((bar) => bar.date.getTime() === date?.getTime())
          .map((bar) => [bar.instrumentId, bar.closeCents]),
      );
    const closes = closesOn(last.date);
    const previousCloses = closesOn(previous?.date);
    const rows: InternalTapeRow[] = [];
    for (const member of members) {
      const close = closes.get(member.instrumentId);
      if (close === undefined) continue;
      const before = previousCloses.get(member.instrumentId);
      rows.push({
        ticker: member.instrument.ticker,
        closeCents: safeNumber(close),
        previousCloseCents: before === undefined ? null : safeNumber(before),
      });
    }
    return { date: isoDay(last.date), rows };
  }
}
