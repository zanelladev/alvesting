import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RETRO_HOSTS } from '../temporada/pieces.js';
import { installNetworkGuard, isAllowedHost, type NetworkGuard } from './network-guard.js';

let guard: NetworkGuard | undefined;
afterEach(() => {
  guard?.restore();
  guard = undefined;
});

describe('installNetworkGuard: o ensaio não sai da máquina', () => {
  it('o fetch global falha e anota o endereço (sem a query, que pode carregar segredo)', async () => {
    const original = globalThis.fetch;
    guard = installNetworkGuard();
    await expect(fetch('https://exemplo.invalid/api?token=segredo')).rejects.toThrow(
      /rede bloqueada/,
    );
    expect(guard.blocked).toEqual(['fetch https://exemplo.invalid/api']);
    guard.restore();
    expect(globalThis.fetch).toBe(original);
  });

  it('conexão TCP para fora do loopback falha na hora, antes de qualquer resolução de nome', () => {
    guard = installNetworkGuard();
    expect(() => net.connect({ host: 'exemplo.invalid', port: 443 })).toThrow(/rede bloqueada/);
    expect(() => net.connect(443, '93.184.216.34')).toThrow(/rede bloqueada/);
    expect(guard.blocked).toEqual(['tcp exemplo.invalid:443', 'tcp 93.184.216.34:443']);
  });

  it('o loopback passa (o Postgres e o Azurite do ensaio estão nele) e nada é anotado', async () => {
    guard = installNetworkGuard();
    const server = net.createServer((socket) => socket.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      for (const host of ['127.0.0.1', 'localhost']) {
        const text = await new Promise<string>((resolve, reject) => {
          const socket = net.connect({ host, port });
          let data = '';
          socket.setEncoding('utf8');
          socket.on('data', (chunk: string) => (data += chunk));
          socket.on('end', () => resolve(data));
          socket.on('error', reject);
        });
        expect(text).toBe('ok');
      }
      expect(guard.blocked).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('restore devolve o connect original (o guarda não vaza para o resto do processo)', () => {
    const connect = (): unknown =>
      Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect')?.value as unknown;
    const original = connect();
    guard = installNetworkGuard();
    expect(connect()).not.toBe(original);
    guard.restore();
    expect(connect()).toBe(original);
  });
});

// A lista branca do arena:retroativo e do operador (ADR 0038). Só a DECISÃO do guarda e um fetch falso por baixo: nenhum teste abre conexão
// para fora (a guarda de rede dos testes registraria).
describe('installNetworkGuard com lista branca: o retroativo só fala com as fontes dele', () => {
  it('os quatro hosts do retroativo e o loopback passam; example.com e os parecidos não', () => {
    expect([...RETRO_HOSTS].sort()).toEqual([
      'api.bcb.gov.br',
      'brapi.dev',
      'dados.cvm.gov.br',
      'openrouter.ai',
    ]);
    for (const host of [
      ...RETRO_HOSTS,
      'OpenRouter.AI',
      'brapi.dev.',
      'localhost',
      '127.0.0.1',
      '::1',
    ]) {
      expect(isAllowedHost(host, RETRO_HOSTS), host).toBe(true);
    }
    for (const host of [
      'example.com',
      'icons.brapi.dev',
      'evil-brapi.dev',
      'brapi.dev.example.com',
      'openrouter.ai.example.com',
      'www.infomoney.com.br',
      '93.184.216.34',
      '',
    ]) {
      expect(isAllowedHost(host, RETRO_HOSTS), host).toBe(false);
    }
    // sem lista (o ensaio), nada de fora passa
    expect(isAllowedHost('openrouter.ai')).toBe(false);
  });

  it('o fetch de um host da lista segue para o fetch de baixo; o de fora é bloqueado, anotado e avisado', async () => {
    const original = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (input: string | URL | Request) => {
      seen.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(new Response('ok'));
    };
    const warned: string[] = [];
    try {
      guard = installNetworkGuard({ allow: RETRO_HOSTS, onBlocked: (entry) => warned.push(entry) });
      expect(await (await fetch('https://brapi.dev/api/quote/list')).text()).toBe('ok');
      await expect(fetch('https://example.com/x?token=segredo')).rejects.toThrow(/rede bloqueada/);
      expect(seen).toEqual(['https://brapi.dev/api/quote/list']);
      expect(guard.blocked).toEqual(['fetch https://example.com/x']);
      expect(warned).toEqual(['fetch https://example.com/x']);
    } finally {
      guard?.restore();
      guard = undefined;
      globalThis.fetch = original;
    }
  });

  it('a conexão TCP para fora da lista falha antes de resolver o nome, e o loopback continua passando', () => {
    guard = installNetworkGuard({ allow: RETRO_HOSTS });
    expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow(/rede bloqueada/);
    expect(guard.blocked).toEqual(['tcp example.com:443']);
  });
});
