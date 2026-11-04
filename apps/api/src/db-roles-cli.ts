import { parseEnv } from './config/env.js';
import { provisionApiLogin } from './infrastructure/database/api-login.js';
import { API_LOGIN } from './infrastructure/database/table-policy.js';

// Linha de comando do papel mínimo do Postgres da api (onda 3d; docs/INFRA.md, 2.7; ADR 0028). Cria o login `alvesting_api` (se faltar),
// define a senha dele e o põe no papel de grupo que a migration `20261103100000_api_role` criou. Idempotente: roda a cada deploy, depois do
// `prisma migrate deploy`, e trocar a senha é trocar a API_DATABASE_URL e rodar de novo.
//   pnpm --filter @alvesting/api db:roles
// Lê DATABASE_URL (o login ADMINISTRADOR, que cria o papel) e API_DATABASE_URL (a URL do login novo: dela só sai a senha). A senha não vai
// em argumento de linha de comando, em migration nem em log. Na Azure roda no job-migrate, que recebe as duas URLs (docs/INFRA.md, 8.2).
const USAGE = `Uso:
  (sem argumentos)
      cria o login ${API_LOGIN} e define a senha dele, a partir da API_DATABASE_URL, com o login administrador (DATABASE_URL).`;

async function main(argv: string[]): Promise<number> {
  if (argv.length !== 0) {
    console.error(USAGE);
    return 2;
  }
  const env = parseEnv();
  if (!env.API_DATABASE_URL) {
    console.error(
      'API_DATABASE_URL ausente: ela traz a senha do login da api (postgresql://alvesting_api:<senha>@<host>:<porta>/<banco>)',
    );
    return 2;
  }
  const result = await provisionApiLogin(env.DATABASE_URL, env.API_DATABASE_URL);
  console.log(
    `login ${result.login} pronto: membro de ${result.group}, statement_timeout de ${result.statementTimeoutMs / 1000} s, ` +
      (result.connectionLimit < 0
        ? 'sem limite de conexões'
        : `limite de ${result.connectionLimit} conexões`),
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
