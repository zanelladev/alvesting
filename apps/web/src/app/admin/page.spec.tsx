import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCosts, AdminJobs, AdminSeason, Me } from '@alvesting/contracts';
import { ApiError } from '../../lib/api';

// O painel /admin (etapa 10, parte 2; docs/TELAS.md, seção 8): quem vê, o que lê e o que mostra. Os e2e conferem o caminho de verdade (a api,
// o cookie, o navegador); aqui entram os estados que a api do e2e não produz (a DLQ que não deu para ler, o texto hostil, a 403 no meio).
const readMe = vi.hoisted(() => vi.fn());
const readAdmin = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${path}` });
  }),
);
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  }),
);
vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(new Headers({ cookie: 'alvesting.session_token=a.b%2Bc; _ga=rastreador' })),
}));
vi.mock('next/navigation', () => ({ redirect, notFound }));
vi.mock('../../lib/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/account')>()),
  readMe,
}));
vi.mock('../../lib/admin', () => ({ readAdmin }));

const { default: AdminPage, metadata } = await import('./page');

const ME: Me = {
  id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  name: 'Admin do teste',
  email: 'admin@example.test',
  emailVerified: true,
  role: 'ADMIN',
  consent: { upToDate: true, documents: [] },
};

const RUN = {
  key: '2026-11-05',
  status: 'FAILED' as const,
  attempts: 3,
  startedAt: '2026-11-06T00:30:00.000Z',
  finishedAt: '2026-11-06T00:30:05.000Z',
  error: '<b>falhou</b> para o ticker',
};
const JOBS: AdminJobs = {
  jobs: [
    {
      type: 'eod',
      queue: 'market',
      counts: { RUNNING: 0, SUCCEEDED: 3, FAILED: 1, WAITING: 0 },
      latest: RUN,
    },
  ],
  failures: [{ type: 'eod', queue: 'market', ...RUN }],
  fetchStates: [{ source: 'cvm-ipe:2026', checkedAt: '2026-11-05T10:30:00.000Z' }],
  queues: [
    {
      queue: 'market',
      deadLetters: {
        status: 'ok',
        count: 1,
        capped: false,
        messages: [
          {
            messageId: 'eod:2026-11-03',
            resubmittable: true,
            deliveryCount: 10,
            reason: 'max_attempts_exceeded',
            description: 'O handler falhou em 10 tentativas',
            enqueuedAt: '2026-11-04T00:30:00.000Z',
          },
        ],
      },
    },
    { queue: 'news', deadLetters: { status: 'unavailable' } },
    { queue: 'briefing', deadLetters: { status: 'ok', count: 0, capped: false, messages: [] } },
    { queue: 'decisions', deadLetters: { status: 'ok', count: 20, capped: true, messages: [] } },
  ],
};
const COSTS: AdminCosts = {
  month: '2026-11',
  capMicroUsd: 40_000_000,
  spentMicroUsd: 3_750_000,
  rows: [
    {
      date: '2026-11-04',
      season: 'ensaio',
      competitor: 'fake-a',
      name: 'Fake A',
      costMicroUsd: 2_000_000,
    },
    {
      date: '2026-11-03',
      season: 'ensaio',
      competitor: 'fake-a',
      name: 'Fake A',
      costMicroUsd: 1_250_000,
    },
    {
      date: '2026-11-03',
      season: 'ensaio',
      competitor: 'fake-b',
      name: 'Fake B',
      costMicroUsd: 500_000,
    },
  ],
};
const SEASON: AdminSeason = {
  id: '01JZZZZZZZZZZZZZZZZZZZZZZA',
  slug: 'rascunho-1',
  name: 'Rascunho <script>alert(1)</script>',
  status: 'DRAFT',
  startDate: null,
  createdAt: '2026-11-02T12:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  params: {
    capitalCents: 10_000_000,
    sessions: 20,
    maxPositions: 10,
    maxOrdersPerCycle: 5,
    buyPercentOfEquity: [5, 25],
    sellPercentOfPosition: [1, 100],
    tradeCostBps: 3,
    decisionTimeBrt: '08:00',
    deadlineTimeBrt: '09:30',
    randomSeed: 'a',
    monteCarloSeed: 'b',
    monteCarloRuns: 1000,
  },
  competitors: [
    { kind: 'RANDOM', slug: 'sorteio', name: 'Sorteio' },
    {
      kind: 'MODEL',
      slug: 'fake-a',
      name: 'Fake A',
      provider: 'fake',
      modelId: 'fake/a',
      capabilities: { jsonSchema: false, reasoningEffort: false },
    },
  ],
};
const RUNNING: AdminSeason = {
  ...SEASON,
  id: '01JZZZZZZZZZZZZZZZZZZZZZZB',
  slug: 'em-andamento',
  name: 'Em andamento',
  status: 'RUNNING',
  startDate: '2026-11-03',
  startedAt: '2026-11-02T20:00:00.000Z',
};
const DATA = { jobs: JOBS, costs: COSTS, seasons: { seasons: [SEASON, RUNNING] } };

const render = async () => renderToStaticMarkup(await AdminPage({}));

beforeEach(() => {
  readMe.mockReset();
  readAdmin.mockReset();
  redirect.mockClear();
  notFound.mockClear();
  readMe.mockResolvedValue(ME);
  readAdmin.mockResolvedValue(DATA);
});

describe('quem vê o painel', () => {
  it('sem sessão manda para a entrada, com o caminho de volta, e nem lê a api de admin', async () => {
    readMe.mockResolvedValue(null);
    await expect(render()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;/entrar?proximo=%2Fadmin',
    });
    expect(readAdmin).not.toHaveBeenCalled();
  });

  it('usuário sem o papel admin recebe 404, para a página não revelar que existe, e a api de admin nem é chamada', async () => {
    readMe.mockResolvedValue({ ...ME, role: 'USER' });
    await expect(render()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(readAdmin).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('o 404 vale mesmo com o aceite vencido: quem não é admin não aprende nada', async () => {
    readMe.mockResolvedValue({ ...ME, role: 'USER', consent: { upToDate: false, documents: [] } });
    await expect(render()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('admin com o aceite vencido vai para a conta aceitar (a api de admin responderia 403)', async () => {
    readMe.mockResolvedValue({ ...ME, consent: { upToDate: false, documents: [] } });
    await expect(render()).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;/conta' });
    expect(readAdmin).not.toHaveBeenCalled();
  });

  it('lê a api só com o cookie da sessão: o de um rastreador não vai', async () => {
    await render();
    expect(readMe).toHaveBeenCalledWith('alvesting.session_token=a.b%2Bc');
    expect(readAdmin).toHaveBeenCalledWith('alvesting.session_token=a.b%2Bc');
  });

  it('a sessão que a api de admin não reconhece (401) vai para a entrada; o papel que sumiu no meio (403) vira 404', async () => {
    readAdmin.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED'));
    await expect(render()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;/entrar?proximo=%2Fadmin',
    });
    readAdmin.mockRejectedValue(new ApiError(403, 'FORBIDDEN'));
    await expect(render()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });

  it('a api fora do ar vira a tela de erro montada no servidor, e não um redirecionamento', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    readAdmin.mockRejectedValue(new ApiError(503, 'UNAVAILABLE'));
    expect(await render()).toContain('Não foi possível carregar os dados');
    log.mockRestore();
  });
});

describe('o que o painel mostra', () => {
  it('as seis seções, o título e o aviso de que cada ação pede confirmação e fica na trilha', async () => {
    const out = await render();
    expect(out).toContain('Painel da arena');
    for (const title of [
      'Jobs',
      'Filas e DLQ',
      'Custos do mês',
      'Temporadas',
      'Reprocessar um ciclo',
      'Evento corporativo',
    ]) {
      expect(out, title).toContain(`>${title}</h2>`);
    }
    expect(out).toContain('confirmação explícita');
    expect(out).toContain('trilha de auditoria');
  });

  it('jobs: o último de cada tipo com o estado, a falha como texto (HTML escapado) e a conferência de cada arquivo da CVM', async () => {
    const out = await render();
    expect(out).toContain('eod');
    expect(out).toContain('2026-11-05');
    expect(out).toContain('&lt;b&gt;falhou&lt;/b&gt; para o ticker');
    expect(out).not.toContain('<b>falhou</b>');
    expect(out).toContain('cvm-ipe:2026');
    expect(out).toContain('05/11/2026 07:30'); // 10:30 UTC em Brasília
  });

  it('filas: a DLQ de cada uma (vazia, com mensagens, com o teto, ou "não deu para ler" sem pedir papel nenhum)', async () => {
    const out = await render();
    expect(out).toContain('1 mensagem na DLQ');
    expect(out).toContain('DLQ vazia');
    expect(out).toContain('20 ou mais mensagens na DLQ');
    expect(out).toContain('Não deu para ler a DLQ desta fila agora');
    expect(out).not.toMatch(/Data Owner|papel de dono/i);
    // a mensagem tem o MessageId, as tentativas e o motivo, e um formulário de reenvio com a confirmação desmarcada
    expect(out).toContain('eod:2026-11-03');
    expect(out).toContain('max_attempts_exceeded');
    expect(out).toMatch(/Confirmo: reenviar a mensagem eod:2026-11-03 para a fila market/);
  });

  // A mesma mensagem pode estar duas vezes na DLQ (o MessageId é determinístico e o Service Bus Basic não detecta duplicata): cada
  // formulário de reenvio precisa de um nome próprio (landmark único, axe), então a posição entra no nome. Uma mensagem que outra
  // ferramenta pôs na DLQ, com o id fora do padrão, é listada sem o botão (a rota de reenvio responderia 400).
  it('filas: a mesma mensagem duas vezes tem dois nomes; o id fora do padrão aparece sem o botão de reenvio', async () => {
    const queue = JOBS.queues[0]!;
    if (queue.deadLetters.status !== 'ok') throw new Error('a fila do exemplo tem a DLQ lida');
    const [first] = queue.deadLetters.messages;
    const odd = { ...first!, messageId: 'mensagem de fora', resubmittable: false };
    readAdmin.mockResolvedValue({
      ...DATA,
      jobs: {
        ...JOBS,
        queues: [
          {
            queue: 'market',
            deadLetters: {
              status: 'ok',
              count: 3,
              capped: false,
              messages: [first!, first!, odd],
            },
          },
        ],
      },
    });
    const out = await render();
    // um formulário de reenvio por mensagem reenviável, cada um ligado ao próprio título (ids diferentes, textos diferentes)
    expect(out.match(/Reenviar para a fila/g)).toHaveLength(2);
    expect(out).toMatch(
      /<p id="dlq-market-0"[^>]*>eod:2026-11-03<span class="sr-only"> \(mensagem 1 de 3\)<\/span>/,
    );
    expect(out).toMatch(
      /<p id="dlq-market-1"[^>]*>eod:2026-11-03<span class="sr-only"> \(mensagem 2 de 3\)<\/span>/,
    );
    expect(out).toMatch(/aria-labelledby="dlq-market-0"/);
    expect(out).toMatch(/aria-labelledby="dlq-market-1"/);
    expect(out).not.toMatch(/aria-labelledby="dlq-market-2"/);
    expect(out).toContain('mensagem de fora');
    expect(out).toContain('fora do padrão');
    expect(out).not.toMatch(/Confirmo: reenviar a mensagem mensagem de fora/);
  });

  // Os ids dos títulos vêm do ULID da temporada, e não do slug: o slug "nova" (válido) seria o mesmo id do título do formulário de
  // criação (`temporada-nova`), e o formulário passaria a se chamar pelo nome da temporada.
  it('temporada de slug "nova" não rouba o nome do formulário "Nova temporada"', async () => {
    readAdmin.mockResolvedValue({
      ...DATA,
      seasons: { seasons: [{ ...SEASON, slug: 'nova', name: 'Uma temporada' }] },
    });
    const out = await render();
    const ids = [...out.matchAll(/\sid="(temporada-[^"]+)"/g)].map((m) => m[1]);
    expect(ids).toContain('temporada-nova');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === 'temporada-nova')).toHaveLength(1);
    expect(ids).toContain(`temporada-${SEASON.id}`);
    expect(ids).toContain(`temporada-${SEASON.id}-editar`);
    expect(ids).toContain(`temporada-${SEASON.id}-iniciar`);
  });

  it('custos: o gasto contra o teto, por competidor e por dia, em dólares (sem float)', async () => {
    const out = await render();
    expect(out).toContain('3,7500');
    expect(out).toContain('40,0000');
    expect(out).toContain('9,37%');
    // por competidor: Fake A soma os dois dias
    expect(out).toContain('3,2500');
    // por dia: 03/11 soma os dois competidores
    expect(out).toContain('1,7500');
  });

  it('custos sem teto configurado diz que o ciclo com modelo pago é pulado', async () => {
    readAdmin.mockResolvedValue({ ...DATA, costs: { ...COSTS, capMicroUsd: null } });
    const out = await render();
    expect(out).toContain('Teto não configurado');
    expect(out).toContain('pulado');
  });

  it('custos do mês sem decisão dizem isso, em vez de uma tabela vazia', async () => {
    readAdmin.mockResolvedValue({ ...DATA, costs: { ...COSTS, spentMicroUsd: 0, rows: [] } });
    expect(await render()).toContain('Nenhuma decisão neste mês');
  });

  it('temporadas: o nome é texto (nunca HTML), o rascunho tem editar e iniciar, a em andamento só diz que está fixa', async () => {
    const out = await render();
    expect(out).toContain('Rascunho &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('rascunho-1');
    expect(out).toContain('em-andamento');
    expect(out).toContain('Salvar o rascunho');
    expect(out).toContain('Iniciar a temporada');
    expect(out).toContain('Criar a temporada');
    expect(out).toMatch(/regras, elenco e prompt ficam fixos/i);
    // só o rascunho tem formulário de edição: um de cada, e não dois
    expect(out.match(/Salvar o rascunho/g)).toHaveLength(1);
    expect(out.match(/Iniciar a temporada/g)).toHaveLength(1);
  });

  it('cada ação tem a caixa de confirmação desmarcada, e nenhuma vem com o campo preenchido por padrão que dispare sozinha', async () => {
    const out = await render();
    const checkboxes = [...out.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
    // reenviar (1 mensagem), reprocessar, evento, criar, salvar o rascunho e iniciar
    expect(checkboxes).toHaveLength(6);
    for (const box of checkboxes) expect(box).not.toMatch(/checked/);
  });

  it('a página não é indexável', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
