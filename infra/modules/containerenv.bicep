// Ambiente do Container Apps (§5.3): perfil Consumption, dentro da VNet, ingress externo.
// O ingress é um Envoy sobre um Azure Load Balancer gerenciado: balanceia entre réplicas e divide
// tráfego entre revisões. Fica separado dos apps porque o Front Door precisa do defaultDomain antes
// que os apps existam (os apps precisam do ID do Front Door).
param name string
param location string
param tags object
param subnetId string
param workspaceName string

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: workspaceName
}

resource managedEnv 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: subnetId
      internal: false
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
    zoneRedundant: false
  }
}

output name string = managedEnv.name
output defaultDomain string = managedEnv.properties.defaultDomain
