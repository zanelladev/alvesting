// Apps e jobs do Container Apps (§5.3 e §6). UMA imagem da api serve todos os papéis do back; o que muda
// é o comando de cada papel:
//   ca-api                 node dist/main.js        HTTP + chat SSE
//   ca-worker-data         node dist/worker.js      consome market, news, briefing, settlement, maintenance
//   job-worker-decisions   node dist/decide.js      1 mensagem da fila decisions por execução
//   job-sched-*  (7)       node dist/schedule.js X  só publica mensagens
//   job-migrate            migrate deploy + db:roles manual, disparado pelo CI (o db:roles cria o login da api)
//
// O banco: o login ADMINISTRADOR (segredo database-url, dono das tabelas) vai para o worker, as decisões, os agendadores e o migrate; a ca-api
// usa o login de MENOR PRIVILÉGIO (segredo database-url-api, no mesmo DATABASE_URL) e nunca lê o do administrador (ADR 0028).
//
// Segredos: SÓ referência ao Key Vault (keyVaultUrl + identidade). Cada workload tem a identidade DELE, e ela tem
// Key Vault Secrets User em cada um dos segredos que o workload referencia e em mais nenhum (secret-access.bicep;
// docs/INFRA.md, seção 3.2; ADR 0020). Os prompts chegam do mesmo jeito, como variável de ambiente por referência
// ao cofre (o código lê process.env, sem SDK do Key Vault):
//   PROMPT_ARENA   só o job-worker-decisions, numa versão FIXA do segredo prompt-arena, e a mesma versão em
//                  PROMPT_ARENA_VERSION (texto puro: não é segredo) para o banco registrá-la com o SHA-256. O
//                  job-sched-cycle recebe só a versão (a identidade dele não lê o segredo): o ciclo fixa a versão
//   PROMPT_CHAT    só o ca-api, e só com enableOpenAI (o chat só começa com o aval do orientador, plano §12)
// O job-sched-cycle recebe também ARENA_MONTHLY_COST_CAP_USD, o teto de custo das LLMs no mês (plano §5.15). A api recebe as duas (a
// versão do prompt e o teto, em texto puro) para as rotas /admin: reprocessar o ciclo fixa a versão, e o painel de custos compara o gasto
// do mês com o teto. Ela nunca recebe o texto do prompt nem a chave do OpenRouter.
//
// Identidades:
//   id-alvesting-web, -api, -worker, -decisions, -sched, -migrate   uma por workload
//   id-alvesting-scale   só as regras de escala do KEDA do worker e das decisões
// lifecycle None = "só a plataforma usa" (pull da imagem, referência de segredo, regra de escala): o token não fica
// disponível ao código do container. Vale para o web, o migrate e a do KEDA. Os demais usam o SDK da Azure (Service
// Bus, Blob, OpenAI): a identidade deles fica disponível e AZURE_CLIENT_ID diz ao DefaultAzureCredential qual é.

param location string
param tags object
param environmentName string
@description('Nomes das identidades (main.bicep, names.identity): uma por workload e a do KEDA.')
param identityNames {
  web: string
  api: string
  worker: string
  decisions: string
  sched: string
  migrate: string
  scale: string
}
param keyVaultName string
param serviceBusName string
param storageAccountName string
param defaultDomain string
@description('Servidor do registro das imagens: o ACR (padrão) ou ghcr.io/<dono> (econômico).')
param registryHost string
@description('Tag das imagens. Sem valor padrão e não vazia: a fase 2 não sobe sem a tag que o pipeline publicou (docs/INFRA.md, passo 6). A fase 1 (deployApps = false) nem chega aqui.')
@minLength(1)
param apiImageTag string
@minLength(1)
param webImageTag string
@description('Versão do segredo prompt-arena (o identificador de 32 hexadecimais do Key Vault). Fixa o conteúdo que o job de decisões lê.')
@minLength(32)
@maxLength(32)
param promptArenaVersion string
@description('Teto de custo das LLMs no mês, em dólares inteiros (main.bicep). Só o job-sched-cycle e a ca-api o recebem, em ARENA_MONTHLY_COST_CAP_USD.')
@minValue(0)
param arenaMonthlyCostCapUsd int
@description('Nome do ACR para pull por identidade. Vazio = imagem pública (GHCR, perfil econômico).')
param registryName string
param hasFrontDoor bool
param webMinReplicas int
param webMaxReplicas int
param apiMinReplicas int
param apiMaxReplicas int
@description('Perfil econômico: a api fica em outro subdomínio e libera só a origem da web. No padrão o Front Door serve tudo no mesmo domínio.')
param corsEnabled bool
param publicUrl string
@description('ID do endpoint do Front Door, para o purge. Só é lido com hasFrontDoor.')
param frontDoorEndpointId string
param openAiEnabled bool
param openAiEndpoint string
param openAiDeployment string
@description('De onde o e-mail da conta sai: DoNotReply@<domínio gerenciado>, saída do email.bicep. Vira EMAIL_SENDER_ADDRESS, só na api.')
param emailSenderAddress string
@description('Client ID do cliente OAuth do Google (não é segredo). Vazio = o login por Google não existe e a variável nem é injetada. Vira GOOGLE_CLIENT_ID, só na api.')
param googleClientId string
@description('Controlador dos dados pessoais e canal de contato da política de privacidade (LGPD, art. 9). A api RECUSA SUBIR em produção sem eles, então não podem ser vazios. Viram LEGAL_CONTROLLER_NAME e LEGAL_CONTACT_EMAIL, só na api.')
@minLength(1)
param legalControllerName string
@minLength(1)
param legalContactEmail string

var webPort = 3000
var apiPort = 8080
var secretBase = 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/'
var apiImage = '${registryHost}/alvesting-api:${apiImageTag}'
var webImage = '${registryHost}/alvesting-web:${webImageTag}'

func idOf(name string) string => resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', name)

// Só entram as identidades que o workload usa. O web e o migrate têm UMA, só da plataforma; o worker e as
// decisões levam também a do KEDA.
func identityBlock(ids array) object => {
  type: 'UserAssigned'
  userAssignedIdentities: toObject(ids, id => id, id => {})
}

// None = "só a plataforma usa" (pull de imagem, referência de segredo, regra de escala).
func platformOnly(id string) array => [{ identity: id, lifecycle: 'None' }]

// Pull por identidade no ACR. Sem ACR (registryName vazio, perfil econômico) a imagem é pública e não há registro.
// A condição olha o NOME do registro (parâmetro conhecido), e não o servidor montado com environment(): o what-if
// não resolve esse e deixaria a expressão inteira para a hora do deploy.
func registriesOf(registry string, id string) array => empty(registry)
  ? []
  : [{ server: '${registry}${environment().suffixes.acrLoginServer}', identity: id }]

// Cada item liga uma variável de ambiente a um segredo do Key Vault. Com version, o URI do segredo leva a versão
// (conteúdo fixo, só muda por um deploy); sem ela o Container Apps pega a mais recente em até 30 minutos e
// reinicia as revisões ativas.
var databaseUrl = { env: 'DATABASE_URL', secret: 'database-url' }
// O login de menor privilégio da api (ADR 0028): a ca-api o usa NO LUGAR do administrador, no mesmo DATABASE_URL, e o job-migrate o recebe em
// API_DATABASE_URL para o db:roles criar o login com a senha dele. Mais ninguém o lê.
var databaseUrlApi = { env: 'DATABASE_URL', secret: 'database-url-api' }
var databaseUrlApiForRoles = { env: 'API_DATABASE_URL', secret: 'database-url-api' }
var insights = { env: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secret: 'appinsights-connection-string' }
var revalidate = { env: 'REVALIDATE_SECRET', secret: 'revalidate-secret' }
// O segredo da rota interna de cotações (docs/API.md, seção 6; ADR 0033): a API pública não entrega a barra de preço (a licença da brapi proíbe), então o
// site a lê dessa rota da api, com este segredo em `Authorization: Bearer`. Os DOIS lados o leem (o mesmo segredo do Key Vault) e mais ninguém.
var quotes = { env: 'QUOTES_SECRET', secret: 'quotes-secret' }
var frontDoorId = { env: 'FRONT_DOOR_ID', secret: 'front-door-id' }
var promptArena = { env: 'PROMPT_ARENA', secret: 'prompt-arena', version: promptArenaVersion }
var promptChat = { env: 'PROMPT_CHAT', secret: 'prompt-chat' }

var webSecrets = concat([insights, revalidate, quotes], hasFrontDoor ? [frontDoorId] : [])
var apiSecrets = concat(
  [
    databaseUrlApi
    insights
    { env: 'BETTER_AUTH_SECRET', secret: 'better-auth-secret' }
    { env: 'GOOGLE_CLIENT_SECRET', secret: 'google-oauth-client-secret' }
    { env: 'ACS_CONNECTION_STRING', secret: 'acs-connection-string' }
    quotes
  ],
  hasFrontDoor ? [frontDoorId] : [],
  openAiEnabled ? [promptChat] : []
)
var workerSecrets = [databaseUrl, insights, { env: 'BRAPI_TOKEN', secret: 'brapi-token' }, revalidate]
var decideSecrets = [
  databaseUrl
  insights
  { env: 'OPENROUTER_API_KEY', secret: 'openrouter-api-key' }
  promptArena
]
var scheduleSecrets = [databaseUrl, insights]
var migrateSecrets = [databaseUrl, databaseUrlApiForRoles]

func secretsOf(base string, id string, refs array) array =>
  map(refs, ref => {
    name: ref.secret
    keyVaultUrl: '${base}${ref.secret}${contains(ref, 'version') ? '/${ref.version}' : ''}'
    identity: id
  })

func envOf(refs array) array => map(refs, ref => { name: ref.env, secretRef: ref.secret })

func probesOn(port int) array => [
  {
    type: 'Startup'
    httpGet: { path: '/health', port: port }
    initialDelaySeconds: 5
    periodSeconds: 5
    failureThreshold: 10
    timeoutSeconds: 3
  }
  {
    type: 'Readiness'
    httpGet: { path: '/health', port: port }
    initialDelaySeconds: 5
    periodSeconds: 10
    failureThreshold: 3
    timeoutSeconds: 3
  }
  {
    type: 'Liveness'
    httpGet: { path: '/health', port: port }
    initialDelaySeconds: 10
    periodSeconds: 30
    failureThreshold: 3
    timeoutSeconds: 3
  }
]

resource managedEnv 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: environmentName
}

// --- Acesso aos segredos: um papel por (workload, segredo), no escopo do segredo ----------------
// Ficam aqui, e não na fase 1, porque os segredos do Artur só existem depois do seed-secrets.sh e um papel não
// nasce no escopo de um segredo que não existe. Se a primeira execução da fase 2 falhar por acesso negado, é o
// papel ainda propagando: repetir (docs/INFRA.md, seção 11).
var access = [
  { name: 'web', identity: identityNames.web, secrets: webSecrets }
  { name: 'api', identity: identityNames.api, secrets: apiSecrets }
  { name: 'worker', identity: identityNames.worker, secrets: workerSecrets }
  { name: 'decisions', identity: identityNames.decisions, secrets: decideSecrets }
  { name: 'sched', identity: identityNames.sched, secrets: scheduleSecrets }
  { name: 'migrate', identity: identityNames.migrate, secrets: migrateSecrets }
]

module secretAccess 'secret-access.bicep' = [
  for item in access: {
    name: 'secret-access-${item.name}'
    params: {
      keyVaultName: keyVaultName
      identityName: item.identity
      secretNames: map(item.secrets, ref => ref.secret)
    }
  }
]

// O client ID de cada identidade que o código usa: o DefaultAzureCredential com identidade atribuída pelo
// usuário precisa dele (AZURE_CLIENT_ID), principalmente no worker e nas decisões, que levam duas identidades.
resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: identityNames.api
}

resource workerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: identityNames.worker
}

resource decisionsIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: identityNames.decisions
}

resource schedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: identityNames.sched
}

// Variáveis em texto puro: só endereços e flags. Nada que pareça segredo (o infra/tests/check.mjs confere).
// O AZURE_CLIENT_ID entra à parte, porque cada workload tem a identidade dele.
var backEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'LOG_LEVEL', value: 'info' }
  { name: 'KEY_VAULT_URL', value: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/' }
  { name: 'SERVICEBUS_FQDN', value: '${serviceBusName}.servicebus.windows.net' }
  { name: 'STORAGE_BLOB_ENDPOINT', value: 'https://${storageAccountName}.blob.${environment().suffixes.storage}/' }
]
var openAiEnv = openAiEnabled
  ? [
      { name: 'AZURE_OPENAI_ENDPOINT', value: openAiEndpoint }
      { name: 'AZURE_OPENAI_DEPLOYMENT', value: openAiDeployment }
    ]
  : []
var purgeEnv = hasFrontDoor ? [{ name: 'FRONT_DOOR_ENDPOINT_ID', value: frontDoorEndpointId }] : []
// A conta (etapa 11, docs/CONTA.md), só na api. Os segredos dela (BETTER_AUTH_SECRET, GOOGLE_CLIENT_SECRET e ACS_CONNECTION_STRING)
// chegam por referência ao Key Vault, em apiSecrets. Aqui só endereços e nomes: nada que pareça segredo (o check.mjs confere).
var accountEnv = concat(
  [
    { name: 'EMAIL_SENDER_ADDRESS', value: emailSenderAddress }
    { name: 'LEGAL_CONTROLLER_NAME', value: legalControllerName }
    { name: 'LEGAL_CONTACT_EMAIL', value: legalContactEmail }
  ],
  empty(googleClientId) ? [] : [{ name: 'GOOGLE_CLIENT_ID', value: googleClientId }]
)
// Contrato da etapa 3 (docs/INFRA.md, seção 3.3): com ORIGIN_LOCK=front-door, web e api só atendem quem traz
// X-Azure-FDID = FRONT_DOOR_ID, e em produção RECUSAM SUBIR se FRONT_DOOR_ID vier vazio (fail closed). Sem esta
// variável um FRONT_DOOR_ID vazio pareceria "sem trava" e um erro de configuração a desligaria em silêncio.
var originLockEnv = hasFrontDoor ? [{ name: 'ORIGIN_LOCK', value: 'front-door' }] : []

// --- Web: Next standalone ------------------------------------------------------------------------
resource web 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-web'
  location: location
  tags: tags
  identity: identityBlock([idOf(identityNames.web)])
  // Os papéis (segredo a segredo) têm de existir antes da primeira revisão; o AcrPull vem da fase 1 (acr.bicep).
  dependsOn: [secretAccess]
  properties: {
    environmentId: managedEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: { external: true, targetPort: webPort, transport: 'auto', allowInsecure: false }
      identitySettings: platformOnly(idOf(identityNames.web))
      registries: registriesOf(registryName, idOf(identityNames.web))
      secrets: secretsOf(secretBase, idOf(identityNames.web), webSecrets)
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: concat(
            [
              { name: 'NODE_ENV', value: 'production' }
              { name: 'PORT', value: string(webPort) }
              { name: 'HOSTNAME', value: '0.0.0.0' }
              { name: 'API_INTERNAL_URL', value: 'https://ca-api.${defaultDomain}' }
              { name: 'PUBLIC_URL', value: publicUrl }
            ],
            originLockEnv,
            envOf(webSecrets)
          )
          probes: probesOn(webPort)
        }
      ]
      scale: {
        minReplicas: webMinReplicas
        maxReplicas: webMaxReplicas
        rules: [{ name: 'http-concurrency', http: { metadata: { concurrentRequests: '50' } } }]
      }
    }
  }
}

// --- Api: NestJS (HTTP e chat SSE) ---------------------------------------------------------------
resource api 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-api'
  location: location
  tags: tags
  identity: identityBlock([idOf(identityNames.api)])
  dependsOn: [secretAccess]
  properties: {
    environmentId: managedEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Multiple'
      ingress: {
        external: true
        targetPort: apiPort
        transport: 'auto'
        allowInsecure: false
        corsPolicy: corsEnabled
          ? {
              allowedOrigins: ['https://ca-web.${defaultDomain}']
              allowedMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
              allowedHeaders: ['content-type']
              allowCredentials: true
              maxAge: 600
            }
          : null
      }
      registries: registriesOf(registryName, idOf(identityNames.api))
      secrets: secretsOf(secretBase, idOf(identityNames.api), apiSecrets)
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          command: ['node', 'dist/main.js']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: concat(
            backEnv,
            [
              { name: 'AZURE_CLIENT_ID', value: apiIdentity.properties.clientId }
              { name: 'API_PORT', value: string(apiPort) }
              { name: 'PUBLIC_URL', value: publicUrl }
            ],
            originLockEnv,
            openAiEnv,
            accountEnv,
            arenaEnv,
            envOf(apiSecrets)
          )
          probes: probesOn(apiPort)
        }
      ]
      scale: {
        minReplicas: apiMinReplicas
        maxReplicas: apiMaxReplicas
        rules: [{ name: 'http-concurrency', http: { metadata: { concurrentRequests: '30' } } }]
      }
    }
  }
}

// --- Worker de dados: sem ingress, 0 a 3, uma regra KEDA por fila -------------------------------
// messageCount 5 = alvo de mensagens por réplica; a primeira mensagem já acorda o worker (de 0 para 1).
// Duas identidades: a do worker (o código; AZURE_CLIENT_ID) e a do KEDA (lifecycle None, só as regras de escala).
var workerQueues = ['market', 'news', 'briefing', 'settlement', 'maintenance']

resource worker 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-worker-data'
  location: location
  tags: tags
  identity: identityBlock([idOf(identityNames.worker), idOf(identityNames.scale)])
  dependsOn: [secretAccess]
  properties: {
    environmentId: managedEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      identitySettings: platformOnly(idOf(identityNames.scale))
      registries: registriesOf(registryName, idOf(identityNames.worker))
      secrets: secretsOf(secretBase, idOf(identityNames.worker), workerSecrets)
    }
    template: {
      // Ao parar (SIGTERM: redução de réplicas, revisão nova), o worker deixa de pedir mensagens e espera os handlers em
      // curso até 270 s (DRAIN_TIMEOUT_MS em messaging.service.ts; a brapi do eod chega a 4 min) antes de fechar os
      // receivers. O padrão da plataforma é 30 s, e o SIGKILL chegaria no meio do eod. 300 = 270 + folga para fechar.
      terminationGracePeriodSeconds: 300
      containers: [
        {
          name: 'worker'
          image: apiImage
          command: ['node', 'dist/worker.js']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(
            backEnv,
            [
              { name: 'AZURE_CLIENT_ID', value: workerIdentity.properties.clientId }
              { name: 'WEB_INTERNAL_URL', value: 'https://ca-web.${defaultDomain}' }
            ],
            purgeEnv,
            envOf(workerSecrets)
          )
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
        rules: [
          for queue in workerQueues: {
            name: 'sb-${queue}'
            custom: {
              type: 'azure-servicebus'
              metadata: { queueName: queue, namespace: serviceBusName, messageCount: '5' }
              identity: idOf(identityNames.scale)
            }
          }
        ]
      }
    }
  }
}

// --- Decisões: job por evento. 1 mensagem = 1 execução ------------------------------------------
// "Paralelismo 10" do plano = até 10 execuções ao mesmo tempo (scale.maxExecutions). Cada execução tem 1
// réplica (parallelism 1) que trata 1 mensagem e sai: um modelo lento ou quebrado não atrasa os outros.
// Falhou: o handler agenda uma nova tentativa (cópia da mensagem, ADR 0015) e a última vai para a DLQ, que vira HOLD.
// Único workload com o prompt da arena e a chave do OpenRouter.
resource decisions 'Microsoft.App/jobs@2025-01-01' = {
  name: 'job-worker-decisions'
  location: location
  tags: tags
  identity: identityBlock([idOf(identityNames.decisions), idOf(identityNames.scale)])
  dependsOn: [secretAccess]
  properties: {
    environmentId: managedEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Event'
      replicaTimeout: 1500
      replicaRetryLimit: 0
      eventTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
        scale: {
          minExecutions: 0
          maxExecutions: 10
          pollingInterval: 30
          rules: [
            {
              name: 'sb-decisions'
              type: 'azure-servicebus'
              metadata: { queueName: 'decisions', namespace: serviceBusName, messageCount: '1' }
              identity: idOf(identityNames.scale)
            }
          ]
        }
      }
      identitySettings: platformOnly(idOf(identityNames.scale))
      registries: registriesOf(registryName, idOf(identityNames.decisions))
      secrets: secretsOf(secretBase, idOf(identityNames.decisions), decideSecrets)
    }
    template: {
      containers: [
        {
          name: 'decide'
          image: apiImage
          command: ['node', 'dist/decide.js']
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(
            backEnv,
            [
              { name: 'AZURE_CLIENT_ID', value: decisionsIdentity.properties.clientId }
              { name: 'PROMPT_ARENA_VERSION', value: promptArenaVersion }
            ],
            envOf(decideSecrets)
          )
        }
      ]
    }
  }
}

// --- Agendadores: só publicam mensagens, em UTC (§6) ---------------------------------------------
// A `retention` é DIÁRIA (10:00 de Brasília): a política de privacidade promete o pior caso do cadastro nunca confirmado (7 dias = o corte de
// 6 dias, RETENTION_DAYS.user, mais 1 dia de espera até a limpeza seguinte). Semanal daria até 14. Mudar o cron muda a promessa.
var schedulers = [
  { name: 'news', cron: '*/30 * * * *' }
  { name: 'briefing', cron: '30 10 * * 1-5' }
  { name: 'cycle', cron: '0 11 * * 1-5' }
  { name: 'eod', cron: '30 0 * * 2-6' }
  { name: 'universe', cron: '0 12 * * 0' }
  { name: 'retention', cron: '0 13 * * *' }
  { name: 'backup', cron: '0 6 1 * *' }
]

// O MessageId é determinístico, então repetir a publicação é seguro (retry de 2 vezes). Os 7 dividem a identidade
// id-alvesting-sched (Service Bus Data Sender e os segredos database-url e appinsights-connection-string). Só o `cycle` leva
// duas variáveis a mais, ambas em texto puro: a versão do prompt que o ciclo fixa e o teto de custo do mês (`arenaEnv`, que a api
// também recebe, acima). Ele não recebe o segredo prompt-arena nem a chave do OpenRouter (docs/INFRA.md, 2.7).
var arenaEnv = [
  { name: 'PROMPT_ARENA_VERSION', value: promptArenaVersion }
  { name: 'ARENA_MONTHLY_COST_CAP_USD', value: string(arenaMonthlyCostCapUsd) }
]
resource schedulerJobs 'Microsoft.App/jobs@2025-01-01' = [
  for scheduler in schedulers: {
    name: 'job-sched-${scheduler.name}'
    location: location
    tags: tags
    identity: identityBlock([idOf(identityNames.sched)])
    dependsOn: [secretAccess]
    properties: {
      environmentId: managedEnv.id
      workloadProfileName: 'Consumption'
      configuration: {
        triggerType: 'Schedule'
        replicaTimeout: 300
        replicaRetryLimit: 2
        scheduleTriggerConfig: {
          cronExpression: scheduler.cron
          parallelism: 1
          replicaCompletionCount: 1
        }
        registries: registriesOf(registryName, idOf(identityNames.sched))
        secrets: secretsOf(secretBase, idOf(identityNames.sched), scheduleSecrets)
      }
      template: {
        containers: [
          {
            name: 'schedule'
            image: apiImage
            command: ['node', 'dist/schedule.js', scheduler.name]
            resources: { cpu: json('0.25'), memory: '0.5Gi' }
            env: concat(
              backEnv,
              [{ name: 'AZURE_CLIENT_ID', value: schedIdentity.properties.clientId }],
              scheduler.name == 'cycle' ? arenaEnv : [],
              envOf(scheduleSecrets)
            )
          }
        ]
      }
    }
  }
]

// --- Migrations e papéis do banco: manual, disparado pelo CI antes de cada nova revisão ----------
// ponytail: o caminho do CLI do Prisma supõe node_modules/prisma dentro do WORKDIR da imagem (a etapa 3
// monta o Dockerfile e confere). Sem retry: migrate deploy é idempotente, mas falha de migration pede olhos.
// Identidade só da plataforma (lifecycle None): puxa a imagem e lê o database-url (o administrador, que migra e cria o login) e o
// database-url-api (de onde o db:roles tira só a senha do login da api), e o código (o CLI do Prisma e o db:roles) não recebe token de ninguém.
// Dois comandos num contêiner só: `migrate deploy` e, SÓ se deu certo (&&), o `db:roles` (ADR 0028; docs/INFRA.md, 2.7), que cria o login
// alvesting_api, define a senha dele (a do database-url-api, como resumo SCRAM) e o põe no papel de grupo que a migration criou. Os dois são
// idempotentes, então repetir o job é seguro, e girar a senha da api é gravar o segredo novo e rodar o job de novo (docs/INFRA.md, 8.2).
// `sh -c` (a imagem é a node:bookworm-slim, que tem o sh) em vez de um comando só: o Container Apps não encadeia dois comandos.
resource migrate 'Microsoft.App/jobs@2025-01-01' = {
  name: 'job-migrate'
  location: location
  tags: tags
  identity: identityBlock([idOf(identityNames.migrate)])
  dependsOn: [secretAccess]
  properties: {
    environmentId: managedEnv.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      identitySettings: platformOnly(idOf(identityNames.migrate))
      registries: registriesOf(registryName, idOf(identityNames.migrate))
      secrets: secretsOf(secretBase, idOf(identityNames.migrate), migrateSecrets)
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: apiImage
          command: [
            'sh'
            '-c'
            'node node_modules/prisma/build/index.js migrate deploy && node dist/db-roles-cli.js'
          ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: concat([{ name: 'NODE_ENV', value: 'production' }], envOf(migrateSecrets))
        }
      ]
    }
  }
}

output webFqdn string = web.properties.configuration.ingress.fqdn
output apiFqdn string = api.properties.configuration.ingress.fqdn
