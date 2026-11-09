import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkApiProxyEnv } from './instrumentation-node';

// O repasse de /api/* (src/lib/api-proxy.ts; ADR 0039) é fail closed na subida, como a trava de origem: um valor torto em API_PROXY (`true`,
// `1`) desligaria o repasse em silêncio, e no perfil econômico o login, o cadastro e a carteira dariam 404 com o /health verde.
describe('checkApiProxyEnv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = (env: Record<string, string | undefined>) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    checkApiProxyEnv(env);
    return { exited: exit.mock.calls.map(([code]) => code), errors: error.mock.calls.flat() };
  };

  it('sem API_PROXY (o padrão) e com API_PROXY=on e um endereço http(s), sobe', () => {
    expect(run({}).exited).toEqual([]);
    expect(
      run({ API_PROXY: 'on', API_INTERNAL_URL: 'https://ca-api.internal.x.test' }).exited,
    ).toEqual([]);
    expect(run({ API_PROXY: 'on', API_INTERNAL_URL: 'http://127.0.0.1:4310' }).exited).toEqual([]);
  });

  it.each([
    [{ API_PROXY: 'true', API_INTERNAL_URL: 'https://ca-api.internal.x.test' }, /API_PROXY/],
    [{ API_PROXY: '1' }, /API_PROXY/],
    [{ API_PROXY: 'on' }, /API_INTERNAL_URL/],
    [{ API_PROXY: 'on', API_INTERNAL_URL: 'banana' }, /API_INTERNAL_URL/],
    [{ API_PROXY: 'on', API_INTERNAL_URL: 'file:///etc/passwd' }, /API_INTERNAL_URL/],
  ])('%o: recusa subir (código 1), dizendo o que falta', (env, message) => {
    const { exited, errors } = run(env);
    expect(exited).toEqual([1]);
    expect(errors.join(' ')).toMatch(message);
  });
});
