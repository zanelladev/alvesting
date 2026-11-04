import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../../config/env.js';
import { decisionJsonSchema } from '../domain/llm-messages.js';
import { requestBody, requestUrl } from '../testing/arena.fixture.js';
import {
  LlmCallError,
  LlmConfigError,
  LlmGateway,
  MAX_OUTPUT_TOKENS,
  buildRequestBody,
  type GatewayCompetitor,
} from './llm-gateway.js';

const base = { DATABASE_URL: 'postgresql://alvesting:alvesting@localhost:25432/alvesting_dev' };
const KEY = 'sk-or-chave-so-do-teste';
const env = (extra: Record<string, string> = {}) =>
  parseEnv({
    ...base,
    OPENROUTER_API_KEY: KEY,
    AZURE_OPENAI_ENDPOINT: 'https://oai-teste.openai.azure.com/',
    ...extra,
  });

const openrouter: GatewayCompetitor = {
  provider: 'openrouter',
  modelId: 'anthropic/claude-opus-5.5',
  capabilities: { jsonSchema: true, reasoningEffort: true },
};
const turns = [{ role: 'user' as const, content: 'dados do dia' }];
const SYSTEM = 'PROMPT-SECRETO-SO-DO-TESTE com palavras suficientes para existir de verdade aqui';

interface Seen {
  url: string;
  headers: Headers;
  body: Record<string, unknown> & { messages: Array<Record<string, unknown>> };
}

// Um fetch falso que anota a requisição e devolve uma resposta pronta (nada sai do processo).
function capture(reply: () => Response) {
  const seen: Seen[] = [];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: requestUrl(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(requestBody(init)) as Seen['body'],
    });
    return Promise.resolve(reply());
  });
  return { fetch, seen };
}

const completion = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: 'gen-1',
      object: 'chat.completion',
      model: 'anthropic/claude-opus-5.5-20260922',
      provider: 'Anthropic',
      system_fingerprint: 'fp_1',
      choices: [
        { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"a":1}' } },
      ],
      usage: {
        prompt_tokens: 18_000,
        completion_tokens: 8_000,
        total_tokens: 26_000,
        completion_tokens_details: { reasoning_tokens: 5_000 },
        cost: 0.232,
      },
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

beforeAll(() => {
  Logger.overrideLogger(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('buildRequestBody: os parâmetros iguais para todos', () => {
  it('prompt de sistema primeiro, depois os turnos; limite de saída, esforço médio e JSON Schema', () => {
    const body = buildRequestBody(openrouter, SYSTEM, turns);
    expect(body).toEqual({
      model: 'anthropic/claude-opus-5.5',
      messages: [{ role: 'system', content: SYSTEM }, ...turns],
      // o OpenRouter lista max_tokens em todo modelo; com require_parameters, outro nome poderia tirá-lo do roteamento
      max_tokens: MAX_OUTPUT_TOKENS,
      reasoning_effort: 'medium',
      response_format: {
        type: 'json_schema',
        // strict:false de propósito: o contrato tem campo opcional (confidence) e o modo estrito exige todos obrigatórios
        json_schema: { name: 'llm_decision', strict: false, schema: decisionJsonSchema },
      },
      // só no OpenRouter: provedores que respeitam os parâmetros e não guardam nem treinam com os dados
      provider: { require_parameters: true, data_collection: 'deny' },
    });
  });

  it('sem ferramentas, sem temperatura e sem streaming', () => {
    const body = buildRequestBody(openrouter, SYSTEM, turns);
    for (const key of ['tools', 'tool_choice', 'temperature', 'top_p', 'stream', 'seed']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('o que o provedor não aceita não é enviado: sem JSON Schema nem esforço', () => {
    const body = buildRequestBody(
      { ...openrouter, capabilities: { jsonSchema: false, reasoningEffort: false } },
      SYSTEM,
      turns,
    );
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it('Azure e fake pedem o limite como max_completion_tokens (os modelos de raciocínio recusam max_tokens)', () => {
    for (const provider of ['azure-openai', 'fake'] as const) {
      const body = buildRequestBody({ ...openrouter, provider }, SYSTEM, turns);
      expect(body.max_completion_tokens).toBe(MAX_OUTPUT_TOKENS);
      expect(body).not.toHaveProperty('max_tokens');
    }
  });

  it('Azure e fake não levam as preferências de roteamento do OpenRouter', () => {
    expect(
      buildRequestBody({ ...openrouter, provider: 'azure-openai' }, SYSTEM, turns),
    ).not.toHaveProperty('provider');
    expect(buildRequestBody({ ...openrouter, provider: 'fake' }, SYSTEM, turns)).not.toHaveProperty(
      'provider',
    );
  });

  it('com um marcador no lugar do prompt, é a mesma requisição (o IO bruto não leva o texto)', () => {
    const sent = buildRequestBody(openrouter, SYSTEM, turns);
    const recorded = buildRequestBody(openrouter, '[prompt-arena v1]', turns);
    expect({ ...sent, messages: sent.messages.slice(1) }).toEqual({
      ...recorded,
      messages: recorded.messages.slice(1),
    });
    expect(JSON.stringify(recorded)).not.toContain('PROMPT-SECRETO');
  });

  it('o limite de saída é um só para todos os modelos', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(16_000);
  });
});

describe('LlmGateway pelo SDK da OpenAI: OpenRouter', () => {
  it('chama o endpoint de chat completions com a chave, sem retry do SDK', async () => {
    const { fetch, seen } = capture(() => completion());
    await new LlmGateway(env(), { fetch }).call({
      competitor: openrouter,
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(seen[0]!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.body.messages[0]).toEqual({ role: 'system', content: SYSTEM });
    expect(seen[0]!.body.provider).toEqual({ require_parameters: true, data_collection: 'deny' });
  });

  it('devolve o texto, o usage, o custo informado pelo provedor e o que ele aplicou', async () => {
    const { fetch } = capture(() => completion());
    const result = await new LlmGateway(env(), { fetch }).call({
      competitor: openrouter,
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    expect(result.text).toBe('{"a":1}');
    expect(result.usage).toEqual({
      promptTokens: 18_000,
      completionTokens: 8_000,
      reasoningTokens: 5_000,
      totalTokens: 26_000,
    });
    expect(result.costMicroUsd).toBe(232_000n);
    expect(result.applied).toEqual({
      provider: 'openrouter',
      requestedModel: 'anthropic/claude-opus-5.5',
      model: 'anthropic/claude-opus-5.5-20260922',
      upstreamProvider: 'Anthropic',
      finishReason: 'stop',
      costSource: 'provider',
      params: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        reasoningEffort: 'medium',
        jsonSchema: true,
        tools: false,
        requireParameters: true,
        dataCollection: 'deny',
      },
    });
    expect((result.response as { id: string }).id).toBe('gen-1');
  });

  it('sem custo no usage, usa a tabela de preços do competidor; sem tabela, custo zero e "none"', async () => {
    const noCost = () =>
      completion({
        usage: { prompt_tokens: 18_000, completion_tokens: 8_000, total_tokens: 26_000 },
      });
    const priced = await new LlmGateway(env(), { fetch: capture(noCost).fetch }).call({
      competitor: { ...openrouter, pricingUsdPerMTok: { input: '4', output: '20' } },
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    expect(priced.costMicroUsd).toBe(232_000n);
    expect(priced.applied.costSource).toBe('table');
    const unknown = await new LlmGateway(env(), { fetch: capture(noCost).fetch }).call({
      competitor: openrouter,
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    expect(unknown.costMicroUsd).toBe(0n);
    expect(unknown.applied.costSource).toBe('none');
    expect(unknown.usage.reasoningTokens).toBe(0);
  });

  it('custo zero por falta de preço num provedor pago é avisado no log; o fake e o custo conhecido não', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const noCost = () =>
      completion({
        usage: { prompt_tokens: 18_000, completion_tokens: 8_000, total_tokens: 26_000 },
      });
    const call = (competitor: GatewayCompetitor) =>
      new LlmGateway(env(), { fetch: capture(noCost).fetch }).call({
        competitor,
        system: SYSTEM,
        turns,
        timeoutMs: 60_000,
      });
    await call({ ...openrouter, pricingUsdPerMTok: { input: '4', output: '20' } });
    await call({ ...openrouter, provider: 'fake', modelId: 'fake/x' });
    expect(warn).not.toHaveBeenCalled();
    await call(openrouter);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('SEGREDO');
  });

  it('número de tokens absurdo (o provedor errou) vira zero, em vez de estourar o JSON público ou o BIGINT do custo', async () => {
    const { fetch } = capture(() =>
      completion({
        usage: {
          prompt_tokens: 1e300,
          completion_tokens: 10_000_001,
          total_tokens: -5,
          completion_tokens_details: { reasoning_tokens: 10_000_000 },
        },
      }),
    );
    const result = await new LlmGateway(env(), { fetch }).call({
      competitor: { ...openrouter, pricingUsdPerMTok: { input: '4', output: '20' } },
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    expect(result.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 10_000_000, // o teto vale: 10 milhões ainda é um número que o JSON e o BIGINT aguentam
      totalTokens: 0,
    });
    expect(result.costMicroUsd).toBe(0n);
  });

  it('conteúdo vazio (resposta cortada pelo limite) volta como texto vazio, para o reparo tratar', async () => {
    const { fetch } = capture(() =>
      completion({
        choices: [
          { index: 0, finish_reason: 'length', message: { role: 'assistant', content: null } },
        ],
      }),
    );
    const result = await new LlmGateway(env(), { fetch }).call({
      competitor: openrouter,
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    expect(result.text).toBe('');
    expect(result.applied.finishReason).toBe('length');
  });

  it('modelo e provedor reais só entram no registro se tiverem cara de identificador', async () => {
    const { fetch } = capture(() =>
      completion({ model: 'texto livre com espaços e SEGREDO', provider: 'x'.repeat(500) }),
    );
    const { applied } = await new LlmGateway(env(), { fetch }).call({
      competitor: openrouter,
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    expect(applied.model).toBeNull();
    expect(applied.upstreamProvider).toBeNull();
  });

  it('resposta sem choices é falha do provedor', async () => {
    const { fetch } = capture(() => completion({ choices: [] }));
    await expect(
      new LlmGateway(env(), { fetch }).call({
        competitor: openrouter,
        system: SYSTEM,
        turns,
        timeoutMs: 60_000,
      }),
    ).rejects.toMatchObject({ name: 'LlmCallError', kind: 'invalid_response' });
  });
});

describe('LlmGateway pelo SDK da OpenAI: Azure OpenAI', () => {
  const azure: GatewayCompetitor = {
    provider: 'azure-openai',
    modelId: 'gpt-4.1-mini',
    capabilities: { jsonSchema: true, reasoningEffort: false },
    pricingUsdPerMTok: { input: '0.4', output: '1.6' },
  };

  it('chama a implantação do endpoint com o token da identidade (sem chave de API)', async () => {
    // o Azure não devolve o custo no usage
    const { fetch, seen } = capture(() =>
      completion({
        model: 'gpt-4.1-mini-2025-04-14',
        provider: undefined,
        usage: { prompt_tokens: 1_000, completion_tokens: 500, total_tokens: 1_500 },
      }),
    );
    const tokenProvider = vi.fn(() => Promise.resolve('token-entra-id'));
    const result = await new LlmGateway(env(), { fetch, azureTokenProvider: tokenProvider }).call({
      competitor: azure,
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    expect(seen[0]!.url).toMatch(
      /^https:\/\/oai-teste\.openai\.azure\.com\/openai\/deployments\/gpt-4\.1-mini\/chat\/completions\?api-version=/,
    );
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer token-entra-id');
    expect(seen[0]!.headers.get('api-key')).toBeNull();
    expect(tokenProvider).toHaveBeenCalled();
    // sem custo no usage do Azure: a tabela de preços do competidor
    expect(result.applied).toMatchObject({ provider: 'azure-openai', costSource: 'table' });
    expect(seen[0]!.body).not.toHaveProperty('provider');
  });

  it('sem AZURE_OPENAI_ENDPOINT falha dizendo o que falta', async () => {
    const { fetch } = capture(() => completion());
    const gateway = new LlmGateway(parseEnv(base), {
      fetch,
      azureTokenProvider: () => Promise.resolve('t'),
    });
    await expect(
      gateway.call({ competitor: azure, system: SYSTEM, turns, timeoutMs: 60_000 }),
    ).rejects.toThrow(/AZURE_OPENAI_ENDPOINT/);
  });
});

describe('LlmGateway pelo SDK da OpenAI: fake', () => {
  it('usa o fetch fake do processo (nenhuma rede) e devolve decisão válida com custo zero', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await new LlmGateway(parseEnv(base)).call({
      competitor: {
        provider: 'fake',
        modelId: 'fake/deterministic-a',
        capabilities: { jsonSchema: false, reasoningEffort: false },
      },
      system: SYSTEM,
      turns: [{ role: 'user', content: 'sem blocos' }],
      timeoutMs: 60_000,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.parse(result.text)).toHaveProperty('market_view');
    expect(result.costMicroUsd).toBe(0n);
    expect(result.applied).toMatchObject({
      provider: 'fake',
      model: 'fake/deterministic-a',
      costSource: 'provider',
    });
  });
});

describe('LlmGateway: erros que não carregam texto do provedor', () => {
  it('HTTP 429 vira LlmCallError com o status, sem repetir o corpo da resposta', async () => {
    const { fetch } = capture(
      () =>
        new Response(JSON.stringify({ error: { message: 'SEGREDO-NO-CORPO eco do prompt' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const error = await new LlmGateway(env(), { fetch })
      .call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 60_000 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmCallError);
    expect(error).toMatchObject({ kind: 'http', status: 429, provider: 'openrouter' });
    expect(String((error as Error).message)).not.toContain('SEGREDO');
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('SEGREDO');
    expect((error as Error).cause).toBeUndefined();
  });

  it('o código e o tipo do erro do provedor entram na mensagem (o diagnóstico da primeira chamada real), sem o corpo', async () => {
    const failing = async (error: Record<string, unknown>, status = 404): Promise<LlmCallError> => {
      const gateway = new LlmGateway(env(), {
        fetch: capture(
          () =>
            new Response(JSON.stringify({ error }), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
        ).fetch,
      });
      try {
        await gateway.call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 60_000 });
      } catch (e) {
        return e as LlmCallError;
      }
      throw new Error('a chamada devia ter falhado');
    };

    const known = await failing({
      code: 'model_not_found',
      type: 'invalid_request_error',
      message: 'SEGREDO-NO-CORPO eco do prompt',
    });
    expect(known).toBeInstanceOf(LlmCallError);
    expect(known.message).toBe(
      'Chamada ao provedor openrouter falhou: http (HTTP 404, code=model_not_found, type=invalid_request_error)',
    );
    expect(known.message).not.toContain('SEGREDO');

    // só o que tem cara de identificador: texto livre, maiúscula, espaço e tamanho não entram; o código numérico do OpenRouter
    // repete o status e também fica de fora
    for (const code of ['Texto livre com SEGREDO', 'x'.repeat(41), '', 402, null, { a: 1 }]) {
      const error = await failing({ code, message: 'SEGREDO' }, 402);
      expect(error.message).toBe('Chamada ao provedor openrouter falhou: http (HTTP 402)');
    }
  });

  it('falha de rede vira LlmCallError network', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('fetch failed: ECONNRESET SEGREDO')));
    const error = await new LlmGateway(env(), { fetch })
      .call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 60_000 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'LlmCallError', kind: 'network' });
    expect(String((error as Error).message)).not.toContain('SEGREDO');
  });

  it('estourou o tempo da chamada: LlmCallError timeout, e a requisição é abortada', async () => {
    let aborted = false;
    const fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const error = await new LlmGateway(env(), { fetch })
      .call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 40 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'LlmCallError', kind: 'timeout' });
    expect(aborted).toBe(true);
  });

  it('tempo zero: nem chama', async () => {
    const { fetch } = capture(() => completion());
    await expect(
      new LlmGateway(env(), { fetch }).call({
        competitor: openrouter,
        system: SYSTEM,
        turns,
        timeoutMs: 0,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sem OPENROUTER_API_KEY falha dizendo o que falta, sem chamar', async () => {
    const { fetch } = capture(() => completion());
    const gateway = new LlmGateway(parseEnv(base), { fetch });
    await expect(
      gateway.call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 60_000 }),
    ).rejects.toThrow(LlmConfigError);
    await expect(
      gateway.call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 60_000 }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('o log do SDK fica desligado: nem OPENAI_LOG=debug imprime corpo de requisição', async () => {
    vi.stubEnv('OPENAI_LOG', 'debug');
    const spies = (['log', 'debug', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const ok = capture(() => completion());
    await new LlmGateway(env(), { fetch: ok.fetch }).call({
      competitor: openrouter,
      system: SYSTEM,
      turns,
      timeoutMs: 60_000,
    });
    const bad = capture(() => new Response('{}', { status: 500 }));
    await new LlmGateway(env(), { fetch: bad.fetch })
      .call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 60_000 })
      .catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

// O transporte de produção (o fetch do undici com o Agent como dispatcher) contra um servidor em 127.0.0.1: nada sai da máquina.
// Os outros testes injetam o fetch, e sem este o caminho que roda de verdade não teria cobertura nenhuma.
describe('LlmGateway: o transporte de produção, contra um servidor local', () => {
  let server: http.Server;
  let baseUrl: string;
  let mode: 'ok' | 'hang' = 'ok';
  const seen: Array<{ url?: string; authorization?: string; body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (mode === 'hang') return; // nunca responde: só o tempo da chamada encerra
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
      req.on('end', () => {
        seen.push({
          url: req.url,
          authorization: req.headers.authorization,
          body: JSON.parse(raw) as Record<string, unknown>,
        });
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'gen-local',
            model: 'anthropic/claude-opus-5.5-20260922',
            provider: 'Anthropic',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: '{"a":1}' },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.000123 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('chama o endpoint de chat completions com a chave e lê a resposta e o custo', async () => {
    mode = 'ok';
    const gateway = new LlmGateway(env(), { openrouterBaseUrl: baseUrl });
    try {
      const result = await gateway.call({
        competitor: openrouter,
        system: SYSTEM,
        turns,
        timeoutMs: 5_000,
      });
      expect(result.text).toBe('{"a":1}');
      expect(result.costMicroUsd).toBe(123n);
      expect(result.applied).toMatchObject({ provider: 'openrouter', costSource: 'provider' });
    } finally {
      await gateway.onModuleDestroy();
    }
    const last = seen[seen.length - 1]!;
    expect(last.url).toBe('/v1/chat/completions');
    expect(last.authorization).toBe(`Bearer ${KEY}`);
    expect(last.body).toMatchObject({ model: 'anthropic/claude-opus-5.5', max_tokens: 16_000 });
  });

  it('servidor que não responde: o tempo da chamada o aborta e vira LlmCallError timeout', async () => {
    mode = 'hang';
    const gateway = new LlmGateway(env(), { openrouterBaseUrl: baseUrl });
    const started = Date.now();
    try {
      const error = await gateway
        .call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 200 })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ name: 'LlmCallError', kind: 'timeout' });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await gateway.onModuleDestroy();
    }
  });

  it('servidor que fecha a conexão: LlmCallError network, sem texto do servidor', async () => {
    const closing = http.createServer((req) => req.socket.destroy());
    await new Promise<void>((resolve) => closing.listen(0, '127.0.0.1', resolve));
    const gateway = new LlmGateway(env(), {
      openrouterBaseUrl: `http://127.0.0.1:${(closing.address() as AddressInfo).port}/v1`,
    });
    try {
      const error = await gateway
        .call({ competitor: openrouter, system: SYSTEM, turns, timeoutMs: 5_000 })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ name: 'LlmCallError', kind: 'network' });
    } finally {
      await gateway.onModuleDestroy();
      closing.close();
    }
  });
});
