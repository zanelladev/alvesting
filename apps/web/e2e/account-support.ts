import { randomInt } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test as base, type APIRequestContext, type TestInfo } from '@playwright/test';
import { envelopeSchema, legalSchema, type Legal } from '@alvesting/contracts';
import { ACCOUNT_OUTBOX_DIR, FRONT_DOOR_URL } from './api-server';

// Apoio dos e2e da conta (docs/CONTA.md): a api sozinha (account-api.spec.ts) e as telas (conta.spec.ts, conta-layout.spec.ts). Tudo
// sintético: e-mails @example.test, senha inventada e o IP de cada teste. Nada vai à rede: o e-mail cai num arquivo da pasta de saída.
export const PASSWORD = 'senha-de-e2e-bem-longa-1';
export const NAME = 'Pessoa do e2e';

// O limite de tentativas do Better Auth é por IP e por caminho: cada teste vem de um IP próprio, ou os três projetos, que rodam em
// paralelo, dividiriam o 127.0.0.1 e tomariam 429. Atrás do Front Door imitado o IP vem do X-Forwarded-For que o teste manda
// (e2e/front-door.ts); direto na api da conta (account-api.spec.ts), do X-Azure-SocketIP.
export const fakeIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

// E-mail único por teste e por projeto: os três rodam ao mesmo tempo no mesmo banco.
export const email = (label: string) =>
  `e2e-${label}-${Date.now().toString(36)}-${randomInt(1e6).toString(36)}@example.test`;

// O teste com um IP próprio, falando com o Front Door imitado, que é https com certificado autoassinado (e2e/front-door.ts): o
// `ignoreHTTPSErrors` vale para o navegador e para o `request` do teste, como o `extraHTTPHeaders`. Contextos abertos à mão
// (`browser.newContext`) levam as duas opções por conta própria (`contextOptions`, em conta.spec.ts).
// (O segundo argumento de um fixture do Playwright é o `use`; aqui se chama `provide`, porque o ESLint do React toma toda chamada a
// `use(...)` por um hook.)
export const test = base.extend<{ ip: string }>({
  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o objeto de dependências, mesmo vazio
  ip: async ({}, provide) => {
    await provide(fakeIp());
  },
  extraHTTPHeaders: async ({ ip }, provide) => {
    await provide({ 'x-forwarded-for': ip });
  },
  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o objeto de dependências, mesmo vazio
  ignoreHTTPSErrors: async ({}, provide) => {
    await provide(true);
  },
});

// Um segundo navegador (outro contexto, outro jar de cookies) com o mesmo aparelho do projeto e o IP dele, para o teste de dois usuários
// (conta.spec.ts e carteira.spec.ts). Contexto aberto à mão não herda o `ignoreHTTPSErrors` do fixture `test`: o Front Door imitado tem
// certificado autoassinado.
export function contextOptions(info: TestInfo, ip: string) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale } = info.project.use;
  return {
    baseURL: FRONT_DOOR_URL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'x-forwarded-for': ip },
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    locale,
  };
}

export interface Mail {
  subject: string;
  plainText: string;
  link: string;
}

// O e-mail mais novo para o endereço (e, se vier, com o assunto pedido). O e-mail sai em segundo plano (a resposta do cadastro não
// espera o envio), então espera a mensagem aparecer na pasta.
export async function mailTo(address: string, subject?: RegExp): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        const files = await readdir(ACCOUNT_OUTBOX_DIR).catch(() => [] as string[]);
        for (const file of files
          .filter((f) => f.endsWith('.json'))
          .sort()
          .reverse()) {
          const message = JSON.parse(
            await readFile(path.join(ACCOUNT_OUTBOX_DIR, file), 'utf8'),
          ) as { to: string; subject: string; plainText: string };
          const link = /https?:\/\/\S+/.exec(message.plainText)?.[0];
          if (message.to === address && link && (subject?.test(message.subject) ?? true)) {
            found = { subject: message.subject, plainText: message.plainText, link };
            return true;
          }
        }
        return false;
      },
      { message: 'o e-mail não apareceu na caixa de saída', timeout: 10_000 },
    )
    .toBe(true);
  return found!;
}

// Quantos e-mails a caixa de saída tem para o endereço agora, sem esperar (para provar que NENHUM saiu; quem espera um é o `mailTo`).
export async function mailCount(address: string): Promise<number> {
  const files = await readdir(ACCOUNT_OUTBOX_DIR).catch(() => [] as string[]);
  let count = 0;
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const message = JSON.parse(await readFile(path.join(ACCOUNT_OUTBOX_DIR, file), 'utf8')) as {
      to: string;
    };
    if (message.to === address) count += 1;
  }
  return count;
}

// Os textos vigentes, como a api os serve (GET /api/v1/legal): a versão, a vigência e o SHA-256 que as telas têm de mostrar.
export async function legal(request: APIRequestContext, origin = FRONT_DOOR_URL): Promise<Legal> {
  const response = await request.get(`${origin}/api/v1/legal`);
  expect(response.status()).toBe(200);
  const body = envelopeSchema(legalSchema).parse(await response.json());
  if (!body.success) throw new Error('GET /api/v1/legal falhou');
  return body.data;
}

export function consentOf(docs: Legal): { terms: string; privacy: string } {
  const version = (id: 'TERMS' | 'PRIVACY') => docs.documents.find((d) => d.document === id)!;
  return { terms: version('TERMS').version, privacy: version('PRIVACY').version };
}

export interface User {
  email: string;
  password: string;
  name: string;
  ip: string;
}

// Uma conta feita pela api que NUNCA verificou o e-mail (o e-mail de verificação sai, e o login responde 403 até o link ser aberto).
// O cadastro vai pelo Front Door imitado, como o navegador o faria.
export async function registerUnverifiedUser(
  request: APIRequestContext,
  ip: string,
  label: string,
  name = NAME,
): Promise<User> {
  const user = { email: email(label), password: PASSWORD, name, ip };
  const signUp = await request.post(`${FRONT_DOOR_URL}/api/auth/sign-up/email`, {
    headers: { origin: FRONT_DOOR_URL, 'x-forwarded-for': ip },
    data: {
      name,
      email: user.email,
      password: user.password,
      callbackURL: '/verificar-email?retorno=1',
      consent: consentOf(await legal(request)),
    },
  });
  expect(signUp.status()).toBe(200);
  return user;
}

// Uma conta pronta para entrar, feita pela api (o cadastro pelas telas tem o próprio teste): o cadastro com o aceite, o link do e-mail
// falso e a verificação.
export async function registerVerifiedUser(
  request: APIRequestContext,
  ip: string,
  label: string,
  name = NAME,
): Promise<User> {
  const user = await registerUnverifiedUser(request, ip, label, name);
  const mail = await mailTo(user.email, /Confirme/);
  const link = new URL(mail.link);
  const verified = await request.get(`${FRONT_DOOR_URL}${link.pathname}${link.search}`, {
    headers: { 'x-forwarded-for': ip },
    maxRedirects: 0,
  });
  expect(verified.status()).toBe(302);
  return user;
}

// Entra pela api: o cookie da sessão fica no jar do `request` (que, no contexto do navegador, é o mesmo do navegador).
export async function signInViaApi(request: APIRequestContext, user: User): Promise<void> {
  const response = await request.post(`${FRONT_DOOR_URL}/api/auth/sign-in/email`, {
    headers: { origin: FRONT_DOOR_URL, 'x-forwarded-for': user.ip },
    data: { email: user.email, password: user.password },
  });
  expect(response.status()).toBe(200);
}
