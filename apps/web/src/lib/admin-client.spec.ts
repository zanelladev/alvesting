import { CYCLE_RERUN_RESULTS, DLQ_RESUBMIT_RESULTS } from '@alvesting/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_SEND_TIMEOUT_MS,
  adminSend,
  describeAdminError,
  summarizeDlq,
  summarizeEvent,
  summarizeRerun,
} from './admin-client';

// O que o navegador faz ao falar com as rotas /admin (etapa 10, parte 2; docs/TELAS.md): a mesma origem do site, o cookie da sessão, o
// corpo em JSON, e a leitura do envelope. Os textos da tela (o que cada resposta quer dizer) são funções puras, testadas aqui.
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const ok = (data: unknown) => ({ success: true, data, error: null });
const fail = (code: string, message: string, details?: unknown) => ({
  success: false,
  data: null,
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<[string, RequestInit]> = [];
  const fn = vi.fn((url: string, init: RequestInit) => {
    calls.push([url, init]);
    return Promise.resolve(respond());
  });
  return { calls, fetch: fn as unknown as typeof fetch };
}

describe('adminSend', () => {
  it('manda o JSON pela mesma origem, com o cookie, sem seguir redirecionamento e com prazo', async () => {
    const t = fakeFetch(() => json(ok({ a: 1 })));
    const out = await adminSend(
      '/api/v1/admin/seasons',
      { method: 'POST', body: { x: 1 } },
      t.fetch,
    );
    expect(out).toEqual({ ok: true, status: 200, data: { a: 1 } });
    const [url, init] = t.calls[0]!;
    expect(url).toBe('/api/v1/admin/seasons');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      body: '{"x":1}',
    });
    expect(init.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('o prazo fica abaixo do limite do Front Door (60 s) e acima do que o evento corporativo leva', () => {
    expect(ADMIN_SEND_TIMEOUT_MS).toBeGreaterThan(30_000);
    expect(ADMIN_SEND_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it('PATCH e sem corpo (reprocessar o ciclo) também', async () => {
    const t = fakeFetch(() => json(ok({})));
    await adminSend('/api/v1/admin/cycles/2026-11-03/rerun', { method: 'POST' }, t.fetch);
    expect(t.calls[0]![1].body).toBeUndefined();
    expect(t.calls[0]![1].headers).not.toHaveProperty('content-type');
    await adminSend(
      '/api/v1/admin/seasons/x',
      { method: 'PATCH', body: { status: 'RUNNING' } },
      t.fetch,
    );
    expect(t.calls[1]![1].method).toBe('PATCH');
  });

  it('erro da api: o código, a mensagem em português e os campos errados (caminho e regra, nunca o valor)', async () => {
    const t = fakeFetch(() =>
      json(
        fail('VALIDATION_ERROR', 'Entrada inválida', [
          {
            path: ['competitors'],
            message: 'o elenco precisa de exatamente um Sorteio',
            code: 'custom',
          },
          { path: ['params', 'sessions'], message: 'Too big', code: 'too_big' },
        ]),
        400,
      ),
    );
    expect(await adminSend('/x', { method: 'POST', body: {} }, t.fetch)).toEqual({
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Entrada inválida',
      issues: [
        'competitors: o elenco precisa de exatamente um Sorteio',
        'params.sessions: Too big',
      ],
    });
  });

  it('as issues são cortadas (as primeiras 8) e só o caminho e a regra entram', async () => {
    const issues = Array.from({ length: 20 }, (_, i) => ({
      path: [`campo${i}`],
      message: 'ruim',
      input: 'SEGREDO',
    }));
    const t = fakeFetch(() => json(fail('VALIDATION_ERROR', 'Entrada inválida', issues), 400));
    const out = await adminSend('/x', { method: 'POST', body: {} }, t.fetch);
    expect(out.issues).toHaveLength(8);
    expect(JSON.stringify(out)).not.toContain('SEGREDO');
  });

  it('rede que cai (ou prazo estourado) é status 0, e resposta que não é JSON só tem o status', async () => {
    const boom = {
      fetch: vi.fn(() => Promise.reject(new Error('rede'))) as unknown as typeof fetch,
    };
    expect(await adminSend('/x', { method: 'POST' }, boom.fetch)).toEqual({ ok: false, status: 0 });
    const html = fakeFetch(() => new Response('<html>502</html>', { status: 502 }));
    expect(await adminSend('/x', { method: 'POST' }, html.fetch)).toEqual({
      ok: false,
      status: 502,
    });
  });
});

describe('describeAdminError: a frase da tela', () => {
  it('sem sessão, sem permissão e sem rede têm frase própria', () => {
    expect(describeAdminError({ ok: false, status: 401 })).toMatch(/entre de novo/i);
    expect(describeAdminError({ ok: false, status: 403, code: 'FORBIDDEN' })).toMatch(/permiss/i);
    expect(describeAdminError({ ok: false, status: 403, code: 'CONSENT_REQUIRED' })).toMatch(
      /termos/i,
    );
    expect(describeAdminError({ ok: false, status: 0 })).toMatch(/conex/i);
  });

  it('a mensagem da api (em português, escrita por nós) vale nos conflitos e nos 400; os campos errados vêm em lista', () => {
    expect(
      describeAdminError({
        ok: false,
        status: 409,
        code: 'SEASON_LOCKED',
        message: 'A temporada já saiu do rascunho.',
      }),
    ).toBe('A temporada já saiu do rascunho.');
    expect(
      describeAdminError({
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Entrada inválida',
        issues: ['competitors: falta o Sorteio'],
      }),
    ).toBe('Entrada inválida. competitors: falta o Sorteio');
  });

  it('erro de servidor não repete a mensagem: diz para tentar de novo', () => {
    const text = describeAdminError({
      ok: false,
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'segredo interno',
    });
    expect(text).not.toContain('segredo interno');
    expect(text).toMatch(/tente de novo/i);
    expect(
      describeAdminError({
        ok: false,
        status: 503,
        code: 'SERVICE_BUS_UNAVAILABLE',
        message: 'O Service Bus não respondeu.',
      }),
    ).toBe('O Service Bus não respondeu.');
  });
});

describe('os resumos do que a api respondeu', () => {
  it('summarizeRerun: uma frase por temporada, e o prazo vencido diz que nada foi publicado', () => {
    expect(summarizeRerun({ date: '2026-11-03', seasons: [] })).toBe(
      'Nenhuma temporada em andamento neste pregão.',
    );
    const text = summarizeRerun({
      date: '2026-11-03',
      seasons: [
        { season: 'a', result: 'published', published: 3 },
        { season: 'b', result: 'past_deadline' },
        { season: 'c', result: 'skipped', reason: 'orcamento' },
        { season: 'd', result: 'no_pending' },
      ],
    });
    expect(text).toContain('a: 3 decisões publicadas na fila.');
    expect(text).toContain(
      'b: fora da janela do reprocesso, que fecha 5 minutos antes do prazo das 09:30; nada foi publicado.',
    );
    expect(text).toContain('c: ciclo pulado (teto de custo do mês); nada foi publicado.');
    expect(text).toContain('d: todo modelo já tem decisão gravada; nada a publicar.');
    expect(
      summarizeRerun({ date: 'x', seasons: [{ season: 'e', result: 'published', published: 1 }] }),
    ).toContain('1 decisão publicada');
  });

  // O cliente do navegador não pode importar o contrato (leva o zod), então as frases repetem à mão os resultados da api. Este teste (que
  // pode importar o índice) liga as duas pontas: um resultado novo no contrato sem frase aqui cairia no texto genérico, em silêncio.
  it('todo resultado do contrato tem frase própria (um resultado novo da api não cai no texto genérico)', () => {
    for (const result of CYCLE_RERUN_RESULTS) {
      const text = summarizeRerun({
        date: '2026-11-03',
        seasons: [{ season: 'a', result, published: 1, reason: 'orcamento' }],
      });
      expect(text, result).not.toBe(`a: ${result}.`);
      expect(text, result).toMatch(/^a: /);
    }
    for (const result of DLQ_RESUBMIT_RESULTS) {
      expect(
        summarizeDlq({ queue: 'news', results: [{ messageId: 'a', result }] }),
        result,
      ).not.toBe('Pedido de reenvio concluído.');
    }
  });

  it('summarizeRerun com um formato que não é o esperado não quebra a tela', () => {
    expect(summarizeRerun(null)).toMatch(/reprocessado/i);
    expect(summarizeRerun({ seasons: 'x' })).toMatch(/reprocessado/i);
  });

  it('summarizeDlq: reenviada, já não estava na DLQ, ou continua inválida', () => {
    expect(
      summarizeDlq({ queue: 'news', results: [{ messageId: 'a', result: 'resubmitted' }] }),
    ).toMatch(/reenviada/i);
    expect(
      summarizeDlq({ queue: 'news', results: [{ messageId: 'a', result: 'not_found' }] }),
    ).toMatch(/não está mais na DLQ/i);
    expect(
      summarizeDlq({ queue: 'news', results: [{ messageId: 'a', result: 'invalid' }] }),
    ).toMatch(/continua/i);
    expect(summarizeDlq(undefined)).toMatch(/reenvio/i);
  });

  it('summarizeEvent: o que mudou e quais temporadas tiveram a reliquidação ENFILEIRADA (a api não liquida na requisição)', () => {
    const text = summarizeEvent({
      event: {
        ticker: 'BBB4',
        exDate: '2026-11-05',
        kind: 'SPLIT',
        ratioFrom: 1,
        ratioTo: 2,
        change: 'created',
      },
      queued: [{ season: 'planilha', through: '2026-11-09' }],
      pending: ['outra'],
    });
    expect(text).toContain('BBB4');
    expect(text).toContain('registrado');
    expect(text).toMatch(/enfileirada/i);
    expect(text).toContain('planilha');
    expect(text).toContain('09/11/2026');
    expect(text).toContain('outra');
    // não afirma que o resultado já mudou: quem liquida é o worker
    expect(text).toMatch(/worker/);
    expect(text).not.toMatch(/Reliquidada:/);
  });

  it('summarizeEvent: sem temporada liquidada o evento vale na primeira liquidação', () => {
    const text = summarizeEvent({
      event: {
        ticker: 'BBB4',
        exDate: '2026-11-05',
        kind: 'SPLIT',
        ratioFrom: 1,
        ratioTo: 2,
        change: 'unchanged',
      },
      queued: [],
      pending: [],
    });
    expect(text).toContain('já estava registrado');
    expect(text).toMatch(/primeira liquidação/);
  });
});
