import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

// Raiz do monorepo: o rastreamento do standalone leva só o que o web usa dos workspaces
// (@alvesting/contracts), e o Turbopack precisa enxergar os pacotes fora de apps/web.
const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Cabeçalhos de toda resposta do site. O CSP leva o frame-ancestors (nenhum site embute a página) e três diretivas que não pedem nonce
// (as telas da conta têm formulário de senha e ação sem volta): base-uri (um <base> injetado não redireciona os caminhos relativos, nem
// o fetch('/api/auth/…')), form-action (um <form> injetado não manda a senha para fora) e object-src (sem <object> nem <embed>). Um CSP
// com script-src exigiria nonce, porque o Next injeta scripts inline na hidratação.
// O Strict-Transport-Security vale só em https (o navegador o ignora em http, então dev e e2e não mudam): sem ele, o navegador só aprende
// a política depois da primeira resposta de /api/*, isto é, depois do primeiro envio de formulário, e quem digita a senha numa rede que
// derruba o TLS na primeira visita à tela de entrar não estaria protegido. Sem includeSubDomains nem preload: o host é o do Front Door.
// O Cache-Control do HTML não importa para a borda: a rota /* do Front Door não tem cache (infra/modules/frontdoor.bicep), então a
// página nunca é guardada lá, e o que ela mostra vem do cache de dados do Next (src/lib/api.ts), revalidado depois de cada
// liquidação. Só o estático (/_next/static/*) e a API pública têm cache na borda (docs/API.md).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  poweredByHeader: false,
  // O CSS vai em arquivo, e não dentro do HTML. Na etapa 9 o `experimental.inlineCss` (uns 5 KB comprimidos) ajudou o LCP simulado da home;
  // com o sistema visual ascii-ui (ADR 0034) o CSS passou de uns 9 KB comprimidos, e em linha ele ia três vezes no documento da home (o
  // <style> do <head> e duas vezes no payload do React): 57,8 KB no fio contra 30,8 KB em arquivo, sem ganho no LCP (docs/TELAS.md, seção
  // 5). Em arquivo, o CSS fica em cache entre as páginas.
  reactStrictMode: true,
  // O `next dev` escreve um AGENTS.md em apps/web para quem usa agente de código. As regras do repositório estão no CLAUDE.md.
  agentRules: false,
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      // O link da redefinição de senha leva o token na URL (?token=): a página responde sem Referer, para o token não ir a nenhum recurso
      // que ela carregue. Vem depois da regra geral, porque a última regra que casa com a mesma chave vence
      // (node_modules/next/dist/docs, next.config.js/headers.md, "Header Overriding Behavior").
      { source: '/redefinir-senha', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      // O logo de um papel (src/app/logos; ADR 0036, "Como o site mostra") é imagem, nunca documento: sai com a CSP dos logos do contrato
      // (LOGO_HEADERS, packages/contracts/src/internal.ts), que deixa o SVG aberto direto na aba inerte (`sandbox`, nenhum script, nada de
      // fora). A rota manda a mesma, mas o Next só põe o cabeçalho da rota quando a config não pôs o mesmo antes
      // (node_modules/next/dist/server/send-response.js), e a CSP geral venceria: a regra vem depois da geral, e a última vence. Um segmento
      // só, o arquivo da rota: a página 404 do Next em /logos e em /logos/a/b segue com a CSP geral (e com o CSS dela).
      {
        source: '/logos/:arquivo',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
          },
        ],
      },
    ]),
};

// Só no `pnpm dev`: o site lê o .env.local e o .env.example da raiz, como a API, porque o Next só lê os .env de apps/web. Mas só as
// variáveis que o site usa: o .env.local também guarda o prompt da arena e a chave do OpenRouter (CLAUDE.md, regra 4), que não são do
// site, e um console.log(process.env) ou o despejo de erro de uma tela os levaria. O .env.local vence o exemplo, o que já está no
// ambiente vence os dois, e em branco (VAR=) vale como ausente. No build e na imagem nada é lido: a configuração vem do ambiente do
// processo (docs/INFRA.md, 2.7).
export const DEV_ENV_VARIABLES = [
  'API_INTERNAL_URL',
  'REVALIDATE_SECRET',
  'QUOTES_SECRET',
  'FRONT_DOOR_ID',
] as const;

export function loadDevEnv(
  files: readonly URL[],
  env: Record<string, string | undefined> = process.env,
): void {
  for (const file of files) {
    if (!existsSync(file)) continue;
    const values = parseEnv(readFileSync(file, 'utf8'));
    for (const name of DEV_ENV_VARIABLES) {
      if (env[name] === undefined && values[name]) env[name] = values[name];
    }
  }
}

// Só no `pnpm dev`: o navegador fala com uma origem só (docs/CONTA.md, seção 9). Em dev o site (4300) e a api (4310) têm portas diferentes,
// e sem um repasse o cookie da sessão, o `Origin` que a api confere e o link do e-mail (`PUBLIC_URL/api/auth/...`) não fecham. Quem repassa
// `/api/*` é o mesmo código do perfil econômico (src/lib/api-proxy.ts, no proxy.ts; ADR 0039), ligado aqui por API_PROXY=on: o dev exercita o
// caminho de produção (o bloqueio de /api/v1/interno/*, o X-Forwarded-For regravado). No build e na imagem nada disto roda: lá o repasse liga
// pelo ambiente do processo (o Bicep põe API_PROXY só no econômico; no padrão quem manda /api/* à api é o Front Door).
export const DEV_API_URL = 'http://127.0.0.1:4310';

export function devApiProxy(env: Record<string, string | undefined> = process.env): void {
  env.API_PROXY = 'on';
  env.API_INTERNAL_URL ||= DEV_API_URL;
}

export default function nextConfig(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return config;
  loadDevEnv(
    ['.env.local', '.env.example'].map((name) => new URL(`../../${name}`, import.meta.url)),
  );
  devApiProxy();
  // sem o círculo "N" do Next no canto: todo canto da casca tem algo (o "Conta" do trilho, a barra de abas do celular, o
  // "Entrar" da landing); os erros de compilação e de execução continuam aparecendo (documentação do devIndicators, Next 16)
  return { ...config, devIndicators: false };
}
