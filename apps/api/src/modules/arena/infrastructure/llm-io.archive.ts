import { createHash } from 'node:crypto';
import type { BlobServiceClient } from '@azure/storage-blob';
import { Inject, Injectable } from '@nestjs/common';
import { uploadBlob } from '../../../infrastructure/storage/blob-upload.js';
import { isIsoDate, type IsoDate } from '../../market-data/domain/dates.js';
import { BLOB_SERVICE_CLIENT } from '../../../infrastructure/storage/blob-client.js';

const CONTAINER = 'llm-io';
const KINDS = ['request', 'response', 'meta'] as const;
type Kind = (typeof KINDS)[number];

export interface LlmIoInput {
  date: IsoDate;
  cycleId: string;
  competitorId: string;
  // A requisição SEM o texto do prompt (no lugar dele, a versão e o SHA-256), a resposta crua do provedor (já passada pelo
  // filtro de vazamento) e os metadados (tentativas, itens descartados, parâmetros aplicados).
  request: unknown;
  response: unknown;
  meta: unknown;
}

export interface LlmIoSaved {
  uris: Record<Kind, string>;
  sha256: Record<Kind, string>;
}

// O IO bruto de cada decisão fica no container `llm-io` da infra (plano 5.3 e 5.8): qualquer ciclo é reprocessável e auditável.
// O nome carrega o SHA-256 de cada blob: conteúdo diferente (uma segunda execução da mesma decisão) nunca sobrescreve o de outra,
// e o hash que vai para a linha de `decision` é o dos bytes exatos que estão lá.
// ATENÇÃO: só o job de decisões grava este container, e nada o lê pelo código; o worker-data NÃO tem papel nele (o Blob vai por container,
// docs/INFRA.md, 3.2; ADR 0030). Mesmo assim NADA que chega aqui pode conter o texto do prompt (regra 4 do CLAUDE.md: defesa em profundidade,
// o papel é uma barreira a mais e o teste de canário é a garantia): quem chama passa a requisição com o marcador e a resposta pelo filtro de vazamento.
@Injectable()
export class LlmIoArchive {
  constructor(
    @Inject(BLOB_SERVICE_CLIENT) private readonly client: BlobServiceClient | undefined,
  ) {}

  async save(input: LlmIoInput): Promise<LlmIoSaved> {
    if (!isIsoDate(input.date)) throw new RangeError(`Data inválida: ${input.date}`);
    const uris = {} as Record<Kind, string>;
    const sha256 = {} as Record<Kind, string>;
    for (const kind of KINDS) {
      const data = Buffer.from(JSON.stringify(input[kind]), 'utf8');
      const hash = createHash('sha256').update(data).digest('hex');
      uris[kind] = await uploadBlob(
        this.client,
        CONTAINER,
        `${input.date}/${input.cycleId}/${input.competitorId}/${kind}-${hash}.json`,
        data,
        {
          blobHTTPHeaders: { blobContentType: 'application/json' },
          metadata: { sha256: hash, kind, date: input.date },
        },
      );
      sha256[kind] = hash;
    }
    return { uris, sha256 };
  }
}
