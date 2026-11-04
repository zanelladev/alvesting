import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccountContext, AccountRequest } from './account-request.js';

export const ROLES_KEY = 'alvesting:roles';

// Uso (etapa 10, as rotas /admin): `@UseGuards(SessionGuard, RolesGuard) @Roles('ADMIN')`. Nenhuma rota de admin existe na etapa 11.
export const Roles = (...roles: AccountContext['role'][]) => SetMetadata(ROLES_KEY, roles);

// Papel obrigatório. Falha fechado: sem `req.account` (esqueceram o SessionGuard na frente) é 401, e rota sem @Roles é 403, nunca
// uma porta aberta por descuido.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AccountRequest>();
    if (!req.account) throw new UnauthorizedException('Sessão ausente ou expirada');
    const required = this.reflector.getAllAndOverride<AccountContext['role'][] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.includes(req.account.role)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Sem permissão para esta rota' });
    }
    return true;
  }
}
