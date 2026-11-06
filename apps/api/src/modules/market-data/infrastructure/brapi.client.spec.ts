import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { QUOTA_RESERVE } from '../domain/bar-plan.js';
import {
  BrapiClient,
  BrapiConfigError,
  type BrapiOptions,
  type PaperResult,
} from './brapi.client.js';

// Nenhum teste fala com a brapi: o fetch é falso e as respostas são sintéticas, no formato dos docs (docs/DADOS.md, seção 6):
// /api/v2/stocks/historical e /api/quote/list. `date` é o pregão em segundos, à meia-noite de Brasília.
const TOKEN = 'token-de-teste-que-nao-pode-vazar';
const OCT_30 = 1793329200; // 2026-10-30T03:00:00Z = 00:00 em Brasília
const OCT_29 = 1793242800;
const OCT_28 = 1793156400;

const price = (
  date: number,
  o = 52.45,
  h = 53.66,
  l = 52.36,
  c = 52.71,
  v: number | null = 61_743_200,
) => ({ date, open: o, high: h, low: l, close: c, volume: v, adjustedClose: c });

const result = (symbol: string, prices: unknown[]) => ({
  requestedSymbol: symbol,
  symbol,
  changed: false,
  data: { usedInterval: '1d', usedRange: 'custom', historicalDataPrice: prices },
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const historical = (symbol: string, prices: unknown[], headers: Record<string, string> = {}) =>
  json(
    { results: [result(symbol, prices)], requestedAt: '2026-10-31T03:30:00.000Z', took: 15 },
    200,
    headers,
  );

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);

const fakeFetch = (handler: (url: URL, init: RequestInit, call: number) => Response | Error) => {
  let call = 0;
  return vi.fn<typeof fetch>((input, init) => {
    call += 1;
    const out = handler(urlOf(input), init ?? {}, call);
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  });
};

const ask = { ticker: 'PETR4', from: '2026-10-30', to: '2026-10-30' };
const papers = (...tickers: string[]) =>
  tickers.map((ticker) => ({ ticker, from: '2026-10-30', to: '2026-10-30' }));

function client(fetchFn: typeof fetch, options: BrapiOptions = {}) {
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  return { sleep, brapi: new BrapiClient(TOKEN, fetchFn, { sleep, ...options }) };
}

async function collect(brapi: BrapiClient, requests: Parameters<BrapiClient['fetchBars']>[0]) {
  const results: PaperResult[] = [];
  const run = await brapi.fetchBars(requests, (r) => void results.push(r));
  return { run, results };
}

const silentWarn = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
let warn: ReturnType<typeof silentWarn>;
beforeEach(() => {
  warn = silentWarn();
});
afterEach(() => {
  vi.restoreAllMocks();
});
const alerted = (text: string) => warn.mock.calls.some((call) => call[1] === text);
const warnedAbout = (part: string) =>
  warn.mock.calls.some((call) => call.some((arg) => typeof arg === 'string' && arg.includes(part)));

// Relógio de mentira: a espera (sleep) e a resposta lenta (advance) o fazem andar, e nenhum teste espera de verdade.
function timed(options: BrapiOptions = {}) {
  let now = 0;
  const sleep = vi.fn((ms: number) => {
    now += ms;
    return Promise.resolve();
  });
  return {
    sleep,
    advance: (ms: number) => {
      now += ms;
    },
    elapsed: () => now,
    options: { sleep, clock: () => now, ...options } satisfies BrapiOptions,
  };
}

describe('BrapiClient.fetchBars: o pedido', () => {
  it('pede o intervalo do papel (startDate e endDate), com o token no cabeçalho e nunca na URL', async () => {
    const fetchFn = fakeFetch(() => historical('PETR4', [price(OCT_30)]));
    await collect(client(fetchFn).brapi, [
      { ticker: 'PETR4', from: '2026-10-26', to: '2026-10-30' },
    ]);
    const [url, init] = fetchFn.mock.calls[0]!;
    const parsed = urlOf(url);
    expect(parsed.origin + parsed.pathname).toBe('https://brapi.dev/api/v2/stocks/historical');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      symbols: 'PETR4',
      startDate: '2026-10-26',
      endDate: '2026-10-30',
      interval: '1d',
    });
    expect(urlOf(url).href).not.toContain(TOKEN);
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // o token vai neste cabeçalho: um redirecionamento (o undici só tira o authorization na troca de origem) o levaria a outro endereço
    expect(init?.redirect).toBe('error');
  });

  it('uma requisição por papel, na ordem, e cada resposta chega a quem chama assim que vem', async () => {
    const order: string[] = [];
    const fetchFn = fakeFetch((url) => {
      const symbol = url.searchParams.get('symbols')!;
      order.push(`pede ${symbol}`);
      return historical(symbol, [price(OCT_30)]);
    });
    const run = await client(fetchFn).brapi.fetchBars(papers('BOVA11', 'PETR4', 'VALE3'), (r) => {
      order.push(`recebe ${r.ticker}`);
    });
    expect(order).toEqual([
      'pede BOVA11',
      'recebe BOVA11',
      'pede PETR4',
      'recebe PETR4',
      'pede VALE3',
      'recebe VALE3',
    ]);
    expect(run).toMatchObject({ requests: 3, stopped: null });
  });

  it("'stop' de quem recebe encerra a passada (a sonda do eod): nenhum outro papel é pedido", async () => {
    const fetchFn = fakeFetch(() => historical('BOVA11', []));
    const run = await client(fetchFn).brapi.fetchBars(
      papers('BOVA11', 'PETR4', 'VALE3'),
      () => 'stop',
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ requests: 1, stopped: null });
  });

  it('sem pedido não faz requisição nenhuma, nem exige o token', async () => {
    const fetchFn = fakeFetch(() => historical('PETR4', []));
    const run = await new BrapiClient(undefined, fetchFn).fetchBars([], () => undefined);
    expect(run).toEqual({ requests: 0, remaining: null, stopped: null });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sem token com pedido: erro de configuração, sem requisição', async () => {
    const fetchFn = fakeFetch(() => historical('PETR4', []));
    await expect(
      new BrapiClient(undefined, fetchFn).fetchBars([ask], () => undefined),
    ).rejects.toThrow(BrapiConfigError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('BrapiClient.fetchBars: a resposta', () => {
  it('converte para centavos (bigint) e estima o volume financeiro como quantidade x fechamento', async () => {
    const fetchFn = fakeFetch(() => historical('PETR4', [price(OCT_30)]));
    const { results } = await collect(client(fetchFn).brapi, [ask]);
    expect(results).toEqual([
      {
        ticker: 'PETR4',
        status: 'ok',
        bars: [
          {
            ticker: 'PETR4',
            date: '2026-10-30',
            openCents: 5245n,
            highCents: 5366n,
            lowCents: 5236n,
            closeCents: 5271n,
            volumeCents: 61_743_200n * 5271n,
          },
        ],
      },
    ]);
  });

  it('arredonda o preço para o centavo, nunca trunca (19,99 x 100 dá 1998,9999...)', async () => {
    const fetchFn = fakeFetch(() =>
      historical('PETR4', [price(OCT_30, 19.99, 20.01, 19.99, 19.99, 10)]),
    );
    const { results } = await collect(client(fetchFn).brapi, [ask]);
    const [bar] = (results[0] as Extract<PaperResult, { status: 'ok' }>).bars;
    expect(bar).toMatchObject({ openCents: 1999n, highCents: 2001n, closeCents: 1999n });
  });

  it('descarta a barra sem preço, com preço zero, com máxima abaixo da mínima ou com volume negativo; as outras ficam', async () => {
    const fetchFn = fakeFetch(() =>
      historical('PETR4', [
        { ...price(OCT_30), open: null },
        price(OCT_29, 0, 1, 1, 1),
        price(OCT_28, 10, 9, 11, 10),
        { ...price(OCT_30), volume: -5 },
        price(OCT_29, 10, 11, 9, 10, null),
      ]),
    );
    const { results } = await collect(client(fetchFn).brapi, [
      { ticker: 'PETR4', from: '2026-10-28', to: '2026-10-30' },
    ]);
    const bars = (results[0] as Extract<PaperResult, { status: 'ok' }>).bars;
    expect(bars.map((bar) => [bar.date, bar.volumeCents])).toEqual([['2026-10-29', 0n]]);
  });

  it('só vale a barra de dentro do período e do papel pedidos; a data repetida vale uma vez', async () => {
    const fetchFn = fakeFetch(() =>
      json({
        results: [
          result('PETR4', [price(OCT_28), price(OCT_29, 1, 2, 1, 1), price(OCT_29, 3, 4, 3, 3)]),
          result('VALE3', [price(OCT_29)]),
        ],
      }),
    );
    const { results } = await collect(client(fetchFn).brapi, [
      { ticker: 'PETR4', from: '2026-10-29', to: '2026-10-30' },
    ]);
    const bars = (results[0] as Extract<PaperResult, { status: 'ok' }>).bars;
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ ticker: 'PETR4', date: '2026-10-29', openCents: 300n });
  });

  it('papel sem negócio no período (lista vazia) é resposta boa sem barra, e não falha', async () => {
    const fetchFn = fakeFetch(() => historical('PETR4', []));
    const { results, run } = await collect(client(fetchFn).brapi, [ask]);
    expect(results).toEqual([{ ticker: 'PETR4', status: 'ok', bars: [] }]);
    expect(run.stopped).toBeNull();
  });

  it('JSON fora do formato vira falta daquele papel, com aviso, e os outros seguem', async () => {
    const fetchFn = fakeFetch((url) =>
      url.searchParams.get('symbols') === 'PETR4'
        ? json({ resultado: 'outro formato' })
        : historical('VALE3', [price(OCT_30)]),
    );
    const { results } = await collect(client(fetchFn).brapi, papers('PETR4', 'VALE3'));
    expect(results.map((r) => [r.ticker, r.status])).toEqual([
      ['PETR4', 'failed'],
      ['VALE3', 'ok'],
    ]);
    expect(warn).toHaveBeenCalledWith({ ticker: 'PETR4' }, expect.stringContaining('formato'));
  });

  it('corpo que não é JSON e 404 também são falta do papel, sem repetir', async () => {
    const fetchFn = fakeFetch((url) =>
      url.searchParams.get('symbols') === 'PETR4'
        ? new Response('<html>erro</html>', { status: 200 })
        : json({ error: true, code: 'NOT_FOUND' }, 404),
    );
    const { results } = await collect(client(fetchFn).brapi, papers('PETR4', 'VALE3'));
    expect(results.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('BrapiClient.fetchBars: a cota', () => {
  const withRemaining = (remaining: number) => ({
    'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-window': 'rolling-30d',
  });

  it('lê X-RateLimit-Remaining de toda resposta e devolve a última (só o número)', async () => {
    const fetchFn = fakeFetch((url, _init, call: number) =>
      historical(url.searchParams.get('symbols')!, [price(OCT_30)], withRemaining(9000 - call)),
    );
    const { run } = await collect(client(fetchFn).brapi, papers('A1', 'B1', 'C1'));
    expect(run.remaining).toBe(8997);
  });

  // A3: a busca para antes de cruzar a reserva, registra o sinal e não faz mais nenhuma requisição.
  it('para antes de a cota restante cair abaixo da reserva, registra brapi-cota-baixa e deixa o resto como falta', async () => {
    // a 2ª resposta informa que restam exatamente QUOTA_RESERVE: a 3ª requisição deixaria a conta abaixo dela
    const fetchFn = fakeFetch((url, _init, call) =>
      historical(
        url.searchParams.get('symbols')!,
        [price(OCT_30)],
        withRemaining(QUOTA_RESERVE + 2 - call),
      ),
    );
    const { run, results } = await collect(
      client(fetchFn).brapi,
      papers('A1', 'B1', 'C1', 'D1', 'E1'),
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.ticker)).toEqual(['A1', 'B1']);
    expect(run).toEqual({ requests: 2, remaining: QUOTA_RESERVE, stopped: 'quota' });
    expect(warn).toHaveBeenCalledWith(
      { remaining: QUOTA_RESERVE, reserve: QUOTA_RESERVE },
      ALERT_LOG.brapiQuotaLow,
    );
  });

  it('com a cota acima da reserva por uma requisição, a próxima ainda sai', async () => {
    const fetchFn = fakeFetch((url) =>
      historical(
        url.searchParams.get('symbols')!,
        [price(OCT_30)],
        withRemaining(QUOTA_RESERVE + 1),
      ),
    );
    const { run } = await collect(client(fetchFn).brapi, papers('A1', 'B1'));
    expect(run).toMatchObject({ requests: 2, stopped: null });
    expect(alerted(ALERT_LOG.brapiQuotaLow)).toBe(false);
  });

  it('resposta sem o cabeçalho não inventa cota: segue até o fim', async () => {
    const fetchFn = fakeFetch((url) =>
      historical(url.searchParams.get('symbols')!, [price(OCT_30)]),
    );
    const { run } = await collect(client(fetchFn).brapi, papers('A1', 'B1', 'C1'));
    expect(run).toEqual({ requests: 3, remaining: null, stopped: null });
    expect(warnedAbout('X-RateLimit-Remaining')).toBe(false); // 3 respostas sem o cabeçalho ainda são normais
  });

  // O X-RateLimit-Remaining é a única fonte da cota. Se ele some de uma passada inteira (a brapi o renomeou, o plano mudou, um proxy o cortou),
  // a reserva de 500 deixa de proteger sem erro nenhum: 5 respostas 200 do histórico sem ele são um aviso no log (fora do ALERT_LOG).
  it('5 respostas do histórico sem o X-RateLimit-Remaining avisam que a reserva ficou cega; com ele em ao menos uma, não', async () => {
    const without = fakeFetch((url) =>
      historical(url.searchParams.get('symbols')!, [price(OCT_30)]),
    );
    const blind = await collect(
      client(without).brapi,
      papers('A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1'),
    );
    expect(blind.run).toEqual({ requests: 7, remaining: null, stopped: null });
    expect(warn).toHaveBeenCalledWith(
      { responses: 7 },
      expect.stringContaining('X-RateLimit-Remaining'),
    );
    expect(alerted(ALERT_LOG.brapiQuotaLow)).toBe(false);

    warn.mockClear();
    const oneHeader = fakeFetch((url, _init, call) =>
      historical(
        url.searchParams.get('symbols')!,
        [price(OCT_30)],
        call === 3 ? withRemaining(9000) : {},
      ),
    );
    const seen = await collect(
      client(oneHeader).brapi,
      papers('A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1'),
    );
    expect(seen.run).toEqual({ requests: 7, remaining: 9000, stopped: null });
    expect(warnedAbout('X-RateLimit-Remaining')).toBe(false);
  });

  // Achado da carga do dev de 04/11/2026: a resposta 200 do histórico pode vir pelo limitador de 20 por minuto, com os cabeçalhos
  // abaixo, sem X-RateLimit-* e sem gastar cota (PETR4 entre duas respostas com a cota de verdade, 14.989 e 14.988). Lido como a cota,
  // esse 20 parou a carga na 5ª requisição por "cota baixa".
  it('o histórico servido pelo limitador de 20 por minuto não muda a cota conhecida, não para a passada e não alerta', async () => {
    const perMinute = {
      'ratelimit-limit': '20',
      'ratelimit-remaining': '20',
      'ratelimit-reset': '60',
    };
    const quota = (remaining: number) => ({
      'ratelimit-limit': '15000',
      'ratelimit-remaining': String(remaining),
      ...withRemaining(remaining),
    });
    const fetchFn = fakeFetch((url) => {
      const symbol = url.searchParams.get('symbols')!;
      return historical(
        symbol,
        [price(OCT_30)],
        symbol === 'B1' ? perMinute : quota(symbol === 'A1' ? 14_989 : 14_988),
      );
    });
    const { run, results } = await collect(client(fetchFn).brapi, papers('A1', 'B1', 'C1'));
    expect(results.map((r) => [r.ticker, r.status])).toEqual([
      ['A1', 'ok'],
      ['B1', 'ok'],
      ['C1', 'ok'],
    ]);
    expect(run).toEqual({ requests: 3, remaining: 14_988, stopped: null });
    expect(alerted(ALERT_LOG.brapiQuotaLow)).toBe(false);
  });
});

describe('BrapiClient.fetchBars: erros', () => {
  it('429 espera o Retry-After e repete só aquele papel; os outros não são refeitos', async () => {
    const fetchFn = fakeFetch((url, _init, call) => {
      const symbol = url.searchParams.get('symbols')!;
      if (symbol === 'B1' && call === 2) return json({}, 429, { 'retry-after': '7' });
      return historical(symbol, [price(OCT_30)], { 'x-ratelimit-remaining': '9000' });
    });
    const { brapi, sleep } = client(fetchFn);
    const { results, run } = await collect(brapi, papers('A1', 'B1', 'C1'));
    expect(results.map((r) => [r.ticker, r.status])).toEqual([
      ['A1', 'ok'],
      ['B1', 'ok'],
      ['C1', 'ok'],
    ]);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(fetchFn.mock.calls.map(([input]) => urlOf(input).searchParams.get('symbols'))).toEqual([
      'A1',
      'B1',
      'B1',
      'C1',
    ]);
    expect(run.requests).toBe(4);
  });

  it('429 de novo e de novo: depois de 3 repetições o papel fica como falta e a passada segue', async () => {
    const fetchFn = fakeFetch((url) =>
      url.searchParams.get('symbols') === 'A1'
        ? json({}, 429, { 'retry-after': '1' })
        : historical('B1', [price(OCT_30)]),
    );
    const { results } = await collect(client(fetchFn).brapi, papers('A1', 'B1'));
    expect(results.map((r) => [r.ticker, r.status])).toEqual([
      ['A1', 'failed'],
      ['B1', 'ok'],
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(5); // 1 + 3 repetições do A1, e o B1
  });

  it('429 sem Retry-After espera 5 s; com Retry-After acima do teto é a cota que acabou: para, sem esperar', async () => {
    const noHeader = fakeFetch((_url, _init, call) =>
      call === 1 ? json({}, 429) : historical('A1', [price(OCT_30)]),
    );
    const first = client(noHeader);
    await collect(first.brapi, papers('A1'));
    expect(first.sleep).toHaveBeenCalledWith(5000);

    const huge = fakeFetch(() => json({}, 429, { 'retry-after': '86400' }));
    const second = client(huge);
    const { run, results } = await collect(second.brapi, papers('A1', 'B1'));
    expect(run.stopped).toBe('quota');
    expect(results).toEqual([]);
    expect(second.sleep).not.toHaveBeenCalled();
    expect(huge).toHaveBeenCalledTimes(1);
    expect(alerted(ALERT_LOG.brapiQuotaLow)).toBe(true);
  });

  it('429 com a cota restante na reserva é cota esgotada: para na hora', async () => {
    const fetchFn = fakeFetch(() =>
      json({}, 429, { 'x-ratelimit-remaining': '0', 'retry-after': '3' }),
    );
    const { brapi, sleep } = client(fetchFn);
    const { run } = await collect(brapi, papers('A1', 'B1'));
    expect(run).toMatchObject({ stopped: 'quota', remaining: 0 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('5xx repete o papel uma vez, depois de 1 s: se a segunda vier boa, o papel vem', async () => {
    const fetchFn = fakeFetch((_url, _init, call) =>
      call === 1 ? json({}, 503) : historical('A1', [price(OCT_30)]),
    );
    const { brapi, sleep } = client(fetchFn);
    const { results } = await collect(brapi, papers('A1'));
    expect(results[0]).toMatchObject({ status: 'ok' });
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('5xx duas vezes e timeout duas vezes: o papel fica como falta, sem terceira tentativa, e os outros seguem', async () => {
    const fetchFn = fakeFetch((url) => {
      const symbol = url.searchParams.get('symbols');
      if (symbol === 'A1') return json({}, 500);
      if (symbol === 'B1') return new DOMException('The operation timed out.', 'TimeoutError');
      return historical('C1', [price(OCT_30)]);
    });
    const { results } = await collect(client(fetchFn).brapi, papers('A1', 'B1', 'C1'));
    expect(results.map((r) => [r.ticker, r.status])).toEqual([
      ['A1', 'failed'],
      ['B1', 'failed'],
      ['C1', 'ok'],
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it.each([401, 402, 403])(
    '%i encerra a busca como erro de configuração: sem o corpo da resposta, sem pedir os outros, e o que veio antes foi entregue',
    async (status) => {
      const fetchFn = fakeFetch((url) =>
        url.searchParams.get('symbols') === 'B1'
          ? json(
              { error: true, message: `seu token ${TOKEN} é inválido`, code: 'INVALID_TOKEN' },
              status,
            )
          : historical('A1', [price(OCT_30)]),
      );
      const results: PaperResult[] = [];
      const error = await client(fetchFn)
        .brapi.fetchBars(papers('A1', 'B1', 'C1', 'D1'), (r) => void results.push(r))
        .catch((e: unknown) => e as Error);
      expect(error).toBeInstanceOf(BrapiConfigError);
      expect((error as Error).message).toContain(`HTTP ${status}`);
      expect((error as Error).message).not.toContain(TOKEN);
      expect(results.map((r) => r.ticker)).toEqual(['A1']);
      expect(fetchFn).toHaveBeenCalledTimes(2); // A1 e B1; nunca refaz a lista
    },
  );

  it('5 papéis seguidos sem resposta é a brapi fora do ar: a passada para, sem gastar 2 requisições em cada papel', async () => {
    const fetchFn = fakeFetch(() => json({}, 502));
    const names = Array.from({ length: 30 }, (_, i) => `P${i}`);
    const { run, results } = await collect(client(fetchFn).brapi, papers(...names));
    expect(run.stopped).toBe('outage');
    expect(results).toHaveLength(5);
    expect(fetchFn).toHaveBeenCalledTimes(10);
  });

  it('um papel bom no meio zera a contagem de falhas seguidas', async () => {
    const fetchFn = fakeFetch((url) =>
      ['G1', 'G2'].includes(url.searchParams.get('symbols')!)
        ? historical(url.searchParams.get('symbols')!, [price(OCT_30)])
        : json({}, 404),
    );
    const names = ['X1', 'X2', 'X3', 'X4', 'G1', 'X5', 'X6', 'X7', 'X8', 'G2'];
    const { run } = await collect(client(fetchFn).brapi, papers(...names));
    expect(run.stopped).toBeNull();
  });

  it('para quando acaba o orçamento de tempo da trava da fila, e o resto fica como falta', async () => {
    let now = 0;
    const fetchFn = fakeFetch((url) => {
      now += 100_000;
      return historical(url.searchParams.get('symbols')!, [price(OCT_30)]);
    });
    const { brapi } = client(fetchFn, { budgetMs: 150_000, clock: () => now });
    const { run, results } = await collect(brapi, papers('A1', 'B1', 'C1', 'D1'));
    expect(run.stopped).toBe('time');
    expect(results.map((r) => r.ticker)).toEqual(['A1', 'B1']);
  });

  it('o orçamento pode vir por chamada (o eod divide o dele entre o obrigatório e o opcional)', async () => {
    let now = 0;
    const fetchFn = fakeFetch((url) => {
      now += 10;
      return historical(url.searchParams.get('symbols')!, [price(OCT_30)]);
    });
    const { brapi } = client(fetchFn, { clock: () => now });
    const run = await brapi.fetchBars(papers('A1', 'B1', 'C1'), () => undefined, 15);
    expect(run).toMatchObject({ requests: 2, stopped: 'time' });
  });

  it('cada requisição passa pela trava de uma por vez, e a espera do Retry-After fica fora dela', async () => {
    const events: string[] = [];
    const fetchFn = fakeFetch((_url, _init, call) => {
      events.push(`fetch ${call}`);
      return call === 1 ? json({}, 429, { 'retry-after': '2' }) : historical('A1', [price(OCT_30)]);
    });
    const exclusive = async <T>(run: () => Promise<T>): Promise<T> => {
      events.push('trava');
      try {
        return await run();
      } finally {
        events.push('solta');
      }
    };
    const sleep = vi.fn(() => {
      events.push('espera');
      return Promise.resolve();
    });
    await collect(new BrapiClient(TOKEN, fetchFn, { exclusive, sleep }), papers('A1'));
    expect(events).toEqual(['trava', 'fetch 1', 'solta', 'espera', 'trava', 'fetch 2', 'solta']);
  });
});

// A trava da fila market é renovada por 5 minutos: passar do orçamento de 4 deixa outra entrega assumir o job e refazer as requisições (só a
// cota se perde, mas se perde). O orçamento vale dentro de um papel (espera do 429, pausa do 5xx, espera da trava, timeout) e para a lista.
describe('BrapiClient: o orçamento de tempo vale também dentro de um papel', () => {
  it('429 com Retry-After de 30 s de novo e de novo: para quando a próxima espera passaria do orçamento, sem passar dele', async () => {
    const t = timed({ budgetMs: 60_000 });
    const fetchFn = fakeFetch(() => json({}, 429, { 'retry-after': '30' }));
    const results: PaperResult[] = [];
    const run = await new BrapiClient(TOKEN, fetchFn, t.options).fetchBars(
      papers('A1', 'B1'),
      (r) => void results.push(r),
    );
    expect(run.stopped).toBe('time');
    expect(results).toEqual([]); // o A1 não terminou e o B1 nem foi pedido
    expect(fetchFn).toHaveBeenCalledTimes(2); // aos 0 e aos 30 s; esperar mais 30 s chegaria ao fim do orçamento
    expect(t.elapsed()).toBeLessThanOrEqual(60_000);
    expect(warnedAbout('orçamento de tempo')).toBe(true);
  });

  it('a pausa de 1 s antes de repetir o 5xx também respeita o orçamento', async () => {
    const t = timed({ budgetMs: 500 });
    const fetchFn = fakeFetch(() => json({}, 503));
    const run = await new BrapiClient(TOKEN, fetchFn, t.options).fetchBars(
      papers('A1'),
      () => undefined,
    );
    expect(run).toMatchObject({ requests: 1, stopped: 'time' });
    expect(t.sleep).not.toHaveBeenCalled();
  });

  it('o timeout de cada requisição é o menor entre 15 s e o que resta do orçamento', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const t = timed({ budgetMs: 40_000 });
    const fetchFn = fakeFetch((url) => {
      t.advance(30_000); // resposta lenta
      return historical(url.searchParams.get('symbols')!, [price(OCT_30)]);
    });
    const run = await new BrapiClient(TOKEN, fetchFn, t.options).fetchBars(
      papers('A1', 'B1', 'C1'),
      () => undefined,
    );
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([15_000, 10_000]);
    expect(run).toMatchObject({ requests: 2, stopped: 'time' }); // o C1 começaria aos 60 s
  });

  it('a espera da trava entra na conta: se o prazo passou quando a vez chegou, a requisição nem sai (e não conta)', async () => {
    const t = timed({ budgetMs: 10_000 });
    const fetchFn = fakeFetch(() => historical('A1', [price(OCT_30)]));
    const exclusive = async <T>(task: () => Promise<T>): Promise<T> => {
      t.advance(20_000); // a outra réplica segurou a trava
      return task();
    };
    const run = await new BrapiClient(TOKEN, fetchFn, { ...t.options, exclusive }).fetchBars(
      papers('A1'),
      () => undefined,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(run).toMatchObject({ requests: 0, stopped: 'time' });
  });
});

describe('BrapiClient.fetchBars: a data e a escala da barra', () => {
  const MIDNIGHT_UTC = OCT_30 - 3 * 3600; // 2026-10-30T00:00:00Z, que em Brasília é 21:00 de 29/10
  const OPEN_UTC = OCT_30 + 10 * 3600; // 13:00Z, 10:00 em Brasília (a abertura)
  const window = { ticker: 'PETR4', from: '2026-10-28', to: '2026-10-30' };

  // A doc diz só "Data do pregão em Unix timestamp, em segundos". O cliente aceita uma forma, a meia-noite de Brasília, e a prova controlada
  // de 04/11/2026 confirmou que é a que a brapi usa (03:00 UTC nas 77 barras): daily_bar é só inserção, e uma data errada por um dia
  // ficaria para sempre.
  it('a data à meia-noite UTC (21:00 do dia anterior em Brasília) falha a resposta: não grava o pregão no dia errado', async () => {
    // com o relógio de Brasília, estas duas viram 29/10 e 28/10: um dia antes do pregão de verdade
    const fetchFn = fakeFetch(() =>
      historical('PETR4', [price(MIDNIGHT_UTC), price(MIDNIGHT_UTC - 86400)]),
    );
    const { results } = await collect(client(fetchFn).brapi, [window]);
    expect(results).toEqual([{ ticker: 'PETR4', status: 'failed' }]);
    expect(warn).toHaveBeenCalledWith(
      { ticker: 'PETR4', count: 2, timestamp: MIDNIGHT_UTC },
      expect.stringContaining('meia-noite de Brasília'),
    );
  });

  it('data fora da forma em todas as barras (a abertura às 10:00, por exemplo) também falha a resposta', async () => {
    const fetchFn = fakeFetch(() =>
      historical('PETR4', [price(OPEN_UTC), price(OPEN_UTC - 86400)]),
    );
    const { results } = await collect(client(fetchFn).brapi, [window]);
    expect(results).toEqual([{ ticker: 'PETR4', status: 'failed' }]);
    expect(warn).toHaveBeenCalledWith(
      { ticker: 'PETR4', count: 2, timestamp: OPEN_UTC },
      expect.stringContaining('meia-noite de Brasília'),
    );
  });

  it('uma barra avulsa fora da forma (um ponto do dia corrente) é descartada com aviso, e as boas ficam', async () => {
    const fetchFn = fakeFetch(() => historical('PETR4', [price(OCT_29), price(OPEN_UTC)]));
    const { results } = await collect(client(fetchFn).brapi, [window]);
    const [only] = results as Array<Extract<PaperResult, { status: 'ok' }>>;
    expect(only!.bars.map((bar) => bar.date)).toEqual(['2026-10-29']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('data absurda (fora do alcance de Date) é descartada, não lança', async () => {
    const huge = 8_640_000_000_000 + 10_800; // na forma, mas depois do último instante que o Date representa
    const fetchFn = fakeFetch(() => historical('PETR4', [price(huge), price(OCT_29)]));
    const { results } = await collect(client(fetchFn).brapi, [window]);
    const [only] = results as Array<Extract<PaperResult, { status: 'ok' }>>;
    expect(only!.bars.map((bar) => bar.date)).toEqual(['2026-10-29']);
  });

  it('volume ou preço fora da escala (erro de unidade) vira falta do dia, e não um INSERT estourado que derruba o lote toda noite', async () => {
    const fetchFn = fakeFetch(() =>
      historical('PETR4', [
        price(OCT_30, 10, 11, 9, 10, 1e17), // 1e17 ações x R$ 10,00 passa do bigint do Postgres
        price(OCT_29, 1e12, 1e12, 1e12, 1e12, 1), // R$ 1 trilhão por ação
        price(OCT_28),
      ]),
    );
    const { results } = await collect(client(fetchFn).brapi, [window]);
    const [only] = results as Array<Extract<PaperResult, { status: 'ok' }>>;
    expect(only!.status).toBe('ok');
    expect(only!.bars.map((bar) => bar.date)).toEqual(['2026-10-28']);
  });

  it('ticker trocado (changed: true): os preços são da série de outro código, então o papel fica sem resposta, com aviso', async () => {
    const fetchFn = fakeFetch(() =>
      json({ results: [{ ...result('ELET6', [price(OCT_30)]), symbol: 'AXIA6', changed: true }] }),
    );
    const { results } = await collect(client(fetchFn).brapi, [{ ...ask, ticker: 'ELET6' }]);
    expect(results).toEqual([{ ticker: 'ELET6', status: 'failed' }]);
    expect(warn).toHaveBeenCalledWith(
      { ticker: 'ELET6', symbol: 'AXIA6' },
      expect.stringContaining('trocado'),
    );
  });

  it('conta, sem preço, as barras cujo fechamento difere do ajustado: é assim que a prova mede se a brapi serve o preço ajustado', async () => {
    const fetchFn = fakeFetch(() =>
      historical('PETR4', [
        price(OCT_29),
        { ...price(OCT_30), adjustedClose: 51.2 },
        { ...price(OCT_28), adjustedClose: null },
      ]),
    );
    const { results } = await collect(client(fetchFn).brapi, [window]);
    const [only] = results as Array<Extract<PaperResult, { status: 'ok' }>>;
    expect(only!.bars.map((bar) => bar.closeCents)).toEqual([5271n, 5271n, 5271n]); // a barra leva o fechamento, não o ajustado
    expect(warn).toHaveBeenCalledWith(
      { ticker: 'PETR4', adjusted: 1 },
      expect.stringContaining('ajustado'),
    );
  });
});

describe('BrapiClient: erros que não são resposta', () => {
  it('falha de rede registra o nome do erro e o código da causa, e nunca a mensagem (que pode trazer a URL)', async () => {
    const cause = Object.assign(new Error(`connect ECONNRESET ${TOKEN} https://brapi.dev/x`), {
      code: 'ECONNRESET',
    });
    const fetchFn = fakeFetch(() => new TypeError('fetch failed', { cause }));
    const { results } = await collect(client(fetchFn).brapi, papers('A1'));
    expect(results).toEqual([{ ticker: 'A1', status: 'failed' }]);
    expect(warn).toHaveBeenCalledWith(
      { error: 'TypeError', code: 'ECONNRESET' },
      expect.stringContaining('sem resposta'),
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('brapi.dev');
  });

  it('token com espaço, quebra de linha ou caractere fora do ASCII é erro de configuração, não "brapi fora do ar"', async () => {
    for (const token of ['abc\ndef', 'abc def', 'tóken']) {
      const fetchFn = fakeFetch(() => historical('A1', []));
      const error = await new BrapiClient(token, fetchFn)
        .fetchBars(papers('A1'), () => undefined)
        .catch((e: unknown) => e as Error);
      expect(error).toBeInstanceOf(BrapiConfigError);
      expect((error as Error).message).not.toContain(token);
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('5 respostas 404 seguidas sem nenhum papel bom antes: a janela ou o plano recusa tudo, e a passada para', async () => {
    // o 400 de verdade da brapi para uma janela de mais de 90 dias (prova controlada de 04/11/2026)
    const fetchFn = fakeFetch(() =>
      json(
        {
          error: 'true',
          code: 'DATE_WINDOW_EXCEEDED',
          message: 'Seu plano permite no máximo 90 dias de dados históricos.',
        },
        400,
      ),
    );
    const names = Array.from({ length: 30 }, (_, i) => `P${i}`);
    const { run, results } = await collect(client(fetchFn).brapi, papers(...names));
    expect(run.stopped).toBe('outage');
    expect(results).toHaveLength(5);
  });

  it('depois de um papel bom, 400 e 404 são do papel (suspenso, sem histórico): dez seguidos não encerram a passada', async () => {
    const fetchFn = fakeFetch((url) =>
      ['G1', 'G2'].includes(url.searchParams.get('symbols')!)
        ? historical(url.searchParams.get('symbols')!, [price(OCT_30)])
        : json({ error: true, code: 'NOT_FOUND' }, 404),
    );
    const names = ['G1', ...Array.from({ length: 10 }, (_, i) => `X${i}`), 'G2'];
    const { run, results } = await collect(client(fetchFn).brapi, papers(...names));
    expect(run.stopped).toBeNull();
    expect(results.at(-1)).toMatchObject({ ticker: 'G2', status: 'ok' });
  });

  it('o 5xx depois de um papel bom continua contando: 5 seguidos são a brapi fora do ar', async () => {
    const fetchFn = fakeFetch((url) =>
      url.searchParams.get('symbols') === 'G1' ? historical('G1', [price(OCT_30)]) : json({}, 502),
    );
    const names = ['G1', ...Array.from({ length: 20 }, (_, i) => `X${i}`)];
    const { run } = await collect(client(fetchFn).brapi, papers(...names));
    expect(run.stopped).toBe('outage');
  });
});

describe('BrapiClient.listStocks', () => {
  const listBody = (stocks: unknown[], hasNextPage = false) => ({
    indexes: [],
    stocks,
    hasNextPage,
    currentPage: 1,
  });

  it('pede a lista de ações com o token no cabeçalho e devolve código, nome e subtipo', async () => {
    const fetchFn = fakeFetch(() =>
      json(
        listBody([
          { stock: 'PETR4', name: 'PETROBRAS', type: 'stock', subType: 'stock', close: 1 },
          { stock: 'TAEE11', name: null, subType: 'unit' },
        ]),
        200,
        // os cabeçalhos da lista de verdade (prova controlada de 04/11/2026): outro limitador, 20 por minuto, que não é a cota
        { 'ratelimit-limit': '20', 'ratelimit-remaining': '20', 'ratelimit-reset': '60' },
      ),
    );
    const out = await client(fetchFn).brapi.listStocks();
    const url = urlOf(fetchFn.mock.calls[0]![0]);
    expect(url.pathname).toBe('/api/quote/list');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: 'stock',
      limit: '1000',
      page: '1',
    });
    expect(url.href).not.toContain(TOKEN);
    // `logo` nulo: a linha da lista não trouxe logo (o teste do logo, abaixo, cobre a forma)
    expect(out.listings).toEqual([
      { ticker: 'PETR4', name: 'PETROBRAS', subType: 'stock', logo: null },
      { ticker: 'TAEE11', name: null, subType: 'unit', logo: null },
    ]);
    expect(out).toMatchObject({ requests: 1, remaining: null, stopped: null });
  });

  // O logo da lista (ADR 0036): o job baixa o SVG desse endereço, então só vale a forma exata do icons.brapi.dev; o resto é "sem logo", e
  // um valor torto num papel nunca derruba a lista inteira.
  it('lê o logo de cada ação: só a URL https exata de icons.brapi.dev/icons/<nome>.svg vale; o resto é sem logo, e nada derruba a lista', async () => {
    const good = 'https://icons.brapi.dev/icons/PETR4.svg';
    const logos: Array<[string, unknown]> = [
      ['PETR4', good],
      ['VALE3', undefined],
      ['ABEV3', null],
      ['ITUB4', 42],
      ['BBDC4', { url: good }],
      ['WEGE3', 'http://icons.brapi.dev/icons/WEGE3.svg'],
      ['B3SA3', 'https://icons.brapi.dev.exemplo.invalid/icons/B3SA3.svg'],
      ['RENT3', 'https://exemplo.invalid/icons/RENT3.svg'],
      ['LREN3', 'https://icons.brapi.dev/icons/../LREN3.svg'],
      ['MGLU3', 'https://icons.brapi.dev/icons/%2e%2e/MGLU3.svg'],
      ['SUZB3', 'https://icons.brapi.dev/icons/SUZB3.png'],
      ['GGBR4', 'https://icons.brapi.dev/icons/GGBR4.svg?v=1'],
      ['CSNA3', 'https://icons.brapi.dev/icons/CSNA3.svg#a'],
      ['EMBR3', 'https://alguem@icons.brapi.dev/icons/EMBR3.svg'],
      ['JBSS3', 'https://icons.brapi.dev:8443/icons/JBSS3.svg'],
      ['RADL3', 'https://icons.brapi.dev/logos/RADL3.svg'],
      ['PRIO3', 'HTTPS://ICONS.BRAPI.DEV/icons/PRIO3.svg'],
      ['UGPA3', `${good} `],
      ['CMIG4', 'javascript:alert(1)//icons.brapi.dev/icons/CMIG4.svg'],
      ['SBSP3', `https://icons.brapi.dev/icons/${'A'.repeat(40)}.svg`],
    ];
    const fetchFn = fakeFetch(() =>
      json(listBody(logos.map(([stock, logo]) => ({ stock, subType: 'stock', logo })))),
    );
    const out = await client(fetchFn).brapi.listStocks();
    expect(out.listings).toHaveLength(logos.length);
    expect(Object.fromEntries(out.listings!.map((l) => [l.ticker, l.logo]))).toEqual(
      Object.fromEntries(logos.map(([ticker]) => [ticker, ticker === 'PETR4' ? good : null])),
    );
  });

  // A prova de 05/11/2026 (ADR 0036): 31 das 783 ações da lista vinham com o mesmo endereço, o ícone da própria brapi para quem não tem logo.
  it('o ícone padrão da brapi (BRAPI.svg, o de quem não tem logo) é sem logo', async () => {
    const fetchFn = fakeFetch(() =>
      json(
        listBody([
          { stock: 'SEML3', subType: 'stock', logo: 'https://icons.brapi.dev/icons/BRAPI.svg' },
          { stock: 'BRAP4', subType: 'stock', logo: 'https://icons.brapi.dev/icons/BRAP4.svg' },
        ]),
      ),
    );
    const out = await client(fetchFn).brapi.listStocks();
    expect(out.listings?.map((l) => [l.ticker, l.logo])).toEqual([
      ['SEML3', null],
      ['BRAP4', 'https://icons.brapi.dev/icons/BRAP4.svg'],
    ]);
  });

  it('segue as páginas enquanto hasNextPage é verdadeiro', async () => {
    const fetchFn = fakeFetch((url) =>
      url.searchParams.get('page') === '1'
        ? json(listBody([{ stock: 'AAAA3' }], true))
        : json(listBody([{ stock: 'BBBB4' }])),
    );
    const out = await client(fetchFn).brapi.listStocks();
    expect(out.listings?.map((l) => l.ticker)).toEqual(['AAAA3', 'BBBB4']);
    expect(out.requests).toBe(2);
  });

  it('lista que não veio (5xx, formato torto, páginas demais) é nula: quem chama segue sem ela', async () => {
    const down = client(fakeFetch(() => json({}, 503)));
    expect((await down.brapi.listStocks()).listings).toBeNull();

    const odd = client(fakeFetch(() => json({ stocks: 'nenhuma' })));
    expect((await odd.brapi.listStocks()).listings).toBeNull();

    const endless = client(fakeFetch(() => json(listBody([{ stock: 'AAAA3' }], true))));
    const out = await endless.brapi.listStocks();
    expect(out.listings).toBeNull();
    expect(out.requests).toBe(3);
  });

  it('401 sobe como erro de configuração', async () => {
    const fetchFn = fakeFetch(() => json({ message: TOKEN }, 401));
    await expect(client(fetchFn).brapi.listStocks()).rejects.toThrow(BrapiConfigError);
  });

  it('a lista também tem o orçamento de tempo: páginas lentas encerram a busca e a lista fica nula', async () => {
    const t = timed({ budgetMs: 150_000 });
    const fetchFn = fakeFetch(() => {
      t.advance(100_000);
      return json(listBody([{ stock: 'AAAA3' }], true));
    });
    const out = await new BrapiClient(TOKEN, fetchFn, t.options).listStocks();
    // a 2ª página começa aos 100 s, dentro do orçamento; a 3ª começaria aos 200 s
    expect(out).toMatchObject({ listings: null, requests: 2, stopped: 'time' });
  });

  // Achado da prova controlada de 04/11/2026: a resposta da lista traz RateLimit-Remaining 20 (o limitador próprio dela, 20 por minuto, fora da
  // cota). Lido como a cota (reserva de 500), esse 20 fazia a lista parar na 2ª página e registrar brapi-cota-baixa por engano.
  it('a lista não lê a cota da resposta dela: o RateLimit-Remaining de 20 por minuto não para a página seguinte nem alerta', async () => {
    const listRate = {
      'ratelimit-limit': '20',
      'ratelimit-remaining': '20',
      'ratelimit-reset': '60',
    };
    const fetchFn = fakeFetch((url) =>
      url.searchParams.get('page') === '1'
        ? json(listBody([{ stock: 'AAAA3' }], true), 200, listRate)
        : json(listBody([{ stock: 'BBBB4' }]), 200, listRate),
    );
    const out = await client(fetchFn).brapi.listStocks();
    expect(out.listings?.map((l) => l.ticker)).toEqual(['AAAA3', 'BBBB4']);
    expect(out).toMatchObject({ requests: 2, remaining: null, stopped: null });
    expect(alerted(ALERT_LOG.brapiQuotaLow)).toBe(false);
  });

  it('o 429 da lista também não espera além do orçamento', async () => {
    const t = timed({ budgetMs: 20_000 });
    const fetchFn = fakeFetch(() => json({}, 429, { 'retry-after': '30' }));
    const out = await new BrapiClient(TOKEN, fetchFn, t.options).listStocks();
    expect(out).toMatchObject({ listings: null, requests: 1, stopped: 'time' });
    expect(t.elapsed()).toBe(0);
  });
});
