import { describe, expect, it } from 'vitest';
import {
  BRAPI_PLAN,
  MISSING_ALERT_PERCENT,
  QUOTA_RESERVE,
  WINDOW_SESSIONS,
  historyStart,
  missingTooMuch,
  planRequests,
  quoteTargets,
  windowOf,
} from './bar-plan.js';
import { addDays, isWeekday, type IsoDate } from './dates.js';
import { loadTradingCalendar } from './trading-calendar.js';

const calendar = loadTradingCalendar();
const have = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries).map(([ticker, days]) => [ticker, new Set(days)]));

describe('windowOf: os 5 últimos pregões até D', () => {
  it('conta só pregões (o feriado de Finados, 02/11, e o fim de semana não entram)', () => {
    expect(WINDOW_SESSIONS).toBe(5);
    expect(windowOf(calendar, '2026-11-06')).toEqual([
      '2026-10-30',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
  });
});

describe('historyStart: o histórico do plano gratuito', () => {
  it('são 3 meses de calendário antes (o dia que não existe no mês cai no último dia dele) e mais 3 dias de folga', () => {
    expect(BRAPI_PLAN.historyMonths).toBe(3);
    expect(historyStart('2026-11-03')).toBe('2026-08-06');
    expect(historyStart('2026-05-31')).toBe('2026-03-03'); // 28/02 + 3 dias
    expect(historyStart('2028-05-31')).toBe('2028-03-03'); // 29/02 + 3 dias
  });

  // A brapi de verdade recusa o pedido com mais de 90 dias entre startDate e endDate (400 DATE_WINDOW_EXCEEDED; prova controlada de
  // 04/11/2026: 88 dias passaram, 274 não). O pedido vai de historyStart até um pregão que não passa de hoje. Três meses de calendário vão
  // de 89 a 92 dias; a folga de 3 dias deixa o pedido em 86 a 89 dias, abaixo do teto em qualquer data.
  it('nunca passa de 89 dias antes, qualquer que seja o mês', () => {
    let longest = 0;
    let shortest = Infinity;
    for (let day: IsoDate = '2026-01-01'; day <= '2028-12-31'; day = addDays(day, 1)) {
      const back = (Date.parse(day) - Date.parse(historyStart(day))) / 86_400_000;
      longest = Math.max(longest, back);
      shortest = Math.min(shortest, back);
    }
    expect(longest).toBe(89);
    expect(shortest).toBe(86); // e continua perto dos 3 meses
  });
});

describe('planRequests: o banco é o cache, só a falta é pedida', () => {
  const sessions = ['2026-10-30', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];

  it('o papel sem barra de D é pedido da janela inteira; o que tem D não é pedido', () => {
    const requests = planRequests(
      ['PETR4', 'VALE3', 'BOVA11'],
      sessions,
      have({ VALE3: sessions, BOVA11: sessions.slice(0, 4) }),
      '2026-11-06',
    );
    expect(requests).toEqual([
      { ticker: 'PETR4', from: '2026-10-30', to: '2026-11-06' },
      { ticker: 'BOVA11', from: '2026-11-06', to: '2026-11-06' },
    ]);
  });

  it('o pedido começa no pregão mais antigo que falta: a noite em que a brapi esteve fora é recuperada junto com a de hoje', () => {
    const requests = planRequests(
      ['PETR4'],
      sessions,
      have({ PETR4: ['2026-10-30', '2026-11-03', '2026-11-04'] }),
      '2026-11-06',
    );
    expect(requests).toEqual([{ ticker: 'PETR4', from: '2026-11-05', to: '2026-11-06' }]);
  });

  it('com D gravado, um buraco mais atrás (pregão sem negócio) não pede o papel de novo', () => {
    const requests = planRequests(
      ['PETR4'],
      sessions,
      have({ PETR4: ['2026-10-30', '2026-11-04', '2026-11-05', '2026-11-06'] }),
      '2026-11-06',
    );
    expect(requests).toEqual([]);
  });

  it('sem pregão obrigatório, qualquer buraco pede o papel (a carga inicial e a atualização semanal)', () => {
    const requests = planRequests(
      ['PETR4', 'VALE3'],
      sessions,
      have({ PETR4: ['2026-10-30', '2026-11-04', '2026-11-05', '2026-11-06'], VALE3: sessions }),
    );
    expect(requests).toEqual([{ ticker: 'PETR4', from: '2026-11-03', to: '2026-11-06' }]);
  });

  it('janela vazia não pede nada, e a ordem dos papéis é a dada', () => {
    expect(planRequests(['PETR4'], [], new Map())).toEqual([]);
    expect(
      planRequests(['B', 'A'], sessions, new Map(), '2026-11-06').map((r) => r.ticker),
    ).toEqual(['B', 'A']);
  });
});

describe('quoteTargets: o conjunto obrigatório e o opcional', () => {
  it('o obrigatório é o BOVA11 (primeiro, é a sonda), o universo e os papéis em posição, sem repetir', () => {
    const { required } = quoteTargets({
      universe: ['PETR4', 'VALE3'],
      held: ['VALE3', 'AMER3'],
      portfolio: [],
    });
    expect(required).toEqual(['BOVA11', 'PETR4', 'VALE3', 'AMER3']);
  });

  it('o opcional são as carteiras dos usuários fora do obrigatório', () => {
    const { optional } = quoteTargets({
      universe: ['PETR4'],
      held: [],
      portfolio: ['PETR4', 'WEGE3', 'WEGE3', 'ITUB4'],
    });
    expect(optional).toEqual(['WEGE3', 'ITUB4']);
  });
});

describe('missingTooMuch: o eod-barras-ausentes', () => {
  it('faltar o BOVA11 sempre alerta', () => {
    expect(missingTooMuch(['BOVA11'], 310)).toBe(true);
  });

  it('o limite é MISSING_ALERT_PERCENT do obrigatório: 31 de 310 passa, 32 alerta', () => {
    expect(MISSING_ALERT_PERCENT).toBe(10);
    const some = (n: number) => Array.from({ length: n }, (_, i) => `T${i}`);
    expect(missingTooMuch(some(31), 310)).toBe(false);
    expect(missingTooMuch(some(32), 310)).toBe(true);
    expect(missingTooMuch([], 310)).toBe(false);
  });
});

// A7: a conta da cota. Um mês sintético de 21 pregões e 4 domingos montado com o MESMO planejador do eod, da atualização semanal e da
// carga inicial, e um teto. Os números são os de docs/DADOS.md, seção 6: se o plano mudar e a conta passar do teto, este teste cai antes
// de a cota de 15 mil requisições por mês acabar de verdade.
describe('a cota de um mês sintético', () => {
  const REQUIRED = 310; // o universo (306 hoje) mais o BOVA11 e uns papéis em posição
  const CANDIDATES = 100; // as ações da lista fora do conjunto diário
  const PORTFOLIO = 20; // papéis das carteiras fora do obrigatório
  const SESSIONS = 21;
  const SUNDAYS = 4;
  const NO_TRADE_PERCENT = 3; // papéis sem negócio num dia comum
  const STRAGGLER_RETRIES = 3; // 22:30, 23:30 e 00:30
  const CEILING = BRAPI_PLAN.requestsPerWindow * 0.6;

  // 30 pregões de calendário sintético, só dias úteis
  const days: IsoDate[] = [];
  for (let day: IsoDate = '2026-09-01'; days.length < 40; day = addDays(day, 1)) {
    if (isWeekday(day)) days.push(day);
  }
  const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const noTrade = (percent: number) => (index: number, day: number) =>
    (index * 7 + day * 13) % 100 < percent;

  function month({
    noTradePercent = NO_TRADE_PERCENT,
    retries = STRAGGLER_RETRIES,
    portfolio = PORTFOLIO,
  } = {}) {
    const skips = noTrade(noTradePercent);
    const required = ['BOVA11', ...names('R', REQUIRED - 1)];
    const optional = names('O', portfolio);
    const candidates = names('C', CANDIDATES);
    const store = new Map<string, Set<IsoDate>>();
    const fetched = (ticker: string, index: number, from: IsoDate, to: IsoDate) => {
      const got = store.get(ticker) ?? new Set<IsoDate>();
      for (const d of days) {
        if (d >= from && d <= to && (ticker === 'BOVA11' || !skips(index, days.indexOf(d)))) {
          got.add(d);
        }
      }
      store.set(ticker, got);
    };
    // antes do mês, todo papel já tem o histórico dos 10 primeiros pregões
    for (const [index, ticker] of [...required, ...optional].entries()) {
      fetched(ticker, index, days[0]!, days[9]!);
    }

    let nightly = 0;
    let weekly = 0;
    for (let n = 0; n < SESSIONS; n += 1) {
      const dayIndex = 10 + n;
      const d = days[dayIndex]!;
      const window = days.slice(dayIndex - (WINDOW_SESSIONS - 1), dayIndex + 1);
      // 1ª passada: o conjunto obrigatório
      const first = planRequests(required, window, store, d);
      for (const r of first) fetched(r.ticker, required.indexOf(r.ticker), r.from, r.to);
      nightly += first.length;
      // novas tentativas: só quem continua sem a barra do dia (papel sem negócio)
      for (let retry = 0; retry < retries; retry += 1) {
        const again = planRequests(required, window, store, d);
        for (const r of again) fetched(r.ticker, required.indexOf(r.ticker), r.from, r.to);
        nightly += again.length;
      }
      // o opcional: uma vez, na tentativa que conclui
      const extra = planRequests(optional, window, store, d);
      for (const r of extra) fetched(r.ticker, 1000 + optional.indexOf(r.ticker), r.from, r.to);
      nightly += extra.length;
    }
    // os domingos: a lista, e a semana dos candidatos (que ninguém pediu durante a semana)
    for (let sunday = 0; sunday < SUNDAYS; sunday += 1) {
      const last = 14 + sunday * 5;
      const window = days.slice(last - (WINDOW_SESSIONS - 1), last + 1);
      const asks = planRequests(candidates, window, store, days[last]);
      for (const r of asks) fetched(r.ticker, 2000 + candidates.indexOf(r.ticker), r.from, r.to);
      weekly += 1 + asks.length;
    }
    return { nightly, weekly, total: nightly + weekly };
  }

  it('o mês fica abaixo do teto de 60% da cota, e a conta é a que o DADOS.md publica', () => {
    const { nightly, weekly, total } = month();
    // As noites: 21 x 310 = 6.510 do obrigatório, mais 585 das novas tentativas dos papéis sem negócio (3 x 195 papéis-noite, uns 9 por
    // noite) e 420 das carteiras (21 x 20). Os domingos: 4 x (1 da lista + 100 candidatos).
    expect(CEILING).toBe(9000);
    expect(total).toBeLessThan(CEILING);
    expect({ nightly, weekly, total }).toEqual({ nightly: 7_515, weekly: 404, total: 7_919 });
  });

  it('a carga inicial (de 377 pedidos num banco novo a uns 480 no dev) mais o mês também cabe, e a reserva ainda sobra', () => {
    // Medido na prova controlada de 04/11/2026: a lista tinha 375 ações elegíveis (1 + 375 + o BOVA11 = 377 num banco novo); o modo sem rede no
    // dev previa 434 (433 papéis com barra faltando e a lista), e cada papel novo da lista soma mais um: 480 é o teto folgado.
    const initial = 480;
    const { total } = month();
    expect(initial + total).toBeLessThan(CEILING);
    expect(BRAPI_PLAN.requestsPerWindow - (initial + total)).toBeGreaterThan(QUOTA_RESERVE * 10);
  });

  it('sem papel sem negócio, sem nova tentativa e sem carteiras, as noites são uma requisição por papel por pregão: 310 x 21 = 6.510', () => {
    expect(REQUIRED * SESSIONS).toBe(6_510);
    // o planejador, e não a aritmética: nenhum papel é pedido duas vezes, e o do obrigatório que já tem o dia não é pedido
    const { nightly } = month({ noTradePercent: 0, retries: 0, portfolio: 0 });
    expect(nightly).toBe(6_510);
    expect(BRAPI_PLAN).toMatchObject({ requestsPerWindow: 15_000, windowDays: 30 });
  });
});
