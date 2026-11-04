import {
  RestError,
  type BlobServiceClient,
  type BlockBlobUploadOptions,
  type ContainerClient,
} from '@azure/storage-blob';

// O cliente do Blob pode estar desligado (sem STORAGE_CONNECTION_STRING nem STORAGE_BLOB_ENDPOINT): quem o usa falha dizendo
// o que falta.
export function requireBlob(client: BlobServiceClient | undefined): BlobServiceClient {
  if (!client) {
    throw new Error(
      'Blob Storage não configurado: defina STORAGE_CONNECTION_STRING (Azurite) ou STORAGE_BLOB_ENDPOINT (Azure)',
    );
  }
  return client;
}

// Envio de um blob com o que os arquivos guardados pelos workers (briefing, IO bruto das LLMs e backup) precisam: o cliente
// pode estar desligado, e o container pode não existir ainda.
// Na Azure a infra cria os containers e a identidade do worker não tem o direito de criar container; no Azurite ele
// ainda não existe, então cria e tenta de novo. Devolve a URL do blob.
export async function uploadBlob(
  client: BlobServiceClient | undefined,
  containerName: string,
  blobName: string,
  data: Buffer,
  options: BlockBlobUploadOptions,
): Promise<string> {
  const container = requireBlob(client).getContainerClient(containerName);
  const blob = container.getBlockBlobClient(blobName);
  const upload = () => blob.uploadData(data, options);
  try {
    await upload();
  } catch (error) {
    if (!(error instanceof RestError && error.code === 'ContainerNotFound')) throw error;
    await container.createIfNotExists();
    await upload();
  }
  return blob.url;
}

// O container para um envio em FLUXO (o dump do backup-verify): um fluxo já lido não se reenvia, então o container que falta (só no Azurite;
// na Azure a infra o cria e a identidade do worker não pode criá-lo) é conferido ANTES, e não depois do ContainerNotFound como em uploadBlob.
export async function containerFor(
  client: BlobServiceClient | undefined,
  containerName: string,
): Promise<ContainerClient> {
  const container = requireBlob(client).getContainerClient(containerName);
  if (!(await container.exists())) await container.createIfNotExists();
  return container;
}
