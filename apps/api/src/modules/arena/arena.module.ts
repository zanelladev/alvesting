import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { BriefingArchive } from '../briefing/infrastructure/briefing.archive.js';
import { BriefingRepository } from '../briefing/infrastructure/briefing.repository.js';
import { BriefingModule } from '../briefing/briefing.module.js';
import { TradingCalendar } from '../market-data/domain/trading-calendar.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { JobRunStore } from '../messaging/infrastructure/job-run.store.js';
import { MessagingService } from '../messaging/infrastructure/messaging.service.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { CycleCloser } from './application/cycle-closer.js';
import { CycleSchedulers } from './application/cycle-schedulers.js';
import { DecideHandler } from './application/decide.handler.js';
import { settledPortfolioReader } from './application/portfolio.js';
import { SeasonService } from './application/season.service.js';
import { CyclesModule } from './cycles.module.js';
import { ArenaRepository } from './infrastructure/arena.repository.js';
import { LlmGateway } from './infrastructure/llm-gateway.js';
import { LlmIoArchive } from './infrastructure/llm-io.archive.js';

// O motor de decisão da arena (etapa 6): o sched-cycle publica uma `decide` por modelo, e o job-worker-decisions (papel
// `decide`) trata uma por execução. O worker-data não consome a fila `decisions`. Detalhes em docs/ARENA.md e docs/JOBS.md.
@Module({
  imports: [MessagingModule, MarketDataModule, BriefingModule, CyclesModule],
  providers: [
    ArenaRepository,
    LlmIoArchive,
    { provide: LlmGateway, inject: [ENV], useFactory: (env: Env) => new LlmGateway(env) },
    {
      provide: CycleCloser,
      inject: [ArenaRepository],
      useFactory: (repo: ArenaRepository) => new CycleCloser(repo),
    },
    {
      provide: CycleSchedulers,
      inject: [MessagingService, TradingCalendar, ArenaRepository, ENV, CycleCloser],
      useFactory: (
        messaging: MessagingService,
        calendar: TradingCalendar,
        repo: ArenaRepository,
        env: Env,
        closer: CycleCloser,
      ) => new CycleSchedulers({ messaging, calendar, repo, env, closer }),
    },
    {
      provide: DecideHandler,
      inject: [
        JobRunStore,
        ArenaRepository,
        BriefingArchive,
        BriefingRepository,
        TradingCalendar,
        LlmGateway,
        LlmIoArchive,
        ENV,
      ],
      useFactory: (
        jobs: JobRunStore,
        repo: ArenaRepository,
        briefings: BriefingArchive,
        bars: BriefingRepository,
        calendar: TradingCalendar,
        gateway: LlmGateway,
        io: LlmIoArchive,
        env: Env,
      ) =>
        new DecideHandler({
          jobs,
          repo,
          briefings,
          bars,
          calendar,
          // a carteira da última liquidação antes do pregão (etapa 7; application/portfolio.ts)
          readPortfolio: settledPortfolioReader({ repo, calendar }),
          gateway,
          io,
          env,
        }),
    },
    {
      provide: SeasonService,
      inject: [ArenaRepository, TradingCalendar],
      useFactory: (repo: ArenaRepository, calendar: TradingCalendar) =>
        new SeasonService(repo, calendar),
    },
  ],
  exports: [CycleSchedulers, DecideHandler, CycleCloser, SeasonService, ArenaRepository],
})
export class ArenaModule {}
