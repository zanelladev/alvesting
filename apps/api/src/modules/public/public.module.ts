import { Module } from '@nestjs/common';
import { TradingCalendar, loadTradingCalendar } from '../market-data/domain/trading-calendar.js';
import { PublicRepository } from './infrastructure/public.repository.js';
import { PublicController } from './presentation/public.controller.js';

// A API pública da arena (etapa 9; docs/API.md): ranking, patrimônio, Monte Carlo, competidor, feed de decisões, notícias e
// ações. Só leitura, sem login, com cache. O papel HTTP carrega este módulo e o CyclesModule (o ciclo, por data ou ULID); os
// papéis sem HTTP não. Não carrega o gateway de LLM, o Blob nem a fila: a API, exposta à internet, só lê o banco. O calendário de
// pregões (a lista de feriados da B3, um arquivo ao lado do código) é só do próximo ciclo da home; o MarketDataModule, que o
// provê aos workers, traz junto a fila e o Blob, que a API não tem.
@Module({
  controllers: [PublicController],
  providers: [
    PublicRepository,
    { provide: TradingCalendar, useFactory: () => loadTradingCalendar() },
  ],
})
export class PublicModule {}
