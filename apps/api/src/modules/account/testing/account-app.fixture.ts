import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { vi } from 'vitest';
import { ConfigModule } from '../../../config/config.module.js';
import { ENV, parseEnv, type Env } from '../../../config/env.js';
import { configureApp } from '../../../configure-app.js';
import { DatabaseModule } from '../../../infrastructure/database/database.module.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { AccountModule } from '../account.module.js';
import { AUTH, EMAIL_SENDER, LEGAL_DOCUMENTS, type Auth } from '../account.tokens.js';
import type { LegalDocument } from '../domain/legal-documents.js';
import type { EmailSender } from '../infrastructure/email/email-sender.js';
import { readOutbox, type OutboxMessage } from '../infrastructure/email/outbox-email-sender.js';

// Apoio dos testes de integração da conta (Postgres): sobe a API de verdade (Better Auth, guards, rotas /me), com o remetente falso
// gravando numa pasta temporária e o Google com credenciais sintéticas. Nada sai pela rede.
export const ORIGIN = 'http://127.0.0.1:4300';
export const PASSWORD = 'senha-longa-de-teste-1';
export const GOOGLE_CLIENT_ID = 'cliente-sintetico.apps.example.test';

let ipCounter = 0;
// Um IP de documentação (RFC 5737) por chamada: o limite de tentativas do Better Auth é por IP e por caminho, e guarda o estado
// em memória no processo todo, então testes que dividissem o mesmo IP se atropelariam.
export const nextIp = (): string => `198.51.100.${(ipCounter++ % 250) + 1}`;
let emailCounter = 0;
export const newEmail = (): string =>
  `pessoa-${Date.now().toString(36)}-${(emailCounter++).toString(36)}@example.test`;

export interface AccountApp {
  app: INestApplication;
  auth: Auth;
  env: Env;
  // a lista de documentos vigentes, mutável: um teste sobe a versão de um deles para simular o texto novo
  docs: LegalDocument[];
  outboxDir: string;
  agent: () => ReturnType<typeof request.agent>;
  http: () => ReturnType<typeof request>;
  consent: () => { terms: string; privacy: string };
  mailTo: (to: string, subject?: RegExp) => Promise<OutboxMessage & { link: string }>;
  stop: () => Promise<void>;
}

export interface AccountAppOptions {
  frontDoorId?: string;
  withGoogle?: boolean;
  sender?: EmailSender;
  extraControllers?: unknown[];
  extraImports?: unknown[];
  // variáveis de ambiente a mais (o módulo de admin lê PROMPT_ARENA_VERSION, ARENA_MONTHLY_COST_CAP_USD e SERVICEBUS_FAKE_DIR)
  env?: Record<string, string>;
  // provedores trocados por um valor (o relógio e o Service Bus do módulo de admin)
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
}

export async function startAccountApp(
  prisma: PrismaService,
  options: AccountAppOptions = {},
): Promise<AccountApp> {
  const outboxDir = await mkdtemp(path.join(tmpdir(), 'alvesting-conta-'));
  const env = parseEnv({
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x_test',
    NODE_ENV: 'test',
    PUBLIC_URL: ORIGIN,
    EMAIL_OUTBOX_DIR: outboxDir,
    EMAIL_SENDER_ADDRESS: 'naoresponda@example.test',
    LEGAL_CONTROLLER_NAME: 'Controlador de Teste',
    LEGAL_CONTACT_EMAIL: 'privacidade@example.test',
    ...(options.withGoogle === false
      ? {}
      : { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: 'segredo-sintetico-do-google' }),
    ...(options.frontDoorId
      ? { ORIGIN_LOCK: 'front-door', FRONT_DOOR_ID: options.frontDoorId }
      : {}),
    ...options.env,
  });

  const { loadLegalDocuments } = await import('../domain/legal-documents.js');
  const docs = [...loadLegalDocuments()];

  let builder = Test.createTestingModule({
    imports: [
      ConfigModule,
      DatabaseModule,
      AccountModule,
      ...((options.extraImports ?? []) as never[]),
    ],
    controllers: (options.extraControllers ?? []) as never[],
  })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(LEGAL_DOCUMENTS)
    .useValue(docs);
  if (options.sender) builder = builder.overrideProvider(EMAIL_SENDER).useValue(options.sender);
  for (const { provide, useValue } of options.overrides ?? []) {
    builder = builder.overrideProvider(provide as never).useValue(useValue);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  const auth = app.get<Auth>(AUTH, { strict: false });
  configureApp(app, { frontDoorId: options.frontDoorId, auth });
  await app.init();

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  return {
    app,
    auth,
    env,
    docs,
    outboxDir,
    agent: () => request.agent(server()),
    http: () => request(server()),
    consent: () => ({
      terms: docs.find((d) => d.document === 'TERMS')!.version,
      privacy: docs.find((d) => d.document === 'PRIVACY')!.version,
    }),
    // O e-mail sai em segundo plano (para o cadastro não revelar a conta pelo tempo de resposta): o teste espera a mensagem aparecer.
    mailTo: async (to, subject) =>
      vi.waitFor(
        async () => {
          const found = (await readOutbox(outboxDir)).filter(
            (m) => m.to === to && (subject === undefined || subject.test(m.subject)),
          );
          if (found.length === 0) throw new Error(`sem e-mail para o destinatário de teste`);
          const message = found[found.length - 1]!;
          const link = /https?:\/\/\S+/.exec(message.plainText)?.[0];
          if (!link) throw new Error('o e-mail não tem link');
          return { ...message, link };
        },
        { timeout: 5_000, interval: 25 },
      ),
    stop: async () => {
      await app.close();
      await rm(outboxDir, { recursive: true, force: true });
    },
  };
}

// --- chamadas ao Better Auth -----------------------------------------------------------------------------------------------
type Agent = ReturnType<typeof request.agent>;
const withHeaders = (req: request.Test, ip = nextIp()) =>
  req.set('Origin', ORIGIN).set('X-Forwarded-For', ip);

export async function signUp(
  agent: Agent,
  body: { email: string; password?: string; name?: string; [key: string]: unknown },
  ip?: string,
) {
  return withHeaders(agent.post('/api/auth/sign-up/email'), ip).send({
    name: 'Pessoa de Teste',
    password: PASSWORD,
    callbackURL: '/conta',
    ...body,
  });
}

export const signIn = (agent: Agent, email: string, password = PASSWORD, ip?: string) =>
  withHeaders(agent.post('/api/auth/sign-in/email'), ip).send({ email, password });

export const getSession = (agent: Agent) =>
  agent.get('/api/auth/get-session').set('X-Forwarded-For', nextIp());

// Cadastra (com o aceite vigente), abre o link do e-mail e entra: devolve o agente já com o cookie da sessão e o id do usuário.
export async function createLoggedInUser(
  account: AccountApp,
  prisma: PrismaService,
  overrides: { email?: string; password?: string } = {},
) {
  const email = overrides.email ?? newEmail();
  const password = overrides.password ?? PASSWORD;
  const agent = account.agent();
  const created = await signUp(agent, { email, password, consent: account.consent() });
  if (created.status !== 200) {
    throw new Error(`cadastro de teste falhou: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const mail = await account.mailTo(email, /Confirme/);
  const url = new URL(mail.link);
  const verified = await agent.get(url.pathname + url.search).set('X-Forwarded-For', nextIp());
  if (verified.status >= 400) throw new Error(`verificação de teste falhou: ${verified.status}`);
  const login = await signIn(agent, email, password);
  if (login.status !== 200) throw new Error(`login de teste falhou: ${login.status}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { agent, email, password, userId: user.id };
}

// As mutações em /api/v1/me pedem a origem do site (defesa em profundidade contra CSRF, além do SameSite=Lax do cookie).
export const asSite = <T extends request.Test>(req: T): T => req.set('Origin', ORIGIN);
