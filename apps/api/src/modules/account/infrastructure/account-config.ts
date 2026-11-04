import type { Env } from '../../../config/env.js';
import { Secret } from '../../../config/secret.js';

// O que a conta (etapa 11; docs/CONTA.md) tira do ambiente, com o contrato fail closed de produção: o app RECUSA SUBIR com o segredo
// vazio, curto ou igual ao do .env.example, sem o Communication Services, com o remetente falso ligado, sem o controlador e o
// contato da privacidade, ou com a URL pública fora de https. Fora de produção (dev e teste) tudo isso é frouxo de propósito: o
// segredo cai no de exemplo e o e-mail vai para uma pasta. Só o papel HTTP monta isto (AccountModule): o worker, os agendadores e o
// job de decisões não têm a conta e não podem ser recusados por ela.

// O segredo que o .env.example traz para o dev rodar sem configurar nada. A produção o recusa (o teste confere que é o mesmo valor).
export const BETTER_AUTH_SECRET_EXAMPLE =
  'exemplo-de-segredo-so-para-desenvolvimento-troque-em-producao';
// O controlador e o contato do .env.example também são de exemplo: copiar o arquivo para a produção publicaria uma política de
// privacidade com um controlador de mentira, que o art. 9 da LGPD não admite.
export const LEGAL_CONTROLLER_NAME_EXAMPLE = 'Controlador de Exemplo (troque)';
export const LEGAL_CONTACT_EMAIL_EXAMPLE = 'privacidade@example.com';

export type EmailConfig =
  | { kind: 'acs'; connectionString: Secret; sender: string }
  | { kind: 'outbox'; dir: string; sender: string };

export interface AccountConfig {
  // a origem do site, sem barra no fim: base dos links dos e-mails, a única origem confiável e, pelo esquema (https), o que decide o
  // cookie `Secure` com o prefixo `__Secure-` (auth.ts)
  publicUrl: string;
  secret: Secret;
  google: { clientId: string; clientSecret: Secret } | null;
  email: EmailConfig;
  // quem é o controlador dos dados e como falar com ele (null só fora de produção, quando as variáveis não existem)
  controller: { name: string; contact: string } | null;
  // atrás do Front Door o IP do cliente vem do X-Azure-SocketIP (ver auth.ts)
  behindFrontDoor: boolean;
}

// A forma do ACS_CONNECTION_STRING que o portal e o Bicep entregam: endpoint=https://<recurso>.communication.azure.com/;accesskey=<chave>
const ACS_SHAPE = /^endpoint=https:\/\/[^;\s]+;accesskey=\S+$/i;

export function accountConfig(env: Env): AccountConfig {
  const production = env.NODE_ENV === 'production';
  const problems: string[] = [];
  const problem = (name: string, why: string) => void problems.push(`${name}: ${why}`);

  // --- a URL pública -------------------------------------------------------------------------------------------------------
  let publicUrl = 'http://127.0.0.1:4300';
  if (env.PUBLIC_URL === undefined) {
    if (production) problem('PUBLIC_URL', 'obrigatória em produção');
  } else {
    const url = new URL(env.PUBLIC_URL);
    if (production && url.protocol !== 'https:') problem('PUBLIC_URL', 'em produção, https');
    if (
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      problem('PUBLIC_URL', 'só a origem (sem usuário, caminho, query nem fragmento)');
    }
    publicUrl = url.origin;
  }

  // --- o segredo da sessão -------------------------------------------------------------------------------------------------
  let secret = env.BETTER_AUTH_SECRET;
  if (secret === undefined) {
    if (production)
      problem('BETTER_AUTH_SECRET', 'obrigatória em produção (openssl rand -base64 48)');
    secret = new Secret(BETTER_AUTH_SECRET_EXAMPLE);
  } else if (production) {
    const value = secret.reveal();
    if (value === BETTER_AUTH_SECRET_EXAMPLE) {
      problem(
        'BETTER_AUTH_SECRET',
        'é o valor de exemplo do .env.example: gere outro (openssl rand -base64 48)',
      );
    } else if (new Set(value).size < 12) {
      problem('BETTER_AUTH_SECRET', 'fraco: repete poucos caracteres (openssl rand -base64 48)');
    }
  }

  // --- o e-mail ------------------------------------------------------------------------------------------------------------
  const sender = env.EMAIL_SENDER_ADDRESS;
  if (production) {
    if (env.EMAIL_OUTBOX_DIR !== undefined) {
      problem('EMAIL_OUTBOX_DIR', 'o remetente falso não pode ser ligado em produção');
    }
    if (env.ACS_CONNECTION_STRING === undefined) {
      problem('ACS_CONNECTION_STRING', 'obrigatória em produção (Azure Communication Services)');
    }
    if (sender === undefined) problem('EMAIL_SENDER_ADDRESS', 'obrigatória em produção');
  }
  if (
    env.ACS_CONNECTION_STRING !== undefined &&
    !ACS_SHAPE.test(env.ACS_CONNECTION_STRING.reveal())
  ) {
    problem('ACS_CONNECTION_STRING', 'forma inválida (endpoint=https://...;accesskey=...)');
  }
  let email: EmailConfig | undefined;
  if (env.EMAIL_OUTBOX_DIR !== undefined && !production) {
    email = {
      kind: 'outbox',
      dir: env.EMAIL_OUTBOX_DIR,
      sender: sender ?? 'naoresponda@example.test',
    };
  } else if (env.ACS_CONNECTION_STRING !== undefined && sender !== undefined) {
    email = { kind: 'acs', connectionString: env.ACS_CONNECTION_STRING, sender };
  } else if (!production) {
    problem(
      'EMAIL_OUTBOX_DIR',
      'ou ACS_CONNECTION_STRING com EMAIL_SENDER_ADDRESS: sem um jeito de mandar e-mail o cadastro não funciona',
    );
  }

  // --- o controlador e o contato da privacidade (LGPD art. 9) ---------------------------------------------------------------
  const { LEGAL_CONTROLLER_NAME: name, LEGAL_CONTACT_EMAIL: contact } = env;
  if (production) {
    if (name === undefined) problem('LEGAL_CONTROLLER_NAME', 'obrigatória em produção');
    else if (name === LEGAL_CONTROLLER_NAME_EXAMPLE) {
      problem(
        'LEGAL_CONTROLLER_NAME',
        'é o valor de exemplo do .env.example: informe o controlador',
      );
    }
    if (contact === undefined) problem('LEGAL_CONTACT_EMAIL', 'obrigatória em produção');
    else if (contact === LEGAL_CONTACT_EMAIL_EXAMPLE) {
      problem('LEGAL_CONTACT_EMAIL', 'é o valor de exemplo do .env.example: informe o contato');
    }
  } else if ((name === undefined) !== (contact === undefined)) {
    problem(
      name === undefined ? 'LEGAL_CONTROLLER_NAME' : 'LEGAL_CONTACT_EMAIL',
      'o controlador e o contato vêm juntos',
    );
  }

  if (problems.length > 0 || email === undefined) {
    // só os nomes das variáveis e a regra violada, nunca os valores (podem ser segredo)
    throw new Error(`Configuração da conta inválida: ${problems.join('; ')}`);
  }

  return {
    publicUrl,
    secret,
    google:
      env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    email,
    controller: name !== undefined && contact !== undefined ? { name, contact } : null,
    behindFrontDoor: env.ORIGIN_LOCK === 'front-door',
  };
}
