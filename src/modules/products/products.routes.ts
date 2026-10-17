import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { createProductSchema, updateProductSchema, adjustStockSchema } from './products.schema';
import * as productsController from './products.controller';

const router = Router();

router.get('/', authenticate, productsController.listProducts);
router.post('/', authenticate, requireRole('owner'), validate(createProductSchema), productsController.createProduct);
router.get('/:id', authenticate, productsController.getProduct);
router.patch(
  '/:id',
  authenticate,
  requireRole('owner'),
  validate(updateProductSchema),
  productsController.updateProduct,
);
router.patch(
  '/:id/stock',
  authenticate,
  requireRole('owner'),
  validate(adjustStockSchema),
  productsController.adjustStock,
);
router.delete('/:id', authenticate, requireRole('owner'), productsController.softDeleteProduct);

export default router;
