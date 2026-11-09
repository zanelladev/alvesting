// pnpm coverage: os testes dos três pacotes com --coverage, pelo turbo (o mesmo `test` do `pnpm test`), e no fim o backend,
// os contratos e o frontend lado a lado, lidos do coverage-summary.json de cada um (docs/QUALIDADE.md). Quem reprova o
// mínimo é o próprio Vitest (os thresholds de cada vitest.config.ts); este script só confere o ambiente e imprime.
// Uso: TEST_DATABASE_URL=... STORAGE_CONNECTION_STRING=... pnpm coverage
// Saída: a do turbo (1 se um teste ou um mínimo reprovou); 1 também sem as variáveis de integração.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Sem elas os testes de integração da api (cerca de mil) são pulados e o backend sai com um número menor que o real.
const REQUIRED_ENV = ['TEST_DATABASE_URL', 'STORAGE_CONNECTION_STRING'];

// O mínimo é o do Playbook da Católica SC para a linha Web Apps (75% backend, 25% frontend); os contratos, que servem
// os dois, ficam com o do backend. Os mesmos números estão nos thresholds de cada vitest.config.ts.
const PACKAGES = [
  { label: 'backend', dir: 'apps/api', min: 75 },
  { label: 'contratos', dir: 'packages/contracts', min: 75 },
  { label: 'frontend', dir: 'apps/web', min: 25 },
];

export function missingEnv(env) {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

const pct = (value) =>
  `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// summaries: { 'apps/api': <coverage-summary.json> | undefined, ... }
export function report(summaries) {
  const rows = PACKAGES.map(({ label, dir, min }) => {
    const total = summaries[dir]?.total;
    const name = `${label.padEnd(10)} ${dir.padEnd(19)}`;
    if (!total) return `  ${name} sem relatório (os testes deste pacote falharam?)`;
    const { lines, statements } = total;
    const below = lines.pct < min || statements.pct < min ? '  abaixo do mínimo' : '';
    return `  ${name} linhas ${pct(lines.pct).padStart(7)}  instruções ${pct(statements.pct).padStart(7)}  mínimo ${min}%${below}`;
  });
  return [
    'Cobertura de linhas e instruções (Playbook da Católica SC, linha Web Apps)',
    ...rows,
  ].join('\n');
}

function readSummary(root, dir) {
  try {
    return JSON.parse(readFileSync(path.join(root, dir, 'coverage/coverage-summary.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const missing = missingEnv(process.env);
  if (missing.length > 0) {
    console.error(
      `pnpm coverage precisa de ${missing.join(' e ')}: sem elas os testes de integração da api são pulados e o número` +
        ' do backend sai menor que o real. Com o Postgres e o Azurite do docker compose no ar:\n\n' +
        '  TEST_DATABASE_URL=postgresql://alvesting:alvesting@localhost:25432/alvesting_test \\\n' +
        "  STORAGE_CONNECTION_STRING='UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://127.0.0.1:25100' \\\n" +
        '  pnpm coverage',
    );
    process.exitCode = 1;
  } else {
    const run = spawnSync('pnpm', ['exec', 'turbo', 'run', 'test', '--', '--coverage'], {
      cwd: root,
      stdio: 'inherit',
    });
    const summaries = Object.fromEntries(PACKAGES.map(({ dir }) => [dir, readSummary(root, dir)]));
    console.log(`\n${report(summaries)}`);
    process.exitCode = run.status ?? 1;
  }
}
