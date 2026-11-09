import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Lot } from '@alvesting/contracts';
import { Avisos } from './avisos';
import { WalletLots } from './wallet-lots';

// Os lançamentos e o modal da carteira, renderizados no servidor (o HTML que chega ao navegador antes do JavaScript): o que o leitor de tela e o
// teclado do celular recebem, e o que a tela faz sem JavaScript. O comportamento com JavaScript (abrir e fechar o modal, conferir, enviar,
// editar, apagar com a confirmação, o foco depois de cada ação, o − e o +, o calendário) os e2e conferem no navegador, nos seis projetos
// (apps/web/e2e/carteira.spec.ts).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const html = renderToStaticMarkup;
const plain = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const lot = (over: Partial<Lot> = {}): Lot => ({
  id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  ticker: 'MOVE3',
  quantity: 100,
  costCents: 355_000,
  boughtOn: '2026-10-15',
  createdAt: '2026-11-03T12:00:00.000Z',
  updatedAt: '2026-11-03T12:00:00.000Z',
  ...over,
});

// Cada <input> do HTML, com os atributos que importam (o React escreve `inputMode` e `autoCapitalize` em camelCase no HTML do servidor)
function inputs(markup: string) {
  return [...markup.matchAll(/<input\b[^>]*>/g)].map((match) => {
    const tag = match[0];
    const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag)?.[1];
    return {
      tag,
      name: attr('name'),
      type: attr('type'),
      id: attr('id'),
      inputMode: attr('inputMode'),
      maxLength: attr('maxLength'),
      autoCapitalize: attr('autoCapitalize'),
      role: attr('role'),
      value: attr('value'),
      placeholder: attr('placeholder'),
    };
  });
}

describe('a carteira vazia', () => {
  const out = html(<WalletLots lots={[]} today="2026-11-09" />);

  it('explica o que é a carteira e como lançar, em vez de ficar em branco', () => {
    expect(plain(out)).toContain('Você ainda não lançou nenhuma compra.');
    expect(plain(out)).toContain('Depois dá para editar ou apagar cada lançamento.');
    expect(out).not.toContain('<ul');
  });

  it('o formulário de lançar mora no modal (o <dialog>, fechado), é nomeado pelo título dele e nasce desativado: sem JavaScript não se envia nada', () => {
    expect(out).toMatch(/<dialog aria-labelledby="lancamento-titulo" class="[^"]*"><div/);
    expect(out).not.toMatch(/<dialog[^>]*\sopen/);
    expect(out).toContain('<h2 id="lancamento-titulo"');
    expect(out).toMatch(/<h2 id="lancamento-titulo"[^>]*>Lançar uma compra<\/h2>/);
    expect(out).toMatch(/<form[^>]*aria-labelledby="lancamento-titulo"/);
    expect(out).toMatch(/<form[^>]*method="post"/);
    expect(out).toMatch(/<form[^>]*noValidate/);
    expect(out).toContain('<fieldset disabled=""');
    // o envio na primária e o "Cancelar" na cinza; o ✕ do canto, de 44 px, com nome
    expect(out).toContain('<button type="submit" class="btn btn-primary">Lançar compra</button>');
    expect(out).toContain('<button type="button" class="btn">Cancelar</button>');
    expect(out).toMatch(/<button type="button" class="[^"]*fechar[^"]*" aria-label="Fechar">/);
  });

  it('o "Lançar compra" que abre o modal fica no cabeçalho da seção, na primária com o "+", desativado até o JavaScript chegar', () => {
    expect(out).toMatch(
      /<h2 id="lancamentos-titulo"[^>]*>Lançamentos<\/h2><div[^>]*><button type="button" class="btn btn-primary" disabled=""><svg[^>]*>.*?<\/svg>Lançar compra<\/button><noscript><span class="muted">Lançar uma compra precisa de JavaScript\.<\/span><\/noscript>/,
    );
  });

  it('o teclado do celular: números para a quantidade e para o valor, caixa alta para o ticker; a quantidade e a data vão em campos escondidos', () => {
    const [ticker, quantity, quantityValue, unit, total, value, date] = inputs(out);
    expect(ticker).toMatchObject({ name: 'ticker', maxLength: '12', autoCapitalize: 'characters' });
    expect(ticker!.tag).toMatch(/class="[^"]*\buppercase\b/);
    // o Number field da Arc: um campo de texto com o papel de spinbutton e o teclado de números, sem nome (o inteiro vai no escondido)
    expect(quantity).toMatchObject({
      type: 'text',
      role: 'spinbutton',
      inputMode: 'numeric',
      value: '1',
    });
    expect(quantity!.name).toBeUndefined();
    expect(quantityValue).toMatchObject({ name: 'quantity', type: 'hidden', value: '1' });
    expect(unit).toMatchObject({ name: 'mode', type: 'radio' });
    expect(total).toMatchObject({ name: 'mode', type: 'radio' });
    // os centavos entram pela direita: só algarismos, o teclado de números de qualquer celular (e não type="number")
    expect(value).toMatchObject({
      name: 'value',
      type: 'text',
      inputMode: 'numeric',
      placeholder: '0,00',
    });
    // a data é o gatilho do calendário (um botão) e o AAAA-MM-DD num escondido, vazio sem data
    expect(date).toMatchObject({ name: 'boughtOn', type: 'hidden', value: '' });
    expect(inputs(out)).toHaveLength(7);
  });

  it('a quantidade começa em 1, com o − e o + em português, e o − parado no mínimo (com o foco, para a pressão mostrar o limite)', () => {
    expect(out).toMatch(/aria-label="Diminuir quantidade" aria-disabled="true"/);
    expect(out).toMatch(/aria-label="Aumentar quantidade"><span/);
    expect(out).toMatch(
      /aria-valuenow="1" aria-valuetext="1" aria-valuemin="1" aria-valuemax="1000000"/,
    );
    expect(plain(out)).toContain('Ações inteiras: use − e + ou digite.');
  });

  it('o valor tem o "R$" dentro do campo, à vista e fora do que o leitor de tela lê (o rótulo diz "em reais")', () => {
    expect(out).toMatch(
      /<span aria-hidden="true" class="[^"]*moeda[^"]*">R\$<\/span><input [^>]*name="value"/,
    );
  });

  it('a data é o gatilho do calendário: o rótulo e "Sem data" dão o nome dele, e a dica fica ligada a ele', () => {
    const trigger =
      /<button id="([^"]+)" type="button" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="([^"]+)"[^>]*>/.exec(
        out,
      );
    expect(trigger, 'o gatilho da data').not.toBeNull();
    const [label, shown] = trigger![2]!.split(' ');
    expect(out).toMatch(
      new RegExp(`<label id="${label}"[^>]*>Data da compra \\(opcional\\)</label>`),
    );
    expect(out).toMatch(new RegExp(`<span id="${shown}" class="[^"]*srOnly[^"]*">Sem data</span>`));
    expect(trigger![0]).toMatch(/aria-describedby="[^"]+"/);
    expect(plain(out)).toContain('Pode ficar em branco. Não pode ser no futuro.');
  });

  it('o modo de preço são dois radios nativos num grupo com legenda, o "preço por ação" já marcado', () => {
    expect(out).toContain(
      '<legend class="text-sm font-medium text-ink">Como você vai informar o valor?</legend>',
    );
    const radios = inputs(out).filter((input) => input.type === 'radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]!.tag).toMatch(/\schecked=""/);
    expect(radios[1]!.tag).not.toMatch(/\schecked/);
    expect(radios.map((r) => r.tag.match(/value="([^"]*)"/)![1])).toEqual(['unit', 'total']);
    expect(plain(out)).toContain('Preço por ação');
    expect(plain(out)).toContain('Valor total pago');
    // o controle segmentado: as duas metades na trilha (o desenho e a pílula que desliza estão no módulo CSS)
    expect(out).toMatch(
      /<div class="[^"]*segmentado[^"]*"><label class="[^"]*opcao[^"]*"><input type="radio"/,
    );
  });

  it('o "valor total pago" explica-se ao leitor de tela como a descrição do radio, e à vista na dica do campo de valor (sem tooltip)', () => {
    const total = inputs(out).find((input) => input.tag.includes('value="total"'))!;
    const id = /aria-describedby="([^"]+)"/.exec(total.tag)![1]!;
    expect(out).toMatch(
      new RegExp(`<span id="${id}" class="sr-only">O total da nota desta compra`),
    );
    expect(out).not.toContain('termo');
  });

  it('o grupo do modo avisa, ligado a ele por aria-describedby, que trocar a opção apaga o valor digitado', () => {
    const group = /<fieldset([^>]*)><legend[^>]*>Como você vai informar o valor\?<\/legend>/.exec(
      out,
    );
    expect(group, 'o grupo de radios com legenda').not.toBeNull();
    const hintId = /aria-describedby="([^"]+)"/.exec(group![1]!)?.[1];
    expect(hintId, 'o grupo aponta para a dica').toBeTruthy();
    expect(out).toMatch(
      new RegExp(
        `<p id="${hintId!.replace(/[^\\w-]/g, '.')}"[^>]*>Ao trocar a opção, o valor digitado é apagado\\.</p>`,
      ),
    );
  });

  it('todo campo tem rótulo (por id, ou o radio dentro do próprio rótulo), e o rótulo do valor diz que é o preço de UMA ação (o modo inicial)', () => {
    for (const input of inputs(out).filter((i) => i.type !== 'radio' && i.type !== 'hidden')) {
      expect(input.id, input.tag).toBeTruthy();
      expect(out, `rótulo de ${input.name}`).toMatch(
        new RegExp(`<label[^>]*for="${input.id!.replace(/[^\\w-]/g, '.')}"`),
      );
    }
    // o radio fica DENTRO do rótulo: o texto inteiro é o alvo de toque, e o leitor de tela lê "Preço por ação, botão de opção"
    expect(out).toMatch(
      /<label[^>]*><input type="radio"[^>]*value="unit"\/><span>Preço por ação<\/span><\/label>/,
    );
    expect(out).toMatch(
      /<label[^>]*><input type="radio"[^>]*value="total"\/><span>Valor total pago<\/span><\/label>/,
    );
    expect(out).toMatch(/>Preço por ação<span class="sr-only"> em reais<\/span><\/label>/);
    expect(plain(out)).toContain(
      'O preço de uma ação. Os centavos entram pela direita: 3550 vira 35,50.',
    );
    expect(out).toMatch(/>Ticker<\/label>/);
    expect(out).toMatch(/>Quantidade<\/label>/);
    expect(out).toMatch(/>Data da compra \(opcional\)<\/label>/);
  });

  // O aviso do resultado é a pilha de avisos da página (o toast da beUI, components/avisos.tsx), antes da lista: a região viva (a lista com
  // `aria-live="polite"`) existe desde o começo, vazia, para o leitor de tela anunciar o que chega depois.
  it('o aviso do resultado existe desde o começo, vazio, para o leitor de tela anunciar o que chega depois', () => {
    const inPage = html(
      <Avisos>
        <WalletLots lots={[]} today="2026-11-09" />
      </Avisos>,
    );
    expect(inPage).toMatch(
      /^<div class="space-y-8"><ol aria-live="polite" aria-atomic="false" aria-label="Avisos"[^>]*><\/ol><section id="lancamentos"/,
    );
  });

  it('quem não sabe o código busca a ação noutra aba, sem entregar a janela e sem perder o formulário', () => {
    expect(out).toMatch(
      /<a href="\/acoes" target="_blank" rel="noopener noreferrer"[^>]*>Buscar uma ação<span class="sr-only"> \(abre em outra aba\)<\/span><\/a>/,
    );
  });

  it('o formulário mora no modal, e não no fim da página: nenhum atalho para ele', () => {
    expect(out).not.toContain('#lancar');
    expect(out).not.toContain('id="lancar"');
  });
});

describe('os lançamentos', () => {
  const out = html(
    <WalletLots
      lots={[
        lot(),
        lot({
          id: '01JABCDEFGHJKMNPQRSTVWXYZ1',
          ticker: 'SINA3',
          quantity: 1_000_000,
          costCents: 100_000_000_000,
          boughtOn: null,
        }),
      ]}
      today="2026-11-09"
    />,
  );

  it('um cartão por lançamento: ticker, quantidade, custo total e a data (ou "sem data")', () => {
    const cards = out.match(/<li[^>]*data-lot="[^"]*"[\s\S]*?<\/li>/g)!;
    expect(cards).toHaveLength(2);
    const dd = (card: string) =>
      [...card.matchAll(/<dd[^>]*>(.*?)<\/dd>/g)].map((m) => plain(m[1]!));
    expect(dd(cards[0])).toEqual(['100', 'R$ 3.550,00', '15/10/2026']);
    expect(dd(cards[1]!)).toEqual(['1.000.000', 'R$ 1.000.000.000,00', 'sem data']);
    expect(cards[0]).toContain('data-lot="01JABCDEFGHJKMNPQRSTVWXYZ0"');
  });

  it('não mostra o empty state, e o formulário de lançar segue no modal', () => {
    expect(plain(out)).not.toContain('Você ainda não lançou');
    expect(out).toContain('<button type="submit" class="btn btn-primary">Lançar compra</button>');
  });

  it('o "Lançar compra" fica no cabeçalho da seção, antes da lista (no celular, a 21ª compra não pede rolar tudo), e o modal depois dela', () => {
    const opener = out.indexOf('<button type="button" class="btn btn-primary" disabled=""');
    expect(opener).toBeGreaterThan(-1);
    expect(opener).toBeLessThan(out.indexOf('<ul'));
    expect(out.indexOf('<ul')).toBeLessThan(out.indexOf('<dialog'));
  });

  it('editar e apagar são botões de 44 px com o nome do lançamento, desativados até o JavaScript chegar (sem ele não fazem nada)', () => {
    const buttons = [
      ...out.matchAll(/<button\b[^>]*data-action="(edit|remove)"[^>]*>(.*?)<\/button>/g),
    ];
    expect(buttons).toHaveLength(4);
    for (const [tag, kind, label] of buttons) {
      expect(tag).toMatch(/\sdisabled=""/);
      expect(tag).toMatch(/type="button"/);
      expect(label).toBe(kind === 'edit' ? 'Editar' : 'Apagar');
    }
    // o nome acessível começa pelo texto visível e diz qual lançamento é (a mesma ação em dois cartões não pode ter o mesmo nome)
    // (o "R$ " do custo leva o espaço sem quebra)
    const nb = '\u00a0';
    expect(out).toContain(`aria-label="Editar lançamento: 100 MOVE3, custo total R$${nb}3.550,00"`);
    expect(out).toContain(`aria-label="Apagar lançamento: 100 MOVE3, custo total R$${nb}3.550,00"`);
    expect(out).toContain(
      `aria-label="Editar lançamento: 1.000.000 SINA3, custo total R$${nb}1.000.000.000,00"`,
    );
  });

  it('nenhum cartão nasce no modo de edição nem de apagar: sem formulário de edição, sem pergunta', () => {
    expect(out).not.toContain('Editar lançamento de');
    expect(out).not.toContain('Sim, apagar');
    expect(out.match(/<form/g)).toHaveLength(1);
  });
});

// A pergunta de apagar e o formulário de editar são do cliente (estado). O que o código promete sobre eles que não depende do navegador:
describe('o código do cliente', () => {
  const source = readFileSync(new URL('./wallet-lots.tsx', import.meta.url), 'utf8');

  it('não abre janela do navegador: nada de confirm, alert nem prompt (a confirmação é na página)', () => {
    expect(source).not.toMatch(/\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/);
  });

  it('não lê valor do índice do pacote de contratos (leva o zod ao navegador): só tipos, e a regra do dinheiro pelo subcaminho', () => {
    const imports = [
      ...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'(@alvesting\/contracts[^']*)';/gms),
    ];
    expect(imports.length).toBeGreaterThan(0);
    for (const [statement, type, from] of imports) {
      if (from === '@alvesting/contracts') expect(type, statement).toBeTruthy();
      if (from === '@alvesting/contracts/portfolio-rules') expect(type, statement).toBeTruthy();
    }
    expect(source).not.toMatch(/from\s+'zod'/);
  });
});
