import { Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, appendAudit } from '../../../common/audit.js';
import { newId } from '../../../common/id.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { MACRO_SERIES } from '../../news/domain/bcb.js';
import type { CdiPoint } from '../domain/cdi.js';
import type { CorporateEvent } from '../domain/corporate-events.js';

const toDate = (day: IsoDate): Date => new Date(`${day}T00:00:00Z`);
const toIso = (date: Date): IsoDate => date.toISOString().slice(0, 10);

// A série 12 do SGS: o CDI que rende o caixa (macro_daily.series é o nome dela na lista fixa). Se ela sair da lista, a liquidação
// não sobe: ler outra série em silêncio daria um patrimônio errado e com cara de certo.
const CDI_SERIES = (() => {
  const series = MACRO_SERIES.find((candidate) => candidate.code === 12);
  if (!series)
    throw new Error(
      'A série 12 do SGS (CDI) não está em MACRO_SERIES: a liquidação não tem taxa para o caixa',
    );
  return series.id;
})();
// NUMERIC(18,8): o texto sai com as oito casas, e o domínio (parseCdi) aceita até oito.
const CDI_DECIMALS = 8;

// O cliente da transação: tudo o que a liquidação lê e grava de uma temporada acontece dentro da trava dela.
export type Db = Prisma.TransactionClient;

// A transação cobre ler, calcular e gravar (menos de um segundo por temporada de 20 pregões), então o prazo é folgado e o que
// espera pela trava de outra liquidação da mesma temporada espera dentro dele.
const TRANSACTION = { maxWait: 15_000, timeout: 120_000 };

// Trava consultiva de transação: solta sozinha no commit, no rollback e quando a conexão cai. A chave vira um inteiro de 64 bits.
const lockBy = (db: Db, key: string) =>
  db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;

// Linhas por createMany: dez colunas por linha ficam bem abaixo do limite de parâmetros do Postgres.
const CHUNK = 1000;
const chunks = <T>(rows: readonly T[]): T[][] => {
  const parts: T[][] = [];
  for (let from = 0; from < rows.length; from += CHUNK) parts.push(rows.slice(from, from + CHUNK));
  return parts;
};

export interface SettlementCompetitor {
  id: string;
  slug: string;
  kind: 'MODEL' | 'RANDOM' | 'BENCHMARK';
  benchmark: 'EQUAL_WEIGHT' | 'CDI' | 'BOVA11' | null;
}

// Um item da decisão que valeu (nunca o descartado). `percent` é o Decimal(7,4) do banco como texto: nulo no HOLD.
export interface DecisionItemRow {
  id: string;
  competitorId: string;
  date: IsoDate;
  position: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  ticker: string;
  percent: string | null;
  rationale: string;
}

export interface BarRow {
  date: IsoDate;
  ticker: string;
  openCents: bigint;
  closeCents: bigint;
}

// O que uma liquidação grava, no formato do createMany de cada tabela.
export interface DerivedRows {
  orders: Prisma.OrderCreateManyInput[];
  fills: Prisma.FillCreateManyInput[];
  positions: Prisma.PositionCreateManyInput[];
  snapshots: Prisma.EquitySnapshotCreateManyInput[];
  stats: Prisma.SeasonStatCreateManyInput[];
  baselines: Prisma.RandomBaselineCreateManyInput[];
}

export interface EventInput {
  ticker: string;
  exDate: IsoDate;
  kind: 'SPLIT' | 'REVERSE_SPLIT' | 'BONUS';
  ratioFrom: number;
  ratioTo: number;
}

// Acesso ao banco da liquidação (etapa 7). A liquidação recalcula a temporada do zero, então o repositório só lê as fontes
// (decisões, barras, universo, CDI e eventos) e SUBSTITUI as linhas derivadas, tudo dentro da transação com a trava consultiva da
// temporada (`locked`). Regra de negócio fica no SettleHandler e no domínio.
@Injectable()
export class SettlementRepository {
  constructor(private readonly prisma: PrismaService) {}

  // A temporada inteira numa transação que segura a trava consultiva dela até o commit (ou o rollback). Duas liquidações da mesma
  // temporada, de réplicas diferentes, se enfileiram aqui: a segunda lê depois que a primeira gravou. Se a leitura ficasse fora
  // da trava, a liquidação que leu antes e gravou depois apagaria o resultado da que leu os dados mais novos. A trava é por
  // temporada: temporadas diferentes liquidam ao mesmo tempo.
  //
  // O Monte Carlo é CPU síncrona entre duas consultas: a conexão fica "ociosa em transação", e o pool (PrismaService) derruba quem
  // passa de 30 s assim. No worker de 0,5 vCPU o teto do contrato (10.000 carteiras) pode passar disso, e o erro enganoso
  // ("connection error") se repetiria a cada entrega até a DLQ. Por isso a transação da trava ganha o mesmo prazo do próprio
  // $transaction; o ajuste é local, e vale só até o commit.
  locked<T>(seasonId: string, work: (db: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (db) => {
      await lockBy(db, `settle:${seasonId}`);
      await db.$executeRaw`SELECT set_config('idle_in_transaction_session_timeout', ${`${TRANSACTION.timeout}ms`}, true)`;
      return work(db);
    }, TRANSACTION);
  }

  // --- leituras (dentro da trava) -----------------------------------------------------------------------------------

  // O último pregão com liquidação gravada, ou nulo se a temporada nunca foi liquidada.
  async lastSettledDate(db: Db, seasonId: string): Promise<IsoDate | null> {
    const row = await db.equitySnapshot.aggregate({ where: { seasonId }, _max: { date: true } });
    return row._max.date ? toIso(row._max.date) : null;
  }

  async competitors(db: Db, seasonId: string): Promise<SettlementCompetitor[]> {
    const rows = await db.competitor.findMany({
      where: { seasonId },
      orderBy: { position: 'asc' },
      select: { id: true, slug: true, kind: true, benchmark: true },
    });
    return rows;
  }

  // Os itens que valeram (dropped = false) dos ciclos da temporada até `to`, por pregão, competidor e posição na lista do modelo.
  // O descartado nunca chega à liquidação (docs/ARENA.md, seção 10).
  async decisionItems(db: Db, seasonId: string, to: IsoDate): Promise<DecisionItemRow[]> {
    const rows = await db.decisionItem.findMany({
      where: { dropped: false, decision: { cycle: { seasonId, date: { lte: toDate(to) } } } },
      select: {
        id: true,
        position: true,
        action: true,
        ticker: true,
        percent: true,
        rationale: true,
        decision: { select: { competitorId: true, cycle: { select: { date: true } } } },
      },
    });
    return rows
      .map((row) => {
        // o CHECK do banco garante ação, ticker e texto no item que valeu; isto só estreita o tipo
        if (row.action === null || row.ticker === null || row.rationale === null) {
          throw new Error(`decision_item ${row.id} sem ação, ticker ou texto: dado corrompido`);
        }
        return {
          id: row.id,
          competitorId: row.decision.competitorId,
          date: toIso(row.decision.cycle.date),
          position: row.position,
          action: row.action,
          ticker: row.ticker,
          percent: row.percent === null ? null : row.percent.toString(),
          rationale: row.rationale,
        };
      })
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.competitorId.localeCompare(b.competitorId) ||
          a.position - b.position,
      );
  }

  // Todas as barras do intervalo (de qualquer papel, de qualquer origem): quem pode estar na carteira de alguém, no
  // universo ou na referência. Só abertura e fechamento importam à liquidação.
  async bars(db: Db, from: IsoDate, to: IsoDate): Promise<BarRow[]> {
    const rows = await db.dailyBar.findMany({
      where: { date: { gte: toDate(from), lte: toDate(to) } },
      select: {
        date: true,
        openCents: true,
        closeCents: true,
        instrument: { select: { ticker: true } },
      },
    });
    return rows.map((row) => ({
      date: toIso(row.date),
      ticker: row.instrument.ticker,
      openCents: row.openCents,
      closeCents: row.closeCents,
    }));
  }

  // O universo congelado de cada semana pedida; a semana sem snapshot não aparece (quem chama decide o que fazer).
  async universes(db: Db, weeks: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await db.universeSnapshot.findMany({
      where: { week: { in: [...weeks] } },
      select: { week: true, members: { select: { instrument: { select: { ticker: true } } } } },
    });
    return new Map(rows.map((row) => [row.week, row.members.map((m) => m.instrument.ticker)]));
  }

  // O CDI (% ao dia) publicado até `to`, em ordem de data, como texto de oito casas: nunca float.
  // ponytail: lê a série inteira até `to`, sem limite inferior. É um ponto por dia útil, e a primeira carga do macro traz uns 400
  // dias e depois só acrescenta (bcb.ts, FIRST_LOAD_DAYS), então são algumas centenas de linhas. Sem limite, a taxa de um pregão
  // ainda é achada mesmo que a série tenha parado de atualizar. Com a história desde 1986 (uns 10 mil pontos), limitar a
  // `date >= início da temporada - alguns dias úteis`.
  async cdi(db: Db, to: IsoDate): Promise<CdiPoint[]> {
    const rows = await db.macroDaily.findMany({
      where: { series: CDI_SERIES, date: { lte: toDate(to) } },
      orderBy: { date: 'asc' },
      select: { date: true, value: true },
    });
    return rows.map((row) => ({ date: toIso(row.date), pct: row.value.toFixed(CDI_DECIMALS) }));
  }

  async events(db: Db, from: IsoDate, to: IsoDate): Promise<CorporateEvent[]> {
    const rows = await db.corporateEvent.findMany({
      where: { exDate: { gte: toDate(from), lte: toDate(to) } },
      orderBy: [{ exDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEvent);
  }

  // --- escrita (dentro da trava) ------------------------------------------------------------------------------------

  // Substitui as linhas derivadas da temporada pelas novas. As execuções saem junto com as ordens (cascade). Qualquer erro
  // desfaz a transação inteira, e a liquidação anterior continua como estava.
  async replace(db: Db, seasonId: string, rows: DerivedRows): Promise<void> {
    await db.order.deleteMany({ where: { seasonId } });
    await db.position.deleteMany({ where: { seasonId } });
    await db.equitySnapshot.deleteMany({ where: { seasonId } });
    await db.seasonStat.deleteMany({ where: { seasonId } });
    await db.randomBaseline.deleteMany({ where: { seasonId } });

    for (const data of chunks(rows.orders)) await db.order.createMany({ data });
    for (const data of chunks(rows.fills)) await db.fill.createMany({ data });
    for (const data of chunks(rows.positions)) await db.position.createMany({ data });
    for (const data of chunks(rows.snapshots)) await db.equitySnapshot.createMany({ data });
    for (const data of chunks(rows.stats)) await db.seasonStat.createMany({ data });
    for (const data of chunks(rows.baselines)) await db.randomBaseline.createMany({ data });
  }

  // RUNNING -> FINISHED, com a hora. O UPDATE condicional é a trava: a segunda vez (ou o rascunho) não muda nada.
  async finishSeason(db: Db, seasonId: string, at: Date): Promise<boolean> {
    const done = await db.season.updateMany({
      where: { id: seasonId, status: 'RUNNING' },
      data: { status: 'FINISHED', finishedAt: at },
    });
    return done.count === 1;
  }

  // --- fora da trava ------------------------------------------------------------------------------------------------

  // Por temporada, o último pregão liquidado: de onde a reliquidação de um evento corporativo parte.
  async settledThrough(): Promise<Array<{ seasonId: string; slug: string; through: IsoDate }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ seasonId: string; slug: string; through: Date }>
    >`
      SELECT e.season_id AS "seasonId", s.slug, MAX(e.date) AS through
      FROM equity_snapshot e JOIN season s ON s.id = e.season_id
      GROUP BY e.season_id, s.slug, s.created_at
      ORDER BY s.created_at, s.slug`;
    return rows.map((row) => ({
      seasonId: row.seasonId,
      slug: row.slug,
      through: toIso(row.through),
    }));
  }

  async instrumentExists(ticker: string): Promise<boolean> {
    return (await this.prisma.instrument.count({ where: { ticker } })) > 0;
  }

  // Registra o evento, ou corrige o fator do mesmo ticker, data ex e tipo. Repetir o mesmo comando não muda nada.
  //
  // Corrigir o fator muda, retroativamente, o resultado publicado da arena, e o evento não guarda o valor antigo: a criação e a
  // correção deixam uma linha em audit_log (quem, e o fator antigo e o novo) na mesma transação. A trava consultiva do evento
  // faz dois registros simultâneos do mesmo evento se enfileirarem, e o segundo lê o que o primeiro gravou, em vez de estourar o
  // erro cru de chave duplicada (P2002).
  upsertEvent(
    input: EventInput,
    actor: string,
  ): Promise<{ event: CorporateEvent; change: 'created' | 'updated' | 'unchanged' }> {
    const target = `${input.ticker}:${input.exDate}:${input.kind}`;
    const where = {
      ticker_exDate_kind: { ticker: input.ticker, exDate: toDate(input.exDate), kind: input.kind },
    };
    const after = { from: input.ratioFrom, to: input.ratioTo };
    return this.prisma.$transaction(async (db) => {
      await lockBy(db, `event:${target}`);
      const existing = await db.corporateEvent.findUnique({ where });
      if (existing && existing.ratioFrom === after.from && existing.ratioTo === after.to) {
        return { event: toEvent(existing), change: 'unchanged' };
      }
      const row = existing
        ? await db.corporateEvent.update({
            where,
            data: { ratioFrom: after.from, ratioTo: after.to },
          })
        : await db.corporateEvent.create({
            data: {
              id: newId(),
              ticker: input.ticker,
              exDate: toDate(input.exDate),
              kind: input.kind,
              ratioFrom: after.from,
              ratioTo: after.to,
            },
          });
      await appendAudit(
        db,
        {
          actor,
          action: existing
            ? AUDIT_ACTIONS.corporateEventUpdated
            : AUDIT_ACTIONS.corporateEventCreated,
          detail: {
            ticker: input.ticker,
            exDate: input.exDate,
            kind: input.kind,
            before: existing ? { from: existing.ratioFrom, to: existing.ratioTo } : null,
            after,
          },
        },
        target,
      );
      return { event: toEvent(row), change: existing ? 'updated' : 'created' };
    });
  }
}

const toEvent = (row: {
  id: string;
  ticker: string;
  exDate: Date;
  ratioFrom: number;
  ratioTo: number;
}): CorporateEvent => ({
  id: row.id,
  ticker: row.ticker,
  exDate: toIso(row.exDate),
  from: BigInt(row.ratioFrom),
  to: BigInt(row.ratioTo),
});
