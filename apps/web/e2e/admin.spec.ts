import { expect, type Locator, type Page } from '@playwright/test';
import {
  adminCostsSchema,
  adminJobsSchema,
  adminSeasonsSchema,
  envelopeSchema,
} from '@alvesting/contracts';
import type { z } from 'zod';
import { registerVerifiedUser, signInViaApi } from './account-support';
import {
  deadLetters,
  published,
  registerAdmin,
  seasonFile,
  test,
  uniqueSlug,
} from './admin-support';
import { FRONT_DOOR_URL } from './api-server';

// O painel de admin (etapa 10, parte 2; docs/TELAS.md, seção 8), em pixel-7 (Chromium), iphone-15 (WebKit) e desktop, como todo e2e. Mesma
// montagem das telas da conta: o navegador fala com UMA origem, o Front Door imitado (https, porta 4311), que manda `/api/*` para a api da
// conta (4308) e o resto para o site da conta (4309). O admin é uma conta de verdade promovida pelo comando account:promote (o `dist` da api,
// contra o banco do e2e). A DLQ é falsa: uma pasta (apps/api/src/modules/messaging/infrastructure/fake-service-bus.ts) com o
// MessagingService de verdade por cima. Nada chama o Service Bus, a Azure nem fonte externa; todo dado é sintético.
// Os três projetos rodam juntos no mesmo banco: cada teste usa o slug e o MessageId dele.
//
// Este e2e NUNCA inicia uma temporada: a temporada em andamento é a "atual" da API pública, e as outras telas (e os outros specs, que
// compartilham o banco) passariam a mostrar a de teste. Iniciar é provado pelos testes de integração da api.
test.skip(Boolean(process.env.BASE_URL), 'precisa do Front Door imitado e dos servidores da conta');
test.use({ baseURL: FRONT_DOOR_URL });

const read = async <S extends z.ZodType>(page: Page, route: string, schema: S) => {
  const response = await page.request.get(`/api/v1/admin${route}`);
  expect(response.status(), route).toBe(200);
  const body = envelopeSchema(schema).parse(await response.json()) as { data: z.output<S> };
  return body.data;
};

// O painel pronto: o título e os formulários ativos (só valem depois da hidratação).
async function openPanel(page: Page) {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Painel da arena' })).toBeVisible();
  for (const button of await page.getByRole('main').getByRole('button').all()) {
    await expect(button).toBeEnabled();
  }
}

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const form = (scope: Page | Locator, name: string) =>
  scope.getByRole('form', { name, exact: true });
// O formulário de reenvio de uma mensagem da DLQ: o nome é o MessageId mais a posição na lista ("eod:2143-03-14 (mensagem 1 de 3)"), porque
// a mesma mensagem pode estar duas vezes na DLQ e dois formulários com o mesmo nome violam o landmark único (axe).
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dlqForm = (scope: Page | Locator, messageId: string) =>
  scope.getByRole('form', {
    name: new RegExp(`^${escapeRegExp(messageId)} \\(mensagem \\d+ de \\d+\\)$`),
  });

// 1234567 micro-dólares -> "1,2346" (quatro casas, o meio sobe), como o site escreve
function usd(micro: number): string {
  const tenThousandths = (BigInt(micro) + 50n) / 100n;
  return `${tenThousandths / 10_000n},${String(tenThousandths % 10_000n).padStart(4, '0')}`;
}

test.describe('quem entra no painel', () => {
  test('anônimo vai para a entrada, com o caminho de volta', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/entrar?proximo=%2Fadmin`);
  });

  test('usuário comum recebe 404, igual a uma página que não existe, e as rotas da api respondem 403', async ({
    page,
    request,
    ip,
  }) => {
    const user = await registerVerifiedUser(request, ip, 'comum');
    await signInViaApi(page.request, user);

    const response = await page.goto('/admin');
    expect(response!.status()).toBe(404);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeVisible();
    // o texto da tela, sem a arte do urso: ela é decorativa (aria-hidden), o quadro 0 chega depois do load (e2e/nao-encontrada.spec.ts) e,
    // a partir de 1024 px, anda; comparada, a arte fazia a conta depender de quando o quadro chegou em cada página
    const text = () =>
      page.getByRole('main').evaluate((main: HTMLElement) => {
        const arts = [...main.querySelectorAll<HTMLElement>('[data-arte]')];
        for (const art of arts) art.style.display = 'none';
        const visible = main.innerText;
        for (const art of arts) art.style.display = '';
        return visible;
      });
    const hidden = await text();
    await page.goto('/nao-existe-de-verdade');
    expect(await text()).toBe(hidden);

    for (const route of ['/seasons', '/jobs', '/costs']) {
      expect((await page.request.get(`/api/v1/admin${route}`)).status(), route).toBe(403);
    }
    // a conta não mostra caminho nenhum para o painel
    await page.goto('/conta');
    await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir o painel da arena' })).toHaveCount(0);
  });

  test('sem sessão a api de admin responde 401', async ({ request }) => {
    for (const route of ['/seasons', '/jobs', '/costs']) {
      expect((await request.get(`/api/v1/admin${route}`)).status(), route).toBe(401);
    }
  });

  test('o admin vê o painel, e a conta dele mostra o caminho até ele', async ({
    page,
    request,
    ip,
  }) => {
    const admin = await registerAdmin(request, ip, 'entrada');
    await signInViaApi(page.request, admin);

    await page.goto('/conta');
    await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
    await page.getByRole('link', { name: 'Abrir o painel da arena' }).click();
    await expect(page).toHaveURL(`${FRONT_DOOR_URL}/admin`);
    await expect(page.getByRole('heading', { level: 1, name: 'Painel da arena' })).toBeVisible();
    for (const title of [
      'Jobs',
      'Filas e DLQ',
      'Custos do mês',
      'Temporadas',
      'Reprocessar um ciclo',
      'Evento corporativo',
    ]) {
      await expect(section(page, title)).toBeVisible();
    }
  });

  test('a página é privada: sem cache, e o cookie da sessão não aparece no HTML', async ({
    page,
    request,
    ip,
  }) => {
    const admin = await registerAdmin(request, ip, 'privada');
    await signInViaApi(page.request, admin);
    const response = await page.goto('/admin');
    const cache = response!.headers()['cache-control'] ?? '';
    expect(cache).toContain('private');
    expect(cache).toContain('no-store');
    const html = await response!.text();
    expect(html).not.toContain('alvesting.session_token');
    expect(html).toContain('noindex');
  });
});

test.describe('o painel mostra o que a api de admin devolve', () => {
  test('jobs, filas, custos e temporadas batem com a api (valores lidos da própria api)', async ({
    page,
    request,
    ip,
  }) => {
    const admin = await registerAdmin(request, ip, 'leitura');
    await signInViaApi(page.request, admin);
    const jobs = await read(page, '/jobs', adminJobsSchema);
    const costs = await read(page, '/costs', adminCostsSchema);
    const seasons = await read(page, '/seasons', adminSeasonsSchema);
    await openPanel(page);

    // o banco do e2e tem uma temporada inteira do ensaio: há jobs de verdade, e cada tipo aparece com o último estado
    expect(jobs.jobs.length).toBeGreaterThan(0);
    const STATUS = { RUNNING: 'rodando', SUCCEEDED: 'ok', FAILED: 'falhou', WAITING: 'esperando' };
    const jobsTable = section(page, 'Jobs').getByRole('table', { name: 'Último job de cada tipo' });
    for (const job of jobs.jobs) {
      const row = jobsTable.getByRole('row').filter({
        has: page.getByRole('rowheader', { name: job.type, exact: true }),
      });
      // célula a célula e com o texto inteiro (um "0" solto casaria com qualquer data): Estado, Chave, Tent., Início, Falhou, Esperando
      const cells = row.getByRole('cell');
      await expect(cells, job.type).toHaveCount(6);
      await expect(cells.nth(0), job.type).toHaveText(STATUS[job.latest.status]);
      await expect(cells.nth(1), job.type).toHaveText(job.latest.key);
      await expect(cells.nth(2), job.type).toHaveText(String(job.latest.attempts));
      await expect(cells.nth(4), job.type).toHaveText(String(job.counts.FAILED));
      await expect(cells.nth(5), job.type).toHaveText(String(job.counts.WAITING));
    }

    // a DLQ de cada fila: o painel diz o que a api leu, e nunca pede papel nenhum
    const queues = section(page, 'Filas e DLQ');
    for (const { queue, deadLetters: dlq } of jobs.queues) {
      await expect(
        queues.getByRole('heading', { level: 3, name: queue, exact: true }),
      ).toBeVisible();
      expect(dlq.status, queue).toBe('ok');
    }
    await expect(queues).not.toContainText('Não deu para ler a DLQ');

    // os custos: o teto vem do ambiente da api (40 dólares), o gasto do banco
    const costsSection = section(page, 'Custos do mês');
    await expect(costsSection).toContainText(`US$ ${usd(costs.capMicroUsd ?? 0)}`);
    await expect(costsSection).toContainText(usd(costs.spentMicroUsd));
    if (costs.rows.length === 0) {
      await expect(costsSection).toContainText('Nenhuma decisão neste mês ainda.');
    } else {
      const byCompetitor = costsSection.getByRole('table', { name: 'Custo por competidor no mês' });
      for (const name of new Set(costs.rows.map((r) => r.name))) {
        await expect(byCompetitor).toContainText(name);
      }
    }

    // as temporadas, o rascunho inclusive: o ensaio do banco do e2e e o estado dela
    const SEASON_STATUS = { DRAFT: 'rascunho', RUNNING: 'em andamento', FINISHED: 'encerrada' };
    expect(seasons.seasons.length).toBeGreaterThan(0);
    const ensaio = seasons.seasons.find((s) => s.slug === 'ensaio')!;
    const card = section(page, 'Temporadas')
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { level: 3, name: ensaio.name, exact: true }) });
    await expect(card).toContainText(SEASON_STATUS[ensaio.status]);
    await expect(card).toContainText(ensaio.slug);
    // temporada que já saiu do rascunho não tem formulário de edição
    await expect(card.getByRole('form')).toHaveCount(0);
    await expect(card).toContainText('Regras, elenco e prompt ficam fixos');
  });

  test('sem JavaScript o painel se lê, e nenhuma ação se envia (os campos nascem desativados)', async ({
    browser,
    request,
    ip,
  }, info) => {
    const admin = await registerAdmin(request, ip, 'semjs');
    const { viewport, userAgent, deviceScaleFactor, isMobile, locale } = info.project.use;
    const context = await browser.newContext({
      baseURL: FRONT_DOOR_URL,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'x-forwarded-for': ip },
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      locale,
      javaScriptEnabled: false,
    });
    try {
      await signInViaApi(context.request, admin);
      const page = await context.newPage();
      await page.goto('/admin');
      await expect(page.getByRole('heading', { level: 1, name: 'Painel da arena' })).toBeVisible();
      await expect(section(page, 'Jobs')).toBeVisible();
      // (o Playwright pula o <noscript> na busca por texto: o aviso é buscado pelo elemento e lido pelo textContent)
      const notice = page.locator('noscript p');
      await expect(notice).toBeVisible();
      expect(await notice.textContent()).toContain('precisam de JavaScript');
      const buttons = await page.getByRole('main').getByRole('button').all();
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) await expect(button).toBeDisabled();
    } finally {
      await context.close();
    }
  });
});

test.describe('temporadas: criar e editar o rascunho', () => {
  test('cria o rascunho (com a confirmação), edita nome e elenco, e a api de admin confere', async ({
    page,
    request,
    ip,
  }) => {
    const admin = await registerAdmin(request, ip, 'temporada');
    await signInViaApi(page.request, admin);
    const slug = uniqueSlug('nova');
    const name = `Temporada do e2e ${slug}`;
    await openPanel(page);

    const create = form(page, 'Nova temporada');
    const file = create.getByLabel('Arquivo da temporada (JSON)');
    const confirm = create.getByRole('checkbox');
    const submit = create.getByRole('button', { name: 'Criar a temporada' });

    // sem a confirmação nada é enviado
    await file.fill(JSON.stringify(seasonFile(slug)));
    await submit.click();
    await expect(create).toContainText('Marque a caixa para confirmar esta ação.');
    await expect(confirm).not.toBeChecked();
    expect(
      (await read(page, '/seasons', adminSeasonsSchema)).seasons.map((s) => s.slug),
    ).not.toContain(slug);

    // o que não é JSON de objeto é recusado antes de ir
    await file.fill('{ isto não é json');
    await confirm.check();
    await submit.click();
    await expect(create).toContainText('O texto não é um objeto JSON válido.');

    // a api recusa o elenco sem o Sorteio, e diz qual regra
    const noRandom = seasonFile(slug);
    noRandom.competitors = noRandom.competitors.filter((c) => c.kind !== 'RANDOM');
    await file.fill(JSON.stringify(noRandom));
    await submit.click();
    await expect(create.getByRole('alert')).toContainText('Sorteio');

    // criada: o resultado aparece, a lista só muda ao recarregar
    await file.fill(JSON.stringify(seasonFile(slug)));
    await submit.click();
    await expect(create.getByRole('status')).toContainText(
      `Temporada ${slug} criada como rascunho`,
    );

    // o mesmo slug de novo é 409, com a mensagem da api
    await submit.click();
    await expect(create.getByRole('alert')).toContainText(
      `Já existe uma temporada com o slug ${slug}`,
    );

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Painel da arena' })).toBeVisible();
    const card = section(page, 'Temporadas')
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });
    await expect(card).toContainText('rascunho');
    await expect(card).toContainText(slug);

    // editar: o texto do rascunho volta no campo; troca o nome e salva
    const edit = form(card, `Editar o rascunho ${slug}`);
    const editFile = edit.getByLabel('Nome, parâmetros e elenco (JSON)');
    await expect(edit.getByRole('button', { name: 'Salvar o rascunho' })).toBeEnabled();
    const current = JSON.parse(await editFile.inputValue()) as {
      name: string;
      competitors: unknown[];
    };
    expect(current.name).toBe(name);
    expect(current.competitors).toHaveLength(5);
    const renamed = `${name} (editada)`;
    await editFile.fill(JSON.stringify({ ...current, name: renamed }));
    await edit.getByRole('button', { name: 'Salvar o rascunho' }).click();
    await expect(edit).toContainText('Marque a caixa para confirmar esta ação.');
    await edit.getByRole('checkbox').check();
    await edit.getByRole('button', { name: 'Salvar o rascunho' }).click();
    await expect(edit.getByRole('status')).toContainText('Rascunho salvo');

    const saved = (await read(page, '/seasons', adminSeasonsSchema)).seasons.find(
      (s) => s.slug === slug,
    )!;
    expect(saved).toMatchObject({ name: renamed, status: 'DRAFT', startDate: null });
    await page.reload();
    await expect(page.getByRole('heading', { level: 3, name: renamed, exact: true })).toBeVisible();
    // o rascunho não é público: a API pública não o lista
    const pub = await page.request.get('/api/v1/seasons');
    expect(JSON.stringify(await pub.json())).not.toContain(slug);
    // e tem o botão de iniciar, com a confirmação no texto (este teste não o aperta)
    const start = form(
      section(page, 'Temporadas')
        .getByRole('listitem')
        .filter({
          has: page.getByRole('heading', { level: 3, name: renamed, exact: true }),
        }),
      `Iniciar o rascunho ${slug}`,
    );
    await expect(start).toContainText('próximo pregão');
    await expect(start.getByRole('checkbox')).not.toBeChecked();
  });
});

test.describe('a DLQ (falsa): reenviar com confirmação, e idempotente', () => {
  test('reenvia a mensagem para a fila de origem uma vez só: repetir não publica de novo', async ({
    page,
    request,
    ip,
    deadLetter,
  }) => {
    const admin = await registerAdmin(request, ip, 'dlq');
    await signInViaApi(page.request, admin);
    // a mensagem foi semeada na DLQ falsa antes do teste (e sai de lá, se ninguém a reenviar, depois dele)
    const { messageId } = deadLetter;
    expect(await deadLetters('market')).toContain(messageId);

    await openPanel(page);
    const queues = section(page, 'Filas e DLQ');
    await expect(queues).toContainText(messageId);
    const resend = dlqForm(page, messageId);
    await expect(resend).toContainText(
      `Confirmo: reenviar a mensagem ${messageId} para a fila market.`,
    );

    // sem a confirmação, nada sai da DLQ
    await resend.getByRole('button', { name: 'Reenviar para a fila' }).click();
    await expect(resend).toContainText('Marque a caixa para confirmar esta ação.');
    expect(await deadLetters('market')).toContain(messageId);
    expect(await published('market')).not.toContain(messageId);

    // com a confirmação: a mensagem sai da DLQ e vai para a fila, uma vez
    await resend.getByRole('checkbox').check();
    await resend.getByRole('button', { name: 'Reenviar para a fila' }).click();
    await expect(resend.getByRole('status')).toContainText('Mensagem reenviada para a fila');
    expect(await deadLetters('market')).not.toContain(messageId);
    expect((await published('market')).filter((id) => id === messageId)).toHaveLength(1);

    // o mesmo clique de novo (a tela ainda mostra a mensagem): a api diz que já saiu, e nada é publicado
    await resend.getByRole('button', { name: 'Reenviar para a fila' }).click();
    await expect(resend.getByRole('status')).toContainText('não está mais na DLQ');
    expect((await published('market')).filter((id) => id === messageId)).toHaveLength(1);

    // recarregada, a lista não tem mais a mensagem
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Painel da arena' })).toBeVisible();
    await expect(section(page, 'Filas e DLQ')).not.toContainText(messageId);
  });
});

test.describe('reprocessar o ciclo e o evento corporativo', () => {
  test('o reprocesso pede a confirmação e diz o que a api fez (sem temporada em andamento, nada)', async ({
    page,
    request,
    ip,
  }) => {
    const admin = await registerAdmin(request, ip, 'ciclo');
    await signInViaApi(page.request, admin);
    await openPanel(page);
    const rerun = form(page, 'Reprocessar um ciclo');
    const date = rerun.getByLabel('Pregão', { exact: true });
    // o campo já vem com um dia (hoje, em Brasília), mas nada dispara sozinho
    await expect(date).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

    // a pasta do Service Bus falso é de todos os testes e projetos: o que vale é que ESTE teste não publica nada, então fotografa antes
    const publishedBefore = await published('decisions');

    // quarta 04/11/2026 é pregão: o banco do e2e só tem a temporada do ensaio, encerrada, então não há ciclo em andamento
    await date.fill('2026-11-04');
    await rerun.getByRole('button', { name: 'Reprocessar o ciclo' }).click();
    await expect(rerun).toContainText('Marque a caixa para confirmar esta ação.');
    await rerun.getByRole('checkbox').check();
    await rerun.getByRole('button', { name: 'Reprocessar o ciclo' }).click();
    await expect(rerun.getByRole('status')).toContainText(
      'Nenhuma temporada em andamento neste pregão.',
    );

    // sábado não é pregão: a api recusa com a causa
    await date.fill('2026-11-07');
    await rerun.getByRole('button', { name: 'Reprocessar o ciclo' }).click();
    await expect(rerun.getByRole('alert')).toContainText('não é pregão');
    // e nada foi publicado na fila de decisões por este teste
    expect(await published('decisions')).toEqual(publishedBefore);
  });

  test('o evento corporativo: ticker que não existe é recusado com a causa; um existente é registrado, e repetir não muda', async ({
    page,
    request,
    ip,
  }) => {
    const admin = await registerAdmin(request, ip, 'evento');
    await signInViaApi(page.request, admin);
    await openPanel(page);
    const event = form(page, 'Evento corporativo');
    const fill = async (ticker: string, exDate: string, factor = '1:2') => {
      await event.getByLabel('Ticker', { exact: true }).fill(ticker);
      await event.getByLabel('Data ex', { exact: true }).fill(exDate);
      await event.getByLabel('Fator (de:para)', { exact: true }).fill(factor);
    };
    const submit = event.getByRole('button', { name: 'Registrar o evento' });

    await fill('', '2026-12-01');
    await submit.click();
    await expect(event).toContainText('Informe o ticker');
    await expect(event).toContainText('Marque a caixa para confirmar esta ação.');

    // uma ação que a api não conhece
    await fill('zzzz9', '2126-03-10');
    await event.getByRole('checkbox').check();
    await submit.click();
    await expect(event.getByRole('alert')).toContainText('ZZZZ9 não está no banco');

    // o fator ao contrário (um desdobramento que reduz as ações) é recusado pela api
    await fill('move3', '2126-03-10', '2:1');
    await submit.click();
    await expect(event.getByRole('alert')).toContainText('aumentam');

    // uma ação que existe no mercado sintético do ensaio, com a data ex bem depois da temporada: registra, sem reliquidar nada que já
    // esteja publicado (a temporada só entra em "pending") e sem enfileirar nenhuma settle. A api não liquida na requisição: o que ela
    // enfileira é a liquidação das temporadas que já passaram da data ex (provado pelos testes de integração, que mexeriam no job_run
    // compartilhado deste banco), e a confirmação diz que é isso que acontece
    await expect(event.getByRole('checkbox')).toHaveAccessibleName(/enfileirar a reliquidação/);
    const settlementBefore = await published('settlement');
    const exDate = `21${String(26 + Math.floor(Math.random() * 70))}-04-15`;
    await fill('move3', exDate, '1:2');
    await submit.click();
    await expect(event.getByRole('status')).toContainText('MOVE3: desdobramento 1:2');
    await expect(event.getByRole('status')).toContainText('registrado');
    await expect(event.getByRole('status')).toContainText(
      'Entra quando a temporada chegar à data ex',
    );
    await submit.click();
    await expect(event.getByRole('status')).toContainText('já estava registrado');
    expect(await published('settlement')).toEqual(settlementBefore);
  });
});

test.describe('no celular: o toque faz o mesmo que o clique', () => {
  test.use({ hasTouch: true });

  test('reenviar da DLQ só com toques (a caixa de marcar e o botão)', async ({
    page,
    request,
    ip,
    deadLetter,
  }) => {
    const admin = await registerAdmin(request, ip, 'toque');
    await signInViaApi(page.request, admin);
    const { messageId } = deadLetter;
    await openPanel(page);
    const resend = dlqForm(page, messageId);
    await resend.getByRole('checkbox').tap();
    await expect(resend.getByRole('checkbox')).toBeChecked();
    await resend.getByRole('button', { name: 'Reenviar para a fila' }).tap();
    await expect(resend.getByRole('status')).toContainText('Mensagem reenviada para a fila');
    expect(await deadLetters('market')).not.toContain(messageId);
  });
});
