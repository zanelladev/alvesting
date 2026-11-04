import { SpanKind, type Attributes } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { clip, redactPath, redactPii } from '../common/redact.js';

// O que um span, um evento e uma exceção podem levar ao Application Insights (plano 5.9; docs/INFRA.md, seção 5). A regra é a do log
// de requisição (common/http-log.ts), só que para a telemetria: lista branca. O que não está na lista cai, em vez de a lista negra
// esquecer um campo. Fica de fora tudo que identifica pessoa ou carrega segredo: IP do cliente (o `client.address` vem do
// X-Forwarded-For), query string (?token=, ?code=), o token da redefinição de senha no caminho, cabeçalho, cookie, valores das
// consultas SQL, e-mail, nome, connection string e chave. O texto do prompt (arena e chat) nunca chega aqui: ele não é atributo de
// nada, e o canário dele cai pela regra de texto abaixo caso apareça numa mensagem de erro.
//
// O processador roda DENTRO do SDK, entre o processador das métricas padrão da Azure e o que exporta em lote (a ordem de
// `useAzureMonitor`, node_modules/@azure/monitor-opentelemetry/dist/esm/index.js): o que o exportador lê já está limpo.
// ponytail: o SDK entrega o mesmo objeto do span ao próximo processador, e mudá-lo no fim do span é o que a documentação da Azure
// ensina ("Add a custom property to a Trace"). Se uma versão nova do SDK passar a congelar os atributos, a escrita no lugar falha: o
// catch abaixo TROCA os atributos e os eventos do span por vazios (`span.attributes = {}`, e não apagar chave a chave, que num objeto
// congelado também falharia e deixaria o span sair cru), então ele sai sem nada (falha fechada) e o teste telemetry.integration.spec.ts
// reprova. Isso vale enquanto `attributes` e `events` forem campos comuns do span (são, no @opentelemetry/sdk-trace 2.x); se virarem
// só leitura, o caminho é sanitizar num SpanExporter que embrulha o da Azure e entrega cópias.

const CLIP = 8 * 1024;

// Linear, como as regras de common/redact.ts: nada de grupo aninhado com repetição.
const EXTRA_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // o canário que o prompt da arena leva (arena/domain/leak-filter.ts): se aparecer numa mensagem, não passa
  [/\balv-canary-[a-z0-9]{16,64}\b/gi, '[canário]'],
  // campos de connection string e de senha (ACS, Application Insights, Storage, Service Bus)
  [
    /\b(?:InstrumentationKey|AccountKey|SharedAccessKey|accesskey|password|pwd|apikey|api_key|secret)\s*=\s*[^;\s&]{1,512}/gi,
    '[credencial]',
  ],
  // Authorization: Bearer abc / Basic abc
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,512}/g, '$1 [token]'],
  // chave de API com prefixo conhecido, mesmo curta
  [/\bsk-[A-Za-z0-9_-]{8,256}/g, '[chave]'],
];

// A mesma limpeza do log (redact.ts: e-mail, IP, JWT, cookie, token, query de URL, argumentos do Prisma), mais as regras acima.
// O corte é o do redact.ts (no último espaço, sem sobrar ponta): um corte seco no meio de um e-mail ou de um token deixaria um
// pedaço que nenhuma regra reconhece.
export function redactText(text: string): string {
  let out = clip(text, CLIP);
  for (const [pattern, replacement] of EXTRA_RULES) out = out.replace(pattern, replacement);
  return redactPii(out);
}

// URL sem usuário, senha, query e fragmento; o token do caminho da redefinição vira :token.
export function redactUrl(value: string): string {
  if (value === '') return '';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${redactText(redactPath(url.pathname) ?? '')}`;
  } catch {
    return redactText(redactPath(value.split(/[?#]/, 1)[0] ?? '') ?? '');
  }
}

const redactPathOnly = (value: string): string =>
  redactText(redactPath(value.split(/[?#]/, 1)[0] ?? '') ?? '');

// O SQL sem valores: literais de texto e de número viram ?, comentários somem, os parâmetros ($1) e os nomes ficam. O Prisma já manda
// os valores como parâmetro, então isto é a última barreira (um $queryRawUnsafe, uma mensagem de erro do driver).
export function redactSql(sql: string): string {
  return clip(sql, CLIP)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, "'?'")
    .replace(/'(?:[^']|'')*'/g, "'?'")
    .replace(/(?<![\w$."])\d+(?:\.\d+)?\b/g, '?');
}

const KEEP = new Set([
  // HTTP (convenção estável do OpenTelemetry e a antiga, que o SDK da Azure ainda emite)
  'http.request.method',
  'http.request.method_original',
  'http.response.status_code',
  'http.route',
  'url.scheme',
  'network.protocol.name',
  'network.protocol.version',
  'user_agent.original',
  'server.address',
  'server.port',
  'error.type',
  'http.method',
  'http.status_code',
  'http.scheme',
  'http.flavor',
  'http.user_agent',
  'http.host',
  'net.peer.name',
  'peer.service',
  // banco
  'db.system',
  'db.system.name',
  'db.name',
  'db.namespace',
  'db.operation',
  'db.operation.name',
  'db.collection.name',
  // a taxa de amostragem que o amostrador da Azure põe no span quando amostra: o exportador a lê (utils/spanUtils.js) e grava `sampleRate`
  // no envelope. Sem ela o que foi amostrado entra no Application Insights como 100% e as contagens saem menores que as reais. É um
  // número, sem dado pessoal. NÃO é um prefixo `microsoft.`: o `microsoft.client.ip` é o IP do cliente e tem de cair.
  'microsoft.sample_rate',
]);
const KEEP_PREFIX = ['alvesting.', 'messaging.', 'message_bus.', 'az.', '_MS.', 'ai.operation.'];
const URL_KEYS = new Set(['url.full', 'http.url']);
const PATH_KEYS = new Set(['url.path', 'http.target']);
const SQL_KEYS = new Set(['db.query.text', 'db.statement']);

const ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['/api/auth', '/api/auth/*'],
  ['/api/docs', '/api/docs/*'],
];

// A rota de quando o Nest não declarou uma (login do Better Auth, Swagger, 404 e robô). O caminho cru nunca vira nome de operação: é
// de quem chama, e o nome da operação agrupa as requisições.
export function routeOf(path: string): string {
  return (
    ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? '(sem rota)'
  );
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// O valor de um atributo pode ser texto, número, booleano ou lista (a API 1.10 também deixa `unknown` nos atributos de log).
function cleanValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    if (URL_KEYS.has(key)) return redactUrl(value);
    if (PATH_KEYS.has(key)) return redactPathOnly(value);
    if (SQL_KEYS.has(key)) return redactSql(value);
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => (typeof item === 'string' ? redactText(item) : item));
  }
  return value;
}

interface MutableSpan {
  name: string;
  kind: SpanKind;
  attributes: Attributes;
  events: Array<{
    name: string;
    time: unknown;
    attributes?: Attributes;
    droppedAttributesCount?: number;
  }>;
  status: { code: number; message?: string | undefined };
}

function cleanEvents(events: MutableSpan['events']): void {
  const kept = events
    .filter((event) => event.name === 'exception')
    .map((event) => {
      const a = event.attributes ?? {};
      const type = text(a['exception.type']);
      const attributes: Attributes = {
        'exception.type': type !== undefined && /^[\w.$-]{1,120}$/.test(type) ? type : 'Error',
      };
      const message = text(a['exception.message']);
      if (message !== undefined) attributes['exception.message'] = redactText(message);
      const stack = text(a['exception.stacktrace']);
      if (stack !== undefined) attributes['exception.stacktrace'] = redactText(stack);
      if (typeof a['exception.escaped'] === 'boolean') {
        attributes['exception.escaped'] = a['exception.escaped'];
      }
      return { ...event, attributes, droppedAttributesCount: 0 };
    });
  events.splice(0, events.length, ...kept);
}

// Limpa o span no lugar (ver o ponytail do topo). Nunca lança: se não conseguir limpar, esvazia.
export function sanitizeSpan(span: ReadableSpan): void {
  const s = span as unknown as MutableSpan;
  try {
    const attributes = s.attributes;
    if (attributes && typeof attributes === 'object') {
      const kept: Attributes = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (value === undefined) continue;
        if (
          KEEP.has(key) ||
          URL_KEYS.has(key) ||
          PATH_KEYS.has(key) ||
          SQL_KEYS.has(key) ||
          KEEP_PREFIX.some((prefix) => key.startsWith(prefix))
        ) {
          kept[key] = cleanValue(key, value);
        }
      }
      // uma requisição sempre tem rota, e o nome da operação é "MÉTODO rota"
      const method = text(kept['http.request.method']) ?? text(kept['http.method']);
      if (s.kind === SpanKind.SERVER && method !== undefined) {
        const path = text(kept['url.path']) ?? text(kept['http.target']) ?? '';
        const route = text(kept['http.route']) ?? routeOf(path);
        kept['http.route'] = route;
        s.name = `${method} ${route}`;
      }
      for (const key of Object.keys(attributes)) delete attributes[key];
      Object.assign(attributes, kept);
    }
    if (typeof s.name === 'string') s.name = redactText(s.name);
    if (Array.isArray(s.events)) cleanEvents(s.events);
    if (s.status && typeof s.status === 'object') s.status = { code: s.status.code };
  } catch {
    // Falha fechada: troca as propriedades em vez de apagar chave a chave (num objeto congelado o `delete` lança e o span sairia cru).
    try {
      s.attributes = {};
      s.events = [];
      s.status = { code: s.status.code }; // sem a mensagem do status
    } catch {
      // nada mais a fazer: o span já falhou duas vezes
    }
  }
}

export class SanitizingSpanProcessor implements SpanProcessor {
  onStart(_span: Span): void {
    // a limpeza é no fim: os atributos que importam chegam durante a vida do span
  }
  onEnd(span: ReadableSpan): void {
    sanitizeSpan(span);
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
