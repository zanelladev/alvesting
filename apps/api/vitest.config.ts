import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // Os testes de integração dividem o mesmo banco alvesting_test e limpam as tabelas que usam: arquivos em
    // paralelo se atropelariam. Cada arquivo roda por vez; dentro do arquivo os testes já são em sequência.
    fileParallelism: false,
    // Nenhum teste pega credencial de verdade da Azure. Sem isto, um DefaultAzureCredential que escapasse do fake
    // sondaria o IMDS e pediria token ao az logado na máquina de quem roda (aconteceu em 03/11/2026). Só com a
    // WorkloadIdentityCredential e sem o arquivo dela, todo getToken falha na hora, sem rede e sem az. Teste que
    // precisa de token injeta um falso.
    env: { AZURE_TOKEN_CREDENTIALS: 'WorkloadIdentityCredential', AZURE_FEDERATED_TOKEN_FILE: '' },
    // Cobertura (docs/QUALIDADE.md): só liga com --coverage (o `pnpm coverage` da raiz), e o `vitest run` de sempre não muda.
    coverage: {
      provider: 'v8',
      // Todo o código da api, e não só o que algum teste importou: sem o include, o Vitest 5 só conta o arquivo carregado
      // por um teste, e um módulo sem teste nenhum sumiria da conta em vez de entrar com 0%.
      include: ['src/**/*.ts'],
      exclude: [
        // o cliente do Prisma, gerado pelo `prisma generate` (fora do git): não é código escrito aqui
        'src/generated/**',
        // os próprios testes; o Vitest já os tira (o que casa com o include dos testes), e a linha deixa a regra à vista,
        // igual à do sonar-project.properties
        'src/**/*.spec.ts',
      ],
      reporter: [
        'text-summary',
        'json-summary',
        // os caminhos do lcov.info a partir da raiz do monorepo (apps/api/src/...): o SonarCloud lê os três relatórios
        // juntos, e com `src/...` o arquivo de um pacote se confundiria com o de mesmo nome em outro
        ['lcovonly', { projectRoot: fileURLToPath(new URL('../..', import.meta.url)) }],
        'html',
      ],
      // O mínimo do Playbook da Católica SC para o backend da linha Web Apps (75%), conferido na prova de autoria.
      thresholds: { lines: 75, statements: 75 },
    },
  },
});
