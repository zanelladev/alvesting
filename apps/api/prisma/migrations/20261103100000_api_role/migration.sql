-- O papel mínimo do Postgres para a api (etapa 10, onda 3d; docs/INFRA.md, 2.2 e 2.7; ADR 0028). Migration só aditiva: cria um papel de
-- GRUPO (sem login) e dá a ele SÓ o que a api usa, tabela por tabela. Nenhuma tabela, linha ou privilégio existente muda.
--
-- Por que: a api é a única peça exposta à internet e tem uma biblioteca grande de terceiros (o Better Auth). Com o login administrador,
-- dono das tabelas, um furo nela viraria DDL, e quem remove o gatilho `consent_no_update` apaga a proteção do histórico de aceite. Com
-- este papel o banco recusa a remoção de gatilho, a mudança de tabela, o esvaziamento de tabela, a criação de tabela, o UPDATE e o
-- DELETE direto em `consent`, o DELETE em `audit_log` e qualquer escrita nas tabelas de resultado da arena (ordens, execuções,
-- posições, patrimônio, métricas, Monte Carlo e decisões: quem as grava é o worker e o job de decisões, que seguem com o login
-- administrador).
--
-- A MATRIZ é apps/api/src/infrastructure/database/table-policy.ts (escrita à mão, com o motivo de cada linha). O teste
-- api-role.integration.spec.ts compara o catálogo do banco com ela: um GRANT daqui que a matriz não tenha, ou o contrário, reprova.
-- NÃO há ALTER DEFAULT PRIVILEGES: tabela nova nasce sem privilégio nenhum para a api e precisa de decisão na matriz e de um GRANT na
-- migration dela.
--
-- O LOGIN (com senha) não nasce aqui: a senha nunca entra no repositório nem em migration. Ele é criado, e a senha definida, por um
-- comando idempotente que roda com o login administrador depois do `migrate deploy` (apps/api/src/db-roles-cli.ts, `pnpm db:roles`).
--
-- Papéis são do servidor inteiro, e não do banco: criar "se não existir" deixa a migration rodar em todo banco do mesmo servidor (dev,
-- teste, e2e) e de novo depois de um banco recriado. O EXCEPTION cobre o papel que outro banco do mesmo servidor já criou (duplicate_object) e
-- duas migrations que o criam no mesmo instante (unique_violation, que o catálogo levanta quando a segunda perde a corrida).

DO $$
BEGIN
  CREATE ROLE "alvesting_api_group" NOLOGIN;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END
$$;

-- O esquema `public` já é de uso comum (USAGE vai para PUBLIC por padrão); explícito para não depender do padrão do servidor. O CREATE no
-- esquema NÃO é concedido: a api não cria nada.
GRANT USAGE ON SCHEMA "public" TO "alvesting_api_group";

-- Conta (Better Auth e exclusão da conta): ler, criar, atualizar e apagar.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "session", "account", "verification" TO "alvesting_api_group";

-- Aceite dos termos: só ler e acrescentar. O DELETE da exclusão da conta vem da CASCATA do usuário, que o Postgres executa com os
-- privilégios do dono da tabela `consent` (docs/CONTA.md, seção 11), então a api não precisa de DELETE em `consent`, e o gatilho
-- `consent_no_delete` recusa o DELETE direto de qualquer jeito. A versão do prompt também só se acrescenta (o SHA-256 é do job de decisões).
GRANT SELECT, INSERT ON "consent", "prompt_version" TO "alvesting_api_group";

-- Trilha de auditoria: a api só acrescenta linha. Não lê, não muda, não apaga.
GRANT INSERT ON "audit_log" TO "alvesting_api_group";

-- O painel de admin lê o job_run, e o evento corporativo o reabre (UPDATE para FAILED); quem cria e apaga linha são os workers.
GRANT SELECT, UPDATE ON "job_run" TO "alvesting_api_group";

-- Temporada, ciclo e evento corporativo: o admin cria, edita o rascunho, inicia, reprocessa o ciclo e registra o evento.
GRANT SELECT, INSERT, UPDATE ON "season", "cycle", "corporate_event" TO "alvesting_api_group";

-- Editar o rascunho da temporada troca o elenco inteiro: apaga e recria.
GRANT SELECT, INSERT, DELETE ON "competitor" TO "alvesting_api_group";

-- Só leitura: o que a API pública e o painel consultam e outro processo grava. `order`, `fill`, `trading_day`, `universe_snapshot` e
-- `universe_member` ficam SEM privilégio: nenhuma rota da api os lê.
GRANT SELECT ON
  "fetch_state", "decision", "decision_item", "position", "equity_snapshot", "season_stat", "random_baseline",
  "instrument", "daily_bar", "news_item", "macro_daily", "briefing"
TO "alvesting_api_group";
