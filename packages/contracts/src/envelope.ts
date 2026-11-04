import { z } from 'zod';

export const errorBodySchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export type Success<T> = { success: true; data: T; error: null };
export type Failure = { success: false; data: null; error: ErrorBody };
export type Envelope<T> = Success<T> | Failure;

export const ok = <T>(data: T): Success<T> => ({ success: true, data, error: null });

export const fail = (code: string, message: string, details?: unknown): Failure => ({
  success: false,
  data: null,
  error: details === undefined ? { code, message } : { code, message, details },
});

// Toda resposta da API (inclusive /health) usa este envelope: { success, data, error }.
export const envelopeSchema = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), data, error: z.null() }),
    z.object({ success: z.literal(false), data: z.null(), error: errorBodySchema }),
  ]);
