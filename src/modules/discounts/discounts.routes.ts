import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { createDiscountSchema, updateDiscountSchema } from './discounts.schema';
import * as ctrl from './discounts.controller';

const router = Router();

router.get('/', authenticate, ctrl.listDiscounts);
router.post('/', authenticate, requireRole('owner'), validate(createDiscountSchema), ctrl.createDiscount);
router.patch('/:id', authenticate, requireRole('owner'), validate(updateDiscountSchema), ctrl.updateDiscount);
router.delete('/:id', authenticate, requireRole('owner'), ctrl.deleteDiscount);

export default router;
