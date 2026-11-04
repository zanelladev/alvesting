// Log Analytics + Application Insights (§5.9): logs Pino em JSON, traces e métricas do OpenTelemetry. Recebe
// também o log de auditoria do Key Vault: o cofre guarda os prompts, e sem esse log não há como saber quem leu um
// segredo nem quando (achado da revisão de segurança da etapa 2).
param workspaceName string
param location string
param tags object
param keyVaultName string
@description('Grava o segredo appinsights-connection-string. Só na fase 1: regravar o mesmo valor cria uma versão nova, e o Container Apps reinicia as revisões que o referenciam.')
param writeDerivedSecrets bool

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    // 90 dias e não os 30 do mínimo: o AuditEvent do cofre é a trilha de quem leu o prompt, a temporada dura ~20
    // pregões (~4 semanas) e um vazamento descoberto depois dos 30 dias não deixaria trilha. A Azure inclui 31 dias; o
    // que passa disso é cobrado por GB armazenado (centavos nesse volume). A retenção vale para o workspace inteiro,
    // inclusive para o log do WAF, que carrega IP e URL com query string (docs/INFRA.md, 2.5 e 3.1).
    retentionInDays: 90
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-alvesting'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    IngestionMode: 'LogAnalytics'
    WorkspaceResourceId: workspace.id
  }
}

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: keyVaultName
}

// AuditEvent: cada SecretGet/SecretSet, com quem fez e quando (o valor do segredo não vai no log). Sem alerta
// por enquanto (os alertas são da etapa 10); o log precisa existir antes, para haver histórico.
// ponytail: a única versão de API de Microsoft.Insights/diagnosticSettings que o Bicep tipa e aceita escopo de
// recurso é a 2021-05-01-preview (a 2017-05-01-preview é mais antiga, e a 2016-09-01 é só de assinatura). É
// preview: exceção à regra "só GA" (docs/INFRA.md, seção 10). A retenção é a do workspace (90 dias, acima); para uma
// trilha mais longa, subir retentionInDays do workspace.
resource vaultAudit 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'auditoria-para-log-alvesting'
  scope: vault
  properties: {
    workspaceId: workspace.id
    logs: [{ category: 'AuditEvent', enabled: true }]
  }
}

// Segredo derivado: os apps recebem a string de conexão só por referência ao Key Vault.
resource connectionString 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = if (writeDerivedSecrets) {
  parent: vault
  name: 'appinsights-connection-string'
  properties: {
    value: insights.properties.ConnectionString
  }
}
