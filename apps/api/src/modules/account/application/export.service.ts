import { Injectable } from '@nestjs/common';
import { userExportSchema, type UserExport } from '@alvesting/contracts';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { safeNumber } from '../../settlement/domain/money.js';
import { EXPORTED_MODELS, USER_EXPORT_COLUMNS } from '../domain/user-data.js';

// Dinheiro é bigint no banco (o custo do lançamento, em centavos) e número no JSON, como em toda resposta da api: o `safeNumber` recusa o que
// perderia precisão (o teto do CHECK cabe com folga). O JSON.stringify não serializa bigint sozinho.
const jsonSafe = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? safeNumber(value) : value;

// O JSON de exportação (LGPD art. 18, II e V): tudo o que guardamos do dono da conta, e só do dono. O que sai de cada modelo está em
// domain/user-data.ts (colunas listadas, nunca `select *`), e o contrato estrito (userExportSchema) recusa qualquer campo a mais:
// o hash da senha, o token de OAuth, o token de verificação e o token de sessão não têm onde entrar.
@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async build(userId: string): Promise<UserExport> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: USER_EXPORT_COLUMNS,
    });
    // cada modelo do usuário (EXPORTED_MODELS) pelo delegate do Prisma, sempre filtrado pelo dono; as consultas não dependem umas das outras
    // ponytail: o delegate vai por nome (tabela de domain/user-data.ts, que o user-data.spec.ts compara com o schema), então o TypeScript
    // não confere where e select; quem confere, em execução, é o userExportSchema estrito abaixo.
    const delegates = this.prisma as unknown as Record<
      string,
      { findMany: (args: object) => Promise<unknown[]> }
    >;
    const rows = Object.fromEntries(
      await Promise.all(
        Object.values(EXPORTED_MODELS).map(async (model) => {
          const found = (await delegates[model.delegate]!.findMany({
            where: model.where(userId),
            select: model.select,
            orderBy: model.orderBy,
          })) as Array<Record<string, unknown>>;
          // a coluna DATE sai como `AAAA-MM-DD` (o Prisma a lê como instante à meia-noite UTC): o dia que o dono digitou, sem fuso
          const dates = model.dateOnly ?? [];
          return [
            model.key,
            dates.length === 0
              ? found
              : found.map((row) => ({
                  ...row,
                  ...Object.fromEntries(
                    dates.map((column) => [
                      column,
                      row[column] instanceof Date ? row[column].toISOString().slice(0, 10) : null,
                    ]),
                  ),
                })),
          ] as const;
        }),
      ),
    );
    // as datas viram texto ISO pelo JSON (Date#toJSON) e o dinheiro, número (jsonSafe); o contrato estrito confere o resto
    return userExportSchema.parse(
      JSON.parse(JSON.stringify({ exportedAt: new Date(), user, ...rows }, jsonSafe)),
    );
  }
}
