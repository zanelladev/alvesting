import { expect, test } from '@playwright/test';
import { healthResponseSchema } from '@alvesting/contracts';

// A home e os cabeçalhos do servidor de produção. Roda em Pixel 7 (Chromium), iPhone 15 (WebKit) e desktop. O conteúdo da home e das
// outras telas está em arena.spec.ts; rolagem, alvos de toque e acessibilidade de todas as telas, em layout.spec.ts.
test.describe('home', () => {
  test('tem título, h1, idioma pt-BR e viewport que permite zoom', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Alvesting');
    // o h1 é o título do hero (ADR 0034); o nome do site fica no <title> e na marca do cabeçalho
    await expect(
      page.getByRole('heading', { level: 1, name: 'Modelos de linguagem investindo na B3' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');

    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });

  // Sem ícone todo navegador e todo robô pedem /favicon.ico e levam a página 404 inteira (o Lighthouse conta o erro no console).
  test('tem um ícone próprio, ligado no <head>', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toMatch(/^\/icon\.svg/);
    const icon = await request.get(href!);
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/svg+xml');
  });

  // O Safari do iPhone viraria os SHA-256 (corridas de dígitos) em links de telefone.
  test('desliga a detecção de telefone, endereço e e-mail do Safari', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="format-detection"]')).toHaveAttribute(
      'content',
      'telephone=no, address=no, email=no',
    );
  });
});

// O servidor de produção (standalone) é o que sai do build e vai para a imagem. Sem estes cabeçalhos o
// navegador adivinha o tipo do conteúdo e qualquer site pode embutir a página num frame.
test.describe('cabeçalhos de segurança', () => {
  test('a home manda nosniff, Referrer-Policy e frame-ancestors, e não anuncia o Next', async ({
    page,
  }) => {
    const response = await page.goto('/');
    const headers = response!.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-powered-by']).toBeUndefined();
  });

  // As telas da conta têm formulário de senha: o CSP fecha também a base dos caminhos, o destino dos formulários e <object>/<embed>, e o
  // HSTS faz o navegador exigir https do host desde a primeira resposta de página (em http ele o ignora, então o e2e segue em http).
  test('o CSP fecha base-uri, form-action e object-src, e as páginas mandam HSTS', async ({
    request,
  }) => {
    for (const path of ['/', '/entrar', '/conta']) {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      const csp = headers['content-security-policy'];
      expect(csp, path).toContain("base-uri 'self'");
      expect(csp, path).toContain("form-action 'self'");
      expect(csp, path).toContain("object-src 'none'");
      expect(headers['strict-transport-security'], path).toBe('max-age=31536000');
    }
  });

  test('o /health e a página 404 mandam os mesmos', async ({ request }) => {
    for (const [path, status] of [
      ['/health', 200],
      ['/nao-existe', 404],
    ] as const) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(status);
      expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
      expect(response.headers()['content-security-policy'], path).toContain(
        "frame-ancestors 'none'",
      );
    }
  });
});

test.describe('GET /health', () => {
  test('responde 200 no envelope do contrato, com service web', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      success: true,
      data: { status: 'ok', service: 'web' },
      error: null,
    });
  });
});
