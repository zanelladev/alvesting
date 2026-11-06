import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkDocs } from './docs-check.mjs';

const script = fileURLToPath(new URL('./docs-check.mjs', import.meta.url));
const dirs = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const HEADER =
  '| Item | Tipo | Versão | Licença | Para quê | Onde | Data | Link |\n|---|---|---|---|---|---|---|---|\n';
const row = (item, tipo, overrides = {}) => {
  const cells = {
    item: `\`${item}\``,
    tipo,
    versao: '1.0.0',
    licenca: 'MIT',
    paraQue: 'teste',
    onde: 'apps/api',
    data: '31/10/2026',
    link: 'https://example.com',
    ...overrides,
  };
  return `| ${Object.values(cells).join(' | ')} |\n`;
};
const doc = (...rows) => HEADER + rows.join('');

// Monta um workspace de mentira num diretório temporário.
async function workspace(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'docs-check-'));
  dirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const names = (result) => result.missing.map((m) => `${m.kind}:${m.name}`).sort();

describe('pacotes npm', () => {
  const packages = {
    'package.json': { devDependencies: { turbo: '2.11.10' } },
    'apps/api/package.json': {
      dependencies: { zod: '4.6.7', '@nestjs/core': '12.3.2' },
      devDependencies: { vitest: '5.0.5' },
    },
  };

  test('falha e lista cada dependência e devDependency que falta', async () => {
    const root = await workspace({
      ...packages,
      'docs/DEPENDENCIAS.md': doc(row('turbo', 'pacote npm')),
    });
    const result = await checkDocs(root);
    assert.deepEqual(names(result), ['npm:@nestjs/core', 'npm:vitest', 'npm:zod']);
    const zod = result.missing.find((m) => m.name === 'zod');
    assert.equal(zod.source, 'apps/api/package.json');
  });

  test('passa quando todas estão documentadas, inclusive as com escopo', async () => {
    const root = await workspace({
      ...packages,
      'docs/DEPENDENCIAS.md': doc(
        row('turbo', 'pacote npm'),
        row('zod', 'pacote npm'),
        row('@nestjs/core', 'pacote npm'),
        row('vitest', 'pacote npm (dev)'),
      ),
    });
    const result = await checkDocs(root);
    assert.deepEqual(result.missing, []);
    assert.equal(result.checked, 4);
  });

  test('olha também optionalDependencies e peerDependencies', async () => {
    const root = await workspace({
      'apps/web/package.json': {
        optionalDependencies: { sharp: '0.34.0' },
        peerDependencies: { react: '^19.0.0' },
      },
      'docs/DEPENDENCIAS.md': doc(row('sharp', 'pacote npm')),
    });
    assert.deepEqual(names(await checkDocs(root)), ['npm:react']);
  });

  test('ignora dependências internas do workspace', async () => {
    const root = await workspace({
      'package.json': { devDependencies: { '@alvesting/config': 'workspace:*' } },
      'apps/web/package.json': { dependencies: { '@alvesting/contracts': 'workspace:*' } },
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual((await checkDocs(root)).missing, []);
  });

  test('ignora package.json dentro de node_modules, .next, dist e .turbo', async () => {
    const root = await workspace({
      'package.json': { dependencies: {} },
      'node_modules/pacote/package.json': { dependencies: { fantasma: '1.0.0' } },
      'apps/web/.next/standalone/package.json': { dependencies: { fantasma: '1.0.0' } },
      'apps/api/dist/package.json': { dependencies: { fantasma: '1.0.0' } },
      '.turbo/package.json': { dependencies: { fantasma: '1.0.0' } },
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual((await checkDocs(root)).missing, []);
  });

  test('só conta a primeira coluna: citar o pacote em outra célula não documenta', async () => {
    const root = await workspace({
      'package.json': { dependencies: { zod: '4.6.7' } },
      'docs/DEPENDENCIAS.md': doc(row('outro', 'pacote npm', { paraQue: 'usa `zod` por baixo' })),
    });
    assert.deepEqual(names(await checkDocs(root)), ['npm:zod']);
  });

  test('o tipo importa: uma imagem Docker homônima não documenta o pacote npm', async () => {
    const root = await workspace({
      'package.json': { dependencies: { postgres: '3.0.0' } },
      'docs/DEPENDENCIAS.md': doc(row('postgres', 'imagem Docker')),
    });
    assert.deepEqual(names(await checkDocs(root)), ['npm:postgres']);
  });

  test('linha incompleta (célula em branco) não vale', async () => {
    const root = await workspace({
      'package.json': { dependencies: { zod: '4.6.7' } },
      'docs/DEPENDENCIAS.md': doc(row('zod', 'pacote npm', { licenca: '' })),
    });
    const result = await checkDocs(root);
    assert.deepEqual(names(result), ['npm:zod']);
    assert.match(result.missing[0].reason, /incompleta/i);
  });

  test('sem docs/DEPENDENCIAS.md tudo falta e o motivo é dito', async () => {
    const root = await workspace({ 'package.json': { dependencies: { zod: '4.6.7' } } });
    const result = await checkDocs(root);
    assert.deepEqual(names(result), ['npm:zod']);
  });
});

describe('imagens Docker', () => {
  test('lê as imagens do docker-compose sem tag nem digest', async () => {
    const root = await workspace({
      'docker-compose.yml': [
        'services:',
        '  db:',
        '    image: postgres:17.11',
        '  blob:',
        '    image: "mcr.microsoft.com/azure-storage/azurite:3.37.0"',
        '  fixa:',
        '    image: redis@sha256:abc123',
        '  sem-tag:',
        "    image: 'busybox'",
        '',
      ].join('\n'),
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual(names(await checkDocs(root)), [
      'docker:busybox',
      'docker:mcr.microsoft.com/azure-storage/azurite',
      'docker:postgres',
      'docker:redis',
    ]);
  });

  test('passa quando as imagens estão documentadas', async () => {
    const root = await workspace({
      'docker-compose.yml': 'services:\n  db:\n    image: postgres:17.11\n',
      'docs/DEPENDENCIAS.md': doc(row('postgres', 'imagem Docker')),
    });
    assert.deepEqual((await checkDocs(root)).missing, []);
  });

  test('lê o FROM de qualquer Dockerfile e ignora estágios, scratch e flags', async () => {
    const root = await workspace({
      'apps/api/Dockerfile': [
        'ARG NODE_VERSION=26',
        'FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine AS build',
        'RUN true',
        'FROM build AS prontos',
        'FROM scratch',
        'FROM gcr.io/distroless/nodejs26-debian12:nonroot',
        '',
      ].join('\n'),
      'apps/web/Dockerfile.prod': 'FROM node:26-alpine\n',
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual(names(await checkDocs(root)), [
      'docker:gcr.io/distroless/nodejs26-debian12',
      'docker:node',
    ]);
  });

  test('FROM com variável no nome da imagem não é verificável e falha', async () => {
    const root = await workspace({
      Dockerfile: 'ARG BASE=node:26\nFROM ${BASE}\n',
      'docs/DEPENDENCIAS.md': doc(),
    });
    const result = await checkDocs(root);
    assert.equal(result.missing.length, 1);
    assert.match(result.missing[0].reason, /variável/i);
  });
});

describe('GitHub Actions', () => {
  test('exige as actions usadas nos workflows, menos as locais', async () => {
    const root = await workspace({
      '.github/workflows/ci.yml': [
        'jobs:',
        '  check:',
        '    steps:',
        '      - uses: actions/checkout@v6',
        '      - uses: pnpm/action-setup@v5',
        '      - uses: github/codeql-action/analyze@v4',
        '      - uses: ./.github/actions/local',
        '',
      ].join('\n'),
      'docs/DEPENDENCIAS.md': doc(row('actions/checkout', 'GitHub Action')),
    });
    assert.deepEqual(names(await checkDocs(root)), [
      'action:github/codeql-action',
      'action:pnpm/action-setup',
    ]);
  });

  test('uses: docker:// é imagem Docker, não action', async () => {
    const root = await workspace({
      '.github/workflows/ci.yml': 'jobs:\n  a:\n    steps:\n      - uses: docker://alpine:3.20\n',
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual(names(await checkDocs(root)), ['docker:alpine']);
  });

  test('imagem de services: e container: (em texto ou em mapa) do workflow', async () => {
    const root = await workspace({
      '.github/workflows/ci.yml': [
        'jobs:',
        '  check:',
        '    container: node:26-alpine',
        '    services:',
        '      postgres:',
        '        image: postgres:17.11',
        '      redis:',
        '        image: "redis:7.4"',
        '  outro:',
        '    container:',
        '      image: ghcr.io/org/build-tools:1.2.3',
        '      options: --cpus 1',
        '',
      ].join('\n'),
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual(names(await checkDocs(root)), [
      'docker:ghcr.io/org/build-tools',
      'docker:node',
      'docker:postgres',
      'docker:redis',
    ]);
  });

  test('passa quando a imagem do service está documentada', async () => {
    const root = await workspace({
      '.github/workflows/ci.yml':
        'jobs:\n  check:\n    services:\n      db:\n        image: postgres:17.11\n',
      'docs/DEPENDENCIAS.md': doc(row('postgres', 'imagem Docker')),
    });
    assert.deepEqual((await checkDocs(root)).missing, []);
  });

  test('actions compostas em .github/actions: o uses: e a imagem de dentro também contam', async () => {
    const root = await workspace({
      '.github/actions/setup/action.yml': [
        'name: setup',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - uses: actions/cache@v5',
        '    - uses: ./.github/actions/outra',
        '',
      ].join('\n'),
      '.github/actions/scan/action.yaml': [
        'name: scan',
        'runs:',
        '  using: docker',
        "  image: 'docker://ghcr.io/org/scanner:2.0'",
        '',
      ].join('\n'),
      '.github/actions/build/action.yml': 'runs:\n  using: docker\n  image: Dockerfile\n',
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual(names(await checkDocs(root)), [
      'action:actions/cache',
      'docker:ghcr.io/org/scanner',
    ]);
  });
});

describe('imagens em Bicep', () => {
  test('image: com texto literal conta; identificador não; montada em variável falha', async () => {
    const root = await workspace({
      'infra/modules/apps.bicep': [
        "var apiImage = '${registry}/alvesting-api:${tag}'",
        'resource app {',
        '  properties: {',
        '    template: {',
        '      containers: [',
        "        { image: 'mcr.microsoft.com/k8se/quickstart:latest' }",
        '        { image: apiImage }',
        "        { name: 'x', image: '${registry}/web:${tag}' }",
        '      ]',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
      'docs/DEPENDENCIAS.md': doc(),
    });
    const result = await checkDocs(root);
    assert.deepEqual(names(result), [
      'docker:${registry}/web',
      'docker:mcr.microsoft.com/k8se/quickstart',
    ]);
    assert.match(result.missing.find((m) => m.name.includes('$')).reason, /variável/i);
  });

  test('duas imagens na mesma linha contam as duas', async () => {
    const root = await workspace({
      'infra/apps.bicep': "var c = [{ image: 'ghcr.io/org/a:1' }, { image: 'ghcr.io/org/b:2' }]\n",
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual(names(await checkDocs(root)), [
      'docker:ghcr.io/org/a',
      'docker:ghcr.io/org/b',
    ]);
  });

  test('o param de tag e o content type image/svg não são imagem', async () => {
    const root = await workspace({
      'infra/main.bicep': "param apiImageTag string\nvar types = ['image/svg+xml']\n",
      'infra/main.dev.bicepparam': "param apiImageTag = 'latest'\n",
      'docs/DEPENDENCIAS.md': doc(),
    });
    assert.deepEqual((await checkDocs(root)).missing, []);
  });
});

// O código copiado de registro (ADR 0037): todo arquivo das pastas das três bibliotecas tem a linha dele na tabela "Componentes copiados de
// registros", pelo caminho do arquivo ou da pasta dele na coluna Onde, e cada pasta tem o LICENSE da MIT. Os testes nossos (`.spec`) ficam fora.
describe('componentes copiados de registros', () => {
  const ARC = 'apps/web/src/components/arc';
  const section = (...rows) =>
    `## Componentes copiados de registros (ADR 0037)\n\nTexto.\n\n${doc(...rows)}\n## Outra\n`;
  const copied = (onde, overrides = {}) =>
    row('Arc `tooltip`', 'componente copiado (registro shadcn da Arc)', { onde, ...overrides });
  const files = {
    [`${ARC}/LICENSE`]: 'MIT',
    [`${ARC}/tooltip/tooltip.tsx`]: '',
    [`${ARC}/tooltip/tooltip.module.css`]: '',
    [`${ARC}/lib/motion-tokens.ts`]: '',
    [`${ARC}/arc.spec.tsx`]: '',
  };

  test('falha e lista cada arquivo copiado sem linha na tabela', async () => {
    const root = await workspace({
      ...files,
      'docs/DEPENDENCIAS.md': section(copied(`${ARC}/lib/motion-tokens.ts`)),
    });
    const result = await checkDocs(root);
    assert.deepEqual(names(result), [
      `componente:${ARC}/tooltip/tooltip.module.css`,
      `componente:${ARC}/tooltip/tooltip.tsx`,
    ]);
    assert.match(result.missing[0].reason, /Componentes copiados de registros/);
  });

  test('a pasta na coluna Onde cobre os arquivos de dentro dela, e o teste nosso não precisa de linha', async () => {
    const root = await workspace({
      ...files,
      'docs/DEPENDENCIAS.md': section(
        copied(`${ARC}/tooltip`),
        copied(`${ARC}/lib/motion-tokens.ts, apps/web/src/app/globals.css (o bloco)`),
      ),
    });
    assert.deepEqual((await checkDocs(root)).missing, []);
  });

  test('a pasta com o nome começado igual não cobre: tooltip não é tooltip-extra', async () => {
    const root = await workspace({
      ...files,
      [`${ARC}/tooltip-extra/x.tsx`]: '',
      'docs/DEPENDENCIAS.md': section(
        copied(`${ARC}/tooltip`),
        copied(`${ARC}/lib/motion-tokens.ts`),
      ),
    });
    assert.deepEqual(names(await checkDocs(root)), [`componente:${ARC}/tooltip-extra/x.tsx`]);
  });

  test('a linha precisa estar na seção certa e completa', async () => {
    const outside = await workspace({
      ...files,
      'docs/DEPENDENCIAS.md': `## Desenho de terceiros\n\n${doc(copied(`${ARC}/tooltip`), copied(`${ARC}/lib`))}`,
    });
    assert.equal((await checkDocs(outside)).missing.length, 3);

    const incomplete = await workspace({
      ...files,
      'docs/DEPENDENCIAS.md': section(
        copied(`${ARC}/tooltip`, { data: 'hoje' }),
        copied(`${ARC}/lib`),
      ),
    });
    const result = await checkDocs(incomplete);
    assert.deepEqual(
      result.missing.map((m) => m.reason),
      ['Data deve ser dd/mm/aaaa', 'Data deve ser dd/mm/aaaa'],
    );
  });

  test('a pasta da biblioteca sem o LICENSE falha', async () => {
    const root = await workspace({
      'apps/web/src/components/beui/line-chart.tsx': '',
      'docs/DEPENDENCIAS.md': section(copied('apps/web/src/components/beui/line-chart.tsx')),
    });
    const result = await checkDocs(root);
    assert.deepEqual(names(result), ['componente:apps/web/src/components/beui/LICENSE']);
    assert.match(result.missing[0].reason, /LICENSE/);
  });
});

describe('conteúdo das colunas', () => {
  const pkg = { 'package.json': { dependencies: { zod: '4.6.7' } } };
  const reasonFor = async (overrides) => {
    const root = await workspace({
      ...pkg,
      'docs/DEPENDENCIAS.md': doc(row('zod', 'pacote npm', overrides)),
    });
    return (await checkDocs(root)).missing.map((m) => m.reason);
  };

  test('Link precisa começar por http:// ou https://', async () => {
    assert.deepEqual(await reasonFor({ link: 'npmjs.com/package/zod' }), [
      'Link deve começar por http:// ou https://',
    ]);
    assert.deepEqual(await reasonFor({ link: 'n/a' }), [
      'Link deve começar por http:// ou https://',
    ]);
    assert.deepEqual(await reasonFor({ link: 'http://example.com' }), []);
    assert.deepEqual(await reasonFor({ link: 'https://example.com' }), []);
  });

  test('Data precisa ser dd/mm/aaaa e existir no calendário', async () => {
    const expected = ['Data deve ser dd/mm/aaaa'];
    assert.deepEqual(await reasonFor({ data: '2026-10-31' }), expected);
    assert.deepEqual(await reasonFor({ data: '1/1/2026' }), expected);
    assert.deepEqual(await reasonFor({ data: 'hoje' }), expected);
    assert.deepEqual(await reasonFor({ data: '31/02/2026' }), expected);
    assert.deepEqual(await reasonFor({ data: '00/10/2026' }), expected);
    assert.deepEqual(await reasonFor({ data: '31/13/2026' }), expected);
    assert.deepEqual(await reasonFor({ data: '29/02/2028' }), []);
    assert.deepEqual(await reasonFor({ data: '31/10/2026' }), []);
  });

  test('basta uma linha boa: a duplicata com link ruim não derruba o item', async () => {
    const root = await workspace({
      ...pkg,
      'docs/DEPENDENCIAS.md': doc(
        row('zod', 'pacote npm', { link: 'rascunho' }),
        row('zod', 'pacote npm'),
      ),
    });
    assert.deepEqual((await checkDocs(root)).missing, []);
  });
});

describe('leitura do DEPENDENCIAS.md', () => {
  test('só a falta do arquivo vira "não existe"; outro erro de leitura não é escondido', async () => {
    const missingDoc = await workspace({ 'package.json': { dependencies: { zod: '4.6.7' } } });
    const result = await checkDocs(missingDoc);
    assert.match(result.missing[0].reason, /não existe/);

    // docs/DEPENDENCIAS.md é uma pasta: o erro é EISDIR, não ENOENT
    const broken = await workspace({
      'package.json': { dependencies: { zod: '4.6.7' } },
      'docs/DEPENDENCIAS.md/.keep': '',
    });
    await assert.rejects(checkDocs(broken), { code: 'EISDIR' });
  });

  test('package.json malformado derruba a checagem em vez de ser ignorado', async () => {
    const root = await workspace({
      'package.json': '{ "dependencies": ',
      'docs/DEPENDENCIAS.md': doc(),
    });
    await assert.rejects(checkDocs(root), SyntaxError);
  });
});

describe('linha de comando', () => {
  test('sai com 1 e lista o que falta; sai com 0 quando está tudo documentado', async () => {
    const missing = await workspace({
      'package.json': { dependencies: { zod: '4.6.7' } },
      'docs/DEPENDENCIAS.md': doc(),
    });
    const failed = spawnSync(process.execPath, [script, missing], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout + failed.stderr, /zod/);
    assert.match(failed.stdout + failed.stderr, /package\.json/);

    const complete = await workspace({
      'package.json': { dependencies: { zod: '4.6.7' } },
      'docs/DEPENDENCIAS.md': doc(row('zod', 'pacote npm')),
    });
    const passed = spawnSync(process.execPath, [script, complete], { encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.match(passed.stdout, /ok/i);
  });

  test('erro de leitura sai com 2 e mensagem curta, sem despejar a pilha', async () => {
    const broken = await workspace({
      'package.json': { dependencies: { zod: '4.6.7' } },
      'docs/DEPENDENCIAS.md/.keep': '',
    });
    const result = spawnSync(process.execPath, [script, broken], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /docs:check não conseguiu ler/);
    assert.match(result.stderr, /EISDIR/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });
});
