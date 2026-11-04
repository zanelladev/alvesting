import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../../../config/env.js';

// O segredo da rota interna de cotações (docs/API.md, seção 6; ADR 0033). A rota é alcançável pelo endereço direto da api, então o
// segredo é a única defesa dela. Chega em `Authorization: Bearer <segredo>` (nunca na URL, que vai para log), como o da revalidação do
// site. A comparação é em tempo constante: os dois lados passam por SHA-256 (tamanho igual, sem revelar o tamanho do segredo) e vão para
// o timingSafeEqual.
//
// Quem não tem o segredo recebe o 404 que o Nest dá a uma rota que não existe ("Cannot GET <endereço>", o mesmo texto, no mesmo envelope e
// com o mesmo `no-store`), e não um 401 ou 403: a resposta não confirma que a rota existe. Sem QUOTES_SECRET no ambiente (a api de dev que
// não o configurou, uma implantação esquecida) a rota é fail closed: 404 para todos. Nada é registrado em log: o log de requisição é uma
// lista branca (sem cabeçalho) e o filtro de erros só registra 5xx.
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

@Injectable()
export class QuotesSecretGuard implements CanActivate {
  private readonly expected: Buffer | undefined;

  constructor(@Inject(ENV) env: Env) {
    this.expected = env.QUOTES_SECRET ? digest(env.QUOTES_SECRET.reveal()) : undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const candidate = /^Bearer (\S+)$/.exec(request.header('authorization') ?? '')?.[1];
    if (
      this.expected !== undefined &&
      candidate !== undefined &&
      timingSafeEqual(digest(candidate), this.expected)
    ) {
      return true;
    }
    // a mesma frase do 404 do roteador do Nest (routes-resolver.js, registerNotFoundHandler): método e endereço pedidos
    throw new NotFoundException(`Cannot ${request.method} ${request.originalUrl}`);
  }
}
