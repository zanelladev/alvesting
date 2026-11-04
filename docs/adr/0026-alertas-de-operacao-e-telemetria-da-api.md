# ADR 0026: Alertas de operação e telemetria da api: o que o plano pedia e o que o Azure Monitor deixa fazer

- **Status:** aceita
- **Data:** 02/11/2026
- **Origem:** `docs/PLANO.md`, §5.9 e §16, etapa 10; ADR 0021 (a DLQ vira HOLD); `docs/INFRA.md`, seção 5; `docs/JOBS.md`, seção 7

## Contexto

O §5.9 do plano pede o OpenTelemetry da api para o Application Insights e uma lista de alertas. Ao implementar, três pedidos não cabem no Azure Monitor
como estão escritos, e a lista cresceu com o que as etapas 6, 7 e 11 deixaram para a 10 (job falho, filtro de vazamento, HOLD por falha, e-mail da conta, aceite).

1. "Fila `decisions` com mensagens às 09:35": o alerta de métrica não tem horário do dia.
2. Oito sinais da aplicação como oito alertas de log custariam uns US$ 12 por mês (US$ 1,50 por regra a cada 5 minutos), mais que a conta de observabilidade inteira do
   perfil econômico (`docs/PLANO.md`, 5.12).
3. O `eod` que espera o arquivo do pregão ficava `FAILED` com o texto "ainda não publicado", e o alerta de job falho teria de filtrar por texto.

A api é ESM. A documentação da distribuição da Azure (`@azure/monitor-opentelemetry`, "ESM Support") manda registrar o gancho de módulo antes de qualquer biblioteca instrumentada.

## Decisão

1. **A telemetria liga por `--import ./dist/telemetry/preload.js` no `NODE_OPTIONS` da imagem**, e não por um `import` no topo de cada ponto de entrada (o ESM carrega o grafo inteiro
   antes de executar a primeira linha) nem por um comando novo em cada app e job do Bicep. O arquivo só faz algo com `APPLICATIONINSIGHTS_CONNECTION_STRING` e só nos quatro papéis.
   Um sanitizador de spans em lista branca roda dentro do SDK, antes do exportador (`docs/INFRA.md`, 5.1). O site fica fora.
2. **"Fila `decisions` com mensagens às 09:35" vira "a fila não esvaziou em 15 minutos"** (`ActiveMessages` mínimo > 0 em janela de 15 minutos). Depois do prazo das 09:30 uma execução grava o HOLD `prazo` em segundos e conclui a mensagem,
   então mensagem ativa às 09:35 é sempre ciclo travado, e um alerta que só vale depois de 15 minutos de fila não vazia cobre isso e dispara antes (por volta das 08:20) se a fila travar na abertura do ciclo. A primeira versão era de 5 minutos e
   a revisão de 02/11/2026 a derrubou: uma mensagem em processamento segue ativa, o job tem até 25 minutos (`replicaTimeout`), e uma chamada legítima de modelo de raciocínio passa de 5, então o alerta abriria quase todo dia útil às 08:06, no
   alerta que existe para o ciclo travado, e o operador aprenderia a ignorá-lo. **É a única exceção ao "em até 10 minutos"**: detecta em 20 (1 de frequência + 15 de janela + 4 de latência), e o `check.mjs` carrega a exceção declarada
   (`maxMinutes`). Ainda falsa-alarma com uma chamada legítima de mais de 15 minutos; se a primeira semana da Temporada 1 mostrar isso, a janela sobe para `PT30M` (detecta em 35, ainda 55 minutos antes do prazo).
3. **Os oito sinais da aplicação (nove desde a onda 3d, com o `ciclo-pulado`) ficam numa regra de log só**, com a dimensão `sinal` (um alerta e um e-mail por sinal, cerca de US$ 0,15 cada a mais). A linha de log de cada
   sinal é uma constante (`apps/api/src/telemetry/alert-logs.ts`) que o código e o Bicep dividem, conferida por teste. Dois não têm linha própria. `news-seguranca` é a
   `job_run falhou` da fila `news` cujo motivo traz um trecho de `NEWS_SECURITY_MARKERS` (DTD no feed, host fora da lista fixa, resposta ou ZIP que passa do teto ou não bate com o que declara,
   arquivo da CVM que mudou de formato): alerta na primeira vez, enquanto a queda de rede só alerta da 3ª tentativa. A fila não tem código de erro, então a ligação é o texto da mensagem;
   o spec força cada falha com o código de verdade, e uma mensagem que mudar sem a lista reprova. `api-5xx` é a razão de respostas 5xx nas linhas de requisição da api (`res.statusCode`, do pino-http)
   nos últimos 10 minutos.
4. **O 5xx da api é um sinal de log, além da métrica de 5xx do Front Door.** O SSR do site chama a api direto pelo ingress (`API_INTERNAL_URL`), sem passar pelo Front Door, e a sonda `/health`
   não consulta o banco de propósito: com o Postgres fora do ar a api responde 500, o site mostra a tela de erro com status 200 e a borda não vê nada (pendência deixada pela onda 3a, "o alerta de falha da api vem do log
   do servidor"). O sinal lê o que o código já escreve, não custa regra nova, e vale também no perfil econômico, que não tem Front Door. A janela é de 10 minutos, e não 5, porque o log chega com até 4 minutos de atraso.
5. **O `job_run` ganha o estado `WAITING`** (migration aditiva) para a espera do `eod`. O alerta de job falho e o painel olham só o `FAILED`. O `JobRunStore.fail` escreve a linha de log,
   porque o `job_run` mora no Postgres e não chega ao Log Analytics sozinho.
6. **O e-mail dos alertas é o do orçamento**, e a regra de log roda sem identidade própria (com a permissão de quem fez o deploy) e com `skipQueryValidation`.

## Consequências

- Um alerta de métrica preso a hora do dia, ou a ausência de uma linha de log ("sem COTAHIST carregado às 00:35"), pede um agendador a mais (o plano fixa 7) ou um novo sinal no código. Ficou de fora de propósito; o `eod`
  que nem chega a rodar só aparece na DLQ, uns 45 minutos depois.
- A regra de log pode ter erro de sintaxe que só aparece na primeira avaliação (a tabela `ContainerAppConsoleLogs_CL` só nasce com o primeiro contêiner, e a regra é criada na fase 1).
  A seção 5.4 do `docs/INFRA.md` manda conferir uma vez no primeiro deploy.
- Nenhum alerta rodou na Azure; a falha forçada por e-mail em até 10 minutos (20 no `decisions-fila-parada`) é conferência do primeiro deploy.
- O `NODE_OPTIONS` vale também para o `job-migrate` e para qualquer `docker run` da imagem; o arquivo é inofensivo sem a connection string.
- O `check.mjs` compara a consulta da regra de log INTEIRA com a escrita no teste, e uma tabela de linhas de exemplo no formato do Pino (um caso positivo e um negativo por sinal, as bordas dos limiares) diz o que ela pretende: mexer na lógica de um sinal
  reprova até a mudança deliberada dos dois lados. Isso não prova que a consulta é válida para o Kusto (a revalidação offline é do serviço de linguagem, fora do repositório).
- O sinal `hold-por-falha-ou-resposta-invalida` conta na JANELA DA REGRA (15 minutos), e não por pregão: a causa comum faz os HOLDs caírem juntos, mas HOLDs de causas diferentes espalhados pelo pregão não se somam (o `falha` só é gravado na 3ª entrega, 30 minutos ou
  mais depois). Contar por pregão pediria uma janela de ~90 minutos para a regra inteira e adiaria o "resolvido" de todos os sinais.
- O `api-5xx` não contava `/api/auth/*` (o Better Auth loga em texto, antes do `pino-http`). **A onda 3d (03/11/2026) passou a contá-lo** (a `AuthRoute` escreve a linha com `res.statusCode`, `docs/INFRA.md`, 5.3) e acrescentou à regra o nono sinal, `ciclo-pulado`. O Statsbeat do exportador da Azure fica ligado (o padrão da Microsoft; desligar é decisão do Artur e muda o contrato de ambiente): `docs/INFRA.md`, 5.1 e 5.3.

## Alternativas consideradas

- **Um alerta de log por sinal.** Mais direto de ler (severidade e janela próprias), mas US$ 12 por mês contra US$ 2,55. A severidade única (2) é o que se perde; o sinal de segurança (`filtro-de-vazamento`) é o primeiro da lista do e-mail.
- **Um alerta de processamento de ação (suprimir fora de 09:35 a 09:50).** O alerta de métrica é de estado: ele dispara quando a condição nasce, não às 09:35, e a notificação suprimida às 08:20 não volta às 09:35.
- **Uma regra de log sobre uma linha "ciclo fechado" com ausência às 09:35.** Pede o código escrever a linha, e a regra teria de saber o horário e se o dia é pregão. Fica para depois do primeiro pregão real.
- **Um sinal de log da varredura (`CycleCloser` gravando o HOLD `sem_resposta`).** A varredura roda no `settle` do dia e no `sched-cycle` do dia seguinte, e não 15 minutos depois do prazo: serviria para saber que um ciclo foi fechado à força, não para agir a tempo.
- **A janela de 5 minutos com severidade 3.** A severidade não muda quem recebe o e-mail (o grupo de ações é um só), então só rotularia o falso alarme; a janela maior o evita.
- **A janela de 30 minutos (`PT30M`).** Sem falso alarme (o job tem 25 minutos), mas detecta em 35. Fica como a saída se a de 15 falsa-alarmar na primeira semana da Temporada 1.
- **`import './telemetry'` no topo de cada ponto de entrada.** Não garante a ordem em ESM.
- **Identidade gerenciada na regra de log.** Mais robusta contra a troca de quem faz o deploy, mas a identidade viraria mais um leitor do workspace, que guarda o log do WAF com IP e URL.
