import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { BLOB_SERVICE_CLIENT } from '../../infrastructure/storage/blob-client.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { JobRunStore } from '../messaging/infrastructure/job-run.store.js';
import { MessagingService } from '../messaging/infrastructure/messaging.service.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { BackupVerifyHandler } from './application/backup-verify.handler.js';
import { MaintenanceQueueHandler } from './application/maintenance-queue.handler.js';
import { MaintenanceSchedulers } from './application/maintenance-schedulers.js';
import { RetentionHandler } from './application/retention.handler.js';
import { RetentionRepository } from './infrastructure/retention.repository.js';
import type { BlobServiceClient } from '@azure/storage-blob';

// A fila `maintenance` (etapa 10, onda 3d; docs/JOBS.md, seção 8): o worker-data consome com o MaintenanceQueueHandler, que despacha a
// `retention` (a limpeza que a política de privacidade promete, mais os job_run do `fetch`) e o `backup-verify` (o dump que se prova
// restaurável); o sched-retention e o sched-backup só publicam (MaintenanceSchedulers). O cliente do Blob é o do módulo de mercado (o
// mesmo dos arquivos de briefing e de IO bruto das LLMs). O backup-verify usa o login ADMINISTRADOR (o DATABASE_URL do worker): cria o banco
// temporário e restaura nele.
@Module({
  imports: [MessagingModule, MarketDataModule],
  providers: [
    RetentionRepository,
    {
      provide: RetentionHandler,
      inject: [JobRunStore, RetentionRepository],
      useFactory: (jobs: JobRunStore, repo: RetentionRepository) =>
        new RetentionHandler(jobs, repo),
    },
    {
      provide: BackupVerifyHandler,
      inject: [JobRunStore, BLOB_SERVICE_CLIENT, ENV],
      useFactory: (jobs: JobRunStore, blob: BlobServiceClient | undefined, env: Env) =>
        new BackupVerifyHandler({ jobs, blob, databaseUrl: env.DATABASE_URL }),
    },
    {
      provide: MaintenanceQueueHandler,
      inject: [RetentionHandler, BackupVerifyHandler],
      useFactory: (retention: RetentionHandler, backup: BackupVerifyHandler) =>
        new MaintenanceQueueHandler(retention, backup),
    },
    {
      provide: MaintenanceSchedulers,
      inject: [MessagingService],
      useFactory: (messaging: MessagingService) => new MaintenanceSchedulers(messaging),
    },
  ],
  exports: [MaintenanceQueueHandler, MaintenanceSchedulers],
})
export class MaintenanceModule {}
