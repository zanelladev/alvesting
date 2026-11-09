import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { provisionApiLogin } from '../infrastructure/database/api-login.js';
import { databaseName } from '../infrastructure/database/database-admin.js';

// O temporada:preparar (ADR 0038; RUNBOOK, "Operador local"): deixa o banco da Temporada 1 pronto para o arena:retroativo e o operador. Cria o
// banco se ele não existe, aplica as migrations, roda o db:roles (o login da api) e copia do banco de dev os dados de mercado que a brapi já
// deu: instrumentos, logos, pregões e barras. Não chama a brapi. Idempotente: rodar de novo não duplica nada (só inserção, com a chave natural
// de cada tabela), e nunca apaga nem reescreve o que o banco da temporada já tem.

// O banco da temporada de verdade, ou um descartável dos testes (o nome termina em _test). Sempre na própria máquina.
export const SEASON_DATABASE = 'alvesting_temporada';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const apiRoot = fileURLToPath(new URL('../../', import.meta.url));

// A mensagem não repete a URL (tem senha).
export function assertSeasonDatabase(url: string): void {
  const name = databaseName(url);
  if (name !== SEASON_DATABASE && !/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `O temporada:preparar só prepara o ${SEASON_DATABASE} (ou um banco *_test dos testes); veio "${name}"`,
    );
  }
  const { hostname } = new URL(url);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `O banco da temporada é o Postgres da própria máquina (localhost, 127.0.0.1 ou ::1); veio "${hostname}"`,
    );
  }
}

export interface PrepareResult {
  created: boolean;
  // as linhas que ESTA execução copiou (a segunda execução copia zero)
  copied: { instruments: number; logos: number; tradingDays: number; bars: number };
}

export async function prepareSeasonDatabase(input: {
  // o banco da temporada (TEMPORADA_DATABASE_URL), com o login administrador
  targetUrl: string;
  // o banco de onde vêm os dados de mercado (o de dev, DATABASE_URL): só lido
  sourceUrl: string;
  // a URL do login da api (API_DATABASE_URL): dela só sai a senha, a mesma de todo banco deste servidor (o login é do servidor inteiro)
  apiUrl: string;
  log: (line: string) => void;
}): Promise<PrepareResult> {
  const { targetUrl, sourceUrl, log } = input;
  assertSeasonDatabase(targetUrl);
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  if (source.host === target.host && databaseName(sourceUrl) === databaseName(targetUrl)) {
    throw new Error('A origem dos dados de mercado e o banco da temporada são o mesmo banco');
  }

  const created = await createIfMissing(targetUrl);
  log(`banco ${databaseName(targetUrl)} ${created ? 'criado' : 'já existia'}`);
  // prisma migrate deploy: só avança, nunca apaga. CHECKPOINT_DISABLE: o CLI do Prisma consultaria o checkpoint.prisma.io
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: targetUrl, CHECKPOINT_DISABLE: '1' },
    stdio: 'pipe',
  });
  log('migrations aplicadas');
  const login = await provisionApiLogin(targetUrl, input.apiUrl, false);
  log(`login ${login.login} pronto (membro de ${login.group})`);

  const copied = await copyMarket(sourceUrl, targetUrl);
  log(
    `copiado do banco de dev: ${copied.instruments} instrumentos, ${copied.logos} logos, ${copied.tradingDays} pregões e ${copied.bars} barras`,
  );
  return { created, copied };
}

async function createIfMissing(url: string): Promise<boolean> {
  const name = databaseName(url);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount === 1) return false;
    // o nome já passou por assertSeasonDatabase (só letras minúsculas, dígitos e _)
    await client.query(`CREATE DATABASE "${name}"`);
    return true;
  } finally {
    await client.end();
  }
}

// Lê da origem (só SELECT) e grava no destino numa transação só, com ON CONFLICT DO NOTHING: o que o destino já tem fica como está. O
// instrumento é casado pelo ticker (o destino pode já ter o papel com outro id, criado pela brapi), e as barras e o logo vão com o id do destino.
async function copyMarket(sourceUrl: string, targetUrl: string): Promise<PrepareResult['copied']> {
  const from = new pg.Client({ connectionString: sourceUrl });
  const to = new pg.Client({ connectionString: targetUrl });
  await from.connect();
  await to.connect();
  try {
    const instruments = await from.query<{
      id: string;
      ticker: string;
      name: string;
      isin: string | null;
      spec: string;
      kind: string;
      last_seen: string;
      created_at: Date;
      cnpj: string | null;
    }>(
      `SELECT id, ticker, name, isin, spec, kind::text AS kind, last_seen::text AS last_seen, created_at, cnpj FROM instrument`,
    );
    const logos = await from.query<{
      ticker: string;
      source_url: string;
      svg: string;
      sha256: string;
      bytes: number;
      fetched_at: Date;
    }>(
      `SELECT i.ticker, l.source_url, l.svg, l.sha256, l.bytes, l.fetched_at FROM instrument_logo l JOIN instrument i ON i.id = l.instrument_id`,
    );
    const days = await from.query<{ date: string; source: string }>(
      `SELECT date::text AS date, source::text AS source FROM trading_day`,
    );
    const bars = await from.query<{
      id: string;
      ticker: string;
      date: string;
      open_cents: string;
      high_cents: string;
      low_cents: string;
      close_cents: string;
      volume_cents: string;
      source: string;
    }>(
      `SELECT b.id, i.ticker, b.date::text AS date, b.open_cents::text AS open_cents, b.high_cents::text AS high_cents,
              b.low_cents::text AS low_cents, b.close_cents::text AS close_cents, b.volume_cents::text AS volume_cents,
              b.source::text AS source
       FROM daily_bar b JOIN instrument i ON i.id = b.instrument_id`,
    );

    await to.query('BEGIN');
    const column = <T, K extends keyof T>(rows: T[], key: K) => rows.map((row) => row[key]);
    const insertedInstruments = await to.query(
      `INSERT INTO instrument (id, ticker, name, isin, spec, kind, last_seen, created_at, cnpj)
       SELECT * FROM unnest($1::varchar[], $2::varchar[], $3::text[], $4::varchar[], $5::varchar[], $6::instrument_kind[],
                            $7::date[], $8::timestamptz[], $9::char(14)[])
       ON CONFLICT DO NOTHING`,
      [
        column(instruments.rows, 'id'),
        column(instruments.rows, 'ticker'),
        column(instruments.rows, 'name'),
        column(instruments.rows, 'isin'),
        column(instruments.rows, 'spec'),
        column(instruments.rows, 'kind'),
        column(instruments.rows, 'last_seen'),
        column(instruments.rows, 'created_at'),
        column(instruments.rows, 'cnpj'),
      ],
    );
    const ids = new Map(
      (
        await to.query<{ id: string; ticker: string }>('SELECT id, ticker FROM instrument')
      ).rows.map((row) => [row.ticker, row.id]),
    );
    const insertedLogos = await to.query(
      `INSERT INTO instrument_logo (instrument_id, source_url, svg, sha256, bytes, fetched_at)
       SELECT * FROM unnest($1::varchar[], $2::text[], $3::text[], $4::char(64)[], $5::int[], $6::timestamptz[])
       ON CONFLICT DO NOTHING`,
      [
        logos.rows.map((row) => ids.get(row.ticker)),
        column(logos.rows, 'source_url'),
        column(logos.rows, 'svg'),
        column(logos.rows, 'sha256'),
        column(logos.rows, 'bytes'),
        column(logos.rows, 'fetched_at'),
      ],
    );
    // O pregão confirmado (BRAPI) na origem sobe o do destino que ainda era só previsão (CALENDAR): as barras dele vêm junto, nesta transação.
    const insertedDays = await to.query(
      `INSERT INTO trading_day (date, source)
       SELECT * FROM unnest($1::date[], $2::trading_day_source[])
       ON CONFLICT (date) DO UPDATE SET source = EXCLUDED.source
         WHERE trading_day.source = 'CALENDAR' AND EXCLUDED.source = 'BRAPI'`,
      [column(days.rows, 'date'), column(days.rows, 'source')],
    );
    const insertedBars = await to.query(
      `INSERT INTO daily_bar (id, instrument_id, date, open_cents, high_cents, low_cents, close_cents, volume_cents, source)
       SELECT * FROM unnest($1::varchar[], $2::varchar[], $3::date[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[],
                            $8::bigint[], $9::bar_source[])
       ON CONFLICT DO NOTHING`,
      [
        column(bars.rows, 'id'),
        bars.rows.map((row) => ids.get(row.ticker)),
        column(bars.rows, 'date'),
        column(bars.rows, 'open_cents'),
        column(bars.rows, 'high_cents'),
        column(bars.rows, 'low_cents'),
        column(bars.rows, 'close_cents'),
        column(bars.rows, 'volume_cents'),
        column(bars.rows, 'source'),
      ],
    );
    await to.query('COMMIT');
    return {
      instruments: insertedInstruments.rowCount ?? 0,
      logos: insertedLogos.rowCount ?? 0,
      tradingDays: insertedDays.rowCount ?? 0,
      bars: insertedBars.rowCount ?? 0,
    };
  } catch (error) {
    await to.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await from.end();
    await to.end();
  }
}
