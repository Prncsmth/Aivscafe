import { z } from 'zod';

export const IdParams = z.object({ id: z.string().min(1).max(64) });
export const money = z.number().int().min(0).max(100_000_000);
export const positiveMoney = z.number().int().positive().max(100_000_000);
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
/** Decimal quantity accepted as number or numeric string, up to 3 decimals. */
export const quantity = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d{1,3})?$/)])
  .transform((v) => String(v));
export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const unit = z.enum(['G', 'KG', 'ML', 'L', 'PCS']);
export const baseUnit = z.enum(['G', 'ML', 'PCS']);
export const pageQuery = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
};
