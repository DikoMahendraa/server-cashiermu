import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env';
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
import { createDocsRouter, decideDocsMount } from './modules/docs/docs.routes';
import { DOCS_BASE_PATH } from './modules/docs/docs.pages';

const app = express();

app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/store', storeRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/branches', branchesRoutes);
app.use('/api/v1/categories', categoriesRoutes);
app.use('/api/v1/products', productsRoutes);
app.use('/api/v1/shifts', shiftsRoutes);
app.use('/api/v1/transactions', transactionsRoutes);
app.use('/api/v1/pending-bills', pendingBillsRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/discounts', discountsRoutes);
app.use('/api/v1/sectors', sectorsRoutes);

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
