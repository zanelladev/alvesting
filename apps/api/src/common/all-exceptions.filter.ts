import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { trace } from '@opentelemetry/api';
import { fail, type Failure } from '@alvesting/contracts';
import { recordError, setServerRoute } from '../telemetry/instruments.js';
import { redactPii } from './redact.js';
import { ValidationException } from './zod-validation.pipe.js';

// O texto do erro como o Nest o imprimiria (a pilha inclui a mensagem), mas como string: o que vai ao log não é objeto.
const describe = (exception: unknown): string =>
  exception instanceof Error
    ? (exception.stack ?? `${exception.name}: ${exception.message}`)
    : String(exception);

const codeOf = (status: number): string =>
  (HttpStatus as unknown as Record<number, string | undefined>)[status] ?? 'HTTP_ERROR';

// Erros do body-parser (corpo grande demais, por exemplo) são http-errors com status 4xx.
const clientErrorStatus = (exception: unknown): number | undefined => {
  const status = (exception as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
};

function toErrorResponse(exception: unknown): { status: number; body: Failure } {
  if (exception instanceof ValidationException) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: fail('VALIDATION_ERROR', 'Entrada inválida', exception.issues),
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    // `new ForbiddenException({ code: 'CONSENT_REQUIRED', message })`: o código próprio vence o do status, para o site distinguir
    // "aceite os termos" de um 403 qualquer. O corpo da exceção é só texto nosso, nunca do cliente.
    const body = exception.getResponse();
    const code =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { code?: unknown }).code === 'string'
        ? (body as { code: string }).code
        : codeOf(status);
    return { status, body: fail(code, exception.message) };
  }
  const status = clientErrorStatus(exception);
  if (status) return { status, body: fail(codeOf(status), 'Requisição inválida') };
  // Erro inesperado: a resposta é genérica; o detalhe (e o possível segredo nele) só vai para o log.
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: fail('INTERNAL_ERROR', 'Erro interno') };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    // O guard (sessão, papel, aceite) roda antes do EnvelopeInterceptor, então a requisição que ele barra nunca chegaria ao interceptor
    // e viraria "GET (sem rota)" na telemetria. Aqui o Express já casou a rota (req.route); o 404 do Nest, que não casou, segue sem ela.
    setServerRoute(http.getRequest<{ route?: { path?: unknown } }>().route?.path);
    const { status, body } = toErrorResponse(exception);
    // O erro vai ao log pelo texto, sem e-mail, IP, cookie nem token: a mensagem de uma biblioteca (Prisma, Better Auth, SDK da Azure)
    // pode levar o que o usuário digitou (LGPD nos logs, common/redact.ts).
    if (status >= 500) {
      this.logger.error(redactPii(describe(exception)));
      // E vai ao span da requisição como exceção do Application Insights (limpa pelo mesmo caminho: telemetry/instruments.ts).
      const span = trace.getActiveSpan();
      if (span) recordError(span, exception);
    }
    // Resposta já em andamento (streaming): não dá para trocar status nem corpo, só encerrar.
    if (response.headersSent) {
      response.end();
      return;
    }
    // O Nest põe o Cache-Control da rota (a pública manda `public, s-maxage`) ANTES de rodar o handler, então ele já está na
    // resposta quando a exceção chega aqui. Erro nunca é cacheado: no Front Door, uma resposta de erro guardada vira erro para
    // todo mundo até o tempo de vida acabar.
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json(body);
  }
}
