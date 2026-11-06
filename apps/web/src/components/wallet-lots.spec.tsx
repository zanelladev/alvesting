import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Lot } from '@alvesting/contracts';
import { WalletLots } from './wallet-lots';

// Os lançamentos e o formulário da carteira, renderizados no servidor (o HTML que chega ao navegador antes do JavaScript): o que o leitor de
// tela e o teclado do celular recebem, e o que a tela faz sem JavaScript. O comportamento com JavaScript (conferir, enviar, editar, apagar com a
// confirmação, o foco depois de cada ação) os e2e conferem no navegador, em pixel-7, iphone-15 e desktop (apps/web/e2e/carteira.spec.ts).
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
      max: attr('max'),
      maxLength: attr('maxLength'),
      autoCapitalize: attr('autoCapitalize'),
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

  it('o formulário de lançar é nomeado pelo título da seção e nasce desativado: sem JavaScript não se envia nada', () => {
    expect(out).toMatch(/<form[^>]*aria-labelledby="lancar-titulo"/);
    expect(out).toMatch(/<form[^>]*method="post"/);
    expect(out).toMatch(/<form[^>]*noValidate/);
    expect(out).toContain('<fieldset disabled=""');
    expect(out).toContain('id="lancar-titulo"');
    expect(out).toContain('>Lançar compra</button>');
    expect(out).not.toContain('Cancelar edição');
  });

  it('o teclado do celular: números para a quantidade, números com vírgula para o valor, caixa alta para o ticker', () => {
    const [ticker, quantity, unit, total, value, date] = inputs(out);
    expect(ticker).toMatchObject({ name: 'ticker', maxLength: '12', autoCapitalize: 'characters' });
    expect(ticker!.tag).toMatch(/class="[^"]*\buppercase\b/);
    expect(quantity).toMatchObject({ name: 'quantity', inputMode: 'numeric' });
    expect(unit).toMatchObject({ name: 'mode', type: 'radio' });
    expect(total).toMatchObject({ name: 'mode', type: 'radio' });
    expect(value).toMatchObject({ name: 'value', inputMode: 'decimal' });
    // um campo de texto com teclado de números, e não type="number": a vírgula, o ponto de milhar e o "e" do expoente não valem
    expect(quantity!.type).toBe('text');
    expect(value!.type).toBe('text');
    expect(date).toMatchObject({ name: 'boughtOn', type: 'date', max: '2026-11-09' });
  });

  it('o modo de preço são dois radios nativos num grupo com legenda, o "preço por ação" já marcado', () => {
    expect(out).toContain(
      '<legend class="font-display text-sm font-medium text-ink">Como você vai informar o valor?</legend>',
    );
    const radios = inputs(out).filter((input) => input.type === 'radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]!.tag).toMatch(/\schecked=""/);
    expect(radios[1]!.tag).not.toMatch(/\schecked/);
    expect(radios.map((r) => r.tag.match(/value="([^"]*)"/)![1])).toEqual(['unit', 'total']);
    expect(plain(out)).toContain('Preço por ação');
    expect(plain(out)).toContain('Valor total pago');
    // o alvo de toque do radio (44 px) e o desenho redondo estão na classe
    expect(radios.every((r) => /class="radio"/.test(r.tag))).toBe(true);
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
    for (const input of inputs(out).filter((i) => i.type !== 'radio')) {
      expect(input.id, input.tag).toBeTruthy();
      expect(out, `rótulo de ${input.name}`).toMatch(
        new RegExp(`<label[^>]*for="${input.id!.replace(/[^\\w-]/g, '.')}"`),
      );
    }
    // o radio fica DENTRO do rótulo: o texto inteiro é o alvo de toque, e o leitor de tela lê "Preço por ação, botão de opção"
    expect(out).toMatch(
      /<label[^>]*><input type="radio"[^>]*value="unit"\/><span[^>]*>Preço por ação<\/span><\/label>/,
    );
    expect(out).toMatch(
      /<label[^>]*><input type="radio"[^>]*value="total"\/><span[^>]*>Valor total pago<\/span><\/label>/,
    );
    expect(out).toMatch(/>Preço por ação \(R\$\)<\/label>/);
    expect(plain(out)).toContain(
      'O preço de uma ação, em reais, com vírgula nos centavos. Ex.: 35,50.',
    );
    expect(out).toMatch(/>Ticker<\/label>/);
    expect(out).toMatch(/>Quantidade<\/label>/);
    expect(out).toMatch(/>Data da compra \(opcional\)<\/label>/);
  });

  it('o aviso do resultado existe desde o começo, vazio, para o leitor de tela anunciar o que chega depois', () => {
    expect(out).toMatch(/<p role="status" data-notice="" class="sr-only"><\/p>/);
  });

  it('quem não sabe o código busca a ação noutra aba, sem entregar a janela e sem perder o formulário', () => {
    expect(out).toMatch(
      /<a href="\/acoes" target="_blank" rel="noopener noreferrer"[^>]*>Buscar uma ação<span class="sr-only"> \(abre em outra aba\)<\/span><\/a>/,
    );
  });

  it('sem lançamentos não há atalho para o formulário: ele está logo abaixo do aviso', () => {
    expect(out).not.toContain('href="#lancar"');
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

  it('não mostra o empty state, e o formulário de lançar segue na página', () => {
    expect(plain(out)).not.toContain('Você ainda não lançou');
    expect(out).toContain('>Lançar compra</button>');
  });

  it('um atalho antes da lista leva ao formulário de lançar, que fica depois dela (no celular, a 21ª compra não pede rolar tudo)', () => {
    const link = out.indexOf('<a href="#lancar"');
    expect(link).toBeGreaterThan(-1);
    expect(out.slice(link)).toMatch(/^<a href="#lancar"[^>]*>Ir para o formulário de lançar<\/a>/);
    expect(link).toBeLessThan(out.indexOf('<ul'));
    expect(out).toContain('id="lancar"');
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
