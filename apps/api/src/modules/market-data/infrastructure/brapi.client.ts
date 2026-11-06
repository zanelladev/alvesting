import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { QUOTA_RESERVE, type BarRequest } from '../domain/bar-plan.js';
import { brasiliaDate, type IsoDate } from '../domain/dates.js';
import type { Listing } from '../domain/instruments.js';

// Cliente da brapi (https://brapi.dev), a única fonte das cotações (plano 5.5; docs/DADOS.md, seções 1 e 6; ADR 0032). Plano gratuito:
// um papel por requisição, uma requisição por vez na conta inteira, 15 mil requisições numa janela móvel de 30 dias (só a resposta 200 do
// histórico gasta cota) e no máximo 90 dias entre startDate e endDate em cada pedido (400 DATE_WINDOW_EXCEEDED). Medido na prova controlada
// de 04/11/2026 (docs/DADOS.md, seção 9).
//  - /api/v2/stocks/historical?symbols=<papel>&startDate=&endDate=&interval=1d: as barras diárias de um papel;
//  - /api/quote/list?type=stock&limit=&page=: a lista de ações (semeia papel novo, uma vez por semana). Fora da cota, com limitador próprio
//    (20 por minuto). A cota só se lê do X-RateLimit-Remaining (`readRemaining`), que a lista não traz.
// O token vem do ambiente (BRAPI_TOKEN) e viaja só no cabeçalho Authorization: query string vai parar em log. O corpo de uma resposta de erro
// nunca é lido nem registrado, porque pode repetir o token.

export interface BrapiBar {
  ticker: string;
  date: IsoDate;
  openCents: bigint;
  highCents: bigint;
  lowCents: bigint;
  closeCents: bigint;
  // estimado: a brapi informa a quantidade, não o volume financeiro (quantidade x fechamento)
  volumeCents: bigint;
}

// `ok`: a brapi respondeu e o formato serve (as barras podem ser nenhuma: papel sem negócio no período). `failed`: sem resposta que sirva
// (5xx e timeout depois da repetição, formato torto, 4xx do papel): vira falta, e quem chama tenta de novo na próxima passada.
export type PaperResult =
  { ticker: string; status: 'ok'; bars: BrapiBar[] } | { ticker: string; status: 'failed' };

// quota: a cota restante chegou à reserva (ou a espera pedida pelo 429 passa do teto); time: acabou o orçamento de tempo da trava da fila;
// outage: papéis seguidos sem resposta, que é a brapi fora do ar e não um papel ruim.
export type StopReason = 'quota' | 'time' | 'outage';

export interface BrapiRun {
  // requisições HTTP feitas (as repetições contam)
  requests: number;
  // a cota restante que a brapi informou na última resposta (só o número), ou nulo se nenhuma respondeu
  remaining: number | null;
  stopped: StopReason | null;
}

// 401, 402 e 403 (e a falta do token): erro de configuração. Encerra a busca, falha o job (alerta job-falhou) e não leva o corpo da resposta.
export class BrapiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrapiConfigError';
  }
}

export type OnResult = (result: PaperResult) => Promise<'stop' | void> | 'stop' | void;

export interface BrapiOptions {
  budgetMs?: number;
  // as esperas do 429 e da repetição; os testes passam um falso
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  // uma requisição por vez na conta inteira, entre réplicas e a carga manual (market-data.module.ts: trava consultiva do Postgres)
  exclusive?: <T>(run: () => Promise<T>) => Promise<T>;
  reserve?: number;
}

const REQUEST_TIMEOUT_MS = 15_000;
// A trava do worker na fila market é renovada por 5 minutos (QUEUES). Para antes, com o que tiver. O orçamento vale por passada INTEIRA,
// e dentro de um papel também: a espera do 429, a pausa do 5xx, a espera da trava e o timeout da requisição não passam do prazo (o pior
// caso de um papel só era de uns 165 s fora do orçamento). O eod divide este orçamento entre o conjunto obrigatório e o opcional; a atualização
// semanal, entre a lista e as barras; a carga manual passa Infinity (não há fila).
export const FETCH_BUDGET_MS = 4 * 60_000;
// ponytail: 429 espera o Retry-After até 30 s e repete o mesmo papel até 3 vezes; Retry-After maior é a cota que acabou (ela só volta quando
// as requisições mais antigas saem da janela de 30 dias), e esperar mais que isso gastaria a trava da fila. O 429 do limite simultâneo (1 no
// gratuito) volta em segundos. Sem o cabeçalho, 5 s. (Um 429 de verdade não foi visto na prova controlada: o comportamento é o dos docs.)
const MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const MAX_RATE_LIMIT_RETRIES = 3;
// 5xx e timeout: o mesmo papel é repetido uma vez, depois de 1 s, e depois fica como falta
const TRANSIENT_PAUSE_MS = 1_000;
// ponytail: 5 papéis seguidos sem resposta encerram a passada. A brapi fora do ar, ou uma janela que o plano recusa (400 em todos), custaria
// 2 requisições por papel (310 papéis, 4 passadas por noite) para nada. Um papel ruim isolado nunca chega a 5 seguidos. O 400 e o 404 só
// contam enquanto nenhum papel respondeu nesta passada (a janela recusada); depois de uma resposta boa são do papel (suspenso, sem histórico).
const OUTAGE_AFTER_FAILURES = 5;
// ponytail: 5 respostas 200 do histórico sem nenhum X-RateLimit-Remaining (a brapi renomeou o cabeçalho, o plano mudou, um proxy o cortou)
// deixam a reserva de cota cega: `remaining` fica nulo e `quotaLow` nunca dispara. Só um aviso no log (fora do ALERT_LOG): um nulo isolado é
// normal (3 de 372 respostas na carga do dev de 04/11/2026 vieram pelo limitador de 20 por minuto, sem o cabeçalho), 5 sem nenhum não.
const BLIND_AFTER_RESPONSES = 5;
const HISTORICAL_PATH = '/api/v2/stocks/historical';
const LIST_PATH = '/api/quote/list';
// limit=1000 é aceito (prova controlada: 785 ações em uma página, hasNextPage falso); mais de 3 páginas é lista que não cabe no teto.
const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 3;

// A forma da data que o cliente aceita: o pregão à meia-noite de Brasília (03:00 UTC), em segundos. A doc da brapi diz só "Data do pregão em
// Unix timestamp, em segundos"; a prova controlada de 04/11/2026 confirmou a forma (77 barras de 3 papéis, todas 03:00 UTC; docs/DADOS.md,
// seção 9). daily_bar é só inserção: uma data errada por um dia (meia-noite UTC cai no dia anterior de Brasília) ficaria para sempre, então
// o que não tem esta forma é descartado com aviso em vez de gravado.
const SECONDS_PER_DAY = 86_400;
const BRASILIA_MIDNIGHT_SECONDS = 3 * 3_600;

// Teto de plausibilidade: R$ 10 milhões por ação, e o bigint do Postgres para o volume (quantidade x fechamento). Acima disso é erro de unidade
// do provedor, e o INSERT que estourasse derrubaria o lote do papel, noite após noite, até o dado mudar.
const MAX_PRICE_CENTS = 1_000_000_000n;
const MAX_VOLUME_CENTS = 2n ** 63n - 1n;

// O Headers recusa com TypeError (que pareceria "brapi fora do ar") token com espaço, quebra de linha ou fora do ASCII visível.
const TOKEN_SHAPE = /^[\x21-\x7e]+$/;

// Preço decimal da fonte para centavos. O 19,99 x 100 dá 1998,9999...: arredonda, nunca trunca.
const toCents = (value: number): bigint => BigInt(Math.round(value * 100));

const priceSchema = z.object({
  date: z.number().int(), // segundos; o pregão à meia-noite de Brasília (BRASILIA_MIDNIGHT_SECONDS)
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  close: z.number().nullable(),
  volume: z.number().nullable(),
  adjustedClose: z.number().nullable().optional(),
});

const historicalSchema = z.object({
  results: z.array(
    z.object({
      requestedSymbol: z.string(),
      symbol: z.string().optional(),
      changed: z.boolean().optional(),
      data: z.object({ historicalDataPrice: z.array(priceSchema) }),
    }),
  ),
});

const listSchema = z.object({
  stocks: z.array(
    z.object({
      stock: z.string(),
      name: z.string().nullish(),
      subType: z.string().nullish(),
    }),
  ),
  hasNextPage: z.boolean().optional(),
});

type Raw =
  | { kind: 'ok'; body: unknown }
  | { kind: 'rate-limited'; retryAfterMs: number | undefined }
  | { kind: 'transient' }
  | { kind: 'rejected' }
  | { kind: 'malformed' }
  | { kind: 'time' };

// `refused`: a brapi respondeu 4xx (400, 404...) àquele papel
type Reply =
  | { kind: 'ok'; body: unknown }
  | { kind: 'failed'; refused: boolean }
  | { kind: 'quota' }
  | { kind: 'time' };

type Exchange = { late: true } | { late: false; status: number; headers: Headers; body: unknown };

interface Run {
  requests: number;
  remaining: number | null;
  // respostas 200 do histórico (só estas gastam cota e trazem o X-RateLimit-Remaining)
  responses: number;
}

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

// Só o nome do erro e o código dele ou da causa (ECONNRESET, ENOTFOUND, 57014, P2028...): a mensagem pode trazer a URL.
const describeError = (error: unknown): { error: string; code?: string } => {
  const codes = [error, error instanceof Error ? error.cause : undefined].map(
    (source) => (source as { code?: unknown } | null | undefined)?.code,
  );
  const code = codes.find((value): value is string => typeof value === 'string');
  return { error: error instanceof Error ? error.name : 'desconhecido', ...(code ? { code } : {}) };
};

// `X-RateLimit-Remaining` (com X-RateLimit-Window: rolling-30d): as requisições que restam na janela móvel de 30 dias. Só vem na
// resposta que gastou cota. O `RateLimit-Remaining` sem o X não serve: na carga do dev de 04/11/2026, a resposta 200 do histórico do
// PETR4 veio pelo limitador de 20 por minuto (RateLimit-Limit 20, Remaining 20, Reset 60, sem X-RateLimit-*, e não gastou cota), e o
// "20" lido como a cota parou a carga na 5ª requisição por "cota baixa". A lista também só traz esse limitador.
const readRemaining = (headers: Headers): number | undefined => {
  const value = headers.get('x-ratelimit-remaining');
  return value !== null && /^\d{1,9}$/.test(value.trim()) ? Number(value) : undefined;
};

const readRetryAfter = (headers: Headers): number | undefined => {
  const value = headers.get('retry-after');
  return value !== null && /^\d{1,9}$/.test(value.trim()) ? Number(value) * 1000 : undefined;
};

export class BrapiClient {
  private readonly logger = new Logger(BrapiClient.name);
  private readonly budgetMs: number;
  private readonly reserve: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly exclusive: NonNullable<BrapiOptions['exclusive']>;

  constructor(
    private readonly token: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
    options: BrapiOptions = {},
    private readonly baseUrl: string = 'https://brapi.dev',
  ) {
    this.budgetMs = options.budgetMs ?? FETCH_BUDGET_MS;
    this.reserve = options.reserve ?? QUOTA_RESERVE;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.clock = options.clock ?? Date.now;
    this.exclusive = options.exclusive ?? ((run) => run());
  }

  // Uma requisição por papel, na ordem dada. Cada resposta vai a `onResult` assim que chega (quem chama grava na hora: o que já veio não
  // se perde se um 401 ou o fim do orçamento interromper a passada), e `onResult` pode devolver 'stop' para encerrar (a sonda do eod: se o
  // BOVA11 não tem a barra do dia, nenhum outro papel terá). Falha de um papel nunca refaz os outros.
  async fetchBars(
    requests: readonly BarRequest[],
    onResult: OnResult,
    budgetMs: number = this.budgetMs,
  ): Promise<BrapiRun> {
    const run: Run = { requests: 0, remaining: null, responses: 0 };
    if (requests.length === 0) return this.finish(run, null);
    this.requireToken();
    const deadline = this.clock() + budgetMs;
    let failuresInARow = 0;
    let answered = false;
    for (const request of requests) {
      if (this.clock() >= deadline) return this.finish(run, 'time');
      if (this.quotaLow(run)) return this.finish(run, 'quota');

      const url = this.url(HISTORICAL_PATH, {
        symbols: request.ticker,
        startDate: request.from,
        endDate: request.to,
        interval: '1d',
      });
      const reply = await this.send(url, run, deadline);
      if (reply.kind === 'quota') return this.finish(run, 'quota');
      if (reply.kind === 'time') return this.finish(run, 'time');
      if (reply.kind === 'ok') run.responses += 1;

      const result = this.toResult(request, reply);
      if (result.status === 'ok') {
        answered = true;
        failuresInARow = 0;
      } else if (!(reply.kind === 'failed' && reply.refused && answered)) {
        failuresInARow += 1;
      }
      if ((await onResult(result)) === 'stop') return this.finish(run, null);
      if (failuresInARow >= OUTAGE_AFTER_FAILURES) return this.finish(run, 'outage');
    }
    return this.finish(run, null);
  }

  // A lista de ações da brapi (semeia papel novo). `listings` é nulo se a lista não veio (a brapi fora do ar, formato torto, cota, tempo):
  // quem chama segue sem ela. O orçamento é o mesmo das barras.
  async listStocks(
    budgetMs: number = this.budgetMs,
  ): Promise<{ listings: Listing[] | null } & BrapiRun> {
    const run: Run = { requests: 0, remaining: null, responses: 0 };
    this.requireToken();
    const deadline = this.clock() + budgetMs;
    const listings: Listing[] = [];
    for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
      if (this.clock() >= deadline) return { listings: null, ...this.finish(run, 'time') };
      if (this.quotaLow(run)) return { listings: null, ...this.finish(run, 'quota') };
      const url = this.url(LIST_PATH, {
        type: 'stock',
        limit: String(LIST_PAGE_SIZE),
        page: String(page),
      });
      const reply = await this.send(url, run, deadline);
      if (reply.kind === 'quota') return { listings: null, ...this.finish(run, 'quota') };
      if (reply.kind === 'time') return { listings: null, ...this.finish(run, 'time') };
      const parsed = reply.kind === 'ok' ? listSchema.safeParse(reply.body) : undefined;
      if (!parsed?.success) {
        if (reply.kind === 'ok')
          this.logger.warn('brapi: a lista de ações não tem o formato esperado');
        return { listings: null, ...this.finish(run, null) };
      }
      listings.push(
        ...parsed.data.stocks.map((item) => ({
          ticker: item.stock,
          name: item.name,
          subType: item.subType,
        })),
      );
      if (parsed.data.hasNextPage !== true) return { listings, ...this.finish(run, null) };
    }
    // mais páginas que o teto: a lista não veio inteira, e uma lista pela metade semearia só uma parte dos papéis
    this.logger.warn('brapi: a lista de ações passou do teto de páginas e foi descartada');
    return { listings: null, ...this.finish(run, null) };
  }

  private requireToken(): void {
    if (!this.token) throw new BrapiConfigError('brapi: BRAPI_TOKEN não configurado');
    if (!TOKEN_SHAPE.test(this.token)) {
      throw new BrapiConfigError(
        'brapi: BRAPI_TOKEN com espaço, quebra de linha ou caractere fora do ASCII',
      );
    }
  }

  private finish(run: Run, stopped: StopReason | null): BrapiRun {
    if (run.responses >= BLIND_AFTER_RESPONSES && run.remaining === null) {
      this.logger.warn(
        { responses: run.responses },
        'brapi: nenhuma resposta do histórico trouxe o X-RateLimit-Remaining; a reserva de cota ficou cega nesta passada',
      );
    }
    if (stopped === 'quota') {
      this.logger.warn(
        { remaining: run.remaining, reserve: this.reserve },
        ALERT_LOG.brapiQuotaLow,
      );
    } else if (stopped === 'outage') {
      this.logger.warn(
        { failures: OUTAGE_AFTER_FAILURES },
        'brapi: papéis seguidos sem resposta; a passada para e o resto fica como falta',
      );
    } else if (stopped === 'time') {
      this.logger.warn('brapi: o orçamento de tempo acabou; o resto fica como falta');
    }
    return { requests: run.requests, remaining: run.remaining, stopped };
  }

  // Parar antes de cruzar a reserva: com `remaining` igual à reserva, a próxima requisição a deixaria abaixo dela.
  private quotaLow(run: Run): boolean {
    return run.remaining !== null && run.remaining <= this.reserve;
  }

  private url(path: string, params: Record<string, string>): URL {
    const url = new URL(path, this.baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return url;
  }

  private toResult(request: BarRequest, reply: Reply): PaperResult {
    const failed: PaperResult = { ticker: request.ticker, status: 'failed' };
    if (reply.kind !== 'ok') return failed;
    const parsed = historicalSchema.safeParse(reply.body);
    if (!parsed.success) {
      this.logger.warn({ ticker: request.ticker }, 'brapi: a resposta não tem o formato esperado');
      return failed;
    }
    const byDate = new Map<IsoDate, BrapiBar>();
    const offForm: number[] = [];
    let inForm = 0;
    let adjusted = 0;
    for (const result of parsed.data.results) {
      if (result.requestedSymbol !== request.ticker) continue;
      // ticker trocado: os preços são da série de outro código (a doc: `changed` é verdadeiro quando `symbol` difere do pedido)
      if (result.changed === true || (result.symbol ?? result.requestedSymbol) !== request.ticker) {
        this.logger.warn(
          { ticker: request.ticker, symbol: result.symbol },
          'brapi: ticker trocado; a série é de outro código e não foi gravada',
        );
        return failed;
      }
      for (const price of result.data.historicalDataPrice) {
        if (price.date % SECONDS_PER_DAY !== BRASILIA_MIDNIGHT_SECONDS) {
          offForm.push(price.date);
          continue;
        }
        inForm += 1;
        const bar = this.toBar(request, price);
        if (!bar) continue;
        byDate.set(bar.date, bar);
        if (price.adjustedClose != null && price.adjustedClose !== price.close) adjusted += 1;
      }
    }
    if (offForm.length > 0) {
      this.logger.warn(
        { ticker: request.ticker, count: offForm.length, timestamp: offForm[0] },
        'brapi: a data da barra não é a meia-noite de Brasília; as barras fora dessa forma foram descartadas',
      );
      // nenhuma barra na forma: a suposição sobre a data não vale para esta resposta, e a passada conta uma falha
      if (inForm === 0) return failed;
    }
    // A doc diz que open/high/low/close diários "podem vir ajustados": o fechamento que difere do ajustado mostra que a barra não vem ajustada
    // por provento (prova controlada de 04/11/2026: 30 de 60 barras da WEGE3). Só a contagem vai ao log (papel e quantidade, nunca preço).
    if (adjusted > 0) {
      this.logger.warn(
        { ticker: request.ticker, adjusted },
        'brapi: barras com fechamento diferente do fechamento ajustado',
      );
    }
    return { ticker: request.ticker, status: 'ok', bars: [...byDate.values()] };
  }

  // A barra só vale com preço positivo, máxima não abaixo da mínima (o banco recusa, daily_bar_values_check, e derrubaria o lote), dentro da
  // escala (MAX_PRICE_CENTS e MAX_VOLUME_CENTS) e dentro do período pedido. Papel sem negócio no dia não tem barra (ou vem com preço nulo):
  // é falta, não erro.
  private toBar(request: BarRequest, price: z.infer<typeof priceSchema>): BrapiBar | undefined {
    const { open, high, low, close } = price;
    if (open === null || high === null || low === null || close === null) return undefined;
    if (![open, high, low, close].every((value) => value > 0) || high < low) return undefined;
    if (price.volume !== null && price.volume < 0) return undefined;
    const instant = new Date(price.date * 1000);
    if (Number.isNaN(instant.getTime())) return undefined; // fora do alcance do Date
    const date = brasiliaDate(instant);
    if (date < request.from || date > request.to) return undefined;
    const [openCents, highCents, lowCents, closeCents] = [open, high, low, close].map(toCents) as [
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    const volumeCents = BigInt(Math.round(price.volume ?? 0)) * closeCents;
    if (
      [openCents, highCents, lowCents, closeCents].some((cents) => cents > MAX_PRICE_CENTS) ||
      volumeCents > MAX_VOLUME_CENTS
    ) {
      return undefined;
    }
    return {
      ticker: request.ticker,
      date,
      openCents,
      highCents,
      lowCents,
      closeCents,
      volumeCents,
    };
  }

  // Uma requisição com a política de erros: 429 espera o Retry-After (com teto) e repete o mesmo papel; 5xx e timeout repetem uma vez;
  // o resto é falta do papel. 401, 402 e 403 sobem como erro de configuração. Nenhuma espera, pausa ou timeout passa de `deadline`.
  private async send(url: URL, run: Run, deadline: number): Promise<Reply> {
    let rateLimited = 0;
    let retried = false;
    for (;;) {
      const raw = await this.once(url, run, deadline);
      switch (raw.kind) {
        case 'ok':
          return raw;
        case 'time':
          return raw;
        case 'malformed':
          return { kind: 'failed', refused: false };
        case 'rejected':
          return { kind: 'failed', refused: true };
        case 'transient':
          if (retried) return { kind: 'failed', refused: false };
          retried = true;
          if (this.clock() + TRANSIENT_PAUSE_MS >= deadline) return { kind: 'time' };
          await this.sleep(TRANSIENT_PAUSE_MS);
          break;
        case 'rate-limited': {
          if (this.quotaLow(run)) return { kind: 'quota' };
          const wait = raw.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
          if (wait > MAX_RETRY_AFTER_MS) return { kind: 'quota' };
          rateLimited += 1;
          if (rateLimited > MAX_RATE_LIMIT_RETRIES) return { kind: 'failed', refused: false };
          if (this.clock() + wait >= deadline) return { kind: 'time' };
          await this.sleep(wait);
          break;
        }
      }
    }
  }

  private async once(url: URL, run: Run, deadline: number): Promise<Raw> {
    let exchange: Exchange;
    try {
      exchange = await this.exclusive(async (): Promise<Exchange> => {
        // a espera da trava (até 15 s) também gasta o orçamento: a requisição só sai se ainda há tempo, e o timeout dela nunca passa do prazo
        const left = deadline - this.clock();
        if (left <= 0) return { late: true };
        run.requests += 1;
        const response = await this.fetchFn(url, {
          headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
          // O token vai neste cabeçalho: um redirecionamento (o undici só tira o authorization na troca de origem) o levaria a outro endereço.
          redirect: 'error',
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, left)),
        });
        if (response.status !== 200) {
          // sem o corpo: ele pode repetir o token. Solta a conexão.
          await response.body?.cancel().catch(() => undefined);
          return {
            late: false,
            status: response.status,
            headers: response.headers,
            body: undefined,
          };
        }
        try {
          return {
            late: false,
            status: 200,
            headers: response.headers,
            body: await response.json(),
          };
        } catch (error) {
          if (isTimeout(error)) throw error;
          return { late: false, status: 200, headers: response.headers, body: undefined };
        }
      });
    } catch (error) {
      // rede, DNS, timeout, trava ou pool: só o nome do erro e o código (a mensagem pode trazer a URL); o que importa é que não houve resposta
      this.logger.warn(
        describeError(error),
        'brapi: requisição sem resposta (rede, timeout ou trava)',
      );
      return { kind: 'transient' };
    }
    if (exchange.late) return { kind: 'time' };

    const { status, headers, body } = exchange;
    // Resposta sem o X-RateLimit-Remaining (a lista, e o histórico servido pelo limitador de 20 por minuto) não muda a cota conhecida.
    const remaining = readRemaining(headers);
    if (remaining !== undefined) run.remaining = remaining;
    if (status === 401 || status === 402 || status === 403) {
      throw new BrapiConfigError(`brapi: HTTP ${status}, confira o BRAPI_TOKEN e o plano`);
    }
    if (status === 429) return { kind: 'rate-limited', retryAfterMs: readRetryAfter(headers) };
    if (status >= 500) return { kind: 'transient' };
    if (status !== 200) return { kind: 'rejected' };
    return body === undefined ? { kind: 'malformed' } : { kind: 'ok', body };
  }
}
