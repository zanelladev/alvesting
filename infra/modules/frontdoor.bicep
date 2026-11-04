// Azure Front Door Standard (§5.4), só no perfil padrão: borda com TLS, WAF com rate limit por IP,
// cache de /_next/static/* e das GET públicas da API, rotas por caminho e probe GET /health a cada 30 s.
//   /api/*           -> grupo api, SEM cache (login, conta, admin, chat, health, Swagger)
//   rotas públicas   -> grupo api, COM cache (as GET públicas de /api/v1, plano §9; ver apiPublicRoute)
//   /_next/static/*  -> grupo web, com cache (imutável)
//   /*               -> grupo web, SEM cache (o HTML não é guardado na borda)
// Um SEGUNDO endpoint, o do blue/green (ADR 0029), leva ao label green de cada app, sem cache nenhum:
//   /api/*           -> grupo api-green      (ca-api---green.<domínio do ambiente>)
//   /*               -> grupo web-green      (ca-web---green.<domínio do ambiente>)
// É por ele que o deploy prova a revisão nova (smoke e Playwright mobile) ANTES de ela receber tráfego, passando pelo mesmo WAF e pela mesma
// trava de origem do site. Sem custo novo: no Standard as rotas e as regras próprias do WAF são grátis, e a taxa-base é por perfil (Learn,
// "Compare pricing between Azure Front Door tiers", 25/09/2025).
// A trava de origem é por cabeçalho: o Front Door manda X-Azure-FDID e web/api recusam quem não traz o
// ID deste perfil (etapa 3). O ID vai para o segredo front-door-id (Key Vault) e vira FRONT_DOOR_ID.
param profileName string
param tags object
param webHostName string
param apiHostName string
@description('Endereço do label green do web (ca-web---green.<domínio do ambiente>), o destino do endpoint green.')
param webGreenHostName string
@description('Endereço do label green da api (ca-api---green.<domínio do ambiente>), o destino do endpoint green.')
param apiGreenHostName string
param keyVaultName string
@description('Identidade que limpa o cache depois da liquidação (a do ca-worker-data). É a única com a ação de purge.')
param purgeIdentityName string
@description('Workspace do Log Analytics que recebe o log do WAF.')
param workspaceName string
@description('Domínio próprio da borda (ex.: alvesting.com.br). Vazio = só o host *.azurefd.net.')
param customDomain string
@description('Limite de requisições por IP e por minuto no WAF.')
param rateLimitPerMinute int
@description('Grava o segredo front-door-id. Só na fase 1 (ou ao passar do econômico para o padrão): regravar o mesmo valor cria uma versão nova, e o Container Apps reinicia as revisões que o referenciam.')
param writeDerivedSecrets bool

// Limite próprio do login e do cadastro (/api/auth/*, Better Auth), contra credential stuffing: o limite geral
// serve à navegação, não a tentativas de senha.
// ponytail: 30 por minuto por IP vale para todo /api/auth/, inclusive get-session. Quem está atrás do mesmo NAT
// (rede da faculdade na banca) divide o limite; se atrapalhar, subir o número ou estreitar o casamento para
// /api/auth/sign-.
var authRateLimitPerMinute = 30

var endpointName = 'alvesting'
var greenEndpointName = 'alvesting-green'
var wafName = 'wafalvesting'
var domainName = 'site'
var purgeAction = 'Microsoft.Cdn/profiles/afdEndpoints/purge/action'

var customDomainRefs = empty(customDomain)
  ? []
  : [{ id: resourceId('Microsoft.Cdn/profiles/customDomains', profileName, domainName) }]

var loadBalancing = {
  sampleSize: 4
  successfulSamplesRequired: 3
  additionalLatencyInMilliseconds: 50
}
// /health nos dois: a api tem o alias sem prefixo (configure-app.ts) e a web tem app/health/route.ts.
var healthProbe = {
  probePath: '/health'
  probeRequestType: 'GET'
  probeProtocol: 'Https'
  probeIntervalInSeconds: 30
}

resource purgeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: purgeIdentityName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: workspaceName
}

resource profile 'Microsoft.Cdn/profiles@2025-06-01' = {
  name: profileName
  location: 'global'
  tags: tags
  sku: { name: 'Standard_AzureFrontDoor' }
  properties: {
    originResponseTimeoutSeconds: 60
  }
}

// Log do WAF (o que a regra de rate limit bloqueou, de que IP e em qual URL) no Log Analytics: sem ele um ataque
// só deixa rastro no 429/403 que o cliente recebeu. O IP do cliente é dado pessoal e o requestUri traz a URL
// completa, com a query string (?code= do OAuth, ?token= da verificação de e-mail): a política de privacidade da
// etapa 11 cita os logs de segurança, e a retenção é a do workspace (90 dias, observability.bicep).
// ponytail: só FrontDoorWebApplicationFirewallLog. O FrontDoorAccessLog tem uma linha por requisição e estoura os
// 5 GB gratuitos do workspace; ligar quando o orçamento de logs permitir. API 2021-05-01-preview: ver
// observability.bicep (a única que o Bicep tipa para escopo de recurso).
resource wafLog 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'waf-para-log-alvesting'
  scope: profile
  properties: {
    workspaceId: workspace.id
    logs: [{ category: 'FrontDoorWebApplicationFirewallLog', enabled: true }]
  }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2025-06-01' = {
  parent: profile
  name: endpointName
  location: 'global'
  tags: tags
  // O host é alvesting-<hash>.z01.azurefd.net: o nome do endpoint só precisa ser único no perfil.
  properties: { enabledState: 'Enabled', autoGeneratedDomainNameLabelScope: 'TenantReuse' }
}

resource domain 'Microsoft.Cdn/profiles/customDomains@2025-06-01' = if (!empty(customDomain)) {
  parent: profile
  name: domainName
  properties: {
    hostName: customDomain
    tlsSettings: { certificateType: 'ManagedCertificate', minimumTlsVersion: 'TLS12' }
  }
}

resource webGroup 'Microsoft.Cdn/profiles/originGroups@2025-06-01' = {
  parent: profile
  name: 'web'
  properties: {
    loadBalancingSettings: loadBalancing
    healthProbeSettings: healthProbe
    sessionAffinityState: 'Disabled'
  }
}

resource webOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2025-06-01' = {
  parent: webGroup
  name: 'web'
  properties: {
    hostName: webHostName
    originHostHeader: webHostName
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

resource apiGroup 'Microsoft.Cdn/profiles/originGroups@2025-06-01' = {
  parent: profile
  name: 'api'
  properties: {
    loadBalancingSettings: loadBalancing
    healthProbeSettings: healthProbe
    sessionAffinityState: 'Disabled'
  }
}

resource apiOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2025-06-01' = {
  parent: apiGroup
  name: 'api'
  properties: {
    hostName: apiHostName
    originHostHeader: apiHostName
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

// O Front Door exige que o grupo já tenha a origem quando a rota nasce, e o domínio próprio (se houver)
// já criado: por isso os dependsOn (os IDs de domínio são montados com resourceId e não geram dependência).
resource apiRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2025-06-01' = {
  parent: endpoint
  name: 'api'
  dependsOn: [apiOrigin, domain]
  properties: {
    originGroup: { id: apiGroup.id }
    patternsToMatch: ['/api/*']
    supportedProtocols: ['Http', 'Https']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    customDomains: customDomainRefs
    enabledState: 'Enabled'
  }
}

// O cache das GET públicas da API (etapa 9; docs/API.md): ranking, patrimônio, Monte Carlo, competidor, ciclo, feed de decisões,
// notícias e ações, as rotas públicas do §9 do plano, UMA a UMA. Nunca o /api/* inteiro: o login (/api/auth/*), a conta e a
// carteira (/api/v1/me/*), o admin e o chat não podem ir para o cache de ninguém, e a documentação do Front Door recomenda rotas
// separadas para o estático e o dinâmico, com o cache desligado no dinâmico (Learn, "Caching with Azure Front Door").
// Rota mais específica vence (Learn, "How requests get matched to a route configuration"): estas ganham do /api/*. O caractere
// curinga só vale no fim e depois de uma barra, e o padrão sem curinga é exato: por isso a lista e o curinga de seasons e stocks.
// Sem cacheBehavior no nível da rota o Front Door respeita o Cache-Control da origem (s-maxage da API, PUBLIC_CACHE_TTL_SECONDS):
// sem o cabeçalho ele guardaria a resposta por 1 a 3 dias, e é por isso que a API manda no-store em tudo o que não declara cache,
// erro inclusive. A chave leva a query string (cursor, limite, filtros): cada página é uma entrada. Nenhum rule set sobrescreve o
// tempo de vida. Depois de cada liquidação o worker limpa /api/v1/* (purge, abaixo); o tempo de vida só limita o atraso se falhar.
// Só GET é cacheado (qualquer outro método passa direto).
resource apiPublicRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2025-06-01' = {
  parent: endpoint
  name: 'api-public'
  dependsOn: [apiOrigin, domain]
  properties: {
    originGroup: { id: apiGroup.id }
    patternsToMatch: [
      '/api/v1/arena/current'
      '/api/v1/seasons'
      '/api/v1/seasons/*'
      '/api/v1/competitors/*'
      '/api/v1/cycles/*'
      '/api/v1/decisions'
      '/api/v1/news'
      '/api/v1/stocks'
      '/api/v1/stocks/*'
    ]
    supportedProtocols: ['Http', 'Https']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    customDomains: customDomainRefs
    enabledState: 'Enabled'
    cacheConfiguration: {
      queryStringCachingBehavior: 'UseQueryString'
      compressionSettings: {
        isCompressionEnabled: true
        contentTypesToCompress: ['application/json']
      }
    }
  }
}

// O estático do Next tem cache (respeita o Cache-Control do origin, que é imutável).
resource staticRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2025-06-01' = {
  parent: endpoint
  name: 'static'
  dependsOn: [webOrigin, domain]
  properties: {
    originGroup: { id: webGroup.id }
    patternsToMatch: ['/_next/static/*']
    supportedProtocols: ['Http', 'Https']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    customDomains: customDomainRefs
    enabledState: 'Enabled'
    cacheConfiguration: {
      queryStringCachingBehavior: 'IgnoreQueryString'
      compressionSettings: {
        isCompressionEnabled: true
        contentTypesToCompress: ['application/javascript', 'text/javascript', 'text/css', 'image/svg+xml']
      }
    }
  }
}

// O HTML (as páginas do site) NÃO tem cache na borda: a rota não tem cacheConfiguration. O que a página mostra vem do cache de
// dados do Next (revalidado depois de cada liquidação), e o cache da borda fica com o estático e com a API pública.
resource webRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2025-06-01' = {
  parent: endpoint
  name: 'web'
  dependsOn: [webOrigin, domain]
  properties: {
    originGroup: { id: webGroup.id }
    patternsToMatch: ['/*']
    supportedProtocols: ['Http', 'Https']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    customDomains: customDomainRefs
    enabledState: 'Enabled'
  }
}

// --- O endpoint do blue/green (ADR 0029) --------------------------------------------------------------------------------------------
// Dois grupos de origem, um por label green, e duas rotas SEM cache (nada do green vai para a borda de ninguém): /api/* para a api e o resto
// para o web. O host do endpoint (alvesting-green-<hash>.z01.azurefd.net) é a variável SITE_GREEN_URL do repositório. Não usa o domínio
// próprio: só o deploy o visita. O label fica na revisão que está no ar quando nenhum deploy corre, então as origens ficam saudáveis; o
// alerta de origem doente olha só os grupos do site (alerts.bicep), porque no meio de um deploy que falha o label pode não existir.
resource greenEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2025-06-01' = {
  parent: profile
  name: greenEndpointName
  location: 'global'
  tags: tags
  properties: { enabledState: 'Enabled', autoGeneratedDomainNameLabelScope: 'TenantReuse' }
}

resource webGreenGroup 'Microsoft.Cdn/profiles/originGroups@2025-06-01' = {
  parent: profile
  name: 'web-green'
  properties: {
    loadBalancingSettings: loadBalancing
    healthProbeSettings: healthProbe
    sessionAffinityState: 'Disabled'
  }
}

resource webGreenOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2025-06-01' = {
  parent: webGreenGroup
  name: 'web-green'
  properties: {
    hostName: webGreenHostName
    originHostHeader: webGreenHostName
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

resource apiGreenGroup 'Microsoft.Cdn/profiles/originGroups@2025-06-01' = {
  parent: profile
  name: 'api-green'
  properties: {
    loadBalancingSettings: loadBalancing
    healthProbeSettings: healthProbe
    sessionAffinityState: 'Disabled'
  }
}

resource apiGreenOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2025-06-01' = {
  parent: apiGreenGroup
  name: 'api-green'
  properties: {
    hostName: apiGreenHostName
    originHostHeader: apiGreenHostName
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

resource apiGreenRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2025-06-01' = {
  parent: greenEndpoint
  name: 'api-green'
  dependsOn: [apiGreenOrigin]
  properties: {
    originGroup: { id: apiGreenGroup.id }
    patternsToMatch: ['/api/*']
    supportedProtocols: ['Http', 'Https']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    customDomains: []
    enabledState: 'Enabled'
  }
}

resource webGreenRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2025-06-01' = {
  parent: greenEndpoint
  name: 'web-green'
  dependsOn: [webGreenOrigin]
  properties: {
    originGroup: { id: webGreenGroup.id }
    patternsToMatch: ['/*']
    supportedProtocols: ['Http', 'Https']
    httpsRedirect: 'Enabled'
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    customDomains: []
    enabledState: 'Enabled'
  }
}

// WAF do Standard: só regras próprias (as gerenciadas são do Premium). O Front Door exige uma condição de
// casamento na regra de rate limit, e ela tem de ser algo que o cliente não escolhe. Por isso casa-se a URL
// que o Front Door recebeu (toda URL contém "/"), e NUNCA RemoteAddr: ele é o IP "original" lido do
// X-Forwarded-For, que o atacante escreve. Com a condição "RemoteAddr não está em 192.0.2.0/24" (o truque do
// quickstart), mandar X-Forwarded-For: 192.0.2.1 fazia a requisição escapar da regra e do limite. A contagem
// é por SocketAddr (o IP que o WAF vê), o padrão, e as duas regras contam em separado.
resource waf 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2025-03-01' = {
  name: wafName
  location: 'global'
  tags: tags
  sku: { name: 'Standard_AzureFrontDoor' }
  properties: {
    policySettings: { enabledState: 'Enabled', mode: 'Prevention' }
    customRules: {
      rules: [
        // /interno/* é do worker, que chama o ingress do ca-web direto (POST /interno/revalidar, docs/INFRA.md, 3.3), e do site, que lê a
        // rota interna de cotações pelo ingress do ca-api (GET /api/v1/interno/barras/:ticker, docs/API.md, seção 6): nada legítimo chega
        // a elas pelo Front Door. Bloqueá-las na borda deixa só o endereço direto do app (trava de origem e segredo) como caminho até
        // elas. Prioridade menor = avaliada antes; a regra casa à prova de caixa e de %2F.
        {
          name: 'BlockInterno'
          priority: 10
          enabledState: 'Enabled'
          ruleType: 'MatchRule'
          action: 'Block'
          matchConditions: [
            {
              matchVariable: 'RequestUri'
              operator: 'Contains'
              negateCondition: false
              matchValue: ['/interno/']
              transforms: ['Lowercase', 'UrlDecode']
            }
          ]
        }
        {
          name: 'RateLimitAuth'
          priority: 90
          enabledState: 'Enabled'
          ruleType: 'RateLimitRule'
          action: 'Block'
          rateLimitDurationInMinutes: 1
          rateLimitThreshold: authRateLimitPerMinute
          matchConditions: [
            {
              matchVariable: 'RequestUri'
              operator: 'Contains'
              negateCondition: false
              matchValue: ['/api/auth/']
              // Maiúscula e %61 no lugar de "a" chegam à mesma rota na origem: sem isso driblavam o casamento.
              transforms: ['Lowercase', 'UrlDecode']
            }
          ]
        }
        {
          name: 'RateLimitPorIp'
          priority: 100
          enabledState: 'Enabled'
          ruleType: 'RateLimitRule'
          action: 'Block'
          rateLimitDurationInMinutes: 1
          rateLimitThreshold: rateLimitPerMinute
          matchConditions: [
            {
              matchVariable: 'RequestUri'
              operator: 'Contains'
              negateCondition: false
              matchValue: ['/']
            }
          ]
        }
      ]
    }
  }
}

resource security 'Microsoft.Cdn/profiles/securityPolicies@2025-06-01' = {
  parent: profile
  name: 'waf'
  dependsOn: [domain]
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: { id: waf.id }
      associations: [
        {
          // o endpoint do green também passa pelo WAF (BlockInterno e os limites): o código novo é provado pela borda de verdade
          domains: concat([{ id: endpoint.id }, { id: greenEndpoint.id }], customDomainRefs)
          patternsToMatch: ['/*']
        }
      ]
    }
  }
}

// Purge após a liquidação (§5.4 e §7): papel próprio só com a ação de purge, no escopo do perfil. O worker chama a ARM REST do
// endpoint (POST .../afdEndpoints/alvesting/purge?api-version=2025-06-01, corpo {"contentPaths":["/api/v1/*"]}; docs/JOBS.md, 4.2)
// com o token da id-alvesting-worker.
resource purgeRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, profileName, purgeAction)
  properties: {
    roleName: 'Front Door purge (${profileName} em ${resourceGroup().name})'
    description: 'Limpa o cache do Front Door e nada além disso.'
    type: 'CustomRole'
    permissions: [{ actions: [purgeAction] }]
    assignableScopes: [resourceGroup().id]
  }
}

resource purgeAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: profile
  name: guid(profile.id, purgeIdentity.id, purgeRole.id)
  properties: {
    principalId: purgeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: purgeRole.id
  }
}

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: keyVaultName
}

// Segredo derivado: o ID do perfil (X-Azure-FDID) só existe depois que o Front Door nasce.
resource frontDoorId 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = if (writeDerivedSecrets) {
  parent: vault
  name: 'front-door-id'
  properties: {
    value: profile.properties.frontDoorId
  }
}

output endpointHostname string = endpoint.properties.hostName
output greenEndpointHostname string = greenEndpoint.properties.hostName
output endpointId string = endpoint.id
