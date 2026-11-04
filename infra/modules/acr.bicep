// Container Registry Basic (§5.3), só no perfil padrão. Pull por identidade: sem usuário admin.
// Cada workload puxa a imagem com a identidade dele (ADR 0020), então todas recebem AcrPull aqui, na fase 1: o
// papel tem tempo de propagar antes de a fase 2 criar os apps.
import { acrPull } from '../roles.bicep'

param name string
param location string
param tags object
@description('Identidades de quem puxa imagem: as dos 6 workloads. A do KEDA não puxa nada.')
param pullIdentityNames array

resource pullers 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = [
  for identityName in pullIdentityNames: {
    name: identityName
  }
]

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (identityName, i) in pullIdentityNames: {
    scope: registry
    name: guid(registry.id, pullers[i].id, acrPull)
    properties: {
      principalId: pullers[i].properties.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPull)
    }
  }
]

output name string = registry.name
