-- CreateEnum
CREATE TYPE "season_status" AS ENUM ('DRAFT', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "competitor_kind" AS ENUM ('MODEL', 'RANDOM', 'BENCHMARK');

-- CreateEnum
CREATE TYPE "benchmark" AS ENUM ('EQUAL_WEIGHT', 'CDI', 'BOVA11');

-- CreateEnum
CREATE TYPE "cycle_status" AS ENUM ('OPEN', 'CLOSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "decision_status" AS ENUM ('DECIDED', 'FORCED_HOLD');

-- CreateEnum
CREATE TYPE "decision_action" AS ENUM ('BUY', 'SELL', 'HOLD');

-- CreateEnum
CREATE TYPE "market_view" AS ENUM ('otimista', 'pessimista', 'neutro');

-- CreateTable
CREATE TABLE "season" (
    "id" VARCHAR(26) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "status" "season_status" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE,
    "params" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor" (
    "id" VARCHAR(26) NOT NULL,
    "season_id" VARCHAR(26) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "competitor_kind" NOT NULL,
    "provider" VARCHAR(16),
    "model_id" TEXT,
    "benchmark" "benchmark",
    "config" JSONB,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_version" (
    "id" VARCHAR(26) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "sha256" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_at" TIMESTAMPTZ(3),

    CONSTRAINT "prompt_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle" (
    "id" VARCHAR(26) NOT NULL,
    "season_id" VARCHAR(26) NOT NULL,
    "date" DATE NOT NULL,
    "status" "cycle_status" NOT NULL DEFAULT 'OPEN',
    "skip_reason" VARCHAR(32),
    "decision_at" TIMESTAMPTZ(3) NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "briefing_id" VARCHAR(26),
    "prompt_version_id" VARCHAR(26),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision" (
    "id" VARCHAR(26) NOT NULL,
    "cycle_id" VARCHAR(26) NOT NULL,
    "competitor_id" VARCHAR(26) NOT NULL,
    "status" "decision_status" NOT NULL,
    "hold_reason" VARCHAR(32),
    "market_view" "market_view",
    "summary" TEXT,
    "usage" JSONB,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "applied" JSONB,
    "input_sha256" CHAR(64),
    "output_sha256" CHAR(64),
    "meta_sha256" CHAR(64),
    "io_uris" JSONB,
    "leak_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_item" (
    "id" VARCHAR(26) NOT NULL,
    "decision_id" VARCHAR(26) NOT NULL,
    "position" INTEGER NOT NULL,
    "action" "decision_action",
    "ticker" VARCHAR(12),
    "percent" DECIMAL(7,4),
    "confidence" DECIMAL(4,3),
    "rationale" TEXT,
    "dropped" BOOLEAN NOT NULL DEFAULT false,
    "drop_reason" VARCHAR(32),
    "drop_detail" VARCHAR(200),

    CONSTRAINT "decision_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "season_slug_key" ON "season"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_season_id_slug_key" ON "competitor"("season_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_version_version_key" ON "prompt_version"("version");

-- CreateIndex
CREATE INDEX "cycle_date_idx" ON "cycle"("date");

-- CreateIndex
CREATE INDEX "cycle_briefing_id_idx" ON "cycle"("briefing_id");

-- CreateIndex
CREATE INDEX "cycle_prompt_version_id_idx" ON "cycle"("prompt_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_season_id_date_key" ON "cycle"("season_id", "date");

-- CreateIndex
CREATE INDEX "decision_competitor_id_idx" ON "decision"("competitor_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_cycle_id_competitor_id_key" ON "decision"("cycle_id", "competitor_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_item_decision_id_position_key" ON "decision_item"("decision_id", "position");

-- AddForeignKey
ALTER TABLE "competitor" ADD CONSTRAINT "competitor_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_briefing_id_fkey" FOREIGN KEY ("briefing_id") REFERENCES "briefing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "prompt_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision" ADD CONSTRAINT "decision_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_item" ADD CONSTRAINT "decision_item_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rede de segurança da arena (o que o Prisma não emite). O código já garante tudo isto antes de gravar; a restrição é para o
-- dia em que um caminho novo esquecer. Migration só aditiva: as tabelas acima acabaram de nascer, vazias.

-- A lista de campos com vazamento nunca é NULL (o Prisma não emite NOT NULL para lista; mesmo motivo do news_item.tickers).
ALTER TABLE "decision" ALTER COLUMN "leak_fields" SET NOT NULL;

-- Temporada: os parâmetros são um objeto, e só o rascunho não tem data de início.
ALTER TABLE "season" ADD CONSTRAINT "season_check" CHECK (
    jsonb_typeof("params") = 'object'
    AND ("status" = 'DRAFT') = ("start_date" IS NULL)
);

-- Competidor: cada tipo carrega só os campos dele. O MODEL tem provedor e ID do modelo; a referência, o benchmark.
ALTER TABLE "competitor" ADD CONSTRAINT "competitor_kind_check" CHECK (
    CASE "kind"
        WHEN 'MODEL' THEN "provider" IN ('openrouter', 'azure-openai', 'fake')
            AND "model_id" IS NOT NULL AND "benchmark" IS NULL
        WHEN 'RANDOM' THEN "provider" IS NULL AND "model_id" IS NULL AND "benchmark" IS NULL AND "config" IS NULL
        WHEN 'BENCHMARK' THEN "provider" IS NULL AND "model_id" IS NULL AND "benchmark" IS NOT NULL AND "config" IS NULL
    END
);

-- Versão do prompt: os 32 hexadecimais da versão do segredo no Key Vault; o SHA-256 do texto só existe com a data do registro.
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_check" CHECK (
    "version" ~ '^[0-9a-f]{32}$'
    AND ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$')
    AND ("sha256" IS NULL) = ("registered_at" IS NULL)
);

-- Ciclo: pulado tem motivo; aberto ou fechado sabe qual briefing e qual prompt usou; a decisão vem antes do prazo.
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_check" CHECK (
    ("status" = 'SKIPPED') = ("skip_reason" IS NOT NULL)
    AND ("skip_reason" IS NULL OR "skip_reason" IN ('sem_briefing', 'orcamento'))
    AND ("status" = 'SKIPPED' OR ("briefing_id" IS NOT NULL AND "prompt_version_id" IS NOT NULL))
    AND "decision_at" < "deadline_at"
);

-- Decisão: o HOLD forçado tem motivo (e só ele); a decisão normal tem visão de mercado e resumo; os hashes são SHA-256 em
-- hexadecimal minúsculo; o custo não é negativo.
ALTER TABLE "decision" ADD CONSTRAINT "decision_check" CHECK (
    ("status" = 'FORCED_HOLD') = ("hold_reason" IS NOT NULL)
    AND ("hold_reason" IS NULL OR "hold_reason" IN ('prazo', 'prompt_divergente', 'resposta_invalida', 'falha', 'sem_resposta'))
    AND ("status" = 'FORCED_HOLD' OR ("market_view" IS NOT NULL AND "summary" IS NOT NULL))
    AND "cost_micro_usd" >= 0
    AND ("input_sha256" IS NULL OR "input_sha256" ~ '^[0-9a-f]{64}$')
    AND ("output_sha256" IS NULL OR "output_sha256" ~ '^[0-9a-f]{64}$')
    AND ("meta_sha256" IS NULL OR "meta_sha256" ~ '^[0-9a-f]{64}$')
);

-- Item da decisão: o descartado tem motivo e não guarda o texto (rationale); o que vale tem ação, ticker e texto; só o HOLD
-- fica sem percentual; o percentual está entre 1 e 100.
ALTER TABLE "decision_item" ADD CONSTRAINT "decision_item_check" CHECK (
    "dropped" = ("drop_reason" IS NOT NULL)
    AND ("drop_reason" IS NULL OR "drop_reason" IN (
        'invalid_item', 'over_order_limit', 'not_in_universe', 'not_in_portfolio', 'duplicate_ticker', 'max_positions'))
    AND (NOT "dropped" OR "rationale" IS NULL)
    AND ("dropped" OR ("action" IS NOT NULL AND "ticker" IS NOT NULL AND "rationale" IS NOT NULL))
    AND ("action" IS NULL OR ("action" = 'HOLD') = ("percent" IS NULL))
    AND ("percent" IS NULL OR ("percent" >= 1 AND "percent" <= 100))
);

