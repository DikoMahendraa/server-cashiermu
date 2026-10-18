import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../../config/database';
import { env } from '../../config/env';
import { CreateTransactionDto, UpdateJobDto, VoidTransactionDto, idempotencyKeySchema } from './transactions.schema';
import { JOB_STATUSES, OPEN_JOB_STATUSES, newReceiptToken, receiptUrl } from './job';
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
    // ?jobStatus=open (anything not completed) or one status; only service stores have jobs
    const jobParam = typeof req.query['jobStatus'] === 'string' ? req.query['jobStatus'] : undefined;
    const jobFilter =
      jobParam === 'open'
        ? { in: OPEN_JOB_STATUSES }
        : jobParam && (JOB_STATUSES as readonly string[]).includes(jobParam)
          ? (jobParam as (typeof JOB_STATUSES)[number])
          : undefined;
    const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
    const sort = req.query['sort'] === 'asc' ? 'asc' : 'desc';

    // Cashier hanya boleh lihat transaksi miliknya sendiri, kecuali daftar pekerjaan layanan: pekerjaan harus
    // bisa dilanjutkan kasir shift berikutnya, jadi seluruh toko terlihat (hanya lewat filter jobStatus).
    // Owner boleh filter per-user via query param, atau lihat semua.
    const userIdFilter =
      role === 'owner'
        ? typeof req.query['userId'] === 'string'
          ? req.query['userId']
          : undefined
        : jobFilter
          ? undefined
          : selfId;

    const transactions = await prisma.transaction.findMany({
      where: {
        storeId,
        ...(userIdFilter ? { userId: userIdFilter } : {}),
        ...(shiftId ? { shiftId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(status ? { status } : {}),
        ...(jobFilter ? { jobStatus: jobFilter, status: 'paid' as const } : {}),
        ...(from || to
          ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
                { customerPhone: { contains: search } },
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

/** Staff (owner or cashier) moves a service order through its stages or fixes customer/ETA details. */
export const updateJob = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const storeId = req.user!.storeId;
    const body = req.body as UpdateJobDto;

    const existing = await prisma.transaction.findFirst({ where: { id, storeId } });
    if (!existing) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Transaction not found' });
      return;
    }
    if (existing.jobStatus === null) {
      res.status(422).json({ code: 'NOT_A_JOB', message: 'Transaksi ini bukan pekerjaan layanan' });
      return;
    }
    if (existing.status === 'voided') {
      res.status(409).json({ code: 'TRANSACTION_VOIDED', message: 'Transaksi sudah dibatalkan' });
      return;
    }

    const statusChanged = body.jobStatus !== undefined && body.jobStatus !== existing.jobStatus;
    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        ...(body.jobStatus !== undefined ? { jobStatus: body.jobStatus } : {}),
        ...(statusChanged ? { jobUpdatedAt: new Date() } : {}),
        ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
        ...(body.customerName !== undefined ? { customerName: body.customerName } : {}),
        ...(body.customerPhone !== undefined ? { customerPhone: body.customerPhone } : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        items: true,
        payments: true,
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

/** Returns the public receipt link; rows created before this feature get their token on first request. */
export const getReceiptLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params['id']);
    const storeId = req.user!.storeId;

    const existing = await prisma.transaction.findFirst({ where: { id, storeId }, select: { receiptToken: true } });
    if (!existing) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Transaction not found' });
      return;
    }

    let token = existing.receiptToken;
    if (!token) {
      // updateMany with a null guard: two simultaneous requests cannot overwrite each other's token
      await prisma.transaction.updateMany({
        where: { id, storeId, receiptToken: null },
        data: { receiptToken: newReceiptToken() },
      });
      token = (await prisma.transaction.findFirst({ where: { id, storeId }, select: { receiptToken: true } }))!
        .receiptToken!;
    }
    res.json({ token, url: env.PUBLIC_BASE_URL ? receiptUrl(env.PUBLIC_BASE_URL, token) : null });
  } catch (err) {
    next(err);
  }
};
