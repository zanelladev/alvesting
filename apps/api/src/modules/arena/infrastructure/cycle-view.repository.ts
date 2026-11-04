import { cycleViewSchema, ulidSchema, type CycleView } from '@alvesting/contracts';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { IsoDate } from '../../market-data/domain/dates.js';

// As colunas que a API pública lê de uma temporada (nenhuma é segredo; `params` é público por desenho, as sementes inclusive).
export const PUBLIC_SEASON_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  startDate: true,
  startedAt: true,
  finishedAt: true,
  params: true,
} as const;

// A temporada que a API pública mostra: em andamento ou encerrada, nunca a rascunho (o elenco de uma temporada que ainda não
// começou não é público). `ref` é o ULID ou o slug. Sem `ref`, a atual: a que está em andamento (a que começou por último, se
// houver mais de uma) ou, não havendo, a última encerrada. É o que `/arena/current`, `/cycles/:date` e o resto da API pública usam
// para dizer "a temporada".
export async function findPublicSeason(prisma: PrismaService, ref?: string) {
  if (ref !== undefined) {
    return prisma.season.findFirst({
      where: {
        status: { in: ['RUNNING', 'FINISHED'] },
        ...(ulidSchema.safeParse(ref).success ? { id: ref } : { slug: ref }),
      },
      select: PUBLIC_SEASON_SELECT,
    });
  }
  const running = await prisma.season.findFirst({
    where: { status: 'RUNNING' },
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    select: PUBLIC_SEASON_SELECT,
  });
  return (
    running ??
    prisma.season.findFirst({
      where: { status: 'FINISHED' },
      orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
      select: PUBLIC_SEASON_SELECT,
    })
  );
}

// A leitura PÚBLICA de um ciclo (GET /api/v1/cycles/:id, que aceita a data do pregão ou o ULID, e o comando cycle:show). Monta o formato explícito do contrato e o
// valida (schema estrito): o que não está no contrato não sai, mesmo que alguém acrescente uma coluna. Nunca devolve o prompt,
// o IO bruto nem os endereços do Blob (briefing.uri e decision.io_uris ficam no banco). O texto de um item descartado também
// não: só a posição e o motivo.
@Injectable()
export class CycleViewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(id: string): Promise<CycleView | null> {
    // Colunas listadas, nunca a linha inteira: o endereço do Blob (briefing.uri, decision.io_uris), o SHA-256 dos metadados e a lista
    // do filtro de vazamento ficam no banco e nem são lidos.
    const row = await this.prisma.cycle.findUnique({
      where: { id },
      select: {
        id: true,
        seasonId: true,
        date: true,
        status: true,
        skipReason: true,
        decisionAt: true,
        deadlineAt: true,
        closedAt: true,
        briefing: { select: { sha256: true } },
        promptVersion: { select: { version: true, sha256: true } },
        decisions: {
          orderBy: { competitor: { position: 'asc' } },
          select: {
            status: true,
            holdReason: true,
            marketView: true,
            summary: true,
            inputSha256: true,
            outputSha256: true,
            costMicroUsd: true,
            usage: true,
            applied: true,
            competitor: { select: { id: true, slug: true, name: true } },
            items: {
              orderBy: { position: 'asc' },
              select: {
                position: true,
                action: true,
                ticker: true,
                percent: true,
                confidence: true,
                rationale: true,
                dropped: true,
                dropReason: true,
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    return cycleViewSchema.parse({
      id: row.id,
      seasonId: row.seasonId,
      date: row.date.toISOString().slice(0, 10),
      status: row.status,
      skipReason: row.skipReason,
      decisionAt: row.decisionAt.toISOString(),
      deadlineAt: row.deadlineAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      prompt: row.promptVersion
        ? { version: row.promptVersion.version, sha256: row.promptVersion.sha256 }
        : null,
      briefing: row.briefing ? { sha256: row.briefing.sha256 } : null,
      decisions: row.decisions.map((decision) => ({
        competitor: decision.competitor,
        status: decision.status,
        holdReason: decision.holdReason,
        marketView: decision.marketView,
        summary: decision.summary,
        inputSha256: decision.inputSha256,
        outputSha256: decision.outputSha256,
        // micro-dólares: inteiro seguro até US$ 9 bilhões
        costMicroUsd: Number(decision.costMicroUsd),
        usage: decision.usage,
        applied: decision.applied,
        items: decision.items
          .filter((item) => !item.dropped)
          .map((item) => ({
            position: item.position,
            action: item.action,
            ticker: item.ticker,
            percent: item.percent?.toNumber() ?? null,
            confidence: item.confidence?.toNumber() ?? null,
            rationale: item.rationale,
          })),
        dropped: decision.items
          .filter((item) => item.dropped)
          .map((item) => ({ position: item.position, reason: item.dropReason })),
      })),
    });
  }

  // O ciclo de um pregão na temporada pública (a atual ou a de `seasonRef`). Mesma montagem de `find`: uma lógica só.
  async findByDate(date: IsoDate, seasonRef?: string): Promise<CycleView | null> {
    const season = await findPublicSeason(this.prisma, seasonRef);
    if (!season) return null;
    const cycle = await this.prisma.cycle.findUnique({
      where: { seasonId_date: { seasonId: season.id, date: new Date(`${date}T00:00:00Z`) } },
      select: { id: true },
    });
    return cycle ? this.find(cycle.id) : null;
  }

  // Os ciclos de um pregão (um por temporada), opcionalmente de uma temporada só. Para o comando cycle:show.
  async idsByDate(date: IsoDate, seasonSlug?: string): Promise<string[]> {
    const rows = await this.prisma.cycle.findMany({
      where: {
        date: new Date(`${date}T00:00:00Z`),
        ...(seasonSlug ? { season: { slug: seasonSlug } } : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }
}
