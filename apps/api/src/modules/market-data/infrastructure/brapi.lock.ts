import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';

// Uma requisição por vez na conta da brapi (o plano gratuito só aceita 1 simultânea, e um 429 por isso conta como falha), entre as
// réplicas do worker-data e a carga manual (market:backfill). A trava é consultiva e de transação no Postgres, o banco que todos eles
// dividem: segura só durante UMA requisição (o orçamento de tempo do cliente é de quem a pede), solta sozinha no commit, no rollback e se o
// processo cair no meio. A espera do Retry-After fica fora dela, para a outra réplica não esperar à toa.
// ponytail: uma transação por requisição (BEGIN, trava e COMMIT, na casa de 3 ms) e uma conexão do pool de 4 enquanto ela dura (até 15 s).
// Com mais papéis por requisição (planos pagos) a conta do tempo muda, e uma trava só por passada passa a valer a pena.
const TRANSACTION = { maxWait: 15_000, timeout: 60_000 };
const IDLE_IN_TRANSACTION_MS = 60_000;

@Injectable()
export class BrapiLock {
  constructor(private readonly prisma: PrismaService) {}

  readonly run = <T>(task: () => Promise<T>): Promise<T> =>
    this.prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('brapi', 0))`;
      // a conexão fica "ociosa em transação" enquanto a requisição espera a resposta; o pool derruba quem passa de 30 s assim
      await db.$executeRaw`SELECT set_config('idle_in_transaction_session_timeout', ${`${IDLE_IN_TRANSACTION_MS}ms`}, true)`;
      return task();
    }, TRANSACTION);
}
