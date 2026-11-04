import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as accountConstantsModule from './account-constants.js';
import {
  ACCOUNT_LIMITS,
  authProvidersSchema,
  consentProofSchema,
  consentStatusSchema,
  deleteAccountBodySchema,
  legalSchema,
  meSchema,
  REAUTH_REQUIRED,
  userExportSchema,
} from './account.js';

// Os contratos da conta (etapa 11, docs/CONTA.md). Tudo é estrito: o que não está aqui não sai pela API, e é isto que impede o
// hash da senha, o token de OAuth, o token de verificação e o token de sessão de chegarem ao JSON de exportação.
const sha = 'a'.repeat(64);
const id = '01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('consentProofSchema (o aceite que o cliente manda)', () => {
  it('aceita as duas versões, e só elas', () => {
    expect(consentProofSchema.safeParse({ terms: '0.1', privacy: '1.12' }).success).toBe(true);
    expect(consentProofSchema.safeParse({ terms: '0.1' }).success).toBe(false);
    expect(consentProofSchema.safeParse({ terms: '0.1', privacy: '0.1', extra: 1 }).success).toBe(
      false,
    );
  });

  it.each([
    ['vazio', ''],
    ['sem ponto', '1'],
    ['com letra', '1.a'],
    ['com espaço', ' 0.1'],
    ['longo demais', '1.1234'],
    ['número, não texto', 0.1],
    ['pré-marcado como true', true],
  ])('recusa a versão %s', (_nome, version) => {
    expect(consentProofSchema.safeParse({ terms: version, privacy: '0.1' }).success).toBe(false);
  });
});

describe('meSchema', () => {
  const consent = {
    upToDate: false,
    documents: [
      {
        document: 'TERMS',
        version: '0.1',
        effectiveDate: '2026-11-02',
        sha256: sha,
        acceptedAt: null,
      },
      {
        document: 'PRIVACY',
        version: '0.1',
        effectiveDate: '2026-11-02',
        sha256: sha,
        acceptedAt: '2026-11-02T12:00:00.000Z',
      },
    ],
  };
  const me = {
    id,
    name: 'Pessoa Teste',
    email: 'a@example.test',
    emailVerified: true,
    role: 'USER',
    consent,
  };

  it('aceita o usuário com o estado do aceite', () => {
    expect(meSchema.safeParse(me).success).toBe(true);
    expect(consentStatusSchema.safeParse(consent).success).toBe(true);
  });

  it.each(['password', 'token', 'accessToken', 'ipAddress'])(
    'recusa o campo %s (nunca sai pela API)',
    (field) => {
      expect(meSchema.safeParse({ ...me, [field]: 'x' }).success).toBe(false);
    },
  );

  it('o papel é USER ou ADMIN', () => {
    expect(meSchema.safeParse({ ...me, role: 'ADMIN' }).success).toBe(true);
    expect(meSchema.safeParse({ ...me, role: 'root' }).success).toBe(false);
  });
});

describe('legalSchema', () => {
  const doc = (document: string) => ({
    document,
    version: '0.1',
    effectiveDate: '2026-11-02',
    title: 'Título',
    sha256: sha,
    text: '# Título',
  });

  it('traz o controlador (ou null em dev) e os dois documentos', () => {
    const body = { controller: null, documents: [doc('TERMS'), doc('PRIVACY')] };
    expect(legalSchema.safeParse(body).success).toBe(true);
    expect(
      legalSchema.safeParse({
        ...body,
        controller: { name: 'Controlador de Teste', contact: 'privacidade@example.test' },
      }).success,
    ).toBe(true);
  });

  it('recusa o hash que não é SHA-256 em hexadecimal minúsculo', () => {
    const body = {
      controller: null,
      documents: [{ ...doc('TERMS'), sha256: 'ABC' }, doc('PRIVACY')],
    };
    expect(legalSchema.safeParse(body).success).toBe(false);
  });
});

describe('userExportSchema (o JSON de LGPD art. 18)', () => {
  const data = {
    exportedAt: '2026-11-02T12:00:00.000Z',
    user: {
      id,
      name: 'Pessoa Teste',
      email: 'a@example.test',
      emailVerified: true,
      image: null,
      role: 'USER',
      createdAt: '2026-11-02T11:00:00.000Z',
      updatedAt: '2026-11-02T11:00:00.000Z',
    },
    accounts: [
      {
        id,
        providerId: 'credential',
        accountId: id,
        createdAt: '2026-11-02T11:00:00.000Z',
        updatedAt: '2026-11-02T11:00:00.000Z',
      },
    ],
    sessions: [
      {
        id,
        createdAt: '2026-11-02T11:00:00.000Z',
        updatedAt: '2026-11-02T11:00:00.000Z',
        expiresAt: '2026-11-09T11:00:00.000Z',
        ipAddress: '',
        userAgent: '',
      },
    ],
    consents: [
      {
        id,
        document: 'TERMS',
        version: '0.1',
        sha256: sha,
        acceptedAt: '2026-11-02T11:00:00.000Z',
      },
    ],
    // a carteira (etapa 12): a linha dela e os lançamentos, com o custo em centavos e a data da compra como data (não instante)
    portfolios: [{ id, createdAt: '2026-11-03T11:00:00.000Z' }],
    portfolioLots: [
      {
        id,
        ticker: 'PETR4',
        quantity: 100,
        costCents: 355_000,
        boughtOn: '2026-10-15',
        createdAt: '2026-11-03T11:00:00.000Z',
        updatedAt: '2026-11-03T11:00:00.000Z',
      },
    ],
  };

  it('aceita o export completo', () => {
    expect(userExportSchema.safeParse(data).success).toBe(true);
  });

  it('a carteira vazia (quem nunca lançou nada) é um export válido', () => {
    expect(userExportSchema.safeParse({ ...data, portfolios: [], portfolioLots: [] }).success).toBe(
      true,
    );
  });

  it('o export sem a carteira é recusado (o JSON de LGPD leva tudo que a conta guarda) e a carteira também é estrita', () => {
    const { portfolios: _p, ...withoutPortfolios } = data;
    const { portfolioLots: _l, ...withoutLots } = data;
    expect(userExportSchema.safeParse(withoutPortfolios).success).toBe(false);
    expect(userExportSchema.safeParse(withoutLots).success).toBe(false);
    const withExtra = (patch: object) => userExportSchema.safeParse({ ...data, ...patch }).success;
    expect(withExtra({ portfolios: [{ ...data.portfolios[0], userId: id }] })).toBe(false);
    expect(withExtra({ portfolioLots: [{ ...data.portfolioLots[0], portfolioId: id }] })).toBe(
      false,
    );
    expect(withExtra({ portfolioLots: [{ ...data.portfolioLots[0], costCents: 2 ** 53 }] })).toBe(
      false,
    );
  });

  // O teste que importa: segredo no export é falha de contrato, não de revisão.
  it.each(['password', 'accessToken', 'refreshToken', 'idToken', 'token'])(
    'recusa %s em qualquer nível do export',
    (field) => {
      const withSecret = (patch: object) =>
        userExportSchema.safeParse({ ...data, ...patch }).success;
      expect(withSecret({ accounts: [{ ...data.accounts[0], [field]: 'segredo' }] })).toBe(false);
      expect(withSecret({ sessions: [{ ...data.sessions[0], [field]: 'segredo' }] })).toBe(false);
      expect(withSecret({ user: { ...data.user, [field]: 'segredo' } })).toBe(false);
      expect(withSecret({ [field]: 'segredo' })).toBe(false);
    },
  );
});

describe('deleteAccountBodySchema', () => {
  it('a senha é opcional e tem teto (o scrypt gasta CPU)', () => {
    expect(deleteAccountBodySchema.safeParse({}).success).toBe(true);
    expect(deleteAccountBodySchema.safeParse({ password: 'x'.repeat(128) }).success).toBe(true);
    expect(deleteAccountBodySchema.safeParse({ password: 'x'.repeat(129) }).success).toBe(false);
    expect(deleteAccountBodySchema.safeParse({ password: '' }).success).toBe(false);
    expect(deleteAccountBodySchema.safeParse({ password: 'x', callbackURL: '/' }).success).toBe(
      false,
    );
  });

  // O Express 5 deixa `req.body` indefinido num DELETE sem corpo, e é assim que um fetch(url, { method: 'DELETE' }) chega.
  it('sem corpo nenhum (indefinido) vale como {}; o que não é objeto continua recusado', () => {
    expect(deleteAccountBodySchema.safeParse(undefined)).toEqual({ success: true, data: {} });
    for (const body of [null, 'texto', 1, []]) {
      expect(deleteAccountBodySchema.safeParse(body).success, String(body)).toBe(false);
    }
  });
});

// GET /api/v1/auth/providers: o que a tela de entrar precisa saber para oferecer (ou não) o login com o Google.
describe('authProvidersSchema', () => {
  it('diz só se o Google está configurado', () => {
    expect(authProvidersSchema.safeParse({ google: true }).success).toBe(true);
    expect(authProvidersSchema.safeParse({ google: false }).success).toBe(true);
  });

  it.each([
    ['sem o campo', {}],
    ['texto, e não booleano', { google: 'true' }],
    ['nulo', { google: null }],
    ['com campo a mais (o client ID não sai)', { google: true, clientId: 'x.apps.example' }],
  ])('recusa %s', (_nome, body) => {
    expect(authProvidersSchema.safeParse(body).success).toBe(false);
  });
});

// Os tetos que a api confere no cadastro e que as telas repetem antes de enviar, e a validade dos links dos e-mails que os textos das telas
// e dos e-mails prometem: um número só, nos dois lados.
describe('ACCOUNT_LIMITS', () => {
  it('senha de 10 a 128 caracteres, nome até 100, e-mail até 254, link de verificação por 60 minutos e de redefinição por 30', () => {
    expect(ACCOUNT_LIMITS).toEqual({
      passwordMin: 10,
      passwordMax: 128,
      nameMax: 100,
      emailMax: 254,
      verificationMinutes: 60,
      passwordResetMinutes: 30,
    });
  });
});

// O site lê os tetos e o código do erro da exclusão pelo subcaminho `@alvesting/contracts/account-constants` nos módulos que vão ao
// navegador. Se o módulo passar a importar algo (o zod, ou os schemas de account.ts), o bundler volta a levar o zod às telas da conta
// (uns 36 KB comprimidos), e o formulário só vale depois de hidratar.
describe('account-constants (o que vai ao navegador)', () => {
  it('mora num módulo sem imports, e o índice reexporta os mesmos valores', async () => {
    const source = await readFile(new URL('./account-constants.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*(import|export)\b[^\n]*\bfrom\b/m);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
    expect(ACCOUNT_LIMITS).toBe(accountConstantsModule.ACCOUNT_LIMITS);
    expect(REAUTH_REQUIRED).toBe(accountConstantsModule.REAUTH_REQUIRED);
  });

  // É o código que a api devolve em DELETE /api/v1/me para a sessão antiga e que a tela entende para pedir a senha (docs/API.md).
  it('o código do erro da exclusão com a sessão antiga é REAUTH_REQUIRED', () => {
    expect(REAUTH_REQUIRED).toBe('REAUTH_REQUIRED');
  });
});
