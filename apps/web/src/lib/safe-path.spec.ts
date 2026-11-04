import { describe, expect, it } from 'vitest';
import { safeInternalPath } from './safe-path';

// O "proximo" da URL de entrar (/entrar?proximo=/conta) vem de quem montou o link, ou seja, pode ser de um atacante: o redirecionamento
// depois do login só vai para um caminho do próprio site. O que não for, volta ao padrão.
describe('safeInternalPath', () => {
  it.each([
    ['/conta'],
    ['/termos'],
    ['/modelos/fake-contrarian'],
    ['/acoes?q=PETR'],
    ['/conta#dados'],
    ['/'],
    // %2F não é "/" para o navegador resolver a autoridade: continua sendo um caminho deste site
    ['/%2F%2Fexample.test'],
  ])('aceita o caminho interno %s', (path) => {
    expect(safeInternalPath(path, '/conta')).toBe(path);
  });

  it.each([
    ['endereço absoluto', 'https://example.test/golpe'],
    ['endereço absoluto http', 'http://example.test'],
    ['sem esquema, com duas barras', '//example.test/golpe'],
    ['barra invertida (o navegador a trata como barra)', '/\\example.test'],
    ['duas barras invertidas', '\\\\example.test'],
    ['barra e barra invertida', '/\\/example.test'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['relativo, sem a barra do começo', 'conta'],
    ['vazio', ''],
    ['só espaço', ' '],
    ['com tabulação (o navegador a descarta e vira //)', '/\t/example.test'],
    ['com quebra de linha', '/\n/example.test'],
    ['com espaço', '/ /example.test'],
    ['com NUL', '/conta\u0000'],
    ['com caractere de controle', '/conta\u001f'],
    ['comprido demais', `/${'a'.repeat(2048)}`],
  ])('recusa %s e volta ao padrão', (_nome, path) => {
    expect(safeInternalPath(path, '/conta')).toBe('/conta');
  });

  it.each([[undefined], [['/conta', '/termos']], [42 as unknown as string]])(
    'o que não é um texto (%j) volta ao padrão',
    (value) => {
      expect(safeInternalPath(value, '/conta')).toBe('/conta');
    },
  );

  it('o padrão é o que o chamador pede', () => {
    expect(safeInternalPath('//example.test', '/')).toBe('/');
  });
});
