import { Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { ACCOUNT_CONFIG, AUTH, EMAIL_SENDER, LEGAL_DOCUMENTS } from './account.tokens.js';
import { ConsentService } from './application/consent.service.js';
import { DeleteAttempts } from './application/delete-attempts.js';
import { ExportService } from './application/export.service.js';
import { loadLegalDocuments } from './domain/legal-documents.js';
import { accountConfig, type AccountConfig } from './infrastructure/account-config.js';
import { createAuth } from './infrastructure/auth.js';
import { AccountMailer } from './infrastructure/email/account-mailer.js';
import { createEmailSender, type EmailSender } from './infrastructure/email/email-sender.js';
import { AuthProvidersController } from './presentation/auth-providers.controller.js';
import { ConsentGuard } from './presentation/consent.guard.js';
import { LegalController } from './presentation/legal.controller.js';
import { MeController } from './presentation/me.controller.js';
import { RolesGuard } from './presentation/roles.guard.js';
import { SessionGuard } from './presentation/session.guard.js';

// A conta (plano §8 e §9, etapa 11; docs/CONTA.md): o Better Auth em /api/auth/*, os termos e a política, o aceite versionado, as
// rotas /api/v1/me (dados, aceite, exportação, exclusão) e os guards que as próximas etapas usam (sessão, papel e aceite). Só o papel
// HTTP carrega este módulo (app.module.ts): o worker, os agendadores e as decisões não têm a conta, e o contrato fail closed de
// produção (account-config.ts) não os recusa.
const logger = new Logger('Conta');

@Module({
  controllers: [MeController, LegalController, AuthProvidersController],
  providers: [
    { provide: ACCOUNT_CONFIG, inject: [ENV], useFactory: (env: Env) => accountConfig(env) },
    { provide: LEGAL_DOCUMENTS, useFactory: () => loadLegalDocuments() },
    {
      provide: EMAIL_SENDER,
      inject: [ACCOUNT_CONFIG],
      useFactory: (config: AccountConfig) => createEmailSender(config.email),
    },
    {
      provide: AccountMailer,
      inject: [EMAIL_SENDER],
      useFactory: (sender: EmailSender) => new AccountMailer(sender, (line) => logger.warn(line)),
    },
    ConsentService,
    ExportService,
    { provide: DeleteAttempts, useFactory: () => new DeleteAttempts() },
    {
      provide: AUTH,
      inject: [PrismaService, ACCOUNT_CONFIG, AccountMailer, ConsentService],
      useFactory: (
        prisma: PrismaService,
        config: AccountConfig,
        mailer: AccountMailer,
        consent: ConsentService,
      ) =>
        createAuth({ prisma, config, mailer, consent, log: (level, line) => logger[level](line) }),
    },
    SessionGuard,
    RolesGuard,
    ConsentGuard,
  ],
  exports: [AUTH, ACCOUNT_CONFIG, ConsentService, SessionGuard, RolesGuard, ConsentGuard],
})
export class AccountModule {}
