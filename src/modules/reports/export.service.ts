import { Prisma, type PrismaClient } from '@prisma/client';
import { getEmployeePerformance } from './employee.service';
import {
  MAX_EXPORT_ROWS,
  employeesTable,
  expensesTable,
  transactionsTable,
  type ExportDataset,
  type ExportTable,
} from './export.report';

export interface ExportQuery {
  storeId: string;
  from?: Date;
  to?: Date;
  branchId?: string;
}

export async function buildExport(db: PrismaClient, dataset: ExportDataset, query: ExportQuery): Promise<ExportTable> {
  const range = (field: 'createdAt' | 'spentAt') =>
    query.from || query.to
      ? { [field]: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {};

  if (dataset === 'transactions') {
    const where: Prisma.TransactionWhereInput = {
      storeId: query.storeId,
      status: { in: ['paid', 'voided'] },
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...range('createdAt'),
    };
    const [total, rows] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MAX_EXPORT_ROWS,
        include: {
          user: { select: { name: true } },
          branch: { select: { name: true } },
          payments: { select: { method: true } },
        },
      }),
    ]);
    return transactionsTable(
      rows.map(row => ({
        createdAt: row.createdAt,
        invoiceNumber: row.invoiceNumber,
        status: row.status,
        cashier: row.user.name,
        branch: row.branch.name,
        customerName: row.customerName,
        paymentMethods: [...new Set(row.payments.map(p => p.method))],
        subtotal: Number(row.subtotal),
        discountAmount: Number(row.discountAmount),
        taxAmount: Number(row.taxAmount),
        serviceChargeAmount: Number(row.serviceChargeAmount),
        grandTotal: Number(row.grandTotal),
      })),
      total,
    );
  }

  if (dataset === 'expenses') {
    const where: Prisma.ExpenseWhereInput = {
      storeId: query.storeId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...range('spentAt'),
    };
    const [total, rows] = await Promise.all([
      db.expense.count({ where }),
      db.expense.findMany({
        where,
        orderBy: { spentAt: 'desc' },
        take: MAX_EXPORT_ROWS,
        include: { branch: { select: { name: true } }, user: { select: { name: true } } },
      }),
    ]);
    return expensesTable(
      rows.map(row => ({
        spentAt: row.spentAt,
        category: row.category,
        amount: Number(row.amount),
        note: row.note,
        branch: row.branch?.name ?? null,
        recordedBy: row.user.name,
      })),
      total,
    );
  }

  return employeesTable(await getEmployeePerformance(db, query));
}
