import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from './configure-app.js';
import { HealthModule } from './infrastructure/health/health.module.js';

const apps: INestApplication[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

// configureApp lê o NODE_ENV na hora de montar o app.
async function csp(nodeEnv: string): Promise<string> {
  vi.stubEnv('NODE_ENV', nodeEnv);
  const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  apps.push(app);
  const res = await request(app.getHttpServer() as Parameters<typeof request>[0]).get('/api/docs');
  expect(res.status).toBe(200);
  return String(res.headers['content-security-policy']);
}

describe('Content-Security-Policy (helmet)', () => {
  // Em http://127.0.0.1:4310/api/docs (a URL do README) o WebKit obedece o upgrade-insecure-requests,
  // reescreve os assets do Swagger para https e a página fica em branco. O supertest só vê o 200 do HTML,
  // por isso o teste olha o cabeçalho.
  it.each(['development', 'test'])(
    'em %s não manda upgrade-insecure-requests, para o Swagger abrir em http no WebKit',
    async (nodeEnv) => {
      expect(await csp(nodeEnv)).not.toContain('upgrade-insecure-requests');
    },
  );

  it('em production manda upgrade-insecure-requests (atrás do Front Door tudo é https)', async () => {
    expect(await csp('production')).toContain('upgrade-insecure-requests');
  });

  it.each(['development', 'production'])(
    'em %s o resto da política continua: só a própria origem para scripts e sem frames de terceiros',
    async (nodeEnv) => {
      const policy = await csp(nodeEnv);
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("frame-ancestors 'self'");
      expect(policy).toContain("object-src 'none'");
    },
  );
});
