import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { JobRunStore } from './infrastructure/job-run.store.js';
import { MessagingService, SERVICE_BUS_CLIENT } from './infrastructure/messaging.service.js';
import { createServiceBusClient } from './infrastructure/service-bus-client.js';

@Module({
  providers: [
    {
      provide: SERVICE_BUS_CLIENT,
      inject: [ENV],
      // O cliente só abre conexão no primeiro sender ou receiver. Sem connection string nem SERVICEBUS_FQDN fica
      // desligado (undefined) e o MessagingService falha com mensagem clara se alguém o usar.
      useFactory: (env: Env) => createServiceBusClient(env),
    },
    MessagingService,
    // a linha de job_run que torna cada handler de fila idempotente
    JobRunStore,
  ],
  exports: [MessagingService, JobRunStore],
})
export class MessagingModule {}
