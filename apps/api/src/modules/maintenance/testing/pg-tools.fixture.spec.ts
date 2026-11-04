import { afterEach, describe, expect, it, vi } from 'vitest';

// O fixture que acha o pg_dump e o pg_restore 17 dos testes de integração do backup-verify decide na hora de carregar. Fora do CI, sem nenhum
// dos dois, o teste é PULADO com o motivo no nome (esta máquina não tem pg_dump nativo). No CI não pode: o passo "Cliente do PostgreSQL 17" do
// ci.yml instala o pacote, e se ele faltar (o passo saiu, o PGDG mudou) pular em silêncio tiraria do CI a única prova de que o backup restaura.
describe('pg-tools.fixture', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  // Nenhum binário responde: nem o do PATH nem o contêiner do projeto.
  const withoutAnyPgTool = () => {
    vi.resetModules();
    vi.doMock('node:child_process', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:child_process')>()),
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
    }));
  };

  it('no CI, sem pg_dump 17 no PATH, falha em vez de pular', async () => {
    withoutAnyPgTool();
    vi.stubEnv('CI', 'true');
    await expect(import('./pg-tools.fixture.js')).rejects.toThrow(
      /Cliente do PostgreSQL 17.*ci\.yml/s,
    );
  });

  it('fora do CI, sem nenhum dos dois, não falha: o teste é pulado com o motivo no nome', async () => {
    withoutAnyPgTool();
    vi.stubEnv('CI', '');
    const fixture = await import('./pg-tools.fixture.js');
    expect(fixture.localPgTools).toBeUndefined();
    expect(fixture.noPgToolsReason).toMatch(/sem pg_dump 17 no PATH/);
  });
});
