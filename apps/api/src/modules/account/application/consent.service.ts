import { Inject, Injectable } from '@nestjs/common';
import { consentProofSchema, type ConsentProof, type ConsentStatus } from '@alvesting/contracts';
import { newId } from '../../../common/id.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { LEGAL_DOCUMENTS } from '../account.tokens.js';
import type { LegalDocument } from '../domain/legal-documents.js';

// O aceite dos termos de uso e da política de privacidade (plano §12, etapa 11). O cadastro só nasce com as versões vigentes
// aceitas de forma explícita; cada aceite grava o documento, a versão, o SHA-256 do texto e a data num histórico que não se reescreve
// (o gatilho do banco recusa UPDATE). Versão nova de um documento muda o estado de todo mundo para "pendente" até um aceite novo.
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    // a lista de documentos vigentes (LEGAL_DOCUMENTS): os testes a trocam para simular um texto novo
    @Inject(LEGAL_DOCUMENTS) private readonly docs: readonly LegalDocument[],
  ) {}

  current(): readonly LegalDocument[] {
    return this.docs;
  }

  // O que o cliente mandou é exatamente as versões vigentes dos dois documentos? Nada de "pré-marcado": o corpo precisa citar as duas.
  isCurrent(proof: unknown): proof is ConsentProof {
    const parsed = consentProofSchema.safeParse(proof);
    if (!parsed.success) return false;
    const version = (id: LegalDocument['document']) =>
      this.docs.find((d) => d.document === id)?.version;
    return parsed.data.terms === version('TERMS') && parsed.data.privacy === version('PRIVACY');
  }

  // Grava o aceite das versões vigentes (quem chama já conferiu o que o cliente mandou com isCurrent). Idempotente: a mesma versão
  // aceita duas vezes é uma linha só (a chave única é usuário, documento e versão).
  async record(userId: string): Promise<void> {
    await this.prisma.consent.createMany({
      data: this.docs.map((doc) => ({
        id: newId(),
        userId,
        document: doc.document,
        version: doc.version,
        sha256: doc.sha256,
      })),
      skipDuplicates: true,
    });
  }

  async state(userId: string): Promise<ConsentStatus> {
    const accepted = await this.prisma.consent.findMany({
      where: { userId, OR: this.docs.map((d) => ({ document: d.document, version: d.version })) },
      select: { document: true, version: true, acceptedAt: true },
    });
    const documents = this.docs.map((doc) => {
      const row = accepted.find((a) => a.document === doc.document && a.version === doc.version);
      return {
        document: doc.document,
        version: doc.version,
        effectiveDate: doc.effectiveDate,
        sha256: doc.sha256,
        acceptedAt: row ? row.acceptedAt.toISOString() : null,
      };
    });
    return { upToDate: documents.every((d) => d.acceptedAt !== null), documents };
  }
}
