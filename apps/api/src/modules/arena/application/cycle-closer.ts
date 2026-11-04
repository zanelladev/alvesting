import { Logger } from '@nestjs/common';
import { recordInvalid } from '../../../telemetry/instruments.js';
import { forcedHold } from '../domain/decision-record.js';
import type { ArenaRepository } from '../infrastructure/arena.repository.js';

// Quanto esperar depois do prazo das 09:30 antes de varrer. Uma execução do decide chamada antes do prazo para de esperar o
// modelo no prazo e grava o HOLD "prazo" em segundos; a folga cobre o tempo de gravar o IO bruto e a decisão. A cópia agendada
// que chegar depois da varredura encontra a decisão pronta e não faz nada.
export const SWEEP_GRACE_MS = 15 * 60_000;

// A varredura que fecha o que a fila não fechou (docs/JOBS.md, "DLQ vira HOLD"). O mecanismo principal é o handler na última
// entrega (DecideHandler): falhou pela terceira vez, grava o HOLD "falha" e conclui a mensagem. Fica de fora dele o que nenhum
// handler vê: processo que caiu (trava expirada três vezes e a mensagem foi para a DLQ pelo broker), banco fora no momento de
// gravar o HOLD, mensagem nunca publicada. Para esses, o competidor que continua sem decisão depois do prazo ganha o HOLD
// "sem_resposta", e o ciclo fecha. Quem liquida (etapa 7) chama isto antes de ler as decisões do dia, e o sched-cycle
// chama antes de abrir o ciclo seguinte.
export class CycleCloser {
  private readonly logger = new Logger(CycleCloser.name);

  constructor(
    private readonly repo: Pick<
      ArenaRepository,
      'overdueOpenCycles' | 'competitorIdsWithoutDecision' | 'saveDecision' | 'closeIfComplete'
    >,
  ) {}

  // Devolve quantos ciclos fechou.
  async closeOverdue(now: Date): Promise<number> {
    const cycles = await this.repo.overdueOpenCycles(new Date(now.getTime() - SWEEP_GRACE_MS));
    let closed = 0;
    for (const cycle of cycles) {
      const missing = await this.repo.competitorIdsWithoutDecision(cycle.id);
      for (const competitorId of missing) {
        // 'exists': o decide gravou no meio da varredura, e a primeira decisão vale (e não conta como inválida)
        const saved = await this.repo.saveDecision(
          forcedHold(cycle.id, competitorId, 'sem_resposta'),
        );
        if (saved === 'created') recordInvalid({ reason: 'sem_resposta' });
      }
      if (await this.repo.closeIfComplete(cycle.id, now)) {
        closed += 1;
        this.logger.warn(
          { cycleId: cycle.id, date: cycle.date, forced: missing.length },
          'ciclo vencido fechado pela varredura: competidores sem decisão viraram HOLD',
        );
      }
    }
    return closed;
  }
}
