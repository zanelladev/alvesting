import { Logger } from '@nestjs/common';
import type { RequestHandler } from 'express';
import { fail } from '@alvesting/contracts';
import { redactPath } from './redact.js';

// Trava de origem (plano 5.4, ADR 0018): atrás do Front Door, a API só atende quem traz o X-Azure-FDID do nosso perfil.
// O Front Door anexa esse cabeçalho a toda requisição que repassa à origem (Microsoft Learn, "Secure traffic
// to Azure Front Door origins"). Private Link, que fecharia a origem na rede, só existe no Premium (ADR 0003).
//
// /health fica de fora, e é a única exceção. Os probes de startup, readiness e liveness do Container Apps
// batem direto na porta do contêiner e nunca trazem o cabeçalho; o smoke do deploy chama a URL da revisão sem
// passar pelo Front Door; e a documentação do probe do Front Door (Learn, "Health probes") só diz que ele manda
// `User-Agent: Edge Health Probe`, não que manda o X-Azure-FDID. Sem a exceção, a origem seria dada como
// doente. Não abre brecha: o caminho é exato, só GET e HEAD, e a resposta é um JSON fixo que já é público pelo
// Front Door. Nada de prefixo (/health/x), caixa diferente, barra no fim ou query para chegar em outra rota.
const HEALTH_PATHS = new Set(['/health', '/api/v1/health']);

export const FRONT_DOOR_HEADER = 'x-azure-fdid';

// Sem FRONT_DOOR_ID (dev, teste e o perfil econômico, que não tem Front Door) a trava não existe.
// ponytail: cada recusa vira uma linha de log, já que a requisição barrada aqui não chega ao pino-http. Um
// scanner na origem enche o log; se virar ruído, amostrar. O cabeçalho e a query nunca entram na linha.
export function originLock(frontDoorId: string | undefined): RequestHandler {
  if (!frontDoorId) return (_req, _res, next) => next();
  const expected = frontDoorId.toLowerCase();
  const logger = new Logger('OriginLock');
  return (req, res, next) => {
    const isProbe = (req.method === 'GET' || req.method === 'HEAD') && HEALTH_PATHS.has(req.path);
    if (isProbe || req.header(FRONT_DOOR_HEADER)?.toLowerCase() === expected) {
      next();
      return;
    }
    // o token da redefinição de senha vai no caminho (/api/auth/reset-password/<token>): sai como :token (common/redact.ts)
    logger.warn(`origem recusada: ${req.method} ${redactPath(req.path)}`);
    res.status(403).json(fail('FORBIDDEN', 'Origem não permitida'));
  };
}
