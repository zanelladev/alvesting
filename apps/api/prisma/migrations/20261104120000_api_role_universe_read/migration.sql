-- A fita da home (docs/API.md, seção 6; ADR 0033): a rota interna `GET /api/v1/interno/fita` lê o universo congelado da semana do último
-- ciclo (os papéis que o briefing deu a todos os modelos), e o papel da api (ADR 0028) não o lia. Migration só de CONCESSÃO: dá ao papel
-- de grupo o SELECT nas duas tabelas do universo e nada mais. Nenhuma tabela, linha ou outro privilégio muda; quem congela o universo
-- continua sendo o worker, com o login administrador.
--
-- A MATRIZ é apps/api/src/infrastructure/database/table-policy.ts (`api: ['SELECT']` nas duas, com o porquê); o api-role.integration.spec.ts
-- compara o catálogo do banco com ela. Sem ALTER DEFAULT PRIVILEGES, como na `20261103100000_api_role`. O GRANT é repetível: concedido de
-- novo, não muda nada.
GRANT SELECT ON "universe_snapshot", "universe_member" TO "alvesting_api_group";
