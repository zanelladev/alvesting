// A api falsa do e2e das telas (etapa 9, parte 2; playwright.config.ts): um servidor HTTP mínimo que responde, no envelope e no formato
// do contrato, o que o banco sintético do ensaio não tem: a temporada que ainda não teve ciclo (com o próximo ciclo para a contagem),
// a ação sem notícia, o ciclo com HOLD forçado e itens descartados, o ciclo pulado, a notícia com caracteres especiais, o texto de
// terceiro com uma palavra de 100 caracteres sem espaço, o erro 500 e uma notícia que muda (e2e/fixture.spec.ts prova que a página só
// muda depois da revalidação). Nada vem de terceiro. Roda com o
// strip de tipos do Node: `node e2e/fixture-api.ts`, sem importar nada do repositório (só tipos, que somem).
// A carteira de quem chega com um cookie de sessão (a api falsa não confere sessão) é o que o banco sintético também não tem: o ticker sem
// barra, os valores nos tetos e o percentual que não cabe no inteiro seguro (e2e/carteira-layout.spec.ts).
import { createServer } from 'node:http';
import type {
  ArenaCurrent,
  CompetitorDetail,
  CycleView,
  DecisionsPage,
  Equity,
  InternalBars,
  Leaderboard,
  NewsPage,
  Portfolio,
  RandomBaseline,
  SeasonSummary,
  StockDetail,
} from '@alvesting/contracts';

const port = Number(process.env.FIXTURE_API_PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error('FIXTURE_API_PORT ausente');

// O segredo da rota interna de cotações (docs/API.md, seção 6), o mesmo que o site da api falsa recebe (playwright.config.ts). Como a api de
// verdade, a rota só responde com ele em `Authorization: Bearer`, e sem ele (ou com outro) é um 404 igual ao da rota que não existe.
const QUOTES_SECRET = process.env.QUOTES_SECRET;
if (!QUOTES_SECRET) throw new Error('QUOTES_SECRET ausente');

const sha = (digit: string) => digit.repeat(64);
const ULID = (suffix: string) => `01HZ8M3Q5K7R2T4V6W9X0Y1A2${suffix}`;

// Texto de terceiro sem um espaço (uma hashtag, uma URL colada): a página tem de quebrá-lo, e não se alargar para caber (e2e/fixture.spec.ts,
// em 360 e 320 px). O "W" é a letra mais larga das fontes de texto: 100 delas passam de 1.000 px.
const LONG_WORD = 'W'.repeat(100);

const season = {
  id: ULID('B'),
  slug: 'fixture',
  name: 'Temporada de teste',
  status: 'RUNNING',
  startDate: '2026-11-03',
  startedAt: '2026-11-02T21:00:00.000Z',
  finishedAt: null,
  settledThrough: null,
  params: {
    capitalCents: 10_000_000,
    sessions: 20,
    maxPositions: 10,
    maxOrdersPerCycle: 5,
    buyPercentOfEquity: [5, 25],
    sellPercentOfPosition: [1, 100],
    tradeCostBps: 3,
    decisionTimeBrt: '08:00',
    deadlineTimeBrt: '09:30',
    randomSeed: 'semente-do-sorteio',
    monteCarloSeed: 'semente-do-monte-carlo',
    monteCarloRuns: 1000,
  },
} satisfies SeasonSummary;

// O próximo 08:00 de Brasília (11:00 UTC) que fica a pelo menos 25 horas: a contagem sempre tem dias e horas para mostrar.
function nextDecision(now: number): { date: string; decisionAt: string } {
  const at = new Date(now);
  at.setUTCHours(11, 0, 0, 0);
  while (at.getTime() - now < 25 * 3_600_000) at.setUTCDate(at.getUTCDate() + 1);
  return { date: at.toISOString().slice(0, 10), decisionAt: at.toISOString() };
}

const arenaCurrent = (): ArenaCurrent => ({
  season,
  lastCycle: null,
  nextCycle: nextDecision(Date.now()),
  macro: { cdi: null, selic: null, ipcaMonth: null, ipca12m: null, usd: null },
  top: [],
});

const fixtureModel = {
  slug: 'fixture-model',
  name: 'Modelo de teste',
  type: 'MODEL',
  provider: 'fake',
  modelId: 'fake/teste',
} as const;

const cycle = (date: string): CycleView | null => {
  const base = {
    seasonId: season.id,
    decisionAt: `${date}T11:00:00.000Z`,
    deadlineAt: `${date}T12:30:00.000Z`,
  };
  if (date === '2026-11-04') {
    // um modelo decidiu com itens descartados; outro perdeu o prazo (HOLD forçado)
    return {
      ...base,
      id: ULID('C'),
      date,
      status: 'CLOSED',
      skipReason: null,
      closedAt: `${date}T11:10:30.000Z`,
      prompt: { version: 'a'.repeat(32), sha256: sha('1') },
      briefing: { sha256: sha('2') },
      decisions: [
        {
          competitor: { id: ULID('D'), slug: fixtureModel.slug, name: fixtureModel.name },
          status: 'DECIDED',
          holdReason: null,
          marketView: 'otimista',
          summary: 'Resumo do modelo de teste com <3 e "aspas" & mais.',
          inputSha256: sha('3'),
          outputSha256: sha('4'),
          costMicroUsd: 0,
          usage: null,
          applied: null,
          items: [
            {
              position: 0,
              action: 'BUY',
              ticker: 'SEMN3',
              percent: 10,
              confidence: 0.5,
              rationale: 'Compra de teste.',
            },
          ],
          dropped: [
            { position: 1, reason: 'over_order_limit' },
            { position: 2, reason: 'not_in_universe' },
          ],
        },
        {
          competitor: { id: ULID('E'), slug: 'fixture-late', name: 'Modelo atrasado' },
          status: 'FORCED_HOLD',
          holdReason: 'prazo',
          marketView: null,
          summary: null,
          inputSha256: null,
          outputSha256: null,
          costMicroUsd: 0,
          usage: null,
          applied: null,
          items: [],
          dropped: [],
        },
      ],
    };
  }
  if (date === '2026-11-06') {
    // o resumo e a justificativa do modelo com uma palavra de 100 caracteres sem espaço
    return {
      ...base,
      id: ULID('G'),
      date,
      status: 'CLOSED',
      skipReason: null,
      closedAt: `${date}T11:10:30.000Z`,
      prompt: { version: 'a'.repeat(32), sha256: sha('1') },
      briefing: { sha256: sha('2') },
      decisions: [
        {
          competitor: { id: ULID('D'), slug: fixtureModel.slug, name: fixtureModel.name },
          status: 'DECIDED',
          holdReason: null,
          marketView: 'neutro',
          summary: LONG_WORD,
          inputSha256: sha('3'),
          outputSha256: sha('4'),
          costMicroUsd: 0,
          usage: null,
          applied: null,
          items: [
            {
              position: 0,
              action: 'BUY',
              ticker: 'LONG3',
              percent: 10,
              confidence: 0.5,
              rationale: LONG_WORD,
            },
          ],
          dropped: [],
        },
      ],
    };
  }
  if (date === '2026-11-05') {
    return {
      ...base,
      id: ULID('F'),
      date,
      status: 'SKIPPED',
      skipReason: 'sem_briefing',
      closedAt: null,
      prompt: null,
      briefing: null,
      decisions: [],
    };
  }
  return null;
};

// A carteira nos tetos de PORTFOLIO_LIMITS (packages/contracts/src/portfolio-rules.ts): 1.000.000 de ações, R$ 1.000.000.000,00 de custo e o
// maior fechamento que a carteira usa (R$ 450.000,00 por ação), o que dá R$ 450.000.000.000,00 de valor numa posição só. A PNLN3 tem custo de
// 1 centavo, então o percentual (4,5 × 10^17 pontos-base) não cabe no inteiro seguro e é nulo mesmo com fechamento; a SEMN3 não tem barra
// (nenhum dos cinco campos do fechamento). O resumo conta o valor só das duas posições com fechamento.
const stamp = '2026-11-03T12:00:00.000Z';
const portfolio = {
  lots: [
    {
      id: ULID('H'),
      ticker: 'MOVE3',
      quantity: 1_000_000,
      costCents: 100_000_000_000,
      boughtOn: '2026-10-15',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: ULID('J'),
      ticker: 'SEMN3',
      quantity: 10,
      costCents: 20_000,
      boughtOn: '2026-10-10',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: ULID('K'),
      ticker: 'PNLN3',
      quantity: 1_000_000,
      costCents: 1,
      boughtOn: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
  positions: [
    {
      ticker: 'MOVE3',
      quantity: 1_000_000,
      costCents: 100_000_000_000,
      avgPriceCents: 100_000,
      closeCents: 45_000_000,
      closeDate: '2026-11-09',
      valueCents: 45_000_000_000_000,
      pnlCents: 44_900_000_000_000,
      pnlBps: 4_490_000,
    },
    {
      ticker: 'PNLN3',
      quantity: 1_000_000,
      costCents: 1,
      avgPriceCents: 0,
      closeCents: 45_000_000,
      closeDate: '2026-11-09',
      valueCents: 45_000_000_000_000,
      pnlCents: 44_999_999_999_999,
      pnlBps: null,
    },
    {
      ticker: 'SEMN3',
      quantity: 10,
      costCents: 20_000,
      avgPriceCents: 2_000,
      closeCents: null,
      closeDate: null,
      valueCents: null,
      pnlCents: null,
      pnlBps: null,
    },
  ],
  totals: {
    costCents: 100_000_020_001,
    pricedCostCents: 100_000_000_001,
    valueCents: 90_000_000_000_000,
    pnlCents: 89_899_999_999_999,
    pnlBps: 8_990_000,
    unpriced: 1,
  },
} satisfies Portfolio;

const failedOnce = new Set<string>();

// As barras da rota interna (docs/API.md, seção 6). A faixa do BOVA11 da home fica "sem dado" aqui (lista vazia, que é o que a api de verdade
// responde a um papel sem barra), e a COTA3 tem três pregões para as velas aparecerem. A CACH3 conta quantas vezes o site foi à api: o teste de
// cache prova que a segunda visita não vai e que a revalidação do worker a faz ir de novo.
const BARS: Readonly<Record<string, InternalBars['bars']>> = {
  COTA3: [
    { date: '2026-11-03', openCents: 3_660, highCents: 3_712, lowCents: 3_594, closeCents: 3_690 },
    { date: '2026-11-04', openCents: 3_690, highCents: 3_819, lowCents: 3_569, closeCents: 3_750 },
    { date: '2026-11-05', openCents: 3_750, highCents: 3_790, lowCents: 3_640, closeCents: 3_655 },
  ],
  CACH3: [
    { date: '2026-11-05', openCents: 1_000, highCents: 1_100, lowCents: 950, closeCents: 1_050 },
  ],
};
const reads = new Map<string, number>();

// A notícia que muda: o teste de cache troca o título e vê a página só mudar depois da revalidação.
let cacheTitle = 'Versão A';
const news = (ticker: string | null): NewsPage => {
  const row = (title: string, id: string) => ({
    title,
    source: 'agencia-brasil',
    sourceName: 'Agência Brasil',
    publishedAt: '2026-11-09T12:00:00.000Z',
    tickers: ticker ? [ticker] : [],
    url: `https://noticias.invalid/fixture/${id}`,
  });
  if (ticker === 'CACH3') return { rows: [row(cacheTitle, 'cache')], nextCursor: null };
  if (ticker === 'LONG3') return { rows: [row(LONG_WORD, 'longo')], nextCursor: null };
  // caracteres que viram HTML se alguém desescapar: aparecem como texto, uma vez só
  if (ticker === 'ESPC3')
    return { rows: [row('Fed & "juros" <3 &amp; mais', 'especial')], nextCursor: null };
  return { rows: [], nextCursor: null };
};

// Exclusão mútua entre os três projetos do Playwright, que rodam em paralelo: o teste de cache troca o dado e revalida, e isso
// atropelaria o mesmo teste rodando em outro projeto. Quem pede espera a vez; a vez vence sozinha em 60 s se o teste cair no meio.
let holder: Promise<void> = Promise.resolve();
let release: (() => void) | undefined;
async function lock(): Promise<void> {
  const previous = holder;
  let mine!: () => void;
  holder = new Promise<void>((resolve) => (mine = resolve));
  await previous;
  release = mine;
  setTimeout(mine, 60_000).unref();
}

const json = (body: unknown, status = 200): { status: number; body: string } => ({
  status,
  body: JSON.stringify(body),
});
const ok = (data: unknown) => json({ success: true, data, error: null });
const fail = (status: number, code: string, message: string) =>
  json({ success: false, data: null, error: { code, message } }, status);
const notFound = () => fail(404, 'NOT_FOUND', 'Não encontrado');

function route(
  method: string,
  url: URL,
  authorization: string | undefined,
): Promise<{ status: number; body: string }> | { status: number; body: string } {
  const path = url.pathname;
  if (method === 'POST' && path === '/__test/lock')
    return lock().then(() => json({ locked: true }));
  if (method === 'POST' && path === '/__test/unlock') {
    release?.();
    return json({ locked: false });
  }
  if (method === 'POST' && path === '/__test/titulo') {
    cacheTitle = url.searchParams.get('valor') ?? cacheTitle;
    return json({ titulo: cacheTitle });
  }
  if (method === 'POST' && path === '/__test/zerar') {
    reads.clear();
    return json({ zerado: true });
  }
  if (method === 'GET' && path === '/__test/leituras')
    return json({ leituras: reads.get(url.searchParams.get('ticker') ?? '') ?? 0 });
  if (method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  if (!path.startsWith('/api/v1/')) return notFound();
  const rest = path.slice('/api/v1'.length);

  if (rest === '/health')
    return json({ success: true, data: { status: 'ok', service: 'api' }, error: null });
  if (rest === '/arena/current') return ok(arenaCurrent());
  if (rest === '/me/portfolio') return ok(portfolio);
  if (rest === '/decisions') return ok({ rows: [], nextCursor: null } satisfies DecisionsPage);
  if (rest === '/news') return ok(news(url.searchParams.get('ticker')));
  if (rest === '/seasons/fixture/leaderboard') {
    return ok({ season, asOf: null, rows: [] } satisfies Leaderboard);
  }
  if (rest === '/seasons/fixture/equity')
    return ok({ season, dates: [], series: [] } satisfies Equity);
  if (rest === '/seasons/fixture/random-baseline')
    return ok({ season, rows: [] } satisfies RandomBaseline);
  if (rest === `/competitors/${fixtureModel.slug}`) {
    return ok({
      season,
      competitor: fixtureModel,
      stat: null,
      portfolio: null,
      series: { dates: [], equityCents: [] },
      decisions: [],
    } satisfies CompetitorDetail);
  }
  const cycleDate = /^\/cycles\/(\d{4}-\d{2}-\d{2})$/.exec(rest)?.[1];
  if (cycleDate) {
    const view = cycle(cycleDate);
    return view ? ok(view) : notFound();
  }
  // a rota interna de cotações: o segredo certo, ou o 404 da rota que não existe (a api de verdade faz o mesmo)
  const barsOf = /^\/interno\/barras\/([A-Z0-9]+)$/.exec(rest)?.[1];
  if (barsOf !== undefined) {
    if (authorization !== `Bearer ${QUOTES_SECRET}`) return notFound();
    // a RECU3 simula a api que recusa o segredo do site (os dois lados com valores diferentes): 404 mesmo com o segredo certo
    if (barsOf === 'RECU3') return notFound();
    reads.set(barsOf, (reads.get(barsOf) ?? 0) + 1);
    return ok({ bars: BARS[barsOf] ?? [] } satisfies InternalBars);
  }
  const ticker = /^\/stocks\/([A-Z0-9]+)$/.exec(rest)?.[1];
  if (ticker === 'SEMN3' || ticker === 'COTA3' || ticker === 'CACH3' || ticker === 'RECU3') {
    return ok({
      ticker,
      name: 'SEM NOTICIA',
      season,
      holders: [],
      decisions: [],
      news: [],
    } satisfies StockDetail);
  }
  if (ticker === 'LONG3') {
    // a justificativa do modelo e o título da notícia com uma palavra longa, na página da ação
    return ok({
      ticker,
      name: 'TEXTO LONGO',
      season,
      holders: [],
      decisions: [
        {
          date: '2026-11-06',
          competitor: fixtureModel,
          action: 'BUY',
          percent: 10,
          confidence: 0.5,
          rationale: LONG_WORD,
        },
      ],
      news: news('LONG3').rows,
    } satisfies StockDetail);
  }
  if (ticker === 'ERRO3') return fail(500, 'INTERNAL_ERROR', 'falha simulada da api');
  // A api que falha uma vez e volta (o botão "Tentar de novo"). Cada tentativa de cada projeto do Playwright usa um ticker novo,
  // FL + a letra do projeto + a da tentativa + 3 (e2e/fixture.spec.ts): a primeira leitura de cada um falha, e a segunda vai para o
  // cache de dados do site (300 s), então um ticker reaproveitado (`--repeat-each`, uma nova tentativa do CI) já nasceria bom.
  if (ticker && /^FL[A-Z]{2}3$/.test(ticker)) {
    if (!failedOnce.has(ticker)) {
      failedOnce.add(ticker);
      return fail(500, 'INTERNAL_ERROR', 'falha passageira da api');
    }
    return ok({
      ticker,
      name: 'FALHA PASSAGEIRA',
      season,
      holders: [],
      decisions: [],
      news: [],
    } satisfies StockDetail);
  }
  return notFound();
}

createServer((request, response) => {
  void (async () => {
    let reply;
    try {
      reply = await route(
        request.method ?? 'GET',
        new URL(request.url ?? '/', 'http://fixture.invalid'),
        request.headers.authorization,
      );
    } catch {
      reply = fail(500, 'INTERNAL_ERROR', 'falha da api falsa');
    }
    response.writeHead(reply.status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(reply.body);
  })();
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`api falsa do e2e em http://127.0.0.1:${port}\n`);
});
