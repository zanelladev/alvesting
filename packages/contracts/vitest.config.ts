import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // Cobertura (docs/QUALIDADE.md): só liga com --coverage (o `pnpm coverage` da raiz), e o `vitest run` de sempre não muda.
    coverage: {
      provider: 'v8',
      // Todos os contratos, e não só o que algum teste importou: sem o include, o Vitest 5 só conta o arquivo carregado por
      // um teste, e um schema sem teste nenhum sumiria da conta em vez de entrar com 0%.
      include: ['src/**/*.ts'],
      exclude: [
        // os próprios testes; o Vitest já os tira (o que casa com o include dos testes), e a linha deixa a regra à vista,
        // igual à do sonar-project.properties
        'src/**/*.spec.ts',
      ],
      reporter: [
        'text-summary',
        'json-summary',
        // os caminhos do lcov.info a partir da raiz do monorepo (packages/contracts/src/...): o SonarCloud lê os três
        // relatórios juntos, e com `src/...` o arquivo de um pacote se confundiria com o de mesmo nome em outro
        ['lcovonly', { projectRoot: fileURLToPath(new URL('../..', import.meta.url)) }],
        'html',
      ],
      // Os contratos servem a api e o site; ficam com o mínimo do backend (75%), o maior dos dois do Playbook.
      thresholds: { lines: 75, statements: 75 },
    },
  },
});
