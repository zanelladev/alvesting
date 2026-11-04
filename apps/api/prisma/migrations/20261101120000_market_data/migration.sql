-- CreateEnum
CREATE TYPE "instrument_kind" AS ENUM ('STOCK', 'REFERENCE');

-- CreateEnum
CREATE TYPE "bar_source" AS ENUM ('COTAHIST', 'BRAPI');

-- CreateEnum
CREATE TYPE "trading_day_source" AS ENUM ('CALENDAR', 'COTAHIST');

-- CreateTable
CREATE TABLE "instrument" (
    "id" VARCHAR(26) NOT NULL,
    "ticker" VARCHAR(12) NOT NULL,
    "name" TEXT NOT NULL,
    "isin" VARCHAR(12),
    "spec" VARCHAR(10) NOT NULL,
    "kind" "instrument_kind" NOT NULL,
    "quote_factor" INTEGER NOT NULL DEFAULT 1,
    "last_seen" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_bar" (
    "id" VARCHAR(26) NOT NULL,
    "instrument_id" VARCHAR(26) NOT NULL,
    "date" DATE NOT NULL,
    "open_cents" BIGINT NOT NULL,
    "high_cents" BIGINT NOT NULL,
    "low_cents" BIGINT NOT NULL,
    "close_cents" BIGINT NOT NULL,
    "volume_cents" BIGINT NOT NULL,
    "trades" INTEGER,
    "source" "bar_source" NOT NULL,

    CONSTRAINT "daily_bar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_day" (
    "date" DATE NOT NULL,
    "source" "trading_day_source" NOT NULL,
    "cotahist_sha256" CHAR(64),

    CONSTRAINT "trading_day_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "universe_snapshot" (
    "id" VARCHAR(26) NOT NULL,
    "week" VARCHAR(8) NOT NULL,
    "window_start" DATE NOT NULL,
    "window_end" DATE NOT NULL,
    "window_days" INTEGER NOT NULL,
    "candidates" INTEGER NOT NULL,
    "eligible" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "universe_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "universe_member" (
    "id" VARCHAR(26) NOT NULL,
    "snapshot_id" VARCHAR(26) NOT NULL,
    "instrument_id" VARCHAR(26) NOT NULL,
    "position" INTEGER NOT NULL,
    "avg_volume_cents" BIGINT NOT NULL,
    "presence_days" INTEGER NOT NULL,

    CONSTRAINT "universe_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instrument_ticker_key" ON "instrument"("ticker");

-- CreateIndex
CREATE INDEX "daily_bar_date_idx" ON "daily_bar"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_bar_instrument_id_date_key" ON "daily_bar"("instrument_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "universe_snapshot_week_key" ON "universe_snapshot"("week");

-- CreateIndex
CREATE UNIQUE INDEX "universe_member_snapshot_id_instrument_id_key" ON "universe_member"("snapshot_id", "instrument_id");

-- CreateIndex
CREATE UNIQUE INDEX "universe_member_snapshot_id_position_key" ON "universe_member"("snapshot_id", "position");

-- AddForeignKey
ALTER TABLE "daily_bar" ADD CONSTRAINT "daily_bar_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universe_member" ADD CONSTRAINT "universe_member_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "universe_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "universe_member" ADD CONSTRAINT "universe_member_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
