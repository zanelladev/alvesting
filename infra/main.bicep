// Alvesting v2: infra na Azure (plano §5 e §6). Documentação: docs/INFRA.md.
//
//   Padrão    Front Door Standard + WAF, ACR, web e api com mínimo 1            (≈ US$ 72–83 por mês)
//   Econômico sem Front Door (o ingress do Container Apps balanceia; a api é interna e o site repassa
//             /api/* a ela: uma origem só, ADR 0039), sem ACR (imagens do GHCR), web e api com
//             mínimo 0; é o perfil em que a produção nasce                       (≈ US$ 5–10 por mês)
//
// Ordem do primeiro deploy (um segredo que o Artur preenche à mão não pode ser criado pelo Bicep, e o
// Container App não sobe se o segredo referenciado não existe):
//   1. deployApps = false, writeDerivedSecrets = true, deployBudget = true
//        -> rede, cofre, banco, filas, Front Door..., os segredos derivados e o orçamento
//   2. infra/scripts/seed-secrets.sh  -> os segredos do Artur (o prompt-arena inclusive); e as imagens vão para o
//      registro (etapa 3). Daqui saem os três valores que a fase 2 exige do ambiente: ALVESTING_API_TAG,
//      ALVESTING_WEB_TAG e ALVESTING_PROMPT_ARENA_VERSION (docs/INFRA.md, passos 4 a 6)
//   3. os valores dos main.*.bicepparam (deployApps = true, o resto false)
//        -> ca-web, ca-api, worker, jobs e agendadores, e o papel de cada um em cada segredo que lê
// Os main.*.bicepparam trazem o regime de rotina (é o que o what-if da segunda execução e o CI usam): nada é
// regravado. writeDerivedSecrets e deployBudget só ligam na fase 1 e nos casos de docs/INFRA.md, seção 6.1.
//
// Idempotência: nenhum valor muda de um deploy para o outro (sem utcNow/newGuid; datas são parâmetros).
// Todo módulo recebe os nomes dos recursos que lê como CONSTANTES (names.*) e a ordem vem de dependsOn: um
// nome vindo de saída de módulo é valor de tempo de execução, e o what-if não consegue olhar dentro do módulo
// (regra what-if-short-circuiting, em erro no bicepconfig.json).
targetScope = 'resourceGroup'

@description('padrao = Front Door + ACR + web/api com mínimo 1. economico = sem Front Door e sem ACR, web/api com mínimo 0.')
@allowed(['padrao', 'economico'])
param profile string

@description('Sufixo dos nomes únicos no mundo (cofre, storage, ACR, Service Bus, Postgres, OpenAI, e-mail). Vazio em prod, "-dev" em dev; troque se a Azure disser que o nome já existe.')
param nameSuffix string = ''

param location string = resourceGroup().location

@description('false só no primeiro deploy: cria tudo menos os apps, para semear os segredos e publicar as imagens antes.')
param deployApps bool = true

@description('Grava os segredos derivados (database-url, front-door-id, acs-connection-string, appinsights-connection-string). Regravar o mesmo valor cria uma versão nova no Key Vault, e o Container Apps reinicia as revisões que o referenciam (ca-web e ca-api com mínimo 1 réplica: uma queda). Ligue só na fase 1 e quando um segredo derivado precisa mudar: troca da senha do Postgres, perfil padrão ligado.')
param writeDerivedSecrets bool

@description('Cria o orçamento. Só no primeiro deploy: a Azure recusa um startDate fora do mês corrente (ou dos 12 seguintes), então regravá-lo em outro mês, com a data antiga, deixaria o deploy vermelho.')
param deployBudget bool

@description('Proteção contra purge do Key Vault. Irreversível depois de ligada. Prod liga; dev não (o nome do cofre fica preso pela retenção depois de apagar o resource group).')
param purgeProtection bool

@description('Dias de exclusão lógica do Key Vault (7 a 90). NÃO muda depois que o cofre existe: decida antes do primeiro deploy.')
param softDeleteRetentionDays int

@description('Tag das imagens alvesting-api e alvesting-web: o SHA do commit que o pipeline publicou. SEM valor padrão (nada de latest, que muda debaixo dos pés): vem de ALVESTING_API_TAG e ALVESTING_WEB_TAG (main.*.bicepparam) e é exigida só quando os apps entram (módulo apps, @minLength(1)). Quem roda a infra informa a tag que está no ar, senão a infra reverte a revisão (docs/INFRA.md, 7.3).')
param apiImageTag string
param webImageTag string

@description('Versão do segredo prompt-arena no Key Vault (32 hexadecimais) que o job de decisões usa. O prompt é lido dessa versão fixa, e a mesma versão vai no PROMPT_ARENA_VERSION para o banco registrá-la ao lado do SHA-256. Vem de ALVESTING_PROMPT_ARENA_VERSION; exigida só quando os apps entram.')
param promptArenaVersion string

@description('Teto de custo das LLMs da arena no mês, em dólares inteiros. O job-sched-cycle (08:00) confere o gasto do mês contra ele antes de abrir o ciclo; estourou, o ciclo é pulado e nenhum modelo é chamado (plano 5.15). Os fakes custam zero e não dependem dele. Vira ARENA_MONTHLY_COST_CAP_USD, no job-sched-cycle e na ca-api (o painel de custos e o reprocesso do ciclo, em /admin).')
@minValue(0)
param arenaMonthlyCostCapUsd int

@description('Controlador dos dados pessoais e canal de contato da política de privacidade (LGPD, art. 9), na tela de privacidade. Vêm de ALVESTING_LEGAL_CONTROLLER_NAME e ALVESTING_LEGAL_CONTACT_EMAIL (main.*.bicepparam) e nunca moram no repositório. A api recusa subir em produção sem eles; exigidos só quando os apps entram (@minLength(1) no módulo apps). Viram LEGAL_CONTROLLER_NAME e LEGAL_CONTACT_EMAIL, só na api.')
param legalControllerName string
param legalContactEmail string

@description('Client ID do cliente OAuth do Google, que não é segredo (o secret é o google-oauth-client-secret, no Key Vault). Vem de ALVESTING_GOOGLE_CLIENT_ID. Vazio = o login por Google não existe e nada quebra. Vira GOOGLE_CLIENT_ID, só na api.')
param googleClientId string = ''

@description('Dono do GHCR no perfil econômico: ghcr.io/<dono>/alvesting-api. Ignorado no padrão (ACR).')
param ghcrOwner string

@description('Senha do administrador do Postgres. Vem de ALVESTING_PG_ADMIN_PASSWORD (main.*.bicepparam); nunca de arquivo.')
@secure()
param postgresAdminPassword string = ''

@description('Senha do login de menor privilégio da api no Postgres (alvesting_api; ADR 0028). Vem de ALVESTING_PG_API_PASSWORD (main.*.bicepparam); nunca de arquivo. Pelo menos 32 caracteres (@minLength no módulo do banco, que a grava no segredo database-url-api). O servidor só a aprende quando o job-migrate roda o db:roles, que a lê desse segredo: este template não cria o login.')
@secure()
param postgresApiPassword string = ''

@description('Object ID de quem implanta, para o papel Key Vault Secrets Officer (seed-secrets.sh). Vazio = não atribui.')
param adminPrincipalId string = ''

@description('Orçamento mensal do resource group, na moeda da assinatura.')
param budgetAmount int
@description('Primeiro dia de um mês (AAAA-MM-01). Só vale com deployBudget. Fixo: um valor que muda a cada deploy quebraria o what-if. A Azure aceita o mês corrente ou um dos 12 seguintes.')
param budgetStartDate string
@description('E-mail do orçamento (50, 80 e 100%) e dos alertas de operação (módulo alerts: DLQ, 5xx, banco, sinais da aplicação). Vem de ALVESTING_BUDGET_EMAIL. Os alertas são criados em todo deploy, então o e-mail é exigido sempre (@minLength(3) no módulo alerts).')
param budgetAlertEmail string = ''

@description('Liga o Azure OpenAI do chat. Desligado por padrão: a cota da assinatura pode vir zerada.')
param enableOpenAI bool = false
param openaiModelName string = 'gpt-4.1-mini'
param openaiModelVersion string = '2025-04-14'
param openaiCapacity int = 10

@description('Domínio próprio no Front Door (perfil padrão), ex.: alvesting.com.br. Vazio = só o host *.azurefd.net.')
param customDomain string = ''
param wafRateLimitPerMinute int = 600

var isStandard = profile == 'padrao'
var tags = { project: 'alvesting', managedBy: 'bicep' }
var compactSuffix = replace(nameSuffix, '-', '')

// Nomes do §5.3. Os que são únicos no mundo levam nameSuffix. Constantes de propósito (ver o topo).
var names = {
  keyVault: 'kv-alvesting${nameSuffix}'
  storage: 'stalvesting${compactSuffix}'
  registry: 'cralvesting${compactSuffix}'
  serviceBus: 'sb-alvesting${nameSuffix}'
  postgres: 'psql-alvesting${nameSuffix}'
  communication: 'acs-alvesting${nameSuffix}'
  email: 'acs-alvesting-email${nameSuffix}'
  openai: 'oai-alvesting${nameSuffix}'
  // Uma identidade por workload e a do KEDA (docs/INFRA.md, seção 3.2; ADR 0020). Sem sufixo: nome de
  // identidade só precisa ser único no resource group.
  identity: {
    web: 'id-alvesting-web'
    api: 'id-alvesting-api'
    worker: 'id-alvesting-worker'
    decisions: 'id-alvesting-decisions'
    sched: 'id-alvesting-sched'
    migrate: 'id-alvesting-migrate'
    scale: 'id-alvesting-scale'
  }
  workspace: 'log-alvesting'
  environment: 'cae-alvesting'
  frontDoor: 'afd-alvesting'
}

// Cada identidade recebe só o papel que o workload dela usa (ADR 0020): AcrPull para os seis workloads (a do KEDA
// não puxa imagem), e as listas do Service Bus (por FILA) e do Blob (por CONTAINER) logo abaixo (ADR 0030). Os papéis de Key Vault
// ficam em secret-access.bicep, chamado pelo containerapps.bicep (fase 2).
var pullers = [
  names.identity.web
  names.identity.api
  names.identity.worker
  names.identity.decisions
  names.identity.sched
  names.identity.migrate
]

module identities 'modules/identity.bicep' = [
  for item in items(names.identity): {
    name: 'identity-${item.key}'
    params: { name: item.value, location: location, tags: tags }
  }
]

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    name: names.keyVault
    location: location
    tags: tags
    adminPrincipalId: adminPrincipalId
    purgeProtection: purgeProtection
    softDeleteRetentionDays: softDeleteRetentionDays
  }
}

module observability 'modules/observability.bicep' = {
  name: 'observability'
  params: {
    workspaceName: names.workspace
    location: location
    tags: tags
    keyVaultName: names.keyVault
    writeDerivedSecrets: writeDerivedSecrets
  }
  dependsOn: [keyVault]
}

module network 'modules/network.bicep' = {
  name: 'network'
  params: { location: location, tags: tags, postgresName: names.postgres }
}

// --- Quem acessa o quê: o Blob por CONTAINER e o Service Bus por FILA (ADR 0030) -------------------------------------------------------
// Cada identidade só nos containers e nas filas que o código dela usa, no escopo do próprio container e da própria fila. O porquê de cada
// linha está em docs/INFRA.md (3.2), e o infra/tests/check.mjs escreve a matriz à mão a partir do código, sem olhar este arquivo.
//   Blob    briefings: o worker grava, as decisões leem · llm-io: as decisões gravam · backups: o worker grava, lê de volta e
//           apaga. As cotações não vão ao Blob (a brapi é a fonte, o banco é o cache; ADR 0032). A api, os agendadores e o web não têm Blob;
//           o migrate, só no econômico (abaixo).
//   Fila    a api: as seis (o admin lê e reenvia a DLQ de qualquer uma, e publica o `decide` e o `settle`) · o worker: as cinco que
//           consome (nelas agenda a nova tentativa, e o `settle` do `eod` cai na settlement) · as decisões: só a decisions · os
//           agendadores só publicam, em cinco (a settlement é do `eod`) · o KEDA lê a profundidade de cada uma (Data Owner)
var allQueues = ['market', 'news', 'briefing', 'decisions', 'settlement', 'maintenance']
var workerQueues = ['market', 'news', 'briefing', 'settlement', 'maintenance']
var schedulerQueues = ['market', 'news', 'briefing', 'decisions', 'maintenance']
//   Só no econômico, a produção (ADR 0039): o migrate LÊ o backups (a restauração da temporada, dist/restore-cli.js) e quem opera
//           (adminPrincipalId) escreve nos três (o envio do dump e a cópia do Blob do Azurite: docs/RUNBOOK.md, 13.6).
var blobGrants = concat(
  [
    { container: 'briefings', identity: names.identity.worker, role: 'contributor' }
    { container: 'briefings', identity: names.identity.decisions, role: 'reader' }
    { container: 'llm-io', identity: names.identity.decisions, role: 'contributor' }
    { container: 'backups', identity: names.identity.worker, role: 'contributor' }
  ],
  isStandard ? [] : [{ container: 'backups', identity: names.identity.migrate, role: 'reader' }]
)
var queueGrants = flatten([
  map(allQueues, queue => { queue: queue, identity: names.identity.api, role: 'sender' })
  map(allQueues, queue => { queue: queue, identity: names.identity.api, role: 'receiver' })
  map(workerQueues, queue => { queue: queue, identity: names.identity.worker, role: 'sender' })
  map(workerQueues, queue => { queue: queue, identity: names.identity.worker, role: 'receiver' })
  [
    { queue: 'decisions', identity: names.identity.decisions, role: 'sender' }
    { queue: 'decisions', identity: names.identity.decisions, role: 'receiver' }
  ]
  map(schedulerQueues, queue => { queue: queue, identity: names.identity.sched, role: 'sender' })
  map(allQueues, queue => { queue: queue, identity: names.identity.scale, role: 'owner' })
])

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: names.storage
    location: location
    tags: tags
    grants: blobGrants
    operatorPrincipalId: isStandard ? '' : adminPrincipalId
  }
  dependsOn: [identities]
}

module registry 'modules/acr.bicep' = if (isStandard) {
  name: 'registry'
  params: { name: names.registry, location: location, tags: tags, pullIdentityNames: pullers }
  dependsOn: [identities]
}

module serviceBus 'modules/servicebus.bicep' = {
  name: 'servicebus'
  params: {
    name: names.serviceBus
    location: location
    tags: tags
    grants: queueGrants
  }
  dependsOn: [identities]
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    name: names.postgres
    location: location
    tags: tags
    subnetId: network.outputs.postgresSubnetId
    privateDnsZoneId: network.outputs.privateDnsZoneId
    keyVaultName: names.keyVault
    adminPassword: postgresAdminPassword
    apiPassword: postgresApiPassword
    writeDerivedSecrets: writeDerivedSecrets
  }
  dependsOn: [keyVault]
}

module email 'modules/email.bicep' = {
  name: 'email'
  params: {
    name: names.communication
    emailName: names.email
    tags: tags
    keyVaultName: names.keyVault
    writeDerivedSecrets: writeDerivedSecrets
  }
  dependsOn: [keyVault]
}

module openai 'modules/openai.bicep' = if (enableOpenAI) {
  name: 'openai'
  params: {
    name: names.openai
    location: location
    tags: tags
    modelName: openaiModelName
    modelVersion: openaiModelVersion
    capacity: openaiCapacity
    userIdentityName: names.identity.api
  }
  dependsOn: [identities]
}

module containerEnv 'modules/containerenv.bicep' = {
  name: 'containerenv'
  params: {
    name: names.environment
    location: location
    tags: tags
    subnetId: network.outputs.appsSubnetId
    workspaceName: names.workspace
  }
  dependsOn: [observability]
}

// Os hosts dos apps são previsíveis (<app>.<domínio do ambiente>), então o Front Door nasce antes deles.
var webHost = 'ca-web.${containerEnv.outputs.defaultDomain}'
var apiHost = 'ca-api.${containerEnv.outputs.defaultDomain}'

// O endereço do LABEL green de cada app (blue/green, ADR 0029): <app>---green.<domínio do ambiente>, três hífens (Learn, "Blue-green
// deployment in Azure Container Apps"). É por onde o deploy prova a revisão nova pelo Front Door antes de ela ter tráfego.
var webGreenHost = 'ca-web---green.${containerEnv.outputs.defaultDomain}'
var apiGreenHost = 'ca-api---green.${containerEnv.outputs.defaultDomain}'

module frontDoor 'modules/frontdoor.bicep' = if (isStandard) {
  name: 'frontdoor'
  params: {
    profileName: names.frontDoor
    tags: tags
    webHostName: webHost
    apiHostName: apiHost
    webGreenHostName: webGreenHost
    apiGreenHostName: apiGreenHost
    keyVaultName: names.keyVault
    purgeIdentityName: names.identity.worker
    workspaceName: names.workspace
    customDomain: customDomain
    rateLimitPerMinute: wafRateLimitPerMinute
    writeDerivedSecrets: writeDerivedSecrets
  }
  dependsOn: [keyVault, identities, observability]
}

// Os alertas de operação (plano 5.9) e o grupo de ações que manda o e-mail. Existem desde a fase 1: os de métrica olham o Service Bus, o
// banco e o Front Door, que já existem, e o de log usa skipQueryValidation (a tabela de logs dos contêineres nasce com o primeiro
// contêiner). No perfil econômico não há Front Door, então os dois alertas da borda não existem.
module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    location: location
    tags: tags
    workspaceName: names.workspace
    serviceBusName: names.serviceBus
    postgresName: names.postgres
    frontDoorName: isStandard ? names.frontDoor : ''
    alertEmail: budgetAlertEmail
  }
  dependsOn: [observability, serviceBus, postgres, frontDoor]
}

module budget 'modules/budget.bicep' = if (deployBudget) {
  name: 'budget'
  params: { amount: budgetAmount, startDate: budgetStartDate, alertEmail: budgetAlertEmail }
}

var edgeHost = frontDoor.?outputs.endpointHostname ?? ''
var greenEdgeHost = frontDoor.?outputs.greenEndpointHostname ?? ''
var publicHost = isStandard ? (empty(customDomain) ? edgeHost : customDomain) : webHost
var registryHost = isStandard
  ? '${names.registry}${environment().suffixes.acrLoginServer}'
  : 'ghcr.io/${ghcrOwner}'

// Só entra depois que os segredos do Artur existem e as imagens estão no registro (ver o topo).
module apps 'modules/containerapps.bicep' = if (deployApps) {
  name: 'apps'
  params: {
    location: location
    tags: tags
    environmentName: names.environment
    identityNames: names.identity
    keyVaultName: names.keyVault
    serviceBusName: serviceBus.outputs.name
    storageAccountName: storage.outputs.name
    defaultDomain: containerEnv.outputs.defaultDomain
    registryHost: registryHost
    apiImageTag: apiImageTag
    webImageTag: webImageTag
    promptArenaVersion: promptArenaVersion
    arenaMonthlyCostCapUsd: arenaMonthlyCostCapUsd
    registryName: isStandard ? names.registry : ''
    hasFrontDoor: isStandard
    webMinReplicas: isStandard ? 1 : 0
    webMaxReplicas: 5
    apiMinReplicas: isStandard ? 1 : 0
    apiMaxReplicas: 5
    restoreFromBackups: !isStandard
    publicUrl: 'https://${publicHost}'
    frontDoorEndpointId: frontDoor.?outputs.endpointId ?? ''
    openAiEnabled: enableOpenAI
    openAiEndpoint: openai.?outputs.endpoint ?? ''
    openAiDeployment: openai.?outputs.deploymentName ?? ''
    emailSenderAddress: email.outputs.senderAddress
    googleClientId: googleClientId
    legalControllerName: legalControllerName
    legalContactEmail: legalContactEmail
  }
  // Os segredos (derivados e do Artur) e os papéis têm de existir antes dos apps. Service Bus, storage,
  // ambiente, Front Door, OpenAI e o e-mail (a saída senderAddress, que também garante o acs-connection-string no cofre)
  // já entram pelos parâmetros acima; faltam as identidades, o cofre (o módulo lê o cofre e dá a cada workload o papel
  // em cada segredo dele), a telemetria (appinsights-connection-string), o banco (database-url e database-url-api) e o ACR (AcrPull de
  // cada workload).
  dependsOn: [identities, keyVault, observability, postgres, registry]
}

output siteUrl string = 'https://${publicHost}'
output edgeHostname string = edgeHost
// O endereço do endpoint green do Front Door (a variável SITE_GREEN_URL do repositório, docs/DEPLOY.md, seção 3). Só no perfil padrão.
output greenSiteUrl string = isStandard ? 'https://${greenEdgeHost}' : ''
output webFqdn string = webHost
// no econômico, o endereço interno: só o site alcança a api (ADR 0039)
output apiFqdn string = isStandard ? apiHost : 'ca-api.internal.${containerEnv.outputs.defaultDomain}'
output keyVaultName string = keyVault.outputs.name
output registryServer string = isStandard ? registryHost : ''
output serviceBusNamespace string = serviceBus.outputs.name
output storageAccountName string = storage.outputs.name
output postgresServerName string = postgres.outputs.name
