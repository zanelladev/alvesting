-- AlterTable
ALTER TABLE "instrument" ADD COLUMN     "cnpj" CHAR(14);

-- CreateTable
CREATE TABLE "news_item" (
    "id" VARCHAR(26) NOT NULL,
    "url_hash" CHAR(64) NOT NULL,
    "url" TEXT NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "tickers" TEXT[],
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macro_daily" (
    "series" VARCHAR(32) NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(18,8) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "macro_daily_pkey" PRIMARY KEY ("series","date")
);

-- CreateTable
CREATE TABLE "briefing" (
    "id" VARCHAR(26) NOT NULL,
    "date" DATE NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uri" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fetch_state" (
    "source" VARCHAR(64) NOT NULL,
    "etag" TEXT,
    "last_modified" TEXT,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fetch_state_pkey" PRIMARY KEY ("source")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_item_url_hash_key" ON "news_item"("url_hash");

-- CreateIndex
CREATE INDEX "news_item_first_seen_at_idx" ON "news_item"("first_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "briefing_date_key" ON "briefing"("date");

-- CreateIndex
CREATE INDEX "instrument_cnpj_idx" ON "instrument"("cnpj");

-- Integridade que o Prisma não modela (CHECK). O código já limpa, trunca e valida tudo isto antes de gravar; a restrição
-- é a rede de segurança para o dia em que um caminho novo esquecer. Migration só aditiva: a restrição é validada contra
-- o que já está nas tabelas (todas novas, ou a coluna nova de instrument, que começa vazia).

-- CNPJ só com os 14 dígitos (sem pontuação).
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_cnpj_check" CHECK ("cnpj" IS NULL OR "cnpj" ~ '^[0-9]{14}$');

-- A notícia vira link na página pública: só http(s), nunca javascript: nem data:. Título e trecho têm teto (caracteres,
-- não bytes); o hash é SHA-256 em hexadecimal minúsculo; a fonte é um id da lista fixa.
ALTER TABLE "news_item" ADD CONSTRAINT "news_item_values_check" CHECK (
    "url_hash" ~ '^[0-9a-f]{64}$'
    AND "url" ~ '^https?://[^[:space:]]+$'
    AND "source" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND char_length("title") BETWEEN 1 AND 300
    AND char_length("snippet") <= 300
);

-- O nome da série é o da lista fixa do código.
ALTER TABLE "macro_daily" ADD CONSTRAINT "macro_daily_series_check" CHECK ("series" ~ '^[a-z0-9_]+$');

-- SHA-256 em hexadecimal minúsculo e um arquivo que não é vazio.
ALTER TABLE "briefing" ADD CONSTRAINT "briefing_values_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$' AND "bytes" > 0);
