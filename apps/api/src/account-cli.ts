import { Logger } from '@nestjs/common';
import { parseEnv } from './config/env.js';
import { PrismaService } from './infrastructure/database/prisma.service.js';
import { demoteFromAdmin } from './modules/account/application/demote.js';
import { jobExecutionName, promoteToAdmin } from './modules/account/application/promote.js';

// Linha de comando da conta (docs/CONTA.md). Usa o banco do ambiente (DATABASE_URL), sem fila e sem Blob.
//   pnpm --filter @alvesting/api account:promote <e-mail>
//   pnpm --filter @alvesting/api account:demote <e-mail>
// Na Azure o Postgres é privado: os dois rodam como uma execução do job-migrate com outro comando (docs/INFRA.md, seção 8.6).
const USAGE = `Uso:
  promote <e-mail>
      promove a conta ao papel admin. É o único jeito de alguém virar admin: nenhuma rota HTTP troca o papel, e o cadastro e a
      atualização do perfil ignoram ou recusam o campo. Só promove e-mail já verificado, o que NÃO prova que a conta é sua: entre antes no
      site com a sua senha (docs/INFRA.md, 8.6). O papel vale na hora, sem sair e entrar. A trilha de auditoria (audit_log, ator "cli")
      guarda só o ULID da conta. Repetir o comando não muda nada.
  demote <e-mail>
      tira o papel de admin e ENCERRA todas as sessões da conta (ela entra de novo como usuário comum). Mesma auditoria. Repetir o comando
      não muda nada e não derruba a sessão de quem já voltou a entrar.`;

async function main(argv: string[]): Promise<number> {
  const [command, email] = argv;
  if ((command !== 'promote' && command !== 'demote') || !email || argv.length !== 2) {
    console.error(USAGE);
    return 2;
  }

  Logger.overrideLogger(['warn', 'error']); // o resultado sai por console.log
  const env = parseEnv();
  const prisma = new PrismaService(env);
  try {
    // na Azure, a execução do job liga a auditoria a quem a iniciou
    const options = { execution: jobExecutionName() };
    // o resultado leva só o ULID, nunca o e-mail
    if (command === 'promote') {
      const { userId, changed } = await promoteToAdmin(prisma, email, options);
      console.log(
        changed ? `conta ${userId} promovida a admin` : `conta ${userId} já era admin: nada mudou`,
      );
      // e-mail verificado não prova que a conta é do operador: alguém pode ter se cadastrado antes com o endereço dele
      if (changed) {
        console.log(
          'Confira que a conta é sua: entre no site com a SUA senha. Se o login falhar (alguém cadastrou o seu e-mail antes), rode account:demote com o mesmo e-mail (encerra as sessões) e use "Esqueci a senha" (docs/INFRA.md, 8.6).',
        );
      }
    } else {
      const { userId, changed, sessionsEnded } = await demoteFromAdmin(prisma, email, options);
      console.log(
        changed
          ? `conta ${userId} rebaixada a usuário; ${sessionsEnded} sessão(ões) encerrada(s)`
          : `conta ${userId} não era admin: nada mudou`,
      );
    }
    return 0;
  } finally {
    await prisma.onModuleDestroy();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
