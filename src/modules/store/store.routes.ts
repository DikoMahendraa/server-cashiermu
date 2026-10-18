import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { updateStoreSchema, deleteAccountSchema } from './store.schema';
import * as storeController from './store.controller';

const router = Router();

// Guessing the PIN here would be the last step before destroying a store, so keep the limit tight
const deleteAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // Per owner (the route is authenticated), not per address: many shops share one mobile-network IP
  keyGenerator: req => req.user!.userId,
  message: { message: 'Too many attempts. Please try again later.' },
});

router.get('/', authenticate, storeController.getStore);
router.patch('/', authenticate, requireRole('owner'), validate(updateStoreSchema), storeController.updateStore);
router.post(
  '/delete-account',
  authenticate,
  requireRole('owner'),
  deleteAccountLimiter,
  validate(deleteAccountSchema),
  storeController.deleteAccount,
);

export default router;
