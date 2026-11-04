import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConsentService } from '../application/consent.service.js';
import type { AccountRequest } from './account-request.js';

// "Versão nova pede novo aceite antes das rotas /me": as rotas de recurso da carteira (etapa 12) e do chat (etapa 13) usam
// `@UseGuards(SessionGuard, ConsentGuard)` e respondem 403 CONSENT_REQUIRED enquanto o usuário não aceitar as versões vigentes.
// Ficam FORA dele, de propósito, as rotas dos direitos do titular (LGPD art. 18): GET /me, POST /me/consents, GET /me/export e DELETE /me
// funcionam com o aceite vencido (exportar e excluir não podem depender de aceitar um texto novo). Falha fechado: sem `req.account`, 401.
@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(private readonly consent: ConsentService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AccountRequest>();
    if (!req.account) throw new UnauthorizedException('Sessão ausente ou expirada');
    if (!(await this.consent.state(req.account.userId)).upToDate) {
      throw new ForbiddenException({
        code: 'CONSENT_REQUIRED',
        message: 'Aceite os termos de uso e a política de privacidade vigentes para continuar',
      });
    }
    return true;
  }
}
