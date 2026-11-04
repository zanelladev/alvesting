import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { newId } from '../../../common/id.js';
import { LEGACY_SHA, LEGACY_SOURCE } from '../testing/legacy-source.fixture.js';
import { MarketRepository } from './market.repository.js';
import { UniverseRepository } from './universe.repository.js';

interface Row {
  date: string;
  ticker: string;
  kind: 'STOCK' | 'REFERENCE';
  volumeCents: bigint;
}
const rec = (overrides: Partial<Row> = {}): Row => ({
  date: '2026-10-30',
  ticker: 'PETR4',
  kind: 'STOCK',
  volumeCents: 1_000n,
  ...overrides,
});

const day = (value: string) => new Date(`${value}T00:00:00Z`);

describe.skipIf(!testDatabaseUrl)(integrationTitle('UniverseRepository'), () => {
  let prisma: PrismaService;
  let market: MarketRepository;
  let repo: UniverseRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    market = new MarketRepository(prisma);
    repo = new UniverseRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    await prisma.universeMember.deleteMany();
    await prisma.universeSnapshot.deleteMany();
    await prisma.dailyBar.deleteMany();
    await prisma.instrument.deleteMany();
    await prisma.tradingDay.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  // Instrumentos e barras pelo caminho de verdade (insertInstruments e insertBars), com preço qualquer.
  async function put(rows: Row[]): Promise<void> {
    const seeds = new Map(
      rows.map((r) => [
        r.ticker,
        {
          ticker: r.ticker,
          name: r.ticker,
          spec: r.kind === 'REFERENCE' ? 'CI' : 'ON',
          kind: r.kind,
        },
      ]),
    );
    await market.insertInstruments([...seeds.values()], '2026-10-30');
    await market.insertBars(
      rows.map((r) => ({
        ticker: r.ticker,
        date: r.date,
        openCents: 100n,
        highCents: 100n,
        lowCents: 100n,
        closeCents: 100n,
        volumeCents: r.volumeCents,
      })),
    );
  }

  // Um dia só é confirmado se tem barra: o BOVA11 negocia todo pregão.
  async function confirm(days: string[]): Promise<void> {
    await put(days.map((date) => rec({ ticker: 'BOVA11', kind: 'REFERENCE', date })));
    await market.confirmTradingDays(days);
  }

  describe('confirmedDaysBetween', () => {
    it('devolve os pregões confirmados em [de, antes), do mais antigo ao mais novo', async () => {
      await confirm(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
      await market.seedCalendar(['2026-11-03', '2026-11-04']); // previstos, não confirmados
      expect(await repo.confirmedDaysBetween('2026-10-28', '2026-11-05')).toEqual([
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
      ]);
    });

    it('o dia inicial entra e a data limite não (antes de segunda-feira, não a própria segunda)', async () => {
      await confirm(['2026-10-28', '2026-10-29', '2026-10-30', '2026-11-03']);
      expect(await repo.confirmedDaysBetween('2026-10-29', '2026-11-03')).toEqual([
        '2026-10-29',
        '2026-10-30',
      ]);
    });

    it('não devolve os dias de antes da janela: um buraco nela não puxa um dia mais velho para dentro', async () => {
      await confirm(['2026-10-26', '2026-10-28', '2026-10-30']); // falta o dia 29
      expect(await repo.confirmedDaysBetween('2026-10-27', '2026-11-02')).toEqual([
        '2026-10-28',
        '2026-10-30',
      ]);
    });

    it('conta o dia legado que o dev trouxe, de antes da brapi, como conta o confirmado pela brapi', async () => {
      await confirm(['2026-10-28']);
      await prisma.tradingDay.create({
        data: { date: day('2026-10-29'), source: LEGACY_SOURCE, [LEGACY_SHA]: 'b'.repeat(64) },
      });
      expect(await repo.confirmedDaysBetween('2026-10-28', '2026-10-30')).toEqual([
        '2026-10-28',
        '2026-10-29',
      ]);
    });

    it('sem nenhum dia confirmado no intervalo, devolve vazio', async () => {
      await confirm(['2026-10-30']);
      expect(await repo.confirmedDaysBetween('2026-10-01', '2026-10-30')).toEqual([]);
    });
  });

  // O Prisma não modela CHECK; a migration 20261101170000 os cria à mão. O parser e o cliente da brapi já recusam
  // estes valores, o banco é a rede de segurança.
  describe('integridade do banco (CHECK e índice)', () => {
    const snapshotData = (week: string) => ({
      id: `S${week.replace(/\W/g, '').padEnd(25, '0')}`.slice(0, 26),
      week,
      windowStart: day('2026-08-04'),
      windowEnd: day('2026-10-30'),
      windowDays: 60,
      candidates: 1,
      eligible: 1,
    });

    it.each(['2026-W01', '2026-W45', '2026-W53', '2020-W53'])(
      'aceita a semana %s',
      async (week) => {
        await expect(
          prisma.universeSnapshot.create({ data: snapshotData(week) }),
        ).resolves.toBeDefined();
      },
    );

    // até 8 caracteres, que é o que cabe na coluna: o que a recusa tem de ser o CHECK, não o tamanho
    it.each([
      '2026-W00',
      '2026-W54',
      '2026-W99',
      '2026-W5',
      '2026-45',
      '26-W45',
      '2026W045',
      'semana',
      '',
    ])('recusa a semana %j', async (week) => {
      await expect(prisma.universeSnapshot.create({ data: snapshotData(week) })).rejects.toThrow(
        /universe_snapshot_week_check|violates check constraint|constraint/i,
      );
      expect(await prisma.universeSnapshot.count()).toBe(0);
    });

    it('recusa posição 0 e negativa no universo, e aceita a 1', async () => {
      await put([rec({ ticker: 'AAA3' })]);
      const instrument = await prisma.instrument.findFirstOrThrow();
      const snapshot = await prisma.universeSnapshot.create({ data: snapshotData('2026-W45') });
      const member = (position: number, id: string) => ({
        id,
        snapshotId: snapshot.id,
        instrumentId: instrument.id,
        position,
        avgVolumeCents: 1n,
        presenceDays: 1,
      });
      await expect(prisma.universeMember.create({ data: member(0, 'M0') })).rejects.toThrow(
        /universe_member_position_check|violates check constraint|constraint/i,
      );
      await expect(prisma.universeMember.create({ data: member(-1, 'M1') })).rejects.toThrow(
        /constraint/i,
      );
      await expect(prisma.universeMember.create({ data: member(1, 'M2') })).resolves.toBeDefined();
    });

    it('universe_member tem índice na FK do instrumento', async () => {
      const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'universe_member'`;
      expect(indexes.map((i) => i.indexname)).toContain('universe_member_instrument_id_idx');
    });
  });

  describe('volumeStats', () => {
    const days = ['2026-10-28', '2026-10-29', '2026-10-30'];

    it('soma o volume e conta a presença por ação, só nos dias da janela', async () => {
      await put([
        rec({ ticker: 'AAA3', date: '2026-10-28', volumeCents: 100n }),
        rec({ ticker: 'AAA3', date: '2026-10-29', volumeCents: 200n }),
        rec({ ticker: 'AAA3', date: '2026-10-30', volumeCents: 300n }),
        rec({ ticker: 'BBB3', date: '2026-10-30', volumeCents: 5_000_000_000_000_000n }), // acima de 2^53
        rec({ ticker: 'AAA3', date: '2026-10-27', volumeCents: 999n }), // fora da janela
      ]);
      const stats = await repo.volumeStats(days);
      expect(stats.sort((a, b) => a.ticker.localeCompare(b.ticker))).toEqual([
        {
          instrumentId: expect.any(String) as string,
          ticker: 'AAA3',
          totalVolumeCents: 600n,
          presenceDays: 3,
        },
        {
          instrumentId: expect.any(String) as string,
          ticker: 'BBB3',
          totalVolumeCents: 5_000_000_000_000_000n,
          presenceDays: 1,
        },
      ]);
    });

    it('fica de fora a referência e o papel cotado por lote; vale a barra de qualquer origem (a da brapi e a legada do dev)', async () => {
      await put([
        rec({ ticker: 'AAA3' }),
        rec({ ticker: 'BOVA11', kind: 'REFERENCE' }),
        rec({ ticker: 'CCC3', date: '2026-10-29' }),
        rec({ ticker: 'CCC3', date: '2026-10-30', volumeCents: 99n }),
      ]);
      // o resíduo do dev: papel por lote (fator 1000), e barras legadas com volume financeiro de verdade
      const goll = await prisma.instrument.create({
        data: {
          id: newId(),
          ticker: 'GOLL54',
          name: 'GOL',
          spec: 'PN',
          kind: 'STOCK',
          quoteFactor: 1000,
          lastSeen: day('2026-10-30'),
        },
      });
      await prisma.dailyBar.create({
        data: {
          id: newId(),
          instrumentId: goll.id,
          date: day('2026-10-30'),
          openCents: 1n,
          highCents: 1n,
          lowCents: 1n,
          closeCents: 1n,
          volumeCents: 5n,
          source: LEGACY_SOURCE,
        },
      });
      const ddd = await prisma.instrument.create({
        data: {
          id: newId(),
          ticker: 'DDD3',
          name: 'DDD',
          spec: 'ON',
          kind: 'STOCK',
          lastSeen: day('2026-10-30'),
        },
      });
      await prisma.dailyBar.create({
        data: {
          id: newId(),
          instrumentId: ddd.id,
          date: day('2026-10-30'),
          openCents: 1n,
          highCents: 1n,
          lowCents: 1n,
          closeCents: 1n,
          volumeCents: 7_000n,
          trades: 12,
          source: LEGACY_SOURCE,
        },
      });
      const stats = await repo.volumeStats(days);
      expect(stats.map((s) => s.ticker).sort()).toEqual(['AAA3', 'CCC3', 'DDD3']);
      expect(stats.find((s) => s.ticker === 'CCC3')).toMatchObject({
        totalVolumeCents: 1_099n,
        presenceDays: 2,
      });
      expect(stats.find((s) => s.ticker === 'DDD3')?.totalVolumeCents).toBe(7_000n);
    });

    it('janela vazia não devolve nada', async () => {
      expect(await repo.volumeStats([])).toEqual([]);
    });
  });

  describe('saveSnapshot', () => {
    const selection = (ids: string[]) => ({
      candidates: 3,
      eligible: ids.length,
      members: ids.map((instrumentId, index) => ({
        instrumentId,
        ticker: `T${index}`,
        position: index + 1,
        avgVolumeCents: BigInt(1000 - index),
        presenceDays: 60 - index,
      })),
    });
    const input = (ids: string[]) => ({
      week: '2026-W45',
      windowStart: '2026-08-04',
      windowEnd: '2026-10-30',
      windowDays: 60,
      selection: selection(ids),
    });

    async function twoInstruments(): Promise<string[]> {
      await put([rec({ ticker: 'AAA3' }), rec({ ticker: 'BBB3' })]);
      return (await prisma.instrument.findMany({ orderBy: { ticker: 'asc' } })).map((i) => i.id);
    }

    it('grava o snapshot da semana e os membros com posição, volume médio e presença', async () => {
      const ids = await twoInstruments();
      expect(await repo.saveSnapshot(input(ids))).toBe('created');
      const snapshot = await prisma.universeSnapshot.findUniqueOrThrow({
        where: { week: '2026-W45' },
        include: { members: { orderBy: { position: 'asc' } } },
      });
      expect(snapshot).toMatchObject({
        windowStart: day('2026-08-04'),
        windowEnd: day('2026-10-30'),
        windowDays: 60,
        candidates: 3,
        eligible: 2,
      });
      expect(
        snapshot.members.map((m) => [m.instrumentId, m.position, m.avgVolumeCents, m.presenceDays]),
      ).toEqual([
        [ids[0], 1, 1000n, 60],
        [ids[1], 2, 999n, 59],
      ]);
    });

    it('é congelado: a segunda gravação da mesma semana não muda nada', async () => {
      const ids = await twoInstruments();
      await repo.saveSnapshot(input(ids));
      expect(await repo.saveSnapshot(input([ids[1]!]))).toBe('exists');
      expect(await prisma.universeSnapshot.count()).toBe(1);
      expect(await prisma.universeMember.count()).toBe(2);
    });

    it('cinco gravações simultâneas da mesma semana: uma cria e as outras reconhecem', async () => {
      const ids = await twoInstruments();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => repo.saveSnapshot(input(ids))),
      );
      expect(results.filter((r) => r === 'created')).toHaveLength(1);
      expect(results.filter((r) => r === 'exists')).toHaveLength(4);
      expect(await prisma.universeMember.count()).toBe(2);
    });

    it('semana sem nenhum membro grava só o snapshot', async () => {
      expect(await repo.saveSnapshot(input([]))).toBe('created');
      expect(await prisma.universeMember.count()).toBe(0);
    });
  });

  describe('tickersOf', () => {
    it('devolve os tickers da semana e, se ela não existe, os da última semana anterior', async () => {
      await put([rec({ ticker: 'AAA3' }), rec({ ticker: 'BBB3' })]);
      const [a, b] = (await prisma.instrument.findMany({ orderBy: { ticker: 'asc' } })).map(
        (i) => i.id,
      );
      const base = { windowStart: '2026-08-04', windowEnd: '2026-10-30', windowDays: 60 };
      const member = (instrumentId: string, position: number) => ({
        instrumentId,
        ticker: 'x',
        position,
        avgVolumeCents: 1n,
        presenceDays: 60,
      });
      await repo.saveSnapshot({
        ...base,
        week: '2026-W44',
        selection: { candidates: 1, eligible: 1, members: [member(a!, 1)] },
      });
      await repo.saveSnapshot({
        ...base,
        week: '2026-W45',
        selection: { candidates: 2, eligible: 2, members: [member(a!, 1), member(b!, 2)] },
      });

      expect(await repo.tickersOf('2026-W45')).toEqual(['AAA3', 'BBB3']);
      expect(await repo.tickersOf('2026-W44')).toEqual(['AAA3']);
      expect(await repo.tickersOf('2026-W47')).toEqual(['AAA3', 'BBB3']); // ainda vale a de W45
      expect(await repo.tickersOf('2026-W40')).toEqual([]); // antes de qualquer universo
    });
  });
});
