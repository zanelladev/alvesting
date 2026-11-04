import { z } from 'zod';
import {
  BUY_PERCENT_OF_EQUITY,
  MAX_ORDERS_PER_CYCLE,
  SELL_PERCENT_OF_POSITION,
} from './llm-decision.js';

// A temporada e o elenco (plano 2 e 8). Os mesmos schemas servem ao comando season:create, à API, ao web e à
// liquidação: quem lê os parâmetros lê daqui.

export const SEASON_STATUSES = ['DRAFT', 'RUNNING', 'FINISHED'] as const;
export const seasonStatusSchema = z.enum(SEASON_STATUSES);
export type SeasonStatus = z.infer<typeof seasonStatusSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const seed = z.string().trim().min(1).max(64);
const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const displayName = z.string().trim().min(1).max(80);

// Parâmetros da temporada. Dinheiro em centavos inteiros (nunca float); em JSON é um número seguro, e o código converte
// para bigint onde faz conta. O limite de ordens e as faixas de BUY e SELL continuam vindo das constantes do contrato da
// decisão (llm-decision.ts): o validador da resposta do modelo usa as mesmas, então a temporada não pode anunciar outras.
export const seasonParamsSchema = z
  .strictObject({
    capitalCents: z.number().int().min(100).max(Number.MAX_SAFE_INTEGER).default(10_000_000),
    sessions: z.number().int().min(1).max(60).default(20),
    maxPositions: z.number().int().min(1).max(50).default(10),
    maxOrdersPerCycle: z.literal(MAX_ORDERS_PER_CYCLE).default(MAX_ORDERS_PER_CYCLE),
    buyPercentOfEquity: z
      .tuple([z.literal(BUY_PERCENT_OF_EQUITY[0]), z.literal(BUY_PERCENT_OF_EQUITY[1])])
      .default([BUY_PERCENT_OF_EQUITY[0], BUY_PERCENT_OF_EQUITY[1]]),
    sellPercentOfPosition: z
      .tuple([z.literal(SELL_PERCENT_OF_POSITION[0]), z.literal(SELL_PERCENT_OF_POSITION[1])])
      .default([SELL_PERCENT_OF_POSITION[0], SELL_PERCENT_OF_POSITION[1]]),
    // 3 pontos-base = 0,03% por operação
    tradeCostBps: z.number().int().min(0).max(1000).default(3),
    // Brasília. A hora da decisão e o prazo (plano 2); depois do prazo vale HOLD
    decisionTimeBrt: hhmm.default('08:00'),
    deadlineTimeBrt: hhmm.default('09:30'),
    // sem padrão: cada temporada fixa as suas, e a semente é pública (reprodutibilidade)
    randomSeed: seed,
    monteCarloSeed: seed,
    monteCarloRuns: z.number().int().min(1).max(10_000).default(1000),
  })
  .refine((params) => params.decisionTimeBrt < params.deadlineTimeBrt, {
    path: ['deadlineTimeBrt'],
    message: 'o prazo tem de ser depois da hora da decisão',
  });
export type SeasonParams = z.infer<typeof seasonParamsSchema>;

export const LLM_PROVIDERS = ['openrouter', 'azure-openai', 'fake'] as const;
export const llmProviderSchema = z.enum(LLM_PROVIDERS);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

export const BENCHMARKS = ['EQUAL_WEIGHT', 'CDI', 'BOVA11'] as const;
export const benchmarkSchema = z.enum(BENCHMARKS);

// Preço em dólares por milhão de tokens, como texto decimal (sem notação científica, sem float).
const usdPerMTok = z.string().regex(/^\d{1,6}(\.\d{1,6})?$/);

// O ID do modelo é fixado na criação da temporada. No OpenRouter é o ID da lista pública (laboratório/modelo), nunca um
// roteador (openrouter/auto escolhe o modelo por conta própria); no Azure é o nome da implantação; no fake, fake/<nome>.
// Sem ":" no OpenRouter: o sufixo de variante muda o que é chamado (":online" liga a busca na web, ":nitro" e ":floor" mudam o
// roteamento, ":free" e ":batch" são outro serviço) e quebraria "mesmos parâmetros, sem ferramentas nem web". Um modelo que só
// existe numa variante é decisão de código, não de arquivo de temporada.
const MODEL_ID: Record<LlmProvider, RegExp> = {
  openrouter: /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/,
  'azure-openai': /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  fake: /^fake\/[a-z0-9]+(-[a-z0-9]+)*$/,
};

// A regra acima como função: o arquivo da temporada a aplica (abaixo) e o job de decisões a reaplica ao ler o competidor do BANCO, porque o
// CHECK da tabela não tem este regex (uma linha escrita por fora do contrato, `:online` ou `openrouter/auto`, seria chamada e paga).
export const isValidModelId = (provider: LlmProvider, modelId: string): boolean =>
  modelId.length <= 128 && MODEL_ID[provider].test(modelId) && !modelId.startsWith('openrouter/');

const modelSpec = z
  .strictObject({
    kind: z.literal('MODEL'),
    slug,
    name: displayName,
    provider: llmProviderSchema,
    modelId: z.string().max(128),
    // O que o provedor aceita (a lista pública do OpenRouter diz em supported_parameters). Desligado = o parâmetro não
    // é enviado: JSON Schema só "quando o provedor aceitar", esforço de raciocínio médio só "onde existir" (plano 10)
    capabilities: z
      .strictObject({ jsonSchema: z.boolean(), reasoningEffort: z.boolean() })
      .default({ jsonSchema: false, reasoningEffort: false }),
    // Para o provedor que não devolve o custo (Azure OpenAI, onde é obrigatório). O OpenRouter devolve em usage.cost e vale
    // mais; a tabela fica de reserva
    pricingUsdPerMTok: z.strictObject({ input: usdPerMTok, output: usdPerMTok }).optional(),
  })
  .superRefine((model, ctx) => {
    if (!isValidModelId(model.provider, model.modelId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['modelId'],
        message: `ID de modelo inválido para o provedor ${model.provider} (fixe um ID da lista pública, sem sufixo de variante e nunca um roteador)`,
      });
    }
    // Sem a tabela o custo do Azure seria zero e o teto mensal nunca fecharia para ele (falharia para o lado aberto)
    if (model.provider === 'azure-openai' && !model.pricingUsdPerMTok) {
      ctx.addIssue({
        code: 'custom',
        path: ['pricingUsdPerMTok'],
        message:
          'o Azure OpenAI não devolve o custo: informe os preços por milhão de tokens (pricingUsdPerMTok)',
      });
    }
  });

export const competitorSpecSchema = z.discriminatedUnion('kind', [
  modelSpec,
  z.strictObject({ kind: z.literal('RANDOM'), slug, name: displayName }),
  z.strictObject({
    kind: z.literal('BENCHMARK'),
    slug,
    name: displayName,
    benchmark: benchmarkSchema,
  }),
]);
export type CompetitorSpec = z.infer<typeof competitorSpecSchema>;

export const MAX_MODELS = 30;

// O arquivo do season:create: o elenco completo da temporada (plano 10). Nunca leva segredo: a chave do OpenRouter e o
// prompt chegam pelo ambiente, e o schema é estrito para recusar uma chave que alguém ponha aqui por engano.
export const seasonFileSchema = z
  .strictObject({
    slug,
    name: displayName,
    params: seasonParamsSchema,
    competitors: z.array(competitorSpecSchema).min(1).max(60),
  })
  .superRefine((file, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['competitors'], message });
    const slugs = new Set<string>();
    for (const competitor of file.competitors) {
      if (slugs.has(competitor.slug)) issue(`slug repetido: ${competitor.slug}`);
      slugs.add(competitor.slug);
    }
    const models = file.competitors.filter((c) => c.kind === 'MODEL').length;
    if (models < 1) issue('o elenco precisa de pelo menos um modelo');
    if (models > MAX_MODELS) issue(`o elenco tem no máximo ${MAX_MODELS} modelos`);
    if (file.competitors.filter((c) => c.kind === 'RANDOM').length !== 1) {
      issue('o elenco precisa de exatamente um Sorteio (controle obrigatório do ranking)');
    }
    for (const benchmark of BENCHMARKS) {
      const count = file.competitors.filter(
        (c) => c.kind === 'BENCHMARK' && c.benchmark === benchmark,
      ).length;
      if (count !== 1) issue(`o elenco precisa de exatamente uma referência ${benchmark}`);
    }
  });
export type SeasonFile = z.infer<typeof seasonFileSchema>;
