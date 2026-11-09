import { tmpdir } from 'node:os';
import path from 'node:path';

// Servidor da api do e2e local (playwright.config.ts): o build de produção, apps/api/dist, sem a trava de origem.
// Porta própria. Atrás do Front Door a api divide a origem do site (/api/* vai para ela); aqui, não. Este arquivo guarda também
// o que a api do e2e precisa (banco e Azurite) e o segredo da revalidação dos servidores do site.
export const API_PORT = 4304;
export const API_URL = `http://127.0.0.1:${API_PORT}`;

// O banco do e2e (etapa 9): descartável (o nome termina em _test), recriado e semeado a cada subida da api com uma temporada
// inteira e SINTÉTICA, pelo driver do ensaio (docs/ENSAIO.md): mercado, notícias, macro e decisões inventados, nenhum dado de
// terceiro. Sobe no Postgres e no Azurite do docker compose (local) ou do job (CI): as mesmas portas e credenciais. As duas variáveis
// abaixo trocam o padrão; pelo `pnpm test:e2e` (turbo, ambiente estrito) elas chegam porque estão em turbo.json.
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://alvesting:alvesting@localhost:25432/alvesting_e2e_test';

// A api do e2e roda com o login de MENOR PRIVILÉGIO do Postgres (papel mínimo, onda 3d; docs/INFRA.md, 2.7; ADR 0028), e não com o
// administrador: assim os e2e das telas e do painel provam as permissões de verdade, e o banco recusa o que a api não pode. O semear (o
// ensaio) e o comando que cria o login seguem com o administrador acima. Mesmo servidor e banco, com a senha de dev do .env.example.
export const E2E_API_DATABASE_URL = (() => {
  const url = new URL(E2E_DATABASE_URL);
  url.username = 'alvesting_api';
  url.password = 'alvesting_api';
  return url.toString();
})();
export const STORAGE_CONNECTION_STRING =
  process.env.STORAGE_CONNECTION_STRING ??
  'UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://127.0.0.1:25100';

// O REVALIDATE_SECRET dos servidores do site no e2e (e2e/revalidate.spec.ts, e2e/fixture.spec.ts): o mesmo que o worker manda em produção.
// Sintético; nada aqui é segredo de verdade.
export const REVALIDATE_SECRET = 'segredo-sintetico-do-e2e-para-a-revalidacao-0123456789';

// O QUOTES_SECRET do e2e (docs/API.md, seção 6; ADR 0033): o mesmo valor nas apis (4304 e 4308) e nos sites que as leem (4301, 4303, 4309) e
// na api falsa (4306) com o seu site (4305). Sintético, diferente do valor de dev do .env.example (a api em produção recusa esse). Os testes o
// usam para pedir a rota interna direto e para provar que ele não aparece em página, script nem cache do site.
export const QUOTES_SECRET = 'segredo-sintetico-do-e2e-para-as-cotacoes-0123456789abcdef';

// A api falsa e o segundo site do e2e das telas (e2e/fixture-api.ts, e2e/fixture.spec.ts): o site lê a api falsa, que responde o que o
// banco sintético não tem (temporada sem ciclo, ação sem notícia, erro 500, notícia que muda). Portas próprias.
export const FIXTURE_API_PORT = 4306;
export const FIXTURE_API_URL = `http://127.0.0.1:${FIXTURE_API_PORT}`;
export const FIXTURE_WEB_PORT = 4305;
export const FIXTURE_WEB_URL = `http://127.0.0.1:${FIXTURE_WEB_PORT}`;

// A conta (etapa 11, docs/CONTA.md). A api do e2e acima roda com NODE_ENV=production, e o contrato de produção da conta pede estas
// variáveis (a api recusa subir sem elas): valores SINTÉTICOS, o Communication Services nunca é chamado (nenhum teste desta api
// manda e-mail; o remetente falso não liga em produção).
export const PRODUCTION_ACCOUNT_ENV = {
  PUBLIC_URL: 'https://alvesting.example.test',
  BETTER_AUTH_SECRET: 'segredo-sintetico-do-e2e-para-a-conta-9f3k2m7q1x8z5w4v',
  ACS_CONNECTION_STRING: 'endpoint=https://acs-e2e.example.test/;accesskey=c2ludGV0aWNv',
  EMAIL_SENDER_ADDRESS: 'DoNotReply@e2e.example.test',
  LEGAL_CONTROLLER_NAME: 'Controlador do e2e',
  LEGAL_CONTACT_EMAIL: 'privacidade@example.test',
};

// A segunda api do e2e, a das telas e dos fluxos da conta (e2e/account-api.spec.ts e e2e/conta.spec.ts): o mesmo build, mas com
// NODE_ENV=test, porque é o único jeito de ligar o remetente falso (EMAIL_OUTBOX_DIR), que cada e-mail grava num arquivo desta pasta,
// e o teste lê o link de lá. Em produção o remetente falso não existe. Sobe DEPOIS da api semeada (o Playwright sobe os servidores em
// ordem) e usa o mesmo banco, que já está migrado.
//
// Ela roda como na Azure, atrás do Front Door: com a trava de origem (`ORIGIN_LOCK=front-door` e o `FRONT_DOOR_ID` do e2e) e com o
// PUBLIC_URL do Front Door imitado (e2e/front-door.ts), que é https: o cookie, o Origin e o link do e-mail saem dele. Atrás da trava o IP
// do limite de tentativas do Better Auth é o `X-Azure-SocketIP`, e o teste escolhe o dele (os três projetos, em paralelo, dividiriam o
// 127.0.0.1 e tomariam 429).
export const ACCOUNT_API_PORT = 4308;
export const ACCOUNT_API_URL = `http://127.0.0.1:${ACCOUNT_API_PORT}`;
export const ACCOUNT_OUTBOX_DIR = path.join(tmpdir(), 'alvesting-e2e-outbox');

// O site das telas da conta (4309): o mesmo build do site, com a trava de origem e a api da conta (4308) no API_INTERNAL_URL. O navegador
// nunca fala com ele nem com a api: fala com o Front Door imitado (4311), que manda `/api/*` para a api e o resto para este site.
// A 4310 é a da api do `pnpm dev`, por isso o salto.
//
// O Front Door imitado serve https, com um certificado autoassinado gerado na subida (e2e/front-door.ts): como na Azure, a conta roda
// em https, e é só assim que o e2e exercita o cookie de produção (`Secure`, com o prefixo `__Secure-`) em Chromium e em WebKit, que
// descarta um `__Secure-` vindo de http. Por isso os testes que falam com ele abrem os contextos com `ignoreHTTPSErrors`.
export const ACCOUNT_WEB_PORT = 4309;
export const ACCOUNT_WEB_URL = `http://127.0.0.1:${ACCOUNT_WEB_PORT}`;
export const FRONT_DOOR_PORT = 4311;
export const FRONT_DOOR_URL = `https://127.0.0.1:${FRONT_DOOR_PORT}`;
export const ACCOUNT_SITE_URL = FRONT_DOOR_URL;

// O painel de admin (etapa 10, parte 2; docs/TELAS.md, seção 8) roda sobre a mesma api da conta (4308), que no e2e ganha duas coisas: o
// Service Bus FALSO, uma pasta com a DLQ e a publicação (apps/api/src/modules/messaging/infrastructure/fake-service-bus.ts; o emulador do
// Service Bus não cabe na máquina), e a versão do prompt e o teto de custo do mês, que o Bicep injeta na api em produção. Sintéticos.
// <pasta>/<fila>/dead/<nome>.json é uma mensagem na DLQ e <pasta>/<fila>/active/<nome>.json é o que a api publicou.
export const ADMIN_BUS_DIR = path.join(tmpdir(), 'alvesting-e2e-bus');
export const ADMIN_API_ENV = {
  PROMPT_ARENA_VERSION: '0123456789abcdef0123456789abcdef',
  ARENA_MONTHLY_COST_CAP_USD: '40',
};

// O perfil econômico (ADR 0039): sem Front Door, o navegador fala com o SITE, que repassa /api/* à api (API_PROXY=on, src/lib/api-proxy.ts), e
// a api só é alcançada por ele. Três servidores, nas portas 4312 a 4314 (e2e/economico.spec.ts): a api, com NODE_ENV=test como a da conta (o
// remetente falso), mas SEM a trava de origem (sem Front Door o IP do limite de tentativas vem do X-Forwarded-For); o site, o mesmo build com o
// repasse ligado; e o ingress imitado do Container Apps (e2e/ingress.ts), em https, que termina o TLS e acrescenta o IP do cliente ao
// X-Forwarded-For. O PUBLIC_URL da api é o do ingress: o cookie, o Origin e o link do e-mail saem dele.
export const ECO_API_PORT = 4312;
export const ECO_API_URL = `http://127.0.0.1:${ECO_API_PORT}`;
export const ECO_WEB_PORT = 4313;
export const ECO_WEB_URL = `http://127.0.0.1:${ECO_WEB_PORT}`;
export const ECO_INGRESS_PORT = 4314;
export const ECO_SITE_URL = `https://127.0.0.1:${ECO_INGRESS_PORT}`;
export const ECO_OUTBOX_DIR = path.join(tmpdir(), 'alvesting-e2e-eco-outbox');
export const ECO_BUS_DIR = path.join(tmpdir(), 'alvesting-e2e-eco-bus');
