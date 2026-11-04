# ADR 0027: Rotas de admin: papel em cada rota, auditoria antes da ação, reprocesso só antes do prazo e o primeiro admin pelo job

- **Status:** aceita
- **Data:** 02/11/2026
- **Origem:** `docs/PLANO.md`, §3, §9 e §16, etapa 10; `docs/ARENA.md`, seções 2, 3 e 5; `docs/CONTA.md`, seção 4; `docs/API.md`, seção 8; ADR 0015, 0021 e 0024

## Contexto

O plano pede sete rotas de admin (temporadas, reprocessar ciclo, reenviar DLQ, evento corporativo, custos e jobs) e o painel `/admin`. A api é exposta à internet, escreve no banco com o login
administrador e, pelas rotas de admin, passa a publicar no Service Bus e a reliquidar. Quatro decisões não estavam no plano.

## Decisão

1. **`@Roles('ADMIN')` em cada rota, e não na classe.** O `RolesGuard` já nega o que não tem `@Roles` (403, até para o admin). Uma anotação na classe valeria para a rota que alguém acrescentar e esquecer, e a abriria
   ao admin sem decisão. Com o papel em cada handler, a rota nova nasce fechada. O teste de integração confere os três guards (`SessionGuard`, `RolesGuard`, `ConsentGuard`, nesta ordem) e o papel em cada handler.
   A mutação exige o `Origin` do site, o que o `SessionGuard` já faz para toda rota que não é GET.
2. **A auditoria vai na mesma transação da mudança quando a mudança é só do banco, e antes da ação quando não é.** Criar, editar e iniciar a temporada gravam o `audit_log` na transação delas (se a linha falha, a
   temporada não nasce). Reprocessar o ciclo, reenviar a DLQ e registrar o evento mexem com o Service Bus ou reliquidam, o que uma transação do Postgres não cobre: a linha de intenção vai **antes**, e se não deu para
   gravá-la a ação não acontece (fecha para o lado seguro). O custo: um pedido recusado depois (400, 409) também deixa a linha, o que é um registro de quem tentou o quê. O ator é sempre `admin:<ULID da sessão>`.
3. **O reprocesso do ciclo nunca publica nos últimos 5 minutos antes do prazo das 09:30, nem depois dele, nem antes das 08:00.** Um `decide` publicado depois do prazo, ou tão perto dele que o worker só o pega depois
   (a KEDA consulta a fila a cada 30 s e o job leva um tempo para subir), gravaria HOLD `prazo`, ou seja, uma decisão depois do prazo, e o admin teria fabricado esse HOLD. A margem de 5 minutos
   (`RERUN_MARGIN_MS`) foi a revisão da parte 2 que a acrescentou: a primeira versão publicava até as 09:30:00, e o critério "nunca gera decisão depois do prazo" só valia para a publicação. Por isso o reprocesso é o caminho do
   agendador (`CycleSchedulers.rerun`) com três diferenças: confere a janela antes de tocar no banco (na margem final e depois do prazo não cria nem o ciclo), publica só para
   quem ainda não tem decisão (a decisão gravada não muda nunca, ADR 0016 e `docs/ARENA.md`, seção 3) e não varre os ciclos vencidos de outros dias (isso é do agendador e da liquidação, e o HOLD `sem_resposta` da
   varredura seguiria sendo uma decisão gerada por um pedido do admin). É idempotente pelo MessageId. Quem fecha um ciclo vencido continua sendo a varredura.
4. **O primeiro admin (e o rebaixamento) na Azure é uma execução do `job-migrate` com o modelo trocado, não um job novo.** O Postgres é privado e o `job-migrate` já tem a rede, o `database-url` e a imagem com os comandos.
   A documentação da Microsoft diz que ao trocar o modelo de uma execução ele é **substituído por inteiro**, então os flags `--command` e `--args` sozinhos (que mandam um contêiner sem imagem e sem variáveis) deixariam o
   comando sem o `DATABASE_URL`; o caminho é `az containerapp job show --query properties.template` e `az containerapp job start --yaml` (`docs/INFRA.md`, 8.6). A criação de temporada **não** passa por aí (o JSON não está na imagem):
   é a rota `POST /admin/seasons`. O nome da execução (`CONTAINER_APP_JOB_EXECUTION_NAME`) entra no detalhe da auditoria de `account:promote` e `account:demote`, o que liga a linha a quem iniciou o job.

## Outras escolhas desta parte

- **Uma temporada só em andamento.** `PATCH /admin/seasons/:id` com `{ status: 'RUNNING' }` recusa (409) se outra está em andamento: o briefing é um por pregão, e duas temporadas com regras diferentes derrubam o
  `freeze` todo dia (`docs/ARENA.md`, seção 10). O comando `season:start` não confere isso; a rota confere porque quem a usa é uma tela. **A conferência vale sob concorrência**: ela e o UPDATE são um passo só, dentro
  da transação do início e sob uma trava consultiva do Postgres (`pg_advisory_xact_lock`, a mesma técnica da liquidação por temporada, ADR 0022). A primeira versão lia as temporadas em andamento e iniciava depois, sem trava, e a
  revisão reproduziu a corrida (dois `PATCH` juntos, de rascunhos diferentes, passavam os dois em 5 de 6 tentativas e a arena parava no `freeze`); o `WHERE id AND status = 'DRAFT'` do UPDATE vale por linha e os dois
  rascunhos são duas linhas. O comando passa pela mesma trava, mas não pede a exclusividade. Um índice único parcial (uma só linha `RUNNING`) seria uma barreira ainda mais forte, mas proibiria duas temporadas com as mesmas regras,
  que o agendador e o `freeze` aceitam (e que alguns testes de integração do repositório usam).
- **O Service Bus falso é uma pasta, só fora de produção.** O e2e do painel precisa de uma DLQ, e o emulador não cabe na máquina. `SERVICEBUS_FAKE_DIR` troca o cliente do SDK (e só ele) por um que lê e escreve arquivos
  (`fake-service-bus.ts`); o `MessagingService` de verdade roda por cima. Em produção o app **recusa subir** com a variável, como faz com o `EMAIL_OUTBOX_DIR`.
- **A DLQ é lida por *peek* com o papel que a api já tem** (Receiver), no máximo 20 por fila. Contar de verdade pede a API de administração, que exige o papel de dono do Service Bus; o painel não o pede e mostra
  "indisponível" quando não consegue ler.
- **A reliquidação do evento corporativo rodava dentro da requisição**, no processo da api, sem o purge do Front Door. **Substituída na onda 3d (ADR 0028):** a api não escreve nas tabelas de resultado (papel mínimo do Postgres), então o evento só é registrado e a `settle` é publicada na fila; o worker liquida e faz o purge.

## Consequências

- **O prazo do reprocesso vale para a publicação, com 5 minutos de margem, e o fechamento é do `DecideHandler`.** A rota publica até 5 minutos antes das 09:30 (`RERUN_MARGIN_MS`; o `docs/JOBS.md` descrevia a janela como
  "enquanto o prazo das 09:30 não passou", e a revisão da parte 2 mostrou que sem margem a mensagem publicada nos últimos instantes só começaria a rodar depois do prazo: a KEDA consulta a fila a cada 30 s e o job leva um tempo
  para subir, e o `DecideHandler` gravaria uma linha HOLD `prazo` depois das 09:30, ou gastaria uma chamada paga que o prazo aborta). Com a margem, a publicação do admin não produz isso; o que sobra (a fila parada, o job que não sobe)
  é do sistema e igual ao da mensagem das 08:00, e o `DecideHandler` o fecha como HOLD `prazo` sem chamar o modelo. O critério é "a rota nunca publica na margem final nem depois do prazo", e não "nunca nasce uma linha depois das 09:30". Uma
  temporada com a janela da decisão mais curta que a margem nunca abre o reprocesso. Se a margem pedir outro número, é a constante.
- Uma rota de admin nova precisa de `@Roles('ADMIN')` própria, de uma linha de auditoria e de uma entrada na lista de rotas sem cache do `infra/tests/check.mjs` (ele lê o controlador).
- O papel do Postgres da onda 3d cobre as escritas listadas em `docs/API.md`, seção 8 (ADR 0028), e a reliquidação do evento saiu da lista.
- A api passa a receber `PROMPT_ARENA_VERSION` e `ARENA_MONTHLY_COST_CAP_USD` (texto puro; o prompt continua só no job de decisões).
- O painel lista só as 20 primeiras mensagens de cada DLQ; com mais de 20, as novas só aparecem depois que as antigas saem.
- **Não verificado na Azure:** o `job start --yaml` com o modelo trocado, o *peek* da sub-fila de dead-letter só com o papel de Receiver e a partida do worker (KEDA) até a `settle` do evento.
