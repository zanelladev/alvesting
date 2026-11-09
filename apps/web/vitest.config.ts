import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes de unidade moram em src. O e2e/ é do Playwright e não pode cair no Vitest: o `test` do package.json já
    // passa --dir src, e a mesma regra fica aqui para valer também em quem chama o vitest sem ela.
    dir: 'src',
    // Cobertura (docs/QUALIDADE.md): só liga com --coverage (o `pnpm coverage` da raiz), e o `vitest run` de sempre não muda.
    coverage: {
      provider: 'v8',
      // Todo o código do site, e não só o que algum teste importou: sem o include, o Vitest 5 só conta o arquivo carregado
      // por um teste, e uma tela sem teste nenhum sumiria da conta em vez de entrar com 0%. Só .ts e .tsx: o CSS, o SVG,
      // a arte em JSON e o LICENSE das bibliotecas não são código.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // os próprios testes; o Vitest já os tira (o que casa com o padrão dos testes), e a linha deixa a regra à vista,
        // igual à do sonar-project.properties
        'src/**/*.spec.{ts,tsx}',
      ],
      reporter: [
        'text-summary',
        'json-summary',
        // os caminhos do lcov.info a partir da raiz do monorepo (apps/web/src/...): o SonarCloud lê os três relatórios
        // juntos, e com `src/...` o arquivo de um pacote se confundiria com o de mesmo nome em outro
        ['lcovonly', { projectRoot: fileURLToPath(new URL('../..', import.meta.url)) }],
        'html',
      ],
      // O mínimo do Playbook da Católica SC para o frontend da linha Web Apps (25%), conferido na prova de autoria.
      thresholds: { lines: 25, statements: 25 },
    },
  },
});
