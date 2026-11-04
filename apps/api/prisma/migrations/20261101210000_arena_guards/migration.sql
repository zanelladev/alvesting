-- Guardas da arena que o Prisma não emite (fecham o fechamento da etapa 6). O código já impede tudo isto antes de gravar
-- (seasonFileSchema, closeIfComplete); a restrição é para o dia em que um caminho novo esquecer. Migration só aditiva: não
-- apaga nem reescreve dado. As tabelas da arena estão vazias em todos os ambientes até a Temporada 0.

-- Um Sorteio por temporada, e cada referência (igual-peso, CDI, BOVA11) uma vez só.
CREATE UNIQUE INDEX "competitor_one_random_per_season" ON "competitor"("season_id") WHERE "kind" = 'RANDOM';
CREATE UNIQUE INDEX "competitor_one_benchmark_per_season" ON "competitor"("season_id", "benchmark") WHERE "kind" = 'BENCHMARK';

-- O ciclo fechado tem a hora do fechamento, e só ele: closeIfComplete grava as duas colunas no mesmo UPDATE.
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_closed_check" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL));
