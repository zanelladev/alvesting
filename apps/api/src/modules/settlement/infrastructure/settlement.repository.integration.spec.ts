import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import { PrismaClient, type Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import {
  HAND_CHECKED_MARKET,
  cleanSettlementTables,
  day,
  seedDecision,
  seedMarket,
  seedSeason,
  type SeededSeason,
} from '../testing/settlement.fixture.js';
import { SettlementRepository, type DerivedRows } from './settlement.repository.js';

const D1 = '2026-11-03';
const D2 = '2026-11-04';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!testDatabaseUrl)(integrationTitle('SettlementRepository'), () => {
  let prisma: PrismaService;
  let repo: SettlementRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    repo = new SettlementRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    await cleanSettlementTables(prisma);
  });

  afterAll(async () => {
    // não deixa para os outros arquivos de teste o mercado, o CDI e a temporada que estes criaram
    await cleanSettlementTables(prisma);
    await prisma.onModuleDestroy();
  });

  // Uma liquidação mínima mas completa de um competidor: uma compra executada (com a execução), uma ordem que não executou,
  // a posição, o snapshot, a estatística e a linha do Monte Carlo.
  function derived(season: SeededSeason, competitor: string, date = D1): DerivedRows {
    const seasonId = season.seasonId;
    const competitorId = season.competitors[competitor]!;
    const orderId = newId();
    return {
      orders: [
        {
          id: orderId,
          seasonId,
          competitorId,
          date: day(date),
          itemIndex: 0,
          ticker: 'AAA3',
          action: 'BUY',
          status: 'FILLED',
          requestedQuantity: 86n,
          filledQuantity: 86n,
          priceCents: 2300n,
        },
        {
          id: newId(),
          seasonId,
          competitorId,
          date: day(date),
          itemIndex: 1,
          ticker: 'BBB4',
          action: 'SELL',
          status: 'NOT_EXECUTED',
          reason: 'no_position',
          filledQuantity: 0n,
        },
      ],
      fills: [
        {
          id: newId(),
          orderId,
          quantity: 86n,
          priceCents: 2300n,
          notionalCents: 197_800n,
          costCents: 59n,
        },
      ],
      positions: [
        {
          id: newId(),
          seasonId,
          competitorId,
          date: day(date),
          ticker: 'AAA3',
          quantity: 86n,
          costCents: 197_859n,
          markCents: 2400n,
          valueCents: 206_400n,
          stale: false,
        },
      ],
      snapshots: [
        {
          id: newId(),
          seasonId,
          competitorId,
          date: day(date),
          cashCents: 802_141n,
          positionsValueCents: 206_400n,
          equityCents: 1_008_541n,
          interestCents: 0n,
          percentileBps: 5000,
        },
      ],
      stats: [
        {
          id: newId(),
          seasonId,
          competitorId,
          asOf: day(date),
          returnBps: 85,
          percentileBps: 5000,
          maxDrawdownBps: 0,
          sells: 0,
          winningSells: 0,
          trades: 1,
        },
      ],
      baselines: [
        {
          id: newId(),
          seasonId,
          date: day(date),
          seed: 'semente',
          runs: 1000,
          equityP5Cents: 990_000n,
          equityP25Cents: 995_000n,
          equityP50Cents: 1_000_000n,
          equityP75Cents: 1_005_000n,
          equityP95Cents: 1_010_000n,
          returnP5Bps: -100,
          returnP25Bps: -50,
          returnP50Bps: 0,
          returnP75Bps: 50,
          returnP95Bps: 100,
        },
      ],
    };
  }

  const save = (season: SeededSeason, rows: DerivedRows) =>
    repo.locked(season.seasonId, (db) => repo.replace(db, season.seasonId, rows));
  const counts = async (seasonId?: string) => {
    const where = seasonId ? { seasonId } : {};
    return {
      orders: await prisma.order.count({ where }),
      fills: await prisma.fill.count({ where: seasonId ? { order: { seasonId } } : {} }),
      positions: await prisma.position.count({ where }),
      snapshots: await prisma.equitySnapshot.count({ where }),
      stats: await prisma.seasonStat.count({ where }),
      baselines: await prisma.randomBaseline.count({ where }),
    };
  };

  describe('o schema da liquidação', () => {
    it('grava e lê de volta uma liquidação completa, com a execução ligada à ordem', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      await save(season, derived(season, 'model-a'));

      expect(await counts(season.seasonId)).toEqual({
        orders: 2,
        fills: 1,
        positions: 1,
        snapshots: 1,
        stats: 1,
        baselines: 1,
      });
      const filled = await prisma.order.findFirstOrThrow({
        where: { status: 'FILLED' },
        include: { fill: true },
      });
      expect(filled).toMatchObject({ ticker: 'AAA3', action: 'BUY', filledQuantity: 86n });
      expect(filled.fill).toMatchObject({ notionalCents: 197_800n, costCents: 59n });
      expect(filled.fill?.realizedCents).toBeNull();
      const snapshot = await prisma.equitySnapshot.findFirstOrThrow();
      expect(snapshot).toMatchObject({ equityCents: 1_008_541n, cdiDate: null });
    });

    it('as chaves naturais são únicas: a mesma linha duas vezes é recusada, não duplicada', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      const rows = derived(season, 'model-a');
      await save(season, rows);

      await expect(
        prisma.order.create({ data: { ...rows.orders[0]!, id: newId() } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.position.create({ data: { ...rows.positions[0]!, id: newId() } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.equitySnapshot.create({ data: { ...rows.snapshots[0]!, id: newId() } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.seasonStat.create({ data: { ...rows.stats[0]!, id: newId() } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        prisma.randomBaseline.create({ data: { ...rows.baselines[0]!, id: newId() } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      // uma execução por ordem
      await expect(
        prisma.fill.create({ data: { ...rows.fills[0]!, id: newId() } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('o banco recusa o que o domínio nunca produz (HOLD como ordem, ordem sem motivo, execução que não fecha a conta)', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      const rows = derived(season, 'model-a');
      const order = rows.orders[0]!;
      const create = (data: Prisma.OrderUncheckedCreateInput) => prisma.order.create({ data });
      const at = (itemIndex: number) => ({ ...order, id: newId(), itemIndex });

      await expect(create({ ...at(5), action: 'HOLD' })).rejects.toThrow(/order_check/);
      // não executou e não diz por quê; ou executou e traz motivo
      await expect(
        create({ ...at(6), status: 'NOT_EXECUTED', filledQuantity: 0n, priceCents: null }),
      ).rejects.toThrow(/order_check/);
      await expect(create({ ...at(7), reason: 'no_bar' })).rejects.toThrow(/order_check/);
      // motivo que o domínio não conhece
      await expect(
        create({
          ...at(8),
          status: 'NOT_EXECUTED',
          reason: 'porque_sim',
          filledQuantity: 0n,
          priceCents: null,
        }),
      ).rejects.toThrow(/order_check/);
      // NOT_EXECUTED com quantidade executada, e FILLED sem nenhuma
      await expect(
        create({ ...at(9), status: 'NOT_EXECUTED', reason: 'no_bar', filledQuantity: 1n }),
      ).rejects.toThrow(/order_check/);
      await expect(create({ ...at(10), filledQuantity: 0n })).rejects.toThrow(/order_check/);
      // FILLED sem preço
      await expect(create({ ...at(11), priceCents: null })).rejects.toThrow(/order_check/);

      const fill = rows.fills[0]!;
      await save(season, rows);
      const saved = await prisma.order.findFirstOrThrow({ where: { status: 'FILLED' } });
      await prisma.fill.delete({ where: { orderId: saved.id } });
      const refill = (data: Partial<Prisma.FillUncheckedCreateInput>) =>
        prisma.fill.create({ data: { ...fill, id: newId(), orderId: saved.id, ...data } });
      await expect(refill({ notionalCents: 197_801n })).rejects.toThrow(/fill_check/);
      await expect(refill({ quantity: 0n, notionalCents: 0n })).rejects.toThrow(/fill_check/);
      await expect(refill({ costCents: -1n })).rejects.toThrow(/fill_check/);
    });

    it('o banco recusa posição, snapshot, estatística e Monte Carlo incoerentes', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      const rows = derived(season, 'model-a');
      const next = '2026-11-05';
      const position = rows.positions[0]!;
      const snapshot = rows.snapshots[0]!;
      const stat = rows.stats[0]!;
      const baseline = rows.baselines[0]!;
      const id = () => newId();

      // valor diferente de quantidade x marcação; quantidade zero
      await expect(
        prisma.position.create({
          data: { ...position, id: id(), date: day(next), valueCents: 1n },
        }),
      ).rejects.toThrow(/position_check/);
      await expect(
        prisma.position.create({
          data: { ...position, id: id(), date: day(next), quantity: 0n, valueCents: 0n },
        }),
      ).rejects.toThrow(/position_check/);
      // patrimônio que não é caixa + posições; caixa negativo (sem alavancagem); percentil fora de 0 a 10.000
      await expect(
        prisma.equitySnapshot.create({
          data: { ...snapshot, id: id(), date: day(next), equityCents: 1n },
        }),
      ).rejects.toThrow(/equity_snapshot_check/);
      await expect(
        prisma.equitySnapshot.create({
          data: {
            ...snapshot,
            id: id(),
            date: day(next),
            cashCents: -1n,
            equityCents: 206_399n,
          },
        }),
      ).rejects.toThrow(/equity_snapshot_check/);
      await expect(
        prisma.equitySnapshot.create({
          data: { ...snapshot, id: id(), date: day(next), percentileBps: 10_001 },
        }),
      ).rejects.toThrow(/equity_snapshot_check/);
      // acerto sem venda, mais vendas lucrativas que vendas, drawdown negativo
      const otherModel = season.competitors['sorteio']!;
      const statOf = (data: Partial<Prisma.SeasonStatUncheckedCreateInput>) =>
        prisma.seasonStat.create({
          data: { ...stat, id: id(), competitorId: otherModel, ...data },
        });
      await expect(statOf({ winRateBps: 5000 })).rejects.toThrow(/season_stat_check/);
      await expect(statOf({ sells: 1, winningSells: 2, winRateBps: 5000 })).rejects.toThrow(
        /season_stat_check/,
      );
      await expect(statOf({ maxDrawdownBps: -1 })).rejects.toThrow(/season_stat_check/);
      // percentis fora de ordem
      await expect(
        prisma.randomBaseline.create({
          data: { ...baseline, id: id(), date: day(next), equityP5Cents: 2_000_000n },
        }),
      ).rejects.toThrow(/random_baseline_check/);
      await expect(
        prisma.randomBaseline.create({
          data: { ...baseline, id: id(), date: day(next), runs: 0 },
        }),
      ).rejects.toThrow(/random_baseline_check/);
    });

    it('o evento corporativo é único por ticker, data ex e tipo, e o fator tem a direção do tipo', async () => {
      const event = (data: Partial<Prisma.CorporateEventUncheckedCreateInput> = {}) =>
        prisma.corporateEvent.create({
          data: {
            id: newId(),
            ticker: 'BBB4',
            exDate: day('2026-11-05'),
            kind: 'SPLIT',
            ratioFrom: 1,
            ratioTo: 2,
            ...data,
          },
        });
      await event();
      await expect(event({ ratioTo: 3 })).rejects.toMatchObject({ code: 'P2002' });
      // o mesmo dia, outro tipo, vale
      await event({ kind: 'BONUS', ratioFrom: 10, ratioTo: 11 });
      // desdobramento que reduz, grupamento que aumenta, bonificação que reduz, fator que não muda nada, zero
      await expect(event({ exDate: day('2026-11-06'), ratioFrom: 2, ratioTo: 1 })).rejects.toThrow(
        /corporate_event_check/,
      );
      await expect(
        event({ exDate: day('2026-11-06'), kind: 'REVERSE_SPLIT', ratioFrom: 1, ratioTo: 2 }),
      ).rejects.toThrow(/corporate_event_check/);
      await expect(
        event({ exDate: day('2026-11-06'), kind: 'BONUS', ratioFrom: 11, ratioTo: 10 }),
      ).rejects.toThrow(/corporate_event_check/);
      await expect(event({ exDate: day('2026-11-06'), ratioFrom: 2, ratioTo: 2 })).rejects.toThrow(
        /corporate_event_check/,
      );
      await expect(event({ exDate: day('2026-11-06'), ratioFrom: 0, ratioTo: 2 })).rejects.toThrow(
        /corporate_event_check/,
      );
      await event({ exDate: day('2026-11-06'), kind: 'REVERSE_SPLIT', ratioFrom: 10, ratioTo: 1 });
    });

    it('a temporada FINISHED tem finished_at, e só ela', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      await expect(
        prisma.season.update({ where: { id: season.seasonId }, data: { status: 'FINISHED' } }),
      ).rejects.toThrow(/season_finished_check/);
      await expect(
        prisma.season.update({
          where: { id: season.seasonId },
          data: { finishedAt: new Date('2026-11-09T21:00:00Z') },
        }),
      ).rejects.toThrow(/season_finished_check/);
      await prisma.season.update({
        where: { id: season.seasonId },
        data: { status: 'FINISHED', finishedAt: new Date('2026-11-09T21:00:00Z') },
      });
    });
  });

  describe('replace: a liquidação substitui a anterior inteira, numa transação', () => {
    it('troca as linhas da temporada e não toca nas de outra; a execução some com a ordem', async () => {
      const first = await seedSeason(prisma, { slug: 'a', decisions: false });
      const second = await seedSeason(prisma, { slug: 'b', decisions: false });
      await save(first, derived(first, 'model-a'));
      await save(second, derived(second, 'model-a'));
      const before = await counts();
      expect(before).toMatchObject({ orders: 4, fills: 2, positions: 2, baselines: 2 });

      // a nova liquidação da primeira tem uma ordem a menos e nenhuma execução
      const next = derived(first, 'model-a', D2);
      next.orders = [next.orders[1]!];
      next.fills = [];
      await save(first, next);

      expect(await counts(first.seasonId)).toEqual({
        orders: 1,
        fills: 0,
        positions: 1,
        snapshots: 1,
        stats: 1,
        baselines: 1,
      });
      expect(await counts(second.seasonId)).toEqual({
        orders: 2,
        fills: 1,
        positions: 1,
        snapshots: 1,
        stats: 1,
        baselines: 1,
      });
      expect(await prisma.fill.count()).toBe(1); // a execução da primeira saiu junto com a ordem
      expect(
        (await prisma.equitySnapshot.findFirstOrThrow({ where: { seasonId: first.seasonId } }))
          .date,
      ).toEqual(day(D2));
    });

    it('se uma linha nova é recusada, nada muda: a liquidação anterior continua inteira', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      await save(season, derived(season, 'model-a'));

      const broken = derived(season, 'model-a', D2);
      broken.baselines[0]!.equityP5Cents = 9_999_999_999n; // fora da ordem dos percentis: a última tabela gravada recusa
      await expect(save(season, broken)).rejects.toThrow(/random_baseline_check/);

      expect(await counts(season.seasonId)).toEqual({
        orders: 2,
        fills: 1,
        positions: 1,
        snapshots: 1,
        stats: 1,
        baselines: 1,
      });
      expect((await prisma.equitySnapshot.findFirstOrThrow()).date).toEqual(day(D1));
    });

    it('grava muitas linhas de uma vez (o igual-peso de 500 ações por 20 pregões)', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      const competitorId = season.competitors['equal-weight']!;
      const dates = Array.from(
        { length: 20 },
        (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`,
      );
      const rows = derived(season, 'equal-weight');
      rows.positions = dates.flatMap((date) =>
        Array.from({ length: 500 }, (_, i) => ({
          id: newId(),
          seasonId: season.seasonId,
          competitorId,
          date: day(date),
          ticker: `S${String(i).padStart(3, '0')}3`,
          quantity: 10n,
          costCents: 1000n,
          markCents: 100n,
          valueCents: 1000n,
          stale: false,
        })),
      );
      await save(season, rows);
      expect(await prisma.position.count()).toBe(10_000);
    });
  });

  describe('locked: a trava consultiva da temporada', () => {
    it('serializa a mesma temporada e deixa as outras passarem', async () => {
      const a = await seedSeason(prisma, { slug: 'a', decisions: false });
      const b = await seedSeason(prisma, { slug: 'b', decisions: false });
      const events: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));

      const first = repo.locked(a.seasonId, async () => {
        events.push('a1');
        await gate;
        events.push('a2');
      });
      while (!events.includes('a1')) await sleep(10);
      const second = repo.locked(a.seasonId, () => {
        events.push('segunda');
        return Promise.resolve();
      });
      await repo.locked(b.seasonId, () => {
        events.push('outra-temporada');
        return Promise.resolve();
      });
      await sleep(300); // a segunda tem tempo de sobra para correr, se a trava não a segurasse
      expect(events).toEqual(['a1', 'outra-temporada']);

      release();
      await Promise.all([first, second]);
      expect(events).toEqual(['a1', 'outra-temporada', 'a2', 'segunda']);
    });

    it('devolve o que o trabalho devolve, e o erro dele desfaz a transação', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      await expect(repo.locked(season.seasonId, () => Promise.resolve(42))).resolves.toBe(42);
      await expect(
        repo.locked(season.seasonId, async (db) => {
          await repo.replace(db, season.seasonId, derived(season, 'model-a'));
          throw new Error('falhou depois de gravar');
        }),
      ).rejects.toThrow('falhou depois de gravar');
      expect(await counts()).toMatchObject({ orders: 0, positions: 0, snapshots: 0 });
      // e a trava foi solta: a próxima passa
      await expect(repo.locked(season.seasonId, () => Promise.resolve('livre'))).resolves.toBe(
        'livre',
      );
    });

    // O Monte Carlo é CPU síncrona dentro da transação: a conexão fica parada, "ociosa em transação", e o pool derruba quem passa
    // de idle_in_transaction_session_timeout (30 s no PrismaService; no worker de 0,5 vCPU o teto do contrato passaria disso). Um
    // pool com 300 ms faz o mesmo em menos de um segundo.
    it('a transação aguenta ficar parada, sem consulta, mais que o limite de inatividade do pool', async () => {
      const impatient = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: testDatabaseUrl!,
          max: 2,
          idle_in_transaction_session_timeout: 300,
        }),
      });
      try {
        const season = await seedSeason(prisma, { decisions: false });
        // o PrismaService só acrescenta o onModuleDestroy ao cliente; o repositório usa o resto
        const impatientRepo = new SettlementRepository(impatient as unknown as PrismaService);
        await expect(
          impatientRepo.locked(season.seasonId, async (db) => {
            await db.$queryRaw`SELECT 1`;
            await sleep(900);
            return db.$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`;
          }),
        ).resolves.toEqual([{ one: 1 }]);

        // o ajuste vale só na transação da trava: o limite do pool segue valendo para o resto
        await expect(
          impatient.$transaction(async (db) => {
            await db.$queryRaw`SELECT 1`;
            await sleep(900);
            return db.$queryRaw`SELECT 1`;
          }),
        ).rejects.toThrow();
        const setting = await impatient.$queryRaw<
          Array<{ timeout: string }>
        >`SELECT current_setting('idle_in_transaction_session_timeout') AS timeout`;
        expect(setting[0]?.timeout).toBe('300ms');
      } finally {
        await impatient.$disconnect();
      }
    });
  });

  describe('leituras', () => {
    it('lastSettledDate: o último pregão com snapshot da temporada, ou nulo', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      const other = await seedSeason(prisma, { slug: 'outra', decisions: false });
      const read = (id: string) => repo.locked(id, (db) => repo.lastSettledDate(db, id));
      expect(await read(season.seasonId)).toBeNull();
      await save(season, derived(season, 'model-a', D2));
      expect(await read(season.seasonId)).toBe(D2);
      expect(await read(other.seasonId)).toBeNull();
    });

    it('competitors: o elenco inteiro, na ordem do arquivo da temporada', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      const found = await repo.locked(season.seasonId, (db) =>
        repo.competitors(db, season.seasonId),
      );
      expect(found.map((c) => [c.slug, c.kind, c.benchmark])).toEqual([
        ['model-a', 'MODEL', null],
        ['sorteio', 'RANDOM', null],
        ['equal-weight', 'BENCHMARK', 'EQUAL_WEIGHT'],
        ['cdi', 'BENCHMARK', 'CDI'],
        ['bova11', 'BENCHMARK', 'BOVA11'],
      ]);
      expect(found[0]!.id).toBe(season.competitors['model-a']);
    });

    it('decisionItems: só o item que valeu (nunca o descartado), até a data, na ordem em que o modelo listou', async () => {
      const season = await seedSeason(prisma, { decisions: false });
      const { itemIds } = await seedDecision(
        prisma,
        season.seasonId,
        D1,
        [
          { ticker: 'AAA3', action: 'BUY', percent_of_equity: 12.5 },
          { ticker: 'BBB4', action: 'SELL', percent_of_position: 50 },
          { ticker: 'CCC3', action: 'HOLD' },
        ],
        { dropped: [1] },
      );
      await seedDecision(prisma, season.seasonId, D2, [
        { ticker: 'AAA3', action: 'BUY', percent_of_equity: 5 },
      ]);

      const read = (to: string) =>
        repo.locked(season.seasonId, (db) => repo.decisionItems(db, season.seasonId, to));
      const firstDay = await read(D1);
      expect(firstDay.map((i) => [i.date, i.position, i.action, i.ticker, i.percent])).toEqual([
        [D1, 0, 'BUY', 'AAA3', '12.5'],
        [D1, 2, 'HOLD', 'CCC3', null],
      ]);
      expect(firstDay.map((i) => i.id)).toEqual([itemIds[0], itemIds[2]]);
      expect(firstDay.every((i) => i.competitorId === season.competitors['model-a'])).toBe(true);
      expect((await read(D2)).map((i) => i.date)).toEqual([D1, D1, D2]);
    });

    it('bars, universes, cdi e events devolvem o que a liquidação lê, dentro do intervalo', async () => {
      await seedMarket(prisma);
      const season = await seedSeason(prisma, { decisions: false });
      const read = <T>(work: (db: Prisma.TransactionClient) => Promise<T>) =>
        repo.locked(season.seasonId, work);

      const bars = await read((db) => repo.bars(db, '2026-11-04', '2026-11-05'));
      expect(
        bars
          .filter((b) => b.date === '2026-11-05')
          .map((b) => b.ticker)
          .sort(),
      ).toEqual(['BBB4', 'BOVA11', 'CCC3']); // AAA3 não tem barra em 05/11
      expect(bars.every((b) => b.date >= '2026-11-04' && b.date <= '2026-11-05')).toBe(true);
      expect(bars.find((b) => b.date === '2026-11-04' && b.ticker === 'AAA3')).toEqual({
        date: '2026-11-04',
        ticker: 'AAA3',
        openCents: 2420n,
        closeCents: 2500n,
      });

      const universes = await read((db) =>
        repo.universes(db, ['2026-W45', '2026-W46', '2026-W47']),
      );
      expect([...universes.keys()].sort()).toEqual(['2026-W45', '2026-W46']);
      expect([...universes.get('2026-W45')!].sort()).toEqual(['AAA3', 'BBB4', 'CCC3']);

      // o CDI sai como texto com as oito casas do NUMERIC(18,8), nunca como float
      const cdi = await read((db) => repo.cdi(db, '2026-11-05'));
      expect(cdi).toEqual([
        { date: '2026-10-30', pct: '0.05000100' },
        { date: '2026-11-03', pct: '0.05078800' },
        { date: '2026-11-04', pct: '0.05081200' },
        { date: '2026-11-05', pct: '0.05064000' },
      ]);

      const events = await read((db) => repo.events(db, '2026-11-03', '2026-11-09'));
      expect(events).toEqual(HAND_CHECKED_MARKET.events);
      expect(await read((db) => repo.events(db, '2026-11-06', '2026-11-09'))).toEqual([]);
      expect(await read((db) => repo.events(db, '2026-11-03', '2026-11-04'))).toEqual([]);
    });
  });

  describe('finishSeason', () => {
    it('RUNNING vira FINISHED com a hora; repetir não muda nada; o rascunho não termina', async () => {
      const running = await seedSeason(prisma, { slug: 'em-andamento', decisions: false });
      const draft = await seedSeason(prisma, {
        slug: 'rascunho',
        decisions: false,
        status: 'DRAFT',
      });
      const at = new Date('2026-11-09T21:30:00Z');
      const finish = (id: string, when: Date) =>
        repo.locked(id, (db) => repo.finishSeason(db, id, when));

      await expect(finish(running.seasonId, at)).resolves.toBe(true);
      await expect(finish(running.seasonId, new Date('2026-11-10T00:00:00Z'))).resolves.toBe(false);
      expect(
        await prisma.season.findUniqueOrThrow({ where: { id: running.seasonId } }),
      ).toMatchObject({
        status: 'FINISHED',
        finishedAt: at,
      });
      await expect(finish(draft.seasonId, at)).resolves.toBe(false);
      expect(
        (await prisma.season.findUniqueOrThrow({ where: { id: draft.seasonId } })).status,
      ).toBe('DRAFT');
    });
  });

  describe('lastSettledThrough: de onde a reliquidação de um evento parte', () => {
    it('lista, por temporada em andamento ou encerrada, o último pregão liquidado', async () => {
      const a = await seedSeason(prisma, { slug: 'a', decisions: false });
      await seedSeason(prisma, { slug: 'sem-liquidacao', decisions: false });
      await seedSeason(prisma, { slug: 'rascunho', decisions: false, status: 'DRAFT' });
      await save(a, derived(a, 'model-a', D2));
      expect(await repo.settledThrough()).toEqual([
        { seasonId: a.seasonId, slug: 'a', through: D2 },
      ]);
    });
  });

  describe('upsertEvent', () => {
    const input = {
      ticker: 'BBB4',
      exDate: '2026-11-06',
      kind: 'SPLIT' as const,
      ratioFrom: 1,
      ratioTo: 2,
    };
    const trail = () =>
      prisma.auditLog.findMany({ where: { action: { startsWith: 'corporate_event.' } } });

    it('cria, reconhece o idêntico e corrige o fator do mesmo ticker, data ex e tipo', async () => {
      await seedMarket(prisma);
      await expect(repo.upsertEvent(input, 'cli')).resolves.toMatchObject({ change: 'created' });
      await expect(repo.upsertEvent(input, 'cli')).resolves.toMatchObject({ change: 'unchanged' });
      const fixed = await repo.upsertEvent({ ...input, ratioTo: 3 }, 'cli');
      expect(fixed).toMatchObject({ change: 'updated', event: { from: 1n, to: 3n } });
      expect(await prisma.corporateEvent.count({ where: { exDate: day('2026-11-06') } })).toBe(1);
    });

    // Corrigir o fator muda, retroativamente, o resultado publicado da arena: precisa de rastro.
    it('deixa na trilha de auditoria quem registrou ou corrigiu o fator, com o valor antigo e o novo; repetir não deixa nada', async () => {
      await seedMarket(prisma);
      await repo.upsertEvent(input, 'cli');
      await repo.upsertEvent(input, 'cli'); // idêntico: sem linha nova
      await repo.upsertEvent({ ...input, ratioTo: 3 }, 'admin:01JCZ6S8Y0000000000000009');

      const rows = await trail();
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.action === 'corporate_event.created')).toMatchObject({
        actor: 'cli',
        target: 'BBB4:2026-11-06:SPLIT',
        detail: { before: null, after: { from: 1, to: 2 } },
      });
      expect(rows.find((row) => row.action === 'corporate_event.updated')).toMatchObject({
        actor: 'admin:01JCZ6S8Y0000000000000009',
        target: 'BBB4:2026-11-06:SPLIT',
        detail: { before: { from: 1, to: 2 }, after: { from: 1, to: 3 } },
      });
    });

    it('dois registros do mesmo evento ao mesmo tempo: um cria e o outro reconhece, sem o erro cru de chave duplicada', async () => {
      await seedMarket(prisma);
      const results = await Promise.all([
        repo.upsertEvent(input, 'cli'),
        repo.upsertEvent(input, 'cli'),
      ]);
      expect(results.map((result) => result.change).sort()).toEqual(['created', 'unchanged']);
      expect(await prisma.corporateEvent.count({ where: { exDate: day('2026-11-06') } })).toBe(1);
      expect(await trail()).toHaveLength(1);
    });

    it('duas correções diferentes ao mesmo tempo: a trilha encadeia, a segunda parte do valor que a primeira deixou', async () => {
      await seedMarket(prisma);
      const results = await Promise.all([
        repo.upsertEvent({ ...input, ratioTo: 3 }, 'cli'),
        repo.upsertEvent({ ...input, ratioTo: 4 }, 'cli'),
      ]);
      expect(results.map((result) => result.change).sort()).toEqual(['created', 'updated']);

      const rows = await trail();
      const created = rows.find((row) => row.action === 'corporate_event.created')!;
      const updated = rows.find((row) => row.action === 'corporate_event.updated')!;
      const after = (row: typeof created) => (row.detail as { after: { to: number } }).after;
      expect((updated.detail as { before: unknown }).before).toEqual(after(created));
      // o evento guardado é o da que correu por último
      const stored = await prisma.corporateEvent.findFirstOrThrow({
        where: { exDate: day('2026-11-06') },
      });
      expect(stored.ratioTo).toBe(after(updated).to);
    });

    it('instrumentExists: só ação gravada', async () => {
      await seedMarket(prisma);
      expect(await repo.instrumentExists('BBB4')).toBe(true);
      expect(await repo.instrumentExists('ZZZZ3')).toBe(false);
    });
  });
});
