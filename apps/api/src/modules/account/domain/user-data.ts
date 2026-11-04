// Tudo o que a conta guarda do usuário, e o que o JSON de exportação (GET /api/v1/me/export, LGPD art. 18) leva de cada coisa.
// Os dois invariantes que protegem as conversas (etapa 13) estão em user-data.spec.ts, e a carteira (etapa 12) já está coberta por eles: todo
// modelo do Prisma ligado ao usuário (direta ou indiretamente) apaga em cascata e tem uma entrada aqui. O chat entra nesta tabela com a
// migration dele.

export interface ExportedModel {
  // a chave no JSON de exportação (contracts: userExportSchema)
  key: 'accounts' | 'sessions' | 'consents' | 'portfolios' | 'portfolioLots';
  // o delegate do PrismaClient (o nome do modelo com a primeira letra minúscula)
  delegate: 'account' | 'session' | 'consent' | 'portfolio' | 'portfolioLot';
  // como achar as linhas do dono: sempre pela chave que aponta para ele (a do lançamento passa pela carteira dele), nunca por um id vindo
  // da requisição
  where: (userId: string) => Record<string, unknown>;
  // as colunas que saem
  select: Readonly<Record<string, true>>;
  orderBy: Readonly<Record<string, 'asc' | 'desc'>>;
  // as colunas DATE (dia, sem hora): o Prisma as lê como instante à meia-noite UTC, e no JSON de LGPD saem como `AAAA-MM-DD`, o dia que o
  // dono digitou, e não um horário que lido no fuso de Brasília cairia na véspera
  dateOnly?: readonly string[];
}

// O próprio usuário (a raiz): tudo sai.
export const USER_EXPORT_COLUMNS = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const EXPORTED_MODELS: Readonly<Record<string, ExportedModel>> = {
  Account: {
    key: 'accounts',
    delegate: 'account',
    where: (userId) => ({ userId }),
    select: { id: true, providerId: true, accountId: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
  },
  Session: {
    key: 'sessions',
    delegate: 'session',
    where: (userId) => ({ userId }),
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  Consent: {
    key: 'consents',
    delegate: 'consent',
    where: (userId) => ({ userId }),
    select: { id: true, document: true, version: true, sha256: true, acceptedAt: true },
    orderBy: { acceptedAt: 'asc' },
  },
  // A carteira (etapa 12): a linha dela (uma por usuário) e os lançamentos. O custo sai em centavos inteiros (bigint no banco, número exato no JSON).
  Portfolio: {
    key: 'portfolios',
    delegate: 'portfolio',
    where: (userId) => ({ userId }),
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  PortfolioLot: {
    key: 'portfolioLots',
    delegate: 'portfolioLot',
    where: (userId) => ({ portfolio: { userId } }),
    select: {
      id: true,
      ticker: true,
      quantity: true,
      costCents: true,
      boughtOn: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { id: 'asc' },
    dateOnly: ['boughtOn'],
  },
};

// As colunas que NUNCA saem no export, por modelo, com o motivo. Uma coluna nova de um modelo do usuário precisa cair num dos dois
// lados (EXPORTED_MODELS.select ou aqui): o teste reprova a que ficar sem decisão.
export const NEVER_EXPORTED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Account: {
    password: 'resumo criptográfico (scrypt) da senha: nunca sai, nem como resumo',
    accessToken: 'token de acesso do OAuth: credencial de terceiro (e nem o guardamos)',
    refreshToken: 'token de renovação do OAuth: credencial de terceiro (e nem o guardamos)',
    idToken: 'token de identidade do OAuth: credencial de terceiro (e nem o guardamos)',
    accessTokenExpiresAt: 'validade do token de acesso, que nem guardamos',
    refreshTokenExpiresAt: 'validade do token de renovação, que nem guardamos',
    scope: 'escopo concedido ao token do OAuth, que nem guardamos',
  },
  Session: {
    token: 'a credencial da sessão: quem a tem entra na conta',
  },
};
