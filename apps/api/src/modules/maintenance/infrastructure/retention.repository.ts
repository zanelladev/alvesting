import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';

// As tabelas que a retenção limpa (docs/JOBS.md, seção 8). A ORDEM importa: o usuário primeiro, porque a cascata dele leva a sessão, a
// conta e o aceite, e as contagens das outras tabelas ficam só com o que sobrou.
export const RETENTION_TABLES = ['user', 'session', 'verification', 'job_run'] as const;
export type RetentionTable = (typeof RETENTION_TABLES)[number];

export interface RetentionStore {
  // apaga até `limit` linhas da regra da tabela, as mais velhas primeiro, e devolve quantas apagou
  deleteBatch(table: RetentionTable, cutoff: Date, limit: number): Promise<number>;
}

// Um DELETE por regra, em lote: `id IN (SELECT ... LIMIT n)` apaga poucas linhas por comando, segura o lock por milissegundos e deixa o
// WAL e a réplica em paz. Nada de identificador montado em texto: cada tabela tem o SQL dela. Sem índice novo: as tabelas são de
// milhares de linhas (medido na revisão da etapa 11: 17,8 mil de 40 mil sessões apagadas em 13 ms e 20 mil usuários varridos em 1,9 ms).
//
// DOIS cuidados que o teste de integração prova:
//  1. A regra vem REPETIDA no DELETE de fora. No READ COMMITTED a subconsulta escolhe as linhas num instante e o DELETE as trava depois: se
//     alguém muda a linha nesse intervalo (o link de confirmação do e-mail, a renovação da sessão), o Postgres reavalia só o WHERE de fora,
//     e sem a regra ali apagaria a conta que acabou de ser confirmada.
//  2. O corte vai como texto ISO com `Z` e vira timestamptz no SQL. O Prisma manda um Date sem fuso, e o Postgres o leria no TimeZone da
//     SESSÃO: num servidor configurado em horário de Brasília todo corte andaria 3 horas.
@Injectable()
export class RetentionRepository implements RetentionStore {
  constructor(private readonly prisma: PrismaService) {}

  deleteBatch(table: RetentionTable, cutoff: Date, limit: number): Promise<number> {
    const at = cutoff.toISOString();
    switch (table) {
      // cadastro que nunca confirmou o e-mail: guarda nome e e-mail e pode ocupar o endereço de outra pessoa. A cascata leva session,
      // account e consent (o gatilho do aceite deixa passar o DELETE em cascata e recusa o direto)
      case 'user':
        return this.prisma.$executeRaw`
          DELETE FROM "user" WHERE NOT email_verified AND created_at < ${at}::timestamptz AND id IN (
            SELECT id FROM "user" WHERE NOT email_verified AND created_at < ${at}::timestamptz ORDER BY created_at LIMIT ${limit})`;
      // sessão vencida e nunca mais usada: o Better Auth só apaga a vencida quando alguém a apresenta de novo
      case 'session':
        return this.prisma.$executeRaw`
          DELETE FROM "session" WHERE expires_at < ${at}::timestamptz AND id IN (
            SELECT id FROM "session" WHERE expires_at < ${at}::timestamptz ORDER BY expires_at LIMIT ${limit})`;
      // pedido de uso único vencido (redefinição de senha, estado do fluxo do Google): cada POST anônimo em /sign-in/social grava um
      case 'verification':
        return this.prisma.$executeRaw`
          DELETE FROM "verification" WHERE expires_at < ${at}::timestamptz AND id IN (
            SELECT id FROM "verification" WHERE expires_at < ${at}::timestamptz ORDER BY expires_at LIMIT ${limit})`;
      // a fila `news` grava um job_run por fonte e por slot de 30 minutos (uns 290 por dia), e a chave do slot não volta
      case 'job_run':
        return this.prisma.$executeRaw`
          DELETE FROM "job_run" WHERE type = 'fetch' AND started_at < ${at}::timestamptz AND id IN (
            SELECT id FROM "job_run" WHERE type = 'fetch' AND started_at < ${at}::timestamptz ORDER BY started_at LIMIT ${limit})`;
    }
  }
}
