import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalBar, LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { ApiError } from '../../../../lib/api';

// A arena (app/(app)/(arena)/arena/page.tsx) no que o banco do e2e não produz: as barras do BOVA11 falhando, a arena sem temporada, o filtro
// por modelo com o filtro por ação e o modelo torto na URL. As barras do BOVA11 são o portão do segredo das cotações (o smoke do deploy
// reprova a revisão nova que não lê a rota interna), e a falha delas é a tela de erro, como a de qualquer leitura.
const api = vi.hoisted(() => ({
  arenaCurrent: vi.fn(),
  decisions: vi.fn(),
  leaderboard: vi.fn(),
  equity: vi.fn(),
  randomBaseline: vi.fn(),
  competitor: vi.fn(),
}));
const quotes = vi.hoisted(() => ({ readBars: vi.fn() }));
vi.mock('../../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/api')>()),
  api,
}));
vi.mock('../../../../lib/quotes', () => ({ REFERENCE_TICKER: 'BOVA11', ...quotes }));
// os logos das ações (o índice da rota interna): nenhum, as linhas com ticker levam o monograma
vi.mock('../../../../lib/logos', () => ({
  versoesDosLogos: () => Promise.resolve(new Map<string, string>()),
}));

const { default: Arena } = await import('./page');

const MACRO = { cdi: null, selic: null, ipcaMonth: null, ipca12m: null, usd: null };
const CURRENT = { season: null, lastCycle: null, nextCycle: null, macro: MACRO, top: [] };
const SEASON = {
  id: '01JZ00000000000000000000AA',
  slug: 'temporada-1',
  name: 'Temporada 1',
  status: 'RUNNING',
  startDate: '2026-11-04',
  startedAt: null,
  finishedAt: null,
  settledThrough: '2026-11-04',
  params: { sessions: 20, capitalCents: 10_000_000 },
};
const bar = (date: string, closeCents: number): InternalBar => ({
  date,
  openCents: closeCents,
  highCents: closeCents,
  lowCents: closeCents,
  closeCents,
});
const FAILED = 'Não foi possível carregar os dados';
const NO_RESULT =
  'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.';

const competitor = (over: Partial<PublicCompetitor>): PublicCompetitor => ({
  slug: 'gpt-6-1-sol',
  name: 'GPT-6.1 Sol',
  type: 'MODEL',
  provider: 'fake',
  modelId: 'fake/contrarian',
  ...over,
});
const row = (c: PublicCompetitor, rank: number): LeaderboardRow => ({
  rank,
  competitor: c,
  equityCents: 10_000_000,
  returnBps: 0,
  percentileBps: 5_000,
  excessEqualWeightBps: null,
  excessCdiBps: null,
  maxDrawdownBps: 0,
  winRateBps: null,
  sells: 0,
  winningSells: 0,
  trades: 0,
  llmCostMicroUsd: 0,
});

const render = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(await Arena({ searchParams: Promise.resolve(query) }));

// o log do servidor: a tela de erro escreve nele
const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(quotes)]) fn.mockReset();
  api.arenaCurrent.mockResolvedValue(CURRENT);
  api.decisions.mockResolvedValue({ rows: [], nextCursor: null });
  quotes.readBars.mockResolvedValue([bar('2026-11-03', 6_690), bar('2026-11-04', 6_625)]);
  log.mockClear();
});
afterAll(() => {
  log.mockRestore();
});

describe('a arena', () => {
  it('as barras do BOVA11 que falham (o segredo recusado) derrubam a página: a tela de erro, montada no servidor', async () => {
    quotes.readBars.mockRejectedValue(new ApiError(502, 'QUOTES_REFUSED'));
    const out = await render();
    expect(out).toContain(FAILED);
    expect(out).not.toContain('Cotações e macro');
  });

  it('sem temporada: nada de ranking nem de carteira, e cada região diz o que falta', async () => {
    const out = await render();
    expect(api.leaderboard).not.toHaveBeenCalled();
    expect(api.competitor).not.toHaveBeenCalled();
    expect(out).toContain(NO_RESULT);
    expect(out).toContain('Nenhuma temporada em andamento ou encerrada ainda.');
    expect(out).toContain('As carteiras aparecem depois da primeira liquidação.');
    // sem modelo no ranking, sem o filtro por modelo; o BOVA11 com a variação (66,90 para 66,25)
    expect(out).not.toContain('Filtrar por modelo');
    expect(out).toContain('R$\u00a066,25');
    expect(out).toContain('-0,97%');
  });

  it('o filtro por ação e o por modelo vão juntos para a api e para todo link do feed', async () => {
    api.decisions.mockResolvedValue({ rows: [], nextCursor: 'CURSOR' });
    const out = await render({ filtro: 'BUY', modelo: 'gpt-6-1-sol' });
    expect(api.decisions).toHaveBeenCalledWith({
      action: 'BUY',
      competitor: 'gpt-6-1-sol',
      cursor: undefined,
      limit: 5,
    });
    expect(out).toContain('Nenhuma decisão com este filtro.');
    // "Mais antigas" leva os dois filtros e o cursor; o filtro por ação mantém o modelo
    expect(out).toContain('href="/arena?filtro=BUY&amp;modelo=gpt-6-1-sol&amp;cursor=CURSOR#feed"');
    expect(out).toContain('href="/arena?filtro=SELL&amp;modelo=gpt-6-1-sol#feed"');
    expect(out).toContain('href="/arena?modelo=gpt-6-1-sol#feed"');
  });

  it('o modelo que não tem a forma de um slug é ignorado, como o filtro que não é uma ação', async () => {
    await render({ modelo: 'NÃO É SLUG', filtro: 'hold' });
    expect(api.decisions).toHaveBeenCalledWith({
      action: undefined,
      competitor: undefined,
      cursor: undefined,
      limit: 5,
    });
  });

  it('com temporada e ciclo: as carteiras são só dos modelos, lidas na temporada da arena, e o filtro lista os modelos', async () => {
    api.arenaCurrent.mockResolvedValue({
      ...CURRENT,
      season: SEASON,
      lastCycle: { date: '2026-11-04', status: 'CLOSED', counts: { BUY: 1, SELL: 0, HOLD: 1 } },
    });
    const model = competitor({});
    const draw = competitor({
      slug: 'sorteio',
      name: 'Sorteio',
      type: 'RANDOM',
      provider: null,
      modelId: null,
    });
    const cdi = competitor({
      slug: 'cdi',
      name: 'CDI',
      type: 'CDI',
      provider: null,
      modelId: null,
    });
    api.leaderboard.mockResolvedValue({
      season: SEASON,
      asOf: '2026-11-04',
      rows: [row(model, 1), row(cdi, 2), row(draw, 3)],
    });
    api.equity.mockResolvedValue({ season: SEASON, dates: [], series: [] });
    api.randomBaseline.mockResolvedValue({ season: SEASON, rows: [] });
    api.competitor.mockResolvedValue({
      season: SEASON,
      competitor: model,
      stat: null,
      portfolio: {
        date: '2026-11-04',
        equityCents: 10_050_000,
        holdings: { cashCents: 10_050_000, positionsValueCents: 0, positions: [] },
      },
      series: { dates: [], equityCents: [] },
      decisions: [],
    });
    const out = await render();
    expect(api.competitor).toHaveBeenCalledTimes(1);
    expect(api.competitor).toHaveBeenCalledWith('gpt-6-1-sol', 'temporada-1');
    expect(out).toContain('data-carteira="gpt-6-1-sol"');
    expect(out).not.toContain('data-carteira="sorteio"');
    // o resultado da temporada: o patrimônio menos o capital
    expect(out).toContain('+R$\u00a0500,00');
    expect(out).toContain('Filtrar por modelo');
    expect(out).toContain('href="/arena?modelo=gpt-6-1-sol#feed"');
    // a faixa leva os modelos e o Sorteio, e as referências não
    expect(out).toContain('href="/modelos/sorteio"');
    expect(out).not.toContain('href="/modelos/cdi"');
  });

  // A barra das carteiras é uma leitura por modelo (seis): uma que falha (5xx, prazo) não pode derrubar a página inteira, com o ranking, o
  // gráfico e o feed que chegaram. A carteira daquele modelo diz que está indisponível, e a falha vai para o log.
  it('uma carteira que falha não derruba a arena: ela diz que está indisponível, e o resto da página fica', async () => {
    api.arenaCurrent.mockResolvedValue({
      ...CURRENT,
      season: SEASON,
      lastCycle: { date: '2026-11-04', status: 'CLOSED', counts: { BUY: 1, SELL: 0, HOLD: 1 } },
    });
    const gpt = competitor({});
    const claude = competitor({
      slug: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      modelId: 'fake/momentum',
    });
    api.leaderboard.mockResolvedValue({
      season: SEASON,
      asOf: '2026-11-04',
      rows: [row(gpt, 1), row(claude, 2)],
    });
    api.equity.mockResolvedValue({ season: SEASON, dates: [], series: [] });
    api.randomBaseline.mockResolvedValue({ season: SEASON, rows: [] });
    api.competitor.mockImplementation((slug: string) => {
      if (slug === 'gpt-6-1-sol') return Promise.reject(new ApiError(503, 'UNAVAILABLE'));
      return Promise.resolve({
        season: SEASON,
        competitor: claude,
        stat: null,
        portfolio: {
          date: '2026-11-04',
          equityCents: 10_050_000,
          holdings: { cashCents: 10_050_000, positionsValueCents: 0, positions: [] },
        },
        series: { dates: [], equityCents: [] },
        decisions: [],
      });
    });
    const out = await render();
    expect(out).not.toContain(FAILED);
    // o ranking (a faixa) e a carteira que chegou ficam; a que falhou diz que está indisponível
    expect(out).toContain('href="/modelos/claude-opus-5-5"');
    expect(out).toContain('data-carteira="claude-opus-5-5"');
    expect(out).toMatch(/data-carteira="gpt-6-1-sol".*Carteira indisponível agora\./s);
    expect(log).toHaveBeenCalledWith('[web] carteira sem gpt-6-1-sol:', expect.any(ApiError));
  });
});
