import { BadRequestException, NotFoundException, ParseIntPipe } from '@nestjs/common';
import type { z } from 'zod';

/** Zod-validates a body or query; 400 names the offending fields, never echoes values. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new BadRequestException({ message: 'invalid input', fields: r.error.issues.map((i) => i.path.join('.') || 'body') });
  return r.data;
}

export const IdParam = new ParseIntPipe({ exceptionFactory: () => new NotFoundException() });

export const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d.toString()));
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
