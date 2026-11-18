import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ArenaCurrent, LeaderboardRow, SeasonSummary } from '@alvesting/contracts';
import escadaria from '../arte/escadaria-q0.json';
import { tapeLoop } from '../lib/fita';
import { Escadaria, Hero, JanelaArena, heroPill, type HeroProps } from './hero';

// O topo da landing (ADR 0041): o selo da temporada em cada estado, os dois botões, o aviso da arena simulada e a janela da arena em
// miniatura (decorativa); e a faixa da escadaria: a arte na moldura escura com o quadro 0 no HTML (sem JavaScript), a fita decorativa com o
// texto para o leitor de tela e a legenda com o crédito das cotações, embaixo da arte. Renderizado no servidor, como o Next.
const season = (status: SeasonSummary['status']): SeasonSummary =>
  ({
    id: '01JZ00000000000000000000AA',
    slug: 'ensaio',
    name: 'Temporada de teste',
    status,
    startDate: '2026-11-03',
    startedAt: null,
    finishedAt: null,
    settledThrough: null,
    params: { sessions: 20 },
  }) as SeasonSummary;
const lastCycle = { date: '2026-11-09' } as NonNullable<ArenaCurrent['lastCycle']>;
const nextCycle = { date: '2026-11-10', decisionAt: '2026-11-10T11:00:00.000Z' };

const render = (over: Partial<HeroProps> = {}) =>
  renderToStaticMarkup(<Hero pill={null} simulated={false} {...over} />);
const links = (out: string) =>
  [...out.matchAll(/<a class="([^"]*)" href="([^"]*)">(.*?)<\/a>/g)].map((m) => ({
    className: m[1],
    href: m[2],
    text: m[3]!.replace(/<[^>]+>/g, ''),
  }));

describe('heroPill', () => {
  it('em andamento: a data do último pregão, levando ao último ciclo, com o ponto da temporada viva', () => {
    expect(heroPill({ season: season('RUNNING'), lastCycle, nextCycle: null })).toEqual({
      text: 'Temporada em andamento · último pregão em 09/11',
      href: '/ciclos/2026-11-09',
      vivo: true,
    });
  });

  it('encerrada: o último pregão de todos, sem o ponto', () => {
    expect(heroPill({ season: season('FINISHED'), lastCycle, nextCycle: null })).toEqual({
      text: 'Temporada encerrada · pregão 20 de 20',
      href: '/ciclos/2026-11-09',
      vivo: false,
    });
  });

  it('antes do primeiro ciclo: o dia dele, levando às regras', () => {
    expect(heroPill({ season: season('RUNNING'), lastCycle: null, nextCycle })).toEqual({
      text: 'Temporada em andamento · primeiro pregão em 10/11',
      href: '/como-funciona',
      vivo: true,
    });
  });

  it('sem temporada (ou sem ciclo nenhum), nenhum selo', () => {
    expect(heroPill({ season: null, lastCycle: null, nextCycle: null })).toBeNull();
    expect(heroPill({ season: season('RUNNING'), lastCycle: null, nextCycle: null })).toBeNull();
  });
});

describe('Hero', () => {
  it('o título em dois tons, os dois botões (o primário para a arena, o de contorno para as regras) e o selo da temporada antes deles', () => {
    const out = render({
      pill: {
        text: 'Temporada em andamento · último pregão em 09/11',
        href: '/ciclos/2026-11-09',
        vivo: true,
      },
    });
    // o h1 é um texto só ("Modelos de linguagem investindo na B3"), com a segunda parte no apoio
    expect(out).toContain('>Modelos de linguagem <span class="tom2">investindo na B3</span></h1>');
    expect(links(out)).toEqual([
      {
        className: 'pill -my-1.5',
        href: '/ciclos/2026-11-09',
        text: 'Temporada em andamento · último pregão em 09/11',
      },
      { className: 'btn btn-primary', href: '/arena', text: 'Abrir a arena' },
      { className: 'btn', href: '/como-funciona', text: 'Regras da arena' },
    ]);
    // o ponto da temporada viva é decorativo
    expect(out).toContain('<span aria-hidden="true" class="selo-vivo"></span>');
    // os ícones dentro do texto são decorativos: o parágrafo lê "o mesmo briefing e o mesmo prompt"
    expect(out).toMatch(/o mesmo<span aria-hidden="true" class="ico"><svg/);
  });

  it('sem temporada: os dois botões, sem selo; e sem a janela, nem o esmaecer dela', () => {
    const out = render();
    expect(links(out).map((link) => link.text)).toEqual(['Abrir a arena', 'Regras da arena']);
    expect(out).not.toContain('class="pill');
    expect(out).not.toContain('esmaece');
  });

  it('o aviso da arena simulada, com o mesmo texto de sempre, só quando algum modelo é simulado', () => {
    const out = render({ simulated: true });
    expect(out).toContain(
      '<strong>Decisões simuladas: os modelos ainda não estão conectados.</strong> Os nomes são os do elenco, mas quem decide por cada modelo marcado como simulado é uma estratégia fixa e simples. O resultado não diz nada sobre os modelos de verdade.',
    );
    expect(render()).not.toContain('Decisões simuladas');
    expect(out).not.toContain('font-mono');
  });

  // a janela vem depois do texto no HTML: o título e o parágrafo nascem antes dela (o LCP do celular), e ela é decorativa
  it('a janela da arena vem depois do texto, decorativa', () => {
    const out = render({ janela: <div aria-hidden="true" className="janela-quadro" /> });
    expect(out.indexOf('</h1>')).toBeLessThan(out.indexOf('janela-quadro'));
    expect(out.indexOf('Às 08:00 de cada pregão')).toBeLessThan(out.indexOf('janela-quadro'));
    expect(out).toContain('class="esmaece-baixo"');
  });
});

describe('JanelaArena', () => {
  const competitor = (slug: string, name: string, modelId: string | null, type = 'MODEL') =>
    ({ slug, name, type, provider: 'openrouter', modelId }) as LeaderboardRow['competitor'];
  const rows = [
    {
      competitor: competitor('qwen', 'Qwen3.8 Max (0902)', 'qwen/qwen3.8-max'),
      returnBps: -1298,
      percentileBps: 8420,
    },
    {
      competitor: competitor('grok', 'Grok 4.7', 'x-ai/grok-4.7'),
      returnBps: -1360,
      percentileBps: 8170,
    },
    {
      competitor: competitor('sorteio', 'Sorteio', null, 'RANDOM'),
      returnBps: -1947,
      percentileBps: null,
    },
  ];
  const out = renderToStaticMarkup(
    <JanelaArena
      rows={rows}
      series={rows.map((row) => ({ competitor: row.competitor, cents: [10_000_000, 9_000_000] }))}
      date="2026-11-05"
    />,
  );

  it('é decorativa (o mesmo dado está no placar), sem link nenhum dentro', () => {
    expect(out).toMatch(/^<div aria-hidden="true" class="janela-quadro">/);
    expect(out).not.toContain('<a ');
  });

  it('o placar dos primeiros, com o nome curto, o retorno com a direção e o percentil; e o pregão do dado', () => {
    expect(out).toContain('pregão de 05/11');
    expect(out).toContain('Qwen3.8 Max<span class="sr-only"> (0902)</span>');
    expect(out).toContain('data-dir="down"');
    expect(out).toContain('percentil 84,2');
    expect(out).toContain('percentil —');
  });
});

describe('Escadaria', () => {
  const out = renderToStaticMarkup(
    <Escadaria
      caption="O mesmo briefing para todos os modelos. Cotações: brapi.dev, pregão de 09/11/2026."
      tape={{ text: 'BOVA11 66,25 ▼ -0,97%', label: 'Na fita: BOVA11 66,25 ▼ -0,97%.' }}
    />,
  );

  it('a arte é decorativa, na moldura escura, e já vem com o quadro 0 no HTML (sem JavaScript), com a brasa do sprite pequeno', () => {
    const moldura = out.indexOf('class="moldura');
    const art =
      /<div aria-hidden="true" data-arte="escadaria" class="arte [^"]*" style="([^"]*)">/.exec(out);
    expect(moldura).toBeGreaterThan(-1);
    expect(art!.index).toBeGreaterThan(moldura);
    expect(art?.[1]).toContain('--sprite:url(/ascii/arte/escadaria-q0.png)');
    expect(art?.[1]).toContain('--cols:200;--rows:120');
    const escaped = escadaria.frames[0]!.replaceAll('&', '&amp;');
    expect(out).toContain(`<pre class="arte-texto">${escaped}</pre>`);
    // o quadro 0 tem 120 linhas de 200 células
    expect(escadaria.frames[0]!.split('\n')).toHaveLength(120);
  });

  // a arte nunca fica atrás de texto que precise ser lido: o palco dela fecha antes do pé, com a legenda e a fita
  it('a legenda e a fita ficam no pé, embaixo do palco da arte, e não por cima dela', () => {
    const palco = out.slice(
      out.indexOf('class="moldura-palco"'),
      out.indexOf('class="moldura-pe"'),
    );
    expect(palco.match(/<div/g)!.length).toBe(palco.match(/<\/div>/g)!.length);
    expect(palco).not.toContain('Cotações');
  });

  it('a fita é decorativa (duas voltas no trilho), e o leitor de tela recebe o texto uma vez, depois da legenda com o crédito', () => {
    const volta = tapeLoop('BOVA11 66,25 ▼ -0,97%');
    expect(out).toMatch(/<div aria-hidden="true" data-fita="" class="tape [^"]*">/);
    expect(out).toContain(`<span>${volta}</span><span>${volta}</span>`);
    // a volta leva um oitavo de segundo por caractere (uns 8 por segundo, rolando sem passos: a sans não tem célula fixa)
    expect(out).toContain(`--tape-duracao:${volta.length / 8}s`);
    expect(out).not.toContain('--tape-passos');
    expect(out).toContain('<p class="sr-only">Na fita: BOVA11 66,25 ▼ -0,97%.</p>');
    expect(out.indexOf('Cotações: brapi.dev, pregão de 09/11/2026.')).toBeLessThan(
      out.indexOf('data-fita'),
    );
  });
});
