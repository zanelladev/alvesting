import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// O Prisma 7 não lê .env sozinho. Em dev vale a mesma regra do `pnpm dev`: o .env.local da raiz (fora do
// git) vence o .env.example (valores do docker-compose local). Em CI e produção as variáveis já estão no
// ambiente. process.loadEnvFile nunca sobrescreve variável já definida, então o primeiro a definir vence:
// um DATABASE_URL explícito (ex.: o banco de teste) ganha dos dois arquivos.
for (const name of ['.env.local', '.env.example']) {
  const file = new URL(`../../${name}`, import.meta.url);
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Sem DATABASE_URL o `prisma generate` continua funcionando; só migrate precisa dele.
  datasource: { url: process.env.DATABASE_URL },
});
