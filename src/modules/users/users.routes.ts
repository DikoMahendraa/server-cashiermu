import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { createUserSchema, updateUserSchema, changePinSchema } from './users.schema';
import * as usersController from './users.controller';

const router = Router();

router.get('/', authenticate, requireRole('owner'), usersController.listUsers);
router.post('/', authenticate, requireRole('owner'), validate(createUserSchema), usersController.createUser);
router.get('/:id', authenticate, requireRole('owner'), usersController.getUser);
router.patch('/:id', authenticate, requireRole('owner'), validate(updateUserSchema), usersController.updateUser);
router.patch('/:id/pin', authenticate, requireRole('owner'), validate(changePinSchema), usersController.changePin);
router.patch('/:id/status', authenticate, requireRole('owner'), usersController.toggleStatus);
router.delete('/:id', authenticate, requireRole('owner'), usersController.deleteUser);

export default router;
