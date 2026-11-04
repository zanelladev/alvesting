import { describe, expect, it } from 'vitest';
import {
  ADMIN_DLQ_MAX_PER_CALL,
  ADMIN_TEXT_MAX,
  adminCostsSchema,
  adminJobsSchema,
  adminSeasonSchema,
  corporateEventBodySchema,
  corporateEventResultSchema,
  cycleRerunSchema,
  dlqMessageIdSchema,
  dlqResubmitBodySchema,
  queueNameSchema,
  seasonPatchBodySchema,
} from './admin.js';
import { QUEUES } from './messages.js';

// O contrato das rotas /api/v1/admin (etapa 10, parte 2; docs/API.md, seção 8). Estrito de propósito, como os outros: campo que não
// está aqui não entra (corpo) nem sai (resposta).

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const NOW = '2026-11-03T11:00:05.000Z';

describe('queueNameSchema', () => {
  it('aceita as filas do plano e só elas', () => {
    for (const queue of Object.keys(QUEUES)) expect(queueNameSchema.parse(queue)).toBe(queue);
    for (const bad of ['', 'Market', 'toString', '__proto__', 'market ', 'dlq', 'news/dead']) {
      expect(queueNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('dlqResubmitBodySchema: o teto por chamada e a forma do MessageId', () => {
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `eod:2026-11-${String(i + 1).padStart(2, '0')}`);

  it('aceita de 1 a ADMIN_DLQ_MAX_PER_CALL ids', () => {
    expect(dlqResubmitBodySchema.safeParse({ messageIds: ids(1) }).success).toBe(true);
    expect(
      dlqResubmitBodySchema.safeParse({ messageIds: ids(ADMIN_DLQ_MAX_PER_CALL) }).success,
    ).toBe(true);
  });

  it('recusa lista vazia, acima do teto, repetida, campo a mais e corpo que não é objeto', () => {
    expect(dlqResubmitBodySchema.safeParse({ messageIds: [] }).success).toBe(false);
    expect(
      dlqResubmitBodySchema.safeParse({ messageIds: ids(ADMIN_DLQ_MAX_PER_CALL + 1) }).success,
    ).toBe(false);
    expect(
      dlqResubmitBodySchema.safeParse({ messageIds: ['eod:2026-11-03', 'eod:2026-11-03'] }).success,
    ).toBe(false);
    expect(dlqResubmitBodySchema.safeParse({ messageIds: ids(1), all: true }).success).toBe(false);
    for (const bad of [undefined, null, 'eod:2026-11-03', ['eod:2026-11-03'], {}]) {
      expect(dlqResubmitBodySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('o MessageId tem a forma de messageId() e nenhuma outra: sem espaço, quebra de linha, barra nem texto grande', () => {
    for (const ok of [
      'eod:2026-11-03',
      'universe:2026-W45',
      'fetch:infomoney:2026-11-01T17:30:00Z',
      `decide:${ULID}:${ULID}`,
      `settle:${ULID}:2026-11-03`,
      'backup-verify:2026-11',
    ]) {
      expect(dlqMessageIdSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      '',
      'e',
      ' eod:2026-11-03',
      'eod:2026-11-03\n',
      'eod 2026',
      '../x',
      'a/b',
      ':eod',
      'x'.repeat(201),
      'eod:é',
    ]) {
      expect(dlqMessageIdSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('seasonPatchBodySchema: ou inicia a temporada, ou edita o rascunho', () => {
  const params = { randomSeed: 'a', monteCarloSeed: 'b' };

  it('{ status: "RUNNING" } é o season:start', () => {
    expect(seasonPatchBodySchema.parse({ status: 'RUNNING' })).toEqual({ status: 'RUNNING' });
  });

  it('só RUNNING: encerrar ou voltar para rascunho não é um pedido possível', () => {
    for (const status of ['FINISHED', 'DRAFT', 'running', '']) {
      expect(seasonPatchBodySchema.safeParse({ status }).success, status).toBe(false);
    }
  });

  it('a edição aceita nome, parâmetros e elenco, e pelo menos um deles', () => {
    expect(seasonPatchBodySchema.safeParse({ name: 'Outro nome' }).success).toBe(true);
    expect(seasonPatchBodySchema.safeParse({ params }).success).toBe(true);
    expect(
      seasonPatchBodySchema.safeParse({
        competitors: [{ kind: 'RANDOM', slug: 'sorteio', name: 'Sorteio' }],
      }).success,
    ).toBe(true);
    // o conjunto (um Sorteio, as três referências...) é conferido pelo serviço, depois de juntar com o resto; aqui só cada campo
    expect(seasonPatchBodySchema.safeParse({ competitors: [] }).success).toBe(false);
    expect(seasonPatchBodySchema.safeParse({}).success).toBe(false);
  });

  it('o slug e o status não se editam junto, e campo desconhecido é recusado', () => {
    for (const body of [
      { slug: 'novo' },
      { name: 'x', status: 'RUNNING' },
      { name: 'x', extra: 1 },
      { status: 'RUNNING', extra: 1 },
      { id: ULID },
    ]) {
      expect(seasonPatchBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('o nome tem o mesmo limite do arquivo da temporada', () => {
    expect(seasonPatchBodySchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(seasonPatchBodySchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('corporateEventBodySchema', () => {
  const body = { ticker: 'dobr4', exDate: '2026-11-05', kind: 'split', factor: '1:2' };

  it('o ticker digitado em minúsculas vira maiúsculo, como no comando settle:event', () => {
    expect(corporateEventBodySchema.parse(body)).toEqual({ ...body, ticker: 'DOBR4' });
  });

  it('recusa ticker, data, tipo e fator fora da forma (a direção do fator é do serviço)', () => {
    for (const bad of [
      { ...body, ticker: 'AB' },
      { ...body, ticker: 'PETR4; DROP' },
      { ...body, exDate: '2026-02-30' },
      { ...body, exDate: '0000-01-01' },
      { ...body, kind: 'dividend' },
      { ...body, factor: '0:2' },
      { ...body, factor: '1-2' },
      { ...body, factor: '1:2:3' },
      { ...body, extra: true },
    ]) {
      expect(corporateEventBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('as respostas são estritas', () => {
  it('cycleRerunSchema recusa resultado desconhecido e campo a mais', () => {
    const ok = {
      date: '2026-11-03',
      seasons: [{ season: 'ensaio', result: 'published', published: 4 }],
    };
    expect(cycleRerunSchema.safeParse(ok).success).toBe(true);
    expect(
      cycleRerunSchema.safeParse({ ...ok, seasons: [{ season: 'ensaio', result: 'talvez' }] })
        .success,
    ).toBe(false);
    expect(cycleRerunSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it('adminCostsSchema: micro-dólares inteiros e o teto pode faltar', () => {
    const ok = { month: '2026-11', capMicroUsd: null, spentMicroUsd: 0, rows: [] };
    expect(adminCostsSchema.safeParse(ok).success).toBe(true);
    expect(adminCostsSchema.safeParse({ ...ok, capMicroUsd: 40_000_000 }).success).toBe(true);
    expect(adminCostsSchema.safeParse({ ...ok, spentMicroUsd: 1.5 }).success).toBe(false);
    expect(adminCostsSchema.safeParse({ ...ok, spentMicroUsd: -1 }).success).toBe(false);
    expect(adminCostsSchema.safeParse({ ...ok, month: '2026-13' }).success).toBe(false);
  });

  it('adminJobsSchema: a DLQ é "ok" com a contagem ou "indisponível", nunca os dois', () => {
    const base = { jobs: [], failures: [], fetchStates: [] };
    const ok = {
      queue: 'news',
      deadLetters: { status: 'ok', count: 1, capped: false, messages: [] },
    };
    expect(
      adminJobsSchema.safeParse({
        ...base,
        queues: [ok, { queue: 'market', deadLetters: { status: 'unavailable' } }],
      }).success,
    ).toBe(true);
    expect(
      adminJobsSchema.safeParse({
        ...base,
        queues: [{ queue: 'market', deadLetters: { status: 'unavailable', count: 3 } }],
      }).success,
    ).toBe(false);
    expect(
      adminJobsSchema.safeParse({
        ...base,
        queues: [{ queue: 'outra', deadLetters: { status: 'unavailable' } }],
      }).success,
    ).toBe(false);
  });

  // Uma mensagem posta na DLQ por outra ferramenta pode ter qualquer MessageId: a lista a mostra, marcada como não reenviável (o painel
  // então não desenha o botão). `resubmittable` é obrigatório, e os cortes de texto são os de ADMIN_TEXT_MAX.
  it('adminJobsSchema: a mensagem da DLQ diz se é reenviável, e o texto tem os cortes de ADMIN_TEXT_MAX', () => {
    const message = {
      messageId: 'eod:2026-11-03',
      resubmittable: true,
      deliveryCount: 10,
      reason: 'max_attempts_exceeded',
      description: null,
      enqueuedAt: null,
    };
    const jobs = (m: object) => ({
      jobs: [],
      failures: [],
      fetchStates: [],
      queues: [
        {
          queue: 'market',
          deadLetters: { status: 'ok', count: 1, capped: false, messages: [m] },
        },
      ],
    });
    expect(adminJobsSchema.safeParse(jobs(message)).success).toBe(true);
    expect(
      adminJobsSchema.safeParse(
        jobs({ ...message, messageId: 'mensagem de fora', resubmittable: false }),
      ).success,
    ).toBe(true);
    const { resubmittable: _omitted, ...without } = message;
    expect(adminJobsSchema.safeParse(jobs(without)).success).toBe(false);
    expect(adminJobsSchema.safeParse(jobs({ ...message, body: {} })).success).toBe(false);
    for (const field of ['messageId', 'reason', 'description'] as const) {
      const at = (length: number) => jobs({ ...message, [field]: 'x'.repeat(length) });
      expect(adminJobsSchema.safeParse(at(ADMIN_TEXT_MAX[field])).success, field).toBe(true);
      expect(adminJobsSchema.safeParse(at(ADMIN_TEXT_MAX[field] + 1)).success, field).toBe(false);
    }
  });

  it('adminSeasonSchema leva os parâmetros e o elenco no formato do arquivo da temporada', () => {
    const season = {
      id: ULID,
      slug: 'ensaio',
      name: 'Ensaio',
      status: 'DRAFT',
      startDate: null,
      createdAt: NOW,
      startedAt: null,
      finishedAt: null,
      params: { randomSeed: 'a', monteCarloSeed: 'b' },
      competitors: [{ kind: 'RANDOM', slug: 'sorteio', name: 'Sorteio' }],
    };
    expect(adminSeasonSchema.safeParse(season).success).toBe(true);
    expect(adminSeasonSchema.safeParse({ ...season, status: 'PAUSADA' }).success).toBe(false);
    expect(adminSeasonSchema.safeParse({ ...season, prompt: 'texto' }).success).toBe(false);
  });
});

// A api não liquida (o papel do Postgres dela não escreve nas tabelas de resultado, ADR 0028): a resposta do evento diz o que foi ENFILEIRADO.
describe('corporateEventResultSchema: a reliquidação é enfileirada, não feita na requisição', () => {
  const event = {
    ticker: 'DOBR4',
    exDate: '2026-11-05',
    kind: 'SPLIT',
    ratioFrom: 1,
    ratioTo: 2,
    change: 'created',
  };

  it('aceita as temporadas enfileiradas (até o pregão que cada uma tinha liquidado) e as que esperam a data ex', () => {
    const result = {
      event,
      queued: [{ season: 'planilha', through: '2026-11-09' }],
      pending: ['outra'],
    };
    expect(corporateEventResultSchema.parse(result)).toEqual(result);
    expect(corporateEventResultSchema.safeParse({ event, queued: [], pending: [] }).success).toBe(
      true,
    );
  });

  it('é estrito: o campo antigo `settled` (a liquidação na requisição) não existe mais, e campo a mais não passa', () => {
    expect(
      corporateEventResultSchema.safeParse({
        event,
        settled: [{ season: 'planilha', through: '2026-11-09', finished: false }],
        pending: [],
      }).success,
    ).toBe(false);
    expect(
      corporateEventResultSchema.safeParse({
        event,
        queued: [{ season: 'planilha', through: '2026-11-09', finished: false }],
        pending: [],
      }).success,
    ).toBe(false);
    expect(
      corporateEventResultSchema.safeParse({ event, queued: [], pending: [], extra: 1 }).success,
    ).toBe(false);
  });

  it('o pregão tem de ser uma data de verdade e a temporada um slug', () => {
    for (const queued of [
      [{ season: 'planilha', through: '2026-02-30' }],
      [{ season: 'Planilha Maiúscula', through: '2026-11-09' }],
      [{ season: 'planilha' }],
    ]) {
      expect(corporateEventResultSchema.safeParse({ event, queued, pending: [] }).success).toBe(
        false,
      );
    }
  });
});
