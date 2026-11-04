import { Logger } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import type { Request, RequestHandler } from 'express';
import { fail } from '@alvesting/contracts';
import { redactPath, redactPii } from '../../../common/redact.js';
import type { Auth } from '../account.tokens.js';

// O Better Auth em /api/auth/* direto no Express (configure-app.ts), antes dos body parsers do Nest: ele lê o corpo da requisição sozinho.
// As respostas dele NÃO usam o envelope { success, data, error } (são o formato do Better Auth, como as rotas @Sse também ficam fora do
// envelope); a trava de origem e o `Cache-Control: no-store` padrão já valeram antes, na mesma cadeia. O resto da API (/api/v1) segue no envelope.
const AUTH_PREFIX = '/api/auth';

// O teto do corpo. O `toNodeHandler` do Better Auth lê o corpo INTEIRO para a memória e não repassa nenhum limite (o de 100 KB dos body
// parsers do Nest não vale aqui, porque este handler entra antes deles): sem teto, uma requisição anônima de 100 MB levava a api de 205
// MB a 603 MB, e o ca-api tem 0,5 GiB. O maior corpo legítimo é o do cadastro (nome, e-mail, senha de até 128 caracteres e o aceite):
// uns 700 bytes.
// ponytail: a conferência é pelo Content-Length declarado (o Node não entrega mais bytes que ele), e o corpo sem tamanho declarado
// (Transfer-Encoding: chunked) é recusado em vez de contado: o navegador manda Content-Length no fetch com corpo de texto, e o Front
// Door repassa o do cliente (não verificado na Azure, docs/INFRA.md, 12). Se a borda passar a fragmentar o corpo, a saída é contar os
// bytes na leitura (um express.json com `limit`, que exige `express` como dependência direta).
const MAX_BODY_BYTES = 16 * 1024;

const bodyTooLarge = (req: Request): boolean => {
  const declared = req.headers['content-length'];
  // `!(x <= teto)` recusa também o que não é número
  if (declared !== undefined) return !(Number(declared) <= MAX_BODY_BYTES);
  return req.headers['transfer-encoding'] !== undefined;
};

export function authRoute(auth: Auth): RequestHandler {
  const handle = toNodeHandler(auth);
  const logger = new Logger('AuthRoute');
  return (req, res, next) => {
    if (req.path !== AUTH_PREFIX && !req.path.startsWith(`${AUTH_PREFIX}/`)) {
      next();
      return;
    }
    // O pino-http do Nest não vê estas rotas (o Express as atende antes do roteador do Nest): uma linha por requisição, com os mesmos
    // campos da lista branca de common/http-log.ts (id, método, caminho sem query, user-agent e status), para ver 401, 429 e 5xx do login.
    // O status vai em `res.statusCode`, o campo que o alerta `api-5xx` conta (docs/INFRA.md, 5.3): sem ele, o login, o cadastro e a
    // redefinição fora do ar ficavam fora da razão de 5xx. Os objetos `req` e `res` de verdade vão para o log porque os serializadores da
    // lista branca (httpLogOptions) é que escolhem os campos: o do `res` do pino devolve `statusCode: null` para um objeto que não seja a
    // resposta (`headersSent` falso), e foi assim que a primeira versão desta linha saiu sem status. Nível de erro a partir do 500, como o
    // pino-http faz com `request errored`.
    res.on('finish', () => {
      const message = `${req.method} ${redactPath(req.path)} ${res.statusCode}`;
      if (res.statusCode >= 500) logger.error({ req, res }, message);
      else logger.log({ req, res }, message);
    });
    if (bodyTooLarge(req)) {
      res.status(413).json(fail('PAYLOAD_TOO_LARGE', 'Corpo da requisição grande demais'));
      return;
    }
    handle(req, res).catch((error: unknown) => {
      logger.error(
        redactPii(error instanceof Error ? (error.stack ?? error.message) : String(error)),
      );
      if (res.headersSent) res.end();
      else res.status(500).json(fail('INTERNAL_ERROR', 'Erro interno'));
    });
  };
}
