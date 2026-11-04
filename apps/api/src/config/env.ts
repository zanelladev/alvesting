import { QUOTES_SECRET_MIN_LENGTH, QUOTES_SECRET_SHAPE } from '@alvesting/contracts';
import { z } from 'zod';
import { API_LOGIN } from '../infrastructure/database/table-policy.js';
import { Secret } from './secret.js';

// Token de injeção do ambiente já validado (ver ConfigModule).
export const ENV = Symbol('ENV');

// Variável em branco (VAR= no .env) vale como ausente.
const blankAsUndefined = (value: unknown) => (value === '' ? undefined : value);

// O mesmo para o segredo que o Key Vault guarda como PENDENTE até o Artur ter o valor (docs/INFRA.md, 2.6).
const pendingAsUndefined = (value: unknown) =>
  value === '' || value === 'PENDENTE' ? undefined : value;

// O mesmo, aparado nas pontas: segredo colado à mão no Key Vault costuma levar a quebra de linha do `echo`, que o cabeçalho Authorization recusaria
// (o token da brapi) e que faria o segredo do site e o da api nunca baterem (o das cotações, que o site também apara).
const trimmedPendingAsUndefined = (value: unknown) =>
  pendingAsUndefined(typeof value === 'string' ? value.trim() : value);

// Segredo do ambiente: o valor fica dentro de um Secret (config/secret.ts) e não aparece em log nem em JSON.
const secret = (max: number, min = 1, trim = false) =>
  z.preprocess(
    trim ? trimmedPendingAsUndefined : pendingAsUndefined,
    z
      .string()
      .min(min)
      .max(max)
      .transform((value) => new Secret(value))
      .optional(),
  );

// O segredo da rota de cotações (QUOTES_SECRET): aparado e só ASCII visível, a forma que o site também exige antes de mandá-lo. Uma quebra de
// linha no meio do valor faria o `fetch` do Node repetir o segredo inteiro na mensagem do erro do cabeçalho, e o erro vai ao log do site. A
// mensagem de erro daqui nomeia a variável e a regra, nunca o valor.
const quotesSecret = z.preprocess(
  trimmedPendingAsUndefined,
  z
    .string()
    .min(QUOTES_SECRET_MIN_LENGTH)
    .max(256)
    .regex(QUOTES_SECRET_SHAPE)
    .transform((value) => new Secret(value))
    .optional(),
);

// O segredo da rota de cotações que o .env.example traz para o `pnpm dev` rodar sem configurar nada. É público (o repositório pode ficar
// público), então a produção o recusa (o teste confere que é o mesmo valor do arquivo): copiar o .env.example para lá abriria a rota a quem o lê.
export const QUOTES_SECRET_EXAMPLE = 'dev-cotacoes-nao-use-em-producao-0123456789abcdef';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const isHttpsOrLoopback = (value: string): boolean => {
  const url = new URL(value);
  return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname);
};

export const envSchema = z
  .object({
    NODE_ENV: z.preprocess(
      blankAsUndefined,
      z.enum(['development', 'test', 'production']).default('development'),
    ),
    LOG_LEVEL: z.preprocess(
      blankAsUndefined,
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ),
    // Em que interface a API escuta. O padrão (todas) é o que o contêiner precisa; o .env.example fixa
    // 127.0.0.1 para o `pnpm dev` não ficar exposto na rede local.
    API_HOST: z.preprocess(
      blankAsUndefined,
      z.union([z.ipv4(), z.ipv6(), z.hostname()]).default('0.0.0.0'),
    ),
    API_PORT: z.preprocess(
      blankAsUndefined,
      z.coerce.number().int().min(1).max(65535).default(4310),
    ),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
    // O login de menor privilégio da api no Postgres (onda 3d; docs/INFRA.md, 2.7). Só o papel HTTP o usa (useApiLogin, abaixo) e o
    // comando `db:roles`, que lê a senha dele daqui para criar o login com o DATABASE_URL do administrador. A URL leva a senha: o erro de
    // validação lista só o nome da variável. Na Azure o ca-api recebe o login da api direto no DATABASE_URL e não precisa desta.
    API_DATABASE_URL: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .regex(/^postgres(ql)?:\/\//)
        .optional(),
    ),
    // Sem ela o Service Bus fica desligado e qualquer uso da fila falha com mensagem clara.
    // Em produção a conexão vira identidade gerenciada (etapa 3).
    SERVICEBUS_CONNECTION_STRING: z.preprocess(blankAsUndefined, z.string().optional()),
    // Na Azure (sem connection string) o Service Bus e o Blob entram pelo endereço com a identidade gerenciada
    // (DefaultAzureCredential; o AZURE_CLIENT_ID escolhe a identidade do próprio workload). A infra injeta SERVICEBUS_FQDN e
    // STORAGE_BLOB_ENDPOINT (docs/INFRA.md, 2.7). No emulador e no CI vale a connection string, que vence.
    SERVICEBUS_FQDN: z.preprocess(blankAsUndefined, z.hostname().optional()),
    // O Service Bus FALSO do e2e e dos testes das rotas /admin: uma pasta com a DLQ e a publicação (modules/messaging/infrastructure/
    // fake-service-bus.ts). Vence a connection string e o FQDN. Em produção o app recusa subir com ela (service-bus-client.ts).
    SERVICEBUS_FAKE_DIR: z.preprocess(blankAsUndefined, z.string().max(1024).optional()),
    // Azurite (docker compose) em dev e no CI. Não existe na Azure.
    STORAGE_CONNECTION_STRING: z.preprocess(blankAsUndefined, z.string().optional()),
    STORAGE_BLOB_ENDPOINT: z.preprocess(blankAsUndefined, z.url().optional()),
    // Token da brapi, a fonte das cotações (etapa 4). O Key Vault guarda PENDENTE até o Artur criar a conta: vale
    // como ausente, e o uso falha dizendo que falta o token. Aparado nas pontas: segredo colado no Key Vault costuma levar
    // a quebra de linha do `echo`, que o cabeçalho Authorization recusaria. É um Secret como os outros (não aparece em JSON, em inspect
    // nem em template, e sai do process.env depois do parse): o cliente da brapi o recebe com `.reveal()` e só o põe no `Authorization`.
    BRAPI_TOKEN: secret(512, 1, true),
    // Trava de origem (plano 5.4): o ID (GUID) do perfil do Front Door. Com ele, só passa requisição que traga o
    // mesmo valor em X-Azure-FDID; sem ele (dev, teste e perfil econômico) não há trava. Vem do segredo
    // front-door-id do Key Vault. GUID torto falha o boot: trancar todo mundo com o /health verde é pior.
    FRONT_DOOR_ID: z.preprocess(blankAsUndefined, z.guid().optional()),
    // Contrato fail closed (docs/INFRA.md, 3.3): o Bicep injeta ORIGIN_LOCK=front-door nos apps atrás do Front Door.
    // Com ele, FRONT_DOOR_ID é obrigatório e a API recusa subir sem o ID: um ID perdido por erro de configuração
    // pareceria "sem trava" (como no econômico) e a desligaria em silêncio.
    ORIGIN_LOCK: z.preprocess(blankAsUndefined, z.enum(['front-door']).optional()),
    // --- Arena (etapa 6; docs/ARENA.md). Só o job de decisões recebe o prompt e a chave (docs/INFRA.md, 2.7). ---
    // O texto do prompt da arena, por referência ao Key Vault, numa versão fixa. Nunca vai a log, a Blob nem à API. O teto
    // é o de um segredo do Key Vault (25 KB).
    PROMPT_ARENA: secret(25_600),
    // A versão do segredo prompt-arena (32 hexadecimais): o decide e o sched-cycle a gravam em prompt_version. Não é segredo.
    PROMPT_ARENA_VERSION: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .regex(/^[0-9a-f]{32}$/)
        .optional(),
    ),
    // A chave do OpenRouter (segredo openrouter-api-key). Vale como ausente enquanto for PENDENTE.
    OPENROUTER_API_KEY: secret(512),
    // O teto de custo das LLMs no mês, em dólares (texto decimal, até 6 casas). Só o sched-cycle lê. Sem ele, o ciclo com
    // modelo pago é pulado (fail closed); os fakes custam zero e não dependem dele.
    ARENA_MONTHLY_COST_CAP_USD: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .regex(/^\d{1,9}(\.\d{1,6})?$/)
        .optional(),
    ),
    // --- Revalidação e purge depois da liquidação (etapa 9; docs/JOBS.md, seção 4.2). Só o worker-data os recebe (docs/INFRA.md, 2.7). ---
    // O endereço interno do site (o ingress do ca-web): o worker pede a revalidação das páginas. http ou https, sem usuário.
    WEB_INTERNAL_URL: z.preprocess(
      blankAsUndefined,
      z
        .url({ protocol: /^https?$/ })
        .refine((value) => URL.canParse(value) && new URL(value).username === '', {
          message: 'sem usuário na URL',
        })
        .optional(),
    ),
    // O segredo da rota de revalidação do site (segredo revalidate-secret do Key Vault). Mínimo de 32 caracteres: a rota é alcançável da
    // internet e o segredo é a única defesa dela (o seed gera 384 bits). Mais curto é erro de configuração e impede o boot.
    REVALIDATE_SECRET: secret(256, 32),
    // O segredo da rota interna de cotações (segredo quotes-secret do Key Vault; docs/API.md, seção 6): o site o manda em
    // `Authorization: Bearer` para ler as barras de preço, que nenhuma rota pública entrega. Só a api (e o site) o recebem. O mesmo mínimo,
    // pelo mesmo motivo. Ausente, a rota fica desligada (404 para todos): o resto da api sobe.
    QUOTES_SECRET: quotesSecret,
    // O ID do endpoint do Front Door, para o purge do cache: só o caminho ARM de um endpoint (é concatenado a management.azure.com,
    // então nada além deste formato passa).
    FRONT_DOOR_ENDPOINT_ID: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .regex(
          /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[\w.()-]{1,90}\/providers\/Microsoft\.Cdn\/profiles\/[A-Za-z0-9-]{1,260}\/afdEndpoints\/[A-Za-z0-9-]{1,50}$/i,
        )
        .optional(),
    ),
    // O endpoint do Azure OpenAI, para um competidor com provedor azure-openai. Hoje a infra o injeta só na api (chat); ligar
    // a arena ao Azure exige levá-lo ao job de decisões e dar o papel à identidade dele (docs/ARENA.md).
    AZURE_OPENAI_ENDPOINT: z.preprocess(blankAsUndefined, z.url().optional()),
    // --- Conta (etapa 11; docs/CONTA.md). Só a api (HTTP) as recebe (docs/INFRA.md, 2.7). Aqui só a forma de cada uma: o que a
    // produção exige (e o que ela recusa) fica em modules/account/infrastructure/account-config.ts, porque o worker, os agendadores
    // e o job de decisões leem este mesmo schema e não têm nada disto. ---
    // A URL pública do site: a base dos links dos e-mails e a única origem confiável do Better Auth.
    PUBLIC_URL: z.preprocess(blankAsUndefined, z.url({ protocol: /^https?$/ }).optional()),
    // O segredo que assina a sessão (segredo better-auth-secret). Mínimo de 32 caracteres, como o da revalidação.
    BETTER_AUTH_SECRET: secret(256, 32),
    // O login com Google só existe com as duas (o secret vem do segredo google-oauth-client-secret; PENDENTE vale como ausente).
    GOOGLE_CLIENT_ID: z.preprocess(blankAsUndefined, z.string().max(256).optional()),
    GOOGLE_CLIENT_SECRET: secret(512),
    // O Communication Services (segredo acs-connection-string) e o endereço de onde o e-mail sai (DoNotReply@<domínio gerenciado>).
    ACS_CONNECTION_STRING: secret(2048),
    EMAIL_SENDER_ADDRESS: z.preprocess(blankAsUndefined, z.email().max(254).optional()),
    // O remetente falso, só fora de produção: grava cada e-mail num arquivo desta pasta para o teste ler o link.
    EMAIL_OUTBOX_DIR: z.preprocess(blankAsUndefined, z.string().max(1024).optional()),
    // Quem é o controlador dos dados e como falar com ele (LGPD art. 9): da configuração, nunca do repositório.
    LEGAL_CONTROLLER_NAME: z.preprocess(
      blankAsUndefined,
      z.string().trim().min(1).max(200).optional(),
    ),
    LEGAL_CONTACT_EMAIL: z.preprocess(blankAsUndefined, z.email().max(254).optional()),
  })
  .refine((env) => env.ORIGIN_LOCK !== 'front-door' || env.FRONT_DOOR_ID !== undefined, {
    path: ['FRONT_DOOR_ID'],
    message: 'obrigatória com ORIGIN_LOCK=front-door',
  })
  // O valor de dev do .env.example é público: em produção o segredo da rota de cotações tem de ser outro.
  .refine(
    (env) => env.NODE_ENV !== 'production' || env.QUOTES_SECRET?.reveal() !== QUOTES_SECRET_EXAMPLE,
    {
      path: ['QUOTES_SECRET'],
      message: 'é o valor de exemplo do .env.example: gere outro (openssl rand -base64 48)',
    },
  )
  // O Bearer da revalidação vai nesse endereço: em produção, só por TLS (o loopback não sai da máquina).
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      env.WEB_INTERNAL_URL === undefined ||
      isHttpsOrLoopback(env.WEB_INTERNAL_URL),
    { path: ['WEB_INTERNAL_URL'], message: 'em produção, https (o segredo vai no cabeçalho)' },
  );
export type Env = z.infer<typeof envSchema>;

// Os segredos que o schema guarda dentro de um Secret. Depois do parse o texto cru não pode ficar em process.env pelo resto da
// vida do processo: um despejo do ambiente, um relatório de falha ou a telemetria da etapa 10 o exporia, e nada mais o lê dali.
const SECRET_VARIABLES = [
  'BRAPI_TOKEN',
  'PROMPT_ARENA',
  'OPENROUTER_API_KEY',
  'REVALIDATE_SECRET',
  'QUOTES_SECRET',
  'BETTER_AUTH_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'ACS_CONNECTION_STRING',
] as const;

// A mensagem de erro lista só o nome da variável e a regra violada, nunca o valor (pode ser segredo). Lido de process.env (o
// padrão), os segredos saem dele ao final: quem precisa do valor o pega do Secret do Env devolvido. Com outra origem (os testes
// passam a sua) nada é apagado.
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (source === process.env) {
    for (const name of SECRET_VARIABLES) delete process.env[name];
  }
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Variáveis de ambiente inválidas: ${problems}`);
}

// O papel HTTP é o único exposto à internet e roda com o login de menor privilégio (docs/INFRA.md, 2.2 e 2.7; ADR 0028): com
// API_DATABASE_URL no ambiente, ela passa a ser o DATABASE_URL deste processo. É o que o `pnpm dev` e o e2e fazem (o .env.example traz os dois
// logins; o semear e o `account:promote` seguem com o administrador). Worker, decisões e agendadores nunca chamam isto: continuam no
// DATABASE_URL, e na Azure a api recebe o do login dela direto, sem esta variável. Chamar ANTES do parseEnv.
export function useApiLogin(env: NodeJS.ProcessEnv = process.env): void {
  if (env.API_DATABASE_URL) env.DATABASE_URL = env.API_DATABASE_URL;
}

// Fail closed do banco (etapa 10, parte 4; docs/INFRA.md, 2.2): em PRODUÇÃO o papel HTTP só sobe com o login de menor privilégio. Na Azure o
// ca-api recebe o segredo database-url-api no DATABASE_URL, e um segredo trocado por engano pelo do administrador (dono das tabelas, com poder
// de DDL) a poria de volta com o poder de antes, em silêncio e com tudo verde. O usuário se reconhece como o PrismaService o reconhece (o nome
// é fixo: API_LOGIN). Fora de produção (dev, teste, e2e) o ambiente escolhe o login. A mensagem não repete a URL: ela leva a senha. Chamar
// DEPOIS do useApiLogin.
export function requireApiLogin(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const url = env.DATABASE_URL;
  const user =
    url !== undefined && URL.canParse(url) ? decodeURIComponent(new URL(url).username) : undefined;
  if (user !== API_LOGIN) {
    throw new Error(
      `Em produção a api só roda com o login ${API_LOGIN} do Postgres (na Azure, o segredo database-url-api no DATABASE_URL), e não com o do administrador, que é dono das tabelas (docs/INFRA.md, 2.2).`,
    );
  }
}
