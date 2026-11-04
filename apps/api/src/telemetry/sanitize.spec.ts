import { SpanKind, SpanStatusCode, type Attributes } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import {
  SanitizingSpanProcessor,
  redactSql,
  redactText,
  redactUrl,
  sanitizeSpan,
} from './sanitize.js';

// Os canários desta suíte são todos sintéticos. Nenhum deles pode aparecer em span, evento ou exceção exportados.
const EMAIL = 'pessoa.canario@example.test';
const IP = '203.0.113.77';
const TOKEN = 'tok9Zx4Kq7Lm2Vb8Np5Rs1Wd6Fh3Jc0TyAe';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.assinaturaCanario';
const PROMPT_CANARY = 'alv-canary-0a1b2c3d4e5f60718293a4b5';
const API_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef';
const CONNECTION =
  'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://eastus2-0.in.applicationinsights.azure.test/';
const ACS = 'endpoint=https://acs.example.test/;accesskey=c2VtLXZhbG9yLXJlYWw=';

const CANARIES = [EMAIL, IP, TOKEN, JWT, PROMPT_CANARY, API_KEY, 'accesskey=c2VtLXZhbG9yLXJlYWw='];

// Um span como o SDK o entrega ao processador no fim: só o que o sanitizador lê e escreve.
function fakeSpan(over: {
  name?: string;
  kind?: SpanKind;
  attributes?: Attributes;
  events?: ReadableSpan['events'];
  status?: ReadableSpan['status'];
}): ReadableSpan {
  return {
    name: 'GET',
    kind: SpanKind.SERVER,
    attributes: {},
    events: [],
    links: [],
    status: { code: SpanStatusCode.UNSET },
    ...over,
  } as unknown as ReadableSpan;
}

const dump = (span: ReadableSpan): string =>
  JSON.stringify({
    name: span.name,
    attributes: span.attributes,
    events: span.events,
    status: span.status,
  });

describe('redactText: o texto que vai à telemetria', () => {
  it('tira e-mail, IP, token, JWT, chave, connection string e o canário do prompt', () => {
    const text = [
      `falhou para ${EMAIL} vindo de ${IP}`,
      `Authorization: Bearer ${TOKEN}`,
      `jwt ${JWT}`,
      `canário ${PROMPT_CANARY}`,
      `chave ${API_KEY}`,
      CONNECTION,
      ACS,
    ].join('\n');
    const out = redactText(text);
    for (const canary of CANARIES) expect(out, canary).not.toContain(canary);
    expect(out).not.toContain('InstrumentationKey=0000');
    expect(out).toContain('falhou para');
  });

  it('mantém o texto comum e o ULID (identificador permitido)', () => {
    const out = redactText('ciclo 01J8Z3Q4W5E6R7T8Y9U0I1O2P3 gravou 3 decisões em 120 ms');
    expect(out).toBe('ciclo 01J8Z3Q4W5E6R7T8Y9U0I1O2P3 gravou 3 decisões em 120 ms');
  });

  it('é linear: texto adversarial grande termina rápido', () => {
    const started = Date.now();
    redactText('a'.repeat(200_000) + '@'.repeat(50_000) + 'x=' + 'y'.repeat(100_000));
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  // O corte do texto grande é no último espaço (redact.ts). Um corte seco na posição 8192 deixava 'pessoa.canario@example' (sem TLD, que
  // a regra do e-mail não reconhece) na telemetria.
  it('o e-mail que atravessa o corte de 8 KB não deixa pedaço para trás', () => {
    const out = redactText(`${' '.repeat(8_170)}${EMAIL}`);
    expect(out).not.toContain('pessoa');
    expect(out).not.toContain('@example');
    expect(out.length).toBeLessThan(8_300);
  });
});

describe('redactUrl', () => {
  it('tira usuário, senha, query e fragmento e mantém host, porta e caminho', () => {
    expect(
      redactUrl(`https://usuario:senha@host.example.test:8443/a/b?token=${TOKEN}&code=1#frag`),
    ).toBe('https://host.example.test:8443/a/b');
  });

  it('troca o token do caminho da redefinição de senha', () => {
    const out = redactUrl(`http://127.0.0.1:4310/api/auth/reset-password/${TOKEN}?callbackURL=/x`);
    expect(out).toBe('http://127.0.0.1:4310/api/auth/reset-password/:token');
  });

  it('o que não é URL perde a query do mesmo jeito, sem lançar', () => {
    expect(redactUrl(`/api/auth/verify-email?token=${TOKEN}`)).toBe('/api/auth/verify-email');
    expect(redactUrl('')).toBe('');
  });
});

describe('redactSql: o SQL vai sem valores', () => {
  it('troca literais de texto e de número por ? e mantém os parâmetros $n e os nomes', () => {
    const out = redactSql(
      `SELECT "id" FROM "user" WHERE "email" = '${EMAIL}' AND "age" > 18 AND "x" = $1 AND "y" = 'it''s' -- ${EMAIL}\n AND n = 3.5 /* ${IP} */`,
    );
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(IP);
    expect(out).toContain('$1');
    expect(out).toContain('"user"');
    expect(out).toContain("'?'");
    expect(out).not.toMatch(/\b18\b|3\.5/);
  });

  it('o texto entre dólares também some', () => {
    expect(redactSql(`SELECT $$${EMAIL}$$, $q$${IP}$q$`)).not.toMatch(/example|203/);
  });

  // O literal cortado no meio (sem a aspa de fechar) não casa com a regra dos literais: o corte tem de levar o pedaço junto.
  it('o literal que atravessa o corte de 8 KB não deixa pedaço para trás', () => {
    const out = redactSql(`${' '.repeat(8_170)}WHERE email = '${EMAIL}'`);
    expect(out).not.toContain('pessoa');
    expect(out).not.toContain('example');
  });
});

describe('sanitizeSpan: o que sobra num span', () => {
  it('requisição: sem IP, sem query, sem cabeçalho; com rota, método, status e user-agent', () => {
    const span = fakeSpan({
      attributes: {
        'http.request.method': 'GET',
        'http.response.status_code': 200,
        'url.scheme': 'https',
        'server.address': 'api.example.test',
        'url.path': `/api/auth/reset-password/${TOKEN}`,
        'url.query': `token=${TOKEN}`,
        'client.address': IP,
        'client.port': 5555,
        'network.peer.address': IP,
        'network.peer.port': 4444,
        'http.client_ip': IP,
        'net.peer.ip': IP,
        'user_agent.original': 'Mozilla/5.0 (teste)',
        'http.request.header.cookie': 'sessao=abc',
        'http.request.header.authorization': `Bearer ${TOKEN}`,
        'microsoft.client.ip': IP,
        'enduser.id': EMAIL,
        'session.id': TOKEN,
      },
    });
    sanitizeSpan(span);
    const out = dump(span);
    for (const canary of CANARIES) expect(out, canary).not.toContain(canary);
    expect(span.attributes).toMatchObject({
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'server.address': 'api.example.test',
      'user_agent.original': 'Mozilla/5.0 (teste)',
      'url.path': '/api/auth/reset-password/:token',
      'http.route': '/api/auth/*',
    });
    expect(span.attributes).not.toHaveProperty('url.query');
    expect(span.name).toBe('GET /api/auth/*');
  });

  it('mantém a rota que o Nest declarou e nomeia o span com ela', () => {
    const span = fakeSpan({
      attributes: {
        'http.request.method': 'GET',
        'http.route': '/api/v1/competitors/:slug',
        'url.path': '/api/v1/competitors/modelo-a',
      },
    });
    sanitizeSpan(span);
    expect(span.attributes['http.route']).toBe('/api/v1/competitors/:slug');
    expect(span.name).toBe('GET /api/v1/competitors/:slug');
  });

  it('requisição sem rota (404, robô) não leva o caminho para o nome da operação', () => {
    const span = fakeSpan({
      attributes: {
        'http.request.method': 'GET',
        'url.path': `/wp-login.php/${TOKEN}`,
        'url.full': `http://api.example.test/wp-login.php/${TOKEN}?x=1`,
      },
    });
    sanitizeSpan(span);
    expect(span.attributes['http.route']).toBe('(sem rota)');
    expect(span.name).toBe('GET (sem rota)');
    expect(dump(span)).not.toContain(TOKEN);
  });

  it('chamada de saída: a URL perde query e usuário; o host e o método ficam', () => {
    const span = fakeSpan({
      name: 'POST',
      kind: SpanKind.CLIENT,
      attributes: {
        'http.request.method': 'POST',
        'url.full': `https://openrouter.example.test/api/v1/chat/completions?key=${TOKEN}`,
        'server.address': 'openrouter.example.test',
        'server.port': 443,
        'http.response.status_code': 200,
        'network.peer.address': IP,
      },
    });
    sanitizeSpan(span);
    expect(span.attributes['url.full']).toBe(
      'https://openrouter.example.test/api/v1/chat/completions',
    );
    expect(span.attributes['server.address']).toBe('openrouter.example.test');
    expect(span.attributes).not.toHaveProperty('network.peer.address');
    expect(span.name).toBe('POST');
  });

  it('consulta ao banco: SQL sem valores e sem os parâmetros do driver', () => {
    const span = fakeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'postgresql',
        'db.namespace': 'alvesting',
        'server.address': 'psql.example.test',
        'db.query.text': `SELECT 1 FROM "user" WHERE email = '${EMAIL}' AND id = $1`,
        'db.statement': `UPDATE "user" SET name = '${EMAIL}' WHERE id = 42`,
        'db.postgresql.values': [EMAIL, TOKEN],
        'db.user': 'alvesting',
        'db.connection_string': CONNECTION,
      },
    });
    sanitizeSpan(span);
    const out = dump(span);
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('InstrumentationKey');
    expect(span.attributes['db.query.text']).toContain('$1');
    expect(span.attributes['db.system.name']).toBe('postgresql');
    expect(span.attributes).not.toHaveProperty('db.postgresql.values');
    expect(span.attributes).not.toHaveProperty('db.user');
  });

  it('atributo desconhecido cai; os nossos, os da fila e os do SDK da Azure ficam', () => {
    const span = fakeSpan({
      kind: SpanKind.CONSUMER,
      attributes: {
        'alvesting.queue': 'market',
        'alvesting.delivery.attempt': 2,
        'messaging.system': 'servicebus',
        'messaging.destination.name': 'market',
        'az.namespace': 'Microsoft.ServiceBus',
        'ai.operation.name': 'process market',
        '_MS.ProcessedByMetricExtractors': '(Name:"Requests", Ver:"1.1")',
        'custom.segredo': TOKEN,
        'prompt.texto': PROMPT_CANARY,
      },
    });
    sanitizeSpan(span);
    expect(Object.keys(span.attributes).sort()).toEqual(
      [
        '_MS.ProcessedByMetricExtractors',
        'ai.operation.name',
        'alvesting.delivery.attempt',
        'alvesting.queue',
        'az.namespace',
        'messaging.destination.name',
        'messaging.system',
      ].sort(),
    );
  });

  it('exceção: mensagem e pilha limpas; evento que não é exceção cai; o status perde a mensagem', () => {
    const span = fakeSpan({
      events: [
        {
          name: 'exception',
          time: [0, 0],
          attributes: {
            'exception.type': 'PrismaClientKnownRequestError',
            'exception.message': `violação para ${EMAIL} de ${IP} ?token=${TOKEN}`,
            'exception.stacktrace': `Error: ${PROMPT_CANARY}\n    at x (/app/dist/y.js:1:1)\n${API_KEY}`,
            'exception.escaped': false,
            'enduser.id': EMAIL,
          },
          droppedAttributesCount: 0,
        },
        {
          name: 'mensagem qualquer',
          time: [0, 0],
          attributes: { texto: EMAIL },
          droppedAttributesCount: 0,
        },
      ],
      status: { code: SpanStatusCode.ERROR, message: `erro de ${EMAIL}` },
    });
    sanitizeSpan(span);
    const out = dump(span);
    for (const canary of CANARIES) expect(out, canary).not.toContain(canary);
    expect(span.events).toHaveLength(1);
    expect(span.events[0]!.attributes).toMatchObject({
      'exception.type': 'PrismaClientKnownRequestError',
    });
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBeUndefined();
  });

  // O exportador da Azure lê `microsoft.sample_rate` (utils/spanUtils.js) para gravar o `sampleRate` do envelope: sem ele o que o
  // amostrador descartou deixa de ser contado e as contagens do Application Insights saem menores que as reais.
  it('a taxa de amostragem da Azure fica; o IP do cliente que a Azure põe no span cai', () => {
    const span = fakeSpan({
      attributes: {
        'http.request.method': 'GET',
        'microsoft.sample_rate': 20,
        'microsoft.client.ip': IP,
      },
    });
    sanitizeSpan(span);
    expect(span.attributes['microsoft.sample_rate']).toBe(20);
    expect(span.attributes).not.toHaveProperty('microsoft.client.ip');
  });

  // Se o SDK passar a congelar os atributos, apagar chave a chave lança e o span sairia cru: o sanitizador troca as propriedades.
  it('atributos e eventos congelados: o span sai vazio e sem a mensagem do status, nunca cru', () => {
    const exception = {
      name: 'exception',
      time: [0, 0],
      attributes: { 'exception.message': `falha de ${EMAIL}` },
      droppedAttributesCount: 0,
    };
    const span = fakeSpan({
      attributes: Object.freeze({
        'http.request.method': 'GET',
        'client.address': IP,
        'enduser.id': EMAIL,
      }),
      events: Object.freeze([exception]) as unknown as ReadableSpan['events'],
      status: { code: SpanStatusCode.ERROR, message: `erro de ${EMAIL}` },
    });
    sanitizeSpan(span);
    expect(span.attributes).toEqual({});
    expect(span.events).toEqual([]);
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR });
    for (const canary of CANARIES) expect(dump(span), canary).not.toContain(canary);
  });

  it('é idempotente', () => {
    const span = fakeSpan({
      attributes: { 'http.request.method': 'GET', 'url.path': `/x/${TOKEN}`, 'client.address': IP },
    });
    sanitizeSpan(span);
    const first = dump(span);
    sanitizeSpan(span);
    expect(dump(span)).toBe(first);
  });

  it('o processador sanitiza no fim do span e não falha com span estranho', () => {
    const processor = new SanitizingSpanProcessor();
    const span = fakeSpan({ attributes: { 'client.address': IP, 'http.request.method': 'GET' } });
    processor.onEnd(span);
    expect(span.attributes).not.toHaveProperty('client.address');
    expect(() => processor.onEnd({} as ReadableSpan)).not.toThrow();
    return expect(
      Promise.all([processor.forceFlush(), processor.shutdown()]),
    ).resolves.toBeDefined();
  });
});
