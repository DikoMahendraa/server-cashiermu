import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { createTransactionSchema, updateJobSchema, voidTransactionSchema } from './transactions.schema';
import * as transactionsController from './transactions.controller';

const router = Router();

router.post('/', authenticate, validate(createTransactionSchema), transactionsController.createTransaction);
router.get('/', authenticate, transactionsController.listTransactions);
router.get('/:id', authenticate, transactionsController.getTransaction);
router.patch('/:id/job', authenticate, validate(updateJobSchema), transactionsController.updateJob);
router.post('/:id/receipt-link', authenticate, transactionsController.getReceiptLink);
router.post(
  '/:id/void',
  authenticate,
  requireRole('owner'),
  validate(voidTransactionSchema),
  transactionsController.voidTransaction,
);

export default router;
