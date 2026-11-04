// Texto de terceiro (título e trecho de RSS, assunto de documento da CVM, nome de empresa da B3) é dado, nunca
// instrução (plano 10; docs/DADOS.md, seção 17). Tudo passa por aqui antes de ir para o banco e, de novo, antes de
// entrar no briefing: HTML fora, entidades decodificadas, caracteres de controle e invisíveis fora, espaços
// colapsados e tamanho truncado. O que sobra é texto simples numa linha só.

export const TITLE_MAX = 300;
export const SNIPPET_MAX = 300;

// Só o começo do bruto importa para um título ou um trecho de 300 caracteres, e o teto mantém o custo da limpeza
// pequeno e previsível: uma entrada de megabytes não vira uma limpeza de megabytes.
const RAW_MAX = 10_000;

// Toda expressão abaixo consome até o fim do que procura ou até o fim da entrada, então cada passada é linear: nenhum
// padrão tenta de novo a partir do mesmo ponto (tag, comentário ou script sem fechar vai até o fim do texto).
const BLOCKS = /<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi; // o conteúdo some junto
const COMMENTS = /<!--[\s\S]*?(?:-->|$)/g;
// Tag: "<" seguido de letra, "/", "!" ou "?". O "<" solto ("lucro < 5%") não é tag.
const TAGS = /<\/?[A-Za-z!?][^>]*(?:>|$)/g;
const ENTITIES = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,9});/gi;
// Separadores e quebras de linha viram espaço; o resto da categoria C (controle, formato, substituto solto, uso
// privado, não atribuído) some. Formato inclui largura zero, soft hyphen, BOM, sobreposição de direção e os caracteres
// de tag do plano 14, que escondem texto de quem lê e não de um modelo. Os ignoráveis por padrão (seletores de variação,
// preenchimentos de Hangul, Khmer e Mongol) não são da categoria C e escondem do mesmo jeito.
const SEPARATORS = /[\p{Zs}\p{Zl}\p{Zp}\t\n\r\f\v\x85]+/gu;
const INVISIBLE = /[\p{C}\p{Default_Ignorable_Code_Point}]/gu;

// Os 96 nomes do HTML 4 para U+00A0 a U+00FF, em ordem de código.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(
    ' ',
  );

// Map e não objeto: "&constructor;" não pode achar Object.prototype.constructor.
const NAMED = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ...Object.entries({
    hellip: 0x2026,
    ndash: 0x2013,
    mdash: 0x2014,
    lsquo: 0x2018,
    rsquo: 0x2019,
    sbquo: 0x201a,
    ldquo: 0x201c,
    rdquo: 0x201d,
    bdquo: 0x201e,
    bull: 0x2022,
    permil: 0x2030,
    euro: 0x20ac,
    trade: 0x2122,
  }).map(([name, code]) => [name, String.fromCodePoint(code)] as const),
  ...LATIN1.map((name, index) => [name, String.fromCodePoint(160 + index)] as const),
]);

const usable = (code: number): boolean =>
  Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);

function decodeEntity(match: string, body: string): string {
  if (body.startsWith('#')) {
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return usable(code) ? String.fromCodePoint(code) : '';
  }
  // desconhecida fica como veio: não se adivinha o que "&foo;" quis dizer
  return NAMED.get(body) ?? match;
}

// Tag de bloco ou de quebra separa palavras ("<p>um</p><p>dois</p>" -> "um dois"); tag de linha some sem deixar espaço
// ("<b>forte</b>." -> "forte.").
const BLOCK_TAG =
  /^<\/?(?:p|br|div|li|ul|ol|tr|td|th|table|h[1-6]|blockquote|section|article|header|footer|hr|figure|figcaption|pre)\b/i;

const stripHtml = (text: string): string =>
  text
    .replace(BLOCKS, ' ')
    .replace(COMMENTS, ' ')
    .replace(TAGS, (tag) => (BLOCK_TAG.test(tag) ? ' ' : ''));

// Tira o HTML até não sobrar tag: a mais interna sai primeiro e pode juntar as pontas de outra ("<<b>/script>" ->
// "</script>"). Cada passada só encolhe o texto, e o texto de verdade estabiliza em duas ou três. Um aninhamento artificial
// que não estabiliza em poucas passadas perde todo "<" que sobrar: sem "<" não há tag, e o custo fica em passadas fixas.
const PASSES = 6;
function withoutHtml(text: string): string {
  let current = text;
  for (let pass = 0; pass < PASSES; pass += 1) {
    const next = stripHtml(current);
    if (next === current) return current;
    current = next;
  }
  return current.replace(/</g, ' ');
}

// Espaços e invisíveis saem ANTES do HTML (e de novo depois de decodificar as entidades): "<" + largura zero + "script>"
// vira "<script>" se o invisível sair só depois de a tag já ter sido procurada.
const flatten = (text: string): string => text.replace(SEPARATORS, ' ').replace(INVISIBLE, '');

// Corta em caracteres (pontos de código, não unidades UTF-16: não parte um emoji) e marca o corte com reticências,
// dentro do teto.
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

export function cleanText(raw: string, max?: number): string {
  // Tira o HTML, decodifica as entidades (uma vez só) e tira o HTML de novo: o RSS que entidade-codifica o
  // description entrega "&lt;p&gt;" já decodificado pelo XML, e o que aparece depois da decodificação também é tag.
  let text = withoutHtml(flatten(raw.slice(0, RAW_MAX)));
  text = withoutHtml(flatten(text.replace(ENTITIES, decodeEntity)));
  text = text.replace(/ {2,}/g, ' ').trim().normalize('NFC');
  return max === undefined ? text : truncate(text, max);
}
