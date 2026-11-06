import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ArenaCurrent, SeasonSummary } from '@alvesting/contracts';
import escadaria from '../arte/escadaria-q0.json';
import { tapeLoop } from '../lib/fita';
import { Hero, heroPill, type HeroProps } from './hero';

// O hero da home (ADR 0034): a pílula do anúncio e os botões em cada estado da temporada, o aviso da arena simulada com o texto da T1, a
// arte com o quadro 0 no HTML (sem JavaScript) e a fita decorativa com o texto para o leitor de tela. Renderizado no servidor, como o Next.
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
  renderToStaticMarkup(
    <Hero
      pill={null}
      lastCycleDate={null}
      simulated={false}
      caption="O mesmo briefing para todos os modelos. Cotações: brapi.dev, pregão de 09/11/2026."
      tape={{ text: 'BOVA11 66,25 ▼ -0,97%', label: 'Na fita: BOVA11 66,25 ▼ -0,97%.' }}
      {...over}
    />,
  );
const links = (out: string) =>
  [...out.matchAll(/<a class="([^"]*)" href="([^"]*)">(.*?)<\/a>/g)].map((m) => ({
    className: m[1],
    href: m[2],
    text: m[3]!.replace(/<[^>]+>/g, ''),
  }));

describe('heroPill', () => {
  // `settledThrough` é o último pregão liquidado: o do último ciclo, depois da liquidação da noite
  const settledThrough = (date: string | null) => ({ ...season('RUNNING'), settledThrough: date });

  it('em andamento: o pregão liquidado de quantos a temporada tem, levando ao último ciclo', () => {
    expect(
      heroPill({ season: settledThrough('2026-11-09'), lastCycle, nextCycle: null }, 4),
    ).toEqual({
      text: 'Temporada em andamento · pregão 4 de 20',
      href: '/ciclos/2026-11-09',
    });
  });

  // Das 08:00 (o ciclo do dia nasce) até a liquidação, à noite, o patrimônio ainda não tem a data do ciclo: a pílula conta o pregão dele,
  // e o primeiro dia da temporada diz 1, nunca 0.
  it('em andamento, com o ciclo do dia aberto e ainda não liquidado: o pregão dele', () => {
    expect(heroPill({ season: settledThrough(null), lastCycle, nextCycle: null }, 0)).toEqual({
      text: 'Temporada em andamento · pregão 1 de 20',
      href: '/ciclos/2026-11-09',
    });
    expect(
      heroPill({ season: settledThrough('2026-11-06'), lastCycle, nextCycle: null }, 4),
    ).toEqual({
      text: 'Temporada em andamento · pregão 5 de 20',
      href: '/ciclos/2026-11-09',
    });
  });

  it('encerrada: o último pregão de todos', () => {
    expect(heroPill({ season: season('FINISHED'), lastCycle, nextCycle: null }, 20)).toEqual({
      text: 'Temporada encerrada · pregão 20 de 20',
      href: '/ciclos/2026-11-09',
    });
  });

  it('antes do primeiro ciclo: o dia dele, levando às regras', () => {
    expect(heroPill({ season: season('RUNNING'), lastCycle: null, nextCycle }, 0)).toEqual({
      text: 'Temporada em andamento · primeiro pregão em 10/11',
      href: '/como-funciona',
    });
  });

  it('sem temporada (ou sem ciclo nenhum), nenhuma pílula', () => {
    expect(heroPill({ season: null, lastCycle: null, nextCycle: null }, 0)).toBeNull();
    expect(heroPill({ season: season('RUNNING'), lastCycle: null, nextCycle: null }, 0)).toBeNull();
  });
});

describe('Hero', () => {
  it('com ciclo: a pílula, "Ver decisões" na pílula branca levando ao ciclo e "Regras da arena" no botão escuro', () => {
    const out = render({
      pill: { text: 'Temporada em andamento · pregão 4 de 20', href: '/ciclos/2026-11-09' },
      lastCycleDate: '2026-11-09',
    });
    expect(out).toContain('<h1');
    expect(out).toContain('Modelos de linguagem investindo na B3</h1>');
    expect(links(out)).toEqual([
      {
        className: 'pill -my-1.5',
        href: '/ciclos/2026-11-09',
        text: 'Temporada em andamento · pregão 4 de 20',
      },
      { className: 'btn btn-primary', href: '/ciclos/2026-11-09', text: 'Ver decisões' },
      { className: 'btn', href: '/como-funciona', text: 'Regras da arena' },
    ]);
  });

  it('sem ciclo (ou sem temporada): sem "Ver decisões", e "Regras da arena" vira a pílula branca', () => {
    const out = render();
    expect(links(out)).toEqual([
      { className: 'btn btn-primary', href: '/como-funciona', text: 'Regras da arena' },
    ]);
    expect(out).not.toContain('class="pill');
  });

  it('o aviso da arena simulada, com o mesmo texto da T1, só quando algum modelo é simulado', () => {
    const out = render({ simulated: true });
    expect(out).toContain(
      '<strong>Decisões simuladas: os modelos ainda não estão conectados.</strong> Os nomes são os do elenco, mas quem decide por cada modelo marcado como simulado é uma estratégia fixa e simples. O resultado não diz nada sobre os modelos de verdade.',
    );
    expect(render()).not.toContain('Decisões simuladas');
  });

  it('a arte é decorativa e já vem com o quadro 0 no HTML (sem JavaScript), com a brasa do sprite pequeno', () => {
    const out = render();
    const art =
      /<div aria-hidden="true" data-arte="escadaria" class="arte [^"]*" style="([^"]*)">/.exec(out);
    expect(art?.[1]).toContain('--sprite:url(/ascii/arte/escadaria-q0.png)');
    expect(art?.[1]).toContain('--cols:200;--rows:120');
    const escaped = escadaria.frames[0]!.replaceAll('&', '&amp;');
    expect(out).toContain(`<pre class="arte-texto">${escaped}</pre>`);
    // o quadro 0 tem 120 linhas de 200 células
    expect(escadaria.frames[0]!.split('\n')).toHaveLength(120);
  });

  it('a fita é decorativa (duas voltas no trilho), e o leitor de tela recebe o texto uma vez', () => {
    const out = render();
    const volta = tapeLoop('BOVA11 66,25 ▼ -0,97%');
    expect(out).toMatch(/<div aria-hidden="true" data-fita="" class="tape">/);
    expect(out).toContain(`<span>${volta}</span><span>${volta}</span>`);
    expect(out).toContain(`--tape-passos:${volta.length}`);
    expect(out).toContain('<p class="sr-only">Na fita: BOVA11 66,25 ▼ -0,97%.</p>');
    expect(out).toContain('Cotações: brapi.dev, pregão de 09/11/2026.');
  });
});
