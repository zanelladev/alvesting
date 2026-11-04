import { createHash } from 'node:crypto';

// Serialização canônica do briefing (docs/DADOS.md, seção 18): a mesma entrada dá sempre os mesmos bytes, e o SHA-256
// público é o dos bytes exatos gravados no Blob. As regras:
// - chaves de objeto em ordem de unidade de código UTF-16, sem espaço nem quebra de linha, em UTF-8;
// - números só inteiros seguros (dinheiro em centavos, percentual em pontos-base): float tem mais de uma grafia, então
//   é recusado; bigint entra como inteiro se couber, senão falha em vez de perder dígito;
// - só valores que o JSON tem. undefined, Date, Map, instância de classe e afins são recusados: a conversão explícita
//   é de quem monta o briefing, para nada sumir ou mudar de forma em silêncio;
// - <, > e crase saem como sequência de escape Unicode (barra invertida, "u" e quatro dígitos hexadecimais), e os
//   separadores de linha e de parágrafo do Unicode (U+2028 e U+2029) também. O JSON resultante é o mesmo, mas o
//   texto de terceiro (título de notícia) não consegue escrever uma tag de fechamento (do tipo XML) nem uma cerca
//   de código com três crases para fechar o bloco em que o briefing for posto num prompt.

const MAX_DEPTH = 32;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const ESCAPED = new RegExp(`[<>\`${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const BACKSLASH_U = `${String.fromCharCode(92)}u`;
const escapeChar = (char: string): string =>
  BACKSLASH_U + char.charCodeAt(0).toString(16).padStart(4, '0');

// JSON.stringify cuida de aspas, barra invertida, controles e substituto solto; o resto é acima.
const text = (value: string): string => JSON.stringify(value).replace(ESCAPED, escapeChar);

function write(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw new RangeError('estrutura profunda demais (ou circular)');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return text(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new RangeError(`número sem forma canônica (só inteiro seguro): ${String(value)}`);
      }
      return String(value); // o zero negativo vira "0"
    case 'bigint':
      if (value > MAX_SAFE || value < -MAX_SAFE) {
        throw new RangeError('bigint fora do intervalo seguro de inteiro do JSON');
      }
      return value.toString();
    case 'object': {
      if (Array.isArray(value)) {
        const items: string[] = [];
        for (let index = 0; index < value.length; index += 1) {
          items.push(write(value[index] as unknown, depth + 1));
        }
        return `[${items.join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(value) as unknown;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('só objeto simples tem forma canônica');
      }
      const record = value as Record<string, unknown>;
      const members = Object.keys(record)
        .sort()
        .map((key) => `${text(key)}:${write(record[key], depth + 1)}`);
      return `{${members.join(',')}}`;
    }
    default:
      throw new TypeError(`valor sem forma canônica: ${typeof value}`);
  }
}

export const canonicalJson = (value: unknown): string => write(value, 0);

export const canonicalBytes = (value: unknown): Buffer => Buffer.from(canonicalJson(value), 'utf8');

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
