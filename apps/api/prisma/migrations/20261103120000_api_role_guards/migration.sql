-- Fecha o que a revisão da onda 3d achou no papel da api (ADR 0028). Migration só aditiva: revoga um privilégio, o concede por coluna e cria
-- gatilhos. Nenhuma tabela, linha ou privilégio que a api usa de verdade muda. É uma migration à parte porque a `20261103100000_api_role` já foi
-- aplicada nos bancos de dev e de teste: editá-la deixaria esses bancos com o privilégio velho e o checksum torto.
--
-- O privilégio de TABELA diz o que a api toca, e não em que estado. Sem os fechos abaixo, uma api comprometida escreve no banco o que as rotas
-- de admin recusam em código (409 SEASON_LOCKED): forja o compromisso do SHA-256 do prompt, muda as regras, o elenco e o prazo de uma temporada
-- em andamento e depois publica um `settle`, que reliquida a partir do que o banco diz (o SettleHandler lê `season.params`). Daí que a api
-- "não escreve nas tabelas de resultado" valia só para o caminho direto.
--
-- Os gatilhos valem SÓ para o login da api (`session_user = 'alvesting_api'`; o SET ROLE não muda o session_user, e o `pg_has_role` daria
-- verdadeiro para o superusuário do Postgres do Docker). O worker, as decisões e os agendadores (login administrador) liquidam, encerram a
-- temporada e semeiam o banco, e os testes criam temporada em andamento direto. A recusa sai com SQLSTATE 42501 (insufficient_privilege), como
-- as de privilégio. As funções leem a `season` com o nome do esquema (public.season): o login pode criar tabela TEMPORÁRIA (o TEMP é de PUBLIC),
-- e uma `season` temporária na frente do search_path enganaria um nome sem esquema.

-- 1. prompt_version: a api só acrescenta a versão (id, version, created_at). O SHA-256 do texto e a hora do registro são do job de decisões
--    (registerPromptSha256): com a tabela inteira a api escolhia o compromisso (INSERT ... sha256), e o `UPDATE ... WHERE sha256 IS NULL` nunca
--    o corrigia, então todo competidor de todo ciclo preso àquela versão ficava em HOLD `prompt_divergente` para sempre. O REVOKE na tabela
--    leva junto o privilégio por coluna; o GRANT vem depois.
REVOKE INSERT ON "prompt_version" FROM "alvesting_api_group";
GRANT INSERT ("id", "version", "created_at") ON "prompt_version" TO "alvesting_api_group";

-- 2. season: a api cria o rascunho, o edita (nome e parâmetros) e o inicia (DRAFT -> RUNNING, com a data e a hora). Temporada em andamento ou
--    encerrada não muda: as regras, o elenco e o prazo ficam fixos (docs/ARENA.md). Encerrar (RUNNING -> FINISHED) é do worker.
--    `to_jsonb(NEW) - ARRAY[...]` compara a linha INTEIRA menos as colunas liberadas: coluna nova da tabela nasce travada para a api (falha fechado).
CREATE FUNCTION "api_season_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user <> 'alvesting_api' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.start_date IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.finished_at IS NOT NULL THEN
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

CREATE TRIGGER "season_api_guard" BEFORE INSERT OR UPDATE ON "season" FOR EACH ROW EXECUTE FUNCTION "api_season_guard"();

-- 3. competitor: editar o rascunho troca o elenco inteiro (apaga e recria). Só enquanto a temporada é rascunho: o elenco de uma temporada em
--    andamento é fixo, e uma linha nova com `model_id` fora do contrato (`:online`, `openrouter/auto`) seria chamada, e paga, pelo job de decisões.
CREATE FUNCTION "api_competitor_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent public.season_status;
BEGIN
  IF session_user <> 'alvesting_api' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  SELECT s.status INTO parent FROM public.season s WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.season_id ELSE NEW.season_id END;
  IF parent IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'o elenco de uma temporada em andamento ou encerrada não muda; a api só troca o elenco do rascunho' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "competitor_api_guard" BEFORE INSERT OR DELETE ON "competitor" FOR EACH ROW EXECUTE FUNCTION "api_competitor_guard"();

-- 4. cycle: o reprocesso cria o ciclo (aberto ou pulado) de uma temporada em andamento e REAVALIA o pulado (pulado -> aberto ou pulado, com o
--    motivo, o briefing e a versão do prompt). A data, a temporada e o prazo nunca mudam: com o prazo das 09:30 empurrado, o ciclo aceitaria
--    decisão depois do fechamento do mercado. Fechar o ciclo (closed_at) é do job de decisões e da varredura, e nunca da api.
CREATE FUNCTION "api_cycle_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user <> 'alvesting_api' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('OPEN', 'SKIPPED')
       OR NOT EXISTS (SELECT 1 FROM public.season s WHERE s.id = NEW.season_id AND s.status = 'RUNNING') THEN
      RAISE EXCEPTION 'a api só cria ciclo aberto ou pulado, de uma temporada em andamento' USING ERRCODE = 'insufficient_privilege';
    END IF;
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

CREATE TRIGGER "cycle_api_guard" BEFORE INSERT OR UPDATE ON "cycle" FOR EACH ROW EXECUTE FUNCTION "api_cycle_guard"();

-- 5. job_run: a api só REABRE a liquidação (JobRunStore.reopen, pelo evento corporativo): a linha da `settle` vai para FAILED, com o motivo e a hora.
--    Com a linha inteira, uma api comprometida marcava `eod` ou `freeze` como SUCCEEDED (a ingestão parada em silêncio) ou reabria o `backup-verify`
--    de um mês antigo e publicava a mensagem, e como o dump é enviado com `uploadStream` (sobrescreve `backups/alvesting-AAAA-MM.dump`), o dump
--    verificado daquele mês trocava pelo estado atual do banco.
CREATE FUNCTION "api_job_run_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user <> 'alvesting_api' THEN
    RETURN NEW;
  END IF;
  IF OLD.type <> 'settle' OR NEW.status <> 'FAILED'
     OR (to_jsonb(NEW) - ARRAY['status', 'error', 'finished_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'error', 'finished_at']) THEN
    RAISE EXCEPTION 'a api só reabre a liquidação (settle -> FAILED, com o motivo e a hora); o resto do job_run é dos workers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "job_run_api_guard" BEFORE UPDATE ON "job_run" FOR EACH ROW EXECUTE FUNCTION "api_job_run_guard"();
