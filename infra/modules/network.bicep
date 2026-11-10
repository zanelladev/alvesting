// VNet 10.10.0.0/16 (§5.2) com duas sub-redes delegadas e a zona DNS privada do Postgres (§5.6).
//   snet-apps      Container Apps (workload profiles, mínimo /27; /23 sobra para 10 jobs + 13 réplicas)
//   snet-postgres  PostgreSQL Flexible com VNet integration: sem IP público
param location string
param tags object
param postgresName string

var vnetName = 'vnet-alvesting'

resource vnet 'Microsoft.Network/virtualNetworks@2025-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.10.0.0/16'] }
    subnets: [
      {
        name: 'snet-apps'
        properties: {
          addressPrefix: '10.10.0.0/23'
          delegations: [
            { name: 'apps', properties: { serviceName: 'Microsoft.App/environments' } }
          ]
        }
      }
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: '10.10.2.0/24'
          delegations: [
            { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
          // A Azure liga este endpoint ao criar o servidor (é por ele que o WAL vai ao Storage), e tirá-lo "pode interromper a conectividade"
          // (learn.microsoft.com/azure/postgresql/network/concepts-networking-private). Sem ele aqui, toda execução da infra o apaga (09/11/2026).
          serviceEndpoints: [{ service: 'Microsoft.Storage' }]
        }
      }
    ]
  }
}

// O nome da zona tem de terminar em .postgres.database.azure.com; esta é a forma que o portal usa.
resource zone 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${postgresName}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource zoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: zone
  name: vnetName
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

// IDs montados com resourceId() (e não lidos da VNet) para valerem desde o início do deploy.
output appsSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, 'snet-apps')
output postgresSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, 'snet-postgres')
output privateDnsZoneId string = zone.id
