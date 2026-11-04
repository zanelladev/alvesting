import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { legalSchema, noQuerySchema, type Legal } from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { ACCOUNT_CONFIG } from '../account.tokens.js';
import { ConsentService } from '../application/consent.service.js';
import type { AccountConfig } from '../infrastructure/account-config.js';

// Os termos de uso e a política de privacidade vigentes, com o controlador e o contato (da configuração, nunca do repositório). Pública,
// sem sessão: o cadastro mostra estes textos antes de o usuário existir. SEM cache, de propósito, e ao contrário das rotas públicas
// da arena: o aceite grava a versão que o usuário viu, e um texto velho guardado na borda o faria aceitar uma versão que a API já
// recusa (409). O site lê esta rota sem o cache de dados do Next.
@ApiTags('conta')
@Controller('legal')
export class LegalController {
  constructor(
    @Inject(ACCOUNT_CONFIG) private readonly config: AccountConfig,
    private readonly consent: ConsentService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Os termos de uso e a política de privacidade vigentes, o controlador e o contato',
  })
  @ApiOkResponse({
    schema: z.toJSONSchema(legalSchema, { target: 'openapi-3.0' }) as Record<string, unknown>,
  })
  legal(
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Legal {
    return legalSchema.parse({
      controller: this.config.controller,
      documents: this.consent.current().map((doc) => ({ ...doc })),
    });
  }
}
