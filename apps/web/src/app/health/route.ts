import { ok, type Health } from '@alvesting/contracts';

// Sonda do Front Door e smoke de deploy. Mesmo contrato do /health da API, com service "web".
export const dynamic = 'force-dynamic';

export function GET() {
  const health = { status: 'ok', service: 'web' } satisfies Health;
  return Response.json(ok(health), { headers: { 'Cache-Control': 'no-store' } });
}
