-- A carteira do usuário (etapa 12; docs/API.md, seção 9; ADR 0031): `portfolio` (uma por usuário) e `portfolio_lot` (os lançamentos de compra).
-- Migration só aditiva: nenhuma tabela, linha ou privilégio existente muda. O SQL das tabelas é a saída de `prisma migrate diff`; o resto
-- (CHECKs, os GRANTs do papel da api e o gatilho) é o que o Prisma não emite. Dado pessoal: a cascata do usuário leva a carteira e os
-- lançamentos (a exclusão da conta, LGPD art. 18), e as duas tabelas ficam fora do dump do backup mensal (table-policy.ts, `personal`).

-- CreateTable
CREATE TABLE "portfolio" (
    "id" VARCHAR(26) NOT NULL,
    "user_id" VARCHAR(26) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_lot" (
    "id" VARCHAR(26) NOT NULL,
    "portfolio_id" VARCHAR(26) NOT NULL,
    "ticker" VARCHAR(12) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cost_cents" BIGINT NOT NULL,
    "bought_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_lot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_user_id_key" ON "portfolio"("user_id");

-- CreateIndex
CREATE INDEX "portfolio_lot_portfolio_id_idx" ON "portfolio_lot"("portfolio_id");

-- AddForeignKey
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_lot" ADD CONSTRAINT "portfolio_lot_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Guardas que o Prisma não emite. A api e o contrato (packages/contracts, portfolio-rules.ts) já impedem tudo o que elas impedem; a restrição
-- é a última barreira para o dia em que um caminho novo esquecer.

-- Os tetos do lançamento (ADR 0031): de 1 a 1.000.000 de ações e de 1 centavo a R$ 1.000.000.000,00 de custo total. Com 200 lançamentos por
-- carteira, o pior caso da soma (2 x 10^13 centavos) cabe em inteiro seguro, e a soma de quantidades (2 x 10^8), no INTEGER.
ALTER TABLE "portfolio_lot" ADD CONSTRAINT "portfolio_lot_quantity_check" CHECK ("quantity" BETWEEN 1 AND 1000000);
ALTER TABLE "portfolio_lot" ADD CONSTRAINT "portfolio_lot_cost_check" CHECK ("cost_cents" BETWEEN 1 AND 100000000000);

-- O mesmo formato de ticker do contrato (llm-decision.ts): BOVA11, PETR4, B3SA3. Sem chave estrangeira para `instrument` (ADR 0031): a
-- limpeza de `instrument` não pode travar por causa da carteira de um usuário, então quem confere que o papel existe é o serviço, na escrita.
ALTER TABLE "portfolio_lot" ADD CONSTRAINT "portfolio_lot_ticker_check" CHECK ("ticker" ~ '^[A-Z][A-Z0-9]{3}[0-9]{1,2}$');

-- A data da compra não é anterior a 1900 (lixo como 0001-01-01); o contrato repete o piso.
ALTER TABLE "portfolio_lot" ADD CONSTRAINT "portfolio_lot_bought_on_check" CHECK ("bought_on" IS NULL OR "bought_on" >= DATE '1900-01-01');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- O papel mínimo da api (ADR 0028), tabela por tabela e sem ALTER DEFAULT PRIVILEGES. A matriz é table-policy.ts; o api-role.integration.spec.ts
-- compara o catálogo com ela.
--   portfolio:     SELECT e INSERT. A api cria a linha no primeiro lançamento e a lê; a linha nunca muda e não sai por DELETE direto, só pela
--                  cascata do usuário (que o Postgres executa com os privilégios do dono da tabela, como em `consent`, ADR 0028 item 3).
--   portfolio_lot: SELECT, INSERT e DELETE (POST, GET e DELETE das rotas), e UPDATE só nas colunas que o PATCH troca: a carteira dona e a
--                  data de criação nunca mudam.
GRANT SELECT, INSERT ON "portfolio" TO "alvesting_api_group";
GRANT SELECT, INSERT, DELETE ON "portfolio_lot" TO "alvesting_api_group";
GRANT UPDATE ("ticker", "quantity", "cost_cents", "bought_on", "updated_at") ON "portfolio_lot" TO "alvesting_api_group";

-- O ESTADO em que a api escreve (o privilégio de tabela só diz o que ela toca): no máximo 200 lançamentos por carteira. O serviço já confere
-- (e responde 409 LOT_LIMIT), e este gatilho é a barreira do banco, do mesmo molde dos `*_api_guard` da migration 20261103120000: vale SÓ para o login
-- da api (`session_user`, que o SET ROLE não muda), e a função lê `public.portfolio_lot` com o esquema no nome (o login cria tabela TEMPORÁRIA).
-- Sem corrida: uma trava consultiva por carteira, que vale até o fim da transação, faz dois INSERT juntos contarem um depois do outro (o
-- segundo vê o commit do primeiro: em READ COMMITTED cada instrução de uma função volátil tem a foto nova). A recusa sai com SQLSTATE 42501.
CREATE FUNCTION "api_portfolio_lot_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user <> 'alvesting_api' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portfolio_lot:' || NEW.portfolio_id, 0));
  IF (SELECT count(*) FROM public.portfolio_lot l WHERE l.portfolio_id = NEW.portfolio_id) >= 200 THEN
    RAISE EXCEPTION 'a carteira tem no máximo 200 lançamentos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "portfolio_lot_api_guard" BEFORE INSERT ON "portfolio_lot" FOR EACH ROW EXECUTE FUNCTION "api_portfolio_lot_guard"();
