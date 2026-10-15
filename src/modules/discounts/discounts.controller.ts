import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { CreateDiscountDto, UpdateDiscountDto } from './discounts.schema';

export const listDiscounts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const discounts = await prisma.storeDiscount.findMany({
      where: { storeId: req.user!.storeId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(discounts);
  } catch (err) {
    next(err);
  }
};

export const createDiscount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const discount = await prisma.storeDiscount.create({
      data: { ...(req.body as CreateDiscountDto), storeId: req.user!.storeId },
    });
    res.status(201).json(discount);
  } catch (err) {
    next(err);
  }
};

export const updateDiscount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const discount = await prisma.storeDiscount.update({
      where: { id, storeId: req.user!.storeId },
      data: req.body as UpdateDiscountDto,
    });
    res.json(discount);
  } catch (err) {
    next(err);
  }
};

export const deleteDiscount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    await prisma.storeDiscount.delete({ where: { id, storeId: req.user!.storeId } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
