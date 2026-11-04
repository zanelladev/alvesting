# Infra na Azure: especificação de produção da Alvesting

Spec da infra em Bicep (`infra/`), no molde de seções da spec de produção da Cargoos. Descreve **o que o Bicep cria de
fato**, o contrato com os apps e o passo a passo para subir do zero. A fonte das decisões é o `docs/PLANO.md` (§5 e §6);
as decisões deliberadas estão em `docs/adr/`, e as que nasceram ao escrever o Bicep estão na seção 10.

**Estado em 01/11/2026:** o Bicep compila sem erro nem aviso e o `infra/tests/check.mjs` passa (seção 13), já com as
correções das revisões de correção e de segurança da etapa 2 e as pendências da onda 1 (seção 10): uma identidade por
workload com cada segredo no escopo de quem o lê (ADR 0020), Azure OpenAI sem chave, log de auditoria do cofre e do WAF
(retenção de 90 dias), imagens sem `latest`. O que a revisão da onda 2a deixou como menor está aqui: o critério do Blob para a
etapa 6 (seção 3.2, item 4), o plano B do segundo cofre (seção 11) e os testes novos (seção 13). **Nada foi implantado**: o
deploy do zero e o what-if da segunda execução precisam da assinatura do Artur, e os comandos exatos estão na seção 6. O que só
a Azure confirma está na seção 11 e no checklist da seção 12. A etapa 10 (parte 1, 02/11/2026) acrescentou a telemetria da api, as
métricas próprias e os alertas (seção 5, `modules/alerts.bicep`); como o resto, sem implantação. **A etapa 10 (parte 4, 03/11/2026)**
fechou o endurecimento da infra: o segredo do login de menor privilégio da api no Postgres (`database-url-api`, seções 2.2, 2.6 e 2.7), o
acesso ao Blob **por container** e ao Service Bus **por fila** (seção 3.2; ADR 0030), o blue/green com o label `green` e o endpoint green do
Front Door (seção 2.5; `docs/DEPLOY.md`; ADR 0029) e o `postgresql-client-17` na imagem da api (seção 2.8); também sem implantação.

```
infra/
├─ main.bicep                  orquestra os módulos; perfil, nomes, imagens
├─ main.prod.bicepparam        rg-alvesting-prod: profile = padrao, nomes do §5.3, regime de rotina
├─ main.dev.bicepparam         rg-alvesting-dev: profile = economico, nomes com -dev, regime de rotina
├─ bicepconfig.json            what-if-short-circuiting em erro (o what-if precisa olhar dentro dos módulos)
├─ roles.bicep                 os GUIDs dos papéis internos da Azure, em um lugar só
├─ modules/                    identity · observability · network · keyvault · storage · acr · servicebus
│                              postgres · email · openai · containerenv · containerapps · secret-access
│                              frontdoor · budget · alerts
├─ scripts/seed-secrets.sh     semeia os segredos que o Artur preenche à mão (uma vez)
├─ scripts/verify-roles.sh     confere na assinatura o nome de cada GUID do roles.bicep (passo 0)
└─ tests/check.mjs             compila os dois perfis e confere os invariantes (só Node)
```

---

## 1. Topologia

### 1.1 Diagrama

```
 Usuários (celular · HTTPS)
        │
        ▼
 Front Door Standard (afd-alvesting)    só no perfil padrão
   WAF: rate limit por IP · cache de /_next/static/* e das GET públicas da API · probe GET /health a cada 30 s
   /api/* ──▶ grupo api        /_next/static/*, /* ──▶ grupo web
        │  a origem só atende quem traz X-Azure-FDID = ID deste perfil (trava no código dos apps, etapa 3)
┌───────┼──────────── East US 2 · rg-alvesting-prod ────────────────────────────────────────────┐
│ vnet-alvesting 10.10.0.0/16                                                                    │
│ ┌─ snet-apps 10.10.0.0/23 · cae-alvesting (Consumption, ingress Envoy + Azure LB gerenciado) ─┐ │
│ │ ca-web (1→5) ──SSR──▶ ca-api (1→5) ──chat──▶ oai-alvesting (opcional)                       │ │
│ │ job-sched-* (7, cron UTC) ──publicam──▶ sb-alvesting ──KEDA──▶ ca-worker-data (0→3)         │ │
│ │                                               └──KEDA──▶ job-worker-decisions (≤10 execuções)│ │
│ │ job-migrate (manual)                                                                        │ │
│ └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ snet-postgres 10.10.2.0/24 (delegada) · psql-alvesting 17 B1ms · DNS privado · sem IP público   │
│ kv-alvesting · stalvesting · cralvesting · log-alvesting + appi-alvesting · acs-alvesting       │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
 Perfil econômico: sem Front Door e sem ACR; o ingress do Container Apps é o balanceador e a api
 vai para outro subdomínio, com CORS.
```

### 1.2 Recursos criados

| Recurso | Nome | SKU / tamanho | Módulo | Perfil |
|---|---|---|---|---|
| Identidade do `ca-web` | `id-alvesting-web` | user-assigned, só a plataforma a usa | `identity.bicep` | ambos |
| Identidade do `ca-api` | `id-alvesting-api` | user-assigned | `identity.bicep` | ambos |
| Identidade do `ca-worker-data` | `id-alvesting-worker` | user-assigned | `identity.bicep` | ambos |
| Identidade do `job-worker-decisions` | `id-alvesting-decisions` | user-assigned | `identity.bicep` | ambos |
| Identidade dos 7 agendadores | `id-alvesting-sched` | user-assigned | `identity.bicep` | ambos |
| Identidade do `job-migrate` | `id-alvesting-migrate` | user-assigned, só a plataforma a usa | `identity.bicep` | ambos |
| Identidade do KEDA | `id-alvesting-scale` | user-assigned, só as regras de escala a usam | `identity.bicep` | ambos |
| Log Analytics | `log-alvesting` | PerGB2018, retenção 90 dias | `observability.bicep` | ambos |
| Application Insights | `appi-alvesting` | workspace-based | `observability.bicep` | ambos |
| VNet + 2 sub-redes + zona DNS privada | `vnet-alvesting`, `snet-apps`, `snet-postgres`, `psql-alvesting.private.postgres.database.azure.com` | 10.10.0.0/16 | `network.bicep` | ambos |
| Key Vault | `kv-alvesting` | Standard, RBAC, exclusão lógica de 90 dias e proteção contra purge em prod (7 dias e sem proteção em dev) | `keyvault.bicep` | ambos |
| Storage | `stalvesting` | v2, LRS, Hot, sem chave de conta | `storage.bicep` | ambos |
| Container Registry | `cralvesting` | Basic, sem usuário admin | `acr.bicep` | padrão |
| Service Bus | `sb-alvesting` | Basic, sem chave (só identidade), 6 filas | `servicebus.bicep` | ambos |
| PostgreSQL | `psql-alvesting`, banco `alvesting` | Flexible, 17, B1ms, 32 GB, backup 7 dias, sem IP público | `postgres.bicep` | ambos |
| Communication Services Email | `acs-alvesting`, `acs-alvesting-email` | domínio gerenciado pela Azure | `email.bicep` | ambos |
| Azure OpenAI (opcional) | `oai-alvesting`, modelo `chat` | S0, `DataZoneStandard`, sem chave (só Entra) | `openai.bicep` | com `enableOpenAI` |
| Ambiente do Container Apps | `cae-alvesting` | Consumption, na `snet-apps`, ingress externo | `containerenv.bicep` | ambos |
| Front Door | `afd-alvesting`, endpoints `alvesting` (o site) e `alvesting-green` (o blue/green, seção 2.5), `wafalvesting` | Standard, 2 endpoints, 4 grupos de origem (`web`, `api`, `web-green`, `api-green`) | `frontdoor.bicep` | padrão |
| `ca-web` | `ca-web` | 0,25 vCPU / 0,5 GiB, 1→5 (0→5 no econômico), HTTP 50 | `containerapps.bicep` | ambos |
| `ca-api` | `ca-api` | 0,25 vCPU / 0,5 GiB, 1→5 (0→5 no econômico), HTTP 30 | `containerapps.bicep` | ambos |
| `ca-worker-data` | `ca-worker-data` | 0,5 vCPU / 1 GiB, 0→3, KEDA por fila | `containerapps.bicep` | ambos |
| `job-worker-decisions` | `job-worker-decisions` | 0,5 vCPU / 1 GiB, por evento, ≤ 10 execuções, 1500 s | `containerapps.bicep` | ambos |
| Agendadores | `job-sched-news`, `-briefing`, `-cycle`, `-eod`, `-universe`, `-retention`, `-backup` | 0,25 vCPU / 0,5 GiB, cron UTC | `containerapps.bicep` | ambos |
| Migrations | `job-migrate` | manual, 0,25 vCPU / 0,5 GiB | `containerapps.bicep` | ambos |
| Orçamento | `budget-alvesting` | mensal, alertas em 50, 80 e 100% | `budget.bicep` | ambos |
| Grupo de ações | `ag-alvesting` | e-mail (o do orçamento), esquema comum de alerta | `alerts.bicep` | ambos |
| Alertas de métrica | `alvesting-dlq-qualquer-fila`, `alvesting-decisions-fila-parada`, `alvesting-banco-cpu`, `alvesting-banco-disco`, e no padrão `alvesting-front-door-origem-doente` e `alvesting-front-door-5xx` | Service Bus, PostgreSQL e Front Door; a cada 1 min, janela de 5 min (15 min na `decisions-fila-parada`) | `alerts.bicep` | 4 no econômico, 6 no padrão |
| Alerta de log | `alvesting-sinais-da-aplicacao` | uma regra, onze sinais (dimensão `sinal`); a cada 5 min, janela de 15 min | `alerts.bicep` | ambos |

Os nomes são os do §5.3 do plano. Os que precisam ser únicos no mundo (`kv-`, `st`, `cr`, `sb-`, `psql-`, `oai-`, `acs-`)
levam o sufixo do parâmetro `nameSuffix`: vazio em prod, `-dev` em dev. Se a Azure disser que um nome já existe, troque o sufixo.

### 1.3 Os dois perfis

| | Padrão (`profile = 'padrao'`) | Econômico (`profile = 'economico'`) |
|---|---|---|
| Borda | Front Door Standard + WAF + cache de estáticos | Nenhuma: o ingress do Container Apps (Envoy sobre o Azure LB) balanceia |
| Mesmo domínio para web e api | Sim, pelo Front Door (sem CORS, cookie primário) | Não: `ca-web` e `ca-api` têm hosts próprios; a api libera por CORS só a origem da web |
| Registro de imagens | ACR (`cralvesting`), pull por identidade | GHCR (`ghcr.io/<dono>/alvesting-*`); o pacote precisa ser público |
| `ca-web` e `ca-api` | mínimo 1, máximo 5 | mínimo 0, máximo 5 |
| Trava de origem | `FRONT_DOOR_ID` e `ORIGIN_LOCK=front-door` em web e api (seção 3.3) | Não existe |
| Custo (plano §5.12) | ≈ US$ 72–83 por mês | ≈ US$ 5–10 por mês |

Trocar de perfil num ambiente que já existe: seção 8.1.

---

## 2. Configuração detalhada

### 2.1 Parâmetros do `main.bicep`

Uma linha por parâmetro em `main.dev.bicepparam` e `main.prod.bicepparam` (o `check.mjs` depende disso). Dá para trocar
qualquer um na linha de comando, **num único `--parameters`**, com o arquivo primeiro e os `chave=valor` depois (a
documentação do Azure CLI diz que, com um `.bicepparam`, esse argumento só pode aparecer uma vez):
`--parameters infra/main.prod.bicepparam deployApps=false`. Onde esta documentação diz "`--parameters x=y`", é um `chave=valor`
a acrescentar nesse mesmo argumento.

| Parâmetro | Padrão | O que faz |
|---|---|---|
| `profile` | (obrigatório) | `padrao` ou `economico` |
| `nameSuffix` | `''` (prod), `-dev` (dev) | Sufixo dos nomes únicos no mundo |
| `deployApps` | `true` | `false` na fase 1: cria tudo menos os apps (seção 6) |
| `writeDerivedSecrets` | `false` | Grava os segredos derivados. **Só liga** na fase 1 e nos casos da seção 6.1: regravar o mesmo valor cria uma versão nova no Key Vault e o Container Apps reinicia as revisões que o referenciam. Sem valor padrão no Bicep: cada `.bicepparam` o declara |
| `deployBudget` | `false` | Cria o orçamento. **Só liga** na fase 1 e para mudar o valor (seção 6.1): a Azure recusa regravá-lo em outro mês com a data antiga. Sem valor padrão no Bicep |
| `purgeProtection` | `true` (prod), `false` (dev) | Proteção contra purge do Key Vault. **Irreversível** depois de ligada. Sem valor padrão no Bicep |
| `softDeleteRetentionDays` | `90` (prod), `7` (dev) | Dias de exclusão lógica do Key Vault (7 a 90). **Não muda depois que o cofre existe.** Sem valor padrão no Bicep |
| `apiImageTag`, `webImageTag` | `ALVESTING_API_TAG`, `ALVESTING_WEB_TAG` | Tag das imagens `alvesting-api` e `alvesting-web`: o **SHA do commit** que o pipeline publicou. **Sem valor padrão** (nada de `latest`, que muda debaixo dos pés): do ambiente, e não vazia, mas só na fase 2. Como repetir a que está no ar: seção 7.3 |
| `promptArenaVersion` | `ALVESTING_PROMPT_ARENA_VERSION` | Versão do segredo `prompt-arena` no Key Vault (32 hexadecimais) que o job de decisões lê; vai também em `PROMPT_ARENA_VERSION`. Do ambiente, exatamente 32 caracteres, mas só na fase 2. Como obter: passo 4 |
| `legalControllerName`, `legalContactEmail` | `ALVESTING_LEGAL_CONTROLLER_NAME`, `ALVESTING_LEGAL_CONTACT_EMAIL` | O controlador dos dados pessoais e o canal de contato da política de privacidade (LGPD, art. 9; `docs/CONTA.md`). **Nunca no repositório**: do ambiente, não vazios e só na fase 2 (a api **recusa subir** em produção sem eles). Viram `LEGAL_CONTROLLER_NAME` e `LEGAL_CONTACT_EMAIL`, só na api |
| `googleClientId` | `ALVESTING_GOOGLE_CLIENT_ID` | O client ID do cliente OAuth do Google (não é segredo; o secret é o `google-oauth-client-secret`, seção 2.6). **Opcional**: vazio = o login por Google não existe e nada quebra. Vira `GOOGLE_CLIENT_ID`, só na api, e só se não for vazio |
| `ghcrOwner` | `zanelladev` | Dono no GHCR; só vale no econômico |
| `postgresAdminPassword` | `ALVESTING_PG_ADMIN_PASSWORD` | Senha do administrador do Postgres. Do ambiente, nunca de arquivo |
| `postgresApiPassword` | `ALVESTING_PG_API_PASSWORD` | Senha do login de menor privilégio da api no Postgres (`alvesting_api`, ADR 0028), **pelo menos 32 caracteres**. Do ambiente, nunca de arquivo. Vai para o segredo `database-url-api`; quem a aplica no banco é o `db:roles` do `job-migrate` (seção 2.2). Gere com `openssl rand -base64 48 \| tr -d '/+=' \| cut -c1-40` |
| `adminPrincipalId` | `ALVESTING_ADMIN_PRINCIPAL_ID` | Quem semeia segredos: recebe Key Vault Secrets Officer. Vazio = não atribui |
| `budgetAlertEmail` | `ALVESTING_BUDGET_EMAIL` | E-mail do orçamento (50, 80 e 100%) e dos alertas de operação (grupo de ações `ag-alvesting`, seção 5) |
| `budgetAmount` | 100 (prod), 20 (dev) | Orçamento mensal, na moeda da assinatura |
| `budgetStartDate` | `2026-11-01` | Primeiro dia de um mês; só vale com `deployBudget`. **Fixo**: um valor calculado quebraria o what-if. A Azure aceita o mês corrente (data passada dentro do mês) ou um dos 12 meses seguintes; fora disso, passe o primeiro dia do mês corrente na linha de comando |
| `enableOpenAI` | `false` | Liga o Azure OpenAI (seção 8.3) |
| `openaiModelName`, `openaiModelVersion`, `openaiCapacity` | `gpt-4.1-mini`, `2025-04-14`, 10 | Modelo do chat. **Confirme o catálogo e a cota antes de ligar** |
| `customDomain` | `''` | Domínio próprio no Front Door (seção 8.4) |
| `wafRateLimitPerMinute` | 600 | Requisições por IP e por minuto antes do WAF bloquear (o login, `/api/auth/*`, tem limite próprio de 30 por minuto, fixo no módulo) |
| `location` | a do resource group | East US 2 |

As dez entradas de ambiente (`ALVESTING_PG_ADMIN_PASSWORD`, `ALVESTING_PG_API_PASSWORD`, `ALVESTING_BUDGET_EMAIL`,
`ALVESTING_ADMIN_PRINCIPAL_ID`, `ALVESTING_API_TAG`, `ALVESTING_WEB_TAG`, `ALVESTING_PROMPT_ARENA_VERSION`,
`ALVESTING_LEGAL_CONTROLLER_NAME`, `ALVESTING_LEGAL_CONTACT_EMAIL` e `ALVESTING_GOOGLE_CLIENT_ID`) são lidas pelos arquivos
`.bicepparam` com `readEnvironmentVariable` e valem `''` quando faltam. Assim `az bicep build-params` compila sem elas, e o deploy para
cedo, **no módulo que precisa delas**: as duas senhas do Postgres são `@secure` e têm trava de tamanho no módulo do banco
(`@minLength(16)` a do administrador e `@minLength(32)` a do login da api, a trava tardia: faltou, o deploy para antes de criar o servidor
ou de gravar o segredo; as duas são exigidas em toda execução, como o `check.mjs` prova), o e-mail (do orçamento e dos alertas)
`@minLength(3)` no módulo dos alertas, que existe desde a fase 1, e as tags de imagem (`@minLength(1)`), a versão do prompt (exatamente 32), o controlador e o contato da
privacidade (`@minLength(1)`) ficam no módulo dos apps. Por isso a fase 1, que não tem imagem, prompt nem conta, passa sem
essas cinco (o e-mail dos alertas é exigido sempre). O client ID do Google é opcional em todas as fases. As passadas na linha de comando
(`--parameters ... apiImageTag=<sha>`) vencem as do ambiente.

**Os `.bicepparam` são o regime de rotina** (`deployApps=true`, `writeDerivedSecrets=false`, `deployBudget=false`): é o que o
what-if da segunda execução e o CI usam, sem nenhum `--parameters` extra. O primeiro deploy sobrescreve três deles na linha de
comando (seção 6). O `check.mjs` prova que a rotina é o primeiro deploy menos exatamente os segredos derivados e o orçamento.

### 2.2 PostgreSQL (§5.3 e §5.6)

- Flexible Server 17, `Standard_B1ms` (Burstable), 32 GB, backup (PITR) de 7 dias, sem alta disponibilidade.
- **Sem acesso público**: `publicNetworkAccess: Disabled`, sub-rede delegada (`snet-postgres`) e zona DNS privada ligada à
  VNet. Não existe regra de firewall.
- **Dois logins** (etapa 10, onda 3d; ADR 0028). O login administrador (`alvesting`, dono das tabelas) serve as migrations, os workers, as decisões e os agendadores; o `database-url` (segredo derivado,
  seção 2.6) usa `sslmode=require`. **A api tem login próprio, de menor privilégio** (`alvesting_api`, membro de um papel de grupo sem login, `alvesting_api_group`): a migration `20261103100000_api_role` dá ao grupo só o que a
  api usa, tabela por tabela (matriz em `apps/api/src/infrastructure/database/table-policy.ts`), e o banco recusa o resto: DDL, remover o gatilho do aceite, o `UPDATE` e o `DELETE` direto em `consent`, o `DELETE`
  em `audit_log`, qualquer escrita nas tabelas de resultado da arena e o `SET ROLE` para o administrador. O login e a senha não estão na migration: o comando `pnpm --filter @alvesting/api db:roles` (`node dist/db-roles-cli.js`,
  idempotente, com o login administrador, depois do `migrate deploy`) lê a senha da `API_DATABASE_URL` e a grava como resumo SCRAM. O papel tem `statement_timeout` de 10 s (os workers: 60 s). Seção 2.7.
  **Na Azure (etapa 10, parte 4):** o Bicep grava dois segredos derivados, o `database-url` (administrador) e o **`database-url-api`** (`postgresql://alvesting_api:<senha>@<servidor>:5432/alvesting?sslmode=require`, com a
  senha de `ALVESTING_PG_API_PASSWORD`, `@secure` e `@minLength(32)` no módulo do banco). O `ca-api` usa o `database-url-api` **no `DATABASE_URL`** e não referencia mais o do administrador; o `job-migrate`, o único que lê
  os dois, roda `sh -c 'migrate deploy && node dist/db-roles-cli.js'` (o `db:roles` só roda se a migration deu certo, e lê a senha do `API_DATABASE_URL`, que ali é o `database-url-api`). Só a `id-alvesting-api` e a
  `id-alvesting-migrate` leem o `database-url-api` (seção 3.2). **A api recusa subir em produção com outro usuário no `DATABASE_URL`** (`requireApiLogin`, `config/env.ts`): um segredo trocado por engano pelo do administrador
  não a põe de volta como dona das tabelas em silêncio, e o job `images` do CI prova a recusa na imagem. O `check.mjs` trava o `secretRef` do `DATABASE_URL` da api. **Ordem do primeiro deploy:** o login só existe no banco
  depois do `job-migrate` (passo 6 da seção 6); até lá o `ca-api` sobe (o `/health` não consulta o banco) mas as rotas que consultam falham com `password authentication failed`.
  A migration `20261103110000_api_role_least_privilege` aperta o papel depois da revisão: tira o `UPDATE` de `verification` (o Better Auth sem plugin só cria, procura e consome) e o `CREATE` do esquema `public` de PUBLIC
  (o PostgreSQL 15 em diante já não o dá; num servidor com o ACL antigo a api herdaria o `CREATE` e criaria tabela e função), e o `db:roles` **recusa** o login que ganhou atributo de administração, outro grupo ou `CREATE` no `public` por fora.
  **O que o login da api ainda pode (risco aceito, ADR 0028):** (a) gravar `user.role` (`INSERT`/`UPDATE` em `user`): criar ou promover um admin direto, porque a regra "o papel só muda pelo `account:promote`" vale na
  aplicação e não no banco; fechá-la pede um gatilho em `user.role` que só o login administrador passe; (b) travar uma tabela inteira (`LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` vale em toda tabela em que ele tem `UPDATE` ou
  `DELETE`: `user`, `session`, `account`, `verification`, `job_run`, `season`, `cycle`, `competitor`, `corporate_event` e, desde a etapa 12, `portfolio_lot`, o que travaria a carteira de todo mundo), o que é negação de serviço; (c) desfazer o próprio limite (`ALTER ROLE alvesting_api RESET statement_timeout`:
  papel comum altera os próprios padrões); (d) trocar a própria senha (`ALTER ROLE alvesting_api PASSWORD`: o papel comum a altera; as réplicas novas deixam de autenticar até o `db:roles` rodar de novo, e a volta é rodar o `job-migrate`, 8.2; o `password authentication failed`
  cai no alerta `api-5xx`); (e) escrever o que as rotas de admin escrevem, sem as rotas (criar e iniciar um rascunho, registrar um evento corporativo e publicar um `settle`, criar o ciclo de uma temporada em andamento; a regra "uma temporada em andamento por vez" é da rota, e não do banco); (f) segurar a trava consultiva da brapi (`pg_advisory_xact_lock(hashtextextended('brapi', 0))`, que não exige privilégio nenhum): a coleta de
  cotações pararia (o `eod` e a atualização semanal falham por tempo até a sessão cair), a mesma negação de serviço do item (b); não dá para revogar o `EXECUTE`, porque o gatilho `portfolio_lot_api_guard` e o início de temporada usam
  trava consultiva com este mesmo login (ADR 0032).
  Quem compromete a api já publica em todas as filas, então estes seis pesam pouco perto do que o desenho impede (DDL, o aceite reescrito, a trilha apagada, escrita no resultado da arena, o compromisso do prompt forjado e a temporada em andamento reescrita, abaixo).
  **O estado em que ela escreve também é do banco** (ADR 0028, item 10; migration `20261103120000_api_role_guards`, achada pela revisão de segurança do fechamento da parte 4): em `prompt_version` a api só tem `INSERT` de `id`, `version` e `created_at` (o SHA-256 do texto é do job de decisões;
  com a tabela inteira ela forjava o compromisso, e todo ciclo preso àquela versão ficava em HOLD `prompt_divergente` para sempre); quatro gatilhos `*_api_guard`, que valem **só para o login da api** (`session_user`), recusam com `42501` o que as rotas de admin recusam em código: `season` (a api cria em rascunho, edita e inicia só o rascunho),
  `competitor` (só o elenco do rascunho), `cycle` (cria aberto ou pulado numa temporada em andamento e reavalia só o pulado; data, temporada e prazo não mudam) e `job_run` (só reabre a `settle`). Em **produção** o login tem ainda `CONNECTION LIMIT 24` (5 réplicas × 4 conexões do pool, com folga, nas ~50 do B1ms): o papel comum não o tira,
  e uma api comprometida não esgota o servidor e deixa o worker, as decisões e os agendadores sem conexão (em dev e no e2e o login fica sem limite: os processos da api da máquina o dividem). O `db:roles` confere o limite junto com os atributos.
- **TLS obrigatório no servidor:** o parâmetro `require_secure_transport = on` é declarado no Bicep (não só herdado do padrão
  da Azure), então o servidor recusa conexão sem TLS mesmo que um cliente peça `sslmode=disable`.
- **Por que `sslmode=require` e não `verify-full`:** o driver `pg` trata `require` como `verify-full` hoje (e avisa que a próxima
  major o enfraquece: rever ao subir o `pg` para a 9). Mas o motor de migrations do Prisma, que roda o `job-migrate`, **ignora
  `verify-full` em silêncio** e conecta sem TLS (medido com o Prisma 7.10.1 contra o Postgres local: `verify-full`, `verify-ca`
  e até um valor inventado conectaram sem TLS; só `require` exigiu). Como o mesmo `database-url` serve os dois, `require` é o
  único modo estrito que ambos entendem. O `check.mjs` trava o valor. **O `pg_dump` e o `pg_restore` do `backup-verify`** (libpq) recebem esse `require` em `PGSSLMODE` e, ao contrário do driver `pg` do Node, só CIFRAM: não conferem o certificado nem o nome do servidor. O servidor
  está numa sub-rede privada, sem acesso público, e o administrador autentica por SCRAM, então o risco é baixo; o endurecimento (`PGSSLMODE=verify-full` e `PGSSLROOTCERT=system` no `toolEnv`, libpq 16 em diante) **não foi feito** porque a cadeia do certificado do Flexible Server contra o `ca-certificates` do Debian e o nome do servidor só se confirmam
  no primeiro `backup-verify` de verdade (seção 11), e um palpite errado derrubaria o backup mensal. O teste local usa o Postgres do Docker, sem TLS.
- **Conexões:** o B1ms tem poucas (na casa de 50). Com 5 réplicas de api, 3 de worker e até 10 execuções de decisão, o pool
  de cada processo precisa ser pequeno (3 ou 4 conexões). Isso é regra para os apps das etapas 3 a 6.

### 2.3 Container Apps (§5.3 e §6)

- **Ambiente** com perfil de carga Consumption, na `snet-apps` (delegada a `Microsoft.App/environments`), ingress externo,
  logs no Log Analytics.
- **`ca-web` e `ca-api`:** ingress externo com `allowInsecure: false`; probes de startup, readiness e liveness em
  `GET /health` (web na porta 3000, api na 8080, as mesmas do ingress; o `check.mjs` confere); escala por concorrência HTTP
  (web 50, api 30); modo de revisão `Multiple`. A api tem CORS no ingress só no econômico. Cada um usa a **própria identidade**
  (seção 3.2); a do `ca-web`, que é o único exposto rodando o Next, tem `lifecycle: None`.
- **`ca-worker-data`:** sem ingress, 0 a 3 réplicas, **uma regra KEDA `azure-servicebus` por fila** (`market`, `news`,
  `briefing`, `settlement`, `maintenance`), com `messageCount: 5` por réplica, autenticada pela **identidade do KEDA**
  (`id-alvesting-scale`, campo `identity` da regra, sem `auth` e sem segredo) e apontando para o namespace do Service Bus
  (`namespace`, que o `check.mjs` compara com o namespace criado). A primeira mensagem já acorda o worker. Ao parar (SIGTERM),
  o worker espera os handlers em curso até 270 s antes de fechar os receivers (o `eod` com a brapi leva até 4 min), então o
  template define `terminationGracePeriodSeconds: 300`; o padrão da plataforma é 30 s e o SIGKILL chegaria no meio do `eod`
  (páginas da Microsoft Learn conferidas em 01/11/2026, sem copiar nada: "Application lifecycle management in Azure Container
  Apps", que diz "If your application doesn't respond within 30 seconds to the SIGTERM message, then SIGKILL terminates your
  container", e a referência de `Microsoft.App/containerApps`, onde `template.terminationGracePeriodSeconds` "Defaults to 30
  seconds"). Não verificado na Azure: o deploy aceitar o valor.
- **`job-worker-decisions`:** por evento na fila `decisions`, uma execução por mensagem, **até 10 ao mesmo tempo**, timeout de
  1500 s. O "paralelismo 10" do plano é `scale.maxExecutions: 10`; dentro de cada execução `parallelism` e
  `replicaCompletionCount` são 1, porque a Microsoft define `parallelism` como o número de réplicas **por execução**.
  Um modelo lento não atrasa os outros. Sem retry da réplica: quando o handler falha, o código agenda uma cópia da mensagem
  para daqui a 10 e 20 minutos e conclui a original, e depois da última tentativa (3) a mensagem vai para a DLQ (ADR 0015).
  É o único workload com `PROMPT_ARENA` e a chave do OpenRouter.
- **`job-sched-*`:** os 7 agendadores, com os crons em UTC do §6, rodam `node dist/schedule.js <nome>` (timeout 300 s, 2
  retentativas; a publicação é idempotente). Dividem a identidade `id-alvesting-sched`. Tabela completa em `docs/JOBS.md`.
- **`job-migrate`:** manual (`az containerapp job start`), roda `sh -c 'node node_modules/prisma/build/index.js migrate deploy && node
  dist/db-roles-cli.js'`: as migrations e, só se deram certo, o login de menor privilégio da api no banco (seção 2.2; os dois são idempotentes). Lê o
  `database-url` (o administrador, que migra e cria o login) e o `database-url-api` (de onde o `db:roles` tira só a senha), e a identidade dele
  (`id-alvesting-migrate`) é só da plataforma (`lifecycle: None`).
- **Uma imagem da api para todos os papéis do back** (`alvesting-api`); cada papel só muda o comando. A web tem a própria imagem.

### 2.4 Service Bus (§5.5)

Namespace Basic com `disableLocalAuth: true` (só identidade). **O acesso é por fila, no escopo da própria fila e nunca do namespace** (etapa 10,
parte 4; ADR 0030; Learn, "Authenticate and authorize an application with Microsoft Entra ID to access Azure Service Bus entities": o escopo do
papel pode ser o namespace ou a fila; a página não fala da DLQ, e que o papel da fila **cubra também a DLQ dela** é inferência, não confirmada: seção 11). Cada identidade só nas filas que o código dela usa, no papel que ele usa (a matriz inteira está na
seção 3.2): Sender e Receiver para a `id-alvesting-api` nas seis (o admin lê e reenvia a DLQ de qualquer uma), para a `id-alvesting-worker` nas cinco que
consome e para a `id-alvesting-decisions` só na `decisions`; só Sender para os agendadores (`id-alvesting-sched`), em cinco; Data Owner para a
`id-alvesting-scale` (o KEDA), que o código não usa, em cada uma das seis. O web e o migrate não falam com o Service Bus. Seis filas, todas com
dead-letter na expiração, lock de 1 minuto e TTL de 1 dia:

| Fila | Entregas máximas |
|---|---|
| `market` | 10 |
| `news` | 5 |
| `briefing` | 5 |
| `decisions` | 3 |
| `settlement` | 5 |
| `maintenance` | 3 |

Os mesmos números estão em `packages/contracts` e em `docker/servicebus/Config.json` (emulador).

### 2.5 Front Door (§5.4), só no padrão

- **Perfil** `afd-alvesting` (Standard_AzureFrontDoor) e **dois endpoints**: `alvesting` (o site; host `alvesting-<hash>.z01.azurefd.net`) e
  `alvesting-green` (o blue/green, abaixo; host `alvesting-green-<hash>.z01.azurefd.net`).
- **O endpoint green (etapa 10, parte 4; ADR 0029).** Dois grupos de origem a mais, `web-green` e `api-green`, com a origem no endereço do **label `green`**
  de cada app (`ca-web---green.<domínio do ambiente>` e `ca-api---green.<domínio do ambiente>`; o FQDN do label é `<app>---<label>.<domínio>`, três hífens: Learn,
  "Blue-green deployment in Azure Container Apps"), o mesmo probe `GET /health` a cada 30 s e `enforceCertificateNameCheck` (o certificado do ambiente é um
  curinga `*.<domínio>`). Duas rotas **sem cache** no endpoint green: `/api/*` para o `api-green` e `/*` para o `web-green`. O endpoint green **passa pelo mesmo WAF**
  (está nos domínios da política de segurança: `BlockInterno` e os limites de taxa valem) **e pela mesma trava de origem** (o `X-Azure-FDID` é o do perfil, o
  mesmo dos dois endpoints), e é por ele que o deploy prova a revisão nova antes de ela receber tráfego (`docs/DEPLOY.md`). **Sem custo novo:** no Standard a taxa é por perfil
  (US$ 35 ao mês), as rotas e as regras próprias do WAF são grátis, e endpoint, grupo de origem e origem não têm tarifa (Learn, "Compare pricing between Azure Front Door
  tiers", 25/09/2025; limites do Standard: 10 endpoints, 100 rotas e 100 grupos de origem por perfil, bem acima do que existe). Não usa o domínio próprio (só o deploy o visita).
  O host do green sai na saída `greenSiteUrl` e vira a variável `SITE_GREEN_URL` do repositório. O label fica na revisão que está no ar quando nenhum deploy corre
  (o `cleanup` não o tira), então as origens verdes ficam saudáveis; num deploy que falha o `rollback` tira o label da revisão nova e as origens verdes ficam doentes até o próximo deploy bom (e antes do primeiro, que dá o primeiro label), por isso o alerta de origem doente olha
  só os grupos `web` e `api` (seção 5.3).
- **Grupos de origem** `web` e `api`, cada um com uma origem: `ca-web.<domínio do ambiente>` e `ca-api.<domínio do ambiente>`
  (o domínio é previsível, por isso o Front Door nasce antes dos apps). Probe `GET /health` por HTTPS a cada 30 s.
- **Rotas do site** (quatro, no endpoint `alvesting`): `/api/*` para o grupo `api`, **sem cache** (login, conta, admin, chat, health e Swagger); `api-public` para o
  grupo `api`, **com cache**: só as GET públicas do §9 (`/api/v1/arena/current`, `/api/v1/seasons` e `/api/v1/seasons/*`,
  `/api/v1/competitors/*`, `/api/v1/cycles/*`, `/api/v1/decisions`, `/api/v1/news`, `/api/v1/stocks` e `/api/v1/stocks/*`), respeitando o
  `Cache-Control` da origem (a API manda `public, s-maxage=300`) e com a **query string na chave**; `/_next/static/*` para o `web`, **com cache**
  (respeita o `Cache-Control` imutável do Next); `/*` para o `web`, **sem cache** (o HTML não é guardado na borda). HTTPS obrigatório,
  encaminhamento só por HTTPS. Por que rota própria e não `/api/*` com cache: a documentação do Front Door (Learn, "Caching with Azure Front
  Door", lida em 01/11/2026) manda separar o estático do dinâmico e avisa que a resposta **sem `Cache-Control` é guardada por 1 a 3 dias**;
  por isso a API manda `no-store` em tudo o que não declara cache (erro inclusive), e nenhum rule set sobrescreve o tempo de vida. O curinga do
  padrão só vale no fim e depois de uma barra, e o padrão sem curinga é exato (Learn, "How requests get matched to a route configuration"):
  por isso `/api/v1/seasons` e `/api/v1/seasons/*` são dois padrões. Rota mais específica vence. `infra/tests/check.mjs` confere a lista
  contra a do plano e que login, conta, admin, chat, health e Swagger não casam nenhum padrão da rota com cache. Mais em `docs/API.md`, seção 2.
- **WAF** `wafalvesting` (Prevention, só regras próprias, que é o que o Standard permite), ligado aos dois endpoints (e ao domínio próprio, se houver) por uma política
  de segurança, com a regra `BlockInterno` (prioridade 10: bloqueia toda URL que contém `/interno/`, sem diferença de caixa e decodificada;
  é a rota do worker, que chama o ingress do `ca-web` direto, e a rota interna de cotações da api, que o site lê pelo ingress do `ca-api`
  (`/api/v1/interno/barras/:ticker`, seção 3.3 e `docs/API.md`, seção 6): nada legítimo as pede pelo Front Door) e duas regras de rate limit por IP
  (a contagem é por `SocketAddr`, o IP que o WAF vê):
  `RateLimitPorIp`, 600 por minuto (`wafRateLimitPerMinute`) em toda requisição, e `RateLimitAuth`, 30 por minuto em
  `/api/auth/*` (login e cadastro do Better Auth, contra credential stuffing; a URL é comparada sem diferença de caixa e
  decodificada, para `%61` e maiúscula não driblarem). **A condição casa a URL (`RequestUri` contém `/`), nunca `RemoteAddr`:**
  ele é o IP lido do `X-Forwarded-For`, que o atacante escreve. Com a condição do quickstart ("`RemoteAddr` fora de
  192.0.2.0/24"), mandar `X-Forwarded-For: 192.0.2.1` tirava a requisição da regra e do limite. O `check.mjs` proíbe `RemoteAddr`.
  O limite de 30 vale para todo `/api/auth/`, inclusive `get-session`; quem está atrás do mesmo NAT divide o limite (nota no módulo).
- **Trava de origem:** o ID do perfil (`X-Azure-FDID`) vai para o segredo `front-door-id` e para `FRONT_DOOR_ID` de web e api,
  junto com `ORIGIN_LOCK=front-door` (contrato fail closed da seção 3.3).
- **Purge:** papel próprio com a única ação `Microsoft.Cdn/profiles/afdEndpoints/purge/action`, atribuído só à
  `id-alvesting-worker` (quem liquida e limpa o cache) no escopo do perfil. O worker recebe `FRONT_DOOR_ENDPOINT_ID` e, depois de cada
  liquidação, chama `POST {FRONT_DOOR_ENDPOINT_ID}/purge?api-version=2025-06-01` na ARM REST com `{"contentPaths":["/api/v1/*"]}` (200 ou 202;
  `docs/JOBS.md`, 4.2). Fonte da operação e do corpo: a especificação oficial da Azure
  (`Azure/azure-rest-api-specs`, `specification/cdn/resource-manager/Microsoft.Cdn/Cdn/stable/2025-06-01/openapi.json`, `AFDEndpoints_PurgeContent`,
  `contentPaths` obrigatório e `domains` opcional), conferida em 01/11/2026; a mesma api-version dos recursos do Bicep. O Front Door leva até
  10 minutos para propagar o purge e ele vale para toda variação de query string (Learn, "Purge cache in Azure Front Door"). Não verificado
  na Azure: a chamada real (só com fakes) e o papel aceitar essa ação no endpoint.
- **Log do WAF:** o `FrontDoorWebApplicationFirewallLog` vai ao Log Analytics (`log-alvesting`) por um diagnostic setting no
  perfil: sem ele um ataque só deixa rastro no 403/429 que o cliente recebeu. **O log carrega o IP do cliente (dado pessoal)
  e o `requestUri`, a URL completa com a query string** (a Microsoft documenta o campo como "Full URI of the request", na
  página "Monitoring and Logging - Azure Web Application Firewall", conferida em 01/11/2026): um pedido bloqueado em
  `/api/auth/` leva consigo o `?code=` do OAuth ou o `?token=` da verificação de e-mail. É uma exceção consciente à regra de logs do `CLAUDE.md` (query string e IP fora do
  log), que vale para o log da aplicação e não alcança o da plataforma. Fica 90 dias (a retenção do workspace). O Bicep não
  atribui papel de leitura do workspace a ninguém (o `check.mjs` afirma a lista inteira de atribuições): lê quem já tem
  acesso ao resource group, o Owner e a identidade do CI (Contributor, `docs/DEPLOY.md`). Não conceda Log Analytics Reader a
  mais ninguém, e a política de privacidade cita o IP e a URL nos logs de segurança e o prazo (feito na etapa 11: item "Segurança" e item 5 do texto, versão 0.1, em rascunho). O log de
  acesso (`FrontDoorAccessLog`, uma linha por requisição) fica de fora: estoura os 5 GB gratuitos. A API de
  `diagnosticSettings` é preview (seção 10).

### 2.6 Segredos

**Derivados** (o Bicep cria, porque o valor só existe depois que o recurso nasce):

| Segredo | Quem cria | Variável do app |
|---|---|---|
| `database-url` | `postgres.bicep` | `DATABASE_URL` (o login **administrador**: worker, decisões, agendadores e migrate) |
| `database-url-api` | `postgres.bicep` | `DATABASE_URL` do `ca-api` e `API_DATABASE_URL` do `job-migrate` (o login de **menor privilégio** `alvesting_api`, ADR 0028) |
| `front-door-id` | `frontdoor.bicep` (padrão) | `FRONT_DOOR_ID` |
| `acs-connection-string` | `email.bicep` | `ACS_CONNECTION_STRING` |
| `appinsights-connection-string` | `observability.bicep` | `APPLICATIONINSIGHTS_CONNECTION_STRING` |

Eles só são gravados com `writeDerivedSecrets=true` (fase 1 e os casos da seção 6.1). Nas demais execuções o Bicep nem declara
esses segredos: regravar o mesmo valor cria uma versão nova no Key Vault, e o Container Apps reinicia as revisões que o
referenciam (uma queda curta de `ca-web` e `ca-api`, que têm mínimo de 1 réplica). **Não existe `azure-openai-key`**: o Azure
OpenAI não tem chave (`disableLocalAuth`), o chat entra por identidade (seção 8.3).

**Do Artur** (nenhum é criado pelo Bicep; `infra/scripts/seed-secrets.sh` semeia uma vez):

| Segredo | Valor | Variável do app |
|---|---|---|
| `better-auth-secret` | gerado ao acaso | `BETTER_AUTH_SECRET` (api) |
| `revalidate-secret` | gerado ao acaso | `REVALIDATE_SECRET` (web e worker) |
| `quotes-secret` | gerado ao acaso (384 bits) | `QUOTES_SECRET` (web e api): o segredo da rota interna de cotações (`docs/API.md`, seção 6; ADR 0033) |
| `openrouter-api-key` | chave do OpenRouter | `OPENROUTER_API_KEY` (decisões) |
| `google-oauth-client-secret` | secret do cliente OAuth | `GOOGLE_CLIENT_SECRET` (api) |
| `brapi-token` | token da brapi | `BRAPI_TOKEN` (worker) |
| `prompt-arena` | texto do prompt da arena, só de arquivo | `PROMPT_ARENA` (decisões), numa **versão fixa**; a versão vai em `PROMPT_ARENA_VERSION` |
| `prompt-chat` | texto do prompt do chat, só de arquivo | `PROMPT_CHAT` (api, só com `enableOpenAI`) |

Os que ainda não existem (OpenRouter, Google, brapi) ficam com o valor `PENDENTE` e a tag `pendente=true`, para o Container
App subir. Rodar o script de novo troca o valor quando ele chegar. Os prompts nunca recebem valor provisório. O banco guarda só
o SHA-256 e a versão do segredo (§5.7). **O `prompt-arena` precisa existir antes da fase 2** (o job de decisões o referencia e o
Container Apps não cria o job sem o segredo); o `prompt-chat` só antes de ligar o chat (`enableOpenAI`, seção 8.3). Cada prompt
tem no máximo 25 KB (teto de um segredo do Key Vault).

Os apps leem os segredos **por referência ao Key Vault** (`keyVaultUrl` + identidade): nenhum valor no template, na imagem ou
no GitHub. Sem versão no URI, o Container Apps pega a mais recente em até 30 minutos e reinicia as revisões ativas; com a
versão no URI (só o `prompt-arena`) o conteúdo fica fixo e só muda por um deploy. **Cada workload referencia só os segredos
dele e só esses a identidade dele consegue ler** (papel no escopo do segredo, seção 3.2): o `ca-web` lê quatro
(`appinsights-connection-string`, `revalidate-secret`, `quotes-secret` e, no padrão, `front-door-id`); o prompt da arena e a chave do OpenRouter
só o job de decisões; o prompt do chat só a api; o token da brapi só o worker; o `quotes-secret` só o site, que o manda, e a api, que o confere;
o banco só quem consulta.

**Por que o prompt é variável de ambiente e não leitura pelo SDK do Key Vault.** O código lê `process.env.PROMPT_ARENA`, sem
`@azure/keyvault-secrets`, e o ADR 0011 continua valendo: ele descartava o prompt em texto puro no template, e aqui o valor só
existe no Key Vault (o template leva a referência). A versão fixa no URI faz o texto ser o mesmo em toda execução do job até o
próximo deploy, e o `PROMPT_ARENA_VERSION` (32 hexadecimais, não é segredo) é o que o código grava em `prompt_version`, ao lado do
SHA-256 do texto que recebeu. Trocar o prompt é uma versão nova no cofre, a variável `ALVESTING_PROMPT_ARENA_VERSION` e o
deploy da fase 2, e o what-if mostra a mudança.

### 2.7 Variáveis de ambiente dos apps (o contrato)

Tudo o que o Bicep injeta em cada workload, e só isso: o `check.mjs` lê esta tabela e a compara com o template compilado,
variável por variável (o que falta, o que sobra, a origem e a coluna "Quando"). As etapas 4 a 7 e 13 leem daqui o que podem
esperar do ambiente. Os workloads são `ca-web`, `ca-api`, `ca-worker-data`, `job-worker-decisions`, o `job-migrate` e os
sete agendadores (`job-sched-news`, `-briefing`, `-cycle`, `-eod`, `-universe`, `-retention` e `-backup`), que recebem
exatamente o mesmo e aparecem juntos como `job-sched-*`. **Exceção da etapa 6:** o `job-sched-cycle` recebe, além disso, a versão
do prompt (`PROMPT_ARENA_VERSION`) e o teto de custo do mês (`ARENA_MONTHLY_COST_CAP_USD`), em texto puro, e aparece à parte nessas
duas linhas. Ele continua sem o segredo do prompt e sem a chave do OpenRouter. **Exceção da etapa 10 (parte 2):** a `ca-api` recebe as
mesmas duas variáveis (as rotas `/admin` reprocessam o ciclo e comparam o gasto do mês com o teto), e continua sem o texto do prompt e
sem a chave do OpenRouter.

Em texto puro (origem "valor") entram só endereços e flags (o `check.mjs` tem a lista fechada); segredo é sempre `secretRef` de
um segredo do Key Vault (origem "segredo"), que o workload só recebe se a identidade dele o lê (seção 3.2). "Quando":
`sempre`, só no perfil `padrão` (Front Door) ou só com `enableOpenAI`.

| Variável | Workloads | Origem | Quando | Para quê |
|---|---|---|---|---|
| `NODE_ENV` | `ca-web`, `ca-api`, `ca-worker-data`, `job-worker-decisions`, `job-sched-*`, `job-migrate` | valor: `production` | sempre | Modo de produção (o `env.ts` da api e o Next) |
| `LOG_LEVEL` | `ca-api`, `ca-worker-data`, `job-worker-decisions`, `job-sched-*` | valor: `info` | sempre | Nível do Pino |
| `AZURE_CLIENT_ID` | `ca-api`, `ca-worker-data`, `job-worker-decisions`, `job-sched-*` | valor: client ID da identidade do próprio workload (`id-alvesting-api`, `-worker`, `-decisions` ou `-sched`, seção 3.2) | sempre | O `DefaultAzureCredential` com identidade atribuída pelo usuário precisa dele para saber qual token pedir; o worker e as decisões carregam também a do KEDA, que o código não usa. O web e o migrate não recebem: a identidade deles é só da plataforma |
| `KEY_VAULT_URL` | `ca-api`, `ca-worker-data`, `job-worker-decisions`, `job-sched-*` | valor: `https://kv-alvesting.vault.azure.net/` | sempre | Endereço do cofre. Nenhum workload lê o cofre pelo SDK hoje (os segredos chegam por referência); quem ler só alcança os segredos em que a identidade dele tem papel |
| `SERVICEBUS_FQDN` | `ca-api`, `ca-worker-data`, `job-worker-decisions`, `job-sched-*` | valor: `sb-alvesting.servicebus.windows.net` | sempre | Namespace do Service Bus **por identidade, sem connection string**: `new ServiceBusClient(fqdn, new DefaultAzureCredential())`. A api, o worker e as decisões publicam e consomem; os agendadores só publicam |
| `STORAGE_BLOB_ENDPOINT` | `ca-api`, `ca-worker-data`, `job-worker-decisions`, `job-sched-*` | valor: `https://stalvesting.blob.core.windows.net/` | sempre | Endpoint do Blob **por identidade, sem chave de conta**: `new BlobServiceClient(endpoint, new DefaultAzureCredential())`. Só o worker e as decisões têm papel de Blob, e cada um **só nos containers que usa** (seção 3.2); a api e os agendadores recebem o endereço e levariam 403 |
| `DATABASE_URL` | `ca-worker-data`, `job-worker-decisions`, `job-sched-*`, `job-migrate` | segredo `database-url` | sempre | Postgres privado com o login **administrador**, `sslmode=require` (seção 2.2), pool de 3 a 4 conexões por processo. O `ca-web` não consulta o banco |
| `DATABASE_URL` | `ca-api` | segredo `database-url-api` | sempre | O login de **menor privilégio** da api (`alvesting_api`, ADR 0028), `sslmode=require`, pool de 3 a 4 conexões. Em produção a api **recusa subir** com outro usuário aqui (`requireApiLogin`): o segredo do administrador não pode ocupar o lugar dele em silêncio |
| `API_DATABASE_URL` | `job-migrate` | segredo `database-url-api` | sempre | De onde o `db:roles` (rodado depois do `migrate deploy`, no mesmo job) tira a **senha** do login da api e o nome do usuário (tem de ser `alvesting_api`); quem cria o login é o `DATABASE_URL` do administrador |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `ca-web`, `ca-api`, `ca-worker-data`, `job-worker-decisions`, `job-sched-*` | segredo `appinsights-connection-string` | sempre | Liga o OpenTelemetry da api (seção 5.1). Só a api, o worker, as decisões e os agendadores a usam: o gancho `dist/telemetry/preload.js` (carregado pelo `NODE_OPTIONS` da imagem, seção 2.8) só liga com ela e só nesses quatro papéis; sem ela nada é exportado nem pedido à rede. O `ca-web` a recebe pelo contrato e não a usa (o site fica fora da telemetria, 5.1) |
| `API_PORT` | `ca-api` | valor: `8080` | sempre | Porta do ingress e dos probes |
| `PORT`, `HOSTNAME` | `ca-web` | valor: `3000` e `0.0.0.0` | sempre | Porta e interface do `server.js` standalone do Next |
| `PUBLIC_URL` | `ca-web`, `ca-api` | valor: URL pública do site (domínio próprio, host do Front Door ou host do `ca-web`) | sempre | URL pública do site, para montar links absolutos |
| `API_INTERNAL_URL` | `ca-web` | valor: `https://ca-api.<domínio do ambiente>` | sempre | O SSR da web lê a API pública direto pelo ingress (`apps/web/src/lib/api.ts`, `docs/API.md`), mandando o `X-Azure-FDID` com o próprio `FRONT_DOOR_ID` (seção 3.3) |
| `WEB_INTERNAL_URL` | `ca-worker-data` | valor: `https://ca-web.<domínio do ambiente>` | sempre | O worker pede a revalidação ao site depois da liquidação (`POST /interno/revalidar`, `docs/JOBS.md`, 4.2), com o `REVALIDATE_SECRET`. Em produção o worker só aceita `https` (ou o loopback), porque o Bearer vai nesse endereço; a chamada não segue redirecionamento |
| `REVALIDATE_SECRET` | `ca-web`, `ca-worker-data` | segredo `revalidate-secret` | sempre | Autentica a revalidação do worker para o site (`Authorization: Bearer`, comparado em tempo constante; o `proxy.ts` do site deixa passar só `POST /interno/revalidar` com ele, seção 3.3). **Pelo menos 32 caracteres**: o worker recusa subir com um mais curto, e o site trata o curto como ausente. Sem ele a rota responde 503 |
| `QUOTES_SECRET` | `ca-web`, `ca-api` | segredo `quotes-secret` | sempre | O segredo da rota interna de cotações: a API pública não entrega a barra de preço (a licença da brapi proíbe entregar os Dados como feed, API ou base bruta), então o site lê as barras de `GET /api/v1/interno/barras/:ticker` pelo `API_INTERNAL_URL`, com `Authorization: Bearer <segredo>` (`apps/web/src/lib/quotes.ts`, módulo só do servidor: a variável não tem `NEXT_PUBLIC_`). A api o confere em tempo constante e responde 404, igual ao da rota que não existe, a quem não o traz; sem ele no ambiente a rota fica desligada. **Pelo menos 32 caracteres** (a api recusa subir com um mais curto, e **em produção com o valor de dev do `.env.example`**; o site trata o curto como erro de configuração). O **mesmo** valor nos dois: quem girar um só derruba a leitura (a home mostra "não foi possível carregar os dados"; `docs/RUNBOOK.md`, seção 4). `docs/API.md`, seção 6 |
| `FRONT_DOOR_ID` | `ca-web`, `ca-api` | segredo `front-door-id` | padrão | ID do perfil do Front Door: o que `X-Azure-FDID` tem de trazer (seção 3.3) |
| `ORIGIN_LOCK` | `ca-web`, `ca-api` | valor: `front-door` | padrão | Contrato fail closed da etapa 3: em produção o app **recusa subir** se `ORIGIN_LOCK=front-door` e `FRONT_DOOR_ID` vier vazio (seção 3.3) |
| `FRONT_DOOR_ENDPOINT_ID` | `ca-worker-data` | valor: ID do endpoint do Front Door | padrão | O ID do endpoint (`/subscriptions/.../afdEndpoints/alvesting`) para o purge de `/api/v1/*` depois da liquidação, por `POST .../purge?api-version=2025-06-01` na ARM REST (a `id-alvesting-worker` tem só a ação de purge; `docs/JOBS.md`, 4.2). A API valida o formato antes de concatená-lo a `management.azure.com` |
| `BETTER_AUTH_SECRET` | `ca-api` | segredo `better-auth-secret` | sempre | Assina as sessões (etapa 11). **Em produção a api recusa subir** com ele vazio, curto (menos de 32 caracteres), com poucos caracteres distintos ou igual ao valor de exemplo do `.env.example` (`apps/api/src/modules/account/infrastructure/account-config.ts`, `docs/CONTA.md`). Gere com `openssl rand -base64 48` |
| `GOOGLE_CLIENT_SECRET` | `ca-api` | segredo `google-oauth-client-secret` | sempre | Login com Google (etapa 11), junto com `GOOGLE_CLIENT_ID`: o login por Google só existe com os dois (o `PENDENTE` do cofre vale como ausente, e sem os dois nada quebra) |
| `ACS_CONNECTION_STRING` | `ca-api` | segredo `acs-connection-string` | sempre | Verificação de e-mail e reset de senha pelo Communication Services (etapa 11). **Obrigatória em produção**: o remetente falso (`EMAIL_OUTBOX_DIR`) não existe na Azure, e a api recusa subir se ele for ligado. Autenticação por chave, não por identidade gerenciada (`docs/CONTA.md`, "Identidade gerenciada no e-mail") |
| `EMAIL_SENDER_ADDRESS` | `ca-api` | valor: `DoNotReply@<domínio gerenciado>`, saída `senderAddress` do `email.bicep` | sempre | De onde o e-mail da conta sai (etapa 11). Obrigatório em produção; o domínio (`<guid>.azurecomm.net`) só existe depois do deploy |
| `LEGAL_CONTROLLER_NAME`, `LEGAL_CONTACT_EMAIL` | `ca-api` | valor: parâmetros `legalControllerName` e `legalContactEmail` (entradas `ALVESTING_LEGAL_CONTROLLER_NAME` e `ALVESTING_LEGAL_CONTACT_EMAIL`) | sempre | O controlador dos dados pessoais e o contato, que a política de privacidade mostra (LGPD, art. 9; etapa 11). Nunca no repositório; **obrigatórios em produção** (a api recusa subir sem eles), e vêm juntos |
| `GOOGLE_CLIENT_ID` | `ca-api` | valor: parâmetro `googleClientId` (entrada `ALVESTING_GOOGLE_CLIENT_ID`), só se não for vazio | sempre | O client ID do cliente OAuth do Google (etapa 11). Não é segredo. A API só registra o Google com ele **e** com o `GOOGLE_CLIENT_SECRET` |
| `BRAPI_TOKEN` | `ca-worker-data` | segredo `brapi-token` | sempre | A fonte única das cotações (o `eod`, a atualização semanal do `universe` e, em dev, o `market:backfill`; `docs/DADOS.md`); só o worker o lê. `PENDENTE` vale como ausente: a busca recusa |
| `OPENROUTER_API_KEY` | `job-worker-decisions` | segredo `openrouter-api-key` | sempre | Gateway dos LLMs da arena; só o job de decisões o lê |
| `PROMPT_ARENA` | `job-worker-decisions` | segredo `prompt-arena` (versão fixa no URI) | sempre | O texto do prompt da arena, que nunca entra em repositório, imagem, log nem resposta da API; só o job de decisões o lê |
| `PROMPT_ARENA_VERSION` | `job-worker-decisions`, `job-sched-cycle`, `ca-api` | valor: a versão do segredo `prompt-arena` (32 hexadecimais) | sempre | Não é segredo. O `job-sched-cycle` a fixa no ciclo (a identidade dele não lê o segredo, então ele não conhece o texto nem o SHA-256); o `job-worker-decisions` a confere com a do ciclo e a grava em `prompt_version` com o SHA-256 do texto que recebeu (docs/ARENA.md). A `ca-api` a recebe para `POST /admin/cycles/:date/rerun` (etapa 10, parte 2): o ciclo reprocessado fixa a mesma versão que o agendador fixaria. A api **não** recebe o texto do prompt nem o segredo `prompt-arena` |
| `ARENA_MONTHLY_COST_CAP_USD` | `job-sched-cycle`, `ca-api` | valor: dólares inteiros (parâmetro `arenaMonthlyCostCapUsd`) | sempre | O teto de custo das LLMs no mês (plano 5.15). Antes de abrir o ciclo, o `job-sched-cycle` soma o custo das decisões do mês; no teto, o ciclo é pulado e nenhum modelo é chamado. Os fakes custam zero e não dependem dele. Sem a variável, o ciclo com modelo pago é pulado. A `ca-api` o recebe para o painel de custos (`GET /admin/costs`, o acumulado do mês contra o teto) e para o reprocesso do ciclo, que respeita o mesmo teto |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | `ca-api` | valor: endpoint da conta e `chat` | `enableOpenAI` | Chat (etapa 13) **por identidade, sem chave**: cliente do Azure OpenAI com `DefaultAzureCredential`, escopo `https://cognitiveservices.azure.com/.default`; a `id-alvesting-api` tem o papel Cognitive Services OpenAI User |
| `PROMPT_CHAT` | `ca-api` | segredo `prompt-chat` | `enableOpenAI` | O texto do prompt do chat; só a api o lê. O segredo precisa existir antes de ligar o chat |

**O login da api no Postgres (etapa 10, onda 3d e parte 4; ADR 0028).** As linhas `DATABASE_URL` e `API_DATABASE_URL` da tabela acima são o contrato; o que cada uma é:

- `database-url-api` (`postgresql://alvesting_api:<senha>@<host>:5432/<banco>?sslmode=require`): a URL do login de menor privilégio. **Na Azure**, o `ca-api` a recebe direto no `DATABASE_URL` (lida só pela
  `id-alvesting-api`, que deixou de ler o `database-url` do administrador), e o `job-migrate` a recebe em `API_DATABASE_URL`. **No dev e no e2e** o papel HTTP usa a `API_DATABASE_URL` do `.env` no lugar do `DATABASE_URL`
  (`useApiLogin` em `config/env.ts`, chamada pelo `main.ts`; o `.env.example` traz o valor de dev, `postgresql://alvesting_api:alvesting_api@localhost:25432/alvesting_dev`, que a produção recusa). O worker, as decisões e
  os agendadores nunca a usam.
- O comando `db:roles` (`node dist/db-roles-cli.js`) recebe as DUAS: o `DATABASE_URL` do administrador (quem cria o login) e a `API_DATABASE_URL` (dela só sai a senha, e o usuário tem de ser `alvesting_api`). Na Azure roda
  no `job-migrate`, depois do `migrate deploy`, e é repetível: **girar a senha da api é gravar a senha nova no segredo `database-url-api` e rodar o job de novo** (8.2). A senha de produção tem pelo menos 32 caracteres.
  A senha nunca vai em argumento de linha de comando, migration ou log: ela chega ao servidor como resumo SCRAM-SHA-256, e o erro do comando nunca repete a URL.

**Não existe `SERVICEBUS_FAKE_DIR` em produção** (etapa 10, parte 2): é o Service Bus falso do e2e, uma pasta com a DLQ e a publicação
(`modules/messaging/infrastructure/fake-service-bus.ts`). Nenhum workload a recebe, e o app **recusa subir** se `NODE_ENV=production` e ela existir.

**Não existe `SERVICEBUS_CONNECTION_STRING` em produção**: o cliente do Service Bus do `apps/api` (etapa 4,
`modules/messaging/infrastructure/service-bus-client.ts`) já entra pelo `SERVICEBUS_FQDN` com o `DefaultAzureCredential` quando
não há connection string; ela só vale no emulador e no CI (definida, vence o endereço). **Também não existe
`AZURE_OPENAI_API_KEY`**: a conta não tem chave. **Nem `STORAGE_CONNECTION_STRING`**: o Blob do briefing e do IO das LLMs entra pelo `STORAGE_BLOB_ENDPOINT` com a identidade, e a connection string existe só para o Azurite em dev e no CI (a conta
tem `allowSharedKeyAccess: false`). As variáveis **novas** desta onda são `PROMPT_ARENA`, `PROMPT_ARENA_VERSION` e `PROMPT_CHAT`; as que já existiam mudam
só de valor (`AZURE_CLIENT_ID` é agora o da identidade de cada workload) ou saem (`AZURE_OPENAI_API_KEY`). As etapas 4 e 5 não
pediram variável nova à infra: além de `NODE_ENV` e `LOG_LEVEL`, o código delas lê `DATABASE_URL`, `SERVICEBUS_FQDN`,
`STORAGE_BLOB_ENDPOINT`, `AZURE_CLIENT_ID` (o `DefaultAzureCredential` a lê sozinho) e `BRAPI_TOKEN`, que já estão na tabela.

**Etapa 6 (decisão da arena).** Só acrescentou: `ARENA_MONTHLY_COST_CAP_USD` (nova, só no `job-sched-cycle`, parâmetro
`arenaMonthlyCostCapUsd` do `main.bicep`) e `PROMPT_ARENA_VERSION` também no `job-sched-cycle`. O `job-worker-decisions` já recebia
`PROMPT_ARENA`, `PROMPT_ARENA_VERSION` e `OPENROUTER_API_KEY`; o código lê as três do ambiente (`apps/api/src/config/env.ts`, que as
guarda dentro de um `Secret` que não aparece em log nem em JSON). `AZURE_OPENAI_ENDPOINT` (o `env.ts` o aceita) **não** está no
`job-worker-decisions`, então um competidor da arena com provedor `azure-openai` ainda não funciona em produção: precisa levar o
endpoint ao job e dar o papel Cognitive Services OpenAI User à `id-alvesting-decisions` (docs/ARENA.md). A Temporada 1 usa o
OpenRouter e não precisa disso.

### 2.8 Contrato com o Dockerfile da api (etapa 3)

O Bicep supõe, no `WORKDIR` da imagem `alvesting-api`: `dist/` (com `main.js`, `worker.js`, `decide.js`, `schedule.js` e, para o `job-migrate` criar o login da api depois do `migrate deploy`, `db-roles-cli.js`),
`node_modules/` com o CLI do Prisma (`node_modules/prisma/build/index.js`), `prisma/` (schema e migrations) e
`prisma.config.ts`. **A telemetria (etapa 10)** acrescenta `dist/telemetry/preload.js`, que o `NODE_OPTIONS` da imagem
(`--enable-source-maps --import ./dist/telemetry/preload.js`, no `ENV` do Dockerfile) carrega antes do ponto de entrada: o comando de cada papel no Bicep não muda, e o
`WORKDIR` da imagem tem de continuar sendo o da raiz de `dist/` (o caminho é relativo). **O `backup-verify` chama `pg_dump` e `pg_restore` pelo PATH da imagem** (etapa 10, onda 3d), então a imagem da api traz o `postgresql-client-17` (o major do servidor; parte 4): o estágio de execução do Dockerfile liga o repositório oficial **PGDG** (`apt.postgresql.org`, suíte `bookworm-pgdg`, com a chave `ACCC4CF8` do próprio PostgreSQL), instala o pacote com o **major fixo no nome** (o Debian 12 só tem o cliente 15; a versão menor vem do `apt` no build, porque o PGDG mantém uma série delas e uma versão exata quebraria o build) e confere no próprio build que `pg_dump` e `pg_restore` são `17.x`. O pacote traz `psql` (a seção 8.6 o usa para o SQL pontual) e o `perl` do Debian (o `/usr/bin/pg_dump` é um wrapper em Perl que escolhe a versão): uns 40 MB a mais, não medidos (`docker build` não roda onde isto foi escrito; o job `images` do CI imprime o tamanho no resumo e confere as três versões dentro da imagem). O código recusa binário de outro major. A imagem do web é o build standalone do Next (`node server.js`, escuta em `PORT`). Se o Dockerfile fugir
disso, o caminho muda em `containerapps.bicep` (os comandos estão no topo do arquivo).

---

## 3. Segurança

### 3.1 Rede (§5.6)

- Banco sem IP público (2.2). Sem private endpoint em Key Vault, Storage, Service Bus ou ACR: é coisa dos tiers caros (fase 4).
- Workers e agendadores não têm ingress. Só `ca-web` e `ca-api` são alcançáveis, e no padrão só passando pelo Front Door.
- **Saída para a internet:** a sub-rede dos apps não tem NAT, firewall nem NSG, então a saída é livre. Além dos endereços da
  própria Azure, o `ca-worker-data` busca por HTTPS (443), com lista fixa no código (`docs/DADOS.md`): `brapi.dev` (as cotações,
  a única fonte; nada mais é baixado da B3), os feeds `www.infomoney.com.br`, `www.moneytimes.com.br`, `www.seudinheiro.com` e
  `agenciabrasil.ebc.com.br`, `dados.cvm.gov.br` (IPE e FCA) e `api.bcb.gov.br` (SGS). Se um dia entrar firewall ou NSG de saída,
  liberar esses sete. Não verificado na Azure: algum site pode recusar o IP de saída (a primeira busca real mostra).
- Storage sem acesso público a blobs, TLS 1.2, **sem chave de conta** (`allowSharedKeyAccess: false`): só identidade.
- Service Bus sem chave SAS (`disableLocalAuth`). Key Vault com RBAC (sem política de acesso), exclusão lógica de 90 dias e
  proteção contra purge em prod: o cofre guarda os prompts, que só existem lá e são revelados no fim da temporada, então um
  `az keyvault purge` ou um segredo apagado e não notado em 7 dias não podem apagá-los de vez. Em dev o cofre fica sem a
  proteção e com 7 dias, para o nome voltar a servir depois de apagar o resource group de teste.
- **Auditoria do cofre:** o `AuditEvent` do Key Vault vai ao Log Analytics (`observability.bicep`): cada leitura e gravação de
  segredo, com quem e quando, sem o valor. É a trilha para saber por onde um prompt vazou. Retenção de **90 dias** (a do
  workspace, e não os 30 do mínimo): a temporada dura ~20 pregões (~4 semanas) e um vazamento descoberto depois dos 30 dias
  não deixaria trilha. A Azure inclui 31 dias de retenção; o que passa disso é cobrado por GB armazenado (página "Azure Monitor
  Logs Cost Calculations And Options", conferida em 01/11/2026: "Includes 31 days of analytics retention at no extra cost"),
  centavos nesse volume. A retenção é do workspace inteiro, então o log do WAF (IP e URL com query string, seção 2.5) também
  fica 90 dias.
  O `seed-secrets.sh` só lista metadado (nome e tag), nunca baixa o valor, para não poluir essa trilha com leituras dele.
- Azure OpenAI sem chave (`disableLocalAuth`) e com a implantação `DataZoneStandard` (seção 8.3).
- Postgres só com TLS (`require_secure_transport`, seção 2.2).

### 3.2 Identidade e papéis

**Uma identidade por workload, mais a do KEDA**, no lugar da única do plano (§5.3; ADR 0020). Cada uma tem o mínimo para o
que o workload faz, e **nenhuma lê o cofre inteiro**: o Key Vault Secrets User é atribuído no escopo de cada segredo
(`modules/secret-access.bicep`, um papel por par workload-segredo).

| Identidade | Quem a usa | Papéis fora do Key Vault (escopo) |
|---|---|---|
| `id-alvesting-web` | só o **`ca-web`**, e só a plataforma (`lifecycle: None`: o código do Next não consegue token dela) | AcrPull (`cralvesting`, padrão). Nada de Blob, Service Bus nem purge |
| `id-alvesting-api` | o **`ca-api`** | Service Bus Data Sender e Receiver **nas seis filas** (o admin lê e reenvia a DLQ de qualquer uma, e publica o `decide` do reprocesso e o `settle` do evento corporativo), AcrPull (padrão) e, com `enableOpenAI`, Cognitive Services OpenAI User (`oai-alvesting`). Sem Blob |
| `id-alvesting-worker` | o **`ca-worker-data`** | Service Bus Data Sender e Receiver nas **cinco filas que consome** (`market`, `news`, `briefing`, `settlement`, `maintenance`; nada em `decisions`), Storage Blob Data Contributor **nos containers `briefings` e `backups`** (nunca no `llm-io`), AcrPull e o papel de purge do Front Door (`afd-alvesting`, padrão) |
| `id-alvesting-decisions` | o **`job-worker-decisions`** | Service Bus Data Sender e Receiver **só na `decisions`**, Storage Blob Data Contributor **no `llm-io`** (IO bruto das LLMs) e Storage Blob Data **Reader** **no `briefings`** (lê o briefing congelado), e AcrPull (padrão) |
| `id-alvesting-sched` | os **7 `job-sched-*`** | Service Bus Data **Sender** em **cinco filas** (só publicam, ADR 0007; `settlement` é do `eod`) e AcrPull (padrão). Sem Blob |
| `id-alvesting-migrate` | só o **`job-migrate`**, e só a plataforma (`lifecycle: None`) | AcrPull (padrão) |
| `id-alvesting-scale` | só as **regras de escala do KEDA** do worker e das decisões (`lifecycle: None`) | Azure Service Bus Data Owner **em cada uma das seis filas** (`sb-alvesting/queues/...`) |

**O Service Bus por fila e o Blob por container (etapa 10, parte 4; ADR 0030).** Nenhum papel de Service Bus está no escopo do namespace e nenhum de Blob no da conta:
cada atribuição é no escopo da **fila** (`.../namespaces/sb-alvesting/queues/<fila>`) ou do **container** (`.../storageAccounts/stalvesting/blobServices/default/containers/<container>`),
o escopo de recurso filho que a documentação da Microsoft prevê para os dois (Learn, "Authenticate and authorize an application with Microsoft Entra ID to access Azure Service
Bus entities" e "Assign an Azure role for access to blob data"). A matriz sai do código, e o `check.mjs` a escreve à mão (`QUEUE_ROLES` e `BLOB_ROLES`), sem olhar o Bicep:

| Fila | Publica (Sender) | Consome e lê a DLQ (Receiver) | Por quê |
|---|---|---|---|
| `market` | api, worker, agendadores | api, worker | O `eod` e o `universe` vêm dos agendadores; o worker se reagenda (+60 min) e agenda a nova tentativa; a api reenvia a DLQ |
| `news` | api, worker, agendadores | api, worker | O `fetch` por fonte |
| `briefing` | api, worker, agendadores | api, worker | O `freeze` |
| `decisions` | api, decisões, agendadores | api, decisões | O `sched-cycle` publica o `decide`; a api o publica no reprocesso do ciclo; as decisões o consomem e agendam a nova tentativa |
| `settlement` | api, worker | api, worker | O fim do `eod` (no worker) publica o `settle`, e a api publica o do evento corporativo; os agendadores não |
| `maintenance` | api, worker, agendadores | api, worker | A `retention` e o `backup-verify` |

| Container | Contributor (ler, gravar e apagar) | Reader (só ler) | Por quê |
|---|---|---|---|
| `briefings` | worker | decisões | O worker grava o briefing congelado (`FreezeHandler`); as decisões o leem para montar o pedido (`BriefingArchive.read`) |
| `llm-io` | decisões | | As decisões gravam o IO bruto (`LlmIoArchive`); **nada o lê pelo código**, então o worker, que parseia RSS, CSV e ZIP de terceiros, deixa de alcançá-lo (fecha o risco do item 4 abaixo) |
| `backups` | worker | | O dump do `backup-verify`: envia, baixa de volta para restaurar, grava os metadados e apaga o que não passou na conferência |

A api e os agendadores não leem nem gravam Blob; o `id-alvesting-scale` não tem Blob. **Sem política de imutabilidade em nenhum container, de propósito (ADR 0030):** uma política travada impede apagar a conta de armazenamento
até a retenção vencer (armadilha com crédito de estudante: o resource group de teste não se apaga), e o SHA-256 que o banco guarda de cada blob de `briefings` e `llm-io` já acusa a adulteração. Fica a exclusão
lógica de 7 dias (apagar por engano não é definitivo). **O `backups` é a exceção:** o dump não tem linha no banco, e o SHA-256 dele mora só nos metadados do próprio blob (gravados pela mesma identidade, o worker) e na linha de log `backup-verify: dump guardado, restaurado e conferido` (Log Analytics, 90 dias);
quem tem escrita nele pode trocar o dump e os metadados juntos, e só a exclusão lógica de 7 dias protege de um apagar por engano. O teto de quem tem papel de escrita num container: sobrescrever blob dele. Em `briefings` e `llm-io` o nome do blob carrega o hash do
conteúdo, então o código nunca sobrescreve bytes diferentes (e o que mudasse não bateria com o hash da linha do banco). O container `cotahist` **saiu** na onda da brapi (ADR 0032): as cotações não vão ao Blob;
o `backups` é sobrescrito a cada nova execução do mesmo mês (`alvesting-AAAA-MM.dump`). Se a banca pedir imutabilidade, o caminho é a política por container com retenção curta, depois do experimento; para os dumps, o versionamento do Blob com um ciclo de vida para as versões antigas é o passo
anterior (a exclusão de uma VERSÃO é uma ação própria no RBAC de Blob: confirmar na tabela de ações antes de contar com ela) e o log de dados do Blob (`StorageRead`, `StorageWrite` e `StorageDelete` no Log Analytics) dá a trilha de quem apagou ou trocou (hoje só o cofre tem trilha de quem leu, 3.1).

**Key Vault Secrets User, segredo a segredo** (a tabela do que cada workload referencia, e só esses ele lê; o `check.mjs` afirma
a lista inteira e que `referências = papéis` em cada workload):

| Identidade | Segredos que lê |
|---|---|
| `id-alvesting-web` | `appinsights-connection-string`, `revalidate-secret`, `quotes-secret` e, no padrão, `front-door-id` |
| `id-alvesting-api` | `database-url-api` (o login de menor privilégio; **não** o `database-url` do administrador), `appinsights-connection-string`, `better-auth-secret`, `google-oauth-client-secret`, `acs-connection-string`, `quotes-secret` e, no padrão, `front-door-id`; com `enableOpenAI`, `prompt-chat` |
| `id-alvesting-worker` | `database-url`, `appinsights-connection-string`, `brapi-token`, `revalidate-secret` |
| `id-alvesting-decisions` | `database-url`, `appinsights-connection-string`, `openrouter-api-key`, `prompt-arena` |
| `id-alvesting-sched` | `database-url`, `appinsights-connection-string` |
| `id-alvesting-migrate` | `database-url` (migra e cria o login) e `database-url-api` (de onde o `db:roles` tira a senha do login da api) |

Por quê: `ca-web` e `ca-api` são os únicos workloads alcançáveis pela internet. Com a identidade única da primeira versão, um
RCE no `ca-web` (o que roda o Next, o código com mais dependências de terceiros) pediria token em `IDENTITY_ENDPOINT` e leria
`prompt-arena`, `prompt-chat`, `database-url` e `openrouter-api-key`, e ainda publicaria uma `decide` forjada no Service Bus. Com
uma identidade por workload, o alcance de um RCE é o do workload comprometido: **web, api e worker-data não leem, pelo Key
Vault, o `prompt-arena` nem a chave do OpenRouter; só a api lê o `prompt-chat`; o token da brapi é só do worker; o banco, só de
quem consulta (o web não)**. O caminho do Blob tem a ressalva (4) abaixo. `lifecycle: None` tira até o token da identidade do
alcance do código no web e no migrate, e a `id-alvesting-scale` existe porque o KEDA provavelmente precisa de Data Owner (seção
11) e esse papel largo não pode ficar na identidade que qualquer código carrega.

O que isto **não** fecha: (1) quem tem permissão de **iniciar um job** ou de listar os segredos do app no Container Apps
(Contributor do resource group, que é o do CI, `docs/DEPLOY.md`) alcança os segredos dele: a documentação da Microsoft diz para
tratar essa permissão como a de usar os segredos e as identidades do job. O isolamento é contra o código comprometido dentro de
um workload, não contra o papel de deploy. (2) A trilha de quem leu o quê é o `AuditEvent` do cofre (seção 3.1). (3) O banco tem dois logins: a api tem o de menor privilégio (seção 2.2),
mas o worker, as decisões e os agendadores seguem com o administrador, dono das tabelas (`ponytail` em `table-policy.ts`: o próximo passo é um papel de escrita sem DDL). (4) **O Blob: fechado na parte 4.** Antes, os papéis de Storage estavam no escopo da conta inteira, e o worker, que
parseia RSS, CSV e ZIP de terceiros, lia também o container `llm-io`: se o IO bruto que a etapa 6 grava ali trouxesse o pedido
como foi enviado, com o texto do prompt da arena, um RCE no worker o leria por esse caminho. Agora o worker **não tem papel no `llm-io`** (só as decisões o
gravam, e nada o lê), e a garantia de que o worker não lê o `prompt-arena` vale também pelo Blob. O **critério de aceite da etapa 6** continua valendo, com teste de
canário: o `llm-io` grava o SHA-256 e a versão do prompt, nunca o texto (a regra 4 do `CLAUDE.md` vale para o Blob também). A api e os agendadores
recebem `STORAGE_BLOB_ENDPOINT` mas não têm papel de Blob e levariam 403 (seção 2.7).
Quem implanta e semeia (`adminPrincipalId`) recebe **Key Vault Secrets Officer** no cofre. Quem roda o deploy precisa ser
**Owner** do resource group (cria atribuições de papel e a definição do papel de purge).

**GUIDs dos papéis internos** (moram só em `infra/roles.bicep`; fonte:
<https://learn.microsoft.com/azure/role-based-access-control/built-in-roles>, conferida em 01/11/2026):

| Papel | GUID |
|---|---|
| AcrPull | `7f951dda-4ed3-4680-a7ca-43fe172d538d` |
| Key Vault Secrets User | `4633458b-17de-408a-b874-0445c86b69e6` |
| Key Vault Secrets Officer | `b86a8fe4-44ce-4948-aee5-eccb2c155cd7` |
| Storage Blob Data Contributor | `ba92f5b4-2d11-453d-a403-e96b0029c9fe` |
| Storage Blob Data Reader | `2a2b9908-6ea1-4ae2-8e65-a410df84e7d1` |
| Azure Service Bus Data Sender | `69a216fc-b8fb-44d8-bc22-1f3c2cd27a39` |
| Azure Service Bus Data Receiver | `4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0` |
| Azure Service Bus Data Owner | `090c5cfd-751d-490a-894a-3ce6f1109419` |
| Cognitive Services OpenAI User | `5e0bd9bd-7b93-4f28-af87-19fc36ad61bd` |

O papel de purge do Front Door é próprio (GUID gerado por `guid(rg, perfil, ação)`). O GUID do Cognitive Services OpenAI User foi
lido na página `ai-machine-learning` da mesma tabela da Microsoft (a fonte do repositório `MicrosoftDocs/azure-docs`), e o do Storage Blob Data Reader, na
página `storage` (03/11/2026: só `containers/read` e `blobs/read`, sem escrita nem exclusão; o Contributor soma `write`, `delete` e `move`).

Um GUID errado já derrubou uma revisão (Key Vault Secrets User terminava em `...0f2c2cf0c5d6`, que não existe: o módulo do cofre
falharia e tudo que depende dele nunca rodaria). Por isso há **duas conferências independentes**, nenhuma cópia do Bicep:
`infra/scripts/verify-roles.sh` pergunta à assinatura o nome de cada GUID (passo 0 da seção 6), e o `check.mjs` compara com a
tabela da Microsoft e afirma, por identidade, exatamente quais papéis existem e em qual escopo.

### 3.3 Trava de origem

O Front Door manda `X-Azure-FDID`. O Container Apps não filtra por cabeçalho, então a recusa é um middleware em web e api
(etapa 3), que compara com `FRONT_DOOR_ID`. Dois cuidados para essa etapa: **`/health` fica fora da trava** (os probes do
Container Apps vêm de dentro do ambiente e não trazem o cabeçalho), e as **chamadas internas** vão direto ao ingress, sem passar
pelo Front Door: o SSR da web para a api precisa mandar `X-Azure-FDID` com o próprio `FRONT_DOOR_ID` (`apps/web/src/lib/api.ts`);
a revalidação do worker para a web é a **segunda e última exceção** (etapa 9): `POST` no caminho exato `/interno/revalidar` com o
`REVALIDATE_SECRET` válido em `Authorization: Bearer` passa sem o cabeçalho, porque o worker não recebe `FRONT_DOOR_ID`. O segredo
é conferido em tempo constante (SHA-256 dos dois lados e `timingSafeEqual`) no `src/proxy.ts` e de novo na rota; vale só para esse
caminho e esse método (o mesmo segredo em outro caminho, ou em `GET` nesse, continua 403); sem `REVALIDATE_SECRET` no ambiente (ou com
menos de 32 caracteres) a rota responde 503. A rota nem precisa ser alcançável pelo Front Door: o worker usa o ingress direto, e o WAF
bloqueia `/interno/` na borda (seção 2.5), então só o endereço direto do `ca-web` (trava e segredo) leva até ela. Private Link
(que fecharia a origem na rede) só existe no Front Door Premium (ADR 0003).

**A rota interna de cotações da api** (`GET /api/v1/interno/barras/:ticker`; `docs/API.md`, seção 6; ADR 0033) **não é exceção da trava**: o SSR do
site a chama pelo ingress do `ca-api` com o `X-Azure-FDID` (como lê o resto da API) e mais o segredo `QUOTES_SECRET` em `Authorization: Bearer`, e a
trava vem antes (sem o `X-Azure-FDID` é 403, até com o segredo certo). O segredo é conferido em tempo constante e, sem ele ou com o errado, a resposta
é um 404 igual ao da rota que não existe (a rota não se confirma a quem não a conhece). Ela fica fora do Swagger, com `no-store`, fora da rota com
cache do Front Door (o `check.mjs` lê o controlador e confere) e, pelo `/interno/` no caminho, bloqueada pelo WAF na borda.

**O que a infra entrega e o que ela NÃO prova.** A infra entrega o ID (segredo `front-door-id`, `FRONT_DOOR_ID`) e o sinal
`ORIGIN_LOCK=front-door`. Quem recusa o pedido é o middleware da etapa 3, e **até ele existir nada na rede impede que se chame
`ca-web` ou `ca-api` direto pelo FQDN do ambiente** (ingress externo, sem restrição de IP): o WAF e o rate limit ficam
contornáveis por esse caminho. O `X-Azure-FDID` é um GUID fixo do perfil, que só muda se o perfil for recriado.

**Contrato fail closed (obrigatório na etapa 3).** O Bicep injeta `ORIGIN_LOCK=front-door` em texto puro em `ca-web` e `ca-api`,
só no padrão. Em produção, o app com `ORIGIN_LOCK=front-door` **recusa subir** se `FRONT_DOOR_ID` vier vazio. Sem isso, um
`FRONT_DOOR_ID` vazio (erro de configuração) pareceria "sem trava", como no econômico, e a desligaria em silêncio.

**Aceite da etapa 3 para esta trava** (testes): pedido direto ao FQDN da api sem o cabeçalho é recusado; com o `X-Azure-FDID`
certo vira 200; `/health` e a revalidação com `REVALIDATE_SECRET` são as únicas exceções; subir com `ORIGIN_LOCK=front-door` e
`FRONT_DOOR_ID` vazio falha. **Não ligue a fase 2 com imagens reais antes disso.**

---

## 4. Backups (§5.8)

- **PITR de 7 dias** no Postgres (`backupRetentionDays: 7`; 35 é o máximo, se a banca pedir).
- **Blob:** exclusão lógica de 7 dias para blobs e containers (o IO bruto das LLMs é o dado do experimento).
- **Ciclo de vida:** `hot` para `cool` em 30 dias em tudo; o que está em `backups/` sai depois de 365 dias (os 12 meses do §5.8).
- **`backup-verify` mensal** (etapa 10, onda 3d; `docs/JOBS.md`, seção 8.2; ADR 0028): o `pg_dump` (formato custom, em fluxo, sem arquivo no disco do contêiner) vai para `backups/alvesting-AAAA-MM.dump`, é restaurado num
  banco temporário do mesmo servidor, e as contagens de toda tabela têm de bater com as da origem no instante do dump (`pg_export_snapshot`). **O dump leva o esquema inteiro e NÃO leva os dados das tabelas pessoais**
  (`user`, `session`, `account`, `verification`, `consent` e, desde a etapa 12, `portfolio` e `portfolio_lot`): ele fica 12 meses, e a política de privacidade promete cópia com dado pessoal só pelo ponto de restauração de 7 dias. O dado pessoal está **só no PITR**.
  Restaurar um desastre inteiro é o PITR (dado pessoal incluído, até 7 dias) mais, se precisar do histórico público, o dump. Falhou = `job_run` `FAILED`, sinal `job-falhou`, e o banco temporário some.
  A imagem da api traz o `postgresql-client-17` (o major do servidor, do repositório PGDG; seção 2.8) para o `pg_dump` e o `pg_restore`, e o job `check` do CI o instala para o teste de integração do backup-verify rodar com o binário nativo; o código recusa binário de outro major.
  **O que a verificação prova e o que não prova:** prova que o dump é legível e completo, no mesmo servidor em que foi tirado. Não prova a restauração num servidor limpo: o dump leva os `GRANT` do papel de grupo
  `alvesting_api_group` (um por tabela e o `USAGE` do esquema; o `--no-owner` não os tira), e com `--exit-on-error` o `pg_restore` para no primeiro se o papel não existir no servidor novo (no verificador ele existe, o papel é do
  servidor). Restaurar o dump num servidor novo: criar antes `CREATE ROLE alvesting_api_group NOLOGIN`, rodar o `pg_restore` e depois o `db:roles`. O dump não traz papéis, logins nem senhas. Um dump sem os metadados `sha256` e
  `personal_data` no Blob não foi verificado (o processo pode morrer entre o envio e a conferência, `docs/JOBS.md`, 8.2). O [RUNBOOK](RUNBOOK.md), seção 5.3, tem o passo a passo.

## 5. Observabilidade (§5.9)

Log Analytics (90 dias, a ingestão dentro dos 5 GB gratuitos) e Application Insights ligados ao ambiente do Container Apps e aos apps pela
variável `APPLICATIONINSIGHTS_CONNECTION_STRING`. Além dos logs do Container Apps, o workspace recebe o `AuditEvent` do Key Vault
e, no padrão, o log do WAF do Front Door (diagnostic settings, seções 2.5 e 3.1). A etapa 10 (parte 1, 02/11/2026) trouxe o OpenTelemetry
da api (5.1), as métricas próprias (5.2) e os alertas (5.3 e `infra/modules/alerts.bicep`). A parte 2 (02/11/2026) trouxe as rotas `/admin` e o painel
(`docs/API.md`, seção 8, e `docs/TELAS.md`, seção 8) e o caminho do `account:promote`, do `account:demote` e do `season:start` na Azure (8.6). A fila `maintenance` (a retenção e o `backup-verify`, `docs/JOBS.md`, seção 8) e os sinais que faltavam (o `ciclo-pulado` e o 5xx do `/api/auth/*`) entraram na onda 3d, que fechou com o [RUNBOOK](RUNBOOK.md) (parte 5).

### 5.1 A telemetria da api (OpenTelemetry para o Application Insights)

- **Quem.** Os quatro papéis da imagem da api: `main` (HTTP), `worker`, `decide` e `schedule <nome>`. Cada um aparece no Application Insights
  com o próprio nome de papel na nuvem: `alvesting-api`, `alvesting-worker`, `alvesting-decide` e `alvesting-sched-<nome>`. **O site fica de
  fora**, como o §5.9 do plano pede ("api, workers e agendadores"): o Front Door (origem doente) e o alerta de 5xx já cobrem o `ca-web`, que
  recebe a connection string pelo contrato da seção 2.7 mas não a usa. Prisma, `account:promote` e qualquer outro processo da imagem não ligam a telemetria.
- **O que sai.** Requisições (um span de servidor por requisição, de nome `MÉTODO rota`, como `GET /api/v1/competitors/:slug`); dependências:
  Postgres (consulta, com o SQL sem valores), Blob e Service Bus (pelo SDK da Azure) e as chamadas HTTP de saída (B3, notícias, CVM, BCB, OpenRouter,
  revalidação e purge); o processamento de cada mensagem das filas (span de consumidor `process <fila>`, com a fila, o tipo, a chave natural e
  a tentativa); cada job agendado (`schedule <nome>`, a "requisição" dele); exceções (o 5xx de uma requisição, o erro de um handler); as métricas padrão do SDK e as próprias (5.2).
  A sonda `GET /health` do Front Door e do Container Apps fica fora: sem o filtro seriam uns 9 GB por mês só de sondas (5.5).
- **Como liga (e por que assim).** A api é ESM (`"type": "module"`, SWC com `module: es6`). A documentação da distribuição da Azure
  (`@azure/monitor-opentelemetry` 1.20.1, README, seção "ESM Support", lida em 02/11/2026) manda registrar os ganchos de módulo antes de
  carregar qualquer biblioteca que ela instrumenta: `node --import @azure/monitor-opentelemetry/loader <entrada>` e `useAzureMonitor()` antes de todo o resto.
  Um `import` no topo do `main.ts` não serve (o ESM carrega o grafo inteiro antes de executar a primeira linha), então o gancho é um arquivo
  à parte, `apps/api/src/telemetry/preload.ts`, carregado por `--import`. **A imagem o põe no `NODE_OPTIONS`** (`apps/api/Dockerfile`):
  vale para os quatro papéis sem mudar o comando de nenhum no Bicep, e os scripts `start*` do `package.json` o repetem. O `pnpm dev` e o e2e rodam sem ele.
  O arquivo só faz algo com `APPLICATIONINSIGHTS_CONNECTION_STRING`: **sem ela (dev, testes, e2e, o ensaio, o `job-migrate`) não carrega a
  distribuição, não instrumenta nada e não pede nada à rede**; o teste `telemetry.spec.ts` prova isso com a rede espiada, e o `preload.spec.ts` prova que o próprio gancho nem chama a telemetria sem ela. Se a telemetria falhar ao subir, a api sobe
  do mesmo jeito e o motivo vai para o stderr, só o nome do erro (`preload.spec.ts`). Ao sair (`app.close()`, que o `exitAfter` e o SIGTERM chamam), o `CoreModule` esvazia a fila de envio, com prazo de 5 s: o job que
  sai logo depois não perde o último span.
- **Logs.** O Pino continua em JSON no stdout, e o Container Apps o manda ao Log Analytics (`ContainerAppConsoleLogs_CL`, coluna `Log_s`: o ambiente usa o
  destino `log-analytics` em `containerenv.bicep`). **A distribuição não duplica**: ela só coleta log por bunyan, winston e console, que ficam desligados, e
  nenhum processador de log é registrado (`telemetry.spec.ts`).
- **Dado pessoal, segredo e prompt.** A telemetria nunca carrega o prompt, o IO bruto do modelo, e-mail, nome, IP do cliente, cookie, token (de sessão, de
  verificação ou de redefinição), connection string nem chave. É uma **lista branca**, como a do log de requisição (`common/http-log.ts`): um processador de spans
  (`telemetry/sanitize.ts`) roda dentro do SDK, entre o processador das métricas padrão da Azure e o que exporta em lote, e deixa só método, status, rota, host,
  user-agent, `db.system`, os atributos `alvesting.*`, `messaging.*` e `az.*`, os internos do SDK e a taxa de amostragem (`microsoft.sample_rate`, que o exportador lê para gravar o `sampleRate` do
  envelope: sem ela as contagens do Application Insights sairiam menores que as reais quando houver amostragem). O resto cai: `client.address` (que vem do `X-Forwarded-For`), `microsoft.client.ip`,
  `url.query`, `network.peer.*`, cabeçalhos, `enduser.*`, `db.postgresql.values`. A URL perde usuário, senha, query e fragmento, e o token do caminho da redefinição vira
  `:token` (o callback do Better Auth leva o token no caminho); o SQL perde os literais (`'x'` e números viram `?`; os parâmetros `$1` ficam); texto de exceção, pilha e nome de span passam
  pelo `redact.ts` (e-mail, IP, JWT, cookie, token, query de URL, argumentos do Prisma) mais as regras do canário do prompt, de `Bearer`, de `accesskey=` e `InstrumentationKey=`;
  evento que não é exceção cai (viraria linha em `AppTraces`); texto grande é cortado no último espaço (um pedaço de e-mail na borda do corte escaparia das regras). A rota de uma requisição sem rota do Nest (login do Better Auth, Swagger, 404, robô) é fixa (`/api/auth/*`,
  `/api/docs/*`, `(sem rota)`), então o caminho cru nunca é nome de operação. A requisição que um guard barra (401 e 403 de `/me`, e depois de `/admin`, da carteira e do chat) leva a rota do mesmo jeito:
  o guard roda antes do interceptor que a dá às demais, então quem a dá a ela é o filtro de exceções. Se o SDK passar a congelar os atributos, o span sai **vazio** (as propriedades são trocadas), nunca cru.
  O Better Auth tem os spans dele desligados (`experimental.instrumentation`): ele os cria sozinho assim que o
  `@opentelemetry/api` existe e põe a mensagem do erro no status. **Prova:** `telemetry.integration.spec.ts` sobe a api de verdade (Better Auth, Postgres), faz
  requisições com e-mail, senha, IP em `X-Forwarded-For`, cookie, `Authorization` e token de verificação e de redefinição, e confere que nenhum span, evento, nome ou atributo
  exportado (exportador em memória) os contém, e que a requisição tem o span da rota com o span filho da consulta ao Postgres.
  Fica de fora do que a lista branca resolve: o texto livre de uma mensagem de erro que não case com nenhuma regra por forma (um nome de pessoa solto);
  os cabeçalhos `traceparent` que o SDK manda a todo host de saída (um identificador opaco, sem dado pessoal).
- **Conferido de ponta a ponta (manual, 02/11/2026).** A api compilada rodou com `node --import ./dist/telemetry/preload.js dist/main.js` e a connection string apontando para um servidor HTTPS
  local que imita o endpoint de ingestão (127.0.0.1, certificado autoassinado; nenhum dado da aplicação saiu da máquina, mas a distribuição consultou sozinha o `settings.sdk.monitor.azure.com` e o IMDS: ver a linha seguinte). Chegaram os envelopes de requisição (`GET /api/v1/competitors/:slug`,
  `GET /api/auth/*` com a URL `.../reset-password/:token`, `POST /api/auth/*`, `GET (sem rota)`), as consultas ao Postgres, as métricas e, do job `schedule cycle`, a requisição
  `schedule cycle` (papel `alvesting-sched-cycle`, enviada antes do `process.exit`); nenhum dos onze canários (IP, cookie, token na query e no caminho, e-mail, senha, nome) estava no corpo.
- **O que mais sai para a Microsoft (com a connection string; nada sem ela).** Além da ingestão (`POST .../v2.1/track`, que leva a telemetria limpa pelo sanitizador), o exportador da Azure
  (`@azure/monitor-opentelemetry-exporter` 1.0.0-beta.46) consulta o IMDS (`169.254.169.254`, link-local: só responde dentro da Azure) e o `settings.sdk.monitor.azure.com` (configuração remota do SDK) e manda o
  **Statsbeat**: dados de uso do SDK (contagem e duração das requisições à ingestão, repetições, regulação, tipo de exceção, versão do runtime, sistema operacional, recursos usados e a chave de
  instrumentação como dimensão; nunca a telemetria da aplicação) para `westus-0.in.applicationinsights.azure.com`, fora do volume e do custo do cliente. O Statsbeat vem **ligado por padrão** (FAQ do
  Application Insights, "What usage data does Microsoft collect?", lida em 02/11/2026) e **não foi desligado**: é decisão do Artur. Desligar é pôr `APPLICATION_INSIGHTS_NO_STATSBEAT=true` (e, para a estatística do próprio
  exportador, `APPLICATIONINSIGHTS_SDKSTATS_DISABLED=true`) como variáveis de ambiente dos quatro papéis no Bicep, o que muda o contrato da seção 2.7 e o `check.mjs`. Também por causa disso, as chamadas da própria
  distribuição aparecem como séries `http.client.request.duration` nas `customMetrics` (o gancho de saída só ignora o endereço da ingestão): ruído, sem dado pessoal. Registrado em `docs/DEPENDENCIAS.md` (Application Insights).

### 5.2 Métricas próprias

Via `@opentelemetry/api` (`telemetry/instruments.ts`); sem o SDK ligado são instrumentos vazios, e o ensaio (`arena:ensaio`) não muda de resultado. Atributos de baixa
cardinalidade: o slug do competidor e o provedor, nunca um ULID. A `chat.messages` é da etapa 13.

| Métrica | Tipo | Unidade | Atributos | De onde vem |
|---|---|---|---|---|
| `llm.tokens` | contador | `{token}` | `type` (`input`, `output`), `competitor`, `provider` | `decision.usage` (a saída já inclui o raciocínio), ao gravar a decisão |
| `llm.cost_usd` | contador | `USD` | `competitor`, `provider` | `decision.cost_micro_usd` (bigint) ÷ 1.000.000; o double é só a leitura da métrica |
| `cycle.duration` | histograma | `s` | nenhum | da abertura (`cycle.created_at`) ao fechamento (`closeIfComplete`), uma vez por ciclo |
| `decision.invalid` | contador | `{decision}` | `reason` (`resposta_invalida`, `falha`, `prazo`, `prompt_divergente`, `sem_resposta`, `item_descartado`), `competitor`, `provider` | HOLD forçado gravado (a varredura `CycleCloser` conta `sem_resposta`, sem competidor) e cada item descartado da resposta |

Só a decisão que valeu conta: a que perdeu a corrida (`already_decided`) não entra. No Application Insights as quatro são `customMetrics` (`AppMetrics`).

### 5.3 Alertas

O que fazer em cada alerta, passo a passo (o comando, o que conferir antes e depois, e o risco), está em [docs/RUNBOOK.md](RUNBOOK.md): uma seção por linha desta tabela, por sinal da regra de log e por ação da trilha. O `apps/api/src/runbook.spec.ts` reprova o que faltar.

Todos mandam e-mail para o grupo de ações `ag-alvesting`, cujo endereço é o do orçamento (`ALVESTING_BUDGET_EMAIL`). **Em até 10 minutos** (aceite da etapa 10) é a frequência
de avaliação mais a latência até o dado chegar ao Azure Monitor, que a documentação ("Troubleshoot log search alerts") trata como o atraso a partir do qual o log deixa de servir (mais de 4 minutos);
adotamos 4 minutos para os dois tipos (a métrica da plataforma costuma chegar antes). No alerta de métrica a condição tem de valer na janela inteira, então a janela soma: 1 minuto de frequência + 5 de janela + 4 de latência = 10. No alerta de log a janela só dimensiona a contagem:
5 + 4 = 9. **Uma exceção, de propósito:** o `alvesting-decisions-fila-parada` mede ausência de progresso, não falha instantânea, e a janela dele é de 15 minutos (1 + 15 + 4 = **20**, ADR 0026). O orçamento de 10 minutos é otimista:
os 4 minutos de latência são o limiar da documentação, não uma garantia (a página "Log data ingestion time in Azure Monitor", lida em 02/11/2026, dá 30 segundos a 20 minutos para dado que vem do Azure e 3 a 10 minutos de ponta a ponta para log de recurso, que é o caso da
tabela `ContainerAppConsoleLogs_CL`; a métrica da plataforma fica disponível em menos de um minuto), e não sobra folga para a entrega do e-mail; só a cronometragem do 5.4 responde, e se estourar o caminho é encurtar a janela dos alertas de métrica de 5 para 3 minutos (o de log
depende da latência do log, e a frequência de 5 minutos é o piso de custo). O `infra/tests/check.mjs` confere esses números, a janela de cada alerta, a severidade, o grupo de ações, o nome e as dimensões das métricas, a consulta da regra de log **inteira** (comparada com a escrita no teste,
espaço em branco à parte) e, numa tabela de linhas de exemplo no formato do Pino, o que cada sinal pretende (um caso positivo e um negativo por sinal, e as bordas dos limiares).
A ordem de gravidade: 1 = erro (age já), 2 = aviso.

Nome e dimensões das métricas, da documentação do Azure Monitor (lida em 02/11/2026): Service Bus `ActiveMessages` e `DeadletteredMessages` (dimensão `EntityName`, agregações Média, Mínimo e Máximo, PT1M; a tabela da
documentação só restringe ao Premium as de CPU, memória e checkpoint, então as duas valem no Basic), Front Door Standard e Premium `OriginHealthPercentage` (dimensões `Origin` e `OriginGroup`) e `Percentage5XX`, PostgreSQL Flexible `cpu_percent` e `storage_percent`.

| Alerta | Tipo | Severidade | Frequência e janela | O que dispara | O que fazer |
|---|---|---|---|---|---|
| `alvesting-dlq-qualquer-fila` | métrica do Service Bus (`DeadletteredMessages`, máximo > 0, um alerta por fila) | 1 | 1 min e 5 min | Mensagem na dead-letter queue de qualquer uma das 6 filas. Atenção à `settlement` (uma `settle` morta deixa a temporada `RUNNING` e trava o `freeze` seguinte) e à `news` (feed fora por mais de uns 10 minutos manda o slot para lá; é a causa mais comum e a menos grave) | Ler a mensagem (o painel `/admin`, "Filas e DLQ", ou `GET /admin/jobs`), achar a causa no `job_run` (`error`) e no log, corrigir, reenviar (o botão do painel ou `POST /admin/dlq/:queue/resubmit`, `docs/API.md`, seção 8). `docs/JOBS.md`, seção 5 |
| `alvesting-decisions-fila-parada` | métrica do Service Bus (`ActiveMessages` da fila `decisions`, mínimo > 0) | 2 | 1 min e **15 min** | A fila `decisions` não esvaziou em 15 minutos (ciclo travado: o job não acordou, a chamada ao modelo pendurou, o processo caiu). O plano pede "mensagens às 09:35"; o Azure Monitor não agenda alerta de métrica por hora do dia (ver a limitação abaixo). **Detecta em 20 minutos (1 + 15 + 4), a única exceção ao "em até 10"**: uma chamada legítima de modelo de raciocínio passa de 5 minutos, e com 5 o alerta abriria quase todo dia útil às 08:06 | `az containerapp job execution list -n job-worker-decisions`: o KEDA acordou o job? (seção 11, risco do `id-alvesting-scale`). Ler o log das execuções, o segredo do OpenRouter, o `PROMPT_ARENA_VERSION`. Uma execução que acorda depois das 09:30 grava o HOLD `prazo` em segundos e conclui a mensagem; a que nunca acorda deixa o ciclo aberto até a varredura (`CycleCloser`, que roda no `settle` do dia e no `sched-cycle` seguinte) gravar `sem_resposta` |
| `alvesting-front-door-origem-doente` | métrica do Front Door (`OriginHealthPercentage`, média < 50, por origem, **só nos grupos `web` e `api`**: os do blue/green, `web-green` e `api-green`, ficam de fora porque no meio de um deploy que falha o label green pode estar sem revisão). **Só no padrão** | 1 | 1 min e 5 min | Metade ou mais das sondas `GET /health` do Front Door falhando na `web` ou na `api` | `az containerapp revision list --all` e o log do app; o `/health` responde? A trava de origem (`FRONT_DOOR_ID`) bate? Voltar a revisão (`docs/DEPLOY.md`, seção 6: `node scripts/deploy.mjs revert`) |
| `alvesting-front-door-5xx` | métrica do Front Door (`Percentage5XX`, média > 1, **sem dimensão: conta o perfil inteiro, o endpoint green também**). **Só no padrão** | 2 | 1 min e 5 min | Mais de 1% das respostas com status 5xx. A média é a das porcentagens de cada minuto, sem peso pelo tráfego: com pouco tráfego um 5xx isolado dispara. **Só vê o que passa pelo Front Door** (o navegador e o HTML do site): o SSR chama a api direto pelo ingress, e quem vê esse erro é o `api-5xx`. **Falso alarme conhecido (ADR 0029):** a revisão nova que falha na prova pelo endpoint green (5xx no Playwright verde) dispara este alerta com o site de produção saudável; o deploy fica vermelho e o `Desfazer` encerra o motivo. Filtrar pela dimensão `Endpoint` pede o formato do valor, que só o primeiro deploy mostra (seção 11) | Application Insights, Falhas (`AppRequests` com `ResultCode >= 500`, `AppExceptions`); o banco e o log da api. Aconteceu durante um deploy? Veja primeiro se o run do `deploy.yml` falhou na prova do green: então o site de produção não tem culpa |
| `alvesting-banco-cpu` | métrica do PostgreSQL (`cpu_percent`, média > 80) | 2 | 1 min e 5 min | CPU do banco acima de 80%. O B1ms é Burstable: sem créditos a CPU fica no teto | Ver o que roda (`settle`/Monte Carlo, uma consulta sem índice); subir para B2s (plano 5.13, fase 3) |
| `alvesting-banco-disco` | métrica do PostgreSQL (`storage_percent`, máximo > 80) | 2 | 1 min e 5 min | Disco do banco acima de 80% (dados, log de transações e log do servidor, nos 32 GB) | A retenção de domingo (`job_run` do tipo `fetch` com mais de 30 dias, sessões e cadastros vencidos) já roda; `news_item` NÃO tem limpeza, de propósito (uns 250 MB por ano no pior caso, `docs/JOBS.md`, seção 8.1). Ver o que cresce (`pg_total_relation_size`); aumentar o disco (só cresce) |
| `alvesting-sinais-da-aplicacao` | alerta de log (`ContainerAppConsoleLogs_CL`), uma regra, um alerta por sinal (dimensão `sinal`) | 2 | 5 min e 15 min | Qualquer um dos onze sinais abaixo. `autoMitigate`: um e-mail por incidente e outro quando passa | Ver o sinal no e-mail (dimensão) e a linha no Log Analytics: `ContainerAppConsoleLogs_CL \| where Log_s has "<texto da linha>"` |
| `api-5xx` | sinal da aplicação | 2 | (da regra) | Mais de 1% das requisições da api nos últimos 10 minutos responderam 5xx (o log de requisição do Pino, `res.statusCode`; a sonda `/health` não entra). **Cobre o que o Front Door não vê:** o SSR do site chama a api direto pelo ingress, então a api fora do ar (o banco caiu, um deploy ruim) aparece como tela de erro com status 200 e a métrica de 5xx da borda não mexe. Vale também no perfil econômico, que não tem Front Door. Com o tráfego do TCC (uns 17 pedidos em 5 minutos) um 5xx isolado já passa de 1%: o filtro de exceções só devolve 5xx para erro nosso. **Conta também `/api/auth/*`** (login, cadastro, redefinição; etapa 10, onda 3d): o Better Auth é atendido pelo Express antes do `pino-http`, então a `AuthRoute` escreve a própria linha, com os mesmos campos da lista branca e o `res.statusCode` que este sinal conta (em nível de erro a partir do 500, `auth-route.spec.ts` com o `LoggerModule` de verdade) | Application Insights, Falhas (`AppRequests` com `ResultCode >= 500`, `AppExceptions`) ou `ContainerAppConsoleLogs_CL \| where Log_s has "request errored" or Log_s has "/api/auth/"` (o 5xx do login sai como `POST /api/auth/... 500`, nível de erro); o banco (`alvesting-banco-*`), a última revisão (`az containerapp revision list`), os segredos do Key Vault |
| `job-falhou` | sinal da aplicação | 2 | (da regra) | `JobRunStore.fail` escreveu `job_run falhou`: a linha do `job_run` ficou `FAILED` (campos `queue`, `type`, `key`, `attempt`, `reason`). **A espera do `eod` pelo arquivo do pregão não conta** (estado `WAITING`, ver `docs/JOBS.md`). Na fila `news` só da 3ª tentativa seguida (a falha costuma ser rede, e o slot seguinte rebusca o feed), salvo a de segurança, que é o `news-seguranca` abaixo | `SELECT * FROM job_run WHERE status = 'FAILED' ORDER BY started_at DESC`; a fila repete sozinha até esgotar as entregas, e o alerta da DLQ avisa se esgotar. Reenviar depois de corrigir |
| `news-seguranca` | sinal da aplicação | 2 | (da regra) | A fila `news` falhou por um motivo de **segurança**, na primeira vez (a mesma linha `job_run falhou`, separada pelo `reason`): DTD ou declaração de entidade no feed, host ou redirecionamento fora da lista fixa de fontes, redirecionamentos demais, resposta ou ZIP grande demais, ZIP que não bate com o que declara (CRC32 ou tamanho) e arquivo da CVM que mudou de formato (cabeçalho sem uma coluna que o código lê). A fila não tem código de erro: a lista de trechos é `NEWS_SECURITY_MARKERS` (`alert-logs.ts`), e o spec força cada falha com o código de verdade. Quem não casa (rede, HTTP, XML quebrado) continua em `job-falhou`, da 3ª tentativa | Ler o `reason` da linha e o `job_run` (`SELECT error FROM job_run WHERE queue = 'news' AND status = 'FAILED' ORDER BY started_at DESC`). Feed com DTD ou redirecionamento para fora: tirar a fonte da lista (`sources.ts`) até entender; é sinal de feed comprometido, não de queda. Arquivo da CVM com formato novo: ajustar o leitor (`docs/DADOS.md`) |
| `filtro-de-vazamento` | sinal da aplicação | 2 | (da regra) | O filtro de vazamento achou trecho do prompt no que o modelo escreveu (`decision.leak_fields` não vazio; só nomes de campos na linha). **É sinal de segurança** | `pnpm --filter @alvesting/api cycle:show <data> <slug>`; conferir o Blob `llm-io` (o filtro já limpou o texto público); decidir se o prompt está comprometido (girar o `prompt-arena`, runbook da 3d) |
| `hold-por-falha-ou-resposta-invalida` | sinal da aplicação | 2 | (da regra) | Mais de 2 HOLD forçados por falha ou resposta inválida **em 15 minutos** (a janela da regra, e não o pregão inteiro: o elenco da Temporada 1 tem 6 modelos, e 3 de 6 juntos apontam causa comum, como provedor fora, esquema que mudou ou prompt quebrado; a causa comum faz os HOLDs caírem juntos). HOLDs de causas diferentes espalhados pelo pregão não se somam: o `falha` só é gravado na 3ª entrega, 30 minutos ou mais depois da 1ª. O ADR 0021 tirou da DLQ o modelo que só falha, e sem este alerta esse caso não tem sinal | `decision.hold_reason`, o status do OpenRouter, o meta do `llm-io`; `HOLD_FORCED_MAX_PER_SESSION` e o `holdMax` do Bicep mudam juntos se o elenco crescer |
| `email-da-conta` | sinal da aplicação | 2 | (da regra) | O envio da verificação ou da redefinição falhou (`e-mail da conta não enviado: <Nome>[:código]`; o descarte por repetição em 60 s tem outro texto e não conta) | Cota do Communication Services (domínio gerenciado: 5 por minuto e 10 por hora, `docs/CONTA.md`, seção 6), chave `acs-connection-string`. Quem não recebeu pede o reenvio no login |
| `aceite-nao-gravado` | sinal da aplicação | 2 | (da regra) | O usuário foi criado e o aceite dos termos não foi gravado (`aceite não gravado para o usuário <ULID>`) | O usuário fica sem aceite e as rotas que o exigem respondem 403; ele regulariza em `POST /api/v1/me/consents`. Ver o banco e o log da api |
| `eod-barras-ausentes` | sinal da aplicação | 2 | (da regra) | O `eod` concluiu o pregão no prazo das 00:30 de Brasília **sem o BOVA11 ou sem mais de 10% do conjunto obrigatório** (`barras do pregão ausentes: o eod concluiu sem o BOVA11 ou sem parte do conjunto obrigatório`; campos `date`, `missing`, `required` e os 20 primeiros tickers). Sai da regra de conclusão do `eod`, e não mais de uma "última tentativa sem o arquivo": o nome continua o do job | Ver a causa (a brapi fora do ar, a cota, o token) e esperar a janela de 5 pregões da noite seguinte; passado disso, `market:backfill --de/--ate`. RUNBOOK, seção 12.1; `docs/DADOS.md`, seção 7 |
| `brapi-cota-baixa` | sinal da aplicação | 2 | (da regra) | A cota restante da brapi (`RateLimit-Remaining`) chegou à reserva de 500 requisições (de 15 mil por 30 dias): o `BrapiClient` parou e deixou o resto como falta (`brapi: a cota restante chegou à reserva; a busca parou e o resto ficou como falta`; campos `remaining` e `reserve`). O `eod` reagenda e conclui no prazo com o que tem | Achar o consumo fora do plano (uns 7.900 por mês; carga em dobro, laço); a janela é móvel, então a cota volta sozinha em até 30 dias, ou trocar de plano. RUNBOOK, seção 12.2 |
| `barras-divergentes` | sinal da aplicação | 2 | (da regra) | A brapi trouxe, para um papel e um pregão que **já têm barra**, valor diferente do gravado (`barras divergentes: a brapi trouxe valor diferente do gravado e nada foi alterado`; campos `count` e `first`, com papel, data e campos). A barra gravada **não muda** | Conferir se é ajuste por provento ou desdobramento da brapi; evento corporativo já registrado? RUNBOOK, seção 12.3 |
| `ciclo-pulado` | sinal da aplicação | 2 | (da regra) | O `sched-cycle` pulou o ciclo do pregão e **nenhum modelo será chamado** (`sched-cycle: ciclo pulado, nenhum modelo será chamado`; campos `date`, `season` e `reason`): `orcamento` (o teto mensal de LLM, `ARENA_MONTHLY_COST_CAP_USD`, estourou ou não está configurado; o alerta de orçamento do Azure não vê o gasto do OpenRouter) ou `sem_briefing` (o `freeze` das 07:30 não rodou). Alerta na primeira vez; vale também para o reprocesso do admin, que reavalia o ciclo pulado | `orcamento`: `GET /admin/costs` (o acumulado do mês contra o teto), subir o teto (parâmetro `arenaMonthlyCostCapUsd`, deploy da fase 2) ou esperar o mês virar. `sem_briefing`: reenviar o `freeze` da DLQ e usar "Reprocessar um ciclo" no painel, só até 5 minutos antes das 09:30 (`docs/API.md`, seção 8) |
| `budget-alvesting` | orçamento (Cost Management) | n/a | mensal, 50, 80 e 100% | O gasto real passou de 50, 80 ou 100% do orçamento. O de 80% é o gatilho para trocar de perfil | Seção 6, "Parar o gasto", e a troca de perfil (8.1) |

**Limitações conhecidas (e o que as cobre).**

- *"Fila `decisions` com mensagens às 09:35".* O alerta de métrica do Azure Monitor não tem horário. A regra implementada é "a fila não esvaziou em 15 minutos" (`Minimum` de `ActiveMessages` > 0 em janela de 15): dispara por volta das 08:20 se a fila travar logo na abertura do ciclo, uns 70 minutos antes do prazo das 09:30,
  e cobre o 09:35 (depois do prazo uma execução grava o HOLD `prazo` em segundos, então mensagem ativa é sempre ciclo travado). **Por que 15 e não 5:** uma mensagem em processamento segue ativa, e o job tem até 25 minutos (`replicaTimeout` 1500 s, uma chamada chega a uns 23): com 5 minutos bastava o modelo de raciocínio mais lento passar de 5 para o alerta abrir às
  08:06 e só fechar depois, quase todo dia útil, no alerta que existe para o ciclo travado; o operador aprenderia a ignorá-lo. **O preço:** detecta em 20 minutos (1 + 15 + 4), a única exceção ao "em até 10" (ADR 0026), e ainda falsa-alarma com uma chamada legítima de mais de 15 minutos; na primeira semana da Temporada 1, se isso acontecer, subir para `PT30M` (detecta em 35 minutos,
  ainda 55 antes do prazo). Um alerta preso à hora exigiria um agendador a mais (o plano tem 7) ou uma linha de log do ciclo; a varredura (`CycleCloser`) não serve de linha, porque roda no `settle` do dia e no `sched-cycle` seguinte, e não 15 minutos depois do prazo.
- *Parada de produto sem sinal.* O `sched-cycle` que pula o ciclo (motivo `orcamento` ou `sem_briefing`) escreve a linha do sinal `ciclo-pulado` desde a etapa 10 (onda 3d), então a arena parada pelo teto de LLM deixou de ser silenciosa. **Ainda sem sinal:** um `job-sched-*` que termina com código diferente de 0 depois das 2 retentativas (não escreve `job_run` nem a linha de job falho) e a queda do `ca-web` no perfil econômico (sem Front Door). O `RUNBOOK.md` (onda 3d) diz o que olhar.
- *5xx do `/api/auth/*`.* Contam no `api-5xx` desde a onda 3d: a `AuthRoute` escreve a linha com `res.statusCode` (o `pino-http` não vê o Better Auth, que o Express atende antes dele). No padrão o `Percentage5XX` do Front Door também os vê.
- *O `eod` que nem chega a rodar* (agendador fora, KEDA sem acordar o worker) não escreve linha nenhuma, e `eod-barras-ausentes` não o vê. Quem o vê é o alerta da DLQ (depois de 10 entregas, uns 45 minutos) e a conferência do dia seguinte.
- *Sem a connection string nada alerta de aplicação*: o alerta de log lê o stdout dos contêineres, que o Container Apps manda ao Log Analytics com ou sem o Application Insights.
- A regra de log roda com a permissão de quem fez o deploy (sem identidade própria): uma identidade da regra viraria mais um leitor do workspace, que guarda o log do WAF com IP e URL (2.5). Se quem a criou perder o acesso ao workspace, a regra para de ver as linhas, e o Azure Monitor avisa
  só no histórico da regra. Refazer o deploy com outra pessoa corrige.
- A tabela `ContainerAppConsoleLogs_CL` só nasce quando o primeiro contêiner escreve no stdout, e a regra de log é criada na fase 1, antes dos apps: por isso ela vai com `skipQueryValidation: true`. Um erro de sintaxe na consulta só apareceria então na primeira avaliação.
  A consulta foi conferida offline em 02/11/2026 com o serviço de linguagem do Kusto (`@kusto/language-service-next` 12.4.1, fora do repositório), contra uma tabela com `TimeGenerated` e
  `Log_s`: 0 diagnósticos (e 5 numa cópia com `summarize` e `Log_s` trocados por erros de digitação, para provar que o conferidor enxerga). Revalidada em 03/11/2026, depois do nono sinal (`ciclo-pulado`): 0 diagnósticos, e a cópia com erros de digitação segue acusando 5. Mesmo assim, conferir uma vez no primeiro deploy,
  pelo histórico da regra ou colando a consulta (`infra/modules/alerts.bicep`) no Log Analytics. O `check.mjs` prova que a consulta é a escrita no teste (a lógica de cada sinal não muda sem querer), **não** que ela é válida para o Kusto:
  quem editar a consulta revalida a sintaxe e os tipos com o serviço de linguagem, que continua fora do repositório (um `devDependency` de uns 32 MB só para isso não pagou o custo).

### 5.4 Conferir na Azure (não feito: precisa da assinatura)

Nada disto rodou: a onda 3c não fala com a Azure. O aceite "a falha forçada chega por e-mail em até 10 minutos" fica para o primeiro deploy, um alerta por vez, cronometrando do gatilho ao e-mail:

1. O e-mail em si: portal, grupo de ações `ag-alvesting`, "Testar o grupo de ações" (ou `az monitor action-group test-notifications create`). Confere o endereço, a caixa de spam e o formato (esquema comum de alerta).
2. `alvesting-dlq-qualquer-fila`: publicar na fila `news` uma mensagem com o corpo `isto nao e json` (portal, Service Bus Explorer, "Send"). O worker a manda na hora para a DLQ (`invalid_json`, sem gastar entrega). Cronometrar até o e-mail; depois apagar a mensagem da DLQ e conferir o e-mail de resolvido.
3. `job-falhou`: publicar em `briefing` um `freeze` de um pregão futuro (`{"type":"freeze","date":"<próximo pregão>"}` com o corpo no formato de `packages/contracts`): o handler falha antes das 07:30 do dia, a linha do `job_run` fica `FAILED` e a linha de log sai. A fila repete 5 vezes e termina na DLQ (o alerta 2 também dispara).
4. `alvesting-front-door-origem-doente` e `-5xx`: desativar a revisão ativa do `ca-api` (`az containerapp revision deactivate`) por 10 minutos e restaurar.
   O `api-5xx` (e só ele, com a tela de erro do site em status 200) se prova parando o Postgres por uns 10 minutos (`az postgres flexible-server stop`; depois `start`) com o site no ar: as rotas de dados da api respondem 500, a sonda `/health` (que não consulta o banco) continua verde e o Front Door não mexe.
5. `alvesting-decisions-fila-parada`: publicar uma `decide` válida em `decisions` com as execuções do job impedidas de rodar, e esperar **20 minutos** (1 de frequência + 15 de janela + 4 de latência; a única exceção aos 10). Na primeira semana da Temporada 1, conferir se algum dia o alerta abriu com o ciclo saudável (chamada legítima de mais de 15 minutos): se sim, `PT30M`.
6. `eod-barras-ausentes`, `brapi-cota-baixa`, `barras-divergentes`, `news-seguranca`, `api-5xx`, `filtro-de-vazamento`, `hold-por-falha-ou-resposta-invalida`, `email-da-conta`, `aceite-nao-gravado` e `ciclo-pulado` acontecem no código, e o teste de cada um já força a falha e confere a linha (`*.spec.ts`; o do `news-seguranca` é o `telemetry.spec.ts`, uma falha de verdade por trecho; o do `api-5xx` é o `http-log.spec.ts`, uma resposta 500 de verdade; o do `ciclo-pulado` é o `cycle-schedulers.integration.spec.ts`, que pula o ciclo por orçamento e por falta de briefing). Na Azure basta conferir que a consulta
   acha uma linha de exemplo: `ContainerAppConsoleLogs_CL | where Log_s has "job_run falhou"` depois do passo 3, e colar a consulta de `alerts.bicep` no Log Analytics (precisa devolver uma linha por sinal).
7. Depois: `Usage | where TimeGenerated > ago(30d) | summarize GB = sum(Quantity) / 1024 by DataType` para medir o volume de verdade e comparar com 5.5.

### 5.5 Volume (os 5 GB por mês gratuitos) e amostragem

O Log Analytics dá 5 GB por mês por conta de cobrança ("The first 5 GB/month per billing account … are free", página de preços do Azure Monitor). A conta abaixo é uma estimativa, não uma medida: tamanhos de registro de 1,1 KB para requisição e
dependência (`AppRequests`, `AppDependencies`), 0,45 KB para métrica e para linha de console, 30 dias.

| Fonte | Hipótese | GB por mês |
|---|---|---|
| Requisições e consultas da api | 5 mil requisições por dia chegam à origem (o Front Door guarda as GET públicas por 300 s; o site lê direto a api), 1 requisição + 2,5 consultas cada. Pessimista: 20 mil por dia | 0,55 (pessimista 2,20) |
| Linhas de console da api | 1 linha por requisição | 0,06 (0,26) |
| Worker, decisões e agendadores | 288 mensagens `news` por dia (6 fontes × 48 slots) com ~8 consultas, mais `eod`, `settle`, `freeze`; 6 modelos × ~40 spans; `schedule news` a cada 30 min | 0,12 |
| Métricas | uma exportação por minuto, ~12 linhas, `ca-api` sempre ligado, worker ~40% do dia, jobs uma vez por execução | 0,32 |
| Linhas de início do Nest dos jobs | ~54 linhas por execução, ~58 execuções por dia | 0,04 |
| **Total** | | **≈ 1,1 (pessimista ≈ 2,9)** |

O teto da amostragem padrão da distribuição (5 traces por segundo por processo) não protege: sozinho permitiria uns 48 GB por mês. Quem protege é o filtro da sonda de saúde (sem ele, uns 9 GB por mês, supondo uma centena de pontos de presença do Front Door sondando a cada 30 s)
e o tráfego do TCC. **Gatilho para amostrar**: o Log Analytics passar de 2,5 GB por mês (metade da franquia) na medição do passo 7 acima; então baixar `tracesPerSecond` ou `samplingRatio` em `azureMonitorOptions()` (`telemetry/telemetry.ts`, comentário `ponytail`).
Também por volume o `requireParentSpan` do Postgres e o `requireParentforOutgoingSpans` das chamadas de saída deixam de fora a consulta e a chamada sem requisição ou mensagem por trás (renovação de token, por exemplo).

**Memória e partida da distribuição (medido na máquina de desenvolvimento com o `dist` compilado, fora da imagem e fora da Azure).** A api ociosa usou 252 MB de RSS sem a telemetria e 343 MB com ela (+91 MB) e ficou pronta em 1,7 s contra 5,7 s. O `ca-api` e os agendadores
têm 0,25 vCPU e 0,5 GiB, então sobram uns 170 MB de folga e o orçamento do probe de partida é de uns 55 s (`infra/modules/containerapps.bicep`). Não é defeito, mas nada nos testes cobre o risco de OOM ou de partida lenta no tamanho real do contêiner.
**No primeiro deploy**, medir o working set do `ca-api` (e de um agendador) e o tempo até o `/health` verde; se apertar, subir o `ca-api` para 1 GiB ou aumentar o `failureThreshold` do probe de partida.

### 5.6 Custo dos alertas (USD por mês, East US 2)

Preços da página oficial do Azure Monitor (`azure.microsoft.com/pricing/details/monitor/`, 02/11/2026; os valores vêm da API pública de preços de varejo do Azure, `prices.azure.com`, a mesma que alimenta a página):
alerta de métrica US$ 0,10 por série monitorada ao mês, as 10 primeiras grátis; alerta de log a cada 5 minutos US$ 1,50 por regra ao mês, mais US$ 0,15 por série (dimensão) adicional; e-mail grátis até 1.000 por mês.

| Item | Padrão | Econômico |
|---|---|---|
| Séries de métrica do Service Bus (DLQ das 6 filas, mais a `decisions`) | 6 + 1 | 6 + 1 |
| Séries de métrica do PostgreSQL (CPU e disco) | 1 + 1 | 1 + 1 |
| Séries de métrica do Front Door (2 origens; 5xx) | 2 + 1 | não existe |
| Total de séries, as 10 primeiras grátis | 12: 2 × 0,10 = **0,20** | 9: **0** |
| Regra de log (5 min), com 10 sinais a mais (são 11) | 1,50 + 10 × 0,15 = **3,00** | **3,00** |
| E-mail (até 1.000 por mês) | 0 | 0 |
| **Total dos alertas** | **≈ 3,20** | **≈ 3,00** |

(O orçamento, que já existia, é do Cost Management e não cobra.) O custo entra no plano 5.12 e na seção 9.

---

## 6. Subir do zero

Duas fases, porque o Container App **não sobe se o segredo que referencia não existe** e o Bicep não pode criar os segredos
do Artur (cada deploy sobrescreveria o valor real):

1. **Fase 1** (`deployApps=false writeDerivedSecrets=true deployBudget=true`): tudo, menos os apps. Os segredos derivados e o
   orçamento nascem aqui, e só aqui (seção 6.1).
2. **Semear** os segredos do Artur (o `prompt-arena` inclusive), **anotar a versão dele** e **publicar as imagens** (etapa 3),
   com o SHA do commit como tag.
3. **Fase 2** (os valores do `.bicepparam`, sem flags extras, mais as três entradas do passo 6: `ALVESTING_API_TAG`,
   `ALVESTING_WEB_TAG` e `ALVESTING_PROMPT_ARENA_VERSION`): `ca-web`, `ca-api`, worker, jobs e agendadores, e o papel de cada
   um em cada segredo que lê.

A pausa entre as fases também dá tempo para os papéis valerem (uma atribuição leva alguns minutos para propagar): o ACR, o
Service Bus, o Blob e o Azure OpenAI ficam na fase 1. Os papéis de **Key Vault** são a exceção: ficam na fase 2, no escopo de cada
segredo, porque os segredos do Artur só existem depois do seed e um papel não nasce no escopo de um segredo que não existe. Se a
primeira execução da fase 2 falhar com acesso negado ao Key Vault ou ao ACR, é o papel ainda propagando: espere uns minutos e
repita (seção 11).

### Passo 0: pré-requisitos (uma vez)

```bash
az login
az account set --subscription "<id da assinatura>"
az bicep version                       # 0.48.1 (az bicep install, se faltar)
# O ARM costuma registrar os provedores sozinho, mas nem sempre; registrar antes evita erro no meio do deploy.
for p in Microsoft.App Microsoft.Cdn Microsoft.CognitiveServices Microsoft.Communication Microsoft.Consumption \
  Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL Microsoft.Insights Microsoft.KeyVault \
  Microsoft.ManagedIdentity Microsoft.Network Microsoft.OperationalInsights Microsoft.ServiceBus Microsoft.Storage; do
  az provider register --namespace "$p" --wait
done

# Cada GUID de papel do infra/roles.bicep tem de ter, na assinatura, o nome que o comentário diz. Falhou: NÃO rode a fase 1
# (um GUID errado vira RoleDefinitionDoesNotExist no meio do deploy e derruba o cofre e tudo que depende dele).
infra/scripts/verify-roles.sh
```

### Passo 1: verificar o Bicep (sem Azure)

```bash
node infra/tests/check.mjs             # compila e confere os invariantes; precisa do Bicep CLI (seção 13)
```

### Passo 2: variáveis de ambiente (só no shell, nunca em arquivo)

Valem só para o shell em que você exportou; em cada terminal novo, exporte de novo antes de rodar o what-if ou o deploy.

```bash
# Senha do administrador do Postgres: guarde num gerenciador de senhas, o deploy pede a mesma sempre.
# "Aa1" no fim garante os 3 tipos de caractere que o Postgres exige.
export ALVESTING_PG_ADMIN_PASSWORD="$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-30)Aa1"
# Senha do login de menor privilégio da api (alvesting_api, ADR 0028): outra, pelo menos 32 caracteres (o db:roles e o Bicep recusam menos),
# e também no gerenciador de senhas. Só letras e números (sem '/', '+' e '=') para a URL do segredo não precisar de escape.
export ALVESTING_PG_API_PASSWORD="$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-40)"
export ALVESTING_BUDGET_EMAIL='voce@example.com'
export ALVESTING_ADMIN_PRINCIPAL_ID="$(az ad signed-in-user show --query id -o tsv)"
# A conta (docs/CONTA.md): quem é o controlador dos dados e o contato da política de privacidade. Valores seus, só no shell (nunca no
# repositório). A api recusa subir em produção sem os dois, então a fase 2 exige; a fase 1 não.
export ALVESTING_LEGAL_CONTROLLER_NAME='<nome de quem responde pelos dados>'
export ALVESTING_LEGAL_CONTACT_EMAIL='<e-mail de contato da privacidade>'
# Opcional: o client ID do Google (não é segredo). Sem ele não há login por Google, e nada quebra.
export ALVESTING_GOOGLE_CLIENT_ID=''
```

A senha do administrador também fica dentro do segredo `database-url`, e a do login da api, dentro do `database-url-api`, caso seja preciso recuperá-las (o
`az keyvault secret show` lê o valor e deixa a leitura no `AuditEvent`). As duas são exigidas em TODA execução da infra, a fase 1 e a rotina, como a trava de
tamanho do módulo do banco prova (seção 2.1); o valor da rotina só não vai a lugar nenhum, porque a rotina não regrava segredo. Das outras entradas dos `.bicepparam`,
`ALVESTING_PROMPT_ARENA_VERSION`, `ALVESTING_API_TAG` e `ALVESTING_WEB_TAG` só existem depois do seed e da publicação das
imagens (passos 4 a 6), e a fase 1 não precisa delas.

### Passo 3: resource group e fase 1

```bash
az group create --name rg-alvesting-prod --location eastus2

# Prévia (cria tudo, menos os apps):
az deployment group what-if --resource-group rg-alvesting-prod --name alvesting \
  --parameters infra/main.prod.bicepparam deployApps=false writeDerivedSecrets=true deployBudget=true

az deployment group create --resource-group rg-alvesting-prod --name alvesting \
  --parameters infra/main.prod.bicepparam deployApps=false writeDerivedSecrets=true deployBudget=true
```

Para o econômico, acrescente `profile=economico`. Em dev: `rg-alvesting-dev` e `infra/main.dev.bicepparam`.
O Postgres leva uns 10 minutos. Se a Azure recusar o Postgres na região ("location is restricted"), veja a seção 11.

`deployBudget=true` cria o orçamento, e a Azure só aceita `budgetStartDate` no mês corrente (data passada dentro do mês) ou em
um dos 12 meses seguintes. O arquivo traz `2026-11-01`, que vale em novembro de 2026; em outro mês, acrescente
`budgetStartDate=AAAA-MM-01` com o primeiro dia do mês corrente.

O cofre de produção nasce com **proteção contra purge e retenção de 90 dias, e nenhum dos dois volta atrás**. Confira os
valores do `.bicepparam` antes do primeiro deploy.

### Passo 4: semear os segredos do Artur

Espere uns 5 minutos pelo papel Key Vault Secrets Officer e rode:

```bash
infra/scripts/seed-secrets.sh kv-alvesting            # em dev: kv-alvesting-dev
```

O script pergunta (sem eco) os valores que faltam; sem valor, o segredo fica `PENDENTE`. Os prompts vêm de arquivo fora do
repositório: `ALVESTING_SECRET_PROMPT_ARENA_FILE=~/segredos/prompt-arena.txt` (idem `..._PROMPT_CHAT_FILE`). Rodar de novo
só preenche o que ainda falta; nunca sobrescreve valor real. O cabeçalho do script lista todas as variáveis. O script só lista
metadado (nome e tag) do cofre: nunca baixa o valor de um segredo.

**O `prompt-arena` é obrigatório antes da fase 2** (o job de decisões o referencia, e a Azure não cria o job sem o segredo).
Na Temporada 0, com provedores fake, serve um arquivo qualquer; o prompt de verdade é outra versão do mesmo segredo (e outro
deploy da fase 2, com a versão nova). O `prompt-chat` só é preciso para ligar o chat (seção 8.3).

Anote a **versão do `prompt-arena`**, que a fase 2 exige e fixa no job de decisões. A consulta lista as versões (metadado, não
baixa o valor) e fica com a mais recente habilitada:

```bash
export ALVESTING_PROMPT_ARENA_VERSION="$(az keyvault secret list-versions --vault-name kv-alvesting --name prompt-arena \
  --query 'sort_by([?attributes.enabled], &attributes.created)[-1].id' -o tsv | sed 's#.*/##')"
echo "$ALVESTING_PROMPT_ARENA_VERSION"      # 32 caracteres hexadecimais; em dev: kv-alvesting-dev
```

### Passo 5: imagens

Publicadas pelo pipeline da etapa 3 (`alvesting-api` e `alvesting-web`) no ACR `cralvesting` (padrão) ou no GHCR (econômico),
com o **SHA do commit** como tag: não existe `latest` (`docs/DEPLOY.md`, "Primeiro deploy", passo 5). Anote o SHA. Sem imagem não
há fase 2.

### Passo 6: fase 2

Antes de usar imagens reais, a trava de origem da etapa 3 tem de estar pronta e testada (seção 3.3). Os valores do `.bicepparam`
são o regime de rotina, então não há flags extras; só as três entradas que não têm valor padrão:

```bash
export ALVESTING_API_TAG='<sha>'                # o SHA publicado no passo 5 (as duas imagens usam o mesmo)
export ALVESTING_WEB_TAG='<sha>'
# ALVESTING_PROMPT_ARENA_VERSION já foi exportada no passo 4 (e as três do passo 2 também)

az deployment group what-if --resource-group rg-alvesting-prod --name alvesting --parameters infra/main.prod.bicepparam
az deployment group create  --resource-group rg-alvesting-prod --name alvesting --parameters infra/main.prod.bicepparam
```

Sem as três a Azure para antes de criar os apps (a tag vazia ou a versão que não tem 32 caracteres reprova o módulo dos apps).
Também dá para passá-las na linha de comando, no mesmo `--parameters`: `... infra/main.prod.bicepparam apiImageTag=<sha>
webImageTag=<sha> promptArenaVersion=<versão>` (o que o `docs/DEPLOY.md` faz); o `chave=valor` vence o ambiente.

Depois, as migrations **e o login da api no banco** (o `job-migrate` roda o `migrate deploy` e, se deu certo, o `db:roles`; até a execução terminar o `ca-api` sobe mas
as rotas que consultam o banco falham com `password authentication failed`, porque o login `alvesting_api` ainda não existe) e a conferência:

```bash
az containerapp job start --resource-group rg-alvesting-prod --name job-migrate
az containerapp job execution list --resource-group rg-alvesting-prod --name job-migrate -o table
# o log da execução termina com "login alvesting_api pronto: membro de alvesting_api_group, statement_timeout de 10 s, limite de 24 conexões"

SITE="$(az deployment group show -g rg-alvesting-prod -n alvesting --query properties.outputs.siteUrl.value -o tsv)"
curl -fsS "$SITE/health" && curl -fsS "$SITE/api/v1/health"   # no econômico a api está no output apiFqdn
```

### Passo 7: o what-if da segunda execução (aceite)

A revisão do Container Apps é definida pelo template, e o pipeline troca a imagem por fora dele. Se a infra rodar com outra tag
que não a do SHA que está no ar, ela **reverte** o que o pipeline publicou. Por isso o what-if do aceite (e toda execução da
infra depois do primeiro deploy) repete as tags **que estão no ar**, e não as do passo 6. O jeito é o do pipeline: ler a imagem
da revisão que tem o tráfego (e não a do template do app, que depois de um rollback ainda guarda a imagem que falhou) e passar
as duas tags no mesmo `--parameters`:

```bash
# O current-tags imprime apiImageTag=<tag> e webImageTag=<tag> (os avisos vão para o stderr). Sem aspas de propósito: são duas palavras.
az deployment group what-if --resource-group rg-alvesting-prod --name alvesting \
  --parameters infra/main.prod.bicepparam $(RESOURCE_GROUP=rg-alvesting-prod node scripts/deploy.mjs current-tags)
```

O que o `ci.yml` faz no what-if do PR, com o mesmo script. Duas ressalvas: antes da fase 2 não há app e o `current-tags` devolve
`latest`, que não existe no ACR (use o SHA do passo 5); e a tag da api vale também para o worker, as decisões, os agendadores
e o migrate (uma imagem só): o pipeline os leva para a tag nova depois do `ca-api` e do `ca-web` (`roll-roles`), então um
what-if feito no meio de um deploy mostra os jobs mudando de tag, o que não é defeito.

A **versão do prompt** também tem de ser a que está no ar: o job de decisões a guarda na variável (texto puro) `PROMPT_ARENA_VERSION`,
e o what-if a lê dali. As entradas do passo 2 são as mesmas de sempre (em terminal novo, exporte de novo):

```bash
export ALVESTING_PROMPT_ARENA_VERSION="$(az containerapp job show -g rg-alvesting-prod -n job-worker-decisions \
  --query "properties.template.containers[0].env[?name=='PROMPT_ARENA_VERSION'].value | [0]" -o tsv)"
```

Tem de mostrar **"No change"** em todos os recursos. Veja na seção 7 o que olhar se aparecer alguma coisa.

### 6.1 Quando passar `writeDerivedSecrets=true` e `deployBudget=true`

Os `.bicepparam` valem `false` para os dois (rotina). Ligue só nestes casos:

| Situação | Flags na linha de comando |
|---|---|
| Fase 1 (primeiro deploy) | `deployApps=false writeDerivedSecrets=true deployBudget=true` |
| Girar a senha do **administrador** do Postgres (8.2) | `writeDerivedSecrets=true` (regrava os segredos derivados com o mesmo valor, menos o `database-url`, que muda; os apps reiniciam). A do login da api (8.2) não precisa do flag: grava-se o `database-url-api` direto |
| Ligar o Azure OpenAI (8.3) | `enableOpenAI=true` (nenhum segredo derivado: a conta não tem chave; o `prompt-chat` precisa existir antes) |
| Passar do econômico para o padrão (8.1) | `profile=padrao writeDerivedSecrets=true` (o `front-door-id` nasce agora) |
| Mudar o valor do orçamento | `deployBudget=true budgetAmount=<novo> budgetStartDate=<primeiro dia do mês corrente>` |
| Qualquer outro (CI, what-if do aceite, réplicas, tag de imagem, versão do prompt, domínio próprio) | nenhuma: os valores do `.bicepparam` |

Esquecer `writeDerivedSecrets=true` na fase 1 ou ao passar para o padrão dá erro no deploy (o segredo que o app referencia não
existe). **Na troca da senha o deploy passa**, mas o `database-url` fica com a senha velha e os apps perdem o banco: nesse caso
o flag é obrigatório. Passá-lo à toa não quebra nada, só reinicia os apps.

### Passo 8: domínio próprio e DNS (opcional)

Seção 8.4.

### Parar o gasto

O orçamento avisa; ele não desliga nada. Para economizar: trocar para `economico` (seção 8.1) e apagar o perfil do Front Door
(`az afd profile delete`). Em dev, `az group delete --name rg-alvesting-dev` apaga tudo (destrutivo; só em dev).

---

## 7. Idempotência e what-if

### 7.1 O que está garantido (e o `check.mjs` confere)

- Nenhum `utcNow`, `newGuid`, `dateTimeAdd` ou script de implantação no template. A data do orçamento é parâmetro fixo.
- Nomes de atribuição de papel são `guid()` de IDs de recurso (estáveis). Nomes de recurso vêm de parâmetros e constantes.
- **O what-if consegue olhar dentro dos módulos.** Todo módulo recebe os nomes dos recursos que lê (`names.*`) como constantes, e
  a ordem vem de `dependsOn` explícito; um nome vindo de saída de módulo é valor de tempo de execução e faria o what-if
  "curto-circuitar" (previsão imprecisa), sem poder mostrar "No change". A regra `what-if-short-circuiting` do linter está em erro
  no `infra/bicepconfig.json`, então voltar a passar saída de módulo como nome quebra o build. O `check.mjs` lê o `dependsOn`
  do template compilado e afirma a ordem (Service Bus, Storage e ACR depois das identidades, apps depois do banco, do e-mail,
  do ACR etc.) e, dentro do módulo dos apps, que todo app e job espera pelos papéis de segredo (`secretAccess`): sem isso o
  ARM cria o app junto com o papel e a referência ao Key Vault é recusada na criação.
- **A rotina não regrava nada que a Azure versione ou recuse:** `writeDerivedSecrets=false` e `deployBudget=false` nos
  `.bicepparam`. O `check.mjs` prova que a rotina é o primeiro deploy menos exatamente os segredos derivados e o orçamento.
- O Bicep **não cria nenhum segredo do Artur**, só os 4 derivados (e só quando `writeDerivedSecrets=true`).
- Os apps não carregam valor secreto, então não há nada que mude por causa de segredo girado. A exceção deliberada é o
  `prompt-arena`, fixo numa versão: trocá-lo é um deploy, e o what-if mostra.

### 7.2 O que só o what-if real mostra (não verificado, precisa da assinatura)

Pontos a olhar na primeira vez que o what-if da segunda execução rodar contra a Azure:

- Propriedades que a Azure só aceita e não devolve (`sharedKey` do ambiente, `value` dos segredos, senha do Postgres) podem
  aparecer como "Modify" sem mudança real. O que importa é a lista de recursos com `Create` ou `Delete`.
- **Segredos derivados:** regravar o mesmo valor cria, em geral, uma **nova versão** no Key Vault (relato da comunidade; não
  verificado aqui). A documentação do Container Apps confirma a consequência: sem versão na referência, o app pega a nova em até
  30 minutos e **reinicia as revisões ativas** que a usam em variável de ambiente, o que derrubaria `ca-web` e `ca-api` (mínimo
  de 1 réplica) e os fluxos SSE a cada execução da infra. Por isso a rotina não os escreve (`writeDerivedSecrets=false`, seção 6.1).
  Se o what-if da rotina ainda listar os segredos, algum módulo os declara fora da condição.
- Orçamento (`currentSpend` e afins) e o VNet (campos de associação criados pelo Container Apps e pelo Postgres). Na rotina o
  orçamento nem entra no template (`deployBudget=false`).
- **Papéis no escopo de segredo** (os de todos os workloads, ~20): confirmar que o what-if os lista como `Create` só na fase 2 e
  como "No change" depois. O que o what-if também não resolve é se o papel no escopo de um segredo **semeado pelo plano de dados**
  (`az keyvault secret set`) é aceito pelo ARM: veja a seção 11.
- **Diagnostic settings** do cofre e do Front Door: a API é preview (`2021-05-01-preview`); o what-if pode mostrar `Modify` por
  propriedade que a Azure acrescenta (categorias com `enabled: false`) sem mudança real.

### 7.3 Interação com o CD (etapa 3): a tag que está no ar

A revisão do Container Apps é definida pelo template, e o pipeline publica por `az containerapp update`. Se alguém rodar a infra
com a tag de um commit antigo, ou com `latest` (a tag que o pipeline nunca publica), **a infra reverte a revisão**. Por isso os
`.bicepparam` **não têm tag**: `apiImageTag` e `webImageTag` vêm de `ALVESTING_API_TAG` e `ALVESTING_WEB_TAG` (ou de
`--parameters apiImageTag=<sha> webImageTag=<sha>`), sem valor padrão, e o módulo dos apps exige `@minLength(1)`. Nada fica apontado
para uma tag que pode ser sobrescrita no registro (cadeia de suprimentos: quem tem push no ACR reescreveria `latest`). A tag é
sempre o SHA do commit que o pipeline publicou.

**Como repetir a tag que está no ar** (o what-if da segunda execução e toda execução da infra depois do primeiro deploy): passo 7
da seção 6. O `node scripts/deploy.mjs current-tags` lê da revisão que tem o tráfego, e o resultado vai no mesmo `--parameters`.

O Bicep não declara `ingress.traffic`, para não brigar com a divisão de tráfego por label (blue/green, etapa 10). Com o modo
`Multiple`, uma revisão nova **não desativa as antigas**: elas ficam rodando (com as réplicas mínimas) até alguém desativá-las.
O pipeline da etapa 3 desativa as antigas depois do smoke (`cleanup`), senão o custo dobra a cada deploy.

---

## 8. Operação

Os procedimentos de operação (reprocessar o ciclo, reenviar a DLQ, girar segredo, restaurar backup, voltar revisão, o primeiro admin, a cota de e-mail e o crédito) estão em [docs/RUNBOOK.md](RUNBOOK.md). Os comandos desta seção são os que ele referencia.

### 8.1 Trocar de perfil

Altere `profile` no `.bicepparam` (ou use `--parameters profile=...`) e rode o deploy. Padrão para econômico **não apaga** o Front Door, o WAF nem o ACR: o Bicep é
incremental. Apague à mão (`az afd profile delete`, `az acr delete`) depois de conferir que o tráfego já vai direto ao
ingress, e mude o DNS. Econômico para padrão cria o ACR e o Front Door; publique as imagens no ACR antes. As imagens trocam de
GHCR para ACR, então haverá uma revisão nova de tudo. Para o padrão, passe também `writeDerivedSecrets=true` (nasce o
`front-door-id`, que `ca-web` e `ca-api` referenciam); a trava de origem da etapa 3 precisa estar pronta (seção 3.3).

### 8.2 Girar a senha do Postgres

Gere outra, exporte `ALVESTING_PG_ADMIN_PASSWORD` e rode o deploy com `--parameters writeDerivedSecrets=true`. O mesmo deploy
troca a senha do servidor e o `database-url`. **Sem o flag o servidor muda de senha e o `database-url` não**, e os apps perdem o
banco. Os apps pegam o segredo novo em até 30 minutos (ou reinicie a revisão); como o flag regrava também os outros segredos
derivados, eles reiniciam uma vez.

**A senha do login da api** (`alvesting_api`, etapa 10, onda 3d e parte 4) gira à parte, sem tocar no administrador e **sem o `writeDerivedSecrets`** (que regravaria todos os derivados e reiniciaria todos os
apps à toa). A ordem, por inteiro (a senha nova é uma das duas pontas: o segredo no cofre e o login no banco, e a ordem abaixo deixa a janela de erro mais curta possível):

```bash
RG=rg-alvesting-prod; KV=kv-alvesting
umask 077; F="$(mktemp)"; trap 'rm -f "$F"' EXIT          # arquivo só do dono, apagado ao sair: a URL leva a senha
# 1. a senha nova (guarde-a no gerenciador de senhas ANTES de seguir) e o segredo database-url-api com ela
NOVA="$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-40)"
SERVER="$(az postgres flexible-server show -g $RG -n psql-alvesting --query fullyQualifiedDomainName -o tsv)"
printf 'postgresql://alvesting_api:%s@%s:5432/alvesting?sslmode=require' "$NOVA" "$SERVER" > "$F"
az keyvault secret set --vault-name $KV --name database-url-api --file "$F" --encoding utf-8 -o none
# 2. o job-migrate troca a senha NO BANCO, na hora (o migrate deploy não tem nada a migrar; o db:roles lê a versão nova do segredo)
az containerapp job start -g $RG -n job-migrate
az containerapp job execution list -g $RG -n job-migrate -o table        # espere Succeeded
# 3. reinicie a(s) revisão(ões) ativa(s) do ca-api LOGO EM SEGUIDA, sem esperar a atualização sozinha do cofre (até 30 minutos)
for r in $(az containerapp revision list -g $RG -n ca-api --query "[?properties.active].name" -o tsv); do
  az containerapp revision restart -g $RG -n ca-api --revision "$r"
done
```

Depois, atualize a `ALVESTING_PG_API_PASSWORD` do seu gerenciador de senhas: a próxima execução da infra com `writeDerivedSecrets=true` (fase 1, giro da senha do administrador) regrava o `database-url-api` com o valor dela, e uma
senha velha ali desfaria o giro. (Pelo Bicep também dá: exporte a senha nova e rode com `writeDerivedSecrets=true`; só que ele regrava todos os derivados e reinicia todos os apps. O resto da ordem é o mesmo.)

**Há uma janela de erro, e ela é aceita.** Do passo 2 até a réplica ler o segredo novo (sozinha, só em até 30 minutos; ou no reinício do passo 3), a réplica ainda tem a senha antiga no ambiente: as conexões que o pool dela já tem abertas
seguem até fechar, mas **cada conexão NOVA** (o pool cresce, uma conexão ociosa recicla) falha a autenticação (`password authentication failed`), e a requisição que a pediu responde 5xx; o `api-5xx` pode alertar. Sem o reinício seriam até
30 minutos disso; com ele, alguns segundos. Faça fora do ciclo das 08:00 às 09:30 e da liquidação da noite. Se o passo 3 vier antes do 2 (ou o job falhar), é o contrário: a réplica reinicia com a senha nova e o banco ainda tem a
velha, e a api não conecta até o `db:roles` rodar; rode o job de novo. **Não verificado na Azure:** se o `job start` lê a versão nova do cofre (o Container Apps resolve a referência quando a execução começa), e se o reinício da
revisão já lê a versão nova ou espera a atualização de até 30 minutos (a documentação diz que, ao mudar segredos, é preciso reiniciar as revisões ativas; se esperar, os 5xx seguem até a atualização chegar, e o log da api mostra
`password authentication failed`). ponytail: giro SEM janela pede dois logins alternados (`alvesting_api_a` e `alvesting_api_b`, o segredo apontando para um enquanto o outro troca de senha); não vale o custo para o tamanho do
projeto. O [RUNBOOK](RUNBOOK.md), seção 4.3, herda esta ordem.

### 8.3 Ligar o Azure OpenAI

Só depois do aval do orientador (plano §12). Confira o catálogo e a cota **do tipo `DataZoneStandard`** (o tipo da implantação,
abaixo) (`az cognitiveservices usage list --location eastus2`, `az cognitiveservices model list --location eastus2`), ajuste
`openaiModelName`/`openaiModelVersion`/`openaiCapacity`, semeie o `prompt-chat` (passo 4) e rode com `--parameters
enableOpenAI=true` (a fase 2 inteira, com as tags do ar: passo 7). Não há `writeDerivedSecrets`: a conta **não tem chave**.

- O módulo cria a conta com `disableLocalAuth: true` (autenticação por chave desligada), o deployment `chat` e o papel Cognitive
  Services OpenAI User **só** para a `id-alvesting-api`. A api ganha `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` e
  `PROMPT_CHAT` (referência ao `prompt-chat`). Não existem o segredo `azure-openai-key` nem `AZURE_OPENAI_API_KEY`: o código usa o
  `DefaultAzureCredential` com o escopo `https://cognitiveservices.azure.com/.default`.
- O tipo da implantação é `DataZoneStandard`: o prompt e a resposta são processados só dentro da zona de dados dos EUA (a
  documentação da Microsoft, "Deployment types", de 01/11/2026: nos tipos *Data Zone* o serviço processa apenas dentro da zona
  especificada). O `GlobalStandard` processa em qualquer região da Azure, e o chat envia a carteira do usuário; o §12 do plano
  e a política de privacidade informam a transferência para os EUA (art. 33 da LGPD), não para o mundo. O dado em repouso fica
  em East US 2 em todos os tipos. `gpt-4.1-mini` aparece com Data Zone Standard no catálogo da Microsoft; a disponibilidade em
  East US 2 e a cota só a assinatura confirma.
- Sem cota, o deploy do modelo falha: deixe `false` e decida a troca de provedor antes da etapa 13 (plano §11).

### 8.4 Domínio próprio e DNS (perfil padrão)

Com `customDomain=alvesting.com.br`, o Bicep cria o domínio no Front Door com certificado gerenciado e o liga às três rotas e ao
WAF. Depois do deploy, no DNS: um `CNAME` do domínio para o host do endpoint (output `edgeHostname`) e o `TXT`
`_dnsauth.<domínio>` com o token que o Front Door mostra
(`az afd custom-domain show --resource-group rg-alvesting-prod --profile-name afd-alvesting --custom-domain-name site --query validationProperties`).
O certificado sai depois da validação. **Perfil econômico:** domínio próprio no ingress do Container Apps não foi
implementado nesta etapa (seção 14).

### 8.5 Disparar um agendador à mão

Veja `docs/JOBS.md`.

### 8.6 Rodar um comando pontual no banco privado (`account:promote`, `account:demote`...)

O Postgres é privado: o `account:promote`, o `account:demote` e os outros comandos da imagem (`dist/*-cli.js`) não rodam da máquina de quem opera. O caminho é **uma execução do `job-migrate` com outro
comando**. Ele já é manual, está na sub-rede com o banco e recebe o `database-url` por referência ao cofre (`secretRef`), e a imagem da api já traz os comandos. Não foi preciso criar um job novo no Bicep (a alternativa,
se isto não funcionar na assinatura, seria um job manual mínimo ao lado do `job-migrate`).

**O que a documentação diz** (Learn, "Jobs in Azure Container Apps", seção "Start a job execution on demand"; referência de `az containerapp job start`; lidas em 02/11/2026): ao iniciar uma execução dá para
trocar o modelo do job (imagem, comando, argumentos, variáveis), e a troca vale só para aquela execução. **Mas, ao trocar, "the job's entire template configuration is replaced with the new configuration. Ensure
that the new configuration includes all required settings."** A CLI tem `--command`, `--args`, `--env-vars`, `--image`, `--container-name`, `--cpu` e `--memory`, e o código dela (`start_containerappsjob`) monta, só
com `--command` e `--args`, um contêiner **sem imagem e sem variáveis**: com o modelo substituído por inteiro, o `DATABASE_URL` se perderia e o comando falharia na validação do ambiente. Por isso o caminho que a
documentação mostra é o do arquivo: pegar o modelo atual, mudar só o comando e iniciar com `--yaml`.

```bash
RG=rg-alvesting-prod
# 0. um arquivo temporário só do dono (0600), apagado ao sair: o modelo leva o e-mail do operador e o desenho do job, e /tmp é de todos
umask 077
F="$(mktemp)"; trap 'rm -f "$F"' EXIT
# 1. o modelo atual do job (imagem, recursos e variáveis, com o DATABASE_URL por segredo)
az containerapp job show -g $RG -n job-migrate --query properties.template -o yaml > "$F"
# 2. edite "$F": troque só o comando e os argumentos do contêiner `migrate`, e deixe o resto como veio
#      command:                          (a lista inteira vira esta)
#      - node
#      args:
#      - dist/account-cli.js
#      - promote
#      - <o e-mail da conta de operador, já verificada, e com o login conferido (ver "Antes do promote", abaixo)>
# 3. inicia a execução com o modelo trocado
az containerapp job start -g $RG -n job-migrate --yaml "$F"
az containerapp job execution list -g $RG -n job-migrate -o table
# 4. o resultado ("conta <ULID> promovida a admin") sai no log da execução (docs/JOBS.md, seção 6); o arquivo some ao sair do shell (trap)
```

| O quê | `command` / `args` do contêiner |
|---|---|
| Promover a admin | `node` / `dist/account-cli.js promote <e-mail>` |
| Rebaixar (e encerrar as sessões) | `node` / `dist/account-cli.js demote <e-mail>` |
| Ver um ciclo | `node` / `dist/arena-cli.js cycle-show <AAAA-MM-DD>` |
| Iniciar uma temporada | `node` / `dist/arena-cli.js season-start <id>` (o painel faz o mesmo: `PATCH /admin/seasons/:id`) |
| Registrar um evento corporativo | `node` / `dist/settlement-cli.js event <TICKER> <AAAA-MM-DD> <tipo> <de:para>` (o painel também) |
| **SQL pontual** (por exemplo, o `UPDATE` do `eod` em espera ao voltar uma revisão, `docs/DEPLOY.md`, seção 6) | `sh` / `-c` e, como **segundo argumento (um item só da lista `args`)**, `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "UPDATE job_run SET status = 'FAILED' WHERE status = 'WAITING'"` (no YAML do modelo é um escalar simples, sem escape; conferido com um `psql` de mentira: ele recebe a URL, `-v ON_ERROR_STOP=1`, `-c` e o SQL como um argumento só). O `psql` 17 vem com o `postgresql-client-17` da imagem (seção 2.8); o `DATABASE_URL` do job é o login **administrador**: só o que o RUNBOOK mandar. Não verificado na Azure |
| **Criar uma temporada** | **não por aqui**: o arquivo JSON do `season:create` não está na imagem. Na Azure é `POST /api/v1/admin/seasons` (o painel `/admin`, "Nova temporada") com o mesmo arquivo |

Só o **primeiro admin** (e o rebaixamento de um) precisam deste caminho; o resto se faz pelo painel (`docs/TELAS.md`, seção 8) depois de entrar com a conta promovida.

Cuidados:

- **Quem pode iniciar um job pode ler os segredos dele.** A documentação avisa: o modelo da execução aceita variáveis e imagem, e quem tem `Microsoft.App/jobs/start/action` e sabe o nome de um segredo (`database-url`) pode lê-lo dentro
  de um contêiner que escolher. Dê o papel de iniciar (Container Apps Jobs Operator ou Contributor) só a quem já é de confiança para o banco; hoje é o operador, o Artur.
- **O e-mail do operador fica no histórico de execuções do job** (o modelo da execução vai na resposta de `az containerapp job execution list/show`), visível a quem lê o grupo de recursos. É o e-mail do próprio operador,
  e a saída do comando nunca o repete; o resultado e a auditoria (`audit_log`) levam só o ULID, mais o nome da execução (`execution`), que liga a linha a quem a iniciou no log de atividade.
- **Antes do `promote`, entre no site com a SUA senha.** Promover pede e-mail já verificado, mas isso não prova que a conta é sua: se alguém cadastrou o seu e-mail antes de você, o e-mail de verificação
  dele chega na SUA caixa, e abri-lo (achando que é o seu) verifica a conta dele. O seu cadastro depois devolve um 200 genérico, sem conta nova e sem e-mail (o repositório é público, e o e-mail do dono pode estar no histórico do git).
  Então: crie a conta no site, confirme o e-mail, **faça login com a senha que você escolheu** e só então rode o comando. Se o login responder 401, a conta é de outra pessoa: use "Esqueci a senha"
  (isso revoga as sessões dela), entre de novo e só então promova. O comando lembra disso na saída; se promoveu a conta errada, o `account:demote` desfaz e encerra as sessões.
- **Não verificado na Azure** (nada rodou na assinatura): o `job start --yaml` com o modelo trocado, a variável `CONTAINER_APP_JOB_EXECUTION_NAME` na execução (está na documentação) e o log do resultado. Faça o primeiro com
  a conta de operador e confira a execução (`Succeeded`) e o `audit_log` (`account.promoted`, com `execution`).

---

## 9. Custos (do plano, §5.12; USD por mês)

| Item | Padrão | Econômico |
|---|---|---|
| Front Door Standard | ~35 | 0 |
| Container Apps | 12–16 | 1–3 |
| PostgreSQL B1ms + 32 GB | ~16 | 0 se a franquia de 12 meses valer, senão ~16 |
| Service Bus Basic, ACR Basic, Storage, Key Vault, DNS privado, e-mail | ~8 | ~3 |
| Log Analytics / App Insights (ingestão dentro dos 5 GB grátis, seção 5.5) | 0–3 | 0 |
| Alertas do Azure Monitor (seção 5.6: 1 regra de log e 9 a 12 séries de métrica) | ~3,2 | ~3,0 |
| **Total Azure** | **≈ 72–83** | **≈ 5–10** (≈ 21–26 sem a franquia do Postgres) |

Com os US$ 100 do Azure for Students, o padrão dura cerca de 5 semanas (e o econômico, de 10 meses a mais de um ano). O alerta de 80% do orçamento é o gatilho para
trocar de perfil.

---

## 10. Decisões desta etapa

As do plano estão em `docs/adr/`. Estas nasceram ao escrever o Bicep e ao aplicar as revisões de correção e de segurança. A linha
da **identidade por workload** abaixo **desvia do §5.3 do plano**, que previa uma identidade só para tudo; o §5.3 do `PLANO.md`
aponta para o ADR 0020 (`docs/adr/0020-uma-identidade-por-workload-segredo-a-segredo.md`), onde a decisão está completa. As
demais não mudam o plano.

| Decisão | Por quê |
|---|---|
| Deploy em duas fases (`deployApps`) | Container App não sobe sem o segredo; o Bicep não cria os do Artur. Uma flag resolve e dá tempo aos papéis de propagar |
| `parallelism: 1` e `maxExecutions: 10` no job de decisões | O "paralelismo 10" do plano é 10 execuções simultâneas; `parallelism` do Container Apps é réplicas por execução |
| **Uma identidade por workload** (web, api, worker, decisions, sched, migrate) **e a do KEDA**, em vez de uma (**desvio do §5.3**, ADR 0020) | Um RCE no `ca-web` (o único exposto rodando o Next), na api ou no worker não pode ler o prompt da arena nem a chave do OpenRouter. Cada workload lê só os segredos dele, com o papel no escopo do segredo; e recebe só os papéis de Service Bus, Blob, ACR e purge que o código dele usa |
| Papéis de Key Vault no escopo de cada segredo, criados na fase 2 (`secret-access.bicep`) | Menor escopo possível. Ficam na fase 2 porque os segredos do Artur só existem depois do seed e um papel não nasce no escopo de um segredo que não existe. O custo: a primeira execução da fase 2 pode esbarrar na propagação do papel (seção 11) |
| `identitySettings` com `lifecycle: None` para as identidades do `ca-web`, do `job-migrate` e do KEDA | São da plataforma (pull de imagem, referência de segredo, regra de escala); com `None` o código do container não consegue token delas. Documentado pela Microsoft para esses usos; não testado na Azure |
| Prompt da arena por referência ao Key Vault (`PROMPT_ARENA`, versão fixa) e a versão em `PROMPT_ARENA_VERSION` | O código lê `process.env`, sem SDK do Key Vault; o texto só existe no cofre. A versão fixa faz o conteúdo ser o mesmo até o próximo deploy e dá ao banco o que registrar ao lado do SHA-256. O ADR 0011 continua valendo (ele descartava o valor literal no template) |
| `id-alvesting-scale` sem interruptor (antes era `grantServiceBusOwner`) | O KEDA com identidade provavelmente precisa de Manage na fila (seção 11). O primeiro deploy já nasce com o papel certo, sem ligar nada; se o KEDA acordar só com Receiver, a identidade e a atribuição saem |
| Azure OpenAI sem chave (`disableLocalAuth`) e com `DataZoneStandard` | A revisão de segurança: a chave ficava no cofre e no ambiente da api, e o `GlobalStandard` processa em qualquer região da Azure enquanto o chat envia a carteira do usuário e o §12 informa a transferência para os EUA. `DataZoneStandard` processa só na zona de dados dos EUA; o acesso é pelo token da identidade da api (Cognitive Services OpenAI User) |
| `AuditEvent` do Key Vault e log do WAF no Log Analytics (`Microsoft.Insights/diagnosticSettings@2021-05-01-preview`) | Sem o log não há trilha de quem leu o prompt nem do que o WAF bloqueou. **Exceção à regra "só GA"**: a única versão da API que o Bicep tipa e aceita escopo de recurso é essa (testado com o Bicep 0.48.1: a 2017-05-01-preview também compila, mas é mais velha; a 2016-09-01 é só de assinatura e a 2020-01-01-preview só de grupo de gerenciamento; as mais novas não têm tipo). Só o log do WAF: o de acesso estoura os 5 GB gratuitos. **Retenção do workspace de 90 dias** (não os 30 do mínimo): a temporada dura ~4 semanas e um vazamento do prompt descoberto depois dos 30 dias não deixaria trilha; a Azure inclui 31 dias e cobra o resto por GB (centavos). O custo é o log do WAF, com IP e URL com query string, ficar também 90 dias (seções 2.5 e 3.1) |
| Tag das imagens e versão do prompt do ambiente, sem valor padrão | Um valor fixo (`latest`) reverteria a revisão a cada execução da infra e seria reescrevível no registro. O módulo dos apps exige as três (a fase 1 não), e o pipeline passa o SHA (seção 7.3) |
| `seed-secrets.sh` só lista metadado | O `show` baixava o valor do segredo (o `--query` só filtra a saída) e poluía o `AuditEvent` com leituras do próprio script |
| GUIDs de papel só em `roles.bicep`, conferidos por duas fontes independentes | Um GUID errado (Key Vault Secrets User) derrubou uma revisão, e o oráculo do `check.mjs` era cópia do próprio Bicep. Agora: `verify-roles.sh` pergunta à assinatura e o `check.mjs` usa a tabela da Microsoft |
| Nomes de recurso como constantes (`names.*`) + `dependsOn`, e `what-if-short-circuiting` em erro | Nome vindo de saída de módulo faz o what-if curto-circuitar e não mostrar "No change" |
| Rotina ≠ primeiro deploy: `writeDerivedSecrets` e `deployBudget` falsos nos `.bicepparam` | Regravar um segredo derivado cria versão nova e reinicia `ca-web` e `ca-api`; regravar o orçamento em outro mês é recusado. O `check.mjs` prova que a rotina é o primeiro deploy menos só isso |
| Key Vault de prod com proteção contra purge e retenção de 90 dias; dev sem proteção e com 7 | O cofre guarda os prompts, que só existem lá. Os dois valores não voltam atrás depois de criados; em dev a proteção travaria o nome do cofre ao repetir o deploy do zero |
| WAF casa por `RequestUri`, nunca por `RemoteAddr`, e tem regra própria de 30/min no `/api/auth/` | `RemoteAddr` vem do `X-Forwarded-For`, que o atacante escreve (o truque do quickstart deixava o limite ser driblado). 600/min serve à navegação, não ao login |
| `require_secure_transport = on` declarado; `sslmode=require` mantido (não `verify-full`) | O servidor recusa conexão sem TLS por regra nossa. `verify-full` seria ignorado em silêncio pelo motor de migrations do Prisma (seção 2.2) |
| `ORIGIN_LOCK=front-door` junto com `FRONT_DOOR_ID`, contrato fail closed | Sem o sinal, um `FRONT_DOOR_ID` vazio pareceria "sem trava" (como no econômico) e um erro de configuração a desligaria em silêncio (seção 3.3) |
| Segredos derivados são criados pelo módulo que os origina | Nenhum valor secreto atravessa saída de módulo (o linter proíbe e o histórico de deploy guardaria) |
| Senha do Postgres, e-mail do orçamento e ID do administrador vêm do ambiente | O repositório pode ser público; o `@minLength` do módulo faz o deploy parar se faltarem |
| `database-url` com o login administrador para o worker, as decisões, os agendadores e as migrations; a api, com o login de menor privilégio (`alvesting_api`) no segredo `database-url-api` | A api é a única exposta à internet (ADR 0028). Os outros ficam com o administrador por enquanto (um papel de escrita sem DDL é o próximo passo). O segundo segredo tem a senha própria (`ALVESTING_PG_API_PASSWORD`, `@secure` e `@minLength(32)`), só a api e o migrate o leem, e a api **recusa subir em produção** com outro usuário no `DATABASE_URL` (`requireApiLogin`) |
| O `job-migrate` roda `sh -c 'migrate deploy && db:roles'` | O Container Apps não encadeia dois comandos, e o login da api tem de existir antes de a revisão nova da api receber consulta. Um job só, na ordem, e o `db:roles` só roda se a migration deu certo. Os dois são idempotentes |
| Blob **por container** e Service Bus **por fila**, no lugar do Contributor na conta e dos papéis no namespace (ADR 0030) | Cada identidade só no que o código dela usa: o worker deixa de alcançar o `llm-io` (fecha o risco do ADR 0020) e os agendadores deixam de publicar na `settlement`. A matriz sai do código e o `check.mjs` a escreve à mão. O KEDA também vai por fila (a inferência de Data Owner continua, e o escopo de fila para ele não foi verificado: seção 11) |
| **Sem política de imutabilidade** nos containers (ADR 0030) | A política travada impede apagar a conta de armazenamento até a retenção vencer (armadilha com crédito de estudante), e o SHA-256 no banco já acusa adulteração. Ficam a exclusão lógica de 7 dias e o escopo por container. O `check.mjs` trava a ausência |
| Blue/green com o label `green` e **um endpoint green no Front Door** (ADR 0029) | Prova a revisão nova pelo Front Door de verdade (WAF, trava de origem, certificado) antes de ela ter tráfego, sem custo novo (rotas, regras do WAF e endpoints são grátis no Standard) e sem deixar o `@pos-virada` para depois da virada. O alerta de origem doente olha só os grupos `web` e `api` |
| `postgresql-client-17` do repositório PGDG na imagem da api, major fixo no nome do pacote | O Debian 12 só tem o cliente 15 e o `backup-verify` recusa outro major que o do servidor (17). A versão menor vem do `apt` (o PGDG mantém uma série delas, e uma versão exata quebraria o build); o build confere que é a 17 |
| `acs-connection-string` no Key Vault | A alternativa, identidade com "Communication and Email Service Owner", é mais larga do que enviar e-mail exige |
| `appinsights-connection-string` também por segredo | Zero exceção na regra "nenhuma variável secreta em texto puro" |
| Storage sem chave de conta e Service Bus sem SAS | "Service Bus e Storage não têm segredo: identidade" (§5.7), imposto pela plataforma |
| TTL de 1 dia nas filas, dead-letter na expiração | Mensagem que ninguém consumiu em 1 dia vai para a DLQ; o `decisions` poderia ter TTL menor |
| Ciclo de vida apaga `backups/` em 365 dias | O §5.8 fala em 12 meses |
| Exclusão lógica de 7 dias no Blob | Apagar sem querer o IO bruto das LLMs não pode ser definitivo |
| Papel próprio só com a ação de purge | "O papel mínimo": `CDN Endpoint Contributor` administra endpoints inteiros |
| Probe `GET /health` por HTTPS nos dois grupos | O alias sem prefixo da api e a rota da web já existem (etapa 1) |
| Imagens por tag em parâmetro (`apiImageTag`, `webImageTag`) | Montam o nome do registro por perfil; a regra da seção 7.3 (a tag que está no ar) evita reverter o CD |
| Sem `ingress.traffic` | Não brigar com o blue/green por label: quem fixa o tráfego e dá o label green a cada revisão é o `scripts/deploy.mjs` (`docs/DEPLOY.md`), e a infra repetida não reverte nem o tráfego nem o label |
| Nomes únicos com `nameSuffix` | Cofre, storage, registro, fila e banco têm nome único no mundo; dev e prod convivem |
| Telemetria da api ligada por `--import` no `NODE_OPTIONS` da imagem (`dist/telemetry/preload.js`), não por `import` no topo de cada ponto de entrada nem por comando novo no Bicep | A api é ESM e o gancho de módulo da distribuição da Azure tem de existir antes do carregamento de `pg`, `http` e do SDK da Azure; o `import` no topo não garante a ordem. Um lugar só (o Dockerfile) vale para os quatro papéis, e o `job-migrate` e o `docker run` local passam pelo mesmo arquivo, que sem a connection string não faz nada (seção 5.1) |
| Os onze sinais da aplicação numa regra de log só, com a dimensão `sinal`, e não onze regras | Cada regra de log a cada 5 minutos custa uns US$ 1,50 por mês; onze regras seriam ~US$ 16,5, mais que o resto da conta de observabilidade do perfil econômico. Com a dimensão, cada sinal é um alerta (e um e-mail) próprio por ~US$ 0,15 (seção 5.6). Desvio do plano: o §5.9 listava os alertas um a um |
| "Fila `decisions` com mensagens às 09:35" implementado como "a fila não esvaziou em 15 minutos" (`Minimum` > 0 em janela de 15), a única exceção ao "em até 10 minutos" | O alerta de métrica do Azure Monitor não tem horário, e as saídas (um agendador a mais, que o plano fixa em 7, ou uma linha de log do ciclo; a varredura não serve, ela roda no `settle` e no `sched-cycle` seguinte) custavam mais que o ganho. Com 5 minutos (a primeira versão) o falso alarme era certo: uma chamada legítima de modelo de raciocínio passa de 5 minutos e o job tem até 25. Com o prazo das 09:30 o resultado cobre o 09:35 e detecta em 20 minutos; o preço e a saída (`PT30M`) estão na seção 5.3 |
| O `eod` que espera o arquivo do pregão passa a `WAITING` (valor novo do enum `job_run_status`), e não mais `FAILED` com o texto "ainda não publicado" | O alerta de job falho e o painel não podem filtrar por texto. Migration aditiva (`ALTER TYPE ... ADD VALUE`), nenhuma linha existente muda; `JobRunStore.claim` reassume `WAITING` como reassume `FAILED` (`docs/JOBS.md`, seção 7) |
| A regra de log sem identidade própria e com `skipQueryValidation` | Uma identidade da regra seria mais um leitor do workspace, que guarda o log do WAF com IP e URL (2.5). A validação da consulta é desligada porque a tabela de logs dos contêineres só nasce com o primeiro contêiner, e a regra é criada na fase 1 (seção 5.3, limitações) |
| O e-mail dos alertas é o do orçamento (`ALVESTING_BUDGET_EMAIL`) | O mais simples (a tarefa da etapa 10 deixou a escolha): um endereço só para tudo que pede atenção, sem variável nova no contrato da seção 2.7. Passar a duas pessoas é acrescentar um `emailReceiver` no grupo de ações |
| O Better Auth sem spans próprios (`experimental.instrumentation.enabled: false`) | Ele os cria sozinho quando o `@opentelemetry/api` existe (um por endpoint, gancho e operação de banco) e põe a mensagem do erro no status. A telemetria da api já cobre a requisição e as consultas (seção 5.1) |
| Versões de API: GA, a maioria de 2025 | Mais antigas só onde não existe outra (Insights `2020-02-02`, papéis `2022-04-01`) ou onde não há ganho em subir (DNS privado, identidade, Budgets). O lint `use-recent-api-versions` fica desligado: depende da data de hoje e quebraria o check com o tempo |

---

## 11. Riscos e pontos a validar no primeiro deploy

| Risco | O que fazer |
|---|---|
| **KEDA com identidade pode exigir mais que Receiver.** O escalador lê a profundidade da fila pela API de administração, e a documentação do KEDA diz que, com chave de acesso, a política precisa ser "Manage". Por inferência (não confirmada), na Entra isso é `Azure Service Bus Data Owner`; Sender e Receiver podem não bastar. Por isso a `id-alvesting-scale` já nasce com esse papel, só nas regras de escala (e invisível ao código: `lifecycle: None`). Se o worker não acordar com mensagem na fila (veja os logs de sistema do app), o problema é outro | **Não verificado**: depende da assinatura. Se o KEDA acordar o worker e as decisões só com Receiver (teste: tirar as atribuições `owner` do `servicebus.bicep` numa fila de teste), apague a `id-alvesting-scale`, as atribuições e as `identity` das regras (o `check.mjs` precisa acompanhar). Desde a parte 4 o papel do KEDA está no escopo de cada fila, e não do namespace: se ele não acordar o worker com Data Owner por fila, a volta é o namespace (linha do RBAC por fila, abaixo) |
| **O `lifecycle: None` não foi testado contra a Azure.** A documentação do Container Apps o descreve para identidade usada só em pull de imagem, referência de segredo e regra de escala, mas é propriedade nova | Se o `ca-web` não subir por falta de identidade, ou o KEDA não autenticar, tire o `identitySettings` do `containerapps.bicep` (perde-se só a defesa em profundidade: o isolamento continua pelos papéis) |
| **Papel no escopo de um segredo (todos os workloads) não foi testado contra a Azure.** O Key Vault aceita RBAC por objeto (a Microsoft documenta o escopo de segredo), mas não se confirmou que (a) o ARM aceita o papel no escopo de um segredo **criado pelo plano de dados** (`az keyvault secret set`, que é o caso dos do Artur), nem que (b) a referência de segredo do Container Apps resolve só com isso, nem que (c) a referência **com versão** (`.../secrets/prompt-arena/<versão>`) é lida com o papel no escopo do segredo e não da versão | Se a fase 2 falhar com acesso negado que não passa com o tempo: o papel por `az role assignment create --scope .../secrets/<nome>` mostra se o problema é o ARM (a). **Plano B que preserva o que mais importa: um segundo cofre só com o que o job de decisões lê** (`prompt-arena` e `openrouter-api-key`; nome novo, por exemplo `kv-alvesting-arena`), com Key Vault Secrets User **no escopo desse cofre** só para a `id-alvesting-decisions`. É o escopo que a documentação do Container Apps manda usar (página "Manage secrets in Azure Container Apps", conferida em 01/11/2026: "Grant the Key Vault Secrets User role to the managed identity on your Key Vault"), então (a), (b) e (c) deixam de ser pressupostos para esses dois segredos; e o papel nasce na fase 1 (o escopo já existe) e propaga durante a pausa do seed, sem a corrida da fase 2. Pede mudar o `main.bicep`, o `seed-secrets.sh` (que hoje semeia num cofre só), a tabela da seção 2.6 e o `check.mjs`. Os outros segredos semeados (`better-auth-secret`, `google-oauth-client-secret`, `brapi-token`, `revalidate-secret`, `quotes-secret`) valem menos: se o papel no escopo deles também falhar, dê Key Vault Secrets User no `kv-alvesting` inteiro às identidades que os leem e registre a perda (com o prompt e a chave do OpenRouter no outro cofre, o `kv-alvesting` já não guarda o que o ADR 0020 mais protege). **Nunca** dê o papel do cofre do `prompt-arena` a outra identidade que não a de decisões: a api, exposta à internet, o leria. O `prompt-chat` também fica fora desse cofre pelo mesmo motivo (a api o leria junto com o `prompt-arena`); ele só entra na etapa 13, e se (a) falhar ganha cofre próprio. Só para (c), sem segundo cofre: tire a versão do URI do `prompt-arena` (perde-se a versão fixa; o `PROMPT_ARENA_VERSION` passa a ser só rótulo). **Depois do primeiro deploy, registre aqui o resultado de (a), (b), (c) e do `lifecycle: None`** |
| **Diagnostic settings em API preview** (`2021-05-01-preview`) | Se a Azure recusar o template por causa dela, o cofre e o Front Door funcionam sem os dois recursos: apague `vaultAudit` (observability.bicep) e `wafLog` (frontdoor.bicep) e o teste correspondente, e configure o log à mão (`az monitor diagnostic-settings create`) até haver versão GA |
| **Segredo semeado depois da fase 1 e `prompt-arena` ausente** | Sem o `prompt-arena` a fase 2 falha na criação do `job-worker-decisions` e no papel dele. Semeie (passo 4) e repita |
| Postgres Flexible recusado na região (assinaturas novas, "location is restricted") | Pedir acesso no suporte ou trocar `location` (nada mais depende de East US 2) |
| Orçamento não suportado no tipo da assinatura (Azure for Students) | Passar `deployBudget=false` na fase 1 (ou tirar o módulo `budget` do `main.bicep`) e monitorar em Cost Management |
| `budgetStartDate` fora do que a Azure aceita: o mês corrente (data passada dentro do mês) ou um dos 12 meses seguintes. Sobre isso a Microsoft é explícita; já a recusa de uma regravação com a data antiga em outro mês não foi vista (por isso `deployBudget` só liga na fase 1) | Se a fase 1 cair num mês diferente de novembro de 2026, passe `budgetStartDate=AAAA-MM-01` do mês corrente |
| Papel ainda propagando na fase 2 (erro de acesso ao Key Vault ou ao ACR). Mais provável na primeira execução: os papéis de segredo de todos os workloads são criados na própria fase 2 (~20) | Esperar uns minutos e repetir; o deploy é idempotente |
| **Regravar um segredo derivado reinicia `ca-web` e `ca-api`** (versão nova no Key Vault; confirmado pela documentação do Container Apps, o comportamento do ARM em si não foi verificado) | A rotina não os grava (`writeDerivedSecrets=false`). Se o what-if da rotina ainda os listar, algum módulo declara o segredo fora da condição |
| **Prova do WAF pós-deploy (não feita):** o limite precisa valer com e sem `X-Forwarded-For` falso | Em 1 minuto, mande mais de `wafRateLimitPerMinute` requisições ao host do Front Door, uma vez sem cabeçalho e outra com `X-Forwarded-For: 192.0.2.1`: as duas têm de receber 403/429 depois do limite. Idem acima de 30 em `/api/auth/get-session` (e com `/API/auth/` e `/api/%61uth/`). Se algum passar, a regra está errada |
| **Os alertas e a telemetria nunca rodaram na Azure.** Os nomes e as dimensões das métricas vêm da documentação; a consulta do alerta de log foi escrita sem poder rodar (`skipQueryValidation`); o pipeline da telemetria foi provado contra um servidor HTTPS local que imita o endpoint de ingestão, e com exportador em memória nos testes | Fazer a seção 5.4 no primeiro deploy, um alerta por vez, cronometrando até o e-mail. Se uma métrica não existir no tier (o Azure recusa a regra no deploy), o erro diz qual: ajustar o nome em `alerts.bicep` e em `METRIC_ALERTS` do `check.mjs` |
| A regra de log roda com a permissão de quem fez o deploy (sem identidade própria): se essa pessoa perde o acesso ao workspace, a regra para de ver as linhas e o Azure Monitor só diz no histórico dela | Conferir o histórico da regra depois de trocar quem faz o deploy; a alternativa é uma identidade gerenciada da regra com Log Analytics Reader no workspace (que vira mais um leitor do log do WAF, 2.5) |
| **O papel mínimo do Postgres e o `backup-verify` nunca rodaram no Flexible Server** (onda 3d; só no Postgres 17.11 do Docker, onde o administrador é superusuário). Não verificado: (a) o administrador do Flexible Server (que NÃO é superusuário) conseguir `CREATE ROLE`, `GRANT` do papel de grupo ao login e `ALTER ROLE ... SET`; (b) o `CREATE DATABASE`, o `DROP DATABASE ... WITH (FORCE)` e o `pg_restore` dele; (c) o `pg_export_snapshot`; (d) o tempo e a memória do dump para o Blob em 0,5 vCPU; (e) o `ALTER ROLE ... PASSWORD 'SCRAM-SHA-256$...'` (a senha já como resumo) ser aceito, e o ACL padrão do esquema `public` ali (a migration `20261103110000_api_role_least_privilege` tira o `CREATE` de PUBLIC com o dono do esquema, e o `db:roles` recusa se o login ainda puder criar objetos); (f) o `ALTER ROLE ... CONNECTION LIMIT 24` (só em produção) e a conferência dele no `db:roles`, e a migration `20261103120000_api_role_guards` (as quatro funções e os gatilhos `*_api_guard`, o `GRANT` por coluna em `prompt_version`) pelo administrador; (g) o `pg_dump` e o `pg_restore` (libpq) só cifram com o `sslmode=require` da URL (2.2): se a cadeia do certificado do Flexible Server estiver no `ca-certificates` do Debian e o nome do servidor casar, endurecer o `toolEnv` para `PGSSLMODE=verify-full` e `PGSSLROOTCERT=system` | Rodar o `job-migrate` com o `db:roles` e conferir `\du` (e o `rolconnlimit` = 24); disparar o `job-sched-backup` à mão (8.5) e ler o `job_run` e o blob; se (a) falhar, o `GRANT` pode pedir o `ADMIN OPTION` no grupo (PostgreSQL 16 em diante: quem cria o papel o recebe sozinho). Detalhes: ADR 0028 |
| **O segredo do login da api e o `job-migrate` com dois comandos nunca rodaram na Azure** (etapa 10, parte 4). Não verificado: (a) o `command: ['sh','-c','... && ...']` do job (a imagem é a `node:bookworm-slim`, que tem o `sh`; o `az containerapp job update --image` manter o comando); (b) o `job start` ler a versão NOVA do `database-url-api` (o Container Apps resolve a referência quando a execução começa, e o reinício da revisão do `ca-api` já ler a nova ou esperar a atualização de até 30 minutos: 8.2); (c) o primeiro deploy: o `ca-api` nasce na fase 2 antes de o login existir, e as rotas que consultam o banco falham até a primeira execução do `job-migrate` | Fazer o passo 6 da seção 6 logo depois da fase 2 e olhar o log da execução (`login alvesting_api pronto`); no giro da senha, seguir a ordem da 8.2 e olhar o log da api (`password authentication failed` é a senha de uma das pontas fora de ordem) |
| **O RBAC por fila e por container nunca rodou na Azure** (etapa 10, parte 4; ADR 0030). Não verificado: (a) o ARM aceitar o papel no escopo de um **container** e de uma **fila** criados no mesmo deploy (o `dependsOn` das atribuições cuida da ordem); (b) o **KEDA** ler a profundidade das filas com o Data Owner no escopo de cada FILA (a inferência de Data Owner já era não confirmada, seção anterior); (c) a DLQ ser coberta pelo papel da fila (`peek` e `receive` da DLQ pela api); (d) o `container.exists()` do `backup-verify` (leitura do container) valer com o Contributor no escopo do container; (e) o atraso de propagação de um papel de Blob (até 10 minutos: Learn, "Assign an Azure role for access to blob data") na primeira execução | Se o worker ou as decisões não acordarem com mensagem na fila: voltar o papel `owner` da `id-alvesting-scale` para o namespace (`servicebus.bicep`: uma atribuição em vez de seis, e o `check.mjs`). Se uma operação der 403: o log mostra a ação e o escopo; o papel certo entra na matriz (`main.bicep`, `INFRA.md` 3.2 e `check.mjs`) |
| **O endpoint green do Front Door nunca rodou na Azure** (etapa 10, parte 4; ADR 0029). Não verificado: (a) o Front Door aceitar como origem o FQDN do label (`ca-api---green.<domínio>`, com três hífens) e o certificado curinga do ambiente passar no `enforceCertificateNameCheck`; (b) o ingress do Container Apps entregar o label a uma requisição com esse `Host` (`originHostHeader`); (c) as sondas ficarem saudáveis (3 de 4 amostras de 30 s: até ~2 minutos depois de o label entrar, e é por isso que o `smoke-green` bate no label direto antes do Playwright); (d) o Better Auth aceitar o POST do login com o `Origin` do site de produção chegando pelo host do green (o smoke manda `Origin` = `SITE_URL`); (e) o formato do valor da dimensão `Endpoint` da métrica `Percentage5XX`, para o alerta `alvesting-front-door-5xx` deixar de contar o endpoint green (5.3: hoje ele conta o perfil inteiro, e a prova que falha no green o dispara) | Olhar `az afd origin-group` e `az afd endpoint show` depois da fase 1; no primeiro deploy, se o Playwright pelo green reprovar com 502/503, abrir o label direto (`https://ca-api---green.<domínio>/health`) para separar a borda do app. Para (e): Azure Monitor, Métricas, `Percentage5XX` dividida por `Endpoint`, e então filtrar o alerta pelo valor do endpoint do site (`alerts.bicep`, `dimensions`, e `METRIC_ALERTS` do `check.mjs`). Se o Front Door recusar o FQDN do label, o desvio previsto no ADR 0029 é provar o green pelo FQDN do label com o `X-Azure-FDID` (o `az afd profile show --query frontDoorId` dá o ID ao CI sem guardá-lo) e voltar a etiqueta `@pos-virada` para o smoke de produção |
| **A imagem da api com o `postgresql-client-17` não foi construída aqui** (`docker build` é proibido nesta máquina). O tamanho (uns 40 MB a mais, por causa do `perl`), o tempo do build e o repositório PGDG responder no `docker build` só aparecem no job `images` do CI | O job `images` confere `pg_dump`, `pg_restore` e `psql` 17 dentro da imagem e imprime o tamanho no resumo; se pesar, copiar só `/usr/lib/postgresql/17/bin` de uma etapa de build (o `ponytail` do Dockerfile) |
| Pool de conexões estoura as ~50 do B1ms | Pool pequeno por processo (2.2) |
| Lock do Service Bus de 1 minuto com decisão de até 25 min | Resolvido no código: o `MessagingService` já passa `QUEUES[fila].lockRenewalMs` ao `createReceiver` (`maxAutoLockRenewalDurationInMs`; 26 minutos em `decisions`, 25 em `maintenance` por causa do `backup-verify`, 5 nas demais; ADR 0015 e 0028). Falta só o teste de integração com o emulador, que roda no CI |
| **`terminationGracePeriodSeconds: 300` no `ca-worker-data` não foi testado contra a Azure** (a documentação dá 30 s de padrão e não cita um teto para o template) | Se a Azure recusar o valor, use o maior que ela aceitar e baixe o `DRAIN_TIMEOUT_MS` (`messaging.service.ts`) para 30 s a menos que ele. O que passar do prazo perde a trava, volta para a fila e a linha de `job_run` barra a repetição; o custo é um `eod` refeito |
| SSE do chat bufferizado pelo Front Door (§5.15) | Teste da etapa 3; se falhar, subdomínio direto ao ingress da api |
| Imagem do econômico no GHCR privado | O pacote precisa ser público (sem credencial no template) |
| Crédito acabando | Seção 6, "Parar o gasto" |

---

## 12. Checklist antes de abrir para o público (plano §5.16, parte da infra)

- [x] `infra/` compila e passa no `check.mjs`
- [ ] `verify-roles.sh` passou na assinatura (passo 0; precisa da assinatura)
- [ ] `infra/` sobe do zero num resource group vazio (precisa da assinatura)
- [ ] what-if da segunda execução sem mudanças, sem nenhum flag extra (precisa da assinatura)
- [x] Banco sem IP público: provado pelo `check.mjs` na infra
- [ ] **Origem só aceita o Front Door.** A infra só entrega o `FRONT_DOOR_ID` e o `ORIGIN_LOCK`; a recusa é do middleware da etapa 3 e o aceite dela está na seção 3.3 (pedido direto ao FQDN sem o cabeçalho recusado; com ele, 200; `/health` e a revalidação como únicas exceções; subir com `ORIGIN_LOCK=front-door` e `FRONT_DOOR_ID` vazio falha). **Não ligue a fase 2 com imagens reais antes disso**
- [ ] WAF: mais de `wafRateLimitPerMinute` requisições em 1 minuto bloqueadas com e sem `X-Forwarded-For: 192.0.2.1` (seção 11; precisa da assinatura)
- [ ] KEDA acorda o worker e as decisões com a `id-alvesting-scale` (seção 11; precisa da assinatura)
- [ ] A conta (etapa 11, `docs/CONTA.md`, seção 11; precisa da assinatura): a api sobe com a configuração da conta (e recusa sem ela); o e-mail de verificação chega pelo
      Communication Services; o `X-Azure-SocketIP` chega à api e o Front Door o sobrescreve se o cliente o mandar (o limite de tentativas do Better Auth depende disso); o login com o Google fecha com o URI de redirecionamento do `PUBLIC_URL`;
      o Front Door repassa o `Content-Length` do cliente nos POST de `/api/auth/*` (a api recusa com 413 o corpo sem tamanho declarado, e o login quebraria se a borda o fragmentasse); **as telas pelo Front Door**
      (parte 2): o cookie `__Secure-alvesting.session_token` volta do navegador e a `/conta` o lê pelo servidor, o redirecionamento da `/conta` sem sessão leva ao endereço do Front Door (o Front Door escreve o `Host` da origem, `originHostHeader`: o `Location` tem de continuar
      relativo) e o link do e-mail abre a tela de verificação; o e2e prova isso só com o Front Door imitado (`apps/web/e2e/front-door.ts`, em https com certificado autoassinado, em Chromium e em WebKit: o certificado e o `Host` do Front Door de verdade e o iPhone físico
      ficam para o primeiro login na Azure, `docs/DEPLOY.md`, seção 4, passo 8); o smoke do deploy faz o POST do login pelo Front Door verde, antes da virada, e pelo de produção, depois dela (`@api`, `docs/DEPLOY.md`, seção 1) e prova que `/api/auth/*`, o `Content-Length`, o WAF e o `PUBLIC_URL` fecham
- [ ] **E-mail da conta com domínio próprio verificado** (`docs/CONTA.md`, seção 6): o domínio gerenciado pela Azure aceita 5 e-mails por minuto e 10 por hora por assinatura, sem aumento (Learn, "Service limits for Azure
      Communication Services", seção Email), e qualquer pessoa gasta isso sem ter conta; o domínio próprio começa em 30 por minuto e 100 por hora e aceita pedido de aumento (decisão do Artur: domínio e DNS)
- [x] Cada workload lê só os segredos dele, e o prompt da arena e a chave do OpenRouter só o job de decisões: provado pelo
      `check.mjs` no template (seção 3.2)
- [ ] O papel no escopo do segredo funciona na Azure: a fase 2 sobe, e o `prompt-arena` versionado é lido pelo job; o resultado
      de (a), (b), (c) e do `lifecycle: None` fica registrado na seção 11, e, se algum falhar, vale o plano B do segundo cofre
      (seção 11; precisa da assinatura)
- [ ] O log de auditoria do cofre chega ao Log Analytics depois do seed (`AzureDiagnostics | where Category == "AuditEvent"`) e
      o do WAF, com o Front Door no ar (precisa da assinatura)
- [ ] Segredos e prompts no Key Vault (semear; o `prompt-arena` antes da fase 2)
- [ ] Orçamento, alertas (incluindo DLQ) e health probe ativos: orçamento, probe e alertas estão no Bicep e no `check.mjs`; falta ativá-los e conferir a falha forçada chegando por e-mail em até 10 minutos (seção 5.4; precisa da assinatura)
- [ ] Telemetria da api no Application Insights: as requisições, as consultas ao Postgres e as métricas próprias aparecem, e o volume medido no primeiro mês cabe nos 5 GB (seção 5.5; precisa da assinatura)
- [ ] O login `alvesting_api` existe no Flexible Server (o `job-migrate` roda o `db:roles` e o log diz `login alvesting_api pronto`) e a api conecta com ele (seções 2.2 e 11; precisa da assinatura)
- [ ] O RBAC por fila e por container funciona (seção 3.2): o KEDA acorda o worker e as decisões, a api lê e reenvia a DLQ, o `backup-verify` envia e baixa o dump, e nenhuma operação dá 403 (seção 11; precisa da assinatura)
- [ ] O blue/green de verdade (seção 2.5 e `docs/DEPLOY.md`): o primeiro deploy completo passa pelo endpoint green, o Playwright pelo green reprova de propósito num teste de falha forçada e o tráfego não muda, e `revert` volta uma revisão (precisa da assinatura)
- [ ] Restore de teste executado (etapa 10)

---

## 13. Validação estática

Sem Azure, sem assinatura, só o Bicep CLI (0.48.1 em `docs/DEPENDENCIAS.md`) e Node:

```bash
export PATH="$HOME/.nvm/versions/node/v26.13.0/bin:$HOME/.azure/bin:$PATH"
az bicep build --file infra/main.bicep --stdout > /dev/null        # sem erro, sem aviso
az bicep build-params --file infra/main.prod.bicepparam --stdout > /dev/null
az bicep build-params --file infra/main.dev.bicepparam --stdout > /dev/null
az bicep lint --file infra/main.bicep                              # limpo
node infra/tests/check.mjs                                         # tudo acima + os invariantes
```

O `infra/tests/check.mjs` (só Node, sem dependência) roda o Bicep CLI (`BICEP_BIN` ou `bicep` no PATH ou `~/.azure/bin/bicep`)
e usa `bicep snapshot`, que avalia o template localmente para cada perfil, sem Azure. Cobre:

- compilação limpa (build, build-params dos dois arquivos, lint com `what-if-short-circuiting` em erro, que o teste também
  exige no `bicepconfig.json`) e ausência de `utcNow`/`newGuid`/scripts;
- **papéis, sem oráculo circular:** cada GUID do `roles.bicep` bate com o nome de uma tabela da Microsoft copiada no teste, e a
  lista de atribuições do deploy é afirmada inteira, por identidade e por escopo ("`id-alvesting-web | Key Vault Secrets User |
  .../secrets/revalidate-secret`"), a partir de matrizes escritas à mão no teste (quem lê o quê; `QUEUE_ROLES`: quem publica, consome e escala em cada
  FILA; `BLOB_ROLES`: quem lê e quem grava em cada CONTAINER), não derivadas do Bicep. Qualquer mudança de uma linha numa atribuição (o papel, a fila, o container,
  a identidade, o escopo subindo para o namespace ou para a conta) reprova a igualdade da lista; a ausência de política de imutabilidade e a exclusão lógica de 7 dias também são afirmadas;
- **o login da api e as senhas do Postgres:** a `ca-api` usa o `database-url-api` no `DATABASE_URL` (e não o do administrador), o `job-migrate` o recebe em `API_DATABASE_URL` e roda o `migrate deploy`
  e, só se deu certo, o `db:roles`; só a api e o migrate leem o `database-url-api`, e o URL é `alvesting_api`, no banco `alvesting`, com TLS; as duas senhas vêm do ambiente, são `@secure` e têm trava de tamanho (16 e 32)
  no módulo do banco;
- **a rota interna de cotações:** o `check.mjs` lê o controlador (`modules/quotes`) e afirma que o caminho (`/api/v1/interno/barras/x`) não casa nenhum padrão da rota com cache do Front Door, está em `NEVER_CACHED` e
  contém o que a regra `BlockInterno` do WAF bloqueia (`/interno/`, que a regra confere inteira: ação, variável, operador, valor e transformações), e que o `quotes-secret` é semeado (aleatório e longo, nunca impresso) e lido só pelo web e pela api;
- **o blue/green no Front Door:** dois endpoints, quatro grupos de origem (os do green com o host `<app>---green.<domínio>` do mesmo ambiente do app), duas rotas do green sem cache e sem domínio próprio, o WAF
  nos dois endpoints, a saída `greenSiteUrl`, e o alerta de origem doente só nos grupos `web` e `api`;
- **a imagem e o CI:** o Dockerfile instala o `postgresql-client-17` (PGDG, bookworm, major fixo) só no estágio de execução, e o `ci.yml` o instala no job `check` e o confere dentro da imagem no job `images`;
- **segredo por workload:** nenhuma identidade tem papel no cofre inteiro; `prompt-arena` e `openrouter-api-key` só da
  `id-alvesting-decisions`, `brapi-token` só da `id-alvesting-worker`, `quotes-secret` só do web e da api, `prompt-chat` de ninguém com o chat desligado e só da api com ele
  ligado, `database-url` de todas menos a do web; cada workload referencia exatamente os segredos que a identidade dele lê, e por
  ela; cada identidade só está anexada ao workload dela (a do KEDA também ao worker e às decisões); `lifecycle: None` no web, no
  migrate e na do KEDA; o `AZURE_CLIENT_ID` de cada workload é o da identidade dele;
- **prompt:** `PROMPT_ARENA` é `secretRef` do segredo `prompt-arena` com a versão fixa no URI, só nas decisões; a versão vai em
  `PROMPT_ARENA_VERSION` (32 hexadecimais), em texto puro e sem segredo;
- **imagens:** nenhum `latest` nos `.bicepparam`, as tags e a versão do prompt vêm do ambiente, o módulo dos apps exige as três
  (`minLength`) e a fase 1 passa sem elas;
- **ordem dos módulos:** o `dependsOn` do template compilado (Service Bus, Storage e ACR depois das identidades, telemetria
  depois do cofre, apps depois do banco, do e-mail, do ACR etc.) e, dentro do módulo dos apps, web, api, worker, decisões, os 7
  agendadores e o migrate depois dos papéis de segredo (`secretAccess`);
- **auditoria:** `AuditEvent` do cofre em todo perfil e `FrontDoorWebApplicationFirewallLog` só no padrão, ambos no workspace,
  que retém pelo menos 90 dias (a trilha do prompt);
- **o contrato de ambiente da seção 2.7**: a tabela é lida e comparada, variável por variável, com o que o template injeta em
  cada workload nos perfis padrão e econômico e com o Azure OpenAI ligado (o que falta, o que sobra, a origem e o "Quando");
  e o INFRA.md cita cada identidade, cada GUID e cada entrada de ambiente dos `.bicepparam`;
- **rotina × primeiro deploy:** a rotina (valores dos `.bicepparam`) é o primeiro deploy menos exatamente os segredos
  derivados e o orçamento;
- Postgres sem acesso público, na sub-rede delegada, com DNS privado, sem regra de firewall, `require_secure_transport = on` e
  `sslmode=require` no `database-url`;
- Service Bus Basic sem chave SAS, 6 filas com as entregas máximas certas, DLQ na expiração, sem sessão nem duplicata;
- Storage sem chave de conta, só HTTPS e Entra por padrão; Key Vault com exclusão lógica e, em prod, proteção contra purge
  e 90 dias (dev: 7 e sem proteção, no teste dos `.bicepparam`); ACR sem usuário admin e sem pull anônimo;
- segredos só como referência ao Key Vault **criado no deploy** (o nome do cofre na URL é comparado, e não só o `/secrets/`), com
  identidade, registros sem usuário e senha, variáveis em texto puro só numa lista fechada e sem aparência de segredo;
- mínimos e máximos de web e api por perfil, 3 probes **na porta do ingress**, ingress, revisões múltiplas;
- worker sem ingress, 0 a 3, uma regra KEDA por fila **no namespace do Service Bus criado** e com a identidade do KEDA; 7
  agendadores com os crons do §6 e o comando certo; job de decisões por evento, até 10 execuções, 1500 s; migrate manual; uma
  imagem da api para todos os papéis;
- orçamento, e-mail, observabilidade e os alertas de operação: o grupo de ações (o e-mail do orçamento, esquema comum), cada alerta de métrica (escopo, namespace, nome, agregação,
  operador, limiar e dimensões da métrica; severidade; janela; ligado ao grupo; frequência + janela + latência de 4 minutos em até 10, e 20 só no `decisions-fila-parada`) nos dois perfis (no econômico os dois do Front Door não existem), a regra de log (tabela
  `ContainerAppConsoleLogs_CL`, que o ambiente alimenta pelo destino `log-analytics`; `skipQueryValidation`; a consulta **inteira**, comparada com a escrita no teste a partir da constante `ALERT_LOG` de `apps/api/src/telemetry/alert-logs.ts`, importada
  pelo Node direto, de modo que mexer na lógica de um sinal reprova até a mudança deliberada dos dois lados; uma tabela de linhas de exemplo no formato do Pino, um caso positivo e um negativo por sinal e as bordas dos limiares, avaliada por um espelho em JS do `case()` e da razão de 5xx;
  frequência de 5 minutos), nenhum alerta com identidade e a linha de cada alerta e de cada sinal na tabela da seção 5.3;
- Front Door, rotas, probe, WAF (três regras: o bloqueio de `/interno/` e dois rate limits, **nunca `RemoteAddr`**) e a trava de origem (`FRONT_DOOR_ID` e `ORIGIN_LOCK`) só no
  padrão; o econômico sem Front Door, sem ACR, com GHCR e CORS;
- fase 1 (sem apps, sem tag e sem versão de prompt), domínio próprio e Azure OpenAI ligado (conta sem chave, implantação
  `DataZoneStandard`, papel Cognitive Services OpenAI User e `prompt-chat` só da api, nenhum `azure-openai-key`);
- o `seed-secrets.sh` e o `verify-roles.sh` com um `az` falso (semeia o que falta, não sobrescreve, não imprime valor; o falso
  registra toda chamada e o teste afirma que só houve `secret list`, com a consulta exata, e `secret set`: `show`, `download` ou
  qualquer outro comando falham o teste mesmo se o script engolir o erro do falso com `|| true`; falha no GUID errado do
  blocker original).

As afirmações novas foram conferidas por mutação em 01/11/2026: 42 defeitos (os apontados nas revisões e variações deles: GUID
errado, `dependsOn` apagado, namespace do KEDA trocado, SAS ligada, `sslmode=disable`, `RemoteAddr` no WAF, identidade
compartilhada de volta no `ca-web`, segredo regravado na rotina etc.) foram reintroduzidos, um por vez, em cópias descartáveis
de `infra/`, e o check falhou nos 42. O executor dessas mutações não está no repositório. Na onda 2a (01/11/2026) outros 13
defeitos foram reintroduzidos, um por vez e nos próprios arquivos, e desfeitos na hora (os checksums de `infra/` e dos
documentos conferidos antes e depois): o worker lendo o `prompt-arena`; `GlobalStandard` no lugar de `DataZoneStandard`; a conta
do OpenAI sem `disableLocalAuth`; o papel de segredo no escopo do cofre; `latest` de volta no `.bicepparam`; a tag da api sem o
`@minLength`; a categoria errada no log de auditoria; o `seed-secrets.sh` lendo o valor com `show`; o migrate sem
`lifecycle: None`; a api com papel de Blob; o `prompt-arena` sem versão fixa; o `AZURE_CLIENT_ID` da api com o client ID de outra
identidade; e uma linha a menos na tabela de ambiente. O check falhou nos 13. Ao fechar os achados menores da revisão da onda 2a,
quatro mutações que passavam em 72 de 72 (o `dependsOn: [secretAccess]` tirado das decisões, o cofre da referência trocado por
`kv-outro` e o `seed-secrets.sh` baixando o valor com `download` ou com `show || true`) viraram testes. Foram refeitas, com
algumas variações, 8 mutações, nos próprios arquivos e desfeitas na hora (checksum idêntico): o `dependsOn: [secretAccess]`
tirado das decisões e, em outra rodada, dos agendadores; o cofre da referência trocado por `kv-outro` e por `kv-alvesting-outro`
(um nome que contém o certo); o `seed-secrets.sh` baixando o valor com `download`, com `show || true` e chamando outro comando
do `az`; e a retenção do workspace de volta a 30 dias. O check falhou nas 8.

**O que ele não prova:** que a Azure aceita o template (validação de pré-voo, cota, regiões, nomes únicos) nem que o what-if da
segunda execução é vazio. Isso é o aceite (1) e (2) da etapa, com os comandos da seção 6.

O `ci.yml` roda o check (job `check`, com `az bicep install --version v0.48.1`) e o what-if informativo do PR (job `whatif`,
só quando o repositório tem as variáveis de OIDC). As entradas do Bicep que não têm valor padrão entram nesse job como no passo 7
da seção 6: as tags pelo `current-tags` e a versão do prompt lida do job de decisões (`promptArenaVersion=`). Só rodam contra a
Azure quando o repositório tiver as variáveis de OIDC; o `actionlint` confere o YAML e o shell, e o resultado na Azure não foi
verificado.

---

## 14. Fora desta etapa

- O `backup-verify` e a retenção entraram na etapa 10, onda 3d (seção 4 e `docs/JOBS.md`, seção 8); a telemetria da api e os alertas entraram na parte 1 (seção 5), e as rotas `/admin` com o painel na parte 2 (`docs/API.md`, seção 8). Réplica de leitura, HA do banco e Front Door Premium (fora do escopo).
- O cache da API pública no Front Door e o purge depois da liquidação entraram na etapa 9 (seções 2.5 e 3.3, `docs/API.md`). Não verificado na Azure: o cache e o purge reais.
- Domínio próprio no ingress do Container Apps (perfil econômico): exige DNS pronto e dois passos (adicionar o host, depois o
  certificado gerenciado), e um `az containerapp hostname bind` manual seria desfeito pelo próximo deploy do Bicep.
- A federação OIDC do GitHub Actions e a pipeline são da etapa 3 (`docs/DEPLOY.md`); o middleware da trava de origem, também
  (ADR 0018, contrato e aceite na seção 3.3).
- Privilégio mínimo no banco: **a api tem o dela desde a etapa 10, onda 3d** (seção 2.2 e ADR 0028). Falta o segundo papel, de escrita sem DDL, para o worker, as decisões e os agendadores: hoje o `database-url` é o login
  administrador para eles, e o isolamento por segredo separa quem lê o URL, não o que ele pode fazer.
- O Service Bus por fila e o Blob por container **entraram na etapa 10, parte 4** (seção 3.2; ADR 0030): o worker não alcança mais o `llm-io` e as decisões leem o `briefings` com o Storage Blob Data Reader. Ficam de fora,
  de propósito: a política de imutabilidade nos containers (a política travada impede apagar a conta de armazenamento; o SHA-256 do banco já acusa adulteração) e o papel de **escrita sem leitura** do worker em
  `briefings` (não há papel interno só de escrita; um papel próprio com `blobs/write` é possível, mas o `backups` pede ler, apagar e `exists()`, e o ganho é pequeno).
- Reforço da trava de origem na rede: um NSG na `snet-apps` liberando a porta 443 só para a service tag
  `AzureFrontDoor.Backend`. Não foi feito porque o ambiente do Container Apps exige regras próprias no NSG que não dá para
  conferir sem a assinatura, e um NSG errado impede o ambiente de subir. Fica como evolução se a banca pedir mais que o cabeçalho.
