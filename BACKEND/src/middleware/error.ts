import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}

/** Centralised error handler — consistent { success: false, error } envelope. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists', details: err.meta },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Record not found' } });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({
        success: false,
        error: { code: 'IN_USE', message: 'This record is referenced by other records and cannot be changed this way' },
      });
    }
  }

  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }

  console.error('[unhandled]', err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
