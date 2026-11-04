import {
  isValidModelId,
  llmProviderSchema,
  seasonParamsSchema,
  type CompetitorSpec,
  type LlmProvider,
  type SeasonFile,
  type SeasonParams,
  type SeasonStatus,
} from '@alvesting/contracts';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { appendAudit, type AuditEntry } from '../../../common/audit.js';
import { newId } from '../../../common/id.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { recordCycleDuration } from '../../../telemetry/instruments.js';
import type { DecisionRecord } from '../domain/decision-record.js';

const toDate = (day: IsoDate): Date => new Date(`${day}T00:00:00Z`);
const toIso = (date: Date): IsoDate => date.toISOString().slice(0, 10);
const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// Trava consultiva de transação: solta sozinha no commit, no rollback e quando a conexão cai. A chave vira um inteiro de 64 bits. O mesmo
// molde do SettlementRepository (a liquidação trava por temporada).
const lockBy = (db: Prisma.TransactionClient, key: string) =>
  db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;

// O slug da temporada já existe (season:create duas vezes com o mesmo arquivo).
export class SeasonSlugTakenError extends Error {
  constructor(slug: string) {
    super(`Já existe uma temporada com o slug ${slug}`);
    this.name = 'SeasonSlugTakenError';
  }
}

export interface SeasonRow {
  id: string;
  slug: string;
  name: string;
  status: SeasonStatus;
  startDate: IsoDate | null;
  params: SeasonParams;
}

// A temporada como o admin a vê: o arquivo do season:create (nome, parâmetros e elenco, na ordem do elenco) mais o estado.
export interface SeasonDetail extends SeasonRow {
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  competitors: CompetitorSpec[];
}

// O que o gateway precisa do competidor MODEL: provedor, ID fixado, recursos do provedor e preços.
const competitorConfigSchema = z.object({
  capabilities: z.object({ jsonSchema: z.boolean(), reasoningEffort: z.boolean() }),
  pricingUsdPerMTok: z.object({ input: z.string(), output: z.string() }).optional(),
});

export interface CompetitorRow {
  id: string;
  seasonId: string;
  slug: string;
  name: string;
  kind: 'MODEL' | 'RANDOM' | 'BENCHMARK';
  provider: LlmProvider | null;
  modelId: string | null;
  capabilities: { jsonSchema: boolean; reasoningEffort: boolean };
  pricingUsdPerMTok?: { input: string; output: string } | undefined;
}

export interface CycleRow {
  id: string;
  seasonId: string;
  date: IsoDate;
  status: 'OPEN' | 'CLOSED' | 'SKIPPED';
  skipReason: 'sem_briefing' | 'orcamento' | null;
  decisionAt: Date;
  deadlineAt: Date;
  closedAt: Date | null;
  briefing: { id: string; sha256: string } | null;
  promptVersion: { id: string; version: string; sha256: string | null } | null;
}

// O estado em que o sched-cycle deixa o ciclo: aberto (com o briefing e o prompt fixados) ou pulado (com o motivo).
export type CycleState =
  | { status: 'OPEN'; briefingId: string; promptVersionId: string }
  | {
      status: 'SKIPPED';
      reason: 'sem_briefing' | 'orcamento';
      briefingId: string | null;
      promptVersionId: string | null;
    };

const CYCLE_INCLUDE = {
  briefing: { select: { id: true, sha256: true } },
  promptVersion: { select: { id: true, version: true, sha256: true } },
} as const;

type CycleWithRelations = Prisma.CycleGetPayload<{ include: typeof CYCLE_INCLUDE }>;

const toCycle = (row: CycleWithRelations): CycleRow => ({
  id: row.id,
  seasonId: row.seasonId,
  date: toIso(row.date),
  status: row.status,
  skipReason: row.skipReason as CycleRow['skipReason'],
  decisionAt: row.decisionAt,
  deadlineAt: row.deadlineAt,
  closedAt: row.closedAt,
  briefing: row.briefing,
  promptVersion: row.promptVersion,
});

function toSeason(row: {
  id: string;
  slug: string;
  name: string;
  status: SeasonStatus;
  startDate: Date | null;
  params: Prisma.JsonValue;
}): SeasonRow {
  const params = seasonParamsSchema.safeParse(row.params);
  // nunca seguir com um padrão no lugar de um parâmetro que o banco guardou torto
  if (!params.success) throw new Error(`Parâmetros da temporada ${row.slug} inválidos no banco`);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    startDate: row.startDate ? toIso(row.startDate) : null,
    params: params.data,
  };
}

function toSeasonDetail(
  row: Parameters<typeof toSeason>[0] & {
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    competitors: Array<Parameters<typeof toSpec>[0]>;
  },
): SeasonDetail {
  return {
    ...toSeason(row),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    competitors: row.competitors.map(toSpec),
  };
}

function toCompetitor(row: {
  id: string;
  seasonId: string;
  slug: string;
  name: string;
  kind: CompetitorRow['kind'];
  provider: string | null;
  modelId: string | null;
  config: Prisma.JsonValue;
}): CompetitorRow {
  const config = competitorConfigSchema.safeParse(
    row.config ?? {
      capabilities: { jsonSchema: false, reasoningEffort: false },
    },
  );
  if (!config.success) throw new Error(`Configuração do competidor ${row.slug} inválida no banco`);
  return {
    id: row.id,
    seasonId: row.seasonId,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    provider: row.provider === null ? null : llmProviderSchema.parse(row.provider),
    modelId: row.modelId,
    capabilities: config.data.capabilities,
    pricingUsdPerMTok: config.data.pricingUsdPerMTok,
  };
}

// O elenco de volta ao formato do arquivo da temporada (o inverso do que createSeason grava): é o que o admin vê e devolve para editar.
function toSpec(row: {
  slug: string;
  name: string;
  kind: CompetitorRow['kind'];
  provider: string | null;
  modelId: string | null;
  benchmark: 'EQUAL_WEIGHT' | 'CDI' | 'BOVA11' | null;
  config: Prisma.JsonValue;
}): CompetitorSpec {
  const { slug, name } = row;
  if (row.kind === 'RANDOM') return { kind: 'RANDOM', slug, name };
  if (row.kind === 'BENCHMARK') {
    if (!row.benchmark) throw new Error(`Referência ${slug} sem o tipo no banco`);
    return { kind: 'BENCHMARK', slug, name, benchmark: row.benchmark };
  }
  const config = competitorConfigSchema.safeParse(
    row.config ?? { capabilities: { jsonSchema: false, reasoningEffort: false } },
  );
  if (!config.success) throw new Error(`Configuração do competidor ${slug} inválida no banco`);
  if (row.modelId === null) throw new Error(`Modelo ${slug} sem o ID do modelo no banco`);
  return {
    kind: 'MODEL',
    slug,
    name,
    provider: llmProviderSchema.parse(row.provider),
    modelId: row.modelId,
    capabilities: config.data.capabilities,
    ...(config.data.pricingUsdPerMTok ? { pricingUsdPerMTok: config.data.pricingUsdPerMTok } : {}),
  };
}

// As linhas de `competitor` de um arquivo de temporada, na ordem do elenco.
const competitorRows = (seasonId: string, file: SeasonFile) =>
  file.competitors.map((competitor, position) => ({
    id: newId(),
    seasonId,
    slug: competitor.slug,
    name: competitor.name,
    kind: competitor.kind,
    position,
    ...(competitor.kind === 'MODEL'
      ? {
          provider: competitor.provider,
          modelId: competitor.modelId,
          config: {
            capabilities: competitor.capabilities,
            ...(competitor.pricingUsdPerMTok
              ? { pricingUsdPerMTok: competitor.pricingUsdPerMTok }
              : {}),
          },
        }
      : {}),
    ...(competitor.kind === 'BENCHMARK' ? { benchmark: competitor.benchmark } : {}),
  }));

const stateData = (state: CycleState) => ({
  status: state.status,
  skipReason: state.status === 'SKIPPED' ? state.reason : null,
  briefingId: state.briefingId,
  promptVersionId: state.promptVersionId,
});

// Acesso ao banco da arena: temporada, elenco, ciclo e decisão. Só persistência e as regras de integridade que dependem
// do banco (unicidade, comparação e troca atômicas); as regras de negócio ficam nos handlers.
@Injectable()
export class ArenaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- temporada e elenco ---------------------------------------------------------------------------------------

  // `audit`: a linha de audit_log (alvo: o id da temporada) vai na mesma transação. O comando season:create e o ensaio não passam.
  async createSeason(file: SeasonFile, audit?: AuditEntry): Promise<string> {
    const id = newId();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.season.create({
          data: { id, slug: file.slug, name: file.name, params: file.params },
        });
        await tx.competitor.createMany({ data: competitorRows(id, file) });
        if (audit) await appendAudit(tx, audit, id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new SeasonSlugTakenError(file.slug);
      throw error;
    }
    return id;
  }

  async seasonById(id: string): Promise<SeasonRow | null> {
    const row = await this.prisma.season.findUnique({ where: { id } });
    return row ? toSeason(row) : null;
  }

  // DRAFT -> RUNNING com a data de início. A condição no WHERE é a trava: só um season:start vence a mesma temporada.
  // `options.exclusive` (as rotas /admin; o comando season:start não passa) recusa com 'running_exists' se OUTRA temporada está em
  // andamento (docs/ARENA.md, seção 10: duas, com regras diferentes, derrubam o `freeze` todo dia). A conferência e o UPDATE são um passo
  // só, sob a trava consultiva `season:start` desta transação: o WHERE vale por linha e dois rascunhos são duas linhas, então sem a
  // trava dois inícios juntos liam "nenhuma em andamento" os dois e iniciavam os dois. Todo início toma a trava, com ou sem a opção, para o
  // exclusivo enxergar o que um comando acabou de iniciar. `audit` vai na mesma transação e só se a temporada começou.
  async startSeason(
    id: string,
    startDate: IsoDate,
    now: Date,
    audit?: AuditEntry,
    options: { exclusive?: boolean } = {},
  ): Promise<'started' | 'not_found' | 'not_draft' | 'running_exists'> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await lockBy(tx, 'season:start');
      if (options.exclusive) {
        const others = await tx.season.count({ where: { status: 'RUNNING', id: { not: id } } });
        if (others > 0) return 'running_exists' as const;
      }
      const result = await tx.season.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'RUNNING', startDate: toDate(startDate), startedAt: now },
      });
      if (result.count !== 1) return 'not_updated' as const;
      if (audit) await appendAudit(tx, audit, id);
      return 'started' as const;
    });
    if (outcome !== 'not_updated') return outcome;
    const exists = await this.prisma.season.findUnique({ where: { id }, select: { id: true } });
    return exists ? 'not_draft' : 'not_found';
  }

  // Edita o RASCUNHO e só ele: troca o nome, os parâmetros e o elenco inteiro (o `file` é o conjunto já validado, com o slug que a
  // temporada tem). Temporada em andamento ou encerrada não muda: regras, elenco e prompt ficam fixos (docs/ARENA.md). O UPDATE
  // condicional trava a linha: um season:start que chegue junto espera esta transação e, depois dela, começa com o elenco novo; um que
  // chegue antes faz esta devolver 'not_draft'. O rascunho não tem ciclo nem decisão, então trocar as linhas do elenco não esbarra em chave.
  async replaceDraft(
    id: string,
    file: SeasonFile,
    audit?: AuditEntry,
  ): Promise<'updated' | 'not_found' | 'not_draft'> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.season.findUnique({ where: { id }, select: { slug: true } });
      if (current && current.slug !== file.slug) {
        throw new Error('O slug da temporada não muda: o arquivo novo tem outro slug');
      }
      const result = await tx.season.updateMany({
        where: { id, status: 'DRAFT' },
        data: { name: file.name, params: file.params },
      });
      if (result.count !== 1) return false;
      await tx.competitor.deleteMany({ where: { seasonId: id } });
      await tx.competitor.createMany({ data: competitorRows(id, file) });
      if (audit) await appendAudit(tx, audit, id);
      return true;
    });
    if (updated) return 'updated';
    const exists = await this.prisma.season.findUnique({ where: { id }, select: { id: true } });
    return exists ? 'not_draft' : 'not_found';
  }

  // Todas as temporadas, rascunho inclusive (a API pública esconde o rascunho), da mais nova para a mais antiga, com o elenco na ordem.
  async listSeasons(): Promise<SeasonDetail[]> {
    const rows = await this.prisma.season.findMany({
      orderBy: { id: 'desc' },
      include: { competitors: { orderBy: { position: 'asc' } } },
    });
    return rows.map(toSeasonDetail);
  }

  async seasonDetail(id: string): Promise<SeasonDetail | null> {
    const row = await this.prisma.season.findUnique({
      where: { id },
      include: { competitors: { orderBy: { position: 'asc' } } },
    });
    return row ? toSeasonDetail(row) : null;
  }

  // As temporadas que já começaram, em andamento ou encerradas: onde mora a liquidação (etapa 7). A encerrada entra porque as
  // pregão dela pode ser liquidado de novo depois (um evento corporativo registrado, ou a correção do dado pelo admin) e o resultado final se refaz.
  async seasonsInPlay(): Promise<SeasonRow[]> {
    const rows = await this.prisma.season.findMany({
      where: { status: { in: ['RUNNING', 'FINISHED'] }, startDate: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSeason);
  }

  async runningSeasons(): Promise<SeasonRow[]> {
    const rows = await this.prisma.season.findMany({
      where: { status: 'RUNNING' },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSeason);
  }

  async modelCompetitors(seasonId: string): Promise<CompetitorRow[]> {
    const rows = await this.prisma.competitor.findMany({
      where: { seasonId, kind: 'MODEL' },
      orderBy: { position: 'asc' },
    });
    return rows.map(toCompetitor);
  }

  // É por aqui que o job de decisões chega ao modelo que vai chamar (e pagar). O ID do modelo é conferido de novo, contra a mesma regra do
  // arquivo da temporada, porque o CHECK da tabela não tem o regex: uma linha escrita por fora do contrato (`:online`, `openrouter/auto`)
  // não chega ao provedor. Falha fechado e só para este competidor: o erro sobe, a última entrega não consegue gravar o HOLD e a mensagem
  // vai para a DLQ, que alerta; os outros competidores seguem. `modelCompetitors` (o agendador) não confere: ele só lista quem recebe a mensagem.
  async competitorById(id: string): Promise<CompetitorRow | null> {
    const row = await this.prisma.competitor.findUnique({ where: { id } });
    if (!row) return null;
    const competitor = toCompetitor(row);
    if (
      competitor.kind === 'MODEL' &&
      !(
        competitor.provider !== null &&
        competitor.modelId !== null &&
        isValidModelId(competitor.provider, competitor.modelId)
      )
    ) {
      throw new Error(`ID de modelo do competidor ${competitor.slug} inválido no banco`);
    }
    return competitor;
  }

  // --- prompt_version -------------------------------------------------------------------------------------------

  // A versão nasce sem SHA-256: quem a fixa no ciclo (o sched-cycle) não lê o texto do prompt.
  async ensurePromptVersion(
    version: string,
  ): Promise<{ id: string; version: string; sha256: string | null }> {
    await this.prisma.promptVersion.createMany({
      data: [{ id: newId(), version }],
      skipDuplicates: true,
    });
    const row = await this.prisma.promptVersion.findUniqueOrThrow({ where: { version } });
    return { id: row.id, version: row.version, sha256: row.sha256 };
  }

  // Registra o SHA-256 só se ainda não há um (o UPDATE condicional é a trava) e devolve o que ficou registrado: o desta
  // execução, ou o que uma anterior já tinha gravado. Quem recebe um valor diferente do seu tem o texto errado.
  async registerPromptSha256(id: string, sha256: string, now: Date): Promise<string> {
    await this.prisma.promptVersion.updateMany({
      where: { id, sha256: null },
      data: { sha256, registeredAt: now },
    });
    const row = await this.prisma.promptVersion.findUniqueOrThrow({ where: { id } });
    return row.sha256!;
  }

  // --- carteira (as linhas que a liquidação da etapa 7 grava) ---------------------------------------------------

  // A carteira do competidor no fechamento do último pregão liquidado ANTES de `before`: o caixa e as posições (quantidade e custo
  // total, de onde sai o preço médio). Nulo se a temporada ainda não liquidou nada antes dessa data (o primeiro pregão). Uma
  // consulta só: o caixa e as posições são do mesmo instante, mesmo que uma reliquidação troque as linhas no meio.
  async lastPortfolio(
    seasonId: string,
    competitorId: string,
    before: IsoDate,
  ): Promise<{
    date: IsoDate;
    cashCents: bigint;
    positions: Array<{ ticker: string; quantity: bigint; costCents: bigint }>;
  } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        date: Date;
        cash: bigint;
        ticker: string | null;
        quantity: bigint | null;
        cost: bigint | null;
      }>
    >`
      SELECT e.date, e.cash_cents AS cash, p.ticker, p.quantity, p.cost_cents AS cost
      FROM (
        SELECT date, cash_cents FROM equity_snapshot
        WHERE season_id = ${seasonId} AND competitor_id = ${competitorId} AND date < ${before}::date
        ORDER BY date DESC LIMIT 1
      ) e
      LEFT JOIN position p ON p.competitor_id = ${competitorId} AND p.date = e.date
      ORDER BY p.ticker`;
    const first = rows[0];
    if (!first) return null;
    return {
      date: toIso(first.date),
      cashCents: first.cash,
      positions: rows.flatMap((row) =>
        row.ticker === null || row.quantity === null || row.cost === null
          ? []
          : [{ ticker: row.ticker, quantity: row.quantity, costCents: row.cost }],
      ),
    };
  }

  // --- briefing e ciclo -----------------------------------------------------------------------------------------

  async findBriefing(date: IsoDate): Promise<{ id: string; sha256: string } | null> {
    return this.prisma.briefing.findUnique({
      where: { date: toDate(date) },
      select: { id: true, sha256: true },
    });
  }

  // Um ciclo por temporada e pregão, idempotente: repetir devolve o que já existe. Aberto e fechado não mudam (as mensagens
  // já saíram); o pulado é reavaliado, porque o briefing pode ter chegado e o orçamento pode ter mudado.
  async upsertCycle(input: {
    seasonId: string;
    date: IsoDate;
    decisionAt: Date;
    deadlineAt: Date;
    state: CycleState;
  }): Promise<{ cycle: CycleRow; created: boolean }> {
    const where = { seasonId_date: { seasonId: input.seasonId, date: toDate(input.date) } };
    const existing = await this.prisma.cycle.findUnique({ where });
    if (!existing) {
      try {
        const row = await this.prisma.cycle.create({
          data: {
            id: newId(),
            seasonId: input.seasonId,
            date: toDate(input.date),
            decisionAt: input.decisionAt,
            deadlineAt: input.deadlineAt,
            ...stateData(input.state),
          },
          include: CYCLE_INCLUDE,
        });
        return { cycle: toCycle(row), created: true };
      } catch (error) {
        // corrida: outra execução do agendador criou o ciclo entre a leitura e a gravação
        if (!isUniqueViolation(error)) throw error;
      }
    } else if (existing.status === 'SKIPPED') {
      await this.prisma.cycle.updateMany({
        where: { id: existing.id, status: 'SKIPPED' },
        data: stateData(input.state),
      });
    }
    const row = await this.prisma.cycle.findUniqueOrThrow({ where, include: CYCLE_INCLUDE });
    return { cycle: toCycle(row), created: false };
  }

  async cycleById(id: string): Promise<CycleRow | null> {
    const row = await this.prisma.cycle.findUnique({ where: { id }, include: CYCLE_INCLUDE });
    return row ? toCycle(row) : null;
  }

  // Ciclos ainda abertos cujo prazo já passou até `cutoff` (a varredura que fecha o que a fila não fechou).
  async overdueOpenCycles(cutoff: Date): Promise<CycleRow[]> {
    const rows = await this.prisma.cycle.findMany({
      where: { status: 'OPEN', deadlineAt: { lte: cutoff } },
      include: CYCLE_INCLUDE,
      orderBy: { date: 'asc' },
    });
    return rows.map(toCycle);
  }

  // O custo das decisões dos ciclos entre as duas datas (inclusive), em micro-dólares: o que o teto do mês compara.
  async monthlySpendMicroUsd(from: IsoDate, to: IsoDate): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(d.cost_micro_usd), 0)::bigint AS total
      FROM decision d JOIN cycle c ON c.id = d.cycle_id
      WHERE c.date >= ${from}::date AND c.date <= ${to}::date`;
    return rows[0]?.total ?? 0n;
  }

  // --- decisão --------------------------------------------------------------------------------------------------

  async decisionExists(cycleId: string, competitorId: string): Promise<boolean> {
    return (await this.prisma.decision.count({ where: { cycleId, competitorId } })) > 0;
  }

  // 'exists': já há decisão deste competidor neste ciclo (execução duplicada); a primeira vale.
  async saveDecision(record: DecisionRecord): Promise<'created' | 'exists'> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const decision = await tx.decision.create({
          data: {
            id: newId(),
            cycleId: record.cycleId,
            competitorId: record.competitorId,
            status: record.status,
            holdReason: record.holdReason,
            marketView: record.marketView,
            summary: record.summary,
            usage: record.usage ?? undefined,
            costMicroUsd: record.costMicroUsd,
            applied: (record.applied as Prisma.InputJsonObject | null) ?? undefined,
            inputSha256: record.inputSha256,
            outputSha256: record.outputSha256,
            metaSha256: record.metaSha256,
            ioUris: record.ioUris ?? undefined,
            leakFields: record.leakFields,
          },
        });
        if (record.items.length > 0) {
          await tx.decisionItem.createMany({
            data: record.items.map((item) => ({
              id: newId(),
              decisionId: decision.id,
              position: item.position,
              action: item.action,
              ticker: item.ticker,
              percent: item.percent,
              confidence: item.confidence,
              rationale: item.rationale,
              dropped: item.dropped,
              dropReason: item.dropReason,
              dropDetail: item.dropDetail,
            })),
          });
        }
      });
      return 'created';
    } catch (error) {
      // Só a unicidade (ciclo, competidor) é "já existe". Outra violação (a posição de um item, uma colisão de chave) é um bug
      // e desfaz a transação inteira: reportá-la como "já existe" faria a decisão sumir sem erro, e a varredura a gravaria depois
      // como HOLD "sem_resposta".
      if (
        isUniqueViolation(error) &&
        (await this.decisionExists(record.cycleId, record.competitorId))
      ) {
        return 'exists';
      }
      throw error;
    }
  }

  // Fecha o ciclo quando todo competidor MODEL da temporada tem decisão (normal ou HOLD forçado). Um UPDATE só, condicional:
  // duas execuções que terminam juntas não se atropelam, e a que commita por último vê todas as decisões. Conta só a decisão de
  // MODEL da temporada do ciclo: uma linha estranha (o banco não a impede) não fecha o ciclo antes da hora. Devolve se fechou. Quem
  // fecha mede a métrica cycle.duration (da abertura, created_at, ao fechamento; plano 5.9): o UPDATE devolve a abertura.
  async closeIfComplete(cycleId: string, now: Date): Promise<boolean> {
    const closed = await this.prisma.$queryRaw<Array<{ created_at: Date }>>`
      UPDATE cycle SET status = 'CLOSED', closed_at = ${now}
      WHERE id = ${cycleId} AND status = 'OPEN'
        AND (SELECT count(*) FROM decision d JOIN competitor dc ON dc.id = d.competitor_id
              WHERE d.cycle_id = cycle.id AND dc.kind = 'MODEL' AND dc.season_id = cycle.season_id)
          >= (SELECT count(*) FROM competitor c WHERE c.season_id = cycle.season_id AND c.kind = 'MODEL')
      RETURNING created_at`;
    const [row] = closed;
    if (row) recordCycleDuration(row.created_at, now);
    return closed.length === 1;
  }

  async competitorIdsWithoutDecision(cycleId: string): Promise<string[]> {
    const rows = await this.prisma.competitor.findMany({
      where: {
        kind: 'MODEL',
        season: { cycles: { some: { id: cycleId } } },
        decisions: { none: { cycleId } },
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}
