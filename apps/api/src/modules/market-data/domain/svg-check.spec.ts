import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, svgRefusal } from './svg-check.js';

// O validador dos logos (ADR 0036; docs/DADOS.md, seção 3a): uma função pura, sem rede. Os SVG daqui são escritos à mão; os ataques são os
// conhecidos de SVG (script, evento, href javascript:, use externo, entidade, style com @import e url externo) e os disfarces deles
// (prefixo de namespace, maiúsculas, entidade de caractere, escape de CSS, comentário no meio da palavra).
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const svg = (inner: string, attributes = '') => `<svg ${NS} ${XLINK}${attributes}>${inner}</svg>`;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('svgRefusal: o logo bom passa', () => {
  it.each([
    ['o mínimo', svg('<path d="M0 0h24v24H0z" fill="#123456"/>', ' viewBox="0 0 24 24"')],
    [
      'a declaração XML, o comentário do editor e o título',
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- Generator: Adobe Illustrator 27.0 -->\n${svg('<title>Empresa</title><rect width="10" height="10"/>')}\n`,
    ],
    ['o BOM do UTF-8 no começo', `\uFEFF${svg('<circle r="4"/>')}`],
    [
      'o gradiente e o recorte por referência interna',
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs>' +
          '<rect fill="url(#g)" clip-path="url(\'#c\')" style="stroke:url(&quot;#g&quot;)" width="10" height="10"/>',
      ),
    ],
    [
      'o <use> interno, com href e xlink:href',
      svg('<defs><path id="a" d="M0 0"/></defs><use href="#a"/><use xlink:href="#a" x="2"/>'),
    ],
    [
      'o <style> com CSS e com CDATA',
      svg(
        '<style>.a{fill:url(#g)} .b{fill:#000}</style><style><![CDATA[ .c { fill: #FFF; } ]]></style><path class="a b c" d="M0 0"/>',
      ),
    ],
    ['a imagem embutida em PNG', svg(`<image href="${PNG}" width="1" height="1"/>`)],
    [
      'a imagem embutida em WEBP, pelo xlink',
      svg('<image xlink:href="data:image/webp;base64,UklGRg==" width="1"/>'),
    ],
    [
      'os metadados do Inkscape (endereço só como nome, fora de href, src e url())',
      svg(
        '<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><dc:type xmlns:dc="http://purl.org/dc/elements/1.1/" rdf:resource="http://purl.org/dc/dcmitype/StillImage"/></rdf:RDF></metadata>' +
          '<sodipodi:namedview xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" inkscape:export-filename="C:\\logos\\x.png" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"/>',
      ),
    ],
    [
      'as entidades de caractere em texto e atributo',
      svg('<text x="1" font-family="&apos;A&apos;">S&amp;A &#169; &#xE9;</text>'),
    ],
    ['o <svg> vazio', `<svg ${NS}/>`],
  ])('%s', (_name, text) => {
    expect(svgRefusal(text)).toBeNull();
  });

  it('exatamente no teto passa; um byte acima, não (o teto conta bytes, não caracteres)', () => {
    const open = `<svg ${NS}><!--`;
    const close = '--></svg>';
    const atCap = `${open}${'a'.repeat(LOGO_MAX_BYTES - open.length - close.length)}${close}`;
    expect(Buffer.byteLength(atCap)).toBe(LOGO_MAX_BYTES);
    expect(svgRefusal(atCap)).toBeNull();
    // "é" tem 2 bytes em UTF-8: o mesmo número de caracteres passa do teto
    expect(svgRefusal(atCap.replace('aa', 'é'))).toBeNull();
    expect(svgRefusal(atCap.replace('a', 'é'))).toMatch(/teto/);
    expect(LOGO_MAX_BYTES).toBe(200 * 1024);
  });
});

describe('svgRefusal: os ataques conhecidos de SVG são recusados, com o motivo', () => {
  it.each([
    // script
    ['<script>', svg('<script>alert(1)</script>'), /<script>/],
    [
      '<script> com prefixo de namespace',
      svg('<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>'),
      /<script>/,
    ],
    ['<SCRIPT> em maiúsculas', svg('<SCRIPT>alert(1)</SCRIPT>'), /<script>/],
    [
      '<script> do XHTML dentro do SVG',
      svg('<h:script xmlns:h="http://www.w3.org/1999/xhtml" src="x.js"/>'),
      /<script>/,
    ],
    // eventos
    ['onload na raiz', `<svg ${NS} onload="alert(1)"><rect/></svg>`, /on\*/],
    ['onclick em maiúsculas', svg('<rect ONCLICK="alert(1)"/>'), /on\*/],
    [
      'onmouseover com prefixo',
      svg('<rect x:onmouseover="alert(1)" xmlns:x="http://www.w3.org/2000/svg"/>'),
      /on\*/,
    ],
    ['onbegin', svg('<rect onbegin="alert(1)"/>'), /on\*/],
    // href javascript:
    ['href javascript:', svg('<a href="javascript:alert(1)"><rect/></a>'), /javascript:/],
    [
      'xlink:href javascript: com maiúsculas e espaço',
      svg('<a xlink:href="  JaVaScRiPt:alert(1)"><rect/></a>'),
      /javascript:/,
    ],
    [
      'javascript: com entidade de caractere',
      svg('<a href="&#106;avascript:alert(1)"><rect/></a>'),
      /javascript:/,
    ],
    [
      'javascript: com tabulação no meio',
      svg('<a href="java&#9;script:alert(1)"><rect/></a>'),
      /javascript:/,
    ],
    [
      'javascript: em hexadecimal',
      svg('<a href="&#x6A;&#x61;vascript:alert(1)"><rect/></a>'),
      /javascript:/,
    ],
    ['vbscript:', svg('<a href="vbscript:msgbox(1)"><rect/></a>'), /javascript:/],
    // use externo e referências de fora
    [
      '<use> externo (https)',
      svg('<use href="https://exemplo.invalid/a.svg#x"/>'),
      /referência externa/,
    ],
    [
      '<use> externo (//)',
      svg('<use xlink:href="//exemplo.invalid/a.svg#x"/>'),
      /referência externa/,
    ],
    [
      '<use> externo (\\\\, que o navegador lê como //)',
      svg('<use href="\\\\exemplo.invalid/a.svg#x"/>'),
      /referência externa/,
    ],
    [
      '<image> externa (http)',
      svg('<image href="http://exemplo.invalid/a.png"/>'),
      /referência externa/,
    ],
    ['<image> por caminho relativo', svg('<image href="a.png"/>'), /referência externa/],
    [
      '<feImage> externa',
      svg('<filter id="f"><feImage href="https://exemplo.invalid/a.png"/></filter>'),
      /referência externa/,
    ],
    [
      'src externo',
      svg('<h:img xmlns:h="http://www.w3.org/1999/xhtml" src="https://exemplo.invalid/a.png"/>'),
      /referência externa/,
    ],
    [
      'a imagem embutida em SVG (pode trazer script)',
      svg('<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>'),
      /imagem embutida/,
    ],
    [
      'data: de HTML',
      svg('<a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"><rect/></a>'),
      /imagem embutida/,
    ],
    [
      'xml:base de fora',
      svg('<use href="#a"/>', ' xml:base="https://exemplo.invalid/"'),
      /xml:base/,
    ],
    // entidades e DOCTYPE
    [
      '<!DOCTYPE> com <!ENTITY> (XXE)',
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg('<text>&x;</text>')}`,
      /DOCTYPE/,
    ],
    ['<!ENTITY> solto', svg('<!ENTITY x "y"><rect/>'), /DOCTYPE/],
    [
      '<!DOCTYPE> sozinho',
      `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${svg('<rect/>')}`,
      /DOCTYPE/,
    ],
    [
      'entidade sem declaração num atributo',
      svg('<text font-family="&nbsp;">a</text>'),
      /entidade/,
    ],
    // style com @import e url externo
    [
      '<style> com @import url()',
      svg('<style>@import url(https://exemplo.invalid/a.css);</style>'),
      /@import/,
    ],
    [
      '<style> com @import de texto',
      svg('<style>@import "https://exemplo.invalid/a.css";</style>'),
      /@import/,
    ],
    [
      '@import partido por um comentário XML',
      svg('<style>@imp<!-- -->ort url(https://exemplo.invalid/a.css);</style>'),
      /@import/,
    ],
    [
      '@import escrito com escape de CSS',
      svg('<style>@\\69mport url(https://exemplo.invalid/a.css);</style>'),
      /@import/,
    ],
    [
      '@import com entidade de caractere',
      svg('<style>&#64;import url(https://exemplo.invalid/a.css);</style>'),
      /@import/,
    ],
    [
      '<style> com url() externo',
      svg('<style>.a{fill:url(https://exemplo.invalid/a.svg#g)}</style>'),
      /url\(\) externo/,
    ],
    [
      'url() externo escrito com escape de CSS',
      svg('<style>.a{fill:\\75 rl(https://exemplo.invalid/a.svg#g)}</style>'),
      /url\(\) externo/,
    ],
    [
      'image-set() com endereço no CSS',
      svg('<style>.a{background-image:image-set("https://exemplo.invalid/a.png" 1x)}</style>'),
      /endereço no CSS/,
    ],
    [
      'url() externo no atributo style',
      svg('<rect style="fill:url(//exemplo.invalid/a.svg#g)"/>'),
      /url\(\) externo/,
    ],
    [
      'url() externo num atributo de apresentação',
      svg('<rect fill="url(http://exemplo.invalid/a.svg#g)"/>'),
      /url\(\) externo/,
    ],
    [
      'url() externo com escape num atributo de apresentação',
      svg('<rect filter="\\75 rl(https://exemplo.invalid/f.svg#f)"/>'),
      /url\(\) externo/,
    ],
    ['url() com javascript:', svg('<rect style="fill:url(javascript:alert(1))"/>'), /javascript:/],
    [
      'url() de imagem embutida em SVG',
      svg('<rect fill="url(data:image/svg+xml;base64,PHN2Zz4=)"/>'),
      /url\(\) externo/,
    ],
    // elementos que embutem ou carregam outro documento
    [
      '<foreignObject>',
      svg('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'),
      /<foreignobject>/,
    ],
    ['<iframe>', svg('<h:iframe xmlns:h="http://www.w3.org/1999/xhtml" src="#a"/>'), /<iframe>/],
    ['<embed>', svg('<embed src="#a"/>'), /<embed>/],
    ['<object>', svg('<object data="#a"/>'), /<object>/],
    // animação que troca atributo depois de carregar
    [
      '<set> que troca o href',
      svg('<a href="#a"><set attributeName="href" to="#b"/><rect/></a>'),
      /<set>/,
    ],
    [
      '<animate> que troca o href',
      svg('<use href="#a"><animate attributeName="href" values="#b"/></use>'),
      /<animate>/,
    ],
    // instrução de processamento, codificação e caractere nulo
    [
      'folha de estilo por instrução de processamento',
      `<?xml-stylesheet href="https://exemplo.invalid/a.css"?>${svg('<rect/>')}`,
      /instrução/,
    ],
    ['instrução de processamento no meio', svg('<?php echo 1 ?><rect/>'), /instrução/],
    [
      'a declaração com outra codificação',
      `<?xml version="1.0" encoding="UTF-7"?>${svg('<rect/>')}`,
      /UTF-8/,
    ],
    ['caractere nulo', svg('<text>a\u0000b</text>'), /nulo/],
  ])('%s', (_name, text, reason) => {
    expect(svgRefusal(text)).toMatch(reason);
  });
});

describe('svgRefusal: o que não é um SVG que o validador lê é recusado', () => {
  it.each([
    ['vazio', '', /raiz/],
    ['a raiz não é <svg>', '<html><body/></html>', /raiz/],
    [
      '<svg> em maiúsculas (outro elemento para o XML)',
      '<SVG xmlns="http://www.w3.org/2000/svg"/>',
      /raiz/,
    ],
    ['texto antes da raiz', `oi${svg('<rect/>')}`, /fora do <svg>/],
    ['texto depois da raiz', `${svg('<rect/>')}oi`, /fora do <svg>/],
    ['duas raízes', `${svg('<rect/>')}${svg('<rect/>')}`, /raiz/],
    ['marcação aberta no fim', `<svg ${NS}><g>`, /marcação/],
    ['fechamento trocado', svg('<g></a>'), /marcação/],
    ['atributo sem aspas', svg('<rect width=10/>'), /marcação/],
    [
      '"<" dentro do valor de um atributo',
      svg('<rect x="<!--" /><rect onload="alert(1)" y="-->"/>'),
      /marcação/,
    ],
    ['comentário sem fim', `<svg ${NS}><!-- <script>`, /marcação/],
    ['CDATA sem fim', svg('<style><![CDATA[ .a{}'), /marcação/],
  ])('%s', (_name, text, reason) => {
    expect(svgRefusal(text)).toMatch(reason);
  });

  it('o motivo é do vocabulário do validador, nunca um pedaço do SVG (vai ao log)', () => {
    const reason = svgRefusal(svg('<script>segredo-do-svg</script>'));
    expect(reason).not.toContain('segredo');
    expect(svgRefusal(svg('<rect onsegredo="x"/>'))).not.toContain('segredo');
  });

  it('um SVG enorme de atributos tortos é recusado rápido (nada de expressão regular que volte atrás sem fim)', () => {
    const started = performance.now();
    expect(svgRefusal(`<svg ${NS}><rect${' a="1"'.repeat(20_000)} b=1/></svg>`)).toMatch(
      /marcação/,
    );
    expect(svgRefusal(`<svg ${NS}><rect${' '.repeat(150_000)}</svg>`)).toMatch(/marcação/);
    expect(svgRefusal(`<svg ${NS}><style>${'url(#a)'.repeat(25_000)}</style></svg>`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
