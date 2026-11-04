import { Injectable, Logger } from '@nestjs/common';
import {
  QUEUES,
  idempotencyKey,
  messageId,
  queueFor,
  type QueueMessage,
} from '@alvesting/contracts';
import { newId } from '../../../common/id.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { redactText } from '../../../telemetry/sanitize.js';

// A idempotência das filas (plano 5.5): uma linha de job_run por mensagem, com (type, idempotency_key) único.
// O Basic do Service Bus não detecta duplicata, então quem barra a mensagem repetida é esta linha. Todo handler
// começa por claim() e termina por succeed() ou fail().
export interface JobClaim {
  id: string;
  attempt: number;
  // de que mensagem é a linha (fila, tipo e chave natural): vai na linha de log do alerta de job falho. O claim() sempre preenche;
  // quem monta um JobClaim à mão (os testes dos handlers) pode omitir
  label?: { queue: string; type: string; key: string };
}

export type ClaimResult =
  | { status: 'claimed'; claim: JobClaim }
  // já concluída: a entrega não faz nada
  | { status: 'done' }
  // outra entrega está trabalhando nela agora: quem chama falha para tentar de novo mais tarde, em vez de
  // concluir a mensagem (se o dono cair, o trabalho não pode se perder)
  | { status: 'busy' };

// Lançado por quem recebe `busy`: a entrega falha, a fila a repete mais tarde (ADR 0015) e, se a dona tiver
// caído, o RUNNING velho é reassumido. Concluir a mensagem aqui perderia o trabalho se a dona não terminasse.
export class JobBusyError extends Error {
  constructor(message: QueueMessage) {
    super(`${messageId(message)} está em processamento por outra entrega; a fila tenta de novo`);
    this.name = 'JobBusyError';
  }
}

// Cabe na coluna de texto sem entupir a tabela; a mensagem de erro de uma exceção pode ser enorme.
const MAX_ERROR_LENGTH = 2000;

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);

@Injectable()
export class JobRunStore {
  private readonly logger = new Logger(JobRunStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async claim(message: QueueMessage, now: Date = new Date()): Promise<ClaimResult> {
    const queue = queueFor(message);
    const key = idempotencyKey(message);
    const where = { type: message.type, idempotencyKey: key };

    const id = newId();
    const label = { queue, type: message.type, key: messageId(message) };
    // startedAt vem do mesmo relógio da conferência de "velha" abaixo (o `now` de quem chama), e não do DEFAULT do banco: com os
    // dois relógios diferentes (os testes fixam o `now`), duas entregas simultâneas veriam a linha nova como velha e as duas
    // assumiriam a mensagem. Em produção os relógios coincidem.
    const created = await this.prisma.jobRun.createMany({
      data: [{ id, queue, ...where, startedAt: now }],
      skipDuplicates: true,
    });
    if (created.count === 1) return { status: 'claimed', claim: { id, attempt: 1, label } };

    // A linha existe. Reassume se a tentativa anterior falhou (FAILED) ou esperou (WAITING), ou se ficou RUNNING além da renovação da
    // trava da fila (o processo caiu no meio). O UPDATE condicional é a trava: só uma entrega concorrente o vence.
    const staleBefore = new Date(now.getTime() - QUEUES[queue].lockRenewalMs);
    const retaken = await this.prisma.jobRun.updateMany({
      where: {
        ...where,
        OR: [
          { status: 'FAILED' },
          { status: 'WAITING' },
          { status: 'RUNNING', startedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        startedAt: now,
        finishedAt: null,
        error: null,
      },
    });
    const row = await this.prisma.jobRun.findUniqueOrThrow({
      where: { type_idempotencyKey: where },
    });
    if (retaken.count === 1)
      return { status: 'claimed', claim: { id: row.id, attempt: row.attempts, label } };
    return { status: row.status === 'SUCCEEDED' ? 'done' : 'busy' };
  }

  // Pede de novo o que já foi tratado: a liquidação refeita porque o dado mudou (evento corporativo novo, correção do dado
  // pelo admin). Marca a linha FAILED com o motivo, e a próxima entrega da mensagem a reassume (claim) como nova tentativa.
  // Vale para a linha em qualquer estado, até RUNNING: o dono antigo perde a posse (o succeed e o fail dele só valem com a linha
  // RUNNING na mesma tentativa), então ele não marca como feito um trabalho que leu o dado velho. Sem linha não há o que reabrir
  // (a primeira entrega cria a sua) e nada é criado. Quem chama reabre ANTES de publicar a mensagem: reabrir depois deixaria a
  // entrega rápida ver a linha ainda SUCCEEDED e não fazer nada. Devolve se havia linha.
  async reopen(message: QueueMessage, reason: string): Promise<boolean> {
    const reopened = await this.prisma.jobRun.updateMany({
      where: { type: message.type, idempotencyKey: idempotencyKey(message) },
      data: { status: 'FAILED', error: errorText(reason), finishedAt: new Date() },
    });
    return reopened.count === 1;
  }

  // succeed e fail só valem para quem ainda é o dono (a mesma tentativa, ainda RUNNING): um dono antigo que
  // travou e chega tarde não apaga o trabalho de quem assumiu depois.
  async succeed(claim: JobClaim): Promise<void> {
    await this.finish(claim, { status: 'SUCCEEDED', error: null });
  }

  // A mensagem esperou em vez de falhar: o eod que reagendou porque o arquivo do pregão não saiu agenda a própria nova tentativa e
  // deixa o motivo aqui. A linha fica WAITING (não FAILED: o alerta de job falho não a conta) e a cópia agendada a reassume. Melhor
  // esforço, como o fail: a cópia já foi publicada, e uma gravação que falha aqui não pode transformar a espera em erro.
  async wait(claim: JobClaim, reason: string): Promise<void> {
    this.logger.log(
      {
        ...claim.label,
        jobId: claim.id,
        attempt: claim.attempt,
        reason: redactText(reason).slice(0, 300),
      },
      'job_run em espera: nova tentativa agendada',
    );
    await this.finishQuietly(claim, { status: 'WAITING', error: errorText(reason) });
  }

  // Melhor esforço, ao contrário do succeed: quem chama está no caminho de erro (`catch { fail; throw }`) e relança o erro original
  // logo depois. Se o banco que derrubou o handler derrubar também esta gravação, o erro dela tomaria o lugar do original e o motivo
  // real sumiria do log e da DLQ. A linha fica RUNNING e é reassumida quando a trava da fila vence (claim).
  // A linha de log é o que o alerta "job falho" lê (ALERT_LOG.jobFailed): o job_run mora no Postgres e não chega ao Log Analytics
  // sozinho. Sai ANTES de gravar, para o alerta não depender do banco, que pode ser a causa da falha. Fila `news`: a falha costuma ser
  // rede e o slot seguinte rebusca o mesmo feed; o filtro por tentativa está no Bicep (NEWS_FAILED_ATTEMPTS_TOLERATED).
  async fail(claim: JobClaim, error: unknown): Promise<void> {
    this.logger.error(
      {
        ...claim.label,
        jobId: claim.id,
        attempt: claim.attempt,
        reason: redactText(errorText(error)).slice(0, 300),
      },
      ALERT_LOG.jobFailed,
    );
    await this.finishQuietly(claim, { status: 'FAILED', error: errorText(error) });
  }

  private async finishQuietly(
    claim: JobClaim,
    data: { status: 'FAILED' | 'WAITING'; error: string },
  ): Promise<void> {
    try {
      await this.finish(claim, data);
    } catch (writeError) {
      this.logger.warn(
        { jobId: claim.id, err: writeError },
        `não deu para marcar o job como ${data.status}; a linha fica RUNNING até a trava da fila vencer`,
      );
    }
  }

  private async finish(
    claim: JobClaim,
    data: { status: 'SUCCEEDED' | 'FAILED' | 'WAITING'; error: string | null },
  ): Promise<void> {
    await this.prisma.jobRun.updateMany({
      where: { id: claim.id, attempts: claim.attempt, status: 'RUNNING' },
      data: { ...data, finishedAt: new Date() },
    });
  }
}
