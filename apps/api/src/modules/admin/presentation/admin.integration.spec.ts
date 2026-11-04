import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ADMIN_DLQ_LISTED,
  adminCostsSchema,
  adminJobsSchema,
  adminSeasonSchema,
  adminSeasonsSchema,
  corporateEventResultSchema,
  cycleRerunSchema,
  dlqResubmitSchema,
  envelopeSchema,
  messageId,
  seasonFileSchema,
  type QueueMessage,
} from '@alvesting/contracts';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Test } from 'supertest';
import { z } from 'zod';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { demoteFromAdmin } from '../../account/application/demote.js';
import { promoteToAdmin } from '../../account/application/promote.js';
import { ConsentGuard } from '../../account/presentation/consent.guard.js';
import { ROLES_KEY, RolesGuard } from '../../account/presentation/roles.guard.js';
import { SessionGuard } from '../../account/presentation/session.guard.js';
import {
  ORIGIN,
  asSite,
  createLoggedInUser,
  startAccountApp,
  type AccountApp,
} from '../../account/testing/account-app.fixture.js';
import { CycleCloser } from '../../arena/application/cycle-closer.js';
import { ArenaRepository } from '../../arena/infrastructure/arena.repository.js';
import { PROMPT_VERSION, seasonFile } from '../../arena/testing/arena.fixture.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { SERVICE_BUS_CLIENT } from '../../messaging/infrastructure/messaging.service.js';
import { JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { SettleHandler } from '../../settlement/application/settle.handler.js';
import { SettlementRepository } from '../../settlement/infrastructure/settlement.repository.js';
import {
  HAND_CHECKED_LAST,
  HAND_CHECKED_MARKET,
  cleanSettlementTables,
  seedMarket,
  seedSeason,
} from '../../settlement/testing/settlement.fixture.js';
import { AdminModule } from '../admin.module.js';
import { ADMIN_CLOCK } from '../admin.tokens.js';
import { AdminAudit } from '../application/admin-audit.js';
import { AdminController } from './admin.controller.js';

// As rotas /api/v1/admin (etapa 10, parte 2; docs/API.md, seção 8), de ponta a ponta: a api de verdade (Better Auth, guards, o módulo
// de admin), o Postgres de verdade e um Service Bus FALSO que é uma pasta (modules/messaging/infrastructure/fake-service-bus.ts), com o
// MessagingService de verdade por cima. Relógio injetado. Nenhum dado pessoal real: e-mails @example.test.
beforeAll(() => {
  Logger.overrideLogger(false);
});

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const AT_0830 = new Date('2026-11-03T11:30:00Z'); // terça 03/11/2026, 08:30 em Brasília: dentro da janela do ciclo
const AT_0925 = new Date('2026-11-03T12:25:00Z'); // 09:25:00: o prazo menos a margem do reprocesso (5 minutos)
const AT_0930 = new Date('2026-11-03T12:30:00Z'); // 09:30:00: o prazo
const SOME_ULID = '01JZZZZZZZZZZZZZZZZZZZZZZZ';

// A resposta no envelope, validada pelo schema do contrato (o mesmo que o site usa): lança se for erro ou se sair do formato.
const envelope = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => {
  const parsed = envelopeSchema(schema).parse(body) as {
    success: boolean;
    data: z.output<S>;
    error: unknown;
  };
  if (!parsed.success) throw new Error(`a resposta é um erro: ${JSON.stringify(parsed.error)}`);
  return parsed.data;
};

describe.skipIf(!testDatabaseUrl)(integrationTitle('As rotas /admin'), () => {
  // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api (ADR 0028), com o qual a api sob teste
  // atende as rotas: o banco recusa o que ela não pode, então um 500 por "permission denied" aparece aqui, e não só na Azure
  let prisma: PrismaService;
  let apiPrisma: PrismaService;
  let account: AccountApp;
  let busDir: string;
  let now: Date;
  let arena: ArenaRepository;
  let admin: Awaited<ReturnType<typeof createLoggedInUser>>;
  let common: Awaited<ReturnType<typeof createLoggedInUser>>;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
    arena = new ArenaRepository(prisma);
    busDir = await mkdtemp(path.join(tmpdir(), 'alvesting-admin-bus-'));
    account = await startAccountApp(apiPrisma, {
      extraImports: [AdminModule],
      env: {
        PROMPT_ARENA_VERSION: PROMPT_VERSION,
        ARENA_MONTHLY_COST_CAP_USD: '40',
        SERVICEBUS_FAKE_DIR: busDir,
      },
      overrides: [{ provide: ADMIN_CLOCK, useValue: () => now }],
    });
    admin = await createLoggedInUser(account, prisma);
    await promoteToAdmin(prisma, admin.email);
    common = await createLoggedInUser(account, prisma);
  }, 120_000);

  beforeEach(async () => {
    now = AT_0830;
    await cleanSettlementTables(prisma);
    await prisma.fetchState.deleteMany();
    await rm(busDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await cleanSettlementTables(prisma);
    await prisma.fetchState.deleteMany();
    await account.stop();
    await rm(busDir, { recursive: true, force: true });
    await apiPrisma.onModuleDestroy();
    await prisma.onModuleDestroy();
  });

  // --- ajudantes ---------------------------------------------------------------------------------------------------------
  const api = (path: string) => `/api/v1/admin${path}`;
  const get = (who: { agent: ReturnType<AccountApp['agent']> }, path: string) =>
    who.agent.get(api(path));
  const post = (who: { agent: ReturnType<AccountApp['agent']> }, path: string, body?: unknown) =>
    asSite(who.agent.post(api(path))).send(body as object);
  const patch = (who: { agent: ReturnType<AccountApp['agent']> }, path: string, body: unknown) =>
    asSite(who.agent.patch(api(path))).send(body as object);
  const actor = () => `admin:${admin.userId}`;

  const auditRows = (action?: string) =>
    prisma.auditLog.findMany({
      where: { ...(action ? { action } : {}), actor: actor() },
      orderBy: { id: 'asc' },
    });

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
  async function runningSeason(slug = 'temporada-teste', startDate = '2026-11-03') {
    const id = await arena.createSeason(seasonFileSchema.parse({ ...seasonFile(), slug }));
    await arena.startSeason(id, startDate, new Date('2026-11-01T18:00:00Z'));
    return id;
  }

  // a pasta do Service Bus falso: a DLQ semeada pelo teste e o que a api publicou
  const seedDead = async (queue: string, record: Record<string, unknown>) => {
    await mkdir(path.join(busDir, queue, 'dead'), { recursive: true });
    await writeFile(
      path.join(busDir, queue, 'dead', `${Date.now()}-${newId()}.json`),
      JSON.stringify(record),
    );
  };
  const names = (queue: string, box: 'dead' | 'active') =>
    readdir(path.join(busDir, queue, box)).catch(() => [] as string[]);
  const published = async (queue: string) => {
    const out: Array<{ messageId: string; body: QueueMessage }> = [];
    for (const name of (await names(queue, 'active')).sort()) {
      out.push(
        JSON.parse(await readFile(path.join(busDir, queue, 'active', name), 'utf8')) as {
          messageId: string;
          body: QueueMessage;
        },
      );
    }
    return out;
  };

  // --- guards ------------------------------------------------------------------------------------------------------------
  describe('guards: sessão, papel, aceite e origem em toda rota', () => {
    const ROUTES: Array<[string, string, string, unknown]> = [
      ['GET', 'listar as temporadas', '/seasons', undefined],
      ['POST', 'criar a temporada', '/seasons', seasonFile()],
      ['PATCH', 'editar a temporada', `/seasons/${SOME_ULID}`, { name: 'Outro nome' }],
      ['POST', 'reprocessar o ciclo', '/cycles/2026-11-03/rerun', undefined],
      ['POST', 'reenviar a DLQ', '/dlq/news/resubmit', { messageIds: ['eod:2026-11-03'] }],
      [
        'POST',
        'registrar o evento',
        '/corporate-events',
        { ticker: 'BBB4', exDate: '2026-11-05', kind: 'split', factor: '1:2' },
      ],
      ['GET', 'custos', '/costs', undefined],
      ['GET', 'jobs', '/jobs', undefined],
    ];
    const MUTATIONS = ROUTES.filter(([method]) => method !== 'GET');

    // O Origin certo vai junto: sem ele a recusa é a da origem (403), e o que se prova aqui é a falta da sessão (401).
    type Caller = { get(url: string): Test; post(url: string): Test; patch(url: string): Test };
    const call = (
      method: string,
      path: string,
      body: unknown,
      agent: Caller,
      origin: string | null = ORIGIN,
    ): Test => {
      const req = agent[method.toLowerCase() as 'get' | 'post' | 'patch'](api(path));
      if (origin !== null) req.set('Origin', origin);
      return body === undefined ? req : req.send(body as object);
    };

    it.each(ROUTES)('%s %s: sem sessão é 401', async (method, _title, p, body) => {
      const res = await call(method, p, body, account.http());
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    });

    it.each(ROUTES)(
      '%s %s: usuário comum é 403, e nada é gravado',
      async (method, _title, p, body) => {
        const res = await call(method, p, body, common.agent);
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
        expect(await prisma.season.count()).toBe(0);
        expect(await prisma.auditLog.count()).toBe(0);
      },
    );

    it.each(MUTATIONS)(
      '%s %s: sem o Origin do site, ou com outro, é 403 até para o admin',
      async (method, _title, p, body) => {
        for (const origin of [null, 'https://golpe.example.test', `${ORIGIN}.golpe.example.test`]) {
          const res = await call(method, p, body, admin.agent, origin);
          expect(res.status, String(origin)).toBe(403);
          expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
        }
        expect(await prisma.season.count()).toBe(0);
        expect(await prisma.auditLog.count()).toBe(0);
        expect(await names('news', 'active')).toEqual([]);
      },
    );

    it.each(ROUTES)(
      '%s %s: com o aceite vencido é 403 CONSENT_REQUIRED',
      async (method, _title, p, body) => {
        const index = account.docs.findIndex((d) => d.document === 'TERMS');
        const original = account.docs[index]!;
        account.docs[index] = { ...original, version: '9.9', sha256: 'f'.repeat(64) };
        try {
          const res = await call(method, p, body, admin.agent);
          expect(res.status).toBe(403);
          expect(res.body).toMatchObject({ success: false, error: { code: 'CONSENT_REQUIRED' } });
        } finally {
          account.docs[index] = original;
        }
      },
    );

    it('o admin passa: toda rota responde (a resposta é a de cada rota), com no-store até no erro', async () => {
      for (const [method, , p, body] of ROUTES) {
        const res = await call(method, p, body, admin.agent);
        expect(res.status, `${method} ${p}`).toBeLessThan(500);
        expect(res.headers['cache-control'], `${method} ${p}`).toBe('no-store');
        expect(res.status, `${method} ${p}`).not.toBe(401);
        expect(res.status, `${method} ${p}`).not.toBe(403);
      }
    });

    it('o controlador nega por padrão: os três guards na ordem e @Roles("ADMIN") em CADA rota, nunca só na classe', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([
        SessionGuard,
        RolesGuard,
        ConsentGuard,
      ]);
      // @Roles na classe valeria para a rota que alguém acrescentar e esquecer: aí a rota nasceria aberta ao admin sem decisão
      expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toBeUndefined();
      const handlers = Object.getOwnPropertyNames(AdminController.prototype).filter(
        (name) => name !== 'constructor',
      );
      expect(handlers.length).toBe(ROUTES.length);
      for (const name of handlers) {
        const handler = (AdminController.prototype as unknown as Record<string, object>)[name]!;
        expect(Reflect.getMetadata(PATH_METADATA, handler), `${name} é uma rota`).toBeDefined();
        expect(Reflect.getMetadata(ROLES_KEY, handler), `${name} tem @Roles`).toEqual(['ADMIN']);
      }
    });

    it('parâmetro de query desconhecido é 400, como nas rotas públicas', async () => {
      expect((await get(admin, '/costs?x=1')).status).toBe(400);
      expect((await get(admin, '/jobs?limit=5')).status).toBe(400);
      expect((await get(admin, '/seasons?x=1')).status).toBe(400);
    });

    it('rebaixado por account:demote, o admin perde a rota na hora e a sessão acaba', async () => {
      const other = await createLoggedInUser(account, prisma);
      await promoteToAdmin(prisma, other.email);
      expect((await get(other, '/costs')).status).toBe(200);
      const demoted = await demoteFromAdmin(prisma, other.email);
      expect(demoted.changed).toBe(true);
      // as sessões foram apagadas: a rota não responde mais 403, responde 401
      expect((await get(other, '/costs')).status).toBe(401);
    });
  });

  // --- temporadas --------------------------------------------------------------------------------------------------------
  describe('temporadas: POST e PATCH /admin/seasons, GET /admin/seasons', () => {
    it('cria o rascunho com o elenco do arquivo, no formato que a listagem devolve, e audita com o ator admin:<ULID>', async () => {
      const res = await post(admin, '/seasons', seasonFile());
      expect(res.status).toBe(201);
      const season = envelope(adminSeasonSchema, res.body);
      expect(season).toMatchObject({
        slug: 'temporada-teste',
        name: 'Temporada de teste',
        status: 'DRAFT',
        startDate: null,
        startedAt: null,
      });
      expect(season.competitors).toEqual(seasonFileSchema.parse(seasonFile()).competitors);

      const [row] = await auditRows('admin.season.create');
      expect(row).toMatchObject({
        actor: `admin:${admin.userId}`,
        target: season.id,
        detail: { slug: 'temporada-teste', models: 3 },
      });
    });

    it('o mesmo slug duas vezes: 409 e a segunda não deixa nada (nem auditoria)', async () => {
      await post(admin, '/seasons', seasonFile());
      const again = await post(admin, '/seasons', seasonFile());
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ error: { code: 'SEASON_SLUG_TAKEN' } });
      expect(await prisma.season.count()).toBe(1);
      expect(await auditRows('admin.season.create')).toHaveLength(1);
    });

    it('arquivo inválido: 400 com os campos errados, sem repetir valor nenhum (um segredo posto por engano), e nada é gravado', async () => {
      const res = await post(admin, '/seasons', {
        ...seasonFile(),
        openrouterApiKey: 'sk-or-chave-secreta-123',
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(JSON.stringify(res.body)).not.toContain('sk-or-chave-secreta-123');
      const noRandom = await post(admin, '/seasons', {
        ...seasonFile(),
        competitors: seasonFile().competitors.filter((c) => c.kind !== 'RANDOM'),
      });
      expect(noRandom.status).toBe(400);
      expect(JSON.stringify(noRandom.body)).toContain('Sorteio');
      expect(await prisma.season.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('lista todas, o rascunho inclusive, da mais nova à mais antiga, no formato do arquivo', async () => {
      await post(admin, '/seasons', seasonFile({ slug: 'primeira' }));
      await post(admin, '/seasons', seasonFile({ slug: 'segunda' }));
      const res = await get(admin, '/seasons');
      expect(res.status).toBe(200);
      const { seasons } = envelope(adminSeasonsSchema, res.body);
      expect(seasons.map((s) => s.slug)).toEqual(['segunda', 'primeira']);
    });

    it('edita o rascunho: o que for enviado substitui o campo, o slug não muda, e a auditoria diz quais campos', async () => {
      const created = envelope(
        adminSeasonSchema,
        (await post(admin, '/seasons', seasonFile())).body,
      );
      const res = await patch(admin, `/seasons/${created.id}`, {
        name: 'Nome novo',
        params: { ...seasonFile().params, sessions: 7 },
      });
      expect(res.status).toBe(200);
      const edited = envelope(adminSeasonSchema, res.body);
      expect(edited).toMatchObject({ id: created.id, slug: 'temporada-teste', name: 'Nome novo' });
      expect(edited.params.sessions).toBe(7);
      expect(edited.competitors).toEqual(created.competitors);
      const [row] = await auditRows('admin.season.update');
      expect(row).toMatchObject({
        actor: actor(),
        target: created.id,
        detail: { fields: ['name', 'params'] },
      });
    });

    it('edição que deixaria o elenco inválido (sem o Sorteio) é 400 e o rascunho fica como estava', async () => {
      const created = envelope(
        adminSeasonSchema,
        (await post(admin, '/seasons', seasonFile())).body,
      );
      const res = await patch(admin, `/seasons/${created.id}`, {
        competitors: created.competitors.filter((c) => c.kind !== 'RANDOM'),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('Sorteio');
      const listed = envelope(adminSeasonsSchema, (await get(admin, '/seasons')).body);
      expect(listed.seasons).toEqual([created]);
      expect(await auditRows('admin.season.update')).toEqual([]);
    });

    it('inicia o rascunho (o season:start): a data de início é o próximo pregão depois de hoje, e audita', async () => {
      const created = envelope(
        adminSeasonSchema,
        (await post(admin, '/seasons', seasonFile())).body,
      );
      // segunda 02/11/2026 é Finados: hoje não é pregão, e o próximo é a terça 03/11
      now = new Date('2026-11-02T15:00:00Z');
      const res = await patch(admin, `/seasons/${created.id}`, { status: 'RUNNING' });
      expect(res.status).toBe(200);
      expect(envelope(adminSeasonSchema, res.body)).toMatchObject({
        id: created.id,
        status: 'RUNNING',
        startDate: '2026-11-03',
      });
      expect((await auditRows('admin.season.start'))[0]).toMatchObject({
        actor: actor(),
        target: created.id,
      });
    });

    it('temporada em andamento (ou encerrada) não muda: regras, elenco e prompt ficam fixos, e iniciar de novo é recusado', async () => {
      const id = await runningSeason();
      const before = await arena.seasonDetail(id);
      for (const body of [
        { name: 'Outro nome' },
        { params: { ...seasonFile().params, sessions: 3 } },
        { competitors: seasonFile().competitors.slice(1) },
        { status: 'RUNNING' },
      ]) {
        const res = await patch(admin, `/seasons/${id}`, body);
        expect(res.status, JSON.stringify(body)).toBe(409);
        expect(res.body).toMatchObject({ error: { code: 'SEASON_LOCKED' } });
      }
      expect(await arena.seasonDetail(id)).toEqual(before);

      await prisma.season.update({
        where: { id },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
      const finished = await patch(admin, `/seasons/${id}`, { name: 'Depois de encerrada' });
      expect(finished.status).toBe(409);
      expect((await arena.seasonDetail(id))!.name).toBe(before!.name);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('com outra temporada em andamento não inicia esta: duas com regras diferentes derrubariam o briefing', async () => {
      await runningSeason('em-andamento');
      const created = envelope(
        adminSeasonSchema,
        (await post(admin, '/seasons', seasonFile({ slug: 'segunda' }))).body,
      );
      const res = await patch(admin, `/seasons/${created.id}`, { status: 'RUNNING' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'SEASON_RUNNING_EXISTS' } });
      expect((await arena.seasonById(created.id))!.status).toBe('DRAFT');
      expect(await auditRows('admin.season.start')).toEqual([]);
    });

    // A regra é conferida dentro da transação do start, sob trava: dois PATCH juntos, de rascunhos diferentes, não passam os dois (antes,
    // a conferência era uma leitura e o UPDATE vinha depois, e em 5 de 6 tentativas as duas voltavam 200 e a arena parava no `freeze`).
    it('dois inícios ao mesmo tempo, de rascunhos diferentes: um 200 e um 409, e uma só temporada em andamento', async () => {
      for (let round = 0; round < 4; round++) {
        await cleanSettlementTables(prisma);
        const [a, b] = await Promise.all(
          ['rodada-a', 'rodada-b'].map(async (slug) =>
            envelope(adminSeasonSchema, (await post(admin, '/seasons', seasonFile({ slug }))).body),
          ),
        );
        const responses = await Promise.all([
          patch(admin, `/seasons/${a!.id}`, { status: 'RUNNING' }),
          patch(admin, `/seasons/${b!.id}`, { status: 'RUNNING' }),
        ]);
        expect(responses.map((r) => r.status).sort(), `rodada ${round}`).toEqual([200, 409]);
        const refused = responses.find((r) => r.status === 409)!;
        expect(refused.body).toMatchObject({ error: { code: 'SEASON_RUNNING_EXISTS' } });
        // a mensagem diz qual está em andamento (o slug da que venceu)
        expect(JSON.stringify(refused.body)).toMatch(/rodada-[ab]/);
        expect(await prisma.season.count({ where: { status: 'RUNNING' } })).toBe(1);
        expect(await auditRows('admin.season.start')).toHaveLength(1);
      }
    });

    it('temporada que não existe é 404; id torto, corpo vazio e status que não é RUNNING são 400', async () => {
      expect((await patch(admin, `/seasons/${SOME_ULID}`, { name: 'x' })).status).toBe(404);
      expect((await patch(admin, '/seasons/nao-e-ulid', { name: 'x' })).status).toBe(400);
      const created = envelope(
        adminSeasonSchema,
        (await post(admin, '/seasons', seasonFile())).body,
      );
      for (const body of [{}, { status: 'FINISHED' }, { status: 'DRAFT' }, { slug: 'novo' }]) {
        expect(
          (await patch(admin, `/seasons/${created.id}`, body)).status,
          JSON.stringify(body),
        ).toBe(400);
      }
    });
  });

  // --- reprocessar o ciclo -----------------------------------------------------------------------------------------------
  describe('POST /admin/cycles/:date/rerun', () => {
    it('dentro da janela publica uma decide por modelo na fila decisions, e audita', async () => {
      await runningSeason();
      await briefing();
      const res = await post(admin, '/cycles/2026-11-03/rerun');
      expect(res.status).toBe(200);
      expect(envelope(cycleRerunSchema, res.body)).toEqual({
        date: '2026-11-03',
        seasons: [{ season: 'temporada-teste', result: 'published', published: 3 }],
      });
      const messages = await published('decisions');
      expect(messages).toHaveLength(3);
      expect(messages.map((m) => m.messageId)).toEqual(messages.map((m) => messageId(m.body)));
      expect(messages.every((m) => m.body.type === 'decide')).toBe(true);
      expect((await auditRows('admin.cycle.rerun'))[0]).toMatchObject({
        actor: actor(),
        target: '2026-11-03',
        detail: { date: '2026-11-03' },
      });
    });

    it('é idempotente: repetir não cria outro ciclo, não cria decisão e republica as mesmas mensagens (mesmo MessageId)', async () => {
      await runningSeason();
      await briefing();
      await post(admin, '/cycles/2026-11-03/rerun');
      await post(admin, '/cycles/2026-11-03/rerun');
      expect(await prisma.cycle.count()).toBe(1);
      expect(await prisma.decision.count()).toBe(0);
      const ids = (await published('decisions')).map((m) => m.messageId);
      expect(new Set(ids).size).toBe(3);
      expect(ids).toHaveLength(6);
    });

    it('só publica para quem falta, e a decisão já gravada não muda', async () => {
      const seasonId = await runningSeason();
      await briefing();
      await post(admin, '/cycles/2026-11-03/rerun');
      const [first] = await arena.modelCompetitors(seasonId);
      const cycle = await prisma.cycle.findFirstOrThrow();
      await prisma.decision.create({
        data: {
          id: newId(),
          cycleId: cycle.id,
          competitorId: first!.id,
          status: 'DECIDED',
          marketView: 'neutro',
          summary: 'gravada',
        },
      });
      const before = await prisma.decision.findMany();
      await rm(busDir, { recursive: true, force: true });

      const res = await post(admin, '/cycles/2026-11-03/rerun');

      expect(envelope(cycleRerunSchema, res.body).seasons).toEqual([
        { season: 'temporada-teste', result: 'published', published: 2 },
      ]);
      const sent = await published('decisions');
      expect(sent).toHaveLength(2);
      expect(sent.some((m) => m.body.type === 'decide' && m.body.competitorId === first!.id)).toBe(
        false,
      );
      expect(await prisma.decision.findMany()).toEqual(before);
    });

    it('NUNCA nos últimos 5 minutos antes do prazo das 09:30 nem depois dele: nenhuma mensagem, nenhum ciclo, nenhuma decisão', async () => {
      await runningSeason();
      await briefing();
      for (const at of [
        AT_0925,
        new Date('2026-11-03T12:29:59Z'),
        AT_0930,
        new Date('2026-11-03T18:00:00Z'),
        new Date('2026-11-04T11:00:00Z'),
      ]) {
        now = at;
        const res = await post(admin, '/cycles/2026-11-03/rerun');
        expect(res.status).toBe(200);
        expect(envelope(cycleRerunSchema, res.body).seasons, at.toISOString()).toEqual([
          { season: 'temporada-teste', result: 'past_deadline' },
        ]);
      }
      expect(await names('decisions', 'active')).toEqual([]);
      expect(await prisma.cycle.count()).toBe(0);
      expect(await prisma.decision.count()).toBe(0);
      // um segundo antes da margem ainda publica
      now = new Date('2026-11-03T12:24:59Z');
      const inside = await post(admin, '/cycles/2026-11-03/rerun');
      expect(envelope(cycleRerunSchema, inside.body).seasons).toEqual([
        { season: 'temporada-teste', result: 'published', published: 3 },
      ]);
    });

    it('o ciclo aberto de um dia que já passou também não é tocado', async () => {
      const seasonId = await runningSeason('temporada-teste', '2026-10-30');
      await briefing('2026-10-30');
      now = new Date('2026-10-30T11:00:05Z');
      await post(admin, '/cycles/2026-10-30/rerun');
      const cycle = await prisma.cycle.findFirstOrThrow();
      await rm(busDir, { recursive: true, force: true });
      now = AT_0830;
      const res = await post(admin, '/cycles/2026-10-30/rerun');
      expect(envelope(cycleRerunSchema, res.body).seasons).toEqual([
        { season: 'temporada-teste', result: 'past_deadline' },
      ]);
      expect(await names('decisions', 'active')).toEqual([]);
      expect(await prisma.cycle.findFirstOrThrow()).toEqual(cycle);
      expect(await prisma.decision.count({ where: { competitor: { seasonId } } })).toBe(0);
    });

    it('dia que não é pregão, ou fora do calendário: 409, sem auditar', async () => {
      await runningSeason();
      for (const date of ['2026-11-02', '2026-11-07', '2031-01-02']) {
        const res = await post(admin, `/cycles/${date}/rerun`);
        expect(res.status, date).toBe(409);
        expect(res.body).toMatchObject({ error: { code: 'NOT_A_TRADING_DAY' } });
      }
      expect(await auditRows('admin.cycle.rerun')).toEqual([]);
    });

    it('data que não existe, ano 0000 ou texto: 400', async () => {
      for (const date of ['2026-02-30', '0000-01-01', 'ontem', '20261103']) {
        expect((await post(admin, `/cycles/${date}/rerun`)).status, date).toBe(400);
      }
    });

    it('sem temporada em andamento a resposta é vazia', async () => {
      const res = await post(admin, '/cycles/2026-11-03/rerun');
      expect(envelope(cycleRerunSchema, res.body)).toEqual({ date: '2026-11-03', seasons: [] });
    });

    // Uma api sem PROMPT_ARENA_VERSION não sabe qual versão do prompt o ciclo fixa: recusa antes de auditar, de criar o ciclo e de publicar.
    it('sem PROMPT_ARENA_VERSION a api não reprocessa: 503 NOT_CONFIGURED, e nada é auditado, criado nem publicado', async () => {
      await runningSeason();
      await briefing();
      const bare = await startAccountApp(apiPrisma, {
        extraImports: [AdminModule],
        env: { SERVICEBUS_FAKE_DIR: busDir },
        overrides: [{ provide: ADMIN_CLOCK, useValue: () => now }],
      });
      try {
        const user = await createLoggedInUser(bare, prisma);
        await promoteToAdmin(prisma, user.email);
        const res = await asSite(user.agent.post(api('/cycles/2026-11-03/rerun')));
        expect(res.status).toBe(503);
        expect(res.body).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
        expect(await prisma.auditLog.count({ where: { action: 'admin.cycle.rerun' } })).toBe(0);
        expect(await prisma.cycle.count()).toBe(0);
        expect(await names('decisions', 'active')).toEqual([]);
      } finally {
        await bare.stop();
      }
    });

    // O Service Bus recusa a publicação: 502 sem o texto do SDK (que pode trazer o endereço do namespace). A linha de auditoria já foi
    // gravada (a intenção), o ciclo existe, e repetir com o barramento bom publica as MESMAS mensagens (o MessageId é determinístico).
    it('se o Service Bus recusa a publicação: 502 PUBLISH_FAILED sem o texto do SDK, e repetir é seguro (mesmos MessageId)', async () => {
      await runningSeason();
      await briefing();
      const sender = {
        sendMessages: () =>
          Promise.reject(new Error('Unauthorized: sb-alvesting.servicebus.windows.net')),
        close: () => Promise.resolve(),
      };
      const broken = await startAccountApp(apiPrisma, {
        extraImports: [AdminModule],
        env: { PROMPT_ARENA_VERSION: PROMPT_VERSION },
        overrides: [
          { provide: ADMIN_CLOCK, useValue: () => now },
          {
            provide: SERVICE_BUS_CLIENT,
            useValue: { createSender: () => sender, close: () => Promise.resolve() },
          },
        ],
      });
      try {
        const user = await createLoggedInUser(broken, prisma);
        await promoteToAdmin(prisma, user.email);
        const res = await asSite(user.agent.post(api('/cycles/2026-11-03/rerun')));
        expect(res.status).toBe(502);
        expect(res.body).toMatchObject({ error: { code: 'PUBLISH_FAILED' } });
        expect(JSON.stringify(res.body)).not.toMatch(/servicebus|Unauthorized/);
        expect(await prisma.auditLog.count({ where: { action: 'admin.cycle.rerun' } })).toBe(1);
        expect(await prisma.cycle.count()).toBe(1);
      } finally {
        await broken.stop();
      }
      const again = await post(admin, '/cycles/2026-11-03/rerun');
      expect(envelope(cycleRerunSchema, again.body).seasons).toEqual([
        { season: 'temporada-teste', result: 'published', published: 3 },
      ]);
      expect(await prisma.cycle.count()).toBe(1);
      expect(new Set((await published('decisions')).map((m) => m.messageId)).size).toBe(3);
    });

    it('o ciclo pulado por orçamento continua pulado: o teto vale no reprocesso', async () => {
      const seasonId = await arena.createSeason(
        seasonFileSchema.parse({
          ...seasonFile(),
          competitors: seasonFile().competitors.map((c) =>
            c.kind === 'MODEL' && c.slug === 'fake-a'
              ? { ...c, provider: 'openrouter' as const, modelId: 'anthropic/claude-opus-5.5' }
              : c,
          ),
        }),
      );
      await arena.startSeason(seasonId, '2026-11-03', new Date('2026-11-01T18:00:00Z'));
      await briefing();
      const old = await prisma.briefing.create({
        data: { id: newId(), date: day('2026-11-02'), sha256: 'b'.repeat(64), uri: 'x', bytes: 1 },
      });
      const pv = await arena.ensurePromptVersion(PROMPT_VERSION);
      const { cycle } = await arena.upsertCycle({
        seasonId,
        date: '2026-11-02',
        decisionAt: new Date('2026-11-02T11:00:00Z'),
        deadlineAt: new Date('2026-11-02T12:30:00Z'),
        state: { status: 'OPEN', briefingId: old.id, promptVersionId: pv.id },
      });
      const [model] = await arena.modelCompetitors(seasonId);
      await prisma.decision.create({
        data: {
          id: newId(),
          cycleId: cycle.id,
          competitorId: model!.id,
          status: 'DECIDED',
          marketView: 'neutro',
          summary: 's',
          costMicroUsd: 40_000_000n,
        },
      });
      const res = await post(admin, '/cycles/2026-11-03/rerun');
      expect(envelope(cycleRerunSchema, res.body).seasons).toEqual([
        { season: 'temporada-teste', result: 'skipped', reason: 'orcamento' },
      ]);
      expect(await names('decisions', 'active')).toEqual([]);
    });
  });

  // --- DLQ ---------------------------------------------------------------------------------------------------------------
  describe('POST /admin/dlq/:queue/resubmit', () => {
    const eod = (date: string): QueueMessage => ({ type: 'eod', date });
    const dead = (message: QueueMessage, extra: Record<string, unknown> = {}) => ({
      messageId: messageId(message),
      body: message,
      deliveryCount: 10,
      deadLetterReason: 'max_attempts_exceeded',
      ...extra,
    });

    it('reenvia da DLQ para a fila com o mesmo MessageId e audita (só os ids)', async () => {
      await seedDead('market', dead(eod('2026-11-03')));
      const res = await post(admin, '/dlq/market/resubmit', { messageIds: ['eod:2026-11-03'] });
      expect(res.status).toBe(200);
      expect(envelope(dlqResubmitSchema, res.body)).toEqual({
        queue: 'market',
        results: [{ messageId: 'eod:2026-11-03', result: 'resubmitted' }],
      });
      expect(await names('market', 'dead')).toEqual([]);
      expect(await published('market')).toMatchObject([
        { messageId: 'eod:2026-11-03', body: eod('2026-11-03') },
      ]);
      expect((await auditRows('admin.dlq.resubmit'))[0]).toMatchObject({
        actor: actor(),
        target: 'market',
        detail: { queue: 'market', messageIds: ['eod:2026-11-03'] },
      });
    });

    it('é idempotente pelo MessageId: repetir devolve not_found e não publica de novo', async () => {
      await seedDead('market', dead(eod('2026-11-03')));
      await post(admin, '/dlq/market/resubmit', { messageIds: ['eod:2026-11-03'] });
      const again = await post(admin, '/dlq/market/resubmit', { messageIds: ['eod:2026-11-03'] });
      expect(envelope(dlqResubmitSchema, again.body).results).toEqual([
        { messageId: 'eod:2026-11-03', result: 'not_found' },
      ]);
      expect(await published('market')).toHaveLength(1);
    });

    it('vários ids na mesma chamada: cada um com o seu resultado; o inválido e o de outra fila ficam na DLQ', async () => {
      await seedDead('market', dead(eod('2026-11-03')));
      await seedDead('market', { messageId: 'lixo:1', body: 'nao e json' });
      await seedDead('market', dead({ type: 'freeze', date: '2026-11-03' }));
      const res = await post(admin, '/dlq/market/resubmit', {
        messageIds: ['eod:2026-11-03', 'lixo:1', 'freeze:2026-11-03', 'eod:2026-11-04'],
      });
      expect(envelope(dlqResubmitSchema, res.body).results).toEqual([
        { messageId: 'eod:2026-11-03', result: 'resubmitted' },
        { messageId: 'lixo:1', result: 'invalid' },
        { messageId: 'freeze:2026-11-03', result: 'invalid' },
        { messageId: 'eod:2026-11-04', result: 'not_found' },
      ]);
      expect(await names('market', 'dead')).toHaveLength(2);
      expect(await published('market')).toHaveLength(1);
    });

    it('o teto por chamada (10), ids repetidos, fila que não existe e id fora da forma: 400, sem tocar no Service Bus', async () => {
      const ids = (n: number) =>
        Array.from({ length: n }, (_, i) => `eod:2026-11-${String(i + 1).padStart(2, '0')}`);
      expect((await post(admin, '/dlq/market/resubmit', { messageIds: ids(11) })).status).toBe(400);
      expect(
        (
          await post(admin, '/dlq/market/resubmit', {
            messageIds: ['eod:2026-11-03', 'eod:2026-11-03'],
          })
        ).status,
      ).toBe(400);
      expect((await post(admin, '/dlq/market/resubmit', { messageIds: [] })).status).toBe(400);
      expect((await post(admin, '/dlq/market/resubmit', {})).status).toBe(400);
      expect(
        (await post(admin, '/dlq/outra/resubmit', { messageIds: ['eod:2026-11-03'] })).status,
      ).toBe(400);
      expect(
        (await post(admin, '/dlq/__proto__/resubmit', { messageIds: ['eod:2026-11-03'] })).status,
      ).toBe(400);
      expect(
        (await post(admin, '/dlq/market/resubmit', { messageIds: ['../../etc/passwd'] })).status,
      ).toBe(400);
      expect((await post(admin, '/dlq/market/resubmit', { messageIds: ids(10) })).status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: 'admin.dlq.resubmit' } })).toBe(1);
    });

    it('com o Service Bus fora do ar (ou sem cliente configurado) é 503 e não diz a causa; nada é auditado como feito', async () => {
      const broken = await startAccountApp(apiPrisma, {
        extraImports: [AdminModule],
        env: { PROMPT_ARENA_VERSION: PROMPT_VERSION },
        overrides: [
          { provide: ADMIN_CLOCK, useValue: () => now },
          {
            provide: SERVICE_BUS_CLIENT,
            useValue: {
              createReceiver: () => {
                throw new Error('Unauthorized: sb-alvesting.servicebus.windows.net');
              },
              close: () => Promise.resolve(),
            },
          },
        ],
      });
      try {
        const user = await createLoggedInUser(broken, prisma);
        await promoteToAdmin(prisma, user.email);
        const res = await asSite(user.agent.post(api('/dlq/market/resubmit'))).send({
          messageIds: ['eod:2026-11-03'],
        });
        expect(res.status).toBe(503);
        expect(res.body).toMatchObject({ error: { code: 'SERVICE_BUS_UNAVAILABLE' } });
        expect(JSON.stringify(res.body)).not.toContain('servicebus.windows.net');
      } finally {
        await broken.stop();
      }
    });
  });

  // --- evento corporativo ------------------------------------------------------------------------------------------------
  // A api NÃO liquida na requisição: o papel do Postgres dela não escreve nas tabelas de resultado da arena (ADR 0028). Ela registra o
  // evento, reabre o job da liquidação e publica a `settle` na fila; quem liquida é o worker (aqui, o mesmo SettleHandler, rodado pelo teste).
  describe('POST /admin/corporate-events', () => {
    const SPLIT = { ticker: 'BBB4', exDate: '2026-11-05', kind: 'split', factor: '1:2' };
    const equities = async () =>
      (
        await prisma.equitySnapshot.findMany({
          orderBy: [{ date: 'asc' }, { competitorId: 'asc' }],
        })
      ).map((s) => s.equityCents);
    const worker = () =>
      new SettleHandler({
        jobs: new JobRunStore(prisma),
        arena,
        closer: new CycleCloser(arena),
        repo: new SettlementRepository(prisma),
        calendar: loadTradingCalendar(),
        clock: () => new Date('2026-11-10T00:35:00Z'),
      });
    const settleJob = (seasonId: string) =>
      prisma.jobRun.findUniqueOrThrow({
        where: {
          type_idempotencyKey: {
            type: 'settle',
            idempotencyKey: `${seasonId}:${HAND_CHECKED_LAST}`,
          },
        },
      });

    async function settledWorld() {
      await seedMarket(prisma, HAND_CHECKED_MARKET, { withEvents: false });
      const season = await seedSeason(prisma);
      await worker().execute({
        type: 'settle',
        seasonId: season.seasonId,
        date: HAND_CHECKED_LAST,
      });
      return season;
    }

    it('registra o evento, reabre o job e ENFILEIRA a settle da temporada que já passou da data ex, sem liquidar na requisição, com o ator admin:<ULID> nas duas trilhas', async () => {
      const season = await settledWorld();
      now = new Date('2026-11-10T00:35:00Z');
      const before = await equities();
      expect((await settleJob(season.seasonId)).status).toBe('SUCCEEDED');

      const res = await post(admin, '/corporate-events', SPLIT);

      expect(res.status).toBe(200);
      const result = envelope(corporateEventResultSchema, res.body);
      expect(result.event).toEqual({
        ticker: 'BBB4',
        exDate: '2026-11-05',
        kind: 'SPLIT',
        ratioFrom: 1,
        ratioTo: 2,
        change: 'created',
      });
      // enfileirada até o pregão que a temporada já tinha liquidado; nada foi liquidado agora
      expect(result.queued).toEqual([{ season: 'planilha', through: HAND_CHECKED_LAST }]);
      expect(result.pending).toEqual([]);
      expect(await equities()).toEqual(before);
      // a settle saiu para a fila da liquidação, com o MessageId determinístico, e o job foi reaberto ANTES (senão seria barrada)
      expect((await published('settlement')).map((m) => m.body)).toEqual([
        { type: 'settle', seasonId: season.seasonId, date: HAND_CHECKED_LAST },
      ]);
      const job = await settleJob(season.seasonId);
      expect(job.status).toBe('FAILED');
      expect(job.error).toMatch(/evento corporativo BBB4/);
      // a trilha do admin (a rota) e a do registro (o serviço), as duas com o ator
      expect((await auditRows('admin.corporate_event'))[0]).toMatchObject({
        actor: actor(),
        detail: { ticker: 'BBB4', exDate: '2026-11-05', kind: 'split', factor: '1:2' },
      });
      expect((await auditRows('corporate_event.created'))[0]).toMatchObject({
        actor: actor(),
        target: 'BBB4:2026-11-05:SPLIT',
      });
    });

    it('o worker liquida a mensagem que a api enfileirou, e só então o resultado publicado muda (o caminho inteiro)', async () => {
      const season = await settledWorld();
      now = new Date('2026-11-10T00:35:00Z');
      const before = await equities();
      await post(admin, '/corporate-events', SPLIT);
      const [message] = await published('settlement');

      const outcome = await worker().execute(message!.body as never);

      expect(outcome).toMatchObject({ status: 'settled', through: HAND_CHECKED_LAST });
      // o desdobramento dobra as ações da carteira
      expect(await equities()).not.toEqual(before);
      expect((await settleJob(season.seasonId)).status).toBe('SUCCEEDED');
    });

    it('repetir não muda o evento (unchanged), enfileira de novo (o job é reaberto outra vez) e deixa a trilha da chamada', async () => {
      const season = await settledWorld();
      now = new Date('2026-11-10T00:35:00Z');
      await post(admin, '/corporate-events', SPLIT);
      await worker().execute((await published('settlement'))[0]!.body as never);
      const after = await equities();

      const again = await post(admin, '/corporate-events', SPLIT);

      expect(envelope(corporateEventResultSchema, again.body)).toMatchObject({
        event: { change: 'unchanged' },
        queued: [{ season: 'planilha', through: HAND_CHECKED_LAST }],
      });
      expect(await equities()).toEqual(after);
      expect(await published('settlement')).toHaveLength(2);
      expect((await settleJob(season.seasonId)).status).toBe('FAILED');
      expect(await prisma.corporateEvent.count()).toBe(1);
      expect(await auditRows('admin.corporate_event')).toHaveLength(2);
      expect(await auditRows('corporate_event.created')).toHaveLength(1);
    });

    it('evento depois do último pregão liquidado fica registrado, sem enfileirar nada (a temporada entra em "pending")', async () => {
      const season = await settledWorld();
      const res = await post(admin, '/corporate-events', { ...SPLIT, exDate: '2026-12-01' });
      expect(envelope(corporateEventResultSchema, res.body)).toMatchObject({
        queued: [],
        pending: ['planilha'],
      });
      expect(await prisma.corporateEvent.count()).toBe(1);
      expect(await published('settlement')).toEqual([]);
      expect((await settleJob(season.seasonId)).status).toBe('SUCCEEDED');
    });

    it('a forma errada é 400 VALIDATION_ERROR; a direção do fator e o ticker que não existe são 400 INVALID_EVENT, sem gravar', async () => {
      await settledWorld();
      for (const body of [
        { ...SPLIT, ticker: 'ab' },
        { ...SPLIT, kind: 'dividendo' },
        { ...SPLIT, extra: 1 },
        {},
      ]) {
        const res = await post(admin, '/corporate-events', body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      }
      const backwards = await post(admin, '/corporate-events', { ...SPLIT, factor: '2:1' });
      expect(backwards.status).toBe(400);
      expect(backwards.body).toMatchObject({ error: { code: 'INVALID_EVENT' } });
      const unknown = await post(admin, '/corporate-events', { ...SPLIT, ticker: 'ZZZZ3' });
      expect(unknown.status).toBe(400);
      expect(unknown.body).toMatchObject({ error: { code: 'INVALID_EVENT' } });
      expect(await prisma.corporateEvent.count()).toBe(0);
      expect(await auditRows('corporate_event.created')).toEqual([]);
      expect(await published('settlement')).toEqual([]);
    });

    // O Service Bus recusa a publicação: o evento FICA registrado e o job reaberto, a resposta é 502 sem o texto do SDK (que pode trazer o
    // endereço do namespace), e repetir com o barramento bom enfileira a mesma mensagem.
    it('se o Service Bus recusa a publicação: 502 PUBLISH_FAILED sem o texto do SDK, o evento fica registrado e repetir enfileira', async () => {
      const season = await settledWorld();
      now = new Date('2026-11-10T00:35:00Z');
      const sender = {
        sendMessages: () =>
          Promise.reject(new Error('Unauthorized: sb-alvesting.servicebus.windows.net')),
        close: () => Promise.resolve(),
      };
      const broken = await startAccountApp(apiPrisma, {
        extraImports: [AdminModule],
        env: { PROMPT_ARENA_VERSION: PROMPT_VERSION },
        overrides: [
          { provide: ADMIN_CLOCK, useValue: () => now },
          {
            provide: SERVICE_BUS_CLIENT,
            useValue: { createSender: () => sender, close: () => Promise.resolve() },
          },
        ],
      });
      try {
        const user = await createLoggedInUser(broken, prisma);
        await promoteToAdmin(prisma, user.email);
        const res = await asSite(user.agent.post(api('/corporate-events'))).send(SPLIT);
        expect(res.status).toBe(502);
        expect(res.body).toMatchObject({ error: { code: 'PUBLISH_FAILED' } });
        expect(JSON.stringify(res.body)).not.toContain('servicebus.windows.net');
        expect(await prisma.corporateEvent.count()).toBe(1);
        expect((await settleJob(season.seasonId)).status).toBe('FAILED');
      } finally {
        await broken.stop();
      }
      const repeated = await post(admin, '/corporate-events', SPLIT);
      expect(repeated.status).toBe(200);
      expect(envelope(corporateEventResultSchema, repeated.body)).toMatchObject({
        event: { change: 'unchanged' },
        queued: [{ season: 'planilha', through: HAND_CHECKED_LAST }],
      });
      expect(await published('settlement')).toHaveLength(1);
    });
  });

  // --- custos ------------------------------------------------------------------------------------------------------------
  describe('GET /admin/costs', () => {
    async function spend(seasonId: string, date: string, slug: string, micro: bigint) {
      const competitor = (await prisma.competitor.findFirstOrThrow({ where: { seasonId, slug } }))
        .id;
      const b = await prisma.briefing.upsert({
        where: { date: day(date) },
        update: {},
        create: { id: newId(), date: day(date), sha256: 'c'.repeat(64), uri: 'x', bytes: 1 },
      });
      const pv = await arena.ensurePromptVersion(PROMPT_VERSION);
      const { cycle } = await arena.upsertCycle({
        seasonId,
        date,
        decisionAt: new Date(`${date}T11:00:00Z`),
        deadlineAt: new Date(`${date}T12:30:00Z`),
        state: { status: 'OPEN', briefingId: b.id, promptVersionId: pv.id },
      });
      await prisma.decision.create({
        data: {
          id: newId(),
          cycleId: cycle.id,
          competitorId: competitor,
          status: 'DECIDED',
          marketView: 'neutro',
          summary: 's',
          costMicroUsd: micro,
        },
      });
    }

    it('o acumulado do mês contra o teto, e o custo por competidor e por dia, só do mês de agora', async () => {
      const seasonId = await runningSeason('temporada-teste', '2026-10-29');
      now = new Date('2026-11-10T15:00:00Z');
      await spend(seasonId, '2026-10-30', 'fake-a', 9_000_000n); // mês anterior: não conta
      await spend(seasonId, '2026-11-03', 'fake-a', 1_250_000n);
      await spend(seasonId, '2026-11-03', 'fake-b', 500_000n);
      await spend(seasonId, '2026-11-04', 'fake-a', 2_000_000n);
      await spend(seasonId, '2026-11-04', 'fake-c', 0n);

      const res = await get(admin, '/costs');
      expect(res.status).toBe(200);
      const costs = envelope(adminCostsSchema, res.body);
      expect(costs).toMatchObject({
        month: '2026-11',
        capMicroUsd: 40_000_000,
        spentMicroUsd: 3_750_000,
      });
      expect(costs.rows).toEqual([
        {
          date: '2026-11-04',
          season: 'temporada-teste',
          competitor: 'fake-a',
          name: 'Fake A',
          costMicroUsd: 2_000_000,
        },
        {
          date: '2026-11-04',
          season: 'temporada-teste',
          competitor: 'fake-c',
          name: 'Fake C',
          costMicroUsd: 0,
        },
        {
          date: '2026-11-03',
          season: 'temporada-teste',
          competitor: 'fake-a',
          name: 'Fake A',
          costMicroUsd: 1_250_000,
        },
        {
          date: '2026-11-03',
          season: 'temporada-teste',
          competitor: 'fake-b',
          name: 'Fake B',
          costMicroUsd: 500_000,
        },
      ]);
      // a mesma conta do sched-cycle: o acumulado é a soma das linhas
      expect(costs.rows.reduce((sum, row) => sum + row.costMicroUsd, 0)).toBe(costs.spentMicroUsd);
    });

    it('o mês é o de Brasília: 22h do dia 30 em Brasília já é dia 1º em UTC, e continua novembro', async () => {
      now = new Date('2026-12-01T01:00:00Z');
      expect(envelope(adminCostsSchema, (await get(admin, '/costs')).body).month).toBe('2026-11');
      now = new Date('2026-12-01T03:00:00Z');
      expect(envelope(adminCostsSchema, (await get(admin, '/costs')).body).month).toBe('2026-12');
    });

    it('sem decisão no mês: zero e nenhuma linha', async () => {
      const costs = envelope(adminCostsSchema, (await get(admin, '/costs')).body);
      expect(costs).toMatchObject({ spentMicroUsd: 0, rows: [] });
    });
  });

  // --- jobs, filas e DLQ -------------------------------------------------------------------------------------------------
  describe('GET /admin/jobs', () => {
    const run = (
      type: string,
      key: string,
      status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'WAITING',
      startedAt: string,
      extra: { error?: string; attempts?: number; queue?: string } = {},
    ) =>
      prisma.jobRun.create({
        data: {
          id: newId(),
          queue: extra.queue ?? 'market',
          type,
          idempotencyKey: key,
          status,
          attempts: extra.attempts ?? 1,
          startedAt: new Date(startedAt),
          finishedAt: status === 'RUNNING' ? null : new Date(new Date(startedAt).getTime() + 5_000),
          error: extra.error ?? null,
        },
      });

    it('o último job_run de cada tipo com a contagem por estado, os FAILED recentes e a conferência de cada arquivo da CVM', async () => {
      await run('eod', '2026-11-03', 'SUCCEEDED', '2026-11-04T00:30:00Z');
      await run('eod', '2026-11-04', 'WAITING', '2026-11-05T00:30:00Z', {
        error: 'brapi sem todas as barras de 2026-11-04; nova tentativa agendada',
        attempts: 2,
      });
      await run('eod', '2026-11-05', 'FAILED', '2026-11-06T00:30:00Z', {
        // e o canário do prompt (regra 4 do CLAUDE.md) não chega à resposta nem se um erro o carregasse
        error:
          'falhou para pessoa@example.test em https://api.example.test/x?token=abc alv-canary-0123456789abcdef0123',
        attempts: 3,
      });
      await run('freeze', '2026-11-05', 'SUCCEEDED', '2026-11-05T10:30:00Z', { queue: 'briefing' });
      await run('fetch', 'infomoney:2026-11-05T10:00:00Z', 'FAILED', '2026-11-05T10:00:00Z', {
        queue: 'news',
        error: 'x'.repeat(2000),
      });
      await prisma.fetchState.createMany({
        data: [
          {
            source: 'cvm-ipe:2026',
            etag: '"etag-secreta"',
            lastModified: 'Wed, 04 Nov 2026 07:00:00 GMT',
            checkedAt: new Date('2026-11-05T10:30:00Z'),
          },
          {
            source: 'cvm-fca:2026',
            etag: null,
            lastModified: null,
            checkedAt: new Date('2026-11-05T07:00:00Z'),
          },
        ],
      });

      const res = await get(admin, '/jobs');
      expect(res.status).toBe(200);
      const jobs = envelope(adminJobsSchema, res.body);

      expect(jobs.jobs.map((j) => j.type)).toEqual(['eod', 'fetch', 'freeze']);
      const eod = jobs.jobs.find((j) => j.type === 'eod')!;
      expect(eod).toMatchObject({
        queue: 'market',
        counts: { RUNNING: 0, SUCCEEDED: 1, FAILED: 1, WAITING: 1 },
        latest: { key: '2026-11-05', status: 'FAILED', attempts: 3 },
      });
      // o WAITING (o eod que espera o arquivo) não é falha
      expect(jobs.failures.map((f) => `${f.type}:${f.key}`)).toEqual([
        'eod:2026-11-05',
        'fetch:infomoney:2026-11-05T10:00:00Z',
      ]);
      // o motivo sai sem dado pessoal nem query string, e cortado
      expect(eod.latest.error).not.toContain('pessoa@example.test');
      expect(eod.latest.error).not.toContain('token=abc');
      expect(JSON.stringify(res.body)).not.toContain('alv-canary-');
      expect(jobs.failures.find((f) => f.type === 'fetch')!.error!.length).toBeLessThanOrEqual(300);
      // a etag e o Last-Modified não saem
      expect(jobs.fetchStates).toEqual([
        { source: 'cvm-fca:2026', checkedAt: '2026-11-05T07:00:00.000Z' },
        { source: 'cvm-ipe:2026', checkedAt: '2026-11-05T10:30:00.000Z' },
      ]);
      expect(JSON.stringify(res.body)).not.toContain('etag-secreta');
    });

    it('lê a DLQ de cada fila com o papel de Receiver (peek, sem consumir): a contagem, o teto da leitura e só o que é seguro', async () => {
      await seedDead('market', {
        messageId: 'eod:2026-11-03',
        body: { type: 'eod', date: '2026-11-03', canario: 'CANARIO-DO-CORPO' },
        deliveryCount: 10,
        deadLetterReason: 'max_attempts_exceeded',
        deadLetterErrorDescription:
          'falhou para pessoa@example.test alv-canary-0123456789abcdef0123',
        enqueuedTimeUtc: '2026-11-04T00:30:00.000Z',
      });
      await seedDead('briefing', {
        messageId: 'envio de pessoa@example.test',
        body: 'nao e json',
        deliveryCount: 3,
      });
      for (let i = 0; i < ADMIN_DLQ_LISTED + 5; i++) {
        await seedDead('news', {
          messageId: `fetch:infomoney:2026-11-05T10:${String(i).padStart(2, '0')}:00Z`,
          body: {},
        });
      }
      const res = await get(admin, '/jobs');
      const queues = new Map(
        envelope(adminJobsSchema, res.body).queues.map((q) => [q.queue, q.deadLetters]),
      );
      expect([...queues.keys()]).toEqual([
        'market',
        'news',
        'briefing',
        'decisions',
        'settlement',
        'maintenance',
      ]);

      const market = queues.get('market')!;
      expect(market).toMatchObject({ status: 'ok', count: 1, capped: false });
      if (market.status !== 'ok') throw new Error('esperava a DLQ lida');
      expect(market.messages[0]).toMatchObject({
        messageId: 'eod:2026-11-03',
        resubmittable: true,
        deliveryCount: 10,
        reason: 'max_attempts_exceeded',
        enqueuedAt: '2026-11-04T00:30:00.000Z',
      });
      // uma mensagem posta por outra ferramenta, com o id fora do padrão (e um e-mail): listada, limpa e sem o botão de reenvio
      const briefing = queues.get('briefing')!;
      if (briefing.status !== 'ok') throw new Error('esperava a DLQ lida');
      expect(briefing.messages).toMatchObject([
        { resubmittable: false, deliveryCount: 3, reason: null },
      ]);
      expect(briefing.messages[0]!.messageId).not.toContain('pessoa@example.test');
      expect(JSON.stringify(res.body)).not.toContain('pessoa@example.test');
      expect(market.messages[0]!.description).not.toContain('pessoa@example.test');
      expect(JSON.stringify(res.body)).not.toContain('alv-canary-');
      // nunca o corpo da mensagem
      expect(JSON.stringify(res.body)).not.toContain('CANARIO-DO-CORPO');

      const news = queues.get('news')!;
      expect(news).toMatchObject({ status: 'ok', count: ADMIN_DLQ_LISTED, capped: true });
      expect(queues.get('decisions')).toEqual({
        status: 'ok',
        count: 0,
        capped: false,
        messages: [],
      });
      // ler não consome
      expect(await names('news', 'dead')).toHaveLength(ADMIN_DLQ_LISTED + 5);
    });

    it('se a DLQ não dá para ler (sem cliente, sem permissão, broker fora), a fila sai "unavailable" e a resposta não conta o motivo nem pede papel de dono', async () => {
      for (const client of [
        undefined,
        {
          createReceiver: () => ({
            peekMessages: () =>
              Promise.reject(new Error('Unauthorized: sb-alvesting.servicebus.windows.net')),
            close: () => Promise.resolve(),
          }),
          close: () => Promise.resolve(),
        },
      ]) {
        const broken = await startAccountApp(apiPrisma, {
          extraImports: [AdminModule],
          overrides: [
            { provide: ADMIN_CLOCK, useValue: () => now },
            { provide: SERVICE_BUS_CLIENT, useValue: client },
          ],
        });
        try {
          const user = await createLoggedInUser(broken, prisma);
          await promoteToAdmin(prisma, user.email);
          const res = await user.agent.get(api('/jobs'));
          expect(res.status).toBe(200);
          const body = envelope(adminJobsSchema, res.body);
          expect(body.queues).toHaveLength(6);
          expect(body.queues.every((q) => q.deadLetters.status === 'unavailable')).toBe(true);
          expect(JSON.stringify(res.body)).not.toMatch(/servicebus|Unauthorized/);
        } finally {
          await broken.stop();
        }
      }
    });
  });

  // --- auditoria ---------------------------------------------------------------------------------------------------------
  describe('a trilha de auditoria', () => {
    it('toda mutação deixa uma linha com o ator admin:<ULID>, a ação e o alvo, e nenhuma delas leva dado pessoal', async () => {
      await runningSeason('em-andamento');
      await briefing();
      await seedDead('market', {
        messageId: 'eod:2026-11-03',
        body: { type: 'eod', date: '2026-11-03' },
      });
      const draft = envelope(
        adminSeasonSchema,
        (await post(admin, '/seasons', seasonFile({ slug: 'nova' }))).body,
      );
      await patch(admin, `/seasons/${draft.id}`, { name: 'Nova, renomeada' });
      await post(admin, '/cycles/2026-11-03/rerun');
      await post(admin, '/dlq/market/resubmit', { messageIds: ['eod:2026-11-03'] });
      await seedMarket(prisma, HAND_CHECKED_MARKET, { withEvents: false });
      await post(admin, '/corporate-events', {
        ticker: 'BBB4',
        exDate: '2026-12-01',
        kind: 'split',
        factor: '1:2',
      });

      const rows = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
      expect(rows.map((r) => r.action)).toEqual([
        'admin.season.create',
        'admin.season.update',
        'admin.cycle.rerun',
        'admin.dlq.resubmit',
        'admin.corporate_event',
        'corporate_event.created',
      ]);
      for (const row of rows) {
        expect(row.actor, row.action).toBe(`admin:${admin.userId}`);
        expect(row.target, row.action).toEqual(expect.any(String));
        expect(row.detail, row.action).not.toBeNull();
      }
      const text = JSON.stringify(rows);
      for (const personal of [admin.email, common.email, 'Pessoa de Teste']) {
        expect(text).not.toContain(personal);
      }
    });

    // O reprocesso, o reenvio e o evento gravam a linha ANTES da ação (o Service Bus e a reliquidação não cabem numa transação do
    // Postgres) e fecham para o lado seguro: se a linha não grava, a ação não acontece. Criar, editar e iniciar a temporada gravam na mesma
    // transação da mudança (arena.repository.seasons.integration.spec.ts prova que, sem a linha, a temporada não fica).
    it('se a linha de auditoria não grava, a ação não acontece (reprocesso, reenvio da DLQ e evento), e a resposta não conta a causa', async () => {
      await runningSeason('em-andamento');
      await briefing();
      await seedDead('market', {
        messageId: 'eod:2026-11-03',
        body: { type: 'eod', date: '2026-11-03' },
      });
      await seedMarket(prisma, HAND_CHECKED_MARKET, { withEvents: false });
      const EVENT = { ticker: 'BBB4', exDate: '2026-12-01', kind: 'split', factor: '1:2' };
      const ACTIONS: Array<[string, object | undefined]> = [
        ['/cycles/2026-11-03/rerun', undefined],
        ['/dlq/market/resubmit', { messageIds: ['eod:2026-11-03'] }],
        ['/corporate-events', EVENT],
      ];
      const failing = await startAccountApp(apiPrisma, {
        extraImports: [AdminModule],
        env: { PROMPT_ARENA_VERSION: PROMPT_VERSION, SERVICEBUS_FAKE_DIR: busDir },
        overrides: [
          { provide: ADMIN_CLOCK, useValue: () => now },
          {
            provide: AdminAudit,
            useValue: { record: () => Promise.reject(new Error('auditoria fora: banco 10.0.0.5')) },
          },
        ],
      });
      try {
        const user = await createLoggedInUser(failing, prisma);
        await promoteToAdmin(prisma, user.email);
        for (const [path, body] of ACTIONS) {
          const res = await asSite(user.agent.post(api(path))).send(body);
          expect(res.status, path).toBe(500);
          expect(JSON.stringify(res.body), path).not.toContain('10.0.0.5');
        }
        expect(await names('decisions', 'active')).toEqual([]);
        expect(await prisma.cycle.count()).toBe(0);
        expect(await names('market', 'dead')).toHaveLength(1);
        expect(await names('market', 'active')).toEqual([]);
        expect(await prisma.corporateEvent.count()).toBe(0);
      } finally {
        await failing.stop();
      }
      // a causa era a auditoria: com ela de volta, as mesmas três ações valem
      for (const [path, body] of ACTIONS) {
        const res = await post(admin, path, body);
        expect(res.status, path).toBe(200);
      }
      expect(await prisma.cycle.count()).toBe(1);
      expect(await names('market', 'dead')).toEqual([]);
      expect(await prisma.corporateEvent.count()).toBe(1);
    });

    it('a leitura não deixa trilha (GET)', async () => {
      await get(admin, '/seasons');
      await get(admin, '/costs');
      await get(admin, '/jobs');
      expect(await prisma.auditLog.count()).toBe(0);
    });
  });
});
