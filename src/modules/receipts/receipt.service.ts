import { PrismaClient } from '@prisma/client';
import { RECEIPT_TOKEN_PATTERN, type JobStatusValue } from '../transactions/job';
import type { ReceiptView } from './receipt.html';

/** Loads what the public receipt page may show. Deliberately omits staff names, ids, cost prices and shift data. */
export async function findReceiptByToken(db: PrismaClient, token: string): Promise<ReceiptView | null> {
  if (!RECEIPT_TOKEN_PATTERN.test(token)) return null;

  const tx = await db.transaction.findUnique({
    where: { receiptToken: token },
    include: {
      items: true,
      payments: true,
      store: { select: { name: true, address: true, phone: true, receiptHeader: true, receiptFooter: true } },
    },
  });
  if (!tx) return null;

  return {
    store: {
      name: tx.store.name,
      address: tx.store.address,
      phone: tx.store.phone,
      header: tx.store.receiptHeader,
      footer: tx.store.receiptFooter,
    },
    invoiceNumber: tx.invoiceNumber,
    createdAt: tx.createdAt,
    voided: tx.status === 'voided',
    customerName: tx.customerName,
    job: tx.jobStatus ? { status: tx.jobStatus as JobStatusValue, updatedAt: tx.jobUpdatedAt, dueAt: tx.dueAt } : null,
    items: tx.items.map(item => ({
      name: item.productName,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      subtotal: Number(item.subtotal),
      variants: (Array.isArray(item.selectedVariants) ? item.selectedVariants : [])
        .map(variant => (variant as { optionLabel?: unknown }).optionLabel)
        .filter((label): label is string => typeof label === 'string'),
      note: item.note,
    })),
    subtotal: Number(tx.subtotal),
    discountAmount: Number(tx.discountAmount),
    taxAmount: Number(tx.taxAmount),
    serviceChargeAmount: Number(tx.serviceChargeAmount),
    grandTotal: Number(tx.grandTotal),
    payments: tx.payments.map(p => ({ method: p.method, amount: Number(p.amount) })),
    note: tx.note,
  };
}
