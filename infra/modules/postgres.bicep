// PostgreSQL 17 Flexible, B1ms, 32 GB, backup (PITR) de 7 dias, privado (§5.3 e §5.6).
// Sem IP público: VNet integration em sub-rede delegada + zona DNS privada. Não existe regra de firewall.
param name string
param location string
param tags object
param subnetId string
param privateDnsZoneId string
param keyVaultName string
// Trava tardia: o valor vem do ambiente (ver main.*.bicepparam) e, se faltar, o deploy para aqui,
// antes de criar o servidor.
@secure()
@minLength(16)
param adminPassword string
// A senha do login da api, com a mesma trava tardia (ADR 0028). O servidor não a conhece: ela só vai para o segredo database-url-api, e quem a
// aplica no banco é o job-migrate (o db:roles lê a senha desse segredo e a grava como resumo SCRAM). 32 é o mínimo que o db:roles aceita em
// produção (apps/api/src/infrastructure/database/api-login.ts).
@secure()
@minLength(32)
param apiPassword string
@description('Grava os segredos database-url e database-url-api. Só na fase 1 e na troca de uma das senhas: regravar o mesmo valor cria uma versão nova, e o Container Apps reinicia as revisões que o referenciam.')
param writeDerivedSecrets bool

// ponytail: o login administrador (dono das tabelas) serve os workers, as decisões, os agendadores e as migrations. A api tem login próprio
// de menor privilégio (alvesting_api, membro de alvesting_api_group; migration 20261103100000_api_role e o comando db:roles; ADR 0028): o
// database-url-api é o segredo dele, lido só pela api e pelo job-migrate, e o ca-api o usa no DATABASE_URL. Este módulo só guarda os dois
// segredos; o login nasce no job-migrate, depois do `migrate deploy`. Teto: um RCE no worker ou nas decisões ainda muda o desenho do banco;
// o próximo passo é um segundo papel de grupo, de escrita sem DDL.
var adminLogin = 'alvesting'
var apiLogin = 'alvesting_api'
var databaseName = 'alvesting'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    createMode: 'Default'
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
    network: {
      publicNetworkAccess: 'Disabled'
      delegatedSubnetResourceId: subnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// TLS obrigatório declarado, e não só herdado do padrão da Azure: o servidor recusa conexão sem TLS mesmo que
// um cliente peça sslmode=disable. Depende do banco para não disputar o servidor com outra operação.
resource secureTransport 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2025-08-01' = {
  parent: server
  name: 'require_secure_transport'
  dependsOn: [database]
  properties: { value: 'on', source: 'user-override' }
}

resource vault 'Microsoft.KeyVault/vaults@2025-05-01' existing = {
  name: keyVaultName
}

// Segredo derivado: a senha só passa por aqui e fica no Key Vault; os apps leem por referência.
// ponytail: sslmode=require, e não verify-full, de propósito. O driver pg trata "require" como verify-full
// hoje (e avisa que a próxima major o enfraquece: rever ao subir o pg para a 9), mas o motor do Prisma, que
// roda o job-migrate, ignora "verify-full" em silêncio (conecta sem TLS; medido com o Prisma 7.10.1) e só
// exige TLS com "require". O check.mjs trava o valor; a TLS no servidor é a require_secure_transport acima.
resource databaseUrl 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = if (writeDerivedSecrets) {
  parent: vault
  name: 'database-url'
  properties: {
    value: 'postgresql://${adminLogin}:${uriComponent(adminPassword)}@${server.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
  }
}

// O login de menor privilégio da api, com a senha própria. Mesmo servidor, mesmo banco, mesmo TLS; só o usuário e a senha mudam. A senha vai
// por uriComponent (a URL a lê por decodeURIComponent no db:roles e no driver). Mesmas regras de regravação do database-url.
resource databaseUrlApi 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = if (writeDerivedSecrets) {
  parent: vault
  name: 'database-url-api'
  properties: {
    value: 'postgresql://${apiLogin}:${uriComponent(apiPassword)}@${server.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
  }
}

output name string = server.name
