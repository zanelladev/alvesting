import { seasonFileSchema, type SeasonFile } from '@alvesting/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { seasonFile } from '../testing/arena.fixture.js';
import { ArenaRepository } from './arena.repository.js';

// As operações de temporada que as rotas /admin usam (etapa 10, parte 2): a trilha de auditoria NA MESMA transação da mudança, a edição
// do rascunho e a leitura da temporada no formato do arquivo do season:create. Banco de verdade (Postgres).
describe.skipIf(!testDatabaseUrl)(integrationTitle('ArenaRepository: temporadas do admin'), () => {
  let prisma: PrismaService;
  let repo: ArenaRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    repo = new ArenaRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.competitor.deleteMany();
    await prisma.season.deleteMany();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.onModuleDestroy();
  });

  const audit = { actor: 'admin:01JABCDEFGHJKMNPQRSTVWXYZ0', action: 'admin.season.create' };

  describe('auditoria na mesma transação', () => {
    it('createSeason grava a linha de auditoria junto, com o id da temporada como alvo', async () => {
      const id = await repo.createSeason(seasonFile(), {
        ...audit,
        detail: { slug: 'temporada-teste' },
      });
      expect(await prisma.auditLog.findFirstOrThrow()).toMatchObject({
        actor: audit.actor,
        action: 'admin.season.create',
        target: id,
        detail: { slug: 'temporada-teste' },
      });
    });

    it('se a auditoria falha, a temporada e o elenco não ficam (uma transação só)', async () => {
      // o NUL o Postgres recusa em texto: a gravação da auditoria falha DEPOIS de a temporada e o elenco irem ao banco
      await expect(
        repo.createSeason(seasonFile(), { actor: 'admin:\u0000', action: 'admin.season.create' }),
      ).rejects.toThrow();
      expect(await prisma.season.count()).toBe(0);
      expect(await prisma.competitor.count()).toBe(0);
    });

    it('sem auditoria (o comando season:create, o ensaio) nada é gravado em audit_log', async () => {
      await repo.createSeason(seasonFile());
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('startSeason grava a auditoria só se a temporada começou', async () => {
      const id = await repo.createSeason(seasonFile());
      const now = new Date('2026-11-02T20:00:00Z');
      expect(
        await repo.startSeason(id, '2026-11-03', now, { ...audit, action: 'admin.season.start' }),
      ).toBe('started');
      expect(await prisma.auditLog.findFirstOrThrow()).toMatchObject({
        action: 'admin.season.start',
        target: id,
      });
      // de novo: já não é rascunho, e a repetição não deixa outra linha
      expect(
        await repo.startSeason(id, '2026-11-04', now, { ...audit, action: 'admin.season.start' }),
      ).toBe('not_draft');
      expect(await repo.startSeason('01JZZZZZZZZZZZZZZZZZZZZZZZ', '2026-11-04', now, audit)).toBe(
        'not_found',
      );
      expect(await prisma.auditLog.count()).toBe(1);
      expect((await repo.seasonById(id))!.startDate).toBe('2026-11-03');
    });

    it('startSeason: se a auditoria falha, a temporada continua rascunho', async () => {
      const id = await repo.createSeason(seasonFile());
      await expect(
        repo.startSeason(id, '2026-11-03', new Date(), {
          actor: 'x\u0000',
          action: 'admin.season.start',
        }),
      ).rejects.toThrow();
      expect((await repo.seasonById(id))!.status).toBe('DRAFT');
    });
  });

  // A regra "uma temporada em andamento por vez" das rotas /admin (409 SEASON_RUNNING_EXISTS): conferida DENTRO da transação do start,
  // sob uma trava consultiva, porque ler as temporadas em andamento antes e iniciar depois deixava dois starts simultâneos passarem
  // juntos (a barreira do UPDATE condicional vale por linha, e os dois rascunhos são linhas diferentes).
  describe('startSeason exclusivo: uma temporada em andamento por vez', () => {
    const NOW = new Date('2026-11-02T20:00:00Z');
    const exclusive = { exclusive: true };
    const draft = (slug: string) => repo.createSeason(seasonFile({ slug }));
    const statuses = async () =>
      (await prisma.season.findMany({ orderBy: { slug: 'asc' } })).map((s) => s.status);

    it('recusa quando outra já está em andamento, e o rascunho continua rascunho (nem a auditoria fica)', async () => {
      const first = await draft('primeira');
      const second = await draft('segunda');
      expect(await repo.startSeason(first, '2026-11-03', NOW, undefined, exclusive)).toBe(
        'started',
      );
      expect(
        await repo.startSeason(
          second,
          '2026-11-03',
          NOW,
          { ...audit, action: 'admin.season.start' },
          exclusive,
        ),
      ).toBe('running_exists');
      expect(await statuses()).toEqual(['RUNNING', 'DRAFT']);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('a encerrada não conta como "em andamento"', async () => {
      const old = await draft('antiga');
      await repo.startSeason(old, '2026-10-01', NOW);
      await prisma.season.update({
        where: { id: old },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
      const next = await draft('nova');
      expect(await repo.startSeason(next, '2026-11-03', NOW, undefined, exclusive)).toBe('started');
    });

    it('sem a opção (o comando season:start) não confere, como sempre foi', async () => {
      const first = await draft('primeira');
      const second = await draft('segunda');
      expect(await repo.startSeason(first, '2026-11-03', NOW)).toBe('started');
      expect(await repo.startSeason(second, '2026-11-03', NOW)).toBe('started');
    });

    it('toma a trava consultiva season:start: enquanto outra transação a segura, o start espera (a conferência e o UPDATE são um passo só)', async () => {
      const id = await draft('espera');
      let release!: () => void;
      let holding!: () => void;
      const holdingLock = new Promise<void>((resolve) => (holding = resolve));
      const held = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('season:start', 0))`;
        holding();
        await new Promise<void>((resolve) => (release = resolve));
      });
      await holdingLock;
      let finished = false;
      const start = repo.startSeason(id, '2026-11-03', NOW, undefined, exclusive).then((result) => {
        finished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(finished).toBe(false);
      expect(await statuses()).toEqual(['DRAFT']);
      release();
      await held;
      expect(await start).toBe('started');
    });

    it('dois starts ao mesmo tempo de rascunhos diferentes: um vence e o outro recebe running_exists, sempre', async () => {
      for (let round = 0; round < 6; round++) {
        await prisma.competitor.deleteMany();
        await prisma.season.deleteMany();
        const [a, b] = [await draft('a'), await draft('b')];
        const results = await Promise.all([
          repo.startSeason(a, '2026-11-03', NOW, undefined, exclusive),
          repo.startSeason(b, '2026-11-03', NOW, undefined, exclusive),
        ]);
        expect([...results].sort(), `rodada ${round}`).toEqual(['running_exists', 'started']);
        expect((await statuses()).filter((s) => s === 'RUNNING')).toHaveLength(1);
      }
    });

    it('o mesmo rascunho iniciado duas vezes ao mesmo tempo: um started e o outro not_draft (ele mesmo não é "outra")', async () => {
      const id = await draft('unica');
      const results = await Promise.all([
        repo.startSeason(id, '2026-11-03', NOW, undefined, exclusive),
        repo.startSeason(id, '2026-11-03', NOW, undefined, exclusive),
      ]);
      expect([...results].sort()).toEqual(['not_draft', 'started']);
    });
  });

  describe('a temporada no formato do arquivo (listSeasons, seasonDetail)', () => {
    it('devolve o que foi criado, na ordem do elenco, e o arquivo volta a passar pelo schema do season:create', async () => {
      const file = seasonFileSchema.parse({
        ...seasonFile(),
        competitors: [
          {
            kind: 'MODEL',
            slug: 'pago',
            name: 'Modelo pago',
            provider: 'openrouter',
            modelId: 'anthropic/claude-opus-5.5',
            capabilities: { jsonSchema: true, reasoningEffort: true },
            pricingUsdPerMTok: { input: '4', output: '20' },
          },
          ...seasonFile().competitors.slice(1),
        ],
      });
      const id = await repo.createSeason(file);
      const detail = (await repo.seasonDetail(id))!;
      expect(detail).toMatchObject({ id, slug: file.slug, name: file.name, status: 'DRAFT' });
      expect(detail.startDate).toBeNull();
      expect(detail.competitors).toEqual(file.competitors);
      // ida e volta: o que sai pode entrar de novo no season:create
      expect(
        seasonFileSchema.parse({
          slug: detail.slug,
          name: detail.name,
          params: detail.params,
          competitors: detail.competitors,
        }),
      ).toEqual(file);
    });

    it('lista as mais novas primeiro, o rascunho também, e seasonDetail de uma que não existe é nulo', async () => {
      const first = await repo.createSeason(seasonFile({ slug: 'primeira' }));
      const second = await repo.createSeason(seasonFile({ slug: 'segunda' }));
      expect((await repo.listSeasons()).map((s) => s.id)).toEqual([second, first]);
      expect(await repo.seasonDetail('01JZZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull();
    });
  });

  describe('replaceDraft: edita o rascunho e só o rascunho', () => {
    const newFile = (): SeasonFile =>
      seasonFile({
        name: 'Nome novo',
        params: { ...seasonFile().params, sessions: 7 },
        competitors: [
          {
            kind: 'MODEL',
            slug: 'so-um',
            name: 'Só um',
            provider: 'fake',
            modelId: 'fake/so-um',
            capabilities: { jsonSchema: false, reasoningEffort: false },
          },
          ...seasonFile().competitors.slice(3),
        ],
      });

    it('troca nome, parâmetros e elenco (posições de novo de 0 a N-1) e grava a auditoria junto', async () => {
      const id = await repo.createSeason(seasonFile());
      expect(
        await repo.replaceDraft(id, newFile(), { ...audit, action: 'admin.season.update' }),
      ).toBe('updated');
      const detail = (await repo.seasonDetail(id))!;
      expect(detail).toMatchObject({ name: 'Nome novo', slug: 'temporada-teste', status: 'DRAFT' });
      expect(detail.params.sessions).toBe(7);
      expect(detail.competitors.map((c) => c.slug)).toEqual([
        'so-um',
        'sorteio',
        'igual-peso',
        'cdi',
        'bova11',
      ]);
      const rows = await prisma.competitor.findMany({
        where: { seasonId: id },
        orderBy: { position: 'asc' },
      });
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4]);
      expect(await prisma.auditLog.findFirstOrThrow()).toMatchObject({
        action: 'admin.season.update',
        target: id,
      });
    });

    it('temporada em andamento ou encerrada não muda nada: regras, elenco e prompt ficam fixos', async () => {
      for (const status of ['RUNNING', 'FINISHED'] as const) {
        const id = await repo.createSeason(seasonFile({ slug: status.toLowerCase() }));
        await repo.startSeason(id, '2026-11-03', new Date());
        if (status === 'FINISHED') {
          await prisma.season.update({
            where: { id },
            data: { status: 'FINISHED', finishedAt: new Date() },
          });
        }
        const before = await repo.seasonDetail(id);
        expect(
          await repo.replaceDraft(id, { ...newFile(), slug: status.toLowerCase() }, audit),
        ).toBe('not_draft');
        expect(await repo.seasonDetail(id)).toEqual(before);
      }
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('temporada que não existe: not_found', async () => {
      expect(await repo.replaceDraft('01JZZZZZZZZZZZZZZZZZZZZZZZ', newFile(), audit)).toBe(
        'not_found',
      );
    });

    it('se a auditoria falha, o rascunho fica como estava (inclusive o elenco)', async () => {
      const id = await repo.createSeason(seasonFile());
      const before = await repo.seasonDetail(id);
      await expect(
        repo.replaceDraft(id, newFile(), { actor: 'x\u0000', action: 'admin.season.update' }),
      ).rejects.toThrow();
      expect(await repo.seasonDetail(id)).toEqual(before);
    });

    it('o slug do arquivo novo tem de ser o da temporada (o slug não muda)', async () => {
      const id = await repo.createSeason(seasonFile());
      await expect(repo.replaceDraft(id, { ...newFile(), slug: 'outro' }, audit)).rejects.toThrow(
        /slug/,
      );
    });
  });
});
