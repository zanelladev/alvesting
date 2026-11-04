import { Logger as NestLogger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SpanKind } from '@opentelemetry/api';
import { Logger } from 'nestjs-pino';
import type { QueueName } from '@alvesting/contracts';
import { CycleSchedulers } from './modules/arena/application/cycle-schedulers.js';
import { DecideHandler } from './modules/arena/application/decide.handler.js';
import type { QueueHandler } from './modules/messaging/application/handle-delivery.js';
import { MessagingService } from './modules/messaging/infrastructure/messaging.service.js';
import { BriefingSchedulers } from './modules/briefing/application/briefing-schedulers.js';
import { FreezeHandler } from './modules/briefing/application/freeze.handler.js';
import { MaintenanceQueueHandler } from './modules/maintenance/application/maintenance-queue.handler.js';
import { MaintenanceSchedulers } from './modules/maintenance/application/maintenance-schedulers.js';
import { MarketQueueHandler } from './modules/market-data/application/market-queue.handler.js';
import { MarketSchedulers } from './modules/market-data/application/market-schedulers.js';
import { FetchHandler } from './modules/news/application/fetch.handler.js';
import { NewsSchedulers } from './modules/news/application/news-schedulers.js';
import { SettleHandler } from './modules/settlement/application/settle.handler.js';
import { DecideModule, SchedulerModule, WorkerModule } from './roles.module.js';
import { inSpan } from './telemetry/instruments.js';

export type Role = 'worker' | 'decide' | 'schedule';

export interface RoleOptions {
  // argumentos do comando (node dist/schedule.js <nome>); o padrão é process.argv
  argv?: string[];
  // encerra o worker (os testes); em produção quem encerra é o SIGTERM do Container Apps
  signal?: AbortSignal;
}

// As filas que o worker-data consome e o handler de cada uma (plano 5.5). `decisions` não está aqui: é do job de decisões.
export const queueHandlers = (app: INestApplicationContext): Array<[QueueName, QueueHandler]> => [
  ['market', app.get(MarketQueueHandler).handle],
  ['news', app.get(FetchHandler).handle],
  ['briefing', app.get(FreezeHandler).handle],
  ['settlement', app.get(SettleHandler).handle],
  ['maintenance', app.get(MaintenanceQueueHandler).handle],
];

// Os agendadores por nome, o argumento do comando de cada job (docs/JOBS.md, seção 1). Só publicam mensagens.
export type SchedulerTable = Record<string, (now: Date) => Promise<unknown>>;

export const schedulers = (app: INestApplicationContext): SchedulerTable => {
  const market = app.get(MarketSchedulers);
  const news = app.get(NewsSchedulers);
  const briefing = app.get(BriefingSchedulers);
  const cycle = app.get(CycleSchedulers);
  const maintenance = app.get(MaintenanceSchedulers);
  return {
    eod: (now) => market.eod(now),
    universe: (now) => market.universe(now),
    news: (now) => news.news(now),
    briefing: (now) => briefing.briefing(now),
    cycle: (now) => cycle.cycle(now),
    retention: (now) => maintenance.retention(now),
    backup: (now) => maintenance.backup(now),
  };
};

export async function runScheduler(
  name: string | undefined,
  table: SchedulerTable,
  now: Date = new Date(),
): Promise<void> {
  // hasOwn: `table[name]` também acharia toString, constructor e as outras chaves de Object.prototype
  const job = name !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;
  if (job) {
    // O job agendado não tem requisição nem mensagem: este span é a "requisição" dele no Application Insights, e as consultas ao
    // Postgres e as publicações na fila viram filhas dele (sem pai elas nem entram na telemetria).
    await inSpan(
      `schedule ${name}`,
      { kind: SpanKind.SERVER, attributes: { 'alvesting.job.name': String(name) } },
      () => job(now),
    );
    return;
  }
  // Os sete jobs que a infra cria (infra/modules/containerapps.bicep) têm código desde a etapa 10: um nome fora da tabela é erro de digitação
  // no comando do job e falha, em vez de sair com 0 como se tivesse publicado.
  throw new Error(
    `Agendador desconhecido: ${name ?? '(nenhum)'}. Use: node dist/schedule.js <${Object.keys(table).join('|')}>`,
  );
}

// Espera o pedido de parada: SIGTERM (o Container Apps ao reduzir réplicas), SIGINT (Ctrl+C) ou o sinal dos testes.
function untilStopped(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
      signal?.removeEventListener('abort', stop);
      resolve();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
}

// O worker-data: consome as filas até o pedido de parada. Cada consumidor para de pedir mensagens, espera os
// handlers em curso terminarem (até DRAIN_TIMEOUT_MS, abaixo do terminationGracePeriodSeconds de 300 s) e só então
// fecha o receiver, para o complete ainda achar o link aberto (o SDK não espera por conta própria; ver
// MessagingService.consume). A mensagem que passar do prazo volta pela trava expirada, e a linha de job_run barra
// a repetição.
export async function runWorker(
  messaging: Pick<MessagingService, 'consume'>,
  handlers: Array<[QueueName, QueueHandler]>,
  signal?: AbortSignal,
): Promise<void> {
  const consumers = handlers.map(([queue, handler]) => messaging.consume(queue, handler));
  new NestLogger('Worker').log({ queues: handlers.map(([queue]) => queue) }, 'consumindo as filas');
  await untilStopped(signal);
  await Promise.allSettled(consumers.map((consumer) => consumer.close()));
}

// O job por evento (job-worker-decisions): recebe UMA mensagem `decide` da fila decisions, trata e sai. O KEDA abre uma execução
// por mensagem; se outra execução já levou a mensagem, a fila está vazia e esta sai sem fazer nada. O resultado não vira código
// de saída: tentativa agendada e DLQ também saem com 0 (a fila cuida da nova tentativa, docs/JOBS.md). Só erro de verdade
// (broker fora, trava perdida) sobe, e a mensagem volta quando a trava vence.
export async function runDecide(
  messaging: Pick<MessagingService, 'receiveOne'>,
  handler: QueueHandler,
): Promise<'empty' | 'processed'> {
  const outcome = await messaging.receiveOne('decisions', handler);
  new NestLogger('Decide').log(
    { outcome },
    outcome === 'empty' ? 'fila vazia: outra execução levou a mensagem' : 'mensagem tratada',
  );
  return outcome === 'empty' ? 'empty' : 'processed';
}

const MODULES = { worker: WorkerModule, decide: DecideModule, schedule: SchedulerModule } as const;

export async function runRole(role: Role, options: RoleOptions = {}): Promise<void> {
  // abortOnError: false faz erro de boot (ex.: ambiente inválido) virar exceção, não process.abort().
  const app = await NestFactory.createApplicationContext(MODULES[role], {
    bufferLogs: true,
    abortOnError: false,
  });
  try {
    const logger = app.get(Logger);
    app.useLogger(logger);
    logger.log({ role }, 'papel iniciado');
    if (role === 'worker') {
      await runWorker(app.get(MessagingService), queueHandlers(app), options.signal);
    } else if (role === 'schedule') {
      await runScheduler((options.argv ?? process.argv.slice(2))[0], schedulers(app));
    } else {
      await runDecide(app.get(MessagingService), app.get(DecideHandler).handle);
    }
  } finally {
    await app.close();
  }
}

// Ponto de entrada dos papéis: sai com 0 no sucesso e com 1 (e o erro no stderr) na falha.
export function exitAfter(role: Role): void {
  runRole(role).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
