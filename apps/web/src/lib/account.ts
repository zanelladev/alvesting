import {
  authProvidersSchema,
  legalSchema,
  meSchema,
  type AuthProviders,
  type Legal,
  type Me,
} from '@alvesting/contracts';
import { ApiError, apiGetFresh, type ApiDeps } from './api';

// As leituras do servidor para as telas da conta (etapa 11, parte 2; docs/CONTA.md, seção 9). Todas passam por `apiGetFresh`: nunca pelo
// cache de dados do Next, sem tags. A página que lê dado do usuário lê o cookie da requisição (`headers()` ou `cookies()`), o que a faz
// dinâmica, e o Next responde a ela com `Cache-Control: private, no-store`.

// O cookie da sessão do Better Auth: o `cookiePrefix: 'alvesting'` da api, que em produção (https) vira `__Secure-alvesting.`. A api
// aceita só estes.
const AUTH_COOKIE = /^(?:__Secure-)?alvesting\./;

// O que o navegador mandou em `Cookie`, filtrado: à api vão só os cookies do Better Auth, nunca os de outros scripts (um rastreador de
// terceiros, por exemplo) e como vieram (a assinatura é base64 codificada: decodificar e codificar de novo mudaria o valor).
export function authCookieHeader(raw: string | null | undefined): string | undefined {
  const pairs = (raw ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes('=') && AUTH_COOKIE.test(pair.slice(0, pair.indexOf('='))));
  return pairs.length > 0 ? pairs.join('; ') : undefined;
}

// Quem é a pessoa da sessão. Sem cookie, ou com a sessão que a api não reconhece (vencida, adulterada, usuário apagado: 401), ninguém: a
// página manda para a entrada. Qualquer outro erro (a trava de origem, 5xx, a rede) sobe e vira a tela de "a arena não respondeu".
export async function readMe(cookie: string | undefined, deps: ApiDeps = {}): Promise<Me | null> {
  if (!cookie) return null;
  try {
    return await apiGetFresh('/me', meSchema, { cookie }, deps);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

// Os termos e a privacidade vigentes. Sem cache de propósito: o aceite grava a versão que a pessoa viu, e um texto velho em cache a faria
// aceitar uma versão que a api já recusa (409).
export const readLegal = (deps: ApiDeps = {}): Promise<Legal> =>
  apiGetFresh('/legal', legalSchema, {}, deps);

// Quais logins a api oferece. O botão do Google só existe com ela configurada.
export const readProviders = (deps: ApiDeps = {}): Promise<AuthProviders> =>
  apiGetFresh('/auth/providers', authProvidersSchema, {}, deps);
