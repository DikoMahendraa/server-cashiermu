import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { UpdateStoreDto, DeleteAccountDto } from './store.schema';
import { deleteStoreData } from './store.delete';
import { isValidSubtype } from '../sectors/sector.config';

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
    const body = req.body as UpdateStoreDto;

    if (body.sector !== undefined || body.subtype !== undefined) {
      const current = await prisma.store.findUnique({
        where: { id: req.user!.storeId },
        select: { sector: true, subtype: true },
      });
      const sector = body.sector ?? current?.sector ?? 'general';
      // Changing the sector without naming a kind falls back to that sector's default kind
      const subtype =
        body.subtype ??
        (body.sector !== undefined && body.sector !== current?.sector ? 'default' : (current?.subtype ?? 'default'));
      if (!isValidSubtype(sector, subtype)) {
        res.status(422).json({ code: 'INVALID_SUBTYPE', message: 'Jenis usaha tidak valid untuk bidang usaha ini' });
        return;
      }
      body.sector = sector;
      body.subtype = subtype;
    }

    const store = await prisma.store.update({
      where: { id: req.user!.storeId },
      data: body,
    });
    res.json(store);
  } catch (err) {
    next(err);
  }
};

// Google Play requires an in-app way to delete the account and its data. The owner confirms with their PIN, then the
// whole store (staff, products, transactions) is erased for good. Owner only: staff are managed by the owner.
export const deleteAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { pin } = req.body as DeleteAccountDto;
    const { userId, storeId } = req.user!;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.storeId !== storeId || !(await bcrypt.compare(pin, user.pinHash))) {
      res.status(401).json({ message: 'Invalid PIN' });
      return;
    }

    // A big store has many rows; the default 5 s transaction limit is too short for it
    await prisma.$transaction(tx => deleteStoreData(tx, storeId), { timeout: 60_000 });
    logger.info('store deleted by owner', { storeId });

    res.json({ message: 'Account and all store data deleted' });
  } catch (err) {
    next(err);
  }
};
