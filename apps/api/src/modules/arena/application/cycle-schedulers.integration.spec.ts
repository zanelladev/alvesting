import { seasonFileSchema, type QueueMessage, type SeasonFile } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { messageId } from '@alvesting/contracts';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { ArenaRepository } from '../infrastructure/arena.repository.js';
import { ALERT_LOG, ALERT_SIGNAL } from '../../../telemetry/alert-logs.js';
import { PROMPT_VERSION, seasonFile } from '../testing/arena.fixture.js';
import { CycleCloser } from './cycle-closer.js';
import { CycleSchedulers, RERUN_MARGIN_MS } from './cycle-schedulers.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
// 08:00:05 em Brasília de terça, 03/11/2026 (o primeiro pregão depois do Finados)
const AT_0800 = new Date('2026-11-03T11:00:05Z');

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('CycleSchedulers (sched-cycle, 0 11 * * 1-5)'),
  () => {
    let prisma: PrismaService;
    let repo: ArenaRepository;
    const calendar = loadTradingCalendar();

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      repo = new ArenaRepository(prisma);
    }, 120_000);

    beforeEach(async () => {
      await prisma.decisionItem.deleteMany();
      await prisma.decision.deleteMany();
      await prisma.cycle.deleteMany();
      await prisma.promptVersion.deleteMany();
      await prisma.competitor.deleteMany();
      await prisma.season.deleteMany();
      await prisma.briefing.deleteMany();
    });

    afterAll(async () => {
      await prisma.onModuleDestroy();
    });

    function setup(
      env: {
        PROMPT_ARENA_VERSION?: string | undefined;
        ARENA_MONTHLY_COST_CAP_USD?: string | undefined;
      } = {
        PROMPT_ARENA_VERSION: PROMPT_VERSION,
      },
    ) {
      const published: QueueMessage[] = [];
      const messaging = {
        publish: vi.fn((message: QueueMessage) => {
          published.push(message);
          return Promise.resolve();
        }),
      };
      const closer = { closeOverdue: vi.fn(() => Promise.resolve(0)) };
      const scheduler = new CycleSchedulers({ messaging, calendar, repo, env, closer });
      return { scheduler, published, messaging, closer };
    }

    async function runningSeason(overrides: Partial<SeasonFile> = {}, startDate = '2026-11-03') {
      const id = await repo.createSeason(seasonFileSchema.parse(seasonFile(overrides)));
      await repo.startSeason(id, startDate, new Date('2026-11-01T18:00:00Z'));
      return id;
    }
    const briefing = (date = '2026-11-03') =>
      prisma.briefing.create({
        data: {
          id: newId(),
          date: day(date),
          sha256: 'a'.repeat(64),
          uri: `https://blob/${date}`,
          bytes: 10,
        },
      });
    const paidSeason = (): Partial<SeasonFile> => ({
      competitors: seasonFile().competitors.map((c) =>
        c.kind === 'MODEL' && c.slug === 'fake-a'
          ? { ...c, provider: 'openrouter' as const, modelId: 'anthropic/claude-opus-5.5' }
          : c,
      ),
    });
    // gasto do mês: uma decisão de ciclo anterior com custo
    async function spend(micro: bigint, seasonId: string) {
      const b = await prisma.briefing.create({
        data: { id: newId(), date: day('2026-11-02'), sha256: 'b'.repeat(64), uri: 'x', bytes: 1 },
      });
      const pv = await repo.ensurePromptVersion(PROMPT_VERSION);
      const { cycle } = await repo.upsertCycle({
        seasonId,
        date: '2026-11-02',
        decisionAt: new Date('2026-11-02T11:00:00Z'),
        deadlineAt: new Date('2026-11-02T12:30:00Z'),
        state: { status: 'OPEN', briefingId: b.id, promptVersionId: pv.id },
      });
      const [a] = await repo.modelCompetitors(seasonId);
      await prisma.decision.create({
        data: {
          id: newId(),
          cycleId: cycle.id,
          competitorId: a!.id,
          status: 'DECIDED',
          marketView: 'neutro',
          summary: 's',
          costMicroUsd: micro,
        },
      });
    }

    it('cria o ciclo, fixa o briefing e a versão do prompt e publica uma decide por competidor MODEL', async () => {
      const seasonId = await runningSeason();
      await briefing();
      const t = setup();

      const result = await t.scheduler.cycle(AT_0800);

      expect(result).toEqual([{ season: 'temporada-teste', result: 'published', published: 3 }]);
      const models = await repo.modelCompetitors(seasonId);
      const cycle = await prisma.cycle.findFirstOrThrow({
        include: { briefing: true, promptVersion: true },
      });
      expect(cycle).toMatchObject({ seasonId, status: 'OPEN', skipReason: null });
      expect(cycle.date).toEqual(day('2026-11-03'));
      expect(cycle.decisionAt).toEqual(new Date('2026-11-03T11:00:00Z')); // 08:00 em Brasília
      expect(cycle.deadlineAt).toEqual(new Date('2026-11-03T12:30:00Z')); // 09:30
      expect(cycle.briefing!.sha256).toBe('a'.repeat(64));
      expect(cycle.promptVersion).toMatchObject({ version: PROMPT_VERSION, sha256: null });
      expect(t.published).toEqual(
        models.map((m) => ({ type: 'decide', cycleId: cycle.id, competitorId: m.id })),
      );
    });

    it('só o MODEL recebe decide: nada para o Sorteio nem para as referências', async () => {
      await runningSeason();
      await briefing();
      const t = setup();
      await t.scheduler.cycle(AT_0800);
      expect(t.published).toHaveLength(3);
      expect(new Set(t.published.map((m) => m.type))).toEqual(new Set(['decide']));
    });

    it('é idempotente: rodar duas vezes cria um ciclo e republica as mesmas mensagens (mesmo MessageId)', async () => {
      await runningSeason();
      await briefing();
      const t = setup();
      await t.scheduler.cycle(AT_0800);
      await t.scheduler.cycle(new Date(AT_0800.getTime() + 90_000));
      expect(await prisma.cycle.count()).toBe(1);
      expect(t.published).toHaveLength(6);
      expect(t.published.slice(0, 3).map(messageId)).toEqual(t.published.slice(3).map(messageId));
    });

    it('não é pregão: o Finados (02/11) e o sábado não criam ciclo nem publicam', async () => {
      await runningSeason();
      const t = setup();
      expect(await t.scheduler.cycle(new Date('2026-11-02T11:00:00Z'))).toEqual([]);
      expect(await t.scheduler.cycle(new Date('2026-11-07T11:00:00Z'))).toEqual([]);
      expect(await prisma.cycle.count()).toBe(0);
      expect(t.published).toEqual([]);
    });

    it('sem temporada RUNNING (rascunho não conta) não faz nada', async () => {
      await repo.createSeason(seasonFileSchema.parse(seasonFile()));
      const t = setup();
      expect(await t.scheduler.cycle(AT_0800)).toEqual([]);
      expect(t.published).toEqual([]);
      expect(await prisma.cycle.count()).toBe(0);
    });

    it('a temporada que começa depois de hoje ainda não tem ciclo', async () => {
      await runningSeason({}, '2026-11-04');
      await briefing();
      const t = setup();
      expect(await t.scheduler.cycle(AT_0800)).toEqual([
        { season: 'temporada-teste', result: 'not_started' },
      ]);
      expect(t.published).toEqual([]);
    });

    it('depois do último pregão da temporada não abre ciclo novo (5 pregões: 3, 4, 5, 6 e 9 de novembro)', async () => {
      await runningSeason();
      await briefing('2026-11-09');
      await briefing('2026-11-10');
      const t = setup();
      const ninth = await t.scheduler.cycle(new Date('2026-11-09T11:00:05Z'));
      expect(ninth).toEqual([{ season: 'temporada-teste', result: 'published', published: 3 }]);
      const tenth = await t.scheduler.cycle(new Date('2026-11-10T11:00:05Z'));
      expect(tenth).toEqual([{ season: 'temporada-teste', result: 'season_over' }]);
      expect(await prisma.cycle.count()).toBe(1);
    });

    describe('sem briefing', () => {
      it('registra o ciclo como pulado, com o motivo, e não publica nada (nenhum modelo é chamado)', async () => {
        await runningSeason();
        const t = setup();
        expect(await t.scheduler.cycle(AT_0800)).toEqual([
          { season: 'temporada-teste', result: 'skipped', reason: 'sem_briefing' },
        ]);
        expect(await prisma.cycle.findFirstOrThrow()).toMatchObject({
          status: 'SKIPPED',
          skipReason: 'sem_briefing',
          briefingId: null,
        });
        expect(t.published).toEqual([]);
      });

      it('rodar de novo com o briefing já congelado reavalia o ciclo pulado e o abre', async () => {
        await runningSeason();
        const t = setup();
        await t.scheduler.cycle(AT_0800);
        await briefing(); // o freeze foi reenviado da DLQ e rodou
        const result = await t.scheduler.cycle(new Date(AT_0800.getTime() + 600_000));
        expect(result).toEqual([{ season: 'temporada-teste', result: 'published', published: 3 }]);
        expect(await prisma.cycle.count()).toBe(1);
        expect(await prisma.cycle.findFirstOrThrow()).toMatchObject({
          status: 'OPEN',
          skipReason: null,
        });
      });
    });

    // A arena parada sem aviso era a lacuna do alerta de orçamento do Azure (que não vê o gasto do OpenRouter): o ciclo pulado escreve a linha
    // `ALERT_LOG.cycleSkipped`, que vira o sinal `ciclo-pulado` da regra de log (alerta na primeira vez; docs/INFRA.md, 5.3). O texto mora em
    // telemetry/alert-logs.ts, e o telemetry.spec.ts e o infra/tests/check.mjs conferem o Bicep contra ele.
    describe('o sinal ciclo-pulado (falha forçada)', () => {
      const skippedLines = (warn: { mock: { calls: unknown[][] } }) =>
        warn.mock.calls.filter((call) => call[1] === ALERT_LOG.cycleSkipped);

      it('o sinal existe, com o nome e a linha que a regra de log procura', () => {
        expect(ALERT_SIGNAL.cycleSkipped).toBe('ciclo-pulado');
        expect(ALERT_LOG.cycleSkipped).toBe(
          'sched-cycle: ciclo pulado, nenhum modelo será chamado',
        );
      });

      it('sem briefing: escreve a linha do alerta, com o pregão, a temporada e o motivo (nunca texto de prompt nem dado pessoal)', async () => {
        await runningSeason();
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
          await setup().scheduler.cycle(AT_0800);
          const lines = skippedLines(warn);
          expect(lines).toHaveLength(1);
          expect(lines[0]![0]).toEqual({
            date: '2026-11-03',
            season: 'temporada-teste',
            reason: 'sem_briefing',
          });
        } finally {
          warn.mockRestore();
        }
      });

      it('teto de custo estourado: escreve a linha com o motivo orcamento', async () => {
        const seasonId = await runningSeason(paidSeason());
        await briefing();
        await spend(10_000_000n, seasonId);
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
          await setup({
            PROMPT_ARENA_VERSION: PROMPT_VERSION,
            ARENA_MONTHLY_COST_CAP_USD: '10',
          }).scheduler.cycle(AT_0800);
          const lines = skippedLines(warn);
          expect(lines).toHaveLength(1);
          expect(lines[0]![0]).toMatchObject({ reason: 'orcamento' });
        } finally {
          warn.mockRestore();
        }
      });

      it('o ciclo que abre normalmente NÃO escreve a linha (senão o alerta dispararia todo dia)', async () => {
        await runningSeason();
        await briefing();
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
          expect(await setup().scheduler.cycle(AT_0800)).toEqual([
            { season: 'temporada-teste', result: 'published', published: 3 },
          ]);
          expect(skippedLines(warn)).toEqual([]);
        } finally {
          warn.mockRestore();
        }
      });

      it('dia sem pregão e temporada sem ciclo a abrir também não escrevem a linha', async () => {
        await runningSeason();
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        try {
          await setup().scheduler.cycle(new Date('2026-11-01T11:00:05Z')); // domingo
          expect(skippedLines(warn)).toEqual([]);
        } finally {
          warn.mockRestore();
        }
      });
    });

    describe('teto de custo do mês (US$)', () => {
      it('com modelo pago e o gasto do mês no teto, o ciclo é pulado por orçamento', async () => {
        const seasonId = await runningSeason(paidSeason());
        await briefing();
        await spend(10_000_000n, seasonId); // US$ 10 já gastos em 02/11
        const t = setup({ PROMPT_ARENA_VERSION: PROMPT_VERSION, ARENA_MONTHLY_COST_CAP_USD: '10' });
        expect(await t.scheduler.cycle(AT_0800)).toEqual([
          { season: 'temporada-teste', result: 'skipped', reason: 'orcamento' },
        ]);
        expect(
          await prisma.cycle.findFirstOrThrow({ where: { date: day('2026-11-03') } }),
        ).toMatchObject({
          status: 'SKIPPED',
          skipReason: 'orcamento',
        });
        expect(t.published).toEqual([]);
      });

      it('abaixo do teto o ciclo abre', async () => {
        const seasonId = await runningSeason(paidSeason());
        await briefing();
        await spend(9_999_999n, seasonId);
        const t = setup({ PROMPT_ARENA_VERSION: PROMPT_VERSION, ARENA_MONTHLY_COST_CAP_USD: '10' });
        expect(await t.scheduler.cycle(AT_0800)).toEqual([
          { season: 'temporada-teste', result: 'published', published: 3 },
        ]);
      });

      it('com modelo pago e sem o teto configurado, pula (fail closed): sem teto não se gasta', async () => {
        await runningSeason(paidSeason());
        await briefing();
        const t = setup({ PROMPT_ARENA_VERSION: PROMPT_VERSION });
        expect(await t.scheduler.cycle(AT_0800)).toEqual([
          { season: 'temporada-teste', result: 'skipped', reason: 'orcamento' },
        ]);
        expect(t.published).toEqual([]);
      });

      it('só fakes custam zero: o teto nem é consultado (nem configurado, nem estourado)', async () => {
        const seasonId = await runningSeason();
        await briefing();
        await spend(999_000_000n, seasonId);
        const t = setup({ PROMPT_ARENA_VERSION: PROMPT_VERSION, ARENA_MONTHLY_COST_CAP_USD: '1' });
        expect(await t.scheduler.cycle(AT_0800)).toEqual([
          { season: 'temporada-teste', result: 'published', published: 3 },
        ]);
      });

      it('o gasto do mês anterior não conta', async () => {
        const seasonId = await runningSeason(paidSeason());
        await briefing();
        const b = await prisma.briefing.create({
          data: {
            id: newId(),
            date: day('2026-10-30'),
            sha256: 'c'.repeat(64),
            uri: 'x',
            bytes: 1,
          },
        });
        const pv = await repo.ensurePromptVersion(PROMPT_VERSION);
        const { cycle } = await repo.upsertCycle({
          seasonId,
          date: '2026-10-30',
          decisionAt: new Date('2026-10-30T11:00:00Z'),
          deadlineAt: new Date('2026-10-30T12:30:00Z'),
          state: { status: 'OPEN', briefingId: b.id, promptVersionId: pv.id },
        });
        const [a] = await repo.modelCompetitors(seasonId);
        await prisma.decision.create({
          data: {
            id: newId(),
            cycleId: cycle.id,
            competitorId: a!.id,
            status: 'DECIDED',
            marketView: 'neutro',
            summary: 's',
            costMicroUsd: 500_000_000n,
          },
        });
        const t = setup({ PROMPT_ARENA_VERSION: PROMPT_VERSION, ARENA_MONTHLY_COST_CAP_USD: '10' });
        expect(await t.scheduler.cycle(AT_0800)).toEqual([
          { season: 'temporada-teste', result: 'published', published: 3 },
        ]);
      });
    });

    it('sem PROMPT_ARENA_VERSION não há versão do prompt para fixar: falha dizendo a variável', async () => {
      await runningSeason();
      await briefing();
      const t = setup({});
      await expect(t.scheduler.cycle(AT_0800)).rejects.toThrow(/PROMPT_ARENA_VERSION/);
      expect(t.published).toEqual([]);
    });

    it('falha em uma publicação não impede as outras e sobe o erro (o job tenta de novo, e publicar de novo é seguro)', async () => {
      await runningSeason();
      await briefing();
      const t = setup();
      t.messaging.publish.mockRejectedValueOnce(new Error('Service Bus fora'));
      await expect(t.scheduler.cycle(AT_0800)).rejects.toThrow(/1 de 3.*Service Bus fora/s);
      expect(t.published).toHaveLength(2);
      // a nova execução do job republica tudo; o ciclo continua um só
      await t.scheduler.cycle(new Date(AT_0800.getTime() + 60_000));
      expect(await prisma.cycle.count()).toBe(1);
      expect(t.published.slice(2).map(messageId)).toHaveLength(3);
    });

    it('antes de abrir o ciclo do dia, varre os ciclos vencidos (um erro da varredura não impede o ciclo)', async () => {
      await runningSeason();
      await briefing();
      const t = setup();
      t.closer.closeOverdue.mockRejectedValueOnce(new Error('banco lento'));
      const result = await t.scheduler.cycle(AT_0800);
      expect(t.closer.closeOverdue).toHaveBeenCalledWith(AT_0800);
      expect(result).toEqual([{ season: 'temporada-teste', result: 'published', published: 3 }]);
    });

    it('o CycleCloser de verdade fecha o ciclo vencido de ontem antes do de hoje', async () => {
      const seasonId = await runningSeason({}, '2026-10-30');
      await briefing('2026-10-30');
      await briefing('2026-11-03');
      const closer = new CycleCloser(repo);
      const scheduler = new CycleSchedulers({
        messaging: { publish: vi.fn(() => Promise.resolve()) },
        calendar,
        repo,
        env: { PROMPT_ARENA_VERSION: PROMPT_VERSION },
        closer,
      });
      await scheduler.cycle(new Date('2026-10-30T11:00:05Z'));
      expect(
        (await prisma.cycle.findFirstOrThrow({ where: { date: day('2026-10-30') } })).status,
      ).toBe('OPEN');
      // ninguém respondeu; no pregão seguinte o ciclo de 30/10 está vencido
      await scheduler.cycle(AT_0800);
      expect(
        await prisma.cycle.findFirstOrThrow({ where: { date: day('2026-10-30') } }),
      ).toMatchObject({
        status: 'CLOSED',
      });
      expect(await prisma.decision.count({ where: { holdReason: 'sem_resposta' } })).toBe(3);
      expect(seasonId).toBeDefined();
    });

    // O reprocesso do admin (POST /admin/cycles/:date/rerun; docs/API.md, seção 8): o mesmo caminho do agendador, com três regras a mais.
    // Nunca publica a menos de RERUN_MARGIN_MS (5 minutos) do prazo das 09:30 nem depois dele (um decide tardio gravaria HOLD "prazo":
    // uma decisão depois do prazo, e o worker leva até 30 s da KEDA mais a partida do job para pegar a mensagem), nunca antes da hora da
    // decisão, e só para quem ainda não tem decisão gravada. Não varre os ciclos vencidos de outros dias.
    describe('rerun (admin)', () => {
      const AT_0829 = new Date('2026-11-03T11:29:59Z'); // 08:29:59
      const AT_0924 = new Date('2026-11-03T12:24:59Z'); // 09:24:59, um segundo antes de a janela fechar
      const AT_0925 = new Date('2026-11-03T12:25:00Z'); // 09:25:00: o prazo menos a margem de 5 minutos
      const AT_0930 = new Date('2026-11-03T12:30:00Z'); // 09:30:00 em Brasília: o prazo
      const AT_0759 = new Date('2026-11-03T10:59:59Z'); // um segundo antes da hora da decisão

      const decide = async (cycleId: string, competitorId: string) =>
        prisma.decision.create({
          data: {
            id: newId(),
            cycleId,
            competitorId,
            status: 'DECIDED',
            marketView: 'neutro',
            summary: 'decisão gravada',
          },
        });

      it('dentro da janela cria o ciclo e publica uma decide por MODEL, com o mesmo MessageId do agendador', async () => {
        await runningSeason();
        await briefing();
        const t = setup();
        const result = await t.scheduler.rerun('2026-11-03', AT_0829);
        expect(result).toEqual([{ season: 'temporada-teste', result: 'published', published: 3 }]);
        // o agendador das 08:00 cai no mesmo ciclo (é idempotente) e publica as mesmas mensagens
        const scheduled = setup();
        await scheduled.scheduler.cycle(AT_0800);
        expect(await prisma.cycle.count()).toBe(1);
        expect(t.published.map(messageId)).toEqual(scheduled.published.map(messageId));
      });

      it('é idempotente: repetir não cria outro ciclo nem outra decisão, e republica as mesmas mensagens', async () => {
        await runningSeason();
        await briefing();
        const t = setup();
        await t.scheduler.rerun('2026-11-03', AT_0829);
        await t.scheduler.rerun('2026-11-03', AT_0924);
        expect(await prisma.cycle.count()).toBe(1);
        expect(await prisma.decision.count()).toBe(0);
        expect(t.published.slice(0, 3).map(messageId)).toEqual(t.published.slice(3).map(messageId));
      });

      it('publica só para quem ainda não decidiu, e a decisão já gravada não muda', async () => {
        const seasonId = await runningSeason();
        await briefing();
        const t = setup();
        await t.scheduler.cycle(AT_0800);
        const [first, second, third] = await repo.modelCompetitors(seasonId);
        const cycle = await prisma.cycle.findFirstOrThrow();
        await decide(cycle.id, first!.id);
        await decide(cycle.id, second!.id);
        const before = await prisma.decision.findMany({ orderBy: { id: 'asc' } });
        t.published.length = 0;

        const result = await t.scheduler.rerun('2026-11-03', AT_0829);

        expect(result).toEqual([{ season: 'temporada-teste', result: 'published', published: 1 }]);
        expect(t.published).toEqual([
          { type: 'decide', cycleId: cycle.id, competitorId: third!.id },
        ]);
        expect(await prisma.decision.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
      });

      it('com todos já decididos não há o que publicar (e o ciclo não é tocado)', async () => {
        const seasonId = await runningSeason();
        await briefing();
        const t = setup();
        await t.scheduler.cycle(AT_0800);
        const cycle = await prisma.cycle.findFirstOrThrow();
        for (const model of await repo.modelCompetitors(seasonId)) await decide(cycle.id, model.id);
        t.published.length = 0;
        expect(await t.scheduler.rerun('2026-11-03', AT_0829)).toEqual([
          { season: 'temporada-teste', result: 'no_pending' },
        ]);
        expect(t.published).toEqual([]);
        expect(await prisma.cycle.findFirstOrThrow()).toEqual(cycle);
      });

      it('o ciclo fechado fica como está', async () => {
        await runningSeason();
        await briefing();
        const t = setup();
        await t.scheduler.cycle(AT_0800);
        await prisma.cycle.updateMany({
          data: { status: 'CLOSED', closedAt: new Date('2026-11-03T11:10:00Z') },
        });
        t.published.length = 0;
        expect(await t.scheduler.rerun('2026-11-03', AT_0829)).toEqual([
          { season: 'temporada-teste', result: 'already_closed' },
        ]);
        expect(t.published).toEqual([]);
      });

      it('a janela fecha 5 minutos antes do prazo: às 09:24:59 ainda publica, às 09:25:00 não, e nada é criado', async () => {
        expect(RERUN_MARGIN_MS).toBe(5 * 60_000);
        await runningSeason();
        await briefing();
        // da margem até depois do prazo (09:25:00, 09:29:59, 09:30:00): nenhuma mensagem, nem o ciclo, nem a versão do prompt
        for (const at of [AT_0925, new Date('2026-11-03T12:29:59Z'), AT_0930]) {
          const late = setup();
          expect(await late.scheduler.rerun('2026-11-03', at), at.toISOString()).toEqual([
            { season: 'temporada-teste', result: 'past_deadline' },
          ]);
          expect(late.published).toEqual([]);
        }
        expect(await prisma.cycle.count()).toBe(0);
        expect(await prisma.decision.count()).toBe(0);
        expect(await prisma.promptVersion.count()).toBe(0);

        const justInTime = setup();
        expect(await justInTime.scheduler.rerun('2026-11-03', AT_0924)).toEqual([
          { season: 'temporada-teste', result: 'published', published: 3 },
        ]);
      });

      it('a margem vale com o prazo de cada temporada: um prazo às 09:00 fecha a janela às 08:55', async () => {
        const early = seasonFile();
        await runningSeason({ params: { ...early.params, deadlineTimeBrt: '09:00' } });
        await briefing();
        const t = setup();
        expect(await t.scheduler.rerun('2026-11-03', new Date('2026-11-03T11:55:00Z'))).toEqual([
          { season: 'temporada-teste', result: 'past_deadline' },
        ]);
        expect(await t.scheduler.rerun('2026-11-03', new Date('2026-11-03T11:54:59Z'))).toEqual([
          { season: 'temporada-teste', result: 'published', published: 3 },
        ]);
      });

      it('depois do prazo (e dentro da margem) não toca num ciclo aberto, não publica e não grava decisão (HOLD "prazo" inclusive)', async () => {
        await runningSeason();
        await briefing();
        const t = setup();
        await t.scheduler.cycle(AT_0800);
        const cycle = await prisma.cycle.findFirstOrThrow();
        t.published.length = 0;
        for (const now of [
          AT_0925,
          AT_0930,
          new Date('2026-11-03T20:00:00Z'),
          new Date('2026-11-04T11:00:00Z'),
        ]) {
          expect(await t.scheduler.rerun('2026-11-03', now)).toEqual([
            { season: 'temporada-teste', result: 'past_deadline' },
          ]);
        }
        expect(t.published).toEqual([]);
        expect(await prisma.decision.count()).toBe(0);
        expect(await prisma.cycle.findFirstOrThrow()).toEqual(cycle);
      });

      it('um pregão antigo é sempre depois do prazo: o ciclo de ontem não é reaberto nem varrido', async () => {
        await runningSeason({}, '2026-10-30');
        await briefing('2026-10-30');
        const t = setup();
        await t.scheduler.cycle(new Date('2026-10-30T11:00:05Z'));
        const cycle = await prisma.cycle.findFirstOrThrow();
        t.published.length = 0;
        t.closer.closeOverdue.mockClear(); // a chamada do agendador acima não conta
        expect(await t.scheduler.rerun('2026-10-30', AT_0829)).toEqual([
          { season: 'temporada-teste', result: 'past_deadline' },
        ]);
        expect(t.closer.closeOverdue).not.toHaveBeenCalled();
        expect(t.published).toEqual([]);
        expect(await prisma.cycle.findFirstOrThrow()).toEqual(cycle);
      });

      it('antes da hora da decisão (08:00) não abre o ciclo', async () => {
        await runningSeason();
        await briefing();
        const t = setup();
        expect(await t.scheduler.rerun('2026-11-03', AT_0759)).toEqual([
          { season: 'temporada-teste', result: 'not_open_yet' },
        ]);
        expect(t.published).toEqual([]);
        expect(await prisma.cycle.count()).toBe(0);
      });

      it('o ciclo pulado por falta de briefing reabre se o briefing chegou (o freeze reenviado), dentro da janela', async () => {
        await runningSeason();
        const t = setup();
        await t.scheduler.cycle(AT_0800);
        expect((await prisma.cycle.findFirstOrThrow()).status).toBe('SKIPPED');
        await briefing();
        expect(await t.scheduler.rerun('2026-11-03', AT_0829)).toEqual([
          { season: 'temporada-teste', result: 'published', published: 3 },
        ]);
        expect(await prisma.cycle.count()).toBe(1);
        expect((await prisma.cycle.findFirstOrThrow()).status).toBe('OPEN');
      });

      it('o ciclo aberto continua com o briefing e a versão do prompt que fixou, mesmo que o ambiente tenha outra versão', async () => {
        await runningSeason();
        await briefing();
        const t = setup();
        await t.scheduler.cycle(AT_0800);
        const before = await prisma.cycle.findFirstOrThrow({ include: { promptVersion: true } });
        const other = setup({ PROMPT_ARENA_VERSION: 'f'.repeat(32) });
        await other.scheduler.rerun('2026-11-03', AT_0829);
        const after = await prisma.cycle.findFirstOrThrow({ include: { promptVersion: true } });
        expect(after.promptVersionId).toBe(before.promptVersionId);
        expect(after.briefingId).toBe(before.briefingId);
        expect(after.promptVersion!.version).toBe(PROMPT_VERSION);
      });

      it('o teto de custo vale também no reprocesso (pula o ciclo, sem chamar modelo)', async () => {
        const seasonId = await runningSeason(paidSeason());
        await briefing();
        await spend(10_000_000n, seasonId);
        const t = setup({ PROMPT_ARENA_VERSION: PROMPT_VERSION, ARENA_MONTHLY_COST_CAP_USD: '10' });
        expect(await t.scheduler.rerun('2026-11-03', AT_0829)).toEqual([
          { season: 'temporada-teste', result: 'skipped', reason: 'orcamento' },
        ]);
        expect(t.published).toEqual([]);
      });

      it('não varre os ciclos vencidos (isso é do agendador e da liquidação, não de um pedido do admin)', async () => {
        await runningSeason();
        await briefing();
        const t = setup();
        await t.scheduler.rerun('2026-11-03', AT_0829);
        expect(t.closer.closeOverdue).not.toHaveBeenCalled();
      });

      it('dia que não é pregão: nada', async () => {
        await runningSeason();
        const t = setup();
        expect(await t.scheduler.rerun('2026-11-02', AT_0829)).toEqual([]);
        expect(t.published).toEqual([]);
      });

      it('sem temporada em andamento: nada', async () => {
        await repo.createSeason(seasonFileSchema.parse(seasonFile()));
        const t = setup();
        expect(await t.scheduler.rerun('2026-11-03', AT_0829)).toEqual([]);
      });

      it('sem PROMPT_ARENA_VERSION falha dizendo a variável, sem publicar', async () => {
        await runningSeason();
        await briefing();
        const t = setup({});
        await expect(t.scheduler.rerun('2026-11-03', AT_0829)).rejects.toThrow(
          /PROMPT_ARENA_VERSION/,
        );
        expect(t.published).toEqual([]);
      });
    });
  },
);
