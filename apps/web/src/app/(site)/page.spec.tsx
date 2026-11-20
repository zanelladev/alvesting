import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedDecision, InternalBar } from '@alvesting/contracts';
import type { MetodoProps } from '../../components/landing/paineis';
import { ApiError } from '../../lib/api';

// A landing (app/(site)/page.tsx) no que o banco do e2e não produz: só uma das leituras falhando, a arena sem temporada e a temporada antes da
// primeira liquidação. A fita é enfeite: a falha da rota dela (a migration do papel da api que faltou, um 5xx, o prazo) não derruba a página,
// que mostra a fita do BOVA11 e do macro e deixa o erro no log do servidor. As barras do BOVA11, não: elas são o portão do segredo das cotações
// (o smoke do deploy reprova a revisão nova que não lê a rota interna), e a falha delas é a tela de erro, como a de qualquer leitura.
const api = vi.hoisted(() => ({
  arenaCurrent: vi.fn(),
  decisions: vi.fn(),
  leaderboard: vi.fn(),
  equity: vi.fn(),
  randomBaseline: vi.fn(),
}));
const quotes = vi.hoisted(() => ({ readBars: vi.fn(), readTape: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api,
}));
vi.mock('../../lib/quotes', () => ({ REFERENCE_TICKER: 'BOVA11', ...quotes }));

const { default: Landing } = await import('./page');
const { CITACAO_MAX, Citacao, Metodo, trechoCitacao } =
  await import('../../components/landing/paineis');

const MACRO = { cdi: null, selic: null, ipcaMonth: null, ipca12m: null, usd: null };
const CURRENT = { season: null, lastCycle: null, nextCycle: null, macro: MACRO, top: [] };
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
const NO_RESULT =
  'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.';
const SIMULATED_NOTICE =
  'Nesta temporada as decisões são simuladas: o resultado não diz nada sobre os modelos de verdade.';

const decision = (slug: string, name: string): FeedDecision => ({
  date: '2026-11-04',
  mode: 'AO_VIVO',
  executedAt: '2026-11-04T11:00:00.000Z',
  competitor: { slug, name, type: 'MODEL', provider: 'fake', modelId: 'fake/momentum' },
  status: 'DECIDED',
  holdReason: null,
  marketView: 'neutro',
  summary: `Resumo de ${name}`,
  items: [],
  dropped: [],
});

// a landing não lê parâmetro nenhum (o Next passa as props de toda página)
const render = async () => renderToStaticMarkup(await Landing({}));

// o log do servidor: a landing sem a fita e a tela de erro escrevem nele
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

describe('a landing', () => {
  it('a rota da fita que falha não derruba a página: o hero fica, com a fita do BOVA11 e do macro, e o erro vai para o log', async () => {
    const error = new ApiError(500, 'INTERNAL');
    quotes.readTape.mockRejectedValue(error);
    const out = await render();
    expect(out).not.toContain(FAILED);
    expect(out).toContain('Modelos de linguagem <span class="tom2">investindo na B3</span></h1>');
    expect(out).toContain(
      'O mesmo briefing para todos os modelos: o BOVA11 e o macro do Banco Central. Cotações: brapi.dev, pregão de 04/11/2026.',
    );
    expect(log).toHaveBeenCalledWith('[web] landing sem a fita:', error);
  });

  it('as barras do BOVA11 que falham (o segredo recusado) seguem derrubando a página: a tela de erro, montada no servidor', async () => {
    quotes.readBars.mockRejectedValue(new ApiError(502, 'QUOTES_REFUSED'));
    const out = await render();
    expect(out).toContain(FAILED);
    expect(out).not.toContain('Modelos de linguagem investindo na B3');
  });

  it('sem temporada: nada de ranking, o placar diz o que falta, e o elenco traz o nome dos laboratórios', async () => {
    const out = await render();
    expect(api.leaderboard).not.toHaveBeenCalled();
    // as leituras da landing (d.10): uma página de decisões; o ranking, o patrimônio e as carteiras sorteadas só com ciclo
    expect(api.equity).not.toHaveBeenCalled();
    expect(api.randomBaseline).not.toHaveBeenCalled();
    expect(api.decisions).toHaveBeenCalledWith({ limit: 6 });
    expect(out).toContain(NO_RESULT);
    // sem decisão, a citação não aparece
    expect(out).not.toContain('<blockquote>');
    for (const lab of ['OpenAI', 'Anthropic', 'Google', 'xAI', 'DeepSeek', 'Alibaba Cloud']) {
      expect(out).toContain(`text-ink">${lab}</span>`);
    }
    expect(out).not.toContain('simulado');
    expect(out).not.toContain(SIMULATED_NOTICE);
    expect(out).not.toContain('class="pill');
  });

  it('antes da primeira liquidação: o elenco vem das decisões do último ciclo, com a etiqueta e o aviso da arena simulada', async () => {
    api.arenaCurrent.mockResolvedValue({
      ...CURRENT,
      season: {
        id: '01JZ00000000000000000000AA',
        slug: 'temporada-1',
        name: 'Temporada 1',
        status: 'RUNNING',
        startDate: '2026-11-04',
        startedAt: null,
        finishedAt: null,
        settledThrough: null,
        params: {
          sessions: 20,
          capitalCents: 10_000_000,
          monteCarloRuns: 1000,
          tradeCostBps: 3,
          decisionTimeBrt: '08:00',
          deadlineTimeBrt: '09:30',
        },
      },
      lastCycle: {
        date: '2026-11-04',
        counts: { BUY: 3, SELL: 0, HOLD: 3 },
        prompt: { version: 'v1', sha256: 'a'.repeat(64) },
      },
    });
    api.decisions.mockResolvedValue({
      rows: [
        decision('claude-opus-5-5', 'Claude Opus 5.5'),
        decision('gpt-6-1-sol', 'GPT-6.1 Sol'),
      ],
      nextCursor: null,
    });
    api.leaderboard.mockResolvedValue({ season: null, asOf: null, rows: [] });
    api.equity.mockResolvedValue({ season: null, dates: [], series: [] });
    api.randomBaseline.mockResolvedValue({ season: null, rows: [] });
    const out = await render();
    expect(api.leaderboard).toHaveBeenCalledWith('temporada-1');
    expect(api.equity).toHaveBeenCalledWith('temporada-1');
    expect(api.randomBaseline).toHaveBeenCalledWith('temporada-1');
    expect(out).toContain('Temporada em andamento · último pregão em 04/11');
    // os dois modelos do elenco nas células deles (o laboratório pelo slug), com o nome do modelo e o do laboratório embaixo, e os outros
    // quatro só com o nome do laboratório; o "simulado" vai uma vez, no cabeçalho do elenco (docs/DESIGN.md: uma vez por contexto), e não em
    // cada célula
    expect(out).toMatch(
      /data-lab="anthropic"[^>]*><\/span><span [^>]*><span [^>]*>Claude Opus 5\.5<\/span><span class="text-muted">Anthropic<\/span>/,
    );
    expect(out).toMatch(
      /data-lab="openai"[^>]*><\/span><span [^>]*><span [^>]*>GPT-6\.1 Sol<\/span><span class="text-muted">OpenAI<\/span>/,
    );
    expect(out).toContain('text-ink">Google</span>');
    const strip = out.slice(out.indexOf('id="laboratorios-titulo"'));
    const header = strip.slice(0, strip.indexOf('<ul'));
    expect(header.match(/>simulado</g)).toHaveLength(1);
    expect(strip.slice(0, strip.indexOf('</ul>')).match(/>simulado</g)).toHaveLength(1);
    expect(out).toContain(SIMULATED_NOTICE);
    // a cena do briefing leva a data do último ciclo, a do prompt a versão dele; a citação, a decisão mais nova
    expect(out).toContain('Briefing de 04/11/2026');
    expect(out).toContain('versão v1');
    expect(out).toContain('Resumo de Claude Opus 5.5');
    expect(out).not.toContain('Resumo de GPT-6.1 Sol');
    // sem ranking ainda: o placar diz que o resultado sai depois da primeira liquidação
    expect(out).toContain(NO_RESULT);
  });
});

// A citação mostra um trecho da justificativa, como no desenho (o pedido do Artur em 20/11/2026: a inteira, de até 540 caracteres, ficava
// grande demais): a primeira frase, "[…]" e a última, até CITACAO_MAX caracteres, e a decisão nunca sai.
describe('a citação: o trecho da justificativa', () => {
  it('a primeira frase, "[…]" e a última; com duas frases, as duas; com uma, ela', () => {
    expect(trechoCitacao('Dia de cautela. O Ibovespa caiu 1,2%. Vendo BBSE3.')).toEqual({
      contexto: 'Dia de cautela.',
      corte: true,
      decisao: 'Vendo BBSE3.',
    });
    expect(trechoCitacao('Dia de cautela. Vendo BBSE3.')).toEqual({
      contexto: 'Dia de cautela.',
      corte: false,
      decisao: 'Vendo BBSE3.',
    });
    expect(trechoCitacao('Sem convicção: segura o caixa (provedor fake).')).toEqual({
      contexto: null,
      corte: false,
      decisao: 'Sem convicção: segura o caixa (provedor fake).',
    });
  });

  it('o contexto sai antes da decisão, e a decisão maior que o teto termina na última palavra que cabe', () => {
    // 190 + 146 caracteres: as duas não cabem juntas, e fica a decisão, com o "[…]" no lugar do contexto
    const contexto = `Pregão de ${'queda '.repeat(30).trim()}.`;
    const decisao = `Vendo ${'metade '.repeat(20).trim()}.`;
    expect(trechoCitacao(`${contexto} ${decisao}`)).toEqual({
      contexto: null,
      corte: true,
      decisao,
    });
    // a decisão de 486 caracteres sozinha passa do teto
    const longa = trechoCitacao(`Dia de cautela. Vendo ${'palavra '.repeat(60).trim()}.`);
    expect(longa.contexto).toBeNull();
    expect(longa.decisao.length).toBeLessThanOrEqual(CITACAO_MAX);
    expect(longa.decisao).toMatch(/ palavra…$/);
  });

  it('na página: o contexto e o "[…]" no apoio, a decisão no <strong>, na tinta', () => {
    const out = renderToStaticMarkup(
      Citacao({
        decision: {
          ...decision('qwen3-8-max', 'Qwen3.8 Max'),
          summary: 'Dia de cautela. O Ibovespa caiu 1,2%. Vendo BBSE3.',
        },
      }),
    );
    expect(out).toMatch(
      /<blockquote>Dia de cautela\. (<!-- -->)?\[…\] (<!-- -->)?<strong>Vendo BBSE3\.<\/strong><\/blockquote>/,
    );
  });
});

// A régua do Monte Carlo no eixo do retorno, como no desenho: a mediana no meio, e a escala até 1,2 vez o ponto mais longe dela.
describe('a régua do Monte Carlo', () => {
  const competidor = (slug: string, type: 'MODEL' | 'RANDOM') => ({
    slug,
    name: slug,
    type,
    provider: 'fake' as const,
    modelId: 'fake/momentum',
  });
  const metodo = (ranked: MetodoProps['ranked']) =>
    renderToStaticMarkup(
      Metodo({
        season: null,
        lastCycle: null,
        decision: null,
        cast: [],
        ranked,
        sorteadas: {
          date: '2026-11-13',
          returnBps: { p5: -3000, p25: -2300, p50: -1900, p75: -1500, p95: -900 },
        },
        referencias: [],
        faixa: null,
        ate: null,
        universo: 0,
      }),
    );
  const naRegua = (x: string) => `left:calc(1.25rem + (100% - 2.5rem) * ${x} / 100)`;

  it('as faixas p5 a p95 e p25 a p75, a mediana no meio, um logo no retorno de cada um, e quem se encontra sobe uma fila', () => {
    const out = metodo([
      { competitor: competidor('a', 'MODEL'), returnBps: -800 },
      { competitor: competidor('c', 'MODEL'), returnBps: -850 },
      { competitor: competidor('sorteio', 'RANDOM'), returnBps: -2100 },
    ]);
    // o ponto mais longe da mediana (-19%) fica a 11 pontos (o p5 e o modelo a): a régua vai a 13,2 pontos de cada lado dela
    expect(out).toContain(`${naRegua('8.3')};width:calc((100% - 2.5rem) * 79.5 / 100)`);
    expect(out).toContain(`${naRegua('34.8')};width:calc((100% - 2.5rem) * 30.3 / 100)`);
    expect(out).toContain(naRegua('50.0'));
    // o modelo c fica a 1,9% da régua do a: sobe uma fila (24 px)
    expect(out).toContain(`${naRegua('91.7')};bottom:8.75rem`);
    expect(out).toContain(`${naRegua('89.8')};bottom:10.25rem`);
    expect(out).toContain(`${naRegua('42.4')};bottom:8.75rem`);
    for (const rotulo of [
      'p5 -30,00%',
      'mediana -19,00%',
      'p95 -9,00%',
      'Retorno das mil carteiras sorteadas no pregão de 13/11/2026',
      'Mil carteiras sorteadas com as mesmas regras formam a régua',
    ]) {
      expect(out).toContain(rotulo);
    }
  });
});
