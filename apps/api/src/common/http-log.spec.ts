import { Controller, Get, Res, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { LoggerModule } from 'nestjs-pino';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpLogOptions } from './http-log.js';

// Sobe o LoggerModule de verdade (nestjs-pino + pino-http) com as opções que a API usa e um stream em
// memória no lugar do stdout. Os segredos abaixo são valores sintéticos.
const SECRETS = {
  authorization: 'Bearer segredo-authorization-123',
  cookie: 'sessao=segredo-cookie-456',
  frontDoorId: 'segredo-fdid-789',
  apiKey: 'segredo-api-key-abc',
  token: 'segredo-token-da-query',
  code: 'segredo-code-oauth',
  setCookie: 'segredo-set-cookie-def',
};

@Controller()
class DemoController {
  @Get('demo')
  demo(@Res({ passthrough: true }) res: Response) {
    res.cookie('sid', SECRETS.setCookie, { httpOnly: true });
    return { ok: true };
  }

  @Get('quebra')
  quebra(): never {
    throw new Error('falha de teste');
  }
}

const lines: string[] = [];
const stream = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    lines.push(chunk.toString());
    callback();
  },
});

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule.forRoot({ pinoHttp: [httpLogOptions('info'), stream] })],
    controllers: [DemoController],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  lines.length = 0;
});

const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
const logged = async (): Promise<Array<Record<string, unknown>>> => {
  // o pino-http escreve quando a resposta termina, um instante depois de o cliente receber
  await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe('log de requisição (lista branca)', () => {
  it('não deixa segredo nenhum em claro: cabeçalhos, query string e Set-Cookie', async () => {
    await http()
      .get(`/api/v1/demo?token=${SECRETS.token}&code=${SECRETS.code}&pagina=2`)
      .set('Authorization', SECRETS.authorization)
      .set('Cookie', SECRETS.cookie)
      .set('X-Azure-FDID', SECRETS.frontDoorId)
      .set('X-Api-Key', SECRETS.apiKey)
      .expect(200);
    await logged();

    const text = lines.join('');
    for (const [name, secret] of Object.entries(SECRETS)) {
      expect(text, name).not.toContain(secret);
    }
  });

  it('registra o que ajuda a achar um problema: método, caminho sem query, user-agent e status', async () => {
    await http().get('/api/v1/demo?token=x&pagina=2').set('User-Agent', 'teste-ua/1.0').expect(200);
    const [entry] = await logged();

    expect(entry).toMatchObject({
      req: { method: 'GET', path: '/api/v1/demo', userAgent: 'teste-ua/1.0' },
      res: { statusCode: 200 },
    });
    expect(typeof entry!.responseTime).toBe('number');
  });

  it('o log da requisição só tem os campos da lista: nada de cabeçalhos, query, IP ou params', async () => {
    await http()
      .get('/api/v1/demo?token=x')
      .set('Authorization', SECRETS.authorization)
      .set('User-Agent', 'teste-ua/1.0');
    const [entry] = await logged();

    expect(Object.keys(entry!.req as object).sort()).toEqual(['id', 'method', 'path', 'userAgent']);
    expect(Object.keys(entry!.res as object)).toEqual(['statusCode']);
  });

  it('registra o 404 também, sem vazar a query', async () => {
    await http().get(`/api/v1/nao-existe?code=${SECRETS.code}`).expect(404);
    const [entry] = await logged();

    expect(entry).toMatchObject({ req: { path: '/api/v1/nao-existe' }, res: { statusCode: 404 } });
    expect(lines.join('')).not.toContain(SECRETS.code);
  });

  it('requisição sem user-agent não derruba o log', async () => {
    await http().get('/api/v1/demo').unset('User-Agent').expect(200);
    const [entry] = await logged();
    expect(entry).toMatchObject({ req: { method: 'GET', path: '/api/v1/demo' } });
  });

  // O alerta `api-5xx` (infra/modules/alerts.bicep) lê estas linhas no Log Analytics: a razão entre as de `res.statusCode` >= 500 e todas as
  // de requisição. O SSR do site chama a api direto pelo ingress, sem passar pelo Front Door, então a métrica de 5xx dele não vê esse erro.
  it('a resposta 500 vai ao log com o status em número no campo res.statusCode, que é o do alerta api-5xx', async () => {
    await http().get('/api/v1/quebra').expect(500);
    await http().get('/api/v1/demo').expect(200);
    await vi.waitFor(() => expect(lines.length).toBe(2));
    const statuses = lines
      .map((line) => (JSON.parse(line) as { res: { statusCode: unknown } }).res.statusCode)
      .sort();
    expect(statuses).toEqual([200, 500]);
  });

  it('não registra a sonda de saúde do Front Door (a cada 30 s)', async () => {
    await http().get('/api/v1/health').expect(404);
    await http().get('/api/v1/demo').expect(200);
    const entries = await logged();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ req: { path: '/api/v1/demo' } });
  });
});

describe('httpLogOptions', () => {
  it('usa o nível pedido', () => {
    expect(httpLogOptions('warn').level).toBe('warn');
    expect(httpLogOptions('silent').level).toBe('silent');
  });
});

// A redefinição de senha leva o token NO CAMINHO (GET /api/auth/reset-password/<token>), e o caminho é o campo que o log guarda.
// O link do e-mail aponta para o site, que manda o token por POST, mas o endereço da API existe e quem o abrir deixaria o token no log.
describe('o token da redefinição de senha no caminho', () => {
  const serializeReq = (url: string) =>
    (httpLogOptions('info').serializers!.req as (req: unknown) => { path?: string })({
      id: 'r1',
      method: 'GET',
      url,
      headers: {},
    });

  it('vira :token no log, com ou sem query', () => {
    expect(
      serializeReq('/api/auth/reset-password/Ab3dEf6hIj9lMn2pQr5tUv8xYz?callbackURL=%2F').path,
    ).toBe('/api/auth/reset-password/:token');
    expect(serializeReq('/api/auth/reset-password/Ab3dEf6hIj9lMn2pQr5tUv8xYz').path).toBe(
      '/api/auth/reset-password/:token',
    );
  });

  it('não mexe nos outros caminhos', () => {
    expect(serializeReq('/api/auth/sign-in/email').path).toBe('/api/auth/sign-in/email');
    expect(serializeReq('/api/auth/reset-password').path).toBe('/api/auth/reset-password');
    expect(serializeReq('/api/v1/me/export').path).toBe('/api/v1/me/export');
  });
});
