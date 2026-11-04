import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { authProvidersSchema, noQuerySchema, type AuthProviders } from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { ACCOUNT_CONFIG } from '../account.tokens.js';
import type { AccountConfig } from '../infrastructure/account-config.js';

// O que a tela de entrar precisa saber antes do login: o botão do Google só aparece se a api o tem (o ID e o segredo do cliente OAuth
// existem juntos; sem eles o provedor nem é registrado, auth.ts). Pública e sem cache, como o /legal: é configuração que muda com o
// deploy, e a borda não pode guardar um "false" de antes de o Google ser ligado. Só o booleano sai, nunca o client ID.
@ApiTags('conta')
@Controller('auth/providers')
export class AuthProvidersController {
  constructor(@Inject(ACCOUNT_CONFIG) private readonly config: AccountConfig) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Quais logins sociais a api oferece (hoje, só o Google, se configurado)',
  })
  @ApiOkResponse({
    schema: z.toJSONSchema(authProvidersSchema, { target: 'openapi-3.0' }) as Record<
      string,
      unknown
    >,
  })
  providers(
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): AuthProviders {
    return authProvidersSchema.parse({ google: this.config.google !== null });
  }
}
