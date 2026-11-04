import { defineConfig, devices } from '@playwright/test';
import {
  ACCOUNT_API_PORT,
  ADMIN_API_ENV,
  ADMIN_BUS_DIR,
  ACCOUNT_API_URL,
  ACCOUNT_OUTBOX_DIR,
  ACCOUNT_SITE_URL,
  ACCOUNT_WEB_PORT,
  ACCOUNT_WEB_URL,
  API_PORT,
  API_URL,
  E2E_API_DATABASE_URL,
  E2E_DATABASE_URL,
  FIXTURE_API_PORT,
  FIXTURE_API_URL,
  FIXTURE_WEB_PORT,
  FIXTURE_WEB_URL,
  FRONT_DOOR_PORT,
  FRONT_DOOR_URL,
  PRODUCTION_ACCOUNT_ENV,
  QUOTES_SECRET,
  REVALIDATE_SECRET,
  STORAGE_CONNECTION_STRING,
} from './e2e/api-server';
import { FRONT_DOOR_ID, LOCKED_PORT } from './e2e/locked-server';

// Porta própria do e2e, diferente da do `pnpm dev` (4300), para nunca reaproveitar um servidor de dev.
const PORT = 4301;

// BASE_URL aponta o e2e para um site que já está no ar (o deploy testa o Front Door com ele) e dispensa os
// servidores locais. Vazio ou ausente = build local. Rodando pelo `turbo run test:e2e`, a variável (e a
// E2E_API_URL, que diz onde está a api quando ela não divide a origem do site) precisa estar em turbo.json;
// o deploy chama o playwright direto, sem passar por ele.
const remote = process.env.BASE_URL?.trim() || undefined;

// O servidor standalone guarda o cache de dados do site (`fetch` com `next.revalidate`) em disco, em .next/standalone/apps/web/.next/cache, e o
// guarda de uma execução para a outra. Os testes semeiam o banco de novo a cada execução (outros ULIDs, então outros cursores) e a api falsa
// falha a primeira leitura de uma ação: com o cache da execução anterior eles leriam dado velho (o "Tentar de novo" nunca veria o erro). Cada
// servidor começa de cache vazio. Os três servidores do site sobem juntos e só recebem pedido depois que todos respondem, então não se atropelam.
const CLEAN_CACHE = 'rm -rf .next/standalone/apps/web/.next/cache';

// Mobile é gate de merge: todo e2e roda nos três projetos (Pixel 7, iPhone 15 e desktop).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // No CI cada teste ganha 2 novas tentativas (um runner lento pisca), mas o que só passa na segunda ainda reprova o job: mobile é gate
  // de merge, e um teste que pisca no WebKit não pode passar sem ninguém ver. Local não repete nada.
  retries: process.env.CI ? 2 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  // Um runner do CI (2 a 4 vCPU) é mais lento que o Mac de quem desenvolve, e o CI reprova o teste instável (acima). Com 12 workers num
  // Mac (sobrecarga de propósito), os testes de 2 a 5 s passaram a levar até 37 s e um `toHaveURL` estourou os 5 s: no CI os prazos
  // dobram. Local ficam os padrões do Playwright (30 s e 5 s), que acusam cedo o teste que ficou lento de verdade.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: remote ?? `http://127.0.0.1:${PORT}`,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-15', use: { ...devices['iPhone 15'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  // Sobe o build de produção (standalone), o mesmo que vai para a imagem. Rode `pnpm build` antes.
  // O segundo é o mesmo build com a trava de origem ligada (e2e/origin-lock.spec.ts). Não repete o `cp` do
  // `pnpm start`: o estático já foi copiado pelo primeiro. Os dois levam o REVALIDATE_SECRET (e2e/revalidate.spec.ts), o QUOTES_SECRET (o
  // mesmo da api abaixo: o site lê as barras de preço pela rota interna dela, docs/API.md, seção 6) e o API_INTERNAL_URL da api abaixo, como o
  // Bicep os injeta em produção (docs/INFRA.md, 2.7).
  // O terceiro é a api (apps/api/dist). Antes de subir, o driver do ensaio (docs/ENSAIO.md) recria e semeia o banco do e2e com
  // uma temporada inteira e sintética, sem rede (NODE_ENV=development só para o ensaio, que recusa production), e o db-roles-cli cria o
  // login de menor privilégio da api (NODE_ENV=development também: a senha de dev que ele cria a produção recusa): é o dado que as
  // telas e e2e/public-api.spec.ts leem. Precisa do Postgres e do Azurite do docker compose (no CI, do job). O ensaio recusa banco
  // que não termine em _test ou _ensaio.
  // Nenhum dos oito reaproveita um servidor que já esteja de pé (reuseExistingServer: false): ele pode ser de outro build, de outro
  // banco ou de outra execução, e então o recriar e semear do banco (parte do command da api) seria pulado em silêncio e o e2e
  // rodaria sobre dado e código velhos, com falhas sem relação com a mudança. Porta ocupada é erro claro.
  webServer: remote
    ? undefined
    : [
        {
          command: `${CLEAN_CACHE} && pnpm start`,
          env: {
            PORT: String(PORT),
            HOSTNAME: '127.0.0.1',
            REVALIDATE_SECRET,
            QUOTES_SECRET,
            API_INTERNAL_URL: API_URL,
          },
          url: `http://127.0.0.1:${PORT}/health`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: `${CLEAN_CACHE} && node .next/standalone/apps/web/server.js`,
          env: {
            PORT: String(LOCKED_PORT),
            HOSTNAME: '127.0.0.1',
            // O mesmo par que o Bicep injeta em produção (docs/INFRA.md, 2.7).
            ORIGIN_LOCK: 'front-door',
            FRONT_DOOR_ID,
            REVALIDATE_SECRET,
            QUOTES_SECRET,
            API_INTERNAL_URL: API_URL,
          },
          url: `http://127.0.0.1:${LOCKED_PORT}/health`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command:
            'NODE_ENV=development node --enable-source-maps dist/ensaio-cli.js && NODE_ENV=development node --enable-source-maps dist/db-roles-cli.js && node --enable-source-maps dist/main.js',
          cwd: '../api',
          env: {
            NODE_ENV: 'production',
            API_PORT: String(API_PORT),
            API_HOST: '127.0.0.1',
            // O semear e o comando que cria o login da api usam o administrador (DATABASE_URL); o main.js, o papel HTTP, troca-o pelo
            // login de menor privilégio (API_DATABASE_URL, config/env.ts useApiLogin): é com ele que a api do e2e atende as rotas.
            DATABASE_URL: E2E_DATABASE_URL,
            API_DATABASE_URL: E2E_API_DATABASE_URL,
            ENSAIO_DATABASE_URL: E2E_DATABASE_URL,
            STORAGE_CONNECTION_STRING,
            // o segredo da rota interna de cotações: o mesmo dos sites que a leem (a api em produção recusa o valor de dev do .env.example)
            QUOTES_SECRET,
            // a conta (etapa 11): em produção a api recusa subir sem estas (valores sintéticos, e2e/api-server.ts)
            ...PRODUCTION_ACCOUNT_ENV,
          },
          url: `${API_URL}/api/v1/health`,
          reuseExistingServer: false,
          timeout: 180_000,
        },
        // O quarto e o quinto são a api falsa e o site que a lê (e2e/fixture.spec.ts): o que o banco sintético não tem (temporada sem
        // ciclo, ação sem notícia, erro 500, notícia que muda). O site é o mesmo build, com a api falsa no API_INTERNAL_URL.
        {
          command: 'node e2e/fixture-api.ts',
          env: { FIXTURE_API_PORT: String(FIXTURE_API_PORT), QUOTES_SECRET },
          url: `${FIXTURE_API_URL}/api/v1/health`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: `${CLEAN_CACHE} && node .next/standalone/apps/web/server.js`,
          env: {
            PORT: String(FIXTURE_WEB_PORT),
            HOSTNAME: '127.0.0.1',
            REVALIDATE_SECRET,
            QUOTES_SECRET,
            API_INTERNAL_URL: FIXTURE_API_URL,
          },
          url: `${FIXTURE_WEB_URL}/health`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        // O sexto é a api da conta e do painel de admin (e2e/account-api.spec.ts, e2e/conta.spec.ts e e2e/admin.spec.ts): o mesmo build com
        // NODE_ENV=test, o único modo que liga o remetente falso (EMAIL_OUTBOX_DIR) e o Service Bus falso (SERVICEBUS_FAKE_DIR); em produção
        // a api recusa os dois. Usa o banco já migrado e semeado pela terceira entrada (os servidores sobem em ordem). Cada e-mail vira um
        // arquivo em ACCOUNT_OUTBOX_DIR, que o teste lê para pegar o link; a DLQ falsa e o que a api publicou ficam em ADMIN_BUS_DIR. Porta 4308.
        // Roda atrás da trava de origem, como na Azure (ORIGIN_LOCK e FRONT_DOOR_ID), e com o PUBLIC_URL do Front Door imitado.
        {
          command: `rm -rf "${ACCOUNT_OUTBOX_DIR}" "${ADMIN_BUS_DIR}" && node --enable-source-maps dist/main.js`,
          cwd: '../api',
          env: {
            NODE_ENV: 'test',
            API_PORT: String(ACCOUNT_API_PORT),
            API_HOST: '127.0.0.1',
            // o login de menor privilégio, como a api de cima (o login já foi criado por ela, que sobe antes)
            DATABASE_URL: E2E_DATABASE_URL,
            API_DATABASE_URL: E2E_API_DATABASE_URL,
            STORAGE_CONNECTION_STRING,
            ORIGIN_LOCK: 'front-door',
            FRONT_DOOR_ID,
            QUOTES_SECRET,
            PUBLIC_URL: ACCOUNT_SITE_URL,
            EMAIL_OUTBOX_DIR: ACCOUNT_OUTBOX_DIR,
            EMAIL_SENDER_ADDRESS: 'naoresponda@example.test',
            LEGAL_CONTROLLER_NAME: PRODUCTION_ACCOUNT_ENV.LEGAL_CONTROLLER_NAME,
            LEGAL_CONTACT_EMAIL: PRODUCTION_ACCOUNT_ENV.LEGAL_CONTACT_EMAIL,
            // o painel de admin: a DLQ falsa e o ambiente que o Bicep injeta na api em produção (a versão do prompt e o teto de custo)
            SERVICEBUS_FAKE_DIR: ADMIN_BUS_DIR,
            ...ADMIN_API_ENV,
          },
          url: `${ACCOUNT_API_URL}/api/v1/health`,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        // O sétimo é o site das telas da conta (e2e/conta.spec.ts): o mesmo build, atrás da trava de origem, lendo a api da conta. Porta 4309.
        {
          command: `${CLEAN_CACHE} && node .next/standalone/apps/web/server.js`,
          env: {
            PORT: String(ACCOUNT_WEB_PORT),
            HOSTNAME: '127.0.0.1',
            ORIGIN_LOCK: 'front-door',
            FRONT_DOOR_ID,
            QUOTES_SECRET,
            API_INTERNAL_URL: ACCOUNT_API_URL,
          },
          url: `${ACCOUNT_WEB_URL}/health`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        // O oitavo é o Front Door imitado (e2e/front-door.ts): o único endereço que o navegador das telas da conta conhece. `/api/*` vai
        // para a api da conta, o resto para o site da conta, e ele escreve o X-Azure-FDID, como o de verdade. Porta 4311. Serve https, com um
        // certificado autoassinado gerado na subida (precisa do `openssl`): é o que faz a api da conta emitir o cookie de produção (`Secure`,
        // com o prefixo `__Secure-`) e o WebKit aceitá-lo. O Playwright confere a saúde dele com `ignoreHTTPSErrors`.
        {
          command: 'node e2e/front-door.ts',
          env: {
            FRONT_DOOR_PORT: String(FRONT_DOOR_PORT),
            FRONT_DOOR_API_PORT: String(ACCOUNT_API_PORT),
            FRONT_DOOR_WEB_PORT: String(ACCOUNT_WEB_PORT),
            FRONT_DOOR_ID,
          },
          url: `${FRONT_DOOR_URL}/health`,
          ignoreHTTPSErrors: true,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      ],
});
