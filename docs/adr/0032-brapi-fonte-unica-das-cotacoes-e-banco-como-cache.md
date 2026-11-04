# ADR 0032: A brapi como fonte única das cotações e o banco como cache

- **Status:** aceita (supera a ADR 0009)
- **Data:** 03/11/2026
- **Origem:** `docs/PLANO.md`, §5.5, §5.12, §5.15, §5.16, §7 e §16 (etapa 4); `docs/DADOS.md`, seções 1 a 8 e 10; ADR 0015 (nova tentativa agendada), 0022 (liquidação refeita do zero) e 0030 (Blob por container); pendências das ondas 2a, 2b, 3a, 3c e 3e

## Contexto

A ADR 0009 fazia do COTAHIST da B3 o preço oficial: o `eod` baixava o arquivo todo dia, e a brapi era a reserva da última tentativa, com barras provisórias que o arquivo
substituía. Em 01/11/2026 a página do arquivo disse que é "expressamente vedada a coleta automatizada, inclusive por meio de ferramentas de inteligência artificial" (`docs/DADOS.md`,
seção 10), o que alcança o job diário. As pendências das ondas 2a a 3e deixaram o resto: a reserva da brapi não era retomável (um 429 ou 5xx num papel refazia os uns 290 pedidos, até 10 entregas, numa
cota pequena), não havia limiar de cobertura para o dia vindo da reserva, e o universo de domingo falhava quando uma sexta ficava na reserva.

Em 03/11/2026 o Artur escolheu a brapi ("da 15k de requests gratis por mês") e perguntou se podia registrar as respostas no banco para não repetir as requisições. O plano gratuito (preços de 03/11/2026)
dá **15 mil requisições numa janela móvel de 30 dias** (o FAQ de limites fala em ciclo mensal que reinicia na data de renovação; a resposta da API diz `X-RateLimit-Window: rolling-30d`, e vale a da API: prova controlada de 04/11/2026, abaixo), **1 ação por requisição**, **1 requisição por vez** na conta, histórico de **3 meses** (na prática, no máximo 90 dias por pedido) e atualização a cada 30 minutos. A licença (FAQ, "O que a licença de
uso permite") deixa, dentro do produto, "guardar em cache, persistir e montar séries históricas, gráficos e tabelas", "exibir os dados para os seus usuários" e "calcular e publicar indicadores derivados", e
proíbe "entregar os Dados a terceiros como feed, API ou base bruta". O mesmo FAQ diz que a brapi não é distribuidora nem redistribuidora licenciada da B3.

## Decisão

1. **A brapi é a fonte única das cotações dos jobs, e o COTAHIST saiu**: o download, o parser, o arquivo dos ZIPs (o container `cotahist` do Blob e o papel dele na infra), a carga por arquivo e as entradas de CI,
   `.dockerignore` e `.gitignore` que só serviam a ele. Com uma fonte só, saem também a **reserva**, a **barra provisória** e a troca da barra da brapi pela do arquivo (`replaceProvisionalDays`, `datesWithBrapiBars` e o
   `reopen`). O que outros módulos reusavam foi para lugares neutros (`infrastructure/storage/blob-client.ts`, `infrastructure/zip/`, `domain/instruments.ts`). O `b3-holidays.json` fica: datas de feriado são fato e
   nada o baixa; a origem e a atualização anual estão no RUNBOOK.
2. **O banco é o cache, e a barra gravada nunca muda.** Cada barra é pedida uma vez; só a falta vai à brapi. A gravação é só inserção (`INSERT ... ON CONFLICT DO NOTHING`), de qualquer fonte (as barras COTAHIST do dev também
   não são tocadas). Uma nova busca com valor diferente do gravado registra o sinal `barras-divergentes` (papel, data e campos) e não muda nada; correção de dado é pelo evento corporativo do admin. O **volume financeiro é
   estimado** (quantidade × fechamento), porque a brapi informa a quantidade.
3. **O que se pede.** O **obrigatório** é o universo da semana ISO do pregão D, o BOVA11 e os papéis em posição de competidor de temporada `RUNNING`; o **opcional** são os papéis das carteiras dos usuários fora do obrigatório.
   Cada papel só é pedido se faltar barra de D, e o pedido começa no pregão **mais antigo que lhe falta** nos **5 últimos pregões** até D (pedir 1 dia ou 5 custa a mesma requisição, e o dia que falhou é recuperado
   na noite seguinte). A falta sai do banco, então nova entrega ou nova tentativa pede só ela. O BOVA11 vai primeiro e é a sonda de "o dia saiu": sem a barra dele, a passada acaba com uma requisição.
4. **Conclusão.** D está completo quando todo papel do obrigatório tem a barra de D; senão o `eod` se reagenda em +60 min (ADR 0015) até 00:30 de Brasília, e aí conclui com o que tem, registra a falta (contagem e os
   20 primeiros) e dispara o `eod-barras-ausentes` se faltar o BOVA11 ou mais de 10% do obrigatório. O opcional é pedido **uma vez**, na tentativa que conclui, e não segura a conclusão. Concluído, o dia é
   confirmado como `trading_day.source = BRAPI` (valor novo do enum, migration aditiva; `COTAHIST` e a coluna `cotahist_sha256` ficam como legado do dev, sem nada novo gravando) e o `afterEod` liquida o pregão e
   os anteriores da janela que acabam de ser confirmados (a noite em que a brapi esteve fora), em ordem de data.
5. **O que já foi liquidado não muda sozinho.** Barra que chega atrasada para um pregão já confirmado é gravada, mas o `eod` não reabre a liquidação; a liquidação é refeita do zero a cada vez (ADR 0022), então a barra
   entra no resultado na próxima liquidação regular, e reprocessar antes disso é decisão do admin (RUNBOOK).
6. **A cota e os erros.** O cliente lê o `RateLimit-Remaining` de toda resposta do histórico (a lista tem outro limitador, de 20 por minuto, e não entra na conta) e **para antes de a cota restante cair abaixo de uma reserva de 500 requisições**, registrando o sinal `brapi-cota-baixa` e deixando o resto
   como falta. 429 respeita o `Retry-After` (teto de 30 s) e repete só aquele papel, até 3 vezes; 5xx e timeout repetem aquele papel uma vez; 401, 402 e 403 encerram a busca como erro de configuração (`job_run` `FAILED`,
   alerta `job-falhou`, o corpo da resposta nunca é lido); JSON fora do formato é falta daquele papel, com aviso; 5 papéis seguidos sem resposta são a brapi fora do ar, e a passada para. Falha num papel **nunca
   refaz a lista**: cada papel é gravado assim que chega. O token vai só no `Authorization`.
7. **Uma requisição por vez na conta inteira**, entre as réplicas do worker-data, o `universe` e a carga manual: **trava consultiva de transação do Postgres** (`pg_advisory_xact_lock`), segurada do envio à leitura do
   corpo. Sem coordenador novo e sem tabela: o Postgres já está no caminho de todo job.
8. **Atualização semanal dentro do `universe`** (domingo 09:00, antes de ele escolher): a lista de ações da brapi semeia papel novo em `instrument` (ISIN nulo; a classe ON, PN ou UNT pelo sufixo do código e pelo tipo da
   brapi), o papel novo recebe 3 meses, e o candidato fora do conjunto diário recebe a semana. O universo continua congelado por semana e sai das barras da brapi (volume estimado).
9. **A carga inicial é o `market:backfill`**: 3 meses de todo papel da lista mais o BOVA11 (377 pedidos num banco novo, medidos na prova controlada; 434 no dev, no modo sem rede), só inserção e retomável, com um modo sem rede que mostra o banco de destino e as requisições que faria,
   e uma confirmação explícita para buscar de verdade. Não publica `settle`.
10. **A conta da cota** (`docs/DADOS.md`, seção 6) dá uns 7.900 pedidos por mês (e de 8.300 a 8.400 no primeiro, com a carga inicial) de 15.000, e um teste monta o mês sintético e falha acima de 9.000.

## Consequências

- Nenhum job baixa nada da B3. A licença da brapi cobre o que o produto faz com o dado (guardar, exibir, derivar). **A API pública de hoje entrega barra bruta, o que a licença proíbe**: a parte 2 da onda a fecha (o site
  lê as cotações por uma rota interna com segredo do servidor, e o rodapé credita "Cotações: brapi.dev"). **Fechado na parte 2 em 03/11/2026: [ADR 0033](0033-api-publica-sem-cotacao-bruta-e-rota-interna-para-o-site.md).** O item do checklist do plano (§5.16) segue com o Artur e o orientador.
- A brapi não é distribuidora licenciada da B3 e não oferece contrato nem SLA: serve a um TCC, não a um produto com compliance de market data (`docs/DADOS.md`, seção 2).
- O dia só conclui com o obrigatório inteiro ou às 00:30. Um papel suspenso ou sem negócio mantém as novas tentativas até o prazo, e só ele é pedido; numa noite assim a liquidação sai às 00:30 e não às 21:40.
- O preço da brapi pode vir ajustado por proventos em intervalos diários. A barra gravada é a **capturada na noite do pregão** e nunca muda depois; o histórico de papel novo vem como a brapi o serve hoje, talvez ajustado.
  **Medido na prova controlada:** o OHLC não vem ajustado por provento (o `close` difere do `adjustedClose` em 30 das 60 barras da WEGE3); desdobramento e grupamento não foram medidos. O cliente registra (papel e quantidade, nunca preço) as barras
  com fechamento diferente do ajustado. A divergência vira sinal, e um desdobramento dentro da janela carregada depois do evento exige conferir a série antes de registrar o evento do admin (RUNBOOK).
- Os sinais novos (`brapi-cota-baixa`, `barras-divergentes`) entram no `ALERT_LOG`, na regra de log do `alerts.bicep` e no INFRA, seção 5.3. O `eod-barras-ausentes` passa a sair da regra de conclusão. O alerta de
  barra BRAPI por mais de 2 pregões, pendência das ondas 2a e 3b, deixa de existir: não há mais barra provisória.
- O `.data/b3` e as barras `COTAHIST` do dev **não foram apagados**: o Artur decide (`docs/DADOS.md`, seção 1). O universo conta barra de qualquer origem.
- O ensaio da Temporada 0 serve o mercado sintético por uma brapi falsa (`fetch` injetado, no formato dos docs), com os mesmos horários de publicação, e conta as requisições por pregão.

## Alternativas consideradas

- **Manter o COTAHIST:** descartado. Os termos da B3 vedam a coleta automatizada, inclusive por IA, e o job diário é exatamente isso.
- **A brapi sem persistir** (pedir de novo a cada vez): descartado. 15 mil requisições por mês não dão para uns 310 papéis por pregão sem cache: o banco é o cache, e a licença o permite.
- **Sobrescrever a barra** (upsert) para acompanhar ajuste de provento: descartado. O que foi liquidado não pode mudar por uma busca, e dois valores para o mesmo pregão precisam de um humano; o sinal
  `barras-divergentes` e o evento corporativo do admin cobrem.
- **Plano pago** (Startup, R$ 99,99/mês, 10 papéis por requisição): fica como saída se a cota apertar; o custo do plano gratuito é zero e a conta cabe.
- **Concluir o dia quando só o BOVA11 respondeu:** descartado. O obrigatório inteiro, ou o prazo das 00:30, evita liquidar uma temporada com metade das marcações; o `eod-barras-ausentes` diz quando o buraco passa de 10%.
- **Um job semanal próprio da atualização:** descartado. O mínimo que funciona é rodá-la dentro do `universe`, antes de ele escolher (a falha dela nunca derruba o universo).
- **Trava de sessão do Postgres (`pg_advisory_lock`):** descartada. A de transação solta sozinha no commit, no rollback ou se o processo cair, sem `unlock` para esquecer.

## Fechamento da parte 1 (revisão de 03/11/2026)

Duas revisões independentes (banco e TypeScript) acharam três problemas que valem registro, e o resto entrou no código e em `docs/DADOS.md`:

- **Consulta quadrática (corrigida).** O `heldTickers` relia a temporada inteira a cada posição (subconsulta correlacionada): com 20 mil posições passava do `statement_timeout` de 60 s do worker, e o `eod` falharia toda
  noite. Agora o `max(date)` sai uma vez por temporada (`LATERAL`), e um teste de integração com 20 mil posições falha se passar de 1 s.
- **O orçamento de tempo vale dentro do papel e para a lista (corrigido).** A trava da fila `market` é renovada por 5 minutos; o orçamento de 4 só era conferido entre papéis, e a espera do 429, a pausa do 5xx e a
  lista ficavam de fora (uns 165 s no pior caso de um papel só). Agora todo prazo é absoluto (início + orçamento), a espera da trava entra na conta e a atualização semanal divide o orçamento entre a lista e as barras.
- **A data da barra era suposição (guardada, e depois confirmada).** A doc diz só "Data do pregão em Unix timestamp, em segundos". O cliente aceita a meia-noite de Brasília e descarta com aviso o que tem outra forma (a resposta inteira
  falha se nenhuma barra a tem), porque `daily_bar` é só inserção e um dia errado ficaria para sempre. A prova controlada de 04/11/2026 confirmou a forma (03:00 UTC nas 77 barras).

Decisões menores, com o motivo:

- **A carga manual só confirma o pregão quando é completa** (sem `--papeis`, sem parada, com o BOVA11 e no máximo 10% dos papéis sem resposta): um pregão confirmado com a barra de poucos papéis deixaria o universo,
  que é congelado, passar na conferência da janela com buraco.
- **A atualização semanal decide pelo banco:** o papel sem nenhuma barra nos 3 meses recebe o histórico inteiro, seja novo ou o que a carga da semana anterior não trouxe.
- **O `historyStart` ganha 3 dias de folga** sobre os 3 meses de calendário: três meses de calendário vão de 89 a 92 dias, e o teto medido é de 90 dias por pedido (a doc não dizia se o limite era de 3 meses ou de 90 dias); com a folga o pedido fica em 86 a 89 dias, e o fake recusa mais de 90.
- **O 400 e o 404 só contam para a queda enquanto nenhum papel respondeu bem na passada** (a janela ou o plano recusando tudo); depois disso são do papel. `changed = true` (ticker trocado) e preço ou volume fora da escala
  viram falta do papel ou do dia, nunca um `INSERT` que estoura.
- **A lista continua no `/api/quote/list` (v1)** com `limit=1000`: a doc manda usar o `/api/v2/tickers` nas integrações novas, mas diz que o v1 "continua ativo e sem data de remoção" e o `subType` que semeia a unit
  está documentado nele. A prova controlada confirmou o `limit=1000` (785 ações em uma página, `hasNextPage` falso) e o `subType` (`stock` ou `unit`, nunca nulo); trocar de endpoint é uma função (`listStocks`) e um fixture.
- **Limite conhecido da divergência:** o sinal `barras-divergentes` vem de uma leitura antes do `INSERT ... ON CONFLICT DO NOTHING`; com duas gravações simultâneas da mesma barra com valores diferentes, a que perde a
  corrida não vê a linha da vencedora e o sinal pode faltar (o dado não se perde nem duplica; medido com 200 pares). Só a carga manual durante a noite abre a janela, e o RUNBOOK a proíbe nesse horário.
- **Risco residual aceito: a trava consultiva da brapi não exige privilégio.** O login `alvesting_api` (menor privilégio) também toma `pg_advisory_xact_lock(hashtextextended('brapi', 0))`; um RCE na api poderia segurá-la e
  parar a coleta. É a mesma classe da negação de serviço por `LOCK TABLE` que o INFRA, 2.2, item (b), já aceita; não dá para revogar o `EXECUTE`, porque o gatilho `portfolio_lot_api_guard` e o início de temporada usam
  trava consultiva com o mesmo login.

## Prova controlada (04/11/2026)

A única chamada real à brapi da onda: 10 requisições, num banco descartável, pelo código de verdade (`docs/DADOS.md`, seção 9, tem a tabela). Decidiu o que a doc deixava em aberto, e **corrigiu três coisas**:

- **A cota é uma janela móvel de 30 dias** (`X-RateLimit-Window: rolling-30d`), e não o ciclo mensal que o FAQ descrevia e que o fechamento da parte 1 tinha adotado. A decisão de 15 mil por 30 dias, a reserva de 500 e a conta de 7.919 por mês valem como estavam.
- **O limite do histórico é o tamanho do pedido, não a idade do início:** no máximo 90 dias entre `startDate` e `endDate`, com 400 `DATE_WINDOW_EXCEEDED` acima (a doc de erros chamava de `INVALID_RANGE`). O `historyStart` (86 a 89 dias) continua certo; a justificativa e o fake mudaram.
- **A resposta da lista traz o limitador dela** (`RateLimit-Remaining` 20, de 20 por minuto, fora da cota), e o cliente a lia como a cota: uma lista de mais de uma página pararia por "cota baixa" (reserva 500). Corrigido: só a resposta do histórico alimenta a cota restante.

Confirmadas: a forma da data (03:00 UTC), o `limit=1000` da lista (785 ações em uma página), a latência (265 ms em média; 310 papéis em uns 82 s), os cabeçalhos de cota e o 404 `NOT_FOUND` do papel desconhecido (nenhum dos erros gasta cota). Medido: o OHLC não vem ajustado por provento. **Em aberto:** o 429, o 5xx, o papel suspenso, desdobramento e grupamento, o horário em que a barra de D passa a existir e o limite exato de 89 ou 90 dias. As decisões da ADR não mudaram.
