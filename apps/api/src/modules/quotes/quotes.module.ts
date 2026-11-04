import { Module } from '@nestjs/common';
import { QuotesRepository } from './infrastructure/quotes.repository.js';
import { QuotesController } from './presentation/quotes.controller.js';

// A rota interna de cotações para o site (docs/API.md, seção 6; ADR 0033). Só o papel HTTP carrega este módulo (app.module.ts). Lê o banco
// com o login de menor privilégio da api (`instrument` e `daily_bar`, que a API pública já lia) e o QUOTES_SECRET do ambiente.
@Module({
  controllers: [QuotesController],
  providers: [QuotesRepository],
})
export class QuotesModule {}
