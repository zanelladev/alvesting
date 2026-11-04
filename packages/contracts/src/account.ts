import { z } from 'zod';
import { ulidSchema } from './messages.js';
import { lotSchema } from './portfolio.js';

// A conta (plano §9 e §12, etapa 11; docs/CONTA.md): o que o site e o dono da conta veem de /api/v1/me, /api/v1/legal e do JSON de
// exportação. Tudo é estrito de propósito, como no contrato público: campo que não está aqui não sai. É este contrato que
// garante que o hash da senha, o token de OAuth, o token de verificação e o token de sessão nunca chegam ao export.

// Os tetos do cadastro, a validade dos links dos e-mails e o código REAUTH_REQUIRED moram em account-constants.ts, um módulo sem imports
// (o site o lê pelo subcaminho, sem levar o zod ao navegador). Aqui só se reexportam, para a api seguir importando do índice.
export { ACCOUNT_LIMITS, REAUTH_REQUIRED } from './account-constants.js';

// --- o que a tela de entrar precisa saber --------------------------------------------------------------------------------
// GET /api/v1/auth/providers (público, sem cache): o login com o Google só existe com o ID e o segredo do cliente OAuth na api. A tela
// oferece o botão só quando ele existe. Nem o client ID sai: só se está ligado ou não.
export const authProvidersSchema = z.strictObject({ google: z.boolean() });
export type AuthProviders = z.infer<typeof authProvidersSchema>;

// --- termos de uso e política de privacidade -----------------------------------------------------------------------------
export const LEGAL_DOCUMENT_IDS = ['TERMS', 'PRIVACY'] as const;
export const legalDocumentIdSchema = z.enum(LEGAL_DOCUMENT_IDS);
export type LegalDocumentId = z.infer<typeof legalDocumentIdSchema>;

// A versão de um documento: "0.1" (rascunho) ou "1.0". Maior.menor, sem espaço nem letra.
const versionSchema = z.string().regex(/^\d{1,3}\.\d{1,3}$/);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const isoDateTime = z.iso.datetime();

// O aceite que o cliente manda no cadastro e em POST /me/consents: as versões que ele mostrou ao usuário. Nada vem pré-marcado: a
// API só aceita se as duas forem exatamente as vigentes.
export const consentProofSchema = z.strictObject({ terms: versionSchema, privacy: versionSchema });
export type ConsentProof = z.infer<typeof consentProofSchema>;

export const legalDocumentSchema = z.strictObject({
  document: legalDocumentIdSchema,
  version: versionSchema,
  effectiveDate: z.iso.date(),
  title: z.string().min(1),
  sha256: sha256Schema,
  text: z.string().min(1),
});

// GET /api/v1/legal: o texto vigente e quem é o controlador (vem da configuração; null só fora de produção, onde a variável é opcional).
export const legalSchema = z.strictObject({
  controller: z
    .strictObject({ name: z.string().min(1).max(200), contact: z.email().max(254) })
    .nullable(),
  documents: z.array(legalDocumentSchema).length(LEGAL_DOCUMENT_IDS.length),
});
export type Legal = z.infer<typeof legalSchema>;

// --- /me -----------------------------------------------------------------------------------------------------------------
export const userRoleSchema = z.enum(['USER', 'ADMIN']);

// O estado do aceite: uma linha por documento vigente, com a data em que ESTE usuário aceitou ESSA versão (null = falta aceitar).
export const consentStatusSchema = z.strictObject({
  upToDate: z.boolean(),
  documents: z.array(
    z.strictObject({
      document: legalDocumentIdSchema,
      version: versionSchema,
      effectiveDate: z.iso.date(),
      sha256: sha256Schema,
      acceptedAt: isoDateTime.nullable(),
    }),
  ),
});
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

// GET /api/v1/me: os dados mínimos e o estado do aceite.
export const meSchema = z.strictObject({
  id: ulidSchema,
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  role: userRoleSchema,
  consent: consentStatusSchema,
});
export type Me = z.infer<typeof meSchema>;

// DELETE /api/v1/me: a senha só é pedida quando a sessão não é recente (conta só com Google não tem senha: precisa entrar de novo).
// Sem corpo nenhum (um DELETE puro do navegador) vale como {}: o Express 5 deixa `req.body` indefinido nesse caso.
export const deleteAccountBodySchema = z.preprocess(
  (body) => (body === undefined ? {} : body),
  z.strictObject({ password: z.string().min(1).max(128).optional() }),
);

// --- exportação (LGPD art. 18, II e V) -----------------------------------------------------------------------------------
// Tudo o que guardamos do dono, menos o segredo: sem hash de senha, token de OAuth, token de verificação nem token de sessão.
// Modelo novo ligado ao usuário (conversas) entra aqui junto com a migration: o teste de invariantes do schema reprova
// o esquecimento (apps/api/src/modules/account/domain/user-data.spec.ts). A carteira (etapa 12) entra com as duas tabelas dela: a linha da
// carteira e os lançamentos (os mesmos campos que o dono vê em GET /me/portfolio; a data da compra sai como data, e o custo, em centavos).
export const userExportSchema = z.strictObject({
  exportedAt: isoDateTime,
  user: z.strictObject({
    id: ulidSchema,
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    role: userRoleSchema,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  }),
  accounts: z.array(
    z.strictObject({
      id: ulidSchema,
      providerId: z.string(),
      accountId: z.string(),
      createdAt: isoDateTime,
      updatedAt: isoDateTime,
    }),
  ),
  sessions: z.array(
    z.strictObject({
      id: ulidSchema,
      createdAt: isoDateTime,
      updatedAt: isoDateTime,
      expiresAt: isoDateTime,
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
    }),
  ),
  consents: z.array(
    z.strictObject({
      id: ulidSchema,
      document: legalDocumentIdSchema,
      version: versionSchema,
      sha256: sha256Schema,
      acceptedAt: isoDateTime,
    }),
  ),
  portfolios: z.array(z.strictObject({ id: ulidSchema, createdAt: isoDateTime })),
  portfolioLots: z.array(lotSchema),
});
export type UserExport = z.infer<typeof userExportSchema>;
