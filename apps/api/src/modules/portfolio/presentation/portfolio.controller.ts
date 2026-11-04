import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  lotBodySchema,
  lotDeletedSchema,
  lotIdParamSchema,
  lotSchema,
  noQuerySchema,
  portfolioSchema,
  type Lot,
  type Portfolio,
} from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import type { AccountRequest } from '../../account/presentation/account-request.js';
import { ConsentGuard } from '../../account/presentation/consent.guard.js';
import { SessionGuard } from '../../account/presentation/session.guard.js';
import { PortfolioService } from '../application/portfolio.service.js';

// A carteira do dono (plano §3, §9 e §11, etapa 12; docs/API.md, seção 9): /api/v1/me/portfolio. Os dois guards em TODA rota, na ordem: a
// sessão (que também confere o Origin das mutações) e o aceite dos termos (403 CONSENT_REQUIRED com a versão vencida). Toda rota trabalha
// com o ULID da SESSÃO (req.account.userId), nunca com um id que chegue no corpo, na query ou no caminho: o lançamento de outro usuário é 404,
// igual ao que não existe. Tudo no envelope, validado pelo Zod (campo a mais é 400), no Swagger e com Cache-Control: no-store (é dado
// pessoal: nada de guardar em borda nem em navegador). Parâmetro de query não existe: o desconhecido é 400.
const schemaOf = (schema: z.ZodType, io: 'input' | 'output' = 'output') =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as Record<string, unknown>;

const noStore = () => applyDecorators(Header('Cache-Control', 'no-store'));
const noQuery = () => new ZodValidationPipe(noQuerySchema);
type NoQuery = z.output<typeof noQuerySchema>;
const idParam = () => new ZodValidationPipe(lotIdParamSchema);

const unauthorized = () =>
  ApiUnauthorizedResponse({ description: 'Sem sessão, ou a sessão expirou' });
const forbidden = () =>
  ApiForbiddenResponse({
    description:
      'O aceite dos termos venceu (CONSENT_REQUIRED) ou (mutação) o Origin não é o do site',
  });
const invalid = () =>
  ApiBadRequestResponse({
    description:
      'Corpo, :id ou query inválidos (campo a mais inclusive), ticker desconhecido ou data futura',
  });
const notFound = () =>
  ApiNotFoundResponse({ description: 'O lançamento não existe, ou é de outro usuário' });

@ApiTags('carteira')
@ApiCookieAuth()
@Controller('me/portfolio')
@UseGuards(SessionGuard, ConsentGuard)
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  @noStore()
  @ApiOperation({
    summary:
      'Os lançamentos do dono e as posições por ticker (preço médio, último fechamento, valor de mercado e P&L), com os totais',
  })
  @ApiOkResponse({ schema: schemaOf(portfolioSchema) })
  @unauthorized()
  @forbidden()
  @invalid()
  get(@Req() req: AccountRequest, @Query(noQuery()) _query: NoQuery): Promise<Portfolio> {
    return this.portfolio.get(req.account!.userId);
  }

  @Post('lots')
  @noStore()
  @ApiOperation({
    summary:
      'Lança uma compra: ticker, quantidade, o preço por ação ou o valor total pago (mode), e a data (opcional). Os dois modos dão o mesmo custo total',
  })
  @ApiBody({ schema: schemaOf(lotBodySchema, 'input') })
  @ApiCreatedResponse({ schema: schemaOf(lotSchema), description: 'O lançamento criado' })
  @ApiConflictResponse({ description: 'A carteira já tem 200 lançamentos (LOT_LIMIT)' })
  @unauthorized()
  @forbidden()
  @invalid()
  add(
    @Req() req: AccountRequest,
    @Body(new ZodValidationPipe(lotBodySchema)) body: z.output<typeof lotBodySchema>,
    @Query(noQuery()) _query: NoQuery,
  ): Promise<Lot> {
    return this.portfolio.add(req.account!.userId, body);
  }

  @Patch('lots/:id')
  @noStore()
  @ApiOperation({
    summary: 'Troca o lançamento INTEIRO (o mesmo corpo do POST). A data que faltar no corpo some',
  })
  @ApiBody({ schema: schemaOf(lotBodySchema, 'input') })
  @ApiOkResponse({ schema: schemaOf(lotSchema), description: 'O lançamento como ficou' })
  @unauthorized()
  @forbidden()
  @invalid()
  @notFound()
  replace(
    @Req() req: AccountRequest,
    @Param('id', idParam()) id: string,
    @Body(new ZodValidationPipe(lotBodySchema)) body: z.output<typeof lotBodySchema>,
    @Query(noQuery()) _query: NoQuery,
  ): Promise<Lot> {
    return this.portfolio.replace(req.account!.userId, id, body);
  }

  @Delete('lots/:id')
  @noStore()
  @ApiOperation({ summary: 'Apaga o lançamento do dono' })
  @ApiOkResponse({ schema: schemaOf(lotDeletedSchema) })
  @unauthorized()
  @forbidden()
  @invalid()
  @notFound()
  remove(
    @Req() req: AccountRequest,
    @Param('id', idParam()) id: string,
    @Query(noQuery()) _query: NoQuery,
  ): Promise<{ deleted: true }> {
    return this.portfolio.remove(req.account!.userId, id);
  }
}
