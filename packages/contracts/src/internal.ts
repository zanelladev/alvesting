import { z } from 'zod';
import { decisionItemSchema } from './llm-decision.js';

// As rotas INTERNAS do site para a api (docs/API.md, seção 6; ADR 0033). A cotação bruta (a barra de preço de um papel) não sai de nenhuma
// rota pública, porque a licença da brapi proíbe "entregar os Dados a terceiros como feed, API ou base bruta": o SSR do site a lê daqui,
// com um segredo que só o servidor tem, e a desenha (as velas da página da ação, o BOVA11 e a fita da home). Este arquivo é de propósito
// separado do public.ts: o teste public-quotes.spec.ts reprova cotação bruta em tudo que o public.ts e o cycle.ts exportam.

// As barras que a rota devolve: as 60 mais recentes, da mais antiga à mais nova (o que a página da ação desenha).
export const INTERNAL_BARS_LIMIT = 60;

// O segredo da rota (QUOTES_SECRET, segredo quotes-secret do Key Vault): a rota é alcançável pelo endereço direto da api, então ele é a única
// defesa dela. Menos que isto é erro de configuração e vale como ausente (o seed gera 384 bits).
export const QUOTES_SECRET_MIN_LENGTH = 32;

// A forma do segredo: só caracteres ASCII visíveis, sem espaço nem controle (o `openssl rand -base64` cumpre). Uma quebra de linha no meio do
// valor (colagem à mão no Key Vault) faria o `fetch` do Node recusar o cabeçalho com o valor INTEIRO na mensagem do erro, que vai ao log do
// servidor; a api e o site aplicam a mesma forma (depois de aparar as pontas) e recusam o resto antes de usá-lo.
export const QUOTES_SECRET_SHAPE = /^[\x21-\x7e]+$/;

const cents = z.number().int().safe();

export const internalBarSchema = z.strictObject({
  date: z.iso.date(),
  openCents: cents,
  highCents: cents,
  lowCents: cents,
  closeCents: cents,
});
export type InternalBar = z.infer<typeof internalBarSchema>;

// Papel que não existe, ou que ainda não tem barra, é lista vazia (200): o 404 desta rota quer dizer só "a rota não é para você" (sem o
// segredo, ou com o errado), e o site o trata como erro de configuração, nunca como "ação não encontrada".
export const internalBarsSchema = z.strictObject({
  bars: z.array(internalBarSchema).max(INTERNAL_BARS_LIMIT),
});
export type InternalBars = z.infer<typeof internalBarsSchema>;

// --- a fita da home ----------------------------------------------------------------------------------------------------------------
// O ticker no formato da B3, o mesmo das decisões e da API pública (reaproveitado pela forma, não copiado).
const ticker = decisionItemSchema.options[2].shape.ticker;

// O teto da fita: o tamanho máximo do universo (UNIVERSE_RULES.maxMembers da api, que o teste da rota confere ser o mesmo número).
export const INTERNAL_TAPE_LIMIT = 500;

export const internalTapeRowSchema = z.strictObject({
  ticker,
  closeCents: cents,
  // o fechamento do papel no pregão anterior a `date`; nulo se ele não tem barra nesse pregão
  previousCloseCents: cents.nullable(),
});
export type InternalTapeRow = z.infer<typeof internalTapeRowSchema>;

// O universo da semana do último ciclo (os papéis que o briefing deu a todos os modelos), na ordem do universo (1 = maior volume
// financeiro médio), com o fechamento do pregão `date`: o mais recente com barra até o pregão do ciclo. Só entra o papel com barra
// nesse pregão. Sem ciclo, sem universo ou sem barra, a resposta vazia: `{ date: null, rows: [] }` (200, nunca 404: o 404 desta rota
// quer dizer só "não é para você", como o das barras).
export const internalTapeSchema = z
  .strictObject({
    date: z.iso.date().nullable(),
    rows: z.array(internalTapeRowSchema).max(INTERNAL_TAPE_LIMIT),
  })
  .refine((tape) => (tape.date === null) === (tape.rows.length === 0), {
    message: 'a data do pregão existe se e só se há linha',
  });
export type InternalTape = z.infer<typeof internalTapeSchema>;
