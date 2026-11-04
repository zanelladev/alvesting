import { z } from 'zod';
import { envelopeSchema } from './envelope.js';

export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.enum(['api', 'web']),
});
export type Health = z.infer<typeof healthSchema>;

export const healthResponseSchema = envelopeSchema(healthSchema);
