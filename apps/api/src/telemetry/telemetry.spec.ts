import { readFileSync } from 'node:fs';
import {
  Logger,
  NotFoundException,
  UnauthorizedException,
  type ArgumentsHost,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { metrics, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../common/all-exceptions.filter.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import { zipOf } from '../infrastructure/zip/zip.fixture.js';
import { JobRunStore } from '../modules/messaging/infrastructure/job-run.store.js';
import { parseRss } from '../modules/news/domain/rss.js';
import { fetchLimited } from '../modules/news/infrastructure/source-http.js';
import { csvRecords, type CsvOptions } from '../modules/news/infrastructure/zip-csv.js';
import {
  ALERT_LOG,
  ALERT_SIGNAL,
  API_5XX_MAX_PERCENT,
  HOLD_FORCED_MAX_PER_SESSION,
  NEWS_FAILED_ATTEMPTS_TOLERATED,
  NEWS_SECURITY_MARKERS,
} from './alert-logs.js';
import {
  inSpan,
  recordCycleDuration,
  recordInvalid,
  recordLlmUsage,
  setServerRoute,
} from './instruments.js';
import { TelemetryShutdown } from '../core.module.js';
import { SanitizingSpanProcessor } from './sanitize.js';
import {
  azureMonitorOptions,
  httpInstrumentationOptions,
  roleOf,
  startTelemetry,
  stopTelemetry,
} from './telemetry.js';

// um ponto de dados das métricas em memória, só com o que os testes leem
type Point = { attributes: Record<string, unknown>; value: unknown };

const CONNECTION =
  'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=http://127.0.0.1:9/';

describe('roleOf: o papel pelo comando', () => {
  it.each([
    [['node', '/app/dist/main.js'], 'api'],
    [['node', '/app/dist/worker.js'], 'worker'],
    [['node', '/app/dist/decide.js'], 'decide'],
    [['node', '/app/dist/schedule.js', 'eod'], 'sched-eod'],
    [['node', '/app/dist/schedule.js'], 'sched'],
    [['node', '/app/dist/schedule.js', 'não é nome'], 'sched'],
    [['node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'], undefined],
    [['node', '/app/dist/account-cli.js', 'promote', 'pessoa@example.test'], undefined],
    [['node'], undefined],
  ])('%j -> %s', (argv, expected) => {
    expect(roleOf(argv)).toBe(expected);
  });
});

describe('azureMonitorOptions: o que a Azure recebe', () => {
  const options = azureMonitorOptions();
  const instrumentation = options.instrumentationOptions ?? {};

  it('não duplica os logs: nenhuma instrumentação de log e nenhum processador de log', () => {
    expect(instrumentation.bunyan?.enabled).toBe(false);
    expect(instrumentation.winston?.enabled).toBe(false);
    expect(instrumentation.console?.enabled).toBe(false);
    expect(options.logRecordProcessors ?? []).toEqual([]);
  });

  it('liga o que o plano pede (requisição, Postgres, SDK da Azure) e desliga o resto', () => {
    expect(instrumentation.http?.enabled).toBe(true);
    expect(instrumentation.postgreSql?.enabled).toBe(true);
    expect(instrumentation.azureSdk?.enabled).toBe(true);
    expect(instrumentation.mongoDb?.enabled).toBe(false);
    expect(instrumentation.mySql?.enabled).toBe(false);
    expect(instrumentation.redis?.enabled).toBe(false);
    expect(options.enableLiveMetrics).toBe(false);
    expect(options.enablePerformanceCounters).toBe(false);
    expect(options.browserSdkLoaderOptions?.enabled).toBe(false);
  });

  it('o SQL vai sem valores e a sonda do Front Door não vira telemetria', () => {
    // as mesmas opções que o teste de integração usa para instrumentar de verdade
    expect(instrumentation.http).toMatchObject({
      enabled: true,
      requireParentforOutgoingSpans: true,
    });
    expect(instrumentation.postgreSql).toMatchObject({
      enhancedDatabaseReporting: false,
      addSqlCommenterCommentToQueries: false,
      requireParentSpan: true,
    });
    const ignore = httpInstrumentationOptions().ignoreIncomingRequestHook;
    expect(ignore?.({ url: '/health', method: 'GET' } as never)).toBe(true);
    expect(ignore?.({ url: '/api/v1/health', method: 'GET' } as never)).toBe(true);
    expect(ignore?.({ url: '/api/v1/health/stream', method: 'GET' } as never)).toBe(false);
    expect(ignore?.({ url: '/api/v1/seasons', method: 'GET' } as never)).toBe(false);
  });

  it('o sanitizador vai no pipeline do SDK', () => {
    expect(options.spanProcessors?.some((p) => p instanceof SanitizingSpanProcessor)).toBe(true);
  });
});

describe('startTelemetry', () => {
  afterEach(async () => {
    await stopTelemetry();
  });

  it('sem connection string nada é carregado, exportado nem pedido à rede', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const loadDistro = vi.fn();
    for (const value of [undefined, '', '   ']) {
      const started = await startTelemetry(['node', '/app/dist/main.js'], {
        env: { APPLICATIONINSIGHTS_CONNECTION_STRING: value },
        deps: { loadDistro },
      });
      expect(started).toBe(false);
    }
    expect(loadDistro).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('fora dos quatro papéis (migrate, comandos do operador) não liga, mesmo com a connection string', async () => {
    const loadDistro = vi.fn();
    const started = await startTelemetry(['node', '/app/dist/account-cli.js', 'promote'], {
      env: { APPLICATIONINSIGHTS_CONNECTION_STRING: CONNECTION },
      deps: { loadDistro },
    });
    expect(started).toBe(false);
    expect(loadDistro).not.toHaveBeenCalled();
  });

  it('com a connection string liga a distribuição uma vez, com o nome do papel, e o stop a desliga', async () => {
    const useAzureMonitor = vi.fn();
    const shutdownAzureMonitor = vi.fn(() => Promise.resolve());
    const registerExtras = vi.fn();
    const env: NodeJS.ProcessEnv = { APPLICATIONINSIGHTS_CONNECTION_STRING: CONNECTION };
    const started = await startTelemetry(['node', '/app/dist/schedule.js', 'eod'], {
      env,
      deps: {
        loadDistro: () => Promise.resolve({ useAzureMonitor, shutdownAzureMonitor }),
        registerExtras,
      },
    });
    expect(started).toBe(true);
    expect(useAzureMonitor).toHaveBeenCalledTimes(1);
    expect(registerExtras).toHaveBeenCalledTimes(1);
    expect(env.OTEL_SERVICE_NAME).toBe('alvesting-sched-eod');
    // a segunda chamada não liga de novo
    expect(
      await startTelemetry(['node', '/app/dist/main.js'], {
        env,
        deps: { loadDistro: () => Promise.resolve({ useAzureMonitor, shutdownAzureMonitor }) },
      }),
    ).toBe(false);
    await stopTelemetry();
    expect(shutdownAzureMonitor).toHaveBeenCalledTimes(1);
    await stopTelemetry();
    expect(shutdownAzureMonitor).toHaveBeenCalledTimes(1);
  });

  // O job que sai logo depois do `app.close()` (process.exit) perderia o que está na fila de envio: fechar o contexto do Nest esvazia
  // e desliga a telemetria, nos quatro papéis (o CoreModule é de todos).
  it('fechar o contexto do Nest esvazia e desliga a telemetria', async () => {
    const shutdownAzureMonitor = vi.fn(() => Promise.resolve());
    await startTelemetry(['node', '/app/dist/decide.js'], {
      env: { APPLICATIONINSIGHTS_CONNECTION_STRING: CONNECTION },
      deps: {
        loadDistro: () => Promise.resolve({ useAzureMonitor: vi.fn(), shutdownAzureMonitor }),
        registerExtras: vi.fn(),
      },
    });
    const moduleRef = await Test.createTestingModule({ providers: [TelemetryShutdown] }).compile();
    await moduleRef.init();
    expect(shutdownAzureMonitor).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(shutdownAzureMonitor).toHaveBeenCalledTimes(1);
  });

  // O SDK já roda quando o registro das instrumentações extras (o undici) falha: o stop tem de valer mesmo assim, ou o job que sai
  // logo depois (decide, schedule) perde o último lote de telemetria.
  it('se as instrumentações extras falham com a distribuição já ligada, o stop ainda a desliga', async () => {
    const shutdownAzureMonitor = vi.fn(() => Promise.resolve());
    await expect(
      startTelemetry(['node', '/app/dist/decide.js'], {
        env: { APPLICATIONINSIGHTS_CONNECTION_STRING: CONNECTION },
        deps: {
          loadDistro: () => Promise.resolve({ useAzureMonitor: vi.fn(), shutdownAzureMonitor }),
          registerExtras: () => Promise.reject(new Error('undici fora')),
        },
      }),
    ).rejects.toThrow('undici fora');
    await stopTelemetry();
    expect(shutdownAzureMonitor).toHaveBeenCalledTimes(1);
  });

  it('um desligamento que não termina é abandonado no prazo, sem lançar', async () => {
    const hang = () => new Promise<void>(() => undefined);
    await startTelemetry(['node', '/app/dist/worker.js'], {
      env: { APPLICATIONINSIGHTS_CONNECTION_STRING: CONNECTION },
      deps: {
        loadDistro: () => Promise.resolve({ useAzureMonitor: vi.fn(), shutdownAzureMonitor: hang }),
        registerExtras: vi.fn(),
      },
    });
    const started = Date.now();
    await expect(stopTelemetry(50)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('os alertas e o código leem o mesmo texto (infra/modules/alerts.bicep)', () => {
  // lido dentro de cada teste: um alerts.bicep ausente reprova estes e não derruba o arquivo inteiro
  const bicepText = () =>
    readFileSync(new URL('../../../../infra/modules/alerts.bicep', import.meta.url), 'utf8');

  it.each(Object.keys(ALERT_LOG) as Array<keyof typeof ALERT_LOG>)(
    'o Bicep cita a linha e o nome do sinal de %s por extenso',
    (key) => {
      const bicep = bicepText();
      expect(bicep).toContain(`"${ALERT_LOG[key]}"`);
      expect(bicep).toContain(`"${ALERT_SIGNAL[key]}"`);
    },
  );

  it('os limiares do Bicep são as constantes do código', () => {
    const bicep = bicepText();
    expect(bicep).toContain(`let holdMax = ${HOLD_FORCED_MAX_PER_SESSION};`);
    expect(bicep).toContain(`let newsTolerated = ${NEWS_FAILED_ATTEMPTS_TOLERATED};`);
    expect(bicep).toContain(`let apiErrorPercent = ${API_5XX_MAX_PERCENT};`);
  });

  it('o api-5xx lê o campo que o log de requisição escreve (res.statusCode, ver http-log.spec.ts), só nas linhas de requisição', () => {
    const bicep = bicepText();
    expect(bicep).toContain('toint(j.res.statusCode)');
    expect(bicep).toContain('isnotnull(j.res.statusCode)');
    expect(bicep).toContain('"api-5xx"');
  });

  it('o Bicep nomeia todos os sinais, inclusive o da falha de segurança da news, que reusa a linha do job falho', () => {
    const bicep = bicepText();
    for (const name of Object.values(ALERT_SIGNAL)) expect(bicep).toContain(`"${name}"`);
  });

  it('os nomes dos sinais são únicos e sem espaço', () => {
    const names = Object.values(ALERT_SIGNAL);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9-]+$/);
  });
});

// A falha de segurança da fila `news` (feed com DTD, host fora da lista, resposta grande demais, ZIP que passa do teto ou mente o
// tamanho, cabeçalho que mudou) tem alerta próprio (`news-seguranca`, no primeiro erro). A fila não tem código de erro: o alerta procura
// um trecho do motivo na linha `job_run falhou` (regex na consulta do Bicep). Cada falha abaixo é forçada com o código de verdade e passa
// pelo JobRunStore.fail: o trecho que o alerta procura tem de estar na linha que o contêiner escreve.
describe('news-seguranca: a falha de segurança da fila news alerta na primeira vez', () => {
  const FEED = 'https://feed.example.test/rss';
  const HOSTS = ['feed.example.test'];
  const limits = { allowedHosts: HOSTS, maxBytes: 1_000 };
  const reply = (status: number, body: string | null, headers: Record<string, string> = {}) =>
    (() => Promise.resolve(new Response(body, { status, headers }))) as typeof fetch;
  const IPE = /^ipe_cia_aberta_\d{4}\.csv$/;
  const csvOptions = { label: 'ipe_cia_aberta_AAAA.csv', maxInflatedBytes: 1_000_000 };
  const drain = async (zip: Buffer, options: Partial<CsvOptions> = {}): Promise<void> => {
    for await (const row of csvRecords(zip, IPE, { ...csvOptions, ...options })) void row;
  };
  const ipe = (text: string) => zipOf('ipe_cia_aberta_2026.csv', Buffer.from(text, 'latin1'));
  const lyingSize = () => {
    const zip = ipe(`CNPJ_Companhia;Assunto\r\n${'1;x\r\n'.repeat(500)}`);
    zip.writeUInt32LE(10, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    return zip;
  };

  const forced: Array<[string, () => Promise<unknown>]> = [
    [
      'feed com DTD',
      () => Promise.resolve().then(() => parseRss('<!DOCTYPE rss [<!ENTITY a "b">]><rss/>')),
    ],
    ['host fora da lista fixa', () => fetchLimited('https://fora.example.test/rss', limits)],
    [
      'redirecionamento para fora da lista',
      () =>
        fetchLimited(FEED, {
          ...limits,
          fetchFn: reply(302, null, { location: 'https://169.254.169.254/latest' }),
        }),
    ],
    [
      'redirecionamentos demais',
      () => fetchLimited(FEED, { ...limits, fetchFn: reply(302, null, { location: FEED }) }),
    ],
    [
      'resposta acima do teto',
      () => fetchLimited(FEED, { ...limits, fetchFn: reply(200, 'x'.repeat(2_000)) }),
    ],
    [
      'ZIP que, inflado, passa do teto',
      () => drain(zipOf('ipe_cia_aberta_2026.csv', Buffer.alloc(3_000_000, 'A'))),
    ],
    ['ZIP que declara o tamanho menor que o real', () => drain(lyingSize())],
    [
      'ZIP com o CRC32 trocado',
      () =>
        drain(zipOf('ipe_cia_aberta_2026.csv', Buffer.from('a;b\r\n1;2\r\n'), { crcOverride: 7 })),
    ],
    [
      'cabeçalho do IPE que mudou',
      () => drain(ipe('CNPJ;Assunto\r\n1;x\r\n'), { requiredColumns: ['CNPJ_Companhia'] }),
    ],
  ];
  const markers = new RegExp(NEWS_SECURITY_MARKERS.join('|'));

  // o motivo que JobRunStore.fail põe na linha `job_run falhou` da fila news
  async function loggedReason(error: unknown): Promise<string> {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const prisma = { jobRun: { updateMany: () => Promise.resolve({ count: 1 }) } };
    await new JobRunStore(prisma as unknown as PrismaService).fail(
      { id: 'job-1', attempt: 1, label: { queue: 'news', type: 'fetch', key: 'fetch:feed-a' } },
      error,
    );
    const [context, message] = logged.mock.calls[0] as unknown as [{ reason: string }, string];
    expect(message).toBe(ALERT_LOG.jobFailed);
    return context.reason;
  }

  afterEach(() => vi.restoreAllMocks());

  it.each(forced)(
    '%s: o motivo da linha job_run falhou casa com o que o alerta procura',
    async (_name, force) => {
      const error = await force().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect(await loggedReason(error)).toMatch(markers);
    },
  );

  it.each([
    new Error('HTTP 503 de feed.example.test'),
    new Error('fetch failed'),
    new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    new Error('XML mal formado (linha 3)'),
  ])(
    'queda de rede e feed quebrado (%s) NÃO é segurança: fica no job-falhou, da 3ª tentativa',
    async (error) => {
      expect(await loggedReason(error)).not.toMatch(markers);
    },
  );

  it('os trechos são texto simples (sem acento nem metacaractere), citados por extenso na consulta do Bicep', () => {
    for (const marker of NEWS_SECURITY_MARKERS)
      expect(marker).toMatch(/^[A-Za-z0-9][A-Za-z0-9 ]*$/);
    const bicep = readFileSync(
      new URL('../../../../infra/modules/alerts.bicep', import.meta.url),
      'utf8',
    );
    expect(bicep).toContain(`matches regex "${NEWS_SECURITY_MARKERS.join('|')}"`);
  });
});

describe('os spans do código', () => {
  const exporter = new InMemorySpanExporter();
  beforeAll(() => {
    new NodeTracerProvider({
      spanProcessors: [new SanitizingSpanProcessor(), new SimpleSpanProcessor(exporter)],
    }).register();
  });
  afterEach(() => exporter.reset());

  it('inSpan fecha o span com OK, devolve o valor e marca a fila como consumidor', async () => {
    const value = await inSpan(
      'process market',
      { kind: SpanKind.CONSUMER, attributes: { 'alvesting.queue': 'market', segredo: 'x' } },
      () => Promise.resolve(42),
    );
    expect(value).toBe(42);
    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.OK);
    expect(span?.kind).toBe(SpanKind.CONSUMER);
    expect(span?.attributes).toMatchObject({ 'alvesting.queue': 'market' });
    expect(span?.attributes).not.toHaveProperty('segredo');
  });

  it('inSpan registra a falha (sem dado pessoal), marca ERROR e repassa o erro', async () => {
    const boom = new Error('violação para pessoa@example.test de 203.0.113.9 ?token=abc123');
    await expect(inSpan('process news', {}, () => Promise.reject(boom))).rejects.toBe(boom);
    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    const text = JSON.stringify(span?.events);
    expect(text).toContain('exception');
    expect(text).not.toMatch(/pessoa@example|203\.0\.113|abc123/);
  });

  it('setServerRoute põe a rota no span ativo e ignora quando não há span nem rota', async () => {
    expect(() => setServerRoute('/api/v1/x')).not.toThrow();
    await inSpan('http', { kind: SpanKind.SERVER }, () => {
      setServerRoute('/api/v1/competitors/:slug');
      setServerRoute(undefined);
      return Promise.resolve();
    });
    expect(exporter.getFinishedSpans()[0]?.attributes).toMatchObject({
      'http.route': '/api/v1/competitors/:slug',
    });
  });

  it('setServerRoute ignora o que não é texto (a rota do Express pode ser regex ou faltar)', async () => {
    await inSpan('http', { kind: SpanKind.SERVER }, () => {
      for (const route of [42, null, {}, /^\/x$/, ['/a'], '']) setServerRoute(route);
      return Promise.resolve();
    });
    expect(exporter.getFinishedSpans()[0]?.attributes).not.toHaveProperty('http.route');
  });

  // O guard roda ANTES do EnvelopeInterceptor: a requisição que ele barra (401, 403) só chega ao filtro de exceções. Sem a rota dada ali
  // ela virava "GET (sem rota)", e é justamente a superfície autenticada (/me, depois /admin, carteira e chat) que falha com 401 e 403.
  it('o filtro de exceções dá a rota ao span da requisição que um guard barrou; o 404 sem rota fica sem ela', async () => {
    const respond = () => {
      const response = { headersSent: false, setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
      response.status.mockReturnValue(response);
      return response;
    };
    const hostOf = (route: unknown, response: object) =>
      ({
        switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ route }) }),
      }) as unknown as ArgumentsHost;
    const guarded = respond();
    await inSpan('http', { kind: SpanKind.SERVER }, () => {
      new AllExceptionsFilter().catch(
        new UnauthorizedException(),
        hostOf({ path: '/api/v1/me' }, guarded),
      );
      return Promise.resolve();
    });
    await inSpan('http', { kind: SpanKind.SERVER }, () => {
      new AllExceptionsFilter().catch(new NotFoundException(), hostOf(undefined, respond()));
      return Promise.resolve();
    });
    expect(guarded.status).toHaveBeenCalledWith(401);
    const [withRoute, withoutRoute] = exporter.getFinishedSpans();
    expect(withRoute?.attributes).toMatchObject({ 'http.route': '/api/v1/me' });
    expect(withoutRoute?.attributes).not.toHaveProperty('http.route');
  });
});

describe('as métricas próprias', () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  const provider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 })],
  });
  beforeAll(() => {
    metrics.setGlobalMeterProvider(provider);
  });
  afterEach(() => exporter.reset());

  async function collected(name: string): Promise<Point[]> {
    await provider.forceFlush();
    return exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === name)
      .flatMap((metric) => metric.dataPoints as unknown as Point[]);
  }
  const pointOf = (points: Point[], attributes: Record<string, string>) =>
    points.find((p) => Object.entries(attributes).every(([k, v]) => p.attributes[k] === v));

  it('llm.tokens: entrada e saída, por competidor e provedor', async () => {
    recordLlmUsage({
      competitor: 'fake-a',
      provider: 'fake',
      promptTokens: 1_000,
      completionTokens: 200,
      costMicroUsd: 10_000n,
    });
    const points = await collected('llm.tokens');
    expect(pointOf(points, { type: 'input', competitor: 'fake-a', provider: 'fake' })?.value).toBe(
      1_000,
    );
    expect(pointOf(points, { type: 'output', competitor: 'fake-a', provider: 'fake' })?.value).toBe(
      200,
    );
  });

  it('llm.cost_usd: o custo em micro-dólares vira dólares, e o zero do fake também aparece', async () => {
    recordLlmUsage({
      competitor: 'fake-a',
      provider: 'fake',
      promptTokens: 1,
      completionTokens: 1,
      costMicroUsd: 2_500n,
    });
    recordLlmUsage({
      competitor: 'fake-b',
      provider: 'fake',
      promptTokens: 1,
      completionTokens: 1,
      costMicroUsd: 0n,
    });
    const points = await collected('llm.cost_usd');
    expect(pointOf(points, { competitor: 'fake-a' })?.value).toBeCloseTo(0.0025, 9);
    expect(pointOf(points, { competitor: 'fake-b' })?.value).toBe(0);
  });

  it('decision.invalid: por motivo, com a contagem dada, sem ULID nos atributos', async () => {
    recordInvalid({ reason: 'resposta_invalida', competitor: 'fake-a', provider: 'fake' });
    recordInvalid({ reason: 'item_descartado', competitor: 'fake-a', provider: 'fake', count: 3 });
    recordInvalid({ reason: 'sem_resposta' });
    const points = await collected('decision.invalid');
    expect(pointOf(points, { reason: 'resposta_invalida', competitor: 'fake-a' })?.value).toBe(1);
    expect(pointOf(points, { reason: 'item_descartado' })?.value).toBe(3);
    expect(pointOf(points, { reason: 'sem_resposta' })?.value).toBe(1);
    for (const point of points) {
      expect(Object.keys(point.attributes).sort().join()).toMatch(
        /^(competitor,provider,reason|reason)$/,
      );
    }
  });

  it('cycle.duration: segundos da abertura ao fechamento; relógio torto não vira número ruim', async () => {
    recordCycleDuration(new Date('2026-11-03T11:00:05Z'), new Date('2026-11-03T11:02:35Z'));
    recordCycleDuration(new Date('2026-11-03T11:00:00Z'), new Date('2026-11-03T10:00:00Z'));
    recordCycleDuration(new Date('invalid'), new Date('2026-11-03T10:00:00Z'));
    const [point] = await collected('cycle.duration');
    const value = point?.value as { count: number; sum: number };
    // 150 s e o 0 do relógio ao contrário; a data inválida não conta
    expect(value.count).toBe(2);
    expect(value.sum).toBe(150);
  });
});
