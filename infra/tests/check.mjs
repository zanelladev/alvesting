// Check estático da infra (etapa 2). Só Node, sem dependência: node infra/tests/check.mjs
//
// 1. Compila e exige saída limpa (nenhum erro, nenhum aviso): bicep build, build-params dos dois
//    arquivos de parâmetros e lint.
// 2. Para cada perfil gera um snapshot do deploy (`bicep snapshot`, local, sem Azure e sem assinatura)
//    e afirma os invariantes do plano (§5 e §6). Este arquivo é o oráculo: o Bicep tem de bater com ele.
//    Um oráculo que é cópia do Bicep não pega nada: o GUID de papel daqui vem da tabela da Microsoft
//    (BUILT_IN_ROLES), a ordem dos módulos vem do template compilado (dependsOn), não de suposição, e "quem lê
//    cada segredo" (secretsRead) é uma matriz escrita à mão a partir do plano, não derivada do Bicep.
// 3. Confere a documentação com o template: a tabela de ambiente do docs/INFRA.md (seção 2.7) tem de listar
//    exatamente as variáveis que cada workload recebe, e o INFRA.md cita cada identidade e cada papel.
//
// ponytail: o snapshot avalia as expressões do ARM sem a Azure. O que só existe depois do deploy
// (principalId, listKeys, defaultDomain) fica como texto "[...]"; as afirmações só olham o que o
// template decide sozinho. A prova de que a Azure aceita (what-if, deploy) precisa da assinatura.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// O texto das linhas de log que os alertas procuram mora num arquivo só, sem import nenhum (o Node 26 lê o .ts direto): o código escreve
// a linha com ele e este check confere o Bicep contra ele (docs/INFRA.md, seção 5).
import {
  ALERT_LOG,
  ALERT_SIGNAL,
  API_5XX_MAX_PERCENT,
  HOLD_FORCED_MAX_PER_SESSION,
  NEWS_FAILED_ATTEMPTS_TOLERATED,
  NEWS_SECURITY_MARKERS,
} from '../../apps/api/src/telemetry/alert-logs.ts';

const INFRA = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(INFRA);
const MAIN = join(INFRA, 'main.bicep');
const SEED = join(INFRA, 'scripts', 'seed-secrets.sh');
const VERIFY_ROLES = join(INFRA, 'scripts', 'verify-roles.sh');
const ROLES = join(INFRA, 'roles.bicep');
const PARAMS = {
  dev: join(INFRA, 'main.dev.bicepparam'),
  prod: join(INFRA, 'main.prod.bicepparam'),
};
const SUBSCRIPTION = '00000000-0000-0000-0000-000000000000';
const TENANT = '22222222-2222-2222-2222-222222222222';

// Valores que os arquivos de parâmetros leem do ambiente (nunca vão para o repositório).
const INPUT_ENV = {
  ALVESTING_PG_ADMIN_PASSWORD: 'check-only-Not-A-Secret-0123456789',
  // A senha do login de menor privilégio da api (alvesting_api), a do segredo database-url-api (docs/INFRA.md, 2.2 e 2.6): pelo menos 32
  // caracteres, como o db:roles exige em produção.
  ALVESTING_PG_API_PASSWORD: 'check-only-Not-A-Secret-api-0123456789abcdef',
  ALVESTING_BUDGET_EMAIL: 'check@example.com',
  ALVESTING_ADMIN_PRINCIPAL_ID: '11111111-1111-1111-1111-111111111111',
  // Sem valor padrão nos .bicepparam (nada de latest): a tag das imagens e a versão do prompt da arena vêm do
  // deploy (docs/INFRA.md, passos 4 e 6). A versão do Key Vault é um hexadecimal de 32 caracteres.
  ALVESTING_API_TAG: 'check-only-api-sha',
  ALVESTING_WEB_TAG: 'check-only-web-sha',
  ALVESTING_PROMPT_ARENA_VERSION: '0123456789abcdef0123456789abcdef',
  // A conta (etapa 11): o controlador e o contato da política de privacidade (sem valor padrão nos .bicepparam: nunca no repositório,
  // e a api recusa subir em produção sem eles) e o client ID do Google (opcional; vazio = sem login por Google).
  ALVESTING_LEGAL_CONTROLLER_NAME: 'Controlador de Teste',
  ALVESTING_LEGAL_CONTACT_EMAIL: 'privacidade@example.test',
  ALVESTING_GOOGLE_CLIENT_ID: 'check-only.apps.googleusercontent.example',
};

// --- O que o plano manda -------------------------------------------------------------------------
const QUEUES = { market: 10, news: 5, briefing: 5, decisions: 3, settlement: 5, maintenance: 3 }; // §5.5
const CRONS = {
  news: '*/30 * * * *',
  briefing: '30 10 * * 1-5',
  cycle: '0 11 * * 1-5',
  eod: '30 0 * * 2-6',
  universe: '0 12 * * 0',
  retention: '0 13 * * *', // diária (04/11/2026): a promessa de 7 dias da política de privacidade depende disso
  backup: '0 6 1 * *',
}; // §6, em UTC
const SCALE = { padrao: [1, 5], economico: [0, 5] }; // ca-web e ca-api: [mínimo, máximo] (§5.3 e §5.12)
const WORKER_QUEUES = ['market', 'news', 'briefing', 'settlement', 'maintenance']; // todas menos decisions

// Alertas de operação (plano 5.9, etapa 10; docs/INFRA.md, seção 5). Escrito à mão a partir da documentação do Azure Monitor (nome da
// métrica, namespace, dimensões e agregações aceitas), não derivado do Bicep. `padraoOnly`: o recurso monitorado (o Front Door) só existe
// no perfil padrão, então no econômico o alerta não existe (nem teria o que medir).
const METRIC_ALERTS = {
  'alvesting-dlq-qualquer-fila': {
    on: 'servicebus',
    namespace: 'Microsoft.ServiceBus/namespaces',
    metric: 'DeadletteredMessages',
    aggregation: 'Maximum',
    operator: 'GreaterThan',
    threshold: 0,
    dimensions: { EntityName: ['*'] },
    severity: 1,
  },
  // A única exceção ao "em até 10 minutos" (ADR 0026): mede ausência de progresso (a fila não esvaziou), e uma chamada legítima de modelo de
  // raciocínio passa de 5 minutos (o job tem até 25). Com 5 minutos o alerta abriria quase todo dia útil, no alerta do ciclo travado.
  'alvesting-decisions-fila-parada': {
    on: 'servicebus',
    namespace: 'Microsoft.ServiceBus/namespaces',
    metric: 'ActiveMessages',
    aggregation: 'Minimum',
    operator: 'GreaterThan',
    threshold: 0,
    dimensions: { EntityName: ['decisions'] },
    severity: 2,
    window: 'PT15M',
    maxMinutes: 20,
  },
  'alvesting-banco-cpu': {
    on: 'postgres',
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers',
    metric: 'cpu_percent',
    aggregation: 'Average',
    operator: 'GreaterThan',
    threshold: 80,
    dimensions: {},
    severity: 2,
  },
  'alvesting-banco-disco': {
    on: 'postgres',
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers',
    metric: 'storage_percent',
    aggregation: 'Maximum',
    operator: 'GreaterThan',
    threshold: 80,
    dimensions: {},
    severity: 2,
  },
  'alvesting-front-door-origem-doente': {
    on: 'frontdoor',
    namespace: 'Microsoft.Cdn/profiles',
    metric: 'OriginHealthPercentage',
    aggregation: 'Average',
    operator: 'LessThan',
    threshold: 50,
    // só os grupos do site: os do blue/green (web-green e api-green, ADR 0029) apontam para o label green, que no meio do deploy pode não
    // existir ou estar numa revisão que vai ser desativada, e isso não é origem doente do site
    dimensions: { Origin: ['*'], OriginGroup: ['web', 'api'] },
    severity: 1,
    padraoOnly: true,
  },
  'alvesting-front-door-5xx': {
    on: 'frontdoor',
    namespace: 'Microsoft.Cdn/profiles',
    metric: 'Percentage5XX',
    aggregation: 'Average',
    operator: 'GreaterThan',
    threshold: 1,
    dimensions: {},
    severity: 2,
    padraoOnly: true,
  },
};
const LOG_ALERT = 'alvesting-sinais-da-aplicacao';
const ALERT_SCOPES = {
  servicebus: 'Microsoft.ServiceBus/namespaces/sb-alvesting',
  postgres: 'Microsoft.DBforPostgreSQL/flexibleServers/psql-alvesting',
  frontdoor: 'Microsoft.Cdn/profiles/afd-alvesting',
};
// O aceite da etapa 10: a falha forçada chega por e-mail em até 10 minutos. Detecção = frequência de avaliação + latência até o dado
// chegar ao Azure Monitor; no alerta de métrica a janela soma (a condição tem de valer nela inteira). 4 minutos é o que a documentação
// do Azure Monitor chama de atraso a partir do qual os logs deixam de servir ("Troubleshoot log search alerts"); a métrica da plataforma
// chega antes, e o mesmo número é o teto conservador dos dois.
const ALERT_MAX_MINUTES = 10;
const ALERT_LATENCY_MINUTES = 4;
// PT1M, PT5M, PT1H, P1D -> minutos
const isoMinutes = (iso) => {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(iso));
  assert.ok(m, `duração ISO 8601 inválida: ${iso}`);
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
};
// A consulta da regra de log, INTEIRA, escrita aqui à mão com as constantes do código no lugar dos textos (alert-logs.ts). O Bicep tem de
// ser igual a ela, espaço em branco à parte: uma edição na lógica (um `!=` por `==`, o rótulo de um sinal, um `startswith` por `==`) reprova
// e só passa com a mudança deliberada dos dois lados, e a tabela de linhas de exemplo (APP_SIGNAL_CASES, mais abaixo) diz o que ela pretende.
// Conferir só a presença de trechos (o que este arquivo fazia) deixava passar quatro mutações de lógica (revisão de 02/11/2026).
// Mexeu na consulta? Revalide a sintaxe e os tipos (INFRA.md, 5.3, "Limitações": o serviço de linguagem do Kusto, fora do repositório).
const APP_SIGNALS_QUERY = `
let holdMax = ${HOLD_FORCED_MAX_PER_SESSION};
let newsTolerated = ${NEWS_FAILED_ATTEMPTS_TOLERATED};
let apiErrorPercent = ${API_5XX_MAX_PERCENT};
let apiWindow = 10m;
ContainerAppConsoleLogs_CL
| where Log_s startswith "{"
| extend j = parse_json(Log_s)
| extend msg = tostring(j.msg)
| extend sinal = case(
    msg == "${ALERT_LOG.jobFailed}" and tostring(j.queue) == "news" and tostring(j.reason) matches regex "${NEWS_SECURITY_MARKERS.join('|')}", "${ALERT_SIGNAL.newsSecurity}",
    msg == "${ALERT_LOG.jobFailed}" and (tostring(j.queue) != "news" or toint(j.attempt) > newsTolerated), "${ALERT_SIGNAL.jobFailed}",
    msg == "${ALERT_LOG.leakFilter}", "${ALERT_SIGNAL.leakFilter}",
    msg == "${ALERT_LOG.holdForced}", "${ALERT_SIGNAL.holdForced}",
    msg startswith "${ALERT_LOG.emailFailed}", "${ALERT_SIGNAL.emailFailed}",
    msg startswith "${ALERT_LOG.consentNotRecorded}", "${ALERT_SIGNAL.consentNotRecorded}",
    msg == "${ALERT_LOG.eodBarsMissing}", "${ALERT_SIGNAL.eodBarsMissing}",
    msg == "${ALERT_LOG.brapiQuotaLow}", "${ALERT_SIGNAL.brapiQuotaLow}",
    msg == "${ALERT_LOG.barsDiverged}", "${ALERT_SIGNAL.barsDiverged}",
    msg == "${ALERT_LOG.cycleSkipped}", "${ALERT_SIGNAL.cycleSkipped}",
    "")
| where sinal != ""
| summarize n = count() by sinal
| where sinal != "${ALERT_SIGNAL.holdForced}" or n > holdMax
| union (
    ContainerAppConsoleLogs_CL
    | where TimeGenerated > ago(apiWindow) and Log_s startswith "{"
    | extend j = parse_json(Log_s)
    | where isnotnull(j.res.statusCode)
    | summarize total = count(), erros = countif(toint(j.res.statusCode) >= 500)
    | where erros * 100 > total * apiErrorPercent
    | project sinal = "${ALERT_SIGNAL.api5xx}", n = erros
  )
`;
const squash = (text) => text.replace(/\s+/g, ' ').trim();
// Papéis internos da Azure: GUID -> nome oficial. Cópia INDEPENDENTE da tabela da Microsoft (páginas security,
// containers, storage, integration e ai-machine-learning de
// https://learn.microsoft.com/azure/role-based-access-control/built-in-roles, conferidas em 01/11/2026). Não
// derivar do infra/roles.bicep: um GUID errado de lá, copiado para cá, já passou batido numa revisão (Key Vault
// Secrets User terminava em ...0f2c2cf0c5d6 em vez de ...0445c86b69e6).
const BUILT_IN_ROLES = new Map([
  ['7f951dda-4ed3-4680-a7ca-43fe172d538d', 'AcrPull'],
  ['4633458b-17de-408a-b874-0445c86b69e6', 'Key Vault Secrets User'],
  ['b86a8fe4-44ce-4948-aee5-eccb2c155cd7', 'Key Vault Secrets Officer'],
  ['ba92f5b4-2d11-453d-a403-e96b0029c9fe', 'Storage Blob Data Contributor'],
  // página storage da mesma tabela, lida em 03/11/2026: leitura de containers e blobs, sem escrita nem exclusão
  ['2a2b9908-6ea1-4ae2-8e65-a410df84e7d1', 'Storage Blob Data Reader'],
  ['69a216fc-b8fb-44d8-bc22-1f3c2cd27a39', 'Azure Service Bus Data Sender'],
  ['4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0', 'Azure Service Bus Data Receiver'],
  ['090c5cfd-751d-490a-894a-3ce6f1109419', 'Azure Service Bus Data Owner'],
  ['5e0bd9bd-7b93-4f28-af87-19fc36ad61bd', 'Cognitive Services OpenAI User'],
]);
const PURGE_ROLE = 'Front Door purge (papel próprio)';

// Uma identidade por workload (docs/INFRA.md, 3.2; ADR 0020). Este bloco é o oráculo de "quem lê o quê", escrito
// à mão a partir do plano (§5.7 e §10) e não derivado do Bicep: se o Bicep der um segredo a quem não deve, ele
// diverge daqui.
const ID = {
  web: 'id-alvesting-web',
  api: 'id-alvesting-api',
  worker: 'id-alvesting-worker',
  decisions: 'id-alvesting-decisions',
  sched: 'id-alvesting-sched',
  migrate: 'id-alvesting-migrate',
  scale: 'id-alvesting-scale',
};
const ALL_IDENTITIES = Object.values(ID);
// A identidade do código de cada workload (a que lê os segredos e puxa a imagem). Os 7 agendadores dividem uma.
const codeIdentityOf = (workload) =>
  workload.startsWith('job-sched-')
    ? ID.sched
    : {
        'ca-web': ID.web,
        'ca-api': ID.api,
        'ca-worker-data': ID.worker,
        'job-worker-decisions': ID.decisions,
        'job-migrate': ID.migrate,
      }[workload];
// O KEDA autentica as regras de escala do worker e das decisões com a id-alvesting-scale (lifecycle None).
const KEDA_WORKLOADS = ['ca-worker-data', 'job-worker-decisions'];
// Identidades só da plataforma (pull da imagem e referência de segredo): o código do container não recebe token. No econômico o migrate sai
// daqui (ADR 0039): a restauração da temporada lê o backups com a identidade dele, que vale para o código (lifecycle Main).
const PLATFORM_ONLY = { 'ca-web': ID.web, 'job-migrate': ID.migrate };
const platformOnlyOf = (profile) =>
  profile === 'economico' ? { 'ca-web': ID.web } : PLATFORM_ONLY;

const vaultScope = 'Microsoft.KeyVault/vaults/kv-alvesting';
const sbScope = 'Microsoft.ServiceBus/namespaces/sb-alvesting';
const storageScope = 'Microsoft.Storage/storageAccounts/stalvesting';
const acrScope = 'Microsoft.ContainerRegistry/registries/cralvesting';
const openAiScope = 'Microsoft.CognitiveServices/accounts/oai-alvesting';

// Service Bus POR FILA, nunca do namespace (docs/INFRA.md, 3.2; ADR 0030). Quem publica (Sender), quem consome e lê a DLQ (Receiver), e o KEDA
// (Data Owner, em todas: ele lê a profundidade de cada fila). Escrito à mão a partir do código, e não derivado do Bicep:
//  - a api: o reprocesso do ciclo publica `decide` (decisions), o evento corporativo publica `settle` (settlement), e o admin lê e reenvia a
//    DLQ de QUALQUER fila (queueNameSchema tem as seis): Sender e Receiver nas seis;
//  - o worker consome market, news, briefing, settlement e maintenance. O handler que falha agenda a nova tentativa NA MESMA fila (Sender), o
//    eod se reagenda em market e o fim do eod publica `settle` em settlement. Nada em decisions;
//  - o job de decisões só consome a decisions e agenda a nova tentativa nela;
//  - os agendadores só publicam (ADR 0007): market (eod, universe), news, briefing, decisions (o ciclo) e maintenance. A settlement é do eod.
const QUEUE_ROLES = {
  market: { sender: [ID.api, ID.worker, ID.sched], receiver: [ID.api, ID.worker] },
  news: { sender: [ID.api, ID.worker, ID.sched], receiver: [ID.api, ID.worker] },
  briefing: { sender: [ID.api, ID.worker, ID.sched], receiver: [ID.api, ID.worker] },
  decisions: { sender: [ID.api, ID.decisions, ID.sched], receiver: [ID.api, ID.decisions] },
  settlement: { sender: [ID.api, ID.worker], receiver: [ID.api, ID.worker] },
  maintenance: { sender: [ID.api, ID.worker, ID.sched], receiver: [ID.api, ID.worker] },
};
// Blob POR CONTAINER, nunca da conta. Escrito à mão a partir do código de cada arquivo (Archive):
//  - briefings: o worker grava o briefing congelado (FreezeHandler, BriefingArchive.save); as decisões o leem para montar o pedido
//    (BriefingArchive.read): Reader basta;
//  - llm-io: as decisões gravam o IO bruto (LlmIoArchive.save). Nada o lê: o worker, que parseia dado de terceiros, deixa de alcançá-lo;
//  - backups: o worker envia o dump, o baixa de volta para restaurar, grava os metadados e apaga o dump que não passou (backup-verify);
// A api e os agendadores não leem nem gravam Blob (nem o web, o migrate e o KEDA).
const BLOB_ROLES = {
  briefings: { contributor: [ID.worker], reader: [ID.decisions] },
  'llm-io': { contributor: [ID.decisions], reader: [] },
  backups: { contributor: [ID.worker], reader: [] },
};

// Key Vault Secrets User NO ESCOPO DE CADA SEGREDO que a identidade lê (nunca no cofre). `padrao` liga o
// front-door-id; `openai` (enableOpenAI) liga o prompt-chat, só da api. prompt-arena e openrouter-api-key só do job
// de decisões, brapi-token só do worker. O quotes-secret (a rota interna de cotações, que a API pública deixou de ter: docs/API.md, seção 6)
// é do web, que o manda, e da api, que o confere, e de mais ninguém. O banco: o login ADMINISTRADOR (database-url) só de quem não é exposto à internet e do migrate
// (que roda as migrations e cria o login da api); o login de menor privilégio da api (database-url-api, ADR 0028) só da api, que o usa, e do
// migrate, que o cria (db:roles). O web não consulta o banco.
const secretsRead = ({ padrao, openai }) => ({
  [ID.web]: [
    'appinsights-connection-string',
    'revalidate-secret',
    'quotes-secret',
    ...(padrao ? ['front-door-id'] : []),
  ],
  [ID.api]: [
    'database-url-api',
    'appinsights-connection-string',
    'better-auth-secret',
    'google-oauth-client-secret',
    'acs-connection-string',
    'quotes-secret',
    ...(padrao ? ['front-door-id'] : []),
    ...(openai ? ['prompt-chat'] : []),
  ],
  [ID.worker]: [
    'database-url',
    'appinsights-connection-string',
    'brapi-token',
    'revalidate-secret',
  ],
  [ID.decisions]: [
    'database-url',
    'appinsights-connection-string',
    'openrouter-api-key',
    'prompt-arena',
  ],
  [ID.sched]: ['database-url', 'appinsights-connection-string'],
  [ID.migrate]: ['database-url', 'database-url-api'],
});

// O perfil econômico, em que a produção nasce (ADR 0039), soma dois papéis de Blob, os dois por container: o migrate LÊ o backups (a
// restauração da temporada, dist/restore-cli.js, numa execução do job-migrate) e quem opera (o adminPrincipalId, "admin" aqui) escreve nos
// três (o envio do dump e a cópia do Blob do Azurite: docs/RUNBOOK.md, 13.6). No padrão nenhum dos dois existe (o RUNBOOK, 5.3, dá o papel à mão).
const ECONOMICO_BLOB_GRANTS = [
  `${ID.migrate} | Storage Blob Data Reader | ${storageScope}/blobServices/default/containers/backups`,
  ...['briefings', 'llm-io', 'backups'].map(
    (container) =>
      `admin | Storage Blob Data Contributor | ${storageScope}/blobServices/default/containers/${container}`,
  ),
];

// Quem recebe o quê (docs/INFRA.md, seção 3.2): "identidade | papel | escopo". Service Bus POR FILA (QUEUE_ROLES) e Blob POR CONTAINER
// (BLOB_ROLES), nenhum papel no namespace nem na conta. AcrPull: todo workload.
const expectedGrants = (opts) =>
  [
    ...Object.entries(secretsRead(opts)).flatMap(([identity, secrets]) =>
      secrets.map(
        (secret) => `${identity} | Key Vault Secrets User | ${vaultScope}/secrets/${secret}`,
      ),
    ),
    ...Object.entries(QUEUE_ROLES).flatMap(([queue, who]) => [
      ...who.sender.map(
        (identity) => `${identity} | Azure Service Bus Data Sender | ${sbScope}/queues/${queue}`,
      ),
      ...who.receiver.map(
        (identity) => `${identity} | Azure Service Bus Data Receiver | ${sbScope}/queues/${queue}`,
      ),
      `${ID.scale} | Azure Service Bus Data Owner | ${sbScope}/queues/${queue}`,
    ]),
    ...Object.entries(BLOB_ROLES).flatMap(([container, who]) => {
      const scope = `${storageScope}/blobServices/default/containers/${container}`;
      return [
        ...who.contributor.map(
          (identity) => `${identity} | Storage Blob Data Contributor | ${scope}`,
        ),
        ...who.reader.map((identity) => `${identity} | Storage Blob Data Reader | ${scope}`),
      ];
    }),
    `admin | Key Vault Secrets Officer | ${vaultScope}`,
    ...(opts.padrao ? [] : ECONOMICO_BLOB_GRANTS),
    ...(opts.padrao
      ? [
          ...[ID.web, ID.api, ID.worker, ID.decisions, ID.sched, ID.migrate].map(
            (identity) => `${identity} | AcrPull | ${acrScope}`,
          ),
          `${ID.worker} | ${PURGE_ROLE} | Microsoft.Cdn/profiles/afd-alvesting`,
        ]
      : []),
    ...(opts.openai ? [`${ID.api} | Cognitive Services OpenAI User | ${openAiScope}`] : []),
  ].sort();
// Segredos que o Bicep deriva (existem porque algo foi criado) e que o Artur preenche à mão (§5.7). Não há
// azure-openai-key: o Azure OpenAI não tem chave (disableLocalAuth), o chat entra por identidade.
const DERIVED_SECRETS = [
  'database-url',
  'database-url-api',
  'front-door-id',
  'acs-connection-string',
  'appinsights-connection-string',
];
const HAND_SECRETS = [
  'openrouter-api-key',
  'better-auth-secret',
  'google-oauth-client-secret',
  'brapi-token',
  'revalidate-secret',
  'quotes-secret',
  'prompt-arena',
  'prompt-chat',
];
// Única forma de uma variável de ambiente ir em texto puro: estar nesta lista e não parecer segredo.
const PLAIN_ENV = new Set([
  'NODE_ENV',
  'LOG_LEVEL',
  'AZURE_CLIENT_ID',
  'KEY_VAULT_URL',
  'SERVICEBUS_FQDN',
  'STORAGE_BLOB_ENDPOINT',
  'API_PORT',
  'PORT',
  'HOSTNAME',
  'PUBLIC_URL',
  'API_INTERNAL_URL',
  // o repasse de /api pelo site, só no econômico (ADR 0039): a flag `on`
  'API_PROXY',
  'WEB_INTERNAL_URL',
  'FRONT_DOOR_ENDPOINT_ID',
  'ORIGIN_LOCK',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT',
  'PROMPT_ARENA_VERSION',
  // a conta (etapa 11), só na api: o remetente do domínio gerenciado, o controlador e o contato da privacidade e o client ID do Google
  'EMAIL_SENDER_ADDRESS',
  'LEGAL_CONTROLLER_NAME',
  'LEGAL_CONTACT_EMAIL',
  'GOOGLE_CLIENT_ID',
  // o teto de custo das LLMs no mês, em dólares inteiros: só o job-sched-cycle e a ca-api (teste "sched-cycle", abaixo)
  'ARENA_MONTHLY_COST_CAP_USD',
]);
// PROMPT_ARENA_VERSION é o identificador da versão do segredo no Key Vault, não o texto: único nome com PROMPT que
// pode ir em texto puro (e o valor é conferido à parte: 32 hexadecimais).
const SECRET_NAME =
  /(SECRET|PASSWORD|TOKEN|API_KEY|_KEY$|CONNECTION_STRING|DATABASE_URL|PROMPT(?!_ARENA_VERSION$)|FRONT_DOOR_ID)/i;
const SECRET_VALUE =
  /(:\/\/[^/\s:@]+:[^@\s]+@|AccountKey=|SharedAccessKey=|InstrumentationKey=|-----BEGIN)/i;

// --- Ferramentas ---------------------------------------------------------------------------------
function findBicep() {
  const candidates = [process.env.BICEP_BIN, 'bicep', join(homedir(), '.azure', 'bin', 'bicep')];
  for (const bin of candidates.filter(Boolean)) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return { bin, version: r.stdout.trim() };
  }
  throw new Error('bicep não encontrado: rode `az bicep install` ou defina BICEP_BIN');
}
const BICEP = findBicep();

function bicep(args, { withInputs = true } = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(INPUT_ENV)) delete env[name];
  const r = spawnSync(BICEP.bin, args, {
    encoding: 'utf8',
    env: withInputs ? { ...env, ...INPUT_ENV } : env,
  });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

// Snapshot do deploy com a prod como base e algumas linhas `param x = ...` trocadas. O perfil da base é o PADRÃO, como sempre foi: o
// main.prod.bicepparam passou ao econômico (ADR 0039), e os testes que não dizem o perfil (fase 1, domínio próprio, Azure OpenAI...) seguem
// olhando o padrão. Quem quer o econômico pede (profileModel('economico')).
const snapshots = new Map();
function snapshot(label, overrides) {
  if (!snapshots.has(label)) {
    try {
      snapshots.set(label, { model: model(runSnapshot(label, overrides)) });
    } catch (error) {
      snapshots.set(label, { error });
    }
  }
  const cached = snapshots.get(label);
  if (cached.error) throw cached.error;
  return cached.model;
}

function runSnapshot(label, overrides) {
  const dir = mkdtempSync(join(INFRA, 'tests', '.tmp-'));
  try {
    let text = readFileSync(PARAMS.prod, 'utf8').replace(/^using .*$/m, "using '../../main.bicep'");
    for (const [name, value] of Object.entries({ profile: "'padrao'", ...overrides })) {
      const line = `param ${name} = ${value}`;
      const pattern = new RegExp(`^param ${name} = .*$`, 'm');
      text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
    }
    const file = join(dir, `${label}.bicepparam`);
    writeFileSync(file, text);
    const r = bicep([
      'snapshot',
      file,
      '--mode',
      'overwrite',
      '--tenant-id',
      TENANT,
      '--subscription-id',
      SUBSCRIPTION,
      '--location',
      'eastus2',
      '--resource-group',
      'rg-check',
    ]);
    assert.equal(r.status, 0, `bicep snapshot (${label}) falhou:\n${r.out}${r.err}`);
    const snap = JSON.parse(readFileSync(join(dir, `${label}.snapshot.json`), 'utf8'));
    assert.deepEqual(snap.diagnostics, [], `diagnósticos do snapshot (${label})`);
    return snap;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function model(snap) {
  const resources = snap.predictedResources;
  const ofType = (type) => resources.filter((r) => r.type.toLowerCase() === type.toLowerCase());
  const named = (type, name) =>
    ofType(type).filter((r) => r.name === name || r.name.endsWith(`/${name}`));
  const one = (type, name) => {
    const found = name === undefined ? ofType(type) : named(type, name);
    assert.equal(
      found.length,
      1,
      `esperava 1 ${type}${name ? ` "${name}"` : ''}, achei ${found.length}`,
    );
    return found[0];
  };
  const underNamespace = (prefix) =>
    resources.filter((r) => r.type.toLowerCase().startsWith(prefix.toLowerCase()));
  const workloads = [...ofType('Microsoft.App/containerApps'), ...ofType('Microsoft.App/jobs')];
  const secretNames = () =>
    ofType('Microsoft.KeyVault/vaults/secrets').map((r) => r.name.split('/').pop());
  // O snapshot deixa a URL como expressão (environment() só existe na Azure):
  //   format('{0}{1}{2}', format('https://{0}{1}/secrets/', '<cofre>', environment()...), '<segredo>', '</versão>')
  // Ela tem de apontar para /secrets/ DO COFRE criado neste deploy (um nome de cofre errado só apareceria na Azure,
  // como referência que não resolve) e nomear o segredo.
  const isKeyVaultUrl = (secret) =>
    typeof secret.keyVaultUrl === 'string' &&
    secret.keyVaultUrl.includes(`/secrets/', '${one('Microsoft.KeyVault/vaults').name}',`) &&
    secret.keyVaultUrl.includes(secret.name);
  // Cada atribuição de papel como "identidade | papel | escopo", em ordem alfabética. O papel é o NOME da tabela
  // da Microsoft para o GUID (BUILT_IN_ROLES); um GUID fora dela aparece como "GUID fora da tabela" e derruba
  // o teste. O papel de purge é próprio (GUID gerado), então vem das definições do próprio deploy.
  const customRoles = new Set(ofType('Microsoft.Authorization/roleDefinitions').map((r) => r.name));
  const grants = () =>
    ofType('Microsoft.Authorization/roleAssignments')
      .map((r) => {
        const guid = r.properties.roleDefinitionId.split('/').pop();
        const role =
          BUILT_IN_ROLES.get(guid) ??
          (customRoles.has(guid) ? PURGE_ROLE : `GUID fora da tabela: ${guid}`);
        const identity = /userAssignedIdentities\/([^'/]+)'/.exec(String(r.properties.principalId));
        const who = identity
          ? identity[1]
          : r.properties.principalType === 'User'
            ? 'admin'
            : `principal desconhecido: ${r.properties.principalId}`;
        const scope = r.id
          .replace(/^.*\/resourceGroups\/[^/]+\/providers\//, '')
          .replace(/\/providers\/Microsoft\.Authorization\/roleAssignments\/.*$/, '');
        return `${who} | ${role} | ${scope}`;
      })
      .sort();
  return { resources, ofType, one, underNamespace, workloads, secretNames, grants, isKeyVaultUrl };
}

// Identidades anexadas a um app ou job (nomes, sem o caminho).
const identitiesOf = (resource) =>
  Object.keys(resource.identity?.userAssignedIdentities ?? {}).map((id) => id.split('/').pop());

const containersOf = (resource) => resource.properties.template.containers;
const envOf = (resource) =>
  Object.fromEntries(
    containersOf(resource)
      .flatMap((c) => c.env ?? [])
      .map((e) => [e.name, e]),
  );
const queueOfRule = (rule) => rule.metadata?.queueName ?? rule.custom?.metadata?.queueName;

// Os segredos do Artur, como o seed-secrets.sh os conhece: `seed <nome> <random|ask|file>`.
const seedPlan = () =>
  [...readFileSync(SEED, 'utf8').matchAll(/^seed (\S+) (random|ask|file)$/gm)].map(
    ([, name, kind]) => ({ name, kind }),
  );

// --- Registro dos testes -------------------------------------------------------------------------
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name });
  } catch (error) {
    results.push({ name, error });
  }
}

const PROFILES = ['padrao', 'economico'];
// Os main.*.bicepparam trazem o regime de ROTINA (nada é regravado). O primeiro deploy liga duas coisas por
// linha de comando; os testes de conteúdo olham o primeiro deploy, e o de rotina é conferido à parte.
const FIRST_DEPLOY = { writeDerivedSecrets: 'true', deployBudget: 'true' };
const profileModel = (profile) => snapshot(profile, { profile: `'${profile}'`, ...FIRST_DEPLOY });
const routineModel = (profile) => snapshot(`rotina-${profile}`, { profile: `'${profile}'` });

// =================================================================================================
// 1. Compilação limpa
// =================================================================================================
test('bicep build: sem erro nem aviso', () => {
  const r = bicep(['build', MAIN, '--stdout'], { withInputs: false });
  assert.equal(r.status, 0, r.err);
  assert.equal(r.err.trim(), '', `avisos:\n${r.err}`);
  const template = JSON.parse(r.out);
  assert.deepEqual(
    template.parameters.profile.allowedValues,
    PROFILES,
    'profile = padrao | economico',
  );
  const text = r.out;
  // Idempotência: nada que mude a cada deploy.
  for (const banned of ['utcNow', 'newGuid', 'dateTimeAdd', 'deploymentScripts']) {
    assert.ok(!text.includes(banned), `o template não pode usar ${banned}`);
  }
});

for (const [name, file] of Object.entries(PARAMS)) {
  test(`bicep build-params ${name}: sem erro nem aviso (sem variáveis de ambiente)`, () => {
    const r = bicep(['build-params', file, '--stdout'], { withInputs: false });
    assert.equal(r.status, 0, r.err);
    assert.equal(r.err.trim(), '', `avisos:\n${r.err}`);
    const parameters = JSON.parse(JSON.parse(r.out).parametersJson).parameters;
    assert.ok(PROFILES.includes(parameters.profile.value), `profile de ${name}`);
    assert.ok(!/utcNow|newGuid/.test(readFileSync(file, 'utf8')), 'parâmetros sem valor que muda');
    // Flags booleanas (writeDerivedSecrets...) têm "secret" no nome mas não guardam segredo.
    const secrets = Object.keys(parameters).filter(
      (p) => typeof parameters[p].value !== 'boolean' && /password|secret|token|key/i.test(p),
    );
    for (const p of secrets) {
      assert.match(readFileSync(file, 'utf8'), new RegExp(`param ${p} = readEnvironmentVariable`));
    }
    // Regime de rotina: o que o what-if da segunda execução e o CI usam não regrava nada.
    assert.equal(
      parameters.writeDerivedSecrets.value,
      false,
      'rotina não regrava segredos derivados',
    );
    assert.equal(parameters.deployBudget.value, false, 'rotina não regrava o orçamento');
    assert.equal(parameters.deployApps.value, true, 'rotina inclui os apps');
    // Cofre: prod protege contra purge e guarda 90 dias; dev fica solto (o nome volta a servir) com 7.
    const vault = name === 'prod' ? [true, 90] : [false, 7];
    assert.deepEqual(
      [parameters.purgeProtection.value, parameters.softDeleteRetentionDays.value],
      vault,
      `proteção contra purge e retenção do cofre de ${name}`,
    );
  });
}

test('bicep lint: limpo', () => {
  const r = bicep(['lint', MAIN], { withInputs: false });
  assert.equal(r.status, 0, r.err);
  assert.equal(`${r.out}${r.err}`.trim(), '', `lint:\n${r.out}${r.err}`);
});

test('bicepconfig.json mantém what-if-short-circuiting em erro (nome vindo de saída de módulo)', () => {
  // Sem isto o what-if da segunda execução não consegue olhar dentro dos módulos e não mostra "No change".
  const config = JSON.parse(readFileSync(join(INFRA, 'bicepconfig.json'), 'utf8'));
  assert.equal(config.analyzers.core.rules['what-if-short-circuiting'].level, 'error');
});

test('roles.bicep: cada GUID tem o nome da tabela da Microsoft, e a tabela inteira é usada', () => {
  const text = readFileSync(ROLES, 'utf8');
  const roles = [...text.matchAll(/^var \w+ = '([0-9a-f-]{36})' \/\/ (.+)$/gm)].map(
    ([, guid, name]) => [guid, name.trim()],
  );
  assert.equal(
    roles.length,
    (text.match(/^var /gm) ?? []).length,
    'toda var tem o nome depois de //',
  );
  for (const [guid, name] of roles) {
    assert.equal(
      BUILT_IN_ROLES.get(guid),
      name,
      `${guid} é "${BUILT_IN_ROLES.get(guid) ?? 'nenhum papel da tabela da Microsoft'}", e o roles.bicep diz "${name}"`,
    );
  }
  assert.deepEqual(roles.map(([guid]) => guid).sort(), [...BUILT_IN_ROLES.keys()].sort());
});

// A ordem dos módulos vem de dependsOn (os nomes são constantes: ver o topo do main.bicep). Quem lê um recurso
// criado por outro módulo tem de depender dele, senão o ARM pode começar os dois ao mesmo tempo.
// `identities` é o laço que cria as 7 identidades (uma por workload); no template compilado ele aparece pelo nome
// do copy, e quem depende dele cita esse nome.
const MODULE_DEPENDS_ON = {
  observability: ['keyvault'],
  // os alertas olham o workspace, o Service Bus, o banco e (no padrão) o Front Door: os nomes são constantes, a ordem vem daqui
  alerts: ['observability', 'servicebus', 'postgres', 'frontdoor'],
  storage: ['identities'],
  registry: ['identities'],
  servicebus: ['identities'],
  postgres: ['keyvault', 'network'],
  email: ['keyvault'],
  openai: ['identities'],
  containerenv: ['network', 'observability'],
  // O Front Door grava o front-door-id no cofre, dá o purge ao worker e manda o log do WAF ao workspace.
  frontdoor: ['keyvault', 'identities', 'observability', 'containerenv'],
  // Os apps leem: os segredos derivados (banco, e-mail, telemetria, Front Door), o AcrPull, o cofre e as
  // identidades. Service Bus, storage e ambiente entram pelas saídas dos módulos.
  apps: [
    'identities',
    'keyvault',
    'observability',
    'postgres',
    'email',
    'registry',
    'servicebus',
    'storage',
    'containerenv',
    'frontdoor',
  ],
};
test('ordem dos módulos: cada um depende dos que criam o que ele lê (dependsOn do template compilado)', () => {
  const r = bicep(['build', MAIN, '--stdout'], { withInputs: false });
  assert.equal(r.status, 0, r.err);
  const deployments = JSON.parse(r.out).resources.filter(
    (resource) => resource.type === 'Microsoft.Resources/deployments',
  );
  // Um laço de módulos (copy) vale pelo nome do copy; o dependsOn de quem o usa cita só esse nome.
  const graph = new Map(
    deployments.map((d) => [
      d.copy?.name ?? d.name,
      new Set(
        (d.dependsOn ?? []).map(
          (ref) => /'Microsoft\.Resources\/deployments',\s*'([^']+)'/.exec(ref)?.[1] ?? ref,
        ),
      ),
    ]),
  );
  for (const [module, dependencies] of Object.entries(MODULE_DEPENDS_ON)) {
    assert.ok(graph.has(module), `módulo ${module} não existe no template`);
    for (const dependency of dependencies) {
      assert.ok(
        graph.get(module).has(dependency),
        `${module} não depende de ${dependency}: dependsOn ${JSON.stringify([...graph.get(module)])}`,
      );
    }
  }
});

// Dentro do módulo dos apps a ordem é outra: os papéis de segredo (secretAccess, um por workload, no escopo de cada
// segredo) nascem ali mesmo, e todo app e job tem de esperar por eles. Sem o dependsOn o ARM cria o app ao mesmo tempo
// que o papel, e a referência ao Key Vault é recusada na criação (acesso negado, sem nada no template que avise). O
// template aninhado usa nomes simbólicos (languageVersion 2.0), e o dependsOn cita esses nomes.
test('ordem dos apps: todo app e job depende dos papéis de segredo (secretAccess) que o deixam ler o cofre', () => {
  const r = bicep(['build', MAIN, '--stdout'], { withInputs: false });
  assert.equal(r.status, 0, r.err);
  const apps = JSON.parse(r.out).resources.find(
    (resource) => resource.type === 'Microsoft.Resources/deployments' && resource.name === 'apps',
  );
  const { resources } = apps.properties.template;
  assert.equal(
    resources.secretAccess?.type,
    'Microsoft.Resources/deployments',
    'os papéis de segredo (laço secretAccess) nascem dentro do módulo dos apps',
  );
  const workloads = Object.entries(resources).filter(([, resource]) =>
    ['Microsoft.App/containerApps', 'Microsoft.App/jobs'].includes(resource.type),
  );
  assert.deepEqual(
    workloads.map(([name]) => name).sort(),
    ['api', 'decisions', 'migrate', 'schedulerJobs', 'web', 'worker'],
    'web, api, worker, decisões, os 7 agendadores (um laço) e migrate',
  );
  for (const [name, resource] of workloads) {
    assert.ok(
      (resource.dependsOn ?? []).includes('secretAccess'),
      `${name} não depende de secretAccess: dependsOn ${JSON.stringify(resource.dependsOn)}`,
    );
  }
});

// O papel de Blob e o de Service Bus têm como escopo o container e a fila que o próprio módulo declara, e por isso o Bicep gera a dependência:
// sem ela o ARM pode criar o papel antes do container ou da fila (a corrida que só aparece na Azure, de vez em quando). E nada é declarado duas
// vezes: o ARM recusa o template ("defined multiple times", a prévia de 07/11/2026, quando cada linha da matriz virava um `existing` da
// identidade e da fila). Então nenhum `existing` do tipo que o módulo cria, e todo laço de `existing` percorre uma lista sem repetição
// (union(…, [])). O que se afirma é o template compilado, no módulo aninhado (nomes simbólicos, languageVersion 2.0).
test('storage e Service Bus: o papel espera o container e a fila, e nenhum recurso é declarado duas vezes', () => {
  const r = bicep(['build', MAIN, '--stdout'], { withInputs: false });
  assert.equal(r.status, 0, r.err);
  const deployments = JSON.parse(r.out).resources.filter(
    (resource) => resource.type === 'Microsoft.Resources/deployments',
  );
  for (const [module, assignments, creates] of [
    ['storage', 'blobAccess', 'containers'],
    ['servicebus', 'access', 'queue'],
  ]) {
    const { resources, variables } = deployments.find((deployment) => deployment.name === module)
      .properties.template;
    assert.equal(
      resources[assignments]?.type,
      'Microsoft.Authorization/roleAssignments',
      `${module}: o laço ${assignments} (o papel de cada ${creates === 'queue' ? 'fila' : 'container'}) nasce no módulo`,
    );
    assert.ok(
      resources[creates],
      `${module}: o recurso ${creates} (o que o papel tem como escopo) nasce no módulo`,
    );
    const dependsOn = resources[assignments].dependsOn ?? [];
    assert.ok(
      dependsOn.some((entry) => entry === creates || entry.startsWith(`[format('${creates}[`)),
      `${module}: ${assignments} não depende de ${creates}: dependsOn ${JSON.stringify(dependsOn)}`,
    );
    for (const [name, resource] of Object.entries(resources).filter(([, r]) => r.existing)) {
      assert.notEqual(
        resource.type,
        resources[creates].type,
        `${module}: ${name} é um existing do mesmo tipo de ${creates}, o recurso declarado duas vezes`,
      );
      const list = /variables\('([^']+)'\)/.exec(resource.copy?.count ?? '')?.[1];
      assert.ok(
        !resource.copy || variables?.[list]?.startsWith('[union('),
        `${module}: o laço ${name} percorre ${resource.copy?.count}, que pode repetir nome (falta o union(…, []))`,
      );
    }
  }
});

test('a lista de variáveis em texto puro não contém nome de segredo', () => {
  for (const name of PLAIN_ENV) assert.doesNotMatch(name, SECRET_NAME, name);
});

test('o seed-secrets.sh semeia exatamente os segredos do Artur (§5.7)', () => {
  assert.deepEqual(
    seedPlan()
      .map((s) => s.name)
      .sort(),
    [...HAND_SECRETS].sort(),
  );
  const prompts = seedPlan()
    .filter((s) => s.kind === 'file')
    .map((s) => s.name);
  assert.deepEqual(prompts.sort(), ['prompt-arena', 'prompt-chat'], 'só os prompts vêm de arquivo');
});

// =================================================================================================
// 2. Invariantes dos dois perfis
// =================================================================================================
for (const profile of PROFILES) {
  const at = (what) => `[${profile}] ${what}`;

  test(
    at('Postgres 17 B1ms privado: sem acesso público, em sub-rede delegada, DNS privado'),
    () => {
      const m = profileModel(profile);
      const pg = m.one('Microsoft.DBforPostgreSQL/flexibleServers');
      assert.equal(pg.properties.version, '17');
      assert.equal(pg.sku.name, 'Standard_B1ms');
      assert.equal(pg.sku.tier, 'Burstable');
      assert.equal(pg.properties.storage.storageSizeGB, 32);
      assert.equal(pg.properties.backup.backupRetentionDays, 7);
      assert.equal(pg.properties.network.publicNetworkAccess, 'Disabled');
      const vnet = m.one('Microsoft.Network/virtualNetworks');
      const subnetId = pg.properties.network.delegatedSubnetResourceId;
      const subnet = vnet.properties.subnets.find((s) => subnetId.endsWith(`/subnets/${s.name}`));
      assert.ok(subnet, `sub-rede ${subnetId} não existe na VNet`);
      assert.equal(
        subnet.properties.delegations[0].properties.serviceName,
        'Microsoft.DBforPostgreSQL/flexibleServers',
      );
      const zone = m.one('Microsoft.Network/privateDnsZones');
      assert.match(zone.name, /\.postgres\.database\.azure\.com$/);
      assert.ok(
        pg.properties.network.privateDnsZoneArmResourceId.endsWith(`/privateDnsZones/${zone.name}`),
      );
      assert.equal(m.ofType('Microsoft.Network/privateDnsZones/virtualNetworkLinks').length, 1);
      assert.equal(m.ofType('Microsoft.DBforPostgreSQL/flexibleServers/firewallRules').length, 0);
      m.one('Microsoft.DBforPostgreSQL/flexibleServers/databases', 'alvesting');
    },
  );

  test(at('Postgres exige TLS no servidor e o database-url pede TLS ao cliente'), () => {
    const m = profileModel(profile);
    // Declarado, não herdado do padrão da Azure: uma mudança de padrão ou um ajuste manual não passa sem alerta.
    const transport = m.one(
      'Microsoft.DBforPostgreSQL/flexibleServers/configurations',
      'require_secure_transport',
    );
    assert.equal(transport.properties.value, 'on');
    // sslmode=require de propósito (ver o ponytail do postgres.bicep): é o único modo estrito que o pg e o motor
    // de migrations do Prisma entendem. disable, allow e prefer deixariam a conexão sem TLS.
    for (const secret of ['database-url', 'database-url-api']) {
      const url = m.one('Microsoft.KeyVault/vaults/secrets', secret);
      assert.match(
        String(url.properties.value),
        /sslmode=require(?![\w-])/,
        `sslmode do ${secret}`,
      );
    }
  });

  // O login de menor privilégio da api (etapa 10, onda 3d; ADR 0028): a ca-api usa o database-url-api no DATABASE_URL, e o job-migrate o recebe em
  // API_DATABASE_URL para o db:roles criar o login com a senha dele DEPOIS do migrate deploy. Nenhum outro workload o recebe, e a api nunca
  // mais recebe o login administrador.
  test(
    at(
      'login da api: a ca-api usa o database-url-api, o job-migrate cria o login depois do migrate deploy e ninguém mais o lê',
    ),
    () => {
      const m = profileModel(profile);
      const api = m.one('Microsoft.App/containerApps', 'ca-api');
      assert.equal(
        envOf(api).DATABASE_URL?.secretRef,
        'database-url-api',
        'ca-api: o DATABASE_URL é o login da api',
      );
      assert.ok(
        !api.properties.configuration.secrets.some((s) => s.name === 'database-url'),
        'ca-api não referencia o login administrador',
      );
      // o segredo: usuário alvesting_api, a senha vinda do ambiente (nunca no template), o banco alvesting e TLS pedido ao cliente
      const url = String(
        m.one('Microsoft.KeyVault/vaults/secrets', 'database-url-api').properties.value,
      );
      assert.match(
        url,
        /^\[format\('postgresql:\/\/\{0\}:\{1\}@\{2\}:5432\/\{3\}\?sslmode=require', 'alvesting_api', uriComponent\(parameters\('postgresApiPassword'\)\), reference\(.*\)\.fullyQualifiedDomainName, 'alvesting'\)\]$/,
      );
      // quem recebe o database-url-api: a api (DATABASE_URL) e o migrate (API_DATABASE_URL); o resto continua com o administrador
      const holders = m.workloads
        .filter((w) =>
          (w.properties.configuration.secrets ?? []).some((s) => s.name === 'database-url-api'),
        )
        .map((w) => w.name)
        .sort();
      assert.deepEqual(holders, ['ca-api', 'job-migrate']);
      for (const w of m.workloads) {
        const env = envOf(w);
        assert.equal(
          env.API_DATABASE_URL?.secretRef,
          w.name === 'job-migrate' ? 'database-url-api' : undefined,
          `${w.name}: API_DATABASE_URL`,
        );
        if (w.name !== 'ca-api' && env.DATABASE_URL) {
          assert.equal(
            env.DATABASE_URL.secretRef,
            'database-url',
            `${w.name}: login administrador`,
          );
        }
      }
      // o job-migrate: migrate deploy e, SÓ se ele deu certo, o db:roles (a migration cria o grupo; o login e a senha são do comando)
      const c = containersOf(m.one('Microsoft.App/jobs', 'job-migrate'))[0];
      assert.deepEqual(
        [...c.command, ...(c.args ?? [])],
        [
          'sh',
          '-c',
          'node node_modules/prisma/build/index.js migrate deploy && node dist/db-roles-cli.js',
        ],
      );
    },
  );

  test(at('Service Bus Basic com as 6 filas, entregas máximas e DLQ na expiração'), () => {
    const m = profileModel(profile);
    assert.equal(m.one('Microsoft.ServiceBus/namespaces').sku.name, 'Basic');
    // Sem chave SAS: só identidade (é o que a regra "Service Bus não tem segredo" do §5.7 supõe).
    assert.equal(m.one('Microsoft.ServiceBus/namespaces').properties.disableLocalAuth, true);
    const queues = Object.fromEntries(
      m.ofType('Microsoft.ServiceBus/namespaces/queues').map((q) => [q.name.split('/').pop(), q]),
    );
    assert.deepEqual(Object.keys(queues).sort(), Object.keys(QUEUES).sort());
    for (const [name, max] of Object.entries(QUEUES)) {
      const p = queues[name].properties;
      assert.equal(p.maxDeliveryCount, max, `entregas máximas de ${name}`);
      assert.equal(p.deadLetteringOnMessageExpiration, true, `DLQ na expiração de ${name}`);
      assert.notEqual(p.requiresSession, true, `${name} sem sessão (Basic)`);
      assert.notEqual(p.requiresDuplicateDetection, true, `${name} sem duplicata (Basic)`);
    }
  });

  test(
    at('segredos do Container Apps só como referência ao Key Vault; nenhum segredo em texto puro'),
    () => {
      const m = profileModel(profile);
      assert.ok(m.workloads.length >= 12, 'web, api, worker, decisões, 7 agendadores e migrate');
      for (const w of m.workloads) {
        const secrets = w.properties.configuration.secrets ?? [];
        for (const s of secrets) {
          assert.ok(m.isKeyVaultUrl(s), `${w.name}: ${s.name} sem keyVaultUrl do Key Vault`);
          assert.ok(s.identity, `${w.name}: ${s.name} sem identidade`);
          assert.equal(s.value, undefined, `${w.name}: ${s.name} com valor inline`);
        }
        for (const r of w.properties.configuration.registries ?? []) {
          assert.ok(r.identity, `${w.name}: registro sem identidade`);
          assert.equal(r.username, undefined, `${w.name}: registro com usuário`);
          assert.equal(r.passwordSecretRef, undefined, `${w.name}: registro com senha`);
        }
        // Segredo e registro só podem usar uma identidade anexada ao próprio workload.
        const attached = Object.keys(w.identity.userAssignedIdentities);
        for (const ref of [...secrets, ...(w.properties.configuration.registries ?? [])]) {
          assert.ok(
            attached.includes(ref.identity),
            `${w.name}: ${ref.name ?? ref.server} usa uma identidade que não está anexada a ele`,
          );
        }
        const known = new Set(secrets.map((s) => s.name));
        for (const e of containersOf(w).flatMap((c) => c.env ?? [])) {
          if (e.secretRef !== undefined) {
            assert.ok(
              known.has(e.secretRef),
              `${w.name}: ${e.name} aponta para segredo inexistente`,
            );
            assert.equal(e.value, undefined, `${w.name}: ${e.name} com secretRef e valor`);
          } else {
            assert.ok(PLAIN_ENV.has(e.name), `${w.name}: ${e.name} em texto puro fora da lista`);
            assert.doesNotMatch(e.name, SECRET_NAME, `${w.name}: ${e.name} parece segredo`);
            assert.doesNotMatch(
              String(e.value),
              SECRET_VALUE,
              `${w.name}: valor de ${e.name} parece segredo`,
            );
          }
        }
      }
    },
  );

  test(
    at(
      'web e api: mínimos e máximos do perfil, ingress externo, 3 probes, concorrência HTTP, revisões múltiplas',
    ),
    () => {
      const m = profileModel(profile);
      const [min, max] = SCALE[profile];
      for (const [name, concurrency] of [
        ['ca-web', '50'],
        ['ca-api', '30'],
      ]) {
        const app = m.one('Microsoft.App/containerApps', name);
        const { scale } = app.properties.template;
        assert.equal(scale.minReplicas, min, `${name} mínimo`);
        assert.equal(scale.maxReplicas, max, `${name} máximo`);
        const http = scale.rules.filter((r) => r.http);
        assert.equal(http.length, 1, `${name}: uma regra HTTP`);
        assert.equal(http[0].http.metadata.concurrentRequests, concurrency, `${name} concorrência`);
        assert.equal(app.properties.configuration.activeRevisionsMode, 'Multiple');
        // a api do econômico é interna (só o site a alcança, ADR 0039); no padrão, as duas são externas
        const external = !(name === 'ca-api' && profile === 'economico');
        assert.equal(
          app.properties.configuration.ingress.external,
          external,
          `${name}: ingress externo`,
        );
        assert.equal(app.properties.configuration.ingress.allowInsecure, false);
        const probes = containersOf(app)[0].probes;
        assert.deepEqual(probes.map((p) => p.type).sort(), ['Liveness', 'Readiness', 'Startup']);
        for (const p of probes) {
          assert.equal(p.httpGet.path, '/health', `${name}: probe ${p.type}`);
          // Probe numa porta que ninguém escuta derruba a revisão: tem de ser a do ingress.
          assert.equal(
            p.httpGet.port,
            app.properties.configuration.ingress.targetPort,
            `${name}: porta do probe ${p.type} = targetPort do ingress`,
          );
        }
        const resources = containersOf(app)[0].resources;
        assert.equal(Number(resources.cpu), 0.25);
        assert.equal(resources.memory, '0.5Gi');
      }
    },
  );

  test(
    at(
      'worker-data sem ingress, 0 a 3, uma regra KEDA azure-servicebus por fila com identidade gerenciada',
    ),
    () => {
      const m = profileModel(profile);
      const worker = m.one('Microsoft.App/containerApps', 'ca-worker-data');
      assert.equal(worker.properties.configuration.ingress, undefined, 'worker sem ingress');
      assert.equal(worker.properties.template.scale.minReplicas, 0);
      assert.equal(worker.properties.template.scale.maxReplicas, 3);
      const rules = worker.properties.template.scale.rules;
      assert.deepEqual(rules.map((r) => queueOfRule(r.custom)).sort(), [...WORKER_QUEUES].sort());
      // O KEDA procura as filas no namespace da regra: um nome que não é o do Service Bus criado aqui deixa o
      // worker em zero para sempre, sem erro nenhum.
      const namespace = m.one('Microsoft.ServiceBus/namespaces').name;
      for (const r of rules) {
        assert.equal(r.custom.type, 'azure-servicebus');
        assert.equal(r.custom.metadata.messageCount, '5');
        assert.equal(r.custom.metadata.namespace, namespace, `${r.name}: namespace da regra`);
        assert.ok(
          r.custom.identity?.endsWith('/userAssignedIdentities/id-alvesting-scale'),
          `${r.name}: a regra de escala usa a identidade do KEDA`,
        );
        assert.equal(r.custom.auth, undefined, `${r.name}: sem segredo de autenticação`);
      }
      // O código usa a id-alvesting-worker; a do KEDA vem junto, invisível a ele (lifecycle None).
      assert.deepEqual(identitiesOf(worker).sort(), [ID.scale, ID.worker].sort());
      for (const s of worker.properties.configuration.secrets) {
        assert.ok(s.identity.endsWith(`/${ID.worker}`), `${s.name}: referência pelo código`);
      }
      const c = containersOf(worker)[0];
      assert.deepEqual([...(c.command ?? []), ...(c.args ?? [])], ['node', 'dist/worker.js']);
      assert.equal(Number(c.resources.cpu), 0.5);
      assert.equal(c.resources.memory, '1Gi');
      // O worker espera os handlers em curso até 270 s ao parar (DRAIN_TIMEOUT_MS em messaging.service.ts; a brapi do eod
      // chega a 4 min). O padrão da plataforma é 30 s, e o SIGKILL chegaria no meio do eod: o prazo tem de cobrir os 270 s.
      assert.equal(
        worker.properties.template.terminationGracePeriodSeconds,
        300,
        'prazo do SIGTERM',
      );
    },
  );

  test(
    at('7 agendadores com os crons UTC do §6, sem ingress, rodando node dist/schedule.js <nome>'),
    () => {
      const m = profileModel(profile);
      const jobs = m.ofType('Microsoft.App/jobs').filter((j) => j.name.startsWith('job-sched-'));
      assert.equal(jobs.length, 7);
      for (const [name, cron] of Object.entries(CRONS)) {
        const job = m.one('Microsoft.App/jobs', `job-sched-${name}`);
        const { configuration } = job.properties;
        assert.equal(configuration.triggerType, 'Schedule');
        assert.equal(configuration.scheduleTriggerConfig.cronExpression, cron, `cron de ${name}`);
        assert.equal(configuration.ingress, undefined, `${name}: sem ingress`);
        const c = containersOf(job)[0];
        assert.deepEqual([...c.command, ...(c.args ?? [])], ['node', 'dist/schedule.js', name]);
        assert.equal(Number(c.resources.cpu), 0.25);
        assert.equal(c.resources.memory, '0.5Gi');
      }
    },
  );

  // A política de privacidade promete o PIOR CASO do cadastro nunca confirmado: 7 dias depois de criado. É o corte do código (RETENTION_DAYS.user)
  // mais a espera até a limpeza seguinte, e a espera só é de 1 dia se a limpeza roda todo dia. Os dois andam juntos: cron diário e corte de 6 dias.
  test(
    at(
      'a limpeza (retention) roda todo dia, e o corte do cadastro não confirmado é de 6 dias: 6 + 1 = os 7 dias da política',
    ),
    () => {
      const job = profileModel(profile).one('Microsoft.App/jobs', 'job-sched-retention');
      const cron = job.properties.configuration.scheduleTriggerConfig.cronExpression;
      const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(' ');
      assert.match(`${minute} ${hour}`, /^\d+ \d+$/, `hora fixa, uma vez por dia (veio "${cron}")`);
      assert.deepEqual(
        [dayOfMonth, month, dayOfWeek],
        ['*', '*', '*'],
        `a limpeza tem de ser diária (veio "${cron}"): semanal deixaria o cadastro não confirmado até 14 dias, e a política diz 7`,
      );
      const source = readFileSync(
        join(dirname(INFRA), 'apps/api/src/modules/maintenance/application/retention.handler.ts'),
        'utf8',
      );
      assert.match(
        source,
        /RETENTION_DAYS[^=]*=\s*\{\s*user: 6,/,
        'RETENTION_DAYS.user = 6: 7 dias prometidos menos 1 dia até a limpeza diária',
      );
    },
  );

  test(
    at(
      'job de decisões: por evento na fila decisions, 1 mensagem = 1 execução, até 10 em paralelo, 1500 s',
    ),
    () => {
      const m = profileModel(profile);
      const job = m.one('Microsoft.App/jobs', 'job-worker-decisions');
      const { configuration } = job.properties;
      assert.equal(configuration.triggerType, 'Event');
      assert.equal(configuration.replicaTimeout, 1500);
      // O código calcula o tempo de cada chamada ao modelo a partir deste mesmo valor (REPLICA_TIMEOUT_MS): os dois têm de
      // andar juntos, ou a chamada passa do que o Container Apps deixa o job viver.
      const timeoutSource = readFileSync(
        join(dirname(INFRA), 'apps/api/src/modules/arena/domain/call-timeout.ts'),
        'utf8',
      );
      assert.match(
        timeoutSource,
        new RegExp(
          `REPLICA_TIMEOUT_MS = ${(configuration.replicaTimeout * 1000).toLocaleString('en-US').replaceAll(',', '_')}`,
        ),
        'REPLICA_TIMEOUT_MS = replicaTimeout x 1000',
      );
      assert.equal(configuration.ingress, undefined);
      const trigger = configuration.eventTriggerConfig;
      // 10 execuções simultâneas (scale.maxExecutions), cada uma com 1 réplica que trata 1 mensagem.
      assert.equal(trigger.scale.maxExecutions, 10);
      assert.equal(trigger.scale.minExecutions, 0);
      assert.equal(trigger.parallelism, 1);
      assert.equal(trigger.replicaCompletionCount, 1);
      assert.equal(trigger.scale.rules.length, 1);
      const [rule] = trigger.scale.rules;
      assert.equal(rule.type, 'azure-servicebus');
      assert.equal(rule.metadata.queueName, 'decisions');
      assert.equal(rule.metadata.messageCount, '1');
      assert.equal(
        rule.metadata.namespace,
        m.one('Microsoft.ServiceBus/namespaces').name,
        'namespace da regra = o do Service Bus criado aqui',
      );
      assert.ok(
        rule.identity?.endsWith('/userAssignedIdentities/id-alvesting-scale'),
        'a regra de escala usa a identidade do KEDA',
      );
      assert.deepEqual(identitiesOf(job).sort(), [ID.decisions, ID.scale].sort());
      const c = containersOf(job)[0];
      assert.deepEqual([...c.command, ...(c.args ?? [])], ['node', 'dist/decide.js']);
      assert.equal(Number(c.resources.cpu), 0.5);
      assert.equal(c.resources.memory, '1Gi');
    },
  );

  test(at('job-migrate manual; uma imagem da api para todos os papéis do back'), () => {
    const m = profileModel(profile);
    const migrate = m.one('Microsoft.App/jobs', 'job-migrate');
    assert.equal(migrate.properties.configuration.triggerType, 'Manual');
    assert.ok(containersOf(migrate)[0].command.join(' ').includes('prisma'));
    const apiImages = new Set(
      [
        m.one('Microsoft.App/containerApps', 'ca-api'),
        m.one('Microsoft.App/containerApps', 'ca-worker-data'),
        ...m.ofType('Microsoft.App/jobs'),
      ].map((r) => containersOf(r)[0].image),
    );
    assert.equal(apiImages.size, 1, `imagens do back: ${[...apiImages].join(', ')}`);
    const web = containersOf(m.one('Microsoft.App/containerApps', 'ca-web'))[0].image;
    assert.ok(!apiImages.has(web), 'web usa a própria imagem');
  });

  test(
    at('papéis: cada identidade com o mínimo (nome pela tabela da Microsoft) e nada além'),
    () => {
      const m = profileModel(profile);
      assert.deepEqual(
        m
          .ofType('Microsoft.ManagedIdentity/userAssignedIdentities')
          .map((i) => i.name)
          .sort(),
        [...ALL_IDENTITIES].sort(),
        'uma identidade por workload e a do KEDA, nenhuma outra',
      );
      // Lista exata (ver expectedGrants): cada workload lê só os segredos dele, no escopo do segredo; a do KEDA só
      // tem Data Owner; ninguém lê o cofre inteiro; e quem implanta (Key Vault Secrets Officer) semeia os segredos.
      assert.deepEqual(m.grants(), expectedGrants({ padrao: profile === 'padrao', openai: false }));
      for (const r of m.ofType('Microsoft.Authorization/roleAssignments')) {
        const isAdmin = r.properties.principalId === INPUT_ENV.ALVESTING_ADMIN_PRINCIPAL_ID;
        assert.equal(r.properties.principalType, isAdmin ? 'User' : 'ServicePrincipal', r.id);
      }
    },
  );

  test(
    at(
      'identidades: cada workload só com a sua; a do web, a do migrate e a do KEDA são da plataforma',
    ),
    () => {
      const m = profileModel(profile);
      const lifecycles = (w) =>
        Object.fromEntries(
          (w.properties.configuration.identitySettings ?? []).map((s) => [
            s.identity.split('/').pop(),
            s.lifecycle,
          ]),
        );
      for (const w of m.workloads) {
        const code = codeIdentityOf(w.name);
        assert.ok(code, `${w.name}: workload sem identidade no oráculo`);
        const keda = KEDA_WORKLOADS.includes(w.name);
        assert.deepEqual(
          identitiesOf(w).sort(),
          (keda ? [code, ID.scale] : [code]).sort(),
          `${w.name}: identidades anexadas (a de nenhum outro workload)`,
        );
        // lifecycle None: o token não fica disponível ao código do container. Vale para o que a plataforma usa
        // sozinha (pull da imagem, referência de segredo, regra de escala); o resto usa o SDK da Azure.
        const onlyPlatform = platformOnlyOf(profile);
        const platformOnly = {
          ...(w.name in onlyPlatform ? { [onlyPlatform[w.name]]: 'None' } : {}),
          ...(keda ? { [ID.scale]: 'None' } : {}),
          ...(profile === 'economico' && w.name === 'job-migrate' ? { [ID.migrate]: 'Main' } : {}),
        };
        assert.deepEqual(lifecycles(w), platformOnly, `${w.name}: lifecycle das identidades`);
      }
    },
  );

  test(
    at('cada workload referencia exatamente os segredos que a identidade dele lê, e por ela'),
    () => {
      const m = profileModel(profile);
      const grants = m.grants();
      for (const w of m.workloads) {
        const identity = codeIdentityOf(w.name);
        const readable = grants
          .filter((g) => g.startsWith(`${identity} | Key Vault Secrets User | `))
          .map((g) => g.split('/secrets/').pop())
          .sort();
        const secrets = w.properties.configuration.secrets ?? [];
        assert.deepEqual(
          secrets.map((s) => s.name).sort(),
          readable,
          `${w.name}: segredos referenciados × segredos legíveis (nem um a mais, nem a menos)`,
        );
        for (const s of secrets) {
          assert.ok(
            s.identity.endsWith(`/${identity}`),
            `${w.name}/${s.name}: lido pela ${identity}`,
          );
        }
      }
    },
  );

  test(
    at('segredo por workload: o prompt, a chave do LLM, o token e o banco só a quem serve'),
    () => {
      const m = profileModel(profile);
      const grants = m.grants();
      const readers = (secret) =>
        grants
          .filter(
            (g) => g.includes('| Key Vault Secrets User |') && g.endsWith(`/secrets/${secret}`),
          )
          .map((g) => g.split(' | ')[0])
          .sort();
      // Nenhuma identidade lê o cofre inteiro: o único papel no escopo do cofre é o de quem semeia.
      assert.deepEqual(
        grants.filter((g) => g.endsWith(`| ${vaultScope}`)),
        [`admin | Key Vault Secrets Officer | ${vaultScope}`],
      );
      assert.deepEqual(
        readers('prompt-arena'),
        [ID.decisions],
        'prompt-arena: só o job de decisões',
      );
      assert.deepEqual(readers('openrouter-api-key'), [ID.decisions]);
      assert.deepEqual(readers('brapi-token'), [ID.worker]);
      assert.deepEqual(readers('prompt-chat'), [], 'prompt-chat: ninguém com o chat desligado');
      for (const secret of [
        'better-auth-secret',
        'google-oauth-client-secret',
        'acs-connection-string',
      ]) {
        assert.deepEqual(readers(secret), [ID.api], `${secret}: só a api`);
      }
      assert.deepEqual(readers('revalidate-secret'), [ID.web, ID.worker].sort());
      assert.deepEqual(
        readers('quotes-secret'),
        [ID.web, ID.api].sort(),
        'quotes-secret: só o web (que o manda) e a api (que o confere)',
      );
      // O login administrador: quem não é exposto à internet e o migrate. A api (a única exposta, ADR 0028) NÃO o lê; ela e o migrate (que
      // cria o login dela) leem o de menor privilégio.
      assert.deepEqual(
        readers('database-url'),
        [ID.worker, ID.decisions, ID.sched, ID.migrate].sort(),
        'database-url: o administrador, só de quem não é exposto (o web não consulta o banco)',
      );
      assert.deepEqual(
        readers('database-url-api'),
        [ID.api, ID.migrate].sort(),
        'database-url-api: o login da api, só da api e de quem o cria',
      );
      // O que o web, a api e o worker-data NÃO leem (o achado major do fechamento da etapa 2).
      for (const identity of [ID.web, ID.api, ID.worker]) {
        for (const secret of ['prompt-arena', 'openrouter-api-key']) {
          assert.ok(!readers(secret).includes(identity), `${identity} não lê ${secret}`);
        }
      }
    },
  );

  test(
    at(
      'AZURE_CLIENT_ID de cada workload é o client ID da identidade DELE (o DefaultAzureCredential precisa)',
    ),
    () => {
      const m = profileModel(profile);
      for (const w of m.workloads) {
        const value = envOf(w).AZURE_CLIENT_ID?.value;
        if (w.name in platformOnlyOf(profile)) {
          // O código do web e do migrate não recebe token (lifecycle None): não há o que apontar.
          assert.equal(value, undefined, `${w.name}: sem AZURE_CLIENT_ID`);
          continue;
        }
        // O snapshot deixa a expressão: [reference('.../userAssignedIdentities/<nome>', '...').clientId]
        const named = /userAssignedIdentities\/([^'/]+)'.*\.clientId\]$/.exec(String(value))?.[1];
        assert.equal(named, codeIdentityOf(w.name), `${w.name}: AZURE_CLIENT_ID`);
      }
    },
  );

  test(
    at(
      'Storage v2 LRS: containers, ciclo de vida hot para cool em 30 dias, sem chave compartilhada',
    ),
    () => {
      const m = profileModel(profile);
      const st = m.one('Microsoft.Storage/storageAccounts');
      assert.equal(st.kind, 'StorageV2');
      assert.equal(st.sku.name, 'Standard_LRS');
      assert.equal(st.properties.allowBlobPublicAccess, false);
      assert.equal(st.properties.allowSharedKeyAccess, false);
      assert.equal(st.properties.minimumTlsVersion, 'TLS1_2');
      assert.equal(st.properties.supportsHttpsTrafficOnly, true, 'só HTTPS');
      assert.equal(st.properties.defaultToOAuthAuthentication, true, 'Entra por padrão');
      const containers = m
        .ofType('Microsoft.Storage/storageAccounts/blobServices/containers')
        .map((c) => c.name.split('/').pop());
      assert.deepEqual(containers.sort(), ['backups', 'briefings', 'llm-io']);
      const rules = m.one('Microsoft.Storage/storageAccounts/managementPolicies').properties.policy
        .rules;
      const cool = rules.find((r) => r.definition.actions.baseBlob.tierToCool);
      assert.equal(
        cool.definition.actions.baseBlob.tierToCool.daysAfterModificationGreaterThan,
        30,
      );
    },
  );

  // SEM política de imutabilidade em container nenhum (ADR 0030): uma política travada impede apagar a conta de armazenamento até a retenção
  // vencer (armadilha com crédito de estudante: o resource group de teste não se apaga), e o SHA-256 que o banco guarda de cada blob já
  // acusa adulteração. Quem a quiser liga de propósito e muda este teste. Fica a exclusão lógica de 7 dias (apagar por engano não é definitivo).
  test(
    at('Storage sem política de imutabilidade em nenhum container; exclusão lógica de 7 dias'),
    () => {
      const m = profileModel(profile);
      assert.equal(
        m.ofType('Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies')
          .length,
        0,
        'nenhuma política de imutabilidade',
      );
      const st = m.one('Microsoft.Storage/storageAccounts');
      assert.equal(
        st.properties.immutableStorageWithVersioning,
        undefined,
        'imutabilidade da conta',
      );
      for (const c of m.ofType('Microsoft.Storage/storageAccounts/blobServices/containers')) {
        assert.equal(
          c.properties?.immutableStorageWithVersioning,
          undefined,
          `${c.name}: imutabilidade`,
        );
      }
      const service = m.one('Microsoft.Storage/storageAccounts/blobServices');
      assert.deepEqual(service.properties.deleteRetentionPolicy, { enabled: true, days: 7 });
      assert.deepEqual(service.properties.containerDeleteRetentionPolicy, {
        enabled: true,
        days: 7,
      });
    },
  );

  test(
    at('Key Vault Standard com RBAC; o Bicep só cria segredos derivados, nunca os do Artur'),
    () => {
      const m = profileModel(profile);
      const kv = m.one('Microsoft.KeyVault/vaults');
      assert.equal(kv.properties.sku.name, 'standard');
      assert.equal(kv.properties.enableRbacAuthorization, true);
      // O cofre guarda os prompts, que só existem ali. Exclusão lógica e, em prod, proteção contra purge com
      // 90 dias (o dev usa 7 e sem proteção: ver o teste dos .bicepparam). Os 90 dias não mudam depois.
      assert.equal(kv.properties.enableSoftDelete, true);
      assert.equal(kv.properties.enablePurgeProtection, true, 'prod: proteção contra purge');
      assert.equal(kv.properties.softDeleteRetentionInDays, 90, 'prod: retenção de 90 dias');
      const created = m.secretNames();
      for (const name of created) {
        assert.ok(DERIVED_SECRETS.includes(name), `segredo ${name} não é derivado`);
        assert.ok(!HAND_SECRETS.includes(name), `${name} é do Artur: o Bicep não pode criar`);
      }
      const expected = [
        'database-url',
        'database-url-api',
        'acs-connection-string',
        'appinsights-connection-string',
      ];
      if (profile === 'padrao') expected.push('front-door-id');
      assert.deepEqual([...created].sort(), expected.sort());
    },
  );

  test(
    at(
      'segredos referenciados: cada um é derivado (fase 1) ou semeado antes da fase 2; o prompt só vai ao job de decisões',
    ),
    () => {
      const m = profileModel(profile);
      const created = new Set(m.secretNames());
      const seeded = new Set(seedPlan().map((s) => s.name));
      const referencedBy = (name) =>
        m.workloads
          .filter((w) => (w.properties.configuration.secrets ?? []).some((s) => s.name === name))
          .map((w) => w.name);
      const referenced = new Set(
        m.workloads.flatMap((w) => (w.properties.configuration.secrets ?? []).map((s) => s.name)),
      );
      for (const name of referenced) {
        assert.ok(created.has(name) || seeded.has(name), `${name}: ninguém o cria antes da fase 2`);
      }
      // Os prompts nunca ficam provisórios no seed (só de arquivo): quem os referencia exige o arquivo antes da
      // fase 2. O da arena é do job de decisões; o do chat só entra com enableOpenAI (teste [openai]).
      assert.deepEqual(referencedBy('prompt-arena'), ['job-worker-decisions']);
      assert.deepEqual(
        referencedBy('prompt-chat'),
        [],
        'chat desligado: nada referencia o prompt-chat',
      );
    },
  );

  test(
    at(
      'prompt da arena: PROMPT_ARENA por referência ao Key Vault (versão fixa), PROMPT_ARENA_VERSION sem segredo, só nas decisões',
    ),
    () => {
      const m = profileModel(profile);
      const version = INPUT_ENV.ALVESTING_PROMPT_ARENA_VERSION;
      const job = m.one('Microsoft.App/jobs', 'job-worker-decisions');
      const env = envOf(job);
      assert.equal(env.PROMPT_ARENA?.secretRef, 'prompt-arena');
      assert.equal(env.PROMPT_ARENA.value, undefined, 'o texto nunca em valor literal');
      const secret = job.properties.configuration.secrets.find((s) => s.name === 'prompt-arena');
      assert.ok(m.isKeyVaultUrl(secret), 'referência ao Key Vault');
      // Versão fixa no URI: o conteúdo só muda por um deploy, e a versão do ciclo é a que está no ambiente.
      assert.ok(secret.keyVaultUrl.includes(version), `URI com a versão ${version}`);
      assert.equal(env.PROMPT_ARENA_VERSION?.value, version);
      assert.equal(env.PROMPT_ARENA_VERSION.secretRef, undefined);
      assert.match(env.PROMPT_ARENA_VERSION.value, /^[0-9a-f]{32}$/);
      for (const w of m.workloads) {
        if (w.name === 'job-worker-decisions') continue;
        for (const name of Object.keys(envOf(w))) {
          // a única exceção é a VERSÃO (não é segredo) no job-sched-cycle e na api (as rotas /admin reprocessam o ciclo); o texto do
          // prompt, em nenhum outro
          if (['job-sched-cycle', 'ca-api'].includes(w.name) && name === 'PROMPT_ARENA_VERSION')
            continue;
          assert.ok(!name.startsWith('PROMPT_'), `${w.name}: sem ${name}`);
        }
      }
    },
  );

  test(
    at(
      'sched-cycle: recebe só a versão do prompt e o teto de custo do mês (texto puro), e só ele entre os agendadores (a api também, no teste de admin abaixo); sem o segredo do prompt',
    ),
    () => {
      const m = profileModel(profile);
      const cycle = m.one('Microsoft.App/jobs', 'job-sched-cycle');
      const env = envOf(cycle);
      assert.equal(env.PROMPT_ARENA_VERSION?.value, INPUT_ENV.ALVESTING_PROMPT_ARENA_VERSION);
      assert.equal(env.PROMPT_ARENA_VERSION.secretRef, undefined);
      // dólares inteiros, em texto (o app lê como decimal exato, sem float)
      assert.match(env.ARENA_MONTHLY_COST_CAP_USD?.value ?? '', /^\d+$/);
      assert.equal(env.ARENA_MONTHLY_COST_CAP_USD.secretRef, undefined);
      // a identidade do agendador não lê o prompt nem a chave do OpenRouter: nenhuma referência a eles no job
      const refs = cycle.properties.configuration.secrets.map((s) => s.name).sort();
      assert.deepEqual(refs, ['appinsights-connection-string', 'database-url']);
      for (const name of ['PROMPT_ARENA', 'OPENROUTER_API_KEY']) {
        assert.equal(env[name], undefined, `job-sched-cycle: sem ${name}`);
      }
      // os outros seis agendadores não levam nenhuma das duas
      for (const w of m.workloads) {
        if (!w.name.startsWith('job-sched-') || w.name === 'job-sched-cycle') continue;
        for (const name of ['PROMPT_ARENA_VERSION', 'ARENA_MONTHLY_COST_CAP_USD']) {
          assert.equal(envOf(w)[name], undefined, `${w.name}: sem ${name}`);
        }
      }
    },
  );

  test(
    at(
      'admin (etapa 10): a api recebe a versão do prompt e o teto de custo do mês em texto puro (reprocessar o ciclo, painel de custos), nunca o texto do prompt nem a chave do OpenRouter nem o Service Bus falso',
    ),
    () => {
      const m = profileModel(profile);
      const api = m.one('Microsoft.App/containerApps', 'ca-api');
      const env = envOf(api);
      assert.equal(env.PROMPT_ARENA_VERSION?.value, INPUT_ENV.ALVESTING_PROMPT_ARENA_VERSION);
      assert.equal(env.PROMPT_ARENA_VERSION.secretRef, undefined);
      assert.match(env.ARENA_MONTHLY_COST_CAP_USD?.value ?? '', /^\d+$/);
      assert.equal(env.ARENA_MONTHLY_COST_CAP_USD.secretRef, undefined);
      // o mesmo valor do agendador: o ciclo reprocessado fixa a versão que o agendador fixaria, e o painel compara com o mesmo teto
      const cycle = envOf(m.one('Microsoft.App/jobs', 'job-sched-cycle'));
      assert.equal(env.PROMPT_ARENA_VERSION.value, cycle.PROMPT_ARENA_VERSION.value);
      assert.equal(env.ARENA_MONTHLY_COST_CAP_USD.value, cycle.ARENA_MONTHLY_COST_CAP_USD.value);
      for (const name of ['PROMPT_ARENA', 'OPENROUTER_API_KEY', 'SERVICEBUS_FAKE_DIR']) {
        assert.equal(env[name], undefined, `ca-api: sem ${name}`);
      }
      // nem o segredo do prompt nem o da chave estão entre as referências da api
      const refs = api.properties.configuration.secrets.map((s) => s.name);
      for (const secret of ['prompt-arena', 'openrouter-api-key']) {
        assert.ok(!refs.includes(secret), `ca-api: sem o segredo ${secret}`);
      }
    },
  );

  test(
    at(
      'conta (etapa 11): a api recebe remetente, controlador, contato e client ID do Google em texto puro; os segredos da conta, por referência; nenhum outro workload leva nada disto',
    ),
    () => {
      const m = profileModel(profile);
      const api = envOf(m.one('Microsoft.App/containerApps', 'ca-api'));
      assert.equal(api.LEGAL_CONTROLLER_NAME?.value, INPUT_ENV.ALVESTING_LEGAL_CONTROLLER_NAME);
      assert.equal(api.LEGAL_CONTACT_EMAIL?.value, INPUT_ENV.ALVESTING_LEGAL_CONTACT_EMAIL);
      assert.equal(api.GOOGLE_CLIENT_ID?.value, INPUT_ENV.ALVESTING_GOOGLE_CLIENT_ID);
      // o remetente sai do domínio gerenciado (saída do email.bicep), em texto puro
      assert.notEqual(api.EMAIL_SENDER_ADDRESS?.value, undefined, 'EMAIL_SENDER_ADDRESS em valor');
      assert.equal(api.EMAIL_SENDER_ADDRESS.secretRef, undefined);
      // os três segredos da conta vão por referência ao Key Vault, nunca em valor literal
      for (const [name, secret] of [
        ['BETTER_AUTH_SECRET', 'better-auth-secret'],
        ['GOOGLE_CLIENT_SECRET', 'google-oauth-client-secret'],
        ['ACS_CONNECTION_STRING', 'acs-connection-string'],
      ]) {
        assert.equal(api[name]?.secretRef, secret, name);
        assert.equal(api[name].value, undefined, `${name}: sem valor literal`);
      }
      // o remetente falso (EMAIL_OUTBOX_DIR) não existe na Azure: a api o recusa em produção, e a infra nunca o injeta
      assert.equal(api.EMAIL_OUTBOX_DIR, undefined);
      for (const w of m.workloads) {
        if (w.name === 'ca-api') continue;
        for (const name of [
          'BETTER_AUTH_SECRET',
          'GOOGLE_CLIENT_SECRET',
          'GOOGLE_CLIENT_ID',
          'ACS_CONNECTION_STRING',
          'EMAIL_SENDER_ADDRESS',
          'LEGAL_CONTROLLER_NAME',
          'LEGAL_CONTACT_EMAIL',
          'EMAIL_OUTBOX_DIR',
        ]) {
          assert.equal(envOf(w)[name], undefined, `${w.name}: sem ${name}`);
        }
      }
    },
  );

  test(at('observabilidade, e-mail e orçamento'), () => {
    const m = profileModel(profile);
    const workspace = m.one('Microsoft.OperationalInsights/workspaces', 'log-alvesting');
    // O AuditEvent do cofre (quem leu o prompt) herda a retenção do workspace. A temporada dura ~20 pregões (~4
    // semanas) e um vazamento descoberto depois dos 30 dias não deixaria trilha: 90 dias cobrem a temporada e a
    // descoberta (docs/INFRA.md, 3.1).
    assert.ok(
      workspace.properties.retentionInDays >= 90,
      `retenção do workspace: ${workspace.properties.retentionInDays} dias (mínimo 90, a trilha do prompt)`,
    );
    m.one('Microsoft.Insights/components', 'appi-alvesting');
    const email = m.one('Microsoft.Communication/emailServices/domains', 'AzureManagedDomain');
    assert.equal(email.properties.domainManagement, 'AzureManaged');
    assert.equal(
      m.one('Microsoft.Communication/communicationServices').properties.linkedDomains.length,
      1,
    );
    const budget = m.one('Microsoft.Consumption/budgets');
    const thresholds = Object.values(budget.properties.notifications).map((n) => n.threshold);
    assert.deepEqual(
      thresholds.sort((a, b) => a - b),
      [50, 80, 100],
    );
    for (const n of Object.values(budget.properties.notifications)) {
      assert.deepEqual(n.contactEmails, [INPUT_ENV.ALVESTING_BUDGET_EMAIL]);
      assert.equal(n.enabled, true);
    }
    assert.equal(budget.properties.timeGrain, 'Annually');
    assert.equal(budget.properties.timePeriod.startDate, '2026-11-01');
  });

  test(
    at(
      'alertas de operação: grupo de ações por e-mail, cada alerta com severidade, detecção em até 10 minutos e ligado ao grupo',
    ),
    () => {
      const m = profileModel(profile);
      const group = m.one('Microsoft.Insights/actionGroups', 'ag-alvesting');
      assert.deepEqual(
        group.properties.emailReceivers.map((r) => r.emailAddress),
        [INPUT_ENV.ALVESTING_BUDGET_EMAIL],
        'o mesmo e-mail do orçamento',
      );
      assert.ok(group.properties.emailReceivers.every((r) => r.useCommonAlertSchema === true));
      assert.equal(group.properties.enabled, true);
      assert.ok(
        group.properties.groupShortName.length <= 12,
        'nome curto do grupo: até 12 caracteres',
      );
      const linkedToGroup = (id) => String(id).toLowerCase().endsWith('/actiongroups/ag-alvesting');

      // métricas da plataforma: no econômico não há Front Door, e os dois alertas da borda não existem
      const expected = Object.entries(METRIC_ALERTS).filter(
        ([, want]) => profile === 'padrao' || !want.padraoOnly,
      );
      assert.deepEqual(
        m
          .ofType('Microsoft.Insights/metricAlerts')
          .map((r) => r.name)
          .sort(),
        expected.map(([name]) => name).sort(),
        'os alertas de métrica do perfil',
      );
      for (const [name, want] of expected) {
        const p = m.one('Microsoft.Insights/metricAlerts', name).properties;
        assert.equal(p.enabled, true, `${name}: ligado`);
        assert.equal(p.severity, want.severity, `${name}: severidade`);
        assert.ok(Number.isInteger(p.severity) && p.severity >= 0 && p.severity <= 4);
        assert.deepEqual(
          p.scopes.map((s) => s.split('/providers/')[1]),
          [ALERT_SCOPES[want.on]],
          `${name}: escopo`,
        );
        assert.equal(p.actions.length, 1, `${name}: ligado ao grupo de ações`);
        assert.ok(linkedToGroup(p.actions[0].actionGroupId), `${name}: grupo de ações`);
        assert.equal(p.autoMitigate, true, `${name}: sai do alerta sozinho`);
        const frequency = isoMinutes(p.evaluationFrequency);
        const window = isoMinutes(p.windowSize);
        // a janela é a escrita à mão aqui (5 minutos, salvo a exceção declarada), e o teto de detecção é o de 10 minutos, salvo a mesma exceção
        assert.equal(p.windowSize, want.window ?? 'PT5M', `${name}: janela`);
        const limit = want.maxMinutes ?? ALERT_MAX_MINUTES;
        assert.ok(
          frequency + window + ALERT_LATENCY_MINUTES <= limit,
          `${name}: frequência ${frequency} + janela ${window} + latência ${ALERT_LATENCY_MINUTES} passa de ${limit} minutos`,
        );
        assert.equal(
          p.criteria['odata.type'],
          'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria',
        );
        assert.equal(p.criteria.allOf.length, 1, `${name}: uma condição`);
        const [c] = p.criteria.allOf;
        assert.deepEqual(
          [
            c.criterionType,
            c.metricNamespace,
            c.metricName,
            c.timeAggregation,
            c.operator,
            c.threshold,
          ],
          [
            'StaticThresholdCriterion',
            want.namespace,
            want.metric,
            want.aggregation,
            want.operator,
            want.threshold,
          ],
          `${name}: a condição`,
        );
        assert.deepEqual(
          Object.fromEntries((c.dimensions ?? []).map((d) => [d.name, d.values])),
          want.dimensions,
          `${name}: dimensões`,
        );
        assert.ok((c.dimensions ?? []).every((d) => d.operator === 'Include'));
      }

      // sinais da aplicação: uma regra de log sobre o stdout dos contêineres
      const log = m.one('Microsoft.Insights/scheduledQueryRules', LOG_ALERT).properties;
      assert.equal(m.one('Microsoft.Insights/scheduledQueryRules', LOG_ALERT).kind, 'LogAlert');
      assert.equal(log.enabled, true);
      assert.equal(log.severity, 2);
      assert.deepEqual(
        log.scopes.map((s) => s.split('/providers/')[1]),
        ['Microsoft.OperationalInsights/workspaces/log-alvesting'],
      );
      assert.equal(log.autoMitigate, true, 'um e-mail por incidente, e outro quando passa');
      assert.deepEqual(log.actions.actionGroups.map(linkedToGroup), [true]);
      const logFrequency = isoMinutes(log.evaluationFrequency);
      const logWindow = isoMinutes(log.windowSize);
      assert.ok(
        logFrequency + ALERT_LATENCY_MINUTES <= ALERT_MAX_MINUTES,
        `sinais da aplicação: frequência ${logFrequency} + latência ${ALERT_LATENCY_MINUTES} passa de ${ALERT_MAX_MINUTES} minutos`,
      );
      assert.ok(
        logFrequency >= 5,
        'abaixo de 5 minutos a regra de log custa o dobro e tem limitações de consulta',
      );
      assert.ok(
        logWindow >= logFrequency && logWindow <= 30,
        'a janela cobre a frequência e não passa de 30 minutos',
      );
      // o skipQueryValidation existe porque a tabela de logs só nasce com o primeiro contêiner (a regra é criada na fase 1)
      assert.equal(log.skipQueryValidation, true);
      const [condition] = log.criteria.allOf;
      assert.equal(log.criteria.allOf.length, 1);
      assert.deepEqual(
        [condition.timeAggregation, condition.operator, condition.threshold],
        ['Count', 'GreaterThan', 0],
      );
      assert.deepEqual(condition.dimensions, [
        { name: 'sinal', operator: 'Include', values: ['*'] },
      ]);
      // a consulta lê a tabela que o ambiente do Container Apps de fato alimenta
      const env = m.one('Microsoft.App/managedEnvironments', 'cae-alvesting');
      assert.equal(env.properties.appLogsConfiguration.destination, 'log-analytics');
      assert.match(condition.query, /^ContainerAppConsoleLogs_CL$/m);
      // e procura as linhas que o código escreve, com o texto e os limiares da constante
      for (const key of Object.keys(ALERT_LOG)) {
        assert.ok(
          condition.query.includes(`"${ALERT_LOG[key]}"`),
          `a consulta não cita a linha de ${key}`,
        );
        assert.ok(
          condition.query.includes(`"${ALERT_SIGNAL[key]}"`),
          `a consulta não nomeia o sinal de ${key}`,
        );
      }
      // dois sinais não têm linha própria: o da falha de segurança da news (é a do job falho, separada pelo motivo) e o do 5xx da api (é o log
      // de requisição do pino-http, res.statusCode). Nome e trechos citados por extenso
      for (const name of Object.values(ALERT_SIGNAL)) {
        assert.ok(condition.query.includes(`"${name}"`), `a consulta não nomeia o sinal ${name}`);
      }
      // a consulta INTEIRA é a escrita acima (os trechos de NEWS_SECURITY_MARKERS, o `>= 500`, os limiares da constante e a lógica de cada sinal)
      assert.equal(
        squash(condition.query),
        squash(APP_SIGNALS_QUERY),
        'a consulta da regra de log mudou: confira a lógica e atualize APP_SIGNALS_QUERY e a tabela APP_SIGNAL_CASES junto',
      );
      // a janela do 5xx cobre ao menos duas avaliações (a latência do log) e cabe na janela da regra
      const apiWindow = Number(/^let apiWindow = (\d+)m;$/m.exec(condition.query)?.[1]);
      assert.ok(
        apiWindow >= 2 * logFrequency && apiWindow <= logWindow,
        `a janela do api-5xx (${apiWindow} min) tem de ser de 2 avaliações (${2 * logFrequency}) até a janela da regra (${logWindow})`,
      );
      // nenhum alerta tem identidade própria (ela viraria mais um leitor do workspace, que guarda o log do WAF com IP e URL)
      for (const type of [
        'Microsoft.Insights/scheduledQueryRules',
        'Microsoft.Insights/metricAlerts',
      ]) {
        for (const rule of m.ofType(type))
          assert.equal(rule.identity, undefined, `${rule.name}: sem identidade`);
      }
    },
  );

  test(at('Azure OpenAI desligado por padrão (enableOpenAI = false)'), () => {
    const m = profileModel(profile);
    assert.equal(m.ofType('Microsoft.CognitiveServices/accounts').length, 0);
    const env = envOf(m.one('Microsoft.App/containerApps', 'ca-api'));
    for (const name of ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'PROMPT_CHAT']) {
      assert.ok(!(name in env), `${name} só com enableOpenAI`);
    }
    assert.ok(!m.grants().some((g) => g.includes('Cognitive Services')), 'sem papel do OpenAI');
  });

  test(
    at('Key Vault manda o log de auditoria (AuditEvent) ao Log Analytics: quem leu o quê'),
    () => {
      const m = profileModel(profile);
      const audit = m
        .ofType('Microsoft.Insights/diagnosticSettings')
        .filter((d) => d.id.includes(`/${vaultScope}/providers/Microsoft.Insights/`));
      assert.equal(audit.length, 1, 'um diagnostic setting no escopo do Key Vault');
      const [setting] = audit;
      assert.match(String(setting.properties.workspaceId), /\/workspaces\/log-alvesting$/);
      assert.deepEqual(
        setting.properties.logs.filter((l) => l.enabled).map((l) => l.category),
        ['AuditEvent'],
      );
    },
  );
}

// --- A lógica da consulta dos sinais, linha a linha ---------------------------------------------------------------------------------
// O golden (APP_SIGNALS_QUERY) prova que a consulta é a que está escrita; isto diz O QUE ELA PRETENDE, com linhas no formato que o Pino
// escreve (os campos `queue`, `attempt`, `reason` e `res.statusCode` são conferidos nos specs do código: job-run.store.spec.ts e
// http-log.spec.ts). O Kusto não roda aqui: `signalOf` e `alertsOf` são um ESPELHO em JS do `case()`, do filtro do HOLD e da razão de 5xx.
// Mexeu na lógica da consulta? O golden reprova, e o espelho e a tabela mudam junto, de propósito.
const pino = (msg, fields = {}) =>
  JSON.stringify({ level: 50, time: 1793836800000, pid: 1, hostname: 'ca-x', ...fields, msg });
const NEWS_MARKERS = new RegExp(NEWS_SECURITY_MARKERS.join('|'));

function signalOf(line) {
  if (!line.startsWith('{')) return '';
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return ''; // o parse_json do Kusto devolve nulo para JSON truncado
  }
  const msg = String(j.msg ?? '');
  const queue = String(j.queue ?? '');
  if (msg === ALERT_LOG.jobFailed && queue === 'news' && NEWS_MARKERS.test(String(j.reason ?? '')))
    return ALERT_SIGNAL.newsSecurity;
  if (
    msg === ALERT_LOG.jobFailed &&
    (queue !== 'news' || Number(j.attempt) > NEWS_FAILED_ATTEMPTS_TOLERATED)
  )
    return ALERT_SIGNAL.jobFailed;
  if (msg === ALERT_LOG.leakFilter) return ALERT_SIGNAL.leakFilter;
  if (msg === ALERT_LOG.holdForced) return ALERT_SIGNAL.holdForced;
  if (msg.startsWith(ALERT_LOG.emailFailed)) return ALERT_SIGNAL.emailFailed;
  if (msg.startsWith(ALERT_LOG.consentNotRecorded)) return ALERT_SIGNAL.consentNotRecorded;
  if (msg === ALERT_LOG.eodBarsMissing) return ALERT_SIGNAL.eodBarsMissing;
  if (msg === ALERT_LOG.brapiQuotaLow) return ALERT_SIGNAL.brapiQuotaLow;
  if (msg === ALERT_LOG.barsDiverged) return ALERT_SIGNAL.barsDiverged;
  if (msg === ALERT_LOG.cycleSkipped) return ALERT_SIGNAL.cycleSkipped;
  return '';
}

// Os sinais que a regra alerta sobre as linhas da janela (todas contadas como se estivessem nela): um por sinal, o HOLD só acima do limite,
// e o api-5xx pela razão de respostas 5xx entre as linhas de requisição (as que têm `res.statusCode`).
function alertsOf(lines) {
  const counts = new Map();
  for (const line of lines) {
    const signal = signalOf(line);
    if (signal) counts.set(signal, (counts.get(signal) ?? 0) + 1);
  }
  const alerts = new Set(
    [...counts]
      .filter(
        ([signal, n]) => signal !== ALERT_SIGNAL.holdForced || n > HOLD_FORCED_MAX_PER_SESSION,
      )
      .map(([signal]) => signal),
  );
  const statuses = lines.flatMap((line) => {
    try {
      const code = line.startsWith('{') ? JSON.parse(line).res?.statusCode : undefined;
      return code === undefined || code === null ? [] : [Number(code)];
    } catch {
      return [];
    }
  });
  const errors = statuses.filter((code) => code >= 500).length;
  if (errors * 100 > statuses.length * API_5XX_MAX_PERCENT) alerts.add(ALERT_SIGNAL.api5xx);
  return [...alerts].sort();
}

const jobFailed = (queue, attempt, reason) =>
  pino(ALERT_LOG.jobFailed, {
    Context: 'JobRunStore',
    queue,
    type: 'x',
    key: 'k',
    jobId: 'j',
    attempt,
    reason,
  });
const requests = (n, statusCode) =>
  Array.from({ length: n }, () =>
    pino(statusCode >= 500 ? 'request errored' : 'request completed', {
      req: { id: 1, method: 'GET', url: '/api/v1/seasons' },
      res: { statusCode },
    }),
  );
const holds = (n) =>
  Array.from({ length: n }, () => pino(ALERT_LOG.holdForced, { Context: 'DecideHandler' }));

// [nome, linhas da janela, sinais que alertam]. Um caso positivo e um negativo por sinal, e as bordas dos limiares.
const APP_SIGNAL_CASES = [
  [
    'job falho fora da news alerta na 1ª vez',
    [jobFailed('market', 1, 'banco fora')],
    ['job-falhou'],
  ],
  [
    'news: a 1ª e a 2ª falhas (rede) não alertam',
    [jobFailed('news', 1, 'fetch failed'), jobFailed('news', 2, 'HTTP 503 de feed.example.test')],
    [],
  ],
  ['news: a 3ª falha alerta', [jobFailed('news', 3, 'fetch failed')], ['job-falhou']],
  [
    'news: motivo de segurança alerta na 1ª vez e só como news-seguranca',
    [jobFailed('news', 1, 'o feed traz DTD (entidades são recusadas)')],
    ['news-seguranca'],
  ],
  [
    'o motivo de segurança só vale na fila news (nas outras é job falho comum)',
    [jobFailed('market', 1, 'o feed traz DTD')],
    ['job-falhou'],
  ],
  [
    'o eod em espera (WAITING) não é falha',
    [pino('job_run em espera: nova tentativa agendada', { queue: 'market', attempt: 1 })],
    [],
  ],
  [
    'filtro de vazamento',
    [pino(ALERT_LOG.leakFilter, { Context: 'DecideHandler', fields: ['summary'] })],
    ['filtro-de-vazamento'],
  ],
  ['HOLD forçado: 2 não alertam', holds(HOLD_FORCED_MAX_PER_SESSION), []],
  [
    'HOLD forçado: o 3º alerta',
    holds(HOLD_FORCED_MAX_PER_SESSION + 1),
    ['hold-por-falha-ou-resposta-invalida'],
  ],
  [
    'e-mail da conta que falhou',
    [pino(`${ALERT_LOG.emailFailed} TimeoutError:ETIMEDOUT`, { Context: 'Conta' })],
    ['email-da-conta'],
  ],
  [
    'e-mail da conta descartado por repetição não é falha',
    [
      pino(
        'e-mail da conta descartado: verificação repetida em menos de 60 s para o mesmo destinatário',
        {
          Context: 'Conta',
        },
      ),
    ],
    [],
  ],
  [
    'aceite não gravado',
    [pino(`${ALERT_LOG.consentNotRecorded} 01J8Z3Q4W5E6R7T8Y9U0I1O2P3`, { Context: 'Conta' })],
    ['aceite-nao-gravado'],
  ],
  [
    'barras do pregão ausentes: o eod concluiu no prazo sem o BOVA11 ou sem parte do obrigatório',
    [
      pino(ALERT_LOG.eodBarsMissing, {
        Context: 'EodHandler',
        date: '2026-11-03',
        missing: 40,
        required: 41,
        first: ['BOVA11'],
      }),
    ],
    ['eod-barras-ausentes'],
  ],
  [
    'o eod que conclui no prazo com poucos papéis sem negócio só registra, não alerta',
    [
      pino('eod concluído no prazo com papéis sem a barra do dia', {
        Context: 'EodHandler',
        date: '2026-11-03',
        missing: 3,
        required: 310,
        first: ['ACAO13', 'ACAO23', 'ACAO33'],
      }),
    ],
    [],
  ],
  [
    'brapi: a cota restante chegou à reserva',
    [pino(ALERT_LOG.brapiQuotaLow, { Context: 'BrapiClient', remaining: 500, reserve: 500 })],
    ['brapi-cota-baixa'],
  ],
  [
    'brapi: barra que chegou com valor diferente do gravado',
    [
      pino(ALERT_LOG.barsDiverged, {
        Context: 'BarLoader',
        count: 1,
        first: [{ ticker: 'PETR4', date: '2026-10-30', fields: ['close'] }],
      }),
    ],
    ['barras-divergentes'],
  ],
  [
    'ciclo pulado por orçamento: alerta na primeira vez',
    [
      pino(ALERT_LOG.cycleSkipped, {
        Context: 'CycleSchedulers',
        date: '2026-11-03',
        season: 'temporada-1',
        reason: 'orcamento',
      }),
    ],
    ['ciclo-pulado'],
  ],
  [
    'ciclo pulado por falta de briefing: o mesmo sinal',
    [
      pino(ALERT_LOG.cycleSkipped, {
        Context: 'CycleSchedulers',
        date: '2026-11-03',
        season: 'temporada-1',
        reason: 'sem_briefing',
      }),
    ],
    ['ciclo-pulado'],
  ],
  [
    'ciclo que abre normalmente não alerta',
    [
      pino('sched-cycle: decide publicado para cada modelo', {
        Context: 'CycleSchedulers',
        date: '2026-11-03',
        published: 6,
      }),
    ],
    [],
  ],
  [
    'linha que não é JSON e JSON truncado não alertam',
    [
      '[Nest] 1  - 11/03/2026, LOG [NestApplication] Nest application successfully started',
      '{"level":50,"msg":"job_run falh',
    ],
    [],
  ],
  ['api-5xx: sem erro nenhum', requests(50, 200), []],
  ['api-5xx: 4xx não é erro do servidor', requests(10, 404), []],
  ['api-5xx: exatamente 1% não alerta', [...requests(99, 200), ...requests(1, 500)], []],
  ['api-5xx: acima de 1% alerta', [...requests(98, 200), ...requests(2, 500)], ['api-5xx']],
  [
    'api-5xx: um 5xx em tráfego pequeno já alerta',
    [...requests(1, 200), ...requests(1, 500)],
    ['api-5xx'],
  ],
  ['api-5xx: sem requisição nenhuma não alerta', [], []],
  [
    'api-5xx: o 5xx do login (a linha da AuthRoute, que o pino-http não escreve) conta',
    [
      pino('POST /api/auth/sign-in/email 500', {
        context: 'AuthRoute',
        req: { method: 'POST', path: '/api/auth/sign-in/email' },
        res: { statusCode: 500 },
      }),
      ...requests(9, 200),
    ],
    ['api-5xx'],
  ],
  [
    'api-5xx: a linha que não é de requisição não entra na conta',
    [jobFailed('market', 1, 'x'), ...requests(1, 200)],
    ['job-falhou'],
  ],
];

test('sinais da aplicação: o que a consulta pretende, linha a linha (espelho em JS do case() e da razão de 5xx)', () => {
  for (const [name, lines, expected] of APP_SIGNAL_CASES)
    assert.deepEqual(alertsOf(lines), expected, name);
  // cada sinal tem ao menos um caso que o faz alertar (a tabela cobre a lista inteira)
  const covered = new Set(APP_SIGNAL_CASES.flatMap(([, , expected]) => expected));
  for (const name of Object.values(ALERT_SIGNAL))
    assert.ok(covered.has(name), `nenhum caso de APP_SIGNAL_CASES faz o sinal ${name} alertar`);
});

// =================================================================================================
// 3. O que muda entre os perfis
// =================================================================================================
test('[padrao] Front Door Standard: dois endpoints (o do site e o do green), quatro grupos de origem com probe GET /health a cada 30 s', () => {
  const m = profileModel('padrao');
  const afd = m.one('Microsoft.Cdn/profiles', 'afd-alvesting');
  assert.equal(afd.sku.name, 'Standard_AzureFrontDoor');
  assert.deepEqual(
    m
      .ofType('Microsoft.Cdn/profiles/afdEndpoints')
      .map((e) => e.name.split('/').pop())
      .sort(),
    ['alvesting', 'alvesting-green'],
    'o endpoint do site e o do blue/green (ADR 0029)',
  );
  const groups = Object.fromEntries(
    m.ofType('Microsoft.Cdn/profiles/originGroups').map((g) => [g.name.split('/').pop(), g]),
  );
  assert.deepEqual(Object.keys(groups).sort(), ['api', 'api-green', 'web', 'web-green']);
  for (const [name, group] of Object.entries(groups)) {
    const probe = group.properties.healthProbeSettings;
    assert.equal(probe.probePath, '/health', `${name}: caminho do probe`);
    assert.equal(probe.probeRequestType, 'GET', `${name}: método do probe`);
    assert.equal(probe.probeIntervalInSeconds, 30, `${name}: intervalo do probe`);
    assert.equal(probe.probeProtocol, 'Https');
  }
  const origins = m.ofType('Microsoft.Cdn/profiles/originGroups/origins');
  assert.equal(origins.length, 4);
  for (const o of origins) {
    assert.equal(o.properties.httpsPort, 443);
    assert.equal(o.properties.enforceCertificateNameCheck, true);
    assert.equal(o.properties.originHostHeader, o.properties.hostName);
  }
  // O host do app (balanceado pelos pesos de tráfego) e o host do LABEL green do mesmo app: <app>---green.<domínio do ambiente>
  // (Learn, "Blue-green deployment in Azure Container Apps": o FQDN do label tem três hífens).
  // o nome da origem é <perfil>/<grupo>/<origem>
  const hostOf = (group) =>
    origins.find((o) => o.name.split('/')[1] === group)?.properties.hostName;
  // (no snapshot o host é a expressão format('<app>.{0}', <domínio do ambiente>), porque o domínio só existe depois do deploy)
  assert.match(hostOf('web'), /^\[format\('ca-web\.\{0\}', reference\(/);
  assert.match(hostOf('api'), /^\[format\('ca-api\.\{0\}', reference\(/);
  assert.match(hostOf('web-green'), /^\[format\('ca-web---green\.\{0\}', reference\(/);
  assert.match(hostOf('api-green'), /^\[format\('ca-api---green\.\{0\}', reference\(/);
  // o green aponta para o mesmo ambiente do app: só o rótulo muda
  assert.equal(hostOf('web-green').replace("'ca-web---green.{0}'", "'ca-web.{0}'"), hostOf('web'));
  assert.equal(hostOf('api-green').replace("'ca-api---green.{0}'", "'ca-api.{0}'"), hostOf('api'));
});

// O endpoint do blue/green (ADR 0029): o deploy prova a revisão nova pelo Front Door ANTES de ela receber tráfego, com o WAF, a trava de
// origem e a borda de verdade. Sem custo novo (Learn, "Compare pricing between Azure Front Door tiers": no Standard as rotas e as regras
// próprias do WAF são grátis, e a taxa-base é por perfil) e sem cache: nada do green vai para a borda de ninguém.
test('[padrao] Front Door: o endpoint green tem duas rotas sem cache para os labels green, e o WAF o cobre', () => {
  const m = profileModel('padrao');
  const routes = m
    .ofType('Microsoft.Cdn/profiles/afdEndpoints/routes')
    .filter((r) => r.name.split('/')[1] === 'alvesting-green');
  assert.deepEqual(
    routes
      .map((r) => [r.properties.patternsToMatch, r.properties.originGroup.id.split('/').pop()])
      .sort(),
    [
      [['/*'], 'web-green'],
      [['/api/*'], 'api-green'],
    ].sort(),
    'duas rotas: /api/* para a api do green e o resto para o web do green',
  );
  for (const r of routes) {
    assert.equal(r.properties.cacheConfiguration, undefined, `${r.name}: sem cache`);
    assert.equal(r.properties.httpsRedirect, 'Enabled');
    assert.equal(r.properties.forwardingProtocol, 'HttpsOnly');
    assert.equal(r.properties.linkToDefaultDomain, 'Enabled');
    assert.deepEqual(
      r.properties.customDomains,
      [],
      `${r.name}: o domínio próprio é do site, não do green`,
    );
  }
  // nenhuma rota do site foi para um grupo green, e nenhuma do green para um grupo do site
  for (const r of m.ofType('Microsoft.Cdn/profiles/afdEndpoints/routes')) {
    const isGreenRoute = r.name.split('/')[1] === 'alvesting-green';
    const group = r.properties.originGroup.id.split('/').pop();
    assert.equal(group.endsWith('-green'), isGreenRoute, `${r.name}: grupo ${group}`);
  }
  // o WAF cobre os dois endpoints: o green passa pelas mesmas regras (BlockInterno e os limites)
  const policy = m.one('Microsoft.Cdn/profiles/securityPolicies');
  const covered = policy.properties.parameters.associations.flatMap((a) =>
    a.domains.map((d) => d.id),
  );
  for (const endpoint of m.ofType('Microsoft.Cdn/profiles/afdEndpoints')) {
    assert.ok(covered.includes(endpoint.id), `WAF no endpoint ${endpoint.name}`);
  }
  // o endereço do green sai nas saídas do deploy (a variável SITE_GREEN_URL do repositório, docs/DEPLOY.md)
  const built = bicep(['build', MAIN, '--stdout'], { withInputs: false });
  assert.equal(built.status, 0, built.err);
  assert.ok('greenSiteUrl' in JSON.parse(built.out).outputs, 'saída greenSiteUrl');
});

// As rotas públicas do plano (§9) que o Front Door guarda no cache, escritas à mão a partir do plano e NÃO derivadas do Bicep: se
// o Bicep guardar um caminho a mais (o login, a conta, o admin, o chat), ele diverge daqui. Sem curinga o padrão do Front Door é
// exato; o curinga só vale no fim, depois de uma barra, e não casa o próprio diretório (Learn, "How requests get matched to a
// route configuration").
const PUBLIC_API_CACHED = [
  '/api/v1/arena/current',
  '/api/v1/seasons',
  '/api/v1/seasons/*',
  '/api/v1/competitors/*',
  '/api/v1/cycles/*',
  '/api/v1/decisions',
  '/api/v1/news',
  '/api/v1/stocks',
  '/api/v1/stocks/*',
];
// Caminhos que nunca podem cair numa rota com cache (privados, de sessão, de operação ou sem dado público).
const NEVER_CACHED = [
  '/api/auth/session',
  '/api/auth/callback/google',
  // as rotas reais da conta (etapa 11): dado pessoal, sessão, o texto legal que o aceite grava e os logins que a api oferece
  // (docs/CONTA.md): um "google: false" guardado na borda esconderia o botão depois de o Google ser ligado
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  '/api/auth/get-session',
  '/api/auth/verify-email',
  '/api/auth/reset-password/x',
  '/api/v1/me',
  '/api/v1/me/consents',
  '/api/v1/me/export',
  '/api/v1/legal',
  '/api/v1/auth/providers',
  // a carteira (etapa 12; docs/API.md, seção 9): dado pessoal, só do dono. O teste logo abaixo do de cache confere que estas três linhas são
  // EXATAMENTE as rotas do controlador (o PATCH e o DELETE do lançamento têm o mesmo caminho)
  '/api/v1/me/portfolio',
  '/api/v1/me/portfolio/lots',
  '/api/v1/me/portfolio/lots/x',
  '/api/v1/me/chat/threads/x/messages',
  // as rotas de admin (etapa 10, parte 2; docs/API.md, seção 8): sessão, papel e dado de operação. O teste logo abaixo do de cache confere
  // que esta lista tem EXATAMENTE as rotas do controlador (uma rota nova de admin que esqueça de entrar aqui reprova)
  '/api/v1/admin/seasons',
  '/api/v1/admin/seasons/x',
  '/api/v1/admin/cycles/2026-11-03/rerun',
  '/api/v1/admin/dlq/news/resubmit',
  '/api/v1/admin/corporate-events',
  '/api/v1/admin/costs',
  '/api/v1/admin/jobs',
  // as rotas internas de cotações (docs/API.md, seção 6; ADR 0033): as barras de um papel, a fita da home e os logos (a lista e o de um papel,
  // ADR 0036). O site as lê com o segredo, e nada delas vai para o cache de ninguém. O teste logo abaixo do de admin confere que esta lista tem
  // EXATAMENTE as rotas do controlador
  '/api/v1/interno/barras/x',
  '/api/v1/interno/fita',
  '/api/v1/interno/logos',
  '/api/v1/interno/logos/x',
  '/api/v1/health',
  '/api/v1/health/stream',
  '/api/docs',
  '/api/v1',
  '/api/v1/',
  '/api',
];

// Quais padrões da rota casam o caminho, pela regra do Front Door: sem curinga é igual (sem diferença de caixa); com curinga
// ("/a/*"), tudo que começa com "/a/".
const matches = (pattern, path) => {
  const [p, q] = [pattern.toLowerCase(), path.toLowerCase()];
  return p.endsWith('/*') ? q.startsWith(p.slice(0, -1)) : p === q;
};

test('[padrao] Front Door: /api/* e o HTML sem cache; as GET públicas da API e o estático do Next com cache', () => {
  const m = profileModel('padrao');
  // só as rotas do endpoint do site; as do endpoint green (sem cache, outro teste) repetem /* e /api/* para os grupos dos labels
  const routes = m
    .ofType('Microsoft.Cdn/profiles/afdEndpoints/routes')
    .filter((r) => r.name.split('/')[1] === 'alvesting');
  const byPattern = new Map(routes.flatMap((r) => r.properties.patternsToMatch.map((p) => [p, r])));
  assert.deepEqual(
    [...byPattern.keys()].sort(),
    ['/*', '/_next/static/*', '/api/*', ...PUBLIC_API_CACHED].sort(),
    'as rotas do Front Door',
  );
  assert.equal(routes.length, 4, 'api, api-public, static e web');

  // a rota geral da API: sem cache (login, conta, admin, chat, health e Swagger passam por ela)
  const api = byPattern.get('/api/*');
  assert.ok(api.properties.originGroup.id.endsWith('/originGroups/api'));
  assert.equal(api.properties.cacheConfiguration, undefined, '/api/* não pode ter cache');

  // o HTML do site: sem cache na borda
  const web = byPattern.get('/*');
  assert.ok(web.properties.originGroup.id.endsWith('/originGroups/web'));
  assert.equal(web.properties.cacheConfiguration, undefined, 'HTML sem cache na borda');

  // o estático do Next: com cache, respeitando o Cache-Control imutável
  const stat = byPattern.get('/_next/static/*');
  assert.ok(stat.properties.originGroup.id.endsWith('/originGroups/web'));
  assert.ok(stat.properties.cacheConfiguration, 'cache habilitado em /_next/static/*');

  // as GET públicas da API: uma rota só, no grupo da api, com a query string na chave
  const pub = byPattern.get('/api/v1/arena/current');
  assert.deepEqual([...pub.properties.patternsToMatch].sort(), [...PUBLIC_API_CACHED].sort());
  assert.ok(pub.properties.originGroup.id.endsWith('/originGroups/api'));
  const cache = pub.properties.cacheConfiguration;
  assert.ok(cache, 'cache habilitado nas GET públicas da API');
  assert.equal(
    cache.queryStringCachingBehavior,
    'UseQueryString',
    'a query string entra na chave (cursor, limite, filtros)',
  );
  assert.equal(cache.compressionSettings.isCompressionEnabled, true);
  assert.deepEqual(cache.compressionSettings.contentTypesToCompress, ['application/json']);
  // sem queryParameters: nenhum parâmetro fica de fora da chave
  assert.equal(cache.queryParameters, undefined);

  // respeitando o Cache-Control da origem: nenhum rule set (que poderia sobrescrever o tempo de vida), e nada de cacheBehavior
  assert.equal(
    m.ofType('Microsoft.Cdn/profiles/ruleSets').length,
    0,
    'nenhum rule set sobrescreve o Cache-Control da origem',
  );
  for (const r of routes) {
    assert.equal(
      r.properties.cacheConfiguration?.cacheBehavior,
      undefined,
      `${r.name}: sem cacheBehavior`,
    );
    assert.equal(r.properties.httpsRedirect, 'Enabled');
    assert.equal(r.properties.forwardingProtocol, 'HttpsOnly');
    assert.deepEqual(r.properties.supportedProtocols, ['Http', 'Https']);
  }

  // o que nunca pode ser guardado não casa nenhum padrão da rota com cache
  for (const path of NEVER_CACHED) {
    assert.ok(
      !pub.properties.patternsToMatch.some((pattern) => matches(pattern, path)),
      `${path} não pode cair na rota com cache`,
    );
  }
  // e cada rota pública do plano casa (a lista cobre o §9)
  for (const path of [
    '/api/v1/arena/current',
    '/api/v1/seasons',
    '/api/v1/seasons/01ABC/leaderboard',
    '/api/v1/seasons/ensaio/equity',
    '/api/v1/seasons/ensaio/random-baseline',
    '/api/v1/competitors/claude-opus',
    '/api/v1/cycles/2026-11-04',
    '/api/v1/decisions',
    '/api/v1/news',
    '/api/v1/stocks',
    '/api/v1/stocks/PETR4',
  ]) {
    assert.ok(
      pub.properties.patternsToMatch.some((pattern) => matches(pattern, path)),
      `${path} tem de cair na rota com cache`,
    );
  }
});

// As rotas /api/v1/admin do código (o controlador), com os parâmetros trocados por "x" ou por um valor de exemplo. Lidas do arquivo-fonte, e
// não do Bicep: o que se confere é que o Front Door não guarda nenhuma delas, e que a lista NEVER_CACHED acima não ficou para trás.
function adminRoutesInCode() {
  const source = readFileSync(
    join(
      REPO_ROOT,
      'apps',
      'api',
      'src',
      'modules',
      'admin',
      'presentation',
      'admin.controller.ts',
    ),
    'utf8',
  );
  const prefix = /@Controller\('([^']+)'\)/.exec(source)?.[1];
  assert.equal(prefix, 'admin', 'o controlador de admin mudou de prefixo');
  const routes = [...source.matchAll(/@(?:Get|Post|Patch|Put|Delete)\('([^']+)'\)/g)].map(
    (m) => m[1],
  );
  assert.ok(routes.length >= 8, 'as 8 rotas de admin não foram achadas no controlador');
  const example = { ':date': '2026-11-03', ':queue': 'news' };
  return routes.map(
    (route) => `/api/v1/admin/${route.replace(/:\w+/g, (param) => example[param] ?? 'x')}`,
  );
}

test('[padrao] Front Door: nenhuma rota /api/v1/admin do código cai na rota com cache, e a lista NEVER_CACHED as tem todas', () => {
  const pub = profileModel('padrao')
    .ofType('Microsoft.Cdn/profiles/afdEndpoints/routes')
    .find((r) => r.properties.patternsToMatch.includes('/api/v1/arena/current'));
  // (a rota com cache existe só no endpoint do site: o green não guarda nada na borda)
  assert.ok(pub, 'a rota com cache da API não foi achada');
  const inCode = adminRoutesInCode();
  for (const path of inCode) {
    assert.ok(
      !pub.properties.patternsToMatch.some((pattern) => matches(pattern, path)),
      `${path}: a rota de admin não pode cair na rota com cache`,
    );
  }
  assert.deepEqual(
    NEVER_CACHED.filter((path) => path.startsWith('/api/v1/admin/')).sort(),
    [...new Set(inCode)].sort(),
    'NEVER_CACHED e as rotas do controlador de admin divergem',
  );
});

// A rota interna de cotações (docs/API.md, seção 6; ADR 0033), lida do controlador: o site a chama pelo endereço interno da api, com o segredo
// só do servidor, e a API pública deixou de entregar a barra de preço. O Front Door não pode guardá-la (nem a rota com cache, nem o /api/*), e o
// caminho tem de levar `/interno/`, que a regra BlockInterno do WAF bloqueia na borda: pela borda a rota nem chega à api.
function internalRoutesInCode() {
  const source = readFileSync(
    join(
      REPO_ROOT,
      'apps',
      'api',
      'src',
      'modules',
      'quotes',
      'presentation',
      'quotes.controller.ts',
    ),
    'utf8',
  );
  const prefix = /@Controller\('([^']+)'\)/.exec(source)?.[1];
  assert.equal(prefix, 'interno', 'o controlador das cotações mudou de prefixo');
  const routes = [...source.matchAll(/@(?:Get|Post|Patch|Put|Delete)\('([^']+)'\)/g)].map(
    (m) => m[1],
  );
  assert.ok(routes.length >= 1, 'a rota interna de cotações não foi achada no controlador');
  return routes.map((route) => `/api/v1/${prefix}/${route.replace(/:\w+/g, 'x')}`);
}

test('[padrao] Front Door: a rota interna de cotações do código não cai na rota com cache, está em NEVER_CACHED e o WAF a bloqueia na borda', () => {
  const m = profileModel('padrao');
  const pub = m
    .ofType('Microsoft.Cdn/profiles/afdEndpoints/routes')
    .find((r) => r.properties.patternsToMatch.includes('/api/v1/arena/current'));
  assert.ok(pub, 'a rota com cache da API não foi achada');
  const inCode = internalRoutesInCode();
  for (const path of inCode) {
    assert.ok(
      !pub.properties.patternsToMatch.some((pattern) => matches(pattern, path)),
      `${path}: a rota interna de cotações não pode cair na rota com cache`,
    );
  }
  assert.deepEqual(
    NEVER_CACHED.filter((path) => path.startsWith('/api/v1/interno/')).sort(),
    [...new Set(inCode)].sort(),
    'NEVER_CACHED e as rotas do controlador de cotações divergem',
  );
  // A regra BlockInterno do WAF: o caminho (em minúsculas e sem percent-encoding, como a regra o vê) contém o que ela bloqueia.
  const waf = m.one('Microsoft.Network/FrontDoorWebApplicationFirewallPolicies');
  const block = waf.properties.customRules.rules.find((rule) => rule.name === 'BlockInterno');
  assert.ok(block, 'a regra BlockInterno do WAF não foi achada');
  assert.equal(block.action, 'Block');
  assert.equal(block.enabledState, 'Enabled');
  assert.equal(block.matchConditions.length, 1);
  const [condition] = block.matchConditions;
  assert.equal(condition.matchVariable, 'RequestUri');
  assert.equal(condition.operator, 'Contains');
  assert.equal(condition.negateCondition, false);
  assert.deepEqual(condition.matchValue, ['/interno/']);
  assert.deepEqual(condition.transforms, ['Lowercase', 'UrlDecode']);
  for (const path of inCode) {
    assert.ok(
      condition.matchValue.some((value) => path.toLowerCase().includes(value)),
      `${path}: a regra BlockInterno do WAF tem de bloqueá-la na borda`,
    );
  }
});

// O mesmo para a carteira do usuário (etapa 12): as rotas de /api/v1/me/portfolio do controlador, lidas do arquivo-fonte. É dado pessoal, só do
// dono: o Front Door não pode guardar nenhuma, e uma rota nova da carteira que esqueça de entrar em NEVER_CACHED reprova.
function portfolioRoutesInCode() {
  const source = readFileSync(
    join(
      REPO_ROOT,
      'apps',
      'api',
      'src',
      'modules',
      'portfolio',
      'presentation',
      'portfolio.controller.ts',
    ),
    'utf8',
  );
  const prefix = /@Controller\('([^']+)'\)/.exec(source)?.[1];
  assert.equal(prefix, 'me/portfolio', 'o controlador da carteira mudou de prefixo');
  const routes = [...source.matchAll(/@(?:Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/g)].map(
    (m) => m[1] ?? '',
  );
  assert.ok(routes.length >= 4, 'as 4 rotas da carteira não foram achadas no controlador');
  return routes.map(
    (route) => `/api/v1/${prefix}${route === '' ? '' : `/${route.replace(/:\w+/g, 'x')}`}`,
  );
}

test('[padrao] Front Door: nenhuma rota /api/v1/me/portfolio do código cai na rota com cache, e a lista NEVER_CACHED as tem todas', () => {
  const pub = profileModel('padrao')
    .ofType('Microsoft.Cdn/profiles/afdEndpoints/routes')
    .find((r) => r.properties.patternsToMatch.includes('/api/v1/arena/current'));
  assert.ok(pub, 'a rota com cache da API não foi achada');
  const inCode = portfolioRoutesInCode();
  for (const path of inCode) {
    assert.ok(
      !pub.properties.patternsToMatch.some((pattern) => matches(pattern, path)),
      `${path}: a rota da carteira não pode cair na rota com cache`,
    );
  }
  assert.deepEqual(
    NEVER_CACHED.filter((path) => path.startsWith('/api/v1/me/portfolio')).sort(),
    [...new Set(inCode)].sort(),
    'NEVER_CACHED e as rotas do controlador da carteira divergem',
  );
});

test('[padrao] WAF com rate limit por IP (geral e do login) e o bloqueio de /interno/ ligados ao endpoint', () => {
  const m = profileModel('padrao');
  const waf = m.one('Microsoft.Network/FrontDoorWebApplicationFirewallPolicies');
  assert.equal(waf.sku.name, 'Standard_AzureFrontDoor');
  assert.equal(waf.properties.policySettings.enabledState, 'Enabled');
  assert.equal(waf.properties.policySettings.mode, 'Prevention');
  const allRules = waf.properties.customRules.rules;
  assert.deepEqual(allRules.map((r) => r.name).sort(), [
    'BlockInterno',
    'RateLimitAuth',
    'RateLimitPorIp',
  ]);
  // a prioridade é única e define a ordem (menor primeiro): o bloqueio vem antes dos limites
  const priorities = allRules.map((r) => r.priority);
  assert.equal(new Set(priorities).size, priorities.length, 'prioridades únicas');
  const rules = allRules.filter((r) => r.name !== 'BlockInterno');
  for (const r of rules) {
    assert.equal(r.ruleType, 'RateLimitRule', r.name);
    assert.equal(r.action, 'Block', r.name);
    assert.equal(r.enabledState, 'Enabled', r.name);
    assert.ok(r.rateLimitThreshold > 0 && r.rateLimitDurationInMinutes >= 1, r.name);
    assert.ok(r.matchConditions.length >= 1, `${r.name}: o Front Door exige uma condição`);
    for (const c of r.matchConditions) {
      // RemoteAddr é o IP "original" lido do X-Forwarded-For, que o atacante escreve: com a negação de uma faixa
      // de documentação, mandar o cabeçalho com um IP dessa faixa tirava a requisição da regra e do limite.
      assert.notEqual(
        c.matchVariable,
        'RemoteAddr',
        `${r.name}: casa por IP que o cliente declara`,
      );
    }
  }
  // Regra geral: casa TODA requisição por algo que o cliente não escolhe (a URL recebida contém "/").
  const general = rules.find((r) => r.name === 'RateLimitPorIp');
  assert.equal(general.rateLimitThreshold, 600);
  assert.deepEqual(
    general.matchConditions.map(({ matchVariable, operator, negateCondition, matchValue }) => ({
      matchVariable,
      operator,
      negateCondition,
      matchValue,
    })),
    [
      {
        matchVariable: 'RequestUri',
        operator: 'Contains',
        negateCondition: false,
        matchValue: ['/'],
      },
    ],
  );
  // Regra do login: /api/auth/* (Better Auth) com limite bem menor, e à prova de caixa e de %-encoding.
  const auth = rules.find((r) => r.name === 'RateLimitAuth');
  assert.ok(
    auth.rateLimitThreshold < general.rateLimitThreshold,
    'login mais estrito que a navegação',
  );
  const [condition] = auth.matchConditions;
  assert.equal(condition.matchVariable, 'RequestUri');
  assert.deepEqual(condition.matchValue, ['/api/auth/']);
  assert.deepEqual([...condition.transforms].sort(), ['Lowercase', 'UrlDecode']);
  // /interno/* (a revalidação do worker, que chama o ingress do ca-web direto) não passa pelo Front Door: bloqueada na borda, à prova
  // de caixa e de %2F, e antes dos limites.
  const internal = allRules.find((r) => r.name === 'BlockInterno');
  assert.equal(internal.ruleType, 'MatchRule');
  assert.equal(internal.action, 'Block');
  assert.equal(internal.enabledState, 'Enabled');
  assert.ok(
    internal.priority < Math.min(...rules.map((r) => r.priority)),
    'o bloqueio é avaliado antes dos limites',
  );
  assert.deepEqual(
    internal.matchConditions.map(({ matchVariable, operator, negateCondition, matchValue }) => ({
      matchVariable,
      operator,
      negateCondition,
      matchValue,
    })),
    [
      {
        matchVariable: 'RequestUri',
        operator: 'Contains',
        negateCondition: false,
        matchValue: ['/interno/'],
      },
    ],
  );
  assert.deepEqual([...internal.matchConditions[0].transforms].sort(), ['Lowercase', 'UrlDecode']);
  assert.equal(waf.properties.managedRules, undefined, 'regras gerenciadas só no Premium');
  const policy = m.one('Microsoft.Cdn/profiles/securityPolicies');
  const { parameters } = policy.properties;
  assert.equal(parameters.type, 'WebApplicationFirewall');
  assert.ok(
    parameters.wafPolicy.id.endsWith(`/FrontDoorWebApplicationFirewallPolicies/${waf.name}`),
  );
  const site = m
    .ofType('Microsoft.Cdn/profiles/afdEndpoints')
    .find((e) => e.name.endsWith('/alvesting'));
  assert.ok(
    parameters.associations[0].domains.some((d) => d.id === site.id),
    'WAF no endpoint',
  );
  assert.deepEqual(parameters.associations[0].patternsToMatch, ['/*']);
});

test('[padrao] o log do WAF (FrontDoorWebApplicationFirewallLog) vai ao Log Analytics', () => {
  const m = profileModel('padrao');
  const diagnostics = m
    .ofType('Microsoft.Insights/diagnosticSettings')
    .filter((d) =>
      d.id.includes('/Microsoft.Cdn/profiles/afd-alvesting/providers/Microsoft.Insights/'),
    );
  assert.equal(diagnostics.length, 1, 'um diagnostic setting no escopo do perfil do Front Door');
  const [setting] = diagnostics;
  assert.match(String(setting.properties.workspaceId), /\/workspaces\/log-alvesting$/);
  // ponytail: só o log do WAF. O de acesso (FrontDoorAccessLog) tem uma linha por requisição e estoura os 5 GB
  // gratuitos do workspace; quem o quiser muda este teste de propósito.
  assert.deepEqual(
    setting.properties.logs.filter((l) => l.enabled).map((l) => l.category),
    ['FrontDoorWebApplicationFirewallLog'],
  );
});

test('[padrao] trava de origem (contrato): front-door-id no Key Vault, FRONT_DOOR_ID e ORIGIN_LOCK em web e api', () => {
  // Isto prova só a ENTREGA do ID e do sinal de trava. Quem recusa o pedido sem X-Azure-FDID é o middleware da
  // etapa 3 (fail closed: ORIGIN_LOCK=front-door com FRONT_DOOR_ID vazio não sobe). Até lá nada na rede trava a
  // origem, e o item do checklist (docs/INFRA.md, seção 12) fica aberto.
  const m = profileModel('padrao');
  assert.ok(m.secretNames().includes('front-door-id'));
  for (const name of ['ca-web', 'ca-api']) {
    const app = m.one('Microsoft.App/containerApps', name);
    assert.equal(envOf(app).ORIGIN_LOCK?.value, 'front-door', `${name}: ORIGIN_LOCK`);
    assert.equal(envOf(app).FRONT_DOOR_ID?.secretRef, 'front-door-id', `${name}: FRONT_DOOR_ID`);
    assert.ok(
      app.properties.configuration.secrets.some(
        (s) => s.name === 'front-door-id' && m.isKeyVaultUrl(s),
      ),
    );
  }
  const worker = m.one('Microsoft.App/containerApps', 'ca-worker-data');
  assert.ok(envOf(worker).FRONT_DOOR_ENDPOINT_ID, 'o worker precisa do endpoint para o purge');
});

test('[padrao] purge do Front Door: papel próprio só com a ação de purge, no perfil', () => {
  const m = profileModel('padrao');
  const role = m.one('Microsoft.Authorization/roleDefinitions');
  assert.deepEqual(role.properties.permissions[0].actions, [
    'Microsoft.Cdn/profiles/afdEndpoints/purge/action',
  ]);
  assert.deepEqual(role.properties.permissions[0].dataActions ?? [], []);
  const assignment = m
    .ofType('Microsoft.Authorization/roleAssignments')
    .find((r) => r.properties.roleDefinitionId.endsWith(`/roleDefinitions/${role.name}`));
  assert.ok(assignment, 'papel de purge atribuído');
  assert.ok(
    assignment.id.includes('/Microsoft.Cdn/profiles/afd-alvesting/'),
    'no escopo do perfil',
  );
});

test('[padrao] ACR Basic, imagens do ACR e pull por identidade', () => {
  const m = profileModel('padrao');
  const acr = m.one('Microsoft.ContainerRegistry/registries');
  assert.equal(acr.sku.name, 'Basic');
  assert.equal(acr.properties.adminUserEnabled, false);
  assert.notEqual(acr.properties.anonymousPullEnabled, true, 'sem pull anônimo');
  for (const w of m.workloads) {
    assert.match(containersOf(w)[0].image, /azurecr\.io|acrLoginServer|cralvesting/, w.name);
    assert.equal(w.properties.configuration.registries.length, 1);
    // Cada workload puxa a imagem com a identidade dele, que é quem tem o AcrPull (a do KEDA não puxa nada).
    const puller = codeIdentityOf(w.name);
    assert.ok(
      w.properties.configuration.registries[0].identity.endsWith(`/${puller}`),
      `${w.name}: pull pela ${puller}`,
    );
  }
});

test('[economico] sem Front Door, sem WAF, sem ACR; imagens do GHCR; a api interna, sem CORS, e o site repassa /api', () => {
  const m = profileModel('economico');
  assert.equal(m.underNamespace('Microsoft.Cdn/').length, 0, 'nenhum recurso Microsoft.Cdn');
  assert.equal(m.ofType('Microsoft.Network/FrontDoorWebApplicationFirewallPolicies').length, 0);
  assert.equal(m.underNamespace('Microsoft.ContainerRegistry/').length, 0, 'sem ACR');
  assert.ok(!m.grants().some((g) => g.includes('AcrPull')), 'sem AcrPull: não há registro');
  assert.equal(m.ofType('Microsoft.Authorization/roleDefinitions').length, 0, 'sem papel de purge');
  assert.equal(
    m.ofType('Microsoft.Insights/diagnosticSettings').length,
    1,
    'só o do Key Vault: não há Front Door para registrar',
  );
  assert.ok(!m.secretNames().includes('front-door-id'));
  for (const w of m.workloads) {
    assert.ok(containersOf(w)[0].image.startsWith('ghcr.io/'), `${w.name}: imagem do GHCR`);
    assert.deepEqual(w.properties.configuration.registries ?? [], [], `${w.name}: sem registro`);
    assert.ok(!('FRONT_DOOR_ID' in envOf(w)), `${w.name}: sem FRONT_DOOR_ID`);
    assert.ok(!('ORIGIN_LOCK' in envOf(w)), `${w.name}: sem ORIGIN_LOCK (não há Front Door)`);
  }
  // Uma origem só, pelo site (ADR 0039): a api é INTERNA e sem CORS (o navegador nunca chama o host dela), e o site repassa /api/* a ela
  // pelo endereço interno (<app>.internal.<domínio>), o mesmo que o SSR lê. Com o CORS de antes, entrar, cadastrar e a carteira davam 404.
  const api = m.one('Microsoft.App/containerApps', 'ca-api');
  assert.equal(api.properties.configuration.ingress.external, false, 'a api é interna');
  assert.ok(api.properties.configuration.ingress.corsPolicy == null, 'a api sem CORS');
  const web = m.one('Microsoft.App/containerApps', 'ca-web');
  assert.equal(web.properties.configuration.ingress.external, true, 'o site é a entrada');
  assert.ok(web.properties.configuration.ingress.corsPolicy == null);
  assert.equal(envOf(web).API_PROXY?.value, 'on', 'o site repassa /api/* à api');
  assert.match(
    String(envOf(web).API_INTERNAL_URL?.value),
    /'https:\/\/ca-api\.internal\.\{0\}'|https:\/\/ca-api\.internal\./,
    'o endereço interno da api',
  );
  for (const w of m.workloads.filter((x) => x.name !== 'ca-web')) {
    assert.ok(!('API_PROXY' in envOf(w)), `${w.name}: o repasse é só do site`);
  }
});

test('[padrao] o site não repassa /api (o Front Door faz) e lê a api pelo endereço externo dela', () => {
  const web = profileModel('padrao').one('Microsoft.App/containerApps', 'ca-web');
  assert.ok(!('API_PROXY' in envOf(web)));
  assert.doesNotMatch(String(envOf(web).API_INTERNAL_URL?.value), /internal/);
});

// A restauração da temporada (ADR 0039; docs/RUNBOOK.md, 13.6): no econômico, o job-migrate, com o comando trocado numa execução, lê o dump
// do container backups. Só LÊ, e só ele (o worker continua o único que grava ali), com a identidade dele valendo para o código (Main) e os
// dois endereços de que o DefaultAzureCredential e o cliente do Blob precisam. No padrão nada disso existe.
test('[economico] a restauração: o migrate só lê o backups, com a identidade dele valendo para o código; quem opera escreve nos três', () => {
  const m = profileModel('economico');
  const migrate = m.one('Microsoft.App/jobs', 'job-migrate');
  assert.deepEqual(migrate.properties.configuration.identitySettings, [
    {
      identity: migrate.properties.configuration.identitySettings[0].identity,
      lifecycle: 'Main',
    },
  ]);
  assert.ok(
    migrate.properties.configuration.identitySettings[0].identity.includes(ID.migrate),
    'a identidade do próprio migrate',
  );
  const env = envOf(migrate);
  assert.match(
    String(env.AZURE_CLIENT_ID?.value),
    new RegExp(`userAssignedIdentities/${ID.migrate}'`),
  );
  assert.ok(env.STORAGE_BLOB_ENDPOINT?.value, 'o endereço do Blob');
  const grants = m.grants();
  const backups = grants.filter((g) => g.endsWith('/containers/backups'));
  assert.deepEqual(
    backups.sort(),
    [
      `${ID.migrate} | Storage Blob Data Reader | ${storageScope}/blobServices/default/containers/backups`,
      `${ID.worker} | Storage Blob Data Contributor | ${storageScope}/blobServices/default/containers/backups`,
      `admin | Storage Blob Data Contributor | ${storageScope}/blobServices/default/containers/backups`,
    ].sort(),
  );
  assert.ok(
    !grants.some((g) => g.startsWith(`${ID.migrate} |`) && g.includes('Contributor')),
    'o migrate nunca escreve no Blob',
  );
  const padrao = profileModel('padrao');
  const migratePadrao = padrao.one('Microsoft.App/jobs', 'job-migrate');
  assert.equal(migratePadrao.properties.configuration.identitySettings[0].lifecycle, 'None');
  assert.ok(!('STORAGE_BLOB_ENDPOINT' in envOf(migratePadrao)));
  assert.ok(!padrao.grants().some((g) => g.startsWith(`${ID.migrate} | Storage`)));
  assert.ok(!padrao.grants().some((g) => g.startsWith('admin | Storage')));
});

test('[padrao] a api não tem CORS (mesmo domínio pelo Front Door)', () => {
  const api = profileModel('padrao').one('Microsoft.App/containerApps', 'ca-api');
  assert.ok(api.properties.configuration.ingress.corsPolicy == null);
});

// =================================================================================================
// 4. Variantes: fase 1 (sem apps) e Azure OpenAI ligado
// =================================================================================================
test('[fase 1] deployApps = false cria tudo menos Container Apps e jobs (sem tag de imagem nem versão do prompt)', () => {
  // Na fase 1 ainda não há imagem nem prompt semeado: os três valores vazios não podem parar o deploy.
  const m = snapshot('fase1', {
    deployApps: 'false',
    apiImageTag: "''",
    webImageTag: "''",
    promptArenaVersion: "''",
    legalControllerName: "''",
    legalContactEmail: "''",
    ...FIRST_DEPLOY,
  });
  assert.equal(m.workloads.length, 0);
  m.one('Microsoft.App/managedEnvironments', 'cae-alvesting');
  m.one('Microsoft.KeyVault/vaults');
  m.one('Microsoft.DBforPostgreSQL/flexibleServers');
  m.one('Microsoft.Cdn/profiles', 'afd-alvesting');
  assert.ok(m.secretNames().includes('database-url'), 'database-url nasce na fase 1');
  assert.ok(m.secretNames().includes('front-door-id'), 'front-door-id nasce na fase 1');
});

test('imagens e prompt: nenhum latest nos .bicepparam; tag e versão vêm do ambiente e, sem elas, os apps não sobem', () => {
  for (const [name, file] of Object.entries(PARAMS)) {
    const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    for (const [param, variable] of [
      ['apiImageTag', 'ALVESTING_API_TAG'],
      ['webImageTag', 'ALVESTING_WEB_TAG'],
      ['promptArenaVersion', 'ALVESTING_PROMPT_ARENA_VERSION'],
    ]) {
      assert.match(
        code,
        new RegExp(`^param ${param} = readEnvironmentVariable\\('${variable}', ''\\)$`, 'm'),
        `${name}: ${param} vem de ${variable}, sem valor padrão`,
      );
    }
    assert.doesNotMatch(code, /latest/i, `${name}: tag latest`);
  }

  // A trava mora no módulo dos apps, como a senha do Postgres no módulo do banco: a fase 1 não precisa dos três
  // valores (teste [fase 1]); a fase 2 não sobe sem eles. A versão do Key Vault tem 32 hexadecimais.
  const built = bicep(['build', MAIN, '--stdout'], { withInputs: false });
  assert.equal(built.status, 0, built.err);
  const apps = JSON.parse(built.out).resources.find(
    (r) => r.type === 'Microsoft.Resources/deployments' && r.name === 'apps',
  );
  const { parameters } = apps.properties.template;
  assert.equal(parameters.apiImageTag.minLength, 1, 'apiImageTag não vazia');
  assert.equal(parameters.webImageTag.minLength, 1, 'webImageTag não vazia');
  assert.equal(parameters.promptArenaVersion.minLength, 32);
  assert.equal(parameters.promptArenaVersion.maxLength, 32);

  // A conta (etapa 11): o controlador e o contato da privacidade vêm do ambiente, sem valor padrão (nunca no repositório), e a api
  // recusa subir em produção sem eles, então os apps não sobem com eles vazios. O client ID do Google é opcional.
  assert.equal(parameters.legalControllerName.minLength, 1, 'legalControllerName não vazio');
  assert.equal(parameters.legalContactEmail.minLength, 1, 'legalContactEmail não vazio');
  assert.equal(parameters.googleClientId.minLength, undefined, 'googleClientId pode ser vazio');
  for (const [name, file] of Object.entries(PARAMS)) {
    const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    for (const [param, variable] of [
      ['legalControllerName', 'ALVESTING_LEGAL_CONTROLLER_NAME'],
      ['legalContactEmail', 'ALVESTING_LEGAL_CONTACT_EMAIL'],
      ['googleClientId', 'ALVESTING_GOOGLE_CLIENT_ID'],
    ]) {
      assert.match(
        code,
        new RegExp(`^param ${param} = readEnvironmentVariable\\('${variable}', ''\\)$`, 'm'),
        `${name}: ${param} vem de ${variable}, sem valor padrão`,
      );
    }
  }

  // As imagens usam as tags recebidas: a da api nos papéis do back, a do web no ca-web.
  for (const w of profileModel('padrao').workloads) {
    const image = containersOf(w)[0].image;
    const tag = w.name === 'ca-web' ? INPUT_ENV.ALVESTING_WEB_TAG : INPUT_ENV.ALVESTING_API_TAG;
    assert.ok(image.includes(tag), `${w.name}: imagem com a tag ${tag}`);
  }
});

// As duas senhas do Postgres (a do administrador e a do login da api) vêm do ambiente, sem valor padrão, e o módulo do banco as tranca TARDE:
// @secure e @minLength. Faltou, o deploy para antes de criar o servidor ou de gravar o segredo (docs/INFRA.md, 2.2 e passo 2). A da api tem
// pelo menos 32 caracteres, como o db:roles (apps/api/src/infrastructure/database/api-login.ts) exige em produção.
test('senhas do Postgres: do ambiente, @secure e trava de tamanho no módulo do banco (administrador e login da api)', () => {
  for (const [name, file] of Object.entries(PARAMS)) {
    const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    for (const [param, variable] of [
      ['postgresAdminPassword', 'ALVESTING_PG_ADMIN_PASSWORD'],
      ['postgresApiPassword', 'ALVESTING_PG_API_PASSWORD'],
    ]) {
      assert.match(
        code,
        new RegExp(`^param ${param} = readEnvironmentVariable\\('${variable}', ''\\)$`, 'm'),
        `${name}: ${param} vem de ${variable}, sem valor padrão`,
      );
    }
  }
  const built = bicep(['build', MAIN, '--stdout'], { withInputs: false });
  assert.equal(built.status, 0, built.err);
  const template = JSON.parse(built.out);
  for (const param of ['postgresAdminPassword', 'postgresApiPassword']) {
    assert.equal(template.parameters[param].type, 'securestring', `${param}: @secure`);
  }
  const postgres = template.resources.find(
    (r) => r.type === 'Microsoft.Resources/deployments' && r.name === 'postgres',
  );
  const { parameters } = postgres.properties.template;
  assert.deepEqual(
    [parameters.adminPassword.type, parameters.adminPassword.minLength],
    ['securestring', 16],
  );
  assert.deepEqual(
    [parameters.apiPassword.type, parameters.apiPassword.minLength],
    ['securestring', 32],
  );
});

test('[google] sem ALVESTING_GOOGLE_CLIENT_ID a variável nem é injetada (o login por Google não existe e nada quebra)', () => {
  const m = snapshot('sem-google', { googleClientId: "''", ...FIRST_DEPLOY });
  const api = envOf(m.one('Microsoft.App/containerApps', 'ca-api'));
  assert.equal(api.GOOGLE_CLIENT_ID, undefined);
  // o secret continua por referência (o app trata o PENDENTE do cofre como ausente) e o resto da conta segue igual
  assert.equal(api.GOOGLE_CLIENT_SECRET?.secretRef, 'google-oauth-client-secret');
  assert.equal(api.LEGAL_CONTACT_EMAIL?.value, INPUT_ENV.ALVESTING_LEGAL_CONTACT_EMAIL);
});

test('[domínio próprio] sem customDomain não há domínio; com ele, rotas e WAF o usam (certificado gerenciado)', () => {
  const plain = profileModel('padrao');
  assert.equal(plain.ofType('Microsoft.Cdn/profiles/customDomains').length, 0);
  for (const route of plain.ofType('Microsoft.Cdn/profiles/afdEndpoints/routes')) {
    assert.deepEqual(route.properties.customDomains, [], `${route.name}: sem domínio`);
  }

  const m = snapshot('dominio', { customDomain: "'alvesting.example.com'" });
  const domain = m.one('Microsoft.Cdn/profiles/customDomains');
  assert.equal(domain.properties.hostName, 'alvesting.example.com');
  assert.equal(domain.properties.tlsSettings.certificateType, 'ManagedCertificate');
  const domainName = domain.name.split('/').pop();
  const all = m.ofType('Microsoft.Cdn/profiles/afdEndpoints/routes');
  // o domínio próprio é do site: as 4 rotas do endpoint dele o usam, e as 2 do green (que só o deploy visita) não
  const routes = all.filter((r) => r.name.split('/')[1] === 'alvesting');
  assert.equal(routes.length, 4);
  assert.equal(all.length, 6, 'as 4 do site e as 2 do green');
  for (const route of routes) {
    assert.ok(
      route.properties.customDomains.some((d) => d.id.endsWith(`/customDomains/${domainName}`)),
      `${route.name}: usa o domínio próprio`,
    );
  }
  for (const route of all.filter((r) => r.name.split('/')[1] === 'alvesting-green')) {
    assert.deepEqual(
      route.properties.customDomains,
      [],
      `${route.name}: o green não usa o domínio`,
    );
  }
  const [association] = m.one('Microsoft.Cdn/profiles/securityPolicies').properties.parameters
    .associations;
  assert.equal(
    association.domains.length,
    3,
    'o WAF cobre o endpoint do site, o do green e o domínio',
  );
});

// A rotina (valores dos .bicepparam) é o que o what-if da segunda execução avalia. Regravar um segredo
// derivado cria uma versão nova no Key Vault, e o Container Apps reinicia as revisões que o referenciam; o
// orçamento regravado em outro mês é recusado pela Azure. Então a rotina tem de ser o primeiro deploy MENOS
// exatamente isso: nem um recurso a mais, nem um a menos, nem uma propriedade diferente.
for (const profile of PROFILES) {
  test(`[${profile}] rotina: não regrava segredo derivado nem orçamento, e todo o resto é idêntico ao primeiro deploy`, () => {
    const first = profileModel(profile);
    const routine = routineModel(profile);
    assert.deepEqual(routine.secretNames(), [], 'nenhum segredo derivado na rotina');
    assert.equal(
      routine.ofType('Microsoft.Consumption/budgets').length,
      0,
      'sem orçamento na rotina',
    );
    assert.ok(
      first.secretNames().length >= 3 && first.ofType('Microsoft.Consumption/budgets').length === 1,
    );
    const kept = (resources) =>
      resources
        .filter(
          (r) =>
            !['Microsoft.KeyVault/vaults/secrets', 'Microsoft.Consumption/budgets'].includes(
              r.type,
            ),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(kept(routine.resources), kept(first.resources));
  });
}

test('idempotência: duas avaliações do mesmo perfil dão exatamente o mesmo deploy', () => {
  const a = runSnapshot('igual-a', { profile: "'padrao'" });
  const b = runSnapshot('igual-b', { profile: "'padrao'" });
  assert.deepEqual(a, b);
});

test('[openai] enableOpenAI = true: conta sem chave (Entra), DataZoneStandard, papel e prompt-chat só da api', () => {
  const m = snapshot('openai', { enableOpenAI: 'true', ...FIRST_DEPLOY });
  const account = m.one('Microsoft.CognitiveServices/accounts');
  assert.equal(account.kind, 'OpenAI');
  assert.equal(account.sku.name, 'S0');
  assert.ok(account.properties.customSubDomainName, 'o token do Entra exige o subdomínio próprio');
  assert.equal(account.properties.disableLocalAuth, true, 'sem autenticação por chave');
  const deployments = m.ofType('Microsoft.CognitiveServices/accounts/deployments');
  assert.equal(deployments.length, 1);
  // GlobalStandard processa o prompt em qualquer região da Azure; DataZoneStandard só dentro da zona de dados dos
  // EUA, que é a transferência que a política de privacidade informa (plano §12, art. 33 da LGPD).
  assert.equal(deployments[0].sku.name, 'DataZoneStandard');

  // Sem chave: nem segredo derivado, nem variável, nem referência.
  assert.ok(!m.secretNames().includes('azure-openai-key'));
  const api = m.one('Microsoft.App/containerApps', 'ca-api');
  const env = envOf(api);
  assert.ok(!('AZURE_OPENAI_API_KEY' in env), 'sem AZURE_OPENAI_API_KEY');
  assert.ok(env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT);
  assert.ok(!api.properties.configuration.secrets.some((s) => s.name === 'azure-openai-key'));

  // O papel Cognitive Services OpenAI User só da api, e o prompt do chat só dela também.
  assert.deepEqual(m.grants(), expectedGrants({ padrao: true, openai: true }));
  assert.equal(env.PROMPT_CHAT?.secretRef, 'prompt-chat');
  assert.equal(env.PROMPT_CHAT.value, undefined);
  const withChatPrompt = m.workloads.filter((w) =>
    (w.properties.configuration.secrets ?? []).some((s) => s.name === 'prompt-chat'),
  );
  assert.deepEqual(
    withChatPrompt.map((w) => w.name),
    ['ca-api'],
  );
  assert.ok(
    m.isKeyVaultUrl(api.properties.configuration.secrets.find((s) => s.name === 'prompt-chat')),
  );

  // Rotina com o OpenAI já ligado: a conta continua no template e nada é regravado.
  const routine = snapshot('openai-rotina', { enableOpenAI: 'true' });
  assert.equal(routine.ofType('Microsoft.CognitiveServices/accounts').length, 1);
  assert.deepEqual(routine.secretNames(), [], 'rotina não regrava segredo derivado');
});

// =================================================================================================
// 5. seed-secrets.sh, com um `az` falso (nenhuma chamada à Azure)
// =================================================================================================
// O cofre falso é uma pasta com um arquivo por segredo; a tag pendente vira um arquivo ao lado.
// O script só pode LISTAR (nome e tag, sem valor) e GRAVAR: `show` e `download` baixam o valor do segredo (e o texto
// dos prompts passaria pela memória do az e geraria um SecretGet no log de auditoria). Recusar com exit não basta,
// porque o script poderia engolir o erro (`|| true`): por isso o falso registra TODA chamada em $FAKE_CALLS
// (argumentos separados por TAB, antes de qualquer recusa) e o teste afirma depois que só houve `list` e `set`.
// A única consulta aceita é a que o script faz; a saída imita o `-o tsv` real, que imprime None para tag ausente.
const FAKE_AZ = `#!/bin/sh
printf '%s\\t' "$@" >> "$FAKE_CALLS"; echo >> "$FAKE_CALLS"
[ "$1" = keyvault ] && [ "$2" = secret ] || exit 99
action=$3; shift 3
name=; file=; tags=; query=; output=
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name=$2; shift ;;
    --file) file=$2; shift ;;
    --tags) tags=$2; shift ;;
    --query) query=$2; shift ;;
    -o) output=$2; shift ;;
  esac
  shift
done
if [ -n "$FAKE_FORBIDDEN" ]; then echo "(Forbidden) Caller is not authorized" >&2; exit 1; fi
case $action in
  list)
    { [ "$query" = '[].[name, tags.pendente]' ] && [ "$output" = tsv ]; } || { echo "consulta inesperada: $query -o $output" >&2; exit 98; }
    for f in "$FAKE_VAULT"/*; do
      [ -e "$f" ] || continue
      n=\${f##*/}
      case $n in *.pendente) continue ;; esac
      if [ -f "$f.pendente" ]; then printf '%s\\ttrue\\n' "$n"; else printf '%s\\tNone\\n' "$n"; fi
    done ;;
  show) echo "o script leu o valor de um segredo (az keyvault secret show)" >&2; exit 97 ;;
  set)
    cp "$file" "$FAKE_VAULT/$name"
    if [ -n "$tags" ]; then : > "$FAKE_VAULT/$name.pendente"; else rm -f "$FAKE_VAULT/$name.pendente"; fi ;;
  *) echo "o script chamou az keyvault secret $action, que o teste não conhece" >&2; exit 96 ;;
esac
`;

test('seed-secrets.sh: semeia o que falta, não sobrescreve valor real, não expõe valor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alvesting-seed-'));
  try {
    const vault = join(dir, 'vault');
    mkdirSync(vault);
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'az'), FAKE_AZ, { mode: 0o755 });
    const promptFile = join(dir, 'prompt-arena.txt');
    writeFileSync(promptFile, 'linha 1 do prompt\nlinha 2 do prompt\n');
    const calls = join(dir, 'calls.log');
    const base = {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      HOME: process.env.HOME,
      FAKE_VAULT: vault,
      FAKE_CALLS: calls,
    };
    // Sem TTY (input vazio): o script não pergunta nada.
    const seed = (extra) =>
      spawnSync('bash', [SEED, 'kv-teste'], {
        encoding: 'utf8',
        input: '',
        env: { ...base, ...extra },
      });
    const read = (name) => readFileSync(join(vault, name), 'utf8');
    const exists = (name) => existsSync(join(vault, name));

    const first = seed({
      ALVESTING_SECRET_OPENROUTER_API_KEY: 'sk-primeiro',
      ALVESTING_SECRET_PROMPT_ARENA_FILE: promptFile,
    });
    assert.equal(first.status, 0, first.stderr);
    assert.ok(read('better-auth-secret').length >= 32, 'segredo aleatório gerado');
    assert.ok(read('revalidate-secret').length >= 32);
    assert.ok(read('quotes-secret').length >= 32, 'o segredo das cotações é aleatório e longo');
    assert.notEqual(
      read('quotes-secret'),
      read('revalidate-secret'),
      'cada segredo aleatório é um sorteio próprio',
    );
    assert.equal(read('openrouter-api-key'), 'sk-primeiro');
    for (const pending of ['google-oauth-client-secret', 'brapi-token']) {
      assert.equal(read(pending), 'PENDENTE');
      assert.ok(exists(`${pending}.pendente`), `${pending} com a tag pendente`);
    }
    assert.equal(read('prompt-arena'), 'linha 1 do prompt\nlinha 2 do prompt\n');
    assert.ok(!exists('prompt-chat'), 'prompt sem arquivo fica ausente, sem valor provisório');
    assert.match(first.stdout, /prompt-chat\s+AUSENTE/);
    // o fecho lembra os cinco segredos que o Bicep deriva (o login da api inclusive: não se semeia à mão)
    assert.match(first.stdout, /database-url-api/);
    const shown = `${first.stdout}${first.stderr}`;
    for (const secret of [
      'sk-primeiro',
      'linha 1 do prompt',
      read('better-auth-secret'),
      read('quotes-secret'),
    ]) {
      assert.ok(!shown.includes(secret), 'o script não pode imprimir valores de segredo');
    }

    const authBefore = read('better-auth-secret');
    const quotesBefore = read('quotes-secret');
    const second = seed({
      ALVESTING_SECRET_OPENROUTER_API_KEY: 'sk-segundo',
      ALVESTING_SECRET_BRAPI_TOKEN: 'brapi-real',
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(read('openrouter-api-key'), 'sk-primeiro', 'valor real não é sobrescrito');
    assert.equal(read('better-auth-secret'), authBefore, 'segundo run não gera outro aleatório');
    assert.equal(read('quotes-secret'), quotesBefore, 'nem o das cotações');
    assert.equal(read('brapi-token'), 'brapi-real', 'pendente é substituído quando há valor');
    assert.ok(!exists('brapi-token.pendente'), 'a tag pendente sai junto');
    assert.equal(
      read('google-oauth-client-secret'),
      'PENDENTE',
      'sem valor novo continua pendente',
    );

    const denied = seed({ FAKE_FORBIDDEN: '1' });
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /Key Vault Secrets Officer/);

    // Nas três execuções o script só listou metadado (com a consulta exata) e gravou. Qualquer outra chamada ao az
    // (`show`, `download`, `account show`...) falha aqui mesmo que o script engula o erro do falso.
    const calledAz = readFileSync(calls, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => line.replace(/\t$/, '').split('\t'));
    assert.deepEqual(
      [...new Set(calledAz.map((args) => args.slice(0, 3).join(' ')))].sort(),
      ['keyvault secret list', 'keyvault secret set'],
      'o script só pode listar metadado e gravar; baixar o valor de um segredo polui o AuditEvent do cofre',
    );
    for (const args of calledAz.filter((args) => args[2] === 'list')) {
      assert.equal(
        args[args.indexOf('--query') + 1],
        '[].[name, tags.pendente]',
        'consulta do list',
      );
      assert.equal(args[args.indexOf('-o') + 1], 'tsv', 'saída do list');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// verify-roles.sh pergunta à assinatura o nome de cada GUID do roles.bicep. O `az` falso devolve a tabela da
// Microsoft (mais um papel qualquer); a mesma pasta de testes roda o script com o roles.bicep de verdade e com
// versões quebradas dele.
test('verify-roles.sh: confere cada GUID com o nome que a Azure dá e falha no GUID errado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alvesting-roles-'));
  try {
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'infra', 'scripts'), { recursive: true });
    writeFileSync(
      join(dir, 'bin', 'az'),
      '#!/bin/sh\n[ "$1 $2 $3" = "role definition list" ] || exit 99\ncat "$FAKE_ROLES"\n',
      { mode: 0o755 },
    );
    copyFileSync(VERIFY_ROLES, join(dir, 'infra', 'scripts', 'verify-roles.sh'));
    const listing = (roles) =>
      `${[['acdd72a7-3385-48ef-bd42-f606fba81ae7', 'Reader'], ...roles].map((r) => r.join('\t')).join('\n')}\n`;
    const run = (roles) => {
      writeFileSync(join(dir, 'azure.tsv'), listing(roles));
      return spawnSync('bash', [join(dir, 'infra', 'scripts', 'verify-roles.sh')], {
        encoding: 'utf8',
        env: {
          PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
          HOME: process.env.HOME,
          FAKE_ROLES: join(dir, 'azure.tsv'),
        },
      });
    };
    const bicepFile = join(dir, 'infra', 'roles.bicep');
    const original = readFileSync(ROLES, 'utf8');

    // 1. O roles.bicep do repositório contra a tabela da Microsoft: tudo ok.
    writeFileSync(bicepFile, original);
    const good = run([...BUILT_IN_ROLES]);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stdout.match(/^ok /gm)?.length, BUILT_IN_ROLES.size);

    // 2. O GUID errado do blocker original (...0f2c2cf0c5d6): a Azure não conhece, o script tem de falhar.
    writeFileSync(
      bicepFile,
      original.replace(
        '4633458b-17de-408a-b874-0445c86b69e6',
        '4633458b-17de-408a-b874-0f2c2cf0c5d6',
      ),
    );
    const wrong = run([...BUILT_IN_ROLES]);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /4633458b-17de-408a-b874-0f2c2cf0c5d6.*nenhum papel com esse GUID/);

    // 3. GUID que existe, mas é de outro papel: também falha, dizendo qual é.
    writeFileSync(bicepFile, original);
    const swapped = run(
      [...BUILT_IN_ROLES].map(([guid, name]) => [guid, name === 'AcrPull' ? 'AcrPush' : name]),
    );
    assert.equal(swapped.status, 1);
    assert.match(swapped.stderr, /esperava "AcrPull", a Azure diz "AcrPush"/);

    // 4. Sem nenhuma linha reconhecível, o script não pode passar por vazio.
    writeFileSync(bicepFile, '// vazio\n');
    assert.equal(run([...BUILT_IN_ROLES]).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// =================================================================================================
// 6. Documentação: o que o docs/INFRA.md afirma tem de bater com o template compilado
// =================================================================================================
const REPO = REPO_ROOT;
const INFRA_DOC = () => readFileSync(join(REPO, 'docs', 'INFRA.md'), 'utf8');

// A tabela da seção 2.7: "Variável | Workloads | Origem | Quando | Para quê". Uma linha pode listar várias
// variáveis e vários workloads (cada um entre crases); `job-sched-*` vale pelos 7 agendadores.
function envContractRows() {
  const lines = INFRA_DOC().split('\n');
  const header = lines.findIndex((line) =>
    /^\|\s*Variável\s*\|\s*Workloads\s*\|\s*Origem\s*\|\s*Quando\s*\|\s*Para quê\s*\|\s*$/.test(
      line,
    ),
  );
  assert.ok(
    header >= 0,
    'INFRA.md: falta a tabela "Variável | Workloads | Origem | Quando | Para quê"',
  );
  const quoted = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
    assert.equal(
      cells.length,
      5,
      `linha da tabela de ambiente com ${cells.length} colunas: ${line}`,
    );
    assert.ok(cells.every(Boolean), `linha da tabela de ambiente com célula vazia: ${line}`);
    rows.push({
      variables: quoted(cells[0]),
      workloads: quoted(cells[1]).flatMap((w) =>
        w === 'job-sched-*' ? Object.keys(CRONS).map((name) => `job-sched-${name}`) : [w],
      ),
      origin: cells[2],
      when: cells[3],
    });
  }
  return rows;
}

test('INFRA.md, 2.7: o contrato de ambiente lista exatamente as variáveis que o Bicep injeta em cada workload', () => {
  const documented = new Map(); // "workload|VARIÁVEL" -> linha da tabela
  for (const row of envContractRows()) {
    assert.ok(
      row.variables.length > 0 && row.workloads.length > 0,
      `linha sem variável ou workload`,
    );
    for (const workload of row.workloads) {
      for (const variable of row.variables) {
        const key = `${workload}|${variable}`;
        assert.ok(!documented.has(key), `${key}: listada duas vezes`);
        documented.set(key, row);
      }
    }
  }
  // O que o template injeta, nos três cenários que mudam o conjunto: padrão, econômico e Azure OpenAI ligado.
  const scenarios = {
    padrao: profileModel('padrao'),
    economico: profileModel('economico'),
    openai: snapshot('openai', { enableOpenAI: 'true', ...FIRST_DEPLOY }),
  };
  const injected = new Map(); // "workload|VARIÁVEL" -> { secretRef, cenários }
  for (const [scenario, m] of Object.entries(scenarios)) {
    for (const w of m.workloads) {
      for (const e of containersOf(w).flatMap((c) => c.env ?? [])) {
        const key = `${w.name}|${e.name}`;
        const item = injected.get(key) ?? { secretRef: e.secretRef, scenarios: new Set() };
        assert.equal(item.secretRef, e.secretRef, `${key}: origem diferente entre cenários`);
        item.scenarios.add(scenario);
        injected.set(key, item);
      }
    }
  }
  assert.deepEqual(
    [...injected.keys()].filter((key) => !documented.has(key)).sort(),
    [],
    'o Bicep injeta e o INFRA.md (2.7) não lista',
  );
  assert.deepEqual(
    [...documented.keys()].filter((key) => !injected.has(key)).sort(),
    [],
    'o INFRA.md (2.7) lista e o Bicep não injeta',
  );
  for (const [key, { secretRef, scenarios: present }] of injected) {
    const row = documented.get(key);
    if (secretRef) {
      assert.ok(
        row.origin.includes(`\`${secretRef}\``),
        `${key}: a origem tem de citar o segredo ${secretRef}`,
      );
    } else {
      assert.match(row.origin, /^valor/, `${key}: variável em texto puro tem origem "valor"`);
    }
    // o que só o econômico injeta (o repasse do site, a restauração do migrate; ADR 0039) diz "econômico"
    const when = present.has('economico')
      ? present.has('padrao')
        ? 'sempre'
        : 'econômico'
      : present.has('padrao')
        ? 'padrão'
        : 'enableOpenAI';
    assert.ok(
      row.when.includes(when),
      `${key}: coluna Quando tem de dizer "${when}", diz "${row.when}"`,
    );
  }
});

test('INFRA.md cita cada identidade, cada papel (GUID) e cada entrada do ambiente dos .bicepparam', () => {
  const doc = INFRA_DOC();
  for (const identity of ALL_IDENTITIES) {
    assert.ok(doc.includes(`\`${identity}\``), `INFRA.md não cita a identidade ${identity}`);
  }
  for (const guid of BUILT_IN_ROLES.keys()) {
    assert.ok(doc.includes(guid), `INFRA.md não cita o GUID ${guid} (3.2)`);
  }
  const inputs = new Set(
    Object.values(PARAMS).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/readEnvironmentVariable\('([A-Z_]+)'/g)].map(
        (m) => m[1],
      ),
    ),
  );
  assert.ok(inputs.size >= 6, 'os .bicepparam leem pelo menos as 6 entradas do ambiente');
  for (const variable of inputs) {
    assert.ok(doc.includes(variable), `INFRA.md não explica a entrada ${variable}`);
  }
});

test('a identidade única do plano (extinta pelo ADR 0020) não sobra na infra nem nos documentos operacionais', () => {
  const files = [
    ...readdirSync(INFRA, { recursive: true })
      .filter((file) => !file.startsWith('tests') && /\.(bicep|bicepparam|sh|json)$/.test(file))
      .map((file) => join(INFRA, file)),
    join(REPO, 'docs', 'INFRA.md'),
    join(REPO, 'docs', 'JOBS.md'),
  ];
  assert.ok(files.length > 15, `arquivos lidos: ${files.length}`);
  const stale = files.filter((file) => readFileSync(file, 'utf8').includes('id-alvesting-apps'));
  assert.deepEqual(stale, [], 'ainda citam a id-alvesting-apps');
});

// Cada alerta tem uma linha na tabela de alertas do docs/INFRA.md (seção 5): o que dispara e o que fazer. O docs/RUNBOOK.md liga a cada
// linha (quem confere é o apps/api/src/runbook.spec.ts). Um alerta novo no Bicep sem linha no documento reprova.
test('INFRA.md, seção 5: cada alerta e cada sinal da aplicação têm a sua linha (o que dispara, o que fazer)', () => {
  const infra = readFileSync(join(INFRA, '..', 'docs', 'INFRA.md'), 'utf8');
  const section = infra.slice(
    infra.indexOf('## 5. Observabilidade'),
    infra.indexOf('## 6. Subir do zero'),
  );
  assert.ok(section.length > 500, 'seção 5 do INFRA.md não achada');
  const rows = section.split('\n').filter((line) => line.startsWith('|'));
  const names = [
    ...Object.keys(METRIC_ALERTS),
    LOG_ALERT,
    ...Object.values(ALERT_SIGNAL),
    'budget-alvesting',
  ];
  for (const name of names) {
    const row = rows.find((line) => line.includes(`\`${name}\``));
    assert.ok(row, `sem linha para \`${name}\` na tabela de alertas do INFRA.md`);
    // as colunas: alerta | tipo | severidade | frequência e janela | o que dispara | o que fazer
    assert.ok(
      row.split('|').length >= 7 &&
        row
          .split('|')
          .slice(1, -1)
          .every((cell) => cell.trim() !== ''),
      `linha de \`${name}\` incompleta`,
    );
  }
});

// O backup-verify chama pg_dump e pg_restore pelo PATH (docs/INFRA.md, 2.8) e o código recusa binário de outro major que o do servidor (17).
// O Debian 12 só traz o cliente 15, então o 17 vem do repositório oficial PGDG, com o major fixo no nome do pacote. `docker build` não roda
// onde o repositório é desenvolvido; quem prova o binário de verdade é o job `images` do CI (pg_dump --version dentro da imagem), e aqui se
// trava o que dá para ler: o pacote certo, no estágio certo, com a chave do repositório.
test('postgresql-client-17: na imagem da api (PGDG, bookworm, só no estágio de execução) e no job check do CI', () => {
  const dockerfile = readFileSync(join(REPO_ROOT, 'apps', 'api', 'Dockerfile'), 'utf8');
  const base = /^FROM (\S+) AS base$/m.exec(dockerfile)?.[1] ?? '';
  assert.match(base, /-bookworm-slim$/, 'a base é o Debian 12 (bookworm)');
  const runtime = dockerfile.slice(dockerfile.indexOf('FROM base AS runtime'));
  const build = dockerfile.slice(0, dockerfile.indexOf('FROM base AS runtime'));
  assert.match(runtime, /postgresql-client-17(?![\w.-])/, 'pacote com o major no nome');
  assert.doesNotMatch(
    runtime.replace(/#.*$/gm, ''),
    /postgresql-client(?!-17)/,
    'sem pacote sem major: o "postgresql-client" puxaria o major do Debian (15)',
  );
  assert.match(
    runtime,
    /https:\/\/apt\.postgresql\.org\/pub\/repos\/apt bookworm-pgdg main/,
    'repositório PGDG do bookworm',
  );
  assert.match(runtime, /signed-by=\S+apt\.postgresql\.org\.asc/, 'chave do repositório');
  assert.match(runtime, /https:\/\/www\.postgresql\.org\/media\/keys\/ACCC4CF8\.asc/);
  // a impressão digital que a página de download do PostgreSQL publica para a chave ("Verify the key", lida em 03/11/2026), conferida no build.
  // O arquivo também tem de ter UMA chave só: o `signed-by` do apt confia em TODAS as chaves do arquivo, então uma segunda chave depois da
  // certa passaria numa conferência que olhasse só o primeiro `fpr`. O `awk` do Dockerfile roda aqui contra a saída (sintética) do `gpg
  // --with-colons`, e não só tem o texto procurado.
  assert.match(runtime, /gpg --show-keys --with-colons/, 'a chave baixada é conferida');
  const keyCheck =
    /test "\$\(gpg --show-keys --with-colons \S+ \| awk -F: '([^']+)'\)" = "([^"]+)" \\/.exec(
      runtime,
    );
  assert.ok(
    keyCheck,
    'a conferência da chave é `test "$(gpg --show-keys --with-colons ARQUIVO | awk -F: \'...\')" = "<chaves> <impressão digital>"`',
  );
  const [, awkProgram, expectedKey] = keyCheck;
  assert.equal(expectedKey, '1 B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8', 'uma chave, a certa');
  const gpgKey = (fingerprint) =>
    `pub:-:4096:1:7FCC7D46ACCC4CF8:1432000000:::-:::scESC::::::23::0:\nfpr:::::::::${fingerprint}:\n` +
    `uid:-::::1432000000::0000::PostgreSQL Debian Repository::::::::::0:\n` +
    `sub:-:4096:1:AAAAAAAAAAAAAAAA:1432000000::::::e::::::23:\nfpr:::::::::${'1'.repeat(40)}:\n`;
  const official = gpgKey('B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8');
  const other = gpgKey('2'.repeat(40));
  const fromAwk = (colons) =>
    spawnSync('awk', ['-F:', awkProgram], { input: colons, encoding: 'utf8' }).stdout.trim();
  assert.equal(fromAwk(official), expectedKey, 'a chave oficial, sozinha, passa');
  for (const [what, colons] of [
    ['outra chave', other],
    ['a oficial e depois outra', official + other],
    ['outra e depois a oficial', other + official],
    ['arquivo sem chave', ''],
  ]) {
    assert.notEqual(fromAwk(colons), expectedKey, `${what}: a conferência da chave tem de recusar`);
  }
  assert.ok(!build.includes('postgresql-client'), 'o estágio de build não leva o cliente');

  const ci = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const checkJob = ci.slice(ci.indexOf('\n  check:'), ci.indexOf('\n  web:'));
  assert.match(checkJob, /apt\.postgresql\.org\.sh/, 'o job check liga o repositório PGDG');
  assert.match(checkJob, /postgresql-client-17/, 'o job check instala o cliente 17');
  // Instalar não basta: o /usr/bin/pg_dump do Debian é o `pg_wrapper`, que sem --host nem PGHOST escolhe a versão do cluster LOCAL, e o runner
  // traz o servidor 16 (cluster 16/main). A pasta do 17 tem de ir na frente do PATH dos passos seguintes (o fixture e o `assertTools` rodam
  // `pg_dump --version` sem host) e o passo tem de provar o major.
  assert.ok(
    checkJob.includes('echo /usr/lib/postgresql/17/bin >> "$GITHUB_PATH"'),
    'o job check põe /usr/lib/postgresql/17/bin na frente do PATH dos passos seguintes (por cima do pg_wrapper)',
  );
  for (const tool of ['pg_dump', 'pg_restore']) {
    assert.ok(
      checkJob.includes(`${tool} --version | grep -q '(PostgreSQL) 17\\.'`),
      `o job check confere que o ${tool} do PATH é o 17`,
    );
  }
  const images = ci.slice(ci.indexOf('\n  images:'), ci.indexOf('\n  whatif:'));
  assert.match(images, /pg_dump --version/, 'o job images confere o pg_dump dentro da imagem');
  assert.match(images, /pg_restore --version/);
});

// --- Resultado -----------------------------------------------------------------------------------
const failed = results.filter((r) => r.error);
console.log(`bicep ${BICEP.version}\n`);
for (const r of results) {
  console.log(`${r.error ? 'FALHOU' : 'ok    '}  ${r.name}`);
  if (r.error)
    console.log(
      `        ${String(r.error.message ?? r.error)
        .split('\n')
        .join('\n        ')}`,
    );
}
console.log(`\n${results.length - failed.length} de ${results.length} verificações passaram`);
process.exitCode = failed.length === 0 ? 0 : 1;
