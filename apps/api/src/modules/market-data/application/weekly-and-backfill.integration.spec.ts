import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { cleanSettlementTables } from '../../settlement/testing/settlement.fixture.js';
import { QUOTA_RESERVE, historyStart } from '../domain/bar-plan.js';
import { type IsoDate } from '../domain/dates.js';
import { loadTradingCalendar } from '../domain/trading-calendar.js';
import { BrapiConfigError } from '../infrastructure/brapi.client.js';
import { MarketRepository } from '../infrastructure/market.repository.js';
import { UniverseRepository } from '../infrastructure/universe.repository.js';
import { at, brapiWorld, marketOf, type BrapiTestWorld } from '../testing/brapi-market.fixture.js';
import { BrapiBackfill } from './backfill.js';
import { BarLoader } from './bar-loader.js';
import { LogoRefresh } from './logo-refresh.js';
import { UniverseHandler } from './universe.handler.js';
import { WeeklyRefresh } from './weekly-refresh.js';

// A carga inicial, a atualização semanal e o universo de domingo sobre as barras da brapi (A6), no Postgres, com a brapi falsa (nenhuma rede).
// O domingo é 01/11/2026: a segunda-feira da semana ISO 2026-W45 é 02/11 (Finados, sem pregão), então a janela do universo são os 60 pregões
// até 30/10, e a semana que acabou vai de 26 a 30/10.
const calendar = loadTradingCalendar();
const SUNDAY = '2026-11-01';
const LAST = '2026-10-30';
const WEEK = '2026-W45';
// 3 meses de histórico a partir de domingo, 01/11/2026: 01/08
const FROM = historyStart(SUNDAY);
const DAYS = calendar.tradingDaysBetween(FROM, LAST);
const day = (date: IsoDate) => new Date(`${date}T00:00:00Z`);
const href = (input: Parameters<typeof fetch>[0]): string =>
  input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('carga inicial, atualização semanal e universo sobre as barras da brapi'),
  () => {
    let prisma: PrismaService;
    let market: MarketRepository;
    let universe: UniverseRepository;
    let jobs: JobRunStore;

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      market = new MarketRepository(prisma);
      universe = new UniverseRepository(prisma);
      jobs = new JobRunStore(prisma);
    }, 120_000);

    beforeEach(async () => {
      await cleanSettlementTables(prisma);
      await prisma.portfolioLot.deleteMany();
      await prisma.portfolio.deleteMany();
      vi.restoreAllMocks();
      for (const level of ['log', 'warn', 'error'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
      }
    });

    afterAll(async () => {
      await cleanSettlementTables(prisma);
      await prisma.onModuleDestroy();
    });

    const world = (
      tickers: string[],
      extra: Partial<Parameters<typeof brapiWorld>[0]> = {},
    ): BrapiTestWorld =>
      brapiWorld({
        market: marketOf({ days: DAYS, tickers }),
        start: at(SUNDAY, '09:00', 10),
        ...extra,
      });
    const backfill = (w: BrapiTestWorld) =>
      new BrapiBackfill(w.client, new BarLoader(w.client, market), market, calendar);
    const historical = (w: BrapiTestWorld) => w.calls.filter((c) => c.kind === 'historical');
    const lists = (w: BrapiTestWorld) => w.calls.filter((c) => c.kind === 'list');
    const input = { to: LAST, today: SUNDAY, fetch: true } as const;
    // n códigos de ação ON válidos (ABAA3, ABBA3...): o número do meio de 2 dígitos viraria sufixo de direito (ABC103 não é ação)
    const onStocks = (n: number) =>
      Array.from(
        { length: n },
        (_, i) =>
          `AB${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}3`,
      );

    describe('market:backfill (BrapiBackfill)', () => {
      it('o modo sem rede mostra quantos papéis e requisições faria e não pede nem escreve nada', async () => {
        const w = world(['BOVA11', 'PETR4', 'VALE3']);
        await market.insertInstruments(
          [{ ticker: 'PETR4', name: 'PETROBRAS', spec: 'PN', kind: 'STOCK' }],
          LAST,
        );
        const plan = await backfill(w).plan({ ...input, fetch: true });
        // o BOVA11 (sempre) e o PETR4 (que o banco já conhece) faltam; a lista da brapi soma uma requisição
        expect(plan).toEqual({
          from: DAYS[0],
          to: LAST,
          sessions: DAYS.length,
          papers: 2,
          requests: 3,
        });
        expect(w.calls).toEqual([]);
        expect(await prisma.dailyBar.count()).toBe(0);
        expect(await prisma.tradingDay.count()).toBe(0);
      });

      it('com a lista de papéis pedida, a conta não inclui a lista da brapi', async () => {
        const w = world(['BOVA11', 'PETR4']);
        const plan = await backfill(w).plan({ ...input, tickers: ['PETR4', 'BOVA11'] });
        expect(plan).toMatchObject({ papers: 2, requests: 2 });
      });

      it('carrega 3 meses de todo papel da lista mais o BOVA11, semeia os papéis e confirma os pregões', async () => {
        const w = world(['BOVA11', 'PETR4', 'VALE3', 'TAEE11']);
        const summary = await backfill(w).run(input);

        // a lista traz as 3 ações (PETR4, VALE3 e a unit), a carga soma o BOVA11: 1 requisição da lista e 1 por papel
        expect(lists(w)).toHaveLength(1);
        expect(
          historical(w)
            .map((c) => c.symbol)
            .sort(),
        ).toEqual(['BOVA11', 'PETR4', 'TAEE11', 'VALE3']);
        expect(historical(w).every((c) => c.from === DAYS[0] && c.to === LAST)).toBe(true);
        expect(summary).toMatchObject({
          requestsMade: 5,
          stopped: null,
          failed: [],
          inserted: DAYS.length * 4,
          confirmedDays: DAYS.length,
        });
        expect(summary.remaining).toBe(15_000 - 5);
        // a classe sai do sufixo; o ISIN fica nulo; o BOVA11 é a referência
        const rows = await prisma.instrument.findMany({ orderBy: { ticker: 'asc' } });
        expect(rows.map((r) => [r.ticker, r.spec, r.kind, r.isin])).toEqual([
          ['BOVA11', 'CI', 'REFERENCE', null],
          ['PETR4', 'PN', 'STOCK', null],
          ['TAEE11', 'UNT', 'STOCK', null],
          ['VALE3', 'ON', 'STOCK', null],
        ]);
        // todo pregão confirmado e toda barra gravada são da brapi, a única origem
        expect(await prisma.tradingDay.count({ where: { source: 'BRAPI' } })).toBe(DAYS.length);
        expect(await prisma.tradingDay.count()).toBe(DAYS.length);
        expect(await prisma.dailyBar.count({ where: { source: 'BRAPI' } })).toBe(DAYS.length * 4);
      });

      it('é retomável: a segunda passada pede só a falta, e uma terceira não pede nada', async () => {
        const w = world(['BOVA11', 'PETR4', 'VALE3'], {
          intercept: (url) =>
            url.searchParams.get('symbols') === 'VALE3'
              ? new Response('{}', { status: 503 })
              : undefined,
        });
        const first = await backfill(w).run({ ...input, tickers: ['BOVA11', 'PETR4', 'VALE3'] });
        expect(first.failed).toEqual(['VALE3']);
        expect(first.inserted).toBe(DAYS.length * 2);

        const w2 = world(['BOVA11', 'PETR4', 'VALE3']);
        const second = await backfill(w2).run({ ...input, tickers: ['BOVA11', 'PETR4', 'VALE3'] });
        expect(historical(w2).map((c) => c.symbol)).toEqual(['VALE3']);
        expect(second).toMatchObject({ inserted: DAYS.length, failed: [], requestsMade: 1 });

        const w3 = world(['BOVA11', 'PETR4', 'VALE3']);
        const third = await backfill(w3).run({ ...input, tickers: ['BOVA11', 'PETR4', 'VALE3'] });
        expect(w3.calls).toEqual([]);
        expect(third).toMatchObject({ requestsMade: 0, inserted: 0 });
      });

      it('a janela e os papéis pedidos recuperam só aquele papel naquele período', async () => {
        const w = world(['BOVA11', 'PETR4']);
        const summary = await backfill(w).run({
          ...input,
          tickers: ['petr4'],
          from: '2026-10-26',
        });
        expect(historical(w)).toEqual([
          { kind: 'historical', symbol: 'PETR4', from: '2026-10-26', to: LAST },
        ]);
        expect(summary).toMatchObject({ sessions: 5, papers: 1, inserted: 5, requestsMade: 1 });
        // a carga de um papel só nunca confirma pregão: o dia ficaria "confirmado" com a barra de um papel e o universo o aceitaria
        expect(summary).toMatchObject({ complete: false, confirmedDays: 0 });
        expect(await prisma.tradingDay.count()).toBe(0);
      });

      // O pregão só é confirmado por uma carga COMPLETA (backfill.ts): o universo exige os 60 pregões confirmados, e um dia confirmado com a
      // barra de poucos papéis o deixaria congelar-se com buraco.
      it('parada por cota: grava o que veio, não confirma nenhum pregão, e a passada seguinte completa e confirma', async () => {
        const tickers = ['BOVA11', 'PETR4', 'VALE3', 'TAEE11'];
        const w = world(tickers, { quota: QUOTA_RESERVE + 3 });
        const first = await backfill(w).run(input);
        expect(first).toMatchObject({ stopped: 'quota', complete: false, confirmedDays: 0 });
        expect(await prisma.dailyBar.count()).toBe(DAYS.length * 2); // o BOVA11 e o PETR4
        expect(await prisma.tradingDay.count({ where: { source: 'BRAPI' } })).toBe(0);

        const w2 = world(tickers);
        const second = await backfill(w2).run(input);
        expect(historical(w2).map((c) => c.symbol)).toEqual(['TAEE11', 'VALE3']); // só a falta
        expect(second).toMatchObject({ stopped: null, complete: true, confirmedDays: DAYS.length });
        expect(await prisma.tradingDay.count({ where: { source: 'BRAPI' } })).toBe(DAYS.length);
      });

      it('papéis sem resposta demais (acima de 10%) não confirmam; no limite de 10% confirmam; a seguinte pede só os que faltaram', async () => {
        const [a, b, ...rest] = onStocks(9);
        const tickers = ['BOVA11', a!, b!, ...rest];
        const failing = (names: string[]) => ({
          intercept: (url: URL) =>
            names.includes(url.searchParams.get('symbols') ?? '')
              ? new Response('{}', { status: 503 })
              : undefined,
        });

        const many = await backfill(world(tickers, failing([a!, b!]))).run(input);
        expect(many).toMatchObject({ failed: [a, b], complete: false, confirmedDays: 0 });
        expect(await prisma.tradingDay.count({ where: { source: 'BRAPI' } })).toBe(0);

        // a segunda passada pede só os dois que faltaram; 1 de 10 papéis sem resposta é o limite (MISSING_ALERT_PERCENT): ainda confirma
        const w2 = world(tickers, failing([b!]));
        const one = await backfill(w2).run(input);
        expect([...new Set(historical(w2).map((c) => c.symbol))]).toEqual([a, b]); // o 5xx do b repete uma vez
        expect(one).toMatchObject({ failed: [b], complete: true, confirmedDays: DAYS.length });
      });

      it('sem a barra do BOVA11 a carga não é completa, mesmo com 1 papel sem resposta em 20', async () => {
        const tickers = ['BOVA11', ...onStocks(19)];
        const w = world(tickers, {
          intercept: (url) =>
            url.searchParams.get('symbols') === 'BOVA11'
              ? new Response('{}', { status: 503 })
              : undefined,
        });
        const summary = await backfill(w).run(input);
        expect(summary).toMatchObject({ failed: ['BOVA11'], complete: false, confirmedDays: 0 });
        expect(await prisma.dailyBar.count()).toBe(DAYS.length * 19);
      });

      it('o token recusado (401) encerra a carga; o que veio antes ficou gravado e a próxima passada pede o resto', async () => {
        const w = world(['BOVA11', 'PETR4', 'VALE3'], {
          intercept: (url) =>
            url.searchParams.get('symbols') === 'PETR4'
              ? new Response('{}', { status: 401 })
              : undefined,
        });
        await expect(
          backfill(w).run({ ...input, tickers: ['BOVA11', 'PETR4', 'VALE3'] }),
        ).rejects.toThrow(BrapiConfigError);
        expect(historical(w).map((c) => c.symbol)).toEqual(['BOVA11', 'PETR4']);
        expect(await prisma.dailyBar.count()).toBe(DAYS.length); // o BOVA11

        const w2 = world(['BOVA11', 'PETR4', 'VALE3']);
        await backfill(w2).run({ ...input, tickers: ['BOVA11', 'PETR4', 'VALE3'] });
        expect(historical(w2).map((c) => c.symbol)).toEqual(['PETR4', 'VALE3']);
      });

      it('código malformado é recusado antes de qualquer requisição', async () => {
        const w = world(['BOVA11']);
        await expect(backfill(w).plan({ ...input, tickers: ['XX'] })).rejects.toThrow(RangeError);
        expect(w.calls).toEqual([]);
      });
    });

    describe('A6: a atualização semanal e o universo de domingo', () => {
      // O estado de uma semana comum: PETR4 e o BOVA11 são o conjunto diário, e a carga inicial trouxe 3 meses deles e do VALE3.
      async function loaded(w: BrapiTestWorld) {
        // a carga completa (a lista inteira): só ela confirma os pregões que o universo exige
        await backfill(w).run(input);
        const ids = new Map((await prisma.instrument.findMany()).map((i) => [i.ticker, i.id]));
        await prisma.universeSnapshot.create({
          data: {
            id: newId(),
            week: '2026-W44',
            windowStart: day('2026-07-20'),
            windowEnd: day('2026-10-23'),
            windowDays: 60,
            candidates: 1,
            eligible: 1,
            members: {
              create: [
                {
                  id: newId(),
                  instrumentId: ids.get('PETR4')!,
                  position: 1,
                  avgVolumeCents: 1n,
                  presenceDays: 60,
                },
              ],
            },
          },
        });
      }

      const refresh = (w: BrapiTestWorld) =>
        new WeeklyRefresh(w.client, new BarLoader(w.client, market), market, universe, calendar);

      it('papel novo da lista recebe 3 meses, candidato fora do conjunto diário recebe a semana, e o conjunto diário não é pedido', async () => {
        const w0 = world(['BOVA11', 'PETR4', 'VALE3']);
        await loaded(w0);
        // o VALE3 saiu do universo e ficou sem a semana que acabou (as barras dele de 26 a 30/10 não vieram)
        await prisma.dailyBar.deleteMany({
          where: { instrument: { ticker: 'VALE3' }, date: { gte: day('2026-10-26') } },
        });

        // a lista de agora: PETR4, VALE3 e dois papéis que o banco não conhece (uma ON e uma unit)
        const w = world(['BOVA11', 'PETR4', 'VALE3', 'NEWW3', 'UNIT11']);
        const summary = await refresh(w).run('2026-11-02', SUNDAY);

        expect(summary).toMatchObject({ listed: 4, created: 2, asked: 3, requests: 4 });
        expect(lists(w)).toHaveLength(1);
        expect(
          historical(w)
            .map((c) => [c.symbol, c.from, c.to])
            .sort(),
        ).toEqual([
          ['NEWW3', FROM, LAST], // 3 meses, contados a partir do dia da execução
          ['UNIT11', FROM, LAST],
          ['VALE3', '2026-10-26', LAST], // a semana
        ]);
        expect(historical(w).map((c) => c.symbol)).not.toContain('PETR4'); // o conjunto diário não é pedido de manhã de domingo
        const created = await prisma.instrument.findMany({
          where: { ticker: { in: ['NEWW3', 'UNIT11'] } },
          orderBy: { ticker: 'asc' },
        });
        expect(created.map((c) => [c.ticker, c.spec, c.isin, c.kind])).toEqual([
          ['NEWW3', 'ON', null, 'STOCK'],
          ['UNIT11', 'UNT', null, 'STOCK'],
        ]);
        expect(await prisma.dailyBar.count({ where: { instrument: { ticker: 'NEWW3' } } })).toBe(
          DAYS.length,
        );
        expect(
          await prisma.dailyBar.count({
            where: { instrument: { ticker: 'VALE3' }, date: { gte: day('2026-10-26') } },
          }),
        ).toBe(5);
      });

      it('na semana seguinte, sem nada novo, a atualização custa só a requisição da lista', async () => {
        const w0 = world(['BOVA11', 'PETR4', 'VALE3']);
        await loaded(w0);
        const w1 = world(['BOVA11', 'PETR4', 'VALE3', 'NEWW3']);
        await refresh(w1).run('2026-11-02', SUNDAY);
        const w2 = world(['BOVA11', 'PETR4', 'VALE3', 'NEWW3']);
        const summary = await refresh(w2).run('2026-11-02', SUNDAY);
        expect(summary).toMatchObject({ created: 0, asked: 0, requests: 1 });
        expect(historical(w2)).toEqual([]);
      });

      // Os logos (ADR 0036): no fim da atualização, o SVG de cada papel do banco que a lista traz com logo, por um fetch falso do icons.brapi.dev
      // (a brapi falsa só serve a lista e o histórico, com o token; os SVG vão por outro fetch, sem ele).
      it('no fim, os logos: guarda o SVG bom, recusa o inseguro, ignora o endereço fora da forma, e a semana seguinte só pede o que falta', async () => {
        await loaded(world(['BOVA11', 'PETR4', 'VALE3']));
        const url = (ticker: string) => `https://icons.brapi.dev/icons/${ticker}.svg`;
        const GOOD = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
        const icons: Array<{ url: string; authorization: string | null }> = [];
        const iconsFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          icons.push({
            url: href(input),
            authorization: new Headers(init?.headers).get('authorization'),
          });
          const body =
            href(input) === url('PETR4')
              ? GOOD
              : '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>';
          return Promise.resolve(
            new Response(body, { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
          );
        }) as typeof fetch;
        const logos = new Map<string, unknown>([
          ['PETR4', url('PETR4')],
          ['VALE3', url('VALE3')],
          // fora da forma: o cliente da lista o deixa sem logo, e nada é pedido
          ['NEWW3', 'https://exemplo.invalid/NEWW3.svg'],
        ]);
        const week = async () => {
          const w = world(['BOVA11', 'PETR4', 'VALE3', 'NEWW3'], { logos });
          await new WeeklyRefresh(
            w.client,
            new BarLoader(w.client, market),
            market,
            universe,
            calendar,
            new LogoRefresh(market, iconsFetch),
          ).run('2026-11-02', SUNDAY);
          return w;
        };

        const w = await week();
        expect(icons).toEqual([
          { url: url('PETR4'), authorization: null },
          { url: url('VALE3'), authorization: null },
        ]);
        // a brapi falsa viu só a lista e o histórico do papel novo (os SVG não passam por ela)
        expect(lists(w)).toHaveLength(1);
        expect(historical(w).map((c) => c.symbol)).toEqual(['NEWW3']);
        const rows = await prisma.instrumentLogo.findMany({ include: { instrument: true } });
        expect(
          rows.map((row) => [row.instrument.ticker, row.sourceUrl, row.svg, row.bytes]),
        ).toEqual([['PETR4', url('PETR4'), GOOD, Buffer.byteLength(GOOD)]]);

        // a semana seguinte: o PETR4 está guardado há menos de 30 dias; o VALE3, recusado, é pedido de novo
        icons.length = 0;
        await week();
        expect(icons.map((call) => call.url)).toEqual([url('VALE3')]);
        expect(await prisma.instrumentLogo.count()).toBe(1);
      });

      // A tabela só guarda o que passa no validador de hoje (ADR 0036): o SVG que entrou antes de uma regra nova sai na passada seguinte.
      it('a passada apaga do banco o SVG guardado que uma regra nova do validador passou a recusar, e o pede de novo', async () => {
        await loaded(world(['BOVA11', 'PETR4', 'VALE3']));
        const url = (ticker: string) => `https://icons.brapi.dev/icons/${ticker}.svg`;
        // guardado ontem, antes de o validador recusar <animate>: fresco (menos de 30 dias) e com o mesmo endereço, não seria pedido de novo
        const before =
          '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"><animate attributeName="x" values="0;1"/></rect></svg>';
        const vale = await prisma.instrument.findUniqueOrThrow({ where: { ticker: 'VALE3' } });
        await prisma.instrumentLogo.create({
          data: {
            instrumentId: vale.id,
            sourceUrl: url('VALE3'),
            svg: before,
            sha256: 'c'.repeat(64),
            bytes: Buffer.byteLength(before),
            fetchedAt: new Date(Date.now() - 86_400_000),
          },
        });
        const GOOD = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>';
        const asked: string[] = [];
        const iconsFetch = ((input: Parameters<typeof fetch>[0]) => {
          asked.push(href(input));
          return Promise.resolve(
            new Response(GOOD, { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
          );
        }) as typeof fetch;
        const warn = vi.spyOn(Logger.prototype, 'warn');
        const w = world(['BOVA11', 'PETR4', 'VALE3'], {
          logos: new Map([['VALE3', url('VALE3')]]),
        });
        await new WeeklyRefresh(
          w.client,
          new BarLoader(w.client, market),
          market,
          universe,
          calendar,
          new LogoRefresh(market, iconsFetch),
        ).run('2026-11-02', SUNDAY);

        expect(asked).toEqual([url('VALE3')]);
        expect(
          await prisma.instrumentLogo.findMany({ select: { instrumentId: true, svg: true } }),
        ).toEqual([{ instrumentId: vale.id, svg: GOOD }]);
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).toContain('VALE3');
        expect(logged).toContain('elemento <animate>');
        expect(logged).not.toContain('attributeName');
      });

      it('lista da brapi que não veio: segue sem ela, sem pedir mais nada e sem derrubar o universo', async () => {
        const w0 = world(['BOVA11', 'PETR4', 'VALE3']);
        await loaded(w0);
        const w = world(['BOVA11', 'PETR4', 'VALE3'], {
          intercept: (url) =>
            url.pathname === '/api/quote/list' ? new Response('{}', { status: 503 }) : undefined,
        });
        const summary = await refresh(w).run('2026-11-02', SUNDAY);
        expect(summary).toMatchObject({ listed: null, created: 0, asked: 0 });
        expect(historical(w)).toEqual([]);
      });

      it('o universo de domingo sai das barras da brapi, com o volume estimado (quantidade x fechamento), e fica congelado', async () => {
        const w0 = world(['BOVA11', 'PETR4', 'VALE3']);
        await loaded(w0);
        const w = world(['BOVA11', 'PETR4', 'VALE3', 'NEWW3']);
        const handler = new UniverseHandler(jobs, calendar, market, universe, refresh(w));
        await expect(handler.execute(WEEK, at(SUNDAY, '09:00', 10))).resolves.toBe('created');

        const snapshot = await prisma.universeSnapshot.findUniqueOrThrow({
          where: { week: WEEK },
          include: { members: { include: { instrument: true }, orderBy: { position: 'asc' } } },
        });
        // os 60 pregões até 30/10, todos confirmados pela brapi; as três ações passam na presença (NEWW3 veio na semanal, com 3 meses)
        expect(snapshot).toMatchObject({ windowDays: 60, candidates: 3, eligible: 3 });
        expect(snapshot.members.map((m) => m.instrument.ticker).sort()).toEqual([
          'NEWW3',
          'PETR4',
          'VALE3',
        ]);
        // o volume médio sai da soma das barras gravadas / 60: volume_cents é quantidade x fechamento
        const sums = await prisma.dailyBar.groupBy({
          by: ['instrumentId'],
          where: {
            date: { gte: day(snapshot.windowStart.toISOString().slice(0, 10)), lte: day(LAST) },
          },
          _sum: { volumeCents: true },
        });
        for (const member of snapshot.members) {
          const total = sums.find((s) => s.instrumentId === member.instrumentId)!._sum.volumeCents!;
          expect(member.avgVolumeCents).toBe(total / 60n);
        }
        // a semana seguinte já gravada só é reconhecida
        expect(
          await universe.saveSnapshot({
            week: WEEK,
            windowStart: LAST,
            windowEnd: LAST,
            windowDays: 1,
            selection: { candidates: 0, eligible: 0, members: [] },
          }),
        ).toBe('exists');
      });

      it('sem os 60 pregões confirmados (a carga inicial não rodou) o universo falha e diz como carregar', async () => {
        const w = world(['BOVA11', 'PETR4']);
        const handler = new UniverseHandler(jobs, calendar, market, universe, refresh(w));
        await expect(handler.execute(WEEK, at(SUNDAY, '09:00', 10))).rejects.toThrow(
          /faltam 60 pregões confirmados.*market:backfill/s,
        );
        expect(await prisma.universeSnapshot.count({ where: { week: WEEK } })).toBe(0);
      });
    });
  },
);
