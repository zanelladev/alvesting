import {
  DROP_REASONS,
  HOLD_REASONS,
  LLM_PROVIDERS,
  SKIP_REASONS,
  seasonFileSchema,
  type SeasonFile,
} from '@alvesting/contracts';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { DecisionRecord } from '../domain/decision-record.js';
import { appliedFixture, seasonFile } from '../testing/arena.fixture.js';
import { ArenaRepository, SeasonSlugTakenError } from './arena.repository.js';

// um ponto de dados das métricas em memória, só com o que os testes leem
type Point = { attributes: Record<string, unknown>; value: unknown };

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const SHA = 'a'.repeat(64);
const VERSION = '0123456789abcdef0123456789abcdef';

describe.skipIf(!testDatabaseUrl)(integrationTitle('ArenaRepository'), () => {
  let prisma: PrismaService;
  let repo: ArenaRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    repo = new ArenaRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    // as linhas da liquidação (etapa 7) apontam para o elenco e para os itens da decisão
    await prisma.position.deleteMany();
    await prisma.equitySnapshot.deleteMany();
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

  const file = (overrides: Partial<SeasonFile> = {}) =>
    seasonFileSchema.parse(seasonFile(overrides));
  const briefing = async (date: string, sha256 = SHA) =>
    prisma.briefing.create({
      data: { id: newId(), date: day(date), sha256, uri: `https://blob/${date}`, bytes: 10 },
    });

  async function openCycle(date = '2026-11-03', seasonId?: string) {
    const id = seasonId ?? (await repo.createSeason(file()));
    const b = await briefing(date);
    const pv = await repo.ensurePromptVersion(VERSION);
    const { cycle } = await repo.upsertCycle({
      seasonId: id,
      date,
      decisionAt: new Date(`${date}T11:00:00Z`),
      deadlineAt: new Date(`${date}T12:30:00Z`),
      state: { status: 'OPEN', briefingId: b.id, promptVersionId: pv.id },
    });
    return { seasonId: id, cycle };
  }

  const decided = (
    cycleId: string,
    competitorId: string,
    over: Partial<DecisionRecord> = {},
  ): DecisionRecord => ({
    cycleId,
    competitorId,
    status: 'DECIDED',
    holdReason: null,
    marketView: 'neutro',
    summary: 'Dia calmo.',
    usage: { calls: 1, promptTokens: 10, completionTokens: 5, reasoningTokens: 0, totalTokens: 15 },
    costMicroUsd: 1_500n,
    applied: appliedFixture(),
    inputSha256: SHA,
    outputSha256: 'b'.repeat(64),
    metaSha256: 'c'.repeat(64),
    ioUris: { request: 'http://blob/request' },
    leakFields: [],
    items: [
      {
        position: 0,
        action: 'BUY',
        ticker: 'WEGE3',
        percent: 7.5,
        confidence: 0.7,
        rationale: 'Resultado forte.',
        dropped: false,
        dropReason: null,
        dropDetail: null,
      },
      {
        position: 1,
        action: 'SELL',
        ticker: 'XPTO3',
        percent: 50,
        confidence: null,
        rationale: null,
        dropped: true,
        dropReason: 'not_in_portfolio',
        dropDetail: null,
      },
      {
        position: 2,
        action: null,
        ticker: null,
        percent: null,
        confidence: null,
        rationale: null,
        dropped: true,
        dropReason: 'invalid_item',
        dropDetail: 'percent_of_equity:too_big',
      },
    ],
    ...over,
  });

  describe('temporada e elenco', () => {
    it('grava a temporada como rascunho, com os parâmetros e o elenco na ordem do arquivo', async () => {
      const id = await repo.createSeason(file());
      const season = await repo.seasonById(id);
      expect(season).toMatchObject({ slug: 'temporada-teste', status: 'DRAFT', startDate: null });
      expect(season!.params).toEqual(file().params);

      const rows = await prisma.competitor.findMany({
        where: { seasonId: id },
        orderBy: { position: 'asc' },
      });
      expect(rows.map((r) => [r.slug, r.kind, r.provider, r.modelId, r.benchmark])).toEqual([
        ['fake-a', 'MODEL', 'fake', 'fake/deterministic-a', null],
        ['fake-b', 'MODEL', 'fake', 'fake/deterministic-b', null],
        ['fake-c', 'MODEL', 'fake', 'fake/deterministic-c', null],
        ['sorteio', 'RANDOM', null, null, null],
        ['igual-peso', 'BENCHMARK', null, null, 'EQUAL_WEIGHT'],
        ['cdi', 'BENCHMARK', null, null, 'CDI'],
        ['bova11', 'BENCHMARK', null, null, 'BOVA11'],
      ]);
    });

    it('só o MODEL recebe decide: modelCompetitors devolve os modelos, na ordem, com os recursos do provedor', async () => {
      const id = await repo.createSeason(
        file({
          competitors: file().competitors.map((c) =>
            c.kind === 'MODEL' && c.slug === 'fake-a'
              ? {
                  ...c,
                  provider: 'openrouter' as const,
                  modelId: 'anthropic/claude-opus-5.5',
                  capabilities: { jsonSchema: true, reasoningEffort: true },
                  pricingUsdPerMTok: { input: '4', output: '20' },
                }
              : c,
          ),
        }),
      );
      const models = await repo.modelCompetitors(id);
      expect(models.map((m) => m.slug)).toEqual(['fake-a', 'fake-b', 'fake-c']);
      expect(models[0]).toMatchObject({
        provider: 'openrouter',
        modelId: 'anthropic/claude-opus-5.5',
        capabilities: { jsonSchema: true, reasoningEffort: true },
        pricingUsdPerMTok: { input: '4', output: '20' },
      });
      expect(models[1]!.pricingUsdPerMTok).toBeUndefined();
      expect(await repo.competitorById(models[1]!.id)).toMatchObject({
        slug: 'fake-b',
        kind: 'MODEL',
      });
      const sorteio = await prisma.competitor.findFirstOrThrow({ where: { slug: 'sorteio' } });
      expect(await repo.competitorById(sorteio.id)).toMatchObject({
        kind: 'RANDOM',
        provider: null,
      });
      expect(await repo.competitorById(newId())).toBeNull();
    });

    // O CHECK da tabela não tem o regex do ID do modelo (só o arquivo da temporada tem): uma linha escrita por fora do contrato seria chamada
    // e paga pelo job de decisões. A leitura que leva ao modelo confere de novo, e só para esse competidor.
    it.each([
      ['perplexity/sonar:online', 'openrouter'],
      ['openrouter/auto', 'openrouter'],
      ['anthropic/claude-opus-5.5:nitro', 'openrouter'],
      ['fake/com espaço', 'fake'],
    ] as const)(
      'competitorById recusa o MODEL do banco com o ID %s (provedor %s), sem derrubar os outros',
      async (badModelId, provider) => {
        const id = await repo.createSeason(file());
        const [bad, good] = await repo.modelCompetitors(id);
        await prisma.competitor.update({
          where: { id: bad!.id },
          data: { provider, modelId: badModelId },
        });
        await expect(repo.competitorById(bad!.id)).rejects.toThrow(
          /ID de modelo do competidor fake-a inválido no banco/,
        );
        expect(await repo.competitorById(good!.id)).toMatchObject({ slug: 'fake-b' });
        // o agendador só lista quem recebe a mensagem: o erro aparece na decisão, que é onde o modelo seria chamado
        expect((await repo.modelCompetitors(id)).map((m) => m.slug)).toEqual([
          'fake-a',
          'fake-b',
          'fake-c',
        ]);
      },
    );

    it('slug repetido falha com erro claro e não deixa o elenco pela metade', async () => {
      await repo.createSeason(file());
      await expect(repo.createSeason(file())).rejects.toBeInstanceOf(SeasonSlugTakenError);
      expect(await prisma.season.count()).toBe(1);
      expect(await prisma.competitor.count()).toBe(7);
    });

    it('season:start leva o rascunho para RUNNING com a data de início; repetir não muda nada', async () => {
      const id = await repo.createSeason(file());
      const now = new Date('2026-11-01T18:00:00Z');
      await expect(repo.startSeason(id, '2026-11-03', now)).resolves.toBe('started');
      expect(await repo.seasonById(id)).toMatchObject({
        status: 'RUNNING',
        startDate: '2026-11-03',
      });
      await expect(repo.startSeason(id, '2026-11-04', now)).resolves.toBe('not_draft');
      expect((await repo.seasonById(id))!.startDate).toBe('2026-11-03');
      await expect(repo.startSeason(newId(), '2026-11-03', now)).resolves.toBe('not_found');
    });

    it('runningSeasons devolve só as RUNNING, com os parâmetros validados', async () => {
      const a = await repo.createSeason(file());
      await repo.createSeason(file({ slug: 'outra' }));
      expect(await repo.runningSeasons()).toEqual([]);
      await repo.startSeason(a, '2026-11-03', new Date());
      const running = await repo.runningSeasons();
      expect(running.map((s) => s.id)).toEqual([a]);
      expect(running[0]!.params.sessions).toBe(5);
    });

    it('parâmetros corrompidos no banco falham alto em vez de seguir com padrão', async () => {
      const id = await repo.createSeason(file());
      await prisma.$executeRaw`UPDATE season SET params = '{"sessions": "vinte"}'::jsonb WHERE id = ${id}`;
      await expect(repo.seasonById(id)).rejects.toThrow(/parâmetros/i);
    });
  });

  describe('prompt_version: a versão do segredo e o SHA-256', () => {
    it('ensurePromptVersion é idempotente por versão e nasce sem SHA-256 (o sched-cycle não lê o texto)', async () => {
      const a = await repo.ensurePromptVersion(VERSION);
      const b = await repo.ensurePromptVersion(VERSION);
      expect(b.id).toBe(a.id);
      expect(a).toMatchObject({ version: VERSION, sha256: null });
      expect(await prisma.promptVersion.count()).toBe(1);
    });

    it('o primeiro decide registra o SHA-256; os seguintes conferem o dele contra o registrado', async () => {
      const pv = await repo.ensurePromptVersion(VERSION);
      const now = new Date('2026-11-03T11:00:05Z');
      await expect(repo.registerPromptSha256(pv.id, SHA, now)).resolves.toBe(SHA);
      // outra execução com um texto diferente sob a mesma versão: devolve o registrado, não sobrescreve
      await expect(repo.registerPromptSha256(pv.id, 'b'.repeat(64), now)).resolves.toBe(SHA);
      const row = await prisma.promptVersion.findUniqueOrThrow({ where: { id: pv.id } });
      expect(row.sha256).toBe(SHA);
      expect(row.registeredAt).toEqual(now);
    });

    it('o banco recusa versão que não são 32 hexadecimais e SHA-256 torto', async () => {
      await expect(
        prisma.promptVersion.create({ data: { id: newId(), version: 'latest' } }),
      ).rejects.toThrow(/prompt_version_check/);
      await expect(
        prisma.promptVersion.create({
          data: { id: newId(), version: VERSION, sha256: 'xyz', registeredAt: new Date() },
        }),
      ).rejects.toThrow(/prompt_version_check/);
    });
  });

  describe('ciclo', () => {
    it('cria o ciclo aberto com o briefing e a versão do prompt fixados', async () => {
      const { cycle, seasonId } = await openCycle();
      expect(cycle).toMatchObject({
        seasonId,
        date: '2026-11-03',
        status: 'OPEN',
        skipReason: null,
        briefing: { sha256: SHA },
        promptVersion: { version: VERSION, sha256: null },
      });
      expect(cycle.decisionAt).toEqual(new Date('2026-11-03T11:00:00Z'));
      expect(cycle.deadlineAt).toEqual(new Date('2026-11-03T12:30:00Z'));
    });

    it('upsertCycle é idempotente: o ciclo aberto volta igual e created = false', async () => {
      const first = await openCycle();
      const pv = await repo.ensurePromptVersion(VERSION);
      const again = await repo.upsertCycle({
        seasonId: first.seasonId,
        date: '2026-11-03',
        decisionAt: first.cycle.decisionAt,
        deadlineAt: first.cycle.deadlineAt,
        state: { status: 'OPEN', briefingId: first.cycle.briefing!.id, promptVersionId: pv.id },
      });
      expect(again.created).toBe(false);
      expect(again.cycle.id).toBe(first.cycle.id);
      expect(await prisma.cycle.count()).toBe(1);
    });

    it('o ciclo pulado leva o motivo, e um ciclo aberto nunca volta a ser pulado', async () => {
      const seasonId = await repo.createSeason(file());
      const dates = {
        decisionAt: new Date('2026-11-03T11:00:00Z'),
        deadlineAt: new Date('2026-11-03T12:30:00Z'),
      };
      const skipped = await repo.upsertCycle({
        seasonId,
        date: '2026-11-03',
        ...dates,
        state: {
          status: 'SKIPPED',
          reason: 'sem_briefing',
          briefingId: null,
          promptVersionId: null,
        },
      });
      expect(skipped.cycle).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'sem_briefing',
        briefing: null,
      });

      // o briefing chegou depois e o sched-cycle rodou de novo: o ciclo pulado é reavaliado e abre
      const b = await briefing('2026-11-03');
      const pv = await repo.ensurePromptVersion(VERSION);
      const opened = await repo.upsertCycle({
        seasonId,
        date: '2026-11-03',
        ...dates,
        state: { status: 'OPEN', briefingId: b.id, promptVersionId: pv.id },
      });
      expect(opened.cycle).toMatchObject({
        id: skipped.cycle.id,
        status: 'OPEN',
        skipReason: null,
      });

      // aberto não é rebaixado (as mensagens já saíram)
      const stillOpen = await repo.upsertCycle({
        seasonId,
        date: '2026-11-03',
        ...dates,
        state: { status: 'SKIPPED', reason: 'orcamento', briefingId: b.id, promptVersionId: pv.id },
      });
      expect(stillOpen.cycle.status).toBe('OPEN');
    });

    it('o banco recusa ciclo aberto sem briefing e ciclo pulado sem motivo', async () => {
      const seasonId = await repo.createSeason(file());
      const base = {
        id: newId(),
        seasonId,
        date: day('2026-11-03'),
        decisionAt: new Date('2026-11-03T11:00:00Z'),
        deadlineAt: new Date('2026-11-03T12:30:00Z'),
      };
      await expect(prisma.cycle.create({ data: { ...base, status: 'OPEN' } })).rejects.toThrow(
        /cycle_check/,
      );
      await expect(
        prisma.cycle.create({ data: { ...base, id: newId(), status: 'SKIPPED' } }),
      ).rejects.toThrow(/cycle_check/);
      await expect(
        prisma.cycle.create({
          data: { ...base, id: newId(), status: 'SKIPPED', skipReason: 'qualquer' },
        }),
      ).rejects.toThrow(/cycle_check/);
    });

    it('o banco recusa ciclo fechado sem a hora do fechamento e ciclo aberto ou pulado com ela', async () => {
      const { cycle } = await openCycle();
      const when = new Date('2026-11-03T11:30:00Z');
      await expect(
        prisma.cycle.update({ where: { id: cycle.id }, data: { status: 'CLOSED' } }),
      ).rejects.toThrow(/cycle_closed_check/);
      await expect(
        prisma.cycle.update({ where: { id: cycle.id }, data: { closedAt: when } }),
      ).rejects.toThrow(/cycle_closed_check/);
      await expect(
        prisma.cycle.update({
          where: { id: cycle.id },
          data: { status: 'CLOSED', closedAt: when },
        }),
      ).resolves.toMatchObject({ status: 'CLOSED' });
    });

    it('o Sorteio é um só por temporada e cada referência uma vez só; outra temporada tem o seu', async () => {
      const seasonId = await repo.createSeason(file());
      const extra = (over: Record<string, unknown>) =>
        prisma.competitor.create({
          data: {
            id: newId(),
            seasonId,
            slug: `extra-${newId()}`,
            name: 'Extra',
            position: 99,
            ...over,
          } as never,
        });
      await expect(extra({ kind: 'RANDOM' })).rejects.toThrow(/competitor_one_random_per_season/);
      await expect(extra({ kind: 'BENCHMARK', benchmark: 'CDI' })).rejects.toThrow(
        /competitor_one_benchmark_per_season/,
      );
      // o mesmo conjunto em outra temporada é outra coisa
      await expect(repo.createSeason(file({ slug: 'outra' }))).resolves.toBeTypeOf('string');
      // e o índice parcial não mexe com os modelos: quantos forem
      await expect(
        extra({ kind: 'MODEL', provider: 'fake', modelId: 'fake/mais-um', config: {} }),
      ).resolves.toMatchObject({ kind: 'MODEL' });
    });

    it('os motivos de pulo do contrato cabem no banco, e um motivo fora da lista não', async () => {
      const seasonId = await repo.createSeason(file());
      for (const [i, reason] of SKIP_REASONS.entries()) {
        const { cycle } = await repo.upsertCycle({
          seasonId,
          date: `2026-11-0${3 + i}`,
          decisionAt: new Date('2026-11-03T11:00:00Z'),
          deadlineAt: new Date('2026-11-03T12:30:00Z'),
          state: { status: 'SKIPPED', reason, briefingId: null, promptVersionId: null },
        });
        expect(cycle).toMatchObject({ status: 'SKIPPED', skipReason: reason });
      }
      await expect(
        prisma.cycle.create({
          data: {
            id: newId(),
            seasonId,
            date: day('2026-11-09'),
            decisionAt: new Date('2026-11-09T11:00:00Z'),
            deadlineAt: new Date('2026-11-09T12:30:00Z'),
            status: 'SKIPPED',
            skipReason: 'motivo_novo_sem_migration',
          },
        }),
      ).rejects.toThrow(/cycle_check/);
    });

    it('cycleById traz o briefing e a versão do prompt', async () => {
      const { cycle } = await openCycle();
      expect(await repo.cycleById(cycle.id)).toEqual(cycle);
      expect(await repo.cycleById(newId())).toBeNull();
    });
  });

  describe('decisão', () => {
    it('grava a decisão com os itens (válidos e descartados) numa transação e devolve created', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a] = await repo.modelCompetitors(seasonId);
      await expect(repo.saveDecision(decided(cycle.id, a!.id))).resolves.toBe('created');

      const decision = await prisma.decision.findFirstOrThrow({
        where: { cycleId: cycle.id },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      expect(decision).toMatchObject({
        status: 'DECIDED',
        holdReason: null,
        marketView: 'neutro',
        summary: 'Dia calmo.',
        costMicroUsd: 1_500n,
        inputSha256: SHA,
        leakFields: [],
      });
      expect(
        decision.items.map((i) => [i.position, i.action, i.ticker, i.dropped, i.dropReason]),
      ).toEqual([
        [0, 'BUY', 'WEGE3', false, null],
        [1, 'SELL', 'XPTO3', true, 'not_in_portfolio'],
        [2, null, null, true, 'invalid_item'],
      ]);
      expect(decision.items[0]!.percent!.toString()).toBe('7.5');
      expect(decision.items[0]!.confidence!.toString()).toBe('0.7');
      expect(decision.items[1]!.rationale).toBeNull(); // o texto do descartado não é guardado
    });

    it('a mesma decisão duas vezes (execução duplicada) devolve exists e não duplica nada', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a] = await repo.modelCompetitors(seasonId);
      await repo.saveDecision(decided(cycle.id, a!.id));
      await expect(repo.saveDecision(decided(cycle.id, a!.id, { summary: 'outra' }))).resolves.toBe(
        'exists',
      );
      expect(await prisma.decision.count()).toBe(1);
      expect(await prisma.decisionItem.count()).toBe(3);
      expect(await repo.decisionExists(cycle.id, a!.id)).toBe(true);
      expect(await repo.decisionExists(cycle.id, newId())).toBe(false);
    });

    it('HOLD forçado leva o motivo, sem visão de mercado nem itens', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a] = await repo.modelCompetitors(seasonId);
      await repo.saveDecision(
        decided(cycle.id, a!.id, {
          status: 'FORCED_HOLD',
          holdReason: 'prazo',
          marketView: null,
          summary: null,
          usage: null,
          costMicroUsd: 0n,
          applied: null,
          inputSha256: null,
          outputSha256: null,
          metaSha256: null,
          ioUris: null,
          items: [],
        }),
      );
      const row = await prisma.decision.findFirstOrThrow({ where: { cycleId: cycle.id } });
      expect(row).toMatchObject({ status: 'FORCED_HOLD', holdReason: 'prazo', summary: null });
    });

    it('o banco recusa HOLD forçado sem motivo, decisão normal sem resumo e item sem ação', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a, b, c] = await repo.modelCompetitors(seasonId);
      const base = { cycleId: cycle.id, costMicroUsd: 0n };
      await expect(
        prisma.decision.create({
          data: { id: newId(), competitorId: a!.id, status: 'FORCED_HOLD', ...base },
        }),
      ).rejects.toThrow(/decision_check/);
      await expect(
        prisma.decision.create({
          data: { id: newId(), competitorId: b!.id, status: 'DECIDED', ...base },
        }),
      ).rejects.toThrow(/decision_check/);
      await expect(
        prisma.decision.create({
          data: {
            id: newId(),
            competitorId: c!.id,
            status: 'DECIDED',
            marketView: 'neutro',
            summary: 's',
            costMicroUsd: -1n,
            cycleId: cycle.id,
          },
        }),
      ).rejects.toThrow(/decision_check/);
      const ok = await prisma.decision.create({
        data: {
          id: newId(),
          competitorId: a!.id,
          status: 'DECIDED',
          marketView: 'neutro',
          summary: 's',
          ...base,
        },
      });
      await expect(
        prisma.decisionItem.create({
          data: { id: newId(), decisionId: ok.id, position: 0, ticker: 'X', rationale: 'r' },
        }),
      ).rejects.toThrow(/decision_item_check/);
      // BUY sem percentual
      await expect(
        prisma.decisionItem.create({
          data: {
            id: newId(),
            decisionId: ok.id,
            position: 1,
            action: 'BUY',
            ticker: 'WEGE3',
            rationale: 'r',
          },
        }),
      ).rejects.toThrow(/decision_item_check/);
    });

    // A liquidação (etapa 7) relê a faixa do BUY e lança RangeError se ela não vale: um item fora da faixa que escapasse do validador
    // (dado reparado à mão, caminho de escrita novo) interromperia a liquidação da temporada inteira, a cada entrega. No banco o erro
    // aparece na gravação da decisão, onde só aquele modelo vira HOLD.
    it('o banco recusa BUY fora da faixa de 5% a 25% do patrimônio, mas guarda o descartado como o modelo pediu', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a] = await repo.modelCompetitors(seasonId);
      const decision = await prisma.decision.create({
        data: {
          id: newId(),
          cycleId: cycle.id,
          competitorId: a!.id,
          status: 'DECIDED',
          marketView: 'neutro',
          summary: 's',
          costMicroUsd: 0n,
        },
      });
      let position = 0;
      const item = (data: Partial<Prisma.DecisionItemUncheckedCreateInput>) =>
        prisma.decisionItem.create({
          data: {
            id: newId(),
            decisionId: decision.id,
            position: position++,
            action: 'BUY',
            ticker: 'WEGE3',
            rationale: 'r',
            ...data,
          },
        });

      for (const percent of ['4.9999', '0.5', '25.0001', '100']) {
        await expect(item({ percent }), `BUY ${percent}%`).rejects.toThrow(
          /decision_item_buy_range_check/,
        );
      }
      // as pontas valem, e o SELL segue de 1% a 100%
      await item({ percent: '5' });
      await item({ percent: '25' });
      await item({ action: 'SELL', percent: '100' });
      await item({ action: 'SELL', percent: '1' });
      // o descartado guarda o que o modelo pediu, mesmo fora da faixa (é o motivo do descarte)
      await item({
        percent: '40',
        dropped: true,
        dropReason: 'invalid_item',
        rationale: null,
      });
      expect(await prisma.decisionItem.count({ where: { decisionId: decision.id } })).toBe(5);
    });

    it('os motivos de HOLD e de descarte do contrato cabem no banco, e um motivo novo sem migration não', async () => {
      const forced = (cycleId: string, competitorId: string, reason: string) =>
        decided(cycleId, competitorId, {
          status: 'FORCED_HOLD',
          holdReason: reason as DecisionRecord['holdReason'],
          marketView: null,
          summary: null,
          usage: null,
          items: [],
        });
      const dropped = (reason: string): DecisionRecord['items'] => [
        {
          position: 0,
          action: 'BUY',
          ticker: 'WEGE3',
          percent: 10,
          confidence: null,
          rationale: null,
          dropped: true,
          dropReason: reason as DecisionRecord['items'][number]['dropReason'],
          dropDetail: null,
        },
      ];
      // uma temporada, um ciclo por valor (a decisão é única por ciclo e competidor)
      const { seasonId } = await openCycle('2026-11-02');
      const [a, b] = await repo.modelCompetitors(seasonId);
      let day2 = 10;
      const nextCycle = async () =>
        (await openCycle(`2026-12-${String(day2++).padStart(2, '0')}`, seasonId)).cycle;
      for (const reason of HOLD_REASONS) {
        const cycle = await nextCycle();
        await expect(repo.saveDecision(forced(cycle.id, a!.id, reason))).resolves.toBe('created');
      }
      for (const reason of DROP_REASONS) {
        const cycle = await nextCycle();
        await expect(
          repo.saveDecision(decided(cycle.id, a!.id, { items: dropped(reason) })),
        ).resolves.toBe('created');
      }
      const last = await nextCycle();
      await expect(
        repo.saveDecision(forced(last.id, a!.id, 'motivo_novo_sem_migration')),
      ).rejects.toThrow(/decision_check/);
      await expect(
        repo.saveDecision(decided(last.id, b!.id, { items: dropped('motivo_novo_sem_migration') })),
      ).rejects.toThrow(/decision_item_check/);
    });

    it('os provedores do contrato cabem no banco (o elenco de cada um é criado e lido de volta)', async () => {
      const spec = (provider: string) =>
        ({
          openrouter: { provider, modelId: 'anthropic/claude-opus-5.5' },
          'azure-openai': {
            provider,
            modelId: 'gpt-4.1-mini',
            pricingUsdPerMTok: { input: '0.4', output: '1.6' },
          },
          fake: { provider, modelId: 'fake/qualquer' },
        })[provider]!;
      for (const [i, provider] of LLM_PROVIDERS.entries()) {
        const id = await repo.createSeason(
          file({
            slug: `provedor-${i}`,
            competitors: file().competitors.map((c) =>
              c.kind === 'MODEL' && c.slug === 'fake-a'
                ? ({ ...c, ...spec(provider) } as never)
                : c,
            ),
          }),
        );
        const [first] = await repo.modelCompetitors(id);
        expect(first).toMatchObject({ provider });
      }
    });

    it('violação de unicidade que não é (ciclo, competidor) NÃO vira "já existe": o erro sobe e nada fica gravado', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a] = await repo.modelCompetitors(seasonId);
      const twice = decided(cycle.id, a!.id);
      // duas linhas na mesma posição: P2002 em decision_item, e a transação desfaz a decisão
      twice.items = [twice.items[0]!, { ...twice.items[0]!, ticker: 'PETR4' }];
      await expect(repo.saveDecision(twice)).rejects.toMatchObject({ code: 'P2002' });
      expect(await prisma.decision.count()).toBe(0);
      expect(await prisma.decisionItem.count()).toBe(0);
      expect(await repo.decisionExists(cycle.id, a!.id)).toBe(false);
    });

    it('closeIfComplete fecha o ciclo quando todo MODEL tem decisão (normal ou HOLD forçado), e só então', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a, b, c] = await repo.modelCompetitors(seasonId);
      const now = new Date('2026-11-03T11:30:00Z');
      await repo.saveDecision(decided(cycle.id, a!.id));
      await expect(repo.closeIfComplete(cycle.id, now)).resolves.toBe(false);
      await repo.saveDecision(decided(cycle.id, b!.id));
      await expect(repo.closeIfComplete(cycle.id, now)).resolves.toBe(false);
      expect((await repo.cycleById(cycle.id))!.status).toBe('OPEN');
      await repo.saveDecision(
        decided(cycle.id, c!.id, {
          status: 'FORCED_HOLD',
          holdReason: 'falha',
          marketView: null,
          summary: null,
          items: [],
        }),
      );
      await expect(repo.closeIfComplete(cycle.id, now)).resolves.toBe(true);
      expect(await repo.cycleById(cycle.id)).toMatchObject({ status: 'CLOSED', closedAt: now });
      // de novo: já fechado, nada muda
      await expect(repo.closeIfComplete(cycle.id, new Date('2026-11-03T12:00:00Z'))).resolves.toBe(
        false,
      );
      expect((await repo.cycleById(cycle.id))!.closedAt).toEqual(now);
    });

    // cycle.duration (plano 5.9): da abertura (created_at) ao fechamento, no instante em que ESTA chamada fecha o ciclo
    it('closeIfComplete grava cycle.duration ao fechar, em segundos, e só então', async () => {
      const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
      const provider = new MeterProvider({
        readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 })],
      });
      metrics.setGlobalMeterProvider(provider);
      const { cycle, seasonId } = await openCycle();
      await prisma.cycle.update({
        where: { id: cycle.id },
        data: { createdAt: new Date('2026-11-03T11:00:05Z') },
      });
      const models = await repo.modelCompetitors(seasonId);
      const durations = async () => {
        await provider.forceFlush();
        const points = exporter
          .getMetrics()
          .flatMap((resource) => resource.scopeMetrics)
          .flatMap((scope) => scope.metrics)
          .filter((metric) => metric.descriptor.name === 'cycle.duration')
          .flatMap((metric) => metric.dataPoints as unknown as Point[])
          .map((point) => point.value as { count: number; sum: number });
        exporter.reset();
        return points;
      };

      await repo.saveDecision(decided(cycle.id, models[0]!.id));
      await expect(repo.closeIfComplete(cycle.id, new Date('2026-11-03T11:01:00Z'))).resolves.toBe(
        false,
      );
      expect(await durations()).toEqual([]);

      for (const model of models.slice(1)) await repo.saveDecision(decided(cycle.id, model.id));
      await expect(repo.closeIfComplete(cycle.id, new Date('2026-11-03T11:02:35Z'))).resolves.toBe(
        true,
      );
      const [closed] = await durations();
      expect(closed).toMatchObject({ count: 1, sum: 150 });

      // já fechado: a segunda chamada não fecha nada e não conta de novo
      await expect(repo.closeIfComplete(cycle.id, new Date('2026-11-03T12:00:00Z'))).resolves.toBe(
        false,
      );
      expect(await durations()).toEqual([]);
      await provider.shutdown();
    });

    it('closeIfComplete não conta o Sorteio nem as referências: só MODEL tem decisão', async () => {
      const { cycle, seasonId } = await openCycle();
      const models = await repo.modelCompetitors(seasonId);
      for (const m of models) await repo.saveDecision(decided(cycle.id, m.id));
      expect(await prisma.competitor.count({ where: { seasonId } })).toBe(7);
      await expect(repo.closeIfComplete(cycle.id, new Date())).resolves.toBe(true);
    });

    it('closeIfComplete só conta decisão de MODEL da temporada do ciclo: linha estranha não fecha o ciclo antes da hora', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a, b, c] = await repo.modelCompetitors(seasonId);
      await repo.saveDecision(decided(cycle.id, a!.id));
      await repo.saveDecision(decided(cycle.id, b!.id));
      // o banco não impede uma decisão do Sorteio, nem de um modelo de outra temporada, no mesmo ciclo
      const sorteio = await prisma.competitor.findFirstOrThrow({
        where: { seasonId, kind: 'RANDOM' },
      });
      await repo.saveDecision(decided(cycle.id, sorteio.id));
      const [foreign] = await repo.modelCompetitors(
        await repo.createSeason(file({ slug: 'outra-temporada' })),
      );
      await repo.saveDecision(decided(cycle.id, foreign!.id));
      expect(await prisma.decision.count({ where: { cycleId: cycle.id } })).toBe(4); // quatro linhas, duas valem
      await expect(repo.closeIfComplete(cycle.id, new Date())).resolves.toBe(false);
      expect((await repo.cycleById(cycle.id))!.status).toBe('OPEN');

      await repo.saveDecision(decided(cycle.id, c!.id));
      await expect(repo.closeIfComplete(cycle.id, new Date())).resolves.toBe(true);
    });

    it('competitorIdsWithoutDecision e overdueOpenCycles apoiam a varredura do ciclo vencido', async () => {
      const { cycle, seasonId } = await openCycle();
      const [a, b, c] = await repo.modelCompetitors(seasonId);
      await repo.saveDecision(decided(cycle.id, b!.id));
      expect((await repo.competitorIdsWithoutDecision(cycle.id)).sort()).toEqual(
        [a!.id, c!.id].sort(),
      );
      expect(
        (await repo.overdueOpenCycles(new Date('2026-11-03T12:29:59Z'))).map((x) => x.id),
      ).toEqual([]);
      expect(
        (await repo.overdueOpenCycles(new Date('2026-11-03T12:30:00Z'))).map((x) => x.id),
      ).toEqual([cycle.id]);
    });
  });

  describe('custo do mês (o teto do sched-cycle)', () => {
    it('soma o custo das decisões dos ciclos do mês, e só dele', async () => {
      const { cycle: november, seasonId } = await openCycle('2026-11-03');
      const [a, b] = await repo.modelCompetitors(seasonId);
      await repo.saveDecision(decided(november.id, a!.id, { costMicroUsd: 2_000_000n }));
      await repo.saveDecision(decided(november.id, b!.id, { costMicroUsd: 500_000n }));

      const october = await briefing('2026-10-30', 'd'.repeat(64));
      const pv = await repo.ensurePromptVersion(VERSION);
      const { cycle: oct } = await repo.upsertCycle({
        seasonId,
        date: '2026-10-30',
        decisionAt: new Date('2026-10-30T11:00:00Z'),
        deadlineAt: new Date('2026-10-30T12:30:00Z'),
        state: { status: 'OPEN', briefingId: october.id, promptVersionId: pv.id },
      });
      await repo.saveDecision(decided(oct.id, a!.id, { costMicroUsd: 9_000_000n }));

      expect(await repo.monthlySpendMicroUsd('2026-11-01', '2026-11-30')).toBe(2_500_000n);
      expect(await repo.monthlySpendMicroUsd('2026-10-01', '2026-10-31')).toBe(9_000_000n);
      expect(await repo.monthlySpendMicroUsd('2026-12-01', '2026-12-31')).toBe(0n);
    });
  });

  describe('seasonsInPlay: onde a liquidação mora (etapa 7)', () => {
    it('as temporadas que já começaram, em andamento ou encerradas, com os parâmetros validados; o rascunho não', async () => {
      const running = await repo.createSeason(file({ slug: 'em-andamento' }));
      await repo.startSeason(running, '2026-11-03', new Date('2026-11-01T18:00:00Z'));
      const finished = await repo.createSeason(file({ slug: 'encerrada' }));
      await repo.startSeason(finished, '2026-10-01', new Date('2026-09-30T18:00:00Z'));
      await prisma.season.update({
        where: { id: finished },
        data: { status: 'FINISHED', finishedAt: new Date('2026-10-30T21:00:00Z') },
      });
      await repo.createSeason(file({ slug: 'rascunho' }));

      const found = await repo.seasonsInPlay();
      expect(found.map((s) => [s.slug, s.status, s.startDate])).toEqual([
        ['em-andamento', 'RUNNING', '2026-11-03'],
        ['encerrada', 'FINISHED', '2026-10-01'],
      ]);
      expect(found[0]!.params.sessions).toBe(5);
    });
  });

  describe('lastPortfolio: a carteira da última liquidação antes do pregão (etapa 7)', () => {
    async function settled(
      seasonId: string,
      competitorId: string,
      date: string,
      cash: bigint,
      positions: Array<[ticker: string, quantity: bigint, cost: bigint]>,
    ) {
      await prisma.equitySnapshot.create({
        data: {
          id: newId(),
          seasonId,
          competitorId,
          date: day(date),
          cashCents: cash,
          positionsValueCents: positions.reduce((sum, [, q]) => sum + q * 100n, 0n),
          equityCents: cash + positions.reduce((sum, [, q]) => sum + q * 100n, 0n),
          interestCents: 0n,
        },
      });
      await prisma.position.createMany({
        data: positions.map(([ticker, quantity, costCents]) => ({
          id: newId(),
          seasonId,
          competitorId,
          date: day(date),
          ticker,
          quantity,
          costCents,
          markCents: 100n,
          valueCents: quantity * 100n,
          stale: false,
        })),
      });
    }

    it('devolve o caixa e as posições do último pregão liquidado ANTES da data, e nada de outro competidor', async () => {
      const seasonId = await repo.createSeason(file());
      const [a, b] = await repo.modelCompetitors(seasonId);
      await settled(seasonId, a!.id, '2026-11-03', 500_000n, [['AAA3', 10n, 11_000n]]);
      await settled(seasonId, a!.id, '2026-11-04', 400_000n, [
        ['CCC3', 5n, 5_001n],
        ['AAA3', 10n, 11_000n],
      ]);
      await settled(seasonId, b!.id, '2026-11-04', 1n, [['ZZZ3', 1n, 1n]]);

      expect(await repo.lastPortfolio(seasonId, a!.id, '2026-11-05')).toEqual({
        date: '2026-11-04',
        cashCents: 400_000n,
        positions: [
          { ticker: 'AAA3', quantity: 10n, costCents: 11_000n },
          { ticker: 'CCC3', quantity: 5n, costCents: 5_001n },
        ],
      });
      // a data da decisão não entra: o pregão de 04/11 só vale para a decisão de 05/11 em diante
      expect(await repo.lastPortfolio(seasonId, a!.id, '2026-11-04')).toMatchObject({
        date: '2026-11-03',
        cashCents: 500_000n,
      });
      expect(await repo.lastPortfolio(seasonId, a!.id, '2026-11-03')).toBeNull();
    });

    it('sem posições, o caixa sozinho; sem nenhuma liquidação, nulo', async () => {
      const seasonId = await repo.createSeason(file());
      const [a, b] = await repo.modelCompetitors(seasonId);
      await settled(seasonId, a!.id, '2026-11-03', 1_000_000n, []);
      expect(await repo.lastPortfolio(seasonId, a!.id, '2026-11-04')).toEqual({
        date: '2026-11-03',
        cashCents: 1_000_000n,
        positions: [],
      });
      expect(await repo.lastPortfolio(seasonId, b!.id, '2026-11-04')).toBeNull();
    });
  });
});
