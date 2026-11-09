// node scripts/guia-check.mjs [raiz]: confere as referências ao código do docs/GUIA-DO-CODIGO.md, para o guia não apodrecer quando o código
// muda. Uma referência é um trecho de código em linha `caminho#símbolo`: o caminho a partir da raiz do repositório (com uma barra ou um ponto,
// para `#feed` e `C#` não contarem) e um texto que aparece no arquivo. Falha se o arquivo não existe, se não é arquivo, se está fora do
// repositório ou se o símbolo não aparece nele. Um símbolo com cara de identificador (`call`, `LOT_SELECT`) vale só como palavra inteira:
// `call` não é achado dentro de `callBudget`; qualquer outro texto (`async replace(`) é procurado como está. Blocos de código cercados
// (``` e ~~~) ficam de fora: um comentário de shell não é referência.
// ponytail: confere que o texto existe no arquivo, não que a frase do guia sobre ele continua certa. Isso é da revisão de quem muda o código.
// Uso: node scripts/guia-check.mjs [raiz]
// Saída: 0 todas as referências valem; 1 alguma quebrou, ou o guia não tem nenhuma; 2 não deu para ler o guia ou um arquivo (ambiente).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GUIDE = 'docs/GUIA-DO-CODIGO.md';
const REFERENCE = /`([^`\s#]*[./][^`\s#]*)#([^`\s][^`]*)`/g;
const FENCE = /^ {0,3}(```|~~~)/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// O texto do arquivo, ou o motivo de não haver um. Outro erro de leitura (permissão, por exemplo) sobe: é do ambiente, não do guia.
async function source(root, file) {
  const full = path.resolve(root, file);
  const relative = path.relative(root, full);
  if (path.isAbsolute(file) || relative.startsWith('..')) return { reason: 'fora do repositório' };
  try {
    return { text: await readFile(full, 'utf8') };
  } catch (error) {
    if (error?.code === 'ENOENT') return { reason: 'o arquivo não existe' };
    if (error?.code === 'EISDIR') return { reason: 'não é um arquivo' };
    throw error;
  }
}

const appears = (symbol, text) =>
  IDENTIFIER.test(symbol)
    ? new RegExp(`(?<![\\w$])${symbol.replaceAll('$', '\\$')}(?![\\w$])`).test(text)
    : text.includes(symbol);

/**
 * @returns {Promise<{checked: number, broken: Array<{line: number, reference: string, reason: string}>}>}
 */
export async function checkGuide(root) {
  const lines = (await readFile(path.join(root, GUIDE), 'utf8')).split(/\r?\n/);
  const sources = new Map();
  const broken = [];
  let checked = 0;
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced || FENCE.test(line)) continue;
    for (const [reference, file, rawSymbol] of line.matchAll(REFERENCE)) {
      checked += 1;
      if (!sources.has(file)) sources.set(file, await source(root, file));
      const { text, reason } = sources.get(file);
      const symbol = rawSymbol.trimEnd();
      const problem =
        reason ?? (appears(symbol, text) ? undefined : 'o símbolo não aparece no arquivo');
      if (problem)
        broken.push({ line: index + 1, reference: reference.slice(1, -1), reason: problem });
    }
  }
  return { checked, broken };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

async function main(root) {
  const { checked, broken } = await checkGuide(root);
  if (checked === 0) {
    console.log(`guia-check falhou: nenhuma referência \`caminho#símbolo\` em ${GUIDE}`);
    return 1;
  }
  if (broken.length === 0) {
    console.log(
      `guia-check ok: ${plural(checked, 'referência conferida', 'referências conferidas')} em ${GUIDE}`,
    );
    return 0;
  }
  console.log(
    `guia-check falhou: ${broken.length} de ${plural(checked, 'referência quebrada', 'referências quebradas')} em ${GUIDE}\n`,
  );
  for (const b of broken) console.log(`  linha ${b.line}: \`${b.reference}\`  ${b.reason}`);
  console.log(
    '\nCada referência é `caminho#símbolo`: o caminho a partir da raiz do repositório e um texto que aparece no arquivo.',
  );
  return 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : fileURLToPath(new URL('..', import.meta.url));
  try {
    process.exitCode = await main(root);
  } catch (error) {
    // erro de ambiente (o guia ou um arquivo ilegível): mensagem curta e código 2, como o docs:check
    console.error(
      `guia-check não conseguiu ler os arquivos: ${error.code ?? error.name}: ${error.message}`,
    );
    process.exitCode = 2;
  }
}
