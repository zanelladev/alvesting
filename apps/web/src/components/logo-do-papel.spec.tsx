import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogoDoPapel } from './logo-do-papel';

// O logo de um papel ao lado do ticker (ADR 0036, "Como o site mostra"; docs/TELAS.md, "Logos das ações"): com a versão do índice, o <img> da
// rota do site; sem ela, o monograma. Os dois são decorativos (o ticker está ao lado) e ficam fora do texto que o leitor de tela e o e2e leem.
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
// o texto como o textContent o veria: sem as tags (o ::before do monograma não é texto)
const text = (out: string) => out.replace(/<[^>]+>/g, '');
const attributes = (out: string) =>
  Object.fromEntries([...out.matchAll(/\s([\w-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
const classes = (out: string) => attributes(out).class!.split(' ');

describe('LogoDoPapel', () => {
  it('com a versão: o <img> da rota do site, decorativo, de tamanho fixo, preguiçoso e no círculo branco com o contorno de 1 px', () => {
    const out = html(<LogoDoPapel ticker="PETR4" versao="659e50f6c54d8fca" />);
    expect(out).toMatch(/^<img [^>]*\/>$/);
    expect(attributes(out)).toMatchObject({
      src: '/logos/PETR4.svg?v=659e50f6c54d8fca',
      alt: '',
      width: '16',
      height: '16',
      loading: 'lazy',
      decoding: 'async',
      'data-logo': 'imagem',
    });
    expect(attributes(out)).not.toHaveProperty('aria-hidden');
    // o tamanho das listas e das tabelas (o do Rallies, 16 px), o círculo branco nos dois temas e o contorno da better-ui: preto a 10% no
    // claro e branco a 10% no escuro, por dentro da borda (os tokens `logo-fundo` e `logo-contorno` do globals.css: o `light-dark()` segue o
    // `color-scheme` da página, o do tema)
    // inline-block: o preflight do Tailwind faz todo <img> virar bloco, e no h1 (texto corrido) o logo ficaria numa linha só dele
    expect(classes(out)).toEqual(
      expect.arrayContaining([
        'inline-block',
        'size-4',
        'shrink-0',
        'rounded-full',
        'bg-logo-fundo',
        'outline',
        '-outline-offset-1',
        'outline-logo-contorno',
      ]),
    );
    expect(text(out)).toBe('');
  });

  it('o do cabeçalho da página da ação tem 40 px, e o resto é igual', () => {
    const out = html(<LogoDoPapel ticker="PETR4" versao="659e50f6c54d8fca" tamanho="cabecalho" />);
    expect(attributes(out)).toMatchObject({ width: '40', height: '40', 'data-logo': 'imagem' });
    expect(classes(out)).toContain('size-10');
    expect(classes(out)).not.toContain('size-4');
  });

  it('sem a versão: o monograma, a primeira letra pelo atributo (fora do texto), decorativo, com as cores do tema', () => {
    const out = html(<LogoDoPapel ticker="VALE3" versao={undefined} />);
    expect(out).toMatch(/^<span [^>]*><\/span>$/);
    expect(attributes(out)).toMatchObject({
      'aria-hidden': 'true',
      'data-logo': 'monograma',
      'data-inicial': 'V',
    });
    expect(classes(out)).toEqual(
      expect.arrayContaining([
        'size-4',
        'rounded-full',
        'bg-surface-strong',
        'text-muted',
        'before:content-[attr(data-inicial)]',
      ]),
    );
    expect(text(out)).toBe('');
    expect(out).not.toContain('<img');
    const big = html(<LogoDoPapel ticker="VALE3" versao={undefined} tamanho="cabecalho" />);
    expect(classes(big)).toContain('size-10');
  });

  it('o className de quem chama vai junto (o respiro até o ticker)', () => {
    expect(
      classes(html(<LogoDoPapel ticker="PETR4" versao="659e50f6c54d8fca" className="mr-3.5" />)),
    ).toContain('mr-3.5');
    expect(
      classes(html(<LogoDoPapel ticker="PETR4" versao={undefined} className="mr-3" />)),
    ).toContain('mr-3');
  });

  it('o endereço vai codificado (o ticker e a versão vêm da api, mas a URL não confia neles)', () => {
    const out = html(<LogoDoPapel ticker="A B" versao={'v"&x'} />);
    expect(attributes(out).src).toBe('/logos/A%20B.svg?v=v%22%26x');
  });

  // Serve aos componentes de servidor e aos de cliente: sem 'use client', sem import nenhum (nada só do servidor, como lib/quotes.ts ou
  // lib/logos.ts, e nada do índice de @alvesting/contracts, que levaria o zod ao navegador).
  it('o arquivo não importa nada e não é de cliente', () => {
    const source = readFileSync(new URL('./logo-do-papel.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*['"]use (client|server)['"];?\s*$/m);
  });
});
