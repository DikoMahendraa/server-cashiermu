import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { UpdateStoreDto } from './store.schema';

export const getStore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const store = await prisma.store.findUnique({ where: { id: req.user!.storeId } });
    if (!store) {
      res.status(404).json({ message: 'Store not found' });
      return;
    }
    res.json(store);
  } catch (err) {
    next(err);
  }
};

export const updateStore = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const store = await prisma.store.update({
      where: { id: req.user!.storeId },
      data: req.body as UpdateStoreDto,
    });
    res.json(store);
  } catch (err) {
    next(err);
  }
};
