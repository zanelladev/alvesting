import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, getOAuthState } from 'better-auth/api';
import { z } from 'zod';
import { ACCOUNT_LIMITS } from '@alvesting/contracts';
import { AUDIT_ACTIONS, appendAudit } from '../../../common/audit.js';
import { newId } from '../../../common/id.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { ConsentService } from '../application/consent.service.js';
import type { AccountConfig } from './account-config.js';
import { createAuthLogger, type AuthLogSink } from './auth-logger.js';
import type { AccountMailer } from './email/account-mailer.js';
import {
  PASSWORD_RESET_VALIDITY_MINUTES,
  VERIFICATION_VALIDITY_MINUTES,
} from './email/email-templates.js';

// O Better Auth da Alvesting (plano §5.7, §8 e §9; etapa 11; docs/CONTA.md): e-mail e senha com verificação obrigatória, redefinição
// de senha, Google como único provedor social (só se GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET existem) e o aceite explícito dos termos
// no cadastro. O handler é montado direto no Express, em /api/auth/* (configure-app.ts), sem adaptador da comunidade: o
// `toNodeHandler` do próprio pacote são três linhas, e o adaptador pediria desligar o body parser do Nest e um guard global.
export interface AuthDeps {
  prisma: PrismaService;
  config: AccountConfig;
  mailer: AccountMailer;
  consent: Pick<ConsentService, 'isCurrent' | 'record'>;
  log: AuthLogSink;
}

const CONSENT_REQUIRED = {
  code: 'CONSENT_REQUIRED',
  message: 'Aceite os termos de uso e a política de privacidade vigentes para criar a conta',
} as const;

const INVALID_PROFILE = {
  code: 'INVALID_PROFILE',
  message:
    'Nome (1 a 100 caracteres, sem caracteres de controle) ou e-mail (até 254 caracteres) inválido, ou imagem enviada (não aceitamos foto)',
} as const;

// Os campos do perfil que o cadastro anônimo escreve. O Better Auth só pede `z.string()` e `z.email()` (um nome de 5 milhões de
// caracteres era gravado sem erro) e o NUL, que o Postgres não guarda, virava 500. A imagem não existe: não temos foto (a imagem de
// quem entra pelo Google também é descartada). O banco tem o mesmo teto em CHECK (migration account_limits), para o dia em que um
// caminho novo esquecer. O tamanho do nome conta caracteres do JavaScript (UTF-16), o do banco conta pontos de código: o do banco é maior.
const signUpProfileSchema = z.object({
  name: z
    .string()
    .max(ACCOUNT_LIMITS.nameMax)
    .refine((name) => name.trim() !== '' && !/\p{Cc}/u.test(name)),
  email: z.string().max(ACCOUNT_LIMITS.emailMax),
  image: z.null().optional(),
});

// As rotas do Better Auth que o site NÃO usa ficam fechadas (404): cada uma seria superfície de ataque sem uso. O /verify-password é um
// oráculo de senha sem o freio do login (60 chutes em 2,6 s, nenhum 429); o /update-user grava nome e imagem sem teto; o /link-social
// grava e-mail e ULID em `verification`; o resto lista ou mexe em sessões e contas vinculadas sem tela que o peça. Tela nova que
// precise de uma delas a tira desta lista, com limite próprio (as telas da etapa 11 não tiraram nenhuma). O teste
// auth-flows.integration.spec.ts lista as rotas que o Better Auth TEM nesta versão e reprova a que não está na lista do site nem aqui:
// rota nova de uma atualização do pacote nasce fechada.
// A exclusão é DELETE /api/v1/me (sessão recente ou senha, freio de tentativas, limpeza do cookie, uma transação): as duas rotas dele
// existem porque a API chama a primeira por dentro, e não ficam abertas ao HTTP.
const CLOSED_PATHS = [
  '/delete-user',
  '/delete-user/callback',
  '/update-user',
  '/update-session',
  '/change-email',
  '/change-password',
  '/verify-password',
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/account-info',
  '/get-access-token',
  '/refresh-token',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
];

export function createAuth({ prisma, config, mailer, consent, log }: AuthDeps) {
  // O aceite sai do corpo do cadastro por e-mail ou do estado do fluxo do Google (`additionalData` do sign-in/social, assinado e
  // guardado até o callback). Em qualquer outro caminho que crie usuário não há prova, e a criação é recusada.
  const proofOf = async (ctx: { path?: string; body?: unknown } | null): Promise<unknown> => {
    if (ctx?.path === '/sign-up/email')
      return (ctx.body as { consent?: unknown } | undefined)?.consent;
    if (ctx?.path === '/callback/:id') {
      return ((await getOAuthState().catch(() => null)) as { consent?: unknown } | null)?.consent;
    }
    return undefined;
  };

  // Dados mínimos: o Better Auth grava os tokens do Google, e nunca os usamos (não chamamos nenhuma API do Google depois do login).
  const withoutOAuthTokens = () =>
    Promise.resolve({
      data: {
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
      },
    });

  // A criação do usuário é a única corrida que denuncia o e-mail: dois cadastros simultâneos do mesmo e-mail novo passam juntos pela
  // checagem "já existe?", e o segundo bate no UNIQUE do banco (P2002) e viraria 422 FAILED_TO_CREATE_USER, uma resposta que o e-mail
  // repetido nunca dá (200 com a resposta genérica). O Better Auth já devolve essa resposta genérica quando a criação lança um 403
  // (sign-up.mjs): o P2002 vira esse 403. O banco continua sendo o árbitro, também entre réplicas.
  const authPrisma = prisma.$extends({
    name: 'duplicate-email-as-forbidden',
    query: {
      user: {
        async create({ args, query }) {
          try {
            return await query(args);
          } catch (error) {
            if ((error as { code?: unknown } | null)?.code === 'P2002') {
              throw new APIError('FORBIDDEN', { message: 'Cadastro não concluído' });
            }
            throw error;
          }
        },
      },
    },
  });

  return betterAuth({
    appName: 'Alvesting',
    // A URL pública do site (Front Door, domínio próprio ou o host do ca-web): os links dos e-mails saem absolutos por ela, e é a
    // única origem em que o Better Auth confia (CSRF e callbackURL).
    baseURL: config.publicUrl,
    basePath: '/api/auth',
    trustedOrigins: [config.publicUrl],
    secret: config.secret.reveal(),
    database: prismaAdapter(authPrisma, { provider: 'postgresql', transaction: true }),
    telemetry: { enabled: false },
    // O Better Auth cria spans próprios assim que o @opentelemetry/api existe (um por endpoint, por gancho e por operação de banco)
    // e põe a mensagem do erro no status do span. A telemetria da api (telemetry/telemetry.ts) já tem o span da requisição e o das
    // consultas; os dele só multiplicariam a ingestão (docs/INFRA.md, seção 5).
    experimental: { instrumentation: { enabled: false } },
    logger: createAuthLogger(log),
    // O roteador do Better Auth tem dois caminhos de log fora do `logger` acima: escreve `ERROR [Better Auth]: <mensagem>` no console
    // (com o texto que o cliente mandou, como o Content-Type) a cada erro de usuário, e o better-call faz `console.error('# SERVER_ERROR:',
    // erro)` com a pilha crua quando a exceção não é do Better Auth (o Prisma, por exemplo). Nenhum passa pelo redactPii. Com `throw`, o
    // erro de usuário vira só a resposta 4xx e a exceção inesperada cai no AuthRoute, que a loga limpa (redactPii) e responde 500 no envelope.
    onAPIError: { throw: true },

    advanced: {
      // IDs são ULID, como no resto do banco (common/id.ts)
      database: { generateId: () => newId() },
      // A conferência de origem (CSRF) e de callbackURL (redirecionamento aberto) LIGADAS em todo ambiente: sem isto o Better Auth as
      // desliga quando NODE_ENV é "test" (a api do e2e e o vitest), e nenhum teste veria uma regressão.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // Secure quando o site é https (a produção sempre é: o contrato fail closed recusa PUBLIC_URL que não seja https); HttpOnly e
      // SameSite=Lax sempre. O prefixo deixa o cookie reconhecível e vira __Secure- com o Secure. Vem do esquema da PUBLIC_URL, e não do
      // NODE_ENV, como o padrão do próprio Better Auth: assim o e2e, que roda atrás de um Front Door imitado em https (NODE_ENV=test),
      // exercita o cookie de produção em Chromium e WebKit, e um staging em https também sai Secure.
      useSecureCookies: config.publicUrl.startsWith('https://'),
      cookiePrefix: 'alvesting',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: {
        // Atrás do Front Door o IP do cliente é o X-Azure-SocketIP: o IP do soquete que o Front Door vê, que o cliente não escolhe
        // (Learn, "Protocol support for HTTP headers in Azure Front Door"). O X-Forwarded-For chega como cadeia ("falso, real") e o
        // Better Auth só confia em uma cadeia com trustedProxies. Sem o Front Door (dev, teste e o perfil econômico), o X-Forwarded-For.
        // Sem IP confiável o Better Auth junta todo mundo num balde por caminho e por réplica (veja o ponytail abaixo).
        ipAddressHeaders: config.behindFrontDoor ? ['x-azure-socketip'] : ['x-forwarded-for'],
      },
    },

    // Limite de tentativas do Better Auth LIGADO em todos os ambientes (por padrão só em produção): 3 por 10 s em /sign-in/* e
    // /sign-up/*, 3 por minuto em /request-password-reset e /send-verification-email, 100 por 10 s no resto, por IP e por caminho.
    // ponytail: o contador fica na memória da réplica (até 5), então o teto real é o limite vezes o número de réplicas, e some no
    // reinício. O limite que vale é o do WAF do Front Door (RateLimitAuth, 30 por minuto por IP em /api/auth/*, docs/INFRA.md 2.5), que
    // é de verdade e fica na borda; este é a segunda camada. Dois cuidados que a Azure confirma e este código não: o
    // X-Azure-SocketIP chegar mesmo na origem e o Front Door sobrescrever o que o cliente mande nele (a documentação não diz); sem IP
    // confiável todos os pedidos de uma réplica dividem um balde só. Saída: storage 'database' (tabela rateLimit) ou secundário.
    rateLimit: { enabled: true, storage: 'memory' },

    session: {
      // 7 dias, renovada a cada uso depois de 1 dia (os padrões); a sessão "recente" que a exclusão da conta aceita sem a senha é a
      // de até 5 minutos.
      freshAge: 5 * 60,
    },

    // Só o Better Auth puro: nenhum plugin (o do admin, por exemplo, abriria rotas que trocam o papel). O papel mora numa coluna do
    // usuário que NENHUMA entrada aceita (input: false) e só o comando account:promote muda.
    user: {
      additionalFields: {
        role: {
          type: ['USER', 'ADMIN'],
          required: false,
          defaultValue: 'USER',
          input: false,
          // não sai nas respostas do Better Auth (nem na sintética do cadastro repetido); o GET /api/v1/me devolve
          returned: false,
        },
      },
      deleteUser: {
        enabled: true,
        // A exclusão é UMA transação (a política promete apagar "no mesmo ato"): o usuário (o banco leva em cascata as sessões, as contas
        // e os aceites), os pedidos pendentes que não têm chave para ele (a redefinição de senha, com value = o ULID do usuário) e o
        // rastro da exclusão, que guarda só o ULID. O Better Auth apagava em comandos soltos, e uma falha no meio (queda de conexão,
        // SIGTERM do blue/green) deixava a pessoa sem credencial e com o cadastro vivo, ou apagada sem o rastro. Depois desta função o
        // Better Auth não acha mais nada para apagar e só limpa o cookie. Falhou, nada foi apagado e a rota responde 500.
        beforeDelete: async (user) => {
          await prisma.$transaction([
            prisma.verification.deleteMany({ where: { value: user.id } }),
            prisma.user.delete({ where: { id: user.id } }),
            // createMany, e não create: a api só tem INSERT em audit_log (papel mínimo do Postgres, common/audit.ts)
            appendAudit(
              prisma,
              { actor: `user:${user.id}`, action: AUDIT_ACTIONS.accountDeleted },
              user.id,
            ),
          ]);
        },
      },
    },

    // O identificador do pedido (que leva o token da redefinição) é guardado como resumo: um vazamento do banco não entrega tokens vivos.
    verification: { storeIdentifier: 'hashed' },

    account: {
      // Sem ligação automática pelo e-mail: quem cadastrou uma conta com o e-mail de outra pessoa (sem nunca o verificar) não ganha o
      // acesso dela quando a vítima entrar com o Google. O custo: quem tem conta por senha e tenta o Google com o mesmo e-mail
      // recebe `account_not_linked` e entra com a senha (ligar os dois é uma tela que ainda não existe).
      accountLinking: { enabled: true, disableImplicitLinking: true },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: ACCOUNT_LIMITS.passwordMin,
      maxPasswordLength: ACCOUNT_LIMITS.passwordMax,
      // a validade que o e-mail promete ("vale por N minutos") vem da mesma constante do texto
      resetPasswordTokenExpiresIn: PASSWORD_RESET_VALIDITY_MINUTES * 60,
      revokeSessionsOnPasswordReset: true,
      // O link vai direto para a tela do site, com o token na query (nunca no caminho, que o log de requisição guardaria).
      sendResetPassword: ({ user, token }) => {
        mailer.sendPasswordReset(
          user.email,
          `${config.publicUrl}/redefinir-senha?token=${encodeURIComponent(token)}`,
        );
        return Promise.resolve();
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: VERIFICATION_VALIDITY_MINUTES * 60,
      // sem await de propósito (AccountMailer): o tempo da resposta não revela se o e-mail já tinha conta
      sendVerificationEmail: ({ user, url }) => {
        mailer.sendVerification(user.email, url);
        return Promise.resolve();
      },
    },

    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret.reveal(),
            // Entrar com o Google não cria conta sozinho: quem cria é o cadastro (requestSignUp), com o aceite explícito.
            disableImplicitSignUp: true,
            // E-mail que o Google não confirma não entra.
            requireEmailVerification: true,
            // Só o fluxo por redirecionamento, que o servidor conduz (state, PKCE e o aceite no estado). O login com o id_token que o
            // cliente mande (sign-in/social com `idToken`) fica desligado: não passaria pelo callback, onde o aceite é conferido.
            disableIdTokenSignIn: true,
          },
        }
      : {},

    hooks: {
      // O aceite é conferido ANTES de olhar se o e-mail já existe: assim a resposta do cadastro sem aceite é a mesma para e-mail novo
      // e para e-mail repetido (conferir só na criação do usuário diria quem já tem conta).
      before: createAuthMiddleware((ctx) => {
        const body = ctx.body as
          | { requestSignUp?: unknown; additionalData?: { consent?: unknown }; consent?: unknown }
          | undefined;
        if (ctx.path === '/sign-up/email') {
          if (!consent.isCurrent(body?.consent))
            throw new APIError('BAD_REQUEST', CONSENT_REQUIRED);
          // também antes de olhar o e-mail: a recusa é a mesma para e-mail novo e repetido
          if (!signUpProfileSchema.safeParse(body).success) {
            throw new APIError('BAD_REQUEST', INVALID_PROFILE);
          }
        }
        if (
          ctx.path === '/sign-in/social' &&
          body?.requestSignUp === true &&
          !consent.isCurrent(body.additionalData?.consent)
        ) {
          throw new APIError('BAD_REQUEST', CONSENT_REQUIRED);
        }
        return Promise.resolve();
      }),
    },

    databaseHooks: {
      user: {
        create: {
          // Defesa em profundidade: qualquer caminho que crie usuário sem a prova do aceite falha aqui. E sem foto: não temos tela para ela.
          before: async (_user, ctx) => {
            if (!consent.isCurrent(await proofOf(ctx)))
              throw new APIError('BAD_REQUEST', CONSENT_REQUIRED);
            return { data: { image: null } };
          },
          // O aceite fica registrado com o documento, a versão, o SHA-256 e a data. O Better Auth roda este hook DEPOIS do commit do
          // usuário: se a gravação falhar, o usuário existe sem o aceite, o cadastro responde 500 (e o e-mail de verificação já saiu), as
          // rotas que o exigem (ConsentGuard) ficam fechadas e ele regulariza por POST /api/v1/me/consents. O log leva só o ULID.
          after: async (user) => {
            try {
              await consent.record(user.id);
            } catch (error) {
              log('error', `${ALERT_LOG.consentNotRecorded} ${user.id}`);
              throw error;
            }
          },
        },
        // A imagem é sempre nula (não temos foto), também numa atualização futura do perfil.
        update: { before: () => Promise.resolve({ data: { image: null } }) },
      },
      session: {
        // Dados mínimos: nem o IP nem o navegador ficam na sessão (o limite de tentativas usa o IP só na memória). NULL diz "não
        // coletado" (a string vazia que o Better Auth grava deixaria a coluna parecer em uso).
        create: { before: () => Promise.resolve({ data: { ipAddress: null, userAgent: null } }) },
      },
      account: {
        create: { before: withoutOAuthTokens },
        update: { before: withoutOAuthTokens },
      },
    },

    disabledPaths: CLOSED_PATHS,
  });
}

export type Auth = ReturnType<typeof createAuth>;
