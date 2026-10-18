import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../utils/app-error';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res
      .status(err.status)
      .json({ code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }

  const requestId: string | undefined = res.locals['requestId'];
  logger.error('unhandled error', {
    requestId,
    error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
  });

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ message: 'A record with this value already exists' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ message: 'Record not found' });
      return;
    }
  }

  // Never hand internals (SQL, file paths, library messages) to a client in production; the request id lets
  // the owner of the server find the real cause in the logs.
  const message = env.NODE_ENV !== 'production' && err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ code: 'INTERNAL_ERROR', message, ...(requestId ? { requestId } : {}) });
}
