// Service Bus Basic com as 6 filas do §5.5. A dead-letter queue (DLQ) é nativa de cada fila.
// Sem chave: disableLocalAuth força identidade gerenciada. O acesso é POR FILA, nunca do namespace (ADR 0030): o papel vai no escopo da
// fila (Learn, "Authenticate and authorize an application with Microsoft Entra ID to access Azure Service Bus entities": o escopo pode ser
// o namespace ou a fila). Que o papel da fila cubra também a DLQ dela é inferência, não confirmada (a página não fala da DLQ; docs/INFRA.md,
// seção 11). Cada workload recebe só as filas que o código dele usa:
//   Sender e Receiver   api (admin: lê e reenvia a DLQ de qualquer fila, publica o `decide` do reprocesso e o `settle` do evento
//                       corporativo), worker (as 5 filas que consome e onde agenda a nova tentativa, e o `settle` encadeado) e
//                       decisões (só a `decisions`)
//   Sender              os agendadores (ADR 0007: só publicam), em 5 filas; a `settlement` é do `eod`
//   Data Owner          id-alvesting-scale: só o KEDA a usa, para ler a profundidade de cada fila (ver abaixo)
// O ca-web e o job-migrate não falam com o Service Bus.
import {
  serviceBusDataOwner
  serviceBusDataReceiver
  serviceBusDataSender
} from '../roles.bicep'

param name string
param location string
param tags object
@description('Quem faz o quê em cada fila: [{ queue, identity, role }], com role = sender (publicar), receiver (consumir e ler a DLQ) ou owner (só o KEDA, id-alvesting-scale: ler a profundidade da fila). Uma linha por par, no escopo da fila. A matriz que o código pede está em docs/INFRA.md, 3.2, e o infra/tests/check.mjs a escreve à mão.')
param grants array

// maxDeliveryCount do §5.5: depois dele a mensagem vai para a DLQ.
var queues = [
  { name: 'market', maxDeliveryCount: 10 }
  { name: 'news', maxDeliveryCount: 5 }
  { name: 'briefing', maxDeliveryCount: 5 }
  { name: 'decisions', maxDeliveryCount: 3 }
  { name: 'settlement', maxDeliveryCount: 5 }
  { name: 'maintenance', maxDeliveryCount: 3 }
]
var serviceBusRoles = {
  sender: serviceBusDataSender
  receiver: serviceBusDataReceiver
  owner: serviceBusDataOwner
}

// Cada identidade declarada uma vez só: o ARM recusa o mesmo recurso duas vezes no template ("defined multiple times", a prévia de
// 07/11/2026), e `grants` repete a identidade (uma linha por par). O union(…, []) tira a repetição; o papel acha a sua pelo indexOf. Pelo
// mesmo motivo o escopo do papel é a fila declarada abaixo, e não um `existing` dela.
var queueNames = map(queues, item => item.name)
var granteeNames = union(map(grants, grant => grant.identity), [])

resource grantees 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = [
  for identityName in granteeNames: {
    name: identityName
  }
]

resource namespace 'Microsoft.ServiceBus/namespaces@2026-01-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'Basic', tier: 'Basic' }
  properties: {
    disableLocalAuth: true
  }
}

// ponytail: TTL único de 1 dia. A mensagem que ninguém consumiu em 1 dia vai para a DLQ (dead-letter na
// expiração). Se a decisão de um ciclo atrasado não fizer mais sentido, baixar o TTL só da fila decisions.
resource queue 'Microsoft.ServiceBus/namespaces/queues@2026-01-01' = [
  for item in queues: {
    parent: namespace
    name: item.name
    properties: {
      maxDeliveryCount: item.maxDeliveryCount
      deadLetteringOnMessageExpiration: true
      lockDuration: 'PT1M'
      defaultMessageTimeToLive: 'P1D'
    }
  }
]

// ponytail: o escalador azure-servicebus do KEDA lê a profundidade da fila pela API de administração, e a
// documentação do KEDA pede a política "Manage" (com chave). Na Entra o único papel interno com Manage é
// Data Owner. É uma inferência, não confirmada sem a assinatura (docs/INFRA.md, seção 11): se o KEDA acordar
// o worker só com Receiver, apagar as linhas `owner` e a id-alvesting-scale. Por isso o papel largo fica numa
// identidade que o código nunca usa, e não nas dos workloads. Ele vai no escopo de cada FILA (o KEDA lê uma por regra), e não do
// namespace: o escopo de fila para o escalador também não foi verificado, e se o KEDA não acordar o worker o caminho de volta é o
// namespace (seção 11).
resource access 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for grant in grants: {
    scope: queue[indexOf(queueNames, grant.queue)]
    name: guid(
      queue[indexOf(queueNames, grant.queue)].id,
      grantees[indexOf(granteeNames, grant.identity)].id,
      serviceBusRoles[grant.role]
    )
    properties: {
      principalId: grantees[indexOf(granteeNames, grant.identity)].properties.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusRoles[grant.role])
    }
  }
]

output name string = namespace.name
