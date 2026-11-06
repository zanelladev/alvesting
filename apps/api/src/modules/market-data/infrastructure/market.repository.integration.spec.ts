import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { InstrumentSeed } from '../domain/instruments.js';
import type { BrapiBar } from './brapi.client.js';
import { MarketRepository } from './market.repository.js';

const day = (value: string) => new Date(`${value}T00:00:00Z`);

const bar = (overrides: Partial<BrapiBar> = {}): BrapiBar => ({
  ticker: 'PETR4',
  date: '2026-10-30',
  openCents: 5245n,
  highCents: 5366n,
  lowCents: 5236n,
  closeCents: 5271n,
  volumeCents: 61_743_200n * 5271n,
  ...overrides,
});

const seed = (ticker: string, overrides: Partial<InstrumentSeed> = {}): InstrumentSeed => ({
  ticker,
  name: `${ticker} SA`,
  spec: 'ON',
  kind: 'STOCK',
  ...overrides,
});

describe.skipIf(!testDatabaseUrl)(integrationTitle('MarketRepository'), () => {
  let prisma: PrismaService;
  let repo: MarketRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    repo = new MarketRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    await prisma.portfolioLot.deleteMany();
    await prisma.portfolio.deleteMany();
    await prisma.position.deleteMany();
    await prisma.competitor.deleteMany();
    await prisma.season.deleteMany();
    await prisma.universeMember.deleteMany();
    await prisma.universeSnapshot.deleteMany();
    await prisma.dailyBar.deleteMany();
    await prisma.instrument.deleteMany();
    await prisma.tradingDay.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const bars = () =>
    prisma.dailyBar.findMany({
      include: { instrument: true },
      orderBy: [{ date: 'asc' }, { instrumentId: 'asc' }],
    });

  describe('insertInstruments', () => {
    it('semeia o papel novo com ISIN nulo, e devolve só os que criou', async () => {
      const created = await repo.insertInstruments(
        [seed('PETR4', { spec: 'PN' }), seed('TAEE11', { spec: 'UNT' })],
        '2026-10-30',
      );
      expect(created.sort()).toEqual(['PETR4', 'TAEE11']);
      const rows = await prisma.instrument.findMany({ orderBy: { ticker: 'asc' } });
      expect(rows).toMatchObject([
        {
          ticker: 'PETR4',
          name: 'PETR4 SA',
          isin: null,
          spec: 'PN',
          kind: 'STOCK',
        },
        { ticker: 'TAEE11', spec: 'UNT', isin: null },
      ]);
      expect(rows[0]!.lastSeen).toEqual(day('2026-10-30'));
    });

    it('o papel que já existe fica como está (nome, ISIN e classe gravados não são tocados)', async () => {
      await prisma.instrument.create({
        data: {
          id: newId(),
          ticker: 'PETR4',
          name: 'PETROBRAS',
          isin: 'BRPETRACNPR6',
          spec: 'PN',
          kind: 'STOCK',
          lastSeen: day('2026-10-01'),
        },
      });
      const created = await repo.insertInstruments(
        [seed('PETR4', { name: 'OUTRO NOME', spec: 'ON' }), seed('VALE3')],
        '2026-10-30',
      );
      expect(created).toEqual(['VALE3']);
      expect(
        await prisma.instrument.findUniqueOrThrow({ where: { ticker: 'PETR4' } }),
      ).toMatchObject({
        name: 'PETROBRAS',
        isin: 'BRPETRACNPR6',
        spec: 'PN',
        lastSeen: day('2026-10-01'),
      });
    });

    it('lista vazia não escreve nada, e repetir a semeadura não cria de novo', async () => {
      expect(await repo.insertInstruments([], '2026-10-30')).toEqual([]);
      await repo.insertInstruments([seed('PETR4')], '2026-10-30');
      expect(await repo.insertInstruments([seed('PETR4')], '2026-10-30')).toEqual([]);
      expect(await prisma.instrument.count()).toBe(1);
    });
  });

  describe('insertBars: só inserção, a barra gravada nunca muda', () => {
    beforeEach(async () => {
      await repo.insertInstruments([seed('PETR4', { spec: 'PN' }), seed('VALE3')], '2026-10-01');
    });

    it('grava a barra em centavos (bigint), de origem BRAPI, e avança o last_seen do papel', async () => {
      const result = await repo.insertBars([bar()]);
      expect(result).toEqual({ inserted: 1, divergent: [], unknown: [] });
      // o volume passa de 2^53 sem perder o último dígito (vai como texto e volta a bigint no SQL)
      await repo.insertBars([bar({ date: '2026-10-29', volumeCents: 2n ** 60n + 1n })]);
      expect(
        (await prisma.dailyBar.findFirstOrThrow({ where: { date: day('2026-10-29') } }))
          .volumeCents,
      ).toBe(2n ** 60n + 1n);
      await prisma.dailyBar.deleteMany({ where: { date: day('2026-10-29') } });
      const [row] = await bars();
      expect(row).toMatchObject({
        date: day('2026-10-30'),
        openCents: 5245n,
        highCents: 5366n,
        lowCents: 5236n,
        closeCents: 5271n,
        volumeCents: 61_743_200n * 5271n,
        source: 'BRAPI',
      });
      expect(row!.instrument.ticker).toBe('PETR4');
      expect(row!.instrument.lastSeen).toEqual(day('2026-10-30'));
    });

    it('o last_seen só avança: uma barra mais velha não o recua', async () => {
      await repo.insertBars([bar({ date: '2026-10-30' })]);
      await repo.insertBars([bar({ date: '2026-10-28' })]);
      expect(
        (await prisma.instrument.findUniqueOrThrow({ where: { ticker: 'PETR4' } })).lastSeen,
      ).toEqual(day('2026-10-30'));
    });

    it('a mesma barra de novo não escreve nada e não é divergência (a segunda entrega do eod)', async () => {
      await repo.insertBars([bar()]);
      const before = await prisma.$queryRaw<
        Array<{ xmin: string }>
      >`SELECT xmin::text FROM daily_bar`;
      const again = await repo.insertBars([bar()]);
      expect(again).toEqual({ inserted: 0, divergent: [], unknown: [] });
      const after = await prisma.$queryRaw<
        Array<{ xmin: string }>
      >`SELECT xmin::text FROM daily_bar`;
      expect(after).toEqual(before);
    });

    // A4: a barra existente nunca é sobrescrita, de qualquer fonte; a divergência é devolvida (e o sinal sai no log, no BarLoader).
    it('barra com valor diferente do gravado não muda nada e vira divergência, com os campos', async () => {
      await repo.insertBars([bar()]);
      const result = await repo.insertBars([
        bar({ closeCents: 5000n, highCents: 5400n, volumeCents: 1n }),
      ]);
      expect(result.inserted).toBe(0);
      expect(result.divergent).toEqual([
        { ticker: 'PETR4', date: '2026-10-30', fields: ['high', 'close', 'volume'] },
      ]);
      const [row] = await bars();
      expect(row).toMatchObject({ highCents: 5366n, closeCents: 5271n, source: 'BRAPI' });
    });

    it('a barra gravada por fora do insertBars (uma correção à mão, por exemplo) também nunca é sobrescrita pela da brapi', async () => {
      const petr4 = await prisma.instrument.findUniqueOrThrow({ where: { ticker: 'PETR4' } });
      await prisma.dailyBar.create({
        data: {
          id: newId(),
          instrumentId: petr4.id,
          date: day('2026-10-30'),
          openCents: 5245n,
          highCents: 5366n,
          lowCents: 5236n,
          closeCents: 5271n,
          volumeCents: 326_552_170_100n,
          source: 'BRAPI',
        },
      });
      const result = await repo.insertBars([bar({ volumeCents: 61_743_200n * 5271n + 7n })]);
      expect(result.inserted).toBe(0);
      expect(result.divergent).toEqual([
        { ticker: 'PETR4', date: '2026-10-30', fields: ['volume'] },
      ]);
      const [row] = await bars();
      expect(row).toMatchObject({ source: 'BRAPI', volumeCents: 326_552_170_100n });
    });

    it('lote misto: grava o que falta, aponta o que diverge e ignora o que já está igual', async () => {
      await repo.insertBars([bar({ date: '2026-10-29' }), bar({ date: '2026-10-30' })]);
      const result = await repo.insertBars([
        bar({ date: '2026-10-29' }),
        bar({ date: '2026-10-30', closeCents: 1n, lowCents: 1n }),
        bar({ date: '2026-11-03' }),
        bar({ ticker: 'VALE3', date: '2026-11-03' }),
      ]);
      expect(result.inserted).toBe(2);
      expect(result.divergent).toEqual([
        { ticker: 'PETR4', date: '2026-10-30', fields: ['low', 'close'] },
      ]);
      expect(await prisma.dailyBar.count()).toBe(4);
    });

    it('papel sem linha em instrument vai para unknown e a barra não é gravada', async () => {
      const result = await repo.insertBars([bar(), bar({ ticker: 'XYZW3' })]);
      expect(result).toMatchObject({ inserted: 1, unknown: ['XYZW3'] });
      expect(await prisma.dailyBar.count()).toBe(1);
    });

    it('papel e dia repetidos no mesmo lote valem uma vez (o INSERT não cai por chave duplicada)', async () => {
      const result = await repo.insertBars([bar(), bar()]);
      expect(result.inserted).toBe(1);
    });

    it('duas gravações ao mesmo tempo da mesma barra não duplicam nem falham', async () => {
      const [a, b] = await Promise.all([repo.insertBars([bar()]), repo.insertBars([bar()])]);
      expect(await prisma.dailyBar.count()).toBe(1);
      expect(a.inserted + b.inserted).toBe(1);
    });

    it('lista vazia não faz nada', async () => {
      expect(await repo.insertBars([])).toEqual({ inserted: 0, divergent: [], unknown: [] });
    });

    it('o banco recusa o que o cliente já filtra: máxima abaixo da mínima derruba o lote inteiro (CHECK)', async () => {
      await expect(repo.insertBars([bar({ highCents: 1n, lowCents: 2n })])).rejects.toThrow();
      expect(await prisma.dailyBar.count()).toBe(0);
    });
  });

  describe('barDates e confirmedDays', () => {
    it('barDates devolve os pregões de cada papel no intervalo, e só ele', async () => {
      await repo.insertInstruments([seed('PETR4'), seed('VALE3')], '2026-10-01');
      await repo.insertBars([
        bar({ date: '2026-10-28' }),
        bar({ date: '2026-10-29' }),
        bar({ date: '2026-10-30' }),
        bar({ ticker: 'VALE3', date: '2026-10-29' }),
      ]);
      const dates = await repo.barDates(['PETR4', 'VALE3', 'XYZW3'], '2026-10-29', '2026-10-30');
      expect(dates).toEqual(
        new Map([
          ['PETR4', new Set(['2026-10-29', '2026-10-30'])],
          ['VALE3', new Set(['2026-10-29'])],
        ]),
      );
      expect((await repo.barDates([], '2026-10-29', '2026-10-30')).size).toBe(0);
    });

    it('confirmedDays ignora o dia só previsto (CALENDAR)', async () => {
      await repo.seedCalendar(['2026-11-03', '2026-11-04']);
      await prisma.tradingDay.createMany({
        data: [
          { date: day('2026-10-29'), source: 'BRAPI' },
          { date: day('2026-10-30'), source: 'BRAPI' },
        ],
      });
      expect(
        await repo.confirmedDays(['2026-10-29', '2026-10-30', '2026-11-03', '2026-11-04']),
      ).toEqual(new Set(['2026-10-29', '2026-10-30']));
      expect((await repo.confirmedDays([])).size).toBe(0);
    });
  });

  describe('confirmTradingDays', () => {
    beforeEach(async () => {
      await repo.insertInstruments([seed('PETR4')], '2026-10-01');
    });

    it('confirma como BRAPI o dia que tem barra, e devolve os dias confirmados agora', async () => {
      await repo.insertBars([bar({ date: '2026-10-29' }), bar({ date: '2026-10-30' })]);
      const confirmed = await repo.confirmTradingDays(['2026-10-30', '2026-10-29']);
      expect(confirmed).toEqual(['2026-10-29', '2026-10-30']);
      const rows = await prisma.tradingDay.findMany({ orderBy: { date: 'asc' } });
      expect(rows).toEqual([
        { date: day('2026-10-29'), source: 'BRAPI' },
        { date: day('2026-10-30'), source: 'BRAPI' },
      ]);
    });

    it('um dia sem nenhuma barra não é confirmado (seria "confirmado" sem dado)', async () => {
      await repo.insertBars([bar({ date: '2026-10-30' })]);
      expect(await repo.confirmTradingDays(['2026-10-29', '2026-10-30'])).toEqual(['2026-10-30']);
      expect(await prisma.tradingDay.count()).toBe(1);
    });

    it('promove o dia previsto (CALENDAR) e nunca reescreve o dia já confirmado: a linha dele nem é escrita de novo', async () => {
      await repo.insertBars([
        bar({ date: '2026-10-28' }),
        bar({ date: '2026-10-29' }),
        bar({ date: '2026-10-30' }),
      ]);
      await repo.seedCalendar(['2026-10-30']);
      await prisma.tradingDay.createMany({
        data: [
          { date: day('2026-10-28'), source: 'BRAPI' },
          { date: day('2026-10-29'), source: 'BRAPI' },
        ],
      });
      // o xmin muda quando a linha é escrita: o dia já confirmado tem de ficar com o mesmo
      const stamp = (date: string) =>
        prisma.$queryRaw<Array<{ xmin: string }>>`
          SELECT xmin::text FROM trading_day WHERE date = ${date}::date`;
      const before = await stamp('2026-10-29');
      expect(await repo.confirmTradingDays(['2026-10-28', '2026-10-29', '2026-10-30'])).toEqual([
        '2026-10-30',
      ]);
      const rows = await prisma.tradingDay.findMany({ orderBy: { date: 'asc' } });
      expect(rows.map((r) => r.source)).toEqual(['BRAPI', 'BRAPI', 'BRAPI']);
      expect(await stamp('2026-10-29')).toEqual(before);
    });

    it('repetir não confirma de novo nem muda a linha', async () => {
      await repo.insertBars([bar()]);
      await repo.confirmTradingDays(['2026-10-30']);
      expect(await repo.confirmTradingDays(['2026-10-30'])).toEqual([]);
      expect(await repo.confirmTradingDays([])).toEqual([]);
    });
  });

  describe('seedCalendar', () => {
    it('cria o dia previsto uma vez e nunca rebaixa o dia já confirmado', async () => {
      await prisma.tradingDay.create({ data: { date: day('2026-10-30'), source: 'BRAPI' } });
      expect(await repo.seedCalendar(['2026-10-30', '2026-11-03'])).toBe(1);
      expect(await repo.seedCalendar(['2026-10-30', '2026-11-03'])).toBe(0);
      expect(await repo.seedCalendar([])).toBe(0);
      const rows = await prisma.tradingDay.findMany({ orderBy: { date: 'asc' } });
      expect(rows.map((r) => r.source)).toEqual(['BRAPI', 'CALENDAR']);
    });
  });

  describe('stockTickers, heldTickers e portfolioTickers', () => {
    it('stockTickers: as ações à vista em ordem de ticker, sem a referência', async () => {
      await repo.insertInstruments(
        [seed('VALE3'), seed('PETR4'), seed('BOVA11', { kind: 'REFERENCE', spec: 'CI' })],
        '2026-10-01',
      );
      expect(await repo.stockTickers()).toEqual(['PETR4', 'VALE3']);
    });

    it('heldTickers: os papéis em posição na última liquidação das temporadas em andamento', async () => {
      const running = await seasonWithPositions('RUNNING', [
        ['2026-11-03', 'PETR4', 10n],
        ['2026-11-04', 'PETR4', 10n],
        ['2026-11-04', 'AMER3', 5n],
      ]);
      await seasonWithPositions('FINISHED', [['2026-11-04', 'WEGE3', 3n]]);
      await seasonWithPositions('DRAFT', [['2026-11-04', 'ITUB4', 3n]]);
      expect(running).toBeDefined();
      // só a data mais nova de cada temporada; temporada encerrada ou rascunho não conta
      expect(await repo.heldTickers()).toEqual(['AMER3', 'PETR4']);
    });

    // O max(date) da temporada vale uma vez (LATERAL), e não por linha: a subconsulta correlacionada relia a temporada inteira a cada
    // posição (O(n²)): 6,5 mil posições levavam 11 s e 36 mil, 100 s, contra o statement_timeout de 60 s do worker. 60 pregões é o
    // máximo que o contrato aceita; 334 papéis é o tamanho de uma temporada real (igual-peso, BOVA11, modelos e Sorteio).
    it('heldTickers responde em menos de 1 s com 20 mil posições numa temporada em andamento', async () => {
      const season = await seasonWithPositions('RUNNING', []);
      const competitor = await prisma.competitor.findFirstOrThrow({
        where: { seasonId: season.id },
      });
      await prisma.$executeRaw`
        INSERT INTO "position" (id, season_id, competitor_id, date, ticker, quantity, cost_cents, mark_cents, value_cents, stale)
        SELECT lpad(to_hex(d * 1000 + t), 26, '0'), ${season.id}, ${competitor.id}, DATE '2026-08-03' + d,
          'T' || lpad(t::text, 4, '0'), 1, 1000, 100, 100, false
        FROM generate_series(0, 59) AS d, generate_series(0, 333) AS t
        WHERE d < 59 OR t < 300`;
      expect(await prisma.position.count({ where: { seasonId: season.id } })).toBe(59 * 334 + 300);

      const started = performance.now();
      const held = await repo.heldTickers();
      expect(performance.now() - started).toBeLessThan(1000);
      // só a data mais nova da temporada
      expect(held).toHaveLength(300);
      expect([held[0], held.at(-1)]).toEqual(['T0000', 'T0299']);
    }, 180_000);

    it('portfolioTickers: o ticker de cada lançamento das carteiras, sem repetir e sem dado pessoal', async () => {
      const user = await prisma.user.create({
        data: {
          id: newId(),
          name: 'Teste',
          email: `carteira-${newId().toLowerCase()}@example.test`,
          emailVerified: true,
        },
      });
      const portfolio = await prisma.portfolio.create({ data: { id: newId(), userId: user.id } });
      for (const ticker of ['WEGE3', 'ITUB4', 'WEGE3']) {
        await prisma.portfolioLot.create({
          data: { id: newId(), portfolioId: portfolio.id, ticker, quantity: 10, costCents: 1000n },
        });
      }
      expect(await repo.portfolioTickers()).toEqual(['ITUB4', 'WEGE3']);
      await prisma.user.delete({ where: { id: user.id } });
    });

    async function seasonWithPositions(
      status: 'DRAFT' | 'RUNNING' | 'FINISHED',
      rows: Array<[string, string, bigint]>,
    ) {
      const season = await prisma.season.create({
        data: {
          id: newId(),
          slug: `temporada-${newId().toLowerCase()}`,
          name: 'Temporada de teste',
          status,
          startDate: status === 'DRAFT' ? null : day('2026-11-03'),
          finishedAt: status === 'FINISHED' ? new Date('2026-11-10T03:00:00Z') : null,
          params: {},
        },
      });
      const competitor = await prisma.competitor.create({
        data: {
          id: newId(),
          seasonId: season.id,
          slug: 'modelo',
          name: 'Modelo',
          kind: 'RANDOM',
          position: 1,
        },
      });
      for (const [date, ticker, quantity] of rows) {
        await prisma.position.create({
          data: {
            id: newId(),
            seasonId: season.id,
            competitorId: competitor.id,
            date: day(date),
            ticker,
            quantity,
            costCents: 1000n,
            markCents: 100n,
            valueCents: 100n * quantity,
            stale: false,
          },
        });
      }
      return season;
    }
  });

  // Os logos das ações (ADR 0036): quem pede o SVG, a gravação e a rede de segurança do banco. Os SVG são escritos aqui.
  describe('os logos: logoTargets, saveLogo e touchLogo', () => {
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const URL_PETR = 'https://icons.brapi.dev/icons/PETR4.svg';
    const sha = (char: string) => char.repeat(64);
    const logo = (instrumentId: string, overrides: Record<string, unknown> = {}) => ({
      instrumentId,
      sourceUrl: URL_PETR,
      svg: SVG,
      sha256: sha('a'),
      bytes: Buffer.byteLength(SVG),
      fetchedAt: new Date('2026-11-01T12:00:00Z'),
      ...overrides,
    });
    const idOf = async (ticker: string) =>
      (await prisma.instrument.findUniqueOrThrow({ where: { ticker } })).id;

    beforeEach(async () => {
      await repo.insertInstruments([seed('PETR4'), seed('VALE3'), seed('ITUB4')], '2026-10-30');
    });

    it('logoTargets: os papéis do banco entre os pedidos, com o logo guardado ou nulo; o papel que o banco não tem fica de fora', async () => {
      await repo.saveLogo(logo(await idOf('PETR4')));
      const targets = await repo.logoTargets(['VALE3', 'PETR4', 'ZZZZ3']);
      expect(targets).toEqual([
        {
          instrumentId: await idOf('PETR4'),
          ticker: 'PETR4',
          stored: {
            sourceUrl: URL_PETR,
            sha256: sha('a'),
            fetchedAt: new Date('2026-11-01T12:00:00Z'),
          },
        },
        { instrumentId: await idOf('VALE3'), ticker: 'VALE3', stored: null },
      ]);
      expect(await repo.logoTargets([])).toEqual([]);
    });

    it('saveLogo cria e, com outro SHA-256, troca o SVG inteiro; touchLogo só anda o endereço e a data, sem regravar o SVG', async () => {
      const id = await idOf('PETR4');
      await repo.saveLogo(logo(id));
      const other = SVG.replace('width="1"', 'width="2"');
      const later = new Date('2026-11-08T12:00:00Z');
      await repo.saveLogo(
        logo(id, {
          svg: other,
          sha256: sha('b'),
          bytes: Buffer.byteLength(other),
          fetchedAt: later,
        }),
      );
      expect(
        await prisma.instrumentLogo.findUniqueOrThrow({ where: { instrumentId: id } }),
      ).toEqual({
        instrumentId: id,
        sourceUrl: URL_PETR,
        svg: other,
        sha256: sha('b'),
        bytes: Buffer.byteLength(other),
        fetchedAt: later,
      });
      const moved = 'https://icons.brapi.dev/icons/PETR3.svg';
      const latest = new Date('2026-12-09T12:00:00Z');
      await repo.touchLogo(id, moved, latest);
      expect(
        await prisma.instrumentLogo.findUniqueOrThrow({ where: { instrumentId: id } }),
      ).toMatchObject({
        sourceUrl: moved,
        svg: other,
        sha256: sha('b'),
        fetchedAt: latest,
      });
    });

    it('o banco recusa o tamanho que não é o do SVG, o que passa do teto, o vazio e o SHA-256 fora do formato', async () => {
      const id = await idOf('PETR4');
      const big = `<svg>${'a'.repeat(204_800)}</svg>`;
      for (const bad of [
        { bytes: 3 },
        { svg: big, bytes: Buffer.byteLength(big) },
        { svg: '', bytes: 0 },
        { sha256: sha('A') },
        { sha256: 'a'.repeat(63) + 'g' },
      ]) {
        await expect(
          repo.saveLogo(logo(id, bad)),
          JSON.stringify(Object.keys(bad)),
        ).rejects.toThrow();
      }
      expect(await prisma.instrumentLogo.count()).toBe(0);
    });

    it('storedLogos devolve todo logo guardado com o SVG, em ordem de ticker; deleteLogo apaga só o do papel', async () => {
      const [petr, vale] = [await idOf('PETR4'), await idOf('VALE3')];
      await repo.saveLogo(logo(vale));
      await repo.saveLogo(logo(petr));
      expect(await repo.storedLogos()).toEqual([
        { instrumentId: petr, ticker: 'PETR4', svg: SVG },
        { instrumentId: vale, ticker: 'VALE3', svg: SVG },
      ]);
      await repo.deleteLogo(petr);
      await repo.deleteLogo(petr); // de novo: nada a apagar, sem erro
      expect((await repo.storedLogos()).map((row) => row.ticker)).toEqual(['VALE3']);
    });

    it('o logo some com o papel (cascata): a limpeza de instrument não trava', async () => {
      await repo.saveLogo(logo(await idOf('PETR4')));
      await prisma.instrument.deleteMany();
      expect(await prisma.instrumentLogo.count()).toBe(0);
    });
  });
});
