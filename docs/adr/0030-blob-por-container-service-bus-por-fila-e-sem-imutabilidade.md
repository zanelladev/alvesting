# ADR 0030: Blob por container, Service Bus por fila, e sem política de imutabilidade

- **Status:** aceita (cumpre o que os ADR 0020 e 0028 deixaram para a etapa 10). Em 03/11/2026 o container `cotahist` saiu com a fonte (ADR 0032): onde o texto o cita, vale o histórico; os containers de hoje são `briefings`, `llm-io` e `backups`.
- **Data:** 03/11/2026
- **Origem:** `docs/PLANO.md`, §5.3, §5.6 e §16 (etapa 10); ADR 0020; `docs/INFRA.md`, 3.2 e 14; pendências das ondas 2a, 2b e 3c

## Contexto

O ADR 0020 separou as identidades e os segredos por workload, mas deixou os papéis de **Service Bus** no escopo do namespace e os de **Blob** no da conta inteira "para a etapa 10": antes de o código dos workloads existir, ganhava-se pouco. Isso tinha um custo
concreto: o worker, que parseia RSS, CSV e ZIP de terceiros, alcançava o container `llm-io` (o IO bruto das LLMs), e a regra era um critério de aceite da etapa 6 (o `llm-io` nunca guarda o texto do prompt). Agora o código existe, e a pergunta "quem lê e quem
grava o quê" tem resposta.

## Decisão

1. **O Blob vai por container** (`.../storageAccounts/<conta>/blobServices/default/containers/<nome>`, o escopo de recurso filho que a documentação prevê). O que o código usa, lido de cada `*Archive`:
   `briefings`: o worker grava (`FreezeHandler`), as decisões leem (`BriefingArchive.read`), então Contributor para o worker e **Storage Blob Data Reader** para as decisões; `llm-io`: só as decisões gravam, e **nada o lê**, então o worker deixa de alcançá-lo;
   `cotahist`: o worker grava; `backups`: o worker envia o dump, o baixa de volta, grava os metadados e apaga o que não passou na conferência. A api, os agendadores, o migrate, o web e o KEDA não têm Blob.
2. **O Service Bus vai por fila**, no escopo da própria fila (a página do Learn diz que o papel vale para a entidade e não fala da DLQ: que ele cubra também a DLQ dela é inferência, não confirmada; `docs/INFRA.md`, seção 11). A api tem Sender e Receiver nas seis (o admin lê e reenvia a DLQ de qualquer uma, e publica o `decide` e o `settle`); o worker, nas cinco que consome (cada handler que falha agenda a nova
   tentativa na mesma fila; o `eod` se reagenda em `market` e publica o `settle`); as decisões, só na `decisions`; os agendadores só publicam, em cinco (a `settlement` é do `eod`); o KEDA (Data Owner) em cada uma das seis.
3. **A matriz é escrita à mão no `infra/tests/check.mjs`** (`QUEUE_ROLES` e `BLOB_ROLES`), a partir do código, e o teste afirma a lista **inteira** das atribuições: qualquer mudança de uma linha (o papel, a fila, o container, a identidade, o escopo subindo para o namespace ou para a conta)
   a reprova. Foi conferido por mutação em 03/11/2026: 31 defeitos de uma linha (grant de Blob e de fila a mais, a menos ou trocado, papel no escopo da conta e do namespace, GUID de papel, segredo do login da api e o endpoint green do Front Door) reintroduzidos um a um nos próprios arquivos (e desfeitos na hora, com o SHA-256 conferido) foram pegos por uma verificação da matriz. Outros 4, que só reprovavam no lint do Bicep (variável sem uso), foram refeitos de um jeito que compila limpo e também foram pegos pela matriz.
4. **Sem política de imutabilidade em container nenhum.** Uma política travada (WORM) impede apagar a conta de armazenamento até a retenção vencer, e com crédito de estudante o resource group de teste não se apagaria. O SHA-256 que o banco guarda de cada blob de `briefings`, `llm-io` e `cotahist` já acusa a adulteração, e nos dois primeiros o nome do blob carrega o hash (o `cotahist` é por data e é
   sobrescrito de propósito quando a B3 republica o arquivo: `CotahistArchive.save`, e o SHA-256 novo vai para `trading_day`). **Os `backups` ficam de fora dessa garantia:** o SHA-256 do dump só mora nos metadados do próprio blob e numa linha de log, gravados pela mesma identidade que pode trocar o dump.
   Ficam a exclusão lógica de 7 dias (apagar por engano não é definitivo) e o escopo por container. O `check.mjs` afirma a ausência (nenhuma `immutabilityPolicies`, nenhum
   `immutableStorageWithVersioning`), para ninguém ligá-la sem decidir.
5. **O KEDA também vai por fila** (a regra de escala lê uma fila). A inferência de que ele precisa de Data Owner continua sem confirmação, e o escopo de fila para ele é outra premissa não verificada; a volta, se ele não acordar o worker, é o escopo do namespace
   (`docs/INFRA.md`, seção 11).

## Alternativas descartadas

- **Política de imutabilidade por tempo (ou versionamento) em `briefings` e `llm-io`**, como as pendências das ondas anteriores sugeriam. Ver o item 4; o teto é o dono de um papel de escrita poder sobrescrever um blob dele (o código só o faz de propósito no `cotahist`, quando a B3 republica o arquivo do dia, e nos `backups` do mesmo mês; em `briefings` e `llm-io` o hash da linha do banco não bateria com o que mudou).
- **Papel só de escrita para o worker em `briefings` e `cotahist`.** Não existe papel interno só de escrita; um papel próprio com `blobs/write` serviria a esses dois, mas o `backups` pede ler, apagar e `exists()`, e o ganho é pequeno perto do custo de mais um papel para
  manter e conferir.
- **Manter o namespace e a conta e confiar no critério da etapa 6.** A regra é um teste de canário do código; o papel é uma barreira que vale mesmo se a regra falhar.

## Consequências

- Um RCE no worker não alcança mais o `llm-io` nem a fila `decisions`; um nos agendadores não publica na `settlement`; um nas decisões só alcança a `decisions` e dois containers. A api, a mais exposta, mantém as seis filas: reenviar a DLQ de qualquer fila é uma rota do admin.
- **Workload ou fila nova, ou código que passa a usar outro container**, atualiza a matriz no `main.bicep`, a tabela da seção 3.2 do INFRA.md e `QUEUE_ROLES`/`BLOB_ROLES` do check (que reprova a divergência).
- Os papéis nascem na fase 1 (identidades, filas e containers já existem), e a propagação (até 10 minutos para o Blob) acontece durante a pausa do seed. Nada foi implantado; se a infra já tivesse sido aplicada com os papéis largos, as atribuições antigas no namespace e na conta
  teriam de ser apagadas à mão (`az role assignment delete`), porque o Bicep é incremental.
- **Risco aceito: os backups dividem o domínio de confiança do worker.** O worker (que parseia RSS, CSV e ZIP de terceiros e guarda o login dono das tabelas) é Contributor de `backups`: apaga e sobrescreve o dump, e o container não tem versionamento nem log de dados do Blob
  (só a exclusão lógica de 7 dias); a conta não tem `networkAcls`, e a Entra, `allowSharedKeyAccess: false` e o acesso público desligado são as únicas barreiras do endpoint aberto à internet. O teto: um RCE no worker já alcança o banco inteiro com o login dono das tabelas (o `ponytail` do
  `table-policy.ts`), então o dump é a cópia do que ele já alcança e o estrago a mais é o histórico de 12 meses. **Próximos passos, nesta ordem, nenhum feito nesta parte** (mudam custo e comportamento na Azure, que não pôde ser verificado aqui): (1) `isVersioningEnabled: true` no `blobService` e
  uma regra de ciclo de vida para as versões antigas (~400 dias); a exclusão de uma VERSÃO é uma ação própria no RBAC de Blob, que o Contributor pode não ter: confirmar na tabela de ações da Microsoft antes de contar com a garantia; (2) um diagnostic setting em `blobServices/default` com
  `StorageRead`, `StorageWrite` e `StorageDelete` para o Log Analytics (hoje só o cofre tem trilha de quem leu); (3) `networkAcls` com `defaultAction: Deny` e o endpoint de serviço da sub-rede dos apps.
- **Não verificado na Azure** (`docs/INFRA.md`, seção 11): o ARM aceitar o papel nos escopos de container e de fila criados no mesmo deploy, o KEDA com Data Owner por fila, a DLQ coberta pelo papel da fila, e o `container.exists()` do `backup-verify` com o Contributor no escopo do container.
