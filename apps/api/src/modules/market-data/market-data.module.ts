import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import {
  BLOB_SERVICE_CLIENT,
  createBlobServiceClient,
} from '../../infrastructure/storage/blob-client.js';
import { ArenaRepository } from '../arena/infrastructure/arena.repository.js';
import { JobRunStore } from '../messaging/infrastructure/job-run.store.js';
import { MessagingService } from '../messaging/infrastructure/messaging.service.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { SettlementPublisher } from '../settlement/application/settlement-publisher.js';
import { BarLoader } from './application/bar-loader.js';
import { EodHandler } from './application/eod.handler.js';
import { MarketQueueHandler } from './application/market-queue.handler.js';
import { MarketSchedulers } from './application/market-schedulers.js';
import { UniverseHandler } from './application/universe.handler.js';
import { WeeklyRefresh } from './application/weekly-refresh.js';
import { TradingCalendar, loadTradingCalendar } from './domain/trading-calendar.js';
import { BrapiClient } from './infrastructure/brapi.client.js';
import { BrapiLock } from './infrastructure/brapi.lock.js';
import { MarketRepository } from './infrastructure/market.repository.js';
import { UniverseRepository } from './infrastructure/universe.repository.js';

// Dados de mercado (etapa 4): as cotações da brapi, o calendário de pregões e o universo semanal. O worker-data consome a fila `market` com
// o MarketQueueHandler; o sched-eod e o sched-universe usam o MarketSchedulers.
@Module({
  imports: [MessagingModule],
  providers: [
    { provide: TradingCalendar, useFactory: () => loadTradingCalendar() },
    // o cliente do Blob serve ao briefing, ao IO das LLMs e ao backup (este módulo não guarda arquivo de cotação)
    {
      provide: BLOB_SERVICE_CLIENT,
      inject: [ENV],
      useFactory: (env: Env) => createBlobServiceClient(env),
    },
    MarketRepository,
    UniverseRepository,
    BrapiLock,
    {
      provide: BrapiClient,
      inject: [ENV, BrapiLock],
      useFactory: (env: Env, lock: BrapiLock) =>
        new BrapiClient(env.BRAPI_TOKEN?.reveal(), undefined, { exclusive: lock.run }),
    },
    {
      provide: BarLoader,
      inject: [BrapiClient, MarketRepository],
      useFactory: (...deps: ConstructorParameters<typeof BarLoader>) => new BarLoader(...deps),
    },
    {
      provide: WeeklyRefresh,
      inject: [BrapiClient, BarLoader, MarketRepository, UniverseRepository, TradingCalendar],
      useFactory: (...deps: ConstructorParameters<typeof WeeklyRefresh>) =>
        new WeeklyRefresh(...deps),
    },
    // O encadeamento eod -> settle (etapa 7): o eod avisa quais pregões acabaram de ser confirmados, e o publicador publica a liquidação
    // das temporadas que os têm. Mora aqui porque o eod o recebe; o SettleHandler, que consome a fila, é do SettlementModule. O
    // ArenaRepository é só consulta ao banco, sem estado: esta instância é deste módulo (o SettlementModule e o ArenaModule têm a
    // deles, de propósito: importar o ArenaModule traria o gateway de LLM para o worker-data).
    ArenaRepository,
    {
      provide: SettlementPublisher,
      inject: [ArenaRepository, JobRunStore, MessagingService, TradingCalendar],
      useFactory: (
        seasons: ArenaRepository,
        jobs: JobRunStore,
        messaging: MessagingService,
        calendar: TradingCalendar,
      ) => new SettlementPublisher({ seasons, jobs, messaging, calendar }),
    },
    {
      provide: EodHandler,
      inject: [
        JobRunStore,
        TradingCalendar,
        MarketRepository,
        UniverseRepository,
        BarLoader,
        MessagingService,
        SettlementPublisher,
      ],
      useFactory: (...deps: ConstructorParameters<typeof EodHandler>) => new EodHandler(...deps),
    },
    {
      provide: UniverseHandler,
      inject: [JobRunStore, TradingCalendar, MarketRepository, UniverseRepository, WeeklyRefresh],
      useFactory: (...deps: ConstructorParameters<typeof UniverseHandler>) =>
        new UniverseHandler(...deps),
    },
    {
      provide: MarketQueueHandler,
      inject: [EodHandler, UniverseHandler],
      useFactory: (eod: EodHandler, universe: UniverseHandler) =>
        new MarketQueueHandler(eod, universe),
    },
    {
      provide: MarketSchedulers,
      inject: [MessagingService, TradingCalendar],
      useFactory: (messaging: MessagingService, calendar: TradingCalendar) =>
        new MarketSchedulers(messaging, calendar),
    },
  ],
  // o calendário e o cliente do Blob também servem ao briefing (etapa 5), às decisões e ao backup
  exports: [MarketQueueHandler, MarketSchedulers, TradingCalendar, BLOB_SERVICE_CLIENT],
})
export class MarketDataModule {}
