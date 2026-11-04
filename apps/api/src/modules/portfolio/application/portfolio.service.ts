import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  lotSchema,
  portfolioSchema,
  type Lot,
  type LotInput,
  type Portfolio,
} from '@alvesting/contracts';
import { ValidationException } from '../../../common/zod-validation.pipe.js';
import { brasiliaDate } from '../../market-data/domain/dates.js';
import { safeNumber } from '../../settlement/domain/money.js';
import { consolidate, type LotRecord } from '../domain/positions.js';
import { LotLimitError, PortfolioRepository } from '../infrastructure/portfolio.repository.js';

const notFound = () => new NotFoundException('Lançamento não encontrado');

// O lançamento como o dono o vê, validado pelo contrato estrito (sem o id da carteira nem o do usuário).
const toLot = (record: LotRecord): Lot =>
  lotSchema.parse({
    id: record.id,
    ticker: record.ticker,
    quantity: record.quantity,
    costCents: safeNumber(record.costCents),
    boughtOn: record.boughtOn,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });

// A carteira do usuário (plano §11, etapa 12; docs/API.md, seção 9). O dono é sempre o ULID da sessão que o controlador passa: nenhum método
// recebe um id de usuário da requisição. Lançamento de outro usuário é 404, igual ao que não existe.
@Injectable()
export class PortfolioService {
  constructor(private readonly repo: PortfolioRepository) {}

  // Os lançamentos e as posições por ticker, com o último fechamento de cada papel (uma consulta para todos) e os totais.
  async get(userId: string): Promise<Portfolio> {
    const lots = await this.repo.lots(userId);
    const closes = await this.repo.closes([...new Set(lots.map((lot) => lot.ticker))]);
    const { positions, totals } = consolidate(lots, closes);
    return portfolioSchema.parse({ lots: lots.map(toLot), positions, totals });
  }

  async add(userId: string, input: LotInput): Promise<Lot> {
    await this.check(input);
    try {
      return toLot(await this.repo.add(userId, input));
    } catch (error) {
      if (error instanceof LotLimitError) {
        throw new ConflictException({
          code: 'LOT_LIMIT',
          message:
            'A carteira chegou ao máximo de lançamentos: apague algum para acrescentar outro',
        });
      }
      throw error;
    }
  }

  async replace(userId: string, id: string, input: LotInput): Promise<Lot> {
    await this.check(input);
    const record = await this.repo.replace(userId, id, input);
    if (!record) throw notFound();
    return toLot(record);
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    if (!(await this.repo.remove(userId, id))) throw notFound();
    return { deleted: true };
  }

  // O que o contrato não sabe: o ticker é uma ação que a api conhece (a tabela `instrument`) e a data da compra não é futura (em Brasília).
  // Sai como 400 no campo, no formato dos erros de validação, e a mensagem nunca repete o que o cliente mandou.
  private async check(input: LotInput): Promise<void> {
    const issues: ValidationException['issues'] = [];
    if (input.boughtOn !== null && input.boughtOn > brasiliaDate(new Date())) {
      issues.push({ code: 'custom', path: ['boughtOn'], message: 'a data da compra é futura' });
    }
    if (!(await this.repo.isStock(input.ticker))) {
      issues.push({ code: 'custom', path: ['ticker'], message: 'ação desconhecida' });
    }
    if (issues.length > 0) throw new ValidationException(issues);
  }
}
