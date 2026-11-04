import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger, LoggerModule } from 'nestjs-pino';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpLogOptions } from '../../../common/http-log.js';
import type { Auth } from '../account.tokens.js';
import { authRoute } from './auth-route.js';

// O 5xx do /api/auth/* (login, cadastro, redefinição) conta no sinal `api-5xx` (docs/INFRA.md, 5.3): o alerta lê as linhas de log com
// `res.statusCode` (a razão de 5xx entre as requisições da api nos últimos 10 minutos). O Better Auth é atendido pelo Express ANTES do
// pino-http do Nest, então sem esta linha o login fora do ar não contava (etapa 10, onda 3d). O LoggerModule é o de verdade, com as opções
// que a api usa (httpLogOptions) e um stream em memória no lugar do stdout; o Better Auth é falso, só responde o status pedido.
const lines: string[] = [];
const stream = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    lines.push(chunk.toString());
    callback();
  },
});

let status = 200;
let crash = false;
let authCalls = 0;
const fakeAuth = {
  handler: () => {
    authCalls += 1;
    if (crash) return Promise.reject(new Error('banco 10.0.0.5 fora'));
    return Promise.resolve(
      new Response('{}', { status, headers: { 'content-type': 'application/json' } }),
    );
  },
} as unknown as Auth;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule.forRoot({ pinoHttp: [httpLogOptions('info'), stream] })],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false, bufferLogs: false });
  app.useLogger(app.get(Logger));
  app.use(authRoute(fakeAuth));
  app.setGlobalPrefix('api/v1');
  await app.init();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  lines.length = 0;
  status = 200;
  crash = false;
  authCalls = 0;
});

const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
interface Line {
  level: number;
  context?: string;
  msg: string;
  req: { method: string; path: string; userAgent?: string };
  res?: { statusCode?: number | null };
}
const parsed = (): Line[] => lines.map((line) => JSON.parse(line) as Line);
const logged = async (): Promise<Line[]> => {
  // o log sai quando a resposta termina, um instante depois de o cliente receber
  await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));
  return parsed();
};
const withStatus = (entries: Line[]) =>
  entries.filter((entry) => typeof entry.res?.statusCode === 'number');

describe('a rota do Better Auth loga o status na linha que o api-5xx conta', () => {
  it.each([500, 502, 503])(
    'a resposta %i vira UMA linha com res.statusCode, em nível de erro, no formato do log de requisição',
    async (code) => {
      status = code;
      await http().post('/api/auth/sign-in/email').send({}).expect(code);

      const [entry] = withStatus(await logged());

      expect(entry).toMatchObject({
        level: 50,
        context: 'AuthRoute',
        req: { method: 'POST', path: '/api/auth/sign-in/email' },
        res: { statusCode: code },
      });
      expect(entry!.msg).toBe(`POST /api/auth/sign-in/email ${code}`);
      expect(withStatus(await logged())).toHaveLength(1);
    },
  );

  it.each([200, 302, 401, 403, 429])(
    'a resposta %i também tem a linha (entra no total da razão), em nível de informação',
    async (code) => {
      status = code;
      await http().post('/api/auth/sign-in/email').send({}).expect(code);

      const [entry] = withStatus(await logged());

      expect(entry).toMatchObject({ level: 30, res: { statusCode: code } });
    },
  );

  it('a linha tem só os campos da lista branca (id, método, caminho sem query, user-agent e status): nada de query, cabeçalho nem IP', async () => {
    await http()
      .get('/api/auth/verify-email?token=segredo-do-link&callbackURL=/x')
      .set('Cookie', 'alvesting.session_token=segredo-da-sessao')
      .set('Authorization', 'Bearer segredo-bearer')
      .set('User-Agent', 'teste-ua/1.0')
      .expect(200);

    const [entry] = withStatus(await logged());

    expect(entry!.req).toEqual({
      method: 'GET',
      path: '/api/auth/verify-email',
      userAgent: 'teste-ua/1.0',
    });
    expect(Object.keys(entry!.res!)).toEqual(['statusCode']);
    const text = lines.join('');
    for (const secret of ['segredo-do-link', 'segredo-da-sessao', 'segredo-bearer']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('o token da redefinição no caminho vira :token na linha (como no log de requisição)', async () => {
    await http().get('/api/auth/reset-password/tokensecretodoemail123').expect(200);
    const [entry] = withStatus(await logged());
    expect(entry!.req.path).toBe('/api/auth/reset-password/:token');
    expect(lines.join('')).not.toContain('tokensecretodoemail123');
  });

  it('o handler que lança vira 500 no envelope, com a linha de erro limpa (sem o IP) e a linha do status 500 que o alerta conta', async () => {
    crash = true;
    const res = await http().post('/api/auth/sign-up/email').send({}).expect(500);
    expect(res.body).toMatchObject({ success: false, error: { code: 'INTERNAL_ERROR' } });

    await vi.waitFor(() => expect(withStatus(parsed()).length).toBe(1));
    expect(withStatus(parsed())[0]).toMatchObject({ level: 50, res: { statusCode: 500 } });
    expect(lines.join('')).not.toContain('10.0.0.5');
  });

  it('o corpo grande demais (413) tem a linha com o status 413, em nível de informação, e o Better Auth nem é chamado', async () => {
    // um corpo de verdade acima dos 16 KiB (o teto é conferido pelo Content-Length que o cliente declara)
    const res = await http()
      .post('/api/auth/sign-in/email')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ enchimento: 'x'.repeat(17 * 1024) }))
      .expect(413);
    expect(res.body).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(authCalls).toBe(0);

    const entries = withStatus(await logged());

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 30,
      context: 'AuthRoute',
      msg: 'POST /api/auth/sign-in/email 413',
      req: { method: 'POST', path: '/api/auth/sign-in/email' },
      res: { statusCode: 413 },
    });
    // o corpo recusado não vai para o log
    expect(lines.join('')).not.toContain('enchimento');
  });

  it('um corpo no teto exato (16 KiB) passa para o Better Auth', async () => {
    const filler = 'x'.repeat(16 * 1024 - '{"e":""}'.length);
    await http()
      .post('/api/auth/sign-in/email')
      .set('Content-Type', 'application/json')
      .send(`{"e":"${filler}"}`)
      .expect(200);
    expect(authCalls).toBe(1);
  });

  it('o que não é do /api/auth não muda: a rota do Nest fica com o pino-http (o 404 é uma linha só, fora do authRoute)', async () => {
    await http().get('/api/v1/nao-existe').expect(404);
    const entries = withStatus(await logged());
    expect(entries).toHaveLength(1);
    expect(entries[0]!.context).not.toBe('AuthRoute');
    expect(authCalls).toBe(0);
  });
});
