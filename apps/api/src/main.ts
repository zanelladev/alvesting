import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV, requireApiLogin, useApiLogin, type Env } from './config/env.js';
import { configureApp } from './configure-app.js';
import { AUTH, type Auth } from './modules/account/account.tokens.js';

async function bootstrap(): Promise<void> {
  // a api roda com o login de menor privilégio do Postgres, e não com o administrador (docs/INFRA.md, 2.7), e em produção recusa subir com
  // outro (o segredo database-url-api no lugar do database-url trocados por engano não passam em silêncio)
  useApiLogin();
  requireApiLogin();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);
  configureApp(app, {
    frontDoorId: env.FRONT_DOOR_ID,
    auth: app.get<Auth>(AUTH, { strict: false }),
  });
  await app.listen(env.API_PORT, env.API_HOST);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
