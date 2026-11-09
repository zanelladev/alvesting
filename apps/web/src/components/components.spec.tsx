import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { InternalBar, LeaderboardRow, NewsItem, PublicCompetitor } from '@alvesting/contracts';
import { ApiDown } from './api-down';
import { BarraExplorar, CartaoCompetidor, UniversoDaSemana } from './arena/explorar';
import { BumpChart } from './beui/bump-chart';
import { motionValue } from 'motion/react';
import { LineChart, moverMola } from './beui/line-chart';
import { Sparkline } from './beui/sparkline';
import { Countdown } from './countdown';
import { DecisionCard, type DecisionCardData } from './decisions';
import { NewsList } from './news-list';
import { LeaderboardTable, PositionsTable } from './tables';
import { Aviso, NotaSimulada, SearchForm, isSimulated, quemSimula } from './ui';
import { UltimoFechamento, Velas, layoutVelas } from './velas';
import { formatPrice } from '../lib/format';

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

  // O logo da empresa à esquerda do ticker (ADR 0036; docs/TELAS.md, 4a), dentro do chip, como nas ordens do feed: a imagem com a versão, o
  // monograma sem ela; o ticker na sans 500, não na mono.
  it('cada ticker é um chip na sans com o logo da ação à esquerda', () => {
    const out = html(
      <NewsList
        rows={[news({ tickers: ['PETR4', 'VALE3'] })]}
        logos={new Map([['PETR4', 'abc123']])}
      />,
    );
    expect(out).toContain(
      '<a class="chip font-medium" href="/acoes/PETR4"><img src="/logos/PETR4.svg?v=abc123"',
    );
    expect(out).toMatch(
      /<a class="chip font-medium" href="\/acoes\/VALE3"><span aria-hidden="true" data-logo="monograma" data-inicial="V"[^>]*><\/span>VALE3<\/a>/,
    );
    expect(out).not.toContain('font-mono');
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

  // O "simulado" uma vez por contexto (docs/DESIGN.md): no item sozinho (a landing), a etiqueta discreta, sem borda, logo depois do título e
  // fora dele (o nome do h3 é o do modelo); na lista que a página já avisa (o feed da arena, o ciclo), `avisoNaPagina` a tira.
  it('a decisão simulada leva a etiqueta depois do título, fora dele; com o aviso na página, não; na página do modelo, não', () => {
    const simulated = html(<DecisionCard by="model" decision={decision()} simulated />);
    expect(simulated).toMatch(
      /<h3[^>]*><a class="link[^"]*" href="\/modelos\/gemini-4-argon">Gemini 4 Argon<\/a><\/h3> <span class="[^"]*bg-surface-strong[^"]*">simulado<\/span>/,
    );
    expect(simulated).not.toContain('border-dashed');
    expect(html(<DecisionCard by="model" decision={decision()} />)).not.toContain('simulado');
    expect(
      html(<DecisionCard by="model" decision={decision()} simulated avisoNaPagina />),
    ).not.toContain('simulado');
    expect(
      html(<DecisionCard by="date" date="2026-11-09" decision={decision()} simulated />),
    ).not.toContain('simulado');
  });

  // O logo da empresa à esquerda do ticker (ADR 0036; docs/TELAS.md, 4a), dentro do chip que leva à ação: o <img> da rota do site quando há a
  // versão, o monograma quando não há (ou quando quem chama não passa os logos, como a landing). O ticker na sans 500, não na mono.
  it('cada ordem leva o logo da ação à esquerda do ticker, no chip, e o ticker e o selo na sans', () => {
    const item = (ticker: string) => ({
      position: 0,
      action: 'BUY' as const,
      ticker,
      percent: 10,
      confidence: 0.5,
      rationale: 'a',
    });
    const both = decision({ items: [item('MOVE3'), { ...item('SINA3'), position: 1 }] });
    const out = html(
      <DecisionCard by="model" decision={both} logos={new Map([['SINA3', 'abc123']])} />,
    );
    expect(out).toMatch(
      /<a class="chip[^"]*" href="\/acoes\/MOVE3"><span aria-hidden="true" data-logo="monograma" data-inicial="M"[^>]*><\/span>MOVE3<\/a>/,
    );
    expect(out).toMatch(
      /<a class="chip[^"]*" href="\/acoes\/SINA3"><img src="\/logos\/SINA3\.svg\?v=abc123" alt=""[^>]*>SINA3<\/a>/,
    );
    expect(
      html(<DecisionCard by="model" decision={both} />).match(/data-logo="monograma"/g),
    ).toHaveLength(2);
    expect(out).not.toContain('font-mono');
  });
});

// A nota da arena simulada, uma vez por contexto (o cabeçalho da faixa, da tabela, da barra das carteiras): a etiqueta discreta e quem ela
// cobre. Todos os modelos simulados (a arena de hoje): "os modelos"; só alguns (a temporada mista): os nomes, para a nota nunca dizer que um
// modelo de verdade é simulado; nenhum (a temporada de verdade): nada.
describe('NotaSimulada', () => {
  const model = (name: string, provider: 'fake' | 'openrouter') => ({
    name,
    type: 'MODEL' as const,
    provider,
  });
  it('todos simulados: a etiqueta e "os modelos"; alguns: os nomes; nenhum: nada', () => {
    expect(
      html(
        <NotaSimulada
          competitors={[
            model('A', 'fake'),
            model('B', 'fake'),
            { name: 'Sorteio', type: 'RANDOM', provider: null },
          ]}
        />,
      ),
    ).toMatch(
      /^<p class="nota-simulada"> <span class="[^"]*">simulado<\/span> Os modelos ainda não estão conectados\.<\/p>$/,
    );
    expect(
      html(
        <NotaSimulada
          competitors={[model('A', 'fake'), model('B', 'openrouter'), model('C (0902)', 'fake')]}
        />,
      ),
    ).toContain('simulado</span> A e C (0902) ainda não estão conectados.');
    expect(
      html(<NotaSimulada competitors={[model('A', 'fake'), model('B', 'openrouter')]} />),
    ).toContain('simulado</span> A ainda não está conectado.');
    expect(html(<NotaSimulada competitors={[model('B', 'openrouter')]} />)).toBe('');
  });

  // Antes da primeira liquidação o elenco sai do feed, e o feed filtrado (por modelo, ação ou cursor) só mostra uma parte dele: aí a nota nomeia
  // os simulados que vê, em vez de concluir que são todos (a revisão do fechamento, M13: /arena?modelo=<um simulado> dizia "os modelos ainda
  // não estão conectados" numa temporada mista).
  it('com o elenco parcial (o feed filtrado), a nota nomeia os simulados em vez de dizer "os modelos"', () => {
    expect(quemSimula([model('A', 'fake')], true)).toBe('A ainda não está conectado.');
    expect(quemSimula([model('A', 'fake'), model('B', 'fake')], true)).toBe(
      'A e B ainda não estão conectados.',
    );
    expect(quemSimula([model('A', 'fake')])).toBe('Os modelos ainda não estão conectados.');
  });

  it('o aviso de página é uma linha discreta, sem a caixa cinza, com o [!] e o texto para o leitor de tela', () => {
    const out = html(<Aviso>texto</Aviso>);
    expect(out).toMatch(
      /^<p class="[^"]*"><span aria-hidden="true" class="[^"]*">\[!\]<\/span><span class="min-w-0">texto<\/span><\/p>$/,
    );
    expect(out).not.toMatch(/bg-surface-card|border|font-mono/);
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
      /<th scope="row"[^>]*><span aria-hidden="true" data-ref="cdi" class="logo[^"]*"><\/span><a class="[^"]*" href="\/modelos\/cdi">CDI<\/a><\/th>/,
    );
  });

  // O "simulado" uma vez por contexto (docs/DESIGN.md): a nota no cabeçalho da tabela (por padrão), e nenhuma etiqueta nas linhas; o nome
  // curto à vista, com o sufixo de versão para o leitor de tela. `avisoNaPagina` tira a nota, quando a página já avisa.
  it('a nota "simulado" vai uma vez, antes da tabela, e a linha do modelo simulado fica sem etiqueta, com o nome curto', () => {
    const claude = row({
      competitor: {
        slug: 'claude-opus-5-5',
        name: 'Claude Opus 5.5 (0902)',
        type: 'MODEL',
        provider: 'fake',
        modelId: 'fake/momentum',
      },
    });
    const out = html(<LeaderboardTable rows={[claude, row()]} label="Ranking" />);
    expect(out).toMatch(
      /^<p class="nota-simulada[^"]*"> <span[^>]*>simulado<\/span> Os modelos ainda não estão conectados\.<\/p><div class="tabela"><div role="region"/,
    );
    expect(out.match(/>simulado</g)).toHaveLength(1);
    expect(out).toMatch(
      /<th scope="row"[^>]*><span aria-hidden="true" data-lab="anthropic" class="logo[^"]*"><\/span><a class="[^"]*" href="\/modelos\/claude-opus-5-5">Claude Opus 5\.5<span class="sr-only"> \(0902\)<\/span><\/a><\/th>/,
    );
    expect(
      html(<LeaderboardTable rows={[claude, row()]} label="Ranking" avisoNaPagina />),
    ).not.toContain('simulado');
    // sem modelo simulado (as referências, o Sorteio), sem nota
    expect(html(<LeaderboardTable rows={[row()]} label="Ranking" />)).not.toContain(
      'nota-simulada',
    );
  });

  // A sparkline da beUI (adaptada para o servidor) na linha do ranking completo: o patrimônio de cada pregão, uma imagem com o resumo no nome,
  // na coluna depois do patrimônio; a tabela compacta (a landing) não a tem.
  it('com as séries, o ranking completo ganha a coluna "Tendência" com a sparkline de cada linha; a compacta, não', () => {
    const series = new Map([['cdi', [10_000_000, 10_020_198] as const]]);
    const out = html(<LeaderboardTable rows={[row()]} label="Ranking" tendencias={series} />);
    const headers = [...out.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(headers.slice(3, 6)).toEqual(['Percentil', 'Patrimônio', 'Tendência']);
    expect(out).toMatch(
      /<td class="td"><svg role="img" aria-label="Patrimônio de CDI: de R\$\u00a0100\.000,00 a R\$\u00a0100\.201,98 \(\+0,20%\)"/,
    );
    expect(
      html(<LeaderboardTable rows={[row()]} label="Ranking" compact tendencias={series} />),
    ).not.toContain('Tendência');
    expect(html(<LeaderboardTable rows={[row()]} label="Ranking" />)).not.toContain('Tendência');
  });

  // O logo da empresa à esquerda do ticker nas posições da carteira do modelo (ADR 0036; docs/TELAS.md, 4a): a imagem com a versão, o
  // monograma sem ela; o ticker na sans 500, não na mono.
  it('as posições da carteira levam o logo da ação à esquerda do ticker, dentro do link', () => {
    const position = {
      quantity: 10,
      avgPriceCents: 1_000,
      valueCents: 10_000,
      pnlCents: 0,
      stale: false,
    };
    const out = html(
      <PositionsTable
        first="Ação"
        label="Posições"
        logos={new Map([['SINA3', 'abc123']])}
        rows={['MOVE3', 'SINA3'].map((ticker) => ({
          ...position,
          key: ticker,
          label: ticker,
          href: `/acoes/${ticker}`,
        }))}
      />,
    );
    expect(out).toMatch(
      /<a class="[^"]*" href="\/acoes\/MOVE3"><span aria-hidden="true" data-logo="monograma" data-inicial="M"[^>]*><\/span>MOVE3<\/a>/,
    );
    expect(out).toMatch(
      /<a class="[^"]*" href="\/acoes\/SINA3"><img src="\/logos\/SINA3\.svg\?v=abc123"/,
    );
    expect(out).not.toContain('font-mono');
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
  it('o número principal da linha leva a direção para o glifo, fora do texto; o outro com sinal, o que não existe ("—") e o sem sinal, não', () => {
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
    expect(board).toContain('<td class="td" data-dir="down">-0,30%</td>');
    // a Regra do Glifo (docs/DESIGN.md): o glifo só no número principal da linha, o retorno; os excessos levam o sinal, na cor do texto
    expect(board).toContain('<td class="td">-0,15%</td>');
    expect(board).toContain('<td class="td">0,00%</td>');
    expect(board.match(/data-dir=/g)).toHaveLength(2);
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

describe('gráfico do patrimônio (o Line Chart da beUI)', () => {
  const competitor = (
    slug: string,
    name: string,
    type: PublicCompetitor['type'] = 'MODEL',
  ): PublicCompetitor => ({
    slug,
    name,
    type,
    provider: type === 'MODEL' ? 'fake' : null,
    modelId: type === 'MODEL' ? 'fake/momentum' : null,
  });
  const props = {
    id: 'x',
    label: 'Patrimônio por pregão',
    dates: ['2026-11-03', '2026-11-04'],
    series: [
      {
        competitor: competitor('claude-opus-5-5', 'Modelo A (0902)'),
        cents: [10_000_000, 10_100_000],
      },
      { competitor: competitor('sorteio', 'Sorteio', 'RANDOM'), cents: [10_000_000, 9_900_000] },
    ],
    band: { p5: [9_900_000, 9_800_000], p95: [10_100_000, 10_200_000] },
  };

  it('o patrimônio é uma imagem com título e descrição, e uma tabela com os mesmos valores', () => {
    const out = html(<LineChart {...props} />);
    expect(out).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby="x-title x-desc"/);
    expect(out).toContain('<title id="x-title">Patrimônio por pregão</title>');
    expect(out).toContain('Modelo A (0902) termina em R$\u00a0101.000,00');
    expect(out).toContain('<caption>Dados do gráfico: patrimônio por pregão</caption>');
    expect(out).toContain('<td>R$\u00a0101.000,00</td>');
    expect(out).toContain('Monte Carlo p5');
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('o figcaption é o último filho da figura e a figura tem nome próprio, sem a legenda no nome', () => {
    const out = html(<LineChart {...props} />);
    expect(out).toContain('<figure aria-label="Patrimônio por pregão"');
    // a tabela para o leitor de tela vem antes da legenda: o figcaption só pode ser o primeiro ou o último filho
    expect(out.indexOf('<table')).toBeLessThan(out.indexOf('<figcaption'));
    expect(out.endsWith('</figcaption></figure>')).toBe(true);
  });

  // O controle pelo teclado (a peça da beUI): um controle deslizante nativo sobre o desenho, uma parada de Tab, que diz a data e o valor de
  // cada série; sem o cursor ainda, ele está no último pregão.
  it('o controle deslizante tem nome e diz a data e o valor de cada série à vista', () => {
    const out = html(<LineChart {...props} />);
    expect(out.match(/<input/g)).toHaveLength(1);
    expect(out).toMatch(/<input type="range" aria-label="Patrimônio por pregão: ler os valores"/);
    expect(out).toContain(
      'aria-valuetext="04/11/2026. Modelo A (0902) R$\u00a0101.000,00. Sorteio R$\u00a099.000,00"',
    );
    expect(out).toMatch(/<input type="range"[^>]*min="0" max="1" step="1"[^>]*value="1"\/>/);
  });

  // O "simulado" mora na página e nas peças que mostram os nomes (a nota uma vez por contexto, docs/DESIGN.md): a legenda do gráfico não o
  // repete, e o nome curto (sem o sufixo de versão) fica à vista, com o sufixo para o leitor de tela.
  it('a legenda é um botão por série, com o traço e o nome curto, e nenhuma etiqueta "simulado"', () => {
    const out = html(<LineChart {...props} />);
    const legend = /<figcaption.*<\/figcaption>/s.exec(out)![0];
    expect(legend.match(/<button type="button" aria-pressed="true"/g)).toHaveLength(2);
    expect(legend).toMatch(/<\/svg>Modelo A<span class="sr-only"> \(0902\)<\/span><\/button>/);
    expect(legend).toContain('Faixa p5 a p95 do Monte Carlo');
    expect(out).not.toContain('simulado');
  });

  // O "i" da faixa abre a explicação no clique, no toque e pelo teclado (o popover nativo, sem JavaScript): o botão de 44 px aponta para o
  // balão, que diz o que é a faixa em português simples. Sem a faixa, nem o "i" nem o balão.
  it('o "i" da faixa do Monte Carlo abre o balão que a explica, e sem faixa ele não existe', () => {
    const legend = /<figcaption.*<\/figcaption>/s.exec(html(<LineChart {...props} />))![0];
    expect(legend).toMatch(
      /Monte Carlo<button type="button" popoverTarget="faixa-explicada" class="info" aria-label="O que é a faixa p5 a p95 do Monte Carlo"><svg/,
    );
    expect(legend).toContain(
      '<div id="faixa-explicada" popover="auto" class="info-balao">São 1.000 carteiras sorteadas, com as mesmas regras e custos dos modelos.',
    );
    expect(legend).toContain('a borda de baixo é o p5 (5% ficaram abaixo dela)');
    expect(legend).toContain('dentro, o resultado não se distingue da sorte.</div>');
    const semFaixa = html(<LineChart {...props} band={null} />);
    expect(semFaixa).not.toContain('popoverTarget');
    expect(semFaixa).not.toContain('info-balao');
  });

  // As referências começam escondidas (a legenda as mostra, e a linha se desenha): fora da escala e sem o rótulo do fim, mas na tabela.
  it('a série escondida de início fica com o botão solto, sem o rótulo do fim, e continua na tabela', () => {
    const out = html(
      <LineChart
        {...props}
        series={[
          ...props.series,
          { competitor: competitor('cdi', 'CDI', 'CDI'), cents: [10_000_000, 10_010_000] },
        ]}
        defaultHidden={['cdi']}
      />,
    );
    expect(out).toMatch(/aria-pressed="false"[^>]*>(<svg.*?<\/svg>)CDI<\/button>/s);
    expect(out).not.toContain('data-rotulo="cdi"');
    expect(out).toMatch(/<g[^>]*data-oculta="true"[^>]*>.*?data-series="cdi"/s);
    expect(/<table.*<\/table>/s.exec(out)![0]).toContain('<th scope="col">CDI</th>');
    // a descrição e o controle falam só do que está à vista
    expect(out).not.toContain('CDI termina');
    expect(out).not.toMatch(/aria-valuetext="[^"]*CDI/);
  });

  // O fim de cada linha (o do Rallies): o logo e o patrimônio final numa pílula da cor do laboratório, decorativos (o mesmo valor está na
  // descrição e na tabela). A cor vai por `var()` dos nomes do shadcn (`--chart-*`), que seguem o tema; nunca hexadecimal.
  it('o fim de cada linha leva o logo e o patrimônio final, na cor do laboratório; o Sorteio, neutro e tracejado', () => {
    const out = html(<LineChart {...props} />);
    const labels = /<ul aria-hidden="true">.*?<\/ul>/s.exec(out)![0];
    expect(labels.match(/data-rotulo=/g)).toHaveLength(2);
    expect(labels).toMatch(
      /data-rotulo="claude-opus-5-5".*data-lab="anthropic".*background-color:var\(--chart-2\)[^>]*>R\$\u00a0101\.000,00</s,
    );
    expect(labels).toMatch(/data-rotulo="sorteio".*data-ref="sorteio".*var\(--chart-7\)/s);
    expect(out).toMatch(/data-series="claude-opus-5-5"[^>]*style="stroke:var\(--chart-2\)"/);
    expect(out).toMatch(/data-series="sorteio"[^>]*stroke-dasharray="6 4"/);
    expect(out).not.toMatch(/(fill|stroke|color)[=:]"?#/);
    // a altura do desenho é fixa e a largura estica: o traço não escala com ela
    expect(out).toContain('preserveAspectRatio="none"');
    expect(out.match(/vector-effect="non-scaling-stroke"/g)!.length).toBeGreaterThan(2);
  });

  // No dia da primeira liquidação a série tem uma data só. O ponto de cada linha vai em HTML, posicionado em % como os rótulos (um círculo no
  // SVG esticado viraria elipse), e o rótulo fica junto dele, e não na borda.
  it('com uma data só, cada linha é um ponto, e o rótulo fica junto dele', () => {
    const out = html(
      <LineChart
        {...props}
        dates={['2026-11-04']}
        series={props.series.map((s) => ({ ...s, cents: [s.cents.at(-1)!] }))}
        band={null}
      />,
    );
    for (const slug of ['claude-opus-5-5', 'sorteio']) {
      expect(out).toMatch(new RegExp(`data-ponto="${slug}"[^>]*style="left:50%`));
      expect(out).toMatch(new RegExp(`data-rotulo="${slug}"[^>]*style="left:50%`));
    }
    expect(out).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('com várias datas, o ponto e o rótulo ficam no fim da linha, na borda direita do desenho', () => {
    const out = html(<LineChart {...props} />);
    expect(out).toMatch(/data-ponto="claude-opus-5-5"[^>]*style="left:100%/);
    expect(out).toMatch(/data-rotulo="claude-opus-5-5"[^>]*style="left:100%/);
  });

  // A linha quebra no dado que falta (a peça da beUI): o caminho recomeça depois do buraco, e a tabela diz "sem dado".
  it('o valor que falta quebra a linha e vira "sem dado" na tabela e na leitura', () => {
    const out = html(
      <LineChart
        {...props}
        dates={['2026-11-03', '2026-11-04', '2026-11-05']}
        series={[
          { ...props.series[0]!, cents: [10_000_000, null, 10_050_000] },
          { ...props.series[1]!, cents: [10_000_000, 9_950_000, 9_900_000] },
        ]}
        band={null}
      />,
    );
    const d =
      /data-series="claude-opus-5-5"[^>]* d="([^"]*)"|<path d="([^"]*)"[^>]*data-series="claude-opus-5-5"/.exec(
        out,
      )!;
    expect((d[1] ?? d[2])!.match(/M/g)).toHaveLength(2);
    expect(out).toContain('<td>sem dado</td>');
  });

  it('sem faixa do Monte Carlo não há faixa nem as colunas p5 e p95', () => {
    const out = html(<LineChart {...props} band={null} />);
    expect(out).not.toContain('data-band');
    expect(out).not.toContain('Monte Carlo');
  });
});

// A sparkline da beUI, adaptada para o servidor: por padrão uma imagem com o resumo no nome (nenhuma parada de Tab dentro de uma tabela),
// sem JavaScript; a cor por `var()`, o fim marcado com um ponto e o buraco no dado que falta.
// A escala do gráfico anda por molas do Motion quando a legenda muda o dado (cada coordenada é um MotionValue); com movimento reduzido ela salta
// para o alvo. As molas correm em JavaScript e o `getAnimations()` do e2e não as vê, então o ramo do salto fica preso aqui (a revisão do
// fechamento, M11).
describe('as molas da escala do gráfico do patrimônio', () => {
  it('com movimento reduzido a coordenada salta para o alvo, sem mola', () => {
    const value = motionValue(10);
    expect(moverMola(value, 42, true)).toBeNull();
    expect(value.get()).toBe(42);
  });
});

describe('sparkline', () => {
  it('é uma imagem com o resumo no nome, do primeiro ao último valor e a variação, sem parada de Tab', () => {
    const out = html(
      <Sparkline
        data={[10_000_000, 10_050_000, 10_100_000]}
        label="Patrimônio de Modelo A"
        cor="var(--chart-2)"
      />,
    );
    expect(out).toMatch(
      /^<svg role="img" aria-label="Patrimônio de Modelo A: de R\$\u00a0100\.000,00 a R\$\u00a0101\.000,00 \(\+1,00%\)" width="64" height="24"/,
    );
    expect(out).not.toMatch(/tabindex|<input|<button/);
    expect(out).toContain('style="color:var(--chart-2)"');
    expect(out).toMatch(/<path d="M[^"]+" fill="none" stroke="currentColor"/);
    // o ponto no último valor
    expect(out.match(/<circle/g)).toHaveLength(1);
    expect(out).not.toMatch(/NaN|Infinity|#/);
  });

  it('o valor que falta quebra a linha; a série constante fica no meio, sem quebrar a escala', () => {
    const gap = html(<Sparkline data={[10_000_000, null, 9_900_000, 9_950_000]} label="P" />);
    expect(/<path d="([^"]+)"/.exec(gap)![1]!.match(/M/g)).toHaveLength(2);
    expect(gap).toContain('aria-label="P: de R$\u00a0100.000,00 a R$\u00a099.500,00 (-0,50%)"');
    const flat = html(<Sparkline data={[10_000_000, 10_000_000]} label="P" />);
    expect(flat).toMatch(/<path d="M[\d.]+,12L[\d.]+,12"/);
    expect(flat).toContain('(0,00%)');
    const empty = html(<Sparkline data={[null, null]} label="P" />);
    expect(empty).toContain('aria-label="P: sem dado"');
    expect(empty).not.toMatch(/<circle|NaN/);
  });
});

// O Bump Chart da beUI no ranking: a posição de cada competidor em cada pregão, com a curva entre as posições, o número da posição em cada
// ponto (decorativo), o nome no fim, a legenda que fixa uma série e a tabela escondida com a posição de cada um em cada pregão.
describe('gráfico de posições (o Bump Chart da beUI)', () => {
  const competitor = (
    slug: string,
    name: string,
    type: PublicCompetitor['type'] = 'MODEL',
  ): PublicCompetitor => ({
    slug,
    name,
    type,
    provider: type === 'MODEL' ? 'fake' : null,
    modelId: type === 'MODEL' ? 'fake/momentum' : null,
  });
  const props = {
    id: 'pos',
    label: 'Posição por pregão',
    dates: ['2026-11-03', '2026-11-04', '2026-11-05'],
    series: [
      { competitor: competitor('gpt-6-1-sol', 'GPT-6.1 Sol'), ranks: [1, 2, 2] },
      { competitor: competitor('qwen3-8-max', 'Qwen3.8 Max (0902)'), ranks: [2, 1, 1] },
      { competitor: competitor('cdi', 'CDI', 'CDI'), ranks: [3, 3, null] },
    ],
  };
  const out = html(<BumpChart {...props} />);

  it('é uma imagem com título e descrição, e a tabela escondida tem a posição de cada um em cada pregão', () => {
    expect(out).toMatch(/<svg[^>]*role="img"[^>]*aria-labelledby="pos-title pos-desc"/);
    expect(out).toContain('<title id="pos-title">Posição por pregão</title>');
    expect(out).toContain('No último pregão: 1º Qwen3.8 Max (0902), 2º GPT-6.1 Sol.');
    const table = /<table.*<\/table>/s.exec(out)![0];
    expect(table).toContain('<caption>Dados do gráfico: posição por pregão</caption>');
    expect(table).toMatch(
      /<th scope="row">Qwen3.8 Max \(0902\)<\/th><td>2º<\/td><td>1º<\/td><td>1º<\/td>/,
    );
    expect(table).toMatch(/<th scope="row">CDI<\/th><td>3º<\/td><td>3º<\/td><td>sem dado<\/td>/);
  });

  it('uma curva por série, na cor dela por `var()`, a referência pontilhada; o ponto de cada posição é decorativo', () => {
    expect(out.match(/<path[^>]*data-serie=/g)).toHaveLength(3);
    expect(out).toMatch(/data-serie="qwen3-8-max"[^>]*style="stroke:var\(--chart-6\)"/);
    expect(out).toMatch(/data-serie="cdi"[^>]*stroke-dasharray="2 3"/);
    // a lacuna do CDI no último pregão: a curva para no penúltimo
    expect(/data-serie="cdi"[^>]* d="([^"]*)"/.exec(out)![1]!.match(/C/g)).toHaveLength(1);
    const dots = /<div aria-hidden="true" data-pontos="true">.*?<\/div>/s.exec(out)![0];
    expect(dots.match(/data-posicao=/g)).toHaveLength(8);
    expect(out).not.toMatch(/(fill|stroke|color)[=:]"?#/);
  });

  it('a legenda é um botão por série, que fixa a linha, com o nome curto e a posição final', () => {
    const legend = /<ul aria-label="Séries do gráfico".*?<\/ul>/s.exec(out)![0];
    expect(legend.match(/<button type="button" aria-pressed="false"/g)).toHaveLength(3);
    expect(legend).toMatch(/Qwen3.8 Max<span class="sr-only"> \(0902\)<\/span>.*1º/s);
    expect(legend).toMatch(/CDI.*—/s);
  });
});

// --- o Explorar (components/arena/explorar.tsx; docs/TELAS.md, seções 1 e 10) ----------------------------------------------------------
// O "simulado" uma vez por contexto (a nota no cabeçalho dos populares e na grade dos modelos), o nome curto à vista (o sufixo de versão para o
// leitor de tela e o tooltip da página), o percentil no cartão e o logo de cada papel à esquerda do ticker, na sans.
const modelo = (over: Partial<LeaderboardRow> = {}): LeaderboardRow =>
  row({
    competitor: {
      slug: 'qwen-3-8-max',
      name: 'Qwen3.8 Max (0902)',
      type: 'MODEL',
      provider: 'fake',
      modelId: 'fake/contrarian-spread',
    },
    returnBps: -18,
    percentileBps: 6_300,
    ...over,
  });

describe('explorar', () => {
  it('o cartão do modelo: o logo, o nome curto à vista, sem etiqueta, as posições, o retorno com o glifo e o percentil', () => {
    const out = html(
      <ul>
        <CartaoCompetidor row={modelo()} posicoes={10} />
      </ul>,
    );
    expect(out).toContain('data-lab="qwen"');
    expect(out).toContain('Qwen3.8 Max<span class="sr-only"> (0902)</span>');
    expect(out).not.toContain('simulado');
    expect(out).toMatch(/<dt[^>]*>Posições<\/dt><dd[^>]*>10<\/dd>/);
    expect(out).toMatch(
      /<dt[^>]*>Retorno<\/dt><dd data-dir="down"[^>]*>-0,18%<\/dd><dd[^>]*>percentil 63,0<\/dd>/,
    );
  });

  it('o cartão da referência: o traço nas posições (sem composição pública) e nenhum percentil', () => {
    const out = html(
      <ul>
        <CartaoCompetidor row={row()} posicoes={null} />
      </ul>,
    );
    expect(out).toMatch(/<dt[^>]*>Posições<\/dt><dd[^>]*>—<\/dd>/);
    expect(out).not.toContain('percentil');
  });

  it('a página envolve o link do cartão (o tooltip da Arc), e a peça segue de servidor', () => {
    const out = html(
      <ul>
        <CartaoCompetidor
          row={modelo()}
          posicoes={1}
          envolver={(link) => <div data-envolto="">{link}</div>}
        />
      </ul>,
    );
    expect(out).toMatch(/<li[^>]*><div data-envolto=""><a /);
  });

  it('a barra: os populares com o nome curto, sem etiqueta em cada um, e a nota "simulado" uma vez', () => {
    const out = html(<BarraExplorar rows={[modelo(), row()]} />);
    expect(out.match(/>simulado</g)).toHaveLength(1);
    expect(out).toContain('nota-simulada');
    expect(out).toContain('Qwen3.8 Max<span class="sr-only"> (0902)</span>');
    // sem modelo simulado, sem nota
    expect(html(<BarraExplorar rows={[row()]} />)).not.toContain('simulado');
  });

  it('o universo da semana: cada papel com o logo à esquerda do ticker, na sans, o fechamento e a variação com o glifo', () => {
    const out = html(
      <UniversoDaSemana
        tape={{
          date: '2026-11-09',
          rows: [
            { ticker: 'MOVE3', closeCents: 7_147, previousCloseCents: 7_060 },
            { ticker: 'SINA3', closeCents: 1_000, previousCloseCents: null },
          ],
        }}
        logos={new Map([['MOVE3', 'v1']])}
      />,
    );
    expect(out).toContain('<img src="/logos/MOVE3.svg?v=v1"');
    expect(out).toContain('data-logo="monograma" data-inicial="S"');
    expect(out).not.toContain('font-mono');
    expect(out).toContain('R$ 71,47');
    expect(out).toMatch(/<span data-dir="up"[^>]*>\+1,23%<\/span>/);
    expect(out).toContain('sem o anterior');
    expect(out).toContain('fechamento do pregão de 09/11/2026');
    expect(out).toContain('Cotações: brapi.dev');
  });

  // as regras do universo à vista, em texto (no celular o tooltip não abre pelo toque; a revisão do fechamento, M9: antes eram só o balão)
  it('o universo: as regras dele à vista, em texto, e o vazio diz quando aparece', () => {
    const tape = {
      date: '2026-11-09',
      rows: [{ ticker: 'MOVE3', closeCents: 1, previousCloseCents: 1 }],
    };
    const out = html(<UniversoDaSemana tape={tape} logos={new Map()} />);
    expect(out).toContain(
      'O universo tem até 500 ações da B3 (ON, PN e unit) negociadas em pelo menos 90% dos últimos 60 pregões, sem FII, ETF nem BDR.',
    );
    expect(out).not.toContain('tabindex');
    expect(html(<UniversoDaSemana tape={{ date: null, rows: [] }} logos={new Map()} />)).toContain(
      'O universo da semana aparece depois do primeiro ciclo.',
    );
  });
});

// --- as velas da página da ação (components/velas.tsx; docs/TELAS.md, seção 4; ADR 0033) ---------------------------------------------
const barra = (
  date: string,
  openCents: number,
  highCents: number,
  lowCents: number,
  closeCents: number,
): InternalBar => ({ date, openCents, highCents, lowCents, closeCents });

describe('velas: a geometria (layoutVelas)', () => {
  const tres = [
    barra('2026-11-03', 1000, 1100, 950, 1050),
    barra('2026-11-04', 1050, 1060, 900, 920),
    barra('2026-11-05', 920, 920, 920, 920),
  ];

  it('uma vela por barra; alta (fecha na abertura ou acima) é vazada e baixa é cheia', () => {
    const layout = layoutVelas(tres);
    expect(layout.velas).toHaveLength(3);
    expect(layout.velas.map((v) => v.up)).toEqual([true, false, true]);
    // o pavio vai da mínima à máxima: o y da máxima é menor que o da mínima
    for (const v of layout.velas) expect(v.wickTop).toBeLessThanOrEqual(v.wickBottom);
    // o corpo da vela sem variação ainda aparece (pelo menos 1 px)
    expect(layout.velas[2]!.bodyHeight).toBeGreaterThanOrEqual(1);
  });

  it('o x é o meio da coluna de cada pregão (o viewBox de 1000 estica na largura), e tudo cabe na altura', () => {
    const layout = layoutVelas(tres);
    expect(layout.velas.map((v) => v.x)).toEqual([166.7, 500, 833.3]);
    expect(layout.corpo).toBeLessThan(1000 / 3);
    for (const v of layout.velas) {
      expect(v.wickTop).toBeGreaterThanOrEqual(0);
      expect(v.wickBottom).toBeLessThanOrEqual(280);
    }
    // as datas em % da largura, a primeira e a última alinhadas para dentro
    expect(layout.xLabels[0]).toMatchObject({ label: '03/11', anchor: 'start' });
    expect(layout.xLabels.at(-1)).toMatchObject({ label: '05/11', anchor: 'end', x: 83.3 });
  });

  it('a linha do último preço fica na altura do último fechamento', () => {
    const layout = layoutVelas(tres);
    expect(layout.ultimo.cents).toBe(920);
    expect(layout.ultimo.y).toBe(layout.velas[2]!.bodyTop);
  });

  it('sessenta barras cabem sem sobrepor', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      barra(
        `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        6000 + i,
        6100 + i,
        5900 + i,
        6050 + i,
      ),
    );
    const layout = layoutVelas(many);
    const xs = layout.velas.map((v) => v.x);
    for (let i = 1; i < xs.length; i += 1)
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(layout.corpo);
  });

  it('sem barra não há o que desenhar', () => {
    expect(() => layoutVelas([])).toThrow(RangeError);
  });
});

describe('velas: o desenho (Velas) e o cabeçalho (UltimoFechamento)', () => {
  // Cinco pregões com fechamentos que não coincidem com nenhum marco do eixo (66,00 a 69,00), nem com a mínima (65,83) nem com a máxima (69,01).
  const cinco = [
    barra('2026-11-03', 6_611, 6_740, 6_590, 6_690),
    barra('2026-11-04', 6_690, 6_733, 6_583, 6_617),
    barra('2026-11-05', 6_617, 6_901, 6_604, 6_873),
    barra('2026-11-06', 6_873, 6_888, 6_701, 6_729),
    barra('2026-11-09', 6_729, 6_812, 6_655, 6_781),
  ];
  const out = html(<Velas ticker="MOVE3" bars={cinco} />);

  it('é uma figura: o desenho é uma imagem com título e o resumo, e o resumo em texto; nenhuma tabela de preços', () => {
    expect(out).toContain('<figure aria-label="Velas diárias de MOVE3"');
    expect(out).toMatch(
      /<svg[^>]* role="img" aria-labelledby="velas-MOVE3-titulo velas-MOVE3-resumo"/,
    );
    expect(out).toContain('<title id="velas-MOVE3-titulo">Velas diárias de MOVE3</title>');
    const resumo =
      '5 pregões, de 03/11/2026 a 09/11/2026: fechamento de R$ 66,90 para R$ 67,81 (+1,36%), mínima de R$ 65,83 e máxima de R$ 69,01.';
    expect(out).toContain(`<desc id="velas-MOVE3-resumo">${resumo}</desc>`);
    expect(out).toContain(`<p data-testid="resumo-barras">${resumo}</p>`);
    expect(out.match(/<g data-candle/g)).toHaveLength(5);
    expect(out).not.toContain('<table');
  });

  // A regra das cotações (ADR 0033): a série nunca vai como dado. O HTML tem o primeiro e o último fechamento, a mínima e a máxima (o resumo),
  // o último na etiqueta da linha e os marcos redondos do eixo; os fechamentos do meio da série, nem escritos nem em centavos.
  it('nenhum fechamento do meio da série aparece no HTML, nem em reais nem em centavos', () => {
    for (const { closeCents } of cinco.slice(1, -1)) {
      expect(out).not.toContain(formatPrice(closeCents));
      expect(out).not.toMatch(new RegExp(`(?<![\\d.,])${closeCents}(?![\\d])`));
    }
    expect(out).toContain('>67,81<');
  });

  it('a alta é vazada e a queda é cheia, nas cores do dado pelo tema, e nenhuma cor crua', () => {
    const velas = [...out.matchAll(/<g data-candle[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(velas).toEqual([
      'vela-alta fill-canvas stroke-data-up',
      'vela-baixa fill-data-down stroke-data-down',
      'vela-alta fill-canvas stroke-data-up',
      'vela-baixa fill-data-down stroke-data-down',
      'vela-alta fill-canvas stroke-data-up',
    ]);
    expect(out).not.toMatch(/(fill|stroke|color)="#|#[0-9a-f]{3,6}[;"]/i);
  });

  it('a linha do último preço é tracejada, com a etiqueta do último fechamento no eixo', () => {
    expect(out).toMatch(/<line data-ultimo="true"[^>]*stroke-dasharray="3 4"/);
    expect(out).toMatch(/<span class="velas-etiqueta[^"]*"[^>]*>67,81<\/span>/);
  });

  // O realce de um pregão é CSS (globals.css, bloco do explorar): uma coluna por vela, com a data no atributo (o CSS a escreve), fora da árvore
  // de acessibilidade e sem parada de Tab. Só a data: nenhum preço.
  it('o realce de cada pregão é uma coluna com a data, escondida do leitor de tela e sem parada de Tab', () => {
    const colunas = /<div aria-hidden="true" class="velas-colunas[^"]*"[^>]*>(.*?)<\/div>/.exec(
      out,
    );
    expect(colunas).not.toBeNull();
    expect([...colunas![1]!.matchAll(/data-data="([^"]*)"/g)].map((m) => m[1])).toEqual([
      '03/11/2026',
      '04/11/2026',
      '05/11/2026',
      '06/11/2026',
      '09/11/2026',
    ]);
    expect(out).not.toContain('tabindex');
  });

  // A etiqueta do último preço tem uns 20 px de altura e o marco do eixo uns 16, centrados na mesma coluna: o marco a menos de 20 px dela some
  // (antes eram 14, e o de R$ 70,00 ficava colado na etiqueta de R$ 71,47; a revisão do fechamento, M18). A linha da grade dele fica.
  it('nenhum marco do eixo fica a menos de 20 px da etiqueta do último preço', () => {
    let perto = 0;
    for (let close = 7_100; close <= 7_200; close += 1) {
      const bars = [
        barra('2026-11-03', 6_400, 6_520, 6_380, 6_450),
        barra('2026-11-04', 6_900, 7_240, 6_850, 7_000),
        barra('2026-11-05', 7_000, 7_210, 6_950, close),
      ];
      const page = html(<Velas ticker="MOVE3" bars={bars} />);
      const etiqueta = Number(/class="velas-etiqueta[^"]*" style="top:([\d.]+)px"/.exec(page)![1]);
      const marcos = [
        ...page.matchAll(
          /class="absolute right-0 -translate-y-1\/2 text-muted" style="top:([\d.]+)px"/g,
        ),
      ].map((m) => Number(m[1]));
      expect(marcos.length).toBeGreaterThan(0);
      for (const top of marcos)
        expect(Math.abs(top - etiqueta), `R$ ${close / 100}`).toBeGreaterThanOrEqual(20);
      // a série passa por fechamentos com um marco entre 20 e 30 px (sem eles a conta não diria nada)
      if (marcos.some((top) => Math.abs(top - etiqueta) < 30)) perto += 1;
    }
    expect(perto).toBeGreaterThan(0);
  });

  // a altura da caixa é a da escala, em px: em rem (o `h-70`) ela cresceria com a fonte padrão do navegador e esticaria o desenho longe dos
  // marcos do eixo, que ficam em px (a revisão do fechamento, I3)
  it('a caixa do desenho tem a altura da escala em px', () => {
    expect(out).toMatch(/<div class="relative border-b border-hairline" style="height:280px">/);
    expect(out).not.toContain('h-70');
  });

  it('os rótulos e a etiqueta na sans com algarismos tabulares: nada de mono', () => {
    expect(out).not.toContain('font-mono');
    expect(out).toContain('Cotações: brapi.dev, pregão de 09/11/2026.');
  });

  it('um pregão só: "1 pregão", sem variação, e a vela sozinha no meio', () => {
    const one = html(<Velas ticker="MOVE3" bars={[cinco[0]!]} />);
    expect(one).toContain(
      '1 pregão, em 03/11/2026: fechamento de R$ 66,90, mínima de R$ 65,90 e máxima de R$ 67,40.',
    );
    expect(one.match(/<g data-candle/g)).toHaveLength(1);
  });

  it('o cabeçalho do terminal: o último fechamento, a variação sobre o pregão anterior com o glifo, a data e o crédito', () => {
    const head = html(<UltimoFechamento bars={cinco} />);
    expect(head).toContain('R$ 67,81');
    expect(head).toMatch(/<dd data-dir="up"[^>]*>\+0,77%<\/dd>/);
    expect(head).toContain('Fechamento do pregão de 09/11/2026, com a variação sobre o anterior.');
    expect(head).toContain('Cotações: brapi.dev');
    // o anterior não aparece: só a variação
    expect(head).not.toContain('67,29');
    const queda = html(<UltimoFechamento bars={cinco.slice(0, 2)} />);
    expect(queda).toMatch(/<dd data-dir="down"[^>]*>-1,09%<\/dd>/);
    // um pregão só: o fechamento, sem a variação
    const um = html(<UltimoFechamento bars={cinco.slice(0, 1)} />);
    expect(um).toContain('R$ 66,90');
    expect(um).not.toContain('data-dir');
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
