// Marcação de ticker na notícia: o padrão da B3 (quatro caracteres, o primeiro uma letra, mais um ou dois dígitos:
// PETR4, B3SA3, BPAC11), validado contra os instrumentos conhecidos da etapa 4. Não se adivinha por nome de empresa
// ("Petrobras" não vira PETR4): só o código escrito, em maiúsculas, vale.
//
// O código tem de estar isolado: sem letra, dígito ou "_" colado antes ou depois, para não achar PETR4 dentro de
// "PETR4F" (fracionário), "XPETR4" ou "PETR44".

const SHAPE = /^[A-Z][A-Z0-9]{3}[0-9]{1,2}$/;
const CANDIDATE = /(?<![\p{L}\p{N}_])[A-Z][A-Z0-9]{3}[0-9]{1,2}(?![\p{L}\p{N}_])/gu;

export const isTickerShape = (value: string): boolean => SHAPE.test(value);

export function findTickers(text: string, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const [candidate] of text.matchAll(CANDIDATE)) {
    if (known.has(candidate)) found.add(candidate);
  }
  return [...found].sort();
}
