// pnpm docs:check: tudo que vem de fora precisa de uma linha completa em docs/DEPENDENCIAS.md.
// Olha dependencies, devDependencies, optionalDependencies e peerDependencies de todo package.json do
// workspace; imagens do docker-compose, services:/container: dos workflows, FROM de Dockerfile e
// image: literal de .bicep; actions (uses:) dos workflows e de .github/actions/**/action.yml; e o código
// copiado de registro (ADR 0037): todo arquivo de apps/web/src/components/{arc,beui,reui} (fora os testes
// nossos e o LICENSE) com a linha dele na seção "Componentes copiados de registros", pelo caminho do arquivo
// ou da pasta dele na coluna Onde, e o LICENSE em cada pasta. Falha listando o que falta.
// ponytail: confere que a linha existe, tem as 8 colunas, Link http(s) e Data dd/mm/aaaa, não que a versão
// bate. A versão exata está no pnpm-lock.yaml; se a tabela começar a divergir dele, comparar a coluna
// Versão com o lockfile. Em Bicep só o image: com texto literal é visto; imagem montada em variável (como
// as do próprio projeto no GHCR) não é, e o image: de um input qualquer de action também conta como
// imagem (falso positivo raro, o aviso aponta o arquivo).
// Uso: node scripts/docs-check.mjs [raiz]
// Saída: 0 tudo documentado; 1 falta documentar; 2 não deu para ler algum arquivo (erro de ambiente).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DOC = 'docs/DEPENDENCIAS.md';
const COLUMNS = 8; // Item | Tipo | Versão | Licença | Para quê | Onde | Data | Link
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'playwright-report',
  'test-results',
]);

// label: como aparece na mensagem. type: o que a coluna "Tipo" da linha precisa mencionar.
const KINDS = {
  npm: { label: 'pacote npm', type: /npm/i },
  docker: { label: 'imagem Docker', type: /docker/i },
  action: { label: 'GitHub Action', type: /action/i },
  componente: { label: 'componente copiado' },
};

// As pastas do código copiado de registro e a seção do DEPENDENCIAS.md que as documenta (ADR 0037).
const COPIED_DIRS = ['arc', 'beui', 'reui'].map((lib) => `apps/web/src/components/${lib}`);
const COPIED_SECTION = 'Componentes copiados de registros';
// os testes nossos ao lado das peças não vêm de fora
const OURS = /\.(spec|test)\.[cm]?[jt]sx?$/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// postgres:17.11 -> postgres, mcr.microsoft.com/x/y:1.0@sha256:... -> mcr.microsoft.com/x/y,
// docker://alpine:3.20 -> alpine
function imageName(ref) {
  const noDigest = ref.replace(/^docker:\/\//, '').split('@')[0];
  const colon = noDigest.lastIndexOf(':');
  return colon > noDigest.lastIndexOf('/') ? noDigest.slice(0, colon) : noDigest;
}

function fromDockerfile(text) {
  const stages = new Set();
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (!match) continue;
    const [, ref, alias] = match;
    const isStage = stages.has(ref.toLowerCase());
    if (ref.toLowerCase() !== 'scratch' && !isStage) refs.push(imageName(ref));
    if (alias) stages.add(alias.toLowerCase());
  }
  return refs;
}

// owner/repo@v1 e owner/repo/subpasta@v1 -> owner/repo. Actions locais (./) ficam de fora e docker://
// é imagem (tratada à parte).
function actionName(ref) {
  if (ref.startsWith('.') || ref.startsWith('docker://')) return undefined;
  return ref.split('@')[0].split('/').slice(0, 2).join('/');
}

// [ \t] e não \s: o valor tem de estar na mesma linha (em `container:` seguido de mapa, a próxima linha
// não é a imagem).
const IMAGE_KEY = /^[ \t]*image:[ \t]*["']?([^\s"'#]+)/gm;
const CONTAINER_KEY = /^[ \t]*container:[ \t]*["']?([^\s"'#]+)/gm;
const USES_KEY = /^[ \t]*-?[ \t]*uses:[ \t]*["']?([^\s"'#]+)/gm;

const matches = (regex, text) => [...text.matchAll(regex)].map((m) => m[1]);

// workflows e actions compostas: uses: de action (ou docker://imagem), image: e container:
function fromWorkflow(text, { withContainers }) {
  const found = { actions: [], images: [] };
  for (const ref of matches(USES_KEY, text)) {
    if (ref.startsWith('docker://')) found.images.push(imageName(ref));
    else {
      const name = actionName(ref);
      if (name) found.actions.push(name);
    }
  }
  if (withContainers) {
    for (const ref of matches(IMAGE_KEY, text)) found.images.push(imageName(ref));
    for (const ref of matches(CONTAINER_KEY, text)) found.images.push(imageName(ref));
  } else {
    // action de Docker: `image: docker://x` usa imagem de fora; `image: Dockerfile` é build local
    for (const ref of matches(IMAGE_KEY, text)) {
      if (ref.startsWith('docker://')) found.images.push(imageName(ref));
    }
  }
  return found;
}

async function collectRequired(root) {
  /** @type {Map<string, {kind: string, name: string, sources: Set<string>, reason?: string}>} */
  const required = new Map();
  const add = (kind, name, source) => {
    const key = `${kind}:${name}`;
    const item = required.get(key) ?? { kind, name, sources: new Set() };
    item.sources.add(source);
    if (/\$/.test(name))
      item.reason = 'nome com variável: use o nome literal da imagem para poder verificar';
    required.set(key, item);
  };

  for await (const file of walk(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const base = path.basename(file);
    if (base === 'package.json') {
      const pkg = JSON.parse(await readFile(file, 'utf8'));
      for (const group of [
        pkg.dependencies,
        pkg.devDependencies,
        pkg.optionalDependencies,
        pkg.peerDependencies,
      ]) {
        for (const [name, version] of Object.entries(group ?? {})) {
          if (!String(version).startsWith('workspace:')) add('npm', name, relative);
        }
      }
    } else if (/^(docker-)?compose(\..+)?\.ya?ml$/.test(base)) {
      const text = await readFile(file, 'utf8');
      for (const ref of matches(IMAGE_KEY, text)) add('docker', imageName(ref), relative);
    } else if (/^Dockerfile(\..+)?$|\.Dockerfile$/.test(base)) {
      for (const name of fromDockerfile(await readFile(file, 'utf8')))
        add('docker', name, relative);
    } else if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(relative)) {
      const { actions, images } = fromWorkflow(await readFile(file, 'utf8'), {
        withContainers: true,
      });
      for (const name of actions) add('action', name, relative);
      for (const name of images) add('docker', name, relative);
    } else if (/(^|\/)\.github\/actions\/.+\/action\.ya?ml$/.test(relative)) {
      const { actions, images } = fromWorkflow(await readFile(file, 'utf8'), {
        withContainers: false,
      });
      for (const name of actions) add('action', name, relative);
      for (const name of images) add('docker', name, relative);
    } else if (base.endsWith('.bicep')) {
      // só image: com texto literal entre aspas (identificador ou variável não é imagem de fora)
      for (const match of (await readFile(file, 'utf8')).matchAll(/\bimage:[ \t]*'([^'\n]+)'/g))
        add('docker', imageName(match[1]), relative);
    }
  }
  return required;
}

// Os arquivos das pastas do código copiado (o caminho a partir da raiz), e as pastas que existem.
async function copiedFiles(root) {
  const files = [];
  const dirs = [];
  for (const dir of COPIED_DIRS) {
    try {
      for await (const file of walk(path.join(root, dir)))
        files.push(path.relative(root, file).split(path.sep).join('/'));
      dirs.push(dir);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { files, dirs };
}

// As linhas da seção do código copiado: do título dela até o título seguinte do mesmo nível.
function sectionRows(markdown, title) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^## /.test(line) && line.includes(title));
  if (start === -1) return [];
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return tableRows(lines.slice(start + 1, end === -1 ? undefined : end).join('\n'));
}

// Os caminhos da coluna Onde ("a/b.tsx, a/c (o bloco)") que cobrem um arquivo: ele mesmo ou uma pasta acima dele.
const covers = (cell, file) =>
  cell
    .split(',')
    .map((part) => part.trim().split(/\s/)[0].replace(/`/g, '').replace(/\/$/, ''))
    .some((place) => place !== '' && (file === place || file.startsWith(`${place}/`)));

// Linhas de tabela do markdown, já divididas em células.
function tableRows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

// dd/mm/aaaa de um dia que existe (31/02 não)
function isDate(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return false;
  const [day, month, year] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// Colunas: Item | Tipo | Versão | Licença | Para quê | Onde | Data | Link
function problemOf(cells) {
  if (cells.length < COLUMNS || !cells.slice(0, COLUMNS).every(Boolean))
    return `linha incompleta: preencha as ${COLUMNS} colunas`;
  if (!isDate(cells[6])) return 'Data deve ser dd/mm/aaaa';
  if (!/^https?:\/\/\S+$/.test(cells[7])) return 'Link deve começar por http:// ou https://';
  return undefined;
}

const itemsOf = (cell) => {
  const quoted = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return quoted.length > 0 ? quoted : [cell];
};

/**
 * @returns {Promise<{checked: number, missing: Array<{kind: string, name: string, source: string, reason: string}>}>}
 */
export async function checkDocs(root) {
  let markdown = '';
  let docExists = true;
  try {
    markdown = await readFile(path.join(root, DOC), 'utf8');
  } catch (error) {
    // só a falta do arquivo vira "não existe"; permissão, pasta no lugar etc. são erro de ambiente
    if (error?.code !== 'ENOENT') throw error;
    docExists = false;
  }
  const rows = tableRows(markdown);
  const required = await collectRequired(root);

  const missing = [];
  for (const item of required.values()) {
    const matching = rows.filter(
      (cells) =>
        itemsOf(cells[0] ?? '').includes(item.name) && KINDS[item.kind].type.test(cells[1] ?? ''),
    );
    // basta uma linha sem problema; se nenhuma presta, aponta o problema da primeira
    const problems = matching.map(problemOf);
    let reason = item.reason;
    if (!reason && !docExists) reason = `${DOC} não existe`;
    else if (!reason && matching.length === 0) reason = 'sem linha na tabela';
    else if (!reason && !problems.includes(undefined)) reason = problems[0];
    if (reason)
      missing.push({
        kind: item.kind,
        name: item.name,
        source: [...item.sources].join(', '),
        reason,
      });
  }

  const { files, dirs } = await copiedFiles(root);
  const copiedRows = sectionRows(markdown, COPIED_SECTION);
  const copies = files.filter(
    (file) => !OURS.test(file) && path.posix.basename(file) !== 'LICENSE',
  );
  for (const file of copies) {
    const matching = copiedRows.filter((cells) => covers(cells[5] ?? '', file));
    const problems = matching.map(problemOf);
    const reason = !docExists
      ? `${DOC} não existe`
      : matching.length === 0
        ? `sem linha na seção "${COPIED_SECTION}" (o caminho dele ou da pasta na coluna Onde)`
        : problems.includes(undefined)
          ? undefined
          : problems[0];
    if (reason) missing.push({ kind: 'componente', name: file, source: file, reason });
  }
  for (const dir of dirs) {
    if (!files.includes(`${dir}/LICENSE`))
      missing.push({
        kind: 'componente',
        name: `${dir}/LICENSE`,
        source: dir,
        reason: 'a pasta do código copiado precisa do LICENSE da MIT ao lado das cópias',
      });
  }
  missing.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { checked: required.size + copies.length + dirs.length, missing };
}

async function main(root) {
  const { checked, missing } = await checkDocs(root);
  if (missing.length === 0) {
    console.log(`docs:check ok: ${checked} itens documentados em ${DOC}`);
    return 0;
  }
  console.log(
    `docs:check falhou: ${missing.length} de ${checked} itens sem linha válida em ${DOC}\n`,
  );
  for (const m of missing)
    console.log(
      m.kind === 'componente'
        ? `  ${KINDS[m.kind].label}: ${m.name}  ${m.reason}`
        : `  ${KINDS[m.kind].label}: ${m.name}  (${m.source})  ${m.reason}`,
    );
  console.log(
    '\nUma linha por item: Item | Tipo | Versão | Licença | Para quê | Onde | Data | Link.',
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
    // erro de ambiente (arquivo ilegível, package.json quebrado): mensagem curta e código 2
    console.error(
      `docs:check não conseguiu ler os arquivos do workspace: ${error.code ?? error.name}: ${error.message}`,
    );
    process.exitCode = 2;
  }
}
