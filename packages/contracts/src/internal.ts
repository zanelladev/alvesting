import { z } from 'zod';

// A rota INTERNA do site para a api (docs/API.md, seção 6; ADR 0033). A cotação bruta (a barra de preço de um papel) não sai de nenhuma
// rota pública, porque a licença da brapi proíbe "entregar os Dados a terceiros como feed, API ou base bruta": o SSR do site a lê daqui,
// com um segredo que só o servidor tem, e a desenha (as velas da página da ação, o BOVA11 da home). Este arquivo é de propósito separado
// do public.ts: o teste public-quotes.spec.ts reprova cotação bruta em tudo que o public.ts e o cycle.ts exportam.

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
