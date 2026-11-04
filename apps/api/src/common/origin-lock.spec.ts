import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../configure-app.js';
import { HealthModule } from '../infrastructure/health/health.module.js';

// ID sintético de um perfil do Front Door (o real é um GUID gerado pela Azure).
const FDID = 'c0ffee00-1234-4abc-8def-0123456789ab';

async function startApp(frontDoorId?: string): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { frontDoorId });
  await app.init();
  return app;
}

const http = (app: INestApplication) =>
  request(app.getHttpServer() as Parameters<typeof request>[0]);

const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
beforeEach(() => warn.mockClear());

describe('trava de origem sem FRONT_DOOR_ID (dev e teste)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp(undefined);
  });
  afterAll(async () => {
    await app.close();
  });

  it('deixa passar requisição sem cabeçalho', async () => {
    expect((await http(app).get('/api/v1/health')).status).toBe(200);
    expect((await http(app).get('/api/docs-json')).status).toBe(200);
  });

  it('rota inexistente continua sendo 404, não 403', async () => {
    expect((await http(app).get('/api/v1/nao-existe')).status).toBe(404);
  });
});

describe('trava de origem com FRONT_DOOR_ID (atrás do Front Door)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp(FDID);
  });
  afterAll(async () => {
    await app.close();
  });

  it('recusa com 403 no envelope quem não traz o cabeçalho', async () => {
    const res = await http(app).get('/api/docs-json');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: { code: 'FORBIDDEN', message: 'Origem não permitida' },
    });
  });

  it('recusa cabeçalho de outro perfil e não repete nenhum ID na resposta', async () => {
    const outro = '11111111-2222-4333-8444-555555555555';
    const res = await http(app).get('/api/docs-json').set('X-Azure-FDID', outro);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(outro);
    expect(JSON.stringify(res.body)).not.toContain(FDID);
  });

  it('recusa cabeçalho vazio e cabeçalho repetido', async () => {
    expect((await http(app).get('/api/docs-json').set('X-Azure-FDID', '')).status).toBe(403);
    // dois valores viram "a, b" no Node: nunca igual ao ID
    const repetido = await http(app).get('/api/docs-json').set('X-Azure-FDID', `${FDID}, ${FDID}`);
    expect(repetido.status).toBe(403);
  });

  it('aceita o ID do perfil, com qualquer caixa', async () => {
    for (const value of [FDID, FDID.toUpperCase()]) {
      const res = await http(app).get('/api/docs-json').set('X-Azure-FDID', value);
      expect(res.status, value).toBe(200);
    }
  });

  it('rota inexistente sem cabeçalho é 403: não revela quais rotas existem', async () => {
    expect((await http(app).get('/api/v1/nao-existe')).status).toBe(403);
    expect((await http(app).get('/api/v1/nao-existe').set('X-Azure-FDID', FDID)).status).toBe(404);
  });

  it.each(['/health', '/api/v1/health'])(
    '%s fica fora da trava (sondas do Container Apps e smoke de deploy), em GET e HEAD',
    async (path) => {
      expect((await http(app).get(path)).status).toBe(200);
      expect((await http(app).head(path)).status).toBe(200);
      expect((await http(app).get(`${path}?probe=1`)).status).toBe(200);
    },
  );

  // A exceção é só estes dois caminhos exatos. Qualquer outro, mesmo parecido, passa pela trava.
  it.each([
    '/health/',
    '/health/x',
    '/healthz',
    '/HEALTH',
    '//health',
    '/api/health',
    '/api/v1/health/',
    '/api/v1/health/stream',
    '/api/v1//health',
    '/api/docs',
  ])('%s sem cabeçalho é 403', async (path) => {
    expect((await http(app).get(path)).status).toBe(403);
  });

  it('o /health só é isento em GET e HEAD', async () => {
    for (const method of ['post', 'put', 'patch', 'delete', 'options'] as const) {
      const res = await http(app)[method]('/health');
      expect(res.status, method).toBe(403);
    }
  });

  it('registra a recusa com método e caminho, sem query nem cabeçalho', async () => {
    await http(app).get('/api/v1/x?token=segredo-da-query').set('X-Azure-FDID', 'segredo-errado');
    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('GET /api/v1/x');
    expect(line).not.toContain('segredo-da-query');
    expect(line).not.toContain('segredo-errado');
  });
});
