import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  adminCostsSchema,
  adminJobsSchema,
  adminSeasonSchema,
  adminSeasonsSchema,
  corporateEventBodySchema,
  corporateEventResultSchema,
  cycleRerunSchema,
  dlqResubmitBodySchema,
  dlqResubmitSchema,
  noQuerySchema,
  queryDateSchema,
  queueNameSchema,
  seasonCreateBodySchema,
  seasonPatchBodySchema,
  ulidSchema,
  type AdminCosts,
  type AdminJobs,
  type AdminSeason,
  type AdminSeasons,
  type CorporateEventResult,
  type CycleRerun,
  type DlqResubmit,
} from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import type { AccountRequest } from '../../account/presentation/account-request.js';
import { ConsentGuard } from '../../account/presentation/consent.guard.js';
import { Roles, RolesGuard } from '../../account/presentation/roles.guard.js';
import { SessionGuard } from '../../account/presentation/session.guard.js';
import { AdminOpsService } from '../application/admin-ops.service.js';
import { AdminReportsService } from '../application/admin-reports.service.js';
import { AdminSeasonsService } from '../application/admin-seasons.service.js';

// As rotas de admin (plano §3 e §9, etapa 10, parte 2; docs/API.md, seção 8). Os três guards em TODA rota, na ordem: a sessão (que
// também confere o Origin das mutações), o papel e o aceite dos termos. E `@Roles('ADMIN')` em CADA rota, e não na classe: o RolesGuard
// nega o que não tem @Roles (403, até para o admin), então uma rota nova que esqueça de declarar o papel nasce fechada, em vez de
// herdar a abertura de uma anotação da classe. O teste (admin.integration.spec.ts) confere as duas coisas. O ator da auditoria é sempre o
// ULID da SESSÃO (`admin:<ULID>`), nunca um id que venha na requisição. Tudo no envelope, validado pelo Zod, no Swagger e com
// Cache-Control: no-store. Parâmetro de query não existe: o desconhecido é 400.
const schemaOf = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as Record<string, unknown>;
const outputOf = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;

const noStore = () => applyDecorators(Header('Cache-Control', 'no-store'));
const noQuery = () => new ZodValidationPipe(noQuerySchema);
type NoQuery = z.output<typeof noQuerySchema>;

const unauthorized = () =>
  ApiUnauthorizedResponse({ description: 'Sem sessão, ou a sessão expirou' });
const forbidden = () =>
  ApiForbiddenResponse({
    description: 'Não é admin, o aceite dos termos venceu, ou (mutação) o Origin não é o do site',
  });

const actorOf = (req: AccountRequest): string => `admin:${req.account!.userId}`;

@ApiTags('admin')
@ApiCookieAuth()
@Controller('admin')
@UseGuards(SessionGuard, RolesGuard, ConsentGuard)
export class AdminController {
  constructor(
    private readonly seasons: AdminSeasonsService,
    private readonly ops: AdminOpsService,
    private readonly reports: AdminReportsService,
  ) {}

  @Get('seasons')
  @Roles('ADMIN')
  @noStore()
  @ApiOperation({
    summary: 'Todas as temporadas, o rascunho inclusive, no formato do arquivo do season:create',
  })
  @ApiOkResponse({ schema: outputOf(adminSeasonsSchema) })
  @unauthorized()
  @forbidden()
  list(@Query(noQuery()) _query: NoQuery): Promise<AdminSeasons> {
    return this.seasons.list();
  }

  @Post('seasons')
  @Roles('ADMIN')
  @noStore()
  @ApiOperation({
    summary: 'Cria a temporada (rascunho) com o elenco: o mesmo arquivo do season:create',
  })
  @ApiBody({ schema: schemaOf(seasonCreateBodySchema) })
  @ApiCreatedResponse({
    schema: outputOf(adminSeasonSchema),
    description: 'A temporada criada (rascunho)',
  })
  @ApiConflictResponse({ description: 'O slug já existe (SEASON_SLUG_TAKEN)' })
  @unauthorized()
  @forbidden()
  create(
    @Req() req: AccountRequest,
    @Body(new ZodValidationPipe(seasonCreateBodySchema))
    body: z.output<typeof seasonCreateBodySchema>,
    @Query(noQuery()) _query: NoQuery,
  ): Promise<AdminSeason> {
    return this.seasons.create(body, actorOf(req));
  }

  @Patch('seasons/:id')
  @Roles('ADMIN')
  @noStore()
  @ApiOperation({
    summary:
      'Inicia o rascunho ({ status: "RUNNING" }, o season:start) ou edita nome, parâmetros e elenco dele. Temporada em andamento ou encerrada não muda',
  })
  @ApiBody({ schema: schemaOf(seasonPatchBodySchema) })
  @ApiOkResponse({ schema: outputOf(adminSeasonSchema) })
  @ApiConflictResponse({
    description:
      'A temporada saiu do rascunho (SEASON_LOCKED) ou há outra em andamento (SEASON_RUNNING_EXISTS, conferido dentro da transação do início: dois inícios juntos não passam os dois)',
  })
  @unauthorized()
  @forbidden()
  update(
    @Req() req: AccountRequest,
    @Param('id', new ZodValidationPipe(ulidSchema)) id: string,
    @Body(new ZodValidationPipe(seasonPatchBodySchema))
    body: z.output<typeof seasonPatchBodySchema>,
    @Query(noQuery()) _query: NoQuery,
  ): Promise<AdminSeason> {
    return this.seasons.update(id, body, actorOf(req));
  }

  @Post('cycles/:date/rerun')
  @HttpCode(200)
  @Roles('ADMIN')
  @noStore()
  @ApiOperation({
    summary:
      'Reprocessa o ciclo do pregão: publica a decide de quem ainda não decidiu, só entre a hora da decisão e 5 minutos antes do prazo das 09:30. Nunca na margem final nem depois do prazo, nunca muda decisão gravada',
  })
  @ApiOkResponse({ schema: outputOf(cycleRerunSchema) })
  @ApiConflictResponse({ description: 'O dia não é pregão (NOT_A_TRADING_DAY)' })
  @unauthorized()
  @forbidden()
  rerun(
    @Req() req: AccountRequest,
    @Param('date', new ZodValidationPipe(queryDateSchema)) date: string,
    @Query(noQuery()) _query: NoQuery,
  ): Promise<CycleRerun> {
    return this.ops.rerunCycle(date, actorOf(req));
  }

  @Post('dlq/:queue/resubmit')
  @HttpCode(200)
  @Roles('ADMIN')
  @noStore()
  @ApiOperation({
    summary:
      'Reenvia da DLQ para a fila as mensagens pelo MessageId (até 10 por chamada). Idempotente: o que já saiu da DLQ responde not_found',
  })
  @ApiBody({ schema: schemaOf(dlqResubmitBodySchema) })
  @ApiOkResponse({ schema: outputOf(dlqResubmitSchema) })
  @unauthorized()
  @forbidden()
  resubmit(
    @Req() req: AccountRequest,
    @Param('queue', new ZodValidationPipe(queueNameSchema)) queue: z.output<typeof queueNameSchema>,
    @Body(new ZodValidationPipe(dlqResubmitBodySchema))
    body: z.output<typeof dlqResubmitBodySchema>,
    @Query(noQuery()) _query: NoQuery,
  ): Promise<DlqResubmit> {
    return this.ops.resubmit(queue, body, actorOf(req));
  }

  @Post('corporate-events')
  @HttpCode(200)
  @Roles('ADMIN')
  @noStore()
  @ApiOperation({
    summary:
      'Registra um desdobramento, grupamento ou bonificação em ações e ENFILEIRA a liquidação das temporadas que já passaram da data ex (o settle:event, mas quem liquida é o worker)',
  })
  @ApiBody({ schema: outputOf(corporateEventBodySchema) })
  @ApiOkResponse({
    schema: outputOf(corporateEventResultSchema),
    description:
      'O evento registrado e as temporadas cuja liquidação foi enfileirada (queued) ou espera a data ex (pending). O resultado publicado só muda quando o worker liquida',
  })
  @ApiBadGatewayResponse({
    description:
      'O evento ficou registrado, mas nem toda liquidação foi enfileirada no Service Bus (PUBLISH_FAILED): repita, é seguro',
  })
  @unauthorized()
  @forbidden()
  registerEvent(
    @Req() req: AccountRequest,
    @Body(new ZodValidationPipe(corporateEventBodySchema))
    body: z.output<typeof corporateEventBodySchema>,
    @Query(noQuery()) _query: NoQuery,
  ): Promise<CorporateEventResult> {
    return this.ops.registerCorporateEvent(body, actorOf(req));
  }

  @Get('costs')
  @Roles('ADMIN')
  @noStore()
  @ApiOperation({
    summary:
      'O custo das LLMs no mês de Brasília, por competidor e por dia, e o acumulado contra o teto (ARENA_MONTHLY_COST_CAP_USD)',
  })
  @ApiOkResponse({ schema: outputOf(adminCostsSchema) })
  @unauthorized()
  @forbidden()
  costs(@Query(noQuery()) _query: NoQuery): Promise<AdminCosts> {
    return this.reports.costs();
  }

  @Get('jobs')
  @Roles('ADMIN')
  @noStore()
  @ApiOperation({
    summary:
      'O último job_run de cada tipo e os estados, os FAILED recentes, o fetch_state e a DLQ de cada fila (ou "unavailable" se o papel da api não deixa ler)',
  })
  @ApiOkResponse({ schema: outputOf(adminJobsSchema) })
  @unauthorized()
  @forbidden()
  jobs(@Query(noQuery()) _query: NoQuery): Promise<AdminJobs> {
    return this.reports.jobs();
  }
}
