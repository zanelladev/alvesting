import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  TEMP_DATABASE,
  assertTempDatabase,
  collect,
  connectionArgs,
  databaseTarget,
  dropTempDatabase,
  dumpArgs,
  majorOfVersionText,
  restoreArgs,
  spawnProcess,
  tempDatabaseName,
  toolEnv,
} from './pg-tools.js';

// As peças do backup-verify que não dependem de banco nem de pg_dump: o banco temporário e a trava que o protege, a URL do administrador
// virando argumentos (sem a senha) e ambiente, a versão dos binários e o processo filho com prazo e abort.
const URL_ADMIN = `postgresql://alvesting:${encodeURIComponent('s3nh@-com/barra')}@db.example.test:6543/alvesting?sslmode=require`;

describe('o banco temporário da restauração de teste', () => {
  it('o nome é alvesting_verify_AAAAMM_<8 hexadecimais>, e cada execução tem o seu', () => {
    const a = tempDatabaseName('2026-11');
    const b = tempDatabaseName('2026-11');
    expect(a).toMatch(TEMP_DATABASE);
    expect(a).toMatch(/^alvesting_verify_202611_[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(tempDatabaseName('2026-11', 'deadbeef')).toBe('alvesting_verify_202611_deadbeef');
  });

  it('a trava aceita só o padrão exato e recusa qualquer outro banco, inclusive os de verdade e os que parecem com o padrão', () => {
    expect(() => assertTempDatabase('alvesting_verify_202611_deadbeef')).not.toThrow();
    for (const name of [
      'alvesting',
      'alvesting_dev',
      'alvesting_test',
      'alvesting_e2e_test',
      'alvesting_ensaio',
      'postgres',
      'template0',
      'template1',
      '',
      'alvesting_verify_202611',
      'alvesting_verify_202611_',
      'alvesting_verify_202611_deadbee',
      'alvesting_verify_202611_deadbeef0',
      'alvesting_verify_202611_DEADBEEF',
      'alvesting_verify_2026_11_deadbeef',
      'Alvesting_verify_202611_deadbeef',
      ' alvesting_verify_202611_deadbeef',
      'alvesting_verify_202611_deadbeef ',
      'alvesting_verify_202611_deadbeef\n',
      'alvesting_verify_202611_deadbeef"; DROP DATABASE alvesting; --',
      'xalvesting_verify_202611_deadbeef',
    ]) {
      expect(() => assertTempDatabase(name), JSON.stringify(name)).toThrow(/banco temporário/);
    }
  });

  it('um mês torto não vira nome', () => {
    for (const month of ['2026-13', '202611', '2026-11-01', '', 'abcd-ef', '2026-1'])
      expect(() => tempDatabaseName(month, 'deadbeef'), month).toThrow(/Mês/);
  });
});

// O DROP DATABASE só existe aqui. A trava fica DENTRO da função (não nos chamadores, que já só passam nomes do padrão): tirar o
// `assertTempDatabase` dela reprova este teste, e nenhum outro notaria.
describe('dropTempDatabase: a única porta do DROP DATABASE', () => {
  const fakeClient = () => {
    const sent: string[] = [];
    return {
      sent,
      client: {
        query: (sql: string) => {
          sent.push(sql);
          return Promise.resolve();
        },
        escapeIdentifier: (name: string) => `"${name}"`,
      },
    };
  };

  it('apaga o banco do padrão exato, com FORCE ou sem', async () => {
    const forced = fakeClient();
    await dropTempDatabase(forced.client, 'alvesting_verify_202611_deadbeef', true);
    expect(forced.sent).toEqual([
      'DROP DATABASE IF EXISTS "alvesting_verify_202611_deadbeef" WITH (FORCE)',
    ]);
    const plain = fakeClient();
    await dropTempDatabase(plain.client, 'alvesting_verify_202611_deadbeef', false);
    expect(plain.sent).toEqual(['DROP DATABASE IF EXISTS "alvesting_verify_202611_deadbeef"']);
  });

  it.each([
    'alvesting',
    'alvesting_dev',
    'alvesting_test',
    'alvesting_e2e_test',
    'alvesting_ensaio',
    'postgres',
    'template0',
    'template1',
    '',
    'alvesting_verify_202611_deadbeef"; DROP DATABASE alvesting; --',
    'alvesting_verify_202611_DEADBEEF',
  ])('recusa %j ANTES de mandar qualquer SQL ao banco, com FORCE ou sem', async (name) => {
    for (const force of [true, false]) {
      const { client, sent } = fakeClient();
      await expect(dropTempDatabase(client, name, force)).rejects.toThrow(/banco temporário/);
      expect(sent).toEqual([]);
    }
  });
});

describe('a URL do administrador vira alvo, argumentos e ambiente do processo filho', () => {
  const target = databaseTarget(URL_ADMIN);

  it('lê host, porta, usuário, senha (decodificada), banco e sslmode', () => {
    expect(target).toEqual({
      host: 'db.example.test',
      port: '6543',
      user: 'alvesting',
      password: 's3nh@-com/barra',
      database: 'alvesting',
      sslmode: 'require',
    });
    expect(databaseTarget('postgresql://u:p@localhost/x')).toMatchObject({
      host: 'localhost',
      port: '5432',
    });
    expect(databaseTarget('postgresql://u:p@[::1]:5432/x').host).toBe('::1');
  });

  it('só repassa um sslmode conhecido', () => {
    expect(databaseTarget('postgresql://u:p@h/x?sslmode=banana').sslmode).toBeUndefined();
    expect(databaseTarget('postgresql://u:p@h/x').sslmode).toBeUndefined();
  });

  it('a senha NUNCA vai em argumento de linha de comando: só no PGPASSWORD do ambiente do filho', () => {
    const all = [
      ...connectionArgs(target),
      ...dumpArgs(target, '00000003-0000001B-1', ['user', 'session']),
      ...restoreArgs(target, 'alvesting_verify_202611_deadbeef'),
    ];
    for (const arg of all) expect(arg).not.toContain(target.password);
    const env = toolEnv(target, {
      PATH: '/usr/bin',
      REVALIDATE_SECRET: 'nao-passa',
      DATABASE_URL: URL_ADMIN,
    });
    expect(env.PGPASSWORD).toBe('s3nh@-com/barra');
    expect(env.PGSSLMODE).toBe('require');
    expect(env.PATH).toBe('/usr/bin');
    // o filho não herda o resto do ambiente do worker (segredos, a URL do banco com a senha)
    expect(env.REVALIDATE_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(Object.keys(env).sort()).toEqual([
      'PATH',
      'PGCONNECT_TIMEOUT',
      'PGPASSWORD',
      'PGSSLMODE',
    ]);
  });

  it('o dump é em formato custom, nunca pede senha, usa o snapshot e deixa de fora os DADOS das tabelas pessoais', () => {
    const args = dumpArgs(target, '00000003-0000001B-1', ['user', 'consent']);
    expect(args).toEqual(
      expect.arrayContaining([
        '--format=custom',
        '--no-password',
        '--snapshot=00000003-0000001B-1',
        '--exclude-table-data=public.user',
        '--exclude-table-data=public.consent',
        '--host=db.example.test',
        '--port=6543',
        '--username=alvesting',
        '--dbname=alvesting',
      ]),
    );
    // o esquema vai inteiro: nada de --schema-only nem --exclude-table (que tiraria a tabela)
    expect(args).not.toContain('--schema-only');
    expect(args.some((arg) => arg.startsWith('--exclude-table='))).toBe(false);
  });

  it('o snapshot e as tabelas só entram em argumento com a forma esperada (nada de injeção na linha de comando)', () => {
    expect(() => dumpArgs(target, '0; rm -rf /', [])).toThrow(/snapshot/);
    expect(() => dumpArgs(target, '00000003-0000001B-1', ['user; DROP'])).toThrow(/tabela/);
    expect(() => dumpArgs(target, '00000003-0000001B-1', ['--schema-only'])).toThrow(/tabela/);
  });

  it('a restauração vai para o banco pedido, sem dono e parando no primeiro erro, lendo a entrada padrão', () => {
    const args = restoreArgs(target, 'alvesting_verify_202611_deadbeef');
    expect(args).toEqual(
      expect.arrayContaining([
        '--dbname=alvesting_verify_202611_deadbeef',
        '--no-owner',
        '--exit-on-error',
        '--no-password',
      ]),
    );
    // sem nome de arquivo: o pg_restore lê o dump da entrada padrão (fluxo, sem arquivo no disco do contêiner)
    expect(args.every((arg) => arg.startsWith('--'))).toBe(true);
  });
});

describe('majorOfVersionText: o major do binário, para casar com o do servidor', () => {
  it.each([
    ['pg_dump (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2)', 17],
    ['pg_restore (PostgreSQL) 17.6', 17],
    ['pg_dump (PostgreSQL) 18.6', 18],
    ['pg_dump (PostgreSQL) 16.9 (Ubuntu 16.9-0ubuntu0.24.04.1)', 16],
    ['pg_dump (PostgreSQL) 18beta1', 18],
    ['pg_dump (PostgreSQL) 19devel', 19],
  ])('%s -> %i', (text, major) => {
    expect(majorOfVersionText(text)).toBe(major);
  });

  it('texto que não é versão não vira major', () => {
    expect(majorOfVersionText('')).toBeUndefined();
    expect(majorOfVersionText('command not found')).toBeUndefined();
  });
});

describe('o processo filho tem prazo e morre no abort', () => {
  const node = (script: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) =>
    spawnProcess('node', ['-e', script], {
      env: { PATH: process.env.PATH },
      signal: options.signal ?? new AbortController().signal,
      timeoutMs: options.timeoutMs ?? 10_000,
    });

  it('devolve o código de saída e a saída de erro (cortada)', async () => {
    const result = await collect(
      node(`process.stderr.write('x'.repeat(20000)); process.stdout.write('ok'); process.exit(3)`),
    );
    expect(result.code).toBe(3);
    expect(result.stdout).toBe('ok');
    expect(result.stderr.length).toBeLessThanOrEqual(4096);
  });

  it('o prazo estourado mata o filho (não fica pendurado)', async () => {
    const started = Date.now();
    const result = await collect(node('setTimeout(() => {}, 60000)', { timeoutMs: 300 }));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.code).not.toBe(0);
    expect(result.signal).not.toBeNull();
  });

  it('o abort mata o filho e a promessa rejeita', async () => {
    const abort = new AbortController();
    const child = node('setTimeout(() => {}, 60000)', { signal: abort.signal });
    const running = collect(child);
    setTimeout(() => abort.abort(), 100);
    await expect(running).rejects.toThrow();
    expect(child.killed || child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('um abort que já aconteceu nem deixa o filho trabalhar', async () => {
    const child = node('setTimeout(() => {}, 60000)', { signal: AbortSignal.abort() });
    await expect(collect(child)).rejects.toThrow();
  });

  it('um executável que não existe rejeita com a causa (e o filho não existe para vazar)', async () => {
    const child = spawn('pg_dump_que_nao_existe', [], { stdio: 'pipe' });
    await expect(collect(child)).rejects.toThrow(/ENOENT/);
  });
});
