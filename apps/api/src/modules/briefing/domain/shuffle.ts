import { createHash } from 'node:crypto';

// A tabela do universo vai para os modelos em ordem embaralhada, com a semente do pregão, igual para todos (plano 2 e
// 10): a ordem de volume (ou a alfabética) viciaria a atenção do modelo nas primeiras linhas. A regra é pública e
// conferível por qualquer um: a posição de cada item é a ordem do SHA-256 de "<semente>:<chave>". Não depende da
// ordem em que a lista chega, não guarda estado e não tem gerador de números pseudoaleatórios.
export function shuffleBySeed<T>(items: readonly T[], seed: string, key: (item: T) => string): T[] {
  return items
    .map((item) => {
      const id = key(item);
      return { item, id, order: createHash('sha256').update(`${seed}:${id}`).digest('hex') };
    })
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map((entry) => entry.item);
}
