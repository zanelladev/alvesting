import {
  Body,
  Controller,
  Delete,
  ConflictException,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import { z } from 'zod';
import {
  REAUTH_REQUIRED,
  consentProofSchema,
  consentStatusSchema,
  deleteAccountBodySchema,
  meSchema,
  noQuerySchema,
  userExportSchema,
  type ConsentStatus,
  type Me,
  type UserExport,
} from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { AUTH, type Auth } from '../account.tokens.js';
import { ConsentService } from '../application/consent.service.js';
import { DeleteAttempts } from '../application/delete-attempts.js';
import { ExportService } from '../application/export.service.js';
import type { AccountRequest } from './account-request.js';
import { SessionGuard } from './session.guard.js';

// A conta do dono (plano §9 e §12, etapa 11; docs/CONTA.md): /api/v1/me. Sessão obrigatória em todas as rotas, e toda rota trabalha
// com o ULID da SESSÃO (req.account.userId), nunca com um id que chegue na requisição: A só lê e só apaga o que é de A. Tudo no
// envelope, validado pelo Zod, no Swagger e com Cache-Control: no-store (é dado pessoal: nada de guardar em borda nem em navegador).
const schemaOf = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;

// Dado pessoal nunca é guardado por cache nenhum.
const noStore = () => applyDecorators(Header('Cache-Control', 'no-store'));

const unauthorized = () =>
  ApiUnauthorizedResponse({ description: 'Sem sessão, ou a sessão expirou' });

@ApiTags('conta')
@ApiCookieAuth()
@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly exports: ExportService,
    private readonly attempts: DeleteAttempts,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  @Get()
  @noStore()
  @ApiOperation({ summary: 'Os dados mínimos da conta e o estado do aceite dos termos' })
  @ApiOkResponse({ schema: schemaOf(meSchema) })
  @unauthorized()
  async me(
    @Req() req: AccountRequest,
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<Me> {
    const userId = req.account!.userId;
    const [user, consent] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true, emailVerified: true, role: true },
      }),
      this.consent.state(userId),
    ]);
    return meSchema.parse({ ...user, consent });
  }

  @Post('consents')
  @HttpCode(200)
  @noStore()
  @ApiOperation({
    summary: 'Aceita as versões vigentes dos termos de uso e da política de privacidade',
  })
  @ApiBody({ schema: schemaOf(consentProofSchema) })
  @ApiOkResponse({ schema: schemaOf(consentStatusSchema) })
  @ApiConflictResponse({ description: 'As versões mandadas não são as vigentes' })
  @unauthorized()
  async accept(
    @Req() req: AccountRequest,
    @Body(new ZodValidationPipe(consentProofSchema)) body: z.output<typeof consentProofSchema>,
  ): Promise<ConsentStatus> {
    // O usuário aceita o texto que viu: se as versões mudaram no meio do caminho, nada é gravado e o site mostra o texto novo.
    if (!this.consent.isCurrent(body)) {
      throw new ConflictException('As versões mandadas não são as vigentes: leia o texto atual');
    }
    await this.consent.record(req.account!.userId);
    return this.consent.state(req.account!.userId);
  }

  @Get('export')
  @noStore()
  @Header('Content-Disposition', 'attachment; filename="alvesting-meus-dados.json"')
  @ApiOperation({
    summary: 'Baixa tudo o que a Alvesting guarda do dono da conta (JSON), sem senha nem chaves',
  })
  @ApiOkResponse({ schema: schemaOf(userExportSchema) })
  @unauthorized()
  exportData(
    @Req() req: AccountRequest,
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<UserExport> {
    return this.exports.build(req.account!.userId);
  }

  @Delete()
  @noStore()
  @ApiOperation({
    summary:
      'Exclui a conta e tudo dela. Pede a sessão recente (até 5 minutos) ou a senha; limpa o cookie',
  })
  @ApiBody({ schema: schemaOf(deleteAccountBodySchema) })
  @ApiOkResponse({ schema: schemaOf(z.strictObject({ deleted: z.literal(true) })) })
  @ApiForbiddenResponse({
    description:
      'Sessão antiga sem a senha (REAUTH_REQUIRED) ou senha incorreta (INVALID_PASSWORD)',
  })
  @ApiTooManyRequestsResponse({ description: 'Senha errada vezes demais' })
  @unauthorized()
  async remove(
    @Req() req: AccountRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(deleteAccountBodySchema))
    body: z.output<typeof deleteAccountBodySchema>,
  ): Promise<{ deleted: true }> {
    const userId = req.account!.userId;
    if (this.attempts.blocked(userId)) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Senha errada vezes demais: tente de novo em alguns minutos',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      // O Better Auth confere a senha ou a sessão recente, apaga o usuário (o banco leva o resto em cascata) e devolve os cookies zerados.
      const { headers } = await this.auth.api.deleteUser({
        headers: fromNodeHeaders(req.headers),
        body: body.password === undefined ? {} : { password: body.password },
        returnHeaders: true,
      });
      for (const cookie of headers.getSetCookie()) res.append('Set-Cookie', cookie);
    } catch (error) {
      if (error instanceof APIError) {
        const code = (error.body as { code?: string } | undefined)?.code;
        if (code === 'INVALID_PASSWORD') {
          this.attempts.fail(userId);
          throw new ForbiddenException({ code: 'INVALID_PASSWORD', message: 'Senha incorreta' });
        }
        if (code === 'SESSION_EXPIRED' || code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') {
          throw new ForbiddenException({
            code: REAUTH_REQUIRED,
            message: 'A sessão é antiga: informe a senha ou entre de novo para excluir a conta',
          });
        }
      }
      throw error;
    }
    this.attempts.clear(userId);
    return { deleted: true };
  }
}
