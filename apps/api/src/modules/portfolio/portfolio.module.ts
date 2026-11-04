import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module.js';
import { PortfolioService } from './application/portfolio.service.js';
import { PortfolioRepository } from './infrastructure/portfolio.repository.js';
import { PortfolioController } from './presentation/portfolio.controller.js';

// A carteira do usuário (etapa 12; docs/API.md, seção 9). Só o papel HTTP carrega este módulo (app.module.ts). Importa a conta pelos guards
// (SessionGuard e ConsentGuard): a rota usa sempre o ULID da sessão. A api escreve em `portfolio` e `portfolio_lot` com o papel mínimo do
// Postgres (infrastructure/database/table-policy.ts) e não grava trilha de auditoria: o lançamento é dado do próprio dono, que o edita e o
// apaga (ADR 0031).
@Module({
  imports: [AccountModule],
  controllers: [PortfolioController],
  providers: [PortfolioRepository, PortfolioService],
})
export class PortfolioModule {}
