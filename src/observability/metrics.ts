import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import client from 'prom-client';
import prisma from '../config/database';
import { env } from '../config/env';

/** Everything Grafana shows about the API comes from this registry (GET /metrics, Prometheus text format). */
export const registry = new client.Registry();
registry.setDefaultLabels({ service: 'cashiermu-api' });
client.collectDefaultMetrics({ register: registry }); // CPU, memory, event loop lag, GC, …

export const httpDuration = new client.Histogram({
  name: 'cashiermu_http_request_duration_seconds',
  help: 'HTTP request duration by method, route pattern and status code',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const checkoutTotal = new client.Counter({
  name: 'cashiermu_checkout_total',
  help: 'Checkout attempts. channel=offline are sales that were rung up offline and synced later',
  labelNames: ['result', 'channel', 'code'] as const,
  registers: [registry],
});

export const checkoutReplays = new client.Counter({
  name: 'cashiermu_checkout_replays_total',
  help: 'Checkouts answered from an earlier identical request (idempotency key)',
  registers: [registry],
});

export const offlineIssuesTotal = new client.Counter({
  name: 'cashiermu_offline_issues_total',
  help: 'Things flagged on synced offline sales for the owner to check',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const loginTotal = new client.Counter({
  name: 'cashiermu_login_total',
  help: 'Login attempts by result (success, invalid_credentials, locked)',
  labelNames: ['result'] as const,
  registers: [registry],
});

new client.Gauge({
  name: 'cashiermu_db_up',
  help: '1 when the database answers a trivial query, 0 otherwise (checked on every scrape)',
  registers: [registry],
  async collect() {
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      this.set(1);
    } catch {
      this.set(0);
    }
  },
});

/**
 * The route as written in the code (`/api/v1/transactions/:id`), never the real URL: real URLs contain ids and
 * tokens, which would explode the number of metric series and leak into logs.
 */
export function routeLabel(req: Request): string {
  const path = req.route?.path;
  if (typeof path !== 'string') return 'unmatched';
  return `${req.baseUrl}${path === '/' ? '' : path}` || '/';
}

const UNTRACKED = new Set(['/metrics', '/health']);

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (UNTRACKED.has(req.path)) {
    next();
    return;
  }
  const end = httpDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: routeLabel(req), status: String(res.statusCode) }));
  next();
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** GET /metrics: needs `Authorization: Bearer <METRICS_TOKEN>`; with no token configured it is only open outside production. */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
  if (env.METRICS_TOKEN) {
    const provided = /^Bearer (.+)$/.exec(req.header('authorization') ?? '')?.[1] ?? '';
    if (!tokenMatches(provided, env.METRICS_TOKEN)) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
  } else if (env.NODE_ENV === 'production') {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.setHeader('Content-Type', registry.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.send(await registry.metrics());
}
