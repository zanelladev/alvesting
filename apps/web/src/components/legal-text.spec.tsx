import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalText } from './legal-text';

// O texto legal chega da api em Markdown simples (título, subtítulos, parágrafos, listas, citação e negrito) e vira elementos do React:
// nunca HTML cru. O título (h1), a versão e a vigência a página mostra à parte, acima do texto; o resto sai na ordem em que está.
const html = (text: string) => renderToStaticMarkup(<LegalText text={text} />);

const SAMPLE = [
  '# Termos de uso',
  '',
  'Versão: 0.1',
  'Vigência: 02/11/2026',
  '',
  '> RASCUNHO para revisão do autor.',
  '',
  '## 1. O que é a Alvesting',
  '',
  'A Alvesting é um projeto **acadêmico** e nada mais.',
  '',
  '## 2. Que dados tratamos',
  '',
  '- **Nome e e-mail**, que você informa.',
  '- **Senha**: guardamos só um resumo.',
  '',
  'Fim.',
].join('\n');

describe('LegalText', () => {
  it('o título, a versão e a vigência não se repetem: a página os mostra acima do texto', () => {
    const out = html(SAMPLE);
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('Termos de uso');
    expect(out).not.toContain('Versão: 0.1');
    expect(out).not.toContain('Vigência:');
  });

  it('subtítulos viram h2, parágrafos viram p e o negrito vira strong', () => {
    const out = html(SAMPLE);
    expect(out).toContain('<h2');
    expect(out).toMatch(/<h2[^>]*>1\. O que é a Alvesting<\/h2>/);
    expect(out).toMatch(
      /<p[^>]*>A Alvesting é um projeto <strong[^>]*>acadêmico<\/strong> e nada mais\.<\/p>/,
    );
    expect(out).toMatch(/<p[^>]*>Fim\.<\/p>/);
  });

  it('as linhas "- " viram uma lista só, e a citação, um blockquote', () => {
    const out = html(SAMPLE);
    expect(out.match(/<ul/g)).toHaveLength(1);
    expect(out.match(/<li/g)).toHaveLength(2);
    expect(out).toMatch(/<li[^>]*><strong[^>]*>Nome e e-mail<\/strong>, que você informa\.<\/li>/);
    expect(out).toMatch(/<blockquote[^>]*>.*RASCUNHO para revisão do autor\..*<\/blockquote>/);
  });

  it('mantém a ordem do texto', () => {
    const out = html(SAMPLE);
    const order = [
      'RASCUNHO',
      '1. O que é',
      'projeto',
      '2. Que dados',
      'Nome e e-mail',
      'Fim.',
    ].map((part) => out.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  // O texto vem da api, que o lê de um arquivo do repositório; ainda assim ele entra como TEXTO: nada vira elemento nem atributo.
  it('HTML e script no texto saem escapados, e um link em Markdown continua sendo texto', () => {
    const out = html(
      [
        '## <img src=x onerror=alert(1)>',
        '',
        'Veja <script>alert(1)</script> e [aqui](javascript:alert(1)) e **<b>x</b>**.',
        '',
        '- <a href="https://example.test">link</a>',
      ].join('\n'),
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('[aqui](javascript:alert(1))');
  });

  it('negrito sem fechar fica como está, e dois negritos na mesma linha são dois', () => {
    expect(html('Texto **sem fechar')).toContain('Texto **sem fechar');
    const two = html('**um** e **dois**');
    expect(two.match(/<strong/g)).toHaveLength(2);
  });

  it('linha seguida de linha no mesmo parágrafo fica no mesmo p, com um espaço entre elas', () => {
    expect(html('primeira\nsegunda')).toMatch(/<p[^>]*>primeira segunda<\/p>/);
  });

  it('texto vazio não quebra', () => {
    expect(html('')).toBe('');
    expect(html('# Só o título\n\nVersão: 1.0\nVigência: 01/01/2027')).toBe('');
  });

  it('texto comprido de uma palavra só quebra em vez de alargar a página', () => {
    const out = html(`## ${'a'.repeat(300)}\n\n${'b'.repeat(300)}`);
    expect(out).toContain('break-words');
  });
});
