// O laboratório de um modelo, para o logo ao lado do nome (components/competidor.tsx; ADR 0035). O contrato público não o traz (o
// `publicCompetitorSchema` tem slug, tipo, provedor e modelId), e não precisa: a temporada de verdade diz o laboratório no prefixo do
// `modelId` (o do OpenRouter: `anthropic/...`, `x-ai/...`), e o provedor fake, que decide por estratégia (`fake/momentum`), só o diz pelo
// slug do elenco (`claude-opus-5-5`) ou, na Temporada 0, pelo nome depois do `fake/`. Só modelo tem logo de laboratório: o Sorteio e as
// referências têm ícones nossos (components/competidor.tsx), e o modelo de laboratório sem logo leva a inicial.
export type Laboratorio = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'qwen';

// o começo de cada pedaço (do modelId ou do slug) que diz o laboratório; a Alibaba Cloud é a do Qwen
const PREFIXES: ReadonlyArray<readonly [string, Laboratorio]> = [
  ['anthropic', 'anthropic'],
  ['claude', 'anthropic'],
  ['openai', 'openai'],
  ['gpt', 'openai'],
  ['google', 'google'],
  ['gemini', 'google'],
  ['x-ai', 'xai'],
  ['xai', 'xai'],
  ['grok', 'xai'],
  ['deepseek', 'deepseek'],
  ['qwen', 'qwen'],
  ['alibaba', 'qwen'],
];

export function labOf(competitor: {
  slug: string;
  modelId: string | null;
  type: string;
}): Laboratorio | null {
  if (competitor.type !== 'MODEL') return null;
  // o prefixo do modelId vem antes do slug: na temporada de verdade é ele quem manda
  const [provider = '', model = ''] = (competitor.modelId ?? '').toLowerCase().split('/');
  for (const piece of [provider, model, ...competitor.slug.toLowerCase().split('-')]) {
    const hit = PREFIXES.find(([prefix]) => piece.startsWith(prefix));
    if (hit) return hit[1];
  }
  return null;
}
