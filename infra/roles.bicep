// Papéis internos da Azure usados pela infra: cada GUID existe aqui e em mais nenhum lugar.
// Um GUID errado só aparece no meio do deploy (RoleDefinitionDoesNotExist) ou, pior, é outro papel.
// Duas conferências independentes deste arquivo:
//   - infra/scripts/verify-roles.sh  pergunta à assinatura qual é o nome de cada GUID (antes da fase 1);
//   - infra/tests/check.mjs          compara com a tabela da Microsoft (sem Azure).
// O texto depois de // é o nome oficial do papel; as duas conferências leem esta linha.
// Fonte: https://learn.microsoft.com/azure/role-based-access-control/built-in-roles
@export()
var acrPull = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull

@export()
var keyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User

@export()
var keyVaultSecretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7' // Key Vault Secrets Officer

@export()
var storageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Contributor

@export()
var storageBlobDataReader = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1' // Storage Blob Data Reader

@export()
var serviceBusDataSender = '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39' // Azure Service Bus Data Sender

@export()
var serviceBusDataReceiver = '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0' // Azure Service Bus Data Receiver

@export()
var serviceBusDataOwner = '090c5cfd-751d-490a-894a-3ce6f1109419' // Azure Service Bus Data Owner

@export()
var cognitiveServicesOpenAIUser = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User
