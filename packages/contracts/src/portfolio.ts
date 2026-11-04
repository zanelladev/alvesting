import { z } from 'zod';
import { ulidSchema } from './messages.js';
import { PORTFOLIO_LIMITS, PRICE_MODES, lotCostCents } from './portfolio-rules.js';
import { queryDateSchema, tickerParamSchema } from './public.js';

// A carteira do usuário (plano §3 e §11, etapa 12; docs/API.md, seção 9): o que o site manda para /api/v1/me/portfolio e o que a api
// devolve. Tudo é estrito, como na conta: campo a mais na entrada é 400 e o que não está aqui não sai. A regra de dinheiro (ler o valor em
// reais, o custo total nos dois modos e os tetos) mora em portfolio-rules.ts, um módulo sem imports que o formulário do site também usa.
//
// O DONO nunca vem no corpo, na query nem no caminho: a rota usa o ULID da sessão (docs/CONTA.md, seção 4).

export {
  PORTFOLIO_LIMITS,
  PRICE_MODES,
  lotCostCents,
  parseBrl,
  parseQuantity,
  type LotCost,
  type MoneyParse,
  type PriceMode,
  type QuantityParse,
} from './portfolio-rules.js';

// Dinheiro e taxa são inteiros seguros: em JSON viram número exato (a api recusa o que perderia precisão), como no contrato público.
const int = z.number().int().safe();
const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime();

// --- entrada -------------------------------------------------------------------------------------------------------------
// POST /me/portfolio/lots e PATCH /me/portfolio/lots/:id (o PATCH troca o lançamento INTEIRO, com este mesmo corpo). `valueCents` é o preço
// de UMA ação no modo "unit" e o total pago no modo "total"; os dois modos geram o mesmo custo para os mesmos números. O ticker aceita
// minúsculas (o site as aceita) e sai maiúsculo. Quem confere que o ticker existe é o serviço (a tabela `instrument` está no banco, não no
// contrato), e a data da compra não pode estar no futuro (o relógio também é do serviço).
export const lotBodySchema = z
  .strictObject({
    ticker: tickerParamSchema,
    quantity: z.number().int().min(1).max(PORTFOLIO_LIMITS.maxQuantity),
    mode: z.enum(PRICE_MODES),
    valueCents: z.number().int().min(1).max(PORTFOLIO_LIMITS.maxCostCents),
    boughtOn: queryDateSchema
      .refine((date) => date >= PORTFOLIO_LIMITS.minBoughtOn, 'a data da compra é antiga demais')
      .nullish(),
  })
  .transform((body, ctx) => {
    const cost = lotCostCents(body.mode, body.quantity, body.valueCents);
    if (!cost.ok) {
      // quantidade e valor já foram conferidos acima, então só o produto pode estar fora do teto (o modo "por ação" com os dois grandes)
      ctx.issues.push({
        code: 'custom',
        input: body.valueCents,
        path: ['valueCents'],
        message: 'o custo total do lançamento passa do teto',
      });
      return z.NEVER;
    }
    return {
      ticker: body.ticker,
      quantity: body.quantity,
      costCents: cost.costCents,
      boughtOn: body.boughtOn ?? null,
    };
  });
export type LotInput = z.output<typeof lotBodySchema>;

// O :id da rota (PATCH e DELETE): um ULID. Qualquer outra coisa é 400 antes de tocar o banco.
export const lotIdParamSchema = ulidSchema;

// --- resposta ------------------------------------------------------------------------------------------------------------
// Um lançamento, como o dono o vê. Sem o id da carteira nem o do usuário.
export const lotSchema = z.strictObject({
  id: ulidSchema,
  ticker: tickerParamSchema,
  quantity: int.min(1),
  costCents: int.min(1),
  boughtOn: isoDate.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Lot = z.infer<typeof lotSchema>;

// A posição consolidada de um ticker: a soma dos lançamentos dele. O preço médio é Σ custo ÷ Σ quantidade, arredondado para o centavo mais
// próximo (o meio vai para longe do zero, a regra de docs/METODOLOGIA.md). O fechamento é o `close_cents` da barra mais recente do papel, com
// a data dela; sem barra (ou com uma barra acima de PORTFOLIO_LIMITS.maxCloseCents, que não é cotação), `closeCents`, `closeDate`,
// `valueCents`, `pnlCents` e `pnlBps` são nulos. `valueCents` é quantidade × fechamento e `pnlCents`, valor − custo, os dois EXATOS; `pnlBps` é
// o P&L sobre o custo em pontos-base (1% = 100), arredondado do mesmo jeito, e é nulo também com fechamento quando passaria do inteiro seguro
// (custo de centavos sobre valor alto). O estado misturado não existe: ou a posição tem fechamento, data, valor e P&L, ou não tem nenhum dos
// cinco; o `refine` o recusa, para o cliente não ter de checar campo a campo.
export const positionSchema = z
  .strictObject({
    ticker: tickerParamSchema,
    quantity: int.min(1),
    costCents: int.min(1),
    avgPriceCents: int.min(0),
    closeCents: int.min(0).nullable(),
    closeDate: isoDate.nullable(),
    valueCents: int.min(0).nullable(),
    pnlCents: int.nullable(),
    pnlBps: int.nullable(),
  })
  .refine(
    (p) => {
      const priced = p.closeCents !== null;
      return (
        (p.closeDate !== null) === priced &&
        (p.valueCents !== null) === priced &&
        (p.pnlCents !== null) === priced &&
        (priced || p.pnlBps === null)
      );
    },
    {
      message:
        'fechamento, data, valor e P&L vêm juntos (ou nenhum), e o percentual não existe sem eles',
    },
  );
export type Position = z.infer<typeof positionSchema>;

// Os totais. `costCents` é o de TODOS os lançamentos; o valor de mercado e o P&L só contam as posições com fechamento (`unpriced` diz quantas
// ficaram de fora), e `pricedCostCents` é o custo dessas posições, o que o P&L total desconta: pnlCents = valueCents − pricedCostCents. O valor
// e o P&L vêm juntos (ambos nulos sem nenhuma posição com fechamento), e o percentual, que também é nulo quando passaria do inteiro seguro,
// não existe sem eles.
export const totalsSchema = z
  .strictObject({
    costCents: int.min(0),
    pricedCostCents: int.min(0),
    valueCents: int.min(0).nullable(),
    pnlCents: int.nullable(),
    pnlBps: int.nullable(),
    unpriced: int.min(0),
  })
  .refine(
    (t) =>
      (t.valueCents !== null) === (t.pnlCents !== null) &&
      (t.valueCents !== null || t.pnlBps === null),
    {
      message: 'valor e P&L vêm juntos, e o percentual não existe sem eles',
    },
  );
export type Totals = z.infer<typeof totalsSchema>;

// GET /me/portfolio: os lançamentos (do mais recente pela data da compra; sem data, no fim), as posições por ticker (ordem alfabética) e os totais.
export const portfolioSchema = z.strictObject({
  lots: z.array(lotSchema).max(PORTFOLIO_LIMITS.maxLots),
  positions: z.array(positionSchema).max(PORTFOLIO_LIMITS.maxLots),
  totals: totalsSchema,
});
export type Portfolio = z.infer<typeof portfolioSchema>;

// DELETE /me/portfolio/lots/:id
export const lotDeletedSchema = z.strictObject({ deleted: z.literal(true) });
