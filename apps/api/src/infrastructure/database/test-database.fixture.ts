import pg from 'pg';
import { parseEnv } from '../../config/env.js';
import { DEV_API_PASSWORD, provisionApiLogin } from './api-login.js';
import { applyMigrations } from './database-admin.js';
import { PrismaService } from './prisma.service.js';
import { API_LOGIN } from './table-policy.js';

// Apoio dos testes de integração com o Postgres. Sem TEST_DATABASE_URL os testes aparecem como pulados, com o
// motivo no nome. O banco de teste é sempre separado do de dev (alvesting_test x alvesting_dev) e só ele é tocado.
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export const integrationTitle = (name: string): string =>
  testDatabaseUrl
    ? `${name} (Postgres)`
    : `${name} (Postgres) [pulado: defina TEST_DATABASE_URL, ex.: docker compose up -d postgres]`;

// Cria o banco de teste se faltar e aplica as migrations (migrate deploy: só avança, nunca apaga).
export async function openTestDatabase(url: string): Promise<PrismaService> {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL deve apontar para um banco que termina em _test (veio "${name}")`,
    );
  }
  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  applyMigrations(url);
  const prisma = new PrismaService(parseEnv({ DATABASE_URL: url }));
  // As tabelas da arena (etapa 6) têm chave para o briefing (RESTRICT). O que um teste da arena deixou para trás, ou que sobrou
  // de uma execução interrompida, travaria a limpeza do briefing nos testes dos outros módulos: cada arquivo de teste começa sem
  // elas. As da liquidação (etapa 7) apontam para as da arena, então saem antes (a execução sai com a ordem). Só o banco de teste
  // chega aqui (o nome termina em _test, acima).
  await prisma.order.deleteMany();
  await prisma.position.deleteMany();
  await prisma.equitySnapshot.deleteMany();
  await prisma.seasonStat.deleteMany();
  await prisma.randomBaseline.deleteMany();
  await prisma.corporateEvent.deleteMany();
  await prisma.decisionItem.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.cycle.deleteMany();
  await prisma.promptVersion.deleteMany();
  await prisma.competitor.deleteMany();
  await prisma.season.deleteMany();
  return prisma;
}

// A URL do login da api (papel mínimo, onda 3d) no mesmo servidor e banco da URL do administrador, com a senha de dev do .env.example.
export function apiTestUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.username = API_LOGIN;
  url.password = DEV_API_PASSWORD;
  return url.toString();
}

// O banco de teste (já migrado por `openTestDatabase`) aberto COMO O LOGIN DA API: cria o login e define a senha (o comando de produção,
// com o administrador), e devolve um PrismaService conectado com ele. Os specs HTTP o passam à api sob teste, enquanto o semear e o conferir
// ficam com o PrismaService do administrador: a api é provada com os privilégios que ela tem na Azure, e não com os de dono das tabelas.
export async function openApiTestDatabase(adminUrl: string): Promise<PrismaService> {
  await provisionApiLogin(adminUrl, apiTestUrl(adminUrl), false);
  return new PrismaService(parseEnv({ DATABASE_URL: apiTestUrl(adminUrl) }));
}
