import { MAX_SESSIONS, MIN_SESSIONS } from './market.js';

// Os argumentos e o banco do comando arena:ensaio (src/ensaio-cli.ts). Estritos: o comando esvazia um banco, então argumento
// desconhecido, valor que não é inteiro ou fora da faixa é erro.

// `syntheticLogos`: a bandeira `--logos-sinteticos` (sem valor), a do seed do e2e (o e2e:seed e o playwright.config.ts a passam): depois do
// relatório, que não os vê, os dois logos sintéticos que o e2e lê (synthetic-logos.ts).
export type ParsedArgs =
  | { kind: 'run'; sessions: number; seed: number; syntheticLogos: boolean }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export function parseArgs(argv: string[]): ParsedArgs {
  let sessions = 5;
  let seed = 1;
  let syntheticLogos = false;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag === '--ajuda' || flag === '--help') return { kind: 'help' };
    if (flag === '--logos-sinteticos') {
      syntheticLogos = true;
      i -= 1; // sem valor: o próximo argumento é outra bandeira
      continue;
    }
    const value = argv[i + 1];
    if (flag !== '--pregoes' && flag !== '--semente') {
      return { kind: 'error', message: `argumento desconhecido: ${flag}` };
    }
    if (value === undefined || !/^\d{1,15}$/.test(value)) {
      return {
        kind: 'error',
        message: `${flag} pede um número inteiro (veio ${value === undefined ? 'nada' : `"${value}"`})`,
      };
    }
    if (flag === '--pregoes') sessions = Number(value);
    else seed = Number(value);
  }
  if (sessions < MIN_SESSIONS || sessions > MAX_SESSIONS) {
    return {
      kind: 'error',
      message: `--pregoes vai de ${MIN_SESSIONS} a ${MAX_SESSIONS} (veio ${sessions})`,
    };
  }
  return { kind: 'run', sessions, seed, syntheticLogos };
}

// O banco do ensaio vem sempre de ENSAIO_DATABASE_URL (o .env.example traz o do docker compose), e nunca é deduzido do DATABASE_URL:
// onde a variável não existe, como no contêiner de produção, o comando recusa em vez de abrir um banco ao lado do de verdade.
export function ensaioDatabaseUrl(env: Record<string, string | undefined>): string {
  const url = env.ENSAIO_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Defina ENSAIO_DATABASE_URL, o banco que o ensaio recria (o nome tem de terminar em _ensaio ou _test; o .env.example traz o do docker compose)',
    );
  }
  return url;
}
