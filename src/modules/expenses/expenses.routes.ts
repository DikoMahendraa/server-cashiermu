import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import * as expensesController from './expenses.controller';
import { createExpenseSchema, updateExpenseSchema } from './expenses.schema';

const router = Router();

// Expenses and net profit are owner-only
router.use(authenticate, requireRole('owner'));

router.get('/', expensesController.listExpenses);
router.post('/', validate(createExpenseSchema), expensesController.createExpense);
router.patch('/:id', validate(updateExpenseSchema), expensesController.updateExpense);
router.delete('/:id', expensesController.deleteExpense);

export default router;
