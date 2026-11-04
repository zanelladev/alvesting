import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseSchema,
  userOwnedModels,
} from '../../modules/account/testing/prisma-schema.fixture.js';
import {
  API_GROUP_ROLE,
  API_LOGIN,
  TABLE_POLICY,
  personalTables,
  policyGaps,
  type Privilege,
} from './table-policy.js';

// A matriz escrita à mão de TODA tabela do banco: o que o login da api pode fazer nela (papel mínimo do Postgres, onda 3d) e se ela guarda
// dado pessoal (o backup-verify deixa o dado dessas tabelas fora do dump). Tabela nova do schema.prisma sem decisão aqui reprova, do jeito do
// user-data.spec.ts: a carteira (etapa 12) e o chat (13) entram classificados, por decisão de quem as cria, e não por herança.
const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
const models = parseSchema(schema);
const tables = models.map((model) => model.table);

describe('a matriz de tabelas contra o schema.prisma de verdade', () => {
  it('o leitor acha as tabelas (se achasse menos, os testes abaixo passariam à toa)', () => {
    expect(tables.length).toBe((schema.match(/^model \w+ \{$/gm) ?? []).length);
    expect(tables.length).toBeGreaterThan(25);
    expect(tables).toEqual(expect.arrayContaining(['user', 'order', 'audit_log', 'job_run']));
    // o nome é o do @@map (a tabela), nunca o do modelo
    expect(tables).not.toContain('User');
  });

  it('toda tabela do schema tem decisão de privilégio e de dado pessoal, e a matriz não tem tabela que não existe', () => {
    expect(policyGaps(tables, TABLE_POLICY)).toEqual({ missing: [], extra: [] });
  });

  it('cada decisão traz o motivo (quem lê a matriz revisa o porquê, não só o quê)', () => {
    for (const [table, policy] of Object.entries(TABLE_POLICY)) {
      expect(policy.why, table).toMatch(/\S{3} \S{3}/);
    }
  });

  it('só privilégios de dados: nada de TRUNCATE, REFERENCES, TRIGGER nem DDL para a api', () => {
    const known: Privilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    for (const [table, policy] of Object.entries(TABLE_POLICY)) {
      for (const privilege of policy.api)
        expect(known, `${table}.${privilege}`).toContain(privilege);
      expect(new Set(policy.api).size, `${table}: privilégio repetido`).toBe(policy.api.length);
    }
  });

  it('as tabelas pessoais são as da conta e as da carteira, e todo modelo ligado ao usuário (hoje e no chat) é pessoal', () => {
    expect([...personalTables()].sort()).toEqual(
      [
        'account',
        'consent',
        'portfolio',
        'portfolio_lot',
        'session',
        'user',
        'verification',
      ].sort(),
    );
    const ownedTables = models
      .filter((model) => userOwnedModels(models).has(model.name))
      .map((model) => model.table);
    for (const table of ownedTables) {
      expect(TABLE_POLICY[table]?.personal, `${table} é do usuário e não está como pessoal`).toBe(
        true,
      );
    }
  });

  it('nenhuma escrita da api nas tabelas de resultado da arena (só o worker liquida e só o job de decisões decide)', () => {
    for (const table of [
      'order',
      'fill',
      'position',
      'equity_snapshot',
      'season_stat',
      'random_baseline',
      'decision',
      'decision_item',
    ]) {
      const writes = TABLE_POLICY[table]!.api.filter((privilege) => privilege !== 'SELECT');
      expect(writes, table).toEqual([]);
    }
  });

  it('o aceite não se reescreve (sem UPDATE nem DELETE direto) e a trilha de auditoria só recebe linha (sem ler, mudar nem apagar)', () => {
    expect(TABLE_POLICY.consent!.api).toEqual(['SELECT', 'INSERT']);
    expect(TABLE_POLICY.audit_log!.api).toEqual(['INSERT']);
  });

  // A carteira (etapa 12): só o que as rotas usam. A linha da carteira nunca muda nem sai por DELETE direto (só pela cascata do usuário); o
  // lançamento se cria, se lê e se apaga, e se atualiza só nas colunas que o PATCH troca, com o gatilho que limita a 200 lançamentos.
  it('a carteira: a api cria e lê a linha dela, e o lançamento só muda nas colunas do PATCH, sob o gatilho do teto', () => {
    expect(TABLE_POLICY.portfolio).toMatchObject({ personal: true, api: ['SELECT', 'INSERT'] });
    expect(TABLE_POLICY.portfolio!.apiColumns).toBeUndefined();
    expect(TABLE_POLICY.portfolio_lot).toMatchObject({
      personal: true,
      api: ['SELECT', 'INSERT', 'DELETE'],
      apiColumns: { UPDATE: ['ticker', 'quantity', 'cost_cents', 'bought_on', 'updated_at'] },
      guard: 'portfolio_lot_api_guard',
    });
    // a carteira dona e a data de criação nunca mudam: fora das colunas do UPDATE
    const updatable = TABLE_POLICY.portfolio_lot!.apiColumns!.UPDATE!;
    for (const column of ['id', 'portfolio_id', 'created_at'])
      expect(updatable).not.toContain(column);
  });

  it('a tabela do histórico de migrations não é da api (não está no schema do Prisma e ninguém a lê)', () => {
    expect(TABLE_POLICY).not.toHaveProperty('_prisma_migrations');
  });

  it('os nomes do papel e do login são os que a migration e o comando de provisionamento usam', () => {
    expect(API_GROUP_ROLE).toBe('alvesting_api_group');
    expect(API_LOGIN).toBe('alvesting_api');
  });
});

describe('as regras pegam a tabela que a etapa 13 vai trazer (schema sintético)', () => {
  const future = parseSchema(`
model User {
  id String @id
  @@map("user")
}
model ChatThread {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("chat_thread")
}
model ChatMessage {
  id       String     @id
  threadId String
  thread   ChatThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  @@map("chat_message")
}
`);

  it('tabela nova sem decisão aparece como "missing"; tabela que saiu do schema, como "extra"', () => {
    const futureTables = future.map((model) => model.table);
    expect(futureTables).toEqual(['user', 'chat_thread', 'chat_message']);
    const gaps = policyGaps(futureTables, TABLE_POLICY);
    expect(gaps.missing).toEqual(['chat_thread', 'chat_message']);
    expect(gaps.extra).toContain('session');
    expect(gaps.extra).not.toContain('user');
  });

  it('o modelo do usuário que não estiver como pessoal reprova (o chat entra no dump só pelo PITR)', () => {
    const owned = userOwnedModels(future);
    expect([...owned].sort()).toEqual(['ChatMessage', 'ChatThread', 'User']);
    const withoutDecision = future
      .filter((model) => owned.has(model.name))
      .filter((model) => TABLE_POLICY[model.table]?.personal !== true)
      .map((model) => model.table);
    expect(withoutDecision).toEqual(['chat_thread', 'chat_message']);
  });

  it('um modelo sem @@map usa o nome do próprio modelo como tabela (o Prisma faz o mesmo)', () => {
    expect(parseSchema('model Thing {\n  id String @id\n}\n')[0]?.table).toBe('Thing');
  });
});
