import { Logger as NestLogger } from '@nestjs/common';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Logger } from 'nestjs-pino';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { queueHandlers, runDecide, runRole, runScheduler, runWorker, schedulers } from './role.js';
import { DecideHandler } from './modules/arena/application/decide.handler.js';
import { LlmGateway } from './modules/arena/infrastructure/llm-gateway.js';
import { EodHandler } from './modules/market-data/application/eod.handler.js';
import { SettleHandler } from './modules/settlement/application/settle.handler.js';
import { SettlementPublisher } from './modules/settlement/application/settlement-publisher.js';
import { DecideModule, SchedulerModule, WorkerModule } from './roles.module.js';

// Os papéis sem HTTP (worker, decide, schedule) sobem o contexto do Nest, logam o papel e fazem o que é deles:
// o decide recebe UMA mensagem da fila decisions, trata e sai (etapa 6), o worker consome as filas até o pedido de
// parada e o schedule publica a mensagem do agendador pedido e sai.
beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://alvesting:alvesting@localhost:25432/alvesting_dev');
  vi.stubEnv('LOG_LEVEL', 'silent');
  // o ambiente do teste não herda a infra do dev: sem Service Bus, sem Blob
  vi.stubEnv('SERVICEBUS_CONNECTION_STRING', '');
  vi.stubEnv('SERVICEBUS_FQDN', '');
  vi.stubEnv('STORAGE_CONNECTION_STRING', '');
  vi.stubEnv('STORAGE_BLOB_ENDPOINT', '');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('runRole', () => {
  it('decide sem Service Bus falha dizendo o que falta, em vez de sair como se não houvesse mensagem', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await expect(runRole('decide')).rejects.toThrow(/Service Bus não configurado/);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'decide' }),
      expect.any(String),
    );
  }, 30_000);

  it('schedule retention e backup (etapa 10) têm código: sem Service Bus falham dizendo o que falta, em vez de fingir que publicaram', async () => {
    for (const name of ['retention', 'backup']) {
      await expect(runRole('schedule', { argv: [name] })).rejects.toThrow(
        /Service Bus não configurado/,
      );
    }
  }, 30_000);

  it('schedule sem Service Bus: o universe falha dizendo o que falta, em vez de fingir que publicou', async () => {
    await expect(runRole('schedule', { argv: ['universe'] })).rejects.toThrow(
      /Service Bus não configurado.*SERVICEBUS_FQDN/s,
    );
  }, 30_000);

  it('schedule com nome desconhecido ou sem nome falha com a lista dos válidos', async () => {
    await expect(runRole('schedule', { argv: ['limpeza'] })).rejects.toThrow(
      /Agendador desconhecido: limpeza.*eod/s,
    );
    await expect(runRole('schedule', { argv: [] })).rejects.toThrow(/\(nenhum\)/);
  }, 30_000);

  it('worker sem Service Bus falha ao subir, em vez de ficar de pé sem consumir nada', async () => {
    await expect(runRole('worker')).rejects.toThrow(/Service Bus não configurado/);
  }, 30_000);

  it('falha com mensagem clara quando o ambiente está inválido', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expect(runRole('worker')).rejects.toThrow(
      /Variáveis de ambiente inválidas.*DATABASE_URL/s,
    );
  });
});

describe('fiação dos papéis (etapas 4 a 7 e 10)', () => {
  it('o worker consome as filas market, news, briefing, settlement e maintenance, cada uma com função (mensagem) => Promise', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    try {
      const handlers = queueHandlers(app);
      expect(handlers.map(([queue]) => queue)).toEqual([
        'market',
        'news',
        'briefing',
        'settlement',
        'maintenance',
      ]);
      for (const [, handler] of handlers) expect(typeof handler).toBe('function');
    } finally {
      await app.close();
    }
  }, 30_000);

  it('o encadeamento eod -> settle está ligado no eod do worker (e a liquidação não leva o gateway de LLM junto)', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    try {
      expect(Reflect.get(app.get(EodHandler), 'settlement')).toBeInstanceOf(SettlementPublisher);
      expect(typeof app.get(SettleHandler).handle).toBe('function');
      expect(() => app.get(LlmGateway)).toThrow(); // o prompt e a chave do OpenRouter são só do job de decisões
    } finally {
      await app.close();
    }
  }, 30_000);

  it('o schedule conhece os sete agendadores que a infra cria: eod, universe, news, briefing, cycle, retention e backup', async () => {
    const app = await NestFactory.createApplicationContext(SchedulerModule, { logger: false });
    try {
      expect(Object.keys(schedulers(app)).sort()).toEqual([
        'backup',
        'briefing',
        'cycle',
        'eod',
        'news',
        'retention',
        'universe',
      ]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('o job de decisões monta o handler da decisão (e o worker-data não consome a fila decisions)', async () => {
    const app = await NestFactory.createApplicationContext(DecideModule, { logger: false });
    try {
      expect(typeof app.get(DecideHandler).handle).toBe('function');
    } finally {
      await app.close();
    }
    const worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    try {
      expect(queueHandlers(worker).map(([queue]) => queue)).not.toContain('decisions');
    } finally {
      await worker.close();
    }
  }, 30_000);

  it('schedule cycle num dia sem pregão não toca em banco nem em fila (domingo 01/11/2026)', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T11:00:00Z'), toFake: ['Date'] });
    try {
      await expect(runRole('schedule', { argv: ['cycle'] })).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);

  it('schedule news sem Service Bus falha dizendo o que falta, em vez de fingir que publicou', async () => {
    await expect(runRole('schedule', { argv: ['news'] })).rejects.toThrow(
      /Service Bus não configurado/,
    );
  }, 30_000);

  it('schedule briefing num pregão sem Service Bus falha dizendo o que falta', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-30T10:30:00Z'), toFake: ['Date'] });
    try {
      await expect(runRole('schedule', { argv: ['briefing'] })).rejects.toThrow(
        /Service Bus não configurado/,
      );
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
});

describe('runWorker', () => {
  const consumer = () => ({ close: vi.fn(() => Promise.resolve()) });
  const handler = () => Promise.resolve();

  it('consome cada fila com o seu handler e fecha os consumidores quando mandam parar', async () => {
    const a = consumer();
    const b = consumer();
    const consume = vi.fn().mockReturnValueOnce(a).mockReturnValueOnce(b);
    const stop = new AbortController();
    vi.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);

    const running = runWorker(
      { consume },
      [
        ['market', handler],
        ['news', handler],
      ],
      stop.signal,
    );
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(2));
    expect(consume).toHaveBeenNthCalledWith(1, 'market', handler);
    expect(consume).toHaveBeenNthCalledWith(2, 'news', handler);
    expect(a.close).not.toHaveBeenCalled(); // segue consumindo

    stop.abort();
    await running;
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it('para ao receber SIGTERM do Container Apps', async () => {
    const a = consumer();
    vi.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    const running = runWorker({ consume: vi.fn().mockReturnValue(a) }, [['market', handler]]);
    await Promise.resolve();
    process.emit('SIGTERM');
    await running;
    expect(a.close).toHaveBeenCalledTimes(1);
  });

  it('um consumidor que não fecha não impede os outros de fechar', async () => {
    const broken = { close: vi.fn(() => Promise.reject(new Error('conexão caiu'))) };
    const fine = consumer();
    const stop = new AbortController();
    vi.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    const running = runWorker(
      { consume: vi.fn().mockReturnValueOnce(broken).mockReturnValueOnce(fine) },
      [
        ['market', handler],
        ['news', handler],
      ],
      stop.signal,
    );
    stop.abort();
    await expect(running).resolves.toBeUndefined();
    expect(fine.close).toHaveBeenCalledTimes(1);
  });

  it('sinal já abortado: consome e para na hora', async () => {
    const a = consumer();
    vi.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    await runWorker(
      { consume: vi.fn().mockReturnValue(a) },
      [['market', handler]],
      AbortSignal.abort(),
    );
    expect(a.close).toHaveBeenCalledTimes(1);
  });

  it('se a fila não abre, a falha sobe', async () => {
    const consume = vi.fn(() => {
      throw new Error('Service Bus não configurado');
    });
    await expect(runWorker({ consume }, [['market', handler]])).rejects.toThrow(/não configurado/);
  });
});

// O job por evento: uma mensagem por execução (docs/JOBS.md, 3.2).
describe('runDecide', () => {
  const handler = () => Promise.resolve();

  it('busca UMA mensagem da fila decisions, com o handler da decisão', async () => {
    vi.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    const receiveOne = vi.fn(() => Promise.resolve('complete' as const));
    await expect(runDecide({ receiveOne }, handler)).resolves.toBe('processed');
    expect(receiveOne).toHaveBeenCalledExactlyOnceWith('decisions', handler);
  });

  it('nova tentativa agendada e DLQ também saem com 0: a fila cuida do resto', async () => {
    vi.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    for (const outcome of ['retry', 'deadletter', 'abandon'] as const) {
      await expect(
        runDecide({ receiveOne: () => Promise.resolve(outcome) }, handler),
      ).resolves.toBe('processed');
    }
  });

  it('fila vazia (outra execução levou a mensagem): sai sem erro e avisa', async () => {
    const log = vi.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    await expect(runDecide({ receiveOne: () => Promise.resolve('empty') }, handler)).resolves.toBe(
      'empty',
    );
    expect(log).toHaveBeenCalledWith({ outcome: 'empty' }, expect.stringContaining('fila vazia'));
  });

  it('erro de verdade (broker, trava perdida) sobe: o job sai com 1 e a mensagem volta quando a trava vence', async () => {
    await expect(
      runDecide({ receiveOne: () => Promise.reject(new Error('trava perdida')) }, handler),
    ).rejects.toThrow(/trava perdida/);
  });
});

describe('runScheduler: o span do job agendado', () => {
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();
  });
  afterEach(() => exporter.reset());

  // O job agendado não tem requisição nem mensagem que abra um trace: sem este span a consulta ao banco e a publicação na fila dele
  // (que só viram telemetria dentro de um span) ficariam de fora do Application Insights.
  it('cada execução é um span "schedule <nome>" (a requisição do job), OK no sucesso e ERROR na falha, que continua subindo', async () => {
    await runScheduler('eod', { eod: () => Promise.resolve() });
    await expect(
      runScheduler('news', { news: () => Promise.reject(new Error('Service Bus fora')) }),
    ).rejects.toThrow(/Service Bus fora/);
    const [ok, failed] = exporter.getFinishedSpans();
    expect(ok).toMatchObject({ name: 'schedule eod', kind: SpanKind.SERVER });
    expect(ok?.status.code).toBe(SpanStatusCode.OK);
    expect(ok?.attributes).toMatchObject({
      'alvesting.job.name': 'eod',
      'ai.operation.name': 'schedule eod',
    });
    expect(failed).toMatchObject({ name: 'schedule news' });
    expect(failed?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('nome desconhecido não abre span', async () => {
    await expect(runScheduler('briefng', {})).rejects.toThrow();
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});

describe('runScheduler', () => {
  it('roda o agendador pedido com o relógio dado e só ele', async () => {
    const eod = vi.fn(() => Promise.resolve());
    const universe = vi.fn(() => Promise.resolve());
    const now = new Date('2026-11-04T00:30:00Z');
    await runScheduler('eod', { eod, universe }, now);
    expect(eod).toHaveBeenCalledWith(now);
    expect(universe).not.toHaveBeenCalled();
  });

  it('a falha do agendador sobe (o job do Container Apps tenta de novo)', async () => {
    const eod = vi.fn(() => Promise.reject(new Error('Service Bus fora')));
    await expect(runScheduler('eod', { eod })).rejects.toThrow(/Service Bus fora/);
  });

  // `table[name]` achava toString, constructor e companhia na cadeia de protótipos: um erro de digitação no
  // argumento do job virava "sucesso" silencioso, exatamente o que a lista de nomes conhecidos quer evitar.
  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'chave herdada de Object.prototype (%s) não é agendador: falha com a lista dos válidos',
    async (name) => {
      await expect(runScheduler(name, {})).rejects.toThrow(
        new RegExp(`Agendador desconhecido: ${name}`),
      );
    },
  );

  // Os sete agendadores têm código desde a etapa 10: não sobra "nome conhecido sem código" que avise e saia com 0. Nome fora da tabela falha
  // com a lista dos que existem.
  it('o nome que não está na tabela falha dizendo os que existem; retention e backup, que já foram avisos, também são nomes da tabela', async () => {
    await expect(runScheduler('briefng', { eod: () => Promise.resolve() })).rejects.toThrow(
      /desconhecido: briefng.*eod/s,
    );
    await expect(runScheduler(undefined, {})).rejects.toThrow(/\(nenhum\)/);
    const retention = vi.fn(() => Promise.resolve());
    await runScheduler('retention', { retention });
    expect(retention).toHaveBeenCalledTimes(1);
    await expect(runScheduler('backup', {})).rejects.toThrow(/Agendador desconhecido: backup/);
  });
});
