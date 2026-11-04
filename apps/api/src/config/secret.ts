import { inspect } from 'node:util';

// Valor secreto do ambiente (o prompt da arena e a chave do OpenRouter). O texto fica num campo privado: não aparece em
// JSON.stringify, em template string, em util.inspect, no spread nem no Object.values. Para usar, `reveal()`, e só no ponto
// que precisa (montar a mensagem de sistema, o cabeçalho de autorização). Um `logger.log(env)` descuidado não vaza nada.
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[segredo]';
  }

  toJSON(): string {
    return '[segredo]';
  }

  [inspect.custom](): string {
    return '[segredo]';
  }
}
