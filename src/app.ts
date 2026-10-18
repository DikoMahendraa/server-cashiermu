import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { checkEnv, parseTrustProxy } from './config/validate-env';
import { metricsHandler, metricsMiddleware } from './observability/metrics';
import { requestContext } from './middleware/requestContext';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

import authRoutes from './modules/auth/auth.routes';
import storeRoutes from './modules/store/store.routes';
import usersRoutes from './modules/users/users.routes';
import branchesRoutes from './modules/branches/branches.routes';
import categoriesRoutes from './modules/categories/categories.routes';
import productsRoutes from './modules/products/products.routes';
import shiftsRoutes from './modules/shifts/shifts.routes';
import transactionsRoutes from './modules/transactions/transactions.routes';
import pendingBillsRoutes from './modules/pending-bills/pending-bills.routes';
import reportsRoutes from './modules/reports/reports.routes';
import discountsRoutes from './modules/discounts/discounts.routes';
import sectorsRoutes from './modules/sectors/sectors.routes';
import expensesRoutes from './modules/expenses/expenses.routes';
import receiptRoutes from './modules/receipts/receipt.routes';
import { createDocsRouter, decideDocsMount } from './modules/docs/docs.routes';
import { DOCS_BASE_PATH } from './modules/docs/docs.pages';

// Refuse to start with a broken production configuration (example secrets, no database…); log the risky-but-legal ones.
const envCheck = checkEnv(process.env);
envCheck.warnings.forEach(warning => logger.warn(warning));
if (envCheck.errors.length > 0) {
  envCheck.errors.forEach(error => logger.error(error));
  process.exit(1);
}

const app = express();

app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
// The API only speaks JSON, and the docs/receipt pages set their own Content-Security-Policy, so helmet's CSP is off.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(requestContext);
app.use(metricsMiddleware);
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
// Import files (up to 500 rows) are bigger than the 100kb default, so give just those routes more room.
// Must come before the global parser, which would otherwise reject them first.
app.use('/api/v1/products/import', express.json({ limit: '2mb' }));
app.use(express.json());

// Prometheus / Grafana Alloy scrape this; protected by METRICS_TOKEN (see docs/13-monitoring.md)
app.get('/metrics', metricsHandler);
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/store', storeRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/branches', branchesRoutes);
app.use('/api/v1/categories', categoriesRoutes);
app.use('/api/v1/products', productsRoutes);
app.use('/api/v1/shifts', shiftsRoutes);
app.use('/api/v1/transactions', transactionsRoutes);
app.use('/api/v1/expenses', expensesRoutes);
app.use('/api/v1/pending-bills', pendingBillsRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/discounts', discountsRoutes);
app.use('/api/v1/sectors', sectorsRoutes);
app.use('/r', receiptRoutes);

const docs = decideDocsMount({
  enabled: env.DOCS_ENABLED,
  isProduction: env.NODE_ENV === 'production',
  password: env.DOCS_PASSWORD,
});
if (docs.mount) {
  app.use(
    DOCS_BASE_PATH,
    createDocsRouter({ user: env.DOCS_USER, password: env.DOCS_PASSWORD, cache: env.NODE_ENV === 'production' }),
  );
} else if (docs.reason) {
  logger.warn(docs.reason);
}

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`CashierMu API running on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

export default app;
