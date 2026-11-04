import { Controller, Get, Header, NotFoundException, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  PUBLIC_CACHE_CONTROL,
  cycleRefSchema,
  cycleViewSchema,
  seasonScopeQuerySchema,
  ulidSchema,
  type CycleView,
} from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { CycleViewRepository } from '../infrastructure/cycle-view.repository.js';

// O ciclo de um pregão, na API pública (plano §9: GET /cycles/:date). Uma rota só: o parâmetro é a data do pregão (AAAA-MM-DD, na
// temporada atual ou na de ?season=) ou o ULID do ciclo, a forma da etapa 6. As duas formas montam a resposta pelo mesmo
// repositório.
@ApiTags('arena')
@Controller('cycles')
export class CyclesController {
  constructor(private readonly cycles: CycleViewRepository) {}

  // Os horários, os hashes do prompt e do briefing, as decisões e os itens públicos. Nunca o prompt, o IO bruto nem o endereço
  // do Blob: o formato do contrato é estrito e o repositório monta só o que ele lista.
  @Get(':id')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiOperation({
    summary:
      'Um ciclo da arena: horários, hashes do prompt e do briefing, decisões e itens públicos',
  })
  @ApiParam({ name: 'id', description: 'A data do pregão (AAAA-MM-DD) ou o ULID do ciclo' })
  @ApiQuery({
    name: 'season',
    required: false,
    description:
      'Slug ou ULID da temporada, quando o parâmetro é uma data. Sem ele, a temporada atual',
  })
  @ApiOkResponse({
    schema: z.toJSONSchema(cycleViewSchema, { target: 'openapi-3.0' }) as Record<string, unknown>,
  })
  @ApiNotFoundResponse({ description: 'Ciclo não encontrado' })
  @ApiBadRequestResponse({ description: 'Data ou ULID inválido' })
  async one(
    @Param('id', new ZodValidationPipe(cycleRefSchema)) ref: string,
    @Query(new ZodValidationPipe(seasonScopeQuerySchema)) query: { season?: string },
  ): Promise<CycleView> {
    const view = ulidSchema.safeParse(ref).success
      ? await this.cycles.find(ref)
      : await this.cycles.findByDate(ref, query.season);
    if (!view) throw new NotFoundException('Ciclo não encontrado');
    return view;
  }
}
