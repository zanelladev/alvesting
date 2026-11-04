import { AUDIT_ACTIONS, auditRow } from '../../../common/audit.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { parseOperatorEmail } from './promote.js';

// O comando account:demote <e-mail> (docs/CONTA.md, seção 4): tira o papel de admin e encerra as sessões da pessoa, numa transação só
// com a linha de auditoria (ator "cli", alvo o ULID, nunca o e-mail). Existe desde a etapa 10, antes das rotas /admin: um admin que não
// deve mais ser admin, ou cuja sessão vazou, tem de poder ser derrubado sem esperar a sessão vencer (7 dias). O papel é lido do banco a cada
// requisição, então o rebaixamento vale na hora; apagar as sessões é a segunda barreira (o cookie deixa de valer para tudo).
// Idempotente: quem já é usuário comum não muda nada e não perde a sessão (rodar de novo não desloga uma pessoa que já voltou a entrar).
export async function demoteFromAdmin(
  prisma: PrismaService,
  rawEmail: string,
  options: { execution?: string } = {},
): Promise<{ userId: string; changed: boolean; sessionsEnded: number }> {
  const email = parseOperatorEmail(rawEmail);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  // as mensagens não repetem o endereço
  if (!user) throw new Error('usuário não encontrado');
  if (user.role !== 'ADMIN') return { userId: user.id, changed: false, sessionsEnded: 0 };

  const sessionsEnded = await prisma.$transaction(async (tx) => {
    // o UPDATE condicional é a trava: dois comandos juntos rebaixam uma vez só e deixam uma linha só
    const demoted = await tx.user.updateMany({
      where: { id: user.id, role: 'ADMIN' },
      data: { role: 'USER' },
    });
    if (demoted.count !== 1) return null;
    const ended = await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({
      data: auditRow(
        {
          actor: 'cli',
          action: AUDIT_ACTIONS.accountDemoted,
          detail: {
            role: 'USER',
            sessionsEnded: ended.count,
            ...(options.execution ? { execution: options.execution } : {}),
          },
        },
        user.id,
      ),
    });
    return ended.count;
  });
  return sessionsEnded === null
    ? { userId: user.id, changed: false, sessionsEnded: 0 }
    : { userId: user.id, changed: true, sessionsEnded };
}
