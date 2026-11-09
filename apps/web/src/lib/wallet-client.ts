// Pelo subcaminho, e não pelo índice: este módulo vai ao navegador, e o índice leva o zod junto (packages/contracts/src/portfolio-rules.ts não
// importa nada). É a MESMA regra de dinheiro que a api aplica: "35,50" é 3.550 centavos nos dois lados.
import {
  PORTFOLIO_LIMITS,
  lotCostCents,
  parseBrl,
  parseQuantity,
  type MoneyError,
  type PriceMode,
  type QuantityError,
} from '@alvesting/contracts/portfolio-rules';
import type { Position } from '@alvesting/contracts';
import { messageFor, type Reply } from './account-client';
import { ratioBps } from './chart';
import { formatBRL, formatDate, formatPrice, formatQuantity } from './format';

// O que o navegador faz com a carteira (etapa 12, parte 2; docs/TELAS.md, seção 9): conferir o que a pessoa digitou antes de enviar, montar o
// corpo que a api espera e dizer, em português e no campo, o que a api recusou. Nada daqui importa valor do índice do pacote de contratos
// (leva o zod). A api confere tudo de novo; a conferência daqui só poupa a ida e fala a língua da pessoa.

export const LOTS_PATH = '/api/v1/me/portfolio/lots';
// os tetos, para o modal do lançamento (components/wallet-lots.tsx lê o contrato só por aqui)
export { PORTFOLIO_LIMITS };

// O que a pessoa digitou, em texto. `mode` é o radio ("por ação" ou "total").
export interface LotDraft {
  ticker: string;
  quantity: string;
  mode: PriceMode;
  value: string;
  boughtOn: string;
}

// O corpo do POST e do PATCH (`lotBodySchema` da api): o valor em centavos, e a data só se a pessoa a informou.
export interface LotBody {
  ticker: string;
  quantity: number;
  mode: PriceMode;
  valueCents: number;
  boughtOn?: string;
}

export type LotCheck =
  { ok: true; body: LotBody; costCents: number } | { ok: false; fields: Record<string, string> };

// As chaves de `fields` são o `name` dos campos do formulário: ticker, quantity, value e boughtOn.
const TICKER_EMPTY = 'Informe o ticker da ação, como PETR4.';
const TICKER_FORMAT = 'O ticker tem só letras e números, como PETR4.';
const DATE_FORMAT = 'Data inválida. Use o seletor de data ou escreva AAAA-MM-DD.';
const COST_TOO_LARGE = `O custo total passa de ${formatBRL(PORTFOLIO_LIMITS.maxCostCents)}. Confira a quantidade e o valor.`;

const QUANTITY_ERRORS: Record<QuantityError, string> = {
  empty: 'Informe a quantidade de ações.',
  invalid: 'Use só números inteiros, sem ponto, vírgula nem sinal. Ex.: 100.',
  zero: 'A quantidade precisa ser pelo menos 1.',
  too_large: `A quantidade passa de ${formatQuantity(PORTFOLIO_LIMITS.maxQuantity)} ações por lançamento.`,
};

function valueError(reason: MoneyError, mode: PriceMode): string {
  switch (reason) {
    case 'empty':
      return 'Informe o valor.';
    case 'invalid':
      return 'Valor inválido. Use só números, com vírgula nos centavos. Ex.: 35,50.';
    case 'ambiguous':
      // "1.234" tanto pode ser mil duzentos e trinta e quatro quanto um e vinte e três: a regra não adivinha (portfolio-rules.ts)
      return 'Não dá para saber se o ponto separa milhares ou centavos. Escreva 1.234,00 ou 1234, com vírgula nos centavos.';
    case 'decimals':
      return mode === 'unit'
        ? 'Use no máximo 2 casas depois da vírgula. Se o preço tem mais casas, escolha “Valor total pago” e informe o total.'
        : 'Use no máximo 2 casas depois da vírgula (os centavos).';
    case 'zero':
      return 'O valor precisa ser maior que zero.';
    case 'too_large':
      return `O valor passa de ${formatBRL(PORTFOLIO_LIMITS.maxCostCents)}.`;
  }
}

// Confere o que a pessoa digitou com a mesma regra da api. Todos os campos são conferidos de uma vez (um erro por campo, e o foco vai ao
// primeiro). Com tudo certo, devolve o corpo para a api e o custo total que ela vai guardar (os dois modos dão o mesmo custo).
export function checkLot(draft: LotDraft): LotCheck {
  const fields: Record<string, string> = {};

  const ticker = draft.ticker.trim().toUpperCase();
  if (ticker === '') fields.ticker = TICKER_EMPTY;
  else if (!/^[A-Z0-9]{1,12}$/.test(ticker)) fields.ticker = TICKER_FORMAT;

  const quantity = parseQuantity(draft.quantity);
  if (!quantity.ok) fields.quantity = QUANTITY_ERRORS[quantity.reason];
  const value = parseBrl(draft.value);
  if (!value.ok) fields.value = valueError(value.reason, draft.mode);

  // o navegador entrega AAAA-MM-DD; um que não tenha o seletor de data entrega o que a pessoa escreveu
  const boughtOn = draft.boughtOn.trim();
  if (boughtOn !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(boughtOn)) fields.boughtOn = DATE_FORMAT;

  let costCents = 0;
  if (quantity.ok && value.ok) {
    const cost = lotCostCents(draft.mode, quantity.quantity, value.cents);
    // quantidade e valor já estão dentro dos tetos: só o produto (o modo "por ação") pode passar do teto do custo
    if (cost.ok) costCents = cost.costCents;
    else fields.value = COST_TOO_LARGE;
  }
  if (Object.keys(fields).length > 0 || !quantity.ok || !value.ok) return { ok: false, fields };

  return {
    ok: true,
    costCents,
    body: {
      ticker,
      quantity: quantity.quantity,
      mode: draft.mode,
      valueCents: value.cents,
      ...(boughtOn === '' ? {} : { boughtOn }),
    },
  };
}

// --- o campo de dinheiro do modal (o padrão dos bancos brasileiros) -----------------------------------------------------------------
// Os centavos entram pela direita: o campo guarda os algarismos (os centavos, sem os zeros da frente) e mostra o texto deles, e cada tecla é
// lida do texto novo do campo. Só algarismos contam, então o teclado de números de qualquer celular serve, e o ponto que um teclado de
// Android manda no lugar da vírgula não muda nada (com o Money input da Arc, "35.50" em pt-BR virava R$ 3.550). O texto que o campo mostra
// ("1.234,56") é o que o formulário envia, e o `parseBrl` o lê como sempre (o checkLot não muda).
// No máximo 12 algarismos: R$ 9.999.999.999,99, acima do teto do custo, que o checkLot recusa com a frase dele.
const MONEY_DIGITS = 12;

// O texto do campo depois de uma tecla (ou de um Backspace), em algarismos; null quando passa do máximo (o campo fica como estava).
export function typedCents(text: string): string | null {
  const digits = text.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length > MONEY_DIGITS ? null : digits;
}

// O que se cola passa pela regra do contrato ("35", "35,5", "1.234,56" e "R$ 35,50", sem o "R$"); o que ela recusa não muda nada (null).
export function pastedCents(text: string): string | null {
  const read = parseBrl(text.replace(/^\s*R\$/i, ''));
  return read.ok ? String(read.cents) : null;
}

// O que o campo mostra: "" (o marcador "0,00" aparece) ou o valor com o milhar ("1.234,56").
export const centsText = (digits: string): string =>
  digits === '' ? '' : formatPrice(Number(digits));

// A linha acima dos botões do modal: no modo por ação, o custo total (o do contrato); no modo total, o preço médio por ação, arredondado no
// centavo mais próximo com o meio para longe do zero (a regra `divRound` da api, em conta inteira). Some sem valor ou acima do teto do custo.
export function lotSummary(
  mode: PriceMode,
  quantity: number,
  valueCents: number | null,
): { label: string; cents: number } | null {
  if (valueCents === null) return null;
  const cost = lotCostCents(mode, quantity, valueCents);
  if (!cost.ok) return null;
  if (mode === 'unit') return { label: 'Custo total', cents: cost.costCents };
  const [total, count] = [BigInt(valueCents), BigInt(quantity)];
  return { label: 'Preço médio por ação', cents: Number((2n * total + count) / (2n * count)) };
}

// "100 MOVE3": como a tela chama um lançamento nos avisos, nos nomes dos botões e na pergunta de apagar.
export const describeLot = (lot: { quantity: number; ticker: string }): string =>
  `${formatQuantity(lot.quantity)} ${lot.ticker}`;

// As frases do resultado (a região de status da tela; o leitor de tela as anuncia).
export const createdMessage = (lot: { quantity: number; ticker: string }, costCents: number) =>
  `Compra lançada: ${describeLot(lot)}, custo total ${formatBRL(costCents)}.`;
export const savedMessage = (lot: { quantity: number; ticker: string }, costCents: number) =>
  `Lançamento salvo: ${describeLot(lot)}, custo total ${formatBRL(costCents)}.`;
export const removedMessage = (lot: { quantity: number; ticker: string }) =>
  `Lançamento apagado: ${describeLot(lot)}.`;

// --- o que a api recusou ---------------------------------------------------------------------------------------------------
// O campo da api (o primeiro trecho do caminho do problema) e o campo do formulário que o mostra.
const FIELD_OF: Record<string, string> = {
  ticker: 'ticker',
  quantity: 'quantity',
  valueCents: 'value',
  boughtOn: 'boughtOn',
};

const API_FIELD_ERRORS: Record<string, string> = {
  ticker:
    'Não encontramos esta ação. Use o código de uma ação da B3 que a Alvesting acompanha, como PETR4. O BOVA11 e os fundos não entram.',
  quantity: `Confira a quantidade: um número inteiro de 1 a ${formatQuantity(PORTFOLIO_LIMITS.maxQuantity)}.`,
  value: `Confira o valor: o custo total do lançamento não pode passar de ${formatBRL(PORTFOLIO_LIMITS.maxCostCents)}.`,
  boughtOn: `A data não pode ser no futuro nem anterior a ${formatDate(PORTFOLIO_LIMITS.minBoughtOn)}.`,
};

export interface LotFailure {
  // erro por campo (a chave é o `name` do campo), quando a api disse qual campo recusou
  fields?: Record<string, string>;
  // o aviso do formulário, quando o erro não é de um campo só
  message?: string;
  // para onde a pessoa vai para resolver: a entrada (a sessão acabou) ou a conta (o aceite dos termos)
  link?: 'entrar' | 'conta';
  // o lançamento não existe mais (apagado noutra aba): a lista precisa ser atualizada
  gone?: true;
}

// A resposta que não deu certo, em frases da tela. Nunca a mensagem da api (ela pode repetir o que o cliente mandou): só o código e o campo.
export function lotFailure(reply: Reply): LotFailure {
  if (reply.status === 400 && reply.code === 'VALIDATION_ERROR') {
    const fields: Record<string, string> = {};
    for (const path of reply.paths ?? []) {
      const field = FIELD_OF[path];
      if (field && !(field in fields)) fields[field] = API_FIELD_ERRORS[field]!;
    }
    if (Object.keys(fields).length > 0) return { fields };
    return { message: 'Não foi possível concluir. Confira os dados e tente de novo.' };
  }
  if (reply.status === 409 && reply.code === 'LOT_LIMIT') {
    return {
      message: `A carteira chegou ao máximo de ${PORTFOLIO_LIMITS.maxLots} lançamentos. Apague algum para lançar outro.`,
    };
  }
  if (reply.status === 403 && reply.code === 'CONSENT_REQUIRED') {
    return {
      message: 'Os termos mudaram. Aceite a versão nova na sua conta para continuar.',
      link: 'conta',
    };
  }
  if (reply.status === 401) {
    return { message: 'Sua sessão acabou. Entre de novo para continuar.', link: 'entrar' };
  }
  if (reply.status === 404) {
    return {
      gone: true,
      message: 'Este lançamento não existe mais (talvez tenha sido apagado em outra aba).',
    };
  }
  return { message: messageFor(reply) };
}

// A alocação da carteira, para a rosca (docs/TELAS.md, seção 9; o valor de cada posição é do dono, ADR 0033): a parte de cada posição com
// fechamento no valor estimado, da maior para a menor (o empate na ordem do ticker), em pontos-base inteiros com o meio para longe do zero
// (`ratioBps`, a regra do projeto). Até seis ações, uma fatia por ação; mais que isso, as cinco maiores e "Outras" com a soma do resto: uma rosca
// de duzentas fatias não se lê. A posição sem cotação (e a de valor zero) não tem fatia: fica fora do valor estimado, e o custo dela segue no
// custo total. A cor é a da ordem (`--fatia-1` a `--fatia-6` e `--fatia-outras`, no globals.css: os tons da primária, que seguem o tema).
export interface Fatia {
  id: string;
  nome: string;
  valueCents: number;
  shareBps: number;
  cor: string;
  tickers: string[];
}
const FATIAS = 6;

export function alocacao(positions: readonly Position[]): { totalCents: number; fatias: Fatia[] } {
  const priced = positions
    .filter(
      (p): p is Position & { valueCents: number } => p.valueCents !== null && p.valueCents > 0,
    )
    .sort((a, b) => b.valueCents - a.valueCents || a.ticker.localeCompare(b.ticker));
  const totalCents = priced.reduce((sum, p) => sum + p.valueCents, 0);
  const share = (cents: number) => ratioBps(cents, totalCents) ?? 0;
  const own = priced.length > FATIAS ? priced.slice(0, FATIAS - 1) : priced;
  const fatias: Fatia[] = own.map((p, i) => ({
    id: p.ticker,
    nome: p.ticker,
    valueCents: p.valueCents,
    shareBps: share(p.valueCents),
    cor: `var(--fatia-${i + 1})`,
    tickers: [p.ticker],
  }));
  const rest = priced.slice(own.length);
  if (rest.length > 0) {
    const valueCents = rest.reduce((sum, p) => sum + p.valueCents, 0);
    fatias.push({
      id: 'outras',
      nome: `Outras (${rest.length} ações)`,
      valueCents,
      shareBps: share(valueCents),
      cor: 'var(--fatia-outras)',
      tickers: rest.map((p) => p.ticker),
    });
  }
  return { totalCents, fatias };
}
