import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import * as reportsController from './reports.controller';

const router = Router();

router.use(authenticate, requireRole('owner'));

router.get('/summary', reportsController.getSummary);
router.get('/chart', reportsController.getChart);
router.get('/top-products', reportsController.getTopProducts);
router.get('/payment-breakdown', reportsController.getPaymentBreakdown);
router.get('/shift-summary', reportsController.getShiftSummary);
router.get('/profit', reportsController.getProfit);

export default router;
