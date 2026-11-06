import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ArenaCurrent, SeasonSummary } from '@alvesting/contracts';
import escadaria from '../arte/escadaria-q0.json';
import { tapeLoop } from '../lib/fita';
import { Hero, heroPill, type HeroProps } from './hero';

// O hero da landing (ADR 0035; docs/redesign-rallies/plano.md, d.2 e d.3): a pílula da temporada em cada estado, os dois CTAs, o aviso da arena
// simulada, a arte na moldura escura com o quadro 0 no HTML (sem JavaScript), a fita decorativa com o texto para o leitor de tela e o cartão
// "Arena agora" fora da moldura. Renderizado no servidor, como o Next.
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
  it('em andamento: a data do último pregão, levando ao último ciclo (sem a contagem: ela saía do patrimônio, que a landing não lê)', () => {
    expect(heroPill({ season: season('RUNNING'), lastCycle, nextCycle: null })).toEqual({
      text: 'Temporada em andamento · último pregão em 09/11',
      href: '/ciclos/2026-11-09',
    });
  });

  it('encerrada: o último pregão de todos', () => {
    expect(heroPill({ season: season('FINISHED'), lastCycle, nextCycle: null })).toEqual({
      text: 'Temporada encerrada · pregão 20 de 20',
      href: '/ciclos/2026-11-09',
    });
  });

  it('antes do primeiro ciclo: o dia dele, levando às regras', () => {
    expect(heroPill({ season: season('RUNNING'), lastCycle: null, nextCycle })).toEqual({
      text: 'Temporada em andamento · primeiro pregão em 10/11',
      href: '/como-funciona',
    });
  });

  it('sem temporada (ou sem ciclo nenhum), nenhuma pílula', () => {
    expect(heroPill({ season: null, lastCycle: null, nextCycle: null })).toBeNull();
    expect(heroPill({ season: season('RUNNING'), lastCycle: null, nextCycle: null })).toBeNull();
  });
});

describe('Hero', () => {
  it('o título, os dois CTAs (a pílula preta para a arena, a cinza para as regras) e a pílula da temporada depois deles', () => {
    const out = render({
      pill: { text: 'Temporada encerrada · pregão 20 de 20', href: '/ciclos/2026-11-09' },
    });
    expect(out).toContain('Modelos de linguagem investindo na B3</h1>');
    expect(links(out)).toEqual([
      { className: 'btn btn-primary', href: '/arena', text: 'Abrir a arena' },
      { className: 'btn', href: '/como-funciona', text: 'Regras da arena' },
      {
        className: 'pill -my-1.5',
        href: '/ciclos/2026-11-09',
        text: 'Temporada encerrada · pregão 20 de 20',
      },
    ]);
    // o hero primeiro no HTML: o título e o parágrafo antes da moldura (o LCP do celular)
    expect(out.indexOf('</h1>')).toBeLessThan(out.indexOf('class="moldura'));
    expect(out.indexOf('Às 08:00 de cada pregão')).toBeLessThan(out.indexOf('class="moldura'));
  });

  it('sem temporada: os dois CTAs, sem pílula', () => {
    const out = render();
    expect(links(out).map((link) => link.text)).toEqual(['Abrir a arena', 'Regras da arena']);
    expect(out).not.toContain('class="pill');
  });

  it('o aviso da arena simulada, com o mesmo texto da T1, só quando algum modelo é simulado', () => {
    const out = render({ simulated: true });
    expect(out).toContain(
      '<strong>Decisões simuladas: os modelos ainda não estão conectados.</strong> Os nomes são os do elenco, mas quem decide por cada modelo marcado como simulado é uma estratégia fixa e simples. O resultado não diz nada sobre os modelos de verdade.',
    );
    expect(render()).not.toContain('Decisões simuladas');
  });

  it('a arte é decorativa, na moldura escura, e já vem com o quadro 0 no HTML (sem JavaScript), com a brasa do sprite pequeno', () => {
    const out = render();
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

  it('a fita é decorativa (duas voltas no trilho), e o leitor de tela recebe o texto uma vez, depois da legenda com o crédito', () => {
    const out = render();
    const volta = tapeLoop('BOVA11 66,25 ▼ -0,97%');
    expect(out).toMatch(/<div aria-hidden="true" data-fita="" class="tape [^"]*">/);
    expect(out).toContain(`<span>${volta}</span><span>${volta}</span>`);
    expect(out).toContain(`--tape-passos:${volta.length}`);
    expect(out).toContain('<p class="sr-only">Na fita: BOVA11 66,25 ▼ -0,97%.</p>');
    expect(out.indexOf('Cotações: brapi.dev, pregão de 09/11/2026.')).toBeLessThan(
      out.indexOf('data-fita'),
    );
  });

  // O cartão segue o tema da página: fica fora do elemento da moldura (que vale a paleta do escuro dentro dela), depois dela no HTML.
  it('o cartão "Arena agora" vem depois da moldura e fora dela', () => {
    const out = render({ card: <section id="cartao">Arena agora</section> });
    const card = out.indexOf('<section id="cartao">');
    expect(card).toBeGreaterThan(out.indexOf('data-fita'));
    // a moldura fecha antes do cartão: o cartão não está dentro dela
    const moldura = out.slice(out.indexOf('class="moldura'), card);
    expect(moldura.match(/<div/g)!.length).toBe(moldura.match(/<\/div>/g)!.length);
    expect(render()).not.toContain('Arena agora');
  });
});
