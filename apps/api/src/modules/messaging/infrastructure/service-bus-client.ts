import { DefaultAzureCredential } from '@azure/identity';
import { ServiceBusClient } from '@azure/service-bus';
import type { Env } from '../../../config/env.js';
import { FakeServiceBus } from './fake-service-bus.js';

// Emulador e CI entram por connection string. Na Azure não há chave (o namespace tem disableLocalAuth): entra pelo
// endereço do namespace com a identidade gerenciada, que o DefaultAzureCredential acha sozinho (o AZURE_CLIENT_ID
// aponta a identidade do próprio workload; docs/INFRA.md, 2.7). Sem nenhuma das duas, o Service Bus fica desligado.
// SERVICEBUS_FAKE_DIR liga o Service Bus falso do e2e (a DLQ e a publicação numa pasta, fake-service-bus.ts): vence as outras duas e, em
// produção, o app RECUSA SUBIR com ela, como com o EMAIL_OUTBOX_DIR: um falso nunca pode falar no lugar do de verdade.
export function createServiceBusClient(
  env: Pick<Env, 'SERVICEBUS_CONNECTION_STRING' | 'SERVICEBUS_FQDN' | 'SERVICEBUS_FAKE_DIR'> & {
    NODE_ENV?: Env['NODE_ENV'];
  },
): ServiceBusClient | undefined {
  if (env.SERVICEBUS_FAKE_DIR) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'SERVICEBUS_FAKE_DIR não existe em produção: o Service Bus falso é só do e2e e dos testes',
      );
    }
    // ponytail: o cast duplo vale porque o MessagingService só usa createSender, createReceiver e close, e o fake cobre só a publicação e a
    // DLQ (o fake-service-bus.spec.ts exercita exatamente isso). O teto: uma chamada nova do MessagingService ao SDK passa no tsc e falha
    // no teste. A saída: tipar a dependência do MessagingService com `Pick<ServiceBusClient, 'createSender' | 'createReceiver' | 'close'>`
    // e fazer o fake implementar essa interface, sem o cast.
    return new FakeServiceBus(env.SERVICEBUS_FAKE_DIR) as unknown as ServiceBusClient;
  }
  if (env.SERVICEBUS_CONNECTION_STRING)
    return new ServiceBusClient(env.SERVICEBUS_CONNECTION_STRING);
  if (env.SERVICEBUS_FQDN)
    return new ServiceBusClient(env.SERVICEBUS_FQDN, new DefaultAzureCredential());
  return undefined;
}
