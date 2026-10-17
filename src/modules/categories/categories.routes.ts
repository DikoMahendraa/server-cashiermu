import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { createCategorySchema, updateCategorySchema } from './categories.schema';
import * as categoriesController from './categories.controller';

const router = Router();

router.get('/', authenticate, categoriesController.listCategories);
router.post(
  '/',
  authenticate,
  requireRole('owner'),
  validate(createCategorySchema),
  categoriesController.createCategory,
);
router.patch(
  '/:id',
  authenticate,
  requireRole('owner'),
  validate(updateCategorySchema),
  categoriesController.updateCategory,
);
router.delete('/:id', authenticate, requireRole('owner'), categoriesController.deleteCategory);

export default router;
