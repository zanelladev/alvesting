import { Injectable } from '@nestjs/common';
import type { JobStatus } from '@alvesting/contracts';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { safeNumber } from '../../settlement/domain/money.js';

export interface CostRow {
  date: IsoDate;
  season: string;
  competitor: string;
  name: string;
  costMicroUsd: number;
}

export interface JobRow {
  type: string;
  queue: string;
  key: string;
  status: JobStatus;
  attempts: number;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

// As leituras do painel de admin (etapa 10, parte 2; docs/API.md, seção 8). Só consultas, com as colunas listadas; o que o painel
// mostra de job_run e de fetch_state nunca é público (docs/API.md, seção 3), e o texto do erro passa por redact antes de sair (o
// serviço). A temporada e o elenco (edição do rascunho) moram no ArenaRepository.
@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  // O custo das decisões dos ciclos entre as duas datas (inclusive), por dia e por competidor, do dia mais novo ao mais antigo. A mesma
  // junção que o teto do mês soma (ArenaRepository.monthlySpendMicroUsd), então a soma das linhas é o acumulado. Competidor sem custo
  // (os fakes) entra com zero: o painel mostra quem decidiu, não só quem gastou.
  async costRows(from: IsoDate, to: IsoDate): Promise<CostRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ date: Date; season: string; competitor: string; name: string; cost: bigint }>
    >`
      SELECT c.date AS date, s.slug AS season, comp.slug AS competitor, comp.name AS name,
             SUM(d.cost_micro_usd)::bigint AS cost
      FROM decision d
      JOIN cycle c ON c.id = d.cycle_id
      JOIN competitor comp ON comp.id = d.competitor_id
      JOIN season s ON s.id = c.season_id
      WHERE c.date >= ${from}::date AND c.date <= ${to}::date
      GROUP BY c.date, s.slug, comp.slug, comp.name
      ORDER BY c.date DESC, s.slug, comp.slug`;
    return rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      season: row.season,
      competitor: row.competitor,
      name: row.name,
      costMicroUsd: safeNumber(row.cost),
    }));
  }

  // O job_run mais recente de cada tipo (DISTINCT ON, uma passada pelo índice único (type, idempotency_key)).
  async latestJobs(): Promise<JobRow[]> {
    const rows = await this.prisma.$queryRaw<RawJob[]>`
      SELECT DISTINCT ON (type) type, queue, idempotency_key, status::text AS status, attempts, started_at, finished_at, error
      FROM job_run ORDER BY type, started_at DESC`;
    return rows.map(toJob);
  }

  // Quantos job_run há em cada tipo e estado (a tabela cresce uns 290 por dia com o `fetch`, até a retenção da fila maintenance).
  async jobCounts(): Promise<Array<{ type: string; status: JobRow['status']; count: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ type: string; status: string; count: number }>
    >`
      SELECT type, status::text AS status, count(*)::int AS count FROM job_run GROUP BY type, status`;
    return rows.map((row) => ({ ...row, status: row.status as JobRow['status'] }));
  }

  // Os FAILED mais recentes, de qualquer tipo. O WAITING (o eod que espera o arquivo do pregão) não é falha.
  async recentFailures(limit: number): Promise<JobRow[]> {
    const rows = await this.prisma.$queryRaw<RawJob[]>`
      SELECT type, queue, idempotency_key, status::text AS status, attempts, started_at, finished_at, error
      FROM job_run WHERE status = 'FAILED' ORDER BY started_at DESC, id DESC LIMIT ${limit}`;
    return rows.map(toJob);
  }

  // A última conferência de cada arquivo da CVM. A etag e o Last-Modified ficam no banco: não saem.
  async fetchStates(): Promise<Array<{ source: string; checkedAt: Date }>> {
    return this.prisma.fetchState.findMany({
      select: { source: true, checkedAt: true },
      orderBy: { source: 'asc' },
    });
  }
}

interface RawJob {
  type: string;
  queue: string;
  idempotency_key: string;
  status: string;
  attempts: number;
  started_at: Date;
  finished_at: Date | null;
  error: string | null;
}

const toJob = (row: RawJob): JobRow => ({
  type: row.type,
  queue: row.queue,
  key: row.idempotency_key,
  status: row.status as JobRow['status'],
  attempts: row.attempts,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  error: row.error,
});
