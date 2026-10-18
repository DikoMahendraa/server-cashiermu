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
};
