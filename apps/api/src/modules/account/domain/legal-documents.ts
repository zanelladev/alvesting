import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LegalDocumentId } from '@alvesting/contracts';

// Os termos de uso e a política de privacidade (etapa 11, plano §12): arquivos .md em ../legal, em português, versionados no
// repositório. Cada um traz no próprio texto o título (`# ...`), a versão (`Versão: 0.1`) e a vigência (`Vigência: dd/mm/aaaa`), e
// por isso os três entram no SHA-256, que é o do texto em UTF-8 com quebra de linha LF. A API serve o texto (GET /api/v1/legal) e
// grava no aceite o documento, a versão e este hash (docs/CONTA.md). Versão nova = texto novo = novo aceite; o teste
// legal-documents.spec.ts congela cada versão para que ninguém mude um texto já aceito sem subir o número.

export interface LegalDocument {
  document: LegalDocumentId;
  version: string;
  // AAAA-MM-DD
  effectiveDate: string;
  title: string;
  sha256: string;
  text: string;
}

// Os arquivos, na ordem em que o site os mostra. O nest build copia **/legal/*.md para o dist (nest-cli.json).
export const LEGAL_FILES: Readonly<Record<LegalDocumentId, string>> = {
  TERMS: 'termos-de-uso.md',
  PRIVACY: 'politica-de-privacidade.md',
};

export function parseLegalDocument(document: LegalDocumentId, raw: string): LegalDocument {
  const text = raw.replace(/\r\n/g, '\n');
  const fail = (why: string): never => {
    throw new Error(`documento legal ${document} inválido: ${why}`);
  };
  if (text.trim() === '') fail('vazio');

  const title = /^# (.+)\n/.exec(text)?.[1]?.trim();
  if (!title) fail('falta o título (`# ...`) na primeira linha');
  const version = /^Versão: (\d{1,3}\.\d{1,3})$/m.exec(text)?.[1];
  if (!version) fail('falta a linha `Versão: N.N`');
  const date = /^Vigência: (\d{2})\/(\d{2})\/(\d{4})$/m.exec(text);
  if (!date) fail('falta a linha `Vigência: dd/mm/aaaa`');
  const [, dd, mm, yyyy] = date!;
  const effectiveDate = `${yyyy}-${mm}-${dd}`;
  // 31/02 não existe: a data volta diferente quando é lida como UTC
  if (new Date(`${effectiveDate}T00:00:00Z`).toISOString().slice(0, 10) !== effectiveDate) {
    fail('a vigência não é uma data');
  }

  return {
    document,
    version: version!,
    effectiveDate,
    title: title!,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    text,
  };
}

// Falta de arquivo ou texto torto impede o boot: servir (e gravar o aceite de) um texto que não existe seria pior que não subir.
export function loadLegalDocuments(
  dir = new URL('../legal/', import.meta.url),
): readonly LegalDocument[] {
  return (Object.entries(LEGAL_FILES) as Array<[LegalDocumentId, string]>).map(([document, file]) =>
    parseLegalDocument(document, readFileSync(new URL(file, dir), 'utf8')),
  );
}
