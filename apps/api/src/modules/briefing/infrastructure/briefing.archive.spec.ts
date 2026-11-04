import { createHash } from 'node:crypto';
import { RestError, type BlobServiceClient } from '@azure/storage-blob';
import { describe, expect, it, vi } from 'vitest';
import { BriefingArchive, BriefingIntegrityError } from './briefing.archive.js';

const bytes = Buffer.from('{"date":"2026-10-30"}');
const sha = createHash('sha256').update(bytes).digest('hex');
const URL_OF = (name: string) => `https://stalvesting.blob.core.windows.net/briefings/${name}`;

function fakeClient(options: { uploadErrors?: Error[] } = {}) {
  const errors = [...(options.uploadErrors ?? [])];
  const uploadData = vi.fn((_data: Buffer, _options: unknown) => {
    const error = errors.shift();
    return error ? Promise.reject(error) : Promise.resolve({});
  });
  const createIfNotExists = vi.fn(() => Promise.resolve({}));
  const getBlockBlobClient = vi.fn((name: string) => ({ uploadData, url: URL_OF(name) }));
  const getContainerClient = vi.fn((_name: string) => ({ createIfNotExists, getBlockBlobClient }));
  return {
    client: { getContainerClient } as unknown as BlobServiceClient,
    getContainerClient,
    createIfNotExists,
    getBlockBlobClient,
    uploadData,
  };
}

const containerNotFound = () =>
  new RestError('The specified container does not exist.', {
    code: 'ContainerNotFound',
    statusCode: 404,
  });

describe('BriefingArchive.save', () => {
  it('guarda os bytes exatos no container briefings, com nome pelo conteúdo, e devolve a URL', async () => {
    const fake = fakeClient();
    const uri = await new BriefingArchive(fake.client).save('2026-10-30', bytes, sha);

    expect(uri).toBe(URL_OF(`2026-10-30/${sha}.json`));
    expect(fake.getContainerClient).toHaveBeenCalledWith('briefings');
    expect(fake.getBlockBlobClient).toHaveBeenCalledWith(`2026-10-30/${sha}.json`);
    expect(fake.createIfNotExists).not.toHaveBeenCalled(); // o container é da infra
    expect(fake.uploadData).toHaveBeenCalledTimes(1);
    const [data, options] = fake.uploadData.mock.calls[0]!;
    expect(data).toBe(bytes);
    expect(options).toEqual({
      blobHTTPHeaders: { blobContentType: 'application/json' },
      metadata: { sha256: sha, date: '2026-10-30' },
    });
  });

  it('o nome carrega o SHA-256: conteúdo diferente nunca sobrescreve o blob de um briefing já registrado', async () => {
    const fake = fakeClient();
    const other = Buffer.from('{"date":"2026-10-30","x":1}');
    const otherSha = createHash('sha256').update(other).digest('hex');
    const archive = new BriefingArchive(fake.client);
    await archive.save('2026-10-30', bytes, sha);
    await archive.save('2026-10-30', other, otherSha);
    const names = fake.getBlockBlobClient.mock.calls.map(([name]) => name);
    expect(new Set(names).size).toBe(2);
  });

  it('recusa SHA-256 que não é o dos bytes: o hash público tem de ser o do que está no Blob', async () => {
    const fake = fakeClient();
    await expect(
      new BriefingArchive(fake.client).save('2026-10-30', bytes, 'ab'.repeat(32)),
    ).rejects.toThrow(/não é o dos bytes/);
    expect(fake.uploadData).not.toHaveBeenCalled();
  });

  it('recusa data inválida, SHA-256 mal formado e conteúdo vazio', async () => {
    const archive = new BriefingArchive(fakeClient().client);
    await expect(archive.save('2026-02-30', bytes, sha)).rejects.toThrow(RangeError);
    await expect(archive.save('2026-10-30', bytes, 'xyz')).rejects.toThrow(/SHA-256/);
    await expect(archive.save('2026-10-30', Buffer.alloc(0), sha)).rejects.toThrow();
  });

  it('sem Blob configurado, falha dizendo quais variáveis faltam', async () => {
    await expect(new BriefingArchive(undefined).save('2026-10-30', bytes, sha)).rejects.toThrow(
      /STORAGE_CONNECTION_STRING.*STORAGE_BLOB_ENDPOINT/,
    );
  });

  it('container que não existe (Azurite novo): cria e guarda na segunda tentativa', async () => {
    const fake = fakeClient({ uploadErrors: [containerNotFound()] });
    await expect(new BriefingArchive(fake.client).save('2026-10-30', bytes, sha)).resolves.toBe(
      URL_OF(`2026-10-30/${sha}.json`),
    );
    expect(fake.createIfNotExists).toHaveBeenCalledTimes(1);
    expect(fake.uploadData).toHaveBeenCalledTimes(2);
  });

  it('erro do Blob sobe, para o freeze não dar o briefing por guardado', async () => {
    const fake = fakeClient({ uploadErrors: [new Error('403 sem permissão')] });
    await expect(new BriefingArchive(fake.client).save('2026-10-30', bytes, sha)).rejects.toThrow(
      /403/,
    );
  });
});

// A decisão (etapa 6) lê o briefing de volta e confere o SHA-256 com a linha de `briefing`: divergência é erro alto.
describe('BriefingArchive.read', () => {
  function readClient(download: () => Promise<Buffer>) {
    const downloadToBuffer = vi.fn(download);
    const getBlockBlobClient = vi.fn((_name: string) => ({ downloadToBuffer }));
    const getContainerClient = vi.fn((_name: string) => ({ getBlockBlobClient }));
    return {
      client: { getContainerClient } as unknown as BlobServiceClient,
      getContainerClient,
      getBlockBlobClient,
    };
  }

  it('lê o blob pelo mesmo nome que o save usa e devolve os bytes quando o hash confere', async () => {
    const fake = readClient(() => Promise.resolve(bytes));
    const read = await new BriefingArchive(fake.client).read('2026-10-30', sha);
    expect(read.equals(bytes)).toBe(true);
    expect(fake.getContainerClient).toHaveBeenCalledWith('briefings');
    expect(fake.getBlockBlobClient).toHaveBeenCalledWith(`2026-10-30/${sha}.json`);
  });

  it('o conteúdo do blob não bate com o SHA-256 da linha: erro alto, e os bytes não saem', async () => {
    const fake = readClient(() =>
      Promise.resolve(Buffer.from('{"date":"2026-10-30","adulterado":1}')),
    );
    const error = await new BriefingArchive(fake.client)
      .read('2026-10-30', sha)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BriefingIntegrityError);
    expect((error as Error).message).toMatch(/SHA-256/);
    expect((error as Error).message).not.toContain('adulterado');
  });

  it('blob que não existe também é erro de integridade (a linha de briefing aponta para um arquivo que sumiu)', async () => {
    const fake = readClient(() =>
      Promise.reject(
        new RestError('The specified blob does not exist.', {
          code: 'BlobNotFound',
          statusCode: 404,
        }),
      ),
    );
    await expect(new BriefingArchive(fake.client).read('2026-10-30', sha)).rejects.toBeInstanceOf(
      BriefingIntegrityError,
    );
  });

  it('erro de acesso (403) sobe como veio: não é o arquivo que está errado', async () => {
    const fake = readClient(() => Promise.reject(new Error('403 sem permissão')));
    await expect(new BriefingArchive(fake.client).read('2026-10-30', sha)).rejects.toThrow(/403/);
  });

  it('recusa data inválida e SHA-256 mal formado, e sem Blob configurado diz o que falta', async () => {
    const archive = new BriefingArchive(readClient(() => Promise.resolve(bytes)).client);
    await expect(archive.read('2026-02-30', sha)).rejects.toThrow(RangeError);
    await expect(archive.read('2026-10-30', 'xyz')).rejects.toThrow(/SHA-256/);
    await expect(new BriefingArchive(undefined).read('2026-10-30', sha)).rejects.toThrow(
      /STORAGE_CONNECTION_STRING.*STORAGE_BLOB_ENDPOINT/,
    );
  });
});
