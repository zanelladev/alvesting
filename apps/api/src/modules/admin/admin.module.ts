import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { AccountModule } from '../account/account.module.js';
import { CycleCloser } from '../arena/application/cycle-closer.js';
import { CycleSchedulers } from '../arena/application/cycle-schedulers.js';
import { SeasonService } from '../arena/application/season.service.js';
import { ArenaRepository } from '../arena/infrastructure/arena.repository.js';
import { TradingCalendar, loadTradingCalendar } from '../market-data/domain/trading-calendar.js';
import { JobRunStore } from '../messaging/infrastructure/job-run.store.js';
import { MessagingService } from '../messaging/infrastructure/messaging.service.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { SettlementPublisher } from '../settlement/application/settlement-publisher.js';
import { SettlementRepository } from '../settlement/infrastructure/settlement.repository.js';
import { ADMIN_CLOCK } from './admin.tokens.js';
import { AdminAudit } from './application/admin-audit.js';
import { AdminOpsService } from './application/admin-ops.service.js';
import { AdminReportsService } from './application/admin-reports.service.js';
import { AdminSeasonsService } from './application/admin-seasons.service.js';
import { AdminRepository } from './infrastructure/admin.repository.js';
import { AdminController } from './presentation/admin.controller.js';

// As rotas de admin e o painel da arena (etapa 10, parte 2; docs/API.md, seção 8). Só o papel HTTP carrega este módulo (app.module.ts).
// Reusa o que a arena e a liquidação já têm, sem importar o ArenaModule (que traz o gateway de LLM, com a chave do OpenRouter e o SDK
// das LLMs: a api, exposta à internet, não os tem) nem o SettlementModule/MarketDataModule (que trazem a saída para B3, brapi e o Blob):
// os repositórios são só consultas ao banco, sem estado, e entram aqui direto, como o SettlementModule já faz com os da arena. A api
// publica na fila (o reprocesso do ciclo e o reenvio da DLQ) com a identidade dela, que já tem Sender e Receiver no Service Bus.
//
// O evento corporativo NÃO reliquida na requisição: registra o evento, reabre o job da liquidação e publica a `settle` na fila, e o worker
// liquida (e revalida o site e limpa a borda, como em toda liquidação). Por isso a api não escreve nas tabelas de resultado da arena
// (ordens, execuções, posições, patrimônio, métricas, Monte Carlo e decisões) e o papel mínimo do Postgres dela (onda 3d, ADR 0028) não as
// alcança. As escritas da api por causa do admin são só: season e competitor (criar e editar o rascunho), prompt_version e cycle (o
// reprocesso), corporate_event, job_run (reabrir o settle) e audit_log; a matriz está em infrastructure/database/table-policy.ts.
@Module({
  imports: [AccountModule, MessagingModule],
  controllers: [AdminController],
  providers: [
    { provide: ADMIN_CLOCK, useValue: () => new Date() },
    { provide: TradingCalendar, useFactory: () => loadTradingCalendar() },
    ArenaRepository,
    SettlementRepository,
    AdminRepository,
    AdminAudit,
    {
      provide: CycleCloser,
      inject: [ArenaRepository],
      useFactory: (repo: ArenaRepository) => new CycleCloser(repo),
    },
    {
      provide: SeasonService,
      inject: [ArenaRepository, TradingCalendar],
      useFactory: (repo: ArenaRepository, calendar: TradingCalendar) =>
        new SeasonService(repo, calendar),
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
    // O evento corporativo reabre o job da liquidação e publica a `settle`; quem liquida é o worker (ADR 0028)
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
    AdminSeasonsService,
    AdminOpsService,
    AdminReportsService,
  ],
})
export class AdminModule {}
