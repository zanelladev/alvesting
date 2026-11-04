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
  },
});
