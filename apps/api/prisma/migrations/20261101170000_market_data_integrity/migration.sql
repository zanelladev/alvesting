-- CreateIndex
-- A FK que ficou sem índice: as duas únicas de universe_member começam por snapshot_id. Serve a "em quais universos
-- o papel esteve" e à checagem da FK quando se mexe em instrument.
CREATE INDEX "universe_member_instrument_id_idx" ON "universe_member"("instrument_id");

-- Integridade que o Prisma não modela (CHECK). O parser e o cliente da brapi já recusam estes casos; a restrição é a
-- rede de segurança para o dia em que um deles errar, em vez de gravar preço torto. Migration só aditiva: a
-- restrição é validada contra o que já está nas tabelas e a migration falha, sem mudar nada, se alguma linha não
-- passar.

-- Preço, volume e negócios nunca são negativos e a máxima nunca fica abaixo da mínima. Abertura e fechamento
-- dentro de [mínima, máxima] não entra: a barra da brapi pode não respeitar, e a reserva do eod não pode falhar por isso.
ALTER TABLE "daily_bar" ADD CONSTRAINT "daily_bar_values_check" CHECK (
    "open_cents" >= 0
    AND "close_cents" >= 0
    AND "low_cents" >= 0
    AND "high_cents" >= "low_cents"
    AND "volume_cents" >= 0
    AND ("trades" IS NULL OR "trades" >= 0)
);

-- A posição no universo começa em 1 (1 = maior volume médio).
ALTER TABLE "universe_member" ADD CONSTRAINT "universe_member_position_check" CHECK ("position" >= 1);

-- Semana ISO 8601: AAAA-Www, de W01 a W53.
ALTER TABLE "universe_snapshot" ADD CONSTRAINT "universe_snapshot_week_check" CHECK (
    "week" ~ '^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$'
);
