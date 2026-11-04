import { describe, expect, it } from 'vitest';
import { poolConfig } from './prisma.service.js';
import { API_LOGIN } from './table-policy.js';

// O pool de cada processo (docs/INFRA.md, 2.2): 4 conexões, prazo para conseguir uma e o statement_timeout de 60 s dos workers. O login da
// api (papel mínimo, onda 3d) tem o statement_timeout dele no PRÓPRIO papel do Postgres (api-login.ts): o parâmetro que o driver manda na
// partida da sessão vence o do papel, então para esse login o pool NÃO manda o seu, ou os 10 s do papel nunca valeriam.
describe('poolConfig', () => {
  const admin = 'postgresql://alvesting:alvesting@localhost:25432/alvesting_dev';
  const api = `postgresql://${API_LOGIN}:alvesting_api@localhost:25432/alvesting_dev`;

  it('o login administrador (workers, decisões, agendadores e migrations) leva o statement_timeout de 60 s', () => {
    expect(poolConfig(admin)).toEqual({
      connectionString: admin,
      max: 4,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 60_000,
      idle_in_transaction_session_timeout: 30_000,
    });
  });

  it('o login da api não manda statement_timeout: vale o do papel', () => {
    const config = poolConfig(api);
    expect(config).not.toHaveProperty('statement_timeout');
    expect(config).toMatchObject({
      connectionString: api,
      max: 4,
      connectionTimeoutMillis: 10_000,
      idle_in_transaction_session_timeout: 30_000,
    });
  });

  it('reconhece o login da api com o usuário codificado na URL, e só ele', () => {
    const encoded = `postgresql://${encodeURIComponent(API_LOGIN)}:x@h/db`;
    expect(poolConfig(encoded)).not.toHaveProperty('statement_timeout');
    expect(poolConfig(`postgresql://${API_LOGIN}2:x@h/db`)).toHaveProperty(
      'statement_timeout',
      60_000,
    );
    expect(poolConfig(`postgresql://x:${API_LOGIN}@h/db`)).toHaveProperty(
      'statement_timeout',
      60_000,
    );
  });

  it('URL que não dá para ler cai no pool dos workers, sem lançar (quem falha é a conexão, com a mensagem do driver)', () => {
    expect(poolConfig('isto nao e uma url')).toHaveProperty('statement_timeout', 60_000);
  });
});
