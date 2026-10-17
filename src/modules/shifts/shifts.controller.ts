import { Request, Response, NextFunction } from 'express';
import prisma from '../../config/database';
import { OpenShiftDto, CloseShiftDto } from './shifts.schema';

export const openShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { type, openingBalance, branchId } = req.body as OpenShiftDto;
    const userId = req.user!.userId;
    const storeId = req.user!.storeId;

    const existing = await prisma.shift.findFirst({ where: { userId, storeId, status: 'open' } });
    if (existing) {
      res.status(400).json({ message: 'You already have an open shift' });
      return;
    }

    const shift = await prisma.shift.create({
      data: { userId, branchId, type, openingBalance, storeId },
    });
    res.status(201).json(shift);
  } catch (err) {
    next(err);
  }
};

export const closeShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { closingBalance, notes } = req.body as CloseShiftDto;
    const userId = req.user!.userId;
    const storeId = req.user!.storeId;

    const shift = await prisma.shift.findFirst({ where: { userId, storeId, status: 'open' } });
    if (!shift) {
      res.status(404).json({ message: 'No open shift found' });
      return;
    }

    const variance = closingBalance - Number(shift.openingBalance) - Number(shift.cashSalesTotal);

    const updated = await prisma.shift.update({
      where: { id: shift.id },
      data: { closingBalance, variance, notes, status: 'closed', closedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const getCurrentShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const shift = await prisma.shift.findFirst({
      where: { userId: req.user!.userId, storeId: req.user!.storeId, status: 'open' },
      include: { branch: true },
    });
    // Return null (not 404) when no active shift — absence of shift is a valid state
    res.json(shift ?? null);
  } catch (err) {
    next(err);
  }
};

export const listShifts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const branchId = typeof req.query['branchId'] === 'string' ? req.query['branchId'] : undefined;
    const userId = typeof req.query['userId'] === 'string' ? req.query['userId'] : undefined;
    const status = typeof req.query['status'] === 'string' ? (req.query['status'] as 'open' | 'closed') : undefined;
    const from = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
    const to = typeof req.query['to'] === 'string' ? req.query['to'] : undefined;

    const shifts = await prisma.shift.findMany({
      where: {
        storeId,
        ...(branchId ? { branchId } : {}),
        ...(userId ? { userId } : {}),
        ...(status ? { status } : {}),
        ...(from || to
          ? { startedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
    res.json(shifts);
  } catch (err) {
    next(err);
  }
};

export const getShift = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const shift = await prisma.shift.findUnique({
      where: { id, storeId: req.user!.storeId },
      include: {
        user: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        transactions: { select: { id: true, invoiceNumber: true, grandTotal: true, status: true, createdAt: true } },
      },
    });
    if (!shift) {
      res.status(404).json({ message: 'Shift not found' });
      return;
    }
    res.json(shift);
  } catch (err) {
    next(err);
  }
};
