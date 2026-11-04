import {
  SpanKind,
  SpanStatusCode,
  metrics,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import type { HoldReason } from '@alvesting/contracts';
import { redactText } from './sanitize.js';

// O que o código da api diz ao OpenTelemetry (plano 5.9): spans manuais (a mensagem da fila, o agendador) e as métricas próprias.
// Tudo isto passa pelo @opentelemetry/api, que sem o SDK registrado (dev, testes, o ensaio, o e2e) devolve instrumentos vazios: não
// exporta nada, não custa nada e não muda o resultado de ninguém. Quem liga o SDK é a distribuição da Azure (telemetry.ts), e só com
// a connection string.
const SCOPE = 'alvesting-api';

// Registra o erro no span SEM dado pessoal: a mensagem de uma biblioteca (Prisma, Better Auth, SDK da Azure) leva o que o usuário
// digitou. O SanitizingSpanProcessor limpa de novo no fim do span; esta é a primeira barreira.
export function recordError(span: Span, error: unknown): void {
  const source = error instanceof Error ? error : new Error(String(error));
  const safe = new Error(redactText(source.message));
  safe.name = source.name;
  if (source.stack) safe.stack = redactText(source.stack);
  span.recordException(safe);
  span.setStatus({ code: SpanStatusCode.ERROR });
}

export interface InSpanOptions {
  kind?: SpanKind;
  attributes?: Attributes;
}

// Roda `fn` dentro de um span ativo (as consultas ao Postgres e as chamadas de saída viram filhas dele). OK no sucesso, ERROR e a
// exceção na falha, que sobe como estava. O CONSUMER e o SERVER que não são HTTP precisam do nome da operação para o Application
// Insights (a tabela de requisições): `ai.operation.name`.
export function inSpan<T>(
  name: string,
  options: InSpanOptions,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const kind = options.kind ?? SpanKind.INTERNAL;
  const attributes: Attributes = {
    ...(kind === SpanKind.CONSUMER || kind === SpanKind.SERVER
      ? { 'ai.operation.name': name }
      : {}),
    ...options.attributes,
  };
  return trace.getTracer(SCOPE).startActiveSpan(name, { kind, attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// A rota do Nest (`/api/v1/competitors/:slug`) no span da requisição. Sem ela o Application Insights agruparia por caminho cru, e o
// caminho da redefinição de senha leva o token. Recebe o `req.route?.path` do Express como está: o que não é texto (sem rota, 404) é
// ignorado. Quem chama: o EnvelopeInterceptor (requisição que chegou ao handler) e o AllExceptionsFilter (a que um guard barrou, 401 e
// 403, ou que falhou: o guard roda ANTES do interceptor, então só o filtro as alcança).
export function setServerRoute(route: unknown): void {
  if (typeof route === 'string' && route !== '') {
    trace.getActiveSpan()?.setAttribute('http.route', route);
  }
}

const meter = () => metrics.getMeter(SCOPE);
const MICRO_PER_USD = 1_000_000;

export interface LlmUsageObservation {
  competitor: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costMicroUsd: bigint;
}

// llm.tokens (entrada e saída, por competidor e provedor) e llm.cost_usd. Os atributos são o slug do competidor e o provedor: poucas
// dezenas de séries, nunca um ULID. A saída já inclui os tokens de raciocínio (assim os provedores contam). O custo de verdade é o
// bigint decision.cost_micro_usd; o double daqui é só a leitura da métrica.
export function recordLlmUsage(usage: LlmUsageObservation): void {
  const { competitor, provider } = usage;
  const tokens = meter().createCounter('llm.tokens', {
    unit: '{token}',
    description: 'Tokens de LLM, por competidor e provedor',
  });
  tokens.add(usage.promptTokens, { type: 'input', competitor, provider });
  tokens.add(usage.completionTokens, { type: 'output', competitor, provider });
  meter()
    .createCounter('llm.cost_usd', {
      unit: 'USD',
      description: 'Custo das chamadas de LLM, em dólares',
    })
    .add(Number(usage.costMicroUsd) / MICRO_PER_USD, { competitor, provider });
}

export type InvalidReason = HoldReason | 'item_descartado';

// decision.invalid: o HOLD que o sistema impôs (por motivo) e os itens que o domínio descartou da resposta do modelo (`count` itens).
export function recordInvalid(observation: {
  reason: InvalidReason;
  competitor?: string;
  provider?: string;
  count?: number;
}): void {
  meter()
    .createCounter('decision.invalid', {
      unit: '{decision}',
      description: 'Decisões forçadas a HOLD e itens descartados, por motivo',
    })
    .add(observation.count ?? 1, {
      reason: observation.reason,
      ...(observation.competitor === undefined ? {} : { competitor: observation.competitor }),
      ...(observation.provider === undefined ? {} : { provider: observation.provider }),
    });
}

// cycle.duration: da abertura ao fechamento do ciclo, em segundos. Relógio ao contrário (o ensaio mistura o simulado com o do banco)
// vira 0; data inválida não conta.
export function recordCycleDuration(openedAt: Date, closedAt: Date): void {
  const ms = closedAt.getTime() - openedAt.getTime();
  if (!Number.isFinite(ms)) return;
  meter()
    .createHistogram('cycle.duration', {
      unit: 's',
      description: 'Da abertura ao fechamento do ciclo',
      advice: {
        explicitBucketBoundaries: [30, 60, 120, 300, 600, 1_200, 1_800, 3_600, 5_400, 7_200],
      },
    })
    .record(Math.max(ms, 0) / 1_000);
}
