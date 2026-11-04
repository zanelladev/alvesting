import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@alvesting/contracts';
import { configureApp } from '../../configure-app.js';
import { HealthModule } from './health.module.js';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

describe('GET /health e GET /api/v1/health', () => {
  it.each(['/health', '/api/v1/health'])(
    '%s responde 200 no envelope do contrato',
    async (path) => {
      const res = await http().get(path);
      expect(res.status).toBe(200);
      expect(healthResponseSchema.parse(res.body)).toEqual({
        success: true,
        data: { status: 'ok', service: 'api' },
        error: null,
      });
    },
  );

  // O Front Door pode guardar resposta em cache (plano 5.4): a sonda e o smoke de deploy precisam do estado de agora.
  it.each(['/health', '/api/v1/health'])('%s manda Cache-Control: no-store', async (path) => {
    const res = await http().get(path);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('o /health mantém a query string da sonda', async () => {
    const res = await http().get('/health?probe=front-door');
    expect(res.status).toBe(200);
  });

  it.each(['/health', '/api/v1/health'])(
    'HEAD %s também responde 200 (a sonda do Front Door usa HEAD)',
    async (path) => {
      const res = await http().head(path);
      expect(res.status).toBe(200);
    },
  );

  it('só aceita GET: POST /health é 404 no envelope', async () => {
    const res = await http().post('/health');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('não confunde caminhos parecidos com /health', async () => {
    for (const path of ['/healthz', '/health/x', '/api/health']) {
      const res = await http().get(path);
      expect(res.status, path).toBe(404);
    }
  });
});

describe('Swagger', () => {
  it('serve a interface em /api/docs', async () => {
    const res = await http().get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('documenta a rota sob o prefixo /api/v1', async () => {
    const res = await http().get('/api/docs-json');
    expect(res.status).toBe(200);
    const doc = res.body as { info: { title: string }; paths: Record<string, unknown> };
    expect(doc.info.title).toBe('Alvesting API');
    expect(Object.keys(doc.paths)).toContain('/api/v1/health');
  });
});
