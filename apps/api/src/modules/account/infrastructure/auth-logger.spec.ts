import { describe, expect, it, vi } from 'vitest';
import { redactPii } from '../../../common/redact.js';
import { createAuthLogger } from './auth-logger.js';

// LGPD nos logs (etapa 11): nunca e-mail, nome, IP, cookie ou token no log; quando precisar identificar, só o ULID do usuário. O
// logger do Better Auth recebe `(nível, mensagem, ...argumentos)`, e os argumentos costumam ser objetos de erro, de usuário ou de
// requisição: aqui só a mensagem (limpa) e o nome do erro passam.
const SECRETS = [
  'pessoa@example.test',
  '203.0.113.77',
  '2001:db8:85a3::8a2e:370:7334',
  'TOKEN-DE-REDEFINICAO-0123456789abcdefghijklmnop',
  'session_token=abc123def456',
  'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.assinatura-do-jwt',
];

describe('redactPii', () => {
  it.each([
    ['e-mail', 'falhou para pessoa@example.test agora', 'falhou para [e-mail] agora'],
    ['IPv4', 'de 203.0.113.77 veio', 'de [ip] veio'],
    ['IPv6', 'de 2001:db8:85a3::8a2e:370:7334 veio', 'de [ip] veio'],
    [
      'query string de URL (token, code, state)',
      'GET https://alvesting.example.test/api/auth/verify-email?token=XYZ123&callbackURL=/ falhou',
      'GET https://alvesting.example.test/api/auth/verify-email falhou',
    ],
    [
      'token longo solto',
      'valor TOKEN-DE-REDEFINICAO-0123456789abcdefghijklmnop vencido',
      'valor [token] vencido',
    ],
    ['cookie', 'Cookie: alvesting.session_token=abc123def456; outro=1', 'Cookie: [cookie]'],
    [
      'os argumentos que o Prisma despeja no erro de validação (levam o nome e o e-mail digitados)',
      "Invalid `prisma.user.create()` invocation:\n\n{\n  data: {\n    name: 'Fulano de Tal',\n    email: 123\n  }\n}\n\nArgument `email`: Invalid value",
      'Invalid `prisma.user.create()` invocation: [omitido]',
    ],
    [
      'JWT',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.assinatura-do-jwt vencido',
      '[token] vencido',
    ],
  ])('tira %s', (_nome, input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it('deixa passar o que não é dado pessoal (o ULID de quem executou fica: é o identificador permitido)', () => {
    const line = 'usuário 01JABCDEFGHJKMNPQRSTVWXYZ0 excluiu a conta em /api/v1/me';
    expect(redactPii(line)).toBe(line);
  });

  it('o caminho da redefinição de senha leva o token no segmento: vira :token', () => {
    expect(redactPii('GET /api/auth/reset-password/Ab3dEf6hIj9lMn2pQr5tUv8xYz0123456789 400')).toBe(
      'GET /api/auth/reset-password/:token 400',
    );
  });
});

describe('createAuthLogger (o logger do Better Auth)', () => {
  it('só deixa passar a mensagem limpa, e o argumento que é erro entra pelo nome e pelo código', () => {
    const sink = vi.fn();
    const logger = createAuthLogger(sink);
    const boom = Object.assign(new Error('violação para pessoa@example.test'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    logger.log('error', 'Failed to create user pessoa@example.test', boom, {
      email: 'pessoa@example.test',
      ip: '203.0.113.77',
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const [level, line] = sink.mock.calls[0]! as [string, string];
    expect(level).toBe('error');
    expect(line).toContain('Failed to create user [e-mail]');
    expect(line).toContain('PrismaClientKnownRequestError');
    expect(line).toContain('P2002');
    for (const secret of SECRETS) expect(line).not.toContain(secret);
    expect(line).not.toContain('violação');
    expect(line).not.toContain('{');
  });

  it('nunca registra argumento que não é erro (objeto de usuário, de requisição, texto)', () => {
    const sink = vi.fn();
    createAuthLogger(sink).log(
      'warn',
      'aviso',
      { user: { email: SECRETS[0] } },
      SECRETS[3],
      SECRETS[1],
    );
    const line = (sink.mock.calls[0] as [string, string])[1];
    for (const secret of SECRETS) expect(line).not.toContain(secret);
  });

  it('os níveis abaixo de warn não saem (info e debug do Better Auth são ruído e risco)', () => {
    const sink = vi.fn();
    const logger = createAuthLogger(sink);
    expect(logger.level).toBe('warn');
    logger.log('info', 'x');
    logger.log('debug', 'x');
    expect(sink).not.toHaveBeenCalled();
    logger.log('warn', 'x');
    logger.log('error', 'x');
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('desliga as cores e não é "disabled": o erro de verdade precisa chegar ao log', () => {
    const logger = createAuthLogger(vi.fn());
    expect(logger.disableColors).toBe(true);
    expect(logger.disabled).toBe(false);
  });
});
