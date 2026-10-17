import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { registerSchema, checkCredentialSchema, loginSchema, refreshSchema } from './auth.schema';
import * as authController from './auth.controller';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: 'Too many login attempts. Please try again later.' },
});

router.post('/register', validate(registerSchema), authController.register);
router.post('/check-credential', validate(checkCredentialSchema), authController.checkCredential);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', authenticate, validate(refreshSchema), authController.logout);
router.get('/me', authenticate, authController.me);
router.patch('/me', authenticate, authController.updateMe);

export default router;
