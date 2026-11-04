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
  // ponytail: `inlineCss` é experimental no Next 16.4 (node_modules/next/dist/docs, inlineCss.md). O CSS (uns 5 KB comprimidos) vai dentro do HTML, e o
  // navegador não pede a folha de estilo: no Lighthouse mobile da home isso, junto com a Plex Sans de um peso só (layout.tsx), tira o LCP simulado
  // de 2,49 s para 2,34 s (docs/TELAS.md, seção 5), a diferença entre passar com folga e reprovar a cada segunda execução; sozinha, cada uma não muda
  // nada. O custo: o CSS não fica em cache entre páginas e vai três vezes no documento da home (o <style> do <head> e duas vezes no payload do React).
  // Se a flag der problema numa versão nova do Next, remova-a e meça de novo com `pnpm lighthouse`.
  experimental: { inlineCss: true },
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

// Só no `pnpm dev`: o navegador fala com uma origem só (docs/CONTA.md, seção 9). Na Azure o Front Door manda `/api/*` para a api e o
// resto para o site; em dev o site (4300) e a api (4310) têm portas diferentes, e sem isto o cookie da sessão, o `Origin` que a api
// confere e o link do e-mail (`PUBLIC_URL/api/auth/...`) não fecham. O `rewrites` repassa `/api/*` à api. Fica de fora do build e do
// servidor de produção (`nextConfig` só o põe na fase de desenvolvimento): o site publicado nunca repassa nada à api, e o e2e usa um
// Front Door imitado (apps/web/e2e/front-door.ts) em vez deste caminho.
export function devRewrites(env: Record<string, string | undefined>) {
  const base = env.API_INTERNAL_URL ?? 'http://127.0.0.1:4310';
  if (!URL.canParse(base) || !/^https?:$/.test(new URL(base).protocol)) {
    throw new Error('API_INTERNAL_URL inválida: o rewrites de /api em dev não sabe para onde ir');
  }
  return [{ source: '/api/:path*', destination: `${new URL(base).origin}/api/:path*` }];
}

export default function nextConfig(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return config;
  loadDevEnv(
    ['.env.local', '.env.example'].map((name) => new URL(`../../${name}`, import.meta.url)),
  );
  return { ...config, rewrites: () => Promise.resolve(devRewrites(process.env)) };
}
