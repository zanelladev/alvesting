import { Module } from '@nestjs/common';
import { JobRunStore } from '../messaging/infrastructure/job-run.store.js';
import { MessagingService } from '../messaging/infrastructure/messaging.service.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { TradingCalendar } from '../market-data/domain/trading-calendar.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { BriefingSchedulers } from './application/briefing-schedulers.js';
import { FreezeHandler } from './application/freeze.handler.js';
import { BriefingArchive } from './infrastructure/briefing.archive.js';
import { BriefingRepository } from './infrastructure/briefing.repository.js';

// Briefing congelado (etapa 5): o worker-data consome a fila `briefing` com o FreezeHandler; o sched-briefing só
// publica (BriefingSchedulers). O calendário de pregões e o cliente do Blob são os do módulo de dados de mercado.
@Module({
  imports: [MessagingModule, MarketDataModule],
  providers: [
    BriefingRepository,
    BriefingArchive,
    {
      provide: FreezeHandler,
      inject: [JobRunStore, TradingCalendar, BriefingRepository, BriefingArchive],
      useFactory: (...deps: ConstructorParameters<typeof FreezeHandler>) =>
        new FreezeHandler(...deps),
    },
    {
      provide: BriefingSchedulers,
      inject: [MessagingService, TradingCalendar],
      useFactory: (messaging: MessagingService, calendar: TradingCalendar) =>
        new BriefingSchedulers(messaging, calendar),
    },
  ],
  // o arquivo e a leitura do briefing também servem à decisão da arena (etapa 6)
  exports: [FreezeHandler, BriefingSchedulers, BriefingArchive, BriefingRepository],
})
export class BriefingModule {}
