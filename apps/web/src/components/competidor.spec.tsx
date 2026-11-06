import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { Competidor, FaixaDeModelos, Logo } from './competidor';

// O competidor com o logo do laboratório (ADR 0035; plano, g.4): o logo é decorativo e não muda o texto que o leitor de tela e o e2e leem
// ("Nome" e "Nome simulado"); quem não tem laboratório leva a inicial pelo atributo, fora do texto.
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
// o texto como o textContent o veria: sem as tags (o ::before do logo e da inicial não é texto)
const text = (out: string) => out.replace(/<[^>]+>/g, '');

const claude: PublicCompetitor = {
  slug: 'claude-opus-5-5',
  name: 'Claude Opus 5.5',
  type: 'MODEL',
  provider: 'fake',
  modelId: 'fake/momentum',
};
const real: PublicCompetitor = {
  slug: 'gpt-6-1-sol',
  name: 'GPT-6.1 Sol',
  type: 'MODEL',
  provider: 'openrouter',
  modelId: 'openai/gpt-6.1-sol',
};
const sorteio: PublicCompetitor = {
  slug: 'sorteio',
  name: 'Sorteio',
  type: 'RANDOM',
  provider: null,
  modelId: null,
};
const cdi: PublicCompetitor = {
  slug: 'cdi',
  name: 'CDI',
  type: 'CDI',
  provider: null,
  modelId: null,
};

describe('Logo', () => {
  it('o modelo de um laboratório conhecido leva o logo dele, decorativo e sem texto', () => {
    expect(html(<Logo competitor={claude} />)).toBe(
      '<span aria-hidden="true" data-lab="anthropic" class="logo"></span>',
    );
    expect(html(<Logo competitor={real} className="size-10" />)).toBe(
      '<span aria-hidden="true" data-lab="openai" class="logo size-10"></span>',
    );
  });

  it('o Sorteio e as referências levam a inicial, pelo atributo (fora do texto)', () => {
    expect(html(<Logo competitor={sorteio} />)).toBe(
      '<span aria-hidden="true" data-inicial="S" class="logo"></span>',
    );
    expect(html(<Logo competitor={cdi} />)).toContain('data-inicial="C"');
  });
});

describe('Competidor', () => {
  it('o logo, o nome como link para a página do competidor e a etiqueta do modelo simulado', () => {
    const out = html(<Competidor competitor={claude} />);
    expect(out).toMatch(
      /^<span aria-hidden="true" data-lab="anthropic" class="logo mr-2"><\/span><a class="link" href="\/modelos\/claude-opus-5-5">Claude Opus 5\.5<\/a> <span class="[^"]*border-dashed[^"]*">simulado<\/span>$/,
    );
    // o texto que o leitor vê não muda com o logo
    expect(text(out)).toBe('Claude Opus 5.5 simulado');
  });

  it('o modelo de verdade não leva a etiqueta; a referência leva a inicial e nenhuma etiqueta', () => {
    expect(text(html(<Competidor competitor={real} />))).toBe('GPT-6.1 Sol');
    const out = html(<Competidor competitor={cdi} />);
    expect(out).toContain('data-inicial="C"');
    expect(text(out)).toBe('CDI');
  });

  it('sem link, quando o que está em volta já é o link (o cartão da faixa)', () => {
    const out = html(<Competidor competitor={sorteio} link={false} />);
    expect(out).not.toContain('<a');
    expect(text(out)).toBe('Sorteio');
  });
});

describe('FaixaDeModelos', () => {
  const row = (
    competitor: PublicCompetitor,
    returnBps: number,
    percentileBps: number | null,
  ): Pick<LeaderboardRow, 'competitor' | 'returnBps' | 'percentileBps'> => ({
    competitor,
    returnBps,
    percentileBps,
  });
  const out = html(
    <FaixaDeModelos
      label="Os modelos e o Sorteio, por retorno"
      rows={[row(claude, 734, 7_200), row(sorteio, -15, null), row(real, 0, 5_000)]}
    />,
  );

  it('é uma lista que rola dentro da própria caixa, com nome e foco de teclado', () => {
    expect(out).toMatch(
      /^<div role="region" aria-label="Os modelos e o Sorteio, por retorno" tabindex="0" class="[^"]*overflow-x-auto[^"]*"><ul/,
    );
    expect(out.match(/<li /g)).toHaveLength(3);
  });

  it('cada cartão leva à página do competidor, com o nome (sem link dentro do link), o retorno com a direção e o percentil', () => {
    const cards = [...out.matchAll(/<li [^>]*>(.*?)<\/li>/g)].map((m) => m[1]!);
    expect(cards[0]).toMatch(/^<a [^>]*href="\/modelos\/claude-opus-5-5"/);
    expect(cards[0]!.match(/<a /g)).toHaveLength(1);
    expect(text(cards[0]!)).toBe('Claude Opus 5.5 simulado+7,34%percentil 72,0');
    expect(cards[0]).toContain('data-dir="up"');
    expect(text(cards[1]!)).toBe('Sorteio-0,15%percentil —');
    expect(cards[1]).toContain('data-dir="down"');
    expect(cards[2]).toContain('data-dir="flat"');
  });
});
