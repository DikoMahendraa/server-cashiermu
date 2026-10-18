import dotenv from 'dotenv';
dotenv.config();

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET!,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  // Public origin of this API, used to build receipt links shared with customers (https://api.example.com)
  // Empty in production = links are not offered (better than handing customers a localhost URL).
  PUBLIC_BASE_URL:
    process.env.PUBLIC_BASE_URL || (isProduction ? '' : `http://localhost:${process.env.PORT || '3000'}`),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'http://localhost:8081',
  MAX_LOGIN_ATTEMPTS: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
  LOGIN_LOCKOUT_MINUTES: parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '5', 10),
  // Developer docs site at /docs: on in development, off in production unless DOCS_ENABLED=true.
  // When enabled in production a DOCS_PASSWORD is required (HTTP Basic auth, user = DOCS_USER).
  DOCS_ENABLED: process.env.DOCS_ENABLED ? process.env.DOCS_ENABLED === 'true' : !isProduction,
  DOCS_USER: process.env.DOCS_USER || 'docs',
  DOCS_PASSWORD: process.env.DOCS_PASSWORD || '',
  // How many reverse proxies sit in front of the API (nginx, Cloudflare, a PaaS router…): `1`, `2`, … or `loopback`.
  // Needed so rate limits and login lockouts see each client's own IP instead of the proxy's. Leave empty when the API
  // is reached directly. Never `true` unless you control every hop (clients could then fake their IP).
  TRUST_PROXY: process.env.TRUST_PROXY || '',
  // Bearer token Prometheus/Alloy must send to GET /metrics. Empty = /metrics is disabled in production.
  METRICS_TOKEN: process.env.METRICS_TOKEN || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  // Also write JSON logs to this file (for Grafana Alloy / Loki to tail). Console logging always stays on.
  LOG_FILE: process.env.LOG_FILE || '',
};
