import { expect, test, type Page } from '@playwright/test';
import { arenaCurrentSchema } from '@alvesting/contracts';
import { brl, dmy, fetchApi, fetchTape, pct } from './data';

// O hero da landing (ADR 0035; docs/redesign-rallies/plano.md, d.2 e d.3): o título, os dois CTAs e a pílula da temporada com os endereços, a
// legenda com o crédito das cotações e a fita no pé da moldura, e a arte. A arte é arquivo e o código só troca o quadro: o quadro 0 vem no HTML
// (sem JavaScript), o celular nunca pede o arquivo inteiro, a partir de 1024 px ela anda, e com movimento reduzido nada anda (nem a fita). Roda
// em pixel-7, iphone-15 e desktop; as larguras que importam são postas à mão. O resto da landing está em landing.spec.ts.
test.skip(Boolean(process.env.BASE_URL), 'precisa da api local com o banco sintético');

const TITLE = 'Modelos de linguagem investindo na B3';
const frame = (page: Page) => page.locator('[data-arte="escadaria"] pre');
// o arquivo inteiro da arte (o JSON com todos os quadros e o sprite grande); o sprite do quadro 0 (escadaria-q0.png) não conta
const WHOLE_ART = /\/ascii\/arte\/escadaria\.(json|png)$/;

function wholeArtRequests(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (WHOLE_ART.test(new URL(request.url()).pathname)) asked.push(request.url());
  });
  return asked;
}

test('o título, os dois CTAs, a pílula da temporada e a legenda com o crédito das cotações', async ({
  page,
  request,
}) => {
  const current = await fetchApi(request, '/arena/current', arenaCurrentSchema);
  const season = current.season!;
  const last = current.lastCycle!;
  const tape = await fetchTape(request);
  await page.goto('/');

  const main = page.getByRole('main');
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
  // a temporada do banco sintético acabou: a pílula diz o último pregão e leva ao último ciclo
  expect(season.status).toBe('FINISHED');
  const total = season.params.sessions;
  await expect(
    main.getByRole('link', {
      name: `Temporada encerrada · pregão ${total} de ${total}`,
      exact: true,
    }),
  ).toHaveAttribute('href', `/ciclos/${last.date}`);
  // os dois CTAs (no hero e de novo no fim da landing; o cartão "Arena agora" também leva à arena): a pílula preta para a arena e a cinza para
  // as regras, todos com o mesmo endereço
  const toArena = main.getByRole('link', { name: 'Abrir a arena', exact: true });
  await expect(toArena).toHaveCount(3);
  for (const link of await toArena.all()) await expect(link).toHaveAttribute('href', '/arena');
  await expect(toArena.first()).toHaveClass(/btn-primary/);
  const toRules = main.getByRole('link', { name: 'Regras da arena', exact: true });
  await expect(toRules).toHaveCount(2);
  for (const link of await toRules.all())
    await expect(link).toHaveAttribute('href', '/como-funciona');
  // o hero primeiro: o título e os CTAs vêm antes da moldura da arte, que vem antes do cartão
  const top = async (locator: ReturnType<typeof page.locator>) => (await locator.boundingBox())!.y;
  expect(await top(toArena.first())).toBeLessThan(await top(page.locator('.moldura')));

  // A fita é o universo da semana do último ciclo (a rota interna da fita, lida pelo teste como pelo site): a legenda diz quantos papéis
  // e credita a brapi com a data do pregão, e o leitor de tela recebe a fita em texto (cada papel com o fechamento e o sinal; sem o glifo,
  // que ele leria como "triângulo preto para cima" em cada papel: o sinal já diz a direção)
  expect(tape.rows.length).toBeGreaterThan(0);
  const day = dmy(tape.date!);
  await expect(
    main.getByText(
      `Os mesmos ${tape.rows.length} papéis da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de ${day}.`,
    ),
  ).toBeVisible();
  const label = main.locator('[data-fita] + p.sr-only');
  await expect(label).toContainText(`Fechamentos do pregão de ${day}`);
  for (const row of tape.rows.slice(0, 3)) {
    const price = `${row.ticker} ${brl(row.closeCents).replace('R$ ', '')}`;
    if (row.previousCloseCents === null) {
      await expect(label).toContainText(price);
      continue;
    }
    const change = Math.round(
      ((row.closeCents - row.previousCloseCents) * 10_000) / row.previousCloseCents,
    );
    await expect(label).toContainText(`${price} ${pct(change)}`);
  }
  await expect(label).not.toContainText(/[▲▼■]/);
});

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('a arte já vem com o quadro 0 inteiro no HTML, igual ao primeiro quadro do arquivo da v1', async ({
    page,
    request,
  }) => {
    const whole = (await (await request.get('/ascii/arte/escadaria.json')).json()) as {
      cols: number;
      rows: number;
      frames: string[];
    };
    const tape = await fetchTape(request);
    await page.goto('/');
    const text = await frame(page).textContent();
    expect(text).toBe(whole.frames[0]);
    expect(text!.split('\n')).toHaveLength(whole.rows);
    await expect(page.locator('[data-fita]')).toContainText(tape.rows[0]!.ticker);
  });
});

test('em 390 px a arte não pede o arquivo inteiro: nem o JSON dos quadros nem o sprite grande', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const asked = wholeArtRequests(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // o laço só começaria depois do load, quando o navegador fica à toa: o tempo de ele ter começado, se fosse começar
  await page.waitForTimeout(1_000);
  expect(asked).toEqual([]);
  await expect(frame(page)).not.toBeEmpty();
});

test('em 1440 px a arte anda (o quadro muda), e a fita rola', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const first = await frame(page).textContent();
  await expect
    .poll(async () => (await frame(page).textContent()) !== first, { timeout: 10_000 })
    .toBe(true);
  // o trilho andou para a esquerda: o deslocamento da matriz fica negativo (a animação parada no passo 0 também tem transform, a matriz
  // identidade, e não provaria nada)
  await expect
    .poll(() =>
      page
        .locator('.tape-trilho')
        .evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41),
    )
    .toBeLessThan(0);
});

// O laço só busca o arquivo inteiro quando o navegador fica à toa, depois do `load`. Quem sai da landing por navegação suave nesse meio tempo
// (o "Ver o ranking" do painel do Sorteio) não baixa a arte para uma página que não está mais na tela. O ócio fica nas mãos do teste: o laço o
// agenda, e ele só chega depois da saída.
test('em 1440 px, quem sai da landing antes de o laço começar não baixa o arquivo inteiro da arte', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const pending: IdleRequestCallback[] = [];
    const idle = window as unknown as { scheduled: () => number; arrive: () => void };
    idle.scheduled = () => pending.length;
    idle.arrive = () => {
      for (const run of pending.splice(0)) run({ didTimeout: false, timeRemaining: () => 50 });
    };
    window.requestIdleCallback = (run: IdleRequestCallback) => pending.push(run);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const asked = wholeArtRequests(page);
  await page.goto('/');
  // a página hidratou e o laço agendou a busca para o ócio
  await page.waitForFunction(
    () => (window as unknown as { scheduled: () => number }).scheduled() > 0,
  );
  await page.evaluate(() => Object.assign(window, { mesmaJanela: true }));
  await page.getByRole('link', { name: 'Ver o ranking', exact: true }).click();
  await expect(page).toHaveURL(/\/ranking$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ranking');
  // a navegação foi suave (a mesma janela): a landing saiu da tela sem recarregar, e o laço dela seguia agendado
  expect(await page.evaluate(() => 'mesmaJanela' in window)).toBe(true);
  await page.evaluate(() => (window as unknown as { arrive: () => void }).arrive());
  // o tempo de a busca sair, se fosse sair
  await page.waitForTimeout(1_000);
  expect(asked).toEqual([]);
});

test('com movimento reduzido nada anda: a arte fica no quadro 0 sem pedir o arquivo, e a fita fica parada', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const asked = wholeArtRequests(page);
  await page.goto('/');
  const first = await frame(page).textContent();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);
  expect(await frame(page).textContent()).toBe(first);
  expect(asked).toEqual([]);
  expect(
    await page.locator('.tape-trilho').evaluate((element) => getComputedStyle(element).transform),
  ).toBe('none');
});
