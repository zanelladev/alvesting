// O que as telas da conta precisam saber da api e que não pode levar o zod ao navegador.
//
// Este módulo NÃO importa nada, de propósito (nem o zod). O site o lê pelo subcaminho `@alvesting/contracts/account-constants` nos módulos
// que vão ao navegador: pelo índice do pacote, o bundler levava junto os schemas de account.ts e messages.ts (o zod, uns 36 KB
// comprimidos) só para ler seis números, e o formulário só vale depois de hidratar. Quem roda no servidor (a api) segue importando do índice.

// Os tetos do cadastro: a api os confere (auth.ts) e as telas os repetem antes de enviar, para dizer o erro no campo sem uma ida à api.
// A api manda: uma tela que errar o número só mostra a mensagem da api em vez da dela. Também a validade dos links dos e-mails, que o
// e-mail (email-templates.ts) e as telas prometem ("vale por 60 minutos"): a api os usa para expirar o token, e o texto sai do mesmo número.
export const ACCOUNT_LIMITS = {
  passwordMin: 10,
  passwordMax: 128,
  nameMax: 100,
  emailMax: 254,
  verificationMinutes: 60,
  passwordResetMinutes: 30,
} as const;

// O código de erro que DELETE /api/v1/me devolve (403) quando a sessão tem mais de 5 minutos e o corpo veio sem a senha. É por ele que a
// tela da conta passa a pedir a senha; a api, a tela e os testes leem este mesmo valor, e renomear o código num lado só não passa.
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED';
