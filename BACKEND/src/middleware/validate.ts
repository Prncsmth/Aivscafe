import type { z, ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors';

function parseWith<S extends ZodTypeAny>(schema: S, data: unknown, where: string): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Invalid ${where}`,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const parseBody = <S extends ZodTypeAny>(schema: S, data: unknown) => parseWith(schema, data, 'request body');
export const parseQuery = <S extends ZodTypeAny>(schema: S, data: unknown) => parseWith(schema, data, 'query parameters');
export const parseParams = <S extends ZodTypeAny>(schema: S, data: unknown) => parseWith(schema, data, 'route parameters');
