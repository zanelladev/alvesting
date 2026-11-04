// Desenvolvimento (rg-alvesting-dev): perfil econômico e nomes com o sufixo -dev, para conviver com a
// produção na mesma assinatura. Uma linha por parâmetro.
//
// Os valores abaixo são o regime de ROTINA (nada é regravado); o primeiro deploy sobrescreve três na linha de
// comando (docs/INFRA.md, seção 6): --parameters deployApps=false writeDerivedSecrets=true deployBudget=true
using 'main.bicep'

param profile = 'economico'
param nameSuffix = '-dev'
param deployApps = true
param writeDerivedSecrets = false
param deployBudget = false
// Sem proteção contra purge e com a retenção mínima: apagar o resource group de dev e recriá-lo não pode
// travar o nome do cofre por 90 dias.
param purgeProtection = false
param softDeleteRetentionDays = 7
param ghcrOwner = 'zanelladev'
param budgetAmount = 20
param budgetStartDate = '2026-11-01'
param enableOpenAI = false
param customDomain = ''
// Teto de custo das LLMs da arena no mês, em dólares. Em dev, só o suficiente para um ensaio curto com um modelo pago.
param arenaMonthlyCostCapUsd = 10

// Do ambiente, nunca de arquivo (docs/INFRA.md, passo 2).
param postgresAdminPassword = readEnvironmentVariable('ALVESTING_PG_ADMIN_PASSWORD', '')
// A senha do login de menor privilégio da api (alvesting_api, ADR 0028), com pelo menos 32 caracteres: vai para o segredo database-url-api.
param postgresApiPassword = readEnvironmentVariable('ALVESTING_PG_API_PASSWORD', '')
param budgetAlertEmail = readEnvironmentVariable('ALVESTING_BUDGET_EMAIL', '')
param adminPrincipalId = readEnvironmentVariable('ALVESTING_ADMIN_PRINCIPAL_ID', '')

// A conta (etapa 11, docs/CONTA.md): o controlador e o contato da política de privacidade (a api recusa subir em produção sem eles) e o
// client ID do Google (não é segredo; vazio = sem login por Google). Também do ambiente, também exigidos só na fase 2.
param legalControllerName = readEnvironmentVariable('ALVESTING_LEGAL_CONTROLLER_NAME', '')
param legalContactEmail = readEnvironmentVariable('ALVESTING_LEGAL_CONTACT_EMAIL', '')
param googleClientId = readEnvironmentVariable('ALVESTING_GOOGLE_CLIENT_ID', '')

// A tag das imagens e a versão do prompt da arena também vêm do ambiente em dev: sem valor fixo, nada reverte o
// que está no ar. A fase 1 não precisa deles; a fase 2 não sobe sem eles (docs/INFRA.md, passos 4 a 7).
param apiImageTag = readEnvironmentVariable('ALVESTING_API_TAG', '')
param webImageTag = readEnvironmentVariable('ALVESTING_WEB_TAG', '')
param promptArenaVersion = readEnvironmentVariable('ALVESTING_PROMPT_ARENA_VERSION', '')
