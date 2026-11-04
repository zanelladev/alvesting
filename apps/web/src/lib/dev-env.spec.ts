import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEV_ENV_VARIABLES, loadDevEnv } from '../../next.config';

// O pnpm dev do site lê o .env.local e o .env.example da raiz (o Next só lê os .env de apps/web). O .env.local também guarda o prompt
// da arena e a chave do OpenRouter (CLAUDE.md, regra 4): essas não são do site e não podem entrar no ambiente dele.
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dev-env-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const file = async (name: string, content: string) => {
  await writeFile(path.join(dir, name), content);
  return pathToFileURL(path.join(dir, name));
};

describe('loadDevEnv', () => {
  it('as variáveis do site são só estas quatro', () => {
    expect([...DEV_ENV_VARIABLES]).toEqual([
      'API_INTERNAL_URL',
      'REVALIDATE_SECRET',
      'QUOTES_SECRET',
      'FRONT_DOOR_ID',
    ]);
  });

  // O segredo das cotações (docs/API.md, seção 6) é o mesmo da api: o `pnpm dev` do site o pega do .env.example (valor de dev) ou do
  // .env.local, como o da revalidação.
  it('copia o QUOTES_SECRET do .env.example, e o .env.local vence', async () => {
    const example = await file(
      '.env.example',
      'QUOTES_SECRET=segredo-de-dev-das-cotacoes-com-mais-de-trinta-e-dois',
    );
    const local = await file(
      '.env.local',
      'QUOTES_SECRET=do-local-com-mais-de-trinta-e-dois-caracteres',
    );
    const fromExample: Record<string, string | undefined> = {};
    loadDevEnv([example], fromExample);
    expect(fromExample).toEqual({
      QUOTES_SECRET: 'segredo-de-dev-das-cotacoes-com-mais-de-trinta-e-dois',
    });
    const both: Record<string, string | undefined> = {};
    loadDevEnv([local, example], both);
    expect(both.QUOTES_SECRET).toBe('do-local-com-mais-de-trinta-e-dois-caracteres');
  });

  it('copia só as variáveis do site: o prompt da arena e a chave do OpenRouter ficam de fora', async () => {
    const local = await file(
      '.env.local',
      [
        'API_INTERNAL_URL=http://127.0.0.1:4310',
        'REVALIDATE_SECRET=segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
        'PROMPT_ARENA="texto do prompt\nem várias linhas"',
        'OPENROUTER_API_KEY=sk-or-nao-pode-entrar',
        'DATABASE_URL=postgresql://alvesting:alvesting@localhost:25432/alvesting_dev',
      ].join('\n'),
    );
    const env: Record<string, string | undefined> = {};
    loadDevEnv([local], env);
    expect(env).toEqual({
      API_INTERNAL_URL: 'http://127.0.0.1:4310',
      REVALIDATE_SECRET: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
    });
    expect(JSON.stringify(env)).not.toContain('sk-or-nao-pode-entrar');
    expect(JSON.stringify(env)).not.toContain('texto do prompt');
  });

  it('o .env.local vence o .env.example, e o que já está no ambiente vence os dois', async () => {
    const local = await file('.env.local', 'API_INTERNAL_URL=http://local:1\nFRONT_DOOR_ID=');
    const example = await file(
      '.env.example',
      'API_INTERNAL_URL=http://exemplo:2\nFRONT_DOOR_ID=c0ffee00-1234-4abc-8def-0123456789ab\nREVALIDATE_SECRET=',
    );
    const env: Record<string, string | undefined> = {};
    loadDevEnv([local, example], env);
    // em branco (VAR=) vale como ausente: o FRONT_DOOR_ID do exemplo entra, a REVALIDATE_SECRET vazia não
    expect(env).toEqual({
      API_INTERNAL_URL: 'http://local:1',
      FRONT_DOOR_ID: 'c0ffee00-1234-4abc-8def-0123456789ab',
    });

    const already: Record<string, string | undefined> = {
      API_INTERNAL_URL: 'http://do-ambiente:3',
    };
    loadDevEnv([local, example], already);
    expect(already.API_INTERNAL_URL).toBe('http://do-ambiente:3');
  });

  it('arquivo que não existe é ignorado', () => {
    const env: Record<string, string | undefined> = {};
    expect(() => loadDevEnv([pathToFileURL(path.join(dir, 'nao-existe'))], env)).not.toThrow();
    expect(env).toEqual({});
  });
});
