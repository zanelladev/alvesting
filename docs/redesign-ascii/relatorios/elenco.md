# Relatório da tarefa T1 (elenco): os seis LLMs da Temporada 1 na arena simulada

Tarefa `task_b5ab04f0b365`, onda "design ASCII + elenco" (Run `run_ee238b5b17cc`), 04/11/2026. Não há commit nem nada no índice: o
trabalho está só no working tree (`git diff`). As 44 mudanças da onda anterior continuam staged, sem nenhuma alteração. O `docs/ENSAIO.md`
aparece como `MM` porque a minha mudança está por cima da que já estava staged.

## 1. O que foi feito

**O elenco.** A temporada sintética (`apps/api/seasons/ensaio.json`, a da demo local, do `arena:ensaio` e da semente do e2e) troca os
quatro fake (Fake Momentum, Fake Contrarian, Fake Hold e Fake Flaky) pelos seis modelos do rascunho da Temporada 1, com **os mesmos nomes e
slugs**. O `season-files.spec.ts` compara o elenco com o `temporada-1.rascunho.json`, que não mudou. Cada modelo tem provider `fake` e uma
estratégia própria. O Sorteio e as três referências ficam como estavam.

| Modelo (slug) | Estratégia simulada | O que faz |
| --- | --- | --- |
| Claude Opus 5.5 (`claude-opus-5-5`) | `fake/momentum` | compra as duas maiores altas do último pregão (10% cada) e vende o que está abaixo do custo |
| GPT-6.1 Sol (`gpt-6-1-sol`) | `fake/contrarian` | compra as duas maiores quedas (10% cada) e realiza o que ganhou 2% ou mais |
| Gemini 4 Argon (`gemini-4-argon`) | `fake/hold-only` | só segura (rende como o CDI) |
| Grok 4.7 (`grok-4-7`) | `fake/hash-picks` | escolhas pelo SHA-256 de modelo e pregão: o padrão do fake, que era o do `fake/flaky-json` sem a falha |
| DeepSeek V4 Pro (0813) (`deepseek-v4-pro`) | `fake/momentum-focused` | **novo**: o momentum concentrado, só a maior alta, com 20% |
| Qwen3.8 Max (0902) (`qwen3-8-max`) | `fake/contrarian-spread` | **novo**: o contrário espalhado, as três maiores quedas, com 5% cada |

A distribuição segue a ordem do rascunho: as quatro estratégias que o ensaio já tinha ficaram nas quatro primeiras posições, e as duas
variantes novas nas duas últimas. A ordem não diz nada sobre o modelo de verdade; o ENSAIO.md (seção 3) registra isso.

**O provedor fake** (`apps/api/src/modules/arena/infrastructure/fake-llm.ts`). O momentum e o contrário viraram uma tabela de quatro
estratégias de tendência (`TRENDS`: o sinal, quantas ações compra e quanto do patrimônio põe em cada uma). O texto e as decisões do
momentum e do contrário saem byte a byte iguais aos de antes. O `fake/flaky-json` ficou sem uso e saiu. As falhas dos testes
(`always-fail`, `invalid-json-*`, `echo-prompt`) continuam, sempre com IDs de teste.

**Nenhuma marca falha.** O ensaio não injeta mais a falha passageira do provedor (era no `fake/contrarian`, hoje o GPT-6.1 Sol) e nenhum
modelo precisa de reparo. Por isso saíram:

- as verificações `reparo` e `nova-tentativa` do relatório (de 19 para 17);
- a exceção do driver que deixava as linhas de alerta (job falho, HOLD forçado, barras ausentes) fora da contagem. Sem falha injetada,
  essas linhas seriam erro de verdade, e agora contam.

O teste do ensaio passou a exigir zero nova tentativa, zero aviso ou erro dos handlers e uma chamada por decisão. O reparo e a nova
tentativa continuam provados onde já eram, com IDs de teste: `decide.handler.integration.spec.ts`, `arena-cycle.integration.spec.ts`,
`bus.spec.ts` e `bus-parity.spec.ts`, todos verdes no `pnpm check`. Um teste novo do `fake-llm.spec.ts` lê o `ensaio.json` e confere que
cada um dos seis responde JSON válido de primeira, em dia par e ímpar, com e sem carteira.

**A tela** (no estilo de hoje, sem restilizar). `apps/web/src/components/ui.tsx` ganhou duas peças:

- `isSimulated(competitor)`: o competidor é `MODEL` com `provider === 'fake'`;
- `SimulatedTag`: a palavra "simulado" numa borda tracejada como a do HOLD, fora do link do nome e com o espaço antes, para o leitor de
  tela ler "GPT-6.1 Sol simulado".

Onde a etiqueta aparece:

- no ranking da home e no `/ranking`;
- nos cartões de decisão do feed da home e da página do ciclo;
- no título da página do modelo, que também troca "Modelo (ID)" por "Estratégia simulada" e diz "Decisões simuladas: o modelo ainda não
  está conectado";
- na página da ação, em quem tem a ação e nas decisões sobre ela.

A home mostra, logo depois da apresentação, **"Decisões simuladas: os modelos ainda não estão conectados."**, enquanto algum competidor
exibido (no ranking ou no feed) for modelo de provedor `fake`. O contrato não mudou: a API pública já devolvia `provider` e `modelId`.

**O oráculo do ensaio.** O novo SHA-256 é `081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12` (22.068 bytes), o mesmo nas
duas execuções.

- O ENSAIO.md (seções 2, 3, 5 e 6, e a nova 6.2) traz o elenco, as estratégias, por que nenhuma marca falha, onde estão as provas do
  reparo e da nova tentativa, o relatório novo e o diff contra o anterior.
- O ARENA.md (seções 1 e 8, e as linhas do provedor fake nas seções 7 e 10) diz que o elenco aparece simulado até a integração e que, no
  dia, o provider vira `openrouter` e a etiqueta e o aviso somem sozinhos.

## 2. Critérios de aceite, com a evidência

Ambiente de todas as execuções: Node 26.13 (`nvm use`), az falso no `PATH` e guarda de rede
(`NODE_OPTIONS="--import .data/guardas/net-guard.mjs"`, `NET_GUARD_LOG=.data/guardas/elenco-rede.log`). Os bancos foram
`TEST_DATABASE_URL=.../alvesting_elenco_test` e `ENSAIO_DATABASE_URL=.../alvesting_elenco_ensaio`, com o Azurite do compose. Cada execução
pesada tomou a trava `.data/trava-pesada`.

1. **`git grep -n -i -E "fake (momentum|contrarian|hold|flaky)" -- apps packages` sem resultado.** Saída vazia, exit 1.
2. **`pnpm check` com exit 0.** Exit 0 em 342 s:
   - lint, tipos e `docs:check` (73 itens);
   - api: 151 arquivos verdes e 2 pulados por condição, que já eram pulados antes (o `messaging.integration.spec.ts` pede o emulador do
     Service Bus; o `cvm-real-files.spec.ts` pede os arquivos reais da CVM); 2.989 testes verdes e 9 pulados;
   - web: 32 arquivos, 559 testes; contracts: 13 arquivos, 491 testes; os `scripts/*.test.mjs` passaram.

   O vitest da api rodou com a guarda ativa (conferido no ambiente do worker). O log da guarda terminou vazio (0 bytes, também depois do
   ensaio e do e2e), e o `.data/guardas/az-stub/calls.log` continua com 0 linhas.
3. **`pnpm build` com exit 0 e e2e verde em pixel-7, iphone-15 e desktop.** Na 4ª rodada, `pnpm build` deu exit 0 (build completo, cache
   miss nas 4 tarefas do turbo) e `pnpm test:e2e -- --workers=2` deu exit 0: 1.114 passaram e 5 foram pulados, em 7,3 min. Os pulados são
   os de sempre: o teclado da carteira no pixel-7 e no iphone-15, e o login do smoke (`@api`) nos três projetos.

   Os testes novos passaram nos três projetos:
   - `arena simulada › a home avisa que as decisões são simuladas, e o ranking traz os seis do elenco, cada um com a etiqueta`;
   - `arena simulada › o ranking completo marca só os modelos`;
   - `modelo › ...`, agora conferindo a etiqueta, a "Estratégia simulada" e o aviso.

   Os testes que já existiam ganharam a etiqueta nas comparações por igualdade: ranking, feed, ciclo e a página da ação.

   As rodadas anteriores, e por que falharam:

   | Rodada | Resultado | Falhas e causa |
   | --- | --- | --- |
   | 1ª (`--workers=3`) | 1.110 ok, 4 falhas | 3 eram bug do meu teste do modelo, já corrigido: `page.locator('header')` casava 7 cabeçalhos (strict mode). 1 foi a exclusão de conta no pixel-7: a senha errada ainda estava sendo conferida quando os 5 s acabaram (o campo estava `[disabled]`), com a máquina carregada |
   | 2ª (`--workers=3`) | 1.111 ok, 3 falhas | O Azurite foi morto por falta de memória (`OOMKilled=true`, exit 137) às 15:46:57, no meio da rodada (a VM do Docker tem 1,8 GB; o swap do Mac estava em 21 de 22,5 GB). A carteira no desktop pegou `net::ERR_NETWORK_CHANGED` quando o container caiu. Os filtros BUY e SELL do feed no iphone-15 tiveram uma navegação acima de 5 s na mesma janela (os três testes do feed no iphone-15 levaram de 8 a 10 s, contra 1,8 a 5,3 s na 1ª rodada) |
   | 3ª | não começou | o Azurite estava fora |
   | 4ª (`--workers=2`) | **1.114 ok, 0 falha** | com o aval do coordenador: `docker start alvesting-azurite-1` (o Postgres seguiu de pé) e 2 workers, para aliviar a VM. O disco não desceu de 5,8 GB livres (vigiado a cada 20 s) |

   Todo teste que falhou na 1ª ou na 2ª rodada passou na 4ª, nos três projetos.
4. **`arena:ensaio` duas vezes no `alvesting_elenco_ensaio`, com o mesmo SHA-256, registrado no ENSAIO.md.** As duas execuções deram exit
   0 e 17 de 17 verificações. O relatório tem o SHA-256 `081d860b…` (22.068 bytes) e o `.json` tem o `93c5d8ab…`, iguais nas duas. Antes
   da mudança, o ensaio no código antigo deu `e3138a55…` (17.528 bytes), o SHA que o ENSAIO.md documentava. O registro está no ENSAIO.md,
   seções 6 e 6.2.
5. **Relatório e `worker_done`.** Este arquivo, e o `worker_done` com `--report-path` apontando para ele.

## 3. Desvios e decisões

1. **O SHA "anterior" da tarefa estava uma onda atrás.** A tarefa citou `b45047f8…`, mas esse é o de antes da brapi. O relatório vigente
   era `e3138a55…` (ENSAIO.md, seção 6.1), e o ensaio no código antigo reproduziu esse SHA. Comparei contra ele e registrei a sequência
   `b45047f8…` → `e3138a55…` → `081d860b…`. O diff, com os slugs trocados e os espaços normalizados, mostra que não mudam:
   - os briefings, o prompt e a brapi falsa;
   - o Sorteio, as referências e o Monte Carlo;
   - as decisões, ordens, carteiras e percentis das três estratégias que ficaram, centavo a centavo.
2. **O e2e final rodou com `--workers=2`**, e não com 3 como dizia o aceite: foi instrução do coordenador depois que o Azurite morreu por
   falta de memória na VM do Docker.
3. **A página do ciclo marca pela resposta, não pelo competidor.** No contrato do ciclo (`cycle.ts`, `decisionView.competitor`) o
   competidor só traz `id`, `slug` e `name`. Para não mexer no contrato, a etiqueta usa `applied.provider === 'fake'`, o provedor que
   respondeu a decisão. Fica sem etiqueta só o HOLD forçado sem chamada (`applied` nulo), que não existe na temporada sintética.
4. **O aviso da home depende do que a home mostra.** Nenhuma rota pública lista o elenco antes da primeira liquidação. Então o aviso
   aparece quando algum competidor do ranking (a temporada inteira) ou do feed é modelo `fake`. Antes da primeira decisão de uma temporada
   fake não há nada simulado na tela, e o aviso também não aparece.
5. **A etiqueta foi também para a página da ação** (quem tem a ação e as decisões sobre ela), que não estava na lista da tarefa, porque o
   nome do modelo aparece lá. **A legenda do gráfico de patrimônio ficou sem etiqueta** (na home e na página do modelo): o aviso da home
   cobre esse caso, e o redesign decide.
6. **Saíram do código, além do pedido, o `fake/flaky-json` e a exceção das linhas de alerta no driver do ensaio.** Os dois só existiam por
   causa das falhas injetadas, que a tarefa tirou das marcas. A troca está registrada no ENSAIO.md (seções 3 e 6.2).
7. **O limite de 10 posições aparece no ensaio de 5 pregões.** A estratégia espalhada do Qwen chega a 10 posições no último pregão. A
   validação descarta uma compra (`max_positions`), e a liquidação recusa outra, porque a venda do PAUS3 (suspenso) não liberou a vaga.
   Antes, isso só aparecia nas execuções longas. Corrigi o comentário do e2e que dizia "sem item descartado"; nenhum teste dependia disso.
8. **O feed ficou mais longo para o e2e.** São 30 decisões em vez de 20, e o filtro BUY agora percorre 5 páginas (eram 3), o SELL 3 (eram
   2) e o HOLD 1 (eram 2). Há mais navegações por teste, e numa máquina carregada uma delas passou de 5 s no WebKit (2ª rodada). No CI os
   prazos dobram; a asserção não foi afrouxada.
9. **O `pnpm build` rodou sem a guarda de rede.** É a exceção das regras: o `next/font` baixa as fontes no build. O `pnpm check`, o ensaio
   e o e2e rodaram com a guarda.
10. **O Lighthouse ficou para a T2**, por decisão do coordenador. A T2 refaz a home inteira e tem o Lighthouse no aceite dela. Esta tarefa
    só acrescentou à home um parágrafo de aviso, com texto renderizado no servidor, sem JS e sem imagem.

## 4. O que ficou para depois

- **A demo (4300/4310) ainda mostra o elenco antigo.** O banco `alvesting_ensaio` não podia ser recriado. A etiqueta e o aviso já
  aparecem lá, porque os quatro antigos também são `fake`. Para ver os seis nomes na demo, é preciso rodar o `arena:ensaio` no
  `alvesting_ensaio`, o que é decisão do Artur ou do coordenador. A api da demo se recompilou e reiniciou sozinha (`nest start --watch`) a
  cada arquivo salvo em `apps/api/src`; não parei nem reiniciei nada à mão, e ela respondeu `ok` no fim.
- **`docs/TELAS.md`** está fora da minha lista de arquivos e não diz nada da etiqueta nem do aviso. Cabe uma linha lá, agora ou no redesign.
- **O redesign tem de manter:**
  - `isSimulated` e `SimulatedTag`, ou o equivalente;
  - o texto do aviso da home e o termo "Estratégia simulada";
  - os testes `arena simulada` e a parte nova do teste `modelo` (`apps/web/e2e/arena.spec.ts`);
  - os ajudantes `CAST`, `SIMULATED`, `isSimulated` e `shownName` (`apps/web/e2e/data.ts`);
  - os unitários de `components.spec.tsx`.
- **Lighthouse da home**: fica com a T2 (item 10 da seção 3).
- `apps/api/seasons/temporada-0.json`, a Temporada 0 de produção, continua com "Fake Anthropic", "Fake OpenAI" e os outros. Não estava no
  escopo e não casa com o grep do aceite.
- Toda execução do ensaio esvazia os containers `ensaio-*` do Azurite, inclusive os arquivos que a demo tinha gravado: vale para a minha,
  a do e2e e a do teste de integração. Já era assim, e as telas públicas não leem o Blob. O `alvesting_recreate_test` (criado com nome fixo
  pelo `database-admin.spec.ts` em qualquer rodada da suíte) também já existia e ficou.

Limpeza feita: apaguei os bancos `alvesting_elenco_test` e `alvesting_elenco_ensaio`, soltei a trava, encerrei o vigia de disco e não
deixei nenhum servidor do e2e de pé. O `.data/ensaio/relatorio-s1-p5.*` ficou com o relatório novo (o ensaio sempre grava ali).

## 5. Arquivos tocados

Só no working tree, nada staged:

- `apps/api/seasons/ensaio.json`
- `apps/api/src/ensaio/driver.ts`
- `apps/api/src/ensaio/ensaio.integration.spec.ts`
- `apps/api/src/ensaio/report.ts`
- `apps/api/src/ensaio/world.ts`
- `apps/api/src/modules/arena/domain/season-files.spec.ts`
- `apps/api/src/modules/arena/infrastructure/fake-llm.spec.ts`
- `apps/api/src/modules/arena/infrastructure/fake-llm.ts`
- `apps/api/src/modules/public/presentation/public-api.integration.spec.ts`
- `apps/web/e2e/arena.spec.ts`
- `apps/web/e2e/data.ts`
- `apps/web/e2e/public-api.spec.ts`
- `apps/web/e2e/quotes.spec.ts`
- `apps/web/src/app/acoes/[ticker]/page.tsx`
- `apps/web/src/app/ciclos/[data]/page.tsx`
- `apps/web/src/app/modelos/[slug]/page.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/components/components.spec.tsx`
- `apps/web/src/components/decisions.tsx`
- `apps/web/src/components/tables.tsx`
- `apps/web/src/components/ui.tsx`
- `apps/web/src/lib/api.spec.ts`
- `apps/web/src/lib/safe-path.spec.ts`
- `docs/ARENA.md`
- `docs/ENSAIO.md`
- `docs/redesign-ascii/relatorios/elenco.md` (este relatório)

Fora do git: `.data/ensaio/relatorio-s1-p5.txt` e `.json` (saída do ensaio) e `.data/guardas/elenco-rede.log` (vazio). O container
`alvesting-azurite-1` foi religado com `docker start`, com o aval do coordenador.
