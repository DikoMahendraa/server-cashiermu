import { Prisma, type PrismaClient } from '@prisma/client';
import {
  buildProfitReport,
  type EmployeeCostRow,
  type EmployeeSalesRow,
  type ProductRow,
  type ProfitReport,
  type SalesRow,
} from './profit.report';

export interface ProfitQuery {
  storeId: string;
  from?: Date;
  to?: Date;
  branchId?: string;
  userId?: string;
  /** How many best sellers to return. */
  limit: number;
}

// Raw SQL rows: Prisma returns DECIMAL columns as Decimal objects, so every value goes through Number().
type Raw = Record<string, unknown>;
const num = (value: unknown): number => Number(value ?? 0);

/**
 * Aggregations run in SQL (a store can have many thousands of sale lines), always filtered by storeId
 * and paid transactions only. Values are bound parameters through the Prisma.sql tag — never string-built.
 */
/**
 * Prisma stores DateTime as UTC wall-clock time in `timestamp without time zone` columns. In raw SQL a JS Date is
 * bound as a time-zone-aware value, so comparing it directly would be shifted by the database session's time zone
 * (e.g. +7h in WIB). Converting it to a UTC `timestamp` first makes the comparison correct on any server.
 */
const utc = (date: Date): Prisma.Sql => Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;

export async function getProfitReport(db: PrismaClient, query: ProfitQuery): Promise<ProfitReport> {
  const conditions: Prisma.Sql[] = [Prisma.sql`t."storeId" = ${query.storeId}`, Prisma.sql`t."status" = 'paid'`];
  if (query.from) conditions.push(Prisma.sql`t."createdAt" >= ${utc(query.from)}`);
  if (query.to) conditions.push(Prisma.sql`t."createdAt" <= ${utc(query.to)}`);
  if (query.branchId) conditions.push(Prisma.sql`t."branchId" = ${query.branchId}`);
  if (query.userId) conditions.push(Prisma.sql`t."userId" = ${query.userId}`);
  const where = Prisma.join(conditions, ' AND ');

  const [salesRows, employeeSalesRows, employeeCostRows, productRows] = await Promise.all([
    db.$queryRaw<Raw[]>`
      SELECT COUNT(*)::int AS "transactionCount",
             COALESCE(SUM(t."subtotal"), 0) AS "grossSales",
             COALESCE(SUM(t."discountAmount"), 0) AS "discounts",
             COALESCE(SUM(t."taxAmount"), 0) AS "taxCollected",
             COALESCE(SUM(t."serviceChargeAmount"), 0) AS "serviceChargeCollected"
      FROM "Transaction" t
      WHERE ${where}`,
    db.$queryRaw<Raw[]>`
      SELECT t."userId" AS "userId", u."name" AS "name",
             COUNT(*)::int AS "transactionCount",
             COALESCE(SUM(t."subtotal"), 0) AS "grossSales",
             COALESCE(SUM(t."discountAmount"), 0) AS "discounts"
      FROM "Transaction" t
      JOIN "User" u ON u."id" = t."userId"
      WHERE ${where}
      GROUP BY t."userId", u."name"`,
    db.$queryRaw<Raw[]>`
      SELECT t."userId" AS "userId", COALESCE(SUM(ti."costPrice" * ti."quantity"), 0) AS "cogs"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON t."id" = ti."transactionId"
      WHERE ${where}
      GROUP BY t."userId"`,
    db.$queryRaw<Raw[]>`
      SELECT ti."productId" AS "productId", ti."productName" AS "productName",
             SUM(ti."quantity")::int AS "quantity",
             COALESCE(SUM(ti."subtotal"), 0) AS "revenue",
             COALESCE(SUM(ti."costPrice" * ti."quantity"), 0) AS "cogs"
      FROM "TransactionItem" ti
      JOIN "Transaction" t ON t."id" = ti."transactionId"
      WHERE ${where}
      GROUP BY ti."productId", ti."productName"
      ORDER BY (SUM(ti."subtotal") - SUM(ti."costPrice" * ti."quantity")) DESC
      LIMIT ${query.limit}`,
  ]);

  const sales: SalesRow = {
    transactionCount: num(salesRows[0]?.['transactionCount']),
    grossSales: num(salesRows[0]?.['grossSales']),
    discounts: num(salesRows[0]?.['discounts']),
    taxCollected: num(salesRows[0]?.['taxCollected']),
    serviceChargeCollected: num(salesRows[0]?.['serviceChargeCollected']),
  };
  const employeeSales: EmployeeSalesRow[] = employeeSalesRows.map(row => ({
    userId: String(row['userId']),
    name: String(row['name']),
    transactionCount: num(row['transactionCount']),
    grossSales: num(row['grossSales']),
    discounts: num(row['discounts']),
  }));
  const employeeCosts: EmployeeCostRow[] = employeeCostRows.map(row => ({
    userId: String(row['userId']),
    cogs: num(row['cogs']),
  }));
  const products: ProductRow[] = productRows.map(row => ({
    productId: String(row['productId']),
    productName: String(row['productName']),
    quantity: num(row['quantity']),
    revenue: num(row['revenue']),
    cogs: num(row['cogs']),
  }));

  return buildProfitReport(sales, employeeSales, employeeCosts, products);
}
