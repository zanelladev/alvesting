import { llmDecisionSchema, type ParseResult } from '@alvesting/contracts';
import { z } from 'zod';

// As mensagens que vão ao modelo (plano 10; docs/ARENA.md). O prompt (texto secreto) vai SOZINHO no papel de sistema, em
// outro lugar do código. Aqui está o turno do usuário: o briefing e a parte própria do competidor, como DADO delimitado,
// nunca concatenados ao prompt.

export interface DataBlock {
  name: 'BRIEFING' | 'CARTEIRA';
  // os bytes exatos do bloco (JSON canônico) e o SHA-256 deles
  bytes: Buffer;
  sha256: string;
}

// [[NOME sha256=<hash>]] ... [[/NOME sha256=<hash>]]. O hash do marcador é o do conteúdo de dentro, que o texto de terceiro
// (uma notícia) não pode conhecer antes de existir: nenhum conteúdo consegue escrever o marcador que fecha o próprio bloco.
// Quem tem o Blob confere o que o modelo viu: o conteúdo entre os marcadores tem o SHA-256 que está no marcador.
export function userMessage(blocks: readonly DataBlock[]): string {
  return blocks
    .map(
      (b) =>
        `[[${b.name} sha256=${b.sha256}]]\n${b.bytes.toString('utf8')}\n[[/${b.name} sha256=${b.sha256}]]`,
    )
    .join('\n\n');
}

// Só o código da regra e o caminho do campo, nunca a mensagem do Zod nem o valor: a mensagem de "chave desconhecida" repete a
// chave que o modelo escreveu, e o reparo não pode devolver texto do modelo como se fosse nosso. O mesmo vale para o motivo
// que fica gravado no item descartado (decision_item.drop_detail).
const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,40}$/;
const MAX_ISSUES = 8;
const FORMAT_REQUEST =
  'Responda de novo somente com o objeto JSON no formato pedido, sem texto antes ou depois e sem cerca de código.';

// O caminho do campo (ex.: decisions.2.ticker). Segmento com texto livre (uma chave inventada pelo modelo) vira "?".
export const safeIssuePath = (path: ReadonlyArray<PropertyKey>): string =>
  path
    .map((segment) =>
      typeof segment === 'number' || SAFE_SEGMENT.test(String(segment)) ? String(segment) : '?',
    )
    .join('.');

export function repairMessage(failure: Exclude<ParseResult<unknown>, { success: true }>): string {
  if (failure.reason === 'invalid_json') {
    return `Sua resposta anterior não é um JSON válido. ${FORMAT_REQUEST}`;
  }
  const shown = failure.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${safeIssuePath(issue.path) || '(raiz)'} (${issue.code})`);
  const more =
    failure.issues.length > MAX_ISSUES ? `, e mais ${failure.issues.length - MAX_ISSUES}` : '';
  return `Sua resposta anterior não segue o formato pedido. Problemas: ${shown.join('; ')}${more}. ${FORMAT_REQUEST}`;
}

// O formato que pedimos aos provedores com saída estruturada. É o do contrato (ADR 0016), sem o $schema, que alguns
// provedores recusam. Quem decide o que vale é o parseLlmDecision, não o provedor.
const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(llmDecisionSchema) as Record<
  string,
  unknown
>;
export const decisionJsonSchema: Record<string, unknown> = jsonSchema;
