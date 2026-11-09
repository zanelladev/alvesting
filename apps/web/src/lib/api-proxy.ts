import { isIP } from 'node:net';
import { NextResponse, type NextRequest } from 'next/server';
import { fail } from '@alvesting/contracts';

// O repasse de /api/* à api pelo próprio site (ADR 0039; docs/INFRA.md, 2.7). Sem Front Door (o perfil econômico), é o que dá ao navegador
// uma origem só: os formulários da conta chamam /api/auth/* no site, a carteira escreve em /api/v1/me/portfolio/lots, e o link do e-mail é
// PUBLIC_URL/api/auth/.... A api tem ingress INTERNO e só o site a alcança. Liga só com API_PROXY=on, que o Bicep põe no econômico (e o
// `pnpm dev`, next.config.ts); sem ela nada muda (no padrão quem manda /api/* à api é o Front Door).
//
// É um rewrite para outra origem, resolvido a cada requisição (o `rewrites` do next.config seria fixado no build, e a imagem é uma só para os
// dois perfis). O Next o faz como proxy HTTP (node_modules/next/dist/server/lib/router-utils/proxy-request.js, httpxy com
// changeOrigin): o Host vira o da api (o ingress do Container Apps escolhe o app pelo Host), o X-Forwarded-Host leva o do site, e o corpo, o
// status e os cabeçalhos da resposta (o Set-Cookie e o Location dos 302 do verify-email e do callback do Google) voltam como vieram: o
// proxy não segue redirecionamento nem reescreve cookie. O Origin também segue como veio, e a api continua conferindo-o (Better Auth).
//
// Duas regras que a borda faria:
//  - nunca leva /api/v1/interno/* (as barras, a fita e os logos que só o SSR do site lê, com o segredo das cotações): 404, igual ao da rota que
//    não existe na api, como o BlockInterno do WAF no padrão. O caminho é conferido decodificado (até o que vem codificado duas vezes) e sem
//    diferença de caixa, e o que vai à api é o mesmo caminho que foi conferido;
//  - regrava o X-Forwarded-For com a entrada da DIREITA, a única que o ingress do Container Apps escreve ("Only the rightmost IP is
//    provided by Azure Container Apps. Any other values must be validated by the user to prevent IP spoofing": Learn, "Ingress in Azure
//    Container Apps"). O Better Auth só confia num X-Forwarded-For de um valor só (getIPFromHeader, @better-auth/core/utils/ip): é o IP do
//    limite de tentativas do login, e o que o cliente escreveu à esquerda não pode virar um balde novo. O ingress interno da api acrescenta
//    o IP do site à direita, e a api o pula como proxy confiável (auth.ts, trustedProxies).

const isApiPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

// /api/v1/interno/fita, /api/v1/INTERNO/fita, /api/v1/%69nterno/fita, /api/v1/%2569nterno/fita... O segmento `interno` em qualquer
// lugar do caminho. O que não decodifica é bloqueado também (o primeiro nível o proxy.ts já recusa com 404).
function isInternalPath(pathname: string): boolean {
  let path = pathname;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return true;
    }
    if (decoded === path) break;
    path = decoded;
  }
  return /(^|\/)interno(\/|$)/i.test(path);
}

// A entrada da direita do X-Forwarded-For, se for um IP; senão nenhuma.
export function rightmostClientIp(header: string | null): string | undefined {
  const last = header?.split(',').at(-1)?.trim();
  return last && isIP(last) ? last : undefined;
}

const noStore = { 'Cache-Control': 'no-store' };

// O endereço da api, ou nada: só http(s), e só a origem (caminho e query do endereço não entram).
function apiOrigin(base: string | undefined): string | undefined {
  if (!base || !URL.canParse(base)) return undefined;
  const url = new URL(base);
  return /^https?:$/.test(url.protocol) ? url.origin : undefined;
}

export function forwardToApi(request: NextRequest): NextResponse | undefined {
  if (process.env.API_PROXY !== 'on') return undefined;
  const { pathname, search } = request.nextUrl;
  if (!isApiPath(pathname)) return undefined;
  if (isInternalPath(pathname)) {
    // a mesma frase do 404 do roteador do Nest (e do QuotesSecretGuard): a resposta não confirma que a rota existe
    return NextResponse.json(fail('NOT_FOUND', `Cannot ${request.method} ${pathname}${search}`), {
      status: 404,
      headers: noStore,
    });
  }
  const origin = apiOrigin(process.env.API_INTERNAL_URL);
  if (!origin) {
    // o instrumentation-node.ts recusa subir assim em produção; aqui é a defesa do dev e do teste
    return NextResponse.json(fail('UNAVAILABLE', 'API indisponível'), {
      status: 503,
      headers: noStore,
    });
  }
  const headers = new Headers(request.headers);
  const client = rightmostClientIp(headers.get('x-forwarded-for'));
  if (client) headers.set('x-forwarded-for', client);
  else headers.delete('x-forwarded-for');
  return NextResponse.rewrite(new URL(`${pathname}${search}`, origin), { request: { headers } });
}
