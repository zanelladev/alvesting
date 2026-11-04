// As linhas de log que os alertas do Azure Monitor procuram (infra/modules/alerts.bicep, regra única "sinais da aplicação"; docs/INFRA.md,
// seção 5). O texto mora AQUI e só aqui: o código que escreve a linha importa esta constante, e o Bicep a cita por extenso. O
// telemetry.spec.ts confere os dois lados, então o texto do alerta e o do log nunca divergem em silêncio.
//
// Este arquivo não importa nada de propósito: o infra/tests/check.mjs o lê direto, pelo Node, sem compilar.
//
// A linha é o campo `msg` do JSON do Pino (stdout do contêiner, tabela ContainerAppConsoleLogs_CL, coluna Log_s). O alerta casa por
// início de texto (`startswith`), então o que vem depois (o nome do erro, o ULID do usuário) pode variar sem quebrar a busca. Mexer
// num texto aqui é mexer no alerta: o spec reprova se o Bicep ficar para trás.
export const ALERT_LOG = {
  // JobRunStore.fail: a linha de job_run ficou FAILED. O eod que espera o arquivo do pregão NÃO passa por aqui (estado WAITING).
  jobFailed: 'job_run falhou',
  // DecideHandler: o filtro de vazamento achou trecho do prompt no que o modelo escreveu (só nomes de campos vão na linha).
  leakFilter:
    'o filtro de vazamento agiu: texto do modelo parecia o prompt (só os nomes dos campos vão no log)',
  // DecideHandler: a decisão virou HOLD forçado por falha ou por resposta inválida (a soma por pregão é o alerta).
  holdForced: 'HOLD forçado por falha ou resposta inválida',
  // AccountMailer: o envio do e-mail da conta falhou (o descarte por repetição usa outro texto e não é falha).
  emailFailed: 'e-mail da conta não enviado:',
  // auth.ts: o usuário foi criado e o aceite dos termos não foi gravado.
  consentNotRecorded: 'aceite não gravado para o usuário',
  // EodHandler: o eod concluiu o pregão no prazo das 00:30 sem o BOVA11 ou sem mais que MISSING_ALERT_PERCENT (10%) do conjunto obrigatório.
  eodBarsMissing:
    'barras do pregão ausentes: o eod concluiu sem o BOVA11 ou sem parte do conjunto obrigatório',
  // BrapiClient: a cota restante da brapi chegou à reserva (QUOTA_RESERVE); a busca parou e o resto ficou como falta.
  brapiQuotaLow:
    'brapi: a cota restante chegou à reserva; a busca parou e o resto ficou como falta',
  // BarLoader: a brapi trouxe, para um papel e um pregão que já têm barra, valor diferente do gravado (a barra existente nunca muda).
  barsDiverged: 'barras divergentes: a brapi trouxe valor diferente do gravado e nada foi alterado',
  // CycleSchedulers: o ciclo do pregão foi PULADO e nenhum modelo será chamado (motivo `orcamento`, quando o teto mensal de LLM estoura, ou
  // `sem_briefing`). Era a arena parada sem aviso: o alerta de orçamento do Azure não vê o gasto do OpenRouter (docs/INFRA.md, 5.3).
  cycleSkipped: 'sched-cycle: ciclo pulado, nenhum modelo será chamado',
} as const;

// O nome de cada sinal na regra do Azure Monitor (a dimensão `sinal`: um alerta por valor). Cada chave de ALERT_LOG tem o seu. `newsSecurity`
// não tem linha própria: é a mesma `job_run falhou`, separada pelo motivo (NEWS_SECURITY_MARKERS). `api5xx` também não: vem do log de
// requisição do pino-http (`res.statusCode`, common/http-log.ts), que o código já escreve em toda requisição.
export const ALERT_SIGNAL = {
  jobFailed: 'job-falhou',
  leakFilter: 'filtro-de-vazamento',
  holdForced: 'hold-por-falha-ou-resposta-invalida',
  emailFailed: 'email-da-conta',
  consentNotRecorded: 'aceite-nao-gravado',
  eodBarsMissing: 'eod-barras-ausentes',
  brapiQuotaLow: 'brapi-cota-baixa',
  barsDiverged: 'barras-divergentes',
  cycleSkipped: 'ciclo-pulado',
  newsSecurity: 'news-seguranca',
  api5xx: 'api-5xx',
} as const satisfies Record<keyof typeof ALERT_LOG | 'newsSecurity' | 'api5xx', string>;

// "5xx acima de 1% em 5 minutos" visto pela própria api (plano 5.9). A métrica de 5xx do Front Door só vê o que passa por ele, e o SSR do
// site chama a api direto pelo ingress (apps/web/src/lib/api.ts): a api fora do ar aparece como tela de erro com status 200. A razão é
// das linhas de requisição da api nos últimos 10 minutos (o log chega com até 4 minutos de atraso e a regra avalia a cada 5: duas
// avaliações veem cada linha). Com o tráfego do TCC (uns 17 pedidos em 5 minutos) um 5xx isolado já passa de 1%; é o que se quer, porque
// o filtro de exceções só devolve 5xx para erro nosso, e erro do cliente é 4xx.
export const API_5XX_MAX_PERCENT = 1;

// A falha de segurança da fila `news` (o feed ou o arquivo tentou o que a fronteira de confiança recusa: DTD, host fora da lista fixa,
// redirecionamento demais, resposta ou ZIP grande demais, ZIP que não bate com o que declara, arquivo da CVM que mudou de formato) alerta
// na primeira vez, e não na 3ª tentativa como a queda de rede. A fila não tem código de erro: o alerta procura estes trechos no `reason`
// da linha `job_run falhou` (regex na consulta do Bicep). Texto simples de propósito (sem acento nem metacaractere): vai dentro de um
// `matches regex "a|b"` do Kusto. O telemetry.spec.ts força cada falha com o código de verdade e confere que o trecho casa; trocar a
// mensagem de um desses erros sem trocar aqui reprova o spec.
export const NEWS_SECURITY_MARKERS = [
  'o feed traz DTD', // domain/rss.ts
  'fora da lista fixa de fontes', // infrastructure/source-http.ts (host ou redirecionamento)
  'redirecionamentos demais', // source-http.ts
  'resposta grande demais', // source-http.ts
  'passa do teto', // infrastructure/zip-csv.ts (ZIP que, inflado, passa do teto)
  'CRC32', // zip-csv.ts
  'too many bytes in the stream', // a biblioteca de ZIP: a entrada passa do tamanho que declara
  'o formato mudou', // zip-csv.ts (cabeçalho do arquivo da CVM sem uma coluna que o código lê)
] as const;

// "HOLD por falha ou resposta inválida acima de N": N = 2, então o terceiro dispara. O elenco da Temporada 1 tem 6 modelos
// (docs/ARENA.md): um ou dois modelos com resposta torta é o ruído normal de um modelo de raciocínio (o reparo já gastou a segunda
// chamada), três em seis é metade do elenco e aponta para causa comum (provedor fora, esquema que mudou, prompt quebrado). A contagem
// é a da JANELA DA REGRA (15 minutos), e não a do pregão inteiro: a causa comum faz os HOLDs caírem juntos (o `falha` de todos os
// modelos sai na 3ª entrega, e o `resposta_invalida` logo depois de cada chamada), mas HOLDs de causas diferentes espalhados pelo
// pregão (o `falha` só é gravado 30 minutos ou mais depois da 1ª entrega) não se somam. Contar por pregão pediria agrupar por
// `cycleId` (já vai na linha) numa janela de ~90 minutos, que valeria para todos os sinais da regra e adiaria o "resolvido" de todos.
// Elenco maior pede N maior: mudar aqui e no Bicep.
export const HOLD_FORCED_MAX_PER_SESSION = 2;

// O job_run da fila `news` falha por rede de vez em quando e o slot seguinte rebusca o mesmo feed (docs/JOBS.md): só alerta a partir
// da 3ª tentativa seguida da mesma mensagem. As outras filas alertam na primeira falha.
export const NEWS_FAILED_ATTEMPTS_TOLERATED = 2;
