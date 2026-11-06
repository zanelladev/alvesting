import { describe, expect, it } from 'vitest';
import { historyStart } from '../modules/market-data/domain/bar-plan.js';
import { addDays, brasiliaInstant, type IsoDate } from '../modules/market-data/domain/dates.js';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { createSimClock } from './bus.js';
import { FAKE_TOKEN, createFakeBrapi } from './fake-brapi.js';
import { buildMarket } from './market.js';

// A brapi do ensaio: um fetch que responde no formato dos docs com o mercado sintético. O cliente de verdade a lê (ensaio.integration.spec.ts);
// aqui o que ela promete: autenticação, uma ação por requisição, janela de no máximo 90 dias, cabeçalhos de cota, quantidade e hora de publicação.
const calendar = loadTradingCalendar();
const market = buildMarket({ seed: 1, stocks: 12, firstDay: '2026-11-03', sessions: 3, calendar });
const [D1, D2] = market.sessionDays as [string, string];
const NOON = new Date('2026-11-04T12:00:00Z'); // 09:00 em Brasília

const headers = { authorization: `Bearer ${FAKE_TOKEN}` };
function setup(now = NOON) {
  const clock = createSimClock(now);
  const brapi = createFakeBrapi({ market, clock });
  const get = (path: string, init: RequestInit = { headers }) =>
    brapi.fetch(`https://brapi.dev${path}`, init);
  return { brapi, clock, get };
}

describe('createFakeBrapi', () => {
  it('sem o token, 401 (como a de verdade) e a requisição não vai para a conta', async () => {
    const t = setup();
    const response = await t.get(
      '/api/v2/stocks/historical?symbols=MOVE3&startDate=2026-11-03&endDate=2026-11-03',
      {},
    );
    expect(response.status).toBe(401);
    expect(t.brapi.requests).toHaveLength(0);
  });

  it('devolve a barra no formato dos docs: data à meia-noite de Brasília em segundos, preço decimal e QUANTIDADE (não volume financeiro)', async () => {
    const t = setup();
    const response = await t.get(
      `/api/v2/stocks/historical?symbols=MOVE3&startDate=${D1}&endDate=${D1}&interval=1d`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{
        requestedSymbol: string;
        data: { historicalDataPrice: Array<Record<string, number>> };
      }>;
    };
    const [result] = body.results;
    expect(result!.requestedSymbol).toBe('MOVE3');
    const [price] = result!.data.historicalDataPrice;
    const bar = market.bars.get(D1)!.find((b) => b.ticker === 'MOVE3')!;
    expect(price).toMatchObject({
      date: brasiliaInstant(D1).getTime() / 1000,
      open: Number(bar.open) / 100,
      close: Number(bar.close) / 100,
    });
    // quantidade x fechamento volta ao volume financeiro do mercado sintético, com o erro do arredondamento (menos de meio fechamento)
    const estimated = BigInt(price!.volume!) * bar.close;
    const gap = estimated > bar.volume ? estimated - bar.volume : bar.volume - estimated;
    expect(gap * 2n <= bar.close).toBe(true);
  });

  it('a barra de um pregão só aparece na hora em que ela "sai": antes das 20:45 a resposta vem vazia', async () => {
    const t = setup(new Date(`${D2}T12:00:00Z`)); // 09:00 de D2
    const body = (await (
      await t.get(`/api/v2/stocks/historical?symbols=MOVE3&startDate=${D2}&endDate=${D2}`)
    ).json()) as { results: Array<{ data: { historicalDataPrice: unknown[] } }> };
    expect(body.results[0]!.data.historicalDataPrice).toEqual([]);
    t.clock.set(brasiliaInstant(D2, '20:45'));
    const later = (await (
      await t.get(`/api/v2/stocks/historical?symbols=MOVE3&startDate=${D2}&endDate=${D2}`)
    ).json()) as { results: Array<{ data: { historicalDataPrice: unknown[] } }> };
    expect(later.results[0]!.data.historicalDataPrice).toHaveLength(1);
  });

  it('papel sem negócio no dia não tem barra (SECA3 em D2)', async () => {
    const t = setup(new Date(`${D2}T23:00:00Z`));
    const body = (await (
      await t.get(`/api/v2/stocks/historical?symbols=SECA3&startDate=${D1}&endDate=${D2}`)
    ).json()) as { results: Array<{ data: { historicalDataPrice: Array<{ date: number }> } }> };
    expect(body.results[0]!.data.historicalDataPrice.map((p) => p.date)).toEqual([
      brasiliaInstant(D1).getTime() / 1000,
    ]);
  });

  // Medido na brapi de verdade (prova controlada de 04/11/2026): o plano gratuito aceita no máximo 90 dias entre startDate e endDate (400
  // DATE_WINDOW_EXCEEDED acima), e a idade do início não conta. 88 dias passaram, 274 não; o limite exato não foi medido.
  it('o plano gratuito: uma ação por requisição e no máximo 90 dias entre startDate e endDate; acima disso, 400 DATE_WINDOW_EXCEEDED', async () => {
    const t = setup(); // 04/11/2026
    expect(
      (await t.get(`/api/v2/stocks/historical?symbols=MOVE3,DOBR4&startDate=${D1}&endDate=${D1}`))
        .status,
    ).toBe(400);
    for (const startDate of ['2026-02-02', '2026-08-01', '2026-08-04']) {
      // 274, 94 e 91 dias até 03/11
      const response = await t.get(
        `/api/v2/stocks/historical?symbols=MOVE3&startDate=${startDate}&endDate=2026-11-03`,
      );
      expect(response.status, startDate).toBe(400);
      expect(await response.json(), startDate).toMatchObject({ code: 'DATE_WINDOW_EXCEEDED' });
    }
    for (const startDate of ['2026-08-05', '2026-08-06', '2026-08-07']) {
      // 90, 89 e 88 dias
      const response = await t.get(
        `/api/v2/stocks/historical?symbols=MOVE3&startDate=${startDate}&endDate=2026-11-03`,
      );
      expect(response.status, startDate).toBe(200);
    }
    // a idade do início não conta: um dia, mais de 3 meses atrás
    expect(
      (
        await t.get(
          '/api/v2/stocks/historical?symbols=MOVE3&startDate=2026-08-03&endDate=2026-08-03',
        )
      ).status,
    ).toBe(200);
    const unknown = await t.get(
      `/api/v2/stocks/historical?symbols=NAOEXISTE3&startDate=${D1}&endDate=${D1}`,
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('o início do histórico que o cliente pede (historyStart) cabe no limite em qualquer dia do ano', async () => {
    for (let day: IsoDate = '2026-01-01'; day <= '2026-12-31'; day = addDays(day, 1)) {
      const t = setup(brasiliaInstant(day, '12:00'));
      const response = await t.get(
        `/api/v2/stocks/historical?symbols=MOVE3&startDate=${historyStart(day)}&endDate=${day}`,
      );
      expect(response.status, day).toBe(200); // e não o 400 do limite
    }
  });

  it('a cota cai a cada requisição e vem na resposta do histórico; a lista traz o limitador próprio dela; a opção quota a aproxima do limite', async () => {
    const t = setup();
    const first = await t.get(
      `/api/v2/stocks/historical?symbols=MOVE3&startDate=${D1}&endDate=${D1}`,
    );
    const list = await t.get('/api/quote/list?type=stock&limit=1000&page=1');
    const second = await t.get(
      `/api/v2/stocks/historical?symbols=MOVE3&startDate=${D1}&endDate=${D1}`,
    );
    expect(first.headers.get('ratelimit-remaining')).toBe('14999');
    expect(first.headers.get('ratelimit-limit')).toBe('15000');
    expect(second.headers.get('ratelimit-remaining')).toBe('14997');
    // o que o cliente lê: o X-RateLimit-Remaining da janela móvel de 30 dias
    expect(first.headers.get('x-ratelimit-remaining')).toBe('14999');
    expect(first.headers.get('x-ratelimit-window')).toBe('rolling-30d');
    expect(second.headers.get('x-ratelimit-remaining')).toBe('14997');
    // a lista de verdade responde 20 de 20 por minuto, fora da cota e sem X-RateLimit-* (prova controlada de 04/11/2026)
    expect(list.headers.get('ratelimit-limit')).toBe('20');
    expect(list.headers.get('ratelimit-remaining')).toBe('20');
    expect(list.headers.get('x-ratelimit-remaining')).toBeNull();

    const near = createFakeBrapi({ market, clock: createSimClock(NOON), quota: 502 });
    const response = await near.fetch(
      `https://brapi.dev/api/v2/stocks/historical?symbols=MOVE3&startDate=${D1}&endDate=${D1}`,
      { headers },
    );
    expect(response.headers.get('ratelimit-remaining')).toBe('501');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('501');
  });

  it('a lista traz as ações do mercado com o subtipo unit para a classe UNT', async () => {
    const t = setup();
    const body = (await (await t.get('/api/quote/list?type=stock&limit=1000&page=1')).json()) as {
      stocks: Array<{ stock: string; name: string; type: string; subType: string }>;
      hasNextPage: boolean;
    };
    expect(body.hasNextPage).toBe(false);
    expect(body.stocks.map((s) => s.stock)).toEqual(market.stocks.map((s) => s.ticker));
    const units = body.stocks.filter((s) => s.subType === 'unit').map((s) => s.stock);
    expect(units.length).toBeGreaterThan(0);
    expect(units.every((ticker) => ticker.endsWith('11'))).toBe(true);
    expect(body.stocks.every((s) => s.type === 'stock')).toBe(true);
  });

  it('conta as requisições que atende, com o tipo', async () => {
    const t = setup();
    await t.get(`/api/v2/stocks/historical?symbols=MOVE3&startDate=${D1}&endDate=${D1}`);
    await t.get('/api/quote/list?type=stock');
    expect(t.brapi.requests.map((r) => [r.kind, r.symbol, r.from, r.to])).toEqual([
      ['historical', 'MOVE3', D1, D1],
      ['list', undefined, undefined, undefined],
    ]);
  });
});
