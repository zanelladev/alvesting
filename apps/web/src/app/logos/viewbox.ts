// O viewBox dos logos (ADR 0036, "Como o site mostra"): 300 dos 357 SVG guardados trazem `width="56" height="56"` na raiz e nenhum `viewBox`,
// e sem ele o navegador não encolhe o desenho num <img> menor (o de 16 px mostraria só o canto de cima). Aqui a raiz sem viewBox, com width e
// height numéricos (em px ou sem unidade, maiores que zero), ganha o `viewBox="0 0 W H"`. Função pura: só a tag raiz muda, e o resto do
// documento sai igual, byte a byte; o que ela não reconhece como uma raiz <svg> (outra raiz, prefixo, DOCTYPE, tag torta) sai como veio.

// O que o validador dos logos (apps/api, svg-check.ts) aceita antes da raiz: o BOM, espaços, a declaração XML e comentários.
const PROLOG = /^\uFEFF?(?:\s|<\?xml\s[^<>?]*\?>|<!--[\s\S]*?-->)*/;
// A tag raiz, com os atributos sempre entre aspas (como o validador os lê) e o fim, `>` ou `/>`. Cada atributo tem uma leitura só (o nome
// não começa com espaço e para no `=`), então a falha volta em tempo linear.
const ROOT = /<svg((?:\s+[^\s=/>"'<]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*\/?>/y;
const ATTRIBUTE = /\s+([^\s=/>"'<]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;
const LENGTH = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/;

export function withViewBox(svg: string): string {
  const start = PROLOG.exec(svg)![0].length;
  ROOT.lastIndex = start;
  const attributes = ROOT.exec(svg)?.[1];
  if (attributes === undefined) return svg;
  const values = new Map<string, string>();
  for (const [, name, double, single] of attributes.matchAll(ATTRIBUTE)) {
    // o XML não deixa repetir atributo; se vier, vale o primeiro
    if (!values.has(name!)) values.set(name!, double ?? single ?? '');
  }
  // o nome tem caixa: um `viewbox` em minúsculas o navegador ignora
  if (values.has('viewBox')) return svg;
  const width = LENGTH.exec(values.get('width') ?? '')?.[1];
  const height = LENGTH.exec(values.get('height') ?? '')?.[1];
  if (!width || !height || !(Number(width) > 0) || !(Number(height) > 0)) return svg;
  const end = start + '<svg'.length + attributes.length;
  return `${svg.slice(0, end)} viewBox="0 0 ${width} ${height}"${svg.slice(end)}`;
}
