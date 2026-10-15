import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { generateInvoiceNumber } from '../../utils/invoice';
import { CreateTransactionDto, VoidTransactionDto } from './transactions.schema';

export const createTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as CreateTransactionDto;
    const userId = req.user!.userId;
    const storeId = req.user!.storeId;

    // Fetch store first — needed for shift validation + tax/service charge rates
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      res.status(404).json({ message: 'Store not found' });
      return;
    }

    // Shift validation — only enforce when shiftEnabled = true
    let resolvedBranchId: string | null = body.branchId ?? req.user!.branchId;
    if (store.shiftEnabled) {
      if (!body.shiftId) {
        res.status(422).json({ message: 'Shift wajib dibuka terlebih dahulu sebelum transaksi' });
        return;
      }
      const shift = await prisma.shift.findUnique({ where: { id: body.shiftId, storeId } });
      if (!shift || shift.status !== 'open') {
        res.status(422).json({ message: 'Shift tidak ditemukan atau sudah ditutup' });
        return;
      }
      resolvedBranchId = shift.branchId;
    }

    if (!resolvedBranchId) {
      res.status(422).json({ message: 'Kasir tidak memiliki cabang yang ditentukan. Hubungi admin untuk mengatur cabang.' });
      return;
    }

    const productIds = body.items.map(i => i.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, storeId, isActive: true } });
    if (products.length !== productIds.length) {
      res.status(422).json({ message: 'One or more products not found or inactive' });
      return;
    }

    for (const item of body.items) {
      const product = products.find(p => p.id === item.productId)!;
      if (product.stock < item.quantity) {
        res.status(422).json({ message: `Insufficient stock for product: ${product.name}` });
        return;
      }
    }

    const taxRate = store.taxEnabled ? Number(store.taxRate) : 0;
    const serviceChargeRate = store.serviceChargeEnabled ? Number(store.serviceChargeRate) : 0;

    // Gunakan subtotal per item dari frontend (sudah termasuk item discount jika ada)
    const subtotal = body.items.reduce((sum, item) => sum + (item.subtotal ?? item.unitPrice * item.quantity), 0);
    let discountAmount = 0;
    if (body.discount) {
      discountAmount = body.discount.type === 'percent'
        ? (subtotal * body.discount.value) / 100
        : body.discount.value;
    }

    const taxableBase = subtotal - discountAmount;
    const taxAmount = taxableBase * taxRate;
    const serviceChargeAmount = taxableBase * serviceChargeRate;
    const grandTotal = taxableBase + taxAmount + serviceChargeAmount;
    const cashPaid = body.cashPaid || 0;
    const changeAmount = Math.max(0, cashPaid - grandTotal);

    // Retry up to 3 times on invoice number collision (P2002 unique constraint)
    let transaction: Awaited<ReturnType<typeof prisma.$transaction>> | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      const invoiceNumber = await generateInvoiceNumber(storeId);
      try {
        transaction = await prisma.$transaction(async tx => {
          for (const item of body.items) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { decrement: item.quantity } },
            });
          }

          const newTx = await tx.transaction.create({
            data: {
              storeId,
              invoiceNumber,
              shiftId: body.shiftId ?? null,
              userId,
              branchId: resolvedBranchId,
              subtotal,
              discountType: body.discount?.type,
              discountValue: body.discount?.value,
              discountLabel: body.discount?.label,
              discountCode: body.discount?.code,
              discountAmount,
              taxRate,
              taxAmount,
              serviceChargeRate,
              serviceChargeAmount,
              grandTotal,
              cashPaid,
              changeAmount,
              customerName: body.customerName,
              note: body.note,
              items: {
                create: body.items.map(item => {
                  const product = products.find(p => p.id === item.productId)!;
                  return {
                    productId: item.productId,
                    productName: product.name,
                    sku: product.sku,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    subtotal: item.subtotal ?? item.unitPrice * item.quantity,
                    note: item.note ?? '',
                    selectedVariants: item.selectedVariants ?? [],
                    discountType:  item.itemDiscount?.type  ?? null,
                    discountValue: item.itemDiscount?.value ?? null,
                    discountLabel: item.itemDiscount?.label ?? null,
                  };
                }),
              },
              payments: {
                create: body.payments.map(p => ({
                  method: p.method,
                  amount: p.amount,
                  reference: p.reference,
                })),
              },
            },
            include: { items: true, payments: true, user: { select: { id: true, name: true } } },
          });

          if (body.shiftId) {
            const cashPayment = body.payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
            const digitalPayment = body.payments.filter(p => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
            await tx.shift.update({
              where: { id: body.shiftId },
              data: {
                cashSalesTotal: { increment: cashPayment },
                digitalSalesTotal: { increment: digitalPayment },
                transactionCount: { increment: 1 },
              },
            });
          }

          return newTx;
        });

        break; // success — exit retry loop
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          lastError = err;
          continue; // retry with a new invoice number
        }
        throw err; // non-collision error — re-throw immediately
      }
    }

    if (!transaction) throw lastError;

    res.status(201).json(transaction);
  } catch (err) {
    next(err);
  }
};

export const listTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId  = req.user!.storeId;
    const role     = req.user!.role;
    const selfId   = req.user!.userId;

    const shiftId  = typeof req.query['shiftId']  === 'string' ? req.query['shiftId']  : undefined;
    const branchId = typeof req.query['branchId'] === 'string' ? req.query['branchId'] : undefined;
    const status   = typeof req.query['status']   === 'string' ? req.query['status'] as 'paid' | 'voided' | 'pending' : undefined;
    const from     = typeof req.query['from']     === 'string' ? req.query['from']     : undefined;
    const to       = typeof req.query['to']       === 'string' ? req.query['to']       : undefined;
    const search   = typeof req.query['search']   === 'string' ? req.query['search']   : undefined;
    const sort     = req.query['sort'] === 'asc' ? 'asc' : 'desc';

    // Cashier hanya boleh lihat transaksi miliknya sendiri.
    // Owner boleh filter per-user via query param, atau lihat semua.
    const userIdFilter = role === 'owner'
      ? (typeof req.query['userId'] === 'string' ? req.query['userId'] : undefined)
      : selfId;

    const transactions = await prisma.transaction.findMany({
      where: {
        storeId,
        ...(userIdFilter ? { userId: userIdFilter } : {}),
        ...(shiftId  ? { shiftId }  : {}),
        ...(branchId ? { branchId } : {}),
        ...(status   ? { status }   : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
        ...(search ? { OR: [{ invoiceNumber: { contains: search, mode: 'insensitive' } }, { customerName: { contains: search, mode: 'insensitive' } }] } : {}),
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
    if (!transaction) { res.status(404).json({ message: 'Transaction not found' }); return; }
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
    if (!owner) { res.status(404).json({ message: 'Owner not found' }); return; }

    const pinMatch = await bcrypt.compare(ownerPin, owner.pinHash);
    if (!pinMatch) { res.status(401).json({ message: 'Invalid owner PIN' }); return; }

    const txRecord = await prisma.transaction.findUnique({
      where: { id, storeId },
      include: { items: true, payments: true },
    });
    if (!txRecord) { res.status(404).json({ message: 'Transaction not found' }); return; }
    if (txRecord.status === 'voided') { res.status(400).json({ message: 'Transaction already voided' }); return; }

    const { items, payments, shiftId } = txRecord;
    const ownerName = owner.name;

    await prisma.$transaction(async tx => {
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
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
