import { Prisma, PrismaClient } from '@prisma/client';
import { generateInvoiceNumber } from '../../utils/invoice';
import { CreateTransactionDto } from './transactions.schema';
import {
  CheckoutError,
  PricingProduct,
  priceCart,
  settlePayments,
} from './checkout.pricing';

export interface CheckoutContext {
  userId: string;
  storeId: string;
  role: string;
  branchId: string | null;
}

export interface CheckoutResult {
  transaction: Prisma.TransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>;
  /** true when an earlier request with the same idempotency key already created it. */
  replayed: boolean;
}

const TRANSACTION_INCLUDE = {
  items: true,
  payments: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.TransactionInclude;

const MAX_INVOICE_ATTEMPTS = 3;

function uniqueTarget(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = err.meta?.['target'];
    return (Array.isArray(target) ? target.join(',') : String(target ?? '')).toLowerCase();
  }
  return null;
}

async function findByIdempotencyKey(db: PrismaClient, ctx: CheckoutContext, key: string): Promise<CheckoutResult | null> {
  const existing = await db.transaction.findUnique({
    where: { storeId_idempotencyKey: { storeId: ctx.storeId, idempotencyKey: key } },
    include: TRANSACTION_INCLUDE,
  });
  if (!existing) return null;
  if (existing.userId !== ctx.userId) {
    throw new CheckoutError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key sudah dipakai oleh pengguna lain');
  }
  return { transaction: existing, replayed: true };
}

/** Resolves which shift/branch the sale belongs to; both must belong to the caller's store. */
async function resolveShiftAndBranch(
  db: PrismaClient,
  ctx: CheckoutContext,
  body: CreateTransactionDto,
  shiftEnabled: boolean,
): Promise<{ shiftId: string | null; branchId: string }> {
  if (body.shiftId) {
    const shift = await db.shift.findFirst({ where: { id: body.shiftId, storeId: ctx.storeId } });
    if (!shift || shift.status !== 'open') {
      throw new CheckoutError(422, 'SHIFT_NOT_OPEN', 'Shift tidak ditemukan atau sudah ditutup');
    }
    if (shift.userId !== ctx.userId) {
      throw new CheckoutError(403, 'SHIFT_NOT_OWNED', 'Shift ini bukan milik Anda');
    }
    return { shiftId: shift.id, branchId: shift.branchId };
  }

  if (shiftEnabled) {
    throw new CheckoutError(422, 'SHIFT_REQUIRED', 'Shift wajib dibuka terlebih dahulu sebelum transaksi');
  }

  const branchId = body.branchId ?? ctx.branchId;
  if (!branchId) {
    throw new CheckoutError(422, 'BRANCH_REQUIRED', 'Kasir tidak memiliki cabang yang ditentukan. Hubungi admin untuk mengatur cabang.');
  }
  if (ctx.role !== 'owner' && ctx.branchId && branchId !== ctx.branchId) {
    throw new CheckoutError(403, 'BRANCH_NOT_ALLOWED', 'Kasir hanya boleh bertransaksi di cabangnya sendiri');
  }
  const branch = await db.branch.findFirst({ where: { id: branchId, storeId: ctx.storeId, isActive: true } });
  if (!branch) {
    throw new CheckoutError(422, 'BRANCH_NOT_FOUND', 'Cabang tidak ditemukan atau tidak aktif');
  }
  return { shiftId: null, branchId: branch.id };
}

export async function createCheckout(
  db: PrismaClient,
  ctx: CheckoutContext,
  body: CreateTransactionDto,
  idempotencyKey?: string,
): Promise<CheckoutResult> {
  if (idempotencyKey) {
    const replay = await findByIdempotencyKey(db, ctx, idempotencyKey);
    if (replay) return replay;
  }

  const store = await db.store.findUnique({ where: { id: ctx.storeId } });
  if (!store) throw new CheckoutError(404, 'STORE_NOT_FOUND', 'Store not found');

  const hasDiscount = !!body.discount || body.items.some(i => i.itemDiscount);
  if (hasDiscount && ctx.role !== 'owner' && !store.cashierCanDiscount) {
    throw new CheckoutError(403, 'DISCOUNT_NOT_ALLOWED', 'Kasir tidak diizinkan memberi diskon');
  }

  const { shiftId, branchId } = await resolveShiftAndBranch(db, ctx, body, store.shiftEnabled);

  // The same product may appear on several lines (different variants), so dedupe before lookup.
  const productIds = [...new Set(body.items.map(i => i.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds }, storeId: ctx.storeId, isActive: true },
    include: { variantGroups: { include: { options: true } } },
  });
  if (products.length !== productIds.length) {
    throw new CheckoutError(422, 'PRODUCT_UNAVAILABLE', 'Satu atau lebih produk tidak ditemukan atau tidak aktif');
  }

  const productMap = new Map<string, PricingProduct & { sku: string; stock: number }>(
    products.map(p => [p.id, {
      id: p.id,
      name: p.name,
      sku: p.sku,
      stock: p.stock,
      sellPrice: Number(p.sellPrice),
      discountEnabled: p.discountEnabled,
      discountType: p.discountType,
      discountValue: Number(p.discountValue),
      variantGroups: p.variantGroups.map(g => ({
        id: g.id,
        name: g.name,
        required: g.required,
        multiSelect: g.multiSelect,
        options: g.options.map(o => ({ id: o.id, label: o.label, priceModifier: Number(o.priceModifier) })),
      })),
    }]),
  );

  const cart = priceCart(body.items, productMap, {
    taxEnabled: store.taxEnabled,
    taxRate: Number(store.taxRate),
    serviceChargeEnabled: store.serviceChargeEnabled,
    serviceChargeRate: Number(store.serviceChargeRate),
    globalDiscountEnabled: store.globalDiscountEnabled,
    globalDiscountType: store.globalDiscountType,
    globalDiscountValue: Number(store.globalDiscountValue),
  }, body.discount);

  const settled = settlePayments(body.payments, cart.grandTotal);

  const qtyByProduct = new Map<string, number>();
  for (const item of cart.items) {
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  // Early, friendly check; the conditional decrement inside the DB transaction is the real guard.
  for (const [productId, qty] of qtyByProduct) {
    const product = productMap.get(productId)!;
    if (product.stock < qty) {
      throw new CheckoutError(422, 'INSUFFICIENT_STOCK', `Stok tidak cukup untuk produk: ${product.name}`);
    }
  }

  for (let attempt = 0; attempt < MAX_INVOICE_ATTEMPTS; attempt++) {
    const invoiceNumber = await generateInvoiceNumber(ctx.storeId);
    try {
      const transaction = await db.$transaction(async tx => {
        // Sorted ids give a consistent lock order across concurrent checkouts (no deadlocks).
        for (const productId of [...qtyByProduct.keys()].sort()) {
          const qty = qtyByProduct.get(productId)!;
          const { count } = await tx.product.updateMany({
            where: { id: productId, storeId: ctx.storeId, isActive: true, stock: { gte: qty } },
            data: { stock: { decrement: qty } },
          });
          if (count === 0) {
            throw new CheckoutError(422, 'INSUFFICIENT_STOCK', `Stok tidak cukup untuk produk: ${productMap.get(productId)!.name}`);
          }
        }

        if (shiftId) {
          const { count } = await tx.shift.updateMany({
            where: { id: shiftId, storeId: ctx.storeId, userId: ctx.userId, status: 'open' },
            data: {
              cashSalesTotal: { increment: settled.cashApplied },
              digitalSalesTotal: { increment: settled.digitalApplied },
              transactionCount: { increment: 1 },
            },
          });
          if (count === 0) {
            throw new CheckoutError(422, 'SHIFT_NOT_OPEN', 'Shift tidak ditemukan atau sudah ditutup');
          }
        }

        return tx.transaction.create({
          data: {
            storeId: ctx.storeId,
            invoiceNumber,
            idempotencyKey: idempotencyKey ?? null,
            shiftId,
            userId: ctx.userId,
            branchId,
            subtotal: cart.subtotal,
            discountType: body.discount?.type,
            discountValue: body.discount?.value,
            discountLabel: body.discount?.label,
            discountCode: body.discount?.code,
            discountAmount: cart.discountAmount,
            taxRate: cart.taxRate,
            taxAmount: cart.taxAmount,
            serviceChargeRate: cart.serviceChargeRate,
            serviceChargeAmount: cart.serviceChargeAmount,
            grandTotal: cart.grandTotal,
            cashPaid: settled.cashTendered,
            changeAmount: settled.changeAmount,
            customerName: body.customerName,
            note: body.note,
            items: {
              create: cart.items.map(item => ({
                productId: item.productId,
                productName: item.productName,
                sku: productMap.get(item.productId)!.sku,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                subtotal: item.subtotal,
                note: item.note,
                selectedVariants: item.selectedVariants as unknown as Prisma.InputJsonValue,
                discountType: item.itemDiscount?.type ?? null,
                discountValue: item.itemDiscount?.value ?? null,
                discountLabel: item.itemDiscount?.label ?? null,
              })),
            },
            payments: { create: settled.entries },
          },
          include: TRANSACTION_INCLUDE,
        });
      });

      return { transaction, replayed: false };
    } catch (err) {
      const target = uniqueTarget(err);
      if (target?.includes('idempotency') && idempotencyKey) {
        // A concurrent request with the same key won the race — return its result.
        const replay = await findByIdempotencyKey(db, ctx, idempotencyKey);
        if (replay) return replay;
      }
      if (target?.includes('invoice')) continue; // retry with a new invoice number
      throw err;
    }
  }

  throw new CheckoutError(503, 'INVOICE_CONFLICT', 'Gagal membuat nomor invoice. Coba lagi.');
}
