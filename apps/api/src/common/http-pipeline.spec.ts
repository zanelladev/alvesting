import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Logger,
  NotFoundException,
  Param,
  Post,
  type ArgumentsHost,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PUBLIC_CACHE_CONTROL, envelopeSchema } from '@alvesting/contracts';
import { configureApp } from '../configure-app.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const widgetSchema = z.strictObject({
  name: z.string().trim().min(1),
  qty: z.number().int().positive(),
});

@Controller('widgets')
class WidgetsController {
  @Post()
  create(@Body(new ZodValidationPipe(widgetSchema)) body: z.infer<typeof widgetSchema>) {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('segredo-interno: postgres://usuario:senha-secreta@host/db');
  }

  @Get('negado')
  negado(): never {
    throw new ForbiddenException('sem permissão');
  }

  // um código próprio no envelope (o ConsentGuard da conta responde CONSENT_REQUIRED, que o site distingue de um 403 comum)
  @Get('exige-aceite')
  exigeAceite(): never {
    throw new ForbiddenException({
      code: 'CONSENT_REQUIRED',
      message: 'Aceite os termos vigentes',
    });
  }

  // erro inesperado com dado pessoal na mensagem: o erro que vai ao log não pode levá-lo (LGPD)
  @Get('vaza-pii')
  vazaPii(): never {
    throw new Error('violação para pessoa@example.test vinda de 203.0.113.9 com ?token=abc123');
  }

  @Get('vazio')
  vazio() {
    return undefined;
  }

  // uma rota pública: declara o próprio Cache-Control, como as da API pública (etapa 9)
  @Get('publico')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  publico() {
    return { ok: true };
  }

  @Get('publico-some')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  publicoSome(): never {
    throw new NotFoundException('não existe');
  }

  @Get('publico-boom')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  publicoBoom(): never {
    throw new Error('falha inesperada');
  }

  @Get('publico/:n')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  publicoValida(@Param('n', new ZodValidationPipe(z.coerce.number().int().positive())) n: number) {
    return { n };
  }

  @Get(':id')
  one(@Param('id', new ZodValidationPipe(z.coerce.number().int().positive())) id: number) {
    return { id };
  }
}

let app: INestApplication;
const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [WidgetsController] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
});
afterAll(async () => {
  await app.close();
});

const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);
const anyEnvelope = envelopeSchema(z.unknown());

describe('envelope de sucesso', () => {
  it('embrulha o retorno em { success, data, error } sob /api/v1', async () => {
    const res = await http().post('/api/v1/widgets').send({ name: 'parafuso', qty: 3 });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: true, data: { name: 'parafuso', qty: 3 }, error: null });
  });

  it('retorno vazio vira data null, não ausente', async () => {
    const res = await http().get('/api/v1/widgets/vazio');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null, error: null });
  });

  it('devolve acentos, emoji e caracteres de SQL sem alterar', async () => {
    const name = "Ação 📈 '; DROP TABLE job_run; --";
    const res = await http().post('/api/v1/widgets').send({ name, qty: 1 });
    expect(res.status).toBe(201);
    expect((res.body as { data: { name: string } }).data.name).toBe(name);
  });

  it('fora do prefixo a rota não existe', async () => {
    const res = await http().post('/widgets').send({ name: 'x', qty: 1 });
    expect(res.status).toBe(404);
  });
});

describe('validação Zod', () => {
  it('rejeita campo com tipo errado e aponta o caminho', async () => {
    const res = await http().post('/api/v1/widgets').send({ name: 'parafuso', qty: 'três' });
    expect(res.status).toBe(400);
    const body = res.body as {
      error: { code: string; message: string; details: Array<{ path: unknown[] }> };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Entrada inválida');
    expect(body.error.details.map((d) => d.path)).toContainEqual(['qty']);
  });

  it('não devolve o valor recebido nos detalhes do erro', async () => {
    const res = await http()
      .post('/api/v1/widgets')
      .send({ name: 'ok', qty: 'senha-super-secreta' });
    expect(JSON.stringify(res.body)).not.toContain('senha-super-secreta');
  });

  it('rejeita campo desconhecido', async () => {
    const res = await http().post('/api/v1/widgets').send({ name: 'x', qty: 1, admin: true });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejeita corpo ausente (erro na raiz)', async () => {
    const res = await http().post('/api/v1/widgets');
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string; details: Array<{ path: unknown[] }> } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.map((d) => d.path)).toEqual([[]]);
  });

  it('rejeita corpo vazio e lista todos os campos faltando', async () => {
    const res = await http().post('/api/v1/widgets').send({});
    expect(res.status).toBe(400);
    const paths = (
      res.body as { error: { details: Array<{ path: unknown[] }> } }
    ).error.details.map((d) => d.path);
    expect(paths).toContainEqual(['name']);
    expect(paths).toContainEqual(['qty']);
  });

  it.each([
    ['zero', 0],
    ['negativa', -2],
    ['fracionária', 1.5],
  ])('quantidade %s é recusada', async (_nome, qty) => {
    const res = await http().post('/api/v1/widgets').send({ name: 'x', qty });
    expect(res.status).toBe(400);
  });

  it('nome só com espaços é recusado', async () => {
    const res = await http().post('/api/v1/widgets').send({ name: '   ', qty: 1 });
    expect(res.status).toBe(400);
  });

  it('aceita o limite inferior', async () => {
    const res = await http().post('/api/v1/widgets').send({ name: 'x', qty: 1 });
    expect(res.status).toBe(201);
  });

  it('valida parâmetro de rota', async () => {
    const bad = await http().get('/api/v1/widgets/abc');
    expect(bad.status).toBe(400);
    expect((bad.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');

    const good = await http().get('/api/v1/widgets/7');
    expect(good.body).toEqual({ success: true, data: { id: 7 }, error: null });
  });
});

describe('envelope de erro', () => {
  it('rota inexistente vira 404 no envelope', async () => {
    const res = await http().get('/api/v1/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'NOT_FOUND' } });
    expect(anyEnvelope.safeParse(res.body).success).toBe(true);
  });

  it('HttpException mantém status e mensagem de quem lançou', async () => {
    const res = await http().get('/api/v1/widgets/negado');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: { code: 'FORBIDDEN', message: 'sem permissão' },
    });
  });

  it('HttpException com código próprio mantém o código (CONSENT_REQUIRED não vira FORBIDDEN)', async () => {
    const res = await http().get('/api/v1/widgets/exige-aceite');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: { code: 'CONSENT_REQUIRED', message: 'Aceite os termos vigentes' },
    });
  });

  it('o erro inesperado vai ao log sem e-mail, sem IP e sem a query (LGPD nos logs)', async () => {
    errorLog.mockClear();
    const res = await http().get('/api/v1/widgets/vaza-pii');
    expect(res.status).toBe(500);
    expect(errorLog).toHaveBeenCalled();
    const logged = errorLog.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    expect(logged).toContain('violação para [e-mail]');
    for (const pii of ['pessoa@example.test', '203.0.113.9', 'abc123']) {
      expect(logged).not.toContain(pii);
    }
  });

  it('JSON quebrado no corpo vira 400 no envelope, não HTML', async () => {
    const res = await http()
      .post('/api/v1/widgets')
      .set('Content-Type', 'application/json')
      .send('{"name": "x", "qty": ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'BAD_REQUEST' } });
  });

  it('corpo grande demais vira 413 no envelope', async () => {
    const res = await http()
      .post('/api/v1/widgets')
      .send({ name: 'x'.repeat(200_000), qty: 1 });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('erro inesperado vira 500 genérico, é logado e não vaza detalhe', async () => {
    errorLog.mockClear();
    const res = await http().get('/api/v1/widgets/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/segredo-interno|senha-secreta|postgres:/);
    expect(errorLog).toHaveBeenCalled();
  });
});

describe('cabeçalhos de segurança (helmet)', () => {
  it('manda nosniff e não anuncia o Express', async () => {
    const res = await http().get('/api/v1/widgets/vazio');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('AllExceptionsFilter com resposta em andamento (streaming)', () => {
  it('só encerra a resposta: não tenta trocar status nem corpo', () => {
    const response = { headersSent: true, end: vi.fn(), status: vi.fn(), json: vi.fn() };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}) }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(new Error('falha no meio do stream'), host);
    expect(response.end).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });
});

// Cache-Control (docs/API.md). O Front Door guarda por 1 a 3 dias a resposta que vem SEM Cache-Control (docs do Front Door, "Cache
// expiration"), então toda resposta da API precisa declarar o dela: a rota pública, o seu `public, s-maxage`; todo o resto, e todo
// erro, `no-store`. O Nest põe o cabeçalho da rota ANTES de rodar o handler, então o filtro de erros tem de trocá-lo.
describe('Cache-Control', () => {
  const cacheControl = (res: request.Response) => res.headers['cache-control'];

  it('a rota pública manda o Cache-Control público com s-maxage e stale-while-revalidate', async () => {
    const res = await http().get('/api/v1/widgets/publico');
    expect(res.status).toBe(200);
    expect(cacheControl(res)).toBe(PUBLIC_CACHE_CONTROL);
    expect(cacheControl(res)).toMatch(/^public, s-maxage=\d+, stale-while-revalidate=\d+$/);
  });

  it('a rota que não declara nada sai com no-store: o padrão é não guardar', async () => {
    for (const path of ['/api/v1/widgets/7', '/api/v1/widgets/vazio']) {
      const res = await http().get(path);
      expect(res.status, path).toBe(200);
      expect(cacheControl(res), path).toBe('no-store');
    }
  });

  it.each([
    ['404 lançado pela rota pública', '/api/v1/widgets/publico-some', 404],
    ['400 de validação na rota pública', '/api/v1/widgets/publico/abc', 400],
    ['500 inesperado na rota pública', '/api/v1/widgets/publico-boom', 500],
    ['rota que não existe', '/api/v1/nao-existe', 404],
    ['403 de uma rota comum', '/api/v1/widgets/negado', 403],
  ])('erro nunca é cacheado: %s', async (_nome, path, status) => {
    errorLog.mockClear();
    const res = await http().get(path);
    expect(res.status).toBe(status);
    expect(cacheControl(res)).toBe('no-store');
  });

  it('a recusa da trava de origem (403) também sai com no-store', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WidgetsController],
    }).compile();
    const locked = moduleRef.createNestApplication({ logger: false });
    configureApp(locked, { frontDoorId: 'c0ffee00-1234-4abc-8def-0123456789ab' });
    await locked.init();
    try {
      const res = await request(locked.getHttpServer() as Parameters<typeof request>[0]).get(
        '/api/v1/widgets/publico',
      );
      expect(res.status).toBe(403);
      expect(cacheControl(res)).toBe('no-store');
    } finally {
      await locked.close();
    }
  });
});
