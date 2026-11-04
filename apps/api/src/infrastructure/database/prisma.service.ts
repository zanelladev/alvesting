import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ENV, type Env } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { API_LOGIN } from './table-policy.js';

// O Postgres B1ms tem na casa de 50 conexões para api, worker, jobs e migrate (docs/INFRA.md, 2.2): o pool de cada
// processo é pequeno. O padrão do pg abre 10 por processo, espera conexão para sempre e deixa uma consulta
// pendurada viver para sempre. Os prazos de servidor ficam acima do que o código leva de verdade (as transações em
// lote do market-data têm 60 s no total, cada instrução leva milissegundos).
const POOL = {
  max: 4,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 60_000,
  idle_in_transaction_session_timeout: 30_000,
};

// O login da api (papel mínimo, onda 3d; api-login.ts) tem o statement_timeout dele no PRÓPRIO papel do Postgres (10 s). O parâmetro que o
// driver manda na partida da sessão vence o do papel, então para esse login o pool não manda o dos 60 s dos workers: do contrário os 10 s
// do papel nunca valeriam. O login se reconhece pelo usuário da URL, que é fixo (API_LOGIN).
export function poolConfig(connectionString: string) {
  const { statement_timeout: _workers, ...withoutStatementTimeout } = POOL;
  const isApiLogin =
    URL.canParse(connectionString) &&
    decodeURIComponent(new URL(connectionString).username) === API_LOGIN;
  return { connectionString, ...(isApiLogin ? withoutStatementTimeout : POOL) };
}

// Prisma 7 fala com o Postgres por driver adapter (pg). A conexão só abre na primeira consulta,
// então subir a API ou um papel sem banco no ar não falha.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg(poolConfig(env.DATABASE_URL)) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
