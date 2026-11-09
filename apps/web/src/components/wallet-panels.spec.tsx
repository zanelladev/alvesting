import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Position, Totals } from '@alvesting/contracts';
import { WalletEmpty, WalletPositions, WalletSummary } from './wallet-panels';

// O resumo e as posições da carteira renderizados no servidor (etapa 12, parte 2; docs/TELAS.md, seção 9). Os números vêm prontos da api em
// centavos e pontos-base inteiros: aqui se confere como saem na tela. O e2e (carteira.spec.ts) confere o mesmo contra a api de verdade; aqui
// entram os estados que o banco sintético não produz (o ticker sem barra, o percentual nulo, a perda, o zero).
const html = renderToStaticMarkup;
// o texto que a pessoa lê: sem marcação, com o espaço sem quebra do "R$ " como espaço comum
const plain = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// O texto que o leitor de tela lê: sem o que está em aria-hidden (os algarismos das rodas do contador da Arc, que vão uma vez só, inteiros, num
// sr-only). Corta cada elemento aria-hidden com tudo o que ele tem dentro.
function lido(markup: string): string {
  let out = markup;
  for (
    let start = out.search(/<\w+[^>]*aria-hidden="true"/);
    start >= 0;
    start = out.search(/<\w+[^>]*aria-hidden="true"/)
  ) {
    const tag = /^<(\w+)/.exec(out.slice(start))![1]!;
    const re = new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, 'g');
    re.lastIndex = start;
    let depth = 0;
    for (let m = re.exec(out); m; m = re.exec(out)) {
      if (m[0].startsWith('</')) depth -= 1;
      else if (m[1] !== '/') depth += 1;
      if (depth === 0) {
        out = out.slice(0, start) + out.slice(re.lastIndex);
        break;
      }
    }
  }
  return plain(out);
}

const SEM_FECHAMENTO = {
  closeCents: null,
  closeDate: null,
  valueCents: null,
  pnlCents: null,
  pnlBps: null,
} as const;

const position = (over: Partial<Position> = {}): Position => ({
  ticker: 'MOVE3',
  quantity: 200,
  costCents: 710_000,
  avgPriceCents: 3_550,
  closeCents: 4_000,
  closeDate: '2026-11-09',
  valueCents: 800_000,
  pnlCents: 90_000,
  pnlBps: 1_268,
  ...over,
});

const totals = (over: Partial<Totals> = {}): Totals => ({
  costCents: 710_000,
  pricedCostCents: 710_000,
  valueCents: 800_000,
  pnlCents: 90_000,
  pnlBps: 1_268,
  unpriced: 0,
  ...over,
});

// As linhas do corpo da tabela, célula a célula, como texto.
function rows(markup: string): string[][] {
  const body = /<tbody>(.*)<\/tbody>/s.exec(markup)![1]!;
  return [...body.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((row) =>
    [...row[1]!.matchAll(/<(?:th|td)[^>]*>(.*?)<\/(?:th|td)>/gs)].map((cell) => plain(cell[1]!)),
  );
}

describe('WalletPositions', () => {
  it('a posição com fechamento: ticker, valor, resultado com sinal e palavra, quantidade, preço médio e o fechamento com a data', () => {
    expect(rows(html(<WalletPositions positions={[position()]} />))).toEqual([
      [
        'MOVE3',
        'R$ 8.000,00',
        '+R$ 900,00 +12,68% · ganho',
        '200',
        'R$ 35,50',
        'R$ 40,00 em 09/11/2026',
      ],
    ]);
  });

  it('a perda leva o sinal de menos e a palavra "perda"; o zero não leva sinal e diz "sem variação"', () => {
    const [loss, flat] = rows(
      html(
        <WalletPositions
          positions={[
            position({ ticker: 'SINA3', valueCents: 590_000, pnlCents: -120_000, pnlBps: -1_690 }),
            position({ ticker: 'SINB4', valueCents: 710_000, pnlCents: 0, pnlBps: 0 }),
          ]}
        />,
      ),
    );
    expect(loss![2]).toBe('-R$ 1.200,00 -16,90% · perda');
    expect(flat![2]).toBe('R$ 0,00 0,00% · sem variação');
  });

  it('o percentual que a api não dá (não cabe no inteiro seguro) não some a posição: diz "sem percentual"', () => {
    const [row] = rows(html(<WalletPositions positions={[position({ pnlBps: null })]} />));
    expect(row![2]).toBe('+R$ 900,00 sem percentual · ganho');
  });

  it('o ticker sem barra diz "sem cotação" no valor e deixa o resto em traço, mas mostra a quantidade e o preço médio', () => {
    const [row] = rows(
      html(
        <WalletPositions
          positions={[
            position({ ticker: 'SEMN3', quantity: 10, avgPriceCents: 2_000, ...SEM_FECHAMENTO }),
          ]}
        />,
      ),
    );
    expect(row).toEqual(['SEMN3', 'sem cotação', '—', '10', 'R$ 20,00', '—']);
  });

  it('cada posição leva a data do PRÓPRIO fechamento: o papel parado tem uma data mais antiga', () => {
    const out = rows(
      html(
        <WalletPositions
          positions={[
            position({ ticker: 'MOVE3', closeDate: '2026-11-09' }),
            position({ ticker: 'PAUS3', closeDate: '2026-11-05' }),
          ]}
        />,
      ),
    );
    expect(out.map((row) => row[5])).toEqual(['R$ 40,00 em 09/11/2026', 'R$ 40,00 em 05/11/2026']);
  });

  it('números grandes saem agrupados, sem perder um centavo (o maior valor que a carteira aceita)', () => {
    const [row] = rows(
      html(
        <WalletPositions
          positions={[
            position({
              quantity: 1_000_000,
              costCents: 100_000_000_000,
              avgPriceCents: 100_000,
              closeCents: 45_000_000,
              valueCents: 45_000_000_000_000,
              pnlCents: 44_900_000_000_000,
              pnlBps: 4_490_000,
            }),
          ]}
        />,
      ),
    );
    expect(row).toEqual([
      'MOVE3',
      'R$ 450.000.000.000,00',
      '+R$ 449.000.000.000,00 +44.900,00% · ganho',
      '1.000.000',
      'R$ 1.000,00',
      'R$ 450.000,00 em 09/11/2026',
    ]);
  });

  it('a tabela tem nome, cabeçalhos de coluna e de linha (o leitor de tela diz "MOVE3, valor...") e rola dentro da própria caixa', () => {
    const out = html(<WalletPositions positions={[position()]} />);
    expect(out).toContain('role="region"');
    expect(out).toContain('aria-label="Posições da carteira, por ticker"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('<caption class="sr-only">Posições da carteira, por ticker</caption>');
    const columns = [...out.matchAll(/<th scope="col"[^>]*>(.*?)<\/th>/g)].map((m) => plain(m[1]!));
    expect(columns).toEqual([
      'Ação',
      'Valor',
      'Resultado',
      'Quantidade',
      'Preço médio',
      'Fechamento',
    ]);
    expect(plain(/<th scope="row"[^>]*>(.*?)<\/th>/.exec(out)![1]!)).toBe('MOVE3');
  });

  // O mesmo número das posições dos modelos (/modelos e /acoes, tables.tsx): o glifo ▲ ▼ ■ vem do CSS (`[data-dir]::before`, com o texto
  // alternativo vazio), então o texto que a pessoa, o leitor de tela e o e2e leem não muda. O ticker sem cotação (o traço) fica sem.
  it('o resultado leva a direção para o glifo ▲ ▼ ■ (data-dir), fora do texto; o traço não leva', () => {
    const out = html(
      <WalletPositions
        positions={[
          position(),
          position({ ticker: 'PAUS3', pnlCents: -120_000, pnlBps: -1_690 }),
          position({ ticker: 'ZERO3', pnlCents: 0, pnlBps: 0 }),
          position({ ticker: 'NADA3', ...SEM_FECHAMENTO }),
        ]}
      />,
    );
    // a segunda célula de cada linha do corpo é a do resultado
    const body = /<tbody>(.*)<\/tbody>/s.exec(out)![1]!;
    const result = [...body.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((row) => {
      const cell = [...row[1]!.matchAll(/<td([^>]*)>/g)][1]![1]!;
      return /data-dir="(\w+)"/.exec(cell)?.[1] ?? null;
    });
    expect(result).toEqual(['up', 'down', 'flat', null]);
    expect(out).not.toMatch(/[▲▼■]/);
  });

  it('o ticker é texto: o resultado nunca depende de cor nem de classe de cor', () => {
    const out = html(<WalletPositions positions={[position({ pnlCents: -5, pnlBps: -1 })]} />);
    expect(out).not.toMatch(/text-(red|green|emerald|rose)|bg-(red|green)/);
    expect(plain(out)).toContain('-R$ 0,05 -0,01% · perda');
  });
});

describe('WalletSummary', () => {
  const dds = (markup: string) =>
    [...markup.matchAll(/<dd[^>]*>(.*?)<\/dd>/gs)].map((m) => lido(m[1]!));
  const dts = (markup: string) =>
    [...markup.matchAll(/<dt[^>]*>(.*?)<\/dt>/g)].map((m) => plain(m[1]!));

  // a ordem do Today do Rallies (ADR 0035): o valor estimado em cima, a frase do resultado e o custo total
  it('o valor estimado, o resultado com sinal, percentual e palavra, e o custo', () => {
    const out = html(<WalletSummary totals={totals()} />);
    expect(dts(out)).toEqual(['Valor estimado', 'Resultado', 'Custo total']);
    expect(dds(out)).toEqual(['R$ 8.000,00', '+R$ 900,00 (+12,68%, ganho)', 'R$ 7.100,00']);
    expect(out).not.toContain('sem cotação');
  });

  it('o resultado leva a direção para o glifo (data-dir), fora do texto', () => {
    const dir = (t: Totals) => /data-dir="(\w+)"/.exec(html(<WalletSummary totals={t} />))?.[1];
    expect(dir(totals())).toBe('up');
    expect(dir(totals({ pnlCents: -120_000, pnlBps: -1_690 }))).toBe('down');
    expect(dir(totals({ pnlCents: 0, pnlBps: 0 }))).toBe('flat');
    expect(dir(totals({ valueCents: null, pnlCents: null, pnlBps: null }))).toBeUndefined();
    expect(html(<WalletSummary totals={totals()} />)).not.toMatch(/[▲▼■]/);
  });

  it('a perda e o percentual que falta', () => {
    expect(
      dds(
        html(
          <WalletSummary
            totals={totals({ valueCents: 590_000, pnlCents: -120_000, pnlBps: -1_690 })}
          />,
        ),
      )[1],
    ).toBe('-R$ 1.200,00 (-16,90%, perda)');
    expect(dds(html(<WalletSummary totals={totals({ pnlBps: null })} />))[1]).toBe(
      '+R$ 900,00 (sem percentual, ganho)',
    );
  });

  it('sem nenhuma posição com fechamento: o custo aparece, o valor e o resultado dizem "sem cotação"', () => {
    const out = html(
      <WalletSummary
        totals={totals({
          pricedCostCents: 0,
          valueCents: null,
          pnlCents: null,
          pnlBps: null,
          unpriced: 2,
        })}
      />,
    );
    expect(dds(out)).toEqual(['sem cotação', 'sem cotação', 'R$ 7.100,00']);
  });

  it('avisa quantas posições ficaram fora do valor e do resultado, no singular e no plural', () => {
    const one = plain(html(<WalletSummary totals={totals({ unpriced: 1 })} />));
    expect(one).toContain(
      '1 posição está sem cotação: fica fora do valor estimado e do resultado, mas o custo dela está no custo total.',
    );
    const many = plain(html(<WalletSummary totals={totals({ unpriced: 3 })} />));
    expect(many).toContain(
      '3 posições estão sem cotação: ficam fora do valor estimado e do resultado, mas o custo delas está no custo total.',
    );
    expect(plain(html(<WalletSummary totals={totals({ unpriced: 0 })} />))).not.toContain(
      'sem cotação:',
    );
  });

  // A alocação (a rosca da beUI, components/wallet-charts.tsx): uma linha da legenda por posição com fechamento, com a parte e o valor; a posição
  // sem cotação fica fora. Os três pares da região continuam os que o e2e confere contra a api, e a pílula primária leva ao formulário.
  it('a rosca da alocação: a imagem com todas as partes no nome e a legenda com a parte e o valor de cada ação, sem a que não tem cotação', () => {
    const out = html(
      <WalletSummary
        totals={totals({ valueCents: 1_000_000, unpriced: 1 })}
        positions={[
          position({ ticker: 'MOVE3', valueCents: 800_000 }),
          position({ ticker: 'SINA3', valueCents: 200_000 }),
          position({ ticker: 'SEMN3', ...SEM_FECHAMENTO }),
        ]}
        logos={{ MOVE3: 'abc123' }}
      />,
    );
    expect(dds(out)).toHaveLength(3);
    expect(out).toContain(
      'role="img" aria-label="Alocação da carteira pelo valor estimado: MOVE3, 80,00%; SINA3, 20,00%."',
    );
    const legenda = [
      ...out.matchAll(/<button[^>]*data-legenda="(\w+)"[^>]*>(.*?)<\/button>/gs),
    ].map((m) => [m[1], lido(m[2]!)]);
    expect(legenda).toEqual([
      ['MOVE3', 'MOVE3 80,00% R$ 8.000,00'],
      ['SINA3', 'SINA3 20,00% R$ 2.000,00'],
    ]);
    // o logo da ação na linha (o da T0b), e o monograma da que não tem logo
    expect(out).toContain('src="/logos/MOVE3.svg?v=abc123"');
    expect(out).toContain('data-inicial="S"');
    // os botões da legenda nascem desativados (o servidor e o navegador sem JavaScript); a hidratação os liga
    expect(out).toMatch(/<button type="button" data-legenda="MOVE3" disabled=""/);
    // o botão que abre o modal de lançar é a pílula cinza: a primária é o do cabeçalho dos lançamentos (o QA do fechamento, achado 9); nasce
    // desativado (sem JavaScript ele não faria nada)
    expect(out).toContain('<button type="button" class="btn" disabled="">Lançar compra</button>');
  });

  it('sem nenhuma posição com fechamento, não há rosca', () => {
    const out = html(
      <WalletSummary
        totals={totals({ valueCents: null, pnlCents: null, pnlBps: null, unpriced: 1 })}
        positions={[position({ ticker: 'SEMN3', ...SEM_FECHAMENTO })]}
      />,
    );
    expect(out).not.toContain('role="img"');
    expect(out).not.toContain('Alocação');
  });

  // O valor estimado, o resultado e o custo no contador da Arc (o número que rola quando muda): o leitor de tela lê o texto inteiro uma vez (o
  // sr-only, com o formatBRL), e as rodas dos algarismos ficam fora dele (aria-hidden). O "Resultado" é o termo com o tooltip.
  it('os três números no contador: o texto lido inteiro, as rodas escondidas do leitor de tela, e o resultado com a explicação', () => {
    const out = html(<WalletSummary totals={totals()} />);
    expect(out.match(/data-contador=""/g)).toHaveLength(3);
    expect(
      [
        ...out.matchAll(
          /<span class="sr-only">([^<]*)<\/span><span aria-hidden="true" data-contador=""/g,
        ),
      ].map((m) => plain(m[1]!)),
    ).toEqual(['R$ 8.000,00', '+R$ 900,00', 'R$ 7.100,00']);
    expect(out).toMatch(
      /<dt[^>]*><button type="button" class="termo[^"]*"[^>]*>Resultado<\/button><\/dt>/,
    );
  });
});

describe('WalletPositions: o desenho limpo do Rallies', () => {
  it('o ticker na sans 500 com o logo à esquerda, ligado à página da ação; nenhuma mono na tabela', () => {
    const out = html(
      <WalletPositions
        positions={[position(), position({ ticker: 'SINA3' })]}
        logos={{ MOVE3: 'v1' }}
      />,
    );
    expect(out).not.toContain('font-mono');
    const [move, sina] = [...out.matchAll(/<th scope="row"[^>]*>(.*?)<\/th>/g)].map((m) => m[1]!);
    expect(move).toMatch(
      /<a [^>]*href="\/acoes\/MOVE3"[^>]*><img src="\/logos\/MOVE3\.svg\?v=v1" alt=""[^>]*\/?>MOVE3<\/a>/,
    );
    expect(sina).toMatch(
      /<span aria-hidden="true" data-logo="monograma" data-inicial="S"[^>]*><\/span>SINA3<\/a>/,
    );
    expect(out).toMatch(/<th scope="row" class="[^"]*font-medium[^"]*"/);
  });

  it('o resultado e o preço médio são termos com explicação (o tooltip da Arc), no cabeçalho da coluna', () => {
    const out = html(<WalletPositions positions={[position()]} />);
    const termos = [
      ...out.matchAll(/<button type="button" class="termo[^"]*"[^>]*>([^<]+)<\/button>/g),
    ].map((m) => m[1]);
    expect(termos).toEqual(['Resultado', 'Preço médio']);
  });
});

describe('WalletEmpty', () => {
  it('a coluna da carteira vazia não tem números nem a região do resumo, e abre o modal de lançar', () => {
    const out = html(<WalletEmpty />);
    expect(out).not.toContain('<dd');
    expect(out).not.toContain('id="resumo"');
    // a pílula cinza que abre o modal (a primária é a do cabeçalho dos lançamentos), desativada até o JavaScript, com o <noscript> ao lado
    expect(out).toContain(
      '<button type="button" class="btn" disabled="">Lançar compra</button><noscript><span class="muted">Lançar uma compra precisa de JavaScript.</span></noscript>',
    );
    expect(out).not.toContain('#lancar');
  });
});
