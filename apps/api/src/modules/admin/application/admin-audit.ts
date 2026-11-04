import { Injectable } from '@nestjs/common';
import { appendAudit, type AuditEntry } from '../../../common/audit.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';

// A trilha das ações de admin que NÃO são só uma mudança no banco (reprocessar o ciclo, reenviar a DLQ, registrar o evento): a linha vai
// ANTES da ação, como registro da intenção, e fecha para o lado seguro (se não deu para gravar, a ação não acontece). A mudança de
// temporada grava a dela na mesma transação da mudança (ArenaRepository). Ator sempre "admin:<ULID>"; nada de dado pessoal.
@Injectable()
export class AdminAudit {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, target: string | null): Promise<void> {
    await appendAudit(this.prisma, entry, target);
  }
}
