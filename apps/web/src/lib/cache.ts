import { createHash, timingSafeEqual } from 'node:crypto';

// O cache de dados do site (plano §5.4 e §9; docs/API.md). Só roda no servidor (Node): o cliente de dados (api.ts), a rota de
// revalidação e o proxy da trava de origem usam daqui.

// As tags com que o cliente marca cada leitura da API pública e que a rota de revalidação vence depois de uma liquidação:
//   arena  tudo que a liquidação muda (ranking, patrimônio, Monte Carlo, competidor, ciclo, feed de decisões, ação)
//   news   as notícias
export const CACHE_TAGS = ['arena', 'news'] as const;
export type CacheTag = (typeof CACHE_TAGS)[number];

// A rota que o worker chama depois da liquidação (docs/INFRA.md, 3.3). É a única, além do /health, que a trava de origem deixa
// passar sem o X-Azure-FDID, e só com o segredo certo.
export const REVALIDATE_PATH = '/interno/revalidar';

// A rota é alcançável da internet (pelo Front Door e pelo endereço direto do ca-web), então o segredo é a única defesa dela. Um
// REVALIDATE_SECRET com menos de 32 caracteres é erro de configuração e vale como ausente: a rota fica desligada (o seed gera 384
// bits; o worker recusa subir com um segredo mais curto).
export const MIN_REVALIDATE_SECRET_LENGTH = 32;
export const isRevalidateSecretUsable = (secret: string | undefined): secret is string =>
  secret !== undefined && secret.length >= MIN_REVALIDATE_SECRET_LENGTH;

// O segredo vem no cabeçalho `Authorization: Bearer <segredo>`, nunca na URL (a URL vai para log). A comparação é em tempo
// constante: os dois lados passam por SHA-256 antes (tamanho igual, sem revelar o tamanho do segredo) e vão para timingSafeEqual.
// Sem segredo configurado (ausente, vazio ou curto demais) ninguém passa: fail closed.
export function hasValidRevalidateSecret(headers: Headers, expected: string | undefined): boolean {
  if (!isRevalidateSecretUsable(expected)) return false;
  const match = /^Bearer (\S+)$/.exec(headers.get('authorization') ?? '');
  if (!match?.[1]) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(expected));
}
