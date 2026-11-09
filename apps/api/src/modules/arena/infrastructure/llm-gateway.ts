import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import type { LlmProvider } from '@alvesting/contracts';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import OpenAI, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AzureOpenAI,
  type ClientOptions,
} from 'openai';
import { Agent, fetch as undiciFetch } from 'undici';
import type { Env } from '../../../config/env.js';
import { pricedCostMicro, reportedCostMicro } from '../domain/cost.js';
import { REPLICA_TIMEOUT_MS } from '../domain/call-timeout.js';
import { decisionJsonSchema } from '../domain/llm-messages.js';
import { createFakeFetch } from './fake-llm.js';

// O gateway LLM (plano 10): o SDK oficial `openai` com `baseURL` por competidor. OpenRouter (arena), Azure OpenAI (por
// identidade, sem chave) e fake (dentro do processo, pelo `fetch` do SDK). Os parâmetros são IGUAIS para todos os modelos:
// limite de tokens de saída, esforço de raciocínio médio onde existir, sem ferramentas, JSON Schema onde o provedor aceita.
// Nenhuma mensagem de erro daqui carrega texto do provedor, da requisição ou do prompt: o log e o job_run não podem vazar.

// Limite de tokens de saída, o mesmo para todos. No OpenRouter e no Azure ele cobre o raciocínio e a resposta visível juntos
// (docs/ARENA.md): com esforço médio, uns 50% ficam para o raciocínio.
export const MAX_OUTPUT_TOKENS = 16_000;

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
// O fake nunca abre conexão (o fetch dele responde antes); o endereço só precisa ser uma URL.
const FAKE_BASE_URL = 'http://fake-llm.invalid/v1';
const AZURE_SCOPE = 'https://cognitiveservices.azure.com/.default';
// ponytail: API datada do Azure OpenAI. Desde 08/2025 a Microsoft recomenda a API v1 (sem api-version, escopo
// https://ai.azure.com/.default); trocar quando a datada for aposentada. Não verificado contra a Azure (docs/ARENA.md).
export const AZURE_API_VERSION = '2025-04-01-preview';

type Fetch = NonNullable<ClientOptions['fetch']>;

export interface GatewayCompetitor {
  provider: LlmProvider;
  modelId: string;
  capabilities: { jsonSchema: boolean; reasoningEffort: boolean };
  // para o provedor que não devolve o custo (Azure OpenAI)
  pricingUsdPerMTok?: { input: string; output: string } | undefined;
}

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatBody {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  // O mesmo limite sob o nome que o provedor aceita: o OpenRouter lista `max_tokens` em todos os modelos (e com
  // require_parameters um nome que o endpoint não lista o tiraria do roteamento); o Azure e os modelos de raciocínio da OpenAI
  // exigem `max_completion_tokens`.
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: 'medium';
  response_format?: {
    type: 'json_schema';
    json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
  };
  provider?: { require_parameters: true; data_collection: 'deny'; ignore: readonly string[] };
}

// Provedores que o OpenRouter não usa para nenhum competidor (o mesmo para todos). A Wafer entrou num laço de espaços na saída
// estruturada do DeepSeek V4 Pro (06/11/2026: começou o JSON certo e escreveu "\t\n" até o limite de saída, HTTP 200 com
// finish_reason "length"; com o schema do contrato, também deixou espaços soltos no meio). A mesma chamada sem ela saiu certa em
// três provedores (Sail Research, Together e CoreWeave). Uma resposta assim custa até 16 mil tokens e, no reparo, viraria HOLD
// por resposta inválida, culpa do provedor e não do modelo (docs/ARENA.md, seção 5).
export const IGNORED_OPENROUTER_PROVIDERS: readonly string[] = ['wafer'];

// A requisição exata. O IO bruto grava esta mesma função com um marcador no lugar do prompt (llm-io), então o que foi
// gravado é o que foi enviado, menos o texto do prompt.
export function buildRequestBody(
  competitor: GatewayCompetitor,
  system: string,
  turns: readonly Turn[],
): ChatBody {
  return {
    model: competitor.modelId,
    messages: [{ role: 'system', content: system }, ...turns],
    ...(competitor.provider === 'openrouter'
      ? { max_tokens: MAX_OUTPUT_TOKENS }
      : { max_completion_tokens: MAX_OUTPUT_TOKENS }),
    ...(competitor.capabilities.reasoningEffort ? { reasoning_effort: 'medium' as const } : {}),
    ...(competitor.capabilities.jsonSchema
      ? {
          response_format: {
            type: 'json_schema' as const,
            // strict:false de propósito: confidence é opcional no contrato (ADR 0016) e o modo estrito da OpenAI exige todos
            // os campos obrigatórios. O schema é dica; a barreira é o parseLlmDecision.
            json_schema: { name: 'llm_decision', strict: false, schema: decisionJsonSchema },
          },
        }
      : {}),
    // OpenRouter (https://openrouter.ai/docs/guides/routing/provider-selection): só provedores que aceitam todos os
    // parâmetros pedidos, que não coletam nem treinam com os dados e que não estão na lista acima. Nada disto vale para o Azure
    // nem para o fake.
    ...(competitor.provider === 'openrouter'
      ? {
          provider: {
            require_parameters: true as const,
            data_collection: 'deny' as const,
            ignore: IGNORED_OPENROUTER_PROVIDERS,
          },
        }
      : {}),
  };
}

export interface CallUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

// O que o provedor aplicou (plano 10): modelo e provedor reais, e os parâmetros pedidos.
export interface Applied {
  provider: LlmProvider;
  requestedModel: string;
  // o modelo e o provedor que o provedor diz ter usado; null se a resposta não os trouxe com cara de identificador
  model: string | null;
  upstreamProvider: string | null;
  finishReason: string | null;
  // de onde veio o custo: 'provider' (usage.cost), 'table' (tokens x preço do competidor) ou 'none'
  costSource: 'provider' | 'table' | 'none';
  params: {
    maxOutputTokens: number;
    reasoningEffort: 'medium' | null;
    jsonSchema: boolean;
    tools: false;
    requireParameters: boolean;
    dataCollection: 'deny' | null;
  };
}

export interface LlmCall {
  competitor: GatewayCompetitor;
  // o texto do prompt; só passa por aqui
  system: string;
  turns: readonly Turn[];
  timeoutMs: number;
}

export interface LlmResult {
  text: string;
  usage: CallUsage;
  costMicroUsd: bigint;
  applied: Applied;
  // a resposta do provedor como veio (JSON); o IO bruto a grava depois do filtro de vazamento
  response: unknown;
}

// A chamada falhou. A mensagem é fixa (provedor, tipo e status), com o código e o tipo do erro do provedor só quando têm cara de
// identificador (minúsculas, dígitos, ponto, hífen e sublinhado, até 40): nunca o corpo da resposta, que pode ecoar a requisição.
export class LlmCallError extends Error {
  constructor(
    readonly kind: 'timeout' | 'http' | 'network' | 'invalid_response',
    readonly provider: LlmProvider,
    readonly status?: number,
    readonly detail: { code?: string; type?: string } = {},
  ) {
    const extra = [
      detail.code === undefined ? '' : `code=${detail.code}`,
      detail.type === undefined ? '' : `type=${detail.type}`,
    ].filter(Boolean);
    super(
      `Chamada ao provedor ${provider} falhou: ${kind}${
        status === undefined
          ? ''
          : ` (HTTP ${status}${extra.length > 0 ? `, ${extra.join(', ')}` : ''})`
      }`,
    );
    this.name = 'LlmCallError';
  }
}

// Falta configuração (chave, endpoint). Diz o nome da variável, nunca o valor.
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

// "model_not_found", "insufficient_quota", "invalid_request_error": o diagnóstico da primeira chamada real, sem o corpo
const SAFE_ERROR_CODE = /^[a-z0-9_.-]{1,40}$/;
const safeCode = (value: unknown): string | undefined =>
  typeof value === 'string' && SAFE_ERROR_CODE.test(value) ? value : undefined;

// 401 (a chave foi recusada) e 402 (a conta ou a chave está sem crédito) não são falha do modelo: é a nossa configuração. Viram
// LlmConfigError, que o DecideHandler nunca transforma em HOLD (docs/ARENA.md, seção 5): a decisão fica por fazer.
const CONFIG_STATUS = new Set([401, 402]);

function toCallError(error: unknown, provider: LlmProvider): LlmCallError | LlmConfigError {
  if (error instanceof APIConnectionTimeoutError) return new LlmCallError('timeout', provider);
  if (error instanceof APIUserAbortError) return new LlmCallError('timeout', provider);
  if (error instanceof APIError && typeof error.status === 'number') {
    const code = safeCode(error.code);
    const type = safeCode(error.type);
    if (CONFIG_STATUS.has(error.status)) {
      return new LlmConfigError(
        `O provedor ${provider} recusou a chamada (HTTP ${error.status}${code === undefined ? '' : `, code=${code}`}): ` +
          'a chave foi recusada ou está sem crédito. A decisão não vira HOLD; recarregue ou troque a chave e rode de novo',
      );
    }
    return new LlmCallError('http', provider, error.status, {
      ...(code === undefined ? {} : { code }),
      ...(type === undefined ? {} : { type }),
    });
  }
  return new LlmCallError('network', provider);
}

// Tokens de uma chamada acima disto não são plausíveis (o provedor errou): vira 0, em vez de estourar o JSON público
// (inteiro seguro) ou o BIGINT do custo calculado pela tabela de preços.
const MAX_TOKENS = 10_000_000;
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TOKENS
    ? Math.trunc(value)
    : 0;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
// identificador de modelo ou de provedor: curto e sem espaço; qualquer outra coisa não vai para o banco
const IDENTIFIER = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const identifier = (value: unknown): string | null =>
  typeof value === 'string' && IDENTIFIER.test(value) ? value : null;

export interface GatewayOptions {
  // troca o transporte (os testes passam um fetch que não sai do processo)
  fetch?: Fetch;
  // troca o token do Azure (os testes não falam com a Entra ID)
  azureTokenProvider?: () => Promise<string>;
  // troca o endereço do OpenRouter, para o teste exercitar o transporte de produção (undici com o Agent) contra um servidor em
  // 127.0.0.1; sem `fetch`, o SDK usa o transporte de verdade
  openrouterBaseUrl?: string;
}

@Injectable()
export class LlmGateway implements OnModuleDestroy {
  private readonly logger = new Logger(LlmGateway.name);
  private readonly clients = new Map<string, OpenAI>();
  private agent: Agent | undefined;
  private azureToken: (() => Promise<string>) | undefined;

  constructor(
    private readonly env: Pick<Env, 'OPENROUTER_API_KEY' | 'AZURE_OPENAI_ENDPOINT'>,
    private readonly options: GatewayOptions = {},
  ) {}

  async call(input: LlmCall): Promise<LlmResult> {
    const { competitor } = input;
    if (input.timeoutMs <= 0) throw new LlmCallError('timeout', competitor.provider);
    const client = this.clientFor(competitor);
    const body = buildRequestBody(competitor, input.system, input.turns);
    let completion: unknown;
    try {
      completion = await client.chat.completions.create(
        body as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
        { timeout: input.timeoutMs, maxRetries: 0 },
      );
    } catch (error) {
      // sem `cause`: o log do erro serializaria o corpo da resposta
      throw toCallError(error, competitor.provider);
    }
    return this.read(competitor, body, JSON.parse(JSON.stringify(completion)) as unknown);
  }

  private read(competitor: GatewayCompetitor, body: ChatBody, response: unknown): LlmResult {
    const raw = record(response);
    const choice = record((raw.choices as unknown[] | undefined)?.[0]);
    if (Object.keys(choice).length === 0)
      throw new LlmCallError('invalid_response', competitor.provider);
    const content = record(choice.message).content;
    const usage = record(raw.usage);

    const tokens: CallUsage = {
      promptTokens: count(usage.prompt_tokens),
      completionTokens: count(usage.completion_tokens),
      reasoningTokens: count(record(usage.completion_tokens_details).reasoning_tokens),
      totalTokens: count(usage.total_tokens),
    };
    let costMicroUsd = reportedCostMicro(usage.cost);
    let costSource: Applied['costSource'] = 'provider';
    if (costMicroUsd === null) {
      if (competitor.pricingUsdPerMTok) {
        costMicroUsd = pricedCostMicro(tokens, competitor.pricingUsdPerMTok);
        costSource = 'table';
      } else {
        costMicroUsd = 0n;
        costSource = 'none';
        // custo zero de verdade só no fake; num provedor pago o teto mensal subestima o gasto, e alguém tem de saber
        if (competitor.provider !== 'fake') {
          this.logger.warn(
            { provider: competitor.provider, modelId: competitor.modelId },
            'a resposta não trouxe o custo e o competidor não tem tabela de preços: custo registrado como zero',
          );
        }
      }
    }
    return {
      text: typeof content === 'string' ? content : '',
      usage: tokens,
      costMicroUsd,
      response,
      applied: {
        provider: competitor.provider,
        requestedModel: competitor.modelId,
        model: identifier(raw.model),
        upstreamProvider: identifier(raw.provider),
        finishReason: identifier(choice.finish_reason),
        costSource,
        params: {
          maxOutputTokens: body.max_tokens ?? body.max_completion_tokens ?? 0,
          reasoningEffort: body.reasoning_effort ?? null,
          jsonSchema: body.response_format !== undefined,
          tools: false,
          requireParameters: body.provider?.require_parameters ?? false,
          dataCollection: body.provider?.data_collection ?? null,
        },
      },
    };
  }

  private clientFor(competitor: GatewayCompetitor): OpenAI {
    const key =
      competitor.provider === 'azure-openai' ? `azure:${competitor.modelId}` : competitor.provider;
    const cached = this.clients.get(key);
    if (cached) return cached;
    // maxRetries 0: quem tenta de novo é a fila (ADR 0015). logLevel 'off': o SDK loga corpo de requisição no nível debug,
    // e o OPENAI_LOG do ambiente não pode ligar isso.
    const common = { maxRetries: 0, logLevel: 'off' } as const;
    let client: OpenAI;
    switch (competitor.provider) {
      case 'openrouter': {
        const apiKey = this.env.OPENROUTER_API_KEY?.reveal();
        if (!apiKey) {
          throw new LlmConfigError(
            'OPENROUTER_API_KEY ausente (ou PENDENTE): o competidor usa o provedor openrouter',
          );
        }
        client = new OpenAI({
          ...common,
          ...this.transport(competitor),
          apiKey,
          baseURL: this.options.openrouterBaseUrl ?? OPENROUTER_BASE_URL,
        });
        break;
      }
      case 'azure-openai': {
        const endpoint = this.env.AZURE_OPENAI_ENDPOINT;
        if (!endpoint) {
          throw new LlmConfigError(
            'AZURE_OPENAI_ENDPOINT ausente: o competidor usa o provedor azure-openai (docs/ARENA.md)',
          );
        }
        client = new AzureOpenAI({
          ...common,
          ...this.transport(competitor),
          endpoint,
          deployment: competitor.modelId,
          apiVersion: AZURE_API_VERSION,
          // sem chave: o token da identidade gerenciada, renovado pelo SDK a cada requisição
          azureADTokenProvider: this.azureTokenProvider(),
        });
        break;
      }
      case 'fake':
        client = new OpenAI({
          ...common,
          ...this.transport(competitor),
          apiKey: 'fake',
          baseURL: FAKE_BASE_URL,
        });
        break;
    }
    this.clients.set(key, client);
    return client;
  }

  private transport(competitor: GatewayCompetitor): Pick<ClientOptions, 'fetch' | 'fetchOptions'> {
    if (this.options.fetch) return { fetch: this.options.fetch };
    if (competitor.provider === 'fake') return { fetch: createFakeFetch() };
    // O fetch do Node espera os cabeçalhos da resposta por 5 minutos, e um modelo de raciocínio pode levar mais que isso
    // numa chamada sem streaming. O Agent do undici (a mesma saída que o SDK documenta) deixa o limite ser o do nosso
    // orçamento de tempo (callBudget), que é quem manda de verdade.
    this.agent ??= new Agent({
      headersTimeout: REPLICA_TIMEOUT_MS,
      bodyTimeout: REPLICA_TIMEOUT_MS,
      connectTimeout: 30_000,
    });
    return { fetch: undiciFetch, fetchOptions: { dispatcher: this.agent } };
  }

  private azureTokenProvider(): () => Promise<string> {
    this.azureToken ??=
      this.options.azureTokenProvider ??
      getBearerTokenProvider(new DefaultAzureCredential(), AZURE_SCOPE);
    return this.azureToken;
  }

  async onModuleDestroy(): Promise<void> {
    await this.agent?.close();
  }
}
