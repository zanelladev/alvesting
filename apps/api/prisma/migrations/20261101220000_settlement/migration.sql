-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('FILLED', 'REDUCED', 'NOT_EXECUTED');

-- CreateEnum
CREATE TYPE "corporate_event_kind" AS ENUM ('SPLIT', 'REVERSE_SPLIT', 'BONUS');

-- CreateTable
CREATE TABLE "order" (
    "id" VARCHAR(26) NOT NULL,
    "season_id" VARCHAR(26) NOT NULL,
    "competitor_id" VARCHAR(26) NOT NULL,
    "date" DATE NOT NULL,
    "item_index" INTEGER NOT NULL,
    "decision_item_id" VARCHAR(26),
    "ticker" VARCHAR(12) NOT NULL,
    "action" "decision_action" NOT NULL,
    "status" "order_status" NOT NULL,
    "reason" VARCHAR(24),
    "requested_quantity" BIGINT,
    "filled_quantity" BIGINT NOT NULL,
    "price_cents" BIGINT,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fill" (
    "id" VARCHAR(26) NOT NULL,
    "order_id" VARCHAR(26) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "price_cents" BIGINT NOT NULL,
    "notional_cents" BIGINT NOT NULL,
    "cost_cents" BIGINT NOT NULL,
    "realized_cents" BIGINT,

    CONSTRAINT "fill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position" (
    "id" VARCHAR(26) NOT NULL,
    "season_id" VARCHAR(26) NOT NULL,
    "competitor_id" VARCHAR(26) NOT NULL,
    "date" DATE NOT NULL,
    "ticker" VARCHAR(12) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "cost_cents" BIGINT NOT NULL,
    "mark_cents" BIGINT NOT NULL,
    "value_cents" BIGINT NOT NULL,
    "stale" BOOLEAN NOT NULL,

    CONSTRAINT "position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_snapshot" (
    "id" VARCHAR(26) NOT NULL,
    "season_id" VARCHAR(26) NOT NULL,
    "competitor_id" VARCHAR(26) NOT NULL,
    "date" DATE NOT NULL,
    "cash_cents" BIGINT NOT NULL,
    "positions_value_cents" BIGINT NOT NULL,
    "equity_cents" BIGINT NOT NULL,
    "interest_cents" BIGINT NOT NULL,
    "cdi_date" DATE,
    "percentile_bps" INTEGER,

    CONSTRAINT "equity_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_stat" (
    "id" VARCHAR(26) NOT NULL,
    "season_id" VARCHAR(26) NOT NULL,
    "competitor_id" VARCHAR(26) NOT NULL,
    "as_of" DATE NOT NULL,
    "return_bps" INTEGER NOT NULL,
    "percentile_bps" INTEGER,
    "excess_equal_weight_bps" INTEGER,
    "excess_cdi_bps" INTEGER,
    "max_drawdown_bps" INTEGER NOT NULL,
    "sells" INTEGER NOT NULL,
    "winning_sells" INTEGER NOT NULL,
    "win_rate_bps" INTEGER,
    "trades" INTEGER NOT NULL,

    CONSTRAINT "season_stat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "random_baseline" (
    "id" VARCHAR(26) NOT NULL,
    "season_id" VARCHAR(26) NOT NULL,
    "date" DATE NOT NULL,
    "seed" VARCHAR(64) NOT NULL,
    "runs" INTEGER NOT NULL,
    "equity_p5_cents" BIGINT NOT NULL,
    "equity_p25_cents" BIGINT NOT NULL,
    "equity_p50_cents" BIGINT NOT NULL,
    "equity_p75_cents" BIGINT NOT NULL,
    "equity_p95_cents" BIGINT NOT NULL,
    "return_p5_bps" INTEGER NOT NULL,
    "return_p25_bps" INTEGER NOT NULL,
    "return_p50_bps" INTEGER NOT NULL,
    "return_p75_bps" INTEGER NOT NULL,
    "return_p95_bps" INTEGER NOT NULL,

    CONSTRAINT "random_baseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_event" (
    "id" VARCHAR(26) NOT NULL,
    "ticker" VARCHAR(12) NOT NULL,
    "ex_date" DATE NOT NULL,
    "kind" "corporate_event_kind" NOT NULL,
    "ratio_from" INTEGER NOT NULL,
    "ratio_to" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corporate_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_season_id_idx" ON "order"("season_id");

-- CreateIndex
CREATE INDEX "order_decision_item_id_idx" ON "order"("decision_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_competitor_id_date_item_index_key" ON "order"("competitor_id", "date", "item_index");

-- CreateIndex
CREATE UNIQUE INDEX "fill_order_id_key" ON "fill"("order_id");

-- CreateIndex
CREATE INDEX "position_season_id_idx" ON "position"("season_id");

-- CreateIndex
CREATE UNIQUE INDEX "position_competitor_id_date_ticker_key" ON "position"("competitor_id", "date", "ticker");

-- CreateIndex
CREATE INDEX "equity_snapshot_season_id_date_idx" ON "equity_snapshot"("season_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "equity_snapshot_competitor_id_date_key" ON "equity_snapshot"("competitor_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "season_stat_competitor_id_key" ON "season_stat"("competitor_id");

-- CreateIndex
CREATE INDEX "season_stat_season_id_idx" ON "season_stat"("season_id");

-- CreateIndex
CREATE UNIQUE INDEX "random_baseline_season_id_date_key" ON "random_baseline"("season_id", "date");

-- CreateIndex
CREATE INDEX "corporate_event_ex_date_idx" ON "corporate_event"("ex_date");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_event_ticker_ex_date_kind_key" ON "corporate_event"("ticker", "ex_date", "kind");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_decision_item_id_fkey" FOREIGN KEY ("decision_item_id") REFERENCES "decision_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fill" ADD CONSTRAINT "fill_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_snapshot" ADD CONSTRAINT "equity_snapshot_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_snapshot" ADD CONSTRAINT "equity_snapshot_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_stat" ADD CONSTRAINT "season_stat_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_stat" ADD CONSTRAINT "season_stat_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "random_baseline" ADD CONSTRAINT "random_baseline_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rede de segurança da liquidação (o que o Prisma não emite). O domínio já garante tudo isto antes de gravar; a restrição é para o
-- dia em que um caminho novo errar a conta e gravar um número com cara de certo. Migration só aditiva: as tabelas novas nascem
-- vazias, e a restrição da temporada é validada contra o que já está nela (nenhuma temporada FINISHED existia até aqui).

-- Ordem: só BUY ou SELL (HOLD não vira ordem). Quem não executou diz por quê e não tem quantidade executada; quem executou tem o
-- preço da abertura.
ALTER TABLE "order" ADD CONSTRAINT "order_check" CHECK (
    "action" IN ('BUY', 'SELL')
    AND "item_index" >= 0
    AND "filled_quantity" >= 0
    AND ("requested_quantity" IS NULL OR "requested_quantity" >= 0)
    AND ("price_cents" IS NULL OR "price_cents" > 0)
    AND ("status" = 'NOT_EXECUTED') = ("reason" IS NOT NULL)
    AND ("reason" IS NULL OR "reason" IN ('no_position', 'max_positions', 'no_bar', 'below_one_share', 'insufficient_cash'))
    AND ("status" = 'NOT_EXECUTED') = ("filled_quantity" = 0)
    AND ("status" = 'NOT_EXECUTED' OR "price_cents" IS NOT NULL)
);

-- Execução: o valor é a quantidade vezes o preço.
ALTER TABLE "fill" ADD CONSTRAINT "fill_check" CHECK (
    "quantity" > 0
    AND "price_cents" > 0
    AND "notional_cents" = "quantity" * "price_cents"
    AND "cost_cents" >= 0
);

-- Posição: o valor é a quantidade vezes a marcação.
ALTER TABLE "position" ADD CONSTRAINT "position_check" CHECK (
    "quantity" > 0
    AND "cost_cents" >= 0
    AND "mark_cents" > 0
    AND "value_cents" = "quantity" * "mark_cents"
);

-- Snapshot: o patrimônio é o caixa mais as posições; o caixa nunca fica negativo (sem alavancagem); o percentil é de 0 a 10.000.
ALTER TABLE "equity_snapshot" ADD CONSTRAINT "equity_snapshot_check" CHECK (
    "cash_cents" >= 0
    AND "positions_value_cents" >= 0
    AND "equity_cents" = "cash_cents" + "positions_value_cents"
    AND "interest_cents" >= 0
    AND ("percentile_bps" IS NULL OR "percentile_bps" BETWEEN 0 AND 10000)
);

-- Métricas: o acerto existe quando houve venda, e só então; as vendas com lucro são parte das vendas; o drawdown não é negativo.
ALTER TABLE "season_stat" ADD CONSTRAINT "season_stat_check" CHECK (
    "max_drawdown_bps" >= 0
    AND "sells" >= 0
    AND "winning_sells" >= 0
    AND "winning_sells" <= "sells"
    AND "trades" >= 0
    AND ("win_rate_bps" IS NULL) = ("sells" = 0)
    AND ("win_rate_bps" IS NULL OR "win_rate_bps" BETWEEN 0 AND 10000)
    AND ("percentile_bps" IS NULL OR "percentile_bps" BETWEEN 0 AND 10000)
);

-- Monte Carlo: pelo menos uma carteira, e os percentis crescem do 5 ao 95.
ALTER TABLE "random_baseline" ADD CONSTRAINT "random_baseline_check" CHECK (
    "runs" >= 1
    AND "equity_p5_cents" <= "equity_p25_cents"
    AND "equity_p25_cents" <= "equity_p50_cents"
    AND "equity_p50_cents" <= "equity_p75_cents"
    AND "equity_p75_cents" <= "equity_p95_cents"
    AND "return_p5_bps" <= "return_p25_bps"
    AND "return_p25_bps" <= "return_p50_bps"
    AND "return_p50_bps" <= "return_p75_bps"
    AND "return_p75_bps" <= "return_p95_bps"
);

-- Evento corporativo: o fator muda a quantidade e tem a direção do tipo (desdobramento e bonificação aumentam; grupamento reduz).
ALTER TABLE "corporate_event" ADD CONSTRAINT "corporate_event_check" CHECK (
    "ratio_from" > 0
    AND "ratio_to" > 0
    AND "ratio_from" <> "ratio_to"
    AND CASE "kind"
        WHEN 'REVERSE_SPLIT' THEN "ratio_to" < "ratio_from"
        ELSE "ratio_to" > "ratio_from"
    END
);

-- Temporada: encerrada tem a hora do encerramento, e só ela. O settle do último pregão grava as duas colunas na mesma transação
-- da última liquidação (docs/ARENA.md, seção 10).
ALTER TABLE "season" ADD CONSTRAINT "season_finished_check" CHECK (("status" = 'FINISHED') = ("finished_at" IS NOT NULL));

