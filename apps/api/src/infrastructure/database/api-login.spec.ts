import { describe, expect, it } from 'vitest';
import {
  API_CONNECTION_LIMIT,
  API_STATEMENT_TIMEOUT_MS,
  apiLoginPassword,
  auditProblem,
  connectionLimitFor,
  provisioningStatements,
  scramSha256,
  type RoleAudit,
} from './api-login.js';
import { API_GROUP_ROLE, API_LOGIN } from './table-policy.js';

// O comando que cria o login da api e define a senha dele (a senha vem da URL do papel, no ambiente, e nunca do repositório nem de uma
// migration). A parte com banco está no api-role.integration.spec.ts; aqui a lógica pura: o resumo SCRAM, a leitura da URL e o SQL.
const url = (user: string, password: string) =>
  `postgresql://${user}:${encodeURIComponent(password)}@localhost:25432/alvesting_dev`;

describe('scramSha256: o resumo que o ALTER ROLE recebe no lugar da senha', () => {
  it('tem o formato do PostgreSQL (SCRAM-SHA-256$iterações:sal$chave guardada:chave do servidor, tudo em base64)', () => {
    const verifier = scramSha256('uma-senha-qualquer-1', Buffer.alloc(16, 7));
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/,
    );
    expect(verifier).toContain(Buffer.alloc(16, 7).toString('base64'));
  });

  it('é determinístico com o mesmo sal, e muda com outra senha ou outro sal (cada execução usa um sal novo)', () => {
    const salt = Buffer.alloc(16, 1);
    expect(scramSha256('senha-1-aaaa', salt)).toBe(scramSha256('senha-1-aaaa', salt));
    expect(scramSha256('senha-1-aaaa', salt)).not.toBe(scramSha256('senha-2-aaaa', salt));
    expect(scramSha256('senha-1-aaaa', salt)).not.toBe(
      scramSha256('senha-1-aaaa', Buffer.alloc(16, 2)),
    );
    expect(scramSha256('senha-1-aaaa')).not.toBe(scramSha256('senha-1-aaaa'));
  });

  it('não carrega a senha: nem inteira nem em base64', () => {
    const password = 'segredo-que-nao-pode-vazar-9';
    const verifier = scramSha256(password);
    expect(verifier).not.toContain(password);
    expect(verifier).not.toContain(Buffer.from(password).toString('base64'));
  });
});

describe('apiLoginPassword: a senha vem da URL do papel, e só dela', () => {
  it('lê a senha (decodificada) de uma URL do login da api', () => {
    expect(apiLoginPassword(url(API_LOGIN, 'a/b+c=d senha'), false)).toBe('a/b+c=d senha');
  });

  it('recusa URL que não é do login da api (o comando não cria outro papel por engano)', () => {
    expect(() => apiLoginPassword(url('alvesting', 'senha-valida-1'), false)).toThrow(
      new RegExp(`"${API_LOGIN}"`),
    );
    expect(() => apiLoginPassword(url('postgres', 'senha-valida-1'), false)).toThrow(/usuário/);
  });

  it('recusa URL torta, sem senha, com senha curta ou com caractere que o resumo não normaliza', () => {
    expect(() => apiLoginPassword('isto nao e uma url', false)).toThrow(/API_DATABASE_URL/);
    expect(() => apiLoginPassword(`postgresql://${API_LOGIN}@localhost/x`, false)).toThrow(/senha/);
    expect(() => apiLoginPassword(url(API_LOGIN, 'curta'), false)).toThrow(/senha/);
    expect(() => apiLoginPassword(url(API_LOGIN, 'senha-com-acentuação-1'), false)).toThrow(
      /ASCII/,
    );
    expect(() => apiLoginPassword(url(API_LOGIN, 'senha\ncom-quebra-1'), false)).toThrow(/ASCII/);
  });

  it('em produção exige senha longa e não aceita a do .env.example', () => {
    expect(() => apiLoginPassword(url(API_LOGIN, 'alvesting_api'), true)).toThrow(/produção/);
    expect(() => apiLoginPassword(url(API_LOGIN, 'uma-senha-de-trinta-caracteres'), true)).toThrow(
      /produção/,
    );
    expect(apiLoginPassword(url(API_LOGIN, 'x'.repeat(32)), true)).toBe('x'.repeat(32));
    // fora de produção a senha de dev serve
    expect(apiLoginPassword(url(API_LOGIN, 'alvesting_api'), false)).toBe('alvesting_api');
  });

  it('a mensagem de erro nunca repete a senha', () => {
    for (const bad of ['curta', 'senha-com-acentuação-1']) {
      try {
        apiLoginPassword(url(API_LOGIN, bad), false);
      } catch (error) {
        expect(String((error as Error).message)).not.toContain(bad);
      }
    }
  });
});

describe('provisioningStatements: o SQL do comando', () => {
  const verifier = scramSha256('uma-senha-longa-de-teste-1');
  const sql = provisioningStatements(verifier).join('\n');

  it('cria o login se faltar, define o resumo, o statement_timeout e a participação no grupo, tudo repetível', () => {
    expect(sql).toMatch(/CREATE ROLE "alvesting_api" LOGIN/);
    // o login que já existe E o comando simultâneo que perde a corrida no catálogo (a migration do grupo trata os dois também)
    expect(sql).toMatch(/EXCEPTION WHEN duplicate_object OR unique_violation THEN/);
    expect(sql).toContain(`ALTER ROLE "${API_LOGIN}" WITH LOGIN PASSWORD '${verifier}'`);
    expect(sql).toContain(
      `ALTER ROLE "${API_LOGIN}" SET statement_timeout = '${API_STATEMENT_TIMEOUT_MS}ms'`,
    );
    expect(sql).toContain(`GRANT "${API_GROUP_ROLE}" TO "${API_LOGIN}"`);
  });

  it('não pede nenhum atributo que o administrador do Azure pode não ter (superusuário, replicação, bypass de RLS)', () => {
    expect(sql).not.toMatch(/SUPERUSER|REPLICATION|BYPASSRLS|CREATEDB|CREATEROLE/i);
  });

  it('o statement_timeout da api é menor que os 60 s do pool dos workers e maior que a consulta mais lenta medida (36,7 ms)', () => {
    expect(API_STATEMENT_TIMEOUT_MS).toBeLessThan(60_000);
    expect(API_STATEMENT_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });

  // O papel comum não tira o limite do próprio login (ao contrário do statement_timeout, que a sessão desfaz): uma api comprometida não
  // esgota as ~50 conexões do B1ms e deixa o worker, as decisões e os agendadores sem conexão.
  it('fixa o limite de conexões: -1 (sem limite) por padrão, e o número pedido em produção', () => {
    expect(sql).toContain(
      `ALTER ROLE "${API_LOGIN}" WITH LOGIN PASSWORD '${verifier}' CONNECTION LIMIT -1`,
    );
    expect(provisioningStatements(verifier, 24).join('\n')).toContain(
      `ALTER ROLE "${API_LOGIN}" WITH LOGIN PASSWORD '${verifier}' CONNECTION LIMIT 24`,
    );
  });

  it('a senha e o limite vão no MESMO ALTER ROLE: o e2e roda o comando em vários processos juntos, e cada ALTER ROLE é uma escrita na mesma linha do catálogo', () => {
    const alters = provisioningStatements(verifier).filter((statement) =>
      /^ALTER ROLE "[^"]+" (WITH|CONNECTION|PASSWORD)/.test(statement),
    );
    expect(alters).toHaveLength(1);
  });

  it('o limite entra no SQL, então só passa inteiro: nada de texto, fração ou menor que -1', () => {
    for (const bad of [1.5, -2, Number.NaN, Infinity]) {
      expect(() => provisioningStatements(verifier, bad)).toThrow(/inteiro/);
    }
    expect(() => provisioningStatements(verifier, '24; DROP ROLE x' as unknown as number)).toThrow(
      /inteiro/,
    );
  });

  it('só produção tem limite (dev e e2e dividem o login entre os processos da api da máquina); o de produção cobre 5 réplicas × 4 conexões e cabe nas ~50 do B1ms', () => {
    expect(connectionLimitFor(false)).toBe(-1);
    expect(connectionLimitFor(true)).toBe(API_CONNECTION_LIMIT);
    expect(API_CONNECTION_LIMIT).toBeGreaterThanOrEqual(5 * 4);
    expect(API_CONNECTION_LIMIT).toBeLessThan(50);
  });
});

// O que o comando confere depois de provisionar: o login sem atributo de administração, membro só do grupo e sem CREATE no esquema public.
// O SQL que lê isso do catálogo está provado contra o banco no api-role.integration.spec.ts; aqui, a decisão sobre o que ele devolve.
describe('auditProblem: o desvio que o comando não aceita', () => {
  const good: RoleAudit = {
    rolcanlogin: true,
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconnlimit: -1,
    schema_create: false,
    member_of: [API_GROUP_ROLE],
  };

  it('o login como a matriz espera passa', () => {
    expect(auditProblem(good)).toBeUndefined();
  });

  it('o limite de conexões tem de ser o que o comando fixou: o do papel diferente é recusado, nos dois sentidos', () => {
    expect(auditProblem({ ...good, rolconnlimit: 24 }, 24)).toBeUndefined();
    expect(auditProblem({ ...good, rolconnlimit: -1 }, 24)).toMatch(
      /CONNECTION LIMIT -1 e o esperado é 24/,
    );
    expect(auditProblem({ ...good, rolconnlimit: 3 })).toMatch(
      /CONNECTION LIMIT 3 e o esperado é -1/,
    );
  });

  it.each([
    ['rolsuper'],
    ['rolcreaterole'],
    ['rolcreatedb'],
    ['rolreplication'],
    ['rolbypassrls'],
  ] as const)('atributo %s é recusado', (flag) => {
    expect(auditProblem({ ...good, [flag]: true })).toMatch(/atributo de administração/);
  });

  it('login que não faz login, ou que não existe, é recusado', () => {
    expect(auditProblem({ ...good, rolcanlogin: false })).toMatch(/atributo de administração/);
    expect(auditProblem(undefined)).toMatch(/atributo de administração/);
  });

  it('membro de outro grupo, de nenhum ou de mais de um é recusado, e a mensagem diz de quais é', () => {
    expect(auditProblem({ ...good, member_of: [] })).toMatch(/é de: nenhum/);
    expect(auditProblem({ ...good, member_of: ['pg_read_all_data'] })).toMatch(
      /membro só de "alvesting_api_group" \(é de: pg_read_all_data\)/,
    );
    expect(auditProblem({ ...good, member_of: [API_GROUP_ROLE, 'pg_read_all_data'] })).toMatch(
      /é de: alvesting_api_group, pg_read_all_data/,
    );
  });

  it('login que pode criar objetos no esquema public é recusado (a api não cria nada)', () => {
    expect(auditProblem({ ...good, schema_create: true })).toMatch(/CREATE no esquema public/);
  });
});
