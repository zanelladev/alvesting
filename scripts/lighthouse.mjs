// pnpm lighthouse: Lighthouse CI (mobile) na home do build local. Metas do plano (§13): LCP <= 2,5 s, CLS <= 0,1 e TBT <= 200 ms, na mediana
// de 5 execuções (apps/web/lighthouserc.json). Rode `pnpm build` antes.
// A home lê a api (etapa 9), então o script sobe uma: semeia o banco do e2e com a temporada sintética do ensaio (a mesma que o Playwright
// usa, sem rede e sem dado de terceiro: docs/ENSAIO.md), sobe a api compilada numa porta própria e passa o endereço ao site, que o lhci
// sobe na 4302. Precisa do Postgres e do Azurite do docker compose, como o e2e. A api cai no fim, passe ou falhe a medição.
// O Lighthouse usa o Chromium que o Playwright já baixou (docs/DEPENDENCIAS.md): nenhum navegador a mais.
// Sem emulação extra: o Lighthouse já testa como celular (tela pequena, CPU 4x mais lenta e rede 4G lenta).
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
// as mesmas constantes do e2e (banco descartável, Azurite): o Node tira os tipos do .ts sozinho
import {
  E2E_API_DATABASE_URL,
  E2E_DATABASE_URL,
  PRODUCTION_ACCOUNT_ENV,
  QUOTES_SECRET,
  STORAGE_CONNECTION_STRING,
} from '../apps/web/e2e/api-server.ts';

const web = new URL('../apps/web/', import.meta.url);
const api = new URL('../apps/api/', import.meta.url);
const { chromium } = createRequire(new URL('package.json', web))('@playwright/test');

// Porta própria da api desta medição: a do e2e (4304) e a do `pnpm dev` (4310) podem estar em uso.
const API_PORT = 4307;
const API_URL = `http://127.0.0.1:${API_PORT}`;

const portInUse = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

async function waitForApi(server) {
  for (let i = 0; i < 120; i += 1) {
    if (server.exitCode !== null) throw new Error('a api saiu antes de responder');
    try {
      if ((await fetch(`${API_URL}/api/v1/health`)).ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('a api não respondeu em 60 s');
}

if (await portInUse(API_PORT)) {
  console.error(`A porta ${API_PORT} está ocupada: encerre o processo que a usa e rode de novo.`);
  process.exit(2);
}

// Dentro do ensaio (NODE_ENV=development, que ele exige) o banco é recriado; depois a api sobe em produção, como no e2e.
const seed = spawnSync('node', ['--enable-source-maps', 'dist/ensaio-cli.js'], {
  cwd: api,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    ENSAIO_DATABASE_URL: E2E_DATABASE_URL,
    STORAGE_CONNECTION_STRING,
  },
});
if (seed.status !== 0) {
  console.error(
    'O ensaio que semeia o banco falhou: o Postgres e o Azurite do compose estão no ar?',
  );
  process.exit(seed.status ?? 1);
}

// O login de menor privilégio da api (ADR 0028): a api em produção só sobe com ele, então o comando que o cria roda aqui, com o administrador
// e em NODE_ENV=development (a senha de dev que ele cria a produção recusa), como o playwright.config.ts faz.
const roles = spawnSync('node', ['--enable-source-maps', 'dist/db-roles-cli.js'], {
  cwd: api,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: E2E_DATABASE_URL,
    API_DATABASE_URL: E2E_API_DATABASE_URL,
  },
});
if (roles.status !== 0) {
  console.error('O comando que cria o login da api no banco (db:roles) falhou.');
  process.exit(roles.status ?? 1);
}

const server = spawn('node', ['--enable-source-maps', 'dist/main.js'], {
  cwd: api,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    API_PORT: String(API_PORT),
    API_HOST: '127.0.0.1',
    // o administrador cria o login (acima); o papel HTTP troca o DATABASE_URL pelo login de menor privilégio (config/env.ts, useApiLogin)
    DATABASE_URL: E2E_DATABASE_URL,
    API_DATABASE_URL: E2E_API_DATABASE_URL,
    STORAGE_CONNECTION_STRING,
    // o segredo da rota interna de cotações (a home lê o BOVA11 por ela): o mesmo do site abaixo
    QUOTES_SECRET,
    // a conta (etapa 11): em produção a api recusa subir sem estas (valores sintéticos, os mesmos do e2e)
    ...PRODUCTION_ACCOUNT_ENV,
  },
});

try {
  await waitForApi(server);
  const result = spawnSync('pnpm', ['exec', 'lhci', 'autorun'], {
    cwd: web,
    stdio: 'inherit',
    env: {
      ...process.env,
      CHROME_PATH: chromium.executablePath(),
      API_INTERNAL_URL: API_URL,
      QUOTES_SECRET,
    },
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  server.kill();
}
