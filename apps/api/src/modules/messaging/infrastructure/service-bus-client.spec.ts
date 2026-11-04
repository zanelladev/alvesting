import { describe, expect, it } from 'vitest';
import { createServiceBusClient } from './service-bus-client.js';

const emulator =
  'Endpoint=sb://localhost:25672;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=SAS_KEY_VALUE;UseDevelopmentEmulator=true;';

// O cliente do SDK só abre conexão no primeiro sender ou receiver: criar não toca a rede nem a Azure.
describe('createServiceBusClient', () => {
  it('na Azure, entra pelo namespace com a identidade gerenciada (SERVICEBUS_FQDN), sem chave', () => {
    const client = createServiceBusClient({
      SERVICEBUS_FQDN: 'sb-alvesting.servicebus.windows.net',
    });
    expect(client?.fullyQualifiedNamespace).toBe('sb-alvesting.servicebus.windows.net');
  });

  it('no emulador e no CI, entra pela connection string', () => {
    const client = createServiceBusClient({ SERVICEBUS_CONNECTION_STRING: emulator });
    expect(client?.fullyQualifiedNamespace).toBe('localhost');
  });

  it('a connection string vence o namespace quando as duas existem', () => {
    const client = createServiceBusClient({
      SERVICEBUS_CONNECTION_STRING: emulator,
      SERVICEBUS_FQDN: 'sb-alvesting.servicebus.windows.net',
    });
    expect(client?.fullyQualifiedNamespace).toBe('localhost');
  });

  it('sem nenhuma das duas o Service Bus fica desligado', () => {
    expect(createServiceBusClient({})).toBeUndefined();
  });
});
