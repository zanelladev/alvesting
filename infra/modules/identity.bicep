// Uma identidade gerenciada user-assigned. O main.bicep a instancia uma vez por workload (laço em names.identity;
// docs/INFRA.md, seção 3.2; ADR 0020):
//   id-alvesting-web        o ca-web, só para a plataforma (referência de segredo e pull da imagem)
//   id-alvesting-api        o ca-api
//   id-alvesting-worker     o ca-worker-data
//   id-alvesting-decisions  o job-worker-decisions
//   id-alvesting-sched      os 7 job-sched-*
//   id-alvesting-migrate    o job-migrate, só para a plataforma
//   id-alvesting-scale      só o KEDA (Service Bus Data Owner); o código nunca a usa
// Os papéis são atribuídos pelo módulo do recurso que recebe o acesso; os de segredo, no escopo de cada segredo,
// por secret-access.bicep.
param name string
param location string
param tags object

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: name
  location: location
  tags: tags
}
