import type { Legal, LegalDocumentId } from '@alvesting/contracts';
import { ApiError } from './api';

// Um dos dois textos vigentes. O contrato garante dois documentos, mas não que sejam um de cada: o que faltar é resposta fora do
// contrato (a mesma tela de erro das outras leituras), e não um buraco na página.
export function documentOf(legal: Legal, id: LegalDocumentId): Legal['documents'][number] {
  const doc = legal.documents.find((d) => d.document === id);
  if (!doc) throw new ApiError(502, 'INVALID_RESPONSE');
  return doc;
}
