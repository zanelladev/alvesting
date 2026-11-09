-- O ciclo retroativo e o operador local (ADR 0038; docs/METODOLOGIA.md, "Temporada 1"). Migration só aditiva: um tipo novo, duas colunas no
-- ciclo e uma na temporada. Nenhum dado existente muda: o executed_at das linhas que já existem nasce igual ao created_at delas (a hora real
-- em que cada uma foi criada; sem a cópia valeria a hora desta migration). As três primeiras instruções são a saída de `prisma migrate diff`;
-- a cópia, o CHECK, os privilégios por coluna e o gatilho da temporada são o que o Prisma não emite.

-- CreateEnum
CREATE TYPE "cycle_mode" AS ENUM ('RETROATIVO', 'AO_VIVO');

-- AlterTable
ALTER TABLE "cycle" ADD COLUMN     "executed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
ADD COLUMN     "mode" "cycle_mode" NOT NULL DEFAULT 'AO_VIVO';

-- AlterTable
ALTER TABLE "season" ADD COLUMN     "prompt_sha256" CHAR(64);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- O executed_at é a hora REAL em que a linha do ciclo nasceu. Para os ciclos que já existem, essa hora é o created_at.
UPDATE "cycle" SET "executed_at" = "created_at";

-- O SHA-256 do prompt com que a temporada começou: hexadecimal minúsculo, como o de prompt_version.
ALTER TABLE "season" ADD CONSTRAINT "season_prompt_sha256_check" CHECK ("prompt_sha256" ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- O papel mínimo da api (ADR 0028): ela LÊ o modo e a hora real do ciclo, e não os escolhe.
--  - UPDATE: era da tabela inteira e passa a ser só das colunas que o reprocesso do admin reavalia no ciclo pulado
--    (ArenaRepository.upsertCycle): estado, motivo, briefing e versão do prompt. O modo e a hora real ficam de fora.
--  - INSERT: continua da tabela inteira, porque o Prisma 7 nomeia no INSERT toda coluna que tem padrão (created_at, mode e executed_at
--    vão com o valor padrão do cliente; conferido no log do Postgres em 06/11/2026), e o GRANT por coluna derrubaria o reprocesso. Quem
--    fecha o valor é o gatilho abaixo: o ciclo que a api cria é sempre AO_VIVO e a hora real é a do relógio do banco.
-- A matriz é table-policy.ts; o api-role.integration.spec.ts compara o catálogo do banco com ela.
REVOKE UPDATE ON "cycle" FROM "alvesting_api_group";
GRANT UPDATE ("status", "skip_reason", "briefing_id", "prompt_version_id") ON "cycle" TO "alvesting_api_group";

-- O gatilho do ciclo (migration `20261103120000_api_role_guards`) com o modo e a hora real no INSERT da api. O UPDATE já recusava mudar
-- qualquer coluna fora das quatro do reprocesso, as novas inclusive.
CREATE OR REPLACE FUNCTION "api_cycle_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user <> 'alvesting_api' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('OPEN', 'SKIPPED') OR NEW.mode <> 'AO_VIVO'
       OR NOT EXISTS (SELECT 1 FROM public.season s WHERE s.id = NEW.season_id AND s.status = 'RUNNING') THEN
      RAISE EXCEPTION 'a api só cria ciclo aberto ou pulado, ao vivo, de uma temporada em andamento' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- a hora real é a do banco, e não a que o cliente mandou
    NEW.executed_at := now();
    RETURN NEW;
  END IF;
  IF OLD.status <> 'SKIPPED' OR NEW.status NOT IN ('OPEN', 'SKIPPED')
     OR (to_jsonb(NEW) - ARRAY['status', 'skip_reason', 'briefing_id', 'prompt_version_id'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'skip_reason', 'briefing_id', 'prompt_version_id']) THEN
    RAISE EXCEPTION 'a api só reavalia o ciclo pulado (estado, motivo, briefing e versão do prompt); data, temporada e prazo não mudam' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- A temporada: a api cria o rascunho SEM o prompt fixado (quem fixa é o arena:retroativo, com o login administrador, ao iniciar). O UPDATE da
-- api já não toca a coluna (o gatilho só deixa mudar nome, parâmetros, estado e início do rascunho). É o gatilho da migration
-- `20261103120000_api_role_guards` com a condição nova no INSERT.
CREATE OR REPLACE FUNCTION "api_season_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user <> 'alvesting_api' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.start_date IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.finished_at IS NOT NULL
       OR NEW.prompt_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'a api só cria temporada em rascunho: quem inicia é POST/PATCH /admin/seasons' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'DRAFT' OR NEW.status NOT IN ('DRAFT', 'RUNNING')
     OR (to_jsonb(NEW) - ARRAY['name', 'params', 'status', 'start_date', 'started_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['name', 'params', 'status', 'start_date', 'started_at']) THEN
    RAISE EXCEPTION 'temporada em andamento ou encerrada não muda (regras, elenco e prazo ficam fixos); a api só edita e inicia o rascunho' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
