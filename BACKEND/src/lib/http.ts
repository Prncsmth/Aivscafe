import type { Response } from 'express';

/** Consistent success envelope: { success: true, data, meta? } */
export function ok<T>(res: Response, data: T, status = 200, meta?: Record<string, unknown>) {
  return res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
}

export function paginate(query: { page?: number; pageSize?: number }) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}
