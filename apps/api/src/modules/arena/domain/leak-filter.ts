// Filtro de vazamento do prompt (plano 10; ADR 0011): o canário e os n-gramas de 8 palavras do prompt, procurados em todo
// texto que sai do processo: summary e rationale (públicos) e a resposta crua que vai para o Blob. O que bater é trocado por
// um aviso. O prompt só vive em memória, aqui dentro: o filtro nunca o devolve, nunca o loga e não expõe os n-gramas.
//
// Comparação por palavra: letras e dígitos Unicode, sem acento e sem caixa. Pontuação, espaço e as sequências de escape do
// JSON (\n, \", \uXXXX) separam palavras, para o trecho ser achado também na resposta crua do provedor, onde o texto vem
// escapado. Marca de acento solta (o "ã" decomposto) e caractere invisível no meio da palavra (soft hyphen, largura zero)
// fazem parte da palavra e somem na comparação. Uma palavra a menos que 8 seguidas não conta: é o limiar do plano.
//
// É um alarme para eco literal, não uma barreira contra um modelo que ofusca de propósito (tradução, base64, homóglifos,
// invisível no lugar do espaço). A barreira dos textos públicos é o conjunto: limpeza do texto (decision-items.ts), teto de
// itens, esta conferência dos campos juntos e o schema estrito.

export const NGRAM_WORDS = 8;
export const LEAK_WARNING = '[trecho removido: parecia o texto do prompt]';

// A linha de canário do prompt (docs/ARENA.md). O filtro extrai do próprio prompt os que existirem: nada a configurar.
const CANARY_SOURCE = '\\balv-canary-[a-z0-9]{16,64}\\b';
const WORD = /[\p{L}\p{N}\p{M}\p{Default_Ignorable_Code_Point}]+/gu;
const JSON_ESCAPE = /\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])/g;
const MAX_DEPTH = 32;

type Range = [start: number, end: number];
interface Word {
  key: string;
  start: number;
  end: number;
}

// O prompt de produção tem de trazer a linha de canário: sem ela o filtro perde o alarme mais forte, em silêncio.
export const hasCanary = (prompt: string): boolean => new RegExp(CANARY_SOURCE, 'i').test(prompt);

const fold = (word: string): string =>
  word
    .normalize('NFKD')
    .replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, '')
    .toLowerCase();

// Troca cada escape do JSON por espaços do mesmo tamanho: as posições das palavras continuam valendo no texto original.
// Palavra que só tinha marca ou invisível (sem letra nem dígito) fica de fora.
const wordsOf = (text: string): Word[] =>
  [...text.replace(JSON_ESCAPE, (escape) => ' '.repeat(escape.length)).matchAll(WORD)]
    .map((m) => ({ key: fold(m[0]), start: m.index, end: m.index + m[0].length }))
    .filter((word) => word.key !== '');

const windowKey = (words: Word[], from: number): string =>
  words
    .slice(from, from + NGRAM_WORDS)
    .map((word) => word.key)
    .join(' ');

export interface Redaction {
  text: string;
  leaked: boolean;
}

export interface LeakFilter {
  // Texto livre (summary, rationale, raciocínio, mensagem de erro): troca o canário e o que parece o prompt por LEAK_WARNING
  // (um aviso por trecho contínuo).
  redact(text: string): Redaction;
  // Só o canário. Para o dado que é nosso (o briefing, a carteira, a mensagem de reparo), que divide vocabulário com o prompt
  // (as regras, os nomes de campo): o n-grama marcaria o que é legítimo.
  redactCanary(text: string): Redaction;
  // O que o modelo devolveu. Se for um documento JSON (o conteúdo de uma resposta), o n-grama olha só os textos de dentro: as
  // chaves e a estrutura repetem o formato de saída que o prompt descreve, e toda resposta comum seria marcada. O canário vale
  // no documento inteiro, chaves inclusive. Sem vazamento devolve o texto como veio, byte a byte.
  redactModelOutput(text: string): Redaction;
  // O mesmo em todos os textos de um valor JSON (a resposta crua). Devolve uma cópia e os caminhos que mudaram
  // (ex.: choices.0.message.content); o valor original não é alterado.
  redactDeep(value: unknown): { value: unknown; paths: string[] };
}

// Objeto ou lista escritos como JSON, senão nada. Aparar e olhar as pontas evita o parse de todo texto comum.
function jsonDocument(text: string): object | undefined {
  const trimmed = text.trim();
  const object = trimmed.startsWith('{') && trimmed.endsWith('}');
  const list = trimmed.startsWith('[') && trimmed.endsWith(']');
  if (!object && !list) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value !== null && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function createLeakFilter(prompt: string): LeakFilter {
  const grams = new Set<string>();
  const promptWords = wordsOf(prompt);
  for (let from = 0; from + NGRAM_WORDS <= promptWords.length; from += 1) {
    grams.add(windowKey(promptWords, from));
  }
  const canaries = [
    ...new Set(
      [...prompt.matchAll(new RegExp(CANARY_SOURCE, 'gi'))].map((m) => m[0].toLowerCase()),
    ),
  ];
  // O canário pelas letras e dígitos, com qualquer separador entre eles (espaço, hífen, quebra de linha, invisível, marca): "alv
  // canary 9f8e…", "alv-can(largura zero)ary-…" e o hífen escapado do JSON cru. É uma sequência aleatória longa, então não há falso positivo.
  const canaryPattern =
    canaries.length > 0
      ? new RegExp(
          canaries
            .map((token) => [...token.replace(/[^a-z0-9]/g, '')].join('[^\\p{L}\\p{N}]*'))
            .join('|'),
          'giu',
        )
      : null;

  // Os trechos do canário no texto. Os escapes do JSON viram espaços do mesmo tamanho (as posições valem no original), como
  // nas palavras.
  function canaryRanges(text: string): Range[] {
    if (canaryPattern === null) return [];
    const flat = text.replace(JSON_ESCAPE, (escape) => ' '.repeat(escape.length));
    return [...flat.matchAll(canaryPattern)].map((m) => [m.index, m.index + m[0].length]);
  }

  // Junta os trechos que se tocam e troca cada um por um aviso só.
  function replaceRanges(text: string, ranges: Range[]): Redaction {
    if (ranges.length === 0) return { text, leaked: false };
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: Range[] = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([range[0], range[1]]);
    }
    let out = '';
    let cursor = 0;
    for (const [start, end] of merged) {
      out += text.slice(cursor, start) + LEAK_WARNING;
      cursor = end;
    }
    return { text: out + text.slice(cursor), leaked: true };
  }

  function redact(text: string): Redaction {
    if (grams.size === 0 && canaryPattern === null) return { text, leaked: false };
    const ranges = canaryRanges(text);
    const words = wordsOf(text);
    for (let from = 0; from + NGRAM_WORDS <= words.length; from += 1) {
      if (grams.has(windowKey(words, from))) {
        ranges.push([words[from]!.start, words[from + NGRAM_WORDS - 1]!.end]);
      }
    }
    return replaceRanges(text, ranges);
  }

  function redactCanary(text: string): Redaction {
    return replaceRanges(text, canaryRanges(text));
  }

  function redactModelOutput(text: string, depth = 0): Redaction {
    const document = depth > MAX_DEPTH ? undefined : jsonDocument(text);
    if (document === undefined) return redact(text);
    const paths: string[] = [];
    let inner: unknown;
    try {
      inner = walk(document, [], paths, depth + 1);
    } catch (error) {
      // JSON fundo demais para ler (um modelo em laço, uma resposta torta): o texto inteiro segue pelo n-grama de sempre, com
      // mais marcações e nunca uma falha, que gastaria as chamadas pagas de novo na nova tentativa
      if (error instanceof RangeError) return redact(text);
      throw error;
    }
    // o canário também nas chaves e na estrutura (o que o walk não olha); o JSON serializado continua válido, porque o
    // canário só existe dentro de um texto
    const canary = redactCanary(JSON.stringify(inner));
    if (paths.length === 0 && !canary.leaked) return { text, leaked: false };
    return { text: canary.text, leaked: true };
  }

  function walk(value: unknown, path: string[], paths: string[], depth: number): unknown {
    if (depth > MAX_DEPTH) throw new RangeError('estrutura profunda demais para filtrar');
    if (typeof value === 'string') {
      const result = redactModelOutput(value, depth + 1);
      if (result.leaked) paths.push(path.join('.'));
      return result.text;
    }
    if (Array.isArray(value)) {
      return (value as unknown[]).map((item, index) =>
        walk(item, [...path, String(index)], paths, depth + 1),
      );
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          walk(item, [...path, key], paths, depth + 1),
        ]),
      );
    }
    return value;
  }

  return {
    redact,
    redactCanary,
    redactModelOutput: (text) => redactModelOutput(text),
    redactDeep(value) {
      const paths: string[] = [];
      return { value: walk(value, [], paths, 0), paths };
    },
  };
}
