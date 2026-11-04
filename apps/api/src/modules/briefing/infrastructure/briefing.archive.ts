import { RestError, type BlobServiceClient } from '@azure/storage-blob';
import { Inject, Injectable } from '@nestjs/common';
import { requireBlob, uploadBlob } from '../../../infrastructure/storage/blob-upload.js';
import { isIsoDate, type IsoDate } from '../../market-data/domain/dates.js';
import { BLOB_SERVICE_CLIENT } from '../../../infrastructure/storage/blob-client.js';
import { sha256Hex } from '../domain/canonical-json.js';

const CONTAINER = 'briefings';

// O blob do briefing não é o que a linha de `briefing` promete (sumiu, ou o conteúdo não tem o SHA-256 dela). Erro alto: a
// decisão nunca segue com um briefing que não é o público (docs/ARENA.md).
export class BriefingIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefingIntegrityError';
  }
}

// O briefing congelado fica no container `briefings` da infra, e o SHA-256 público é o dos bytes exatos que estão lá
// (plano 10). O nome carrega o SHA-256: um briefing diferente nunca sobrescreve o blob de outro, e quem lê a linha de
// `briefing` (pregão, SHA-256, URI) chega ao arquivo cujo conteúdo confere com o hash.
@Injectable()
export class BriefingArchive {
  constructor(
    @Inject(BLOB_SERVICE_CLIENT) private readonly client: BlobServiceClient | undefined,
  ) {}

  // Devolve a URL do blob. O mesmo conteúdo no mesmo nome é o mesmo blob, então repetir é inofensivo.
  async save(date: IsoDate, bytes: Buffer, sha256: string): Promise<string> {
    if (!isIsoDate(date)) throw new RangeError(`Data inválida: ${date}`);
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new RangeError('SHA-256 inválido: esperava 64 hexadecimais');
    }
    if (bytes.length === 0) throw new RangeError('Briefing vazio');
    // O hash que vai para o banco e para a página pública tem de ser o do que foi gravado.
    if (sha256Hex(bytes) !== sha256) {
      throw new Error('O SHA-256 informado não é o dos bytes do briefing');
    }
    return uploadBlob(this.client, CONTAINER, `${date}/${sha256}.json`, bytes, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      metadata: { sha256, date },
    });
  }

  // Lê o briefing que a linha de `briefing` aponta (pregão e SHA-256) e confere o conteúdo contra esse SHA-256. Sumiu ou não
  // bate: BriefingIntegrityError, sem repetir o conteúdo. Erro de acesso sobe como veio.
  async read(date: IsoDate, sha256: string): Promise<Buffer> {
    if (!isIsoDate(date)) throw new RangeError(`Data inválida: ${date}`);
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new RangeError('SHA-256 inválido: esperava 64 hexadecimais');
    }
    const blob = requireBlob(this.client)
      .getContainerClient(CONTAINER)
      .getBlockBlobClient(`${date}/${sha256}.json`);
    let bytes: Buffer;
    try {
      bytes = await blob.downloadToBuffer();
    } catch (error) {
      if (error instanceof RestError && error.statusCode === 404) {
        throw new BriefingIntegrityError(
          `O briefing de ${date} não está no Blob (a linha de briefing aponta para ${sha256})`,
        );
      }
      throw error;
    }
    if (sha256Hex(bytes) !== sha256) {
      throw new BriefingIntegrityError(
        `O conteúdo do briefing de ${date} no Blob não tem o SHA-256 da linha de briefing`,
      );
    }
    return bytes;
  }
}
