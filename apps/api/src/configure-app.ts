import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { originLock } from './common/origin-lock.js';
import type { Auth } from './modules/account/account.tokens.js';
import { authRoute } from './modules/account/presentation/auth-route.js';

// GET /health é um alias de GET /api/v1/health: a sonda do Front Door bate na origem sem prefixo.
// O prefixo global do Nest não consegue servir a mesma rota com e sem prefixo, então a URL é
// reescrita antes do roteamento e as duas passam pelo mesmo controller, filtro e interceptor.
const healthAlias = (req: Request, _res: Response, next: NextFunction) => {
  if (req.path === '/health') req.url = `/api/v1${req.url}`;
  next();
};

// O padrão de toda resposta é não ser guardada. Só a rota pública declara o próprio Cache-Control (o Nest o põe depois deste, então
// vence), e o filtro de erros volta a `no-store`. O Front Door cacheia por 1 a 3 dias o que chega sem Cache-Control numa rota com
// cache (docs/INFRA.md, 2.5): a falta do cabeçalho nunca pode virar cache. Vale também para a recusa da trava de origem.
const noStoreByDefault = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

// Tudo que é HTTP e compartilhado entre main.ts e os testes: o que o teste exercita é o que roda.
// frontDoorId liga a trava de origem (ver common/origin-lock.ts); sem ele, tudo passa. auth monta o Better Auth em /api/auth/*
// (etapa 11): só o papel HTTP o tem, e ele entra DEPOIS da trava de origem (rota nova já nasce atrás dela) e ANTES dos body parsers do
// Nest, que só são registrados no init() e que consumiriam o corpo que o Better Auth lê sozinho.
export function configureApp(
  app: INestApplication,
  options: { frontDoorId?: string; auth?: Auth } = {},
): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // O padrão do helmet manda upgrade-insecure-requests. Em http://127.0.0.1 (dev) o WebKit reescreve
          // os assets do Swagger para https e a página fica em branco. Em produção tudo é https.
          'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.use(noStoreByDefault);
  // Antes de tudo que responde (alias, rotas, Swagger). Roda sobre o caminho cru, antes da reescrita do alias.
  app.use(originLock(options.frontDoorId));
  app.use(healthAlias);
  if (options.auth) app.use(authRoute(options.auth));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Alvesting API')
      .setDescription(
        'Arena de LLMs na B3 com dinheiro fictício. Respostas no envelope { success, data, error }.',
      )
      .setVersion('0.0.0')
      // as rotas /me citam este esquema (@ApiCookieAuth); em produção o nome do cookie leva o prefixo __Secure-
      .addCookieAuth('alvesting.session_token')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}
