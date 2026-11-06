import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api';

// A tela de entrar (etapa 11, parte 2): o que da URL vira tela e o que não vira. O `proximo` só vale se for um caminho do site; o aviso e o
// erro do Google são listas fechadas (o que não está nelas não aparece, e nada da URL é refletido na página); o botão do Google
// depende do que a api diz.
const readProviders = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/account')>()),
  readProviders,
}));

const { default: SignInPage } = await import('./page');

const render = async (params: Record<string, string | string[]> = {}) =>
  renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  readProviders.mockReset();
  readProviders.mockResolvedValue({ google: false });
});

describe('a página /entrar', () => {
  it('tem o título, o formulário e os caminhos para esquecer a senha e criar conta', async () => {
    const out = await render();
    expect(out).toContain('>Entrar</h1>');
    expect(out).toContain('href="/esqueci-senha"');
    expect(out).toContain('href="/cadastro"');
  });

  it('o botão do Google existe só quando a api diz que está configurada', async () => {
    expect(await render()).not.toMatch(/google/i);
    readProviders.mockResolvedValue({ google: true });
    expect(await render()).toContain('Entrar com o Google');
  });

  it('a api fora do ar vira a tela de erro do servidor (a entrada não funciona sem ela)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    readProviders.mockRejectedValue(new ApiError(503, 'UNAVAILABLE'));
    expect(await render()).toContain('Não foi possível carregar os dados');
    log.mockRestore();
  });

  it.each([
    ['saiu', 'Você saiu da conta.'],
    ['conta-excluida', 'Sua conta foi excluída. Os dados foram apagados.'],
    ['senha-redefinida', 'Senha redefinida. Entre com a nova senha.'],
  ])(
    'o aviso "%s" sai do servidor, logo abaixo do título e antes do formulário',
    async (aviso, text) => {
      const out = await render({ aviso });
      const notice = out.indexOf(`>${text}</p>`);
      expect(notice).toBeGreaterThan(out.indexOf('</h1>'));
      expect(notice).toBeLessThan(out.indexOf('<form'));
      // texto simples: nenhuma região viva que já nasça com o texto (o leitor de tela não a anuncia ao carregar a página)
      expect(out).not.toMatch(/<p role="status"[^>]*>[^<]/);
    },
  );

  it('sem aviso na URL não há o quadro do aviso, e a região de status do formulário fica vazia', async () => {
    const out = await render();
    expect(out).not.toMatch(/Você saiu da conta|Sua conta foi excluída|Senha redefinida/);
    expect(out).toMatch(/<p role="status" class="sr-only"><\/p>/);
  });

  it.each([['constructor'], ['__proto__'], ['toString'], ['<script>alert(1)</script>'], ['x']])(
    'o aviso desconhecido (%j) não aparece, e nada da URL é refletido',
    async (aviso) => {
      const out = await render({ aviso });
      expect(out).toMatch(/<p role="status" class="sr-only"><\/p>/);
      expect(out).not.toContain('alert(1)');
      expect(out).not.toContain('constructor');
    },
  );

  it.each([
    ['signup_disabled', 'Não encontramos uma conta com o e-mail desse Google.'],
    ['account_not_linked', 'Já existe uma conta com esse e-mail, criada com senha.'],
    ['email_not_verified', 'O Google não confirmou o seu e-mail'],
    ['access_denied', 'O login com o Google foi cancelado.'],
  ])('o erro do Google "%s" sai como alerta, em português', async (error, text) => {
    expect(await render({ error })).toMatch(new RegExp(`<p role="alert"[^>]*>${text}`));
  });

  it('o erro do Google desconhecido vira a frase geral, e o texto da URL não é refletido', async () => {
    const out = await render({ error: '<img src=x onerror=alert(1)>' });
    expect(out).toContain('Não foi possível entrar com o Google. Tente de novo.');
    expect(out).not.toContain('onerror');
  });

  it('sem erro na URL não há alerta', async () => {
    expect(await render()).not.toContain('role="alert"');
  });
});
