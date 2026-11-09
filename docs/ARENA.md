# Arena: o motor de decisão (etapa 6)

Como a temporada, o ciclo e a decisão de cada modelo funcionam. Plano: §2, §5.5, §6, §7, §8 e §10. Regras: `docs/METODOLOGIA.md`.
A fila e os jobs estão em `docs/JOBS.md`; as variáveis de ambiente, em `docs/INFRA.md` (2.7). **O texto do prompt não está aqui,
nem no repositório, nem na imagem, nem em log, nem em resposta da API** (regra 4 do `CLAUDE.md`, ADR 0011).

```
 season:create  ──▶ season (DRAFT) + competitor ×N          season:start ──▶ RUNNING, início = próximo pregão
 07:30  freeze  ──▶ briefing (Blob `briefings` + linha)
 08:00  job-sched-cycle ──▶ cycle (OPEN, briefing + prompt_version fixados) ──▶ uma `decide` por competidor MODEL
        job-worker-decisions (1 mensagem = 1 execução) ──▶ prazo? ▶ prompt? ▶ briefing? ▶ modelo (+1 reparo)
                              ▶ domínio ▶ filtro de vazamento ▶ Blob `llm-io` ▶ decision + decision_item
        o último MODEL decide  ──▶ cycle CLOSED
 09:30  prazo: sem resposta = HOLD
```

## 1. Temporada e elenco

Os parâmetros da temporada têm um schema só (`packages/contracts/src/season.ts`, `seasonParamsSchema`), lido por quem cria, pela
liquidação (etapa 7) e pelo web: capital em centavos (R$ 100.000,00), número de pregões (20), até 10 posições, 5 ordens, BUY de 5
a 25% do patrimônio, SELL de 1 a 100% da posição, custo de 0,03% (3 pontos-base), decisão às 08:00 e prazo às 09:30, as
sementes do Sorteio e do Monte Carlo (públicas, de reprodutibilidade) e as 1.000 carteiras do Monte Carlo. O limite de ordens e as faixas
de BUY e SELL **são as constantes do contrato da decisão** (`llm-decision.ts`): o schema da temporada recusa outro valor, porque o
validador da resposta do modelo usa as mesmas constantes. O status é `DRAFT`, `RUNNING` ou `FINISHED`; a data de início só existe
depois do `season:start`.

O elenco (`competitor`) tem três tipos: `MODEL` (provedor `openrouter`, `azure-openai` ou `fake`, com o **ID do modelo fixado**),
`RANDOM` (o Sorteio, obrigatório e único) e `BENCHMARK` (igual-peso, CDI e BOVA11, cada um uma vez). **Só o `MODEL` recebe
`decide`.** O ID do OpenRouter é o da lista pública (laboratório/modelo); o roteador `openrouter/auto`, que escolhe o modelo por
conta própria, e qualquer sufixo de variante (`:online`, `:nitro`, `:floor`, `:free`, `:batch`) são recusados. O Azure OpenAI exige a
tabela de preços (seção 7).

**O elenco aparece simulado até a integração.** A temporada sintética (`apps/api/seasons/ensaio.json`: a do `arena:ensaio`, da demo local
e da semente do e2e) já tem o elenco da Temporada 1 (seção 8), com os mesmos nomes e slugs, mas com o provedor `fake`: as chaves ainda não
existem, e quem decide por cada modelo é uma estratégia simples e determinística do provedor fake, que nunca falha (`docs/ENSAIO.md`,
seção 3). O site marca todo competidor `MODEL` de provedor `fake` com a etiqueta **"simulado"** junto do nome, onde o nome aparece (ranking,
cartões de decisão, página do modelo, do ciclo e da ação); a página do modelo mostra a estratégia (o `modelId` `fake/...`, como
"Estratégia simulada") e a home avisa que as decisões são simuladas enquanto a temporada exibida tiver um modelo assim. A tela não guarda
lista de nomes: a regra é o provedor que a API pública já devolve (`publicCompetitorSchema`), e no ciclo, o provedor que respondeu a decisão
(`applied.provider`). No dia da integração a temporada de verdade nasce com o provedor `openrouter` e o ID do rascunho, e a etiqueta e o
aviso somem sozinhos.

Comandos (rodam com o banco do ambiente, sem fila e sem LLM; em dev, `pnpm --filter @alvesting/api <comando>`):

| Comando | O que faz |
|---|---|
| `season:create <arquivo.json>` | Valida o arquivo inteiro (`seasonFileSchema`, estrito: chave a mais, segredo inclusive, é recusada, e a mensagem de erro nunca repete o valor) e cria a temporada em `DRAFT` com o elenco. Exemplos versionados em `apps/api/seasons/`: `temporada-0.json` (o ensaio, 5 pregões, 6 provedores fake). O `temporada-1.json` (a Temporada 1, seção 8) traz a data fixa do primeiro pregão (`startDate`) e não é deste comando: ele o recusa dizendo que quem o cria e o inicia é o `arena:retroativo` |
| `season:start <id>` | `DRAFT` para `RUNNING`, com a data de início no **próximo pregão depois de hoje** (de Brasília): hoje nunca é o início, porque o briefing das 07:30 e o ciclo das 08:00 podem já ter passado. No domingo 01/11/2026 o início é a terça 03/11 (02/11 é Finados) |
| `cycle:show <AAAA-MM-DD\|id> [slug]` | Mostra o ciclo de um pregão: status, motivo de pulo, hashes do prompt e do briefing, e uma linha por competidor (resultado, visão, ordens por ação, descartados, custo, chamadas). Só o formato público; nunca o IO bruto |

**A Temporada 1 de verdade** (ADR 0038; `docs/METODOLOGIA.md`, "Temporada 1"; `docs/RUNBOOK.md`, seção 13) começa em 13/10/2026, antes de hoje, e
por isso não passa pelo `season:start`: o `arena:retroativo` a cria do `temporada-1.json` e a inicia **na data do arquivo**, com o SHA-256 do
prompt fixado em `season.prompt_sha256`; roda os pregões que já passaram como **retroativos**; e o operador local (`arena:operar`) roda os
seguintes **ao vivo**. Cada ciclo guarda o modo (`cycle.mode`: `RETROATIVO` ou `AO_VIVO`, o padrão) e a hora real em que nasceu
(`cycle.executed_at`); a API pública os devolve em toda rota que mostra o ciclo (`mode` e `executedAt`) e o ranking conta os pregões de cada modo
(`cyclesByMode`). O agendador de produção e o reprocesso do painel só abrem ciclo `AO_VIVO`; a api nem consegue gravar outro (o gatilho
`cycle_api_guard`, migration `20261106120000_retroactive_cycles`).

**Na Azure** (e pelo painel) os dois primeiros comandos são `POST /admin/seasons` e `PATCH /admin/seasons/:id` (etapa 10, parte 2; `docs/API.md`, seção 8): o mesmo arquivo e a mesma data de início, com a trilha de auditoria na
transação. O painel também **edita o rascunho** (nome, parâmetros e elenco, que o comando não faz). **Regras, elenco e prompt de uma temporada em andamento ou encerrada ficam fixos**: a edição só aceita o rascunho
(409 `SEASON_LOCKED` nos outros casos, com o UPDATE condicional no banco como a barreira de verdade), e o prompt é fixado no ciclo pelo agendador (seção 2). A rota ainda recusa iniciar uma temporada enquanto outra está em
andamento (409 `SEASON_RUNNING_EXISTS`): o briefing é um por pregão, e duas com regras diferentes derrubam o `freeze` (seção 10). A conferência e o início são **um passo só, sob uma trava consultiva do Postgres**
(`ArenaRepository.startSeason`, `exclusive`): dois inícios simultâneos de rascunhos diferentes (duas abas, dois `curl`) não passam os dois, um recebe 409. O comando `season:start` não confere isso (e toma a mesma trava).

## 2. O ciclo (`sched-cycle`, 08:00)

Roda só se for pregão (o calendário da B3), e só para temporada `RUNNING` que já começou e ainda não passou do último pregão
(`sessions`). Por temporada:

1. **Antes de tudo, a varredura** dos ciclos vencidos (seção 5).
2. **Briefing.** Sem a linha de `briefing` do pregão, o ciclo é registrado como **pulado** (`sem_briefing`) e nenhum modelo é chamado.
3. **Orçamento.** Com algum competidor pago (provedor que não é `fake`), o gasto do mês (soma de `decision.cost_micro_usd` dos ciclos
   do mês, de todas as temporadas) tem de estar abaixo do teto `ARENA_MONTHLY_COST_CAP_USD` (dólares inteiros, parâmetro
   `arenaMonthlyCostCapUsd` do Bicep). No teto, ou **sem o teto configurado** (fail closed), o ciclo é pulado (`orcamento`). Os fakes custam zero e
   não dependem dele. O teto é conferido **antes** do ciclo: um ciclo que começa abaixo dele pode passar um pouco (no máximo o custo
   de um ciclo). O custo de uma tentativa que falha antes de a decisão ser gravada não entra na soma (só o que fica em `decision` conta).
4. **Prompt.** O agendador não lê o prompt (a identidade dele não tem acesso ao segredo): a versão chega por `PROMPT_ARENA_VERSION` e
   o ciclo a fixa em `prompt_version` (que nasce **sem SHA-256**; o primeiro `decide` o registra).
5. Cria o `cycle` (`OPEN`, com `decision_at` 08:00 e `deadline_at` 09:30 de Brasília) e publica uma `decide {ciclo, competidor}`
   por MODEL. É idempotente: o ciclo é único por temporada e pregão, o `MessageId` é determinístico, e repetir o job (2 retentativas)
   republica as mesmas mensagens. O ciclo pulado é **reavaliado** na próxima execução (o briefing pode ter chegado, reenviado da DLQ).
   **O reprocesso a pedido do admin** (`POST /admin/cycles/:date/rerun`, o botão "Reprocessar um ciclo" do painel; `docs/API.md`, seção 8) é este mesmo
   passo, mais estrito: **nunca nos últimos 5 minutos antes do prazo das 09:30 nem depois dele** (um `decide` publicado tarde só começa depois do prazo, porque a KEDA e a partida do job levam tempo, e gravaria HOLD
   `prazo`, uma decisão depois do prazo; a margem é `RERUN_MARGIN_MS` em `cycle-schedulers.ts`) nem antes das 08:00,
   só para o MODEL que **ainda não tem decisão** (a decisão gravada não muda nunca) e **sem a varredura** dos ciclos vencidos. Passado o prazo, quem fecha o ciclo é a
   varredura do `sched-cycle` seguinte ou a do `settle` (seção 5), e não o admin.

Estados do ciclo: `OPEN` (mensagens publicadas), `CLOSED` (todo MODEL tem decisão, normal ou HOLD forçado) e `SKIPPED`. A liquidação
(etapa 7) trata o ciclo `SKIPPED` ou ausente como HOLD de todos.

## 3. A decisão (`decide`, um job por evento)

Cada execução do `job-worker-decisions` recebe **uma** mensagem da fila `decisions` (`MessagingService.receiveOne`, com a trava
renovada por 26 minutos), trata e sai com 0. Passos, na ordem:

| # | Passo | Se falhar |
|---|---|---|
| 1 | `job_run` (`decide` + `ciclo:competidor`): repetida não faz nada | `JobBusyError` se outra entrega é a dona |
| 2 | Carrega o ciclo e o competidor (tem de ser MODEL da mesma temporada). Decisão já gravada: nada a fazer, a não ser tentar fechar o ciclo (quem a gravou pode ter caído antes; é um `UPDATE` condicional) | erro (a fila tenta de novo) |
| 3 | **Prazo:** a partir das 09:30 de Brasília não chama o modelo | HOLD `prazo` |
| 4 | **Igualdade do prompt:** lê `PROMPT_ARENA` e `PROMPT_ARENA_VERSION`, exige no texto a linha de canário (seção 6), calcula o SHA-256 e confere a versão com a fixada no ciclo e o hash com o registrado para a versão (o primeiro `decide` o registra, por UPDATE condicional) | HOLD `prompt_divergente`, sem chamar o modelo; prompt sem canário é erro de configuração (`LlmConfigError`), que o alerta enxerga |
| 5 | **Briefing:** lê o Blob e confere o SHA-256 com a linha de `briefing` | `BriefingIntegrityError` (erro alto, o modelo nunca é chamado) |
| 6 | **Parte própria:** caixa, posições com quantidade e preço médio, e as barras de 30 pregões dessas ações (`readPortfolio`: a carteira da última liquidação antes do pregão, seção 10; a inicial no primeiro pregão) | erro |
| 7 | **Gateway:** 1 chamada (e 1 reparo, se a resposta não for JSON válido ou sair do envelope, com o erro e custo somado). O reparo só começa com **3 minutos** de folga (no prazo ou no job): sem eles a primeira resposta, já paga, é guardada como HOLD, e a nova tentativa da fila não a joga fora. Primeira resposta vazia vai ao reparo com um texto fixo no turno do assistente | HOLD `resposta_invalida` depois do reparo (ou sem tempo para ele); `prazo` se o tempo acabou |
| 8 | **Validação** (ADR 0016), a **limpeza dos textos** e o **filtro de vazamento** | |
| 9 | **IO bruto** no Blob `llm-io` e a `decision` com os hashes. Se outra execução gravou a decisão antes (a trava da fila venceu com a dona viva, o que `lockRenewalMs` > `replicaTimeout` impede em produção), a desta não vale: o resultado é `already_decided` e o log avisa o custo pago que não entrou no teto do mês | erro |

**Mensagens ao modelo.** O prompt vai sozinho no papel de sistema. O turno do usuário traz o briefing e a parte própria como **dado
delimitado**, nunca concatenados ao prompt: `[[BRIEFING sha256=<hash>]]` ... `[[/BRIEFING sha256=<hash>]]` e o mesmo para
`CARTEIRA`. O hash do marcador é o do conteúdo de dentro, que um texto de terceiro (uma notícia) não pode conhecer antes de existir:
nenhum conteúdo consegue escrever o marcador que fecha o próprio bloco. Quem tem o Blob confere o que o modelo viu. O reparo
devolve o erro como **código da regra e caminho do campo** (`market_view (invalid_value)`), nunca o valor nem a mensagem do Zod, que
repete a chave que o modelo escreveu.

**Teto de itens.** A resposta tem no máximo **50 itens** em `decisions` (`MAX_DECISION_ITEMS`: 10 posições, 5 ordens e folga de HOLD de
acompanhamento). Acima disso a resposta inteira é inválida (reparo único, depois HOLD `resposta_invalida`), nunca um corte calado: o
HOLD não conta como ordem nem passa por universo ou carteira, e sem teto seria um canal largo de texto livre para o feed público.

**Validação semântica** (depois do `parseLlmDecision` estrito, que roda com `applyOrderCap: false`): o item inválido é descartado,
com o motivo, e os outros valem. Em ordem, sobre o que a anterior deixou: ticker repetido (o primeiro vale); BUY fora do universo da
semana (a tabela que o modelo recebeu, conferida pelo hash do briefing); SELL de ação que não está na carteira; compra de ação nova
que passaria de 10 posições (a venda de 100% libera a vaga, porque as vendas rodam antes das compras); as ordens além da quinta,
na ordem listada (HOLD não conta); e, por fim, **as posições de novo, só com o que o corte deixou**: a vaga que a venda total
liberava vale só se o corte não derrubou essa venda (o SELL listado depois da quinta ordem). Sem esta última conferência a decisão
mostraria a compra como válida e a liquidação a recusaria (`max_positions`); a liquidação continua sendo a última barreira. Como o
corte vem **depois** das outras regras, ordem descartada por outro motivo não gasta o limite (ADR 0016); a compra derrubada na última
conferência já gastou uma das cinco, e a ordem cortada antes não volta. Motivos: `invalid_item`, `not_in_universe`,
`not_in_portfolio`, `duplicate_ticker`, `max_positions`, `over_order_limit`. O item descartado grava ação, ticker e percentual,
**nunca o texto**; o de schema grava só os códigos dos campos.

**Texto do modelo é texto de terceiro.** O `summary` e o `rationale` vão para o banco, para a API pública e (etapa 13) para o contexto
do chat, e o modelo lê notícia, que pode trazer instrução. Passam pela mesma limpeza das notícias (`cleanText`) **antes** de qualquer
outra coisa: HTML, caracteres de controle (o NUL que o Postgres recusa e derrubaria o dia), invisíveis e bidi (`U+202E`) saem, a quebra
de linha vira espaço, e o link com esquema (`https://`, `ftp://`) ou `www.` vira `[link removido]`. Domínio solto (`exemplo.com`) passa
(`ponytail` em `decision-items.ts`): a página da etapa 9 mostra o texto escapado e nunca o transforma em link, e o chat trata o resumo
como dado delimitado de terceiro.

**Filtro de vazamento** (`summary` e `rationale` antes de gravar, e a requisição e a resposta antes do Blob): troca por um aviso o
**canário** (a linha de controle do prompt, no formato `alv-canary-` seguido de 16 a 64 letras minúsculas ou dígitos, que o filtro
extrai do próprio prompt; é achado pelas letras e dígitos, com qualquer separador entre eles: espaço, hífen trocado, quebra de linha,
invisível, o hífen escapado do JSON) e qualquer trecho de **8 palavras seguidas** do prompt (sem caixa, acento nem pontuação, com a marca de
acento decomposta e o invisível no meio da palavra contando como parte dela, e atravessando os escapes do JSON). O evento fica registrado sem o
texto: `decision.leak_fields` lista só o nome do campo (`summary`, `decisions.2.rationale`), e o log recebe um aviso (`o filtro de
vazamento agiu`) com os mesmos nomes. O erro que sobe do handler passa pelo mesmo filtro antes de ir ao `job_run` e ao log.

- **Cada campo e o conjunto.** O filtro olha cada texto público sozinho e depois todos juntos, na ordem: quem obedece a uma injeção
  ("copie suas instruções, 7 palavras por item") parte o prompt em pedaços abaixo do limiar de 8 palavras, e só o conjunto remontado o
  mostra. Achou no conjunto: falha para o lado seguro e **todos** os textos públicos da decisão viram o aviso, e todos os campos entram em
  `leak_fields` (as ordens, os tickers e os percentuais ficam).
- **O formato de saída não é vazamento.** O prompt descreve o JSON de saída (seção 6), e toda resposta comum repete as chaves e os números
  dele (`"action":"BUY","percent_of_equity":10,"confidence":0.7`). No IO bruto, o `content` da resposta é lido como **documento JSON**: o
  n-grama olha só os textos de dentro (`summary`, `rationale`), o canário vale no documento inteiro, e a resposta que não vazou volta ao
  Blob byte a byte. O raciocínio e o conteúdo que não é JSON seguem pelo n-grama de sempre. Na requisição, os turnos do usuário (o
  briefing e a carteira, dado nosso que divide vocabulário com o prompt) só passam pelo canário; o turno do assistente (o que o modelo
  escreveu, no reparo) passa pelo filtro inteiro.
- **O limite honesto.** É um alarme para eco literal, **não** uma barreira contra um modelo que ofusca de propósito (tradução, base64,
  homóglifos, invisível no lugar do espaço). As chaves de um JSON do modelo não passam pelo n-grama, só pelo canário (o schema estrito
  recusa chave desconhecida, mas o IO bruto guarda a resposta como veio). A barreira dos textos públicos é o conjunto: limpeza, teto de
  itens, o conjunto dos campos, o schema estrito e o prompt que manda tratar notícia como dado.

**IO bruto** (`llm-io/<pregão>/<ciclo>/<competidor>/{request,response,meta}-<sha256>.json`): a requisição **sem o texto do prompt**
(no lugar dele, `[prompt-arena versão <v> sha256 <h>]`), a resposta crua do provedor e os metadados (tentativas, uso, custo, o que o
provedor aplicou, itens descartados, onde o filtro agiu). O nome carrega o SHA-256 de cada arquivo, o `decision` guarda os três hashes
e os endereços, e **a API nunca devolve os endereços**. O worker-data NÃO tem papel nesse container (o Blob vai por container: só as decisões o gravam e nada o lê;
`docs/INFRA.md`, 3.2, e ADR 0030). O prompt nunca entra ali mesmo assim, como defesa em profundidade (regra 4 do `CLAUDE.md`), e o teste de canário confere.

**Custo e uso.** `decision.usage` soma os tokens das chamadas (original e reparo) e `cost_micro_usd` o custo em micro-dólares, inteiro,
sem float: o `usage.cost` que o OpenRouter devolve, ou, sem ele, os tokens vezes o preço do competidor (arredondado para cima);
sem nenhum dos dois, zero (`applied.costSource = none`).

## 4. HOLD forçado e seus motivos

| Motivo (`hold_reason`) | Quando |
|---|---|
| `prazo` | a decisão começou depois das 09:30, ou o prazo chegou durante a chamada (a chamada é abortada; o limite da chamada era o prazo, mesmo que o timer dispare um instante antes das 09:30 no relógio de parede), ou faltavam menos de 3 minutos para o reparo |
| `prompt_divergente` | a versão ou o hash do prompt do job não é o fixado no ciclo |
| `resposta_invalida` | JSON inválido ou fora do envelope (inclusive mais de 50 itens), também no reparo; ou o job sem 3 minutos para o reparo |
| `falha` | a **última entrega** da mensagem falhou (seção 5) |
| `sem_resposta` | a varredura achou o ciclo vencido sem decisão (processo que caiu, mensagem perdida) |

## 5. A DLQ vira HOLD registrado

`decisions` tem 3 entregas (`QUEUES`). O mecanismo escolhido é **o handler na última entrega**, com a **varredura** como rede de
segurança (ADR 0021):

1. O `MessagingService` passa ao handler a entrega: a tentativa (propriedade `attempt` da mensagem) e se é a última da fila. Falhou
   na 1ª e na 2ª: a fila agenda a cópia para 10 e 20 minutos (ADR 0015), dentro da janela até as 09:30.
2. Na **última** entrega, se o processamento falha, o `DecideHandler` grava a decisão como HOLD `falha` (o `job_run` fica `FAILED`,
   com o erro) e **não lança**: a mensagem é concluída e **não vai para a DLQ**. Se nem o HOLD dá para gravar (banco fora), o erro
   sobe e a mensagem vai para a DLQ, que é o que o alerta da etapa 10 vigia.
3. Mensagem inválida (corpo torto, fila errada) continua indo para a DLQ na hora, sem HOLD: não há competidor a registrar.
   **Erro de configuração também não vira HOLD** (06/11/2026): chave ausente, recusada (HTTP 401) ou sem crédito (HTTP 402), prompt
   ausente ou sem a linha de canário (`LlmConfigError`). Não é decisão do modelo, e o HOLD `falha` mancharia a temporada (no retroativo,
   um crédito que acabasse no meio gravaria HOLD em todos os pregões seguintes, porque a chamada recusada não custa e o teto nunca
   dispara). A última entrega lança, a mensagem vai para a DLQ (o alerta enxerga) e o par fica sem decisão: o `arena:retroativo` para
   no pregão antes da liquidação e, corrigida a causa, decide o que falta; ao vivo, a varredura do item 4 grava `sem_resposta`, e o
   operador local nem abre o ciclo sem saldo para o pior caso do pregão (`temporada/credit.ts`, regra 5 do `operator.ts`).
4. **A varredura** (`CycleCloser.closeOverdue`): ciclo `OPEN` com o prazo vencido há mais de 15 minutos fecha, e cada MODEL sem decisão
   ganha HOLD `sem_resposta`. Cobre o que nenhum handler vê: o broker mandou a mensagem para a DLQ por trava expirada (processo que
   caiu três vezes), ou ela nunca foi publicada. Roda no `sched-cycle` (antes de abrir o ciclo do dia) e **no início do `settle`**
   (etapa 7), antes de ler as decisões do dia.

O ciclo fecha quando **todos os MODEL têm decisão, normal ou HOLD forçado**: a mensagem na DLQ não trava o ciclo.

## 6. O prompt

**O texto nunca entra no repositório.** Em produção vive no Key Vault (`prompt-arena`, versionado); em dev, na variável `PROMPT_ARENA`
do `.env.local` (fora do git, que ignora `.env*`); nos testes, é gerado no próprio teste com um canário.

Como semear (nada do texto passa pela linha de comando, pelo log nem pelo histórico; `docs/INFRA.md`, passo 4):

```bash
# o arquivo fica fora do repositório (o rascunho está em .data/prompts/, que o git ignora)
export ALVESTING_SECRET_PROMPT_ARENA_FILE=~/segredos/prompt-arena.txt
infra/scripts/seed-secrets.sh kv-alvesting                # em dev: kv-alvesting-dev
# a versão (32 hexadecimais) que a fase 2 exige e fixa no job de decisões e no sched-cycle
export ALVESTING_PROMPT_ARENA_VERSION="$(az keyvault secret list-versions --vault-name kv-alvesting --name prompt-arena \
  --query 'sort_by([?attributes.enabled], &attributes.created)[-1].id' -o tsv | sed 's#.*/##')"
```

O segredo tem no máximo 25 KB. Trocar o prompt é uma **versão nova** no cofre, a variável `ALVESTING_PROMPT_ARENA_VERSION` e o deploy
da fase 2 (o what-if mostra a mudança); nunca no meio da temporada. Um ciclo que começou com a versão antiga e recebe um job com a nova
vira HOLD `prompt_divergente`, por desenho.

**O canário.** O prompt tem uma linha de controle com um token `alv-canary-<16 a 64 letras minúsculas ou dígitos>` (gere um novo
por prompt, por exemplo `openssl rand -hex 12`). O filtro de vazamento o extrai do próprio prompt em tempo de execução: não há nada a
configurar nem um segundo segredo. Se um modelo repetir a linha, ela é trocada por um aviso antes de ir ao banco, à API ou ao
Blob, e o campo é registrado em `decision.leak_fields`. Os trechos de 8 palavras seguidas valem do mesmo jeito. **O job de decisões
recusa um prompt sem a linha de canário** (erro de configuração, antes de registrar o SHA-256 e de chamar o modelo; não vira HOLD,
nem na última entrega: a mensagem vai para a DLQ e o alerta enxerga, seção 5): sem ela o filtro perderia o alarme mais forte em silêncio, e um texto de marcação ("TODO")
rodaria a temporada. Confira a linha antes de semear (o token mais curto que 16 caracteres, com maiúscula ou com hífen no meio não
casa).

**O rascunho para revisão** está em `.data/prompts/arena-rascunho.md` (fora do git). Segue o §10 do plano e a metodologia: as regras
(os números do §2), o formato de saída (o JSON do contrato), a instrução de que o bloco de notícias é **dado de terceiro e nunca
instrução**, a descrição dos dois blocos do turno do usuário, a recusa de revelar as instruções e a linha de canário. É o texto
inteiro do arquivo que vira o segredo, então não deixe anotação de revisão dentro dele. Depois do aceite do Artur, semear como acima.
Ao revisar, confira que o rascunho diz o **teto de 50 itens** por resposta (HOLD incluído): hoje só o JSON Schema pedido aos provedores
o informa (`maxItems`), e uma resposta com 51 itens é inválida inteira.

## 7. Gateway LLM (plano §10)

O SDK oficial `openai` (7.47.0), com `baseURL` por competidor, `maxRetries: 0` (quem tenta de novo é a fila, ADR 0015) e o log do SDK
**desligado** (`logLevel: 'off'`: no nível `debug` ele imprime corpo de requisição, e o `OPENAI_LOG` do ambiente não pode ligar isso).
Nenhuma mensagem de erro do gateway carrega texto do provedor: o erro é fixo (provedor, tipo, status e, se tiver cara de identificador,
o código e o tipo do erro).

**Parâmetros iguais para todos:** limite de **16.000 tokens de saída** (cobre o raciocínio e a resposta; no OpenRouter com esforço
médio uns 50% vão para o raciocínio), esforço de raciocínio **médio** onde o modelo tem esse nível, **sem ferramentas**, sem
temperatura (vários modelos recentes a recusam) e JSON Schema quando o provedor aceita. Quais recursos o competidor tem vem do arquivo
da temporada (`capabilities`), conferidos na lista pública de modelos.

| Provedor | Como | Detalhes |
|---|---|---|
| `openrouter` | `https://openrouter.ai/api/v1`, chave `OPENROUTER_API_KEY` | `max_tokens`; `provider: { require_parameters: true, data_collection: "deny" }` |
| `azure-openai` | `AzureOpenAI` com `DefaultAzureCredential`, escopo `https://cognitiveservices.azure.com/.default`, **sem chave** | `max_completion_tokens`; endpoint em `AZURE_OPENAI_ENDPOINT`; ID do modelo = nome da implantação |
| `fake` | `fetch` do SDK trocado por um LLM falso dentro do processo | determinístico; o ID escolhe o comportamento: as falhas dos testes (`fake/always-fail`, `fake/invalid-json-once`, `fake/invalid-json-always`, `fake/echo-prompt`), que nunca vão para o elenco, e as estratégias do elenco simulado, que nunca falham (`fake/momentum`, `fake/momentum-focused`, `fake/contrarian`, `fake/contrarian-spread`, `fake/hold-only` e, para qualquer outro ID, a escolha por SHA-256, como o `fake/hash-picks`; `docs/ENSAIO.md`, seção 3) |

**OpenRouter, a política de dados** (documentação consultada em 01/11/2026): `require_parameters: true` roteia só para provedores que
aceitam todos os parâmetros pedidos ("the request won't even be routed to that provider",
<https://openrouter.ai/docs/guides/routing/provider-selection.md>), e `data_collection: "deny"` usa só provedores que não coletam dados
do usuário ("use only providers which do not collect user data", mesma página). Por conta, o OpenRouter não guarda prompt nem resposta
a menos que se ative o registro (<https://openrouter.ai/docs/guides/privacy/data-collection.md>), e o treino por provedores se controla
em <https://openrouter.ai/docs/guides/privacy/logging.md>: **deixe desligados o registro de entrada e saída e o uso dos dados pelo
OpenRouter** na conta. Não enviamos `zdr: true` (retenção zero): pode excluir todos os endpoints de um modelo; decidir com a primeira
chamada real. O custo vem em `usage.cost` de toda resposta (<https://openrouter.ai/docs/cookbook/administration/usage-accounting.md>).
O esforço e o limite de tokens: <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md> e
<https://openrouter.ai/docs/api_reference/parameters.md>.

**O ID do modelo no OpenRouter não leva sufixo de variante** (`:online` liga a busca na web, `:nitro` e `:floor` mudam o roteamento,
`:free` e `:batch` são outro serviço): o contrato recusa qualquer `:`, porque quebraria "mesmos parâmetros, sem ferramentas nem web".
O Azure OpenAI não devolve o custo, então o competidor desse provedor **exige** a tabela de preços (`pricingUsdPerMTok`); sem ela o
custo seria zero e o teto do mês nunca fecharia para ele. No OpenRouter a tabela é só reserva do `usage.cost`; resposta sem custo e
sem tabela grava zero (`applied.costSource = none`) e o log avisa. Os tokens que o provedor devolve acima de 10 milhões valem zero
(o provedor errou). O erro do gateway diz o provedor, o tipo, o status e, quando têm cara de identificador, o `code` e o `type` do erro
do provedor (`model_not_found`, `insufficient_quota`): o diagnóstico da primeira chamada real, sem o corpo da resposta.

**Checklist da primeira chamada real** (não verificada aqui, regra 3): (1) na conta do OpenRouter, desligue o **registro de entrada e
saída** e o **uso dos dados para treino**; `data_collection: "deny"` exclui provedores que coletam, mas **não é retenção zero**, e essas
duas opções da conta são um passo manual sem verificação; (2) decida `zdr: true` só se os seis modelos tiverem endpoint com retenção zero
(sem endpoint o OpenRouter responde 404); (3) uma chamada com cada um dos seis, conferindo `applied` (modelo e provedor reais) e o custo
contra o painel; (4) o 404 "No endpoints found" com `require_parameters` e o 402 de crédito aparecem agora com o `code` na mensagem.

**JSON Schema com `strict: false`, no dialeto comum**, de propósito: `confidence` é opcional no contrato (ADR 0016) e o modo estrito da
OpenAI exige todos os campos obrigatórios. O schema é uma dica para o modelo; a barreira é o `parseLlmDecision`. Ele é escrito à mão em
`llm-messages.ts`, só com tipos, obrigatórios, `enum` e objetos fechados, e **não** é o `z.toJSONSchema` do contrato. Na primeira chamada
real (a prova do pregão de 13/10, rodada em 06/11/2026), o schema do contrato, com `oneOf`, `const`, `pattern` e limites de número e de
texto, levou HTTP 400 em dois dos seis: a Anthropic respondeu "Schema type 'oneOf' is not supported" e o Google, `INVALID_ARGUMENT`, e os
dois ficaram com HOLD forçado. Os outros quatro aceitaram. O mesmo pedido com o dialeto comum passou nos seis. O teste do
`llm-messages.spec.ts` confere que os campos, os obrigatórios e os enums são os do contrato e que nenhum recurso fora do dialeto voltou.
Aceitar `response_format` (o `supported_parameters` do endpoint) não diz quais recursos de JSON Schema o provedor aceita.

**Um provedor fora do roteamento: a Wafer** (`IGNORED_OPENROUTER_PROVIDERS` no gateway, a mesma lista para todos os competidores; só o
DeepSeek V4 Pro, entre os seis, tem endpoint nela). No teste do schema novo (06/11/2026), o DeepSeek pela Wafer começou o JSON certo e
entrou num laço de espaços e tabulações até o limite de saída (HTTP 200 com `finish_reason` "length", 16 mil tokens, US$ 0,07); com o
schema do contrato, também deixou espaços soltos no meio. A mesma chamada sem a Wafer saiu certa em três provedores (Sail Research,
Together e CoreWeave). Sem a exclusão, a falha do motor de saída estruturada de um provedor viraria HOLD por resposta inválida do modelo.

**Tempo de cada chamada:** o menor entre o que falta até 09:30 e o `replicaTimeout` do job (1500 s) menos 2 minutos de margem; a
segunda chamada (o reparo) recebe só o que sobrou. O `fetch` do Node espera 5 minutos pelos cabeçalhos, pouco para um modelo de
raciocínio sem streaming; por isso o gateway usa o `Agent` do `undici` (a saída que o SDK documenta) e o limite passa a ser o orçamento
acima. Com menos de 10 segundos não vale começar a primeira chamada, e com menos de **3 minutos** não vale começar o reparo (a primeira
resposta, já paga, vira HOLD com o IO e o custo, em vez de se perder na nova tentativa). O transporte de produção (SDK com o `Agent` do
`undici`) tem teste contra um servidor em 127.0.0.1: sucesso, custo, servidor que não responde (timeout) e conexão fechada.

## 8. Elenco da Temporada 1 (decidido em 06/11/2026)

Um modelo de topo por laboratório, conferido na lista pública (`GET https://openrouter.ai/api/v1/models`, sem chave) em **01/11/2026** (os
IDs e os recursos) e em **06/11/2026** (os preços: a resposta das 08:53, com 453 modelos, consultada pelo coordenador; `docs/DEPENDENCIAS.md`).
"Topo" é o que a própria descrição na lista chama de principal; as variantes `-pro` (modo de raciocínio mais caro) e os `:batch` ficam
de fora. O arquivo é `apps/api/seasons/temporada-1.json`: a Temporada 1, de **13/10/2026** (o primeiro pregão em que os seis já existiam no
OpenRouter: o Gemini 4 Argon entrou em 13/10) ao **último pregão de 2026, 30/12/2026**, **53 pregões** pelo calendário da B3 (o
`season-files.spec.ts` refaz a conta), com as regras de sempre (capital de R$ 100.000,00, 10 posições, 5 ordens, 0,03% de custo, decisão às
08:00 e prazo às 09:30) e as sementes do Sorteio e do Monte Carlo do rascunho.

**A temporada sintética continua simulada** (seção 1): o ensaio, a demo local e a semente do e2e usam os mesmos seis nomes e slugs com o
provedor `fake` (`docs/ENSAIO.md`, seção 3), e o site marca cada um como "simulado". A Temporada 1 nasce com o `openrouter` e os IDs abaixo,
e a etiqueta some sozinha.

| Laboratório | ID | US$ / M entrada | US$ / M saída | JSON Schema | Esforço `medium` |
|---|---|---|---|---|---|
| Anthropic | `anthropic/claude-opus-5.5` | 4 | 20 | sim | sim |
| OpenAI | `openai/gpt-6.1-sol` | 2 | 10 | sim | sim |
| Google | `google/gemini-4-argon` | 2 | 10 | sim | sim |
| xAI | `x-ai/grok-4.7` | 2 | 6 | sim | sim |
| DeepSeek | `deepseek/deepseek-v4-pro-0813` | 0,1165 | 4,66 | sim | **não**: os níveis são `max`, `high`, `low` e `none` |
| Alibaba | `qwen/qwen3.8-max-0902` | 2 | 6 | sim | sim |

"JSON Schema" = `response_format` e `structured_outputs` em `supported_parameters`; "Esforço" = `reasoning_effort` em
`supported_parameters` e `medium` em `reasoning.supported_efforts`. Os seis aceitam `max_tokens` e `reasoning_effort` (e só o Opus e o
Sol aceitam também `max_completion_tokens`, razão de o OpenRouter usar `max_tokens`). **O DeepSeek não tem o nível médio**: o
parâmetro não é enviado e o modelo usa o padrão dele (`high`). É uma assimetria da metodologia ("esforço médio onde existir") a
declarar entre as limitações. Fora do elenco, por escolha: `anthropic/claude-fable-5.1` (US$ 10 / 50, mais caro e de outra linha),
`deepseek/deepseek-v4-pro` (0423, anterior ao 0813, a versão GA) e `qwen/qwen3.8-max-prime` (variante de maior vazão, a um preço maior).
Os preços de 06/11/2026 são os de 01/11/2026, menos o DeepSeek V4 Pro (0813), que passou de 0,115 e 4 para 0,1165 e 4,66.

**Estimativa de custo.** Entrada de um briefing sintético do tamanho do real (305 ações, 17 com barras, 8 notícias: **45.765 bytes**, contra os
43.405 do de dev) mais a carteira (247 bytes na carteira inicial, 15.879 bytes com 10 posições de 30 barras) e o rascunho do prompt (6.250
bytes). A 3 bytes por token são uns 17,5 mil tokens de entrada com a carteira inicial e uns 22,7 mil com 10 posições; é uma aproximação, e o
tokenizer de cada modelo difere. Dois cenários (`apps/api/src/temporada/plan.ts`, `COST_SCENARIOS`, com a conta à mão no `plan.spec.ts`):
**típico** (20 mil de entrada e 6 mil de saída: uns 4,5 mil de raciocínio e 1,5 mil de JSON) e **pior caso** (a primeira chamada no teto, 27 mil
de entrada a 2,5 bytes por token com a carteira cheia e os 16 mil de saída do gateway, **mais o reparo**, com a resposta de volta na entrada:
43 mil e 16 mil). O custo de cada chamada arredonda para cima (`pricedCostMicro`).

| Modelo | Pregão típico | Pior caso do pregão | 53 pregões, típico | 53 pregões, pior caso |
|---|---|---|---|---|
| Claude Opus 5.5 | US$ 0,200 | US$ 0,920 | US$ 10,60 | US$ 48,76 |
| GPT-6.1 Sol | US$ 0,100 | US$ 0,460 | US$ 5,30 | US$ 24,38 |
| Gemini 4 Argon | US$ 0,100 | US$ 0,460 | US$ 5,30 | US$ 24,38 |
| Grok 4.7 | US$ 0,076 | US$ 0,332 | US$ 4,03 | US$ 17,60 |
| DeepSeek V4 Pro (0813) | US$ 0,030 | US$ 0,157 | US$ 1,61 | US$ 8,34 |
| Qwen3.8 Max (0902) | US$ 0,076 | US$ 0,332 | US$ 4,03 | US$ 17,60 |
| **Os seis** | **US$ 0,582** | **US$ 2,661** | **US$ 30,86** | **US$ 141,05** |

Por mês (pelo mês do pregão, que é como o teto do mês conta): outubro tem 14 pregões (típico US$ 8,15; pior caso US$ 37,26), novembro 19
(US$ 11,06; US$ 50,56) e dezembro 20 (US$ 11,65; US$ 53,23). Os 17 pregões retroativos de 13/10 a 05/11 custam uns US$ 9,90 no típico e no
máximo US$ 45,24. O OpenRouter cobra uma taxa sobre a compra de créditos que esta tabela não inclui (não conferida). O custo de verdade é o
`usage.cost` que o OpenRouter devolve em cada resposta, gravado em cada decisão.

**Os tetos.** O teto de produção proposto é **US$ 40 por mês** (`arenaMonthlyCostCapUsd` em `main.prod.bicepparam`; no Mac,
`ARENA_MONTHLY_COST_CAP_USD`), com folga de 3,4 vezes sobre o típico do mês mais caro (dezembro); só novembro ou dezembro inteiros perto do pior caso passariam dele, e
então o ciclo seguinte ao teto seria pulado (`orcamento`). O `arena:retroativo` tem ainda o **teto da execução** (`--teto-usd`, padrão 30): antes de abrir
cada pregão, para se o gasto da execução mais o pior caso do pregão passaria dele. O plano (§5.12) estimava US$ 20 a 50 por mês.

## 9. A API (`GET /api/v1/cycles/:id`)

A leitura mínima da etapa 6, no envelope `{ success, data, error }`, com o `id` validado como ULID (400 se não for, 404 se não existe). Traz
os horários (decisão e prazo, em UTC), o status e o motivo de pulo, a versão e o SHA-256 do prompt, o SHA-256 do briefing e, por
competidor, o resultado (ou o HOLD e o motivo), a visão de mercado, o resumo, os hashes da entrada e da saída, o custo em micro-dólares,
o uso, o que o provedor aplicou, os itens públicos e, dos descartados, só a posição e o motivo. **Nunca** o prompt, o IO bruto, nem o endereço
do Blob (`briefing.uri` e `decision.io_uris` ficam no banco). O formato é um schema estrito (`cycleViewSchema`) e o repositório monta
só o que ele lista. Até o que o provedor aplicou (`applied`) é estrito: o provedor, o modelo pedido, o modelo e o provedor reais (só
identificadores curtos), o motivo de parada, de onde veio o custo, os parâmetros (limite de saída, esforço, JSON Schema, `tools: false`,
`require_parameters`, `data_collection`) e o número de chamadas; campo a mais ou texto livre no lugar de um identificador derruba a
leitura em vez de sair na resposta. A API pública completa (cache, rotas por data, ranking) entrou na etapa 9 (`docs/API.md`).

## 10. O que a etapa 7 recebe, e o que não foi verificado

**Para a liquidação (etapa 7):**

- **Feito na etapa 7.** A carteira de cada competidor entra por `ReadPortfolio` (`application/portfolio.ts`): o `ArenaModule` monta
  `settledPortfolioReader`, que lê o caixa e as posições do **último fechamento liquidado antes do pregão** (`ArenaRepository.lastPortfolio`,
  uma consulta só) e dá o preço médio como custo / quantidade, no centavo mais próximo. Sem liquidação anterior vale a carteira inicial
  (`readInitialPortfolio`), sem aviso no primeiro pregão da temporada (o `DecideHandler` passa a data de início ao leitor). Se a última
  liquidação não é a do pregão anterior, ou não há nenhuma e o pregão não é o primeiro, o modelo decide com a que existe (ou a inicial) e
  o log avisa (o ciclo não é pulado: isso pediria um motivo de pulo novo, com migration e contrato). Agora o SELL vale.
- **Feito na etapa 7.** O `settle` começa por `CycleCloser.closeOverdue(now)` (seção 5), trata como HOLD o competidor sem decisão e o ciclo
  `SKIPPED` ou ausente, e lê só `decision_item` com `dropped = false` (o percentual é o `Decimal(7,4)` do banco: BUY é % do patrimônio, SELL é
  % da posição, HOLD é nulo). O banco recusa ciclo `CLOSED` sem `closed_at` e `OPEN` ou `SKIPPED` com ele (`cycle_closed_check`): em teste,
  feche o ciclo por `closeIfComplete` ou informe a hora. Também recusa um segundo Sorteio e uma referência repetida na mesma temporada
  (migration `20261101210000_arena_guards`, só aditiva; `closeIfComplete` conta só decisão de MODEL da temporada do ciclo). E recusa o BUY
  que vale fora de 5% a 25% do patrimônio (`decision_item_buy_range_check`, migration `20261101230000_decision_item_buy_range`): o erro
  aparece na gravação da decisão, onde só aquele modelo vira HOLD, e não na liquidação, que interromperia a temporada de todos. O item
  descartado guarda o que o modelo pediu, mesmo fora da faixa.
- **Feito na etapa 7: encerrar a temporada.** O `settle` do último pregão marca `FINISHED` e `finished_at` **na mesma transação da última
  liquidação**, com teste, e a migration `20261101220000_settlement` acrescentou
  `CHECK ((status = 'FINISHED') = (finished_at IS NOT NULL))` (`briefing.repository.integration.spec.ts` agora informa o `finished_at`). Sem
  isso a temporada ficaria `RUNNING` para sempre, e `runningSeasons` (o `freeze`, o `sched-cycle`) a trataria como em andamento: com a
  Temporada 0 (5 pregões) ainda `RUNNING` quando a Temporada 1 (20) começar, `rulesOfSeasons` acharia duas temporadas com regras
  diferentes, o `freeze` falharia todo dia e a arena pararia. **Atenção:** a temporada só encerra quando o `settle` do último pregão dá certo;
  se ele ficar na DLQ, ela segue `RUNNING` e trava o `freeze` da próxima. O alerta da etapa 10 tem de cobrir a DLQ do `settlement`.
- **O limite de posições tem duas barreiras.** A validação da decisão (seção 3, quarta conferência) e a execução da liquidação
  (`max_positions` no `portfolio.ts`): a liquidação é a última, e recusa a compra de ação nova que não cabe depois das vendas do pregão.
- **Criar e iniciar a temporada em produção: decidido na etapa 10 (parte 2).** `season:create` e `season:start` rodam "na máquina de quem
  tem acesso ao banco", e o Postgres de produção é privado; os JSON de `apps/api/seasons/` não estão na imagem. O caminho na Azure é o painel
  `/admin` (`POST /admin/seasons` e `PATCH /admin/seasons/:id`, `docs/API.md`, seção 8), com o mesmo arquivo; o primeiro admin nasce pelo
  `account:promote` como uma execução do `job-migrate` (`docs/INFRA.md`, seção 8.6). **A parte local da etapa 8 já existe**: `arena:ensaio` cria e inicia a
  temporada de `apps/api/seasons/ensaio.json` (desde 04/11/2026, os seis modelos do elenco da Temporada 1 com estratégias do provedor
  fake, o Sorteio e as referências; seção 1) pelos mesmos `SeasonService.create` e `start` dos comandos, e roda 5 pregões seguidos sem
  rede (`docs/ENSAIO.md`). As estratégias do provedor fake (`fake/momentum`, `fake/momentum-focused`, `fake/contrarian`,
  `fake/contrarian-spread` e `fake/hold-only`) valem também para a Temporada 0 de produção.
- **As regras do briefing vêm da temporada.** O bloco `rules` do briefing (capital, duração, posições, custo e horários) é lido
  de `season.params` pelo `freeze` (`rulesOfSeasons`): o ensaio de 5 pregões anuncia 5, não 20. O limite de ordens e as faixas de
  BUY e SELL seguem vindo do contrato. Sem temporada RUNNING valem as constantes da Temporada 1 (o mesmo documento de antes, e os
  padrões do schema da temporada são presos a elas por teste). O briefing é **um por pregão**: duas temporadas RUNNING com regras
  diferentes fazem o `freeze` falhar, em vez de dar a um modelo uma regra que não é a dele.
- **Teto global de notícias: nenhum novo, e a conta.** O teto por fonte (100 notícias, 5 fontes) fica. O pior caso, com dados
  sintéticos no teto (305 ações, 40 citadas mais a triagem com 30 barras, 500 notícias com título e trecho de 300 caracteres
  acentuados e 6 tickers cada), dá um briefing de **451.591 bytes**: uns 150 mil tokens a 3 bytes por token, 181 mil a 2,5. O menor
  contexto do elenco é o do Grok 4.7 (500 mil, na lista de 01/11/2026; os outros cinco têm 1 milhão ou mais), então o pior caso usa
  uns 40% dele, com os 16 mil de saída e o prompt. O `freeze` avisa acima de 300 KB. **Um modelo de contexto menor (128 mil, por
  exemplo) não cabe no pior caso**: antes de pô-lo no elenco, o corte de notícias passa a ser decisão de produto (o que sai
  primeiro: RSS antes da CVM? as mais antigas?). O dia real tem de 8 a umas dezenas de notícias (43 KB no briefing de dev), longe do teto.

**Não verificado** (precisa de rede, de conta ou da Azure): chamada real ao OpenRouter (nenhum teste chama LLM, regra 3), inclusive se
`strict: false` e `require_parameters` roteiam todos os seis modelos e se os nomes de parâmetro acima valem em cada endpoint;
a versão datada `2025-04-01-preview` da API do Azure OpenAI (a Microsoft recomenda a v1 desde 08/2025, com o escopo `https://ai.azure.com/.default`);
o KEDA acordar o job de decisões; a renovação da trava de 26 minutos no emulador real do Service Bus (os testes dela rodam no CI).
O provedor `azure-openai` na arena ainda não tem como funcionar em produção: faltam o endpoint no job e o papel na identidade (`docs/INFRA.md`, 2.7).
O filtro de vazamento também não foi conferido contra o **texto real** do prompt (o rascunho de `.data/prompts/` não foi lido por regra
desta onda): o que está provado, com um prompt sintético que traz o exemplo de formato do plano (§10), é que a resposta comum não é
marcada e que o eco do prompt, inteiro ou partido em pedaços, é. Os dois arquivos de segredo locais (`.env.local` e o rascunho do prompt)
ficam com modo 600 (e `.data/prompts` com 700), porque outro usuário da máquina os leria.
