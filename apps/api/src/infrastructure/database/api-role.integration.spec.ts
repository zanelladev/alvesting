import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAudit, auditRow } from '../../common/audit.js';
import { newId } from '../../common/id.js';
import { parseEnv } from '../../config/env.js';
import {
  API_CONNECTION_LIMIT,
  API_STATEMENT_TIMEOUT_MS,
  AUDIT_SQL,
  auditProblem,
  provisionApiLogin,
  scramSha256,
  type RoleAudit,
} from './api-login.js';
import { PrismaService } from './prisma.service.js';
import { API_GROUP_ROLE, API_LOGIN, POLICY_TABLES, TABLE_POLICY } from './table-policy.js';
import {
  apiTestUrl,
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from './test-database.fixture.js';

// O papel mínimo do Postgres da api, de verdade (etapa 10, onda 3d; ADR 0028): a migration `20261103100000_api_role` cria o papel de grupo, o
// comando de provisionamento cria o login e define a senha, e este teste conecta COMO O LOGIN NOVO e confere (1) que o catálogo do banco é a
// matriz escrita à mão (table-policy.ts), (2) que o que a api precisa funciona e (3) que o que ela não pode é recusado pelo banco
// (SQLSTATE 42501, "permission denied"), com o gatilho do consent no meio. Os gatilhos `*_api_guard` (migration `20261103120000_api_role_guards`)
// fecham o ESTADO em que a api escreve (só o rascunho da temporada, só reabrir a liquidação...), que o privilégio de tabela não diz.
// Os specs HTTP (admin, conta, públicas) rodam a api inteira com este login.
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
const denied = (error: unknown) => (error as { code?: string } | null)?.code === '42501';
const q = (name: string) => `"${name}"`;
// 32 hexadecimais, o formato da versão do prompt (a do segredo no Key Vault)
const hex32 = () => randomBytes(16).toString('hex');

describe.skipIf(!testDatabaseUrl)(integrationTitle('O papel mínimo do Postgres da api'), () => {
  let admin: pg.Client;
  let api: pg.Client;

  // Roda o SQL numa transação que sempre volta atrás (nada fica no banco), e devolve o erro (ou nada, se passou).
  async function attempt(sql: string, params: unknown[] = []): Promise<unknown> {
    await api.query('BEGIN');
    try {
      await api.query(sql, params);
      return undefined;
    } catch (error) {
      return error;
    } finally {
      await api.query('ROLLBACK');
    }
  }

  beforeAll(async () => {
    const prisma = await openTestDatabase(testDatabaseUrl!);
    await prisma.$disconnect();
    await provisionApiLogin(testDatabaseUrl!, apiTestUrl(testDatabaseUrl!), false);
    admin = new pg.Client({ connectionString: testDatabaseUrl });
    await admin.connect();
    api = new pg.Client({ connectionString: apiTestUrl(testDatabaseUrl!) });
    await api.connect();
  }, 120_000);

  afterAll(async () => {
    await api?.end();
    await admin?.end();
  });

  describe('o login', () => {
    it('é o login da api, sem nenhum atributo de administração e membro só do papel de grupo', async () => {
      const { rows } = await admin.query(
        `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls,
                (SELECT array_agg(g.rolname::text) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                 WHERE m.member = r.oid) AS member_of
         FROM pg_roles r WHERE rolname = $1`,
        [API_LOGIN],
      );
      expect(rows[0]).toEqual({
        rolcanlogin: true,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: false,
        member_of: [API_GROUP_ROLE],
      });
      const group = await admin.query(
        'SELECT rolcanlogin, rolsuper FROM pg_roles WHERE rolname = $1',
        [API_GROUP_ROLE],
      );
      expect(group.rows[0]).toEqual({ rolcanlogin: false, rolsuper: false });
    });

    it('conecta com a senha da URL e o statement_timeout do papel vale (menor que os 60 s dos workers)', async () => {
      const { rows } = await api.query<{ who: string; timeout: string }>(
        'SELECT current_user AS who, current_setting($1) AS timeout',
        ['statement_timeout'],
      );
      expect(rows[0]!.who).toBe(API_LOGIN);
      expect(rows[0]!.timeout).toBe(`${API_STATEMENT_TIMEOUT_MS / 1000}s`);
    });

    it('o pool da api não sobrepõe o statement_timeout do papel (10 s); o dos workers segue com os 60 s do pool', async () => {
      const asApi = new PrismaService(parseEnv({ DATABASE_URL: apiTestUrl(testDatabaseUrl!) }));
      const asAdmin = new PrismaService(parseEnv({ DATABASE_URL: testDatabaseUrl }));
      try {
        expect(await asApi.$queryRaw`SHOW statement_timeout`).toEqual([
          { statement_timeout: '10s' },
        ]);
        expect(await asAdmin.$queryRaw`SHOW statement_timeout`).toEqual([
          { statement_timeout: '1min' },
        ]);
      } finally {
        await asApi.$disconnect();
        await asAdmin.$disconnect();
      }
    });

    it('o comando é repetível: roda de novo, troca a senha, e a senha antiga deixa de valer', async () => {
      const url = new URL(apiTestUrl(testDatabaseUrl!));
      url.password = 'outra-senha-de-teste-2';
      try {
        await provisionApiLogin(testDatabaseUrl!, url.toString(), false);
        const stale = new pg.Client({ connectionString: apiTestUrl(testDatabaseUrl!) });
        await expect(stale.connect()).rejects.toThrow(/password authentication failed/);
        const fresh = new pg.Client({ connectionString: url.toString() });
        await fresh.connect();
        await fresh.end();
      } finally {
        // o login é do SERVIDOR inteiro e os bancos dev e e2e o usam: a senha de dev volta mesmo que uma asserção acima falhe
        await provisionApiLogin(testDatabaseUrl!, apiTestUrl(testDatabaseUrl!), false);
      }
      const again = new pg.Client({ connectionString: apiTestUrl(testDatabaseUrl!) });
      await again.connect();
      await again.end();
    });

    it('o resumo SCRAM é o mesmo que o próprio servidor calcularia (conferido contra o PostgreSQL, com o sal dele)', async () => {
      await admin.query('BEGIN');
      try {
        await admin.query(`SET LOCAL password_encryption = 'scram-sha-256'`);
        await admin.query(`CREATE ROLE alvesting_scram_probe LOGIN PASSWORD 'pencil-pencil-1'`);
        const probe = await admin.query<{ rolpassword: string }>(
          `SELECT rolpassword FROM pg_authid WHERE rolname = 'alvesting_scram_probe'`,
        );
        const serverSide = probe.rows[0]!.rolpassword;
        const [, params] = serverSide.split('$');
        const [iterations, salt] = params!.split(':');
        expect(
          scramSha256('pencil-pencil-1', Buffer.from(salt!, 'base64'), Number(iterations)),
        ).toBe(serverSide);
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it('um login que ganhou atributo de administração por fora é recusado pelo comando, que não o corrige em silêncio', async () => {
      await admin.query(`ALTER ROLE ${API_LOGIN} CREATEDB`);
      try {
        await expect(
          provisionApiLogin(testDatabaseUrl!, apiTestUrl(testDatabaseUrl!), false),
        ).rejects.toThrow(/atributo de administração/);
      } finally {
        await admin.query(`ALTER ROLE ${API_LOGIN} NOCREATEDB`);
      }
      await provisionApiLogin(testDatabaseUrl!, apiTestUrl(testDatabaseUrl!), false);
    });

    // O que o comando confere depois de provisionar, lido pela consulta de verdade do catálogo. Papel e GRANT são transacionais no
    // PostgreSQL: o desvio é armado e desarmado dentro de uma transação que sempre volta atrás, então o login do SERVIDOR (que os bancos
    // dev e e2e usam) nunca fica torto, nem se o teste cair no meio.
    async function auditWith(setup: string[], premise?: () => Promise<void>, connectionLimit = -1) {
      await admin.query('BEGIN');
      try {
        for (const sql of setup) await admin.query(sql);
        await premise?.();
        const { rows } = await admin.query<RoleAudit>(AUDIT_SQL, [API_LOGIN]);
        return { role: rows[0]!, problem: auditProblem(rows[0], connectionLimit) };
      } finally {
        await admin.query('ROLLBACK');
      }
    }

    it('a conferência do comando aceita o login como a migration e o comando o deixam', async () => {
      const { role, problem } = await auditWith([]);
      expect(problem).toBeUndefined();
      expect(role).toEqual({
        rolcanlogin: true,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: false,
        // dev e testes: sem limite (o de produção, 24, só vale com NODE_ENV=production no comando)
        rolconnlimit: -1,
        schema_create: false,
        member_of: [API_GROUP_ROLE],
      });
    });

    it('o limite de conexões do papel (o da produção) é lido do catálogo, e o que não é o esperado é recusado', async () => {
      const limited = await auditWith(
        [`ALTER ROLE ${API_LOGIN} CONNECTION LIMIT ${API_CONNECTION_LIMIT}`],
        undefined,
        API_CONNECTION_LIMIT,
      );
      expect(limited.role.rolconnlimit).toBe(API_CONNECTION_LIMIT);
      expect(limited.problem).toBeUndefined();
      // o login sem o limite que a produção pede (alguém o tirou, ou o comando nunca rodou com NODE_ENV=production)
      const unlimited = await auditWith([], undefined, API_CONNECTION_LIMIT);
      expect(unlimited.problem).toMatch(/CONNECTION LIMIT -1 e o esperado é 24/);
      // e o contrário: o limite de produção num ambiente que não o pede
      const stale = await auditWith([`ALTER ROLE ${API_LOGIN} CONNECTION LIMIT 3`]);
      expect(stale.problem).toMatch(/CONNECTION LIMIT 3 e o esperado é -1/);
    });

    it('um login que entrou em outro grupo por fora é recusado (pg_read_all_data daria SELECT em tudo)', async () => {
      const { role, problem } = await auditWith([`GRANT pg_read_all_data TO ${API_LOGIN}`]);
      expect(role.member_of).toEqual([API_GROUP_ROLE, 'pg_read_all_data']);
      expect(problem).toMatch(
        /membro só de "alvesting_api_group" \(é de: alvesting_api_group, pg_read_all_data\)/,
      );
    });

    it('o mesmo grupo concedido por dois concedentes (PostgreSQL 16 em diante) conta uma vez só, e não vira um falso "membro de mais de um"', async () => {
      const { role, problem } = await auditWith(
        [
          'CREATE ROLE alvesting_probe_grantor NOLOGIN',
          `GRANT ${API_GROUP_ROLE} TO alvesting_probe_grantor WITH ADMIN OPTION`,
          `GRANT ${API_GROUP_ROLE} TO ${API_LOGIN} GRANTED BY alvesting_probe_grantor`,
        ],
        async () => {
          // a premissa: o catálogo tem mesmo duas linhas para o par (sem isto o teste passaria à toa)
          const pair = await admin.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_auth_members m
             JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles r ON r.oid = m.member
             WHERE g.rolname = $1 AND r.rolname = $2`,
            [API_GROUP_ROLE, API_LOGIN],
          );
          expect(pair.rows[0]!.n).toBe(2);
        },
      );
      expect(role.member_of).toEqual([API_GROUP_ROLE]);
      expect(problem).toBeUndefined();
    });

    it('um servidor em que PUBLIC pode criar no esquema public é recusado (a api passaria a criar tabela e função)', async () => {
      // o PG15 em diante já não dá CREATE a PUBLIC, e a migration o tira de novo (idempotente); aqui o servidor "permissivo" é refeito
      const { role, problem } = await auditWith(['GRANT CREATE ON SCHEMA public TO PUBLIC']);
      expect(role.schema_create).toBe(true);
      expect(problem).toMatch(/CREATE no esquema public/);
    });
  });

  describe('o catálogo do banco é a matriz escrita à mão', () => {
    it('toda tabela do banco (public) está na matriz, menos o histórico de migrations do Prisma, que a api não alcança', async () => {
      const { rows } = await admin.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`,
      );
      const inDatabase = rows
        .map((row) => row.relname)
        .filter((name) => name !== '_prisma_migrations');
      expect(inDatabase).toEqual([...POLICY_TABLES].sort());
    });

    it.each(POLICY_TABLES)(
      '%s: o papel de grupo tem exatamente os privilégios da matriz (e o login herda)',
      async (table) => {
        const expected = TABLE_POLICY[table]!.api;
        const columns = await admin.query<{ attname: string }>(
          `SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
           ORDER BY attnum`,
          [q(table)],
        );
        for (const role of [API_GROUP_ROLE, API_LOGIN]) {
          const got: boolean[] = [];
          for (const privilege of [...PRIVILEGES, 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
            const { rows } = await admin.query<{ has: boolean }>(
              `SELECT has_table_privilege($1, $2, $3) AS has`,
              [role, q(table), privilege],
            );
            got.push(rows[0]!.has);
          }
          expect(
            got,
            `${role} em ${table}: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`,
          ).toEqual([
            ...PRIVILEGES.map((privilege) => expected.includes(privilege)),
            false,
            false,
            false,
          ]);
          // por coluna: a tabela inteira vale para todas; sem ela, só as colunas da matriz (`apiColumns`) e nenhuma outra
          for (const privilege of ['INSERT', 'UPDATE'] as const) {
            const have: string[] = [];
            for (const { attname } of columns.rows) {
              const { rows } = await admin.query<{ has: boolean }>(
                `SELECT has_column_privilege($1, $2, $3, $4) AS has`,
                [role, q(table), attname, privilege],
              );
              if (rows[0]!.has) have.push(attname);
            }
            const want = expected.includes(privilege)
              ? columns.rows.map((column) => column.attname)
              : [...(TABLE_POLICY[table]!.apiColumns?.[privilege] ?? [])];
            expect(have.sort(), `${role}: ${privilege} por coluna em ${table}`).toEqual(
              want.sort(),
            );
          }
        }
      },
    );

    it('o único privilégio concedido POR COLUNA é o da matriz (prompt_version: INSERT de id, version e created_at), e o histórico de migrations é intocável', async () => {
      const { rows } = await admin.query<{
        tbl: string;
        col: string;
        priv: string;
        grantee: string;
      }>(
        `SELECT c.relname AS tbl, a.attname AS col, x.privilege_type AS priv, r.rolname AS grantee
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
         WHERE n.nspname = 'public' AND a.attacl IS NOT NULL ORDER BY 1, 2, 3, 4`,
      );
      const fromMatrix = POLICY_TABLES.flatMap((table) =>
        Object.entries(TABLE_POLICY[table]!.apiColumns ?? {}).flatMap(([priv, columns]) =>
          columns.map((col) => ({ tbl: table, col, priv, grantee: API_GROUP_ROLE })),
        ),
      ).sort((a, b) => `${a.tbl}.${a.col}.${a.priv}`.localeCompare(`${b.tbl}.${b.col}.${b.priv}`));
      expect(rows).toEqual(fromMatrix);
      expect(fromMatrix.length).toBeGreaterThan(0); // a premissa: a matriz tem mesmo privilégio por coluna
      const history = await admin.query<{ has: boolean }>(
        `SELECT has_table_privilege($1, '_prisma_migrations', 'SELECT') AS has`,
        [API_LOGIN],
      );
      expect(history.rows[0]!.has).toBe(false);
    });

    it('o papel de grupo não tem CREATE no esquema (a api não cria nada), e ninguém mais o tem por PUBLIC: a migration o tira, sem depender do padrão do servidor', async () => {
      const { rows } = await admin.query(
        `SELECT has_schema_privilege($1, 'public', 'CREATE') AS create_priv,
                has_schema_privilege($1, 'public', 'USAGE') AS usage_priv`,
        [API_LOGIN],
      );
      expect(rows[0]).toEqual({ create_priv: false, usage_priv: true });
      // PUBLIC é o grantee 0 no ACL do esquema
      const publicCreate = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_namespace n, aclexplode(n.nspacl) a
         WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'`,
      );
      expect(publicCreate.rows[0]!.n).toBe(0);
    });
  });

  describe('o que a api precisa funciona e o que ela não pode o banco recusa (instruções de verdade, como o login novo)', () => {
    // Sonda que NÃO depende de linha nem de valor válido: `WHERE false` (ou um SELECT que não devolve linha) não toca em nada, e o Postgres confere
    // o privilégio antes de olhar as linhas. Uma recusa é sempre SQLSTATE 42501; qualquer outro resultado (inclusive erro de NOT NULL) quer dizer
    // que passou do privilégio. O INSERT é `INSERT ... (coluna) SELECT NULL WHERE false`, e não `DEFAULT VALUES`: sem linha nenhuma, o gatilho
    // `*_api_guard` (que recusa uma linha sem temporada pai) nem dispara, e a sonda mede só o privilégio. Com privilégio por coluna (prompt_version)
    // a sonda nomeia uma coluna concedida.
    const probe = (table: string, privilege: (typeof PRIVILEGES)[number], column: string) =>
      ({
        SELECT: `SELECT 1 FROM ${q(table)} WHERE false`,
        INSERT: `INSERT INTO ${q(table)} (${q(column)}) SELECT NULL WHERE false`,
        UPDATE: `UPDATE ${q(table)} SET ${q(column)} = ${q(column)} WHERE false`,
        DELETE: `DELETE FROM ${q(table)} WHERE false`,
      })[privilege];

    it.each(POLICY_TABLES)(
      '%s: cada instrução passa do privilégio ou é recusada, exatamente como a matriz diz',
      async (table) => {
        const { rows } = await admin.query<{ attname: string }>(
          `SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
         ORDER BY attnum LIMIT 1`,
          [q(table)],
        );
        const policy = TABLE_POLICY[table]!;
        for (const privilege of PRIVILEGES) {
          const columnGrant =
            privilege === 'INSERT' || privilege === 'UPDATE'
              ? policy.apiColumns?.[privilege]
              : undefined;
          const column = columnGrant?.[0] ?? rows[0]!.attname;
          const error = await attempt(probe(table, privilege, column));
          const allowed = policy.api.includes(privilege) || columnGrant !== undefined;
          expect(denied(error), `${privilege} em ${table}: ${String(error)}`).toBe(!allowed);
        }
        expect(denied(await attempt(`TRUNCATE ${q(table)}`)), `TRUNCATE em ${table}`).toBe(true);
      },
    );

    it('excluir o usuário leva o aceite junto SEM a api ter DELETE em consent: a cascata roda com os privilégios do dono da tabela', async () => {
      const userId = newId();
      await api.query('BEGIN');
      try {
        await api.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Pessoa de Teste', $2)`, [
          userId,
          `papel-${userId.toLowerCase()}@example.test`,
        ]);
        await api.query(
          `INSERT INTO "session" (id, user_id, token, expires_at) VALUES ($1, $2, $3, now())`,
          [newId(), userId, `token-${userId}`],
        );
        await api.query(
          `INSERT INTO "account" (id, user_id, account_id, provider_id) VALUES ($1, $2, 'conta', 'credential')`,
          [newId(), userId],
        );
        await api.query(
          `INSERT INTO "consent" (id, user_id, document, version, sha256) VALUES ($1, $2, 'TERMS', '0.1', $3)`,
          [newId(), userId, 'a'.repeat(64)],
        );
        // o DELETE direto no aceite é recusado pelo PRIVILÉGIO (antes mesmo do gatilho)...
        await api.query('SAVEPOINT direto');
        const direct = await api
          .query(`DELETE FROM "consent" WHERE user_id = $1`, [userId])
          .catch((e: unknown) => e);
        expect(denied(direct)).toBe(true);
        await api.query('ROLLBACK TO SAVEPOINT direto');
        // ...e o do usuário passa e leva sessão, conta e aceite em cascata
        const removed = await api.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
        expect(removed.rowCount).toBe(1);
        for (const table of ['session', 'account', 'consent']) {
          const left = await api.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM ${q(table)} WHERE user_id = $1`,
            [userId],
          );
          expect(left.rows[0]!.n, table).toBe(0);
        }
      } finally {
        await api.query('ROLLBACK');
      }
    });

    it('o gatilho do aceite continua de pé para quem tem o privilégio (o administrador): o UPDATE direto é recusado por ele', async () => {
      await admin.query('BEGIN');
      try {
        const userId = newId();
        await admin.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Pessoa', $2)`, [
          userId,
          `gatilho-${userId.toLowerCase()}@example.test`,
        ]);
        const consentId = newId();
        await admin.query(
          `INSERT INTO "consent" (id, user_id, document, version, sha256) VALUES ($1, $2, 'TERMS', '0.1', $3)`,
          [consentId, userId, 'b'.repeat(64)],
        );
        await expect(
          admin.query(`UPDATE "consent" SET version = '9.9' WHERE id = $1`, [consentId]),
        ).rejects.toThrow(/histórico de aceite/);
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it.each([
      ['remover o gatilho do aceite', `DROP TRIGGER consent_no_update ON "consent"`],
      ['desligar os gatilhos do aceite', `ALTER TABLE "consent" DISABLE TRIGGER ALL`],
      ['mudar uma tabela', `ALTER TABLE "consent" ADD COLUMN intruso text`],
      ['apagar uma tabela', `DROP TABLE "session"`],
      ['esvaziar o aceite', `TRUNCATE "consent"`],
      ['criar uma tabela no esquema public', `CREATE TABLE public.intruso (id int)`],
      [
        'criar uma função no esquema public',
        `CREATE FUNCTION public.intruso() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
      ],
      ['atualizar o aceite', `UPDATE "consent" SET version = '9.9'`],
      ['apagar o aceite direto', `DELETE FROM "consent"`],
      ['apagar a trilha de auditoria', `DELETE FROM "audit_log"`],
      ['mudar a trilha de auditoria', `UPDATE "audit_log" SET action = 'x'`],
      ['ler a trilha de auditoria', `SELECT * FROM "audit_log"`],
      ['gravar uma ordem', `INSERT INTO "order" (id) VALUES ('x')`],
      ['gravar uma execução', `INSERT INTO "fill" (id) VALUES ('x')`],
      ['gravar uma posição', `INSERT INTO "position" (id) VALUES ('x')`],
      ['gravar o patrimônio', `INSERT INTO "equity_snapshot" (id) VALUES ('x')`],
      ['gravar as métricas', `INSERT INTO "season_stat" (id) VALUES ('x')`],
      ['gravar o Monte Carlo', `INSERT INTO "random_baseline" (id) VALUES ('x')`],
      ['gravar uma decisão', `INSERT INTO "decision" (id) VALUES ('x')`],
      ['apagar o resultado de uma temporada', `DELETE FROM "equity_snapshot"`],
      // o compromisso do SHA-256 do prompt é do job de decisões: a api só acrescenta a versão (id, version, created_at)
      [
        'forjar o compromisso do SHA-256 do prompt',
        `INSERT INTO "prompt_version" (id, version, sha256, registered_at) VALUES ('x', '${'a'.repeat(32)}', '${'b'.repeat(64)}', now())`,
      ],
      [
        'gravar só a hora do registro do prompt',
        `INSERT INTO "prompt_version" (id, version, registered_at) VALUES ('x', '${'a'.repeat(32)}', now())`,
      ],
      [
        'mudar o SHA-256 de uma versão do prompt',
        `UPDATE "prompt_version" SET sha256 = '${'b'.repeat(64)}'`,
      ],
      // a carteira (etapa 12): a linha dela nunca muda nem sai por DELETE direto, e o lançamento só muda nas colunas do PATCH
      ['apagar a carteira direto (só a cascata do usuário a leva)', `DELETE FROM "portfolio"`],
      ['mudar o dono de uma carteira', `UPDATE "portfolio" SET user_id = 'x'`],
      ['mudar a carteira dona de um lançamento', `UPDATE "portfolio_lot" SET portfolio_id = 'x'`],
      ['mudar o id de um lançamento', `UPDATE "portfolio_lot" SET id = 'x'`],
      ['mudar a data de criação de um lançamento', `UPDATE "portfolio_lot" SET created_at = now()`],
      ['esvaziar os lançamentos', `TRUNCATE "portfolio_lot"`],
      ['ler o histórico de migrations', `SELECT * FROM "_prisma_migrations"`],
      ['virar o administrador', `SET ROLE alvesting`],
      ['virar o dono das tabelas', `SET SESSION AUTHORIZATION alvesting`],
      ['criar um papel', `CREATE ROLE intruso LOGIN`],
      ['dar superusuário a si mesmo', `ALTER ROLE ${API_LOGIN} SUPERUSER`],
      ['entrar no grupo do administrador', `GRANT alvesting TO ${API_LOGIN}`],
      ['dar privilégio a si mesmo', `GRANT SELECT ON "order" TO ${API_LOGIN}`],
      ['criar uma extensão', `CREATE EXTENSION IF NOT EXISTS pgcrypto`],
    ])('recusa %s', async (_what, sql) => {
      const error = await attempt(sql);
      expect(error, `deveria ter sido recusado: ${sql}`).toBeDefined();
      expect(denied(error), `${sql}: ${String(error)}`).toBe(true);
    });

    it('appendAudit grava a trilha como o login da api; o `create` do Prisma (que lê a linha de volta) é recusado: por isso o código usa createMany', async () => {
      const asApi = new PrismaService(parseEnv({ DATABASE_URL: apiTestUrl(testDatabaseUrl!) }));
      try {
        await appendAudit(asApi, { actor: 'teste', action: 'teste.papel.append' }, 'alvo');
        await expect(
          asApi.auditLog.create({
            data: auditRow({ actor: 'teste', action: 'teste.papel.create' }, null),
          }),
        ).rejects.toThrow(/denied|permission/i);
        const rows = await admin.query(
          `SELECT action FROM audit_log WHERE action LIKE 'teste.papel.%' ORDER BY action`,
        );
        // o INSERT recusado não deixou linha (o create roda INSERT ... RETURNING num comando só)
        expect(rows.rows.map((row: { action: string }) => row.action)).toEqual([
          'teste.papel.append',
        ]);
      } finally {
        await admin.query(`DELETE FROM audit_log WHERE action LIKE 'teste.papel.%'`);
        await asApi.$disconnect();
      }
    });

    it('recusa criar um banco (o comando não roda dentro de transação, então sem o BEGIN do attempt)', async () => {
      const error = await api.query('CREATE DATABASE intruso').catch((e: unknown) => e);
      expect(denied(error), String(error)).toBe(true);
    });

    it('a trilha de auditoria aceita o INSERT, mas não o RETURNING (que pede SELECT): o código grava com createMany', async () => {
      const row = `INSERT INTO "audit_log" (id, actor, action) VALUES ($1, 'teste', 'teste.papel')`;
      expect(await attempt(row, [newId()])).toBeUndefined();
      expect(denied(await attempt(`${row} RETURNING id`, [newId()]))).toBe(true);
    });

    // O compromisso do SHA-256 do prompt: a api acrescenta a versão (id, version, created_at) e mais nada. Com a tabela inteira ela escolhia o
    // `sha256` (e o `UPDATE ... WHERE sha256 IS NULL` do job de decisões nunca o corrigia): todo ciclo preso àquela versão ficava em HOLD
    // `prompt_divergente` para sempre, e a API pública mostrava o compromisso falso.
    it('prompt_version: o INSERT de id, version e created_at passa, e sha256 ou registered_at, em qualquer combinação, não', async () => {
      const insert = (columns: string, values: string) =>
        `INSERT INTO "prompt_version" (id, ${columns}) VALUES ('${newId()}', ${values})`;
      const v = () => `'${hex32()}'`;
      expect(await attempt(insert('version', v()))).toBeUndefined();
      expect(await attempt(insert('version, created_at', `${v()}, now()`))).toBeUndefined();
      for (const [columns, values] of [
        ['version, sha256', `${v()}, '${'a'.repeat(64)}'`],
        ['version, registered_at', `${v()}, now()`],
        ['version, sha256, registered_at', `${v()}, '${'a'.repeat(64)}', now()`],
        ['version, created_at, sha256', `${v()}, now(), '${'a'.repeat(64)}'`],
      ] as const) {
        const error = await attempt(insert(columns, values));
        expect(denied(error), `${columns}: ${String(error)}`).toBe(true);
      }
    });

    it('ensurePromptVersion de verdade: o createMany com skipDuplicates do Prisma cabe no INSERT por coluna (o que a produção roda)', async () => {
      const asApi = new PrismaService(parseEnv({ DATABASE_URL: apiTestUrl(testDatabaseUrl!) }));
      const version = hex32();
      try {
        const first = await asApi.promptVersion.createMany({
          data: [{ id: newId(), version }],
          skipDuplicates: true,
        });
        const again = await asApi.promptVersion.createMany({
          data: [{ id: newId(), version }],
          skipDuplicates: true,
        });
        expect([first.count, again.count]).toEqual([1, 0]);
        expect(await asApi.promptVersion.findUniqueOrThrow({ where: { version } })).toMatchObject({
          version,
          sha256: null,
          registeredAt: null,
        });
      } finally {
        await admin.query('DELETE FROM prompt_version WHERE version = $1', [version]);
        await asApi.$disconnect();
      }
    });
  });

  // O privilégio de tabela diz o que a api toca, e não em que estado. Sem estes gatilhos uma api comprometida mudava, no banco, o que as rotas de
  // admin recusam em código (409 SEASON_LOCKED): as regras, o elenco e o prazo de uma temporada em andamento, e depois publicava um `settle`, que
  // reliquida a partir do que o banco diz. Migration `20261103120000_api_role_guards`. Cada gatilho vale SÓ para o login da api (session_user).
  describe('o ESTADO em que a api escreve: os gatilhos *_api_guard', () => {
    interface Scene {
      seasonId: string;
      // roda o SQL dentro de um SAVEPOINT e o desfaz: devolve o erro (ou nada, se passou), e a transação segue de pé
      probeIt: (sql: string) => Promise<unknown>;
    }

    // Uma transação do login da api que sempre volta atrás. Monta o que a api monta: uma temporada em rascunho com um competidor MODEL e, se
    // `started`, a inicia (DRAFT -> RUNNING, com a data e a hora).
    async function inApi(started: boolean, body: (scene: Scene) => Promise<void>): Promise<void> {
      await api.query('BEGIN');
      try {
        const seasonId = newId();
        await api.query(
          `INSERT INTO "season" (id, slug, name, params) VALUES ($1, $2, 'Guarda', '{}')`,
          [seasonId, `guarda-${seasonId.toLowerCase()}`],
        );
        await api.query(
          `INSERT INTO "competitor" (id, season_id, slug, name, kind, provider, model_id, position)
           VALUES ($1, $2, 'modelo', 'Modelo', 'MODEL', 'fake', 'fake/modelo', 0)`,
          [newId(), seasonId],
        );
        if (started) {
          await api.query(
            `UPDATE "season" SET status = 'RUNNING', start_date = '2026-11-03', started_at = now() WHERE id = $1`,
            [seasonId],
          );
        }
        const probeIt = async (sql: string) => {
          await api.query('SAVEPOINT sonda');
          try {
            await api.query(sql);
            return undefined;
          } catch (error) {
            return error;
          } finally {
            await api.query('ROLLBACK TO SAVEPOINT sonda');
            await api.query('RELEASE SAVEPOINT sonda');
          }
        };
        await body({ seasonId, probeIt });
      } finally {
        await api.query('ROLLBACK');
      }
    }

    // Recusado PELO GATILHO (e não por falta de privilégio): SQLSTATE 42501 e a mensagem do gatilho.
    const refused = (error: unknown, message: RegExp, what: string) => {
      expect(denied(error), `${what}: ${String(error)}`).toBe(true);
      expect(String((error as Error).message), what).toMatch(message);
    };

    it('cada gatilho *_api_guard do banco está na matriz (coluna `guard`), e cada `guard` da matriz está ligado no banco, antes de cada linha', async () => {
      const { rows } = await admin.query<{
        tbl: string;
        tgname: string;
        before_row: boolean;
        enabled: string;
      }>(
        `SELECT c.relname AS tbl, t.tgname, ((t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2) AS before_row, t.tgenabled AS enabled
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE NOT t.tgisinternal AND t.tgname ~ '_api_guard$' ORDER BY 1`,
      );
      const fromMatrix = POLICY_TABLES.filter((table) => TABLE_POLICY[table]!.guard).map(
        (table) => ({
          tbl: table,
          tgname: TABLE_POLICY[table]!.guard,
          before_row: true,
          enabled: 'O',
        }),
      );
      expect(fromMatrix.map((guard) => guard.tbl).sort()).toEqual([
        'competitor',
        'cycle',
        'job_run',
        'portfolio_lot',
        'season',
      ]);
      expect(rows).toEqual(fromMatrix.sort((a, b) => a.tbl.localeCompare(b.tbl)));
    });

    it('season: a api cria o rascunho, o edita (nome e parâmetros) e o inicia (DRAFT -> RUNNING): o que as rotas de admin fazem passa', async () => {
      await inApi(false, async ({ seasonId, probeIt }) => {
        expect(
          await probeIt(
            `UPDATE "season" SET name = 'Outro nome', params = '{"sessions": 5}' WHERE id = '${seasonId}'`,
          ),
        ).toBeUndefined();
        expect(
          await probeIt(
            `UPDATE "season" SET status = 'RUNNING', start_date = '2026-11-03', started_at = now() WHERE id = '${seasonId}'`,
          ),
        ).toBeUndefined();
      });
    });

    it.each([
      [
        'criar a temporada já em andamento (a regra de uma só em andamento é da rota)',
        false,
        (_season: string) =>
          `INSERT INTO "season" (id, slug, name, params, status, start_date, started_at)
           VALUES ('${newId()}', 'andamento-${newId().toLowerCase()}', 'X', '{}', 'RUNNING', '2026-11-03', now())`,
      ],
      [
        'mudar o slug do rascunho',
        false,
        (id: string) => `UPDATE "season" SET slug = 'outro-slug' WHERE id = '${id}'`,
      ],
      [
        'encerrar o rascunho',
        false,
        (id: string) =>
          `UPDATE "season" SET status = 'FINISHED', start_date = '2026-11-03', finished_at = now() WHERE id = '${id}'`,
      ],
      [
        'mudar as regras (params) da temporada em andamento',
        true,
        (id: string) => `UPDATE "season" SET params = '{"tradeCostBps": 1000}' WHERE id = '${id}'`,
      ],
      [
        'mudar o nome da temporada em andamento',
        true,
        (id: string) => `UPDATE "season" SET name = 'Outro' WHERE id = '${id}'`,
      ],
      [
        'trocar a data de início da temporada em andamento',
        true,
        (id: string) => `UPDATE "season" SET start_date = '2026-12-01' WHERE id = '${id}'`,
      ],
      [
        'encerrar a temporada em andamento (é do worker)',
        true,
        (id: string) =>
          `UPDATE "season" SET status = 'FINISHED', finished_at = now() WHERE id = '${id}'`,
      ],
      [
        'devolver a temporada em andamento a rascunho',
        true,
        (id: string) =>
          `UPDATE "season" SET status = 'DRAFT', start_date = NULL, started_at = NULL WHERE id = '${id}'`,
      ],
      // o prompt fixado (prompt_sha256) é do arena:retroativo, com o login administrador: a api não o escreve em estado nenhum
      [
        'criar o rascunho com o prompt já fixado',
        false,
        (_season: string) =>
          `INSERT INTO "season" (id, slug, name, params, prompt_sha256)
           VALUES ('${newId()}', 'fixado-${newId().toLowerCase()}', 'X', '{}', '${'a'.repeat(64)}')`,
      ],
      [
        'fixar o prompt do rascunho',
        false,
        (id: string) =>
          `UPDATE "season" SET prompt_sha256 = '${'b'.repeat(64)}' WHERE id = '${id}'`,
      ],
      [
        'trocar o prompt fixado da temporada em andamento',
        true,
        (id: string) =>
          `UPDATE "season" SET prompt_sha256 = '${'c'.repeat(64)}' WHERE id = '${id}'`,
      ],
    ])('season: recusa %s', async (what, started, sql) => {
      await inApi(started, async ({ seasonId, probeIt }) => {
        refused(await probeIt(sql(seasonId)), /temporada/, what);
      });
    });

    it('competitor: o elenco do rascunho se troca inteiro (apaga e recria), e o da temporada em andamento não se mexe, nem com um ID de modelo fora do contrato', async () => {
      const insert = (seasonId: string, modelId: string, provider = 'openrouter') =>
        `INSERT INTO "competitor" (id, season_id, slug, name, kind, provider, model_id, position)
         VALUES ('${newId()}', '${seasonId}', 'novo', 'Novo', 'MODEL', '${provider}', '${modelId}', 1)`;
      await inApi(false, async ({ seasonId, probeIt }) => {
        expect(
          await probeIt(`DELETE FROM "competitor" WHERE season_id = '${seasonId}'`),
        ).toBeUndefined();
        expect(await probeIt(insert(seasonId, 'anthropic/claude-opus-5.5'))).toBeUndefined();
      });
      await inApi(true, async ({ seasonId, probeIt }) => {
        refused(
          await probeIt(insert(seasonId, 'perplexity/sonar:online')),
          /elenco/,
          'entrar com o ID :online',
        );
        refused(
          await probeIt(insert(seasonId, 'openrouter/auto')),
          /elenco/,
          'entrar com o roteador',
        );
        refused(
          await probeIt(`DELETE FROM "competitor" WHERE season_id = '${seasonId}'`),
          /elenco/,
          'sair do elenco',
        );
      });
    });

    it('cycle: a api cria o ciclo aberto ou pulado de uma temporada em andamento e reavalia o PULADO; o prazo, a data e a temporada nunca mudam, e o ciclo aberto não muda', async () => {
      // o ciclo aberto aponta um briefing e uma versão do prompt (FK): o briefing é do worker (a api só lê), então nasce pelo administrador
      const briefingId = newId();
      await admin.query(
        `INSERT INTO briefing (id, date, sha256, uri, bytes) VALUES ($1, '2099-01-02', $2, 'http://exemplo.test/briefing', 1)`,
        [briefingId, 'c'.repeat(64)],
      );
      try {
        await inApi(true, async ({ seasonId, probeIt }) => {
          const versionId = newId();
          await api.query(`INSERT INTO "prompt_version" (id, version) VALUES ($1, $2)`, [
            versionId,
            hex32(),
          ]);
          const open = newId();
          const skipped = newId();
          const insertOpen = (id: string, season: string, date: string) =>
            `INSERT INTO "cycle" (id, season_id, date, status, decision_at, deadline_at, briefing_id, prompt_version_id)
             VALUES ('${id}', '${season}', '${date}', 'OPEN', '${date}T12:00:00Z', '${date}T12:30:00Z', '${briefingId}', '${versionId}')`;
          const insertSkipped = (id: string, season: string, date: string) =>
            `INSERT INTO "cycle" (id, season_id, date, status, skip_reason, decision_at, deadline_at)
             VALUES ('${id}', '${season}', '${date}', 'SKIPPED', 'sem_briefing', '${date}T12:00:00Z', '${date}T12:30:00Z')`;
          await api.query(insertOpen(open, seasonId, '2026-11-04'));
          await api.query(insertSkipped(skipped, seasonId, '2026-11-05'));

          // o que o reprocesso faz passa: o pulado muda de motivo ou vira aberto (com o briefing e a versão do prompt)
          expect(
            await probeIt(`UPDATE "cycle" SET skip_reason = 'orcamento' WHERE id = '${skipped}'`),
          ).toBeUndefined();
          expect(
            await probeIt(
              `UPDATE "cycle" SET status = 'OPEN', skip_reason = NULL, briefing_id = '${briefingId}', prompt_version_id = '${versionId}' WHERE id = '${skipped}'`,
            ),
          ).toBeUndefined();

          // o que não: empurrar o prazo (do aberto e do pulado), mexer na hora da decisão, na data, e fechar ou reabrir o ciclo
          for (const [what, sql] of [
            [
              'empurrar o prazo do ciclo aberto',
              `UPDATE "cycle" SET deadline_at = deadline_at + interval '30 days' WHERE id = '${open}'`,
            ],
            [
              'mexer na hora da decisão do ciclo aberto',
              `UPDATE "cycle" SET decision_at = decision_at - interval '1 hour' WHERE id = '${open}'`,
            ],
            [
              'fechar o ciclo aberto',
              `UPDATE "cycle" SET status = 'CLOSED', closed_at = now() WHERE id = '${open}'`,
            ],
            [
              'pular o ciclo aberto',
              `UPDATE "cycle" SET status = 'SKIPPED', skip_reason = 'orcamento', briefing_id = NULL, prompt_version_id = NULL WHERE id = '${open}'`,
            ],
            [
              'empurrar o prazo do ciclo pulado',
              `UPDATE "cycle" SET deadline_at = deadline_at + interval '30 days' WHERE id = '${skipped}'`,
            ],
            [
              'mudar a data do ciclo pulado',
              `UPDATE "cycle" SET date = '2026-11-09' WHERE id = '${skipped}'`,
            ],
            [
              'fechar o ciclo pulado',
              `UPDATE "cycle" SET status = 'CLOSED', skip_reason = NULL, closed_at = now() WHERE id = '${skipped}'`,
            ],
          ] as const) {
            // Desde a migration `20261106120000_retroactive_cycles` o UPDATE da api é só das quatro colunas do reprocesso: prazo, hora da
            // decisão, data e fechamento são recusados pelo PRIVILÉGIO, antes do gatilho; o gatilho segue recusando as quatro fora do estado
            // pulado (pular o ciclo aberto, fechar o pulado)
            refused(await probeIt(sql), /ciclo|permission denied for table cycle/, what);
          }

          // o modo e a hora real (migration `20261106120000_retroactive_cycles`): a api os lê e nunca os escolhe. O UPDATE nem tem o
          // privilégio dessas colunas; o INSERT nomeia as duas (o Prisma manda o padrão), e o gatilho só aceita o AO_VIVO e põe a hora do banco
          for (const [what, sql] of [
            [
              'mudar o modo do ciclo pulado',
              `UPDATE "cycle" SET mode = 'RETROATIVO' WHERE id = '${skipped}'`,
            ],
            [
              'mudar a hora real do ciclo pulado',
              `UPDATE "cycle" SET executed_at = now() WHERE id = '${skipped}'`,
            ],
          ] as const) {
            expect(denied(await probeIt(sql)), what).toBe(true);
          }
          refused(
            await probeIt(
              `INSERT INTO "cycle" (id, season_id, date, status, skip_reason, decision_at, deadline_at, mode)
               VALUES ('${newId()}', '${seasonId}', '2026-11-06', 'SKIPPED', 'sem_briefing', '2026-11-06T11:00:00Z', '2026-11-06T12:30:00Z', 'RETROATIVO')`,
            ),
            /ciclo/,
            'criar o ciclo retroativo',
          );
          const backdated = newId();
          await api.query(
            `INSERT INTO "cycle" (id, season_id, date, status, skip_reason, decision_at, deadline_at, executed_at)
             VALUES ('${backdated}', '${seasonId}', '2026-11-10', 'SKIPPED', 'sem_briefing', '2026-11-10T11:00:00Z', '2026-11-10T12:30:00Z', '2000-01-01T00:00:00Z')`,
          );
          const real = await api.query<{ mode: string; recent: boolean }>(
            `SELECT mode::text AS mode, executed_at > now() - interval '1 minute' AS recent FROM "cycle" WHERE id = $1`,
            [backdated],
          );
          expect(real.rows[0]).toEqual({ mode: 'AO_VIVO', recent: true });

          // criar: nada de ciclo fechado, nem de ciclo em temporada que não está em andamento
          refused(
            await probeIt(
              `INSERT INTO "cycle" (id, season_id, date, status, decision_at, deadline_at, briefing_id, prompt_version_id, closed_at)
               VALUES ('${newId()}', '${seasonId}', '2026-11-06', 'CLOSED', '2026-11-06T12:00:00Z', '2026-11-06T12:30:00Z', '${briefingId}', '${versionId}', now())`,
            ),
            /ciclo/,
            'criar o ciclo já fechado',
          );
          const draft = newId();
          await api.query(
            `INSERT INTO "season" (id, slug, name, params) VALUES ($1, $2, 'Rascunho', '{}')`,
            [draft, `rascunho-${draft.toLowerCase()}`],
          );
          refused(
            await probeIt(insertSkipped(newId(), draft, '2026-11-07')),
            /ciclo/,
            'criar o ciclo de uma temporada em rascunho',
          );
        });
      } finally {
        await admin.query('DELETE FROM briefing WHERE id = $1', [briefingId]);
      }
    });

    it('job_run: a api reabre a liquidação (settle -> FAILED, com o motivo e a hora), e só isso', async () => {
      const settle = newId();
      const eod = newId();
      await admin.query(
        `INSERT INTO job_run (id, queue, type, idempotency_key, status)
         VALUES ($1, 'settlement', 'settle', $3, 'SUCCEEDED'), ($2, 'market', 'eod', $4, 'SUCCEEDED')`,
        [settle, eod, `guarda:${settle}`, `guarda:${eod}`],
      );
      try {
        const reopen = (id: string) =>
          `UPDATE "job_run" SET status = 'FAILED', error = 'reaberto', finished_at = now() WHERE id = '${id}'`;
        expect(await attempt(reopen(settle))).toBeUndefined();
        for (const [what, sql] of [
          ['reabrir um eod', reopen(eod)],
          [
            'marcar a liquidação como feita',
            `UPDATE "job_run" SET status = 'SUCCEEDED' WHERE id = '${settle}'`,
          ],
          [
            'marcar a liquidação como em espera',
            `UPDATE "job_run" SET status = 'WAITING' WHERE id = '${settle}'`,
          ],
          ['mudar o tipo da linha', `UPDATE "job_run" SET type = 'eod' WHERE id = '${settle}'`],
          [
            'mudar a fila da linha',
            `UPDATE "job_run" SET queue = 'maintenance', status = 'FAILED' WHERE id = '${settle}'`,
          ],
          [
            'trocar a chave de idempotência',
            `UPDATE "job_run" SET idempotency_key = 'outra', status = 'FAILED' WHERE id = '${settle}'`,
          ],
          [
            'mexer nas tentativas',
            `UPDATE "job_run" SET attempts = 99, status = 'FAILED' WHERE id = '${settle}'`,
          ],
        ] as const) {
          refused(await attempt(sql), /liquidação/, what);
        }
      } finally {
        await admin.query('DELETE FROM job_run WHERE id IN ($1, $2)', [settle, eod]);
      }
    });

    it('SET ROLE para o papel de grupo não escapa dos gatilhos: eles olham o session_user, que a sessão não troca', async () => {
      await inApi(true, async ({ seasonId, probeIt }) => {
        await api.query(`SET LOCAL ROLE ${API_GROUP_ROLE}`);
        const who = await api.query('SELECT current_user AS atual, session_user AS sessao');
        expect(who.rows[0]).toEqual({ atual: API_GROUP_ROLE, sessao: API_LOGIN });
        refused(
          await probeIt(
            `UPDATE "season" SET params = '{"tradeCostBps": 1000}' WHERE id = '${seasonId}'`,
          ),
          /temporada/,
          'mudar as regras depois do SET ROLE',
        );
      });
    });

    it('os gatilhos são só do login da api: o administrador (workers, decisões, testes) escreve o que ela não pode', async () => {
      await admin.query('BEGIN');
      try {
        const seasonId = newId();
        await admin.query(
          `INSERT INTO "season" (id, slug, name, params, status, start_date, started_at)
           VALUES ($1, $2, 'Em andamento', '{}', 'RUNNING', '2026-11-03', now())`,
          [seasonId, `admin-${seasonId.toLowerCase()}`],
        );
        await admin.query(
          `INSERT INTO "competitor" (id, season_id, slug, name, kind, provider, model_id, position)
           VALUES ($1, $2, 'modelo', 'Modelo', 'MODEL', 'fake', 'fake/modelo', 0)`,
          [newId(), seasonId],
        );
        // a liquidação do worker encerra a temporada; um teste muda as regras de uma em andamento
        const finished = await admin.query(
          `UPDATE "season" SET params = '{"tradeCostBps": 1000}', status = 'FINISHED', finished_at = now() WHERE id = $1`,
          [seasonId],
        );
        expect(finished.rowCount).toBe(1);
        const removed = await admin.query(`DELETE FROM "competitor" WHERE season_id = $1`, [
          seasonId,
        ]);
        expect(removed.rowCount).toBe(1);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });

  // A carteira (etapa 12; migration `20261103130000_portfolio`, ADR 0031): o que as rotas /me/portfolio fazem passa, e o que elas não fazem o
  // banco recusa. As recusas de privilégio e do gatilho saem com SQLSTATE 42501; as de CHECK, com 23514.
  describe('a carteira: portfolio e portfolio_lot', () => {
    const checkViolation = (error: unknown, constraint: string) => {
      expect((error as { code?: string } | null)?.code, String(error)).toBe('23514');
      expect((error as { constraint?: string }).constraint).toBe(constraint);
    };

    // Uma transação do login da api que sempre volta atrás: o usuário, a carteira dele e `lots` lançamentos válidos. `probeIt` roda o SQL
    // num SAVEPOINT e o desfaz (devolve o erro, ou nada se passou).
    async function inPortfolio(
      lots: number,
      body: (scene: {
        userId: string;
        portfolioId: string;
        lotId: string;
        probeIt: (sql: string) => Promise<unknown>;
      }) => Promise<void>,
    ): Promise<void> {
      await api.query('BEGIN');
      try {
        const userId = newId();
        const portfolioId = newId();
        const lotId = `LOT${'1'.padStart(23, '0')}`;
        await api.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Pessoa de Teste', $2)`, [
          userId,
          `carteira-${userId.toLowerCase()}@example.test`,
        ]);
        await api.query(`INSERT INTO "portfolio" (id, user_id) VALUES ($1, $2)`, [
          portfolioId,
          userId,
        ]);
        if (lots > 0) {
          await api.query(
            `INSERT INTO "portfolio_lot" (id, portfolio_id, ticker, quantity, cost_cents)
             SELECT 'LOT' || lpad(n::text, 23, '0'), $1, 'PETR4', 100, 355000 FROM generate_series(1, $2::int) AS n`,
            [portfolioId, lots],
          );
        }
        const probeIt = async (sql: string) => {
          await api.query('SAVEPOINT sonda');
          try {
            await api.query(sql);
            return undefined;
          } catch (error) {
            return error;
          } finally {
            await api.query('ROLLBACK TO SAVEPOINT sonda');
            await api.query('RELEASE SAVEPOINT sonda');
          }
        };
        await body({ userId, portfolioId, lotId, probeIt });
      } finally {
        await api.query('ROLLBACK');
      }
    }
    const insertLot = (portfolioId: string, boughtOn?: string) =>
      boughtOn === undefined
        ? `INSERT INTO "portfolio_lot" (id, portfolio_id, ticker, quantity, cost_cents)
           VALUES ('${newId()}', '${portfolioId}', 'VALE3', 10, 99900)`
        : `INSERT INTO "portfolio_lot" (id, portfolio_id, ticker, quantity, cost_cents, bought_on)
           VALUES ('${newId()}', '${portfolioId}', 'VALE3', 10, 99900, ${boughtOn})`;

    it('o que as rotas fazem passa: criar o lançamento, trocar as colunas do PATCH, apagar, e a escrita do dono numa instrução só (com RETURNING)', async () => {
      await inPortfolio(1, async ({ userId, portfolioId, lotId, probeIt }) => {
        expect(await probeIt(insertLot(portfolioId, `'2026-10-15'`))).toBeUndefined();
        expect(
          await probeIt(
            `UPDATE "portfolio_lot" SET ticker = 'ITUB4', quantity = 5, cost_cents = 12345, bought_on = NULL, updated_at = now() WHERE id = '${lotId}'`,
          ),
        ).toBeUndefined();
        expect(await probeIt(`DELETE FROM "portfolio_lot" WHERE id = '${lotId}'`)).toBeUndefined();
        // o molde que o repositório usa: o dono entra na MESMA instrução, e o RETURNING (que pede SELECT) devolve a linha
        const owned = await api.query(
          `UPDATE "portfolio_lot" l SET quantity = 7, updated_at = now() FROM "portfolio" p
           WHERE l.id = $1 AND l.portfolio_id = p.id AND p.user_id = $2 RETURNING l.id`,
          [lotId, userId],
        );
        expect(owned.rows).toEqual([{ id: lotId }]);
        const notOwned = await api.query(
          `UPDATE "portfolio_lot" l SET quantity = 8, updated_at = now() FROM "portfolio" p
           WHERE l.id = $1 AND l.portfolio_id = p.id AND p.user_id = $2 RETURNING l.id`,
          [lotId, newId()],
        );
        expect(notOwned.rows).toEqual([]);
      });
    });

    it('o teto de 200 lançamentos por carteira: o 200º passa, o 201º é recusado pelo gatilho (42501), em um INSERT ou em muitos de uma vez', async () => {
      await inPortfolio(199, async ({ portfolioId, probeIt }) => {
        expect(await probeIt(insertLot(portfolioId))).toBeUndefined();
      });
      await inPortfolio(200, async ({ portfolioId, probeIt }) => {
        const error = await probeIt(insertLot(portfolioId));
        expect(denied(error), String(error)).toBe(true);
        expect(String((error as Error).message)).toMatch(/200 lançamentos/);
      });
      // muitos de uma vez: a linha que passa do teto na MESMA instrução também é recusada, e a instrução toda volta atrás
      await inPortfolio(199, async ({ portfolioId, probeIt }) => {
        const bulk = await probeIt(
          `INSERT INTO "portfolio_lot" (id, portfolio_id, ticker, quantity, cost_cents)
           SELECT 'BULK' || lpad(n::text, 22, '0'), '${portfolioId}', 'VALE3', 1, 1 FROM generate_series(1, 2) AS n`,
        );
        expect(denied(bulk), String(bulk)).toBe(true);
      });
    });

    it('o teto é POR CARTEIRA: a carteira de outro usuário não conta', async () => {
      await inPortfolio(200, async ({ probeIt }) => {
        const otherUser = newId();
        const otherPortfolio = newId();
        await api.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Outra Pessoa', $2)`, [
          otherUser,
          `outra-${otherUser.toLowerCase()}@example.test`,
        ]);
        await api.query(`INSERT INTO "portfolio" (id, user_id) VALUES ($1, $2)`, [
          otherPortfolio,
          otherUser,
        ]);
        expect(await probeIt(insertLot(otherPortfolio))).toBeUndefined();
      });
    });

    it('sem corrida: dois INSERT juntos no último lugar não passam do teto (a trava consultiva faz o segundo contar depois do primeiro)', async () => {
      const second = new pg.Client({ connectionString: apiTestUrl(testDatabaseUrl!) });
      await second.connect();
      const userId = newId();
      const portfolioId = newId();
      try {
        // 199 lançamentos já confirmados, para as duas conexões os enxergarem
        await api.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Pessoa de Teste', $2)`, [
          userId,
          `corrida-${userId.toLowerCase()}@example.test`,
        ]);
        await api.query(`INSERT INTO "portfolio" (id, user_id) VALUES ($1, $2)`, [
          portfolioId,
          userId,
        ]);
        await api.query(
          `INSERT INTO "portfolio_lot" (id, portfolio_id, ticker, quantity, cost_cents)
           SELECT 'RACE' || lpad(n::text, 22, '0'), $1, 'PETR4', 100, 355000 FROM generate_series(1, 199) AS n`,
          [portfolioId],
        );

        // A pega o último lugar e NÃO confirma; B tenta o mesmo lugar e tem de ficar esperando a trava
        await api.query('BEGIN');
        await api.query(insertLot(portfolioId));
        await second.query('BEGIN');
        let settled = false;
        const attemptB = second.query(insertLot(portfolioId)).then(
          () => {
            settled = true;
            return undefined;
          },
          (error: unknown) => {
            settled = true;
            return error;
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(settled, 'B devia esperar a trava de A').toBe(false);

        await api.query('COMMIT');
        const errorOfB = await attemptB;
        await second.query('ROLLBACK');
        expect(denied(errorOfB), String(errorOfB)).toBe(true);
        expect(String((errorOfB as Error).message)).toMatch(/200 lançamentos/);

        const count = await admin.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "portfolio_lot" WHERE portfolio_id = $1`,
          [portfolioId],
        );
        expect(count.rows[0]!.n).toBe(200);
      } finally {
        await api.query('ROLLBACK').catch(() => undefined);
        await second.end();
        await admin.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
      }
    });

    it('o UPDATE da api é só das colunas do PATCH: a carteira dona, o id e a data de criação são recusados por privilégio de coluna (42501)', async () => {
      await inPortfolio(1, async ({ lotId, portfolioId, probeIt }) => {
        for (const [what, set] of [
          ['mudar a carteira dona', `portfolio_id = '${portfolioId}'`],
          ['mudar o id', `id = 'OUTRO'`],
          ['mudar a data de criação', `created_at = now()`],
        ] as const) {
          const error = await probeIt(`UPDATE "portfolio_lot" SET ${set} WHERE id = '${lotId}'`);
          expect(denied(error), `${what}: ${String(error)}`).toBe(true);
        }
      });
    });

    it('os CHECKs: quantidade de 1 a 1.000.000, custo de 1 centavo a R$ 1.000.000.000,00, ticker no formato do contrato e data a partir de 1900', async () => {
      await inPortfolio(0, async ({ portfolioId, probeIt }) => {
        const lot = (patch: Record<string, string>) => {
          const values = {
            ticker: `'PETR4'`,
            quantity: '100',
            cost_cents: '355000',
            bought_on: 'NULL',
            ...patch,
          };
          return `INSERT INTO "portfolio_lot" (id, portfolio_id, ${Object.keys(values).join(', ')})
                  VALUES ('${newId()}', '${portfolioId}', ${Object.values(values).join(', ')})`;
        };
        // os limites exatos passam
        const passes: Array<Record<string, string>> = [
          { quantity: '1', cost_cents: '1' },
          { quantity: '1000000', cost_cents: '100000000000' },
          { ticker: `'B3SA3'` },
          { ticker: `'BOVA11'` },
          { bought_on: `'1900-01-01'` },
        ];
        for (const patch of passes) {
          expect(await probeIt(lot(patch)), JSON.stringify(patch)).toBeUndefined();
        }
        // e um passo além é recusado, cada um pela sua restrição
        const fails: Array<[Record<string, string>, string]> = [
          [{ quantity: '0' }, 'portfolio_lot_quantity_check'],
          [{ quantity: '-5' }, 'portfolio_lot_quantity_check'],
          [{ quantity: '1000001' }, 'portfolio_lot_quantity_check'],
          [{ cost_cents: '0' }, 'portfolio_lot_cost_check'],
          [{ cost_cents: '-1' }, 'portfolio_lot_cost_check'],
          [{ cost_cents: '100000000001' }, 'portfolio_lot_cost_check'],
          [{ ticker: `'petr4'` }, 'portfolio_lot_ticker_check'],
          [{ ticker: `'PETR'` }, 'portfolio_lot_ticker_check'],
          [{ ticker: `'PETR4X'` }, 'portfolio_lot_ticker_check'],
          [{ ticker: `'PE TR4'` }, 'portfolio_lot_ticker_check'],
          [{ ticker: `''` }, 'portfolio_lot_ticker_check'],
          [{ bought_on: `'1899-12-31'` }, 'portfolio_lot_bought_on_check'],
          [{ bought_on: `'0001-01-01'` }, 'portfolio_lot_bought_on_check'],
        ];
        for (const [patch, constraint] of fails) {
          checkViolation(await probeIt(lot(patch)), constraint);
        }
        // o ticker maior que a coluna (12 caracteres) é recusado pelo próprio tipo
        const tooLong = await probeIt(lot({ ticker: `'ABCDEFGHIJKLM4'` }));
        expect((tooLong as { code?: string }).code).toBe('22001');
      });
    });

    it('excluir o usuário leva a carteira e os lançamentos junto SEM a api ter DELETE em portfolio: a cascata roda com os privilégios do dono da tabela', async () => {
      await inPortfolio(3, async ({ userId, portfolioId, probeIt }) => {
        // o DELETE direto na carteira é recusado pelo PRIVILÉGIO...
        const direct = await probeIt(`DELETE FROM "portfolio" WHERE id = '${portfolioId}'`);
        expect(denied(direct), String(direct)).toBe(true);
        // ...e o do usuário passa e leva a carteira e os 3 lançamentos em cascata
        const removed = await api.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
        expect(removed.rowCount).toBe(1);
        const left = await api.query<{ portfolios: number; lots: number }>(
          `SELECT (SELECT count(*)::int FROM "portfolio" WHERE user_id = $1) AS portfolios,
                  (SELECT count(*)::int FROM "portfolio_lot" WHERE portfolio_id = $2) AS lots`,
          [userId, portfolioId],
        );
        expect(left.rows[0]).toEqual({ portfolios: 0, lots: 0 });
      });
    });

    it('o gatilho do teto é só do login da api: o administrador (semear, testes) passa dos 200', async () => {
      await admin.query('BEGIN');
      try {
        const userId = newId();
        const portfolioId = newId();
        await admin.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Pessoa', $2)`, [
          userId,
          `admin-carteira-${userId.toLowerCase()}@example.test`,
        ]);
        await admin.query(`INSERT INTO "portfolio" (id, user_id) VALUES ($1, $2)`, [
          portfolioId,
          userId,
        ]);
        const inserted = await admin.query(
          `INSERT INTO "portfolio_lot" (id, portfolio_id, ticker, quantity, cost_cents)
           SELECT 'ADM' || lpad(n::text, 23, '0'), $1, 'PETR4', 1, 1 FROM generate_series(1, 201) AS n`,
          [portfolioId],
        );
        expect(inserted.rowCount).toBe(201);
      } finally {
        await admin.query('ROLLBACK');
      }
    });
  });
});
