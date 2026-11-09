import { readdirSync, readFileSync } from 'node:fs';
import { seasonFileSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { parseDatedSeasonFile, seasonSessions } from '../../../temporada/plan.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';

// Os arquivos de temporada versionados em apps/api/seasons/ (entrada do season:create e, o da Temporada 1, do arena:retroativo). Têm de
// passar no mesmo schema que o comando usa, e nunca podem carregar segredo: a chave do OpenRouter e o prompt chegam só pelo ambiente.
const dir = new URL('../../../../seasons/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
const load = (name: string): unknown => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
// o arquivo com a data fixa do primeiro pregão (a Temporada 1, que o arena:retroativo cria e inicia: ADR 0038)
const DATED = 'temporada-1.json';

describe('arquivos de temporada versionados', () => {
  it('são o ensaio local (arena:ensaio), a Temporada 0 de produção e a Temporada 1', () => {
    expect(files.sort()).toEqual(['ensaio.json', 'temporada-0.json', 'temporada-1.json']);
  });

  // Até a integração, a arena simulada mostra o elenco da Temporada 1 com decisões do provedor fake (a tela marca "simulado").
  it('o ensaio local tem o elenco da Temporada 1, com os mesmos nomes e slugs, cada um com uma estratégia fake própria, o Sorteio e as três referências', () => {
    const season = seasonFileSchema.parse(load('ensaio.json'));
    const draft = parseDatedSeasonFile(load(DATED)).file;
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

  it.each(files.filter((name) => name !== DATED))('%s passa no schema do season:create', (name) => {
    const parsed = seasonFileSchema.safeParse(load(name));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('a Temporada 1 passa no mesmo schema, mais a data fixa do primeiro pregão (o arquivo do arena:retroativo)', () => {
    const { startDate, file } = parseDatedSeasonFile(load(DATED));
    expect(startDate).toBe('2026-10-13');
    expect(seasonFileSchema.parse(file)).toEqual(file);
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

  // A Temporada 1 real (decisão do Artur em 06/11/2026): de 13/10/2026, o primeiro pregão em que os seis modelos já existiam no OpenRouter (o
  // Gemini 4 Argon entrou em 13/10), ao último pregão de 2026. A conta dos pregões é refeita aqui direto do calendário, dia a dia.
  it('a Temporada 1 vai de 13/10/2026 ao último pregão de 2026 (30/12): sessions é a conta do calendário', () => {
    const calendar = loadTradingCalendar();
    const dated = parseDatedSeasonFile(load(DATED));
    expect(dated.file.name).toBe('Temporada 1');
    const days = calendar.tradingDaysBetween('2026-10-13', '2026-12-31');
    expect(days.at(-1)).toBe('2026-12-30');
    expect(calendar.isTradingDay('2026-12-31')).toBe(false);
    expect(dated.file.params.sessions).toBe(days.length);
    expect(days.length).toBe(53);
    expect(seasonSessions(dated, calendar)).toEqual(days);
    // 12/10 foi feriado (N. Sra. Aparecida): 13/10, terça, é o primeiro pregão da semana
    expect(calendar.isTradingDay('2026-10-12')).toBe(false);
  });

  it('a Temporada 1 tem um modelo de topo por laboratório, com o ID fixado e as mesmas regras', () => {
    const season = parseDatedSeasonFile(load(DATED)).file;
    expect(season.params).toMatchObject({
      capitalCents: 10_000_000,
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
    // os preços da lista pública do OpenRouter de 06/11/2026 (a resposta das 08:53), em US$ por milhão de tokens (entrada e saída)
    expect(models.map((m) => [m.slug, m.pricingUsdPerMTok])).toEqual([
      ['claude-opus-5-5', { input: '4', output: '20' }],
      ['gpt-6-1-sol', { input: '2', output: '10' }],
      ['gemini-4-argon', { input: '2', output: '10' }],
      ['grok-4-7', { input: '2', output: '6' }],
      ['deepseek-v4-pro', { input: '0.1165', output: '4.66' }],
      ['qwen3-8-max', { input: '2', output: '6' }],
    ]);
  });

  it('as sementes das duas temporadas são diferentes (o ensaio não reaproveita a do experimento)', () => {
    const t0 = seasonFileSchema.parse(load('temporada-0.json')).params;
    const t1 = parseDatedSeasonFile(load(DATED)).file.params;
    expect(t0.randomSeed).not.toBe(t1.randomSeed);
    expect(t0.monteCarloSeed).not.toBe(t1.monteCarloSeed);
  });
});
