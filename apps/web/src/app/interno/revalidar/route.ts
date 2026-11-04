import { revalidateTag } from 'next/cache';
import { fail, ok } from '@alvesting/contracts';
import { CACHE_TAGS, hasValidRevalidateSecret, isRevalidateSecretUsable } from '../../../lib/cache';

// A revalidação que o worker pede depois de cada liquidação (plano §5.5 e §7; docs/JOBS.md, 4.2). Só POST, e só com o
// REVALIDATE_SECRET em `Authorization: Bearer`. Vence as tags de cache de dados do site (lib/cache.ts): a próxima leitura de cada
// página busca o dado novo na API, sem servir o velho. `{ expire: 0 }` porque quem chama é um serviço, e não uma ação do
// usuário (docs do Next 16.4, revalidateTag): o `updateTag` só existe em Server Action.
//
// O proxy (src/proxy.ts) deixa esta rota passar sem o X-Azure-FDID quando o segredo é o certo, porque o worker chama o ingress
// direto, sem o Front Door. Aqui o segredo é conferido de novo: sem REVALIDATE_SECRET no ambiente (ou curto demais, lib/cache.ts)
// a rota fecha para todos (503).
const NO_STORE = { 'Cache-Control': 'no-store' };

export function POST(request: Request): Response {
  const secret = process.env.REVALIDATE_SECRET;
  if (!isRevalidateSecretUsable(secret)) {
    return Response.json(fail('UNAVAILABLE', 'Revalidação desligada'), {
      status: 503,
      headers: NO_STORE,
    });
  }
  if (!hasValidRevalidateSecret(request.headers, secret)) {
    return Response.json(fail('UNAUTHORIZED', 'Segredo inválido'), {
      status: 401,
      headers: { ...NO_STORE, 'WWW-Authenticate': 'Bearer' },
    });
  }
  for (const tag of CACHE_TAGS) revalidateTag(tag, { expire: 0 });
  return Response.json(ok({ revalidated: [...CACHE_TAGS] }), { headers: NO_STORE });
}
