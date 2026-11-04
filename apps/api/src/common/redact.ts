// Tira dado pessoal e segredo de um texto antes de ele ir a um log (LGPD nos logs, etapa 11; CLAUDE.md): e-mail, endereço IP, cookie,
// token e a query string de uma URL. É a última barreira: o log de requisição já é uma lista branca e o que a aplicação escreve não
// deveria levar nada disto, mas a mensagem de erro de uma biblioteca (Prisma, Better Auth, SDK da Azure) leva o que quiser.
// ponytail: regras por forma, não por valor; um nome de pessoa em texto livre passa (o único lugar onde os erros do Prisma o
// carregam, o dump dos argumentos, é cortado abaixo). Se o log passar a aceitar texto livre do usuário, esse texto não entra nele.
//
// Este texto pode ser do atacante (o Better Auth loga o `callbackURL` e o `Origin` inválidos), então a função TEM de ser linear no
// tamanho dele (ReDoS: a regra do e-mail era quadrática e 60 KB travavam a api por 1,6 s). Duas barreiras: (1) o texto é cortado
// antes das regras; (2) cada regra é linear sozinha: onde uma sequência pode começar em qualquer ponto de uma corrida de letras (o
// trecho local do e-mail, o início do JWT), um lookbehind só deixa começar no começo da corrida, e onde a repetição não tem fim
// natural ela tem teto. O teste (redact.spec.ts) tira o corte e confere cada regra com texto adversarial.
const MAX_LENGTH = 8 * 1024;

// Corta no último espaço ou quebra de linha antes do teto, e nada da ponta fica (um pedaço de e-mail ou de token na borda do corte
// escaparia das regras). Sem nenhum espaço antes do teto, não sobra nada: é lixo, não mensagem.
export function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = Math.max(text.lastIndexOf(' ', maxLength), text.lastIndexOf('\n', maxLength));
  return `${cut > 0 ? text.slice(0, cut) : ''}${cut > 0 ? ' ' : ''}[cortado]`;
}

// O token da redefinição de senha vai NO CAMINHO (GET /api/auth/reset-password/<token>), e o caminho é o que o log de requisição
// guarda. O e-mail da redefinição já aponta para o site, que manda o token por POST, mas a rota da API existe e quem a abrir deixaria
// o token no log.
const RESET_PATH = /(\/api\/auth\/reset-password\/)[^\s/?#]+/g;

export const redactPath = (path: string | undefined): string | undefined =>
  path?.replace(RESET_PATH, '$1:token');

const RULES: ReadonlyArray<
  readonly [RegExp, string | ((match: string, ...groups: string[]) => string)]
> = [
  // JWT (com ou sem "Bearer "); o lookbehind faz "eyJeyJeyJ..." ter um começo só
  [/(?:Bearer\s+)?(?<![\w-])eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'],
  // linha de cabeçalho Cookie / Set-Cookie
  [/\b(Set-)?Cookie:[^\n]*/gi, (_m, set = '') => `${set}Cookie: [cookie]`],
  // o Prisma despeja os argumentos da chamada (nome, e-mail) no erro de validação
  [/(Invalid `prisma\.[^`]+` invocation:)[\s\S]*/g, '$1 [omitido]'],
  [RESET_PATH, '$1:token'],
  // query string e fragmento de URL (?token=, ?code=, ?state=). A regra casa a URL inteira e tira a query na função: sem falha
  // depois do "http://" não há retrocesso, e "http://http://http://..." continua linear
  [/https?:\/\/[^\s?#]*(?:[?#]\S*)?/g, (m) => m.replace(/[?#]\S*$/, '')],
  // parâmetro com cara de segredo fora de uma URL ("falhou com ?token=abc")
  [
    /([?&][\w.-]*(?:token|code|state|password|secret|key|session|sid|auth)[\w.-]*=)[^\s&]*/gi,
    '$1[x]',
  ],
  // o lookbehind faz o trecho local começar no começo da corrida de letras (sem ele, cada letra de "aaaa..." seria um começo)
  [
    /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    '[e-mail]',
  ],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  // IPv6: com "::" ou com os 8 grupos; "12:30:45" (uma hora) não casa
  [
    /[0-9a-f:]{6,45}/gi,
    (m) =>
      /^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i.test(m) &&
      (m.includes('::') || m.split(':').length === 8)
        ? '[ip]'
        : m,
  ],
  // um token solto: 32 ou mais caracteres de base64url (o ULID, com 26, é o identificador permitido e fica)
  [/[A-Za-z0-9_-]{32,}/g, '[token]'],
];

// `maxLength` só existe para o teste tirar o corte e provar que as regras são lineares sozinhas.
export function redactPii(text: string, maxLength = MAX_LENGTH): string {
  let out = clip(text, maxLength);
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement as string);
  }
  return out;
}
