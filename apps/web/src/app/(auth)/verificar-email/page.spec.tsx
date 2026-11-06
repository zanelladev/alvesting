import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import VerifyEmailPage from './page';

// A tela de verificar o e-mail (etapa 11, parte 2): três estados pela URL, e o que vem da URL só escolhe entre as frases daqui. O cadastro
// responde igual para quem acabou de se cadastrar e para quem digitou um e-mail que já tem conta, e nada é mandado ao segundo
// (docs/CONTA.md, seção 11): a tela não pode afirmar que o link saiu.
const render = async (params: Record<string, string | string[]> = {}) =>
  renderToStaticMarkup(await VerifyEmailPage({ searchParams: Promise.resolve(params) }));

describe('a página /verificar-email', () => {
  it('depois do cadastro não afirma que o link saiu: diz "se o e-mail ainda não tinha cadastro" e aponta entrar e esqueci a senha', async () => {
    const out = await render();
    expect(out).toContain('>Confirme o seu e-mail</h1>');
    expect(out).toContain('Se o e-mail ainda não tinha cadastro, mandamos um link de confirmação');
    expect(out).not.toContain('Mandamos um link de confirmação para o e-mail do cadastro');
    expect(out).toContain('ele vale por 60 minutos');
    expect(out).toContain('Se você já tem conta');
    expect(out).toContain('href="/entrar"');
    expect(out).toContain('href="/esqueci-senha"');
    expect(out).toContain('href="/cadastro"');
    // o pedido de um link novo
    expect(out).toContain('>Reenviar o link</button>');
  });

  it('?retorno=1: o e-mail está confirmado, e o caminho é entrar', async () => {
    const out = await render({ retorno: '1' });
    expect(out).toContain('>E-mail confirmado</h1>');
    expect(out).toContain('href="/entrar"');
    expect(out).not.toContain('Reenviar o link');
  });

  it('?retorno=1&error=TOKEN_EXPIRED: o link venceu, com a validade que o e-mail prometeu, e dá para pedir outro', async () => {
    const out = await render({ retorno: '1', error: 'TOKEN_EXPIRED' });
    expect(out).toContain('>Não foi possível confirmar o e-mail</h1>');
    expect(out).toContain('O link venceu: ele vale por 60 minutos.');
    expect(out).toContain('>Reenviar o link</button>');
  });

  it.each([['INVALID_TOKEN'], ['<script>alert(1)</script>'], ['constructor'], ['']])(
    '?retorno=1&error=%j: qualquer outro erro é a frase geral, e nada da URL é refletido',
    async (error) => {
      const out = await render({ retorno: '1', error });
      expect(out).toContain('O link não vale: já foi usado, ou está incompleto.');
      expect(out).not.toContain('alert(1)');
      expect(out).not.toContain('constructor');
    },
  );
});
