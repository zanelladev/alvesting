import type { ConsentProof } from '@alvesting/contracts';
// Pelo subcaminho, e não pelo índice: este módulo vai ao navegador, e o índice leva o zod junto (packages/contracts/src/account-constants.ts).
import { ACCOUNT_LIMITS } from '@alvesting/contracts/account-constants';

// O que o navegador faz ao falar com a api da conta (etapa 11, parte 2; docs/CONTA.md). Sempre na mesma origem: na Azure o Front Door
// manda `/api/*` para a api e o resto para o site, e em dev o `rewrites` do next.config.ts faz o mesmo. Por isso o cookie da sessão
// (HttpOnly, SameSite=Lax) e o `Origin` que a api confere chegam sozinhos. As respostas do Better Auth (`/api/auth/*`) e as rotas
// `/api/v1/me*` têm formatos diferentes ({ code } e o envelope { error: { code } }): a leitura aceita os dois.

export interface Reply {
  ok: boolean;
  // 0 = a requisição nem chegou (rede)
  status: number;
  code?: string;
  // segundos, do X-Retry-After do limite de tentativas
  retryAfter?: number;
  // o corpo de sucesso, para quem precisa dele (a URL do Google)
  body?: unknown;
  // no 400 de validação do envelope, o campo (o primeiro trecho do caminho) de cada problema, sem a mensagem nem o valor: a carteira
  // (etapa 12) põe o erro no campo certo e escreve a frase dela
  paths?: string[];
}

// O prazo de cada pedido. Sem ele, uma rede de celular que trava depois do envio deixa o formulário em "Enviando…", desativado, até o
// navegador desistir (minutos depois). Estourado, vira "sem conexão" (status 0), como uma rede que caiu, e a pessoa pode tentar de novo.
export const SEND_TIMEOUT_MS = 15_000;

export async function send(
  path: string,
  options: { method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
  doFetch: typeof fetch = fetch,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<Reply> {
  let response: Response;
  try {
    response = await doFetch(path, {
      signal: AbortSignal.timeout(timeoutMs),
      method: options.method ?? 'POST',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      // a api não redireciona respostas de POST; um redirecionamento aqui seria um erro, não um caminho a seguir
      redirect: 'error',
    });
  } catch {
    return { ok: false, status: 0 };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // a borda caiu, ou a resposta é um HTML de erro: só o status importa
    return response.ok
      ? { ok: true, status: response.status }
      : { ok: false, status: response.status };
  }
  if (response.ok) return { ok: true, status: response.status, body };

  const reply: Reply = { ok: false, status: response.status };
  const code = errorCode(body);
  if (code) reply.code = code;
  const paths = errorPaths(body);
  if (paths) reply.paths = paths;
  const retryAfter = Number(response.headers.get('x-retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) reply.retryAfter = retryAfter;
  return reply;
}

function errorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const direct = (body as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const nested = (body as { error?: { code?: unknown } | null }).error?.code;
  return typeof nested === 'string' ? nested : undefined;
}

// Os campos que o 400 de validação do envelope recusou (`error.details`, os problemas do Zod): só o primeiro trecho do caminho de cada um.
function errorPaths(body: unknown): string[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const details = (body as { error?: { details?: unknown } | null }).error?.details;
  if (!Array.isArray(details)) return undefined;
  const paths = details.flatMap((issue: unknown) => {
    const path = (issue as { path?: unknown } | null)?.path;
    return Array.isArray(path) && typeof path[0] === 'string' ? [path[0]] : [];
  });
  return paths.length > 0 ? paths : undefined;
}

const BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  INVALID_PASSWORD: 'Senha incorreta.',
  INVALID_TOKEN: 'Este link venceu ou já foi usado. Peça um novo.',
  TOKEN_EXPIRED: 'Este link venceu. Peça um novo.',
  PASSWORD_TOO_SHORT: `A senha precisa ter pelo menos ${ACCOUNT_LIMITS.passwordMin} caracteres.`,
  PASSWORD_TOO_LONG: `A senha pode ter no máximo ${ACCOUNT_LIMITS.passwordMax} caracteres.`,
  CONSENT_REQUIRED: 'Aceite os termos de uso e a política de privacidade para criar a conta.',
  INVALID_PROFILE: `Confira o nome (até ${ACCOUNT_LIMITS.nameMax} caracteres, sem caracteres de controle) e o e-mail.`,
  INVALID_EMAIL: 'Informe um e-mail válido.',
  UNAUTHORIZED: 'Sua sessão acabou. Entre de novo.',
};

const BUSY = 'Não foi possível concluir agora. Tente de novo em alguns minutos.';

// A frase da tela para uma resposta que não deu certo. Nunca a mensagem da api: ela vem em inglês (Better Auth) ou pode repetir o que o
// cliente mandou. Código desconhecido cai na frase do status.
export function messageFor(reply: Reply): string {
  const known = reply.code ? BY_CODE[reply.code] : undefined;
  if (known) return known;
  if (reply.status === 0) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  if (reply.status === 413)
    return 'O pedido ficou grande demais. Confira os dados e tente de novo.';
  if (reply.status === 429) return `Muitas tentativas. ${wait(reply.retryAfter)} e tente de novo.`;
  if (reply.status >= 500) return BUSY;
  return 'Não foi possível concluir. Confira os dados e tente de novo.';
}

function wait(seconds: number | undefined): string {
  if (seconds === undefined) return 'Espere um pouco';
  if (seconds >= 120) return `Espere ${Math.ceil(seconds / 60)} minutos`;
  return `Espere ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`;
}

// O corpo do POST /api/auth/sign-in/social (docs/CONTA.md, seção 2): entrar não cria conta; cadastrar manda `requestSignUp` e o aceite
// explícito em `additionalData` (o estado do fluxo o guarda até o callback). Os erros do Google voltam para /entrar (?error=).
export function googleBody({
  next,
  consent,
}: {
  next: string;
  consent?: ConsentProof;
}): Record<string, unknown> {
  return {
    provider: 'google',
    callbackURL: next,
    newUserCallbackURL: '/conta',
    errorCallbackURL: '/entrar',
    ...(consent ? { requestSignUp: true, additionalData: { consent } } : {}),
  };
}
