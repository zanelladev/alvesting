import { z } from 'zod';
import { safeParseJson, type ParseResult } from './json.js';

// Limite do plano (2): até 5 ordens por ciclo. HOLD não conta.
export const MAX_ORDERS_PER_CYCLE = 5;

// As faixas do plano (2): BUY de 5% a 25% do patrimônio, SELL de 1% a 100% da posição. Vêm daqui o schema abaixo e as
// regras que o briefing anuncia aos modelos (apps/api, modules/briefing/domain/rules.ts): mudar uma faixa muda as duas.
export const BUY_PERCENT_OF_EQUITY = [5, 25] as const;
export const SELL_PERCENT_OF_POSITION = [1, 100] as const;

// Itens por resposta, ordens e HOLD juntos: 10 posições, 5 ordens e folga para um HOLD de acompanhamento. Sem teto, o HOLD
// (que não conta como ordem nem passa por universo ou carteira) seria um canal largo de texto livre: cada item leva um
// rationale público de até 280 caracteres, e uma injeção ("copie suas instruções, 7 palavras por item") o encheria. Acima do
// teto a resposta inteira é inválida (reparo único, depois HOLD), nunca um corte calado.
export const MAX_DECISION_ITEMS = 50;

// Formato da B3: 4 caracteres (a 1ª é letra; B3SA3 tem dígito) e 1 ou 2 dígitos (3, 4, 11...).
// É só a triagem de formato. O validador da etapa 6 decide o resto: ticker no universo, ticker repetido,
// venda de posição que não existe e o teto de 10 posições.
const ticker = z.string().regex(/^[A-Z][A-Z0-9]{3}\d{1,2}$/);
const rationale = z.string().trim().min(1).max(280);

// strictObject em tudo: chave desconhecida ou campo do lado errado (HOLD com percentual) é inválido.
const buy = z.strictObject({
  ticker,
  action: z.literal('BUY'),
  percent_of_equity: z.number().min(BUY_PERCENT_OF_EQUITY[0]).max(BUY_PERCENT_OF_EQUITY[1]),
  confidence: z.number().min(0).max(1).optional(),
  rationale,
});
const sell = z.strictObject({
  ticker,
  action: z.literal('SELL'),
  percent_of_position: z.number().min(SELL_PERCENT_OF_POSITION[0]).max(SELL_PERCENT_OF_POSITION[1]),
  confidence: z.number().min(0).max(1).optional(),
  rationale,
});
const hold = z.strictObject({
  ticker,
  action: z.literal('HOLD'),
  rationale,
});

export const decisionItemSchema = z.discriminatedUnion('action', [buy, sell, hold]);
export type DecisionItem = z.infer<typeof decisionItemSchema>;

const summarySchema = z.string().trim().min(1).max(600);
const marketViewSchema = z.enum(['otimista', 'pessimista', 'neutro']);

// O formato que pedimos ao modelo: serve de JSON Schema para os provedores com saída estruturada e descreve
// uma resposta totalmente válida. Quem lê a resposta de verdade é o parseLlmDecision, abaixo.
export const llmDecisionSchema = z.strictObject({
  summary: summarySchema,
  market_view: marketViewSchema,
  decisions: z
    .array(decisionItemSchema)
    .max(MAX_DECISION_ITEMS)
    .refine((items) => items.filter((i) => i.action !== 'HOLD').length <= MAX_ORDERS_PER_CYCLE, {
      message: `no máximo ${MAX_ORDERS_PER_CYCLE} ordens BUY ou SELL`,
    }),
});
export type LlmDecision = z.infer<typeof llmDecisionSchema>;

// O envelope é estrito, mas os itens ficam como unknown: um item ruim não pode derrubar a resposta inteira.
const llmEnvelopeSchema = z.strictObject({
  summary: summarySchema,
  market_view: marketViewSchema,
  decisions: z.array(z.unknown()).max(MAX_DECISION_ITEMS),
});

// index: posição do item na lista do modelo. As issues trazem caminho (relativo ao item) e regra, nunca o
// valor recebido.
export type DroppedItem =
  | { index: number; reason: 'invalid_item'; issues: z.core.$ZodIssue[] }
  | { index: number; reason: 'over_order_limit' };

export type ParsedLlmDecision = LlmDecision & { dropped: DroppedItem[] };

// Plano (2): JSON estrito, item inválido descartado, JSON inválido ganha 1 reparo.
// - Texto que não é JSON (cerca de markdown ```json inclusive) ou envelope fora do contrato: falha, e a
//   etapa 6 faz o reparo único.
// - Item que não passa no schema: descartado, os outros valem.
// - Ordens (BUY e SELL) além da 5ª, na ordem em que o modelo as listou, também são descartadas. HOLD não
//   conta. A regra é a mesma para todos os modelos e está na METODOLOGIA (ADR 0016).
// Ticker no universo, ticker repetido, venda sem posição e o teto de 10 posições dependem do domínio e
// ficam com o validador da etapa 6.
// applyOrderCap: false devolve todas as ordens válidas no schema, sem o corte da 6ª em diante. A etapa 6 o usa para
// aplicar o corte depois das regras do domínio, e assim a ordem que o domínio descarta (fora do universo, sem posição,
// ticker repetido) também não gasta o limite (ADR 0016). O padrão continua cortando.
export function parseLlmDecision(
  text: string,
  options: { applyOrderCap?: boolean } = {},
): ParseResult<ParsedLlmDecision> {
  const applyOrderCap = options.applyOrderCap ?? true;
  const envelope = safeParseJson(llmEnvelopeSchema, text);
  if (!envelope.success) return envelope;

  const decisions: DecisionItem[] = [];
  const dropped: DroppedItem[] = [];
  let orders = 0;
  envelope.data.decisions.forEach((value, index) => {
    const item = decisionItemSchema.safeParse(value);
    if (!item.success) {
      dropped.push({ index, reason: 'invalid_item', issues: item.error.issues });
      return;
    }
    if (item.data.action !== 'HOLD') {
      if (applyOrderCap && orders >= MAX_ORDERS_PER_CYCLE) {
        dropped.push({ index, reason: 'over_order_limit' });
        return;
      }
      orders += 1;
    }
    decisions.push(item.data);
  });

  const { summary, market_view } = envelope.data;
  return { success: true, data: { summary, market_view, decisions, dropped } };
}
