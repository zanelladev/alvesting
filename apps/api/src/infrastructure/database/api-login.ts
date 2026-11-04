import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';
import { API_GROUP_ROLE, API_LOGIN } from './table-policy.js';

// O login da api no Postgres (papel mínimo, onda 3d; docs/INFRA.md, 2.2 e 2.7; ADR 0028): membro do papel de grupo `alvesting_api_group`
// que a migration `20261103100000_api_role` cria e preenche. Quem cria o login e define a senha é este comando idempotente, que roda com
// o login ADMINISTRADOR (DATABASE_URL) depois do `prisma migrate deploy`, lendo a senha da URL do papel novo (API_DATABASE_URL). A senha
// nunca entra no repositório, numa migration nem num log.

// A consulta mais lenta medida na api foi de 36,7 ms (docs/API.md, seção 4, sem índice; com índice, sub-milissegundo), e as rotas do admin
// são de poucos milissegundos. 10 s dá mais de 270 vezes de folga e segura uma rota anônima presa em vez dos 60 s dos workers.
// ponytail: o ALTER ROLE ... SET é só o PADRÃO do papel (o cliente pode dar um SET statement_timeout na própria sessão); o que o
// limita de fato é o pool da api não mandar o dele (PrismaService: o login da api vem sem o statement_timeout de 60 s do pool), então
// vale o do papel. Se um dia a api precisar de uma consulta mais longa, ela abre uma transação com SET LOCAL.
export const API_STATEMENT_TIMEOUT_MS = 10_000;

// O limite de conexões do login (ALTER ROLE ... CONNECTION LIMIT). O B1ms tem uns 50 (docs/INFRA.md, 2.2) e a api chega a 5 réplicas × 4
// conexões do pool (apiMaxReplicas e `POOL.max` do PrismaService) = 20; 24 dá folga para uma réplica nova subindo enquanto a velha drena.
// Sem o limite, uma api comprometida (ou com defeito) abre conexão até esgotar o servidor e deixa o worker, as decisões e os agendadores
// sem conexão. Ao contrário do statement_timeout (um padrão que a sessão desfaz com RESET), o papel comum NÃO consegue tirar o limite do
// próprio login. Só em produção: em dev e no e2e o login é dividido por todos os processos da api da máquina (o e2e sobe sete), sobre um
// servidor de 100 conexões, e -1 é o "sem limite" do Postgres.
// ponytail: o número é a conta acima, escrita à mão; se as réplicas máximas ou o pool mudarem, ele muda junto.
export const API_CONNECTION_LIMIT = 24;
export const connectionLimitFor = (production: boolean): number =>
  production ? API_CONNECTION_LIMIT : -1;

// A senha do login no .env.example (só dev): a produção a recusa.
export const DEV_API_PASSWORD = 'alvesting_api';
const MIN_PASSWORD = 8;
const MIN_PRODUCTION_PASSWORD = 32;

// O resumo SCRAM-SHA-256 que o PostgreSQL guarda em pg_authid (RFC 5802 e 7677; a mesma conta de scram_build_secret): o ALTER ROLE o aceita
// no lugar da senha, e então a senha em texto nunca passa pelo comando SQL (que um erro, o log do servidor ou o pg_stat_statements
// guardariam). O servidor confere o login contra ele sem saber a senha. A SASLprep é a identidade para ASCII imprimível, que é o que
// `apiLoginPassword` deixa passar.
export function scramSha256(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations = 4096,
): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const hmac = (key: Buffer, text: string) => createHmac('sha256', key).update(text).digest();
  const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest();
  const serverKey = hmac(salted, 'Server Key');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

const VERIFIER = /^SCRAM-SHA-256\$\d{1,7}:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

// A senha do login, lida da URL do papel. As mensagens de erro nunca repetem a URL nem a senha. Só o login `alvesting_api` é aceito:
// uma URL de outro usuário (a do administrador, por engano) não vira um papel novo.
export function apiLoginPassword(
  apiUrl: string,
  production: boolean = process.env.NODE_ENV === 'production',
): string {
  if (!URL.canParse(apiUrl) || !/^postgres(ql)?:$/.test(new URL(apiUrl).protocol)) {
    throw new Error(
      `API_DATABASE_URL inválida: esperava postgresql://${API_LOGIN}:<senha>@<host>:<porta>/<banco>`,
    );
  }
  const url = new URL(apiUrl);
  if (decodeURIComponent(url.username) !== API_LOGIN) {
    throw new Error(`O usuário da API_DATABASE_URL tem de ser "${API_LOGIN}"`);
  }
  const password = decodeURIComponent(url.password);
  if (password.length < MIN_PASSWORD) {
    throw new Error(`A senha da API_DATABASE_URL tem de ter pelo menos ${MIN_PASSWORD} caracteres`);
  }
  if (!/^[\x20-\x7e]+$/.test(password)) {
    throw new Error('A senha da API_DATABASE_URL só pode ter caracteres ASCII imprimíveis');
  }
  if (production && (password === DEV_API_PASSWORD || password.length < MIN_PRODUCTION_PASSWORD)) {
    throw new Error(
      `Em produção a senha da API_DATABASE_URL tem de ter pelo menos ${MIN_PRODUCTION_PASSWORD} caracteres e ser diferente da do .env.example`,
    );
  }
  return password;
}

// O SQL, repetível: cria o login se faltar (sem atributo nenhum além de LOGIN: o administrador do Azure não é superusuário e pode não ter
// REPLICATION nem BYPASSRLS para repassar; os padrões do CREATE ROLE já são NO*), troca o resumo da senha, fixa o statement_timeout e o
// limite de conexões e o põe no grupo. O EXCEPTION cobre o login que já existe (duplicate_object) e dois comandos simultâneos, em que o
// segundo perde a corrida no catálogo (unique_violation): papel é do servidor inteiro, e este comando e a migration do grupo podem rodar
// ao mesmo tempo. `connectionLimit` (-1 = sem limite) é inteiro e entra no SQL: nada além disso passa.
export function provisioningStatements(verifier: string, connectionLimit = -1): string[] {
  if (!VERIFIER.test(verifier)) throw new Error('Resumo SCRAM fora do formato do PostgreSQL');
  if (!Number.isInteger(connectionLimit) || connectionLimit < -1) {
    throw new Error('O limite de conexões do login é um inteiro, -1 (sem limite) ou mais');
  }
  return [
    `DO $$
BEGIN
  CREATE ROLE "${API_LOGIN}" LOGIN;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END
$$`,
    // a senha e o limite num ALTER só: o e2e sobe vários processos que rodam este comando juntos, e cada ALTER ROLE é uma escrita na mesma linha
    // do catálogo (dois concorrentes dão "tuple concurrently updated"); com um comando só a janela é a de antes do limite
    `ALTER ROLE "${API_LOGIN}" WITH LOGIN PASSWORD '${verifier}' CONNECTION LIMIT ${connectionLimit}`,
    `ALTER ROLE "${API_LOGIN}" SET statement_timeout = '${API_STATEMENT_TIMEOUT_MS}ms'`,
    `GRANT "${API_GROUP_ROLE}" TO "${API_LOGIN}"`,
  ];
}

// Confere o que o comando não pede mas não pode faltar: um login que já existia e ganhou atributo ou outro grupo por fora (alguém
// dar CREATEROLE ao papel da api desfaria o propósito dele), e um servidor em que o login conseguiria criar objetos no esquema `public`
// (CREATE concedido a PUBLIC, o padrão do PostgreSQL 14 e anteriores; a migration `20261103110000_api_role_least_privilege` o tira, e
// aqui se confere o que o servidor de fato faz), e o limite de conexões que o comando acabou de fixar (`rolconnlimit`). Falha em vez de
// corrigir: mudar atributo exige privilégio que o administrador do Azure pode não ter, e o desvio é para um humano ver.
// DISTINCT: no PostgreSQL 16 em diante o mesmo grupo pode estar concedido por dois concedentes (duas linhas em pg_auth_members), e a
// conferência de "só um grupo" não pode contá-lo duas vezes.
export const AUDIT_SQL = `
SELECT r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls, r.rolconnlimit,
       has_schema_privilege(r.oid, 'public', 'CREATE') AS schema_create,
       COALESCE((SELECT array_agg(DISTINCT g.rolname::text ORDER BY g.rolname::text) FROM pg_auth_members m
                 JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid), '{}') AS member_of
FROM pg_roles r WHERE r.rolname = $1`;

export interface RoleAudit {
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  // o CONNECTION LIMIT do papel (-1 = sem limite)
  rolconnlimit: number;
  schema_create: boolean;
  member_of: string[];
}

// O desvio que o `db:roles` não aceita (a mensagem), ou nada se o login está como a matriz espera. `role` ausente = o login não existe.
// `connectionLimit`: o que o comando acabou de fixar (connectionLimitFor), e que o catálogo tem de mostrar.
export function auditProblem(
  role: RoleAudit | undefined,
  connectionLimit = -1,
): string | undefined {
  const flags = role
    ? [role.rolsuper, role.rolcreaterole, role.rolcreatedb, role.rolreplication, role.rolbypassrls]
    : [true];
  if (!role?.rolcanlogin || flags.some(Boolean)) {
    return `O papel "${API_LOGIN}" tem atributo de administração (superusuário, criar papel ou banco, replicação ou bypass de RLS) ou não faz login: corrija à mão`;
  }
  if (role.member_of.length !== 1 || role.member_of[0] !== API_GROUP_ROLE) {
    return `O papel "${API_LOGIN}" tem de ser membro só de "${API_GROUP_ROLE}" (é de: ${role.member_of.join(', ') || 'nenhum'})`;
  }
  if (role.schema_create) {
    return `O papel "${API_LOGIN}" pode criar objetos no esquema public (CREATE no esquema public concedido a PUBLIC ou ao grupo): rode "REVOKE CREATE ON SCHEMA public FROM PUBLIC" com o dono do esquema`;
  }
  if (role.rolconnlimit !== connectionLimit) {
    return `O papel "${API_LOGIN}" tem CONNECTION LIMIT ${role.rolconnlimit} e o esperado é ${connectionLimit}: rode o comando de novo (ALTER ROLE ... CONNECTION LIMIT)`;
  }
  return undefined;
}

export interface ProvisionResult {
  login: string;
  group: string;
  statementTimeoutMs: number;
  // -1 = sem limite (dev e testes)
  connectionLimit: number;
}

// Prazo para abrir a conexão: um banco inalcançável (o endereço certo sem rota, a regra de rede) não deixa o comando esperando o prazo do
// sistema operacional.
const CONNECT_TIMEOUT_MS = 30_000;

export async function provisionApiLogin(
  adminUrl: string,
  apiUrl: string,
  production: boolean = process.env.NODE_ENV === 'production',
): Promise<ProvisionResult> {
  const password = apiLoginPassword(apiUrl, production);
  const client = new pg.Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // uma conexão que cai emite 'error', e sem ouvinte o Node derruba o processo com a pilha; a consulta pendente falha por conta própria,
  // com a mensagem do driver, e é essa que o comando mostra
  client.on('error', () => undefined);
  await client.connect();
  try {
    const group = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [API_GROUP_ROLE]);
    if (group.rowCount === 0) {
      throw new Error(
        `O papel de grupo "${API_GROUP_ROLE}" não existe: rode o migrate deploy (migration 20261103100000_api_role) antes deste comando`,
      );
    }
    const connectionLimit = connectionLimitFor(production);
    await client.query('BEGIN');
    try {
      for (const statement of provisioningStatements(scramSha256(password), connectionLimit)) {
        await client.query(statement);
      }
      const { rows } = await client.query<RoleAudit>(AUDIT_SQL, [API_LOGIN]);
      const problem = auditProblem(rows[0], connectionLimit);
      if (problem) throw new Error(problem);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    return {
      login: API_LOGIN,
      group: API_GROUP_ROLE,
      statementTimeoutMs: API_STATEMENT_TIMEOUT_MS,
      connectionLimit,
    };
  } finally {
    await client.end();
  }
}
