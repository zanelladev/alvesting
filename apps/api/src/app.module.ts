import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { HealthModule } from './infrastructure/health/health.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { CyclesModule } from './modules/arena/cycles.module.js';
import { PortfolioModule } from './modules/portfolio/portfolio.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { QuotesModule } from './modules/quotes/quotes.module.js';

// Papel HTTP (src/main.ts). Os módulos de domínio entram aqui nas etapas seguintes: a etapa 6 trouxe a leitura do ciclo, a
// etapa 9, a API pública da arena (ranking, competidor, feed, notícias e ações), a 11, a conta (login, termos, /me), a 10 (parte 2),
// as rotas /admin e o painel, a 12, a carteira do usuário (/me/portfolio), e a rota interna de cotações do site (/interno, onda da brapi).
@Module({
  imports: [
    CoreModule,
    HealthModule,
    CyclesModule,
    PublicModule,
    QuotesModule,
    AccountModule,
    AdminModule,
    PortfolioModule,
  ],
})
export class AppModule {}
