import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LeaderboardRow, NewsItem } from '@alvesting/contracts';
import { ApiDown } from './api-down';
import { CandlesChart, EquityChart } from './charts';
import { Countdown } from './countdown';
import { DecisionCard, type DecisionCardData } from './decisions';
import { NewsList } from './news-list';
import { LeaderboardTable, PositionsTable } from './tables';
import { SearchForm, isSimulated } from './ui';

// A página "Como funciona" lê a api para os números da temporada: o teste dela troca o cliente de dados por um que falha.
vi.mock('../lib/api', () => ({ api: { arenaCurrent: vi.fn() } }));

// As peças das telas, renderizadas no servidor (o mesmo que o Next faz) e lidas como texto: o que vira HTML e o que vira texto, o que
// o leitor de tela recebe e o que nunca aparece. Os e2e conferem o mesmo no navegador, sobre o banco sintético; aqui entram as entradas
// que o banco sintético não tem (texto hostil, valor nulo, lista vazia).
const html = renderToStaticMarkup;

const news = (over: Partial<NewsItem> = {}): NewsItem => ({
  title: 'Ibovespa sobe',
  source: 'agencia-brasil',
  sourceName: 'Agência Brasil',
  publishedAt: '2026-11-09T12:00:00.000Z',
  tickers: ['PETR4'],
  url: 'https://exemplo.invalid/a',
  ...over,
});

describe('NewsList', () => {
  it('título e fonte são texto: o HTML do terceiro vira texto escapado, nunca elemento', () => {
    const out = html(
      <NewsList
        rows={[news({ title: '<img src=x onerror=alert(1)> "a" & b', sourceName: '<b>Fonte</b>' })]}
      />,
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;a&quot; &amp; b');
    expect(out).toContain('&lt;b&gt;Fonte&lt;/b&gt;');
  });

  it('o link externo abre noutra aba sem entregar a janela de origem e sem passar reputação', () => {
    const out = html(<NewsList rows={[news()]} />);
    expect(out).toMatch(
      /<a href="https:\/\/exemplo\.invalid\/a" target="_blank" rel="noopener noreferrer nofollow"/,
    );
    // quem lê com leitor de tela é avisado de que abre noutra aba
    expect(out).toContain('(abre em outra aba)');
  });

  it('mostra a hora de Brasília e os tickers como links para a ação; sem ticker, sem a linha', () => {
    const out = html(
      <NewsList rows={[news(), news({ url: 'https://exemplo.invalid/b', tickers: [] })]} />,
    );
    expect(out).toContain('09/11/2026 09:00');
    expect(out).toContain('href="/acoes/PETR4"');
    expect(out.match(/href="\/acoes\//g)).toHaveLength(1);
  });

  it('o documento da CVM chega só com o dia: a tela não inventa a hora 00:00', () => {
    const out = html(
      <NewsList
        rows={[
          news({
            source: 'cvm-ipe',
            sourceName: 'CVM',
            // meia-noite de Brasília: o que a api guarda para o documento sem hora
            publishedAt: '2026-11-04T03:00:00.000Z',
          }),
        ]}
      />,
    );
    expect(out).toContain('CVM ·');
    expect(out).toContain('>04/11/2026</time>');
    expect(out).not.toContain('04/11/2026 00:00');
  });

  it('o título sem espaço quebra: o link pode encolher abaixo da palavra mais longa', () => {
    const out = html(<NewsList rows={[news({ title: 'W'.repeat(100) })]} />);
    expect(out).toContain('max-w-full');
    expect(out).toContain('[overflow-wrap:anywhere]');
  });

  it('o trecho (snippet) não existe nesta tela: uma linha com campo a mais não o repete', () => {
    const row = { ...news(), snippet: 'TEXTO DO TRECHO' } as NewsItem;
    expect(html(<NewsList rows={[row]} />)).not.toContain('TEXTO DO TRECHO');
  });

  it('lista vazia é uma lista vazia, sem erro', () => {
    expect(html(<NewsList rows={[]} />)).toBe('<ul aria-label="Notícias" class="max-w-2xl"></ul>');
  });
});

const decision = (over: Partial<DecisionCardData> = {}): DecisionCardData => ({
  competitor: { slug: 'gemini-4-argon', name: 'Gemini 4 Argon' },
  status: 'DECIDED',
  holdReason: null,
  marketView: 'neutro',
  summary: 'Resumo.',
  items: [],
  dropped: [],
  ...over,
});

describe('DecisionCard', () => {
  it('o texto do modelo (resumo e justificativa) é texto, e não vira link nem HTML', () => {
    const out = html(
      <DecisionCard
        by="model"
        date="2026-11-09"
        decision={decision({
          summary: '<script>alert(1)</script> veja https://evil.invalid',
          items: [
            {
              position: 0,
              action: 'BUY',
              ticker: 'WEGE3',
              percent: 12.5,
              confidence: 0.7,
              rationale: '<a href="https://evil.invalid">clique</a>',
            },
          ],
        })}
      />,
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('href="https://evil.invalid"');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt; veja https://evil.invalid');
    expect(out).toContain('12,5% do patrimônio');
    expect(out).toContain('confiança 0,70');
  });

  it('SELL é percentual da posição e HOLD não tem percentual nem confiança', () => {
    const out = html(
      <DecisionCard
        by="model"
        decision={decision({
          items: [
            {
              position: 0,
              action: 'SELL',
              ticker: 'VALE3',
              percent: 100,
              confidence: 0.6,
              rationale: 'a',
            },
            {
              position: 1,
              action: 'HOLD',
              ticker: 'ITUB4',
              percent: null,
              confidence: null,
              rationale: 'b',
            },
          ],
        })}
      />,
    );
    expect(out).toContain('100% da posição');
    expect(out.match(/confiança/g)).toHaveLength(1);
    expect(out).toContain('data-action="SELL"');
    expect(out).toContain('data-action="HOLD"');
  });

  it('HOLD forçado e item descartado dizem o motivo, e só a posição e o motivo (o conteúdo nunca)', () => {
    const out = html(
      <DecisionCard
        by="model"
        decision={decision({
          status: 'FORCED_HOLD',
          holdReason: 'resposta_invalida',
          summary: null,
          marketView: null,
          dropped: [
            { position: 0, reason: 'invalid_item' },
            { position: 4, reason: 'max_positions' },
          ],
        })}
      />,
    );
    expect(out).toContain('HOLD forçado: resposta inválida');
    expect(out).toContain('Item 1: item fora do formato');
    expect(out).toContain('Item 5: acima do limite de posições');
    expect(out).not.toContain('data-action');
  });

  it('a justificativa sem espaço pode encolher: o item flex leva min-w-0 (senão alarga a página em 360 px)', () => {
    const out = html(
      <DecisionCard
        by="model"
        decision={decision({
          items: [
            {
              position: 0,
              action: 'BUY',
              ticker: 'WEGE3',
              percent: 10,
              confidence: 0.5,
              rationale: 'W'.repeat(100),
            },
          ],
        })}
      />,
    );
    expect(out).toMatch(/<p class="min-w-0 basis-full text-sm[^"]*">W{100}<\/p>/);
  });

  // "neutro" é o valor do contrato (o que o modelo responde); a frase concorda com "visão": "visão neutra" (otimista e pessimista servem
  // aos dois gêneros)
  it('a visão de mercado concorda com "visão": neutra, otimista, pessimista; sem visão, sem a frase', () => {
    const view = (marketView: DecisionCardData['marketView']) =>
      /<span>(visão [^<]*)<\/span>/.exec(
        html(<DecisionCard by="model" decision={decision({ marketView })} />),
      )?.[1];
    expect(view('neutro')).toBe('visão neutra');
    expect(view('otimista')).toBe('visão otimista');
    expect(view('pessimista')).toBe('visão pessimista');
    expect(view(null)).toBeUndefined();
  });

  it('na página do modelo o título é a data, link para o ciclo; no feed é o modelo', () => {
    const byDate = html(<DecisionCard by="date" date="2026-11-09" decision={decision()} />);
    expect(byDate).toMatch(
      /<h3 class="[^"]*"><a class="link[^"]*" href="\/ciclos\/2026-11-09">09\/11\/2026<\/a><\/h3>/,
    );
    // na página do modelo não há logo nem retorno no cabeçalho: a página já os mostra
    expect(byDate).not.toContain('class="logo');
    const byModel = html(<DecisionCard by="model" date="2026-11-09" decision={decision()} />);
    expect(byModel).toContain('href="/modelos/gemini-4-argon"');
  });

  it('a decisão simulada leva a etiqueta logo depois do nome do modelo; na página do modelo (título é a data) não', () => {
    const simulated = html(<DecisionCard by="model" decision={decision()} simulated />);
    expect(simulated).toMatch(
      /<h3[^>]*><a class="link[^"]*" href="\/modelos\/gemini-4-argon">Gemini 4 Argon<\/a> <span class="[^"]*border-dashed[^"]*">simulado<\/span><\/h3>/,
    );
    expect(html(<DecisionCard by="model" decision={decision()} />)).not.toContain('simulado');
    expect(
      html(<DecisionCard by="date" date="2026-11-09" decision={decision()} simulated />),
    ).not.toContain('simulado');
  });
});

describe('DecisionCard no feed da arena', () => {
  // O item do feed do Rallies (plano do redesenho, e.5): o logo do laboratório e o retorno do modelo no cabeçalho. O contrato de DOM que os
  // e2e leem fica: o h3 com o link, um p só no cabeçalho, o resumo como o único p direto do item.
  it('o cabeçalho tem o logo do laboratório (pelo slug, quando o dado não traz o tipo) e o retorno do modelo, fora do h3 e do p', () => {
    const out = html(
      <DecisionCard by="model" date="2026-11-09" decision={decision()} returnBps={-120} />,
    );
    expect(out).toMatch(/<span aria-hidden="true" data-lab="google" class="logo size-10"><\/span>/);
    expect(out).toMatch(/<\/h3><span data-dir="down"[^>]*>-1,20%<\/span><p/);
    expect(out.match(/<header[\s\S]*<\/header>/)![0].match(/<p/g)).toHaveLength(1);
  });

  it('sem o retorno (a landing não o passa), sem a frase; com o competidor do feed, o laboratório sai do modelo', () => {
    const out = html(
      <DecisionCard
        by="model"
        decision={decision({
          competitor: {
            slug: 'modelo-x',
            name: 'Modelo X',
            type: 'MODEL',
            provider: 'openrouter',
            modelId: 'anthropic/claude-opus-5.5',
          },
        })}
      />,
    );
    expect(out).not.toContain('data-dir');
    expect(out).toContain('data-lab="anthropic"');
  });

  it('o resumo é o único parágrafo direto do item, e os descartados ficam recuados, fora dele', () => {
    const out = html(
      <DecisionCard
        by="model"
        decision={decision({ dropped: [{ position: 1, reason: 'not_in_universe' }] })}
      />,
    );
    const direct = out
      .replace(/<header[\s\S]*<\/header>/, '')
      .match(/<article[^>]*>(?:<p[^>]*>[^<]*<\/p>)?/g);
    expect(direct![0]).toContain('Resumo.');
    expect(out).toContain('aria-label="Itens descartados"');
    expect(out).toContain('Item 2: ação fora do universo');
  });
});

const row = (over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  rank: 1,
  competitor: { slug: 'cdi', name: 'CDI', type: 'CDI', provider: null, modelId: null },
  equityCents: 10_020_198,
  returnBps: 20,
  percentileBps: null,
  excessEqualWeightBps: null,
  excessCdiBps: null,
  maxDrawdownBps: 0,
  winRateBps: null,
  sells: 0,
  winningSells: 0,
  trades: 0,
  llmCostMicroUsd: 0,
  ...over,
});

describe('tabelas', () => {
  it('valor que não existe (percentil antes do Monte Carlo, acerto sem venda) é um traço, não zero', () => {
    const out = html(<LeaderboardTable rows={[row()]} label="Ranking" />);
    expect(out.match(/—/g)).toHaveLength(4);
    expect(out).toContain('R$\u00a0100.201,98');
    expect(out).toContain('+0,20%');
  });

  it('a versão compacta é a mesma tabela só com posição, nome, retorno e percentil', () => {
    const out = html(
      <LeaderboardTable rows={[row({ percentileBps: 7_200 })]} label="Ranking" compact />,
    );
    expect(out.match(/<th scope="col"/g)).toHaveLength(4);
    expect(out).toContain('72,0');
    expect(out).not.toContain('Patrimônio');
  });

  // o logo do laboratório (ou a inicial, aqui a do CDI) vem antes do nome, decorativo e sem texto (competidor.tsx)
  it('o nome do competidor é o cabeçalho da linha e é link para a página dele', () => {
    const out = html(<LeaderboardTable rows={[row()]} label="Ranking" />);
    expect(out).toMatch(
      /<th scope="row"[^>]*><span aria-hidden="true" data-inicial="C" class="logo[^"]*"><\/span><a class="[^"]*" href="\/modelos\/cdi">CDI<\/a><\/th>/,
    );
  });

  it('o modelo do provedor fake leva a etiqueta "simulado" no cabeçalho da linha, fora do link; o resto não', () => {
    const out = html(
      <LeaderboardTable
        rows={[
          row({
            competitor: {
              slug: 'claude-opus-5-5',
              name: 'Claude Opus 5.5',
              type: 'MODEL',
              provider: 'fake',
              modelId: 'fake/momentum',
            },
          }),
          row(),
        ]}
        label="Ranking"
      />,
    );
    expect(out).toMatch(
      /<th scope="row"[^>]*><span aria-hidden="true" data-lab="anthropic" class="logo[^"]*"><\/span><a class="[^"]*" href="\/modelos\/claude-opus-5-5">Claude Opus 5.5<\/a> <span class="[^"]*">simulado<\/span><\/th>/,
    );
    expect(out.match(/simulado/g)).toHaveLength(1);
  });

  it('quem tem a ação e é modelo simulado leva a etiqueta; a ação na carteira do modelo, não', () => {
    const position = {
      key: 'A',
      href: '/modelos/gpt-6-1-sol',
      quantity: 10,
      avgPriceCents: 1_000,
      valueCents: 10_000,
      pnlCents: 0,
      stale: false,
    };
    const holders = html(
      <PositionsTable
        first="Competidor"
        label="Quem tem"
        rows={[{ ...position, label: 'GPT-6.1 Sol', simulated: true }]}
      />,
    );
    expect(holders).toContain('GPT-6.1 Sol</a> <span');
    expect(holders).toContain('>simulado</span></th>');
    const wallet = html(
      <PositionsTable first="Ação" label="Posições" rows={[{ ...position, label: 'MOVE3' }]} />,
    );
    expect(wallet).not.toContain('simulado');
  });

  it('a posição sem negócio no dia leva o aviso, e o resultado leva o sinal', () => {
    const out = html(
      <PositionsTable
        first="Ação"
        label="Posições"
        rows={[
          {
            key: 'A',
            label: 'PAUS3',
            href: '/acoes/PAUS3',
            quantity: 1_234,
            avgPriceCents: 8_058,
            valueCents: 1_043_956,
            pnlCents: -4_000,
            stale: true,
          },
        ]}
      />,
    );
    expect(out).toContain('sem negócio no dia');
    expect(out).toContain('-R$\u00a040,00');
    expect(out).toContain('1.234');
  });

  // O glifo ▲ ▼ ■ é do CSS (globals.css, `[data-dir]`), com o texto alternativo vazio: no HTML só vai a direção, e o texto da célula (o que o
  // leitor de tela e o e2e leem) continua sendo o número com o sinal.
  it('o número com sinal leva a direção para o glifo, fora do texto; o que não existe ("—") e o que não tem sinal não levam', () => {
    const board = html(
      <LeaderboardTable
        rows={[
          row({ returnBps: 20, excessEqualWeightBps: -15, excessCdiBps: 0 }),
          row({
            competitor: {
              slug: 'sorteio',
              name: 'Sorteio',
              type: 'RANDOM',
              provider: null,
              modelId: null,
            },
            returnBps: -30,
          }),
        ]}
        label="Ranking"
      />,
    );
    expect(board).toContain('<td class="td" data-dir="up">+0,20%</td>');
    expect(board).toContain('<td class="td" data-dir="down">-0,15%</td>');
    expect(board).toContain('<td class="td" data-dir="flat">0,00%</td>');
    expect(board).toContain('<td class="td" data-dir="down">-0,30%</td>');
    // o excesso que não existe, o percentil, o drawdown (sem sinal) e o acerto ficam sem direção: só as colunas com sinal
    expect(board.match(/data-dir=/g)).toHaveLength(4);
    expect(board).not.toMatch(/[▲▼■]/);

    const positions = html(
      <PositionsTable
        first="Ação"
        label="Posições"
        rows={[-4_000, 0].map((pnlCents, i) => ({
          key: String(i),
          label: `PAUS${i + 3}`,
          href: `/acoes/PAUS${i + 3}`,
          quantity: 1,
          avgPriceCents: 1_000,
          valueCents: 1_000,
          pnlCents,
          stale: false,
        }))}
      />,
    );
    expect(positions).toContain('<td class="td" data-dir="down">-R$ 40,00</td>');
    expect(positions).toContain('<td class="td" data-dir="flat">R$ 0,00</td>');
  });
});

describe('isSimulated', () => {
  it('só o modelo do provedor fake é simulado: o de verdade, o Sorteio e as referências não', () => {
    expect(isSimulated({ type: 'MODEL', provider: 'fake' })).toBe(true);
    expect(isSimulated({ type: 'MODEL', provider: 'openrouter' })).toBe(false);
    expect(isSimulated({ type: 'MODEL', provider: 'azure-openai' })).toBe(false);
    expect(isSimulated({ type: 'RANDOM', provider: null })).toBe(false);
    expect(isSimulated({ type: 'CDI', provider: null })).toBe(false);
  });
});

describe('gráficos', () => {
  const props = {
    id: 'x',
    dates: ['2026-11-03', '2026-11-04'],
    series: [
      { slug: 'a', name: 'Modelo A', cents: [10_000_000, 10_100_000] },
      { slug: 'b', name: 'Sorteio', cents: [10_000_000, 9_900_000] },
    ],
    band: { p5: [9_900_000, 9_800_000], p95: [10_100_000, 10_200_000] },
  };

  it('o patrimônio é uma imagem com título e descrição, e uma tabela com os mesmos valores', () => {
    const out = html(<EquityChart {...props} />);
    expect(out).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby="x-title x-desc"/);
    expect(out).toContain('<title id="x-title">Patrimônio por pregão</title>');
    expect(out).toContain('Modelo A termina em R$\u00a0101.000,00');
    expect(out).toContain('<caption>Dados do gráfico: patrimônio por pregão</caption>');
    expect(out).toContain('<td>R$\u00a0101.000,00</td>');
    expect(out).toContain('Monte Carlo p5');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('o figcaption é o último filho da figura e a figura tem nome próprio, sem a legenda no nome', () => {
    const out = html(<EquityChart {...props} />);
    expect(out).toContain('<figure aria-label="Patrimônio por pregão"');
    // a tabela para o leitor de tela vem antes da legenda: o figcaption só pode ser o primeiro ou o último filho
    expect(out.indexOf('<table')).toBeLessThan(out.indexOf('<figcaption'));
    expect(out.endsWith('</figcaption></figure>')).toBe(true);
  });

  // A etiqueta "simulado" segue o nome onde ele aparece (plano, seção 4.5): na legenda também, depois do nome; a tabela para o leitor de
  // tela fica só com o nome (o cabeçalho de coluna é o nome da série, e a etiqueta já está na legenda e no ranking)
  it('na legenda, o modelo simulado leva a etiqueta depois do nome; o resto não', () => {
    const out = html(
      <EquityChart
        {...props}
        series={[{ ...props.series[0]!, simulated: true }, props.series[1]!]}
      />,
    );
    const legend = /<figcaption.*<\/figcaption>/s.exec(out)![0];
    expect(legend).toMatch(/Modelo A <span class="[^"]*border-dashed[^"]*">simulado<\/span><\/li>/);
    // o traço e o logo (aqui a inicial, sem laboratório) antes do nome, que segue sozinho no texto
    expect(legend).toMatch(
      /<\/svg><span aria-hidden="true" data-inicial="S"[^>]*><\/span>Sorteio<\/li>/,
    );
    expect(legend.match(/simulado/g)).toHaveLength(1);
    expect(/<table.*<\/table>/s.exec(out)![0]).not.toContain('simulado');
  });

  // O fim de cada linha (plano do redesenho, e.4): o logo e o patrimônio final numa pílula da cor do laboratório, decorativos (o mesmo
  // valor está na descrição e na tabela). A cor vai por classe, nunca em hexadecimal no atributo (no claro a linha ficaria invisível).
  it('o fim de cada linha leva o logo e o patrimônio final, na cor do laboratório; o Sorteio, neutro e tracejado', () => {
    const out = html(
      <EquityChart
        {...props}
        series={[
          {
            ...props.series[0]!,
            slug: 'claude-opus-5-5',
            competitor: {
              slug: 'claude-opus-5-5',
              name: 'Modelo A',
              type: 'MODEL',
              provider: 'fake',
              modelId: 'fake/momentum',
            },
          },
          {
            ...props.series[1]!,
            slug: 'sorteio',
            competitor: {
              slug: 'sorteio',
              name: 'Sorteio',
              type: 'RANDOM',
              provider: null,
              modelId: null,
            },
          },
        ]}
      />,
    );
    const labels = /<ul aria-hidden="true">.*?<\/ul>/s.exec(out)![0];
    expect(labels.match(/data-rotulo=/g)).toHaveLength(2);
    expect(labels).toMatch(
      /data-rotulo="claude-opus-5-5"[^>]*>.*data-lab="anthropic".*bg-serie-anthropic[^>]*>R\$\u00a0101\.000,00</s,
    );
    expect(labels).toMatch(/data-rotulo="sorteio"[^>]*>.*data-inicial="S".*bg-serie-neutra/s);
    expect(out).toMatch(/data-series="claude-opus-5-5"[^>]*class="stroke-serie-anthropic"/);
    expect(out).toMatch(/data-series="sorteio"[^>]*stroke-dasharray="6 4"/);
    expect(out).not.toMatch(/(fill|stroke)="#/);
    // a altura do desenho é fixa e a largura estica: o traço não escala com ela
    expect(out).toContain('preserveAspectRatio="none"');
    expect(out.match(/vector-effect="non-scaling-stroke"/g)!.length).toBeGreaterThan(2);
  });

  // No dia da primeira liquidação a série tem uma data só: a linha seria só um "mova para" e o SVG não desenharia nada. O ponto de cada linha
  // vai em HTML, posicionado em % como os rótulos (um círculo no SVG esticado viraria elipse), e o rótulo fica junto dele, e não na borda.
  it('com uma data só, cada linha é um ponto, e o rótulo fica junto dele', () => {
    const out = html(
      <EquityChart
        {...props}
        dates={['2026-11-04']}
        series={props.series.map((s) => ({ ...s, cents: [s.cents.at(-1)!] }))}
        band={null}
      />,
    );
    const labels = /<ul aria-hidden="true">.*?<\/ul>/s.exec(out)![0];
    for (const slug of ['a', 'b']) {
      expect(out).toMatch(new RegExp(`data-ponto="${slug}"[^>]*style="left:50%;top:[\\d.]+px"`));
      expect(labels).toMatch(
        new RegExp(`data-rotulo="${slug}"[^>]*style="left:50%;top:[\\d.]+px"`),
      );
    }
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('com várias datas, o ponto e o rótulo ficam no fim da linha, na borda direita do desenho', () => {
    const out = html(<EquityChart {...props} />);
    expect(out).toMatch(/data-ponto="a"[^>]*style="left:100%;top:[\d.]+px"/);
    expect(out).toMatch(/data-rotulo="a"[^>]*style="left:100%;top:[\d.]+px"/);
  });

  it('sem faixa do Monte Carlo não há faixa nem as colunas p5 e p95', () => {
    const out = html(<EquityChart {...props} band={null} />);
    expect(out).not.toContain('data-band');
    expect(out).not.toContain('Monte Carlo');
  });

  it('as velas trazem um resumo em texto e nenhuma tabela de preços (cotação bruta)', () => {
    const out = html(
      <CandlesChart
        ticker="MOVE3"
        bars={[
          {
            date: '2026-11-03',
            openCents: 6_660,
            highCents: 6_712,
            lowCents: 6_594,
            closeCents: 6_690,
          },
          {
            date: '2026-11-04',
            openCents: 6_644,
            highCents: 6_819,
            lowCents: 6_569,
            closeCents: 6_750,
          },
        ]}
      />,
    );
    expect(out).toContain('<figure aria-label="Velas diárias de MOVE3"');
    expect(out).toContain('2 pregões, de 03/11/2026 a 04/11/2026');
    expect(out).toContain('fechamento de R$\u00a066,90 para R$\u00a067,50 (+0,90%)');
    expect(out).toContain('mínima de R$\u00a065,69 e máxima de R$\u00a068,19');
    expect(out.match(/data-candle/g)).toHaveLength(2);
    expect(out).not.toContain('<table');
  });
});

describe('SearchForm', () => {
  const form = (props: Partial<Parameters<typeof SearchForm>[0]> = {}) =>
    html(
      <SearchForm
        action="/acoes"
        name="q"
        label="Ticker ou nome"
        placeholder="Buscar ação…"
        button="Buscar"
        maxLength={40}
        {...props}
      />,
    );

  it('é um formulário GET com o campo ligado ao rótulo, que pede a tecla "buscar" do teclado do celular', () => {
    const out = form({ defaultValue: 'MO' });
    expect(out).toContain('role="search"');
    expect(out).toContain('action="/acoes" method="get"');
    expect(out).toContain('<label for="campo-q"');
    expect(out).toMatch(/<input id="campo-q"[^>]*name="q"[^>]*value="MO"/);
    expect(out).toContain('enterKeyHint="search"');
  });

  it('o teclado só vai para caixa alta no campo que aceita apenas ticker', () => {
    expect(form()).toContain('autoCapitalize="off"');
    expect(form({ capitalize: 'characters' })).toContain('autoCapitalize="characters"');
  });

  it('o aviso de valor inválido fica ligado ao campo para o leitor de tela; sem aviso, o campo é válido', () => {
    const invalid = form({ invalidId: 'aviso-busca' });
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('aria-describedby="aviso-busca"');
    const valid = form();
    expect(valid).not.toContain('aria-invalid');
    expect(valid).not.toContain('aria-describedby');
  });
});

describe('ApiDown', () => {
  it('diz o que houve e o que fazer, com o botão que o chamador escolhe, e não vale como página', () => {
    const out = html(<ApiDown retry={<button type="button">Tentar de novo</button>} />);
    expect(out).toContain('Não foi possível carregar os dados');
    expect(out).toContain('Tente de novo em alguns minutos');
    expect(out).toContain('<button type="button">Tentar de novo</button>');
    expect(out).toContain('href="/"');
    expect(out).toContain('<meta name="robots" content="noindex"/>');
    expect(out).not.toContain('Código do erro');
  });

  it('o código do erro (o digest do log do servidor) só aparece quando há', () => {
    expect(html(<ApiDown digest="1234567" retry={null} />)).toContain('Código do erro: 1234567');
  });
});

describe('Countdown', () => {
  it('o servidor escreve a frase inicial, que o navegador depois refaz', () => {
    expect(
      html(<Countdown at="2026-11-03T11:00:00.000Z" initial="Faltam 1 dia e 3 horas." />),
    ).toBe('<span data-testid="contagem">Faltam 1 dia e 3 horas.</span>');
  });
});

describe('Como funciona sem a api', () => {
  it('explicar a regra não depende de dado: sai o texto, com os números do plano e sem o hash', async () => {
    const { api } = await import('../lib/api');
    vi.mocked(api.arenaCurrent).mockRejectedValue(new Error('api fora do ar: detalhe interno'));
    const { default: Page } = await import('../app/(site)/como-funciona/page');
    const out = html(await Page());
    expect(out).toContain('Regras da temporada');
    expect(out).toContain('R$\u00a0100.000,00 por competidor');
    expect(out).toContain('20 pregões');
    expect(out).toContain('Valores previstos para a Temporada 1');
    expect(out).toContain('O hash do prompt aparece aqui depois do primeiro ciclo.');
    expect(out).not.toContain('detalhe interno');
  });
});
