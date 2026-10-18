import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { routeLabel } from '../observability/metrics';
import { logger } from '../utils/logger';

const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const QUIET = new Set(['/health', '/metrics']);

/**
 * Gives every request an id (X-Request-Id header, also in the logs and in 500 responses, so "what went wrong at 14:03?"
 * can be answered) and writes one structured log line when it finishes. It logs the route pattern, never the URL,
 * query string or body: those can contain tokens, names and phone numbers.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.locals['requestId'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    if (QUIET.has(req.path)) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger.log(level, 'request', {
      requestId,
      method: req.method,
      route: routeLabel(req),
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: req.user?.userId,
      storeId: req.user?.storeId,
    });
  });
  next();
}
