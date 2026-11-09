import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_LIMITS } from '@alvesting/contracts/account-constants';
import {
  AcceptConsentsForm,
  DeleteAccountForm,
  ForgotPasswordForm,
  ResendVerificationForm,
  ResetPasswordForm,
  SignInForm,
  SignOutForm,
  SignUpForm,
} from './account-forms';

// Os formulários da conta, renderizados no servidor (o HTML que chega ao navegador antes do JavaScript): o que o leitor de tela e o
// gerenciador de senhas recebem, e o que a tela faz sem JavaScript. O comportamento com JavaScript (validar, enviar, focar o primeiro erro,
// navegar) os e2e conferem no navegador, em pixel-7, iphone-15 e desktop (apps/web/e2e/conta.spec.ts).
const html = renderToStaticMarkup;

// Cada <input> do HTML, como { name, type, autocomplete, id }
function inputs(markup: string) {
  return [...markup.matchAll(/<input\b[^>]*>/g)].map((match) => {
    const tag = match[0];
    const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
    return {
      tag,
      name: attr('name'),
      type: attr('type'),
      autocomplete: attr('autoComplete') ?? attr('autocomplete'),
      id: attr('id'),
    };
  });
}

describe('todo formulário', () => {
  const forms = {
    entrar: <SignInForm next="/conta" google={false} />,
    cadastro: <SignUpForm terms="0.1" privacy="0.1" google={false} />,
    'esqueci a senha': <ForgotPasswordForm />,
    'redefinir a senha': <ResetPasswordForm token="token-sintetico" />,
    'reenviar a verificação': <ResendVerificationForm />,
    sair: <SignOutForm labelledBy="sair-titulo" />,
    excluir: <DeleteAccountForm labelledBy="excluir-titulo" />,
    'aceite novo': <AcceptConsentsForm terms="0.2" privacy="0.2" labelledBy="aceites-titulo" />,
  };

  it.each(Object.entries(forms))(
    '%s: sem JavaScript não se envia (campos desativados) e não vai pela URL',
    (_nome, form) => {
      const out = html(form);
      // um <form> sem handler faria um GET com a senha na URL: o <fieldset> nasce desativado, e o método é POST de qualquer jeito
      expect(out).toContain('<fieldset disabled=""');
      expect(out).toMatch(/<form[^>]*method="post"/);
      expect(out).toMatch(/<form[^>]*noValidate/);
      expect(out).not.toMatch(/<form[^>]*method="get"/i);
    },
  );

  it.each(
    Object.entries(forms).filter(([nome]) => !['sair', 'excluir', 'aceite novo'].includes(nome)),
  )('%s: avisa que precisa de JavaScript', (_nome, form) => {
    expect(html(form)).toContain('<noscript>');
    expect(html(form)).toContain('Esta tela precisa de JavaScript para enviar o formulário');
  });

  it('todo campo tem rótulo ligado por id e todo botão tem texto', () => {
    for (const [nome, form] of Object.entries(forms)) {
      const out = html(form);
      for (const input of inputs(out)) {
        expect(input.id, `${nome}: ${input.tag}`).toBeTruthy();
        expect(out, `${nome}: rótulo de ${input.name}`).toMatch(
          new RegExp(`<label[^>]*for="${input.id!.replace(/[^\\w-]/g, '.')}"`),
        );
      }
      for (const button of out.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)) {
        expect(button[1]!.replace(/<[^>]+>/g, '').trim(), nome).not.toBe('');
      }
    }
  });

  it('o aviso de status existe desde o começo, vazio, para o leitor de tela anunciar o que chega depois', () => {
    for (const form of Object.values(forms)) {
      expect(html(form)).toMatch(/<p role="status" class="sr-only"><\/p>/);
    }
  });
});

describe('entrar', () => {
  const out = html(<SignInForm next="/conta" google={false} />);

  it('e-mail e senha, com o tipo e o autocomplete certos para o gerenciador de senhas', () => {
    const [email, password, ...rest] = inputs(out);
    expect(rest).toEqual([]);
    expect(email).toMatchObject({ name: 'email', type: 'email', autocomplete: 'email' });
    expect(password).toMatchObject({
      name: 'password',
      type: 'password',
      autocomplete: 'current-password',
    });
    expect(out).toMatch(/>E-mail<\/label>/);
    expect(out).toMatch(/>Senha<\/label>/);
  });

  it('sem o Google configurado não há botão do Google', () => {
    expect(out).not.toMatch(/google/i);
    expect(out.match(/<button/g)).toHaveLength(1);
  });

  it('com o Google configurado, o botão existe, é de envio e carrega o valor que o distingue', () => {
    const withGoogle = html(<SignInForm next="/conta" google />);
    expect(withGoogle).toMatch(
      /<button(?=[^>]*type="submit")(?=[^>]*name="via")(?=[^>]*value="google")[^>]*>Entrar com o Google<\/button>/,
    );
    expect(withGoogle.match(/<button/g)).toHaveLength(2);
  });
});

describe('cadastro', () => {
  const out = html(<SignUpForm terms="0.1" privacy="0.3" google={false} />);

  it('nome, e-mail e senha nova, com os autocompletes certos', () => {
    const [name, email, password] = inputs(out);
    expect(name).toMatchObject({ name: 'name', type: 'text', autocomplete: 'name' });
    expect(email).toMatchObject({ name: 'email', type: 'email', autocomplete: 'email' });
    expect(password).toMatchObject({
      name: 'password',
      type: 'password',
      autocomplete: 'new-password',
    });
  });

  it('o teclado do celular: o nome ganha a inicial maiúscula; e-mail e senha ficam como foram digitados', () => {
    const [name, email, password] = inputs(out);
    expect(name!.tag).toMatch(/autocapitalize="words"/i);
    expect(email!.tag).toMatch(/autocapitalize="none"/i);
    expect(password!.tag).toMatch(/autocapitalize="none"/i);
  });

  it('o aceite é explícito: duas caixas, nenhuma marcada, cada uma com a versão que a api mandou', () => {
    const boxes = inputs(out).filter((input) => input.type === 'checkbox');
    expect(boxes.map((box) => box.name)).toEqual(['terms', 'privacy']);
    for (const box of boxes) {
      expect(box.tag).not.toMatch(/\schecked/);
      expect(box.tag).not.toMatch(/\sdefaultChecked/);
    }
    expect(out).toContain('Li e aceito os termos de uso (versão 0.1).');
    expect(out).toContain('Li e aceito a política de privacidade (versão 0.3)');
    // a transferência internacional (LGPD, art. 33) está na frase que a pessoa aceita
    expect(out).toContain('servidores no Chile e nos Estados Unidos (LGPD, art. 33)');
  });

  it('os textos abrem noutra aba, sem entregar a janela, e o link fica fora da frase da caixa', () => {
    expect(out).toMatch(
      /<a href="\/termos" target="_blank" rel="noopener noreferrer"[^>]*>Ler os termos de uso<span class="sr-only"> \(abre em outra aba\)<\/span><\/a>/,
    );
    expect(out).toMatch(/<a href="\/privacidade" target="_blank" rel="noopener noreferrer"/);
  });

  it('o Google só com a api configurada, e o cadastro por ele diz que é cadastro', () => {
    expect(out).not.toMatch(/google/i);
    expect(html(<SignUpForm terms="0.1" privacy="0.1" google />)).toContain(
      'Cadastrar com o Google',
    );
  });
});

describe('redefinir, reenviar e esqueci a senha', () => {
  it('a senha nova usa new-password; o token nunca vai ao HTML como campo nem como texto', () => {
    const out = html(<ResetPasswordForm token="token-sintetico" />);
    expect(inputs(out)).toHaveLength(1);
    expect(inputs(out)[0]).toMatchObject({ type: 'password', autocomplete: 'new-password' });
    expect(out).not.toContain('token-sintetico');
  });

  it('a dica do tamanho da senha sai do mesmo número que a api confere (nova senha, no cadastro e na redefinição)', () => {
    const hint = `Pelo menos ${ACCOUNT_LIMITS.passwordMin} caracteres.`;
    expect(html(<ResetPasswordForm token="token-sintetico" />)).toContain(hint);
    expect(html(<SignUpForm terms="0.1" privacy="0.1" google={false} />)).toContain(hint);
  });

  it('o e-mail do esqueci a senha e o do reenvio são do tipo e-mail, com autocomplete', () => {
    for (const form of [<ForgotPasswordForm key="a" />, <ResendVerificationForm key="b" />]) {
      expect(inputs(html(form))[0]).toMatchObject({
        type: 'email',
        autocomplete: 'email',
        name: 'email',
      });
    }
    expect(html(<ResendVerificationForm />)).toContain('>E-mail do cadastro</label>');
  });
});

describe('excluir a conta', () => {
  const out = html(<DeleteAccountForm labelledBy="excluir-titulo" />);

  it('começa sem pedir senha (a sessão recente basta), com a confirmação desmarcada', () => {
    expect(inputs(out)).toHaveLength(1);
    expect(inputs(out)[0]).toMatchObject({ name: 'confirm', type: 'checkbox' });
    expect(inputs(out)[0]!.tag).not.toMatch(/\schecked/);
    expect(out).toContain(
      'Entendi que a exclusão é definitiva e que não dá para recuperar a conta.',
    );
    expect(out).toContain('>Excluir minha conta</button>');
  });

  it('o formulário é nomeado pelo título da seção', () => {
    expect(out).toMatch(/<form[^>]*aria-labelledby="excluir-titulo"/);
  });
});

describe('aceite novo', () => {
  it('duas caixas desmarcadas com as versões novas', () => {
    const out = html(<AcceptConsentsForm terms="0.2" privacy="0.4" labelledBy="aceites-titulo" />);
    expect(inputs(out).map((input) => input.name)).toEqual(['terms', 'privacy']);
    expect(out).toContain('Li e aceito os termos de uso (versão 0.2).');
    expect(out).toContain('Li e aceito a política de privacidade (versão 0.4).');
    expect(out).toContain('>Aceitar as versões novas</button>');
  });
});
