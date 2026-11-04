import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { REVALIDATE_SECRET } from './api-server';
import { FRONT_DOOR_ID, LOCKED_URL } from './locked-server';

// A rota que o worker chama depois de cada liquidação (docs/INFRA.md, 3.3; docs/API.md): POST /interno/revalidar, que só aceita
// o REVALIDATE_SECRET e vence as tags de cache de dados do site. Estes testes batem no build de produção (standalone) subido com
// o segredo, na porta do e2e (4301, sem a trava de origem) e na 4303 (com a trava ligada). Não rodam contra o site publicado
// (BASE_URL): lá o segredo é o do Key Vault.
test.skip(Boolean(process.env.BASE_URL), 'precisa dos servidores locais com REVALIDATE_SECRET');

const PATH = '/interno/revalidar';
const bearer = (secret: string) => ({ Authorization: `Bearer ${secret}` });

test.describe('POST /interno/revalidar (sem a trava de origem)', () => {
  test('com o segredo certo revalida as tags e responde no envelope, sem cache', async ({
    request,
  }) => {
    const response = await request.post(PATH, { headers: bearer(REVALIDATE_SECRET) });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: { revalidated: ['arena', 'news'] },
      error: null,
    });
  });

  test('sem o segredo, ou com outro, é 401 no envelope e nada é revalidado', async ({
    request,
  }) => {
    const wrong: Array<Record<string, string>> = [
      {},
      bearer(''),
      bearer('errado'),
      // o mesmo segredo com um caractere a mais ou a menos: o tamanho não pode ser a pista
      bearer(`${REVALIDATE_SECRET}x`),
      bearer(REVALIDATE_SECRET.slice(0, -1)),
      bearer(REVALIDATE_SECRET.toUpperCase()),
      // outro esquema de autorização, ou o segredo sem o "Bearer"
      { Authorization: `Basic ${REVALIDATE_SECRET}` },
      { Authorization: REVALIDATE_SECRET },
      { Authorization: `Bearer ${REVALIDATE_SECRET} extra` },
      // o segredo em outro cabeçalho não vale
      { 'X-Revalidate-Secret': REVALIDATE_SECRET },
    ];
    for (const headers of wrong) {
      const response = await request.post(PATH, { headers });
      expect(response.status(), JSON.stringify(headers)).toBe(401);
      expect(response.headers()['cache-control']).toBe('no-store');
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({
        success: false,
        data: null,
        error: { code: 'UNAUTHORIZED' },
      });
      expect(body).not.toContain(REVALIDATE_SECRET);
    }
  });

  test('o segredo na URL (query) não vale: a URL vai para o log', async ({ request }) => {
    const response = await request.post(`${PATH}?secret=${REVALIDATE_SECRET}`);
    expect(response.status()).toBe(401);
  });

  test('só POST: os outros métodos não revalidam nada', async ({ request }) => {
    for (const method of ['get', 'put', 'patch', 'delete'] as const) {
      const response = await request[method](PATH, { headers: bearer(REVALIDATE_SECRET) });
      expect(response.status(), method).toBe(405);
    }
  });
});

test.describe('a trava de origem deixa passar só essa rota, e só com o segredo válido', () => {
  const withFdid = { 'X-Azure-FDID': FRONT_DOOR_ID };

  test('POST com o segredo certo e sem o X-Azure-FDID passa (é a chamada interna do worker)', async ({
    request,
  }) => {
    const response = await request.post(`${LOCKED_URL}${PATH}`, {
      headers: bearer(REVALIDATE_SECRET),
    });
    expect(response.status()).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({ success: true });
  });

  test('sem o X-Azure-FDID e sem o segredo certo é 403 da trava, não 401 da rota', async ({
    request,
  }) => {
    for (const headers of [{}, bearer('errado'), bearer(`${REVALIDATE_SECRET}x`), bearer('')]) {
      const response = await request.post(`${LOCKED_URL}${PATH}`, { headers });
      expect(response.status(), JSON.stringify(headers)).toBe(403);
      expect(await response.json()).toEqual({
        success: false,
        data: null,
        error: { code: 'FORBIDDEN', message: 'Origem não permitida' },
      });
    }
  });

  test('o segredo certo não abre mais nada: outra rota, outro método e outro caminho continuam 403', async ({
    request,
  }) => {
    const headers = bearer(REVALIDATE_SECRET);
    for (const path of [
      '/',
      '/health/x',
      '/interno',
      '/interno/outra',
      `${PATH}/x`,
      '/INTERNO/REVALIDAR',
      `/x${PATH}`,
    ]) {
      const response = await request.post(`${LOCKED_URL}${path}`, { headers });
      expect(response.status(), `POST ${path}`).toBe(403);
    }
    for (const method of ['get', 'put', 'patch', 'delete'] as const) {
      const response = await request[method](`${LOCKED_URL}${PATH}`, { headers });
      expect(response.status(), method).toBe(403);
    }
    const page = await request.get(`${LOCKED_URL}/`, { headers });
    expect(page.status()).toBe(403);
  });

  test('o 403 não repete o segredo nem o ID', async ({ request }) => {
    const response = await request.post(`${LOCKED_URL}${PATH}`, {
      headers: bearer('quase-o-segredo'),
    });
    const body = await response.text();
    expect(body).not.toContain(REVALIDATE_SECRET);
    expect(body).not.toContain(FRONT_DOOR_ID);
    expect(body).not.toContain('quase-o-segredo');
  });

  test('com o X-Azure-FDID a trava passa e a rota ainda exige o segredo', async ({ request }) => {
    const refused = await request.post(`${LOCKED_URL}${PATH}`, { headers: withFdid });
    expect(refused.status()).toBe(401);
    const accepted = await request.post(`${LOCKED_URL}${PATH}`, {
      headers: { ...withFdid, ...bearer(REVALIDATE_SECRET) },
    });
    expect(accepted.status()).toBe(200);
  });
});

// Sem REVALIDATE_SECRET configurado a rota fica fechada para todos (fail closed): nunca "sem segredo, sem checagem".
test.describe('sem REVALIDATE_SECRET no ambiente', () => {
  const webDir = fileURLToPath(new URL('..', import.meta.url));

  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const probe = createServer().once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });

  test('a rota responde 503 até para quem manda um segredo, e o servidor sobe', async ({
    request,
  }) => {
    const port = await freePort();
    const server = spawn('node', ['.next/standalone/apps/web/server.js'], {
      cwd: webDir,
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        REVALIDATE_SECRET: undefined,
      },
      stdio: 'ignore',
    });
    try {
      const url = `http://127.0.0.1:${port}`;
      await expect
        .poll(
          async () =>
            (await request.get(`${url}/health`).catch(() => ({ status: () => 0 }))).status(),
          {
            timeout: 30_000,
          },
        )
        .toBe(200);
      for (const headers of [{}, bearer(''), bearer('qualquer')]) {
        const response = await request.post(`${url}${PATH}`, { headers });
        expect(response.status(), JSON.stringify(headers)).toBe(503);
        expect(response.headers()['cache-control']).toBe('no-store');
      }
    } finally {
      server.kill();
    }
  });
});
