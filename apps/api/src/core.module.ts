import { Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { httpLogOptions } from './common/http-log.js';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { MessagingModule } from './modules/messaging/messaging.module.js';
import { stopTelemetry } from './telemetry/telemetry.js';

// Esvazia a telemetria e a desliga quando o contexto fecha (SIGTERM da api, o fim de um job). O job sai com `process.exit` logo depois
// do `app.close()`, e o que estivesse na fila de envio ao Application Insights se perderia. Sem a connection string não há nada a
// desligar (telemetry.ts). Com prazo: o Application Insights fora do ar não prende o encerramento.
@Injectable()
export class TelemetryShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await stopTelemetry();
  }
}

// O que os quatro papéis (http, worker, decide, schedule) têm em comum: ambiente validado,
// logs Pino, banco e filas. Cada papel acrescenta o que é dele em cima disto.
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      // Lista branca de campos no log de requisição: ver common/http-log.ts.
      useFactory: (env: Env) => ({ pinoHttp: httpLogOptions(env.LOG_LEVEL) }),
    }),
    DatabaseModule,
    MessagingModule,
  ],
  providers: [TelemetryShutdown],
})
export class CoreModule {}
