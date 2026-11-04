// Redirecionamento só para caminho interno, nunca aberto. O "proximo" de /entrar?proximo=/conta vem de quem montou o link, ou seja,
// pode ser de um atacante: depois do login a pessoa só pode ser mandada para uma página deste site.
// Aceita um caminho que começa com uma única "/" e não tem espaço nem caractere de controle: o navegador descarta a tabulação e a
// quebra de linha do meio de uma URL, e "/\t/golpe.com" viraria "//golpe.com". A "/" seguida de outra "/" ou de "\" é recusada: o
// navegador trata a barra invertida como barra, e "//host" é um endereço de outro site. Um caminho assim, depois da primeira "/", nunca
// muda a origem. Qualquer outra coisa (endereço absoluto, "javascript:", caminho sem a barra do começo) volta ao padrão.
const MAX_LENGTH = 2048;
const SHAPE = /^\/(?![/\\])[^\s\p{Cc}]*$/u;

export function safeInternalPath(value: string | string[] | undefined, fallback: string): string {
  return typeof value === 'string' && value.length <= MAX_LENGTH && SHAPE.test(value)
    ? value
    : fallback;
}
