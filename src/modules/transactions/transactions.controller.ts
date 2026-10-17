import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../../config/database';
import { CreateTransactionDto, VoidTransactionDto, idempotencyKeySchema } from './transactions.schema';
import { createCheckout } from './checkout.service';
import { CheckoutError } from './checkout.pricing';

export const createTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawKey = req.header('Idempotency-Key');
    let idempotencyKey: string | undefined;
    if (rawKey !== undefined) {
      const parsed = idempotencyKeySchema.safeParse(rawKey);
      if (!parsed.success) {
        res.status(422).json({
          code: 'INVALID_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key harus 8-128 karakter (huruf, angka, - atau _)',
        });
        return;
      }
      idempotencyKey = parsed.data;
    }

    const { transaction, replayed } = await createCheckout(
      prisma,
      { userId: req.user!.userId, storeId: req.user!.storeId, role: req.user!.role, branchId: req.user!.branchId },
      req.body as CreateTransactionDto,
      idempotencyKey,
    );

    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(replayed ? 200 : 201).json(transaction);
  } catch (err) {
    if (err instanceof CheckoutError) {
      res
        .status(err.status)
        .json({ code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    next(err);
  }
};

export const listTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.user!.storeId;
    const role = req.user!.role;
    const selfId = req.user!.userId;

    const shiftId = typeof req.query['shiftId'] === 'string' ? req.query['shiftId'] : undefined;
    const branchId = typeof req.query['branchId'] === 'string' ? req.query['branchId'] : undefined;
    const status =
      typeof req.query['status'] === 'string' ? (req.query['status'] as 'paid' | 'voided' | 'pending') : undefined;
    const from = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
    const to = typeof req.query['to'] === 'string' ? req.query['to'] : undefined;
    const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
    const sort = req.query['sort'] === 'asc' ? 'asc' : 'desc';

    // Cashier hanya boleh lihat transaksi miliknya sendiri.
    // Owner boleh filter per-user via query param, atau lihat semua.
    const userIdFilter =
      role === 'owner' ? (typeof req.query['userId'] === 'string' ? req.query['userId'] : undefined) : selfId;

    const transactions = await prisma.transaction.findMany({
      where: {
        storeId,
        ...(userIdFilter ? { userId: userIdFilter } : {}),
        ...(shiftId ? { shiftId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(status ? { status } : {}),
        ...(from || to
          ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        items: { select: { id: true, productName: true, quantity: true, unitPrice: true, subtotal: true } },
        payments: true,
      },
      orderBy: { createdAt: sort },
    });

    res.json(transactions);
  } catch (err) {
    next(err);
  }
};

export const getTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const transaction = await prisma.transaction.findUnique({
      where: { id, storeId: req.user!.storeId },
      include: {
        user: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, imageUrl: true } } } },
        payments: true,
      },
    });
    if (!transaction) {
      res.status(404).json({ message: 'Transaction not found' });
      return;
    }
    res.json(transaction);
  } catch (err) {
    next(err);
  }
};

export const voidTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const { ownerPin, reason } = req.body as VoidTransactionDto;
    const storeId = req.user!.storeId;

    const owner = await prisma.user.findFirst({ where: { role: 'owner', storeId, isActive: true } });
    if (!owner) {
      res.status(404).json({ message: 'Owner not found' });
      return;
    }

    const pinMatch = await bcrypt.compare(ownerPin, owner.pinHash);
    if (!pinMatch) {
      res.status(401).json({ message: 'Invalid owner PIN' });
      return;
    }

    const txRecord = await prisma.transaction.findUnique({
      where: { id, storeId },
      include: { items: true, payments: true },
    });
    if (!txRecord) {
      res.status(404).json({ message: 'Transaction not found' });
      return;
    }
    if (txRecord.status === 'voided') {
      res.status(400).json({ message: 'Transaction already voided' });
      return;
    }

    const { items, payments, shiftId } = txRecord;
    const ownerName = owner.name;

    await prisma.$transaction(async tx => {
      for (const item of items) {
        // updateMany + trackStock filter: untracked products (services/unlimited) never get stock added back
        await tx.product.updateMany({
          where: { id: item.productId, storeId, trackStock: true },
          // tracked products only ever sell whole quantities, so this is an integer
          data: { stock: { increment: Math.round(Number(item.quantity)) } },
        });
      }

      await tx.transaction.update({
        where: { id },
        data: { status: 'voided', voidReason: reason, voidedAt: new Date(), voidedBy: ownerName },
      });

      // Only reverse shift totals if transaction was linked to a shift
      if (shiftId) {
        const cashTotal = payments.filter(p => p.method === 'cash').reduce((s, p) => s + Number(p.amount), 0);
        const digitalTotal = payments.filter(p => p.method !== 'cash').reduce((s, p) => s + Number(p.amount), 0);

        await tx.shift.update({
          where: { id: shiftId },
          data: {
            cashSalesTotal: { decrement: cashTotal },
            digitalSalesTotal: { decrement: digitalTotal },
            transactionCount: { decrement: 1 },
          },
        });
      }
    });

    res.json({ message: 'Transaction voided successfully' });
  } catch (err) {
    next(err);
  }
};
