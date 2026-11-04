import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import type { Env } from '../../config/env.js';

export const BLOB_SERVICE_CLIENT = Symbol('BLOB_SERVICE_CLIENT');

// Azurite e CI entram por connection string; a Azure, pelo endereço da conta com a identidade gerenciada
// (a conta não tem chave: allowSharedKeyAccess=false, docs/INFRA.md). Sem nenhum dos dois o Blob fica desligado
// e quem o usar falha com mensagem clara (requireBlob, em blob-upload.ts).
export function createBlobServiceClient(
  env: Pick<Env, 'STORAGE_CONNECTION_STRING' | 'STORAGE_BLOB_ENDPOINT'>,
): BlobServiceClient | undefined {
  if (env.STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(env.STORAGE_CONNECTION_STRING);
  }
  if (env.STORAGE_BLOB_ENDPOINT) {
    return new BlobServiceClient(env.STORAGE_BLOB_ENDPOINT, new DefaultAzureCredential());
  }
  return undefined;
}
