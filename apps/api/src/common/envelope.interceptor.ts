import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { ok } from '@alvesting/contracts';
import { setServerRoute } from '../telemetry/instruments.js';

// Embrulha todo retorno bem-sucedido em { success: true, data, error: null }.
// Rotas @Sse (health/stream agora, o chat na etapa 13) ficam de fora: cada evento já é um MessageEvent, e
// embrulhá-lo no envelope quebraria o stream.
// Também diz à telemetria qual foi a rota (o padrão do Express, `/api/v1/competitors/:slug`) antes de o handler rodar: é o nome da
// operação no Application Insights, e o caminho cru levaria o ULID, o slug e o token da redefinição de senha (telemetry/sanitize.ts).
// O guard roda ANTES do interceptor: a requisição que ele barra (401, 403) não passa por aqui, e quem dá a rota a ela é o
// AllExceptionsFilter.
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  private readonly reflector = new Reflector();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    setServerRoute(context.switchToHttp().getRequest<{ route?: { path?: unknown } }>().route?.path);
    if (this.reflector.get<boolean | undefined>(SSE_METADATA, context.getHandler())) {
      return next.handle() as Observable<unknown>;
    }
    return next.handle().pipe(map((data: unknown) => ok(data ?? null)));
  }
}
