import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_DLQ_LISTED,
  ADMIN_TEXT_MAX,
  JOB_STATUSES,
  QUEUES,
  adminCostsSchema,
  adminJobsSchema,
  dlqMessageIdSchema,
  type AdminCosts,
  type AdminJobs,
  type QueueName,
} from '@alvesting/contracts';
import { redactPii } from '../../../common/redact.js';
import { ENV, type Env } from '../../../config/env.js';
import { redactText } from '../../../telemetry/sanitize.js';
import { parseUsdToMicro } from '../../arena/domain/cost.js';
import { ArenaRepository } from '../../arena/infrastructure/arena.repository.js';
import { brasiliaDate, monthBounds } from '../../market-data/domain/dates.js';
import {
  MessagingService,
  type DeadLetter,
} from '../../messaging/infrastructure/messaging.service.js';
import { safeNumber } from '../../settlement/domain/money.js';
import { ADMIN_CLOCK, type AdminClock } from '../admin.tokens.js';
import { AdminRepository, type JobRow } from '../infrastructure/admin.repository.js';

// Quanto esperar o Service Bus responder ao ler uma DLQ. Sem prazo, um broker fora do ar prenderia a página inteira do painel.
export const DLQ_READ_TIMEOUT_MS = 5_000;
// Quantos job_run FAILED o painel lista.
const FAILURES_LISTED = 10;

// O motivo da falha como o painel o mostra: sem e-mail, IP, token nem query de URL (redactText) e cortado. O job_run guarda o texto bruto.
const reason = (error: string | null): string | null =>
  error === null ? null : redactText(error).slice(0, ADMIN_TEXT_MAX.error);

const toRun = (row: JobRow) => ({
  key: row.key,
  status: row.status,
  attempts: row.attempts,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt?.toISOString() ?? null,
  error: reason(row.error),
});

// Só o que o painel precisa de uma mensagem da DLQ, e nunca o corpo dela (a mensagem é nossa, mas uma inválida pode ser de qualquer
// ferramenta). O MessageId, a descrição e o motivo vêm do broker ou do nosso código e passam pela mesma limpeza. O MessageId só é
// reenviável se saiu da limpeza igual ao que veio (o botão de reenvio manda o id mostrado) e tem a forma que a rota de reenvio aceita: o
// de uma mensagem posta por outra ferramenta pode ter qualquer forma, e o painel então a lista sem o botão (que responderia 400).
export const toDeadLetter = (message: DeadLetter) => {
  const messageId = redactText(message.messageId).slice(0, ADMIN_TEXT_MAX.messageId);
  return {
    messageId,
    resubmittable:
      messageId === message.messageId && dlqMessageIdSchema.safeParse(messageId).success,
    deliveryCount: message.deliveryCount,
    reason:
      message.reason === undefined
        ? null
        : redactText(message.reason).slice(0, ADMIN_TEXT_MAX.reason),
    description:
      message.description === undefined
        ? null
        : redactText(message.description).slice(0, ADMIN_TEXT_MAX.description),
    enqueuedAt: message.enqueuedAt?.toISOString() ?? null,
  };
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('tempo esgotado ao ler a DLQ')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// As leituras do painel: GET /admin/costs e GET /admin/jobs (docs/API.md, seção 8).
@Injectable()
export class AdminReportsService {
  private readonly logger = new Logger(AdminReportsService.name);

  constructor(
    private readonly repo: AdminRepository,
    private readonly arena: ArenaRepository,
    private readonly messaging: MessagingService,
    @Inject(ENV) private readonly env: Env,
    @Inject(ADMIN_CLOCK) private readonly clock: AdminClock,
  ) {}

  // O gasto do mês de Brasília contra o teto. O acumulado é a soma que o sched-cycle compara com o teto (mesma função, mesmo intervalo).
  async costs(): Promise<AdminCosts> {
    const today = brasiliaDate(this.clock());
    const { first, last } = monthBounds(today);
    const [spent, rows] = await Promise.all([
      this.arena.monthlySpendMicroUsd(first, last),
      this.repo.costRows(first, last),
    ]);
    const cap = this.env.ARENA_MONTHLY_COST_CAP_USD;
    return adminCostsSchema.parse({
      month: today.slice(0, 7),
      capMicroUsd: cap === undefined ? null : safeNumber(parseUsdToMicro(cap)),
      spentMicroUsd: safeNumber(spent),
      rows,
    });
  }

  async jobs(): Promise<AdminJobs> {
    const queues = Object.keys(QUEUES) as QueueName[];
    const [latest, counts, failures, fetchStates, deadLetters] = await Promise.all([
      this.repo.latestJobs(),
      this.repo.jobCounts(),
      this.repo.recentFailures(FAILURES_LISTED),
      this.repo.fetchStates(),
      Promise.all(queues.map((queue) => this.deadLetters(queue))),
    ]);
    return adminJobsSchema.parse({
      jobs: latest.map((row) => ({
        type: row.type,
        queue: row.queue,
        counts: Object.fromEntries(
          JOB_STATUSES.map((status) => [
            status,
            counts.find((c) => c.type === row.type && c.status === status)?.count ?? 0,
          ]),
        ),
        latest: toRun(row),
      })),
      failures: failures.map((row) => ({ type: row.type, queue: row.queue, ...toRun(row) })),
      fetchStates: fetchStates.map((state) => ({
        source: state.source,
        checkedAt: state.checkedAt.toISOString(),
      })),
      queues: queues.map((queue, index) => ({ queue, deadLetters: deadLetters[index] })),
    });
  }

  // A DLQ de uma fila, lida por peek com o papel de Receiver que a identidade da api já tem (infra/modules/servicebus.bicep): conta no
  // máximo ADMIN_DLQ_LISTED. Contar de verdade pede a API de administração do Service Bus, que exige o papel de dono; a resposta não pede
  // esse papel. Se não deu para ler (sem cliente, sem permissão, broker fora, prazo), a fila sai "unavailable" e o motivo vai só ao log.
  private async deadLetters(queue: QueueName) {
    try {
      const messages = await withTimeout(
        this.messaging.readDeadLetters(queue, ADMIN_DLQ_LISTED),
        DLQ_READ_TIMEOUT_MS,
      );
      return {
        status: 'ok' as const,
        count: messages.length,
        capped: messages.length >= ADMIN_DLQ_LISTED,
        messages: messages.map(toDeadLetter),
      };
    } catch (error) {
      this.logger.warn(
        { queue },
        redactPii(String(error instanceof Error ? error.message : error)),
      );
      return { status: 'unavailable' as const };
    }
  }
}
