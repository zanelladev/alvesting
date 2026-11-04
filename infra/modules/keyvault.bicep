// Key Vault Standard com RBAC (§5.7). Aqui só nascem o cofre e o papel de quem semeia os segredos. NENHUMA
// identidade de workload tem papel no cofre inteiro: cada uma lê só os segredos dela, com Key Vault Secrets User no
// escopo do segredo (secret-access.bicep, chamado por containerapps.bicep; ADR 0020). Os segredos derivados são
// criados pelos módulos que os originam e os do Artur, por infra/scripts/seed-secrets.sh. O log de auditoria do
// cofre (quem leu o quê) é configurado em observability.bicep, que conhece o workspace.
import { keyVaultSecretsOfficer } from '../roles.bicep'

param name string
param location string
param tags object
@description('Object ID de quem implanta e semeia segredos (Key Vault Secrets Officer). Vazio = não atribui.')
param adminPrincipalId string
@description('Proteção contra purge. Irreversível depois de ligada. O cofre guarda os prompts, que só existem aqui e são revelados no fim da temporada: purge e retenção curta não podem apagá-los.')
param purgeProtection bool
@description('Dias de exclusão lógica (7 a 90). NÃO muda depois que o cofre existe: o valor da primeira criação vale para sempre.')
@minValue(7)
@maxValue(90)
param softDeleteRetentionDays int

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: softDeleteRetentionDays
    // A API não aceita false: ou liga (e nunca mais desliga) ou omite. Em dev fica desligada para o nome
    // do cofre poder ser reaproveitado depois de apagar o resource group (docs/INFRA.md, seção 10).
    enablePurgeProtection: purgeProtection ? true : null
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}

resource adminWrite 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(adminPrincipalId)) {
  scope: vault
  name: guid(vault.id, adminPrincipalId, keyVaultSecretsOfficer)
  properties: {
    principalId: adminPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficer)
  }
}

output name string = vault.name
