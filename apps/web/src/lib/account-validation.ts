// Pelo subcaminho, e não pelo índice: este módulo vai ao navegador, e o índice leva o zod junto (packages/contracts/src/account-constants.ts).
import { ACCOUNT_LIMITS } from '@alvesting/contracts/account-constants';

// A conferência que as telas da conta fazem antes de enviar (etapa 11): o erro aparece no campo, ligado a ele, sem uma ida à api.
// Quem manda é a api, que confere tudo de novo (apps/api/src/modules/account/infrastructure/auth.ts); os números vêm do mesmo lugar
// (ACCOUNT_LIMITS). Cada função devolve a frase do erro, ou null quando o valor serve.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  return email.length <= ACCOUNT_LIMITS.emailMax && EMAIL_SHAPE.test(email)
    ? null
    : 'Informe um e-mail válido.';
}

export function validateName(value: string): string | null {
  return value.trim() !== '' && value.length <= ACCOUNT_LIMITS.nameMax && !/\p{Cc}/u.test(value)
    ? null
    : `Informe o seu nome (até ${ACCOUNT_LIMITS.nameMax} caracteres, sem caracteres de controle).`;
}

// A senha que a pessoa está escolhendo (cadastro e redefinição): vale como digitada, o espaço do começo e do fim conta.
export function validateNewPassword(value: string): string | null {
  if (value.length < ACCOUNT_LIMITS.passwordMin) {
    return `A senha precisa ter pelo menos ${ACCOUNT_LIMITS.passwordMin} caracteres.`;
  }
  if (value.length > ACCOUNT_LIMITS.passwordMax) {
    return `A senha pode ter no máximo ${ACCOUNT_LIMITS.passwordMax} caracteres.`;
  }
  return null;
}

// A senha que já existe (entrar): só confere que veio. Uma regra de tamanho aqui trancaria para fora quem tem uma senha antiga.
export const validateSignInPassword = (value: string): string | null =>
  value === '' ? 'Informe a senha.' : null;

// Uma caixa de marcar chega ao FormData como "on" quando marcada, e não chega quando não está.
export const checked = (data: FormData, name: string): boolean => data.has(name);
