import type { QueueMessage } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { CycleCloser } from '../../arena/application/cycle-closer.js';
import { ArenaRepository } from '../../arena/infrastructure/arena.repository.js';
import { forcedHold } from '../../arena/domain/decision-record.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { JobBusyError, JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { SettlementRepository } from '../infrastructure/settlement.repository.js';
import {
  HAND_CHECKED_DATES,
  HAND_CHECKED_LAST,
  HAND_CHECKED_MARKET,
  cleanSettlementTables,
  day,
  readHandCheckedCsv,
  seedDecision,
  seedMarket,
  seedSeason,
  type CsvRow,
  type SeededSeason,
} from '../testing/settlement.fixture.js';
import { Secret } from '../../../config/secret.js';
import { CacheRefresher } from './cache-refresher.js';
import { IncompleteDataError } from './settlement-plan.js';
import { SettleHandler } from './settle.handler.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// 21:35 em Brasília de segunda, 09/11/2026: o eod terminou e o settle roda. Os prazos dos ciclos (09:30) já passaram.
const NOW = new Date('2026-11-10T00:35:00Z');
const iso = (date: Date | null): string => (date ? date.toISOString().slice(0, 10) : '');
const show = (value: bigint | number | boolean | string | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('SettleHandler (a liquidação de ponta a ponta)'),
  () => {
    let prisma: PrismaService;
    let jobs: JobRunStore;
    let repo: SettlementRepository;
    let arena: ArenaRepository;
    let handler: SettleHandler;

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      jobs = new JobRunStore(prisma);
      repo = new SettlementRepository(prisma);
      arena = new ArenaRepository(prisma);
      handler = new SettleHandler({
        jobs,
        arena,
        closer: new CycleCloser(arena),
        repo,
        calendar: loadTradingCalendar(),
        clock: () => NOW,
      });
    }, 120_000);

    beforeEach(async () => {
      await cleanSettlementTables(prisma);
    });

    afterAll(async () => {
      // não deixa para os outros arquivos de teste o mercado, o CDI e a temporada que este criou
      await cleanSettlementTables(prisma);
      await prisma.onModuleDestroy();
    });

    const message = (season: SeededSeason, date: string = HAND_CHECKED_LAST) =>
      ({ type: 'settle', seasonId: season.seasonId, date }) as Extract<
        QueueMessage,
        { type: 'settle' }
      >;

    async function world(options: Parameters<typeof seedSeason>[1] = {}) {
      await seedMarket(prisma);
      return seedSeason(prisma, options);
    }

    // --- o que o banco devolve, no formato dos CSVs da planilha ---------------------------------------------------------

    const orderRows = async (season: SeededSeason, slug: string): Promise<CsvRow[]> => {
      const orders = await prisma.order.findMany({
        where: { competitorId: season.competitors[slug]! },
        include: { fill: true },
      });
      // a ordem de execução do pregão: vendas primeiro, cada grupo na ordem em que o modelo listou
      orders.sort(
        (a, b) =>
          iso(a.date).localeCompare(iso(b.date)) ||
          (a.action === b.action ? 0 : a.action === 'SELL' ? -1 : 1) ||
          a.itemIndex - b.itemIndex,
      );
      return orders.map((o) => ({
        competitor: slug,
        date: iso(o.date),
        item_index: show(o.itemIndex),
        ticker: o.ticker,
        action: o.action,
        status: o.status,
        reason: show(o.reason),
        requested_quantity: show(o.requestedQuantity),
        filled_quantity: show(o.filledQuantity),
        price_cents: show(o.priceCents),
        notional_cents: show(o.fill?.notionalCents),
        cost_cents: show(o.fill?.costCents),
        realized_cents: show(o.fill?.realizedCents),
      }));
    };
    const positionRows = async (season: SeededSeason, slug: string): Promise<CsvRow[]> => {
      const rows = await prisma.position.findMany({
        where: { competitorId: season.competitors[slug]! },
      });
      rows.sort(
        (a, b) => iso(a.date).localeCompare(iso(b.date)) || a.ticker.localeCompare(b.ticker),
      );
      return rows.map((p) => ({
        competitor: slug,
        date: iso(p.date),
        ticker: p.ticker,
        quantity: show(p.quantity),
        cost_cents: show(p.costCents),
        mark_cents: show(p.markCents),
        value_cents: show(p.valueCents),
        stale: show(p.stale),
      }));
    };
    const snapshotRows = async (season: SeededSeason, slug: string): Promise<CsvRow[]> => {
      const rows = await prisma.equitySnapshot.findMany({
        where: { competitorId: season.competitors[slug]! },
        orderBy: { date: 'asc' },
      });
      return rows.map((s) => ({
        competitor: slug,
        date: iso(s.date),
        cash_cents: show(s.cashCents),
        positions_value_cents: show(s.positionsValueCents),
        equity_cents: show(s.equityCents),
        interest_cents: show(s.interestCents),
        cdi_date: iso(s.cdiDate),
      }));
    };
    const statRow = async (season: SeededSeason, slug: string): Promise<CsvRow> => {
      const s = await prisma.seasonStat.findUniqueOrThrow({
        where: { competitorId: season.competitors[slug]! },
      });
      return {
        competitor: slug,
        return_bps: show(s.returnBps),
        excess_equal_weight_bps: show(s.excessEqualWeightBps),
        excess_cdi_bps: show(s.excessCdiBps),
        max_drawdown_bps: show(s.maxDrawdownBps),
        sells: show(s.sells),
        winning_sells: show(s.winningSells),
        win_rate_bps: show(s.winRateBps),
        trades: show(s.trades),
      };
    };
    const forCompetitor = (rows: CsvRow[], slug: string) =>
      rows.filter((row) => row['competitor'] === slug);
    const SHEET = ['model-a', 'equal-weight', 'cdi', 'bova11'] as const;

    // Tudo o que a liquidação grava, sem os ids e sem a hora: o conteúdo, para comparar duas liquidações.
    async function content(season: SeededSeason) {
      const where = { seasonId: season.seasonId };
      const strip = <T extends { id: string }>(rows: T[]) =>
        rows.map(({ id: _id, ...rest }) => rest);
      return {
        orders: strip(
          await prisma.order.findMany({
            where,
            orderBy: [{ competitorId: 'asc' }, { date: 'asc' }, { itemIndex: 'asc' }],
          }),
        ),
        positions: strip(
          await prisma.position.findMany({
            where,
            orderBy: [{ competitorId: 'asc' }, { date: 'asc' }, { ticker: 'asc' }],
          }),
        ),
        snapshots: strip(
          await prisma.equitySnapshot.findMany({
            where,
            orderBy: [{ competitorId: 'asc' }, { date: 'asc' }],
          }),
        ),
        stats: strip(await prisma.seasonStat.findMany({ where, orderBy: { competitorId: 'asc' } })),
        baselines: strip(await prisma.randomBaseline.findMany({ where, orderBy: { date: 'asc' } })),
      };
    }
    const ids = async (season: SeededSeason) => ({
      orders: (
        await prisma.order.findMany({
          where: { seasonId: season.seasonId },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      ).map((r) => r.id),
      snapshots: (
        await prisma.equitySnapshot.findMany({
          where: { seasonId: season.seasonId },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      ).map((r) => r.id),
      baselines: (
        await prisma.randomBaseline.findMany({
          where: { seasonId: season.seasonId },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      ).map((r) => r.id),
    });

    describe('aceite 1: a planilha conferida à mão, agora pelo caminho do banco', () => {
      it('o settle sobre os dados da planilha, gravados no banco de teste, devolve os mesmos centavos do CSV', async () => {
        const season = await world();
        await expect(handler.execute(message(season))).resolves.toEqual({
          status: 'settled',
          through: HAND_CHECKED_LAST,
          sessions: 5,
          finished: true,
        });

        for (const slug of SHEET) {
          expect(await orderRows(season, slug), `ordens de ${slug}`).toEqual(
            forCompetitor(readHandCheckedCsv('hand-checked-orders.csv'), slug),
          );
          expect(await positionRows(season, slug), `posições de ${slug}`).toEqual(
            forCompetitor(readHandCheckedCsv('hand-checked-positions.csv'), slug),
          );
          expect(await snapshotRows(season, slug), `fechamentos de ${slug}`).toEqual(
            forCompetitor(readHandCheckedCsv('hand-checked-snapshots.csv'), slug),
          );
        }
        const stats = [];
        for (const slug of SHEET) stats.push(await statRow(season, slug));
        expect(stats).toEqual(readHandCheckedCsv('hand-checked-stats.csv'));
      });

      it('o Sorteio também é liquidado, e todos têm percentil no Monte Carlo (a planilha não o cobre, os testes do domínio sim)', async () => {
        const season = await world();
        await handler.execute(message(season));
        const slugs = ['model-a', 'sorteio', 'equal-weight', 'cdi', 'bova11'];
        const stats = await prisma.seasonStat.findMany({ where: { seasonId: season.seasonId } });
        expect(stats).toHaveLength(slugs.length);
        for (const stat of stats) {
          expect(stat.percentileBps).toBeGreaterThanOrEqual(0);
          expect(stat.percentileBps).toBeLessThanOrEqual(10_000);
          expect(iso(stat.asOf)).toBe(HAND_CHECKED_LAST);
        }
        expect(await snapshotRows(season, 'sorteio')).toHaveLength(HAND_CHECKED_DATES.length);
        const snapshots = await prisma.equitySnapshot.findMany({
          where: { competitorId: season.competitors['sorteio']! },
        });
        expect(snapshots.every((s) => s.percentileBps !== null)).toBe(true);
        expect(await prisma.randomBaseline.count({ where: { seasonId: season.seasonId } })).toBe(5);
      });

      it('liga a ordem ao item da decisão que a originou; o item descartado não vira ordem e não desloca o índice', async () => {
        const season = await world({ decisions: false });
        // o item 0 foi descartado pelo validador (a venda de uma ação que não estava na carteira); o 1 vale
        const { itemIds } = await seedDecision(
          prisma,
          season.seasonId,
          '2026-11-03',
          [
            { ticker: 'BBB4', action: 'SELL', percent_of_position: 50 },
            { ticker: 'AAA3', action: 'BUY', percent_of_equity: 20 },
            { ticker: 'CCC3', action: 'HOLD' },
          ],
          { dropped: [0] },
        );
        await handler.execute(message(season, '2026-11-03'));

        const orders = await prisma.order.findMany({
          where: { competitorId: season.competitors['model-a']! },
        });
        expect(orders).toHaveLength(1);
        expect(orders[0]).toMatchObject({ ticker: 'AAA3', action: 'BUY', itemIndex: 0 });
        expect(orders[0]!.decisionItemId).toBe(itemIds[1]);
        const others = await prisma.order.findMany({
          where: { competitorId: { not: season.competitors['model-a']! } },
        });
        expect(others.length).toBeGreaterThan(0);
        expect(others.every((o) => o.decisionItemId === null)).toBe(true);
      });
    });

    describe('aceite 2: nenhuma ordem usa preço anterior à decisão', () => {
      it('toda execução sai pela abertura do próprio pregão, lida do banco, nunca pelo fechamento nem pelo preço de D-1', async () => {
        const season = await world();
        await handler.execute(message(season));

        const fills = await prisma.fill.findMany({ include: { order: true } });
        expect(fills.length).toBeGreaterThan(10);
        for (const fill of fills) {
          const bar = await prisma.dailyBar.findFirstOrThrow({
            where: { date: fill.order.date, instrument: { ticker: fill.order.ticker } },
          });
          expect(fill.priceCents, `${fill.order.ticker} em ${iso(fill.order.date)}`).toBe(
            bar.openCents,
          );
          expect(fill.order.priceCents).toBe(bar.openCents);
        }
      });

      it('AAA3 não tem barra em 05/11: a venda, com posição e fechamento anterior de R$ 25,00, não executa', async () => {
        const season = await world();
        await handler.execute(message(season));

        const order = await prisma.order.findFirstOrThrow({
          where: {
            competitorId: season.competitors['model-a']!,
            date: day('2026-11-05'),
            ticker: 'AAA3',
          },
          include: { fill: true },
        });
        expect(order).toMatchObject({
          status: 'NOT_EXECUTED',
          reason: 'no_bar',
          priceCents: null,
          filledQuantity: 0n,
        });
        expect(order.fill).toBeNull();
        // a posição fica na carteira, marcada pelo último fechamento (R$ 25,00 de 04/11)
        const position = await prisma.position.findFirstOrThrow({
          where: {
            competitorId: season.competitors['model-a']!,
            date: day('2026-11-05'),
            ticker: 'AAA3',
          },
        });
        expect(position).toMatchObject({ quantity: 43n, markCents: 2500n, stale: true });
      });
    });

    describe('aceite 3: o percentil é reproduzível', () => {
      it('dois settle com a mesma semente gravam o mesmo random_baseline, os mesmos percentis e as mesmas estatísticas', async () => {
        const season = await world();
        await handler.execute(message(season));
        const first = await content(season);
        const firstIds = await ids(season);
        expect(first.baselines).toHaveLength(5);
        expect(first.baselines[0]).toMatchObject({ seed: 'monte-carlo-teste', runs: 1000 });

        // refaz do zero: as linhas são substituídas (ids novos), e o conteúdo é o mesmo
        await jobs.reopen(message(season), 'de novo');
        await handler.execute(message(season));
        expect(await content(season)).toEqual(first);
        const secondIds = await ids(season);
        expect(secondIds.baselines).not.toEqual(firstIds.baselines);
        expect(secondIds.snapshots).not.toEqual(firstIds.snapshots);
      });

      it('outra semente dá outro resultado, sobre os mesmos dados', async () => {
        const season = await world();
        const other = await seedSeason(prisma, {
          slug: 'outra-semente',
          decisions: false,
          params: { monteCarloSeed: 'outra-semente-do-monte-carlo' },
        });
        await handler.execute(message(season));
        await handler.execute(message(other));
        const a = await prisma.randomBaseline.findMany({
          where: { seasonId: season.seasonId },
          orderBy: { date: 'asc' },
        });
        const b = await prisma.randomBaseline.findMany({
          where: { seasonId: other.seasonId },
          orderBy: { date: 'asc' },
        });
        expect(b[0]!.seed).toBe('outra-semente-do-monte-carlo');
        const distribution = (rows: typeof a) =>
          rows.map(({ id: _id, seasonId: _season, seed: _seed, ...rest }) => rest);
        expect(distribution(b)).not.toEqual(distribution(a));
      });
    });

    describe('idempotência e concorrência', () => {
      it('o mesmo settle duas vezes não muda nada: a segunda entrega é reconhecida pela linha de job_run', async () => {
        const season = await world();
        await handler.execute(message(season));
        const before = await ids(season);
        const contentBefore = await content(season);

        await expect(handler.execute(message(season))).resolves.toEqual({ status: 'already_done' });
        expect(await ids(season)).toEqual(before); // nem uma linha reescrita
        expect(await content(season)).toEqual(contentBefore);
        const rows = await prisma.jobRun.findMany({ where: { type: 'settle' } });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          queue: 'settlement',
          idempotencyKey: `${season.seasonId}:${HAND_CHECKED_LAST}`,
          status: 'SUCCEEDED',
          attempts: 1,
        });
      });

      it('entregas simultâneas da mesma mensagem: uma liquida, as outras esperam a fila ou nada fazem, e nada duplica', async () => {
        const season = await world();
        // o que uma liquidação sozinha grava; depois limpa e refaz com cinco entregas ao mesmo tempo
        await handler.execute(message(season));
        const single = await content(season);
        await repo.locked(season.seasonId, (db) =>
          repo.replace(db, season.seasonId, {
            orders: [],
            fills: [],
            positions: [],
            snapshots: [],
            stats: [],
            baselines: [],
          }),
        );
        await prisma.jobRun.deleteMany();
        expect((await content(season)).orders).toHaveLength(0);

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, () => handler.execute(message(season))),
        );
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        expect(fulfilled.filter((r) => r.value.status === 'settled')).toHaveLength(1);
        for (const result of results) {
          if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(JobBusyError);
        }
        expect(await content(season)).toEqual(single);
        expect(await prisma.jobRun.count({ where: { type: 'settle' } })).toBe(1);
      });

      // As mensagens de pregões diferentes da mesma temporada têm job_run diferentes: a trava consultiva é que as enfileira.
      it('mensagens de pregões diferentes da mesma temporada, ao mesmo tempo, terminam na temporada inteira e sem duplicata', async () => {
        const season = await world();
        await Promise.all(HAND_CHECKED_DATES.map((date) => handler.execute(message(season, date))));
        expect(await prisma.equitySnapshot.count({ where: { seasonId: season.seasonId } })).toBe(
          25,
        );
        expect(
          await prisma.equitySnapshot.groupBy({
            by: ['competitorId', 'date'],
            where: { seasonId: season.seasonId },
            _count: true,
          }),
        ).toHaveLength(25);
        const stats = await prisma.seasonStat.findMany({ where: { seasonId: season.seasonId } });
        expect(stats.every((s) => iso(s.asOf) === HAND_CHECKED_LAST)).toBe(true);
      });

      it('com a trava da temporada ocupada, a liquidação espera: nada é lido nem gravado até a outra terminar', async () => {
        const season = await world();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let held = false;
        const holding = repo.locked(season.seasonId, async () => {
          held = true;
          await gate;
        });
        while (!held) await sleep(10);

        let done = false;
        const running = handler.execute(message(season)).then((r) => {
          done = true;
          return r;
        });
        await sleep(400);
        expect(done).toBe(false);
        expect(await prisma.equitySnapshot.count()).toBe(0);

        release();
        await holding;
        await expect(running).resolves.toMatchObject({ status: 'settled' });
        expect(await prisma.equitySnapshot.count()).toBe(25);
      });

      it('temporadas diferentes não esperam uma pela outra', async () => {
        const first = await world();
        const second = await seedSeason(prisma, { slug: 'segunda', decisions: false });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let held = false;
        const holding = repo.locked(first.seasonId, async () => {
          held = true;
          await gate;
        });
        while (!held) await sleep(10);
        await expect(handler.execute(message(second))).resolves.toMatchObject({
          status: 'settled',
        });
        release();
        await holding;
      });
    });

    // Etapa 9: depois da liquidação concluída o worker revalida o site e limpa o Front Door, nessa ordem. O fetch e a credencial são
    // falsos: nenhum teste chama a Azure nem o site.
    describe('revalidação e purge depois da liquidação (etapa 9)', () => {
      const ENDPOINT =
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Cdn/profiles/afd/afdEndpoints/alvesting';

      function withCache(respond: (url: string) => Response | Error = () => new Response('{}')) {
        const urls: string[] = [];
        const fetchFake = ((input: string | URL | Request) => {
          const url =
            input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
          urls.push(url);
          const next = respond(url);
          return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
        }) as typeof fetch;
        const cache = new CacheRefresher({
          env: {
            WEB_INTERNAL_URL: 'https://ca-web.exemplo.io',
            REVALIDATE_SECRET: new Secret('segredo'),
            FRONT_DOOR_ENDPOINT_ID: ENDPOINT,
          },
          fetch: fetchFake,
          credential: {
            getToken: () =>
              Promise.resolve({ token: 't', expiresOnTimestamp: Date.now() + 60_000 }),
          },
        });
        const instance = new SettleHandler({
          jobs,
          arena,
          closer: new CycleCloser(arena),
          repo,
          calendar: loadTradingCalendar(),
          clock: () => NOW,
          cache,
        });
        return { instance, urls };
      }

      it('a liquidação de verdade pede a revalidação do site e depois o purge do Front Door, uma vez', async () => {
        const season = await world();
        const { instance, urls } = withCache();
        await expect(instance.execute(message(season))).resolves.toMatchObject({
          status: 'settled',
        });
        expect(urls).toEqual([
          'https://ca-web.exemplo.io/interno/revalidar',
          `https://management.azure.com${ENDPOINT}/purge?api-version=2025-06-01`,
        ]);
        // o resultado e o job estão gravados antes das chamadas
        expect(
          await prisma.seasonStat.count({ where: { seasonId: season.seasonId } }),
        ).toBeGreaterThan(0);
        expect((await prisma.jobRun.findFirstOrThrow({ where: { type: 'settle' } })).status).toBe(
          'SUCCEEDED',
        );
      });

      it('a mensagem repetida de uma liquidação já feita não chama nada', async () => {
        const season = await world();
        const { instance, urls } = withCache();
        await instance.execute(message(season));
        urls.length = 0;
        await expect(instance.execute(message(season))).resolves.toEqual({
          status: 'already_done',
        });
        expect(urls).toEqual([]);
      });

      it('o site fora do ar e a Azure recusando o purge não falham a liquidação: o resultado fica e o job termina SUCCEEDED', async () => {
        const season = await world();
        const { instance, urls } = withCache((url) =>
          url.includes('management.azure.com')
            ? new Response('{}', { status: 403 })
            : new TypeError('fetch failed'),
        );
        await expect(instance.execute(message(season))).resolves.toMatchObject({
          status: 'settled',
          finished: true,
        });
        expect(urls).toHaveLength(2); // as duas foram tentadas
        expect(
          await prisma.equitySnapshot.count({ where: { seasonId: season.seasonId } }),
        ).toBeGreaterThan(0);
        expect((await prisma.jobRun.findFirstOrThrow({ where: { type: 'settle' } })).status).toBe(
          'SUCCEEDED',
        );
      });

      it('liquidação que falha (dado incompleto) não revalida nem limpa nada: o resultado anterior segue valendo', async () => {
        const season = await world();
        await prisma.dailyBar.deleteMany({ where: { date: day('2026-11-09') } });
        const { instance, urls } = withCache();
        await expect(instance.execute(message(season))).rejects.toBeInstanceOf(IncompleteDataError);
        expect(urls).toEqual([]);
      });
    });

    describe('dados incompletos: não liquida, não apaga nada e deixa a fila tentar de novo', () => {
      it('sem barra nenhuma do universo no pregão (as barras do dia não foram carregadas): falha dizendo o dia', async () => {
        const season = await world();
        await prisma.dailyBar.deleteMany({ where: { date: day(HAND_CHECKED_LAST) } });

        await expect(handler.execute(message(season))).rejects.toThrow(IncompleteDataError);
        await expect(handler.execute(message(season))).rejects.toThrow(/2026-11-09/);
        expect(await prisma.equitySnapshot.count()).toBe(0);
        expect(await prisma.order.count()).toBe(0);
        const run = await prisma.jobRun.findFirstOrThrow({ where: { type: 'settle' } });
        expect(run.status).toBe('FAILED');
        expect(run.error).toContain('2026-11-09');
        expect(
          await prisma.season.findUniqueOrThrow({ where: { id: season.seasonId } }),
        ).toMatchObject({
          status: 'RUNNING',
        });
      });

      it('quando o dado chega, a nova entrega reassume a mesma mensagem e liquida (a nova tentativa da fila)', async () => {
        const season = await world();
        const lost = await prisma.dailyBar.findMany({
          where: { date: day(HAND_CHECKED_LAST) },
          include: { instrument: true },
        });
        await prisma.dailyBar.deleteMany({ where: { date: day(HAND_CHECKED_LAST) } });
        await expect(handler.execute(message(season))).rejects.toThrow(IncompleteDataError);

        await prisma.dailyBar.createMany({
          data: lost.map(({ instrument: _instrument, ...bar }) => ({ ...bar, id: newId() })),
        });
        await expect(handler.execute(message(season))).resolves.toMatchObject({
          status: 'settled',
        });
        const run = await prisma.jobRun.findFirstOrThrow({ where: { type: 'settle' } });
        expect(run).toMatchObject({ status: 'SUCCEEDED', attempts: 2, error: null });
      });

      it('semana sem universo congelado', async () => {
        const season = await world();
        await prisma.universeMember.deleteMany({ where: { snapshot: { week: '2026-W46' } } });
        await prisma.universeSnapshot.deleteMany({ where: { week: '2026-W46' } });
        await expect(handler.execute(message(season))).rejects.toThrow(/2026-W46/);
        expect(await prisma.equitySnapshot.count()).toBe(0);
      });

      it('sem nenhum CDI publicado até o pregão anterior', async () => {
        const season = await world();
        await prisma.macroDaily.deleteMany();
        await expect(handler.execute(message(season))).rejects.toThrow(/CDI/);
        expect(await prisma.equitySnapshot.count()).toBe(0);
      });

      it('falhar numa liquidação nova não apaga a anterior: o resultado até o pregão 04/11 continua como estava', async () => {
        const season = await world();
        await handler.execute(message(season, '2026-11-04'));
        const before = await content(season);
        expect(before.snapshots).toHaveLength(10);

        await prisma.dailyBar.deleteMany({ where: { date: day('2026-11-05') } });
        await expect(handler.execute(message(season, '2026-11-05'))).rejects.toThrow(
          IncompleteDataError,
        );
        expect(await content(season)).toEqual(before);
      });

      it('a posição sem barra no dia é marcada pelo último fechamento e liquida normalmente (daily_bar nunca é denso)', async () => {
        const season = await world();
        await expect(handler.execute(message(season, '2026-11-05'))).resolves.toMatchObject({
          status: 'settled',
        });
        const stale = await prisma.position.findMany({ where: { stale: true } });
        expect(stale.map((p) => [iso(p.date), p.ticker])).toContainEqual(['2026-11-05', 'AAA3']);
      });
    });

    describe('o que a liquidação lê das decisões', () => {
      it('pregão sem ciclo, ciclo pulado e HOLD forçado: o modelo fica no caixa e rende igual ao CDI', async () => {
        const season = await world({ decisions: false });
        // 03/11: ciclo pulado (sem briefing); 04/11: HOLD forçado; os outros três pregões não têm ciclo
        await arena.upsertCycle({
          seasonId: season.seasonId,
          date: '2026-11-03',
          decisionAt: new Date('2026-11-03T11:00:00Z'),
          deadlineAt: new Date('2026-11-03T12:30:00Z'),
          state: {
            status: 'SKIPPED',
            reason: 'sem_briefing',
            briefingId: null,
            promptVersionId: null,
          },
        });
        const { cycleId } = await seedDecision(prisma, season.seasonId, '2026-11-04', []);
        await prisma.decision.deleteMany({ where: { cycleId } });
        await arena.saveDecision(forcedHold(cycleId, season.competitors['model-a']!, 'falha'));

        await handler.execute(message(season));
        expect(
          await prisma.order.count({ where: { competitorId: season.competitors['model-a']! } }),
        ).toBe(0);
        expect(await snapshotRows(season, 'model-a')).toEqual(
          (await snapshotRows(season, 'cdi')).map((row) => ({ ...row, competitor: 'model-a' })),
        );
      });

      it('começa pela varredura: o ciclo vencido sem decisão fecha, o modelo vira HOLD "sem_resposta" e a liquidação segue', async () => {
        const season = await world({ decisions: false });
        const { cycleId } = await seedDecision(prisma, season.seasonId, '2026-11-03', []);
        // volta o ciclo a aberto e apaga a decisão: o job do modelo morreu e a fila não o fechou
        await prisma.decision.deleteMany({ where: { cycleId } });
        await prisma.cycle.update({
          where: { id: cycleId },
          data: { status: 'OPEN', closedAt: null },
        });

        await handler.execute(message(season));
        expect(await prisma.cycle.findUniqueOrThrow({ where: { id: cycleId } })).toMatchObject({
          status: 'CLOSED',
        });
        const decision = await prisma.decision.findFirstOrThrow({ where: { cycleId } });
        expect(decision).toMatchObject({ status: 'FORCED_HOLD', holdReason: 'sem_resposta' });
        expect(
          await prisma.order.count({ where: { competitorId: season.competitors['model-a']! } }),
        ).toBe(0);
      });
    });

    describe('até onde a liquidação vai', () => {
      it('liquida pregão a pregão: cada settle estende até o seu dia, o resultado é prefixo do seguinte e o último termina a temporada', async () => {
        const season = await world();
        const stages: Awaited<ReturnType<typeof content>>[] = [];
        for (const date of HAND_CHECKED_DATES) {
          const result = await handler.execute(message(season, date));
          expect(result).toMatchObject({ status: 'settled', through: date });
          stages.push(await content(season));
          const row = await prisma.season.findUniqueOrThrow({ where: { id: season.seasonId } });
          expect(row.status).toBe(date === HAND_CHECKED_LAST ? 'FINISHED' : 'RUNNING');
        }
        // 5 competidores x n pregões
        expect(stages.map((s) => s.snapshots.length)).toEqual([5, 10, 15, 20, 25]);
        // a temporada recalculada do zero: o que já estava liquidado não muda quando o dia seguinte chega
        const prefix = (n: number) =>
          stages[4]!.snapshots.filter((s) => s.date <= day(HAND_CHECKED_DATES[n]!));
        for (const n of [0, 1, 2, 3]) {
          expect(stages[n]!.snapshots).toEqual(prefix(n));
        }
      });

      it('um settle de pregão mais antigo depois do mais novo não encolhe a temporada: refaz até o último liquidado', async () => {
        const season = await world();
        await handler.execute(message(season));
        const before = await content(season);

        await expect(handler.execute(message(season, '2026-11-05'))).resolves.toMatchObject({
          status: 'settled',
          through: HAND_CHECKED_LAST,
          finished: false,
        });
        expect(await content(season)).toEqual(before);
        expect(await prisma.equitySnapshot.count({ where: { seasonId: season.seasonId } })).toBe(
          25,
        );
      });

      it('o último pregão marca a temporada FINISHED com a hora, na mesma transação; refazer não muda a hora', async () => {
        const season = await world();
        await handler.execute(message(season, '2026-11-04'));
        expect(
          await prisma.season.findUniqueOrThrow({ where: { id: season.seasonId } }),
        ).toMatchObject({
          status: 'RUNNING',
          finishedAt: null,
        });
        await expect(handler.execute(message(season))).resolves.toMatchObject({ finished: true });
        expect(
          await prisma.season.findUniqueOrThrow({ where: { id: season.seasonId } }),
        ).toMatchObject({
          status: 'FINISHED',
          finishedAt: NOW,
        });

        await jobs.reopen(message(season), 'refazer');
        const later = new SettleHandler({
          jobs,
          arena,
          closer: new CycleCloser(arena),
          repo,
          calendar: loadTradingCalendar(),
          clock: () => new Date('2026-11-12T10:00:00Z'),
        });
        await expect(later.execute(message(season))).resolves.toMatchObject({
          status: 'settled',
          finished: false, // já estava encerrada
        });
        expect(
          (await prisma.season.findUniqueOrThrow({ where: { id: season.seasonId } })).finishedAt,
        ).toEqual(NOW);
      });

      it('se a liquidação falha, a temporada não é encerrada (nem pela metade)', async () => {
        const season = await world();
        await prisma.macroDaily.deleteMany();
        await expect(handler.execute(message(season))).rejects.toThrow();
        expect(
          await prisma.season.findUniqueOrThrow({ where: { id: season.seasonId } }),
        ).toMatchObject({
          status: 'RUNNING',
          finishedAt: null,
        });
      });
    });

    describe('a mensagem tem de ser de uma temporada e de um pregão dela', () => {
      it('temporada que não existe', async () => {
        await world();
        await expect(
          handler.execute({ type: 'settle', seasonId: newId(), date: HAND_CHECKED_LAST }),
        ).rejects.toThrow(/inexistente/);
      });

      it('rascunho: ainda não começou', async () => {
        await seedMarket(prisma);
        const draft = await seedSeason(prisma, { status: 'DRAFT', decisions: false });
        await expect(handler.execute(message(draft))).rejects.toThrow(/não começou|DRAFT/);
        expect(await prisma.equitySnapshot.count()).toBe(0);
      });

      it('dia que não é pregão, pregão antes do início e pregão depois do último', async () => {
        const season = await world();
        await expect(handler.execute(message(season, '2026-11-07'))).rejects.toThrow(/pregão/);
        await expect(handler.execute(message(season, '2026-11-02'))).rejects.toThrow(/pregão/);
        await expect(handler.execute(message(season, '2026-11-10'))).rejects.toThrow(
          /último pregão/,
        );
        expect(await prisma.equitySnapshot.count()).toBe(0);
      });
    });

    describe('reliquidar: o dado mudou e a conta é refeita do zero', () => {
      it('o evento corporativo registrado depois da liquidação: a nova liquidação o aplica e bate com a planilha', async () => {
        await seedMarket(prisma, HAND_CHECKED_MARKET, { withEvents: false });
        const season = await seedSeason(prisma);
        await handler.execute(message(season));
        // sem o desdobramento de BBB4, 62 ações a R$ 12,50 parecem uma perda enorme
        const withoutEvent = await prisma.equitySnapshot.findFirstOrThrow({
          where: { competitorId: season.competitors['model-a']!, date: day('2026-11-05') },
        });
        expect(withoutEvent.equityCents).not.toBe(1_002_300n);

        await prisma.corporateEvent.create({
          data: {
            id: newId(),
            ticker: 'BBB4',
            exDate: day('2026-11-05'),
            kind: 'SPLIT',
            ratioFrom: 1,
            ratioTo: 2,
          },
        });
        await jobs.reopen(message(season), 'evento corporativo novo');
        await handler.execute(message(season));
        expect(await snapshotRows(season, 'model-a')).toEqual(
          forCompetitor(readHandCheckedCsv('hand-checked-snapshots.csv'), 'model-a'),
        );
      });

      it('as barras de um pregão corrigidas: a nova liquidação usa as certas', async () => {
        await seedMarket(prisma, HAND_CHECKED_MARKET);
        const season = await seedSeason(prisma);
        await handler.execute(message(season));
        const provisional = await snapshotRows(season, 'equal-weight');

        // a barra do pregão 06/11 é corrigida (outro fechamento de BBB4: a brapi estava ajustada por provento)
        await prisma.dailyBar.updateMany({
          where: { date: day('2026-11-06'), instrument: { ticker: 'BBB4' } },
          data: { closeCents: 1500n, highCents: 1500n },
        });
        await jobs.reopen(message(season), 'barras de 06/11 corrigidas');
        await handler.execute(message(season));
        const corrected = await snapshotRows(season, 'equal-weight');
        expect(corrected[3]).not.toEqual(provisional[3]); // 06/11 mudou
        expect(corrected[0]).toEqual(provisional[0]); // o que veio antes não muda
        // 144 x 2.550 + 266 x 1.500 (era 1.400) + 333 x 980
        expect(corrected[3]).toMatchObject({
          positions_value_cents: '1092540',
          equity_cents: '1095547',
        });
      });
    });
  },
);
