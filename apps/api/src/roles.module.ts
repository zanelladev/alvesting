import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { ArenaModule } from './modules/arena/arena.module.js';
import { BriefingModule } from './modules/briefing/briefing.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { MarketDataModule } from './modules/market-data/market-data.module.js';
import { NewsModule } from './modules/news/news.module.js';
import { SettlementModule } from './modules/settlement/settlement.module.js';

// O que cada papel sem HTTP carrega além do CoreModule. Cada etapa acrescenta o seu módulo de domínio onde o
// papel usa: o worker consome as filas (etapas 4, 5, 7 e 10), os agendadores publicam (etapas 4, 5, 6 e 10) e o job de decisões
// trata uma mensagem `decide` por execução (etapa 6). A liquidação (etapa 7) é do worker-data, sem o gateway de LLM.
@Module({
  imports: [
    CoreModule,
    MarketDataModule,
    NewsModule,
    BriefingModule,
    SettlementModule,
    MaintenanceModule,
  ],
})
export class WorkerModule {}

@Module({
  imports: [
    CoreModule,
    MarketDataModule,
    NewsModule,
    BriefingModule,
    ArenaModule,
    MaintenanceModule,
  ],
})
export class SchedulerModule {}

// O job-worker-decisions: o único com o prompt da arena e a chave do OpenRouter (docs/INFRA.md, 2.7). Não carrega as notícias
// nem os agendadores.
@Module({ imports: [CoreModule, MarketDataModule, BriefingModule, ArenaModule] })
export class DecideModule {}
