import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  internalBarsSchema,
  internalTapeSchema,
  noQuerySchema,
  tickerParamSchema,
  type InternalBars,
  type InternalTape,
} from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { QuotesRepository } from '../infrastructure/quotes.repository.js';
import { QuotesSecretGuard } from './quotes-secret.guard.js';

// As rotas INTERNAS de cotações (docs/API.md, seção 6; ADR 0033): o site lê aqui a cotação que nenhuma rota pública entrega (a licença da
// brapi proíbe entregar os Dados a terceiros como feed, API ou base bruta). O mínimo de que o site precisa: as barras de um papel (a home
// pede as do BOVA11, o último fechamento e o anterior; a página da ação, as do papel; o rodapé, a data do último pregão) e a fita da home
// (o universo da semana do último ciclo, com o fechamento e o anterior de cada papel).
//
//  - Segredo só do servidor, em TODA rota (o guard na classe): sem ele, ou com o errado, 404 igual ao da rota que não existe.
//  - `no-store`: o site é quem guarda (o cache de dados do Next, com as tags da liquidação); nenhuma borda nem navegador.
//  - Fora do Swagger (`ApiExcludeController`) e fora da rota com cache do Front Door (o infra/tests/check.mjs lê este arquivo). O prefixo
//    `interno` não é por acaso: a regra BlockInterno do WAF bloqueia na borda todo caminho com `/interno/`, então o Front Door nem repassa.
//  - Parâmetro de query não existe: o desconhecido é 400, como em toda rota (depois do guard: quem não tem o segredo só vê o 404).
//
// ponytail: a rota das barras devolve as 60 também para o BOVA11, de que a home usa as duas últimas (uns 5 KB a mais, uma vez a cada 5
// minutos, no cache de dados do site). Se o peso ou a segunda leitura pesarem: um `?limite=` (a home pede 2) e o `noQuerySchema` vira um schema com ele.
@ApiExcludeController()
@Controller('interno')
@UseGuards(QuotesSecretGuard)
export class QuotesController {
  constructor(private readonly repo: QuotesRepository) {}

  @Get('barras/:ticker')
  @Header('Cache-Control', 'no-store')
  async bars(
    @Param('ticker', new ZodValidationPipe(tickerParamSchema)) ticker: string,
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<InternalBars> {
    return internalBarsSchema.parse(await this.repo.bars(ticker));
  }

  @Get('fita')
  @Header('Cache-Control', 'no-store')
  async tape(
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<InternalTape> {
    return internalTapeSchema.parse(await this.repo.tape());
  }
}
