import { Controller, Get, Header, Sse, type MessageEvent } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { map, take, timer, type Observable } from 'rxjs';
import { z } from 'zod';
import { healthResponseSchema, type Health } from '@alvesting/contracts';

// Teste de streaming (ADR 0017): 5 eventos, um por segundo, o primeiro na hora.
const STREAM_EVENTS = 5;
const STREAM_INTERVAL_MS = 1000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  // Liveness: só diz que o processo responde. Não consulta banco nem fila de propósito, para que
  // uma queda do Postgres não tire a API do rodízio do Front Door. no-store: a resposta nunca é reaproveitada
  // do cache (como o /health do web).
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'A API está de pé' })
  @ApiOkResponse({
    schema: z.toJSONSchema(healthResponseSchema, { target: 'openapi-3.0' }) as Record<
      string,
      unknown
    >,
  })
  check(): Health {
    return { status: 'ok', service: 'api' };
  }

  // Serve para medir se o Front Door entrega SSE aos poucos ou bufferiza (scripts/sse-probe.mjs). Fica sob a
  // trava de origem, ao contrário do /health. Cada evento carrega a hora em que o servidor o gerou, para o
  // probe comparar com a hora de chegada.
  @Sse('stream')
  @ApiOperation({ summary: 'Teste de streaming: 5 eventos, um por segundo (SSE)' })
  @ApiProduces('text/event-stream')
  stream(): Observable<MessageEvent> {
    return timer(0, STREAM_INTERVAL_MS).pipe(
      take(STREAM_EVENTS),
      map((i) => ({ data: { seq: i + 1, of: STREAM_EVENTS, at: new Date().toISOString() } })),
    );
  }
}
