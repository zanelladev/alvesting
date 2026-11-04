import type { z } from 'zod';

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; reason: 'invalid_json' }
  | { success: false; reason: 'invalid_schema'; issues: z.core.$ZodIssue[] };

export function safeParseValue<S extends z.ZodType>(
  schema: S,
  value: unknown,
): ParseResult<z.output<S>> {
  const result = schema.safeParse(value);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, reason: 'invalid_schema', issues: result.error.issues };
}

// As issues do Zod trazem caminho e motivo, nunca o valor recebido: dá para logar sem vazar conteúdo.
export function safeParseJson<S extends z.ZodType>(
  schema: S,
  text: string,
): ParseResult<z.output<S>> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { success: false, reason: 'invalid_json' };
  }
  return safeParseValue(schema, value);
}
