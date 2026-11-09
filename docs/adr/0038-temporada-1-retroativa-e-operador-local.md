# ADR 0038: A Temporada 1 de verdade antes da Azure: os pregões passados como retroativos e um operador local ao vivo

- **Status:** aceita
- **Data:** 06/11/2026
- **Origem:** o pedido do Artur de 06/11/2026 ("vamos gerar os dados e decisões sem ser fakes ... se as api permitir quero que comece a 1 mês
  atrás e finalize só na virada de 2026 pra 2027"); `docs/METODOLOGIA.md`, "Temporada 1"; `docs/DADOS.md`, seção 22; `docs/RUNBOOK.md`, seção 13;
  `docs/ARENA.md`, seções 1 e 8; ADR 0011 (o prompt oculto), 0028 (o papel mínimo do Postgres) e 0032 (a brapi, fonte única).

## Contexto

A arena estava pronta para rodar com os seis modelos do OpenRouter, mas a Azure ainda não existe (a assinatura de estudante e o repositório
público ficam para depois). O Artur quer a Temporada 1 com decisões reais já, começando um mês atrás e terminando na virada do ano.

Três fatos limitam o desenho:

1. **Não dá para voltar no tempo.** Um pregão que já passou não pode ser decidido "ao vivo": a decisão de 13/10 rodada em 07/11 é, por
   definição, posterior ao pregão. Se ela aparecesse como ao vivo, seria falsificação de resultado, e o Playbook reprova isso na hora
   (critério 5, honestidade).
2. **O banco de hoje sabe o futuro do pregão antigo.** Ele tem as barras dos dias seguintes, o CDI publicado depois, o IPCA de meses
   que, na manhã do pregão, ainda não tinham sido divulgados, e os documentos da CVM entregues depois. Um briefing montado agora com tudo isso
   olharia para a frente.
3. **As notícias dos portais não guardam histórico.** O RSS mostra só os últimos itens; não há como saber, hoje, o que o portal mostrava
   às 07:30 de 13/10.

## Decisão

1. **O ciclo ganha um modo.** `cycle.mode` é `RETROATIVO` ou `AO_VIVO` (padrão `AO_VIVO`) e `cycle.executed_at` é a hora REAL em que a
   linha nasceu (migration `20261106120000_retroactive_cycles`, só aditiva). A API pública expõe os dois onde o ciclo aparece (o ciclo, o
   feed de decisões, a página do modelo, a página da ação e a home) e o ranking conta os pregões de cada modo (`cyclesByMode`). A api só
   lê as duas colunas: o UPDATE dela no ciclo passou a ser só das quatro colunas do reprocesso, e o gatilho `cycle_api_guard` só aceita o
   ciclo AO_VIVO, com a hora do banco, no INSERT dela (o Prisma 7 nomeia no INSERT toda coluna com padrão, então o INSERT por coluna
   derrubaria o reprocesso).
2. **Os pregões de 13/10/2026 até ontem entram como retroativos**, pelo `arena:retroativo`: o MESMO motor do ensaio (`apps/api/src/ensaio/world.ts`,
   agora montado com as peças escolhidas: `assembleWorld`), com o relógio simulado no pregão e as peças reais (a brapi para as barras que
   faltam, a CVM, o BCB, o OpenRouter e o Azurite). Cada pregão D só vê o que o pipeline ao vivo teria visto às 07:30 de D, pela regra de cada
   fonte (`apps/api/src/temporada/visibility.ts`; `docs/DADOS.md`, seção 22): as barras até D-1, o documento da CVM pela hora em que a busca
   das 07:30 do dia seguinte à entrega o veria, cada valor do BCB pela data em que ele fica público (a regra mais conservadora, quando a hora
   de publicação não é documentada) e a notícia de RSS só pela hora real em que o operador a viu. **O retroativo não tem notícias de portal**
   até o operador começar a coletá-las.
3. **A partir da virada, o pregão é ao vivo** pelo `arena:operar`, um processo do Mac (o `launchd`, com `caffeinate -i`) que roda a mesma
   agenda dos agendadores de produção (`apps/api/src/temporada/agenda.ts`, conferida contra os crons do Bicep por teste) com o relógio da máquina e
   o barramento do processo. Ele **nunca abre ao vivo atrasado**: passada a janela da decisão (09:30, menos a margem de 5 minutos do
   reprocesso), o pregão não ganha ciclo ao vivo e fica para o retroativo. Só abre o ciclo ao vivo quando todos os pregões anteriores da
   temporada já têm ciclo resolvido, nunca para pregão que já tem ciclo, e com o mesmo prompt. Antes da virada roda `--so-dados`, só coletando.
4. **A temporada fixa o prompt ao começar.** `season.prompt_sha256` guarda o SHA-256 do texto com que o `arena:retroativo` a iniciou, e o
   retroativo e o operador recusam abrir qualquer ciclo com outro prompt. O texto continua fora do repositório, de log e de resposta: vem de
   `PROMPT_ARENA` ou de `PROMPT_ARENA_FILE` (um arquivo fora do git).
5. **O arquivo da temporada tem a data do primeiro pregão** (`apps/api/seasons/temporada-1.json`, `startDate: 2026-10-13`, 53 pregões até
   30/12/2026, o último de 2026). Quem o cria e o inicia é o `arena:retroativo`; o `season:create` o recusa dizendo isso.
6. **O banco é o `alvesting_temporada`**, preparado pelo `temporada:preparar` (as migrations, o `db:roles` e a cópia do mercado do banco de
   dev, sem chamar a brapi). Quando a Azure existir, ele vai para lá por `pg_dump` (RUNBOOK, 13.6).
7. **Rede em lista branca.** O retroativo só fala com `openrouter.ai`, `brapi.dev`, `dados.cvm.gov.br`, `api.bcb.gov.br` e o loopback; o
   operador também com os quatro feeds RSS da lista fixa e o `icons.brapi.dev` (os logos da semana). O resto é bloqueado e vai para o log.
8. **Teto de custo por execução** (`--teto-usd`, padrão 30): antes de abrir um pregão, o retroativo para se o que já gastou mais o pior caso
   do pregão passaria do teto. O teto do mês (`ARENA_MONTHLY_COST_CAP_USD`) continua valendo e conta pelo mês do pregão.

## Por que 13/10/2026

É o primeiro pregão em que os seis modelos do elenco já existiam no OpenRouter: o Gemini 4 Argon entrou na lista em 13/10/2026, e os outros
cinco antes. Começar antes daria ao Gemini um pregão sem modelo, e trocar o elenco no meio quebraria "mesmas regras para todos".

## Alternativas consideradas

- **Começar na virada, só ao vivo.** É o mais limpo, mas a temporada ficaria com menos de 40 pregões e sem o mês que o Artur pediu.
- **Rodar os pregões passados "como se" fossem ao vivo.** Recusada: seria apresentar como ao vivo o que não foi (o critério eliminatório do
  Playbook). O modo e a hora real existem para isso.
- **Esperar a Azure.** Recusada: a data da assinatura é incerta, e o Mac já roda o motor inteiro (o ensaio prova isso).
- **Um segundo motor só para o retroativo.** Recusada: o ensaio já é a arena inteira com relógio simulado; duplicar daria dois comportamentos
  para explicar e testar. O retroativo e o operador são o mesmo motor com outras peças.

## Consequências

- **Dois trechos na mesma temporada.** O resultado da Temporada 1 mistura pregões retroativos (sem notícias de portal, com o macro e a CVM
  pela regra conservadora) e ao vivos. A metodologia declara isso (`docs/METODOLOGIA.md`, "Temporada 1"), e o site rotula cada pregão.
- **Datas internas do retroativo.** Num ciclo retroativo, a hora da decisão, o prazo, o fechamento, a liquidação e o `first_seen_at` dos
  documentos da CVM seguem o relógio do pregão simulado; a hora real está em `cycle.executed_at` e, por chamada, nas horas do pedido e da
  resposta HTTP do meta do IO bruto (`http`).
- **O Mac é ponto único de falha até a Azure.** Mac desligado na janela da decisão vira um pregão retroativo (RUNBOOK, 13.4 e 13.5), e enquanto
  o buraco existir nenhum pregão seguinte abre ao vivo.
- **A recusa pelo prompt fixado é só local.** Na Azure, o `sched-cycle` não lê o prompt (ADR 0020); o job de decisões confere o SHA-256 da
  versão do Key Vault fixada no ciclo. Levar a temporada para a Azure exige o mesmo texto no Key Vault (o SHA-256 confere).
- **O ensaio ganhou `--retroativos K`** para o site testar os rótulos; com o padrão (0) o relatório é o de sempre, byte a byte.
