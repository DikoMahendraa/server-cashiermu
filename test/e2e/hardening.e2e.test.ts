/**
 * End-to-end: production hardening and the /metrics endpoint against the live local API.
 * The /metrics tests need METRICS_TOKEN in the API's .env (the local .env has one).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { call, e2eEnv } from './helpers';

function metricsToken(): string {
  if (process.env['METRICS_TOKEN']) return process.env['METRICS_TOKEN'];
  try {
    const line = readFileSync(join(__dirname, '../../.env'), 'utf8')
      .split('\n')
      .find(l => l.startsWith('METRICS_TOKEN='));
    return line?.slice('METRICS_TOKEN='.length).trim().replace(/^"|"$/g, '') ?? '';
  } catch {
    return '';
  }
}

const origin = new URL(e2eEnv.url).origin;
const token = metricsToken();

describe('request hygiene', () => {
  it('gives every response a request id and honours a valid incoming one', async () => {
    const generated = await fetch(`${origin}/health`);
    expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await fetch(`${origin}/health`, { headers: { 'X-Request-Id': 'client-supplied-id-1' } });
    expect(echoed.headers.get('x-request-id')).toBe('client-supplied-id-1');
    const hostile = await fetch(`${origin}/health`, { headers: { 'X-Request-Id': 'bad id\twith spaces' } }).catch(
      () => null,
    );
    if (hostile) expect(hostile.headers.get('x-request-id')).not.toBe('bad id\twith spaces');
  });

  it('sends the standard security headers and does not advertise Express', async () => {
    const res = await fetch(`${origin}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-frame-options')).toBeTruthy();
  });

  it('answers unknown routes and bad JSON without leaking internals', async () => {
    const bad = await fetch(`${e2eEnv.url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(await bad.text()).not.toMatch(/node_modules|at .*\.(js|ts):\d+/);
  });
});

describe('check-credential', () => {
  it('only tells the login screen what it needs (no internal ids)', async () => {
    const res = await call('', 'POST', '/auth/check-credential', { credential: e2eEnv.email });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.exists).toBe(true);
    expect(Object.keys(res.data.user).sort()).toEqual(['avatarUrl', 'id', 'name', 'role']);
  });
});

describe('GET /metrics', () => {
  it.skipIf(!token)('is closed without the token and open with it', async () => {
    expect((await fetch(`${origin}/metrics`)).status).toBe(401);
    expect((await fetch(`${origin}/metrics`, { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);

    const ok = await fetch(`${origin}/metrics`, { headers: { Authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/plain');
    const text = await ok.text();
    expect(text).toContain('cashiermu_db_up{service="cashiermu-api"} 1');
    expect(text).toContain('nodejs_eventloop_lag_seconds');
    expect(text).toContain('cashiermu_http_request_duration_seconds_bucket');
  });

  it.skipIf(!token)('labels requests by route pattern, never by real ids', async () => {
    await call('', 'GET', '/transactions/11111111-2222-3333-4444-555555555555'); // 401, but still a matched route
    const text = await (await fetch(`${origin}/metrics`, { headers: { Authorization: `Bearer ${token}` } })).text();
    expect(text).toContain('route="/api/v1/transactions/:id"');
    expect(text).not.toContain('11111111-2222-3333-4444-555555555555');
    expect(text).not.toMatch(/route="[^"]*Bearer/);
  });
});
