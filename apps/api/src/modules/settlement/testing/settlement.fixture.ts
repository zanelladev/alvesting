// Dados sintéticos dos testes da liquidação. Nada aqui vem de B3, brapi, BCB, CVM nem de site de notícia: os tickers são só
// formato de ticker, e preços, universo, CDI e decisões são inventados (a planilha conferida à mão é a de
// domain/fixtures/hand-checked.fixture.ts). Fica fora do build (*.fixture.ts).
import { seasonFileSchema, type SeasonParams } from '@alvesting/contracts';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { ArenaRepository } from '../../arena/infrastructure/arena.repository.js';
import { PROMPT_VERSION, seasonFile } from '../../arena/testing/arena.fixture.js';
import { isoWeek, type IsoDate } from '../../market-data/domain/dates.js';
import {
  HAND_CHECKED_CAPITAL_CENTS,
  HAND_CHECKED_COMPETITORS,
  HAND_CHECKED_MARKET,
  readHandCheckedCsv,
  type CsvRow,
} from '../domain/fixtures/hand-checked.fixture.js';
import type { Market } from '../domain/simulation.js';

export const day = (iso: IsoDate): Date => new Date(`${iso}T00:00:00Z`);

// Do mais dependente para o menos: o que um teste da liquidação deixa para trás. A execução apaga junto com a ordem (cascade).
export async function cleanSettlementTables(prisma: PrismaService): Promise<void> {
  await prisma.order.deleteMany();
  await prisma.position.deleteMany();
  await prisma.equitySnapshot.deleteMany();
  await prisma.seasonStat.deleteMany();
  await prisma.randomBaseline.deleteMany();
  await prisma.corporateEvent.deleteMany();
  await prisma.decisionItem.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.cycle.deleteMany();
  await prisma.promptVersion.deleteMany();
  await prisma.competitor.deleteMany();
  await prisma.season.deleteMany();
  await prisma.briefing.deleteMany();
  await prisma.jobRun.deleteMany();
  await prisma.universeMember.deleteMany();
  await prisma.universeSnapshot.deleteMany();
  await prisma.dailyBar.deleteMany();
  await prisma.instrument.deleteMany();
  await prisma.macroDaily.deleteMany();
  await prisma.tradingDay.deleteMany();
  await prisma.auditLog.deleteMany(); // a trilha do registro de evento corporativo
}

// A planilha conferida à mão: capital de R$ 10.000,00, cinco pregões (03/11 a 09/11/2026), três ações e o BOVA11.
export const HAND_CHECKED_DATES = HAND_CHECKED_MARKET.sessions.map((s) => s.date);
export const HAND_CHECKED_LAST = HAND_CHECKED_DATES[HAND_CHECKED_DATES.length - 1]!;
const REFERENCE_TICKER = 'BOVA11';

// Instrumentos, barras (abertura e fechamento da planilha; máxima, mínima e volume inventados), o universo de cada semana, o CDI e
// os eventos do mercado. As barras entram com a origem da brapi (a fonte única).
export async function seedMarket(
  prisma: PrismaService,
  market: Market = HAND_CHECKED_MARKET,
  options: { withEvents?: boolean } = {},
): Promise<Map<string, string>> {
  const tickers = new Set<string>();
  for (const session of market.sessions) {
    for (const ticker of session.bars.keys()) tickers.add(ticker);
    for (const ticker of session.universe) tickers.add(ticker);
  }
  const ids = new Map<string, string>();
  for (const ticker of [...tickers].sort()) {
    const id = newId();
    ids.set(ticker, id);
    await prisma.instrument.create({
      data: {
        id,
        ticker,
        name: `EMPRESA ${ticker}`,
        spec: 'ON',
        kind: ticker === REFERENCE_TICKER ? 'REFERENCE' : 'STOCK',
        lastSeen: day(market.sessions[0]!.date),
      },
    });
  }
  await prisma.dailyBar.createMany({
    data: market.sessions.flatMap((session) =>
      [...session.bars].map(([ticker, bar]) => ({
        id: newId(),
        instrumentId: ids.get(ticker)!,
        date: day(session.date),
        openCents: bar.openCents,
        highCents: bar.openCents > bar.closeCents ? bar.openCents : bar.closeCents,
        lowCents: bar.openCents > bar.closeCents ? bar.closeCents : bar.openCents,
        closeCents: bar.closeCents,
        volumeCents: 1_000_000n,
        source: 'BRAPI',
      })),
    ),
  });

  // um universo por semana ISO, o da primeira sessão dela
  const weeks = new Map<string, readonly string[]>();
  for (const session of market.sessions) {
    if (!weeks.has(isoWeek(session.date))) weeks.set(isoWeek(session.date), session.universe);
  }
  for (const [week, members] of weeks) {
    const snapshotId = newId();
    await prisma.universeSnapshot.create({
      data: {
        id: snapshotId,
        week,
        windowStart: day('2026-08-03'),
        windowEnd: day('2026-10-30'),
        windowDays: 60,
        candidates: members.length,
        eligible: members.length,
        members: {
          create: members.map((ticker, index) => ({
            id: newId(),
            instrumentId: ids.get(ticker)!,
            position: index + 1,
            avgVolumeCents: 1_000_000_000n,
            presenceDays: 60,
          })),
        },
      },
    });
  }

  await prisma.macroDaily.createMany({
    data: market.cdi.map(({ date, pct }) => ({
      series: 'cdi_daily_pct',
      date: day(date),
      value: pct,
    })),
  });
  if (options.withEvents ?? true) {
    await prisma.corporateEvent.createMany({
      data: market.events.map((event) => ({
        id: event.id,
        ticker: event.ticker,
        exDate: day(event.exDate),
        kind: event.to > event.from ? 'SPLIT' : 'REVERSE_SPLIT',
        ratioFrom: Number(event.from),
        ratioTo: Number(event.to),
      })),
    });
  }
  return ids;
}

export interface SeededSeason {
  seasonId: string;
  // slug -> id do competidor
  competitors: Record<string, string>;
}

// A temporada da planilha: o `model-a` (modelo fake), o Sorteio e as três referências, com os slugs da planilha. Começa em
// 03/11/2026, com os cinco pregões. Com `decisions`, grava um ciclo fechado por pregão e a decisão do `model-a` (os itens da
// planilha, na ordem em que o modelo os listou). O `model-a` decide o que `decisions` diz; sem ela, a temporada não tem ciclo.
export async function seedSeason(
  prisma: PrismaService,
  options: {
    slug?: string;
    params?: Partial<SeasonParams>;
    decisions?: boolean;
    // o estado em que a temporada fica: RUNNING (o padrão) ou DRAFT (não iniciada)
    status?: 'RUNNING' | 'DRAFT';
    startDate?: IsoDate;
  } = {},
): Promise<SeededSeason> {
  const arena = new ArenaRepository(prisma);
  const base = seasonFile();
  const file = seasonFileSchema.parse({
    ...base,
    slug: options.slug ?? 'planilha',
    name: 'Temporada da planilha',
    params: {
      ...base.params,
      capitalCents: Number(HAND_CHECKED_CAPITAL_CENTS),
      sessions: HAND_CHECKED_DATES.length,
      ...options.params,
    },
    competitors: [
      {
        kind: 'MODEL',
        slug: 'model-a',
        name: 'Modelo A',
        provider: 'fake',
        modelId: 'fake/deterministic-a',
        capabilities: { jsonSchema: false, reasoningEffort: false },
      },
      { kind: 'RANDOM', slug: 'sorteio', name: 'Sorteio' },
      { kind: 'BENCHMARK', slug: 'equal-weight', name: 'Igual-peso', benchmark: 'EQUAL_WEIGHT' },
      { kind: 'BENCHMARK', slug: 'cdi', name: 'CDI', benchmark: 'CDI' },
      { kind: 'BENCHMARK', slug: 'bova11', name: 'BOVA11', benchmark: 'BOVA11' },
    ],
  });
  const seasonId = await arena.createSeason(file);
  const rows = await prisma.competitor.findMany({ where: { seasonId } });
  const competitors = Object.fromEntries(rows.map((row) => [row.slug, row.id]));
  if ((options.status ?? 'RUNNING') === 'RUNNING') {
    await arena.startSeason(
      seasonId,
      options.startDate ?? HAND_CHECKED_DATES[0]!,
      new Date('2026-11-01T18:00:00Z'),
    );
  }
  if (options.decisions ?? true) {
    const modelA = HAND_CHECKED_COMPETITORS.find((c) => c.id === 'model-a');
    if (modelA?.kind !== 'MODEL') throw new Error('a planilha perdeu o model-a');
    for (const [date, items] of modelA.decisions) await seedDecision(prisma, seasonId, date, items);
  }
  return { seasonId, competitors };
}

type PlanItem = {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  percent_of_equity?: number;
  percent_of_position?: number;
};

// O ciclo do pregão (fechado) e a decisão do primeiro modelo da temporada com os itens dados, nenhum descartado.
export async function seedDecision(
  prisma: PrismaService,
  seasonId: string,
  date: IsoDate,
  items: readonly PlanItem[],
  options: { dropped?: number[] } = {},
): Promise<{ cycleId: string; itemIds: string[] }> {
  const arena = new ArenaRepository(prisma);
  const briefing = await prisma.briefing.upsert({
    where: { date: day(date) },
    update: {},
    create: {
      id: newId(),
      date: day(date),
      sha256: 'a'.repeat(64),
      uri: `https://blob/${date}`,
      bytes: 1,
    },
  });
  const promptVersion = await arena.ensurePromptVersion(PROMPT_VERSION);
  const { cycle } = await arena.upsertCycle({
    seasonId,
    date,
    decisionAt: new Date(`${date}T11:00:00Z`),
    deadlineAt: new Date(`${date}T12:30:00Z`),
    state: { status: 'OPEN', briefingId: briefing.id, promptVersionId: promptVersion.id },
  });
  const [model] = await arena.modelCompetitors(seasonId);
  await arena.saveDecision({
    cycleId: cycle.id,
    competitorId: model!.id,
    status: 'DECIDED',
    holdReason: null,
    marketView: 'neutro',
    summary: 'Decisão da planilha.',
    usage: null,
    costMicroUsd: 0n,
    applied: null,
    inputSha256: null,
    outputSha256: null,
    metaSha256: null,
    ioUris: null,
    leakFields: [],
    items: items.map((item, position) => {
      const dropped = options.dropped?.includes(position) ?? false;
      return {
        position,
        action: item.action,
        ticker: item.ticker,
        percent: item.percent_of_equity ?? item.percent_of_position ?? null,
        confidence: null,
        rationale: dropped ? null : 'planilha',
        dropped,
        dropReason: dropped ? 'not_in_universe' : null,
        dropDetail: null,
      };
    }),
  });
  await arena.closeIfComplete(cycle.id, new Date(`${date}T12:50:00Z`));
  const stored = await prisma.decisionItem.findMany({
    where: { decision: { cycleId: cycle.id } },
    orderBy: { position: 'asc' },
    select: { id: true },
  });
  return { cycleId: cycle.id, itemIds: stored.map((row) => row.id) };
}

// O leitor dos CSVs da planilha mora com ela (domain/fixtures/hand-checked.fixture.ts), e os testes do banco o importam daqui.
export {
  HAND_CHECKED_CAPITAL_CENTS,
  HAND_CHECKED_COMPETITORS,
  HAND_CHECKED_MARKET,
  readHandCheckedCsv,
  type CsvRow,
};
