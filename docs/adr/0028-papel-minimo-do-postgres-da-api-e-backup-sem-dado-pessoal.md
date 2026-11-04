# ADR 0028: Papel mínimo do Postgres para a api, matriz de tabelas escrita à mão e backup mensal sem dado pessoal

- **Status:** aceita
- **Data:** 03/11/2026
- **Origem:** `docs/PLANO.md`, §5.6, §5.8 e §16 (etapa 10); `docs/CONTA.md`, seções 5, 8 e 11; `docs/INFRA.md`, 2.2, 2.7, 4 e 10; `docs/API.md`, seções 6 e 8; ADR 0020, 0024 e 0027

## Contexto

Até a etapa 10 (partes 1 e 2) a api, os workers, os agendadores e as migrations usavam o mesmo login administrador do Postgres, dono das tabelas. A api é a única peça exposta à internet e tem uma
biblioteca grande de terceiros (o Better Auth); um furo nela viraria DDL, e quem remove o gatilho `consent_no_update` apaga a proteção do histórico de aceite. As rotas `/admin` ainda reliquidavam o evento
corporativo dentro da requisição, o que obrigava o papel da api a escrever nas tabelas de resultado da arena (ordens, execuções, posições, patrimônio, métricas, Monte Carlo).

Do outro lado, a política de privacidade (rascunho 0.1, item 5) promete que as cópias de segurança guardam dado pessoal só pelo ponto de restauração de 7 dias. O plano (§5.8) pede um `pg_dump` mensal
no Blob por 12 meses e uma restauração de teste. Um dump completo deixaria nome, e-mail e hash de senha por um ano.

## Decisão

1. **Um papel de grupo sem login (`alvesting_api_group`) e um login membro dele (`alvesting_api`).** A migration aditiva `20261103100000_api_role` cria o grupo (se não existir; papel é do servidor, não do banco)
   e dá a ele só o que a api usa, tabela por tabela, conferido no código (repositórios, Better Auth, rotas públicas, da conta e do admin). Sem `ALTER DEFAULT PRIVILEGES`: a tabela nova nasce sem privilégio para a api e
   precisa de uma decisão. O login (com senha) NÃO nasce na migration, porque a senha nunca entra em migration nem no repositório: um comando idempotente (`pnpm --filter @alvesting/api db:roles`, `src/db-roles-cli.ts`)
   roda com o login administrador depois do `migrate deploy`, lê a senha da `API_DATABASE_URL`, cria o login, define a senha e põe o login no grupo. A senha vai ao servidor como **resumo SCRAM-SHA-256**
   (`ALTER ROLE ... PASSWORD 'SCRAM-SHA-256$...'`): a documentação do `CREATE ROLE` avisa que a senha em texto "might also be logged in the client's command history or the server log", e um resumo já no formato
   é guardado como veio. Depois de criar, o comando CONFERE o login (sem atributo de administração, membro só do grupo, sem `CREATE` no esquema `public`) e falha se ele desviou. A revisão da onda acrescentou a migration
   `20261103110000_api_role_least_privilege` (à parte, porque a primeira já estava aplicada nos bancos de dev e de teste): só revoga o `UPDATE` de `verification` (o Better Auth sem plugin só cria, procura e consome) e o
   `CREATE` do esquema `public` de PUBLIC (o PostgreSQL 15 em diante já não o dá; num servidor com o ACL antigo a api herdaria o `CREATE`). A revisão de segurança do fechamento da parte 4 acrescentou a terceira, `20261103120000_api_role_guards` (item 10).
2. **A matriz escrita à mão (`apps/api/src/infrastructure/database/table-policy.ts`) é a fonte única de duas decisões por tabela:** o que a api faz nela e se ela guarda dado pessoal. O `table-policy.spec.ts` lê o
   `schema.prisma` e reprova a tabela sem decisão (do jeito do `user-data.spec.ts`) e o modelo ligado ao usuário que não esteja marcado como pessoal. O `api-role.integration.spec.ts` compara o catálogo do banco com a
   matriz (um `GRANT` da migration que a matriz não tenha, ou o contrário, reprova) e conecta COMO o login novo: o que a api precisa funciona e o que ela não pode o banco recusa (`42501`): remover o gatilho do aceite,
   alterar, esvaziar ou criar tabela, o `UPDATE` e o `DELETE` direto em `consent`, o `DELETE` em `audit_log`, qualquer escrita nas tabelas de resultado, `SET ROLE` para o administrador.
3. **A cascata do `DELETE` do usuário não pede `DELETE` em `consent`.** A ação `ON DELETE CASCADE` é um gatilho de integridade referencial que o Postgres executa com os privilégios do **dono da tabela que ele
   consulta** (`ri_triggers.c`, `ri_PlanCheck`: "we'll do the check as that table's owner"; nas ações a tabela é a que referencia). Então a api tem só `SELECT` e `INSERT` em `consent`, o gatilho `consent_no_delete`
   continua recusando o `DELETE` direto, e excluir o usuário leva o aceite junto (provado no `api-role.integration.spec.ts` e no `DELETE /me` do `me.integration.spec.ts`).
4. **A api só tem `INSERT` em `audit_log`**: grava a trilha, e não a lê, muda nem apaga. O `create` do Prisma lê a linha de volta (`INSERT ... RETURNING`, que pede `SELECT`), então toda gravação de auditoria que a
   api alcança usa `appendAudit` (`common/audit.ts`, `createMany`). O teste mostra o `create` recusado.
5. **A api não escreve nas tabelas de resultado da arena.** O `POST /admin/corporate-events` registra o evento, reabre o `job_run` da liquidação e **publica a `settle` na fila** (`SettlementPublisher.resettle` e
   `JobRunStore.reopen`); quem liquida é o worker, que depois revalida o site e limpa a borda como em toda liquidação. A resposta e o painel dizem "enfileirada" (`queued`, no lugar de `settled`). Falha ao publicar é 502
   `PUBLISH_FAILED` (o evento fica registrado; repetir é seguro). O comando `settle:event` e o ensaio, que usam o `CorporateEventService` direto com o login administrador, não mudam.
6. **`statement_timeout` de 10 s no papel** (`ALTER ROLE ... SET`), contra os 60 s dos workers. A consulta mais lenta medida na api foi de 36,7 ms (sem índice, `docs/API.md`, seção 4) e as rotas do admin são de
   poucos milissegundos: 10 s dá mais de 270 vezes de folga. O parâmetro que o driver manda na partida da sessão vence o do papel, então o pool da api (`PrismaService.poolConfig`, que reconhece o login pelo usuário
   da URL) não manda o dele. O papel é só o PADRÃO (a sessão pode dar um `SET statement_timeout`); o teto de verdade seria um limite na rota.
7. **A api roda com a `API_DATABASE_URL` no dev e no e2e** (`useApiLogin` no `main.ts`: o papel HTTP troca o `DATABASE_URL` pela dela; worker, decisões e agendadores nunca chamam isso). Na Azure o `ca-api` recebe o
   login dela direto no `DATABASE_URL` (**feito na parte 4 da etapa 10**: o `postgres.bicep` grava o segredo derivado `database-url-api`, com a senha de `ALVESTING_PG_API_PASSWORD`, `@secure` e `@minLength(32)`; só a `id-alvesting-api` e a `id-alvesting-migrate` o leem; o `ca-api` o usa no `DATABASE_URL`; o `job-migrate` roda `sh -c 'migrate deploy && node dist/db-roles-cli.js'`; e **a api recusa subir em produção** com outro usuário no `DATABASE_URL`, `requireApiLogin`, provado também na imagem pelo job `images` do CI). Os specs HTTP (admin, conta, públicas, ciclo, telemetria) e os três projetos do e2e rodam a api com este login.
8. **O backup mensal leva o esquema inteiro e NÃO leva os dados das tabelas pessoais.** `pg_dump --exclude-table-data` para cada tabela marcada como pessoal na matriz (hoje `user`, `session`, `account`,
   `verification` e `consent`); o dado delas fica só no ponto de restauração de 7 dias, como a política promete. A restauração de teste confere que elas voltam vazias, e o handler recusa tabela do banco sem decisão
   na matriz (uma tabela pessoal nova iria para o dump com os dados). O `audit_log` NÃO é pessoal: só tem ULID (a política mantém a linha depois da exclusão da conta).
9. **O `backup-verify` restaura de verdade, em fluxo, e confere no mesmo instante.** `pg_export_snapshot()` numa transação `REPEATABLE READ` que fica aberta, contagem de toda tabela da matriz nesse snapshot, e
   `pg_dump --snapshot` (formato custom, em fluxo, para `backups/alvesting-AAAA-MM.dump` com `uploadStream` de blocos de 4 MiB: nada passa pelo disco do contêiner) e `pg_restore` (do Blob, em fluxo) para um banco
   temporário no mesmo servidor. As contagens da restauração têm de bater com as da origem; as pessoais, zero. O banco temporário (`alvesting_verify_AAAAMM_<8 hex>`) é apagado no fim, inclusive na falha, e o
   código só apaga banco com esse nome exato (`dropTempDatabase`, a única porta do `DROP DATABASE`, com teste). O dump que não passou na conferência é apagado do Blob; o que o processo deixa para trás se morre entre o envio e
   a conferência se reconhece pela falta dos metadados `sha256` e `personal_data`, que só são gravados depois dela. As ferramentas têm de ser do major do servidor (17): o código confere e recusa as outras. A senha vai no
   `PGPASSWORD` do filho, nunca em argumento. Todo filho tem prazo e morre no abort. A fila `maintenance` renova a trava por 25 min (o prazo do conjunto é 20) e espera 10 e 20 min entre as entregas: a última cai depois da
   trava, e a réplica que morre no meio do backup é reassumida pela terceira entrega e não mandada à DLQ (com 1 minuto de espera as três entregas veriam `busy`).
10. **O banco recusa à api o ESTADO errado, não só a tabela errada** (migration `20261103120000_api_role_guards`; achada pela revisão de segurança do fechamento da parte 4, reproduzida com o login numa transação que volta atrás). O privilégio de tabela diz o que a api toca, e não em
    que estado: ela forjava o compromisso do SHA-256 do prompt (`INSERT` de `prompt_version` com `sha256`, que o `UPDATE ... WHERE sha256 IS NULL` do job de decisões nunca corrigia, e todo ciclo preso àquela versão ficava em HOLD `prompt_divergente` para sempre) e mudava, nas tabelas que as
    rotas de admin editam, o que elas recusam em código (409 `SEASON_LOCKED`: as regras, o elenco e o prazo de uma temporada em andamento), e como a api também tem `Sender` em `settlement`, publicar um `settle` reliquidava a arena a partir do que o banco dizia. Então: (1) `prompt_version`: `INSERT` só de
    `id`, `version` e `created_at` (privilégio por coluna; o `Prisma createMany` do `ensurePromptVersion` manda exatamente essas três, provado com o login); (2) quatro gatilhos `BEFORE ... FOR EACH ROW` que valem **só para o login da api** (`session_user = 'alvesting_api'`, que o `SET ROLE` não muda; o
    `pg_has_role` daria verdadeiro para o superusuário do Postgres do Docker, e o worker, as decisões e as fixtures dos testes escrevem o que a api não pode): `season` (a api cria em rascunho, edita o nome e os parâmetros do rascunho e o inicia; temporada em andamento ou encerrada não muda), `competitor` (insere e apaga só com a
    temporada em rascunho), `cycle` (cria ciclo aberto ou pulado de temporada em andamento e reavalia só o PULADO nas colunas de estado; data, temporada e prazo nunca mudam) e `job_run` (só reabre a `settle`: status `FAILED`, erro e hora). Cada um compara a linha inteira menos as colunas liberadas
    (`to_jsonb(NEW) - ARRAY[...]`), então coluna nova da tabela nasce travada para a api, e recusa com `42501`. As funções leem `public.season` com o esquema no nome (o login cria tabela TEMPORÁRIA, que passaria na frente do `search_path`). A coluna `guard` da matriz (`table-policy.ts`) liga cada tabela ao seu gatilho
    e o `api-role.integration.spec.ts` confere o catálogo contra ela, com uma sonda por recusa e outra por permissão, feitas com o login (e o mutante de cada gatilho desligado foi pego); (3) `CONNECTION LIMIT 24` no login **em produção** (5 réplicas × 4 do pool, com folga, nas ~50 conexões do B1ms): ao contrário do `statement_timeout`,
    o papel comum não o tira, e uma api comprometida não esgota o servidor e deixa o worker, as decisões e os agendadores sem conexão; em dev e no e2e o login é dividido por todos os processos da api da máquina (o e2e sobe sete) e fica sem limite; (4) o job de decisões confere o ID do modelo do banco contra a regra do arquivo da temporada
    (`isValidModelId`, `competitorById`) antes de chamá-lo, porque o `CHECK` da tabela não tem o regex (uma linha `:online` ou `openrouter/auto` seria chamada e paga); falha só para aquele competidor (DLQ, que alerta).

## Alternativas descartadas

- **RLS no lugar do papel.** Com o login administrador, dono das tabelas, uma política de RLS não amarraria a api; e o que se quer impedir é DDL e escrita no resultado, que privilégio de tabela resolve.
- **Papel só de `SELECT` para a api.** Já não serve desde a etapa 11 (a conta escreve).
- **Dump completo com criptografia.** Resolveria o vazamento do arquivo, não a promessa da política (a cópia guardaria dado pessoal por 12 meses).
- **Dump só do esquema.** Não provaria que o dado público da arena (que é o experimento) volta.
- **Arquivo temporário para o `pg_restore -j`.** Disco efêmero pequeno; o restore sequencial de um dump em formato custom lido da entrada padrão funciona.

## Consequências

- **Workers, decisões e agendadores seguem com o login administrador** (não são expostos à internet). `ponytail`: um RCE neles poderia mudar o desenho do banco. O próximo passo é um segundo papel de grupo, de
  escrita sem DDL, com uma coluna `worker` ao lado de `api` na mesma matriz.
- **Toda tabela nova** (a carteira da etapa 12, o chat da 13) precisa de uma linha na matriz (privilégio da api e pessoal ou não) e de um `GRANT` na migration dela, ou o `table-policy.spec.ts` e o
  `api-role.integration.spec.ts` reprovam. Dado pessoal novo entra no dump só pelo ponto de restauração.
- A rotação da senha do login da api é trocar o segredo, rodar o comando de novo **e reiniciar a revisão do `ca-api` logo em seguida**: a senha muda no banco na hora e as réplicas só recebem o segredo novo ao reiniciar, então há uma janela
  de alguns segundos com 5xx, aceita (`docs/INFRA.md`, 8.2). Giro sem janela pede dois logins alternados.
- O login ainda pode criar tabelas TEMPORÁRIAS (o `TEMP` no banco é privilégio padrão de PUBLIC): elas morrem com a sessão e não alcançam o esquema `public`, onde ele não tem `CREATE`.
- **Cinco coisas que o login da api ainda pode (risco aceito; conferido com o login, em transação que volta atrás).**
  (a) **Gravar `user.role`**: o Better Auth insere e atualiza `user`, então o papel nega DDL mas não impede um `INSERT`/`UPDATE` com `role = 'ADMIN'`. A regra "o papel só muda pelo `account:promote`" vale na aplicação, e não
  no banco. Fechá-la pede um gatilho `BEFORE INSERT OR UPDATE OF role ON "user"` que recuse `ADMIN` para o login da api (comparando `session_user`, e não `pg_has_role`, que dá verdadeiro para superusuário e travaria o
  `account:promote` no Postgres do Docker). Não foi feito: quem compromete a api já publica em todas as filas e escreve o que as rotas de admin escrevem (dentro dos gatilhos do item 10), então o ganho é pequeno.
  (b) **Travar uma tabela inteira**: `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` é permitido em toda tabela em que o papel tem `UPDATE` ou `DELETE` (`user`, `session`, `account`, `verification`, `job_run`, `season`,
  `cycle`, `competitor`, `corporate_event` e, desde a etapa 12, `portfolio_lot`, ADR 0031), o que é negação de serviço. (c) **Desfazer o próprio limite**: `ALTER ROLE alvesting_api RESET statement_timeout` é aceito (papel comum altera os próprios padrões), e o
  `statement_timeout` de 10 s deixa de valer para o login. (d) **Trocar a própria senha**: `ALTER ROLE alvesting_api PASSWORD '...'` é aceito (o papel comum altera a própria senha; impedir pede gatilho de evento, que o administrador do Flexible Server não cria), e as réplicas novas deixam de autenticar até o
  `db:roles` rodar de novo. A recuperação é rodar o `job-migrate`, que reaplica a senha do `database-url-api` (`docs/INFRA.md`, 8.2), e o `password authentication failed` cai no alerta `api-5xx`. (e) **O que as rotas de admin deixam fazer, sem as rotas**: criar e iniciar um rascunho (com qualquer `params`
  ou elenco; o ID do modelo fora do contrato morre em `competitorById`, e o teto mensal de custo limita o gasto), registrar um `corporate_event` com o fator que quiser e publicar um `settle` (o worker reliquida com ele), e criar o ciclo de uma temporada em andamento. A regra "uma temporada em andamento por vez" é conferida na rota, sob trava consultiva, e não no banco: um índice único parcial em
  `status = 'RUNNING'` não foi feito porque o comando `season:start` e as fixtures dos testes iniciam mais de uma. Os cinco ficam como estão; o desenho impede o que mais custa (DDL, o aceite reescrito, a trilha apagada, escrita no resultado da arena, o compromisso do prompt forjado, a temporada em andamento reescrita).
- **O dump leva os `GRANT` do papel de grupo.** A restauração num servidor novo precisa do papel antes (`CREATE ROLE alvesting_api_group NOLOGIN`) e do `db:roles` depois; o `backup-verify` restaura no mesmo servidor, onde o papel
  existe, então não prova isso (`docs/JOBS.md`, 8.2).
- **Não verificado na Azure** (nada rodou na assinatura): o `CREATE ROLE` e o `GRANT` pelo administrador do Flexible Server (que não é superusuário), o `CREATE DATABASE` e o `pg_restore` nele, a latência do
  dump para o Blob de verdade, o `job-migrate` com os dois comandos e o `postgresql-client-17` na imagem (parte 4: está no Dockerfile e no CI, mas `docker build` não rodou; `docs/INFRA.md`, seção 11).
