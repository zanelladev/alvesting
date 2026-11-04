-- Aperta o papel mínimo da api depois da revisão da onda 3d (ADR 0028). Migration só de REVOGAÇÃO e repetível: nenhuma tabela, linha ou
-- privilégio que a api usa muda. É uma migration à parte (e não uma edição da `20261103100000_api_role`) porque aquela já foi aplicada nos
-- bancos de dev e de teste: editar uma migration aplicada deixaria esses bancos com o privilégio velho e o checksum torto.

-- 1. `verification`: o Better Auth sem plugin só cria, procura e consome (DELETE) o pedido de uso único. O UPDATE dessa tabela
--    (`updateVerificationByIdentifier`) só é chamado pelos plugins email-otp e siwe, que não estão ligados, e a reserva de trava
--    (`reserveVerificationValue`) é um INSERT. A matriz (table-policy.ts) passa a dizer SELECT, INSERT e DELETE.
REVOKE UPDATE ON "verification" FROM "alvesting_api_group";

-- 2. Esquema `public`: o CREATE não é concedido ao grupo, mas a api também o herdaria de PUBLIC num servidor com o ACL permissivo (o padrão
--    do PostgreSQL 14 e anteriores; o 15 em diante já não dá CREATE a PUBLIC). Tirar de PUBLIC não depende do padrão do servidor: com ele a
--    api não cria tabela nem função no esquema. No padrão do PostgreSQL 17 é um comando sem efeito. O dono do esquema (o administrador, que
--    roda as migrations) pode revogar; as migrations seguintes continuam criando objetos, porque ele segue com o CREATE.
REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;
