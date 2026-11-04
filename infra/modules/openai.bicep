// Azure OpenAI para o chat (§5.3 e §11). Só entra com enableOpenAI = true: a cota da assinatura pode
// vir zerada e um deployment sem cota derruba o deploy inteiro.
//
// SEM CHAVE: disableLocalAuth desliga a autenticação por chave da conta. A api entra com o token da identidade
// dela (DefaultAzureCredential, escopo https://cognitiveservices.azure.com/.default) e o papel Cognitive Services
// OpenAI User, só dela. Não existe o segredo azure-openai-key nem AZURE_OPENAI_API_KEY (§5.7: "ou identidade").
//
// DataZoneStandard: o prompt e a resposta são processados só dentro da zona de dados dos EUA. O GlobalStandard
// processa em qualquer região da Azure, e o chat envia a carteira do usuário; o §12 e a política de privacidade
// informam a transferência para os EUA (art. 33 da LGPD), não para o mundo.
import { cognitiveServicesOpenAIUser } from '../roles.bicep'

param name string
param location string
param tags object
@description('Modelo pequeno do chat. Confirme o catálogo e a cota da região antes de ligar (az cognitiveservices model list).')
param modelName string
param modelVersion string
@description('Cota em milhares de tokens por minuto (DataZoneStandard).')
param capacity int
@description('Identidade da api (a única que fala com o modelo). Recebe Cognitive Services OpenAI User na conta.')
param userIdentityName string

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: userIdentityName
}

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: name
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    // O token do Entra só vale num endpoint com subdomínio próprio.
    customSubDomainName: name
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource chat 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: 'chat'
  sku: { name: 'DataZoneStandard', capacity: capacity }
  properties: {
    model: { format: 'OpenAI', name: modelName, version: modelVersion }
  }
}

resource apiUsesModel 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: account
  name: guid(account.id, apiIdentity.id, cognitiveServicesOpenAIUser)
  properties: {
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesOpenAIUser
    )
  }
}

output endpoint string = account.properties.endpoint
output deploymentName string = chat.name
