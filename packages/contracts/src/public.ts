import { z } from 'zod';
import { cycleStatusSchema, cycleViewSchema, holdReasonSchema } from './cycle.js';
import { decisionItemSchema } from './llm-decision.js';
import { ulidSchema } from './messages.js';
import { llmProviderSchema, seasonFileSchema, seasonParamsSchema } from './season.js';

// A API pública (plano §9, etapa 9): o que o site e qualquer leitor externo veem. Os mesmos schemas validam a resposta no site
// (apps/web/src/lib/api.ts) e documentam a rota no Swagger. Tudo é estrito de propósito: o que não está aqui não sai, mesmo que
// alguém acrescente uma coluna. Nunca entram o texto do prompt, o IO bruto, os endereços do Blob, o trecho (snippet) das
// notícias, chaves, config do competidor nem dado de job_run (docs/API.md).

// --- cache -----------------------------------------------------------------------------------------------------------------
// O tempo de vida do cache público, em segundos: uma constante só. A API manda no Cache-Control (s-maxage), o Front Door o respeita
// e o site usa o mesmo valor no cache de dados do Next. Depois de cada liquidação o worker revalida o site e limpa o Front Door,
// então o tempo de vida só limita o atraso quando uma das duas chamadas falha (docs/API.md).
export const PUBLIC_CACHE_TTL_SECONDS = 300;
export const PUBLIC_CACHE_CONTROL = `public, s-maxage=${PUBLIC_CACHE_TTL_SECONDS}, stale-while-revalidate=${PUBLIC_CACHE_TTL_SECONDS}`;

// --- listas ----------------------------------------------------------------------------------------------------------------
export const PAGE_DEFAULT_LIMIT = 20;
export const PAGE_MAX_LIMIT = 100;
export const STOCK_SEARCH_LIMIT = 20;
// quantas linhas do ranking o arena/current traz
export const TOP_RANKING = 5;

// Os formatos que já existem noutros contratos, reaproveitados pela forma e não copiados: o slug do competidor e da temporada
// (season.ts) e o ticker (llm-decision.ts).
export const slugSchema = seasonFileSchema.shape.slug;
const slug = slugSchema;
const ticker = decisionItemSchema.options[2].shape.ticker;
export const tickerParamSchema = z.string().max(12).toUpperCase().pipe(ticker);

// A temporada é identificada pelo ULID ou pelo slug (que é minúsculo, então um não se confunde com o outro).
export const seasonRefSchema = z.union([ulidSchema, slug]);

// Data que vira parâmetro de consulta. z.iso.date() e z.iso.datetime() aceitam o ano 0000, e o Postgres não tem ano zero (22008,
// "date/time field value out of range"): a data passaria no Zod, entraria na consulta e sairia 500. Toda data que a API recebe de
// fora (o ciclo e os cursores do feed e das notícias) passa por aqui. O menor ano que o Postgres tem é o 0001.
const notYearZero = (value: string) => !value.startsWith('0000');
export const queryDateSchema = z.iso.date().refine(notYearZero, 'o ano 0000 não existe');
export const queryDateTimeSchema = z.iso.datetime().refine(notYearZero, 'o ano 0000 não existe');

// O ciclo é pedido pela data do pregão (a forma pública, na temporada atual ou na de ?season=) ou pelo ULID dele (a forma da etapa 6).
export const cycleRefSchema = z.union([queryDateSchema, ulidSchema]);

// Query string: só dígitos no limite ("1e2" e "0x10" passariam por Number), cursor opaco em base64url, e nenhum parâmetro a mais.
// Parâmetro desconhecido é 400: sem isso qualquer ?x=<aleatório> seria uma chave nova no cache da borda e uma ida à origem. A rota
// que não tem parâmetro nenhum usa o noQuerySchema, com o mesmo teto.
const limit = z
  .string()
  .regex(/^\d{1,3}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(PAGE_MAX_LIMIT));
export const cursorSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

export const noQuerySchema = z.strictObject({});
export const seasonsQuerySchema = z.strictObject({
  limit: limit.optional(),
  cursor: cursorSchema.optional(),
});
export const seasonScopeQuerySchema = z.strictObject({ season: seasonRefSchema.optional() });
export const FEED_ACTIONS = ['BUY', 'SELL', 'HOLD'] as const;
export const decisionsQuerySchema = z.strictObject({
  season: seasonRefSchema.optional(),
  action: z.enum(FEED_ACTIONS).optional(),
  competitor: slug.optional(),
  limit: limit.optional(),
  cursor: cursorSchema.optional(),
});
export const newsQuerySchema = z.strictObject({
  ticker: ticker.optional(),
  limit: limit.optional(),
  cursor: cursorSchema.optional(),
});
// Sem caractere de controle: o NUL (U+0000) o Postgres recusa em texto ("invalid byte sequence", 22021) e a busca viraria 500.
export const stocksQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine((value) => !/\p{Cc}/u.test(value), 'caractere de controle'),
});

// --- peças comuns ----------------------------------------------------------------------------------------------------------
const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
// Centavos e pontos-base são inteiros seguros: em JSON viram número exato (o banco guarda bigint; a API recusa o que perderia
// precisão). Nunca float.
const int = z.number().int().safe();
const nonNegative = int.min(0);
const cents = int;
const bps = int;
const nextCursor = z.string().nullable();

export const COMPETITOR_TYPES = ['MODEL', 'RANDOM', 'EQUAL_WEIGHT', 'CDI', 'BOVA11'] as const;
export const competitorTypeSchema = z.enum(COMPETITOR_TYPES);
export type CompetitorType = z.infer<typeof competitorTypeSchema>;

// O competidor como o público o vê: o provedor e o ID do modelo fixados na criação da temporada. A config (recursos do provedor
// e preços) não sai.
export const publicCompetitorSchema = z.strictObject({
  slug,
  name: z.string(),
  type: competitorTypeSchema,
  provider: llmProviderSchema.nullable(),
  modelId: z.string().max(128).nullable(),
});
export type PublicCompetitor = z.infer<typeof publicCompetitorSchema>;

// Temporada em andamento ou encerrada: a rascunho (DRAFT) não é pública. Os parâmetros inteiros são públicos (as sementes do
// Sorteio e do Monte Carlo são, por desenho, de reprodutibilidade).
export const seasonSummarySchema = z.strictObject({
  id: ulidSchema,
  slug,
  name: z.string(),
  status: z.enum(['RUNNING', 'FINISHED']),
  startDate: isoDate.nullable(),
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  // o último pregão liquidado; nulo antes da primeira liquidação
  settledThrough: isoDate.nullable(),
  params: seasonParamsSchema,
});
export type SeasonSummary = z.infer<typeof seasonSummarySchema>;

export const seasonsPageSchema = z.strictObject({
  rows: z.array(seasonSummarySchema),
  nextCursor,
});

// --- ranking, patrimônio e Monte Carlo --------------------------------------------------------------------------------------
export const leaderboardRowSchema = z.strictObject({
  // 1 é o maior retorno; o empate vale a ordem do elenco
  rank: int.min(1),
  competitor: publicCompetitorSchema,
  equityCents: cents,
  returnBps: bps,
  // o percentil no Monte Carlo (0 a 10.000); nulo se a temporada ainda não rodou o Monte Carlo
  percentileBps: bps.nullable(),
  excessEqualWeightBps: bps.nullable(),
  excessCdiBps: bps.nullable(),
  maxDrawdownBps: bps,
  // acerto: vendas executadas com ganho / vendas executadas; nulo sem venda
  winRateBps: bps.nullable(),
  sells: nonNegative,
  winningSells: nonNegative,
  trades: nonNegative,
  // custo acumulado das LLMs na temporada, em micro-dólares (zero para quem não é modelo)
  llmCostMicroUsd: nonNegative,
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const leaderboardSchema = z.strictObject({
  season: seasonSummarySchema,
  asOf: isoDate.nullable(),
  rows: z.array(leaderboardRowSchema),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;

// A série de patrimônio por pregão de cada competidor: uma lista de datas e, para cada um, um valor por data (alinhados).
const equitySeries = z.strictObject({
  dates: z.array(isoDate),
  equityCents: z.array(cents),
});
export const equitySchema = z
  .strictObject({
    season: seasonSummarySchema,
    dates: z.array(isoDate),
    series: z.array(
      z.strictObject({ competitor: publicCompetitorSchema, equityCents: z.array(cents) }),
    ),
  })
  .refine((equity) => equity.series.every((s) => s.equityCents.length === equity.dates.length), {
    path: ['series'],
    message: 'cada série tem um valor por data',
  });
export type Equity = z.infer<typeof equitySchema>;

const percentiles = (value: z.ZodType<number>) =>
  z.strictObject({ p5: value, p25: value, p50: value, p75: value, p95: value });
export const randomBaselineSchema = z.strictObject({
  season: seasonSummarySchema,
  // os percentis 5, 25, 50, 75 e 95 das carteiras aleatórias, por pregão (posto mais próximo, sem interpolação)
  rows: z.array(
    z.strictObject({
      date: isoDate,
      equityCents: percentiles(cents),
      returnBps: percentiles(bps),
    }),
  ),
});
export type RandomBaseline = z.infer<typeof randomBaselineSchema>;

// --- decisões ---------------------------------------------------------------------------------------------------------------
// O item e o descartado são os do ciclo (cycle.ts): o texto de um item descartado nunca sai, só a posição e o motivo.
const cycleDecision = cycleViewSchema.shape.decisions.element;
const decisionItem = cycleDecision.shape.items.element;
const droppedItem = cycleDecision.shape.dropped.element;

export const feedDecisionSchema = z.strictObject({
  date: isoDate,
  competitor: publicCompetitorSchema,
  status: cycleDecision.shape.status,
  holdReason: holdReasonSchema.nullable(),
  marketView: cycleDecision.shape.marketView,
  summary: z.string().nullable(),
  items: z.array(decisionItem),
  dropped: z.array(droppedItem),
});
export type FeedDecision = z.infer<typeof feedDecisionSchema>;

export const decisionsPageSchema = z.strictObject({
  rows: z.array(feedDecisionSchema),
  nextCursor,
});
export type DecisionsPage = z.infer<typeof decisionsPageSchema>;

// --- notícias ---------------------------------------------------------------------------------------------------------------
// Título e link são dado de terceiro. O link só é http ou https (sem espaço nem usuário na frente); o título não tem tag HTML
// (a limpeza do worker já tira, e a API limpa de novo ao ler). O trecho (snippet) não existe aqui.
const TAG_LIKE = /<\/?[A-Za-z!?]/;
export const newsItemSchema = z.strictObject({
  title: z
    .string()
    .min(1)
    .max(300)
    .refine((title) => !TAG_LIKE.test(title), { message: 'título com HTML' }),
  source: z.string().max(64),
  sourceName: z.string().max(80),
  publishedAt: isoDateTime,
  tickers: z.array(ticker).max(50),
  // o regex vem antes do z.url(), que apara os espaços das pontas antes de validar. Usuário e senha na frente
  // (https://infomoney.com.br@outro.site/) são o truque clássico do link enganoso: o worker já os recusa (normalizeUrl) e a API
  // deixa de fora a linha que os traga; aqui o contrato garante o que as telas afirmam.
  url: z
    .string()
    .max(2048)
    .regex(/^https?:\/\/\S+$/i)
    .pipe(z.url({ protocol: /^https?$/ }))
    .refine(
      (link) => {
        const { username, password } = new URL(link);
        return username === '' && password === '';
      },
      { message: 'link com usuário ou senha' },
    ),
});
export type NewsItem = z.infer<typeof newsItemSchema>;

export const newsPageSchema = z.strictObject({
  rows: z.array(newsItemSchema),
  nextCursor,
});
export type NewsPage = z.infer<typeof newsPageSchema>;

// --- o competidor ------------------------------------------------------------------------------------------------------------
export const positionViewSchema = z.strictObject({
  ticker,
  quantity: nonNegative,
  // custo total pago (valor mais custo das compras) e o preço médio, no centavo mais próximo
  costCents: cents,
  avgPriceCents: cents,
  // a marcação: o fechamento do pregão, ou o último conhecido quando a ação não teve barra (stale). É registro da arena, não cotação:
  // o valor com que a liquidação avaliou a posição (docs/API.md, seção 6; ADR 0033)
  markCents: cents,
  valueCents: cents,
  pnlCents: cents,
  stale: z.boolean(),
});
export type PositionView = z.infer<typeof positionViewSchema>;

export const competitorDetailSchema = z.strictObject({
  season: seasonSummarySchema,
  competitor: publicCompetitorSchema,
  // a mesma linha do ranking; nula antes da primeira liquidação
  stat: leaderboardRowSchema.nullable(),
  // a carteira no fechamento do último pregão liquidado; nula antes da primeira liquidação
  portfolio: z
    .strictObject({
      date: isoDate,
      equityCents: cents,
      // A composição (o caixa e as posições) é só do MODELO; nula no Sorteio e nas referências. O igual-peso segura o universo inteiro e o
      // BOVA11 um papel só, então a posição e o caixa deles seriam o fechamento de todo papel, todo pregão (e `(patrimônio − caixa) ÷
      // quantidade` devolveria o do BOVA11): a base bruta que a licença da brapi proíbe entregar (docs/API.md, seção 6; ADR 0033).
      holdings: z
        .strictObject({
          cashCents: cents,
          positionsValueCents: cents,
          positions: z.array(positionViewSchema),
        })
        .nullable(),
    })
    .nullable(),
  series: equitySeries,
  // as últimas decisões (só o modelo decide; o Sorteio e as referências não têm)
  decisions: z.array(feedDecisionSchema),
});
export type CompetitorDetail = z.infer<typeof competitorDetailSchema>;

// --- a ação -----------------------------------------------------------------------------------------------------------------
export const stockSearchSchema = z.strictObject({
  rows: z.array(z.strictObject({ ticker, name: z.string() })).max(STOCK_SEARCH_LIMIT),
});
export type StockSearch = z.infer<typeof stockSearchSchema>;

// Sem as barras de preço: a cotação bruta não sai de rota pública (a licença da brapi proíbe entregar os Dados como feed, API ou base
// bruta). O site as lê de uma rota interna, com um segredo do servidor (internal.ts; docs/API.md, seção 6; ADR 0033).
export const stockDetailSchema = z.strictObject({
  ticker,
  name: z.string(),
  // a temporada de onde saem os donos e as decisões; nula se nenhuma começou
  season: seasonSummarySchema.nullable(),
  // quais MODELOS têm a ação no fechamento do último pregão liquidado (o Sorteio e as referências não entram: o igual-peso tem o universo
  // inteiro, e a marcação dele seria o fechamento do dia de toda ação; docs/API.md, seção 6)
  holders: z.array(
    z.strictObject({
      competitor: publicCompetitorSchema,
      quantity: nonNegative,
      avgPriceCents: cents,
      markCents: cents,
      valueCents: cents,
      pnlCents: cents,
      stale: z.boolean(),
    }),
  ),
  // o que os modelos decidiram sobre a ação (itens válidos, do mais novo ao mais antigo)
  decisions: z.array(
    z.strictObject({
      date: isoDate,
      competitor: publicCompetitorSchema,
      action: decisionItem.shape.action,
      percent: decisionItem.shape.percent,
      confidence: decisionItem.shape.confidence,
      rationale: z.string(),
    }),
  ),
  news: z.array(newsItemSchema),
});
export type StockDetail = z.infer<typeof stockDetailSchema>;

// --- a arena agora (a home) ---------------------------------------------------------------------------------------------------
// Cada valor leva a data do dado: o mais recente até o último pregão (o macro de depois dele seria olhar para o futuro). Os
// valores do BCB são texto decimal exato, nunca float. Fonte: Banco Central do Brasil (docs/DADOS.md, seção 15).
const macroValue = z.strictObject({ date: isoDate, value: z.string().regex(/^-?\d+(\.\d+)?$/) });
export const macroSchema = z.strictObject({
  // % ao dia
  cdi: macroValue.nullable(),
  // meta, % ao ano
  selic: macroValue.nullable(),
  // IPCA do mês e acumulado em 12 meses, em %
  ipcaMonth: macroValue.nullable(),
  ipca12m: macroValue.nullable(),
  // R$ por US$ (PTAX de venda)
  usd: macroValue.nullable(),
  // Sem o BOVA11: o fechamento dele é cotação bruta e sai pela rota interna do site (internal.ts; docs/API.md, seção 6)
});
export type Macro = z.infer<typeof macroSchema>;

export const lastCycleSchema = z.strictObject({
  date: isoDate,
  status: cycleStatusSchema,
  skipReason: cycleViewSchema.shape.skipReason,
  decisionAt: isoDateTime,
  deadlineAt: isoDateTime,
  closedAt: isoDateTime.nullable(),
  prompt: cycleViewSchema.shape.prompt,
  briefingSha256: sha256.nullable(),
  // itens válidos (não descartados) de todas as decisões do ciclo, por ação
  counts: z.strictObject({ BUY: nonNegative, SELL: nonNegative, HOLD: nonNegative }),
});
export type LastCycle = z.infer<typeof lastCycleSchema>;

// O próximo ciclo, para a contagem da home: o pregão e o instante da decisão (08:00 de Brasília, em UTC). Nulo quando não há:
// nenhuma temporada em andamento, ou a última sessão já abriu. O site não tem o calendário de feriados da B3, então a conta é da API;
// e não depende do relógio, porque a resposta é cacheada: o pregão seguinte ao último ciclo da temporada (ou o primeiro, antes de o
// primeiro abrir). Quem desenha a contagem compara o `decisionAt` com a hora de agora; se já passou, o ciclo está abrindo.
export const nextCycleSchema = z.strictObject({ date: isoDate, decisionAt: isoDateTime });
export type NextCycle = z.infer<typeof nextCycleSchema>;

export const arenaCurrentSchema = z.strictObject({
  season: seasonSummarySchema.nullable(),
  lastCycle: lastCycleSchema.nullable(),
  nextCycle: nextCycleSchema.nullable(),
  macro: macroSchema,
  top: z.array(leaderboardRowSchema).max(TOP_RANKING),
});
export type ArenaCurrent = z.infer<typeof arenaCurrentSchema>;
