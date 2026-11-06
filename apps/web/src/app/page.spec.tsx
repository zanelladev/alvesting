import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaCurrent, InternalBar } from '@alvesting/contracts';
import { ApiError } from '../lib/api';

// A home (app/page.tsx) quando só uma das leituras falha. A fita do hero é enfeite: a falha da rota dela (a migration do papel da api que
// faltou, um 5xx, o prazo) não derruba a página, que mostra a fita do BOVA11 e do macro e deixa o erro no log do servidor. As barras do
// BOVA11, não: elas são o portão do segredo das cotações (o smoke do deploy reprova a revisão nova que não lê a rota interna), e a falha
// delas é a tela de erro, como a de qualquer leitura. Os e2e conferem a home de verdade; aqui entra o que o banco do e2e não produz.
const api = vi.hoisted(() => ({
  arenaCurrent: vi.fn(),
  decisions: vi.fn(),
  leaderboard: vi.fn(),
  equity: vi.fn(),
  randomBaseline: vi.fn(),
}));
const quotes = vi.hoisted(() => ({ readBars: vi.fn(), readTape: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api,
}));
vi.mock('../lib/quotes', () => ({ REFERENCE_TICKER: 'BOVA11', ...quotes }));

const { default: Home } = await import('./page');

const CURRENT = {
  season: null,
  lastCycle: null,
  nextCycle: null,
  macro: { cdi: null, selic: null, ipcaMonth: null, ipca12m: null, usd: null },
} as unknown as ArenaCurrent;
const bar = (date: string, closeCents: number): InternalBar => ({
  date,
  openCents: closeCents,
  highCents: closeCents,
  lowCents: closeCents,
  closeCents,
});
// o BOVA11 caiu: 66,90 para 66,25 (-0,97%)
const BARS = [bar('2026-11-03', 6_690), bar('2026-11-04', 6_625)];
const FAILED = 'Não foi possível carregar os dados';

const render = async () => renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));

// o log do servidor: a home sem a fita e a tela de erro escrevem nele
const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(quotes)]) fn.mockReset();
  api.arenaCurrent.mockResolvedValue(CURRENT);
  api.decisions.mockResolvedValue({ rows: [], nextCursor: null });
  quotes.readBars.mockResolvedValue(BARS);
  quotes.readTape.mockResolvedValue({ date: null, rows: [] });
  log.mockClear();
});
afterAll(() => {
  log.mockRestore();
});

describe('a home', () => {
  it('a rota da fita que falha não derruba a página: o hero fica, com a fita do BOVA11 e do macro, e o erro vai para o log', async () => {
    const error = new ApiError(500, 'INTERNAL');
    quotes.readTape.mockRejectedValue(error);
    const out = await render();
    expect(out).not.toContain(FAILED);
    expect(out).toContain('Modelos de linguagem investindo na B3</h1>');
    expect(out).toContain(
      'O mesmo briefing para todos os modelos: o BOVA11 e o macro do Banco Central. Cotações: brapi.dev, pregão de 04/11/2026.',
    );
    expect(out).toContain('id="cotacoes"');
    expect(log).toHaveBeenCalledWith('[web] home sem a fita:', error);
  });

  it('as barras do BOVA11 que falham (o segredo recusado) seguem derrubando a página: a tela de erro, montada no servidor', async () => {
    quotes.readBars.mockRejectedValue(new ApiError(502, 'QUOTES_REFUSED'));
    const out = await render();
    expect(out).toContain(FAILED);
    expect(out).not.toContain('Modelos de linguagem investindo na B3');
  });

  // O glifo ▲ ▼ ■ vem do CSS (`[data-dir]::before`, com o texto alternativo vazio), como nas tabelas: o texto não muda
  it('a variação do BOVA11 na faixa de cotações leva a direção para o glifo, fora do texto', async () => {
    const out = await render();
    expect(out).toContain('R$ 66,25 (<span data-dir="down">-0,97%</span>)');
  });
});
