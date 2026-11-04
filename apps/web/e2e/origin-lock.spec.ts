import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { FRONT_DOOR_ID, LOCKED_URL } from './locked-server';

// Trava de origem do site (plano 5.4): atrás do Front Door, o Next só atende quem traz o X-Azure-FDID do nosso
// perfil. Estes testes batem no build de produção (standalone) subido com FRONT_DOOR_ID na porta 4303
// (playwright.config.ts). Não rodam contra o site publicado (BASE_URL): lá a trava é do Front Door de verdade.
test.skip(Boolean(process.env.BASE_URL), 'precisa do servidor local com FRONT_DOOR_ID');

const withId = { 'X-Azure-FDID': FRONT_DOOR_ID };

test.describe('trava de origem', () => {
  test('recusa com 403 a requisição sem o cabeçalho, no envelope', async ({ request }) => {
    const response = await request.get(`${LOCKED_URL}/`);
    expect(response.status()).toBe(403);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(await response.json()).toEqual({
      success: false,
      data: null,
      error: { code: 'FORBIDDEN', message: 'Origem não permitida' },
    });
  });

  test('recusa o ID de outro perfil e não repete nenhum ID na resposta', async ({ request }) => {
    const outro = '11111111-2222-4333-8444-555555555555';
    const response = await request.get(`${LOCKED_URL}/`, { headers: { 'X-Azure-FDID': outro } });
    expect(response.status()).toBe(403);
    const body = await response.text();
    expect(body).not.toContain(outro);
    expect(body).not.toContain(FRONT_DOOR_ID);
  });

  test('aceita o ID do perfil, com qualquer caixa', async ({ request }) => {
    for (const value of [FRONT_DOOR_ID, FRONT_DOOR_ID.toUpperCase()]) {
      const response = await request.get(`${LOCKED_URL}/`, { headers: { 'X-Azure-FDID': value } });
      expect(response.status(), value).toBe(200);
      expect(await response.text()).toContain('Alvesting');
    }
  });

  test('o estático do Next também fica atrás da trava', async ({ request }) => {
    const html = await (await request.get(`${LOCKED_URL}/`, { headers: withId })).text();
    const asset = /\/_next\/static\/[^"')\s]+\.(?:js|css)/.exec(html)?.[0];
    expect(asset, 'a home referencia algum arquivo de /_next/static').toBeTruthy();

    expect((await request.get(`${LOCKED_URL}${asset}`)).status()).toBe(403);
    expect((await request.get(`${LOCKED_URL}${asset}`, { headers: withId })).status()).toBe(200);
  });

  test('uma página que não existe também é 403 sem o cabeçalho, 404 com ele', async ({
    request,
  }) => {
    expect((await request.get(`${LOCKED_URL}/nao-existe`)).status()).toBe(403);
    expect((await request.get(`${LOCKED_URL}/nao-existe`, { headers: withId })).status()).toBe(404);
  });

  // O 404 do caminho torto (src/proxy.ts) vem depois da trava e não é exceção: quem não passa por ela recebe 403 em qualquer caminho.
  test('o caminho com percent-encoding inválido é 403 sem o cabeçalho e 404 com ele', async ({
    request,
  }) => {
    for (const path of ['/acoes/%', '/modelos/%zz']) {
      expect((await request.get(`${LOCKED_URL}${path}`)).status(), path).toBe(403);
      expect((await request.get(`${LOCKED_URL}${path}`, { headers: withId })).status(), path).toBe(
        404,
      );
    }
  });

  // O Container Apps sonda o /health sem cabeçalho, e o smoke do deploy chama a revisão direto. É a única exceção.
  test('o /health fica fora da trava, em GET e HEAD, mesmo com query', async ({ request }) => {
    const get = await request.get(`${LOCKED_URL}/health`);
    expect(get.status()).toBe(200);
    expect(await get.json()).toEqual({
      success: true,
      data: { status: 'ok', service: 'web' },
      error: null,
    });
    expect((await request.head(`${LOCKED_URL}/health`)).status()).toBe(200);
    expect((await request.get(`${LOCKED_URL}/health?probe=1`)).status()).toBe(200);
  });

  test('a exceção é só o caminho exato, e só em GET e HEAD', async ({ request }) => {
    for (const path of ['/health/x', '/healthz', '/Health', '/HEALTH', '/api/health']) {
      expect((await request.get(`${LOCKED_URL}${path}`)).status(), path).toBe(403);
    }
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const response = await request[method](`${LOCKED_URL}/health`);
      expect(response.status(), method).toBe(403);
    }
  });
});

// Contrato fail closed (docs/INFRA.md, 3.3): o Bicep injeta ORIGIN_LOCK=front-door nos apps atrás do Front Door.
// Com o ID vazio ou torto o servidor tem de RECUSAR SUBIR, senão o erro de configuração desligaria a trava em silêncio.
test.describe('contrato fail closed (ORIGIN_LOCK)', () => {
  const webDir = fileURLToPath(new URL('..', import.meta.url));

  // Porta livre por execução: os três projetos rodam estes testes ao mesmo tempo.
  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = createServer().once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });

  async function boot(env: { ORIGIN_LOCK?: string; FRONT_DOOR_ID?: string }) {
    return spawnSync('node', ['.next/standalone/apps/web/server.js'], {
      cwd: webDir,
      env: {
        ...process.env,
        PORT: String(await freePort()),
        HOSTNAME: '127.0.0.1',
        ORIGIN_LOCK: undefined,
        FRONT_DOOR_ID: undefined,
        ...env,
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
  }

  test('ORIGIN_LOCK=front-door sem FRONT_DOOR_ID: o servidor recusa subir', async () => {
    for (const env of [
      { ORIGIN_LOCK: 'front-door' },
      { ORIGIN_LOCK: 'front-door', FRONT_DOOR_ID: '' },
    ]) {
      const result = await boot(env);
      expect(result.error, 'o servidor não pode ficar de pé').toBeUndefined();
      expect(result.status).toBeGreaterThan(0);
      expect(result.stderr).toContain('exige FRONT_DOOR_ID');
    }
  });

  test('FRONT_DOOR_ID que não é GUID: o servidor recusa subir, sem repetir o valor', async () => {
    const result = await boot({ FRONT_DOOR_ID: 'PENDENTE-segredo-que-nao-e-guid' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toContain('FRONT_DOOR_ID inválido');
    expect(result.stderr).not.toContain('PENDENTE-segredo-que-nao-e-guid');
  });

  test('ORIGIN_LOCK com valor desconhecido: o servidor recusa subir', async () => {
    const result = await boot({ ORIGIN_LOCK: 'desligado', FRONT_DOOR_ID });
    expect(result.error).toBeUndefined();
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toContain('ORIGIN_LOCK inválido');
  });
});
