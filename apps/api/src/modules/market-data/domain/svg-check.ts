// O validador dos logos das ações (ADR 0036; docs/DADOS.md, seção 3a). O SVG vem de fora (icons.brapi.dev), fica no nosso banco e o site o
// serve do próprio domínio: o que passa aqui é o que o visitante recebe. Função pura, sem dependência: um leitor pequeno de XML que entende
// só o que um logo usa (a declaração, comentários, CDATA, elementos e atributos entre aspas) e RECUSA o resto. Na dúvida, recusa: o papel
// fica com o monograma.
//
// Recusa: raiz que não é <svg>; <script>, <foreignObject>, <iframe>, <embed>, <object> e os outros elementos de BLOCKED_ELEMENTS; atributo
// de evento (on*); <!DOCTYPE> e <!ENTITY>; instrução de processamento (<?xml-stylesheet?>); javascript: em qualquer atributo; href e src que
// não sejam #id ou imagem embutida em data:image/(png|jpeg|gif|webp);base64; url() que não seja #id ou essa imagem; @import e endereço (//)
// no CSS; e o que passa de LOGO_MAX_BYTES. Os nomes valem sem o prefixo de namespace e sem caixa (svg:script e SCRIPT são <script>), e os
// valores, depois das entidades de caractere do XML (&#106;), dos escapes do CSS (\75) e sem os espaços e controles que o navegador ignora
// num endereço (java&#9;script:).
//
// O motivo da recusa vai ao log com o ticker: é sempre do vocabulário daqui, nunca um pedaço do SVG.
// ponytail: lista do que recusar, e não lista do que aceitar (um logo exportado do Illustrator ou do Inkscape traz metadados de nomes que
// nenhuma lista curta prevê). O teto é a lista: um vetor novo de SVG pede uma linha aqui. A outra camada é a da resposta (CSP com
// `default-src 'none'` e `sandbox`, rota interna dos logos), e o site os mostra em <img>, que não roda script nem busca nada de fora.

export const LOGO_MAX_BYTES = 200 * 1024;

const BLOCKED_ELEMENTS: ReadonlySet<string> = new Set([
  'script',
  'foreignobject',
  'iframe',
  'frame',
  'embed',
  'object',
  'applet',
  // SMIL: trocam um atributo depois de carregar (o href de um <a> ou de um <use> vira javascript: ou um endereço de fora)
  'set',
  'animate',
  'animatemotion',
  'animatetransform',
  'animatecolor',
  'discard',
  // SVG Tiny (tratam evento) e o HTML que redireciona, carrega folha de estilo ou muda a base dos endereços
  'handler',
  'listener',
  'meta',
  'link',
  'base',
]);

const NAME = '[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?';
// a tag inteira: nome, atributos sempre entre aspas e sem "<" no valor (o XML não aceita), e o fim (">" ou "/>")
const OPEN = new RegExp(
  `<(${NAME})((?:\\s+[^\\s=/>"'<]+\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`,
  'y',
);
const CLOSE = new RegExp(`</(${NAME})\\s*>`, 'y');
const ATTRIBUTE = /\s+([^\s=/>"'<]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;
const XML_DECLARATION = /^<\?xml\s[^<>?]*\?>/;
const ENCODING = /\bencoding\s*=\s*["']([^"']*)["']/;
const XML_ENTITY = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(lt|gt|amp|quot|apos));/g;
const NAMED_ENTITY: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/g;
// sobre o valor compacto (sem espaço nem controle, em minúsculas)
const SCRIPT_SCHEME = /(?:java|vb)script:/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]*$/;
const ALLOWED_URL =
  /url\((['"]?)(?:#[^'"()]*|data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]*)\1\)/y;

// O que o navegador ignora num endereço (espaço, tabulação, quebra de linha e os outros controles), e a caixa.
// eslint-disable-next-line no-control-regex
const compact = (text: string): string => text.replace(/[\u0000- ]+/g, '').toLowerCase();

// As entidades que o XML conhece sem DOCTYPE; outra (&nbsp;) é erro para o navegador, e aqui é recusa (undefined).
function decodeXml(text: string): string | undefined {
  if (text.replace(XML_ENTITY, '').includes('&')) return undefined;
  try {
    return text.replace(XML_ENTITY, (_match, dec?: string, hex?: string, name?: string) =>
      name
        ? NAMED_ENTITY[name]!
        : String.fromCodePoint(dec ? Number(dec) : Number.parseInt(hex!, 16)),
    );
  } catch {
    return undefined; // código fora do Unicode
  }
}

function cssUnescape(text: string): string | undefined {
  try {
    return text.replace(CSS_ESCAPE, (_match, hex?: string, char?: string) =>
      hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char!,
    );
  } catch {
    return undefined;
  }
}

// `stylesheet`: CSS de verdade (o texto do <style> e o atributo style). Nos outros atributos (os de apresentação, como fill e filter, também
// são lidos como CSS) só o javascript: e o url() contam: um metadado do Inkscape guarda caminho do Windows e endereço como nome.
function cssRefusal(text: string, stylesheet: boolean): string | null {
  const unescaped = cssUnescape(text);
  if (unescaped === undefined) return 'escape de CSS fora do Unicode';
  const css = compact(unescaped);
  if (SCRIPT_SCHEME.test(css)) return 'javascript:';
  if (stylesheet && css.includes('@import')) return '@import';
  for (let at = css.indexOf('url('); at !== -1; at = css.indexOf('url(', at + 4)) {
    ALLOWED_URL.lastIndex = at;
    if (!ALLOWED_URL.test(css)) return 'url() externo';
  }
  if (stylesheet && css.includes('//')) return 'endereço no CSS';
  return null;
}

function attributeRefusal(rawName: string, rawValue: string): string | null {
  const name = rawName.toLowerCase();
  // a declaração de namespace só dá nome (o endereço dela nunca é buscado)
  if (name === 'xmlns' || name.startsWith('xmlns:')) return null;
  const local = name.slice(name.lastIndexOf(':') + 1);
  if (local.startsWith('on')) return 'atributo de evento (on*)';
  if (name === 'xml:base') return 'xml:base';
  const value = decodeXml(rawValue);
  if (value === undefined) return 'entidade desconhecida';
  const plain = compact(value);
  if (SCRIPT_SCHEME.test(plain)) return 'javascript:';
  if (local === 'href' || local === 'src') {
    if (plain.startsWith('#') || DATA_IMAGE.test(plain)) return null;
    return plain.startsWith('data:')
      ? 'imagem embutida fora de png, jpeg, gif ou webp'
      : 'referência externa';
  }
  return cssRefusal(value, local === 'style');
}

const localName = (qualified: string): string => qualified.slice(qualified.indexOf(':') + 1);

// O motivo da recusa, ou null se o SVG passa.
export function svgRefusal(input: string): string | null {
  if (Buffer.byteLength(input, 'utf8') > LOGO_MAX_BYTES) return 'passa do teto de 200 KB';
  if (input.includes('\u0000')) return 'caractere nulo';
  const svg = input.startsWith('﻿') ? input.slice(1) : input;
  let at = 0;
  const declaration = XML_DECLARATION.exec(svg);
  if (declaration) {
    const encoding = ENCODING.exec(declaration[0])?.[1];
    if (encoding !== undefined && encoding.toLowerCase() !== 'utf-8')
      return 'codificação diferente de UTF-8';
    at = declaration[0].length;
  }
  const malformed = 'marcação que o validador não lê';
  // os nomes como estão no texto (o fechamento tem de repetir o da abertura) e quantos <style> estão abertos
  const open: string[] = [];
  let styles = 0;
  let styleText = '';
  let rootSeen = false;
  while (at < svg.length) {
    const lt = svg.indexOf('<', at);
    const text = svg.slice(at, lt === -1 ? svg.length : lt);
    if (open.length === 0 && text.trim() !== '') return 'texto fora do <svg>';
    if (styles > 0) {
      const decoded = decodeXml(text);
      if (decoded === undefined) return 'entidade desconhecida';
      // o texto do <style> é a soma dos pedaços (um comentário no meio de "@import" some para o CSS): confere tudo junto, no fim
      styleText += decoded;
    }
    if (lt === -1) break;
    at = lt;
    if (svg.startsWith('<!--', at)) {
      const end = svg.indexOf('-->', at + 4);
      if (end === -1) return malformed;
      at = end + 3;
      continue;
    }
    if (svg.startsWith('<![CDATA[', at)) {
      const end = svg.indexOf(']]>', at + 9);
      if (end === -1) return malformed;
      if (open.length === 0) return 'texto fora do <svg>';
      if (styles > 0) styleText += svg.slice(at + 9, end);
      at = end + 3;
      continue;
    }
    if (svg.startsWith('<!', at)) return 'DOCTYPE ou ENTITY';
    if (svg.startsWith('<?', at)) return 'instrução de processamento';

    CLOSE.lastIndex = at;
    const close = CLOSE.exec(svg);
    if (close) {
      if (open.pop() !== close[1]) return malformed;
      if (localName(close[1]!).toLowerCase() === 'style') styles -= 1;
      at = CLOSE.lastIndex;
      continue;
    }
    OPEN.lastIndex = at;
    const tag = OPEN.exec(svg);
    if (!tag) return malformed;
    const [, qualified, attributes, selfClosing] = tag as unknown as [
      string,
      string,
      string,
      string,
    ];
    const local = localName(qualified);
    if (open.length === 0) {
      if (rootSeen) return 'mais de uma raiz';
      if (local !== 'svg') return 'a raiz não é <svg>';
      rootSeen = true;
    }
    const element = local.toLowerCase();
    if (BLOCKED_ELEMENTS.has(element)) return `elemento <${element}>`;
    for (const [, name, double, single] of attributes.matchAll(ATTRIBUTE)) {
      const refusal = attributeRefusal(name!, double ?? single ?? '');
      if (refusal) return refusal;
    }
    if (selfClosing === '') {
      open.push(qualified);
      if (element === 'style') styles += 1;
    }
    at = OPEN.lastIndex;
  }
  if (!rootSeen) return 'a raiz não é <svg>';
  if (open.length > 0) return malformed;
  return cssRefusal(styleText, true);
}
