import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  LOGO_HEADERS,
  LOGO_NOT_FOUND,
  internalBarsSchema,
  internalLogosSchema,
  internalTapeSchema,
  noQuerySchema,
  tickerParamSchema,
  type InternalBars,
  type InternalLogos,
  type InternalTape,
} from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { QuotesRepository } from '../infrastructure/quotes.repository.js';
import { QuotesSecretGuard } from './quotes-secret.guard.js';

// As rotas INTERNAS de cotações (docs/API.md, seção 6; ADR 0033): o site lê aqui a cotação que nenhuma rota pública entrega (a licença da
// brapi proíbe entregar os Dados a terceiros como feed, API ou base bruta). O mínimo de que o site precisa: as barras de um papel (a home
// pede as do BOVA11, o último fechamento e o anterior; a página da ação, as do papel; o rodapé, a data do último pregão), a fita da home
// (o universo da semana do último ciclo, com o fechamento e o anterior de cada papel) e os logos (ADR 0036: a lista de quem tem logo, com a
// versão, e o SVG de um papel, que a atualização semanal copiou do icons.brapi.dev e que o site serve do próprio domínio).
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

  // A lista dos logos (ADR 0036): os papéis com logo guardado, em ordem de ticker, com a versão do SVG (o site a põe no endereço).
  @Get('logos')
  @Header('Cache-Control', 'no-store')
  async logos(
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<InternalLogos> {
    return internalLogosSchema.parse(await this.repo.logos());
  }

  // O logo de um papel (ADR 0036): o SVG guardado, como imagem e fora do envelope (`@Res`: o corpo é o SVG), com LOGO_HEADERS (image/svg+xml,
  // nosniff e a CSP que o deixa inerte até aberto direto na aba). Lê o banco como está, como a lista: só o worker escreve na tabela (a api só
  // a lê, pela matriz do papel), e cada passada dos logos apaga o que o validador de hoje recusa. Sem logo, 404 LOGO_NOT_FOUND no envelope
  // (depois do guard: quem não tem o segredo só vê o 404 da rota que não existe). Só o no-store em `@Header`, como as outras (o teste do
  // controlador confere); o resto vai na resposta.
  @Get('logos/:ticker')
  @Header('Cache-Control', 'no-store')
  async logo(
    @Param('ticker', new ZodValidationPipe(tickerParamSchema)) ticker: string,
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
    @Res() res: Response,
  ): Promise<void> {
    const svg = await this.repo.logo(ticker);
    if (svg === null) {
      throw new NotFoundException({ code: LOGO_NOT_FOUND, message: 'Este papel não tem logo' });
    }
    for (const [name, value] of Object.entries(LOGO_HEADERS)) res.setHeader(name, value);
    // um Buffer, e não o texto: com texto o Express acrescentaria o charset ao Content-Type
    res.send(Buffer.from(svg, 'utf8'));
  }
}
