import { Prisma, type PrismaClient } from '@prisma/client';
import {
  buildEmployeePerformance,
  type EmployeeCostInput,
  type EmployeePerformance,
  type EmployeeSalesInput,
  type EmployeeVoidInput,
} from './employee.report';
import { utc } from './profit.service';

export interface EmployeeQuery {
  storeId: string;
  from?: Date;
  to?: Date;
  branchId?: string;
}

type Raw = Record<string, unknown>;
const num = (value: unknown): number => Number(value ?? 0);

function conditions(query: EmployeeQuery, status: 'paid' | 'voided'): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`t."storeId" = ${query.storeId}`,
    Prisma.sql`t."status" = ${status}::"TransactionStatus"`,
  ];
  if (query.from) parts.push(Prisma.sql`t."createdAt" >= ${utc(query.from)}`);
  if (query.to) parts.push(Prisma.sql`t."createdAt" <= ${utc(query.to)}`);
  if (query.branchId) parts.push(Prisma.sql`t."branchId" = ${query.branchId}`);
  return Prisma.join(parts, ' AND ');
}

export async function getEmployeePerformance(db: PrismaClient, query: EmployeeQuery): Promise<EmployeePerformance> {
  const paid = conditions(query, 'paid');
  const voided = conditions(query, 'voided');

  const [salesRows, costRows, voidRows] = await Promise.all([
    db.$queryRaw<Raw[]>`
      SELECT t."userId" AS "userId", u."name" AS "name",
             COUNT(*)::int AS "transactionCount",
             COALESCE(SUM(t."subtotal"), 0) AS "grossSales",
             COALESCE(SUM(t."discountAmount"), 0) AS "discounts"
      FROM "Transaction" t
      JOIN "User" u ON u."id" = t."userId"
      WHERE ${paid}
      GROUP BY t."userId", u."name"`,
    db.$queryRaw<Raw[]>`
      SELECT t."userId" AS "userId", COALESCE(SUM(ti."costPrice" * ti."quantity"), 0) AS "cogs"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON t."id" = ti."transactionId"
      WHERE ${paid}
      GROUP BY t."userId"`,
    db.$queryRaw<Raw[]>`
      SELECT t."userId" AS "userId", u."name" AS "name",
             COUNT(*)::int AS "voidedCount",
             COALESCE(SUM(t."grandTotal"), 0) AS "voidedAmount"
      FROM "Transaction" t
      JOIN "User" u ON u."id" = t."userId"
      WHERE ${voided}
      GROUP BY t."userId", u."name"`,
  ]);

  const sales: EmployeeSalesInput[] = salesRows.map(row => ({
    userId: String(row['userId']),
    name: String(row['name']),
    transactionCount: num(row['transactionCount']),
    grossSales: num(row['grossSales']),
    discounts: num(row['discounts']),
  }));
  const costs: EmployeeCostInput[] = costRows.map(row => ({ userId: String(row['userId']), cogs: num(row['cogs']) }));
  const voids: EmployeeVoidInput[] = voidRows.map(row => ({
    userId: String(row['userId']),
    name: String(row['name']),
    voidedCount: num(row['voidedCount']),
    voidedAmount: num(row['voidedAmount']),
  }));

  return buildEmployeePerformance(sales, costs, voids);
}
