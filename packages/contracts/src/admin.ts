import { z } from 'zod';
import { SKIP_REASONS } from './cycle.js';
import { QUEUES, ulidSchema, type QueueName } from './messages.js';
import { queryDateSchema, slugSchema } from './public.js';
import {
  competitorSpecSchema,
  seasonFileSchema,
  seasonParamsSchema,
  seasonStatusSchema,
} from './season.js';

// As rotas de admin (plano §9, etapa 10, parte 2; docs/API.md, seção 8): o que o painel do site e o `curl` de quem opera mandam e
// recebem. Estrito de propósito, como os outros contratos: campo que não está aqui não entra no corpo nem sai na resposta. Nunca
// entram o texto do prompt, o IO bruto, endereço de Blob, chave nem dado pessoal. O mesmo schema valida a resposta na api e no site.

const isoDateTime = z.iso.datetime();
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
// custo das LLMs em micro-dólares (1 US$ = 1.000.000): inteiro, sem float
const microUsd = count;

// --- filas e DLQ -----------------------------------------------------------------------------------------------------------
// Quantos MessageId uma chamada de reenvio aceita: cada um abre um receiver e examina até 100 mensagens da DLQ, e a DLQ é para a
// pessoa olhar mensagem por mensagem, não para soltar em massa (ADR 0015).
export const ADMIN_DLQ_MAX_PER_CALL = 10;
// Quantas mensagens da DLQ de cada fila o painel lê (peek): é também o teto da contagem ("20 ou mais").
export const ADMIN_DLQ_LISTED = 20;
// Os cortes de texto que a api aplica antes de responder (admin-reports.service.ts) e que o schema da resposta confere: um número só,
// nos dois lados, senão um corte maior que o schema vira 500.
export const ADMIN_TEXT_MAX = {
  error: 300,
  reason: 120,
  description: 300,
  messageId: 200,
} as const;

export const queueNameSchema = z.enum(Object.keys(QUEUES) as [QueueName, ...QueueName[]]);

// O MessageId que messageId() (messages.ts) monta: o tipo e a chave natural, só com letras, dígitos e `: . _ -`. Nada de espaço,
// barra, quebra de linha nem texto grande: o id vai ao Service Bus e ao log.
export const dlqMessageIdSchema = z
  .string()
  .min(3)
  .max(ADMIN_TEXT_MAX.messageId)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/);

export const dlqResubmitBodySchema = z
  .strictObject({
    messageIds: z.array(dlqMessageIdSchema).min(1).max(ADMIN_DLQ_MAX_PER_CALL),
  })
  .refine((body) => new Set(body.messageIds).size === body.messageIds.length, {
    path: ['messageIds'],
    message: 'ids repetidos',
  });
export type DlqResubmitBody = z.infer<typeof dlqResubmitBodySchema>;

// Idempotente pelo MessageId: o que já foi reenviado não está mais na DLQ, e repetir devolve not_found sem publicar nada.
export const DLQ_RESUBMIT_RESULTS = ['resubmitted', 'not_found', 'invalid'] as const;
export const dlqResubmitSchema = z.strictObject({
  queue: queueNameSchema,
  results: z.array(
    z.strictObject({ messageId: dlqMessageIdSchema, result: z.enum(DLQ_RESUBMIT_RESULTS) }),
  ),
});
export type DlqResubmit = z.infer<typeof dlqResubmitSchema>;

// --- temporadas ------------------------------------------------------------------------------------------------------------
// A temporada como o admin a vê: o arquivo do season:create (nome, parâmetros e elenco) mais o estado. É o que o painel mostra e o que
// ele devolve para editar o rascunho. Sem config de provedor além do que o arquivo da temporada já tem (capacidades e preços).
export const adminSeasonSchema = z.strictObject({
  id: ulidSchema,
  slug: slugSchema,
  name: z.string().min(1).max(80),
  status: seasonStatusSchema,
  startDate: z.iso.date().nullable(),
  createdAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  params: seasonParamsSchema,
  competitors: z.array(competitorSpecSchema),
});
export type AdminSeason = z.infer<typeof adminSeasonSchema>;

export const adminSeasonsSchema = z.strictObject({ seasons: z.array(adminSeasonSchema) });
export type AdminSeasons = z.infer<typeof adminSeasonsSchema>;

// POST /admin/seasons: o mesmo arquivo do season:create (docs/ARENA.md, seção 1). Cria o rascunho com o elenco.
export const seasonCreateBodySchema = seasonFileSchema;

// PATCH /admin/seasons/:id: ou inicia a temporada ({ status: 'RUNNING' }, o season:start), ou edita o rascunho (o que for enviado
// SUBSTITUI o campo inteiro, sem mesclar). O slug não muda. Temporada em andamento ou encerrada não aceita edição: regras, elenco e
// prompt ficam fixos (quem decide é o serviço, com 409). O elenco e os parâmetros só são conferidos no conjunto (um Sorteio, as três
// referências...) depois de juntar com o que já existe.
const fileShape = seasonFileSchema.shape;
export const seasonPatchBodySchema = z.union([
  z.strictObject({ status: z.literal('RUNNING') }),
  z
    .strictObject({
      name: fileShape.name.optional(),
      params: fileShape.params.optional(),
      competitors: fileShape.competitors.optional(),
    })
    .refine(
      (body) =>
        body.name !== undefined || body.params !== undefined || body.competitors !== undefined,
      { message: 'informe ao menos um campo para editar' },
    ),
]);
export type SeasonPatchBody = z.infer<typeof seasonPatchBodySchema>;

// --- reprocessar o ciclo ---------------------------------------------------------------------------------------------------
// O que aconteceu com cada temporada em andamento. published/skipped/already_closed são os do agendador (docs/ARENA.md, seção 2);
// past_deadline e not_open_yet são do reprocesso: nunca se publica nos últimos 5 minutos antes do prazo das 09:30 nem depois dele
// (past_deadline cobre a margem e o que vem depois), nem antes da hora da decisão; no_pending: todo modelo já tem decisão gravada,
// então nada a publicar.
export const CYCLE_RERUN_RESULTS = [
  'published',
  'skipped',
  'already_closed',
  'no_pending',
  'not_started',
  'season_over',
  'past_deadline',
  'not_open_yet',
] as const;
export const cycleRerunSchema = z.strictObject({
  date: queryDateSchema,
  seasons: z.array(
    z.strictObject({
      season: slugSchema,
      result: z.enum(CYCLE_RERUN_RESULTS),
      published: count.optional(),
      reason: z.enum(SKIP_REASONS).optional(),
    }),
  ),
});
export type CycleRerun = z.infer<typeof cycleRerunSchema>;

// --- evento corporativo ----------------------------------------------------------------------------------------------------
// O mesmo corpo do comando settle:event (docs/JOBS.md, seção 6): `factor` é de:para (cada "de" ações antigas viram "para" novas).
// Aqui só a forma; a direção do fator conferir com o tipo, e que o ticker existe, é do CorporateEventService.
export const CORPORATE_EVENT_KINDS = ['split', 'reverse-split', 'bonus'] as const;
export const corporateEventBodySchema = z.preprocess(
  // o terminal e o formulário digitam em minúsculas; o resto é validado como veio
  (raw) =>
    typeof raw === 'object' && raw !== null && 'ticker' in raw && typeof raw.ticker === 'string'
      ? { ...raw, ticker: raw.ticker.toUpperCase() }
      : raw,
  z.strictObject({
    // só a forma (o código negociado, até 12 caracteres); que o papel existe quem confere é o banco
    ticker: z
      .string()
      .regex(/^[A-Z0-9]{4,12}$/, 'ticker em letras maiúsculas e dígitos (ex.: BBDC4)'),
    exDate: z.iso
      .date('data ex no formato AAAA-MM-DD')
      .refine((value) => !value.startsWith('0000'), 'o ano 0000 não existe'),
    kind: z.enum(CORPORATE_EVENT_KINDS, 'tipo: split, reverse-split ou bonus'),
    // cada `de` ações antigas viram `para` novas: desdobramento 1:2, grupamento 10:1, bonificação de 10% = 10:11
    factor: z
      .string()
      .regex(
        /^[1-9]\d{0,5}:[1-9]\d{0,5}$/,
        'fator no formato de:para, inteiros positivos (ex.: 1:2)',
      ),
  }),
);
export type CorporateEventBody = z.output<typeof corporateEventBodySchema>;

// A api não liquida (o papel do Postgres dela não escreve nas tabelas de resultado da arena; ADR 0028): registra o evento, reabre o job da
// liquidação e PUBLICA a `settle` na fila, e o worker liquida. A resposta diz o que ficou enfileirado, não que o resultado já mudou.
export const corporateEventResultSchema = z.strictObject({
  event: z.strictObject({
    ticker: z.string().max(12),
    exDate: z.iso.date(),
    kind: z.enum(['SPLIT', 'REVERSE_SPLIT', 'BONUS']),
    ratioFrom: z.number().int().min(1),
    ratioTo: z.number().int().min(1),
    change: z.enum(['created', 'updated', 'unchanged']),
  }),
  // as temporadas cuja reliquidação foi ENFILEIRADA, até o último pregão que cada uma tinha liquidado (a liquidação do zero aplica o evento)
  queued: z.array(z.strictObject({ season: slugSchema, through: z.iso.date() })),
  // as que liquidaram só até antes da data ex: o evento entra quando chegarem lá
  pending: z.array(slugSchema),
});
export type CorporateEventResult = z.infer<typeof corporateEventResultSchema>;

// --- custos ----------------------------------------------------------------------------------------------------------------
// O gasto das LLMs no mês de Brasília, de todas as temporadas (a mesma soma que o sched-cycle compara com o teto), e o detalhe por
// competidor e por dia. `capMicroUsd` nulo = o teto não está configurado (o ciclo com modelo pago é pulado, fail closed).
export const adminCostsSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  capMicroUsd: microUsd.nullable(),
  spentMicroUsd: microUsd,
  rows: z.array(
    z.strictObject({
      date: z.iso.date(),
      season: slugSchema,
      competitor: slugSchema,
      name: z.string().max(80),
      costMicroUsd: microUsd,
    }),
  ),
});
export type AdminCosts = z.infer<typeof adminCostsSchema>;

// --- jobs, filas e DLQ -----------------------------------------------------------------------------------------------------
export const JOB_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'WAITING'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
const jobRun = z.strictObject({
  // a chave natural da mensagem (pregão, semana, `fonte:slot`, `ciclo:competidor`...)
  key: z.string().max(200),
  status: z.enum(JOB_STATUSES),
  attempts: z.number().int().min(1),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  // o motivo da falha, sem dado pessoal nem segredo (passa por redactText) e cortado
  error: z.string().max(ADMIN_TEXT_MAX.error).nullable(),
});

const deadLetter = z.strictObject({
  // o MessageId como o painel o mostra: passou pela limpeza de dado pessoal (redactText) e foi cortado
  messageId: z.string().max(ADMIN_TEXT_MAX.messageId),
  // true só se o id mostrado é o id de verdade E tem a forma que o reenvio aceita (dlqMessageIdSchema). Uma mensagem posta na DLQ por
  // outra ferramenta pode não ter: o painel a lista e não desenha o botão de reenvio, que sempre responderia 400.
  resubmittable: z.boolean(),
  deliveryCount: count,
  reason: z.string().max(ADMIN_TEXT_MAX.reason).nullable(),
  description: z.string().max(ADMIN_TEXT_MAX.description).nullable(),
  enqueuedAt: isoDateTime.nullable(),
});

export const adminJobsSchema = z.strictObject({
  // o último job_run de cada tipo, com quantos há em cada estado
  jobs: z.array(
    z.strictObject({
      type: z.string().max(64),
      queue: z.string().max(32),
      counts: z.strictObject({
        RUNNING: count,
        SUCCEEDED: count,
        FAILED: count,
        WAITING: count,
      }),
      latest: jobRun,
    }),
  ),
  // os FAILED mais recentes, de qualquer tipo
  failures: z.array(jobRun.extend({ type: z.string().max(64), queue: z.string().max(32) })),
  // a última conferência de cada arquivo da CVM (fetch_state.checked_at); a etag e o Last-Modified não saem
  fetchStates: z.array(z.strictObject({ source: z.string().max(64), checkedAt: isoDateTime })),
  // a DLQ de cada fila, lida com o papel de Receiver que a identidade da api já tem (peek, sem consumir). Se não deu para ler (Service
  // Bus fora, sem permissão, sem o cliente configurado), "unavailable": a resposta nunca pede papel de dono do Service Bus
  queues: z.array(
    z.strictObject({
      queue: queueNameSchema,
      deadLetters: z.discriminatedUnion('status', [
        z.strictObject({
          status: z.literal('ok'),
          count,
          // a leitura parou em ADMIN_DLQ_LISTED: há essa quantidade ou mais
          capped: z.boolean(),
          messages: z.array(deadLetter),
        }),
        z.strictObject({ status: z.literal('unavailable') }),
      ]),
    }),
  ),
});
export type AdminJobs = z.infer<typeof adminJobsSchema>;
