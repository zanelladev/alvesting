// Azure Communication Services Email (§5.3): verificação de e-mail e reset de senha (etapa 11).
// Domínio gerenciado pela Azure (remetente DoNotReply@<guid>.azurecomm.net); domínio próprio fica para depois.
param name string
param emailName string
param tags object
param keyVaultName string
@description('Grava o segredo acs-connection-string. Só na fase 1: regravar o mesmo valor cria uma versão nova, e o Container Apps reinicia as revisões que o referenciam.')
param writeDerivedSecrets bool

// Os dados do envio ficam nos Estados Unidos; o resto da stack, na Chile Central (ADR 0040). A política de privacidade informa as
// duas transferências (item 6).
var dataLocation = 'United States'

resource emailService 'Microsoft.Communication/emailServices@2025-09-01' = {
  name: emailName
  location: 'global'
  tags: tags
  properties: { dataLocation: dataLocation }
}

resource domain 'Microsoft.Communication/emailServices/domains@2025-09-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: { domainManagement: 'AzureManaged' }
}

resource communication 'Microsoft.Communication/communicationServices@2025-09-01' = {
  name: name
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
    linkedDomains: [domain.id]
  }
}

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: keyVaultName
}

// De onde o e-mail da conta sai (EMAIL_SENDER_ADDRESS, só na api): o remetente do domínio gerenciado pela Azure. O usuário DoNotReply é o
// que o domínio gerenciado cria sozinho; o domínio (<guid>.azurecomm.net) só existe depois do deploy, por isso é saída do módulo.
output senderAddress string = 'DoNotReply@${domain.properties.mailFromSenderDomain}'

// ponytail: connection string no Key Vault, lida só pela id-alvesting-api (ACS_CONNECTION_STRING). A alternativa é a identidade
// gerenciada (o EmailClient aceita um TokenCredential), mas a documentação do Communication Services que foi lida em 02/11/2026
// (autenticação, identidade gerenciada, quickstarts de e-mail e de service principal, páginas dos papéis internos) confirma que o
// e-mail aceita o Entra ID e NÃO diz qual papel do Azure RBAC basta para enviar: o quickstart usa Contributor, largo demais, e as
// páginas de papéis internos não listam um papel do Communication Services. Sem o papel confirmado a troca seria chute
// (docs/CONTA.md, "Identidade gerenciada no e-mail").
resource connectionString 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = if (writeDerivedSecrets) {
  parent: vault
  name: 'acs-connection-string'
  properties: {
    value: communication.listKeys().primaryConnectionString
  }
}
