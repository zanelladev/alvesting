import { expect, type APIRequestContext } from '@playwright/test';
import {
  envelopeSchema,
  internalBarsSchema,
  internalTapeSchema,
  type Envelope,
} from '@alvesting/contracts';
import type { z } from 'zod';
import { API_URL, QUOTES_SECRET } from './api-server';

// Apoio dos e2e das telas (etapa 9, parte 2). Os testes leem a MESMA api que o site lê (o banco sintético do ensaio, semeado a cada
// subida: docs/ENSAIO.md) e conferem que a tela mostra o que o contrato diz, valor a valor. A formatação esperada é escrita aqui,
// por outro caminho que o do site (src/lib/format.ts, que tem os próprios testes): se os dois errassem do mesmo jeito o teste
// passaria, então nada daqui importa do site.

// A temporada sintética do ensaio (slug) e o que há nela: 5 pregões (03/11 a 09/11/2026), os 6 modelos do elenco da Temporada 1 com
// decisões simuladas (provedor fake), o Sorteio e 3 referências. MODEL é o GPT-6.1 Sol, que segue a estratégia do contrário (fake/contrarian).
export const SEASON = 'ensaio';
export const LAST_DAY = '2026-11-09';
export const CYCLE_DAY = '2026-11-04';
export const MODEL = 'gpt-6-1-sol';
// os seis do elenco, na ordem do arquivo da temporada (apps/api/seasons/ensaio.json)
export const CAST = [
  'Claude Opus 5.5',
  'GPT-6.1 Sol',
  'Gemini 4 Argon',
  'Grok 4.7',
  'DeepSeek V4 Pro (0813)',
  'Qwen3.8 Max (0902)',
] as const;
export const TICKER = 'MOVE3';
// quantas decisões o feed da home mostra por página (apps/web/src/app/page.tsx, FEED_LIMIT)
export const FEED_PAGE = 5;

export async function fetchApi<S extends z.ZodType>(
  request: APIRequestContext,
  path: string,
  schema: S,
): Promise<z.output<S>> {
  const response = await request.get(`${API_URL}/api/v1${path}`);
  expect(response.status(), path).toBe(200);
  // o narrowing por `success` não atravessa o genérico S: o schema é exatamente o envelope de S
  const body = envelopeSchema(schema).parse(await response.json()) as Envelope<z.output<S>>;
  if (!body.success) throw new Error(`${path}: ${body.error.code}`);
  return body.data;
}

// As barras de preço de um papel, pela rota INTERNA da api, com o segredo do e2e: a API pública não as entrega (docs/API.md, seção 6). O
// teste confere a tela contra elas, como confere o resto contra a API pública. Da mais antiga à mais nova.
export async function fetchBars(request: APIRequestContext, ticker: string) {
  const response = await request.get(`${API_URL}/api/v1/interno/barras/${ticker}`, {
    headers: { Authorization: `Bearer ${QUOTES_SECRET}` },
  });
  expect(response.status(), ticker).toBe(200);
  const body = envelopeSchema(internalBarsSchema).parse(await response.json());
  if (!body.success) throw new Error(`${ticker}: ${body.error.code}`);
  return body.data.bars;
}

// A fita da home (o universo da semana do último ciclo, com o fechamento do pregão), pela rota INTERNA da api, com o segredo do e2e, como o
// site a lê (docs/API.md, seção 6).
export async function fetchTape(request: APIRequestContext) {
  const response = await request.get(`${API_URL}/api/v1/interno/fita`, {
    headers: { Authorization: `Bearer ${QUOTES_SECRET}` },
  });
  expect(response.status()).toBe(200);
  const body = envelopeSchema(internalTapeSchema).parse(await response.json());
  if (!body.success) throw new Error(`fita: ${body.error.code}`);
  return body.data;
}

// O modelo cujas decisões vêm do provedor fake leva a etiqueta "simulado" logo depois do nome, onde o nome aparece (ranking, cartão de
// decisão, página do modelo e da ação). `shownName` é o texto que o leitor vê no lugar do nome.
export const SIMULATED = 'simulado';
export const isSimulated = (c: { type: string; provider: string | null }) =>
  c.type === 'MODEL' && c.provider === 'fake';
export const shownName = (c: { name: string; type: string; provider: string | null }) =>
  isSimulated(c) ? `${c.name} ${SIMULATED}` : c.name;

// O texto que o leitor vê, com o espaço sem quebra do site (entre "R$" e o número) como espaço comum: o toHaveText do Playwright já faz
// isso, e quem lê o texto cru (allInnerTexts) precisa fazer também.
export const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+$)/g, '.');
const two = (n: number) => String(n).padStart(2, '0');

// centavos -> "R$ 100.201,98" (espaço comum: o Playwright trata o espaço sem quebra do site como espaço)
export function brl(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}R$ ${group(String(Math.floor(abs / 100)))},${two(abs % 100)}`;
}
// pontos-base -> "+0,20%"
export function pct(bps: number, signed = true): string {
  const abs = Math.abs(bps);
  const sign = bps < 0 ? '-' : signed && bps > 0 ? '+' : '';
  return `${sign}${Math.floor(abs / 100)},${two(abs % 100)}%`;
}
// percentil de 0 a 10.000 bps -> "72,0"
export function pctl(bps: number): string {
  const tenths = Math.floor((bps + 5) / 10);
  return `${Math.floor(tenths / 10)},${tenths % 10}`;
}
// micro-dólares -> "US$ 0,0000"
export function usd(micro: number): string {
  const tenThousandths = Math.floor((micro + 50) / 100);
  return `US$ ${group(String(Math.floor(tenThousandths / 10_000)))},${String(tenThousandths % 10_000).padStart(4, '0')}`;
}
// "2026-11-09" -> "09/11/2026"
export const dmy = (iso: string) => iso.split('-').reverse().join('/');
// instante UTC -> "09/11/2026 08:00" (ou "09/11/2026 08:00:30", com os segundos) em Brasília (UTC-3, sem horário de verão desde 2019)
export function brt(iso: string, seconds = false): string {
  const [date, time] = new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().split('T');
  return `${dmy(date!)} ${time!.slice(0, seconds ? 8 : 5)}`;
}
// o percentual que o modelo respondeu, como veio: 7 -> "7%", 12.5 -> "12,5%"
export const percentValue = (value: number) => `${String(value).replace('.', ',')}%`;
// a confiança de 0 a 1 em duas casas: 0.7 -> "0,70"
export const confidence = (value: number) => value.toFixed(2).replace('.', ',');

// O que uma decisão diz sobre um ticker, como o cartão (feed, ciclo e modelo) e a lista da página da ação escrevem: o percentual (do
// patrimônio na compra, da posição na venda; o HOLD não leva) e a confiança, quando há, e a justificativa. O texto inteiro de um item
// é comparado com `toHaveText`, que exige igualdade: um dígito, uma palavra ou um BUY trocado por SELL reprova.
interface DecisionItem {
  action: 'BUY' | 'SELL' | 'HOLD';
  percent: number | null;
  confidence: number | null;
  rationale: string;
}
const itemParts = (item: DecisionItem): string[] => [
  item.action,
  ...(item.percent !== null && item.action !== 'HOLD'
    ? [`${percentValue(item.percent)} ${item.action === 'BUY' ? 'do patrimônio' : 'da posição'}`]
    : []),
  ...(item.confidence !== null ? [`confiança ${confidence(item.confidence)}`] : []),
  item.rationale,
];
// o item do cartão: a ação, o ticker, o percentual, a confiança e a justificativa
export const itemText = (item: DecisionItem & { ticker: string }): string =>
  [item.action, item.ticker, ...itemParts(item).slice(1)].join(' ');
// a linha da lista da página da ação: a data, o modelo, a ação, o percentual, a confiança e a justificativa
export const stockDecisionText = (
  decision: DecisionItem & {
    date: string;
    competitor: { name: string; type: string; provider: string | null };
  },
): string => [dmy(decision.date), shownName(decision.competitor), ...itemParts(decision)].join(' ');

// As telas que o e2e de layout e de acessibilidade percorre (layout.spec.ts).
export const ROUTES = [
  '/',
  '/?filtro=SELL#feed',
  '/ranking',
  `/modelos/${MODEL}`,
  `/ciclos/${CYCLE_DAY}`,
  '/noticias',
  `/noticias?ticker=${TICKER}`,
  '/acoes',
  '/acoes?q=MO',
  `/acoes/${TICKER}`,
  '/como-funciona',
  '/rota-que-nao-existe',
] as const;
