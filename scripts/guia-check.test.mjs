import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkGuide } from './guia-check.mjs';

const script = fileURLToPath(new URL('./guia-check.mjs', import.meta.url));
const dirs = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const CODE = [
  'export class PortfolioService {',
  '  async replace(userId, id, input) {',
  '    return callBudget(userId);',
  '  }',
  '}',
  'const LOT_SELECT = { id: true };',
].join('\n');

// Monta um repositório de mentira num diretório temporário: o guia e os arquivos que ele cita.
async function workspace(guide, files = { 'apps/api/src/portfolio.service.ts': CODE }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'guia-check-'));
  dirs.push(dir);
  const all = guide === undefined ? files : { ...files, 'docs/GUIA-DO-CODIGO.md': guide };
  for (const [relative, content] of Object.entries(all)) {
    const target = path.join(dir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return dir;
}

const reasons = (result) => result.broken.map((b) => [b.line, b.reference, b.reason]);

describe('referências que valem', () => {
  test('passa quando o arquivo existe e o símbolo aparece nele, e conta cada referência', async () => {
    const root = await workspace(
      [
        '# Guia',
        'O serviço: `apps/api/src/portfolio.service.ts#PortfolioService`.',
        'Duas na mesma linha: `apps/api/src/portfolio.service.ts#LOT_SELECT` e `apps/api/src/portfolio.service.ts#replace`.',
      ].join('\n'),
    );
    const result = await checkGuide(root);
    assert.deepEqual(result.broken, []);
    assert.equal(result.checked, 3);
  });

  test('o símbolo pode ser um texto com espaço e pontuação, procurado como está', async () => {
    const root = await workspace(
      'Veja `apps/api/src/portfolio.service.ts#async replace(userId, id, input)`.',
    );
    assert.deepEqual((await checkGuide(root)).broken, []);
  });

  test('caminho com grupos de rota e segmentos dinâmicos do Next', async () => {
    const page = 'apps/web/src/app/(app)/(carteira)/carteira/[id]/page.tsx';
    const root = await workspace(`A página: \`${page}#WalletPage\`.`, {
      [page]: 'export default withApiDown(async function WalletPage() {});',
    });
    assert.deepEqual((await checkGuide(root)).broken, []);
  });
});

describe('referências quebradas', () => {
  test('arquivo que não existe falha, com a linha do guia', async () => {
    const root = await workspace(
      ['# Guia', '', 'Some: `apps/api/src/sumiu.ts#PortfolioService`.'].join('\n'),
    );
    assert.deepEqual(reasons(await checkGuide(root)), [
      [3, 'apps/api/src/sumiu.ts#PortfolioService', 'o arquivo não existe'],
    ]);
  });

  test('símbolo que não aparece no arquivo falha (o código mudou e o guia não)', async () => {
    const root = await workspace('Ver `apps/api/src/portfolio.service.ts#PortfolioRepository`.');
    assert.deepEqual(reasons(await checkGuide(root)), [
      [
        1,
        'apps/api/src/portfolio.service.ts#PortfolioRepository',
        'o símbolo não aparece no arquivo',
      ],
    ]);
  });

  test('um identificador vale só como palavra inteira: `call` não é achado dentro de `callBudget`', async () => {
    const root = await workspace('Ver `apps/api/src/portfolio.service.ts#call`.');
    assert.deepEqual(reasons(await checkGuide(root)), [
      [1, 'apps/api/src/portfolio.service.ts#call', 'o símbolo não aparece no arquivo'],
    ]);
  });

  test('uma pasta não é arquivo', async () => {
    const root = await workspace('Ver `apps/api/src#PortfolioService`.');
    assert.deepEqual(reasons(await checkGuide(root)), [
      [1, 'apps/api/src#PortfolioService', 'não é um arquivo'],
    ]);
  });

  test('caminho absoluto ou que sai do repositório falha, mesmo que o arquivo exista', async () => {
    const root = await workspace(
      [
        `Absoluto: \`${path.join(tmpdir(), 'x.ts')}#x\`.`,
        'Para fora: `../fora/portfolio.service.ts#PortfolioService`.',
      ].join('\n'),
    );
    assert.deepEqual(
      (await checkGuide(root)).broken.map((b) => [b.line, b.reason]),
      [
        [1, 'fora do repositório'],
        [2, 'fora do repositório'],
      ],
    );
  });

  test('cada referência quebrada aparece, também a repetida em outra linha', async () => {
    const root = await workspace(
      [
        'Uma: `apps/api/src/sumiu.ts#x`.',
        'Boa: `apps/api/src/portfolio.service.ts#LOT_SELECT`.',
        'De novo: `apps/api/src/sumiu.ts#x`.',
      ].join('\n'),
    );
    const result = await checkGuide(root);
    assert.equal(result.checked, 3);
    assert.deepEqual(
      result.broken.map((b) => b.line),
      [1, 3],
    );
  });
});

describe('o que não é referência', () => {
  test('código em linha sem `#`, âncora sem caminho e texto com `#` fora de código não contam', async () => {
    const root = await workspace(
      [
        'A rota `/api/v1/me/portfolio`, o filtro `/?filtro=` e a âncora `#feed` ou `C#`.',
        'Fora de código: apps/api/src/sumiu.ts#x não é referência.',
        'Esta é: `apps/api/src/portfolio.service.ts#LOT_SELECT`.',
      ].join('\n'),
    );
    const result = await checkGuide(root);
    assert.deepEqual(result.broken, []);
    assert.equal(result.checked, 1);
  });

  test('bloco de código cercado fica de fora: um comentário de shell não é referência', async () => {
    const root = await workspace(
      [
        '```bash',
        'pnpm install   # `apps/api/src/sumiu.ts#x` aqui é exemplo',
        '```',
        '~~~',
        '`apps/api/src/sumiu.ts#y`',
        '~~~',
        'Depois do bloco: `apps/api/src/portfolio.service.ts#LOT_SELECT`.',
      ].join('\n'),
    );
    const result = await checkGuide(root);
    assert.deepEqual(result.broken, []);
    assert.equal(result.checked, 1);
  });
});

describe('linha de comando', () => {
  test('sai com 0 e conta as referências; sai com 1 e lista a quebrada', async () => {
    const good = await workspace('Ver `apps/api/src/portfolio.service.ts#PortfolioService`.');
    const passed = spawnSync(process.execPath, [script, good], { encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, /guia-check ok: 1 referência conferida/);

    const bad = await workspace(
      [
        'Ver `apps/api/src/portfolio.service.ts#PortfolioService`.',
        '`apps/api/src/sumiu.ts#x`',
      ].join('\n'),
    );
    const failed = spawnSync(process.execPath, [script, bad], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /guia-check falhou: 1 de 2 referências quebradas/);
    assert.match(failed.stdout, /linha 2: `apps\/api\/src\/sumiu\.ts#x` +o arquivo não existe/);
  });

  test('guia sem nenhuma referência falha: um guia que não cita o código não está sendo conferido', async () => {
    const root = await workspace('# Guia\n\nSó prosa, `sem#referência` de código.\n');
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /nenhuma referência/);
  });

  test('sem o guia sai com 2 e uma mensagem curta, sem despejar a pilha', async () => {
    const root = await workspace(undefined);
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /guia-check não conseguiu ler .*ENOENT/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });
});
