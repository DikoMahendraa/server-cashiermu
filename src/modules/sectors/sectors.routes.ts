import { Router } from 'express';
import * as sectorsController from './sectors.controller';

const router = Router();

// Intentionally no `authenticate`: static form definitions, needed during registration.
router.get('/', sectorsController.listSectors);

export default router;
