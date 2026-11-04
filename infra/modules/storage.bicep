// Storage v2 LRS (§5.3): briefings, IO bruto das LLMs e backups. Só identidade: sem chave de conta.
// O acesso é POR CONTAINER, nunca da conta (ADR 0030): o papel vai no escopo do container (Learn, "Assign an Azure role for access to blob
// data": o escopo de um container é .../storageAccounts/<conta>/blobServices/default/containers/<nome>), e cada identidade só alcança o
// container que o código dela usa. Sem política de imutabilidade em container nenhum, de propósito (ADR 0030): a política travada impede
// apagar a conta até a retenção vencer, e o SHA-256 que o banco guarda de cada blob de briefings e llm-io já acusa adulteração.
// Os backups ficam de fora disso: o SHA-256 do dump só está nos metadados do próprio blob (docs/INFRA.md, 3.2).
import { storageBlobDataContributor, storageBlobDataReader } from '../roles.bicep'

param name string
param location string
param tags object
@description('Quem acessa qual container: [{ container, identity, role }], com role = contributor (ler, gravar e apagar) ou reader (só ler). Uma linha por par, no escopo do container. Quem não aparece não alcança Blob nenhum: a api, os agendadores, o migrate e o web (um RCE na api não pode reescrever o dado do experimento). O que o código de cada workload usa está em docs/INFRA.md, 3.2, e o infra/tests/check.mjs escreve a matriz à mão.')
param grants array

var containerNames = ['briefings', 'llm-io', 'backups']
var blobRoles = { contributor: storageBlobDataContributor, reader: storageBlobDataReader }

resource grantees 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = [
  for grant in grants: {
    name: grant.identity
  }
]

resource account 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// Exclusão lógica de 7 dias: o IO bruto das LLMs é o dado do experimento, apagar por engano não pode ser definitivo.
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
    containerDeleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = [
  for container in containerNames: {
    parent: blobService
    name: container
  }
]

// hot -> cool em 30 dias em tudo; os dumps mensais ficam 12 meses (§5.8) e depois saem sozinhos.
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2025-01-01' = {
  parent: account
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'hot-to-cool-30d'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'] }
            actions: { baseBlob: { tierToCool: { daysAfterModificationGreaterThan: 30 } } }
          }
        }
        {
          name: 'backups-delete-365d'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['backups/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 365 } } }
          }
        }
      ]
    }
  }
}

// O container de cada linha de `grants`, como escopo do papel. É `existing` (o container nasce acima) e por isso o dependsOn explícito: sem
// ele o ARM podia criar o papel antes do container.
resource grantContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' existing = [
  for grant in grants: {
    parent: blobService
    name: grant.container
  }
]

resource blobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for (grant, i) in grants: {
    scope: grantContainers[i]
    name: guid(grantContainers[i].id, grantees[i].id, blobRoles[grant.role])
    dependsOn: [containers]
    properties: {
      principalId: grantees[i].properties.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobRoles[grant.role])
    }
  }
]

output name string = account.name
