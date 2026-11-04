import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUEUES } from '@alvesting/contracts';

// O Config.json do emulador e a tabela do plano (5.5) não podem divergir: o teste de integração
// confia que o emulador tem as mesmas filas e os mesmos limites de entrega que os contratos.
type EmulatorConfig = {
  UserConfig: {
    Namespaces: Array<{
      Name: string;
      Queues: Array<{ Name: string; Properties: Record<string, unknown> }>;
      Topics?: unknown[];
    }>;
  };
};

const config = JSON.parse(
  readFileSync(new URL('../../../../../../docker/servicebus/Config.json', import.meta.url), 'utf8'),
) as EmulatorConfig;
const namespace = config.UserConfig.Namespaces[0]!;

describe('docker/servicebus/Config.json', () => {
  it('tem um único namespace e nenhum tópico (o plano usa só filas)', () => {
    expect(config.UserConfig.Namespaces).toHaveLength(1);
    expect(namespace.Topics ?? []).toHaveLength(0);
  });

  it('declara exatamente as 6 filas do plano', () => {
    expect(namespace.Queues.map((q) => q.Name).sort()).toEqual(Object.keys(QUEUES).sort());
  });

  it.each(Object.entries(QUEUES))('fila %s usa %j', (name, expected) => {
    const properties = namespace.Queues.find((q) => q.Name === name)!.Properties;
    expect(properties.MaxDeliveryCount).toBe(expected.maxDeliveryCount);
  });

  it('a trava é de 1 min em toda fila; o que passar disso a renovação automática cobre (lockRenewalMs)', () => {
    // O Bicep (infra/modules/servicebus.bicep) usa os mesmos PT1M. Handler lento sem renovação = mensagem
    // entregue em dobro, ver messaging.service.ts.
    for (const queue of namespace.Queues) {
      expect(queue.Properties.LockDuration, queue.Name).toBe('PT1M');
    }
  });

  it('imita o tier Basic: sem sessão nem detecção de duplicata, e DLQ também na expiração', () => {
    for (const queue of namespace.Queues) {
      expect(queue.Properties.RequiresSession, queue.Name).toBe(false);
      expect(queue.Properties.RequiresDuplicateDetection, queue.Name).toBe(false);
      expect(queue.Properties.DeadLetteringOnMessageExpiration, queue.Name).toBe(true);
    }
  });
});
