-- Tira do banco o que só existia para o COTAHIST da B3 (ADR 0032; docs/DADOS.md, seção 1): o valor COTAHIST dos enums bar_source e
-- trading_day_source, trading_day.cotahist_sha256, instrument.quote_factor (o fator de cota do arquivo, 1000 em GOLL54 e 1000000 em AZUL53) e
-- daily_bar.trades (a contagem de negócios, que a brapi não informa e nada lê).
--
-- EXCEÇÃO à regra "migration só aditiva" (CLAUDE.md), autorizada pelo Artur em 04/11/2026 ("Recriar do zero pela brapi"): não há produção nem
-- dado legado. O dev foi recriado do zero pelas migrations e carregado pela brapi no mesmo dia, e nenhuma linha usa o que sai. O LIMITE da
-- exceção: depois do primeiro deploy, remover coluna ou valor volta a seguir os três lançamentos (adicionar e migrar; parar de usar; remover).
--
-- Gerada por `prisma migrate diff` (as trocas dos dois enums e os três DROP COLUMN), com duas mãos a mais, porque o diff não vê CHECK nem sabe
-- recusar:
--  1. A GUARDA: se alguma linha ainda usa o que sai, a migration falha inteira, sem mudar nada, em vez de perder o dado em silêncio (o
--     DROP COLUMN apagaria o valor, e a troca do enum só pararia com um erro de conversão sem dizer qual).
--  2. O CHECK daily_bar_values_check cita a coluna trades, então o DROP COLUMN o derrubaria junto: é refeito sem ela (o resto não muda).
-- Tudo numa transação só: o script inteiro vai ao servidor como uma consulta só, e o Postgres o trata como uma transação implícita (falhou,
-- nada mudou). SEM BEGIN nem COMMIT escritos aqui, de propósito (os do diff, um por enum, saíram): com eles, a recusa da guarda deixa a sessão
-- numa transação abortada, e o `prisma migrate deploy` perde a mensagem dela (o operador lê só "current transaction is aborted") e não
-- consegue gravar o erro em _prisma_migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "daily_bar" WHERE "source"::text = 'COTAHIST') THEN
    RAISE EXCEPTION 'migration 20261104100000_drop_cotahist_legacy recusada: há barra com origem COTAHIST em daily_bar; nada foi alterado';
  END IF;
  IF EXISTS (SELECT 1 FROM "trading_day" WHERE "source"::text = 'COTAHIST') THEN
    RAISE EXCEPTION 'migration 20261104100000_drop_cotahist_legacy recusada: há pregão com origem COTAHIST em trading_day; nada foi alterado';
  END IF;
  IF EXISTS (SELECT 1 FROM "trading_day" WHERE "cotahist_sha256" IS NOT NULL) THEN
    RAISE EXCEPTION 'migration 20261104100000_drop_cotahist_legacy recusada: há pregão com o SHA-256 do arquivo (cotahist_sha256) em trading_day; nada foi alterado';
  END IF;
  IF EXISTS (SELECT 1 FROM "instrument" WHERE "quote_factor" <> 1) THEN
    RAISE EXCEPTION 'migration 20261104100000_drop_cotahist_legacy recusada: há papel com fator de cota diferente de 1 (quote_factor) em instrument; nada foi alterado';
  END IF;
  IF EXISTS (SELECT 1 FROM "daily_bar" WHERE "trades" IS NOT NULL) THEN
    RAISE EXCEPTION 'migration 20261104100000_drop_cotahist_legacy recusada: há barra com a contagem de negócios (trades) em daily_bar; nada foi alterado';
  END IF;
END
$$;

-- AlterEnum
CREATE TYPE "bar_source_new" AS ENUM ('BRAPI');
ALTER TABLE "daily_bar" ALTER COLUMN "source" TYPE "bar_source_new" USING ("source"::text::"bar_source_new");
ALTER TYPE "bar_source" RENAME TO "bar_source_old";
ALTER TYPE "bar_source_new" RENAME TO "bar_source";
DROP TYPE "public"."bar_source_old";

-- AlterEnum
CREATE TYPE "trading_day_source_new" AS ENUM ('CALENDAR', 'BRAPI');
ALTER TABLE "trading_day" ALTER COLUMN "source" TYPE "trading_day_source_new" USING ("source"::text::"trading_day_source_new");
ALTER TYPE "trading_day_source" RENAME TO "trading_day_source_old";
ALTER TYPE "trading_day_source_new" RENAME TO "trading_day_source";
DROP TYPE "public"."trading_day_source_old";

-- AlterTable: a coluna trades sai, e o CHECK que a citava volta sem ela (preço e volume nunca negativos; máxima nunca abaixo da mínima)
ALTER TABLE "daily_bar" DROP CONSTRAINT "daily_bar_values_check";
ALTER TABLE "daily_bar" DROP COLUMN "trades";
ALTER TABLE "daily_bar" ADD CONSTRAINT "daily_bar_values_check" CHECK (
    "open_cents" >= 0
    AND "close_cents" >= 0
    AND "low_cents" >= 0
    AND "high_cents" >= "low_cents"
    AND "volume_cents" >= 0
);

-- AlterTable
ALTER TABLE "instrument" DROP COLUMN "quote_factor";

-- AlterTable
ALTER TABLE "trading_day" DROP COLUMN "cotahist_sha256";
