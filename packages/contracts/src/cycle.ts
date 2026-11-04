import { z } from 'zod';
import { ulidSchema } from './messages.js';
import { llmProviderSchema } from './season.js';

// O ciclo de um pregão como a API o mostra (GET /api/v1/cycles/:id). É o formato PÚBLICO: o hash do prompt e o do briefing
// sim; o texto do prompt, o IO bruto e o endereço do Blob nunca. O schema é estrito de propósito: campo novo exige decisão.

export const CYCLE_STATUSES = ['OPEN', 'CLOSED', 'SKIPPED'] as const;
export const cycleStatusSchema = z.enum(CYCLE_STATUSES);
export type CycleStatus = z.infer<typeof cycleStatusSchema>;

// Por que o ciclo inteiro foi pulado (nenhum modelo é chamado).
export const SKIP_REASONS = ['sem_briefing', 'orcamento'] as const;

// Por que a decisão de um modelo virou HOLD forçado (docs/ARENA.md):
// prazo: depois das 09:30 de Brasília; prompt_divergente: a versão ou o hash do prompt não é o do ciclo;
// resposta_invalida: JSON inválido mesmo depois do reparo; falha: o handler esgotou as tentativas (a mensagem iria
// para a DLQ); sem_resposta: a varredura achou o ciclo vencido sem decisão (processo que caiu).
export const HOLD_REASONS = [
  'prazo',
  'prompt_divergente',
  'resposta_invalida',
  'falha',
  'sem_resposta',
] as const;
export const holdReasonSchema = z.enum(HOLD_REASONS);
export type HoldReason = z.infer<typeof holdReasonSchema>;

// Por que um item da resposta do modelo foi descartado. Só o motivo e a posição: o conteúdo do item não sai.
export const DROP_REASONS = [
  'invalid_item',
  'over_order_limit',
  'not_in_universe',
  'not_in_portfolio',
  'duplicate_ticker',
  'max_positions',
] as const;
export const dropReasonSchema = z.enum(DROP_REASONS);
export type DropReason = z.infer<typeof dropReasonSchema>;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const usageSchema = z.strictObject({
  calls: z.number().int().min(0),
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  reasoningTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
});
export type LlmUsage = z.infer<typeof usageSchema>;

// O que o provedor aplicou (plano 10): o modelo e o provedor que ele diz ter usado (identificadores curtos, nunca texto livre),
// o que foi pedido e o número de chamadas. Estrito como o resto: a API só devolve o que está aqui.
const identifier = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9._:/@+-]+$/);
const appliedSchema = z.strictObject({
  provider: llmProviderSchema,
  requestedModel: z.string().max(128),
  model: identifier.nullable(),
  upstreamProvider: identifier.nullable(),
  finishReason: identifier.nullable(),
  // de onde veio o custo: o que o provedor informou, a tabela de preços do competidor ou nenhum dos dois
  costSource: z.enum(['provider', 'table', 'none']),
  params: z.strictObject({
    maxOutputTokens: z.number().int().min(0),
    reasoningEffort: z.literal('medium').nullable(),
    jsonSchema: z.boolean(),
    tools: z.literal(false),
    requireParameters: z.boolean(),
    dataCollection: z.literal('deny').nullable(),
  }),
  calls: z.number().int().min(0),
});
export type LlmApplied = z.infer<typeof appliedSchema>;

const itemView = z.strictObject({
  position: z.number().int().min(0),
  action: z.enum(['BUY', 'SELL', 'HOLD']),
  ticker: z.string(),
  percent: z.number().nullable(),
  confidence: z.number().nullable(),
  rationale: z.string(),
});

const decisionView = z.strictObject({
  competitor: z.strictObject({ id: ulidSchema, slug: z.string(), name: z.string() }),
  status: z.enum(['DECIDED', 'FORCED_HOLD']),
  holdReason: holdReasonSchema.nullable(),
  marketView: z.enum(['otimista', 'pessimista', 'neutro']).nullable(),
  summary: z.string().nullable(),
  inputSha256: sha256.nullable(),
  outputSha256: sha256.nullable(),
  // micro-dólares (1 US$ = 1.000.000): inteiro, sem float
  costMicroUsd: z.number().int().min(0),
  usage: usageSchema.nullable(),
  // o que o provedor aplicou: modelo e provedor reais, parâmetros pedidos
  applied: appliedSchema.nullable(),
  items: z.array(itemView),
  dropped: z.array(z.strictObject({ position: z.number().int().min(0), reason: dropReasonSchema })),
});
export type DecisionView = z.infer<typeof decisionView>;

export const cycleViewSchema = z.strictObject({
  id: ulidSchema,
  seasonId: ulidSchema,
  date: z.iso.date(),
  status: cycleStatusSchema,
  skipReason: z.enum(SKIP_REASONS).nullable(),
  decisionAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  prompt: z.strictObject({ version: z.string(), sha256: sha256.nullable() }).nullable(),
  briefing: z.strictObject({ sha256 }).nullable(),
  decisions: z.array(decisionView),
});
export type CycleView = z.infer<typeof cycleViewSchema>;
