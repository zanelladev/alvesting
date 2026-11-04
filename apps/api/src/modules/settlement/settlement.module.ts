import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { CycleCloser } from '../arena/application/cycle-closer.js';
import { ArenaRepository } from '../arena/infrastructure/arena.repository.js';
import { TradingCalendar } from '../market-data/domain/trading-calendar.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { JobRunStore } from '../messaging/infrastructure/job-run.store.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { CacheRefresher } from './application/cache-refresher.js';
import { SettleHandler } from './application/settle.handler.js';
import { SettlementRepository } from './infrastructure/settlement.repository.js';

// A liquidação (etapa 7): o worker-data consome a fila `settlement` com o SettleHandler (o role.ts o pega por app.get, então o
// módulo não exporta nada). O comando settle:event monta o CorporateEventService à mão (settlement-cli.ts); a rota do admin da
// etapa 10 é quem o registra aqui, quando existir. Quem publica o `settle` depois do eod é o SettlementPublisher, que mora no
// MarketDataModule (o eod o recebe). Não importa o ArenaModule de propósito: ele traz o gateway de LLM, e o worker-data não tem o
// prompt nem a chave do OpenRouter. O ArenaRepository e o CycleCloser são só consultas ao banco, sem estado: entram aqui direto,
// e o ArenaRepository também no MarketDataModule e no ArenaModule. São instâncias independentes de propósito.
@Module({
  imports: [MessagingModule, MarketDataModule],
  providers: [
    ArenaRepository,
    SettlementRepository,
    {
      provide: CycleCloser,
      inject: [ArenaRepository],
      useFactory: (arena: ArenaRepository) => new CycleCloser(arena),
    },
    // Depois de cada liquidação: revalida o site e limpa o Front Door (WEB_INTERNAL_URL, REVALIDATE_SECRET e
    // FRONT_DOOR_ENDPOINT_ID, que só o worker-data recebe). Sem as variáveis cada passo é pulado.
    {
      provide: CacheRefresher,
      inject: [ENV],
      useFactory: (env: Env) => new CacheRefresher({ env }),
    },
    {
      provide: SettleHandler,
      inject: [
        JobRunStore,
        ArenaRepository,
        CycleCloser,
        SettlementRepository,
        TradingCalendar,
        CacheRefresher,
      ],
      useFactory: (
        jobs: JobRunStore,
        arena: ArenaRepository,
        closer: CycleCloser,
        repo: SettlementRepository,
        calendar: TradingCalendar,
        cache: CacheRefresher,
      ) => new SettleHandler({ jobs, arena, closer, repo, calendar, cache }),
    },
  ],
})
export class SettlementModule {}
