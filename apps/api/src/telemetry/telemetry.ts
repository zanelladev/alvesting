import { basename, extname } from 'node:path';
import type { AzureMonitorOpenTelemetryOptions } from '@azure/monitor-opentelemetry';
import type { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';
import type { PgInstrumentationConfig } from '@opentelemetry/instrumentation-pg';
import type { UndiciInstrumentationConfig } from '@opentelemetry/instrumentation-undici';
import { SanitizingSpanProcessor } from './sanitize.js';

// OpenTelemetry para o Application Insights nos quatro papéis da api (plano 5.9; docs/INFRA.md, seção 5), pela distribuição da Azure
// (@azure/monitor-opentelemetry). Este módulo NÃO é importado pelos pontos de entrada (main, worker, decide, schedule): quem o liga é o
// `--import ./dist/telemetry/preload.js` do NODE_OPTIONS da imagem (apps/api/Dockerfile). A api é ESM, e a documentação da Azure
// ("ESM Support", README do pacote) manda registrar os ganchos de módulo ANTES de carregar qualquer biblioteca que ela instrumenta (pg,
// http, o SDK da Azure): `node --import @azure/monitor-opentelemetry/loader` e `useAzureMonitor()` antes de todo o resto. Um
// `import` no topo do main.ts não serve: o ESM carrega o grafo inteiro antes de executar a primeira linha.
//
// Sem APPLICATIONINSIGHTS_CONNECTION_STRING (dev, testes, e2e, o ensaio) este módulo não faz nada: não carrega a distribuição, não
// instrumenta nada e não pede nada à rede. Os testes nunca falam com o Application Insights: injetam `deps`.
//
// Logs: o Pino continua em JSON no stdout (o Container Apps os manda ao Log Analytics, ContainerAppConsoleLogs_CL). A distribuição só
// coleta log por bunyan, winston e console, que ficam desligados: o mesmo log não entra duas vezes (e não paga a ingestão em dobro).

type Options = AzureMonitorOpenTelemetryOptions;

// A sonda do Front Door bate no /health de cada POP a cada 30 s, e o Container Apps tem as suas: milhares de requisições por dia sem
// nenhum valor, mais que o resto da api junto (docs/INFRA.md, 5, a conta do volume). Ficam fora da telemetria, como já ficam do log.
const PROBE_PATHS = new Set(['/health', '/api/v1/health']);

export const httpInstrumentationOptions = (): HttpInstrumentationConfig => ({
  enabled: true,
  ignoreIncomingRequestHook: (request) => PROBE_PATHS.has((request.url ?? '').split('?')[0] ?? ''),
  // só chamada de saída feita dentro de uma requisição ou de uma mensagem vira span; a renovação de token e afins ficam de fora
  requireParentforOutgoingSpans: true,
});

// O SQL vai sem valores: o driver nunca anexa os parâmetros ao span (enhancedDatabaseReporting desligado) e o sanitizador ainda tira
// os literais do texto.
export const pgInstrumentationOptions = (): PgInstrumentationConfig => ({
  enabled: true,
  enhancedDatabaseReporting: false,
  addSqlCommenterCommentToQueries: false,
  requireParentSpan: true,
  ignoreConnectSpans: true,
});

// O fetch do Node e o `undici` (gateway da arena) não passam pelo módulo http, que é o que a distribuição instrumenta: todas as
// chamadas de saída da api (B3, notícias, CVM, BCB, OpenRouter, revalidação e purge) saem por eles.
export const undiciInstrumentationOptions = (): UndiciInstrumentationConfig => ({
  requireParentforSpans: true,
});

export function azureMonitorOptions(): Options {
  return {
    enableLiveMetrics: false,
    enablePerformanceCounters: false,
    enableStandardMetrics: true,
    browserSdkLoaderOptions: { enabled: false },
    instrumentationOptions: {
      http: httpInstrumentationOptions(),
      postgreSql: pgInstrumentationOptions(),
      azureSdk: { enabled: true },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
      console: { enabled: false },
    },
    // ponytail: a amostragem é a padrão da distribuição, no máximo 5 traces por segundo por processo. A conta do volume está em
    // docs/INFRA.md, seção 5 (uns 0,2 GB por mês contra os 5 GB gratuitos); se o Log Analytics passar de 2,5 GB por mês, baixar com
    // `tracesPerSecond` ou `samplingRatio` aqui, sem mexer em mais nada.
    spanProcessors: [new SanitizingSpanProcessor()],
    logRecordProcessors: [],
  };
}

const ROLE_BY_SCRIPT = new Map([
  ['main', 'api'],
  ['worker', 'worker'],
  ['decide', 'decide'],
  ['schedule', 'sched'],
]);

// O papel pelo comando (`node dist/main.js`, `node dist/schedule.js eod`): vira o nome do papel na nuvem (cloud role) no Application
// Insights. Prisma, comandos do operador e qualquer outro processo da imagem não ligam a telemetria.
export function roleOf(argv: readonly string[]): string | undefined {
  const script = argv[1];
  if (!script) return undefined;
  const role = ROLE_BY_SCRIPT.get(basename(script, extname(script)));
  if (role !== 'sched') return role;
  const name = argv[2];
  return name !== undefined && /^[a-z]{1,16}$/.test(name) ? `sched-${name}` : 'sched';
}

export interface DistroModule {
  useAzureMonitor(options: Options): void;
  shutdownAzureMonitor(): Promise<void>;
}

export interface TelemetryDeps {
  loadDistro?: () => Promise<DistroModule>;
  registerExtras?: () => void | Promise<void>;
}

// Os ganchos de módulo do ESM primeiro (o loader da própria distribuição), depois a distribuição.
async function loadDistro(): Promise<DistroModule> {
  await import('@azure/monitor-opentelemetry/loader');
  return import('@azure/monitor-opentelemetry');
}

// O que a distribuição não instrumenta (chamadas de saída por fetch), registrado depois dela, como o README dela ensina
// ("Custom instrumentation": useAzureMonitor() e então registerInstrumentations com o tracerProvider global).
async function registerExtras(): Promise<void> {
  const [{ registerInstrumentations }, { UndiciInstrumentation }, { metrics, trace }] =
    await Promise.all([
      import('@opentelemetry/instrumentation'),
      import('@opentelemetry/instrumentation-undici'),
      import('@opentelemetry/api'),
    ]);
  registerInstrumentations({
    instrumentations: [new UndiciInstrumentation(undiciInstrumentationOptions())],
    tracerProvider: trace.getTracerProvider(),
    meterProvider: metrics.getMeterProvider(),
  });
}

let stopper: (() => Promise<void>) | undefined;

// Liga a telemetria se houver connection string e o processo for um dos quatro papéis. Devolve se ligou.
export async function startTelemetry(
  argv: readonly string[] = process.argv,
  { env = process.env, deps = {} }: { env?: NodeJS.ProcessEnv; deps?: TelemetryDeps } = {},
): Promise<boolean> {
  if (stopper) return false;
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
  if (!connectionString) return false;
  const role = roleOf(argv);
  if (!role) return false;
  if (!env.OTEL_SERVICE_NAME) env.OTEL_SERVICE_NAME = `alvesting-${role}`;
  const distro = await (deps.loadDistro ?? loadDistro)();
  distro.useAzureMonitor(azureMonitorOptions());
  // Antes das extras: a partir daqui o SDK roda, e se o registro delas falhar o stopTelemetry ainda tem de esvaziar a fila de envio
  // (o job que sai logo depois, decide ou schedule, perderia o último lote).
  stopper = () => distro.shutdownAzureMonitor();
  await (deps.registerExtras ?? registerExtras)();
  return true;
}

// Esvazia o que está na fila de envio e desliga. O job que sai logo depois (`process.exit`) perderia a telemetria sem isto. Com prazo:
// o Application Insights fora do ar não pode prender o encerramento do contêiner.
export async function stopTelemetry(timeoutMs = 5_000): Promise<void> {
  const stop = stopper;
  if (!stop) return;
  stopper = undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      stop(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // a telemetria nunca derruba o desligamento
  } finally {
    clearTimeout(timer);
  }
}
