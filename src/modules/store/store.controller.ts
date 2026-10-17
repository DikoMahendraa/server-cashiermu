import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { UpdateStoreDto } from './store.schema';
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
