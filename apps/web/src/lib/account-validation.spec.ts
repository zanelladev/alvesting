import { ACCOUNT_LIMITS } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import {
  checked,
  validateEmail,
  validateName,
  validateNewPassword,
  validateSignInPassword,
} from './account-validation';

// A conferência que as telas fazem antes de enviar (UX: o erro aparece no campo, sem uma ida à api). Quem manda é a api: estas regras
// repetem as dela (ACCOUNT_LIMITS, do pacote de contratos), e a api continua conferindo tudo.
describe('validateEmail', () => {
  it.each(['pessoa@example.test', 'a.b+c@sub.example.test', ' pessoa@example.test '])(
    'aceita %j',
    (value) => {
      expect(validateEmail(value)).toBeNull();
    },
  );

  it.each([
    ['vazio', ''],
    ['só espaço', '   '],
    ['sem arroba', 'pessoa.example.test'],
    ['sem domínio', 'pessoa@'],
    ['sem ponto no domínio', 'pessoa@example'],
    ['com espaço no meio', 'pes soa@example.test'],
    ['duas arrobas', 'a@b@example.test'],
    ['comprido demais', `${'a'.repeat(ACCOUNT_LIMITS.emailMax)}@example.test`],
  ])('recusa e-mail %s', (_nome, value) => {
    expect(validateEmail(value)).toBe('Informe um e-mail válido.');
  });

  it('o limite é o da api: 254 caracteres passam, 255 não', () => {
    const domain = '@example.test';
    expect(validateEmail('a'.repeat(ACCOUNT_LIMITS.emailMax - domain.length) + domain)).toBeNull();
    expect(
      validateEmail('a'.repeat(ACCOUNT_LIMITS.emailMax - domain.length + 1) + domain),
    ).not.toBeNull();
  });
});

describe('validateName', () => {
  it.each(['Ana', 'José da Silva', 'Pessoa do e2e', 'あ'.repeat(ACCOUNT_LIMITS.nameMax)])(
    'aceita %j',
    (value) => {
      expect(validateName(value)).toBeNull();
    },
  );

  it.each([
    ['vazio', ''],
    ['só espaço', '    '],
    ['com caractere de controle', 'Ana\u0007'],
    ['com NUL', 'Ana\u0000'],
    ['com quebra de linha', 'Ana\nSilva'],
    ['comprido demais', 'a'.repeat(ACCOUNT_LIMITS.nameMax + 1)],
  ])('recusa nome %s', (_nome, value) => {
    expect(validateName(value)).toMatch(/^Informe o seu nome/);
  });
});

describe('validateNewPassword (a senha que a pessoa está escolhendo)', () => {
  it('10 a 128 caracteres', () => {
    expect(validateNewPassword('x'.repeat(ACCOUNT_LIMITS.passwordMin))).toBeNull();
    expect(validateNewPassword('x'.repeat(ACCOUNT_LIMITS.passwordMax))).toBeNull();
    expect(validateNewPassword('x'.repeat(ACCOUNT_LIMITS.passwordMin - 1))).toBe(
      'A senha precisa ter pelo menos 10 caracteres.',
    );
    expect(validateNewPassword('x'.repeat(ACCOUNT_LIMITS.passwordMax + 1))).toBe(
      'A senha pode ter no máximo 128 caracteres.',
    );
    expect(validateNewPassword('')).toBe('A senha precisa ter pelo menos 10 caracteres.');
  });

  it('a senha vale como foi digitada: o espaço no começo e no fim conta', () => {
    expect(validateNewPassword(`${' '.repeat(5)}abcde${' '.repeat(5)}`)).toBeNull();
  });
});

describe('validateSignInPassword (a senha que já existe: só confere se veio)', () => {
  it('pede a senha e não repete a regra do cadastro (senha antiga pode ser mais curta)', () => {
    expect(validateSignInPassword('')).toBe('Informe a senha.');
    expect(validateSignInPassword('curta')).toBeNull();
  });
});

describe('checked (caixa de marcar)', () => {
  it('uma caixa marcada chega ao FormData como "on"; desmarcada não chega', () => {
    const data = new FormData();
    data.set('terms', 'on');
    expect(checked(data, 'terms')).toBe(true);
    expect(checked(data, 'privacy')).toBe(false);
  });
});
