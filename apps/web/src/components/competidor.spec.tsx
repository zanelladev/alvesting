import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { Competidor, FaixaDeModelos, Logo, partesDoNome } from './competidor';

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

describe('partesDoNome', () => {
  it('separa o sufixo de versão do fim ("(0902)"), e o nome sem sufixo fica inteiro', () => {
    expect(partesDoNome('Qwen3.8 Max (0902)')).toEqual({ curto: 'Qwen3.8 Max', resto: ' (0902)' });
    expect(partesDoNome('DeepSeek V4 Pro (0813)')).toEqual({
      curto: 'DeepSeek V4 Pro',
      resto: ' (0813)',
    });
    expect(partesDoNome('GPT-6.1 Sol')).toEqual({ curto: 'GPT-6.1 Sol', resto: '' });
    // só o "(dígitos)" do fim: o parêntese no meio, ou com letras, fica
    expect(partesDoNome('Sorteio (controle)')).toEqual({ curto: 'Sorteio (controle)', resto: '' });
    expect(partesDoNome('(0902)')).toEqual({ curto: '(0902)', resto: '' });
  });

  // as referências têm o nome curto pelo tipo (o QA do fechamento, achados 3 e 17: "Igual-peso do universo (só preço)" quebrava em três
  // linhas nas tabelas e saía cortado no gráfico de posições), e o resto do nome vai para o leitor de tela
  it('o nome curto das referências, pelo tipo; o nome que não começa por ele fica como está', () => {
    expect(partesDoNome('Igual-peso do universo (só preço)', 'EQUAL_WEIGHT')).toEqual({
      curto: 'Igual-peso',
      resto: ' do universo (só preço)',
    });
    expect(partesDoNome('BOVA11 (contexto)', 'BOVA11')).toEqual({
      curto: 'BOVA11',
      resto: ' (contexto)',
    });
    expect(partesDoNome('CDI', 'CDI')).toEqual({ curto: 'CDI', resto: '' });
    expect(partesDoNome('Carteira igual-peso', 'EQUAL_WEIGHT')).toEqual({
      curto: 'Carteira igual-peso',
      resto: '',
    });
    // o modelo segue a regra do sufixo
    expect(partesDoNome('Qwen3.8 Max (0902)', 'MODEL')).toEqual({
      curto: 'Qwen3.8 Max',
      resto: ' (0902)',
    });
  });
});

describe('Competidor', () => {
  it('o logo, o nome como link para a página do competidor e a etiqueta do modelo simulado, sem borda', () => {
    const out = html(<Competidor competitor={claude} />);
    expect(out).toMatch(
      /^<span aria-hidden="true" data-lab="anthropic" class="logo mr-2"><\/span><a class="link" href="\/modelos\/claude-opus-5-5">Claude Opus 5\.5<\/a> <span class="[^"]*bg-surface-strong[^"]*">simulado<\/span>$/,
    );
    expect(out).not.toContain('border-dashed');
    // o texto que o leitor vê não muda com o logo
    expect(text(out)).toBe('Claude Opus 5.5 simulado');
  });

  // Nos lugares que já têm a nota uma vez por contexto (a tabela do ranking, a barra das carteiras), sem a etiqueta; nos lugares apertados, o
  // nome curto à vista e o sufixo de versão para o leitor de tela (o texto e o nome acessível continuam o nome inteiro).
  it('sem a etiqueta, e com o nome curto: o sufixo vai para o leitor de tela', () => {
    const qwen = { ...claude, slug: 'qwen3-8-max', name: 'Qwen3.8 Max (0902)' };
    const out = html(<Competidor competitor={qwen} etiqueta={false} curto />);
    expect(out).toContain(
      '<a class="link" href="/modelos/qwen3-8-max">Qwen3.8 Max<span class="sr-only"> (0902)</span></a>',
    );
    expect(out).not.toContain('simulado');
    expect(text(out)).toBe('Qwen3.8 Max (0902)');
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
  const qwen = { ...claude, slug: 'qwen3-8-max', name: 'Qwen3.8 Max (0902)' };
  const rows = [row(qwen, 734, 7_200), row(sorteio, -15, null), row(real, 0, 5_000)];
  const out = html(<FaixaDeModelos label="Os modelos e o Sorteio, por retorno" rows={rows} />);

  it('é uma lista que rola dentro da própria caixa, com nome e foco de teclado', () => {
    expect(out).toMatch(
      /<div role="region" aria-label="Os modelos e o Sorteio, por retorno" tabindex="0" class="[^"]*overflow-x-auto[^"]*"><ul/,
    );
    expect(out.match(/<li /g)).toHaveLength(3);
  });

  // O "simulado" uma vez por contexto: a nota no cabeçalho da faixa (aparece por padrão: a honestidade não depende de quem usa a peça), e
  // nenhuma etiqueta nos cartões; `avisoNaPagina` a tira, quando a página já tem o aviso que cobre a faixa (a arena).
  it('a nota "simulado" vai uma vez, antes da faixa, e nenhum cartão leva a etiqueta; com o aviso na página, nem ela', () => {
    // a temporada mista: a nota diz quem é simulado (o GPT de verdade, não)
    expect(out).toMatch(
      /^<p class="nota-simulada[^"]*"> <span[^>]*>simulado<\/span> Qwen3\.8 Max \(0902\) ainda não está conectado\.<\/p>/,
    );
    expect(out.match(/>simulado</g)).toHaveLength(1);
    const covered = html(<FaixaDeModelos label="Faixa" rows={rows} avisoNaPagina />);
    expect(covered).not.toContain('simulado');
    expect(covered).toMatch(/^<div role="region"/);
  });

  // O nome do cartão numa linha só (o pedido do Artur: o "(0902)" e a etiqueta quebravam o nome em duas e três linhas): o curto à vista, o
  // sufixo para o leitor de tela; o nome acessível do cartão é o nome inteiro, o retorno e o percentil.
  it('cada cartão leva à página do competidor, com o nome curto numa linha, o retorno com a direção e o percentil', () => {
    const cards = [...out.matchAll(/<li [^>]*>(.*?)<\/li>/g)].map((m) => m[1]!);
    expect(cards[0]).toMatch(/^<a [^>]*href="\/modelos\/qwen3-8-max"/);
    expect(cards[0]!.match(/<a /g)).toHaveLength(1);
    expect(cards[0]).toContain(
      'class="min-w-0 truncate">Qwen3.8 Max<span class="sr-only"> (0902)</span></span>',
    );
    expect(text(cards[0]!)).toBe('Qwen3.8 Max (0902)+7,34%percentil 72,0');
    expect(cards[0]).toContain('data-dir="up"');
    expect(text(cards[1]!)).toBe('Sorteio-0,15%percentil —');
    expect(cards[1]).toContain('data-dir="down"');
    expect(cards[2]).toContain('data-dir="flat"');
  });

  // O tooltip da Arc (o nome inteiro e o percentil explicado) é de cliente: a peça é de servidor e não o importa (a landing não carrega o
  // Motion por ela); quem quer o tooltip (a arena) envolve cada cartão.
  it('quem usa a peça pode envolver cada cartão (o tooltip da arena), e o cartão continua o mesmo', () => {
    const wrapped = html(
      <FaixaDeModelos
        label="Faixa"
        rows={rows}
        avisoNaPagina
        envolver={(cartao, r) => <span data-dica={r.competitor.slug}>{cartao}</span>}
      />,
    );
    expect(wrapped.match(/<span data-dica="[^"]+"><a /g)).toHaveLength(3);
  });
});
