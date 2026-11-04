import type { Prisma } from '../generated/prisma/client.js';
import { newId } from './id.js';

// A trilha de auditoria (tabela audit_log; plano §8). Quem muda algo que importa grava uma linha com o ator ("cli", "system",
// "admin:<ULID>" ou "user:<ULID>"), a ação, o alvo e um detalhe. NUNCA dado pessoal: ULID, slug, data, nome de fila e número, nada de
// e-mail, nome ou IP (LGPD; docs/CONTA.md). A linha que acompanha uma mudança no banco vai na MESMA transação dela (o repositório recebe
// o `AuditEntry` e a grava com `appendAudit`): ou as duas valem, ou nenhuma.
export interface AuditEntry {
  actor: string;
  action: string;
  detail?: Prisma.InputJsonValue;
}

// As ações que a api grava na trilha (docs/API.md, seção 8). Quem grava usa esta lista, e não o texto solto: o runbook.spec.ts lê a lista e
// reprova a ação que não tem seção no docs/RUNBOOK.md (o que fazer quando ela aparece no log, ou por que não há o que fazer).
export const AUDIT_ACTIONS = {
  seasonCreate: 'admin.season.create',
  seasonUpdate: 'admin.season.update',
  seasonStart: 'admin.season.start',
  cycleRerun: 'admin.cycle.rerun',
  dlqResubmit: 'admin.dlq.resubmit',
  corporateEvent: 'admin.corporate_event',
  corporateEventCreated: 'corporate_event.created',
  corporateEventUpdated: 'corporate_event.updated',
  accountPromoted: 'account.promoted',
  accountDemoted: 'account.demoted',
  accountDeleted: 'account.deleted',
} as const;

export const auditRow = (entry: AuditEntry, target: string | null) => ({
  id: newId(),
  actor: entry.actor,
  action: entry.action,
  target,
  ...(entry.detail === undefined ? {} : { detail: entry.detail }),
});

// Grava a linha. A api só tem INSERT em audit_log (papel mínimo do Postgres, ADR 0028: a trilha não se lê, não se muda e não se apaga por
// ela), e o `create` do Prisma lê a linha de volta (RETURNING), que pede SELECT. O `createMany` insere sem ler. Todo código que a api alcança
// grava a trilha por aqui; o `api-role.integration.spec.ts` prova que o `create` seria recusado.
export const appendAudit = (
  db: Pick<Prisma.TransactionClient, 'auditLog'>,
  entry: AuditEntry,
  target: string | null,
) => db.auditLog.createMany({ data: [auditRow(entry, target)] });
