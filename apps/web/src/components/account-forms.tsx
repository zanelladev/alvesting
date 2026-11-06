'use client';

import { useState } from 'react';
// Pelo subcaminho, e não pelo índice: este módulo vai ao navegador, e o índice leva o zod junto (packages/contracts/src/account-constants.ts).
import { ACCOUNT_LIMITS, REAUTH_REQUIRED } from '@alvesting/contracts/account-constants';
import { googleBody, messageFor, send, type Reply } from '../lib/account-client';
import {
  checked,
  validateEmail,
  validateName,
  validateNewPassword,
  validateSignInPassword,
} from '../lib/account-validation';
import { AccountForm, CheckField, TextField, type Outcome } from './form-kit';
import { BUTTON, LINK, NavLink } from './ui';

// Os formulários da conta (etapa 11, parte 2; docs/CONTA.md, seções 2 e 9). Cada um fala com a api pela mesma origem (`/api/auth/*` do
// Better Auth e `/api/v1/me*`), confere o que dá antes de enviar e, no sucesso, sai da tela por uma navegação completa (o cookie da
// sessão acabou de mudar, e a tela seguinte é renderizada no servidor com ele). Os erros da api viram frases em português (messageFor),
// nunca a mensagem crua dela. Quem renderiza decide o `next` (já validado por safeInternalPath, no servidor).

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};

const go = (path: string): void => window.location.assign(path);

// Para onde o link do e-mail de verificação termina (a tela de verificação mostra o resultado, com o erro na query se houver)
const VERIFIED = '/verificar-email?retorno=1';

// O Google: a api devolve a URL de autorização e a página vai para lá. Só https, e só o que a api devolve.
async function startGoogle(body: Record<string, unknown>): Promise<Outcome | void> {
  const out = await send('/api/auth/sign-in/social', { body });
  const url = (out.body as { url?: unknown } | undefined)?.url;
  if (out.ok && typeof url === 'string' && url.startsWith('https://')) {
    window.location.assign(url);
    return;
  }
  return { form: messageFor(out.ok ? { ...out, ok: false, status: 502 } : out) };
}

// O texto que a pessoa vai aceitar abre noutra aba: o formulário preenchido não se perde. O link fica abaixo da caixa (e não no meio da
// frase dela), porque todo link tem 44 px de largura mínima; o recuo é o da caixa (44 px) mais o vão.
const ReadLink = ({ href, children }: { href: string; children: string }) => (
  <p className="pl-14">
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
      <span className="sr-only"> (abre em outra aba)</span>
    </a>
  </p>
);

const GoogleButton = ({ children }: { children: string }) => (
  <button type="submit" name="via" value="google" className={BUTTON}>
    {children}
  </button>
);

export function SignInForm({ next, google }: { next: string; google: boolean }) {
  async function run(data: FormData, via: string | null): Promise<Outcome | void> {
    if (via === 'google') return startGoogle(googleBody({ next }));
    const email = text(data, 'email').trim();
    const password = text(data, 'password');
    const fields: Record<string, string> = {};
    const emailError = validateEmail(email);
    if (emailError) fields.email = emailError;
    const passwordError = validateSignInPassword(password);
    if (passwordError) fields.password = passwordError;
    if (Object.keys(fields).length > 0) return { fields };

    const out = await send('/api/auth/sign-in/email', { body: { email, password } });
    if (out.ok) return go(next);
    if (out.code === 'EMAIL_NOT_VERIFIED') {
      return {
        form: (
          <>
            Confirme o seu e-mail antes de entrar. Mandamos um link para o endereço do cadastro; se
            não chegou, espere 1 minuto e tente entrar de novo para receber outro.{' '}
            <NavLink href="/verificar-email" className={LINK}>
              Reenviar o link de confirmação
            </NavLink>
          </>
        ),
      };
    }
    return { form: messageFor(out) };
  }

  return (
    <AccountForm
      submit="Entrar"
      run={run}
      primary
      actions={google ? <GoogleButton>Entrar com o Google</GoogleButton> : undefined}
    >
      <TextField name="email" label="E-mail" type="email" autoComplete="email" />
      <TextField name="password" label="Senha" type="password" autoComplete="current-password" />
    </AccountForm>
  );
}

export function SignUpForm({
  terms,
  privacy,
  google,
}: {
  // as versões vigentes dos dois textos (a api manda; o aceite só vale se for exatamente elas)
  terms: string;
  privacy: string;
  google: boolean;
}) {
  async function run(data: FormData, via: string | null): Promise<Outcome | void> {
    const fields: Record<string, string> = {};
    const name = text(data, 'name').trim();
    const email = text(data, 'email').trim();
    const password = text(data, 'password');
    // o cadastro com o Google não pede nome, e-mail nem senha: o Google os informa. Pede só o aceite.
    if (via !== 'google') {
      const nameError = validateName(name);
      if (nameError) fields.name = nameError;
      const emailError = validateEmail(email);
      if (emailError) fields.email = emailError;
      const passwordError = validateNewPassword(password);
      if (passwordError) fields.password = passwordError;
    }
    if (!checked(data, 'terms')) fields.terms = 'Marque a caixa para aceitar os termos de uso.';
    if (!checked(data, 'privacy')) {
      fields.privacy = 'Marque a caixa para aceitar a política de privacidade.';
    }
    if (Object.keys(fields).length > 0) return { fields };

    const consent = { terms, privacy };
    if (via === 'google') return startGoogle(googleBody({ next: '/conta', consent }));

    const out = await send('/api/auth/sign-up/email', {
      body: { name, email, password, callbackURL: VERIFIED, consent },
    });
    if (out.ok) return go('/verificar-email');
    // o aceite recusado, com as caixas marcadas, é texto que mudou enquanto a pessoa preenchia
    if (out.code === 'CONSENT_REQUIRED') {
      return {
        form: 'Os textos mudaram enquanto você preenchia. Recarregue a página, leia a versão nova e aceite de novo.',
      };
    }
    if (out.code === 'PASSWORD_TOO_SHORT' || out.code === 'PASSWORD_TOO_LONG') {
      return { fields: { password: messageFor(out) } };
    }
    if (out.code === 'INVALID_EMAIL') return { fields: { email: messageFor(out) } };
    return { form: messageFor(out) };
  }

  return (
    <AccountForm
      submit="Criar conta"
      run={run}
      primary
      actions={google ? <GoogleButton>Cadastrar com o Google</GoogleButton> : undefined}
    >
      <TextField name="name" label="Nome" autoComplete="name" />
      <TextField
        name="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        hint="Mandamos um link para confirmar o endereço."
      />
      <TextField
        name="password"
        label="Senha"
        type="password"
        autoComplete="new-password"
        hint={`Pelo menos ${ACCOUNT_LIMITS.passwordMin} caracteres.`}
      />
      <fieldset className="min-w-0 space-y-2">
        <legend className="font-display text-sm font-medium text-ink">Aceite</legend>
        <CheckField name="terms">{`Li e aceito os termos de uso (versão ${terms}).`}</CheckField>
        <ReadLink href="/termos">Ler os termos de uso</ReadLink>
        <CheckField name="privacy">
          {`Li e aceito a política de privacidade (versão ${privacy}), inclusive o envio dos meus dados para servidores nos Estados Unidos (LGPD, art. 33).`}
        </CheckField>
        <ReadLink href="/privacidade">Ler a política de privacidade</ReadLink>
      </fieldset>
    </AccountForm>
  );
}

export function ForgotPasswordForm() {
  async function run(data: FormData): Promise<Outcome | void> {
    const email = text(data, 'email').trim();
    const emailError = validateEmail(email);
    if (emailError) return { fields: { email: emailError } };
    const out = await send('/api/auth/request-password-reset', { body: { email } });
    if (!out.ok) return { form: messageFor(out) };
    // a mesma resposta para e-mail cadastrado ou não: a tela não revela quem tem conta
    return {
      status: `Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. Ele vale por ${ACCOUNT_LIMITS.passwordResetMinutes} minutos. Se não chegar, confira o spam e espere 1 minuto antes de pedir de novo.`,
    };
  }

  return (
    <AccountForm submit="Enviar o link" run={run} primary>
      <TextField name="email" label="E-mail" type="email" autoComplete="email" />
    </AccountForm>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  async function run(data: FormData): Promise<Outcome | void> {
    const newPassword = text(data, 'password');
    const passwordError = validateNewPassword(newPassword);
    if (passwordError) return { fields: { password: passwordError } };
    const out = await send('/api/auth/reset-password', { body: { newPassword, token } });
    // `replace`, e não `assign`: a entrada /redefinir-senha?token=… (o token já foi usado, mas o link aberto e abandonado vale até 30
    // minutos) sai do histórico, e o "voltar" não a devolve num computador compartilhado.
    if (out.ok) return window.location.replace('/entrar?aviso=senha-redefinida');
    if (out.code === 'INVALID_TOKEN' || out.code === 'TOKEN_EXPIRED') {
      return {
        form: (
          <>
            {messageFor(out)}{' '}
            <NavLink href="/esqueci-senha" className={LINK}>
              Pedir um link novo
            </NavLink>
          </>
        ),
      };
    }
    if (out.code === 'PASSWORD_TOO_SHORT' || out.code === 'PASSWORD_TOO_LONG') {
      return { fields: { password: messageFor(out) } };
    }
    return { form: messageFor(out) };
  }

  return (
    <AccountForm submit="Salvar a nova senha" run={run} primary>
      <TextField
        name="password"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        hint={`Pelo menos ${ACCOUNT_LIMITS.passwordMin} caracteres.`}
      />
    </AccountForm>
  );
}

export function ResendVerificationForm() {
  async function run(data: FormData): Promise<Outcome | void> {
    const email = text(data, 'email').trim();
    const emailError = validateEmail(email);
    if (emailError) return { fields: { email: emailError } };
    const out = await send('/api/auth/send-verification-email', {
      body: { email, callbackURL: VERIFIED },
    });
    if (!out.ok) return { form: messageFor(out) };
    // a mesma resposta para qualquer e-mail, e o mesmo tipo de e-mail só sai de novo depois de 1 minuto (AccountMailer)
    return {
      status:
        'Se existir um cadastro ainda não confirmado com esse e-mail, enviamos um novo link. Se não chegar, confira o spam e espere 1 minuto antes de pedir de novo.',
    };
  }

  return (
    <AccountForm submit="Reenviar o link" run={run} primary>
      <TextField name="email" label="E-mail do cadastro" type="email" autoComplete="email" />
    </AccountForm>
  );
}

export function SignOutForm({ labelledBy }: { labelledBy: string }) {
  async function run(): Promise<Outcome | void> {
    const out = await send('/api/auth/sign-out', { body: {} });
    if (out.ok) return go('/entrar?aviso=saiu');
    return { form: messageFor(out) };
  }
  return <AccountForm submit="Sair" run={run} labelledBy={labelledBy} noscript={false} />;
}

// Versão nova de um texto: a conta mostra o pedido de aceite (docs/CONTA.md, "Aceite novo").
export function AcceptConsentsForm({
  terms,
  privacy,
  labelledBy,
}: {
  terms: string;
  privacy: string;
  labelledBy: string;
}) {
  async function run(data: FormData): Promise<Outcome | void> {
    const fields: Record<string, string> = {};
    if (!checked(data, 'terms')) fields.terms = 'Marque a caixa para aceitar os termos de uso.';
    if (!checked(data, 'privacy')) {
      fields.privacy = 'Marque a caixa para aceitar a política de privacidade.';
    }
    if (Object.keys(fields).length > 0) return { fields };
    const out = await send('/api/v1/me/consents', { body: { terms, privacy } });
    // 409: as versões mudaram de novo enquanto a pessoa lia; recarregar mostra as vigentes
    if (out.ok || out.status === 409) return window.location.reload();
    return { form: messageFor(out) };
  }
  return (
    <AccountForm
      submit="Aceitar as versões novas"
      run={run}
      labelledBy={labelledBy}
      noscript={false}
      primary
    >
      <CheckField name="terms">{`Li e aceito os termos de uso (versão ${terms}).`}</CheckField>
      <CheckField name="privacy">{`Li e aceito a política de privacidade (versão ${privacy}).`}</CheckField>
    </AccountForm>
  );
}

export function DeleteAccountForm({ labelledBy }: { labelledBy: string }) {
  // A senha só é pedida quando a api diz que a sessão é antiga (mais de 5 minutos): sessão recente basta.
  const [needsPassword, setNeedsPassword] = useState(false);

  async function run(data: FormData): Promise<Outcome | void> {
    const fields: Record<string, string> = {};
    if (!checked(data, 'confirm')) fields.confirm = 'Marque a caixa para confirmar a exclusão.';
    const password = text(data, 'password');
    if (needsPassword && password === '') fields.password = 'Informe a senha para excluir a conta.';
    if (Object.keys(fields).length > 0) return { fields };

    // sem corpo quando a sessão é recente: um DELETE puro
    const out: Reply = await send('/api/v1/me', {
      method: 'DELETE',
      body: needsPassword ? { password } : undefined,
    });
    if (out.ok) return go('/entrar?aviso=conta-excluida');
    if (out.code === REAUTH_REQUIRED) {
      setNeedsPassword(true);
      return {
        fields: {
          password:
            'Sua sessão tem mais de 5 minutos. Informe a senha para excluir a conta. Se você entra só com o Google, saia, entre de novo e exclua em seguida.',
        },
      };
    }
    if (out.code === 'INVALID_PASSWORD') return { fields: { password: 'Senha incorreta.' } };
    return { form: messageFor(out) };
  }

  return (
    <AccountForm submit="Excluir minha conta" run={run} labelledBy={labelledBy} noscript={false}>
      <CheckField name="confirm">
        Entendi que a exclusão é definitiva e que não dá para recuperar a conta.
      </CheckField>
      {needsPassword ? (
        <TextField name="password" label="Senha" type="password" autoComplete="current-password" />
      ) : null}
    </AccountForm>
  );
}
