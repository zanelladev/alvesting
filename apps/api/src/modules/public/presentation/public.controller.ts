import {
  applyDecorators,
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  PAGE_DEFAULT_LIMIT,
  PUBLIC_CACHE_CONTROL,
  arenaCurrentSchema,
  competitorDetailSchema,
  decisionsPageSchema,
  decisionsQuerySchema,
  equitySchema,
  leaderboardSchema,
  newsPageSchema,
  newsQuerySchema,
  noQuerySchema,
  queryDateSchema,
  queryDateTimeSchema,
  randomBaselineSchema,
  seasonRefSchema,
  seasonScopeQuerySchema,
  seasonsPageSchema,
  seasonsQuerySchema,
  slugSchema,
  stockDetailSchema,
  stockSearchSchema,
  stocksQuerySchema,
  tickerParamSchema,
  ulidSchema,
  type ArenaCurrent,
  type CompetitorDetail,
  type DecisionsPage,
  type Equity,
  type Leaderboard,
  type NewsPage,
  type RandomBaseline,
  type StockDetail,
  type StockSearch,
} from '@alvesting/contracts';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { InvalidCursorError, decodeCursor, encodeCursor } from '../domain/cursor.js';
import { PublicRepository } from '../infrastructure/public.repository.js';

// A API pública (plano §9, etapa 9; docs/API.md). Só GET, sem login. Toda resposta bem-sucedida declara o cache público (o mesmo
// tempo de vida para o Front Door e para o site), todo erro sai com no-store (o filtro de erros) e todo corpo passa pelo schema
// do contrato antes de sair: o que não está no contrato não vai para a rede, mesmo que a consulta traga uma coluna a mais. As
// rotas da temporada e do ciclo aceitam o ULID ou o slug da temporada; sem ele, a temporada atual.

// Um GET público: o cache, o resumo, os parâmetros de query (do mesmo schema que os valida) e o formato da resposta no Swagger.
// Os parâmetros de caminho o Nest já descreve a partir do @Param.
function publicGet(
  path: string,
  summary: string,
  schema: z.ZodType,
  query: z.ZodObject = noQuerySchema,
) {
  const queryParameters = (Object.entries(query.shape) as Array<[string, z.ZodType]>).map(
    ([name, field]) =>
      ApiQuery({
        name,
        // obrigatório é o que não aceita a ausência
        required: !field.safeParse(undefined).success,
        // o valor chega da query como texto: vale o lado de entrada do schema (o limite é texto que vira número)
        schema: z.toJSONSchema(field, {
          target: 'openapi-3.0',
          io: 'input',
          unrepresentable: 'any',
        }) as Record<string, unknown>,
      }),
  );
  return applyDecorators(
    Get(path),
    Header('Cache-Control', PUBLIC_CACHE_CONTROL),
    ApiOperation({ summary }),
    ...queryParameters,
    ApiOkResponse({
      schema: z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>,
    }),
    ApiBadRequestResponse({ description: 'Parâmetro inválido' }),
    ApiNotFoundResponse({ description: 'Não encontrado' }),
  );
}

// As posições do cursor de cada lista. As datas passam pelo schema do contrato que recusa o ano 0000: o Postgres não o tem, e
// um cursor forjado à mão (é só base64url) viraria 500.
const SEASON_CURSOR = z.tuple([ulidSchema]);
const DECISION_CURSOR = z.tuple([queryDateSchema, ulidSchema]);
const NEWS_CURSOR = z.tuple([queryDateTimeSchema, ulidSchema]);

// Cursor torto é erro de quem chamou (400), nunca 500.
function after(cursor: string | undefined, shape: z.ZodType<string[]>): string[] | undefined {
  if (cursor === undefined) return undefined;
  try {
    return decodeCursor(cursor, shape);
  } catch (error) {
    if (error instanceof InvalidCursorError) throw new BadRequestException('Cursor inválido');
    throw error;
  }
}

const found = <T>(value: T | null, message: string): T => {
  if (value === null) throw new NotFoundException(message);
  return value;
};

@Controller()
export class PublicController {
  constructor(private readonly repo: PublicRepository) {}

  @ApiTags('arena')
  @publicGet(
    'arena/current',
    'A arena agora: a temporada atual, o último ciclo, o macro e o topo do ranking',
    arenaCurrentSchema,
  )
  async current(
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<ArenaCurrent> {
    return arenaCurrentSchema.parse(await this.repo.arenaCurrent());
  }

  @ApiTags('arena')
  @publicGet(
    'seasons',
    'As temporadas em andamento e encerradas, da mais nova à mais antiga',
    seasonsPageSchema,
    seasonsQuerySchema,
  )
  async seasons(
    @Query(new ZodValidationPipe(seasonsQuerySchema)) query: z.output<typeof seasonsQuerySchema>,
  ) {
    const page = await this.repo.seasons({
      after: after(query.cursor, SEASON_CURSOR),
      limit: query.limit ?? PAGE_DEFAULT_LIMIT,
    });
    return seasonsPageSchema.parse({
      rows: page.rows,
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  }

  @ApiTags('ranking')
  @publicGet(
    'seasons/:id/leaderboard',
    'O ranking: por competidor, o patrimônio, o retorno, o percentil no Monte Carlo, o excesso, o drawdown, o acerto, as operações e o custo de LLM',
    leaderboardSchema,
  )
  async leaderboard(
    @Param('id', new ZodValidationPipe(seasonRefSchema)) ref: string,
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<Leaderboard> {
    return leaderboardSchema.parse(
      found(await this.repo.leaderboard(ref), 'Temporada não encontrada'),
    );
  }

  @ApiTags('ranking')
  @publicGet(
    'seasons/:id/equity',
    'A série de patrimônio por pregão de cada competidor',
    equitySchema,
  )
  async equity(
    @Param('id', new ZodValidationPipe(seasonRefSchema)) ref: string,
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<Equity> {
    return equitySchema.parse(found(await this.repo.equity(ref), 'Temporada não encontrada'));
  }

  @ApiTags('ranking')
  @publicGet(
    'seasons/:id/random-baseline',
    'Os percentis 5, 25, 50, 75 e 95 das carteiras aleatórias (Monte Carlo), por pregão',
    randomBaselineSchema,
  )
  async randomBaseline(
    @Param('id', new ZodValidationPipe(seasonRefSchema)) ref: string,
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<RandomBaseline> {
    return randomBaselineSchema.parse(
      found(await this.repo.randomBaseline(ref), 'Temporada não encontrada'),
    );
  }

  @ApiTags('ranking')
  @publicGet(
    'competitors/:slug',
    'Um competidor: provedor e modelo fixados, o patrimônio e, só no modelo, a composição da carteira com preço médio e P&L (o Sorteio e as referências não a trazem), a série e as últimas decisões',
    competitorDetailSchema,
    seasonScopeQuerySchema,
  )
  async competitor(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
    @Query(new ZodValidationPipe(seasonScopeQuerySchema))
    query: z.output<typeof seasonScopeQuerySchema>,
  ): Promise<CompetitorDetail> {
    return competitorDetailSchema.parse(
      found(await this.repo.competitor(slug, query.season), 'Competidor não encontrado'),
    );
  }

  @ApiTags('arena')
  @publicGet(
    'decisions',
    'O feed de decisões dos modelos, do mais novo ao mais antigo, filtrável por ação (BUY, SELL ou HOLD) e por competidor',
    decisionsPageSchema,
    decisionsQuerySchema,
  )
  async decisions(
    @Query(new ZodValidationPipe(decisionsQuerySchema))
    query: z.output<typeof decisionsQuerySchema>,
  ): Promise<DecisionsPage> {
    const page = found(
      await this.repo.decisions({
        seasonRef: query.season,
        action: query.action,
        competitor: query.competitor,
        after: after(query.cursor, DECISION_CURSOR),
        limit: query.limit ?? PAGE_DEFAULT_LIMIT,
      }),
      'Temporada não encontrada',
    );
    return decisionsPageSchema.parse({
      rows: page.rows,
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  }

  @ApiTags('noticias')
  @publicGet(
    'news',
    'As notícias: título, fonte, hora, tickers e link (nunca o trecho), filtráveis por ticker',
    newsPageSchema,
    newsQuerySchema,
  )
  async news(
    @Query(new ZodValidationPipe(newsQuerySchema)) query: z.output<typeof newsQuerySchema>,
  ): Promise<NewsPage> {
    const page = await this.repo.news({
      ticker: query.ticker,
      after: after(query.cursor, NEWS_CURSOR),
      limit: query.limit ?? PAGE_DEFAULT_LIMIT,
    });
    return newsPageSchema.parse({
      rows: page.rows,
      nextCursor: page.next ? encodeCursor(page.next) : null,
    });
  }

  @ApiTags('acoes')
  @publicGet(
    'stocks',
    'Busca de ações por ticker ou nome (até 20 resultados)',
    stockSearchSchema,
    stocksQuerySchema,
  )
  async searchStocks(
    @Query(new ZodValidationPipe(stocksQuerySchema)) query: z.output<typeof stocksQuerySchema>,
  ): Promise<StockSearch> {
    return stockSearchSchema.parse(await this.repo.searchStocks(query.q));
  }

  @ApiTags('acoes')
  @publicGet(
    'stocks/:ticker',
    'Uma ação: quais modelos a têm, o que os modelos decidiram e as notícias com ela (a série de preços não sai de rota pública)',
    stockDetailSchema,
  )
  async stock(
    @Param('ticker', new ZodValidationPipe(tickerParamSchema)) ticker: string,
    @Query(new ZodValidationPipe(noQuerySchema)) _query: z.output<typeof noQuerySchema>,
  ): Promise<StockDetail> {
    return stockDetailSchema.parse(found(await this.repo.stock(ticker), 'Ação não encontrada'));
  }
}
