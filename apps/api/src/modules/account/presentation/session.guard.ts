import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { ACCOUNT_CONFIG, AUTH, type Auth } from '../account.tokens.js';
import type { AccountConfig } from '../infrastructure/account-config.js';
import type { AccountRequest } from './account-request.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Sessão obrigatória (plano §5.6: guarda de dono em /me). Lê o cookie pelo Better Auth, confere o usuário no banco e deixa
// `req.account` com o ULID e o papel. Quem usa: as rotas /me desta etapa e, nas próximas, as de admin (etapa 10), da carteira (12) e
// do chat (13). A rota SEMPRE trabalha com `req.account.userId`, nunca com um id vindo da requisição: é isso que impede A de ler B.
//
// Mutação (POST, PUT, PATCH, DELETE) pede ainda o Origin do site: o cookie é SameSite=Lax, que já impede o navegador de mandá-lo num
// POST de outro site, e isto é a segunda camada (o Better Auth faz o mesmo nas rotas dele). Quem não manda Origin, como um curl, manda
// o cabeçalho de propósito; um navegador sempre manda em fetch com corpo.
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ACCOUNT_CONFIG) private readonly config: AccountConfig,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<AccountRequest>();
    const res = http.getResponse<Response>();

    if (!SAFE_METHODS.has(req.method) && req.header('origin') !== this.config.publicUrl) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Origem não permitida' });
    }

    // returnHeaders: uma sessão que passou da metade do prazo é renovada, e o cookie novo precisa chegar ao navegador
    const { headers, response } = await this.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    });
    for (const cookie of headers.getSetCookie()) res.append('Set-Cookie', cookie);
    if (!response) throw new UnauthorizedException('Sessão ausente ou expirada');

    const user = await this.prisma.user.findUnique({
      where: { id: response.user.id },
      select: { id: true, role: true },
    });
    if (!user) throw new UnauthorizedException('Sessão ausente ou expirada');
    req.account = { userId: user.id, role: user.role };
    return true;
  }
}
