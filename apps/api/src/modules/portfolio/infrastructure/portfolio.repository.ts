import { PORTFOLIO_LIMITS, type LotInput } from '@alvesting/contracts';
import { Injectable } from '@nestjs/common';
import { newId } from '../../../common/id.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { CloseRow, LotRecord } from '../domain/positions.js';

// As consultas da carteira (plano §11, etapa 12; docs/API.md, seção 9). O DONO é sempre o ULID da sessão (nunca um id da requisição), e entra
// na MESMA instrução que lê ou escreve: o PATCH e o DELETE são um UPDATE e um DELETE que juntam a carteira pelo `user_id` e devolvem a linha
// (RETURNING), sem ler primeiro e escrever depois. Lançamento de outro usuário é, para a api, um lançamento que não existe (404).
// As colunas são listadas, nunca `select *`.

// Chega ao teto de lançamentos da carteira (200); quem converte em 409 é o serviço.
export class LotLimitError extends Error {
  constructor() {
    super(`A carteira já tem ${PORTFOLIO_LIMITS.maxLots} lançamentos`);
    this.name = 'LotLimitError';
  }
}

const day = (date: Date): string => date.toISOString().slice(0, 10);
const startOf = (iso: string | null): Date | null => (iso ? new Date(`${iso}T00:00:00Z`) : null);

// Trava consultiva de transação: solta sozinha no commit, no rollback e quando a conexão cai. A chave vira um inteiro de 64 bits. O mesmo
// molde do ArenaRepository e do SettlementRepository (aqui, uma trava por usuário).
const lockBy = (db: Prisma.TransactionClient, key: string) =>
  db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;

const LOT_SELECT = {
  id: true,
  ticker: true,
  quantity: true,
  costCents: true,
  boughtOn: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface LotRow {
  id: string;
  ticker: string;
  quantity: number;
  costCents: bigint;
  boughtOn: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const toRecord = (row: LotRow): LotRecord => ({
  ...row,
  boughtOn: row.boughtOn && day(row.boughtOn),
});

@Injectable()
export class PortfolioRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Os lançamentos do dono, do mais recente ao mais antigo pela data da compra (sem data, no fim; entre iguais, o criado por último primeiro).
  // ponytail: sem paginação. A carteira tem no máximo 200 lançamentos (PORTFOLIO_LIMITS.maxLots, uns 80 KB de resposta no pior caso); se o teto
  // subir, a saída é o cursor por (data da compra, id) das listas públicas.
  async lots(userId: string): Promise<LotRecord[]> {
    const rows = await this.prisma.portfolioLot.findMany({
      where: { portfolio: { userId } },
      orderBy: [{ boughtOn: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      select: LOT_SELECT,
    });
    return rows.map(toRecord);
  }

  // O último fechamento (a barra mais recente) de cada ticker, numa consulta só para a carteira inteira. O LATERAL lê UMA entrada do índice
  // `daily_bar_instrument_id_date_key` por papel (de trás para a frente), então o custo é de uns 200 papéis no máximo, e não da tabela de barras
  // (docs/API.md, seção 9, com o EXPLAIN). Ticker sem barra não aparece no resultado.
  async closes(tickers: readonly string[]): Promise<CloseRow[]> {
    if (tickers.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{ ticker: string; date: Date; closeCents: bigint }>
    >`
      SELECT i.ticker, b.date, b.close_cents AS "closeCents"
      FROM instrument i
      CROSS JOIN LATERAL (
        SELECT d.date, d.close_cents FROM daily_bar d
        WHERE d.instrument_id = i.id
        ORDER BY d.date DESC LIMIT 1
      ) b
      WHERE i.ticker IN (${Prisma.join(tickers)})`;
    return rows.map((row) => ({
      ticker: row.ticker,
      date: day(row.date),
      closeCents: row.closeCents,
    }));
  }

  // O ticker é uma ação que a api conhece: as que /stocks?q e /stocks/:ticker servem (kind STOCK). Sem chave estrangeira no banco (ADR 0031),
  // é esta conferência, na escrita, que garante que o papel existe.
  async isStock(ticker: string): Promise<boolean> {
    const found = await this.prisma.instrument.findFirst({
      where: { ticker, kind: 'STOCK' },
      select: { id: true },
    });
    return found !== null;
  }

  // Cria o lançamento na carteira do dono, e a carteira, se for o primeiro. A transação trava o dono (a criação da carteira e a contagem
  // não correm), conta e só então grava: dois POST juntos no último lugar não passam do teto. O gatilho do banco (`portfolio_lot_api_guard`) é a
  // segunda barreira, com a trava dele, para o caminho que esquecer esta.
  async add(userId: string, input: LotInput): Promise<LotRecord> {
    return this.prisma.$transaction(async (tx) => {
      await lockBy(tx, `portfolio:${userId}`);
      const found = await tx.portfolio.findUnique({ where: { userId }, select: { id: true } });
      const portfolio =
        found ??
        (await tx.portfolio.create({ data: { id: newId(), userId }, select: { id: true } }));
      const count = await tx.portfolioLot.count({ where: { portfolioId: portfolio.id } });
      if (count >= PORTFOLIO_LIMITS.maxLots) throw new LotLimitError();
      const row = await tx.portfolioLot.create({
        data: {
          id: newId(),
          portfolioId: portfolio.id,
          ticker: input.ticker,
          quantity: input.quantity,
          costCents: BigInt(input.costCents),
          boughtOn: startOf(input.boughtOn),
        },
        select: LOT_SELECT,
      });
      return toRecord(row);
    });
  }

  // Troca o lançamento INTEIRO (ticker, quantidade, custo e data), numa instrução só que já filtra pelo dono. Nenhuma linha = o lançamento não
  // existe ou é de outro usuário: `null`.
  async replace(userId: string, id: string, input: LotInput): Promise<LotRecord | null> {
    const rows = await this.prisma.$queryRaw<LotRow[]>`
      UPDATE portfolio_lot AS l
      SET ticker = ${input.ticker}, quantity = ${input.quantity}, cost_cents = ${BigInt(input.costCents)},
          bought_on = ${input.boughtOn}::date, updated_at = now()
      FROM portfolio AS p
      WHERE l.id = ${id} AND l.portfolio_id = p.id AND p.user_id = ${userId}
      RETURNING l.id, l.ticker, l.quantity, l.cost_cents AS "costCents", l.bought_on AS "boughtOn",
                l.created_at AS "createdAt", l.updated_at AS "updatedAt"`;
    return rows[0] ? toRecord(rows[0]) : null;
  }

  // Apaga o lançamento do dono, na mesma instrução que o procura. `false` = não existe ou é de outro usuário.
  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      DELETE FROM portfolio_lot AS l USING portfolio AS p
      WHERE l.id = ${id} AND l.portfolio_id = p.id AND p.user_id = ${userId}
      RETURNING l.id`;
    return rows.length > 0;
  }
}
