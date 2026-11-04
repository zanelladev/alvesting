import { afterEach, describe, expect, it, vi } from 'vitest';

// O gancho de `node --import ./dist/telemetry/preload.js` (apps/api/Dockerfile, docs/INFRA.md, 5.1): só liga a telemetria com a connection
// string, e uma telemetria que não sobe não derruba a api. O telemetry.js é trocado por um espião: nenhum teste fala com a Azure.
const start = vi.fn<() => Promise<boolean>>();

async function load(connectionString: string | undefined): Promise<void> {
  vi.resetModules();
  vi.doMock('./telemetry.js', () => ({ startTelemetry: start }));
  if (connectionString === undefined)
    vi.stubEnv('APPLICATIONINSIGHTS_CONNECTION_STRING', undefined);
  else vi.stubEnv('APPLICATIONINSIGHTS_CONNECTION_STRING', connectionString);
  await import('./preload.js');
}

afterEach(() => {
  vi.doUnmock('./telemetry.js');
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  start.mockReset();
});

describe('preload da telemetria', () => {
  it.each([undefined, '', '   '])(
    'sem connection string (%j) nem carrega o módulo da telemetria',
    async (value) => {
      await load(value);
      expect(start).not.toHaveBeenCalled();
    },
  );

  it('com a connection string liga a telemetria, uma vez', async () => {
    start.mockResolvedValue(true);
    await load('InstrumentationKey=00000000-0000-0000-0000-000000000000');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('telemetria que falha ao subir não derruba o processo: avisa no stderr só o nome do erro, sem a mensagem', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    start.mockRejectedValue(new TypeError('InstrumentationKey=00000000-segredo-abc123'));
    await expect(
      load('InstrumentationKey=00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledTimes(1);
    const text = String(stderr.mock.calls[0]?.[0]);
    expect(text).toContain('TypeError');
    expect(text).not.toContain('abc123');
  });
});
