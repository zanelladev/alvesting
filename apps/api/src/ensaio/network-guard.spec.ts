import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { installNetworkGuard, type NetworkGuard } from './network-guard.js';

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
