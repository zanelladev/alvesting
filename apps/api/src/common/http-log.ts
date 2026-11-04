import type { Options } from 'pino-http';
import { redactPath } from './redact.js';

// O que o pino-http entrega ao serializer de req: a requisição já passada pelo serializador padrão do pino.
type LoggedReq = { id?: unknown; method?: string; url?: string; headers?: Record<string, unknown> };

// Lista branca. Sozinho, o pino-http registra todos os cabeçalhos, a query string inteira, o IP e os params
// de toda requisição, e isso inclui segredo: Authorization, Cookie, X-Azure-FDID (a trava de origem do
// Front Door, plano 5.4), X-Api-Key, ?token= e o ?code= do OAuth (etapa 11), além do Set-Cookie da resposta.
// Lista negra de cabeçalhos sempre esquece algum; aqui cada campo do log foi escolhido de propósito.
// Campo novo entra por decisão (e por um teste em http-log.spec.ts), nunca por efeito colateral.
// O caminho da redefinição de senha leva o token no último segmento: redactPath o troca por :token (etapa 11).
export const httpLogOptions = (level: string): Options => ({
  level,
  serializers: {
    req: (req: LoggedReq) => ({
      id: req.id,
      method: req.method,
      path: redactPath(req.url?.split('?')[0]),
      userAgent: req.headers?.['user-agent'],
    }),
    res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
  },
  // A sonda do Front Door bate no /health a cada 30 s; não vale poluir o log.
  autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
});
