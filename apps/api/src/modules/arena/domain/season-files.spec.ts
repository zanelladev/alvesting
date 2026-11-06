import { readdirSync, readFileSync } from 'node:fs';
import { seasonFileSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';

// Os arquivos de temporada versionados em apps/api/seasons/ (entrada do season:create). Têm de passar no mesmo schema que o
// comando usa, e nunca podem carregar segredo: a chave do OpenRouter e o prompt chegam só pelo ambiente.
const dir = new URL('../../../../seasons/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
const load = (name: string): unknown => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

describe('arquivos de temporada versionados', () => {
  it('são o ensaio local (arena:ensaio), a Temporada 0 de produção e o rascunho da Temporada 1', () => {
    expect(files.sort()).toEqual(['ensaio.json', 'temporada-0.json', 'temporada-1.rascunho.json']);
  });

  // Até a integração, a arena simulada mostra o elenco da Temporada 1 com decisões do provedor fake (a tela marca "simulado").
  it('o ensaio local tem o elenco da Temporada 1, com os mesmos nomes e slugs, cada um com uma estratégia fake própria, o Sorteio e as três referências', () => {
    const season = seasonFileSchema.parse(load('ensaio.json'));
    const draft = seasonFileSchema.parse(load('temporada-1.rascunho.json'));
    expect(season.params.sessions).toBe(5);
    const models = season.competitors.flatMap((c) => (c.kind === 'MODEL' ? [c] : []));
    const cast = draft.competitors.flatMap((c) => (c.kind === 'MODEL' ? [[c.slug, c.name]] : []));
    expect(models.map((m) => [m.slug, m.name])).toEqual(cast);
    expect(models.map((m) => [m.provider, m.modelId])).toEqual([
      ['fake', 'fake/momentum'],
      ['fake', 'fake/contrarian'],
      ['fake', 'fake/hold-only'],
      ['fake', 'fake/hash-picks'],
      ['fake', 'fake/momentum-focused'],
      ['fake', 'fake/contrarian-spread'],
    ]);
    expect(season.competitors.filter((c) => c.kind === 'RANDOM')).toHaveLength(1);
    expect(season.competitors.filter((c) => c.kind === 'BENCHMARK')).toHaveLength(3);
  });

  it.each(files)('%s passa no schema do season:create', (name) => {
    const parsed = seasonFileSchema.safeParse(load(name));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it.each(files)('%s não traz segredo (chave, token, texto de prompt)', (name) => {
    const text = readFileSync(new URL(name, dir), 'utf8');
    expect(text).not.toMatch(/sk-or-|api[_-]?key|secret|token|prompt|senha|password/i);
  });

  it('o ensaio usa só provedores fake e 5 pregões; é o que a Temporada 0 pede', () => {
    const season = seasonFileSchema.parse(load('temporada-0.json'));
    expect(season.params.sessions).toBe(5);
    const models = season.competitors.filter((c) => c.kind === 'MODEL');
    expect(models.length).toBe(6);
    expect(models.every((m) => m.provider === 'fake')).toBe(true);
  });

  it('a Temporada 1 tem um modelo de topo por laboratório, com o ID fixado, 20 pregões e as mesmas regras', () => {
    const season = seasonFileSchema.parse(load('temporada-1.rascunho.json'));
    expect(season.params).toMatchObject({
      capitalCents: 10_000_000,
      sessions: 20,
      maxPositions: 10,
      tradeCostBps: 3,
      monteCarloRuns: 1000,
    });
    const models = season.competitors.flatMap((c) => (c.kind === 'MODEL' ? [c] : []));
    expect(models.map((m) => m.modelId)).toEqual([
      'anthropic/claude-opus-5.5',
      'openai/gpt-6.1-sol',
      'google/gemini-4-argon',
      'x-ai/grok-4.7',
      'deepseek/deepseek-v4-pro-0813',
      'qwen/qwen3.8-max-0902',
    ]);
    expect(models.every((m) => m.provider === 'openrouter')).toBe(true);
  });

  it('as sementes das duas temporadas são diferentes (o ensaio não reaproveita a do experimento)', () => {
    const t0 = seasonFileSchema.parse(load('temporada-0.json')).params;
    const t1 = seasonFileSchema.parse(load('temporada-1.rascunho.json')).params;
    expect(t0.randomSeed).not.toBe(t1.randomSeed);
    expect(t0.monteCarloSeed).not.toBe(t1.monteCarloSeed);
  });
});
