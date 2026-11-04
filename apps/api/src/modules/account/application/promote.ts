import { z } from 'zod';
import { AUDIT_ACTIONS, auditRow } from '../../../common/audit.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';

// O e-mail que o operador digitou no comando (account:promote e account:demote): minúsculo, sem espaço nas pontas, e a mensagem de erro
// nunca repete o endereço.
export function parseOperatorEmail(raw: string): string {
  const email = z.email().safeParse(raw.trim().toLowerCase());
  if (!email.success) throw new Error('e-mail inválido');
  return email.data;
}

// O nome da execução do job do Container Apps que roda o comando (a plataforma injeta CONTAINER_APP_JOB_EXECUTION_NAME; Learn, "Environment
// variables in Azure Container Apps"). Vem do ambiente, então só passa o que tem a forma de um nome de recurso: a auditoria não guarda texto
// livre. Fora da Azure não há.
export function jobExecutionName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = env.CONTAINER_APP_JOB_EXECUTION_NAME;
  return name !== undefined && /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(name) ? name : undefined;
}

// O comando account:promote <e-mail> (docs/CONTA.md): o único jeito de alguém virar admin. Nenhuma rota HTTP troca o papel (o campo
// `role` do Better Auth é input: false, e o teste confere o cadastro e a atualização do perfil). A auditoria guarda só o ULID.
// Só promove e-mail JÁ VERIFICADO, o que NÃO prova que a conta é do operador: o cadastro por e-mail não prova o dono do endereço, e
// quem se cadastrou antes do operador com o e-mail dele e abriu o link do único e-mail enviado (o do cadastro dele: o do operador
// recebe um 200 genérico, sem conta nova e sem e-mail) tem a conta verificada. A senha dele continuaria valendo depois da promoção.
// Por isso o operador entra no site com a SENHA DELE antes de promover (docs/INFRA.md, 8.6): o 401 mostra a conta tomada, e "Esqueci a
// senha" (que revoga as sessões) a devolve. O comando lembra disso na saída (account-cli.ts), e o remédio de uma promoção errada é o
// account:demote.
// O contrário é o account:demote (application/demote.ts). `execution`: na Azure o comando roda num job, e o nome da execução
// (CONTAINER_APP_JOB_EXECUTION_NAME) liga a linha de auditoria a quem o iniciou no log de atividade da assinatura; local, não há.
export async function promoteToAdmin(
  prisma: PrismaService,
  rawEmail: string,
  options: { execution?: string } = {},
): Promise<{ userId: string; changed: boolean }> {
  const email = parseOperatorEmail(rawEmail);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, emailVerified: true },
  });
  // as mensagens não repetem o endereço
  if (!user) throw new Error('usuário não encontrado');
  if (!user.emailVerified) throw new Error('o e-mail do usuário ainda não foi verificado');
  if (user.role === 'ADMIN') return { userId: user.id, changed: false };

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } }),
    prisma.auditLog.create({
      data: auditRow(
        {
          actor: 'cli',
          action: AUDIT_ACTIONS.accountPromoted,
          detail: { role: 'ADMIN', ...(options.execution ? { execution: options.execution } : {}) },
        },
        user.id,
      ),
    }),
  ]);
  return { userId: user.id, changed: true };
}
