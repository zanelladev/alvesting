// Os textos dos e-mails da conta, em português, com o link absoluto (o Better Auth entrega a URL já montada pelo PUBLIC_URL) e a
// validade curta. Sem o nome da pessoa e sem rastreamento. Texto simples e HTML mínimo. A validade é a do pacote de contratos: as
// telas (/verificar-email, /esqueci-senha) prometem o mesmo número.
import { ACCOUNT_LIMITS } from '@alvesting/contracts';

export const VERIFICATION_VALIDITY_MINUTES = ACCOUNT_LIMITS.verificationMinutes;
export const PASSWORD_RESET_VALIDITY_MINUTES = ACCOUNT_LIMITS.passwordResetMinutes;

interface Content {
  subject: string;
  plainText: string;
  html: string;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// O link é de terceiro até chegar aqui (vem de uma URL montada com o que o cliente mandou): só http(s) vira link.
function assertHttp(url: string): string {
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    throw new Error('o link do e-mail precisa ser http(s)');
  }
  return url;
}

function compose(
  subject: string,
  lead: string,
  url: string,
  minutes: number,
  ignore: string,
): Content {
  const plainText = [
    'Olá,',
    '',
    `${lead} Ele vale por ${minutes} minutos.`,
    '',
    url,
    '',
    ignore,
    '',
    'Alvesting',
  ].join('\n');
  const html = [
    '<p>Olá,</p>',
    `<p>${escapeHtml(lead)} Ele vale por ${minutes} minutos.</p>`,
    `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
    `<p>${escapeHtml(ignore)}</p>`,
    '<p>Alvesting</p>',
  ].join('\n');
  return { subject, plainText, html };
}

export function verificationEmail({
  url,
  validityMinutes,
}: {
  url: string;
  validityMinutes: number;
}): Content {
  return compose(
    'Confirme seu e-mail na Alvesting',
    'Para confirmar o seu e-mail na Alvesting, abra o link abaixo.',
    assertHttp(url),
    validityMinutes,
    'Se você não criou uma conta na Alvesting, ignore esta mensagem: nada será feito.',
  );
}

export function passwordResetEmail({
  url,
  validityMinutes,
}: {
  url: string;
  validityMinutes: number;
}): Content {
  return compose(
    'Redefina a sua senha da Alvesting',
    'Para escolher uma senha nova na Alvesting, abra o link abaixo.',
    assertHttp(url),
    validityMinutes,
    'Se não foi você quem pediu, ignore esta mensagem: a sua senha continua a mesma.',
  );
}
