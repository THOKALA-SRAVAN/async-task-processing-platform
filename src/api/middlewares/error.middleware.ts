import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from '../../lib/logger';

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,     // required 4th param for Express to treat this as error handler
): void {
  // Prisma: record not found on update/delete
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    res.status(404).json({ error: { message: 'Resource not found' } });
    return;
  }

  // Prisma: unique constraint violation (idempotency key race not caught in service)
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: { message: 'Resource already exists' } });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  const stack   = err instanceof Error ? err.stack   : undefined;

  logger.error(
    { correlationId: req.correlationId, method: req.method, path: req.path, error: message, stack },
    'Unhandled error',
  );

  res.status(500).json({ error: { message: 'Internal server error' } });
}
