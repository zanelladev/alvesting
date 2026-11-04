import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ValidationException extends BadRequestException {
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super('Entrada inválida');
  }
}

// Uso: @Body(new ZodValidationPipe(schema)) body. Vale também para @Param e @Query.
// O filtro global transforma ValidationException em 400 VALIDATION_ERROR com os caminhos dos campos.
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new ValidationException(result.error.issues);
    return result.data;
  }
}
