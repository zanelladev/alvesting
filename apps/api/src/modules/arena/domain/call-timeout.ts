// O tempo de cada chamada ao modelo (plano 5.3 e 7): o menor entre o que falta até o prazo das 09:30 e o que resta ao job
// (replicaTimeout de 1500 s, em infra/modules/containerapps.bicep, menos uma margem para gravar o IO bruto e a decisão antes
// do SIGKILL). Vale para cada chamada, a original e o reparo: a segunda recebe só o que sobrou da primeira.

// replicaTimeout do job-worker-decisions. Mudou na infra, muda aqui (o infra/tests/check.mjs confere o valor do Bicep).
export const REPLICA_TIMEOUT_MS = 1_500_000;
// Folga para o que vem depois da última chamada: filtro, Blob (3 arquivos) e o banco. Dois minutos sobram.
export const JOB_MARGIN_MS = 120_000;
// Com menos que isto não vale começar uma chamada de LLM: ela não termina.
export const MIN_CALL_MS = 10_000;
// O reparo é uma segunda chamada paga com o que sobrou do job (ou do prazo). Com menos que isto ele quase certamente estoura, e a
// primeira resposta, já paga, se perderia na nova tentativa: sem o mínimo, o reparo nem começa, e a decisão vira HOLD guardando
// o IO e o custo da primeira chamada.
export const MIN_REPAIR_MS = 180_000;

export interface CallBudget {
  ms: number;
  // o que limita: o prazo das 09:30 (vira HOLD "prazo") ou o tempo do job (vira falha, e a fila tenta de novo)
  bound: 'deadline' | 'job';
}

export function callBudget(input: { now: Date; jobStartedAt: Date; deadlineAt: Date }): CallBudget {
  const untilDeadline = input.deadlineAt.getTime() - input.now.getTime();
  const untilJobEnd =
    input.jobStartedAt.getTime() + REPLICA_TIMEOUT_MS - JOB_MARGIN_MS - input.now.getTime();
  // empate: o prazo (é ele que vira HOLD; o fim do job é falha)
  return untilDeadline <= untilJobEnd
    ? { ms: Math.max(0, untilDeadline), bound: 'deadline' }
    : { ms: Math.max(0, untilJobEnd), bound: 'job' };
}
