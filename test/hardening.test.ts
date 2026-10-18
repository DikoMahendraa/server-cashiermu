import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } }));
import { checkEnv, parseTrustProxy } from '../src/config/validate-env';
import { env } from '../src/config/env';
import { errorHandler } from '../src/middleware/errorHandler';
import { LoginGuard } from '../src/modules/auth/login-guard';
import { metricsHandler, routeLabel } from '../src/observability/metrics';
import { AppError } from '../src/utils/app-error';

const good = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:s3cret@db.internal:5432/cashiermu',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  TRUST_PROXY: '1',
  PUBLIC_BASE_URL: 'https://api.example.com',
  METRICS_TOKEN: 'token',
  FRONTEND_ORIGIN: 'https://app.example.com',
};

describe('checkEnv', () => {
  it('accepts a complete production configuration without warnings', () => {
    expect(checkEnv(good)).toEqual({ errors: [], warnings: [] });
  });

  it('refuses weak, example or identical secrets and example database credentials in production', () => {
    const errors = checkEnv({
      ...good,
      JWT_ACCESS_SECRET: 'your-access-secret-min-32-chars-here',
      JWT_REFRESH_SECRET: 'short',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cashiermu',
    }).errors;
    expect(errors).toHaveLength(3);
    expect(checkEnv({ ...good, JWT_REFRESH_SECRET: good.JWT_ACCESS_SECRET }).errors).toEqual([
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.',
    ]);
  });

  it('only insists on secrets existing in development', () => {
    expect(
      checkEnv({ NODE_ENV: 'development', DATABASE_URL: 'x', JWT_ACCESS_SECRET: 'dev', JWT_REFRESH_SECRET: 'dev2' })
        .errors,
    ).toEqual([]);
    expect(checkEnv({ NODE_ENV: 'development' }).errors).toHaveLength(3);
  });

  it('warns about the settings that bite later', () => {
    const warnings = checkEnv({
      ...good,
      TRUST_PROXY: '',
      PUBLIC_BASE_URL: '',
      METRICS_TOKEN: '',
      FRONTEND_ORIGIN: 'http://localhost:8081',
      DOCS_ENABLED: 'true',
    }).warnings;
    expect(warnings).toHaveLength(5);
    expect(checkEnv({ ...good, TRUST_PROXY: 'true' }).warnings[0]).toMatch(/fake their IP/);
  });
});

describe('parseTrustProxy', () => {
  it('turns the env value into what Express expects', () => {
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});

describe('LoginGuard', () => {
  const make = () => {
    let now = 1_000_000;
    const guard = new LoginGuard({
      maxAttempts: 3,
      lockoutMs: 60_000,
      windowMs: 120_000,
      maxEntries: 5,
      now: () => now,
    });
    return { guard, advance: (ms: number) => (now += ms) };
  };

  it('locks after the allowed failures and unlocks after the lockout', () => {
    const { guard, advance } = make();
    guard.recordFailure('a');
    guard.recordFailure('a');
    expect(guard.lockedFor('a')).toBe(0);
    guard.recordFailure('a');
    expect(guard.lockedFor('a')).toBe(60_000);
    advance(30_000);
    expect(guard.lockedFor('a')).toBe(30_000);
    advance(30_001);
    expect(guard.lockedFor('a')).toBe(0);
  });

  it('keeps keys independent and forgets old failures', () => {
    const { guard, advance } = make();
    guard.recordFailure('a');
    guard.recordFailure('a');
    guard.recordFailure('b');
    advance(200_000); // outside the window
    guard.recordFailure('a'); // counts as the first again
    guard.recordFailure('a');
    expect(guard.lockedFor('a')).toBe(0);
    guard.recordFailure('a');
    expect(guard.lockedFor('a')).toBeGreaterThan(0);
    expect(guard.lockedFor('b')).toBe(0);
  });

  it('a success clears the count', () => {
    const { guard } = make();
    guard.recordFailure('a');
    guard.recordFailure('a');
    guard.clear('a');
    guard.recordFailure('a');
    expect(guard.lockedFor('a')).toBe(0);
  });

  it('does not grow without bound', () => {
    const { guard, advance } = make();
    for (let i = 0; i < 4; i++) guard.recordFailure(`old-${i}`);
    advance(300_000);
    for (let i = 0; i < 4; i++) guard.recordFailure(`new-${i}`); // size passes maxEntries → sweep drops the old ones
    expect(guard.size).toBeLessThanOrEqual(5);
  });
});

const fakeRes = (requestId?: string) => {
  const res: any = { locals: requestId ? { requestId } : {}, statusCode: 0, body: undefined };
  res.status = vi.fn((code: number) => ((res.statusCode = code), res));
  res.json = vi.fn((body: unknown) => ((res.body = body), res));
  res.send = vi.fn((body: unknown) => ((res.body = body), res));
  res.setHeader = vi.fn();
  return res;
};

describe('errorHandler', () => {
  const original = env.NODE_ENV;
  const withEnv = (value: string, fn: () => void) => {
    (env as { NODE_ENV: string }).NODE_ENV = value;
    try {
      fn();
    } finally {
      (env as { NODE_ENV: string }).NODE_ENV = original;
    }
  };

  it('passes AppError through untouched', () => {
    const res = fakeRes();
    errorHandler(new AppError(422, 'NOPE', 'Tidak boleh', { a: 1 }), {} as any, res, vi.fn());
    expect([res.statusCode, res.body]).toEqual([422, { code: 'NOPE', message: 'Tidak boleh', details: { a: 1 } }]);
  });

  it('hides internals in production but keeps a request id to find them in the logs', () => {
    withEnv('production', () => {
      const res = fakeRes('req-12345678');
      errorHandler(new Error('relation "Transaction" does not exist at /srv/app/db.js:12'), {} as any, res, vi.fn());
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: 'req-12345678' });
    });
  });

  it('is more helpful while developing', () => {
    withEnv('development', () => {
      const res = fakeRes();
      errorHandler(new Error('boom'), {} as any, res, vi.fn());
      expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR', message: 'boom' });
    });
  });
});

describe('metrics', () => {
  it('labels routes by pattern, never by real URL', () => {
    expect(routeLabel({ baseUrl: '/api/v1/transactions', route: { path: '/:id/job' } } as any)).toBe(
      '/api/v1/transactions/:id/job',
    );
    expect(routeLabel({ baseUrl: '/api/v1/products', route: { path: '/' } } as any)).toBe('/api/v1/products');
    expect(routeLabel({ baseUrl: '', route: undefined } as any)).toBe('unmatched');
  });

  it('/metrics needs the bearer token, and does not exist in production without one', async () => {
    const original = { token: env.METRICS_TOKEN, nodeEnv: env.NODE_ENV };
    const req = (authorization?: string) =>
      ({ header: (name: string) => (name === 'authorization' ? authorization : undefined) }) as any;
    try {
      (env as { METRICS_TOKEN: string }).METRICS_TOKEN = 'secret-token';
      let res = fakeRes();
      await metricsHandler(req(), res);
      expect(res.statusCode).toBe(401);
      res = fakeRes();
      await metricsHandler(req('Bearer wrong-token'), res);
      expect(res.statusCode).toBe(401);

      (env as { METRICS_TOKEN: string }).METRICS_TOKEN = '';
      (env as { NODE_ENV: string }).NODE_ENV = 'production';
      res = fakeRes();
      await metricsHandler(req(), res);
      expect(res.statusCode).toBe(404);
    } finally {
      (env as { METRICS_TOKEN: string }).METRICS_TOKEN = original.token;
      (env as { NODE_ENV: string }).NODE_ENV = original.nodeEnv;
    }
  });
});
