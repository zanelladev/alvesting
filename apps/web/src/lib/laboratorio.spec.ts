import { describe, expect, it } from 'vitest';
import { labOf } from './laboratorio';

// O logo de cada modelo sai do laboratório dele, que o contrato público não traz: o `modelId` da temporada de verdade diz o laboratório no
// prefixo (o do OpenRouter), e o provedor fake, que decide por estratégia (`fake/momentum`), só o diz pelo slug do elenco. As três temporadas
// do repositório (apps/api/seasons) estão aqui, e o que não é modelo, ou é de um laboratório sem logo, fica com a inicial.
const model = (slug: string, modelId: string | null) => ({ slug, modelId, type: 'MODEL' });

describe('labOf', () => {
  it('a Temporada 1 de verdade: pelo prefixo do modelId', () => {
    expect(labOf(model('claude-opus-5-5', 'anthropic/claude-opus-5.5'))).toBe('anthropic');
    expect(labOf(model('gpt-6-1-sol', 'openai/gpt-6.1-sol'))).toBe('openai');
    expect(labOf(model('gemini-4-argon', 'google/gemini-4-argon'))).toBe('google');
    expect(labOf(model('grok-4-7', 'x-ai/grok-4.7'))).toBe('xai');
    expect(labOf(model('deepseek-v4-pro', 'deepseek/deepseek-v4-pro-0813'))).toBe('deepseek');
    expect(labOf(model('qwen3-8-max', 'qwen/qwen3.8-max-0902'))).toBe('qwen');
  });

  it('o ensaio e a demo (o elenco no provedor fake, que decide por estratégia): pelo slug', () => {
    expect(labOf(model('claude-opus-5-5', 'fake/momentum'))).toBe('anthropic');
    expect(labOf(model('gpt-6-1-sol', 'fake/contrarian'))).toBe('openai');
    expect(labOf(model('gemini-4-argon', 'fake/hold-only'))).toBe('google');
    expect(labOf(model('grok-4-7', 'fake/hash-picks'))).toBe('xai');
    expect(labOf(model('deepseek-v4-pro', 'fake/momentum-focused'))).toBe('deepseek');
    expect(labOf(model('qwen3-8-max', 'fake/contrarian-spread'))).toBe('qwen');
  });

  it('a Temporada 0 (os fakes com o nome do laboratório): a Alibaba é a do Qwen', () => {
    expect(labOf(model('fake-anthropic', 'fake/anthropic'))).toBe('anthropic');
    expect(labOf(model('fake-openai', 'fake/openai'))).toBe('openai');
    expect(labOf(model('fake-google', 'fake/google'))).toBe('google');
    expect(labOf(model('fake-xai', 'fake/xai'))).toBe('xai');
    expect(labOf(model('fake-deepseek', 'fake/deepseek'))).toBe('deepseek');
    expect(labOf(model('fake-alibaba', 'fake/alibaba'))).toBe('qwen');
  });

  it('maiúsculas no modelId e no slug não mudam nada', () => {
    expect(labOf(model('Claude-Opus', 'Anthropic/Claude'))).toBe('anthropic');
  });

  it('o Sorteio e as referências não são modelo: sem logo, mesmo com um nome parecido', () => {
    for (const type of ['RANDOM', 'EQUAL_WEIGHT', 'CDI', 'BOVA11']) {
      expect(labOf({ slug: 'gpt-sorteio', modelId: null, type })).toBeNull();
    }
  });

  it('um laboratório sem logo, ou um modelo sem nada que o diga, fica sem logo (a inicial)', () => {
    expect(labOf(model('llama-5', 'meta-llama/llama-5-405b'))).toBeNull();
    expect(labOf(model('mistral-grande', 'mistralai/mistral-large'))).toBeNull();
    expect(labOf(model('modelo-x', 'fake/momentum'))).toBeNull();
    expect(labOf(model('modelo-y', null))).toBeNull();
  });
});
