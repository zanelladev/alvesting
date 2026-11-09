import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { buildWiki, repoUrlFrom, rewriteLinks, writeWiki } from './wiki.mjs';

const REPO = 'https://github.com/dono/alvesting';
// o nome de página de cada documento, como o buildWiki monta a partir da lista do script
const pages = new Map([
  ['docs/DEPLOY.md', 'Deploy'],
  ['docs/RUNBOOK.md', 'Runbook'],
  ['docs/INFRA.md', 'Infra'],
  ['docs/adr/0029-blue-green.md', 'ADR-0029-blue-green'],
  ['docs/adr/0032-brapi.md', 'ADR-0032-brapi'],
]);
const rewrite = (markdown, from) => rewriteLinks(markdown, { from, pages, repoUrl: REPO });

describe('reescrita dos links', () => {
  test('link para outro documento vira o nome da página, com a âncora', () => {
    assert.equal(
      rewrite('Ver o [runbook](RUNBOOK.md).', 'docs/DEPLOY.md'),
      'Ver o [runbook](Runbook).',
    );
    assert.equal(
      rewrite('[seção 3](INFRA.md#3-segurança)', 'docs/DEPLOY.md'),
      '[seção 3](Infra#3-segurança)',
    );
    assert.equal(
      rewrite('[ADR 0029](adr/0029-blue-green.md#contexto)', 'docs/DEPLOY.md'),
      '[ADR 0029](ADR-0029-blue-green#contexto)',
    );
  });

  test('de um ADR: o vizinho e o documento da pasta de cima', () => {
    const from = 'docs/adr/0029-blue-green.md';
    assert.equal(rewrite('[0032](0032-brapi.md)', from), '[0032](ADR-0032-brapi)');
    assert.equal(rewrite('[o deploy](../DEPLOY.md#1-o-que)', from), '[o deploy](Deploy#1-o-que)');
  });

  test('a pasta dos ADRs vira a página índice', () => {
    assert.equal(rewrite('[ADRs](adr/)', 'docs/DEPLOY.md'), '[ADRs](ADRs)');
    assert.equal(rewrite('[ADRs](docs/adr)', 'README.md'), '[ADRs](ADRs)');
  });

  test('arquivo que não é página vira o endereço dele no repositório', () => {
    assert.equal(
      rewrite('[o main](../apps/api/src/main.ts)', 'docs/DEPLOY.md'),
      `[o main](${REPO}/blob/main/apps/api/src/main.ts)`,
    );
    assert.equal(
      rewrite('[CLAUDE.md](../../CLAUDE.md#banco)', 'docs/adr/0029-blue-green.md'),
      `[CLAUDE.md](${REPO}/blob/main/CLAUDE.md#banco)`,
    );
    assert.equal(
      rewrite('![a tela](redesign/home.png)', 'docs/DEPLOY.md'),
      `![a tela](${REPO}/raw/main/docs/redesign/home.png)`,
    );
  });

  test('âncora da própria página, endereço externo e e-mail ficam como estão', () => {
    const text = '[acima](#topo) [brapi](https://brapi.dev/termos) [e-mail](mailto:a@example.test)';
    assert.equal(rewrite(text, 'docs/DEPLOY.md'), text);
  });

  test('nada muda dentro de bloco de código, de diagrama Mermaid e de código em linha', () => {
    const text = [
      '```mermaid',
      'flowchart LR',
      '  a["[x](RUNBOOK.md)"] --> b',
      '```',
      '`[y](RUNBOOK.md)` e [z](RUNBOOK.md)',
      '~~~',
      '[w](INFRA.md)',
      '~~~',
    ].join('\n');
    const out = rewrite(text, 'docs/DEPLOY.md').split('\n');
    assert.deepEqual(out.slice(0, 4), text.split('\n').slice(0, 4));
    assert.equal(out[4], '`[y](RUNBOOK.md)` e [z](Runbook)');
    assert.deepEqual(out.slice(5), ['~~~', '[w](INFRA.md)', '~~~']);
  });
});

describe('endereço do repositório', () => {
  test('lê o remote em https e em ssh', () => {
    assert.equal(repoUrlFrom('https://github.com/dono/alvesting.git\n'), REPO);
    assert.equal(repoUrlFrom('git@github.com:dono/alvesting.git'), REPO);
    assert.equal(repoUrlFrom('https://github.com/dono/alvesting'), REPO);
  });

  test('sem remote do GitHub não há endereço', () => {
    assert.equal(repoUrlFrom(''), undefined);
    assert.equal(repoUrlFrom('https://gitlab.com/dono/alvesting.git'), undefined);
  });
});

describe('páginas da Wiki', () => {
  const dirs = [];
  after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  async function workspace(files) {
    const dir = await mkdtemp(path.join(tmpdir(), 'wiki-'));
    dirs.push(dir);
    for (const [relative, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
      await writeFile(path.join(dir, relative), content);
    }
    return dir;
  }

  const MERMAID = '```mermaid\nC4Context\n  Person(p, "Pessoa")\n```\n';
  const files = {
    'README.md':
      '# Alvesting\n\nArena pública de LLMs.\n\nProjeto acadêmico.\n\n**Estado:** muita coisa.\n\n## Documentos\n',
    'docs/DEPLOY.md':
      '# Deploy\n\nVer o [runbook](RUNBOOK.md) e o [ADR](adr/0029-blue-green.md).\n',
    'docs/RUNBOOK.md': `# Runbook\n\n${MERMAID}`,
    'docs/NOVO.md': '# Um documento que a lista não conhece\n',
    'docs/DESIGN.md': '---\nname: Alvesting\n---\n\n# Design\n',
    'docs/adr/0029-blue-green.md': '# ADR 0029: Blue/green\n\nVolta ao [deploy](../DEPLOY.md).\n',
    'docs/temporada-1/relatorios/t2.md': '# Relatório de onda: não é documento principal\n',
  };

  test('Home com o resumo do README e os links, _Sidebar e uma página por documento e por ADR', async () => {
    const wiki = await buildWiki(await workspace(files), { repoUrl: REPO });
    assert.deepEqual([...wiki.keys()].sort(), [
      'ADR-0029-blue-green.md',
      'ADRs.md',
      'Deploy.md',
      'Design.md',
      'Home.md',
      'NOVO.md',
      'Runbook.md',
      '_Sidebar.md',
    ]);
    const home = wiki.get('Home.md');
    assert.match(home, /Arena pública de LLMs\.\n\nProjeto acadêmico\./);
    assert.doesNotMatch(home, /Estado/);
    assert.match(home, /\[Deploy\]\(Deploy\)/);
    assert.match(home, /\[Decisões \(ADRs\)\]\(ADRs\)/);
    assert.match(wiki.get('_Sidebar.md'), /\[Runbook\]\(Runbook\)/);
    // o documento que a lista não conhece também vira página, no grupo "Outros"
    assert.match(home, /Outros[\s\S]*\[Um documento que a lista não conhece\]\(NOVO\)/);
    assert.match(wiki.get('ADRs.md'), /\[ADR 0029: Blue\/green\]\(ADR-0029-blue-green\)/);
  });

  test('cada página diz de onde veio, com os links reescritos e o Mermaid intacto', async () => {
    const wiki = await buildWiki(await workspace(files), { repoUrl: REPO });
    const deploy = wiki.get('Deploy.md');
    assert.match(deploy, new RegExp(`\\(${REPO}/blob/main/docs/DEPLOY\\.md\\)`));
    assert.match(deploy, /\[runbook\]\(Runbook\) e o \[ADR\]\(ADR-0029-blue-green\)/);
    assert.match(wiki.get('ADR-0029-blue-green.md'), /\[deploy\]\(Deploy\)/);
    assert.ok(wiki.get('Runbook.md').endsWith(MERMAID));
    // o front matter do DESIGN.md vira um bloco yaml, que a Wiki mostra como código
    assert.match(wiki.get('Design.md'), /```yaml\nname: Alvesting\n```\n\n# Design/);
  });

  test('gravar troca as páginas antigas e não toca no .git do clone da Wiki', async () => {
    const out = await workspace({
      'Pagina-velha.md': 'velha',
      '.git/HEAD': 'ref: refs/heads/master\n',
    });
    await writeWiki(out, new Map([['Home.md', '# Home\n']]));
    assert.deepEqual((await readdir(out)).sort(), ['.git', 'Home.md']);
    assert.equal(await readFile(path.join(out, '.git/HEAD'), 'utf8'), 'ref: refs/heads/master\n');
  });
});
