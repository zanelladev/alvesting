// Produção (rg-alvesting-prod, Chile Central, ADR 0040). Nomes exatos do §5.3 do plano. Uma linha por parâmetro:
// o infra/tests/check.mjs troca algumas delas para testar os dois perfis.
//
// Econômico (ADR 0039, 06/11/2026): sem Front Door e sem ACR, uns US$ 5 a 10 por mês, o que cabe nos US$ 100 do Azure for Students até
// depois do Demo Day; o padrão (Front Door, US$ 72 a 83) acabaria com o crédito em umas 5 semanas. O site repassa /api/* à api interna.
// Para voltar ao padrão (com crédito): profile = 'padrao' na linha abaixo, e a ordem de docs/INFRA.md, 8.1 (as imagens no ACR antes, o deploy
// com writeDerivedSecrets=true para nascer o front-door-id, e a variável ALVESTING_PROFILE apagada do repositório, docs/DEPLOY.md, seção 3).
//
// Os valores abaixo são o regime de ROTINA (what-if da segunda execução, CI, qualquer deploy depois do
// primeiro): nada é regravado. O primeiro deploy sobrescreve três na linha de comando (docs/INFRA.md, seção 6):
//   --parameters deployApps=false writeDerivedSecrets=true deployBudget=true
using 'main.bicep'

param profile = 'economico'
param nameSuffix = ''
param deployApps = true
param writeDerivedSecrets = false
param deployBudget = false
param purgeProtection = true
param softDeleteRetentionDays = 90
param ghcrOwner = 'zanelladev'
param budgetAmount = 100
param budgetStartDate = '2026-11-01'
param enableOpenAI = false
param customDomain = ''
// Teto de custo das LLMs da arena no mês, em dólares (plano 5.15: estourou, o ciclo é pulado e nenhum modelo é chamado).
// 40 é a proposta, a decisão é do Artur: a estimativa da Temporada 1 (6 modelos, 20 pregões) está em docs/ARENA.md, de
// uns US$ 11 no uso típico a uns US$ 24 no teto de tokens.
param arenaMonthlyCostCapUsd = 40

// Do ambiente, nunca de arquivo (docs/INFRA.md, passo 2).
param postgresAdminPassword = readEnvironmentVariable('ALVESTING_PG_ADMIN_PASSWORD', '')
// A senha do login de menor privilégio da api (alvesting_api, ADR 0028), com pelo menos 32 caracteres: vai para o segredo database-url-api.
param postgresApiPassword = readEnvironmentVariable('ALVESTING_PG_API_PASSWORD', '')
param budgetAlertEmail = readEnvironmentVariable('ALVESTING_BUDGET_EMAIL', '')
param adminPrincipalId = readEnvironmentVariable('ALVESTING_ADMIN_PRINCIPAL_ID', '')

// A conta (etapa 11, docs/CONTA.md): quem é o controlador dos dados e o contato da política de privacidade (nunca no repositório; a api
// recusa subir em produção sem eles) e o client ID do Google (não é segredo; vazio = sem login por Google). Exigidos só na fase 2.
param legalControllerName = readEnvironmentVariable('ALVESTING_LEGAL_CONTROLLER_NAME', '')
param legalContactEmail = readEnvironmentVariable('ALVESTING_LEGAL_CONTACT_EMAIL', '')
param googleClientId = readEnvironmentVariable('ALVESTING_GOOGLE_CLIENT_ID', '')

// A tag das imagens (o SHA que o pipeline publicou) e a versão do prompt da arena NÃO têm valor aqui: um valor fixo
// reverteria o que está no ar a cada execução da infra. A fase 1 não precisa deles; a fase 2 não sobe sem eles
// (docs/INFRA.md, passos 4 a 7, e como repetir os que estão no ar).
param apiImageTag = readEnvironmentVariable('ALVESTING_API_TAG', '')
param webImageTag = readEnvironmentVariable('ALVESTING_WEB_TAG', '')
param promptArenaVersion = readEnvironmentVariable('ALVESTING_PROMPT_ARENA_VERSION', '')
