# Runbook de operação da Alvesting

Como operar a Alvesting depois do deploy: o que fazer quando um alerta chega, como refazer uma ação de admin, como girar um segredo, como restaurar, como voltar uma revisão e como dar e tirar o papel de admin. Cobre o aceite da etapa 10: reprocessar o ciclo, reenviar a DLQ, girar o segredo, restaurar o backup e voltar a revisão.

**Nada deste runbook rodou na Azure.** Cada procedimento traz **não ensaiado** até o Artur ensaiá-lo, um de cada vez, cronometrando até o e-mail do alerta (`docs/INFRA.md`, 5.4). Depois do ensaio, troque a marca por `ensaiado em AAAA-MM-DD` e anote o que mudou. Os comandos de `az` seguem os de `docs/INFRA.md` e `docs/DEPLOY.md`, e os novos foram conferidos no `--help` da CLI local (2.86.0). Nada foi conferido na assinatura: o que não foi conferido na documentação ou na assinatura está escrito como "não verificado".

## Índice

Mapa: cada alerta, sinal, orçamento e ação de auditoria aponta para a seção que trata dele. O teste `apps/api/src/runbook.spec.ts` reprova o item que não aparece numa seção numerada.

**Alertas (Bicep) e sinais (regra de log):**

| Item | Seção |
|---|---|
| `alvesting-dlq-qualquer-fila` | 3 |
| `job-falhou`, `news-seguranca`, `alvesting-sinais-da-aplicacao` | 3 |
| `eod-barras-ausentes`, `brapi-cota-baixa`, `barras-divergentes` | 12 |
| `alvesting-decisions-fila-parada`, `ciclo-pulado`, `hold-por-falha-ou-resposta-invalida` | 2 |
| `filtro-de-vazamento` | 4 |
| `alvesting-banco-cpu`, `alvesting-banco-disco` | 5 |
| `alvesting-front-door-origem-doente`, `alvesting-front-door-5xx`, `api-5xx` | 6 |
| `email-da-conta`, `aceite-nao-gravado` | 8 |
| `budget-alvesting` | 11 |

**Ações gravadas no audit_log (`AUDIT_ACTIONS`, em `apps/api/src/common/audit.ts`):**

| Ação | Seção |
|---|---|
| `admin.season.create`, `admin.season.update`, `admin.season.start` | 10 |
| `admin.cycle.rerun` | 2 |
| `admin.dlq.resubmit` | 3 |
| `admin.corporate_event`, `corporate_event.created`, `corporate_event.updated` | 9 |
| `account.promoted`, `account.demoted` | 7 |
| `account.deleted` | 8 |

## Antes de começar

- **Conta e variáveis.** `az login` com a conta do Artur. Os blocos abaixo rodam em zsh ou bash, e supõem estas variáveis:

```bash
export RG=rg-alvesting-prod KV=kv-alvesting
SITE="$(az deployment group show -g $RG -n alvesting --query properties.outputs.siteUrl.value -o tsv)"
```

  Recursos (nomes do `infra/main.bicep`, perfil padrão): cofre `kv-alvesting`; Blob `stalvesting` (containers `briefings`, `llm-io` e `backups`); Service Bus `sb-alvesting`; Postgres `psql-alvesting`; Communication Services `acs-alvesting`; Log Analytics `log-alvesting`; Front Door `afd-alvesting` (só no padrão). Apps: `ca-web`, `ca-api`, `ca-worker-data`. Jobs: `job-migrate`, `job-worker-decisions` e os agendadores `job-sched-news`, `job-sched-briefing`, `job-sched-cycle`, `job-sched-eod`, `job-sched-universe`, `job-sched-retention` e `job-sched-backup`.

- **Extensão do `az`.** O `az monitor log-analytics query` (seções 2 e 8) vem da extensão `log-analytics` (1.0.0b3, prévia): instale-a uma vez com `az extension add --name log-analytics` (sem ela o `az` não conhece o comando). Todos os outros comandos `az` deste runbook são do núcleo da CLI (conferido no `--help` da 2.86.0).
- **Sessão de admin para o `curl`.** As rotas `/api/v1/admin` pedem uma sessão de conta com o papel `admin` (seção 7) e, nas mutações, o `Origin` igual ao do site (sem ele, 403). O bloco guarda o cookie num arquivo só do dono e não põe a senha na linha de comando. A senha não pode ter aspas nem barra invertida, porque o JSON do bloco não as escapa. O `trap` só apaga o arquivo quando o shell fecha: apague-o com `rm -f` ao fim do uso.

```bash
umask 077; J="$(mktemp)"; B="$(mktemp)"; trap 'rm -f "$J" "$B"' EXIT
printf 'e-mail da conta de admin: '; read -r EMAIL
printf 'senha: '; read -rs SENHA; echo
printf '{"email":"%s","password":"%s"}' "$EMAIL" "$SENHA" > "$B"; unset SENHA
curl -sS -c "$J" -H 'Content-Type: application/json' -H "Origin: $SITE" --data @"$B" \
  -o /dev/null -w '%{http_code}\n' "$SITE/api/auth/sign-in/email"    # 200: entrou
```

  Sem 200: 401 é senha errada ou sessão recusada; 403 com `EMAIL_NOT_VERIFIED` é e-mail não confirmado (o login reenvia o link). Nas rotas de admin, 403 é conta sem o papel ou aceite vencido (`CONSENT_REQUIRED`).

- **Relógio.** As janelas são de Brasília; o cron é UTC. Veja a hora com `TZ=America/Sao_Paulo date '+%F %H:%M'`. Não mexa no ciclo entre 08:00 e 09:30, nem na noite do `eod` (ele sai às 21:30 de Brasília e a liquidação vem depois). Trocas de senha e deploys que reiniciam réplicas também saem dessas janelas.
- **Segredo.** Valor de segredo não vai à linha de comando, ao log, ao chat nem a arquivo do repositório. Use `read -rs`, um arquivo com `umask 077` apagado ao fim, e `az keyvault secret set --file`.
- **Dado pessoal.** Nenhum e-mail, nome ou ULID de usuário em issue, chat ou planilha. Os exemplos usam `<e-mail-do-operador>`.

---

## 1. Conferência diária (painel `/admin`)

**Não ensaiado.** É a rotina que pega o que nenhum alerta vê, como o `eod` que nem chegou a rodar (`docs/INFRA.md`, 5.3).

Quando: depois das 09:35 de Brasília em dia de pregão (a segunda-feira cobre o fim de semana: a retenção roda todo dia, e o `GET /admin/jobs` mostra a última de cada tipo). Pelo painel (`docs/TELAS.md`, seção 8) ou pelo `curl`:

```bash
curl -sS -b "$J" "$SITE/api/v1/admin/jobs"     # jobs (o último de cada tipo), failures e queues (a DLQ de cada fila)
curl -sS -b "$J" "$SITE/api/v1/admin/costs"    # gasto do mês e teto (capMicroUsd; null = sem teto)
```

Confira:
1. **Jobs.** O `eod` do pregão de ontem é `SUCCEEDED` (ou `WAITING`, a espera do arquivo, que não é falha). O `settle` que ele publicou é `SUCCEEDED`. O `decide` de hoje existe. Se a última linha de `eod` é de outro dia, o agendador não rodou: `az containerapp job execution list -g $RG -n job-sched-eod -o table`, e a seção 3.
2. **Falhas.** Cada item de `failures` tem explicação (seção 3). Sem explicação, vira pendência.
3. **DLQ.** As seis filas com zero mensagens. `"unavailable"` quer dizer que a api não conseguiu ler a fila agora (o `peek` depende do papel de Receiver): não é zero. Confira o log da api.
4. **Custos.** O acumulado do mês contra o teto. Perto do teto, o ciclo com modelo pago é pulado (seção 2).
5. **Diário.** O `retention` (10:00 de Brasília, todo dia) mais recente é `SUCCEEDED` e é de ontem, ou de hoje se a conferência é depois das 10:00. É ele que cumpre a promessa da política de privacidade (cadastro nunca confirmado apagado em até 7 dias depois de criado, sessão e pedido de uso único vencidos em até 1 dia depois de vencer): uma execução que falhou ou não rodou adia o prazo em um dia até alguém corrigir (seção 3; `docs/JOBS.md`, 8.1). A política diz isso (se uma limpeza falhar ou não rodar, o prazo cresce pelos dias sem limpeza). **Nenhum alerta vigia a ausência** da `retention` (agendador que não publica, worker que não acorda): um buraco de sábado ou de domingo só aparece aqui, na segunda-feira, e cada dia a mais é um dia além dos 7 prometidos (`docs/INFRA.md`, 5.3, limitações).
6. **Mensal (dia 1).** O `backup-verify` (03:00 de Brasília) é `SUCCEEDED`. Confira o blob como na seção 5.3.

**Risco:** nenhum. São leituras.

## 2. Ciclo travado, pulado ou sem decisão

**Não ensaiado.** Cobre `admin.cycle.rerun`, `ciclo-pulado`, `hold-por-falha-ou-resposta-invalida` e `alvesting-decisions-fila-parada`.

**Reprocessar o ciclo do pregão** (botão "Reprocessar um ciclo" no painel, ou a rota abaixo). Publica a `decide` só de quem ainda não tem decisão gravada, e nunca depois de 09:25 de Brasília (`RERUN_MARGIN_MS`: 5 minutos antes do prazo das 09:30). A decisão gravada não muda, a operação é idempotente (o MessageId é o mesmo), e a linha `admin.cycle.rerun` é gravada antes da ação.

Quando: o alerta `ciclo-pulado` (o motivo é `orcamento` ou `sem_briefing`), ou a conferência da seção 1 mostra modelo sem decisão e a `decide` foi para a DLQ (seção 3).

Antes:
- Janela: `TZ=America/Sao_Paulo date '+%H:%M'` entre 08:00 e 09:25. Fora dela a rota não publica nada (`past_deadline` ou `not_open_yet`).
- Motivo `orcamento`: `GET /admin/costs`. Teto estourado, ou sem `ARENA_MONTHLY_COST_CAP_USD`, faz o reprocesso pular do mesmo jeito. Subir o teto é deploy da fase 2 (`arenaMonthlyCostCapUsd`, `docs/INFRA.md`, 2.7).
- Motivo `sem_briefing`: o `freeze` não rodou. Reenvie-o da DLQ (seção 3) antes de reprocessar.
- Temporada: `GET /api/v1/admin/seasons` tem uma em `RUNNING`.

Comando (o painel faz o mesmo, com confirmação):

```bash
D="$(TZ=America/Sao_Paulo date +%F)"          # o pregão de hoje; ou troque por <AAAA-MM-DD>
curl -sS -b "$J" -H "Origin: $SITE" -X POST "$SITE/api/v1/admin/cycles/$D/rerun"
```

Depois: `seasons[].result` diz o que aconteceu por temporada: `published` (com a contagem), `skipped` (com o `reason`), `no_pending` (todo modelo já decidiu) ou `already_closed`. `409 NOT_A_TRADING_DAY`: o dia não é pregão. `503 NOT_CONFIGURED`: a api não tem `PROMPT_ARENA_VERSION` (deploy). `502 PUBLISH_FAILED`: repita, é seguro. Em alguns minutos, as `decide` aparecem em `jobs` como `SUCCEEDED`, ou em `failures`.

**Risco:** uma `decide` publicada perto das 09:25 pode começar depois do prazo e gravar HOLD `prazo`, sem chamar o modelo. Não reprocesse com `az containerapp job start -n job-sched-cycle`: esse job não confere o prazo nem a janela.

**`alvesting-decisions-fila-parada`** (a fila `decisions` não esvaziou em 15 minutos: o ciclo travou). Veja se o KEDA acordou o worker, e o que a execução fez:

```bash
az containerapp job execution list -g $RG -n job-worker-decisions -o table
WS="$(az monitor log-analytics workspace show -g $RG -n log-alvesting --query customerId -o tsv)"
az monitor log-analytics query --workspace "$WS" --analytics-query \
  "ContainerAppConsoleLogs_CL | where ContainerGroupName_s startswith '<nome da execução>' | order by TimeGenerated asc" -o table
```

Se nenhuma execução acordou, `az containerapp job start -g $RG -n job-worker-decisions` põe uma para consumir uma mensagem (sem mensagem, ela sai sem fazer nada). Não verificado na Azure. Uma mensagem que acorda depois das 09:30 vira HOLD `prazo` sozinha.

**`hold-por-falha-ou-resposta-invalida`** (mais de 2 HOLDs forçados em 15 minutos: é causa comum). Olhe `failures` em `/admin/jobs` e o motivo gravado no `decide` (`decision.hold_reason`). As causas que o alerta procura são provedor fora, chave do OpenRouter errada (seção 4, `openrouter-api-key`) e prompt quebrado (seção 4.2, `prompt-arena`).

**`ciclo-pulado`:** os motivos estão em "Antes", acima.

## 3. Job falhou e DLQ

**Não ensaiado.** Cobre `admin.dlq.resubmit`, `alvesting-dlq-qualquer-fila`, a regra de log `alvesting-sinais-da-aplicacao` (um alerta por sinal), `job-falhou` e `news-seguranca`.

Quando: o alerta da DLQ (uma mensagem em qualquer das seis filas), `job-falhou` (um `job_run` ficou `FAILED`) ou `news-seguranca` (a fila `news` falhou por motivo de segurança, já na primeira vez). O `eod-barras-ausentes`, o `brapi-cota-baixa` e o `barras-divergentes` têm a seção 12.

1. **Veja a causa.** `GET /admin/jobs`: `failures` (os 10 `FAILED` mais recentes, com o erro já sem dado pessoal e cortado em 300 caracteres) e `queues[].messages` (MessageId, entregas, motivo e hora; nunca o corpo).
2. **Corrija antes de reenviar.** Por fila, o que manda a mensagem para a DLQ está em `docs/JOBS.md`, seção 5. Resumo:
   - `market` (`eod`, `universe`): a brapi com 401, 402 ou 403 (token ausente ou recusado, plano sem o recurso), o banco, a publicação do `settle`, ou a janela do `universe` incompleta (a carga inicial, seção 12.5). Falta de barra, 429, 5xx e cota baixa não vão para a DLQ: o `eod` reagenda e conclui no prazo (seção 12). Nada se baixa da B3.
   - `news`: `news-seguranca` (DTD, host ou redirecionamento fora da lista fixa, ZIP que não bate, CVM com formato novo) indica feed comprometido ou arquivo que mudou, não queda. Tire a fonte de `sources.ts` por PR até entender. Rede e HTTP são queda: a fila repete sozinha, e `job-falhou` só alerta a partir da 3ª tentativa.
   - `briefing` (`freeze`): cobertura abaixo de 80%, universo ausente ou o Blob fora. Corrija e reenvie antes das 09:30, porque o ciclo depende dele.
   - `settlement` (`settle`): dado incompleto (as barras do pregão, o CDI). Uma `settle` morta deixa a temporada `RUNNING` e trava o `freeze` seguinte (`docs/INFRA.md`, 5.3).
   - `maintenance` (`retention`, `backup-verify`): **não reenvie enquanto o `job_run` estiver `RUNNING`.** Ele só é reassumido 25 minutos depois do início da execução que morreu (`lockRenewalMs`). Antes disso o reenvio volta `busy` e a mensagem volta à DLQ.
   - `decisions`: a fila só recebe mensagem inválida, ou a decisão que nem o banco aceitou (a última entrega grava HOLD `falha` e conclui, ADR 0021). Reenviar depois das 09:25 não adianta.
3. **Reenvie.** Até 10 MessageIds por chamada. É idempotente: o que já saiu da DLQ volta `not_found`, sem publicar de novo.

```bash
curl -sS -b "$J" -H "Origin: $SITE" -H 'Content-Type: application/json' -X POST \
  "$SITE/api/v1/admin/dlq/<fila>/resubmit" --data '{"messageIds":["<messageId>"]}'
```

`<fila>` é `market`, `news`, `briefing`, `decisions`, `settlement` ou `maintenance`. Cada id volta `resubmitted`, `not_found` (já saiu) ou `invalid` (continua inválido e fica na DLQ).

4. **Confira.** O `job_run` vai a `SUCCEEDED` (em `jobs`) e a DLQ volta a zero: `az servicebus queue show -g $RG --namespace-name sb-alvesting --name <fila> --query countDetails -o json`.

**`news-seguranca`.** Não reenvie antes de ler o `reason`: o slot seguinte rebusca o feed, então uma `fetch` antiga não tem valor.

**Risco:** reenviar sem corrigir a causa devolve a mensagem à DLQ, depois do número de entregas da fila (`docs/JOBS.md`, seção 2).

## 4. Girar um segredo (Key Vault)

**Não ensaiado.** Cobre `filtro-de-vazamento`: o sinal diz que o texto de um modelo parecia o prompt. Pode ser vazamento; nesse caso gire o `prompt-arena` (4.2).

Quando: vazamento suspeito, troca de quem tinha acesso ao cofre ou ao banco, ou um prazo que o Artur decidir. A lista é a de `docs/INFRA.md`, 2.6: os semeados por `infra/scripts/seed-secrets.sh` e os que o Bicep grava.

| Segredo (`kv-alvesting`) | Quem lê | Como gira |
|---|---|---|
| `better-auth-secret` | `ca-api` (assina as sessões) | 4.1; **derruba todas as sessões** |
| `revalidate-secret` | `ca-web`, `ca-worker-data` | 4.1, nos dois apps ao mesmo tempo |
| `quotes-secret` | `ca-web`, `ca-api` (a rota interna de cotações) | 4.1, nos dois apps, a `ca-api` primeiro e o `ca-web` logo em seguida |
| `openrouter-api-key` | `job-worker-decisions` | 4.1, fora do ciclo |
| `google-oauth-client-secret` | `ca-api` | no Google Cloud, depois 4.1 |
| `brapi-token` | `ca-worker-data` | 4.1 |
| `prompt-arena` | `job-worker-decisions` (versão fixa no URI); `job-sched-cycle` e `ca-api` (só a versão) | 4.2: nova versão e deploy, **só sem temporada em andamento** |
| `prompt-chat` | `ca-api`, só com o chat (etapa 13) | igual ao `prompt-arena`; ainda não existe |
| `database-url` | o login administrador: `ca-worker-data`, decisões, agendadores, `job-migrate` | 4.3: senha do administrador, deploy com `writeDerivedSecrets=true` |
| `database-url-api` | o login `alvesting_api`: `ca-api` e `job-migrate` | 4.3: a ordem da senha da api |
| `acs-connection-string` | `ca-api` | regenerar a chave, depois deploy com `writeDerivedSecrets=true` |
| `appinsights-connection-string` | `ca-web`, `ca-api`, `ca-worker-data`, decisões, agendadores | só se vazar: deploy com `writeDerivedSecrets=true` |
| `front-door-id` | `ca-web`, `ca-api` (trava de origem) | não é segredo de fato (é o ID do perfil); só muda se o perfil for recriado |

### 4.1 Girar um segredo semeado pelo Artur

Vale para `better-auth-secret`, `revalidate-secret`, `quotes-secret`, `openrouter-api-key`, `google-oauth-client-secret` e `brapi-token`:

```bash
umask 077; F="$(mktemp)"; trap 'rm -f "$F"' EXIT
openssl rand -base64 48 | tr -d '\n' > "$F"    # só para os gerados ao acaso; os de fora: escreva em "$F" num editor, nunca no chat
az keyvault secret set --vault-name $KV --name <segredo> --file "$F" --encoding utf-8 -o none
az keyvault secret list-versions --vault-name $KV --name <segredo> --query 'length(@)' -o tsv   # uma versão a mais
az containerapp revision list -g $RG -n <app> --query "[?properties.active].name" -o tsv | while read -r r; do
  az containerapp revision restart -g $RG -n <app> --revision "$r"
done
rm -f "$F"
```

`<app>` é o app que lê o segredo (tabela acima). Não use o `seed-secrets.sh` para girar: ele não sobrescreve valor real, de propósito. Os apps pegam a versão nova em até 30 minutos; o reinício das revisões ativas faz valer na hora. Os jobs (`job-worker-decisions`, `job-sched-*`) não têm revisão: a próxima execução usa o que a Azure resolver ao começar (não verificado; confira no log do primeiro giro).

- **`better-auth-secret`:** girar derruba todas as sessões, porque o cookie assinado com o segredo velho deixa de valer. Todos entram de novo, o admin inclusive. Use uma hora de pouco uso. O segredo tem de ter 32 caracteres ou mais, com pelo menos 12 distintos; `openssl rand -base64 48` cumpre.
- **`revalidate-secret`:** gire nos dois apps (`ca-web` e `ca-worker-data`). Se só um trocar, a revalidação depois da liquidação responde 401 e o worker registra `cache_publico_falhou`. A liquidação não falha, e o cache público leva no máximo 5 minutos para vencer (`docs/JOBS.md`, 4.2).
- **`quotes-secret`:** o site manda e a api confere (a rota interna de cotações, `docs/API.md`, seção 6), então gire nos dois apps, **a `ca-api` primeiro e o `ca-web` logo em seguida** (os dois reinícios do comando acima, um depois do outro, sem esperar os 30 minutos), e **nunca o site primeiro**. Entre os dois reinícios a api só aceita o segredo novo e o site ainda manda o velho: o cache de dados do site (5 minutos) segura as páginas que já tinham a leitura, mas só até vencer ou até a revalidação que o worker pede depois da próxima liquidação (`expire: 0`), e toda leitura nova nesse intervalo vira 404 na api e `QUOTES_REFUSED` no site. A home e a página da ação, que dependem da rota (a faixa do BOVA11 e as velas), mostram "Não foi possível carregar os dados" até o `ca-web` reiniciar com o valor novo, e o reinício também esvazia o cache dele. Com o site primeiro é pior: o cache de dados do Next guarda a leitura com uma chave que inclui o cabeçalho `Authorization`, então o segredo novo muda a chave, todas as leituras erram na hora e a api (ainda com o velho) responde 404 a todas. A tela de erro sai com **status 200**, então o alerta de 5xx do Front Door não dispara e nenhum sinal do `alerts.bicep` a vê (o 404 do segredo é só da api): a falha só aparece no `smoke` do próximo deploy ou numa conferência à mão, e por isso **confira na hora**: abra a home e uma página de ação (`/acoes/PETR4`), e a faixa do BOVA11 e as velas aparecem. Nada se perde nem vaza: o 404 não diz nada a quem não tem o segredo. O valor tem de ser ASCII visível, sem espaço, com 32 caracteres ou mais (`openssl rand -base64 48` cumpre): o resto impede a `ca-api` de subir, e o site cai na tela de erro com o nome da variável no log (nunca o valor). Se a rotação virar rotina, a saída é a api aceitar um `QUOTES_SECRET_PREVIOUS` durante a troca (poucas linhas no `quotes-secret.guard.ts`, comparando os dois resumos em tempo constante), o que tira a janela; hoje ela é rara (vazamento suspeito) e a janela é de segundos a minutos.
- **`openrouter-api-key`:** gire fora das 08:00 às 09:30. Chave errada faz cada `decide` virar HOLD `falha`, e duas no mesmo quarto de hora disparam `hold-por-falha-ou-resposta-invalida` (seção 2).
- **`google-oauth-client-secret`:** gere o novo segredo no Google Cloud (`docs/CONTA.md`, 6), grave no cofre e reinicie o `ca-api`. Até reiniciar, o login por Google falha; o e-mail e a senha seguem.
- **`brapi-token`:** é a fonte única das cotações (o `eod` e a atualização semanal do `universe`). Gire no site da brapi e grave no cofre; o worker lê o valor ao subir, então reinicie o `ca-worker-data`. Token recusado aparece como `job-falhou` (seção 3). Não use o token em teste nem em requisição fora do plano: cada uma gasta a cota de 15 mil por 30 dias (seção 12).

### 4.2 Girar o `prompt-arena` (`filtro-de-vazamento`)

Só com **nenhuma temporada `RUNNING`** (`GET /api/v1/admin/seasons`). Trocar no meio de uma temporada faz o ciclo aberto virar HOLD `prompt_divergente`, e mistura dois prompts no mesmo campeonato (`docs/ARENA.md`, seção 6). O `seed-secrets.sh` não serve aqui, porque não sobrescreve: use o `az keyvault secret set`.

1. Confira o texto novo fora do repositório: a linha de canário (`docs/ARENA.md`, seção 6) precisa estar nele. Não cole o texto em lugar nenhum.
2. Grave a versão nova e pegue o identificador dela:

```bash
az keyvault secret set --vault-name $KV --name prompt-arena --file <arquivo-do-prompt> --encoding utf-8 -o none
export ALVESTING_PROMPT_ARENA_VERSION="$(az keyvault secret list-versions --vault-name $KV --name prompt-arena \
  --query 'sort_by([?attributes.enabled], &attributes.created)[-1].id' -o tsv | sed 's#.*/##')"
echo "$ALVESTING_PROMPT_ARENA_VERSION"               # 32 hexadecimais
```

3. Deploy da fase 2 com as tags que estão no ar (`docs/INFRA.md`, 6, passo 7). Primeiro o `what-if`, depois o `create`:

```bash
TAGS="$(RESOURCE_GROUP=$RG node scripts/deploy.mjs current-tags)"
az deployment group what-if --resource-group $RG --name alvesting --parameters infra/main.prod.bicepparam $TAGS
az deployment group create  --resource-group $RG --name alvesting --parameters infra/main.prod.bicepparam $TAGS
```

A versão vai ao `job-sched-cycle`, ao `job-worker-decisions` e à `ca-api` no mesmo deploy. Confira nos dois jobs:

```bash
for j in job-sched-cycle job-worker-decisions; do
  az containerapp job show -g $RG -n $j --query "properties.template.containers[0].env[?name=='PROMPT_ARENA_VERSION'].value | [0]" -o tsv
done
```

Os dois têm de imprimir a versão nova.

**Risco:** um deploy entre o ciclo das 08:00 e a `decide` deixa o ciclo preso à versão antiga, e ele vira HOLD `prompt_divergente`. Por isso o deploy vai entre a liquidação da noite e as 08:00 do pregão seguinte. Um prompt sem a linha de canário é recusado pelo job (erro de configuração, que o alerta enxerga).

- **`prompt-chat`:** não existe ainda (etapa 13, com o aval do orientador). Quando existir, a regra é a do `prompt-arena`, com `enableOpenAI` no deploy.

### 4.3 As senhas do Postgres

**`database-url`: a senha do administrador.** Gere a nova, exporte `ALVESTING_PG_ADMIN_PASSWORD` (lida com `read -rs`) e **também** `ALVESTING_PG_API_PASSWORD` com a senha **atual** do `alvesting_api`: o deploy regrava o `database-url-api` com ela, e uma senha velha ali desfaz o giro (`docs/INFRA.md`, 8.2). Depois o deploy com `writeDerivedSecrets=true`, que reinicia `ca-web` e `ca-api` uma vez (queda curta):

```bash
TAGS="$(RESOURCE_GROUP=$RG node scripts/deploy.mjs current-tags)"
az deployment group what-if --resource-group $RG --name alvesting --parameters infra/main.prod.bicepparam writeDerivedSecrets=true $TAGS
az deployment group create  --resource-group $RG --name alvesting --parameters infra/main.prod.bicepparam writeDerivedSecrets=true $TAGS
```

Sem `writeDerivedSecrets=true` o servidor troca a senha, o `database-url` fica com a velha, e os apps perdem o banco.

**`database-url-api`: a senha do `alvesting_api`.** Não é a do administrador, e não usa `writeDerivedSecrets`. A ordem é a de `docs/INFRA.md`, 8.2:

```bash
umask 077; F="$(mktemp)"; trap 'rm -f "$F"' EXIT
NOVA="$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-40)"    # guarde no gerenciador de senhas ANTES de seguir
SERVER="$(az postgres flexible-server show -g $RG -n psql-alvesting --query fullyQualifiedDomainName -o tsv)"
printf 'postgresql://alvesting_api:%s@%s:5432/alvesting?sslmode=require' "$NOVA" "$SERVER" > "$F"
az keyvault secret set --vault-name $KV --name database-url-api --file "$F" --encoding utf-8 -o none
az containerapp job start -g $RG -n job-migrate                 # o db:roles troca a senha no banco
az containerapp job execution list -g $RG -n job-migrate -o table    # espere Succeeded
az containerapp revision list -g $RG -n ca-api --query "[?properties.active].name" -o tsv | while read -r r; do
  az containerapp revision restart -g $RG -n ca-api --revision "$r"
done
rm -f "$F"
```

Depois, atualize a `ALVESTING_PG_API_PASSWORD` no seu gerenciador de senhas (a próxima execução com `writeDerivedSecrets=true` regrava o segredo com ela).

**Janela de erro, aceita.** Do passo do job até a réplica ler o segredo novo, cada conexão nova falha com `password authentication failed`, e a requisição responde 5xx (o `api-5xx` pode alertar, seção 6). Faça fora das 08:00–09:30 e da noite do `eod`. Se o reinício vier antes do job, a api não conecta até o `db:roles` rodar de novo. **Não verificado na Azure:** se o `job start` e o reinício já leem a versão nova do cofre, ou se esperam a atualização de até 30 minutos.

**Risco:** no giro da senha do administrador, `ca-web` e `ca-api` reiniciam. No giro da senha da api, o risco é o 5xx da janela acima.

- **`acs-connection-string`:** a chave primária do Communication Services (`acs-alvesting`) é regenerada pelo portal (a CLI pede uma extensão de `az` que este runbook não instala; não verificado). Depois, o deploy com `writeDerivedSecrets=true` regrava o segredo derivado. Até o deploy, o e-mail da conta falha (`email-da-conta`, seção 8).
- **`appinsights-connection-string`:** só se vazar. Não há comando de giro estudado para ela (não verificado): recrie o que o Bicep recria e faça o deploy com `writeDerivedSecrets=true`.
- **`front-door-id`:** é o ID do perfil, não um segredo. Só muda se o perfil for recriado. Se mudar à mão, o app recusa tudo com 403 até o deploy.

## 5. Banco: restaurar backup, CPU e disco

**Não ensaiado.** Nunca restaurou no Flexible Server. Cobre `alvesting-banco-cpu`, `alvesting-banco-disco` e a verificação mensal do `backup-verify`.

### 5.1 Qual caminho

| Situação | Caminho | O que volta |
|---|---|---|
| Dado estragado ou apagado nos últimos 7 dias, ou servidor perdido | PITR (5.2) | tudo, com dado pessoal, até 7 dias |
| Cópia mensal sem dado pessoal (histórico público) | dump do `backup-verify` (5.3) | esquema e dado público; nunca `user`, `session`, `account`, `verification`, `consent`, `portfolio` nem `portfolio_lot`: **a carteira só volta pelo PITR** (7 dias) |

### 5.2 PITR para um servidor novo

O original não é tocado. Escolha o instante em UTC, antes do dano. Em rede privada, a documentação permite restaurar na mesma VNet ou em outra; a sub-rede aqui é a do servidor original, e se a Azure recusar, use outra sub-rede delegada (não verificado):

```bash
az postgres flexible-server restore -g $RG --name psql-alvesting-restaurado --source-server psql-alvesting \
  --restore-time "<AAAA-MM-DDTHH:MM:SSZ>" --vnet vnet-alvesting --subnet snet-postgres
```

A documentação (página "Backup and Restore in Azure Database for PostgreSQL Flexible Server", lida em 03/11/2026) diz que o PITR cria um servidor novo, na mesma região, com o tier, o hardware e a retenção do de origem. **Não copia** os valores dos parâmetros, nem as regras de firewall e de VNet. Depois de restaurar, refaça o que não veio:

1. **Parâmetros.** O `require_secure_transport` (o Bicep o declara como `on`) e os demais não vêm no servidor novo. Confira com `az postgres flexible-server parameter show` e ajuste com `az postgres flexible-server parameter set --server-name psql-alvesting-restaurado --name require_secure_transport --value ON`. Sem TLS obrigatório, o servidor aceita `sslmode=disable`.
2. **Rede.** Confira que o servidor novo enxerga a sub-rede dos apps (`snet-apps`) e a zona DNS privada que a CLI criou para ele.
3. **Logins.** Confira `alvesting_api` e `alvesting_api_group` (`\du`), porque a documentação manda conferir "logins e permissões". Se a senha do `alvesting_api` no servidor novo não for a do segredo `database-url-api`, o job de migração (`db:roles`, seção 4.3) acerta.
4. **Segredos.** Aponte `database-url` e `database-url-api` para o host novo (`az postgres flexible-server show -g $RG -n psql-alvesting-restaurado --query fullyQualifiedDomainName -o tsv`). **Enquanto o servidor definitivo não estiver decidido, não rode `writeDerivedSecrets=true`:** o Bicep ainda aponta para `psql-alvesting` e regravaria o host antigo.
5. **Apps.** Reinicie `ca-api`, `ca-web` e `ca-worker-data` (seção 4.1) e confira `/health` e `/api/v1/health`.

O Blob não volta com o PITR. Os containers têm exclusão lógica de 7 dias (`docs/INFRA.md`, 4), e a recuperação de blob apagado não foi ensaiada. Para servidor apagado (não só desligado), a documentação tem página própria de restauração; não verificada aqui.

**Risco:** o servidor novo cobra enquanto existir. Apague o que sobrar depois de conferir.

### 5.3 Dump mensal (`backup-verify`)

O `backup-verify` dia 1, às 03:00 de Brasília, grava `alvesting-AAAA-MM.dump` no container `backups` (12 meses, `docs/JOBS.md`, 8.2). **Conta como verificado só o dump com os metadados `sha256` e `personal_data`.** Sem eles, o processo pode ter morrido entre o envio e a conferência, e o dump não serve.

```bash
B="alvesting-<AAAA-MM>.dump"
az storage blob show --auth-mode login --account-name stalvesting -c backups -n "$B" --query metadata -o json
umask 077; F="$(mktemp)"; trap 'rm -f "$F"' EXIT
az storage blob download --auth-mode login --account-name stalvesting -c backups -n "$B" -f "$F"
shasum -a 256 "$F"                                    # tem de bater com o metadado sha256
```

Quem roda precisa do papel `Storage Blob Data Reader` no container `backups` (RBAC por container, ADR 0030). Ele não está no Bicep: se der 403, dê o papel no escopo do container (`az role assignment create`). Não verificado na Azure.

**Restaurar para conferir (não é a restauração de desastre).** No contêiner de dev do Postgres 17.11, num banco novo com sufixo `_test` (nunca o `alvesting_dev`):

```bash
docker cp "$F" alvesting-postgres-1:/tmp/alvesting.dump
docker exec alvesting-postgres-1 createdb -U alvesting alvesting_restore_test
docker exec alvesting-postgres-1 pg_restore -U alvesting -d alvesting_restore_test --no-owner --exit-on-error /tmp/alvesting.dump
docker exec alvesting-postgres-1 dropdb -U alvesting alvesting_restore_test
```

**Restaurar na Azure não tem caminho pronto.** O servidor é privado (sem acesso público), então o `pg_restore` tem de rodar dentro da VNet, e o Bicep não tem um job para isso. Se for preciso: crie o papel de grupo no servidor novo antes (`CREATE ROLE alvesting_api_group NOLOGIN`), porque o dump traz `GRANT` para ele e o `pg_restore --exit-on-error` para no primeiro se o papel não existir (`docs/JOBS.md`, 8.2); depois rode o `db:roles`. O dump não traz logins nem senhas. Lacuna: não ensaiada.

### 5.4 CPU e disco (`alvesting-banco-cpu`, `alvesting-banco-disco`)

- **Disco acima de 80%** (os 32 GB do `postgres.bicep`: dados, log de transações e log do servidor). Veja o que cresce pelo SQL pontual abaixo. Aumentar é `storageSizeGB` no `postgres.bicep` e deploy (o disco só cresce). A retenção diária já limpa sessões, cadastros não confirmados e `fetch` com mais de 30 dias; o `news_item` não tem limpeza, de propósito (`docs/JOBS.md`, 8.1).
- **CPU acima de 80% por 5 minutos.** O B1ms é Burstable: sem créditos, a CPU fica no teto. Veja o que roda (`pg_stat_activity`, pelo mesmo caminho). A saída é subir de tier (B2s, plano 5.13, fase 3), por deploy.

**SQL pontual** (leitura, ou a correção da seção 6), pelo job de migração com o comando trocado (`docs/INFRA.md`, 8.6). Só o `command` e os `args` do contêiner `migrate` mudam; o resto do modelo fica como veio. O `DATABASE_URL` desse job é o login **administrador**: o que o SQL escreve, acontece.

```bash
umask 077; F="$(mktemp)"; trap 'rm -f "$F"' EXIT
az containerapp job show -g $RG -n job-migrate --query properties.template -o yaml > "$F"
# edite "$F" (só command e args do contêiner migrate):
#   command:
#   - sh
#   args:
#   - -c
#   - psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10"
az containerapp job start -g $RG -n job-migrate --yaml "$F"
az containerapp job execution list -g $RG -n job-migrate -o table     # Succeeded; o resultado sai no log da execução
rm -f "$F"
```

## 6. Site ou api fora do ar: voltar uma revisão

**Não ensaiado.** Cobre `api-5xx`, `alvesting-front-door-origem-doente` e `alvesting-front-door-5xx`.

Quando:
- `api-5xx`: mais de 1% das requisições da api deram 5xx em 10 minutos (o `/api/auth/*` conta também).
- `alvesting-front-door-origem-doente`: metade ou mais das sondas do Front Door falharam na `web` ou na `api`.
- `alvesting-front-door-5xx`: mais de 1% de 5xx na borda. É **falso alarme conhecido** quando uma revisão nova falha na prova do endpoint green (ADR 0029).

Antes de voltar nada, veja (1) se o `deploy.yml` deste SHA falhou na prova: se falhou, o `Desfazer` já devolveu o tráfego e o site de produção não tem culpa; (2) o log do app (`ContainerAppConsoleLogs_CL`, o Application Insights e as falhas); (3) quem tem o tráfego:

```bash
for app in ca-api ca-web; do az containerapp ingress traffic show -n $app -g $RG -o table; done
az containerapp revision list --all -n ca-api -g $RG -o table     # ca-api--<sufixo>: a que tem o tráfego e a anterior
```

Voltar **uma** revisão (depois do deploy confirmado; as antigas estão desativadas, por isso `--all`):

```bash
export RESOURCE_GROUP=$RG
node scripts/deploy.mjs revert ca-api--<sufixo>      # e, se a web também precisar: revert ca-web--<sufixo>
curl -fsS "$SITE/health" && curl -fsS "$SITE/api/v1/health"
```

O `revert` reativa a revisão, espera ela ficar saudável, passa 100% a ela (conferindo que ficou numa só), desativa a defeituosa e confere o `/health`. Se a que volta não fica saudável, o tráfego não muda. Ele não toca no label `green` nem nos jobs.

**Deploy que morreu no meio** (o runner caiu e o `Desfazer` não rodou; `docs/DEPLOY.md`, seção 6): os três passos à mão, em cada app que tem revisão nova:

```bash
az containerapp ingress traffic set -n ca-api -g $RG --revision-weight ca-api--<a antiga>=100
az containerapp revision label remove -n ca-api -g $RG --label green
az containerapp revision deactivate -n ca-api -g $RG --revision ca-api--<a nova>
```

**Jobs não voltam por `revert`.** Worker, decisões e agendadores não têm revisão: use o *Re-run all jobs* do run verde do commit que você quer de volta, ou `az containerapp job update -g $RG -n <job> --image <imagem antiga>` em cada um (`docs/DEPLOY.md`, seção 6).

**`eod` em espera.** Se a revisão que volta é anterior à etapa 10 e existe um `eod` `WAITING` (o arquivo do pregão não chegou), o código antigo não reassume a linha, e o `eod` do dia vai para a DLQ. Feche a linha **antes** da cópia agendada (21:30 de Brasília), com o SQL pontual da seção 5:

```sql
UPDATE job_run SET status = 'FAILED' WHERE status = 'WAITING';
```

**Export sem a carteira.** Se a revisão da api que volta é anterior à etapa 12, ela monta o `GET /me/export` sem `portfolios` nem `portfolioLots` (os lançamentos seguem no banco, intactos, e a exclusão da conta os apaga pela cascata do banco): enquanto essa revisão estiver ativa, o direito de acesso (LGPD, art. 18) não leva a carteira. Volte para a revisão nova assim que o defeito sair; quem pedir os dados nesse intervalo recebe o arquivo depois (ADR 0031).

**Risco:** a migração não volta (é aditiva, e o código antigo convive com o banco novo). Mudança incompatível em `/api/v1` segue a regra de lançamentos separados (`CLAUDE.md`). Depois do `cleanup` (ponto sem volta) a revisão antiga está desativada: o `revert` a reativa, e leva alguns minutos.

## 7. Primeiro admin e rebaixamento

**Não ensaiado.** Nunca rodou na assinatura. Cobre `account.promoted` e `account.demoted`.

O Postgres é privado, então o `account:promote` roda como uma execução do `job-migrate` com outro comando (`docs/INFRA.md`, 8.6). O modelo da execução substitui o modelo inteiro do job, por isso o YAML.

**Antes do `promote`, com a conta do operador:** crie a conta no site com o e-mail do operador, confirme o link e **entre com a senha que escolheu**. O `promote` só exige e-mail verificado, e isso não prova que a conta é sua: se outra pessoa cadastrou o seu endereço antes, a conta é dela. Se o login responder 401, use "Esqueci a senha" (que revoga as sessões) e entre de novo (`docs/CONTA.md`, 4).

```bash
umask 077; F="$(mktemp)"; trap 'rm -f "$F"' EXIT
az containerapp job show -g $RG -n job-migrate --query properties.template -o yaml > "$F"
# edite "$F": troque só command e args do contêiner migrate; o resto fica como veio
#   command:
#   - node
#   args:
#   - dist/account-cli.js
#   - promote
#   - <e-mail-do-operador>
az containerapp job start -g $RG -n job-migrate --yaml "$F"
az containerapp job execution list -g $RG -n job-migrate -o table     # espere Succeeded
rm -f "$F"
```

Saída do log: `conta <ULID> promovida a admin`, e o lembrete de entrar com a própria senha. A trilha grava `account.promoted` com ator `cli` e o nome da execução. Confira entrando na conta: `/admin` abre.

**Rebaixar** (`account.demoted`): o mesmo bloco, com `args` `demote` e o e-mail. Tira o papel **e encerra todas as sessões** da conta. A saída diz `rebaixada a usuário; N sessão(ões) encerrada(s)`. Repetir não muda nada e não derruba quem já voltou a entrar como usuário comum. Confira que `/admin` responde 404 para a conta.

**Risco:**
- Promoveu a conta errada: rode o `demote` com o mesmo e-mail, e depois o "Esqueci a senha" na conta que é de fato a sua.
- Quem pode iniciar um job lê os segredos dele. Só o operador tem esse papel hoje.
- O e-mail do operador fica no histórico de execuções do job, visível a quem lê o grupo de recursos. Use a conta de operador, nunca outra.
- A CLI recebe o e-mail, e não o ULID: pendência em "Lacunas conhecidas".

## 8. Conta: e-mail, aceite e exclusão

**Não ensaiado.** Cobre `email-da-conta`, `aceite-nao-gravado` e `account.deleted`.

### 8.1 Cota de e-mail do Communication Services (`email-da-conta`)

O sinal é `e-mail da conta não enviado: <Nome>[:código]`. O log não guarda o endereço, e o descarte por repetição em 60 segundos não conta.

```bash
WS="$(az monitor log-analytics workspace show -g $RG -n log-alvesting --query customerId -o tsv)"
az monitor log-analytics query --workspace "$WS" --analytics-query \
  "ContainerAppConsoleLogs_CL | where Log_s has 'e-mail da conta não enviado' | order by TimeGenerated desc | take 20 | project TimeGenerated, Log_s" -o table
```

O domínio gerenciado do Communication Services aceita **5 e-mails por minuto e 10 por hora por assinatura, sem como aumentar** (e 10 consultas de estado por minuto). Um domínio próprio verificado começa em 30 por minuto e 100 por hora, e tem pedido de aumento (`docs/CONTA.md`, 6).

- Não reenvie em massa. A cota se recupera sozinha, por minuto e por hora.
- Quem não recebeu pede o reenvio no login: o `403 EMAIL_NOT_VERIFIED` manda um e-mail novo, respeitando o limite de 60 segundos por destinatário.
- Se o sinal se repete o dia todo, pode ser abuso (muitos cadastros ou pedidos de redefinição). O caminho de médio prazo é o domínio próprio verificado (`docs/CONTA.md`, 8: decisão do Artur, com DNS).
- Confirme depois da hora com um cadastro de teste com endereço do operador.

**Risco:** a cota é da assinatura inteira, e qualquer pessoa que cadastra consome. Sem domínio próprio, não há como aumentar.

### 8.2 Aceite não gravado (`aceite-nao-gravado`)

O sinal é `aceite não gravado para o usuário <ULID>`: a conta foi criada e o aceite dos termos não foi gravado. Ela fica sem aceite, e as rotas que o pedem respondem 403 `CONSENT_REQUIRED`. Quem regulariza é o próprio usuário, com `POST /api/v1/me/consents` nas versões que viu (`docs/CONTA.md`, 2). O operador não grava aceite por outra pessoa.

Se o sinal se repete, é bug, não um usuário: veja o log da api no horário e, se a versão nova for a culpada, a seção 6 (voltar revisão).

### 8.3 Conta excluída (`account.deleted`)

É ação do titular, não do admin: `DELETE /api/v1/me` com a sessão recente (até 5 minutos) ou com a senha. A trilha guarda `account.deleted` com ator `user:<ULID>`, só o ULID.

Não há comando de operador para excluir a conta de outra pessoa. Quem não consegue entrar usa "Esqueci a senha" (que revoga as sessões) e depois exclui pela `/conta`. Pedido que chegue por outro canal não se executa por SQL sem decisão do Artur e do orientador (LGPD, `docs/CONTA.md`, 5).

## 9. Evento corporativo errado

**Não ensaiado.** Cobre `admin.corporate_event`, `corporate_event.created` e `corporate_event.updated`. A reliquidação só anda com um registro de evento.

A chave do evento é **ticker, data ex e tipo**. Registrar com a mesma chave e outro fator **corrige** o fator: a trilha grava `corporate_event.updated` com o fator antigo e o novo, e a reliquidação é enfileirada de novo.

**Caso 1: o fator está errado** (mesmo ticker, data ex e tipo). Registre de novo com o fator certo, pelo painel ("Evento corporativo") ou pela rota:

```bash
curl -sS -b "$J" -H "Origin: $SITE" -H 'Content-Type: application/json' -X POST \
  "$SITE/api/v1/admin/corporate-events" --data '{"ticker":"<TICKER>","exDate":"<AAAA-MM-DD>","kind":"split","factor":"1:2"}'
```

`kind` é `split`, `reverse-split` ou `bonus`. `factor` é `de:para` (desdobramento `1:2`, grupamento `10:1`), com a direção do tipo: direção contrária é 400 `INVALID_EVENT`. A resposta traz `queued` (temporadas cuja liquidação foi enfileirada) e `pending` (as que liquidaram só até antes da data ex). **Ela não diz que o resultado mudou:** o worker liquida em alguns minutos, e o ranking público leva até 5 minutos a mais por causa do cache. Depois, confira o `settle` em `SUCCEEDED` (em `/admin/jobs`). `502 PUBLISH_FAILED`: o evento ficou registrado, e repetir é seguro.

**Caso 2: ticker, data ex ou tipo errados, ou um evento que não devia existir.** **Não há rota nem comando para apagar um evento** (`docs/API.md`, seção 8). O caminho que existe é SQL pontual (seção 5). Antes de rodar, confira o `SELECT` com o mesmo `WHERE`:

```sql
SELECT * FROM corporate_event WHERE ticker = '<TICKER>' AND ex_date = '<AAAA-MM-DD>';
DELETE FROM corporate_event WHERE ticker = '<TICKER>' AND ex_date = '<AAAA-MM-DD>' AND kind = '<SPLIT | REVERSE_SPLIT | BONUS>';
```

O `DELETE` não passa pela trilha: anote o motivo e a hora no seu registro. **Nada reliquida sozinho depois dele.** A reliquidação só é enfileirada por um registro de evento (o `eod` só liquida o pregão do dia). Se houver um evento certo para registrar, registre-o pelo caso 1, e as temporadas são liquidadas de novo sem o errado. Se não houver, **não há caminho ensaiado** para refazer o resultado: é lacuna (ver "Lacunas conhecidas").

**Risco:** um `DELETE` sem o `WHERE` completo apaga mais do que devia. O comando `settle:event` registra e liquida na hora, mas só roda de onde o banco é alcançável (`docs/JOBS.md`, seção 6).

## 10. Temporadas: criar, editar e iniciar

**Não ensaiado.** Cobre `admin.season.create`, `admin.season.update` e `admin.season.start`. O e2e nunca inicia uma temporada, de propósito (os specs dividem o banco): o início é provado só pelos testes de integração.

**Criar (rascunho).** Pelo painel ("Nova temporada") ou com o arquivo do `season:create` (`apps/api/seasons/temporada-0.json` é o modelo; o arquivo não está na imagem, então o envio sai do seu computador):

```bash
curl -sS -b "$J" -H "Origin: $SITE" -H 'Content-Type: application/json' -X POST "$SITE/api/v1/admin/seasons" --data @<arquivo-da-temporada.json>
```

Campo a mais, segredo inclusive, é 400. Slug repetido é 409 `SEASON_SLUG_TAKEN`.

**Editar.** Só o rascunho: `PATCH /api/v1/admin/seasons/<id>` com `name`, `params` e/ou `competitors` (o que for enviado substitui o campo inteiro). Temporada em andamento ou encerrada responde 409 `SEASON_LOCKED`.

**Iniciar.** `PATCH` com `{"status":"RUNNING"}`. A data de início é o próximo pregão depois de hoje, em Brasília. Antes, confira:
1. Nenhuma outra temporada `RUNNING`. A rota recusa com 409 `SEASON_RUNNING_EXISTS`, conferido dentro da transação e sob trava, então dois inícios juntos não passam os dois.
2. A versão do prompt já está no ar (seção 4.2). A temporada começa com o prompt que está no cofre, e o ciclo fixa a versão do deploy.
3. O `freeze` das 07:30 e o ciclo das 08:00 dos próximos pregões são automáticos.

```bash
curl -sS -b "$J" -H "Origin: $SITE" -H 'Content-Type: application/json' -X PATCH \
  "$SITE/api/v1/admin/seasons/<id>" --data '{"status":"RUNNING"}'
```

Depois: `GET /api/v1/admin/seasons` mostra `RUNNING`, e a temporada vira a "atual" da API pública.

**Risco:** não há rota para cancelar uma temporada em andamento nem para editar o elenco dela. Erro de elenco ou de parâmetro se resolve com a próxima temporada. Confira antes de iniciar.

## 11. Crédito da Azure acabando

**Não ensaiado.** Cobre `budget-alvesting`. O orçamento nasce na fase 1 (`deployBudget=true`). Em assinatura de estudante a Azure pode recusá-lo (`docs/INFRA.md`, 11), e nesse caso só a conferência no portal vale.

O orçamento de US$ 100 (`budgetAmount = 100`, o crédito do Azure for Students) manda e-mail para o `ag-alvesting` em 50%, 80% e 100%. **Ele avisa, não desliga nada** (`docs/INFRA.md`, 6).

**Ao chegar o de 80%:** é o gatilho para trocar de perfil. O padrão custa uns US$ 72 a 83 por mês; o econômico, uns US$ 5 a 10 (`docs/INFRA.md`, 9).
1. Confira o gasto no portal (Cost Management, o orçamento `budget-alvesting`) e a data em que o crédito acaba.
2. Troque o perfil: `profile=economico` (no `.bicepparam` ou na linha de comando) e faça o deploy normal (`docs/INFRA.md`, 8.1). O padrão **não apaga** o Front Door, o WAF nem o ACR. Apague o perfil do Front Door à mão só depois de conferir o tráfego e o DNS (`az afd profile delete`).

**Antes de o crédito acabar.** O plano assume que a assinatura de estudante **desliga os recursos** quando o crédito acaba. Isso não foi verificado aqui: confirme no portal da assinatura.
- Gere o dump do mês à mão, se ele ainda não existe: `az containerapp job start -g $RG -n job-sched-backup` publica o `backup-verify` do mês de Brasília, e é idempotente (`docs/JOBS.md`, 1). Baixe-o e guarde fora da Azure, com a conferência da seção 5.3. Sem dado pessoal.
- Guarde fora da Azure o que é só seu: os segredos no gerenciador de senhas (`ALVESTING_*`) e o arquivo do prompt. Banco e Blob ficam na assinatura, e somem com ela.
- Parar o Postgres (`az postgres flexible-server stop -g $RG -n psql-alvesting`) é uma opção de corte. A documentação diz que servidor parado não faz backup novo e mantém os antigos até ser reiniciado; o efeito na cobrança de computação e no crédito não foi verificado.
- Não apague o grupo de recursos sem decisão: `az group delete` apaga tudo, e em produção não tem volta.

**Risco:** sem agir a tempo no 80%, o crédito acaba com a arena no ar. Cronometre o e-mail do orçamento uma vez (`docs/INFRA.md`, 5.4).

---

## 12. Cotações (brapi): barras ausentes, cota baixa, barras divergentes, brapi fora do ar, a carga inicial e os logos

**Não ensaiado.** Cobre `eod-barras-ausentes`, `brapi-cota-baixa` e `barras-divergentes`, mais a brapi fora do ar, a carga inicial e o calendário de feriados do ano. Só a carga inicial (seção 12.5, no banco descartável) e a leitura dos cabeçalhos de cota foram exercitadas contra a brapi de verdade, na prova controlada de 04/11/2026 (10 requisições; `docs/DADOS.md`, seção 9). Os alertas, o 429, o 5xx e a brapi fora do ar nunca foram vistos de verdade: os testes usam um `fetch` falso. A fonte é a brapi (ADR 0032); nada se baixa da B3.

### 12.1 `eod-barras-ausentes`

Quando: o `eod` concluiu o pregão no prazo das 00:30 de Brasília **sem o BOVA11 ou sem mais de 10% do conjunto obrigatório** (campos `date`, `missing`, `required` e os 20 primeiros tickers). Faltar um ou outro papel sem negócio **não** alerta: vai só ao registro.

1. **Veja a causa.** O log do `ca-worker-data` traz, na mesma noite, a linha do `eod` (`eod: barras do conjunto obrigatório pedidas à brapi`, com `asked`, `requests`, `remaining` (a cota restante, só o número), `failed` e `stopped`) e, se a brapi caiu, `brapi: papéis seguidos sem resposta` ou `brapi-cota-baixa`. `stopped` é `outage` (a brapi fora do ar, seção 12.4), `quota` (seção 12.2) ou `time` (o orçamento de 4 minutos acabou).
2. **Nada a fazer na mesma noite se a brapi voltou.** A janela de 5 pregões recupera: o `eod` da noite seguinte pede, a cada papel, do pregão mais antigo que lhe falta até o de hoje, confirma os dois pregões e a liquidação do mais novo refaz a temporada em ordem. Conferir no dia seguinte: `SELECT d.date, d.source, (SELECT count(*) FROM daily_bar b WHERE b.date = d.date) AS barras FROM trading_day d WHERE d.date >= current_date - 7 AND d.source <> 'CALENDAR' ORDER BY d.date;` e o `job_run` do `eod` e do `settle` em `SUCCEEDED` (`GET /admin/jobs`).
3. **Passou da janela** (a brapi fora por mais de 5 pregões): a carga manual recupera um intervalo, só o que falta (seção 12.5, com `--de` e `--ate`). A liquidação dos pregões recuperados entra na próxima liquidação regular, que recalcula a temporada do zero (ver "Lacunas conhecidas").
4. **Sempre os mesmos papéis** (suspensos): é o esperado; eles mantêm as novas tentativas até as 00:30 e não alertam abaixo de 10%.

**Risco:** carregar à mão o que o `eod` já ia recuperar gasta cota à toa (uma requisição por papel).

### 12.2 `brapi-cota-baixa`

Quando: a cota restante da brapi (o **`X-RateLimit-Remaining`**, que vem com `X-RateLimit-Window: rolling-30d`) chegou à reserva de **500** requisições, de 15 mil numa janela móvel de 30 dias. O `BrapiClient` parou e deixou o resto como falta; o `eod` reagenda e conclui no prazo com o que tem (e o `eod-barras-ausentes` pode alertar junto). **O `RateLimit-Remaining` sem o `X` não é a cota**: é o do limitador de 20 por minuto (a lista, e às vezes o próprio histórico, sem nenhum `X-RateLimit-*` e sem gastar cota). Lido como cota, o "20" parou a carga do dev na 5ª requisição por "cota baixa" (achado de 04/11/2026, `docs/DADOS.md`, seções 2 e 9); o cliente de hoje só lê o par com `X`.

1. **Veja o consumo.** O painel da brapi (`brapi.dev/dashboard`) mostra o uso. O esperado é uns **7.900 por mês** (`docs/DADOS.md`, seção 6); a linha do alerta traz `remaining` e `reserve`. Se o `remaining` é **20** logo no começo de uma carga, não é falta de cota: desconfie de um cliente que voltou a ler o cabeçalho sem o `X` (o `brapi.client.spec.ts` tem o teste com os cabeçalhos reais) antes de mexer no plano.
2. **Ache o consumo fora do plano:** uma carga manual repetida (`market:backfill` com `--confirmo-banco` rodado várias vezes), um laço, muitos papéis de carteira (`SELECT count(DISTINCT ticker) FROM portfolio_lot;` o pior caso é uns 140) ou a janela recusada pela brapi (400 `DATE_WINDOW_EXCEEDED` em todos: não gasta cota, e cinco papéis seguidos sem resposta param a passada). A lista, o 400 e o 404 não gastam cota; só a resposta 200 do histórico que passa pela cota (a que traz o `X-RateLimit-Remaining`: na carga do dev, 3 de 372 vieram pelo limitador de 20 por minuto e não gastaram).
3. **A cota é uma janela móvel de 30 dias** (`X-RateLimit-Window: rolling-30d`, visto na prova controlada de 04/11/2026): cada requisição sai da conta 30 dias depois, então a cota volta aos poucos, e não de uma vez numa data (o FAQ da brapi fala em ciclo mensal que reinicia na data de renovação; a API disse outra coisa para o plano gratuito). Não há o que fazer além de esperar as requisições mais antigas saírem da janela, ou trocar de plano (Startup, 150 mil, R$ 119,99 por mês no plano mensal, segundo a mensagem da própria API; a página de preços de 03/11 mostra R$ 99,99 com a oferta do plano anual; a decisão é do Artur). **Não** use outra conta nem outra chave para "furar": os Termos de Uso da brapi proíbem exceder os limites do plano.
4. **Confira:** a linha deixa de aparecer quando o `X-RateLimit-Remaining` passa de 500 de novo.
5. **O contrário do alerta: a reserva cega.** O cliente só conhece a cota pelo `X-RateLimit-Remaining`. Se a brapi o renomeia ou o corta (um proxy, outro plano), nenhum alerta toca e a reserva deixa de proteger. O sinal é a linha de aviso **sem** alerta `brapi: nenhuma resposta do histórico trouxe o X-RateLimit-Remaining; a reserva de cota ficou cega nesta passada` (campo `responses`, 5 ou mais) e o `remaining: null` na linha do `eod`. Confira o consumo no painel da brapi e os cabeçalhos de uma resposta de verdade (uma requisição, na prova controlada, `docs/DADOS.md`, seção 9) antes de a cota acabar.

**Risco:** baixar a reserva (`QUOTA_RESERVE`, `domain/bar-plan.ts`) tira a folga da recuperação à mão.

### 12.3 `barras-divergentes`

Quando: a brapi trouxe, para um papel e um pregão que **já têm barra**, valor diferente do gravado (campos `count` e `first`, com papel, data e os campos que diferem). **A barra gravada não muda** (só inserção); o sinal pede que alguém olhe.

1. **Causa comum:** a brapi **ajusta o histórico** por provento, desdobramento ou grupamento (`docs/DADOS.md`, seção 4). A barra gravada ficou sem o ajuste; a nova veio com. Compare as duas: `SELECT date, open_cents, high_cents, low_cents, close_cents, volume_cents, source FROM daily_bar WHERE instrument_id = (SELECT id FROM instrument WHERE ticker = '<TICKER>') AND date = '<AAAA-MM-DD>';` contra o que a brapi diz para o papel e a data (só se for preciso, uma requisição fora da fila, com o token do cofre).
2. **Se foi desdobramento ou grupamento:** veja se o evento corporativo já está registrado (seção 9). **Não registre de novo** se a série da brapi já vem ajustada e a quantidade foi multiplicada: seria aplicado duas vezes. O evento só vale para a série que **não** está ajustada.
3. **Se a diferença não tem explicação:** guarde a linha do log e a resposta (sem o token) e não mexa na barra; o resultado da arena segue com o que está gravado.
4. **Corrigir uma barra errada** é SQL pontual (seção 5), e a liquidação só anda por um registro de evento (seção 9): não há gatilho para reliquidar um pregão já liquidado (ver "Lacunas conhecidas"); a próxima liquidação regular recalcula a temporada do zero com as barras gravadas.

**Risco:** apagar ou corrigir uma barra à mão muda o que o público vê e o que a liquidação seguinte calcula do zero.

### 12.4 Brapi fora do ar

1. Veja `https://status.brapi.dev`. O cliente para a passada depois de 5 papéis seguidos sem resposta (para não gastar duas requisições em cada um dos 300 papéis), e o `eod` reagenda de hora em hora até as 00:30.
2. Se voltou antes das 00:30, a nova tentativa pede **só a falta** e o pregão conclui. Se não, o pregão fecha sem barra, o `eod-barras-ausentes` alerta (12.1) e a noite seguinte recupera pela janela.
3. **Token recusado** (401, 402 ou 403) não é queda: é `job-falhou`, e a fila repete até a DLQ. Confira o segredo `brapi-token` no cofre (seção 4.1) e o plano da conta.

### 12.5 Carga inicial e recuperação (`market:backfill`)

Quando: o primeiro deploy (o `universe` de domingo precisa dos 60 pregões confirmados, e o banco novo não tem nenhum), a brapi fora por mais de 5 pregões, ou um papel que ficou sem histórico. O banco de dev já foi carregado assim em 04/11/2026 (`docs/DADOS.md`, seções 1 e 9); uma carga nova nele pede só a falta.

1. **Primeiro sem rede.** O comando mostra o banco de destino (servidor e nome, sem credencial) e quantas requisições faria, e **não busca nada**:

```bash
pnpm --filter @alvesting/api market:backfill                      # a carga inicial: 3 meses, todo papel da lista da brapi e o BOVA11
pnpm --filter @alvesting/api market:backfill --papeis PETR4,VALE3 --de 2026-10-26 --ate 2026-10-30   # um papel e uma janela
```

   O comando usa o `DATABASE_URL` do ambiente, e o `.env.local` da raiz aponta para o banco de dev: para um banco descartável (a prova controlada, por exemplo), passe a variável na linha de comando, com o schema já aplicado (`DATABASE_URL=postgresql://.../<banco>_test pnpm --filter @alvesting/api migrate:deploy`, e depois o mesmo `DATABASE_URL` no `market:backfill`). O `--confirmo-banco` existe para esse erro: o nome que ele mostra é o que você confirma.

2. **Confira o banco mostrado.** Só então busque de verdade, repetindo o comando com o **nome do banco** que ele mostrou:

```bash
pnpm --filter @alvesting/api market:backfill --confirmo-banco <nome do banco>
```

   É só inserção e retomável: uma segunda passada pede só a falta. No fim mostra as requisições feitas, os papéis sem resposta e a cota restante informada pela brapi (só o número). A carga inicial é de 377 pedidos num banco novo (2,5% da cota; a do dev, em 04/11/2026, fez 373 e gastou 369; o modo sem rede mostra o número exato). Não publica `settle`.

   **Só a carga completa confirma os pregões** (`docs/DADOS.md`, seção 6): sem `--papeis`, sem parada por cota, tempo ou queda, com o BOVA11 respondido e no máximo 10% dos papéis sem resposta. A carga parcial grava as barras e avisa `Carga parcial: nenhum pregão foi confirmado`; **repita o comando** (pede só a falta) até o aviso sumir, e só então espere o `universe`. **Não rode a carga entre 21:30 e 00:30**: o `eod` da noite grava as barras do pregão no mesmo momento, e, se as duas gravações trouxerem valores diferentes para a mesma barra, a que perde a corrida pode passar sem o sinal `barras-divergentes`.
3. **`400 DATE_WINDOW_EXCEEDED`** (a brapi recusa o pedido que passa de 90 dias entre `startDate` e `endDate`; não gasta cota): a janela padrão (3 meses de calendário mais 3 dias, 86 a 89 dias) cabe. Com `--de` e `--ate` seus, deixe no máximo 90 dias entre eles e repita por partes; a idade do início não importa. A carga mostra só "N papéis sem resposta", sem o código: o corpo de erro nunca é lido.
4. **Na Azure** o Postgres é privado, e não há job para a carga: ela roda de onde o banco é alcançável (`docs/JOBS.md`, seção 6) ou por uma execução do `job-migrate` com outro comando, como o primeiro admin (`docs/INFRA.md`, 8.6). Pendente: o job dedicado.
5. **Depois:** reenvie a `universe` da semana (ou espere o domingo). Ela exige os 60 pregões confirmados e, se faltar algum, diz quais.

**Risco:** apontar para o banco errado grava barra onde não devia (por isso o nome do banco tem de ser repetido). Nunca apaga nada.

### 12.6 O calendário de feriados (`b3-holidays.json`), uma vez por ano

O arquivo `apps/api/src/modules/market-data/domain/b3-holidays.json` é **escrito à mão**; nada o baixa. Origem: a página de feriados da B3 (o JSON guarda a `url` e a data da conferência). 2026 é oficial; **2027 é provisório** (os feriados nacionais que caem em dia útil mais a véspera de Natal e o último dia do ano).

1. Quando a B3 publicar a lista do ano seguinte, confira a página e troque o JSON por PR (o schema do `trading-calendar.ts` valida a forma). Rode `pnpm --filter @alvesting/api test` (o `trading-calendar.spec.ts` trava os dias de cada ano).
2. Apague as linhas previstas do calendário (`DELETE FROM trading_day WHERE source = 'CALENDAR';`): o próximo `eod` ou `universe` as semeia de novo, certas.
3. Um dia útil que a B3 abre e a lista marca como feriado passa em silêncio: o `eod` não roda e o erro só aparece 60 pregões depois, no `universe`.

**Risco:** lista errada para o ano seguinte esconde um pregão (ou inventa um) até o `universe` acusar.

### 12.7 Os logos das ações (`market:logos`)

**Não ensaiado** pelo Artur: só a prova de 05/11/2026 (banco descartável) e a carga do dev, no mesmo dia (`docs/DADOS.md`, seção 3a). O
logo de cada ação é uma cópia do SVG da brapi (`icons.brapi.dev`) no nosso banco (`instrument_logo`, ADR 0036). A atualização semanal o
mantém sozinha (domingo, no `universe`); este comando é para a carga de um banco novo, para repetir o que falhou e, **sempre, depois de
mudar o validador** (`apps/api/src/modules/market-data/domain/svg-check.ts`).

1. **Primeiro sem rede.** Mostra o banco de destino (servidor e nome, sem credencial), quantas ações ele tem, quantas já têm logo (e
   quantas com mais de 30 dias) e os pedidos que faria, e **não busca nada**:

```bash
pnpm --filter @alvesting/api market:logos
```

2. **Confira o banco mostrado** e repita com o nome dele:

```bash
pnpm --filter @alvesting/api market:logos --confirmo-banco <nome do banco>
```

   Faz 1 pedido à lista da brapi (não gasta cota) e baixa do icons.brapi.dev só o que falta, mudou de endereço ou tem mais de 30 dias
   (a carga do dev: 357 SVG em 44 s). **Antes de baixar, reconfere todo SVG guardado com o validador de hoje e apaga o que ele recusa**:
   é por isso que o comando vem depois de toda mudança no validador (sem ele, a regra nova só vale no domingo seguinte). No fim mostra os
   pedidos (a lista e os SVG; nenhum ao histórico), os gravados, os apagados, os recusados por motivo, os sem resposta, os bytes e o tempo.
3. **Recusado** (`logo recusado; o papel fica sem logo` no log, com o ticker e o motivo, nunca o conteúdo): o papel fica com o monograma.
   Se o motivo parecer um falso positivo (um logo de verdade que o validador não lê), a correção é no validador, com o caso no
   `svg-check.spec.ts`, e depois este comando. **Nunca** se grava SVG à mão na tabela: as rotas internas leem o banco como está.
4. **Sem resposta** (`logo sem resposta do icons.brapi.dev`) ou a passada parada por 5 falhas seguidas: o host fora do ar. Rode de novo
   mais tarde (pede só a falta).
5. **Na Azure** o comando roda de onde o banco é alcançável, como o `market:backfill` (seção 12.5).

**Risco:** apontar para o banco errado grava logo onde não devia (por isso o nome do banco tem de ser repetido). Só apaga o logo que o
validador de hoje recusa.

## Lacunas conhecidas

O que este runbook **não** cobre, e por quê. Cada uma é pendência de código ou decisão do Artur:

- **Apagar evento corporativo** (ticker, data ex ou tipo errados): só SQL, fora da trilha (seção 9).
- **Reliquidar uma temporada sem evento**: não há gatilho. Só o registro de evento enfileira a reliquidação. É o que impede o admin de refazer, por conta própria, um pregão já liquidado cuja barra chegou atrasada (seção 12.3): a barra entra no resultado quando a próxima liquidação regular recalcula a temporada do zero.
- **Carga inicial na Azure**: não há job para o `market:backfill` (o Postgres é privado); roda de onde o banco é alcançável (seção 12.5).
- **Restaurar o dump no servidor da Azure**: o servidor é privado, e não há job para o `pg_restore` (seção 5.3).
- **`account:promote` e `account:demote` por e-mail, não por ULID**: a CLI recebe o e-mail (seção 7).
- **Sinal que falta** (`docs/INFRA.md`, 5.3): um `job-sched-*` que termina com código diferente de 0 depois das retentativas, e a queda do `ca-web` no perfil econômico. A conferência diária (seção 1) é quem os vê.
- **Blob apagado**: a recuperação da exclusão lógica não foi ensaiada (seção 5.2).
- **Girar segredo de job**: que a próxima execução leia a versão nova não foi verificado (seção 4.1).
- **Documentos e serviços de terceiros**: cotas do Communication Services, o comportamento de assinatura de estudante e a chave do Communication Services. Estão marcados como "não verificado" em cada seção, a conferir no portal.
