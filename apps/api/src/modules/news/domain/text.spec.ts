import { describe, expect, it } from 'vitest';
import { SNIPPET_MAX, TITLE_MAX, cleanText, truncate } from './text.js';

// Caracteres invisíveis são montados por código de ponto: escrever o literal no arquivo esconderia o teste de quem lê.
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

// Texto de terceiro (título e trecho de RSS, assunto da CVM, nome de empresa) é dado, nunca instrução: entra no
// banco e no briefing depois desta limpeza. Os casos abaixo são os que vêm dos feeds de verdade (CDATA com HTML,
// entidades, caractere de controle na CVM) e os que um atacante mandaria.

describe('cleanText: HTML', () => {
  it('tira as tags e mantém o texto', () => {
    expect(cleanText('<p>Olá <b>mundo</b></p>')).toBe('Olá mundo');
  });

  it('não cola palavras de blocos vizinhos', () => {
    expect(cleanText('<p>um</p><p>dois</p><br/>três')).toBe('um dois três');
  });

  it('tag de linha não deixa espaço onde não havia: "<b>forte</b>." continua "forte."', () => {
    expect(cleanText('Texto <b>forte</b>. E <a href="https://x.com">link</a>, <i>fim</i>')).toBe(
      'Texto forte. E link, fim',
    );
    expect(cleanText('pre<b>fixo</b>')).toBe('prefixo');
  });

  it('tira o conteúdo de script e style, não só as tags', () => {
    expect(cleanText('a<script>alert("x")</script>b<style>p{color:red}</style>c')).toBe('a b c');
    expect(cleanText('a<SCRIPT type="text/javascript">1</SCRIPT >b')).toBe('a b');
  });

  it('tira comentário e declaração', () => {
    expect(cleanText('a<!-- fim --> b <!DOCTYPE html><?xml version="1.0"?>c')).toBe('a b c');
  });

  it('tag sem fechar e comentário sem fechar vão até o fim, sem sobrar pedaço', () => {
    expect(cleanText('texto <a href="http://x.com/')).toBe('texto');
    expect(cleanText('texto <!-- nunca fecha')).toBe('texto');
    expect(cleanText('texto <script>nunca fecha')).toBe('texto');
  });

  it('imagem no começo do trecho (o que o Agência Brasil e o InfoMoney mandam) não deixa lixo', () => {
    const html =
      '<p><img width="300" height="200" src="https://x.com/a.jpg" alt="Foto"></p><p>Texto da matéria.</p>';
    expect(cleanText(html)).toBe('Texto da matéria.');
  });

  it('o sinal de menor solto no texto fica (não é tag)', () => {
    expect(cleanText('lucro < 5% e 3 < 4')).toBe('lucro < 5% e 3 < 4');
  });

  // Dois desvios que a limpeza deixava passar (revisão de segurança): o invisível era tirado depois do HTML, e a tag mais
  // interna saía sozinha e juntava as pontas de outra.
  it('invisível no meio da tag não esconde a tag: "<" + largura zero + "script>" some', () => {
    expect(cleanText('<' + cp(0x200b) + 'script>alert(document.cookie)</script> PETR4 sobe')).toBe(
      'PETR4 sobe',
    );
    expect(cleanText('<' + cp(0xe0101, 0xfe0f, 0x3164) + 'b>negrito</b>')).toBe('negrito');
  });

  it('invisível que nasce de uma entidade também não esconde a tag', () => {
    expect(cleanText('&lt;&#x200B;script&gt;alert(1)&lt;/script&gt;ok')).toBe('ok');
  });

  it('tags aninhadas que se juntam depois de a de dentro sair também somem', () => {
    expect(cleanText('<<<b>b>script>alert(1)</script>')).toBe('');
    expect(cleanText('PETR4 sobe <<<b>b>img src=x onerror=alert(1)>')).toBe('PETR4 sobe');
    expect(cleanText('x<<b>/script>y')).toBe('xy');
  });

  it('aninhamento fundo demais para estabilizar perde o "<" que sobrar, em tempo curto', () => {
    const deep = '<'.repeat(2000) + 'b>'.repeat(2000);
    const started = performance.now();
    const out = cleanText(deep);
    expect(out).not.toContain('<');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  // Propriedade: por mais que se embaralhem "<", ">", "!", entidades e invisíveis, a saída nunca tem o começo de uma tag.
  // O gerador é fixo (LCG), então o teste é o mesmo em toda máquina.
  it('nenhuma saída tem o começo de uma tag, por mais que a entrada embaralhe os pedaços', () => {
    const pieces = [
      '<',
      '<',
      '>',
      '/',
      '!',
      '?',
      '--',
      'a',
      'b',
      'script',
      'style',
      'img src=x',
      ' ',
      '\n',
      '"',
      '=',
      '&lt;',
      '&gt;',
      '&#60;',
      '&#x3c;',
      '&amp;lt;',
      cp(0x200b),
      cp(0xfe0f),
      cp(0xe0101),
      cp(0x3164),
      cp(0xad),
      cp(0xa0),
    ];
    let state = 12345;
    const next = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state >>> 8;
    };
    for (let round = 0; round < 3000; round += 1) {
      const length = 1 + (next() % 40);
      let raw = '';
      for (let i = 0; i < length; i += 1) raw += pieces[next() % pieces.length];
      expect(cleanText(raw)).not.toMatch(/<\/?[A-Za-z!?]/);
    }
  });
});

describe('cleanText: entidades', () => {
  it('decodifica as entidades comuns, numéricas e nomeadas', () => {
    expect(cleanText('A &amp; B &lt; C &gt; &quot;D&quot; &#39;E&#39; &apos;F&apos;')).toBe(
      "A & B < C > \"D\" 'E' 'F'",
    );
    expect(cleanText('2022 &#8211; 2026 &#x2013; fim &hellip; &mdash; &ldquo;oi&rdquo;')).toBe(
      '2022 – 2026 – fim … — “oi”',
    );
    expect(cleanText('a&nbsp;b&ccedil;&atilde;o &Eacute;&eacute; &ordm;')).toBe('a bção Éé º');
  });

  it('entidade desconhecida ou torta fica como veio', () => {
    expect(cleanText('&naoexiste; &amp &#xZZ; &#;')).toBe('&naoexiste; &amp &#xZZ; &#;');
  });

  it('referência numérica inválida (zero, substituto, fora do Unicode) some', () => {
    expect(cleanText('a&#0;b&#xD800;c&#1114112;d')).toBe('abcd');
  });

  it('decodifica uma vez só: &amp;lt; vira &lt;, não <', () => {
    expect(cleanText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  it('HTML escapado duas vezes (RSS que entidade-codifica o description) também é limpo', () => {
    expect(cleanText('&lt;p&gt;Texto &lt;b&gt;forte&lt;/b&gt;&lt;/p&gt;')).toBe('Texto forte');
    expect(cleanText('&lt;script&gt;alert(1)&lt;/script&gt;ok')).toBe('ok');
  });
});

describe('cleanText: caracteres invisíveis e de controle', () => {
  it('tira controle de C0 e C1 (a CVM manda BEL no começo de assunto)', () => {
    expect(cleanText('\u0007Deliberar sobre a remuneração')).toBe('Deliberar sobre a remuneração');
    expect(cleanText('a\u0000b\u001bc\u007fd\u009fe')).toBe('abcde');
  });

  it('quebra de linha e tabulação viram espaço', () => {
    expect(cleanText('linha 1\nlinha 2\r\n\tlinha 3' + cp(0x2028) + 'fim' + cp(0x85) + 'fim')).toBe(
      'linha 1 linha 2 linha 3 fim fim',
    );
  });

  it('tira largura zero, soft hyphen, BOM e sobreposição de direção (texto escondido ou invertido)', () => {
    expect(cleanText('ig' + cp(0x200b) + 'no' + cp(0x200d) + 're' + cp(0xad, 0xfeff))).toBe(
      'ignore',
    );
    expect(cleanText('abc' + cp(0x202e) + 'def' + cp(0x2066) + 'g' + cp(0x2069))).toBe('abcdefg');
  });

  it('tira os caracteres de tag do plano 14 (instrução invisível)', () => {
    const hidden = String.fromCodePoint(0xe0049, 0xe0067, 0xe006e); // "Ign" em tag characters
    expect(cleanText(`ok${hidden}`)).toBe('ok');
  });

  it('tira os ignoráveis por padrão que a categoria C não pega: seletores de variação e preenchimentos', () => {
    // seletores de variação (U+E0100 em diante e U+FE00 a U+FE0F), preenchimentos de Hangul, Khmer e Mongol
    const hidden = cp(0xe0101, 0xe0102, 0xe0103, 0xfe00, 0xfe0f, 0x3164, 0x115f, 0x1160, 0xffa0);
    expect(cleanText('A' + hidden + 'B' + cp(0x17b4, 0x180b, 0x034f) + 'C')).toBe('ABC');
  });

  it('tira substituto solto e uso privado, mas mantém emoji', () => {
    expect(cleanText('a' + cp(0xd800) + 'b' + cp(0xe000) + 'c 😀')).toBe('abc 😀');
  });

  it('colapsa espaços de todo tipo e apara as pontas', () => {
    expect(cleanText('  a ' + cp(0xa0, 0x2003) + ' b' + cp(0x3000) + 'c  ')).toBe('a b c');
  });

  it('normaliza para NFC', () => {
    expect(cleanText('é')).toBe('é');
    expect(cleanText('Itaú'.normalize('NFD'))).toBe('Itaú'.normalize('NFC'));
  });
});

describe('cleanText: tamanho', () => {
  it('sem teto, devolve o texto limpo inteiro', () => {
    expect(cleanText('x'.repeat(1000))).toHaveLength(1000);
  });

  it('com teto, corta em caracteres (não bytes) e marca com reticências', () => {
    const out = cleanText('palavra '.repeat(100), 20);
    expect(Array.from(out)).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('texto no limite exato não ganha reticências', () => {
    expect(cleanText('a'.repeat(300), SNIPPET_MAX)).toBe('a'.repeat(300));
    expect(cleanText('a'.repeat(301), SNIPPET_MAX)).toHaveLength(300);
  });

  it('não parte um par substituto ao cortar', () => {
    const out = cleanText('😀'.repeat(50), 10);
    expect(Array.from(out)).toHaveLength(10);
    expect(out).toBe('😀'.repeat(9) + '…');
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(out)).toBe(false);
  });

  it('os tetos de título e trecho são 300 caracteres', () => {
    expect(TITLE_MAX).toBe(300);
    expect(SNIPPET_MAX).toBe(300);
  });

  it('entrada enorme (1 MB de "<" ou de "<!--") é limpa em tempo curto, sem explodir', () => {
    const started = Date.now();
    expect(cleanText('<'.repeat(1_000_000)).length).toBeLessThanOrEqual(10_000);
    expect(cleanText('<!--'.repeat(250_000))).toBe('');
    expect(cleanText('<a '.repeat(300_000))).toBe('');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('truncate', () => {
  it('corta com reticências dentro do teto', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abcdef', 6)).toBe('abcdef');
    expect(truncate('', 4)).toBe('');
  });

  it('apara o espaço antes das reticências', () => {
    expect(truncate('ab cd ef', 4)).toBe('ab…');
  });
});
