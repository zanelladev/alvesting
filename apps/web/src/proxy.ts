import { NextResponse, type NextRequest } from 'next/server';
import { fail } from '@alvesting/contracts';
import { REVALIDATE_PATH, hasValidRevalidateSecret } from './lib/cache';

// Trava de origem (plano 5.4, ADR 0018): atrás do Front Door, o site só atende quem traz o X-Azure-FDID do nosso perfil.
// O Front Door anexa esse cabeçalho a toda requisição que repassa à origem (Microsoft Learn, "Secure traffic
// to Azure Front Door origins"). Private Link, que fecharia a origem na rede, só existe no Premium (ADR 0003).
// FRONT_DOOR_ID vem do segredo front-door-id do Key Vault. Sem ele (dev, teste e perfil econômico) a trava não
// existe. Sem `matcher`, este proxy roda em toda requisição, inclusive /_next/static, /_next/image e public/.
//
// /health fica de fora, e é a única exceção. Os probes do Container Apps batem direto na porta do contêiner e
// nunca trazem o cabeçalho; o smoke do deploy chama a URL da revisão sem passar pelo Front Door; e a documentação
// do probe do Front Door (Learn, "Health probes") só diz que ele manda `User-Agent: Edge Health Probe`, não que
// manda o X-Azure-FDID. Sem a exceção, a origem seria dada como doente. Não abre brecha: o caminho é exato, só
// GET e HEAD, e a resposta é um JSON fixo que já é público pelo Front Door. A mesma regra vale na API
// (apps/api/src/common/origin-lock.ts).
//
// A outra exceção é a revalidação do worker (ADR 0018, docs/INFRA.md, 3.3): POST no caminho exato /interno/revalidar COM o
// REVALIDATE_SECRET válido em `Authorization: Bearer`. O worker chama o ingress do site direto, sem o Front Door, e não recebe o
// FRONT_DOOR_ID, então não traz o X-Azure-FDID. O segredo vale só para essa rota e esse método: com ele, qualquer outro caminho,
// ou GET nesse, continua 403. A rota confere o segredo de novo (defesa em profundidade).
//
// Não é uma exceção, e vem depois da trava: o caminho com um "%" que não é percent-encoding (`/acoes/%`, `/modelos/%zz`) é 404, e
// não o 500 sem corpo que o Next dá ao decodificar o parâmetro das rotas dinâmicas (sem log, e um scanner o repetiria às dezenas).
// Quem não passa pela trava recebe 403 em qualquer caminho, torto ou não.
export function proxy(request: NextRequest) {
  const expected = process.env.FRONT_DOOR_ID?.toLowerCase();
  const { pathname } = request.nextUrl;

  if (expected) {
    const isProbe =
      (request.method === 'GET' || request.method === 'HEAD') && pathname === '/health';
    const isRevalidation =
      request.method === 'POST' &&
      pathname === REVALIDATE_PATH &&
      hasValidRevalidateSecret(request.headers, process.env.REVALIDATE_SECRET);
    if (
      !isProbe &&
      !isRevalidation &&
      request.headers.get('x-azure-fdid')?.toLowerCase() !== expected
    ) {
      return NextResponse.json(fail('FORBIDDEN', 'Origem não permitida'), {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }

  try {
    decodeURIComponent(pathname);
  } catch {
    return NextResponse.json(fail('NOT_FOUND', 'Página não encontrada'), {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return NextResponse.next();
}
