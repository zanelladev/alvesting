import { createHash } from 'node:crypto';
import { BlobServiceClient, type BlobServiceClient as BlobClient } from '@azure/storage-blob';
import { describe, expect, it, vi } from 'vitest';
import { newId } from '../../../common/id.js';
import { LlmIoArchive } from './llm-io.archive.js';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const input = {
  date: '2026-11-03',
  cycleId: newId(),
  competitorId: newId(),
  request: { model: 'fake/a', messages: [{ role: 'system', content: '[prompt-arena v1]' }] },
  response: { id: 'fake-1', choices: [{ message: { content: '{"summary":"ok"}' } }] },
  meta: { attempts: 1, dropped: [] },
};

function fakeClient() {
  const uploads: Array<{ container: string; name: string; data: Buffer; options: unknown }> = [];
  const getContainerClient = vi.fn((container: string) => ({
    getBlockBlobClient: (name: string) => ({
      url: `https://stalvesting.blob.core.windows.net/${container}/${name}`,
      uploadData: (data: Buffer, options: unknown) => {
        uploads.push({ container, name, data, options });
        return Promise.resolve({});
      },
    }),
  }));
  return { client: { getContainerClient } as unknown as BlobClient, uploads };
}

describe('LlmIoArchive: o IO bruto de uma decisão no container llm-io', () => {
  it('grava a requisição, a resposta crua e os metadados em três blobs, com o SHA-256 de cada um', async () => {
    const fake = fakeClient();
    const saved = await new LlmIoArchive(fake.client).save(input);

    expect(fake.uploads.map((u) => u.container)).toEqual(['llm-io', 'llm-io', 'llm-io']);
    const byKind: Record<string, (typeof fake.uploads)[number]> = Object.fromEntries(
      fake.uploads.map((u) => [u.name.split('/').pop()!.split('-')[0]!, u]),
    );
    expect(Object.keys(byKind).sort()).toEqual(['meta', 'request', 'response']);

    for (const [kind, value] of [
      ['request', input.request],
      ['response', input.response],
      ['meta', input.meta],
    ] as const) {
      const text = JSON.stringify(value);
      expect(byKind[kind]!.data.toString('utf8')).toBe(text);
      expect(saved.sha256[kind]).toBe(sha(text));
      expect(byKind[kind]!.name).toBe(
        `2026-11-03/${input.cycleId}/${input.competitorId}/${kind}-${sha(text)}.json`,
      );
      expect(saved.uris[kind]).toBe(
        `https://stalvesting.blob.core.windows.net/llm-io/${byKind[kind]!.name}`,
      );
      expect(byKind[kind]!.options).toEqual({
        blobHTTPHeaders: { blobContentType: 'application/json' },
        metadata: { sha256: sha(text), kind, date: '2026-11-03' },
      });
    }
  });

  it('o nome carrega o SHA-256: conteúdo diferente da mesma decisão nunca sobrescreve o blob de outro', async () => {
    const fake = fakeClient();
    const archive = new LlmIoArchive(fake.client);
    await archive.save(input);
    await archive.save({ ...input, response: { id: 'outra' } });
    const responses = fake.uploads.filter((u) => u.name.includes('/response-')).map((u) => u.name);
    expect(new Set(responses).size).toBe(2);
  });

  it('recusa data inválida, e sem Blob configurado diz o que falta', async () => {
    await expect(
      new LlmIoArchive(fakeClient().client).save({ ...input, date: '2026-02-30' }),
    ).rejects.toThrow(RangeError);
    await expect(new LlmIoArchive(undefined).save(input)).rejects.toThrow(
      /STORAGE_CONNECTION_STRING.*STORAGE_BLOB_ENDPOINT/,
    );
  });
});

// Integração com o Azurite (docker compose up -d azurite). Sem STORAGE_CONNECTION_STRING aparece como pulado.
const connectionString = process.env.STORAGE_CONNECTION_STRING;
describe.skipIf(!connectionString)(
  connectionString
    ? 'LlmIoArchive com o Azurite (Blob)'
    : 'LlmIoArchive com o Azurite (Blob) [pulado: defina STORAGE_CONNECTION_STRING com o Azurite no ar, ver .env.example]',
  () => {
    it('cria o container llm-io se faltar (só no Azurite) e lê de volta os mesmos bytes', async () => {
      const client = BlobServiceClient.fromConnectionString(connectionString!);
      const cycleId = newId();
      const saved = await new LlmIoArchive(client).save({ ...input, cycleId });
      for (const kind of ['request', 'response', 'meta'] as const) {
        // no Azurite a URL leva o nome da conta antes do container; o nome do blob é o que vem depois de /llm-io/
        const name = saved.uris[kind].split('/llm-io/')[1]!;
        const blob = client.getContainerClient('llm-io').getBlockBlobClient(name);
        const bytes = await blob.downloadToBuffer();
        expect(sha(bytes.toString('utf8'))).toBe(saved.sha256[kind]);
        await blob.delete();
      }
    }, 30_000);
  },
);
