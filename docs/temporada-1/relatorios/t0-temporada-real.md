# T0: a Temporada 1 de verdade (modo retroativo, operador local e banco da temporada)

Relatório da tarefa T0 da onda "Temporada 1 real e Playbook" (06/11/2026). A especificação está em
`.data/orquestracao/temporada/t0-temporada-real.md`; a decisão, no ADR 0038. **Nada real rodou**: nenhuma chamada ao OpenRouter, à brapi, à
CVM, ao BCB nem a portal; tudo foi provado com os substitutos do ensaio (a brapi falsa, o provedor fake, o SGS e a CVM sintéticos), em bancos
meus (`alvesting_t0_test`, `alvesting_t0_ensaio`, `alvesting_t0_preparar_test`). O `alvesting_temporada` não foi criado nem tocado.

## 1. O que foi feito

1. **O modo do ciclo** (`cycle.mode`, `RETROATIVO` ou `AO_VIVO`, padrão `AO_VIVO`; `cycle.executed_at`, a hora real) e o **prompt fixado
   pela temporada** (`season.prompt_sha256`), na migration aditiva `20261106120000_retroactive_cycles` (o SQL das colunas saiu do
   `prisma migrate diff`). A matriz `table-policy.ts` e os privilégios do `alvesting_api`: o UPDATE no ciclo passou a ser só das quatro
   colunas do reprocesso (o modo e a hora real ficam de fora); o INSERT continua da tabela inteira, porque **o Prisma 7 nomeia no INSERT toda
   coluna com padrão** (conferido no log do Postgres, `log_statement = all`: `created_at`, `mode` e `executed_at` vão com o valor do cliente), e o
   gatilho `cycle_api_guard` passou a exigir `mode = AO_VIVO` e a pôr `executed_at := now()` no INSERT da api. O gatilho da temporada recusa o
   INSERT da api com o prompt fixado.
2. **Os contratos públicos**: `mode` e `executedAt` no ciclo (`cycleViewSchema`), na decisão do feed (`feedDecisionSchema`, que também é a da
   página do modelo), nas decisões da página da ação (`stockDetailSchema.decisions`) e no último ciclo da home (`lastCycleSchema`); o ranking
   ganhou `cyclesByMode` (seção 4). A api monta e devolve os campos; o `cycle:show` diz o modo.
3. **O motor do ensaio montado com as peças escolhidas**: `assembleWorld(pieces)` em `apps/api/src/ensaio/world.ts`. O ensaio passa as
   sintéticas (o `createWorld` de sempre) e o relatório padrão continua com o SHA-256 `081d860b…1f12`. Ganhou `--retroativos K`.
4. **O arquivo da Temporada 1**: `apps/api/seasons/temporada-1.json` (o rascunho foi apagado com `rm`), "Temporada 1", `startDate` 2026-10-13,
   53 pregões (de 13/10 ao último pregão de 2026, 30/12, conferido no calendário por teste), o mesmo elenco e os mesmos parâmetros, com os preços
   da resposta de 06/11/2026 08:53 da lista do OpenRouter (o DeepSeek V4 Pro (0813) com o valor exato, 0,1165 e 4,66, como o coordenador
   pediu). O `season:create` recusa o arquivo dizendo que quem o cria é o `arena:retroativo`.
5. **`temporada:preparar`** (`apps/api/src/temporada/prepare.ts`): cria o banco se faltar, aplica as migrations, roda o `db:roles` e copia do
   banco de dev os instrumentos, os logos, os pregões e as barras, sem chamar a brapi; idempotente; recusa qualquer nome que não seja
   `alvesting_temporada` ou `*_test`, e servidor fora da máquina.
6. **`arena:retroativo`** (`apps/api/src/temporada/retro.ts`): cria e inicia a temporada na data do arquivo, com o prompt fixado; lê de uma
   vez as barras que faltam (em blocos de até 85 dias, desde a janela do universo da primeira semana), o BCB e a CVM (`CvmFetcher.backfill`,
   com a hora em que o ao vivo veria cada documento); roda os pregões em ordem, com o relógio do pregão; pula o pregão fechado e liquidado;
   nunca decide de novo um par que já tem decisão; para no Ctrl+C entre duas entregas; tem o `--teto-usd`, o `--dry-run` (só leitura) e o
   relatório por pregão e o resumo em `.data/temporada/`; e para no primeiro pregão que não fechou (o ciclo pulado, a liquidação que falhou),
   em vez de seguir sobre o buraco. A guarda de rede em lista branca (`installNetworkGuard({ allow })`).
7. **A regra de visibilidade** (`apps/api/src/temporada/visibility.ts`): barras até D-1 (o próprio freeze), a CVM pela hora da busca das 07:30
   do dia seguinte à entrega, o BCB pela data em que cada valor fica público (a regra mais conservadora, documentada série por série) e o RSS
   pela hora real em que foi visto.
8. **`arena:operar`** (`apps/api/src/temporada/operator.ts` e `agenda.ts`): o operador local com o relógio da máquina e a agenda de produção
   (a fonte única, comparada com os crons do Bicep por teste), as quatro regras do ciclo ao vivo, o `--so-dados`, o log do dia em
   `.data/operador/AAAA-MM-DD.log` com o batimento a cada 30 min, e o modelo do `launchd` (`infra/local/br.alvesting.operador.plist`, com
   `caffeinate -i` e `KeepAlive`) e do arquivo de ambiente (`infra/local/operador.env.example`).
9. **As horas reais de cada chamada** no meta do IO bruto (`http: [{ requestedAt, respondedAt }]`, pelo relógio da máquina, no
   `DecideHandler`).
10. **Docs**: METODOLOGIA ("Temporada 1: o trecho retroativo e o ao vivo" e a limitação nova), ARENA (seções 1 e 8: o elenco final, as datas, o
    custo da temporada inteira e por mês), DADOS (seção 22: a visibilidade de cada fonte no retroativo), JOBS (os comandos e a seção 9, o
    operador), RUNBOOK (seção 13: preparar, retroativo, operador, o Mac que dorme, o dia perdido, a ida para a Azure; "não ensaiado"), ENSAIO
    (`--retroativos`, `assembleWorld`) e o ADR 0038.

## 2. Critérios de aceite, com a evidência

Ambiente de todos os testes: o das regras comuns (`PATH` com o `az` falso, `NODE_OPTIONS` com a guarda de rede dos testes,
`NET_GUARD_LOG=.data/guardas/t0-temporada-rede.log`), `TEST_DATABASE_URL=…/alvesting_t0_test` e o Azurite do compose.

| # | Critério | Evidência |
|---|---|---|
| 1 | Com o LLM fake e a brapi falsa, 5 pregões viram 5 ciclos `RETROATIVO` com `executed_at` real e as decisões dos seis modelos e do Sorteio; interrompido no 3º e rodado de novo, nenhuma decisão nem chamada repetida | `pnpm exec vitest run src/temporada/retro.integration.spec.ts`: "5 pregões viram 5 ciclos RETROATIVO com a hora real; interrompido no 3º…" passa. O provedor fake conta as chamadas: o Ctrl+C simulado depois da 14ª (12 do 1º e do 2º pregão, mais 2 do 3º); a segunda execução faz 16 (os 4 que faltavam no 3º e os 12 do 4º e do 5º); 14 + 16 = 30 chamadas e 30 decisões, uma por par (ciclo, competidor); `executed_at` entre o começo do teste e agora, a hora da decisão a do pregão simulado; o Sorteio com 5 patrimônios e ordens; a temporada `FINISHED`, com o prompt fixado e início em 03/11. Uma terceira execução, com tudo fechado, faz 0 chamadas |
| 2 | Visibilidade por fonte (barras, CVM, BCB, RSS) e a borda da sexta e do fim de semana da CVM | `pnpm exec vitest run src/temporada/visibility.integration.spec.ts` (4 testes, o freeze de verdade com as leituras do retroativo sobre um banco que já tem o futuro): barras até D-1 com as de D e D+1 no banco; o CDI e o PTAX de 21/10 fora do briefing de 22/10 (vale o de 20/10), o IPCA de setembro fora de outubro, e a prova do contrário (o freeze ao vivo, no mesmo banco, os mostraria); a notícia vista 1 s depois do corte vai para o pregão seguinte; o documento da terça entra na quinta, os da sexta e do sábado na segunda, o do domingo na terça, cada um num briefing só. E `src/modules/news/application/cvm-fetcher.spec.ts` ("CvmFetcher.backfill", 3 testes): a janela, o horizonte inclusivo, um lote por dia com a hora da regra, sem condição e sem tocar nos validadores |
| 3 | `--dry-run` faz zero chamada e zero escrita; `--teto-usd` para antes de estourar | `retro.integration.spec.ts`: "--dry-run" conta as linhas de TODA tabela antes e depois (iguais), 0 chamadas ao LLM e 0 à brapi falsa, e confere o plano (18 chamadas, até 36; e, sem banco, a Temporada 1 inteira até 05/11: 17 pregões, 102 chamadas, o custo à mão). "--teto-usd": com US$ 2 para antes do 1º pregão (o pior caso de um pregão é US$ 2,66), 0 chamadas e 0 ciclos; com US$ 3,30 roda 2 pregões (12 chamadas a US$ 0,10, gasto 1.200.000 micro-dólares) e para no 3º. E de ponta a ponta pelo comando: `node dist/temporada-cli.js retroativo --dry-run --ate 2026-11-05` com o `TEMPORADA_DATABASE_URL` de um banco que não existe: o plano de 17 pregões, 102 chamadas (até 204), típico US$ 9,90 e pior caso US$ 45,24, exit 0 |
| 4 | Prompt diferente do fixado recusa abrir o ciclo; o canário fica fora de rota pública, log e blob que não seja o pedido ao LLM | `retro.integration.spec.ts`: "o prompt diferente…" (`RetroRefusedError`, 0 chamadas, nenhum ciclo novo) e "o canário do prompt só vai no pedido ao LLM…" (o canário está em toda mensagem de sistema que o provedor fake recebeu e em nenhum blob dos containers do teste, em nenhuma linha de log e em nenhum resumo do banco). `operator.integration.spec.ts`: "com outro prompt, não abre ciclo ao vivo". As rotas públicas: `public-api.integration.spec.ts` (65 testes, agora com o 1º pregão retroativo) varre todas as rotas atrás do canário e das frases do prompt do ensaio |
| 5 | Operador: a agenda bate com os crons do Bicep; às 09:40 não abre ciclo ao vivo; nem para pregão que já tem um, nem com pregão anterior aberto; `--so-dados` não abre ciclo | `pnpm exec vitest run src/temporada/agenda.spec.ts` (6 testes: lê o vetor `schedulers` do `infra/modules/containerapps.bicep` e compara cron por cron; só o `backup` fica de fora). `src/temporada/operator.integration.spec.ts` (6 testes): o controle (às 08:00:30 com o retroativo em dia, congela o briefing e abre o ciclo `AO_VIVO`, 6 decisões); às 09:40 e às 09:26 nenhum ciclo nem briefing atrasado; pregão com ciclo `RETROATIVO` não ganha outro; com o pregão anterior sem ciclo não abre; outro prompt não abre; `--so-dados` sem briefing e sem ciclo, e o eod do dia concluído (`SUCCEEDED`) sem nenhuma liquidação pedida |
| 6 | A guarda em lista branca bloqueia `example.com` e deixa passar os quatro hosts, sem rede | `src/ensaio/network-guard.spec.ts` (7 testes): `isAllowedHost` aceita `openrouter.ai`, `brapi.dev`, `dados.cvm.gov.br`, `api.bcb.gov.br` e o loopback e recusa `example.com`, `icons.brapi.dev`, `evil-brapi.dev`, `brapi.dev.example.com`, um IP de fora e o vazio; o fetch de um host da lista segue para o fetch de baixo (um falso), o de fora é bloqueado, anotado e avisado; a conexão TCP para fora falha antes de resolver o nome |
| 7 | `pnpm check` verde; migration com `migrate diff` vazio depois; ensaio padrão com o SHA-256 `081d860b…1f12`; `api-role` e `table-policy` batendo com o catálogo; o log da guarda vazio e o `az` falso sem chamada | Seção 3 |

## 3. As conferências finais

PREENCHER_CONFERENCIAS

## 4. O contrato exato, para a T1 (o site)

Tudo em `packages/contracts/src/cycle.ts` e `public.ts`; os campos são **obrigatórios** (a resposta sem eles é recusada pelo schema estrito):

```ts
// cycle.ts
export const CYCLE_MODES = ['RETROATIVO', 'AO_VIVO'] as const;
export const cycleModeSchema = z.enum(CYCLE_MODES);
export type CycleMode = z.infer<typeof cycleModeSchema>;

cycleViewSchema      // GET /api/v1/cycles/:id e /cycles/:date
  + mode: cycleModeSchema
  + executedAt: z.iso.datetime()        // a hora REAL em que o ciclo rodou (UTC)

// public.ts
feedDecisionSchema   // GET /api/v1/decisions (rows) e GET /api/v1/competitors/:slug (decisions)
  + mode: cycleModeSchema               // o modo do ciclo da decisão
  + executedAt: isoDateTime
stockDetailSchema.decisions[]           // GET /api/v1/stocks/:ticker
  + mode: cycleModeSchema
  + executedAt: isoDateTime
lastCycleSchema      // GET /api/v1/arena/current (lastCycle)
  + mode: cycleModeSchema
  + executedAt: isoDateTime
leaderboardSchema    // GET /api/v1/seasons/:id/leaderboard
  + cyclesByMode: { RETROATIVO: number; AO_VIVO: number }   // os ciclos da temporada até `asOf`, por modo; os dois zero sem liquidação
```

Num ciclo `RETROATIVO`, `decisionAt`, `deadlineAt` e `closedAt` são os do pregão simulado (08:00, 09:30 e o fechamento no relógio do pregão);
`executedAt` é a hora real, dias depois. O rótulo que o site mostra e o texto da explicação são da T1. Para testar os rótulos, o seed do e2e pode
passar `--retroativos K` ao `arena:ensaio` (o `e2e:seed` não foi mudado: ele é do site). As fixtures do site que constroem esses tipos ganharam só
os campos novos (`apps/web/e2e/fixture-api.ts` e `apps/web/src/app/(site)/page.spec.tsx`, com `mode: 'AO_VIVO'`, `executedAt` igual ao
`decisionAt` e `cyclesByMode` zero), com o aval do coordenador.

**Para a revisão do deploy (ADR 0029):** o site valida a resposta com o schema estrito, então o web ANTIGO recusaria a api NOVA (campo a mais) nos
minutos entre a api virar e o web virar. Hoje não há produção; quando houver, este tipo de campo novo pede o web que aceita o formato novo antes.

## 5. As linhas que o README precisa (para a T2)

- **A Temporada 1** vai de 13/10/2026 a 30/12/2026 (53 pregões), com os seis modelos do OpenRouter, o Sorteio e as três referências; os pregões
  que já tinham passado em 06/11/2026 entram como **retroativos** e os seguintes como **ao vivo** (`docs/METODOLOGIA.md`, "Temporada 1"; ADR 0038).
- **Comandos:** `pnpm --filter @alvesting/api temporada:preparar` (o banco da temporada), `arena:retroativo [--dry-run] [--ate D]
  [--teto-usd 30]` (os pregões passados) e `arena:operar [--so-dados]` (o operador local, até a Azure); procedimento no `docs/RUNBOOK.md`, seção 13.
- **O ensaio:** `arena:ensaio [--retroativos K]`.

## 6. O passo a passo da primeira execução real (para o coordenador)

Pré-requisitos: o Postgres e o Azurite do compose no ar; a chave do OpenRouter e o prompt aprovados pelo Artur; o checklist da primeira chamada
real (`docs/ARENA.md`, seção 7: desligar o registro de entrada e saída e o uso para treino na conta do OpenRouter). Rodar a partir da raiz do
repositório, com `source ~/.nvm/nvm.sh && nvm use`.

1. **O arquivo de ambiente**, fora do git: `cp infra/local/operador.env.example ~/segredos/alvesting-operador.env && chmod 600
   ~/segredos/alvesting-operador.env`; preencher `BRAPI_TOKEN`, `OPENROUTER_API_KEY` e `PROMPT_ARENA_FILE` (o caminho do prompt aprovado em
   `.data/prompts/`, com a linha de canário; o texto nunca vai ao arquivo de ambiente) e conferir `ARENA_MONTHLY_COST_CAP_USD` (40). A
   `API_DATABASE_URL` tem a senha de dev (`alvesting_api`): o login é do servidor inteiro, e outra senha derruba a demo e o e2e.
2. **Compilar:** `pnpm --filter @alvesting/api build`.
3. **Preparar o banco:**

   ```bash
   cd apps/api
   node --env-file=$HOME/segredos/alvesting-operador.env dist/temporada-cli.js preparar
   ```

   Esperado: "banco alvesting_temporada criado", "migrations aplicadas", "login alvesting_api pronto", e a cópia do dev (376 instrumentos, 357
   logos, 60 pregões e ~20 mil barras, de 07/08 a 03/11/2026). Rodar de novo copia zero.
4. **O plano** (sem chamada e sem escrita):

   ```bash
   node --env-file=$HOME/segredos/alvesting-operador.env dist/temporada-cli.js retroativo --dry-run --ate 2026-11-05
   ```

   Esperado: 17 pregões a rodar (13/10 a 05/11), 102 chamadas (até 204), típico ~US$ 9,90, pior caso ~US$ 45,24. Conferir o SHA-256 do prompt
   que a execução vai fixar (passo 5 o imprime) com o que o Artur aprovou.
5. **Uma prova pequena antes do lote:** `retroativo --ate 2026-10-13 --teto-usd 5` (só o 1º pregão; o primeiro contato real com o OpenRouter, a
   brapi, a CVM e o BCB). Ela faz, uma vez: a carga das barras que faltam desde a janela do universo de 2026-W42 (o bloco de 17/07 a 10/10, uns 377
   pedidos à brapi, um por papel, porque o dev começa em 07/08; o bloco seguinte, até o `--ate`, só o que faltar), o macro do BCB (400 dias, a
   primeira vez) e os dois ZIP da CVM de 2026. Conferir em `.data/temporada/pregao-2026-10-13.txt` as 6 decisões, o custo e o `RETROATIVO`; e o
   `cycle:show 2026-10-13` (com `DATABASE_URL` do banco da temporada) contra o painel do OpenRouter. Se o BCB ou a CVM falharem na leitura, o
   comando sai com erro antes de abrir qualquer ciclo; se faltar barra (o universo da semana sem os 60 pregões confirmados), o ciclo fica pulado
   e a execução para nesse pregão (código 3). Corrigir e rodar de novo continua de onde parou.
6. **O lote:** `retroativo --ate 2026-11-05` (padrão `--teto-usd 30`). Ctrl+C para entre duas decisões; rodar de novo continua. Saída: os
   relatórios por pregão e o `resumo.txt` em `.data/temporada/`.
7. **O operador, antes da virada, só coletando:** instalar o plist com `--so-dados` (RUNBOOK, 13.3). Ele coleta o RSS, roda o eod de cada noite
   (confirma as barras do dia, sem liquidar) e o universo de domingo com os logos.
8. **A virada:** na noite do último pregão a cobrir (depois do eod do operador, que confirma as barras), `retroativo` sem `--ate` (o padrão é o
   último pregão confirmado antes de hoje); depois, antes das 08:00 do pregão seguinte, trocar o plist para o modo ao vivo (sem `--so-dados`) e
   `launchctl kickstart -k gui/$(id -u)/br.alvesting.operador`. No log do dia, às 08:00: "ciclo ao vivo aberto".

**O teto do mês quando outubro roda em novembro.** O `ARENA_MONTHLY_COST_CAP_USD` é conferido pelo agendador antes de abrir cada ciclo, com o gasto
**dos ciclos do mês do pregão** (`ArenaRepository.monthlySpendMicroUsd`, que soma `decision.cost_micro_usd` dos ciclos de `cycle.date` no mês). Os
14 pregões de outubro rodados em novembro somam em outubro (típico US$ 8,15; pior caso US$ 37,26, abaixo dos 40), e não comem o teto de novembro;
os pregões de novembro, retroativos (03 a 05/11) e ao vivo, somam juntos em novembro (19 pregões: típico US$ 11,06; pior caso US$ 50,56). Só um mês
inteiro perto do pior caso passaria dos 40, e então os ciclos seguintes ao teto naquele mês seriam pulados (`orcamento`) até o mês virar. O
`--teto-usd` é outro limite, por execução, e vale antes do do mês. Sem a variável, todo ciclo com modelo pago é pulado (fail closed), como em
produção.

## 7. Desvios e decisões tomadas aqui

- **A lista branca do operador é maior que a do retroativo.** A especificação pede "a mesma guarda" no operador, mas o `--so-dados` existe para
  coletar o RSS, e os quatro feeds e o `icons.brapi.dev` (os logos da semana) ficariam bloqueados. O mecanismo é o mesmo; a lista do operador é a
  do retroativo mais esses cinco hosts, todos derivados da lista fixa do código (`OPERATOR_HOSTS`). O teste do critério 6 é o da lista do
  retroativo.
- **O INSERT da api no ciclo continua da tabela inteira** (achado do Prisma 7, seção 1). A api não escolhe o modo nem a hora real porque o
  gatilho decide (AO_VIVO, e a hora do banco); o UPDATE ficou por coluna. O `api-role.integration.spec.ts` prova as duas coisas.
- **"Fechado", para a regra 3 do operador, é o ciclo que não está `OPEN`** (fechado ou pulado). Um pregão sem ciclo, ou com ciclo aberto,
  bloqueia o ao vivo.
- **O retroativo só lê o RSS que o operador já gravou**: não há fila de notícias no retroativo. A CVM e o BCB são lidos de uma vez, antes dos
  pregões, com o relógio da máquina, e a regra de visibilidade decide o que cada briefing vê.
- **No `--so-dados` o eod não pede a liquidação**: liquidar um pregão sem ciclo o mostraria no ranking como HOLD de todos até o retroativo o
  cobrir. Quando um pregão liquidado antes das decisões é coberto pelo retroativo, a liquidação dele é reaberta (`JobRunStore.reopen`) e refeita.
- **O eod do retroativo roda às 21:30 do pregão, como no ensaio**, com as novas tentativas até 00:30 no relógio simulado: um papel sem negócio no
  dia é pedido 4 vezes à brapi por pregão (uns 20 a 60 pedidos por pregão, dentro da cota de 15 mil por 30 dias).
- **O briefing ao vivo depois do prazo não é congelado pelo operador**: quem congela o pregão perdido é o retroativo, pela regra de visibilidade
  (o macro não tem hora de chegada, e um congelamento tardio levaria o que chegou depois do corte).
- **O prompt no `--so-dados` é opcional** (nenhum modelo é chamado nesse modo).
- **Os containers do Azurite da temporada são `temporada-briefings` e `temporada-llm-io`**, fora dos de dev e dos do ensaio; os testes usam
  `rt-<banco de teste>-`, para duas execuções em bancos diferentes não apagarem os arquivos uma da outra (aconteceu: uma execução concorrente
  derrubou 10 testes meus com o prefixo fixo; com o prefixo por banco, os 29 passam).
- **O preço do DeepSeek**: 0,1165 (o valor exato da resposta de 06/11), e não o 0,117 arredondado da especificação, por pedido do coordenador.

## 8. Incidentes

1. **A demo fora do ar por uns 5 minutos.** Ao gravar o `public.repository.ts` com o modo e a hora real, o `nest start --watch` da demo reiniciou a
   api com o `dist` ANTIGO dos contratos (estritos), e `/api/v1/arena/current` e `/decisions` deram 500. Restaurado com
   `pnpm --filter @alvesting/contracts build` e uma gravação de verdade em `apps/api/src` (o `touch` não basta: o watch do swc só reinicia com
   conteúdo novo); o `/ranking` do `next dev` precisou de um segundo pedido. O coordenador conferiu e liberou. **A regra que ficou:** compilar os
   contratos ANTES de gravar código da api ou do site que dependa deles (é um acoplamento entre o watch e os contratos compilados, bom exemplo
   para o guia do código).
2. **A migration na demo.** Com o aval do coordenador: `migrate status` no `alvesting_ensaio` (pendente só a `20261106120000_retroactive_cycles`),
   `migrate deploy`, e depois de achar o comportamento do Prisma 7, o delta equivalente (o `GRANT INSERT ON cycle` e o `CREATE OR REPLACE FUNCTION
   api_cycle_guard()` do arquivo final). Conferido pelo catálogo (`has_table_privilege('alvesting_api', 'cycle', 'INSERT')` verdadeiro, a função
   nova no `pg_proc`), `/health` e `/api/v1/arena/current` 200 e a conta `demo@example.test` presente. A `_prisma_migrations` da demo ficou com o
   checksum da primeira versão (o coordenador recria a demo no fechamento).
3. **Um erro meu no git:** rodei `git rm --cached` no rascunho da Temporada 1, o que mexeu no índice (proibido). Avisei na hora; o coordenador
   desfez. Depois disso, git só de leitura, e o rascunho foi apagado com `rm`.
4. **`@default(dbgenerated("now()"))` deixava o `migrate diff` com uma linha** (`SET DEFAULT now()`); com `@default(now())` ele fica vazio.

## 9. O que ficou para depois

- **O site** (T1): os rótulos do retroativo, com o contrato da seção 4; o `e2e:seed` com `--retroativos`, se a T1 quiser.
- **O `docs/API.md`** (não é meu): as linhas dos campos novos nas rotas (seção 4 daqui).
- **A primeira execução real** (o coordenador, seção 6), e o ensaio dos procedimentos do RUNBOOK, seção 13 (todos "não ensaiado").
- **A Azure**: o `sched-cycle` de produção não confere o `season.prompt_sha256` (ADR 0038, consequências); levar a temporada para lá é o RUNBOOK,
  13.6, não verificado.
- **Os limites declarados**: o retroativo sem notícias de portal e com o macro mais velho (METODOLOGIA); o Mac como ponto único de falha até a
  Azure; a cópia agendada do eod na memória do processo (reposta pela volta seguinte do operador).

## 10. Arquivos tocados

PREENCHER_ARQUIVOS
