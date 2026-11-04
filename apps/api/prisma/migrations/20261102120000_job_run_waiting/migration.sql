-- Etapa 10: o eod que não achou o arquivo do pregão e agendou a própria nova tentativa não é falha. Ficava FAILED com o texto "ainda
-- não publicado" (docs/JOBS.md), e o alerta de job falho teria de filtrar por texto. Agora é WAITING; a próxima entrega reassume a linha.
-- Aditiva: só acrescenta um valor ao enum. Nenhuma linha existente muda (o que já está FAILED continua FAILED). O valor novo só é usado
-- por código, depois da migration; por isso o ALTER TYPE fica sozinho neste arquivo.

-- AlterEnum
ALTER TYPE "job_run_status" ADD VALUE 'WAITING';
