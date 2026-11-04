import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { CycleCloser } from '../../arena/application/cycle-closer.js';
import { ArenaRepository } from '../../arena/infrastructure/arena.repository.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { SettlementRepository } from '../infrastructure/settlement.repository.js';
import {
  HAND_CHECKED_LAST,
  HAND_CHECKED_MARKET,
  cleanSettlementTables,
  day,
  readHandCheckedCsv,
  seedMarket,
  seedSeason,
} from '../testing/settlement.fixture.js';
import {
  CorporateEventInputError,
  CorporateEventService,
  SettlementFailedError,
  recordCorporateEvent,
} from './corporate-event.service.js';
import { SettleHandler } from './settle.handler.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

const NOW = new Date('2026-11-10T00:35:00Z');
const SPLIT = { ticker: 'BBB4', exDate: '2026-11-05', kind: 'split', factor: '1:2' };

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('CorporateEventService (registrar o evento e reliquidar)'),
  () => {
    let prisma: PrismaService;
    let jobs: JobRunStore;
    let settle: SettleHandler;
    let service: CorporateEventService;

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      jobs = new JobRunStore(prisma);
      const arena = new ArenaRepository(prisma);
      const repo = new SettlementRepository(prisma);
      settle = new SettleHandler({
        jobs,
        arena,
        closer: new CycleCloser(arena),
        repo,
        calendar: loadTradingCalendar(),
        clock: () => NOW,
      });
      service = new CorporateEventService({ repo, jobs, settle });
    }, 120_000);

    beforeEach(async () => {
      await cleanSettlementTables(prisma);
    });

    afterAll(async () => {
      await cleanSettlementTables(prisma);
      await prisma.onModuleDestroy();
    });

    // A planilha sem o desdobramento de BBB4 na data ex (05/11), já liquidada
    async function worldWithoutEvent(slug?: string) {
      await seedMarket(prisma, HAND_CHECKED_MARKET, { withEvents: false });
      const season = await seedSeason(prisma, slug ? { slug } : {});
      await settle.execute({ type: 'settle', seasonId: season.seasonId, date: HAND_CHECKED_LAST });
      return season;
    }
    const equityOf = async (competitorId: string) =>
      (
        await prisma.equitySnapshot.findMany({ where: { competitorId }, orderBy: { date: 'asc' } })
      ).map((s) => [s.date.toISOString().slice(0, 10), s.equityCents.toString()]);
    const sheetEquity = (slug: string) =>
      readHandCheckedCsv('hand-checked-snapshots.csv')
        .filter((row) => row['competitor'] === slug)
        .map((row) => [row['date'], row['equity_cents']]);

    it('registra o desdobramento e reliquida a temporada: o resultado passa a bater com a planilha', async () => {
      const season = await worldWithoutEvent();
      expect(await equityOf(season.competitors['model-a']!)).not.toEqual(sheetEquity('model-a'));

      const result = await service.register(SPLIT, NOW, 'cli');

      expect(result.event).toMatchObject({
        ticker: 'BBB4',
        exDate: '2026-11-05',
        kind: 'SPLIT',
        ratioFrom: 1,
        ratioTo: 2,
        change: 'created',
      });
      expect(result.settled).toEqual([
        { season: 'planilha', through: HAND_CHECKED_LAST, finished: false },
      ]);
      expect(await equityOf(season.competitors['model-a']!)).toEqual(sheetEquity('model-a'));
      expect(await equityOf(season.competitors['equal-weight']!)).toEqual(
        sheetEquity('equal-weight'),
      );
      expect(await prisma.corporateEvent.count()).toBe(1);
    });

    it('repetir o mesmo comando não muda o evento nem o resultado (ele reliquida de novo, por se a anterior falhou)', async () => {
      const season = await worldWithoutEvent();
      await service.register(SPLIT, NOW, 'cli');
      const before = await equityOf(season.competitors['model-a']!);

      const again = await service.register(SPLIT, NOW, 'cli');
      expect(again.event.change).toBe('unchanged');
      expect(again.settled).toHaveLength(1);
      expect(await equityOf(season.competitors['model-a']!)).toEqual(before);
      expect(await prisma.corporateEvent.count()).toBe(1);
      expect(await prisma.auditLog.count()).toBe(1); // só a criação: repetir não deixa rastro novo
    });

    it('o mesmo ticker, data ex e tipo com outro fator corrige o evento e reliquida', async () => {
      const season = await worldWithoutEvent();
      await service.register(SPLIT, NOW, 'cli');
      const sheet = await equityOf(season.competitors['equal-weight']!);

      const fixed = await service.register({ ...SPLIT, factor: '1:3' }, NOW, 'cli');
      expect(fixed.event).toMatchObject({ change: 'updated', ratioFrom: 1, ratioTo: 3 });
      expect(await prisma.corporateEvent.count()).toBe(1);
      expect(await equityOf(season.competitors['equal-weight']!)).not.toEqual(sheet);

      // o fator antigo não se perde: a criação e a correção ficam na trilha de auditoria, com quem pediu
      const trail = await prisma.auditLog.findMany({ orderBy: { action: 'asc' } });
      expect(trail.map((row) => [row.action, row.actor, row.target])).toEqual([
        ['corporate_event.created', 'cli', 'BBB4:2026-11-05:SPLIT'],
        ['corporate_event.updated', 'cli', 'BBB4:2026-11-05:SPLIT'],
      ]);
      expect(trail[1]!.detail).toMatchObject({
        before: { from: 1, to: 2 },
        after: { from: 1, to: 3 },
      });
    });

    it('vale para a temporada já encerrada, e ela continua encerrada com a mesma hora', async () => {
      const season = await worldWithoutEvent();
      const row = await prisma.season.findUniqueOrThrow({ where: { id: season.seasonId } });
      expect(row.status).toBe('FINISHED');

      await service.register(SPLIT, NOW, 'cli');
      expect(
        await prisma.season.findUniqueOrThrow({ where: { id: season.seasonId } }),
      ).toMatchObject({ status: 'FINISHED', finishedAt: row.finishedAt });
    });

    it('reliquida cada temporada que já liquidou até a data ex, e só elas', async () => {
      const first = await worldWithoutEvent('primeira');
      // a segunda temporada só foi liquidada até 04/11, antes da data ex: o evento entra quando ela chegar lá
      const second = await seedSeason(prisma, { slug: 'segunda', decisions: false });
      await settle.execute({ type: 'settle', seasonId: second.seasonId, date: '2026-11-04' });
      // a terceira nunca foi liquidada
      await seedSeason(prisma, { slug: 'terceira', decisions: false });

      const result = await service.register(SPLIT, NOW, 'cli');
      expect(result.settled.map((s) => s.season)).toEqual(['primeira']);
      expect(result.pending).toEqual(['segunda']);
      expect(await equityOf(first.competitors['model-a']!)).toEqual(sheetEquity('model-a'));
      expect(await prisma.equitySnapshot.count({ where: { seasonId: second.seasonId } })).toBe(10); // continua até 04/11
    });

    it('evento de uma data ex depois do último pregão liquidado fica registrado, sem reliquidar nada', async () => {
      await worldWithoutEvent();
      const result = await service.register({ ...SPLIT, exDate: '2026-11-20' }, NOW, 'cli');
      expect(result.settled).toEqual([]);
      expect(await prisma.corporateEvent.count({ where: { exDate: day('2026-11-20') } })).toBe(1);
    });

    describe('valida a entrada antes de tocar no banco', () => {
      const bad = async (input: unknown, pattern: RegExp) => {
        await worldWithoutEvent();
        await expect(service.register(input, NOW, 'cli')).rejects.toThrow(CorporateEventInputError);
        await expect(service.register(input, NOW, 'cli')).rejects.toThrow(pattern);
        expect(await prisma.corporateEvent.count()).toBe(0);
      };

      it('ticker fora do formato da B3', () => bad({ ...SPLIT, ticker: 'bbb' }, /ticker/));
      it('data ex que não existe', () => bad({ ...SPLIT, exDate: '2026-02-30' }, /exDate/));
      it('tipo desconhecido', () => bad({ ...SPLIT, kind: 'dividendo' }, /kind/));
      it('fator torto', () => bad({ ...SPLIT, factor: '2' }, /factor/));
      it('fator com zero', () => bad({ ...SPLIT, factor: '0:2' }, /factor/));
      it('fator que não muda nada', () => bad({ ...SPLIT, factor: '2:2' }, /aumentam|reduz/));
      it('desdobramento que reduz as ações (o fator ao contrário)', () =>
        bad({ ...SPLIT, factor: '2:1' }, /desdobramento/));
      it('grupamento que aumenta as ações', () =>
        bad({ ...SPLIT, kind: 'reverse-split', factor: '1:2' }, /grupamento/));
      it('campo a mais', () => bad({ ...SPLIT, provento: 'x' }, /provento/));
      it('entrada que nem é um objeto', () => bad('BBB4', /./));
    });

    it('ticker que não está no banco: erro dizendo como carregar os preços, e nada é gravado', async () => {
      await worldWithoutEvent();
      await expect(service.register({ ...SPLIT, ticker: 'ZZZZ3' }, NOW, 'cli')).rejects.toThrow(
        /ZZZZ3.*market:backfill/s,
      );
      expect(await prisma.corporateEvent.count()).toBe(0);
    });

    it('o ticker digitado em minúsculas, no terminal, é aceito', async () => {
      await worldWithoutEvent();
      const result = await service.register({ ...SPLIT, ticker: 'bbb4' }, NOW, 'cli');
      expect(result.event.ticker).toBe('BBB4');
    });

    it('se a reliquidação falha, o evento fica registrado e o erro diz qual temporada e por quê', async () => {
      await worldWithoutEvent();
      // as barras de um pregão do meio da temporada sumiram: a conta não fecha
      await prisma.dailyBar.deleteMany({ where: { date: day('2026-11-06') } });
      await expect(service.register(SPLIT, NOW, 'cli')).rejects.toThrow(/planilha.*2026-11-06/s);
      // com tipo próprio: a rota do admin responde 409 (o evento está salvo, falta o dado), e não 500
      await expect(service.register(SPLIT, NOW, 'cli')).rejects.toBeInstanceOf(
        SettlementFailedError,
      );
      expect(await prisma.corporateEvent.count()).toBe(1);
      // a liquidação anterior continua inteira
      expect(await prisma.equitySnapshot.count()).toBe(25);
    });

    // A rota do admin devolve `safe` na resposta 409. O dado que falta (erro de domínio da liquidação, mensagem nossa) entra nela; o texto
    // de qualquer outro erro (Prisma, pg, rede: host, SQL, texto do driver) fica só no `message`, que o comando mostra e a rota manda ao log.
    it('a mensagem para a resposta da rota só carrega o dado que falta; o erro inesperado vira uma frase fixa (o texto completo fica em message)', async () => {
      await worldWithoutEvent();
      await prisma.dailyBar.deleteMany({ where: { date: day('2026-11-06') } });
      const known = await service.register(SPLIT, NOW, 'cli').catch((e: unknown) => e);
      expect(known).toBeInstanceOf(SettlementFailedError);
      expect((known as SettlementFailedError).safe).toMatch(/planilha.*2026-11-06/s);
      expect((known as SettlementFailedError).safe).toBe((known as SettlementFailedError).message);

      const boom = new CorporateEventService({
        repo: new SettlementRepository(prisma),
        jobs,
        settle: {
          execute: () =>
            Promise.reject(
              new Error('connect ECONNREFUSED 10.20.30.40:5432 SELECT * FROM "equity_snapshot"'),
            ),
        },
      });
      const unexpected = await boom.register(SPLIT, NOW, 'cli').catch((e: unknown) => e);
      expect(unexpected).toBeInstanceOf(SettlementFailedError);
      const { message, safe } = unexpected as SettlementFailedError;
      expect(message).toContain('ECONNREFUSED 10.20.30.40');
      expect(safe).toContain('planilha');
      expect(safe).not.toMatch(/ECONNREFUSED|10\.20\.30\.40|SELECT/);
      expect(safe).toContain('veja o log da api');
    });

    // O caminho da api (POST /admin/corporate-events): só REGISTRA e diz quais temporadas pedem liquidação de novo; quem enfileira é o
    // SettlementPublisher.resettle. O papel do Postgres da api não escreve nas tabelas de resultado, então nada aqui toca nelas.
    describe('recordCorporateEvent (sem liquidar)', () => {
      const repo = () => new SettlementRepository(prisma);

      it('registra o evento e devolve as temporadas que já liquidaram até a data ex, SEM refazer o resultado nem mexer no job', async () => {
        const season = await worldWithoutEvent();
        const before = await equityOf(season.competitors['model-a']!);
        const jobsBefore = await prisma.jobRun.findMany({ orderBy: { id: 'asc' } });

        const recorded = await recordCorporateEvent(
          repo(),
          SPLIT,
          'admin:01JZZZZZZZZZZZZZZZZZZZZZZZ',
        );

        expect(recorded.event).toEqual({
          ticker: 'BBB4',
          exDate: '2026-11-05',
          kind: 'SPLIT',
          ratioFrom: 1,
          ratioTo: 2,
          change: 'created',
        });
        expect(recorded.due).toEqual([
          { seasonId: season.seasonId, slug: 'planilha', through: HAND_CHECKED_LAST },
        ]);
        expect(recorded.pending).toEqual([]);
        // o resultado publicado e as linhas de job_run ficam como estavam: a liquidação é do worker
        expect(await equityOf(season.competitors['model-a']!)).toEqual(before);
        expect(await prisma.jobRun.findMany({ orderBy: { id: 'asc' } })).toEqual(jobsBefore);
        expect(await prisma.corporateEvent.count()).toBe(1);
        const audit = await prisma.auditLog.findFirstOrThrow({
          where: { action: 'corporate_event.created' },
        });
        expect(audit.actor).toBe('admin:01JZZZZZZZZZZZZZZZZZZZZZZZ');
      });

      it('evento depois do último pregão liquidado: fica registrado e a temporada entra em "pending"', async () => {
        await worldWithoutEvent();
        const recorded = await recordCorporateEvent(
          repo(),
          { ...SPLIT, exDate: '2026-12-01' },
          'cli',
        );
        expect(recorded.due).toEqual([]);
        expect(recorded.pending).toEqual(['planilha']);
      });

      it('repetir não muda o evento (unchanged) e continua devolvendo a temporada a liquidar', async () => {
        await worldWithoutEvent();
        await recordCorporateEvent(repo(), SPLIT, 'cli');
        const again = await recordCorporateEvent(repo(), SPLIT, 'cli');
        expect(again.event.change).toBe('unchanged');
        expect(again.due).toHaveLength(1);
        expect(await prisma.corporateEvent.count()).toBe(1);
      });

      it('valida a entrada antes de tocar no banco, com a mesma recusa do comando', async () => {
        await expect(
          recordCorporateEvent(repo(), { ...SPLIT, factor: '2:1' }, 'cli'),
        ).rejects.toBeInstanceOf(CorporateEventInputError);
        await expect(
          recordCorporateEvent(repo(), { ...SPLIT, ticker: 'ZZZZ3' }, 'cli'),
        ).rejects.toThrow(/ZZZZ3 não está no banco/);
        expect(await prisma.corporateEvent.count()).toBe(0);
      });
    });
  },
);
