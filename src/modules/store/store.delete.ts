import { Prisma } from '@prisma/client';

/**
 * Permanently removes a store and everything that belongs to it. Children go first because most relations have no
 * `onDelete: Cascade`; items, payments, variants and refresh tokens are removed by their parent's cascade.
 * Must run inside one transaction so a failure half-way leaves the store untouched.
 */
export async function deleteStoreData(tx: Prisma.TransactionClient, storeId: string): Promise<void> {
  await tx.transaction.deleteMany({ where: { storeId } });
  await tx.pendingBill.deleteMany({ where: { storeId } });
  await tx.expense.deleteMany({ where: { storeId } });
  await tx.shift.deleteMany({ where: { storeId } });
  await tx.product.deleteMany({ where: { storeId } });
  await tx.category.deleteMany({ where: { storeId } });
  await tx.user.deleteMany({ where: { storeId } });
  await tx.branch.deleteMany({ where: { storeId } });
  await tx.storeDiscount.deleteMany({ where: { storeId } });
  await tx.store.delete({ where: { id: storeId } });
}
