import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { createProductSchema, updateProductSchema, adjustStockSchema } from './products.schema';
import * as productsController from './products.controller';
import * as importController from './import/import.controller';
import { importBodySchema } from './import/import.schema';

const router = Router();

router.get('/', authenticate, productsController.listProducts);
router.post('/', authenticate, requireRole('owner'), validate(createProductSchema), productsController.createProduct);
// Import / export. These MUST be declared before `/:id`, which would otherwise treat "export" as an id.
router.get('/export', authenticate, requireRole('owner'), importController.exportProducts);
router.get('/import/template', authenticate, requireRole('owner'), importController.getImportTemplate);
router.post(
  '/import/preview',
  authenticate,
  requireRole('owner'),
  validate(importBodySchema),
  importController.previewProductImport,
);
router.post(
  '/import',
  authenticate,
  requireRole('owner'),
  validate(importBodySchema),
  importController.commitProductImport,
);

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
