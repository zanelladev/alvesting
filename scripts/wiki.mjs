// node scripts/wiki.mjs [pasta]: gera as páginas da Wiki do GitHub a partir do docs/ (o núcleo comum do Playbook da Católica SC pede a
// documentação em Wiki junto ao repositório). Saída padrão: .data/wiki/, fora do git. Uma página por documento do docs/ e por ADR, a
// Home (o resumo do README e os links) e a _Sidebar. Link entre documentos vira o nome da página; link para outro arquivo vira o endereço
// dele no repositório (lido do `git remote get-url origin`); bloco de código, diagrama Mermaid inclusive, e código em linha ficam como
// estão. Não publica nada: como publicar está no docs/QUALIDADE.md, seção 8.
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A ordem da Home e da _Sidebar e o nome de cada página. O nome vira o endereço da página e o nome do arquivo no git da Wiki: só ASCII
// e sem espaço (acento em nome de arquivo complica o git no macOS). Documento do docs/ fora da lista também vira página, com o nome do
// arquivo, no grupo "Outros": um documento novo nunca some da Wiki por falta de linha aqui. `adr` é a página índice dos ADRs.
const GROUPS = [
  [
    'Comece aqui',
    [
      ['PRODUCT.md', 'Produto', 'O produto'],
      ['CONFORMIDADE-PLAYBOOK.md', 'Conformidade-com-o-Playbook', 'Conformidade com o Playbook'],
      ['GUIA-DO-CODIGO.md', 'Guia-do-codigo', 'Guia do código'],
    ],
  ],
  [
    'Requisitos e arquitetura',
    [
      ['REQUISITOS.md', 'Requisitos', 'Requisitos'],
      ['USER-STORIES.md', 'User-stories', 'User stories'],
      ['ARQUITETURA.md', 'Arquitetura', 'Arquitetura (C4)'],
      ['PLANO.md', 'Plano', 'Plano'],
      ['METODOLOGIA.md', 'Metodologia', 'Metodologia'],
    ],
  ],
  [
    'Qualidade e entrega',
    [
      ['QUALIDADE.md', 'Qualidade', 'Qualidade e cobertura'],
      ['DEPLOY.md', 'Deploy', 'Deploy'],
      ['INFRA.md', 'Infra', 'Infra na Azure'],
      ['RUNBOOK.md', 'Runbook', 'Runbook'],
    ],
  ],
  [
    'Por dentro',
    [
      ['API.md', 'API', 'API'],
      ['TELAS.md', 'Telas', 'Telas'],
      ['CONTA.md', 'Conta', 'Conta e LGPD'],
      ['ARENA.md', 'Arena', 'Arena'],
      ['DADOS.md', 'Dados', 'Dados'],
      ['JOBS.md', 'Jobs', 'Jobs e filas'],
      ['ENSAIO.md', 'Ensaio', 'Ensaio'],
      ['DESIGN.md', 'Design', 'Design'],
    ],
  ],
  [
    'Registro',
    [
      ['adr', 'ADRs', 'Decisões (ADRs)'],
      ['DEPENDENCIAS.md', 'Dependencias', 'Dependências'],
    ],
  ],
];
const ADR_INDEX = 'ADRs';
// Sem remote do GitHub (o repositório ainda não foi publicado), os links para o código levam este endereço, e o script avisa.
const PLACEHOLDER = 'https://github.com/DONO/REPOSITORIO';

const LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g; // [texto](alvo) e ![alt](imagem)
const SCHEME = /^[a-z][a-z0-9+.-]*:/i; // https:, mailto:...

function target(href, { from, pages, repoUrl }, image) {
  if (href.startsWith('#') || SCHEME.test(href)) return href;
  const cut = href.search(/[#?]/);
  const [file, rest] = cut === -1 ? [href, ''] : [href.slice(0, cut), href.slice(cut)];
  const resolved = path.posix
    .normalize(path.posix.join(path.posix.dirname(from), file))
    .replace(/\/$/, '');
  if (resolved === 'docs/adr') return ADR_INDEX + rest;
  const page = pages.get(resolved);
  if (page) return page + rest;
  // imagem pelo raw (o blob é a página HTML do arquivo, que não aparece como imagem)
  return `${repoUrl}/${image ? 'raw' : 'blob'}/main/${resolved}${rest}`;
}

// context: { from: o arquivo de onde o texto vem, a partir da raiz; pages: Map arquivo -> página; repoUrl }
export function rewriteLinks(markdown, context) {
  let fence;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        return line;
      }
      if (marker) {
        fence = marker;
        return line;
      }
      // as partes ímpares do split são código em linha (entre crases), que fica como está
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) =>
          i % 2
            ? part
            : part.replace(
                LINK,
                (_, bang, text, href) => `${bang}[${text}](${target(href, context, bang)})`,
              ),
        )
        .join('');
    })
    .join('\n');
}

export function repoUrlFrom(remote) {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/.exec(remote ?? '');
  return match ? `https://github.com/${match[1]}/${match[2]}` : undefined;
}

const titleOf = (text, fallback) => /^# (.+)$/m.exec(text)?.[1] ?? fallback;
// o front matter (o DESIGN.md abre com um) vira um bloco yaml, que a Wiki mostra como código
const frontMatterAsCode = (text) => text.replace(/^---\n([\s\S]*?)\n---\n/, '```yaml\n$1\n```\n');
const list = (items) => items.map(([page, label]) => `- [${label}](${page})`).join('\n');

export async function buildWiki(root, { repoUrl }) {
  const markdown = async (dir) =>
    (await readdir(path.join(root, dir)).catch(() => [])).filter((f) => f.endsWith('.md')).sort();
  const docs = await markdown('docs');
  const adrs = await markdown('docs/adr');
  const known = new Map(GROUPS.flatMap(([, items]) => items.map(([file, page]) => [file, page])));
  const pages = new Map([
    ...docs.map((f) => [`docs/${f}`, known.get(f) ?? f.slice(0, -3)]),
    ...adrs.map((f) => [`docs/adr/${f}`, `ADR-${f.slice(0, -3)}`]),
  ]);

  const wiki = new Map();
  const titles = new Map();
  for (const [file, page] of pages) {
    const text = await readFile(path.join(root, file), 'utf8');
    titles.set(file, titleOf(text, page));
    const source = `> Gerada de [\`${file}\`](${repoUrl}/blob/main/${file}) pelo \`scripts/wiki.mjs\`: edite lá, porque esta página é refeita a cada geração.`;
    wiki.set(
      `${page}.md`,
      `${source}\n\n${rewriteLinks(frontMatterAsCode(text), { from: file, pages, repoUrl })}`,
    );
  }
  wiki.set(
    `${ADR_INDEX}.md`,
    `# Decisões (ADRs)\n\nUma decisão por arquivo, em [\`docs/adr/\`](${repoUrl}/blob/main/docs/adr): o contexto, a decisão, as alternativas e as consequências.\n\n${list(adrs.map((f) => [pages.get(`docs/adr/${f}`), titles.get(`docs/adr/${f}`)]))}\n`,
  );

  const groups = GROUPS.map(([name, items]) => [
    name,
    items
      .filter(([file]) => (file === 'adr' ? adrs.length > 0 : docs.includes(file)))
      .map(([, page, label]) => [page, label]),
  ]);
  const others = docs.filter((f) => !known.has(f));
  if (others.length > 0)
    groups.push(['Outros', others.map((f) => [pages.get(`docs/${f}`), titles.get(`docs/${f}`)])]);

  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const summary = /^# .+\n([\s\S]*?)(?=^\*\*Estado:\*\*|^## )/m.exec(readme)?.[1].trim() ?? '';
  wiki.set(
    'Home.md',
    [
      '# Alvesting',
      rewriteLinks(summary, { from: 'README.md', pages, repoUrl }),
      `Esta Wiki é gerada do \`docs/\` do [repositório](${repoUrl}) pelo \`scripts/wiki.mjs\`. O código, os testes e o histórico ficam lá.`,
      ...groups.map(([name, items]) => `## ${name}\n\n${list(items)}`),
    ].join('\n\n') + '\n',
  );
  wiki.set(
    '_Sidebar.md',
    ['**[Início](Home)**', ...groups.map(([name, items]) => `**${name}**\n\n${list(items)}`)].join(
      '\n\n',
    ) + '\n',
  );
  return wiki;
}

// Troca as páginas da pasta (as .md do topo) pelas novas; o resto, como o .git do clone da Wiki, fica.
export async function writeWiki(out, wiki) {
  await mkdir(out, { recursive: true });
  for (const name of await readdir(out))
    if (name.endsWith('.md')) await rm(path.join(out, name), { force: true });
  for (const [name, content] of wiki) await writeFile(path.join(out, name), content);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const out = path.resolve(process.argv[2] ?? path.join(root, '.data/wiki'));
  let remote = '';
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // sem remote: fica o endereço de exemplo, com o aviso abaixo
  }
  const repoUrl = repoUrlFrom(remote) ?? PLACEHOLDER;
  if (repoUrl === PLACEHOLDER)
    console.warn(
      `wiki: o repositório não tem remote do GitHub; os links para o código apontam para ${PLACEHOLDER}. Gere de novo depois do primeiro push.`,
    );
  const wiki = await buildWiki(root, { repoUrl });
  await writeWiki(out, wiki);
  console.log(`wiki: ${wiki.size} páginas em ${path.relative(root, out) || out}`);
}
