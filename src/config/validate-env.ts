/**
 * Startup checks for production configuration. Pure (takes a plain record) so it can be unit tested.
 * `errors` stop the server from starting; `warnings` are logged and should be read.
 */
export interface EnvCheck {
  errors: string[];
  warnings: string[];
}

const PLACEHOLDER = /your-|change-?me|secret-min|example|placeholder/i;

export function parseTrustProxy(value: string): boolean | number | string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'false') return false;
  if (trimmed === 'true') return true;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  return trimmed; // e.g. "loopback" or "10.0.0.0/8, loopback"
}

export function checkEnv(source: Record<string, string | undefined>): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = (source['NODE_ENV'] || 'development') === 'production';

  if (!source['DATABASE_URL']) errors.push('DATABASE_URL is not set.');
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = source[key] ?? '';
    if (!value) errors.push(`${key} is not set.`);
    else if (production && (value.length < 32 || PLACEHOLDER.test(value))) {
      errors.push(`${key} must be a random string of at least 32 characters (not the example value).`);
    }
  }
  if (production && source['JWT_ACCESS_SECRET'] && source['JWT_ACCESS_SECRET'] === source['JWT_REFRESH_SECRET']) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
  }
  if (production && /user:pass@/.test(source['DATABASE_URL'] ?? '')) {
    errors.push('DATABASE_URL still contains the example credentials.');
  }

  if (production) {
    const proxy = parseTrustProxy(source['TRUST_PROXY'] ?? '');
    if (proxy === false) {
      warnings.push(
        'TRUST_PROXY is not set. Behind a reverse proxy every user then shares the proxy IP, so a few failed logins can lock everyone out. Set it to the number of proxies (e.g. 1).',
      );
    } else if (proxy === true) {
      warnings.push('TRUST_PROXY=true trusts every hop; clients can fake their IP. Prefer a hop count such as 1.');
    }
    if (!source['PUBLIC_BASE_URL']) warnings.push('PUBLIC_BASE_URL is not set: customers will not get receipt links.');
    if (!source['METRICS_TOKEN']) warnings.push('METRICS_TOKEN is not set: /metrics is disabled (no Grafana metrics).');
    if (/localhost|127\.0\.0\.1/.test(source['FRONTEND_ORIGIN'] ?? 'http://localhost')) {
      warnings.push('FRONTEND_ORIGIN still points at localhost.');
    }
    if (source['DOCS_ENABLED'] === 'true')
      warnings.push('DOCS_ENABLED=true: the developer docs are reachable in production.');
  }

  return { errors, warnings };
}
