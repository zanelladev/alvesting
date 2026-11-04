// Uma identidade lê EXATAMENTE os segredos da lista: Key Vault Secrets User no escopo de cada segredo (o recurso
// Microsoft.KeyVault/vaults/secrets), nunca no cofre inteiro. É o que separa o prompt-arena e a chave do OpenRouter
// (só o job de decisões), o prompt-chat (só a api), o token da brapi (só o worker) e o banco (só quem consulta).
// containerapps.bicep o chama uma vez por workload; ele vive na fase 2 porque os segredos do Artur só existem depois
// do infra/scripts/seed-secrets.sh e um papel não nasce no escopo de um segredo que não existe (docs/INFRA.md, 6).
import { keyVaultSecretsUser } from '../roles.bicep'

param keyVaultName string
param identityName string
@description('Nomes dos segredos do Key Vault que esta identidade lê (os mesmos que o workload referencia).')
param secretNames array

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: keyVaultName
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: identityName
}

resource secrets 'Microsoft.KeyVault/vaults/secrets@2025-05-01' existing = [
  for name in secretNames: {
    parent: vault
    name: name
  }
]

resource reads 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (name, i) in secretNames: {
    scope: secrets[i]
    name: guid(secrets[i].id, identity.id, keyVaultSecretsUser)
    properties: {
      principalId: identity.properties.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUser)
    }
  }
]
