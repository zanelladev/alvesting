// Alertas do Azure Monitor (plano §5.9 e etapa 10; docs/INFRA.md, seção 5) e o grupo de ações que manda o e-mail.
//
// Dois tipos, por custo e por origem do sinal (a página de preços do Azure Monitor está no docs/INFRA.md, seção 9):
//   Alerta de MÉTRICA da plataforma (Service Bus, Front Door, PostgreSQL): sinal que o Azure já mede. As 10 primeiras séries do mês são
//   gratuitas, e a latência é a menor (1 a 3 minutos). A regra olha a janela de 5 minutos a cada minuto.
//   Alerta de LOG (uma regra só, "sinais da aplicação"): sinal que só o código sabe (o job_run mora no Postgres e não chega ao Log
//   Analytics sozinho). Procura no stdout dos contêineres (ContainerAppConsoleLogs_CL, o destino `log-analytics` do ambiente em
//   containerenv.bicep; coluna Log_s, uma linha de JSON do Pino por registro) a linha que o código escreve. O texto de cada linha é a
//   constante ALERT_LOG de apps/api/src/telemetry/alert-logs.ts, e o telemetry.spec.ts confere este arquivo contra ela. Uma regra de
//   log custa uns US$ 1,50 por mês a cada 5 minutos: um alerta por sinal seriam oito regras; a dimensão `sinal` dá um alerta (e um
//   e-mail) por sinal numa regra só.
//
// Detecção em até 10 minutos (aceite da etapa 10): frequência de avaliação + latência até o dado chegar ao Azure Monitor. A latência de
// um log é de até 4 minutos (a documentação "Troubleshoot log search alerts" fala em "more than a 4-minute delay"), a de uma métrica da
// plataforma é menor. A janela do alerta de log só dimensiona a contagem; a do alerta de métrica de condição sustentada soma ao
// tempo (a condição tem de valer na janela inteira), por isso é de 5 minutos. O infra/tests/check.mjs confere os números. Uma exceção,
// de propósito: `alvesting-decisions-fila-parada` mede ausência de progresso (a fila não esvaziou), e uma chamada de modelo de raciocínio
// legítima passa de 5 minutos; a janela dela é de 15 (detecta em 20 minutos, não em 10; ADR 0026).
param location string
param tags object
param workspaceName string
param serviceBusName string
param postgresName string
@description('Nome do perfil do Front Door. Vazio no econômico: sem Front Door não há borda a monitorar.')
param frontDoorName string
@description('Quem recebe o e-mail dos alertas. É o mesmo do orçamento (ALVESTING_BUDGET_EMAIL): um endereço só para tudo que pede atenção.')
@minLength(3)
param alertEmail string

var hasFrontDoor = !empty(frontDoorName)
var workspaceId = resourceId('Microsoft.OperationalInsights/workspaces', workspaceName)
var serviceBusId = resourceId('Microsoft.ServiceBus/namespaces', serviceBusName)
var postgresId = resourceId('Microsoft.DBforPostgreSQL/flexibleServers', postgresName)
var frontDoorId = resourceId('Microsoft.Cdn/profiles', frontDoorName)

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-alvesting'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'alvesting'
    enabled: true
    emailReceivers: [{ name: 'operador', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}

// --- Métricas da plataforma ----------------------------------------------------------------------------------------------------
// Nomes e dimensões conferidos na documentação do Azure Monitor (docs/DEPENDENCIAS.md): Service Bus (`ActiveMessages` e
// `DeadletteredMessages`, dimensão EntityName, médias/mínimo/máximo, PT1M), Front Door Standard e Premium (`OriginHealthPercentage`,
// dimensões Origin e OriginGroup, e `Percentage5XX`) e PostgreSQL Flexible (`cpu_percent` e `storage_percent`).
var serviceBusAlerts = [
  {
    name: 'alvesting-dlq-qualquer-fila'
    description: 'Mensagem na dead-letter queue de qualquer uma das 6 filas (market, news, briefing, decisions, settlement, maintenance). Um alerta por fila. O que fazer: docs/INFRA.md, seção 5, e docs/JOBS.md, seção 5.'
    severity: 1
    scope: serviceBusId
    namespace: 'Microsoft.ServiceBus/namespaces'
    metricName: 'DeadletteredMessages'
    aggregation: 'Maximum'
    operator: 'GreaterThan'
    threshold: 0
    window: 'PT5M'
    dimensions: [{ name: 'EntityName', operator: 'Include', values: ['*'] }]
  }
  // ponytail: o plano pede "fila decisions com mensagens às 09:35", e o Azure Monitor não agenda alerta de métrica por hora do dia.
  // A regra é a que o horário quer dizer: a fila não esvaziou em 15 minutos. Uma chamada legítima de modelo de raciocínio passa de
  // 5 minutos (o job tem até 25: replicaTimeout, e uma mensagem em processamento segue ativa), então com 5 minutos o alerta abriria
  // quase todo dia útil às 08:06, no alerta que existe para o ciclo travado, e o operador aprenderia a ignorá-lo. Com 15 só uma
  // chamada de mais de 15 minutos, ou um job que nem acordou, abre o alerta (por volta das 08:20). A chamada que passa do prazo das
  // 09:30 vira HOLD "prazo" e conclui a mensagem em segundos, então mensagem ativa depois disso é sempre ciclo travado. Custo:
  // detecta em 20 minutos (1 de frequência + 15 de janela + 4 de latência), exceção ao aceite de 10 (ADR 0026). Se a primeira semana
  // da Temporada 1 mostrar chamada legítima de mais de 15 minutos, subir para PT30M.
  {
    name: 'alvesting-decisions-fila-parada'
    description: 'A fila decisions não esvaziou em 15 minutos (o plano pede mensagens às 09:35, depois do prazo das 09:30). Uma chamada de modelo de raciocínio legítima chega a uns 23 minutos: ver a limitação em docs/INFRA.md, seção 5.'
    severity: 2
    scope: serviceBusId
    namespace: 'Microsoft.ServiceBus/namespaces'
    metricName: 'ActiveMessages'
    aggregation: 'Minimum'
    operator: 'GreaterThan'
    threshold: 0
    window: 'PT15M'
    dimensions: [{ name: 'EntityName', operator: 'Include', values: ['decisions'] }]
  }
]

// Metade ou mais das sondas do Front Door falhando é "origem doente" (a sonda bate em /health a cada 30 s de cada ponto de presença).
// Só os grupos do SITE (web e api): os do blue/green (web-green e api-green, ADR 0029) apontam para o label green, que no meio de um deploy
// que falha pode estar sem revisão, e isso não é o site doente (o deploy já fica vermelho).
var frontDoorAlerts = [
  {
    name: 'alvesting-front-door-origem-doente'
    description: 'Origem (web ou api) com metade ou mais das sondas de saúde do Front Door falhando em 5 minutos.'
    severity: 1
    scope: frontDoorId
    namespace: 'Microsoft.Cdn/profiles'
    metricName: 'OriginHealthPercentage'
    aggregation: 'Average'
    operator: 'LessThan'
    threshold: 50
    window: 'PT5M'
    dimensions: [
      { name: 'Origin', operator: 'Include', values: ['*'] }
      { name: 'OriginGroup', operator: 'Include', values: ['web', 'api'] }
    ]
  }
  // ponytail: o Percentage5XX é a média da porcentagem de cada minuto, sem peso pelo tráfego. Com pouco tráfego, um 5xx isolado num
  // minuto quase vazio passa de 1%: a regra vira "houve 5xx" e não "mais de 1% das requisições". Para o volume do TCC é o aviso
  // certo. Ele só vê o que passa pelo Front Door (o navegador e o HTML do site); o SSR chama a api direto pelo ingress, e quem o vê é
  // o sinal `api-5xx` da regra de log abaixo, que pesa pela contagem (razão das linhas de requisição da api).
  // ponytail: sem dimensão, ele conta o perfil inteiro, e isso inclui o endpoint green (ADR 0029). Uma revisão nova que falha na prova
  // (502, 503 ou outro 5xx no Playwright pelo green) dispara este alerta por e-mail com o site de produção saudável; o deploy já fica
  // vermelho e o e-mail some com o `Desfazer`. Aceito. Filtrar pela dimensão `Endpoint` (o endpoint do site) pede o formato do valor,
  // que só o primeiro deploy mostra, e um valor errado deixaria o alerta mudo, que é pior que um alarme falso durante um deploy
  // que falha: conferir no primeiro deploy (docs/INFRA.md, seção 11) e então filtrar.
  {
    name: 'alvesting-front-door-5xx'
    description: 'Mais de 1% das respostas do Front Door com status 5xx na média dos últimos 5 minutos.'
    severity: 2
    scope: frontDoorId
    namespace: 'Microsoft.Cdn/profiles'
    metricName: 'Percentage5XX'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: 1
    window: 'PT5M'
    dimensions: []
  }
]

var postgresAlerts = [
  {
    name: 'alvesting-banco-cpu'
    description: 'CPU do PostgreSQL acima de 80% na média dos últimos 5 minutos (o B1ms é Burstable: com os créditos acabando a CPU fica presa no teto).'
    severity: 2
    scope: postgresId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metricName: 'cpu_percent'
    aggregation: 'Average'
    operator: 'GreaterThan'
    threshold: 80
    window: 'PT5M'
    dimensions: []
  }
  {
    name: 'alvesting-banco-disco'
    description: 'Disco do PostgreSQL acima de 80% (os 32 GB incluem dados, log de transações e log do servidor).'
    severity: 2
    scope: postgresId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metricName: 'storage_percent'
    aggregation: 'Maximum'
    operator: 'GreaterThan'
    threshold: 80
    window: 'PT5M'
    dimensions: []
  }
]

var metricAlerts = concat(serviceBusAlerts, postgresAlerts, hasFrontDoor ? frontDoorAlerts : [])

resource metricRules 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for alert in metricAlerts: {
    name: alert.name
    location: 'global'
    tags: tags
    properties: {
      description: alert.description
      severity: alert.severity
      enabled: true
      scopes: [alert.scope]
      evaluationFrequency: 'PT1M'
      windowSize: alert.window
      // sai do estado de alerta sozinho quando a condição passa (a DLQ esvaziada, a CPU normal), e avisa por e-mail também disso
      autoMitigate: true
      actions: [{ actionGroupId: actionGroup.id }]
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: 'condicao'
            metricNamespace: alert.namespace
            metricName: alert.metricName
            dimensions: alert.dimensions
            operator: alert.operator
            threshold: alert.threshold
            timeAggregation: alert.aggregation
          }
        ]
      }
    }
  }
]

// --- Sinais da aplicação (log) ----------------------------------------------------------------------------------------------------
// Cada sinal é uma linha de log que o código já escreve, com o texto exato da constante ALERT_LOG (apps/api/src/telemetry/alert-logs.ts).
// A consulta lê só as linhas JSON do Pino; `msg` é o texto, e os campos do contexto (queue, attempt) vêm junto na mesma linha.
//   job-falhou          JobRunStore.fail: job_run FAILED. A espera do eod pelo arquivo do pregão (WAITING) não escreve esta linha. Na fila
//                       news só a partir da 3ª tentativa seguida (a falha costuma ser rede, e o slot seguinte rebusca o feed)
//   api-5xx             o log de requisição da api (pino-http, `res.statusCode`): mais de 1% das requisições dos últimos 10 minutos com 5xx.
//                       A métrica de 5xx do Front Door não vê o SSR do site, que chama a api direto pelo ingress (a api fora do ar vira tela de
//                       erro com status 200); este vê, e vale também no perfil econômico, que não tem Front Door
//   news-seguranca      a mesma linha, na fila news, quando o motivo é de segurança (DTD no feed, host fora da lista fixa, redirecionamento
//                       demais, resposta ou ZIP grande demais, ZIP que não bate com o que declara, arquivo da CVM que mudou de formato):
//                       alerta na primeira vez. NEWS_SECURITY_MARKERS, em alert-logs.ts, é a lista; o spec força cada falha de verdade
//   filtro-de-vazamento DecideHandler: o filtro achou trecho do prompt no que o modelo escreveu (sinal de segurança)
//   hold-por-falha-ou-resposta-invalida
//                       DecideHandler: cada HOLD forçado por falha ou resposta inválida. Alerta com mais de 2 na janela da regra, 15
//                       minutos (holdMax): o elenco da Temporada 1 tem 6 modelos, e 3 de 6 juntos apontam causa comum (provedor,
//                       esquema, prompt). Os HOLDs de causas diferentes, espalhados pelo pregão (o `falha` só é gravado na 3ª
//                       entrega, 30 minutos ou mais depois da 1ª), não se somam
//   email-da-conta      AccountMailer: o envio da verificação ou da redefinição falhou (o descarte por repetição tem outro texto)
//   aceite-nao-gravado  auth.ts: o usuário foi criado e o aceite dos termos, não
//   eod-barras-ausentes EodHandler: o eod concluiu o pregão no prazo das 00:30 sem o BOVA11 ou sem mais de 10% do conjunto obrigatório
//   brapi-cota-baixa    BrapiClient: a cota restante da brapi chegou à reserva (500 de 15 mil por 30 dias); a busca parou e o resto ficou como falta
//   barras-divergentes  BarLoader: a brapi trouxe, para um papel e um pregão que já têm barra, valor diferente do gravado (a barra nunca muda)
//   ciclo-pulado        CycleSchedulers: o ciclo do pregão foi pulado e nenhum modelo será chamado (teto mensal de LLM estourado ou sem
//                       briefing). A arena parada sem aviso: o alerta de orçamento do Azure não vê o gasto do OpenRouter. Alerta na primeira vez
// ponytail: o eod que nem chega a rodar (agendador fora, KEDA sem acordar o worker) não escreve linha nenhuma, e este alerta não o vê.
// Quem o vê é o da DLQ (depois de 10 entregas, uns 45 minutos) e a conferência do dia seguinte. Um alerta de ausência ("sem linha de
// eod concluído às 00:35 de um pregão") pede o agendador escrever a linha de publicação; fica para quando o primeiro pregão real
// mostrar se a lacuna importa.
var appSignalsQuery = '''
let holdMax = 2;
let newsTolerated = 2;
let apiErrorPercent = 1;
let apiWindow = 10m;
ContainerAppConsoleLogs_CL
| where Log_s startswith "{"
| extend j = parse_json(Log_s)
| extend msg = tostring(j.msg)
| extend sinal = case(
    msg == "job_run falhou" and tostring(j.queue) == "news" and tostring(j.reason) matches regex "o feed traz DTD|fora da lista fixa de fontes|redirecionamentos demais|resposta grande demais|passa do teto|CRC32|too many bytes in the stream|o formato mudou", "news-seguranca",
    msg == "job_run falhou" and (tostring(j.queue) != "news" or toint(j.attempt) > newsTolerated), "job-falhou",
    msg == "o filtro de vazamento agiu: texto do modelo parecia o prompt (só os nomes dos campos vão no log)", "filtro-de-vazamento",
    msg == "HOLD forçado por falha ou resposta inválida", "hold-por-falha-ou-resposta-invalida",
    msg startswith "e-mail da conta não enviado:", "email-da-conta",
    msg startswith "aceite não gravado para o usuário", "aceite-nao-gravado",
    msg == "barras do pregão ausentes: o eod concluiu sem o BOVA11 ou sem parte do conjunto obrigatório", "eod-barras-ausentes",
    msg == "brapi: a cota restante chegou à reserva; a busca parou e o resto ficou como falta", "brapi-cota-baixa",
    msg == "barras divergentes: a brapi trouxe valor diferente do gravado e nada foi alterado", "barras-divergentes",
    msg == "sched-cycle: ciclo pulado, nenhum modelo será chamado", "ciclo-pulado",
    "")
| where sinal != ""
| summarize n = count() by sinal
| where sinal != "hold-por-falha-ou-resposta-invalida" or n > holdMax
| union (
    ContainerAppConsoleLogs_CL
    | where TimeGenerated > ago(apiWindow) and Log_s startswith "{"
    | extend j = parse_json(Log_s)
    | where isnotnull(j.res.statusCode)
    | summarize total = count(), erros = countif(toint(j.res.statusCode) >= 500)
    | where erros * 100 > total * apiErrorPercent
    | project sinal = "api-5xx", n = erros
  )
'''

// skipQueryValidation: a tabela ContainerAppConsoleLogs_CL só nasce quando o primeiro contêiner escreve no stdout, e a regra é criada
// junto com os apps (e na fase 1, antes de eles existirem). Sem isto o Azure recusa a regra por "tabela inexistente".
// Sem identidade própria: a regra consulta com a permissão de quem fez o deploy (Owner do resource group, ou a identidade do CI).
// Uma identidade da regra viraria mais um leitor do workspace, que guarda o log do WAF com IP e URL (docs/INFRA.md, 2.5).
resource appSignals 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: 'alvesting-sinais-da-aplicacao'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'Alvesting: sinais da aplicação'
    description: 'Uma linha de log que o código escreve num caso de atenção: 5xx acima de 1% nas requisições da api, job falho, falha de segurança da fila news, filtro de vazamento, HOLD por falha ou resposta inválida, e-mail da conta que falhou, aceite não gravado, barras do pregão ausentes, cota baixa da brapi, barras divergentes e ciclo pulado. Um alerta por sinal (dimensão sinal). O que fazer: docs/INFRA.md, seção 5.'
    severity: 2
    enabled: true
    scopes: [workspaceId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    skipQueryValidation: true
    criteria: {
      allOf: [
        {
          query: appSignalsQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          dimensions: [{ name: 'sinal', operator: 'Include', values: ['*'] }]
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}
