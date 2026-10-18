// Pure profit calculations — no database access, so the math is easy to test.
//
// Definitions (all amounts in Rupiah, tax and service charge are NOT revenue):
//   grossSales  = sum of sale-line subtotals (after per-item discounts)
//   discounts   = cart-level discounts
//   netSales    = grossSales − discounts
//   cogs (HPP)  = sum of costPrice × quantity, where costPrice was stored on the line at checkout
//   grossProfit = netSales − cogs
// "Net profit" (after operating expenses) comes with the expenses module and is not part of this report yet.

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface SalesRow {
  transactionCount: number;
  grossSales: number;
  discounts: number;
  taxCollected: number;
  serviceChargeCollected: number;
}

export interface EmployeeSalesRow {
  userId: string;
  name: string;
  transactionCount: number;
  grossSales: number;
  discounts: number;
}

export interface EmployeeCostRow {
  userId: string;
  cogs: number;
}

export interface ProductRow {
  productId: string;
  productName: string;
  quantity: number;
  revenue: number;
  cogs: number;
}

export interface ExpenseRow {
  category: string;
  total: number;
}

export interface ProfitReport {
  transactionCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  /** grossProfit / netSales × 100, or null when there were no sales. */
  marginPct: number | null;
  /**
   * Operating expenses in the period (rent, salaries, …); `null` when they cannot be attributed, which is the case
   * when the report is filtered by employee (expenses belong to the business or a branch, not to a cashier).
   */
  expenses: { total: number; byCategory: { category: string; total: number }[] } | null;
  /** grossProfit − expenses, or null together with `expenses`. */
  netProfit: number | null;
  /** netProfit / netSales × 100, or null when there were no sales or no net profit. */
  netMarginPct: number | null;
  taxCollected: number;
  serviceChargeCollected: number;
  byEmployee: {
    userId: string;
    name: string;
    transactionCount: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    marginPct: number | null;
  }[];
  /** Best sellers by profit. `revenue` is the line subtotal before any cart-level discount. */
  topProducts: {
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
    cogs: number;
    profit: number;
  }[];
}

const margin = (profit: number, sales: number): number | null => (sales > 0 ? round2((profit / sales) * 100) : null);

export function buildProfitReport(
  sales: SalesRow,
  employeeSales: EmployeeSalesRow[],
  employeeCosts: EmployeeCostRow[],
  products: ProductRow[],
  expenseRows: ExpenseRow[] | null = [],
): ProfitReport {
  const costByUser = new Map(employeeCosts.map(row => [row.userId, row.cogs]));
  const cogs = round2(employeeCosts.reduce((sum, row) => sum + row.cogs, 0));
  const netSales = round2(sales.grossSales - sales.discounts);
  const grossProfit = round2(netSales - cogs);

  const expenses = expenseRows
    ? {
        total: round2(expenseRows.reduce((sum, row) => sum + row.total, 0)),
        byCategory: expenseRows
          .map(row => ({ category: row.category, total: round2(row.total) }))
          .sort((a, b) => b.total - a.total),
      }
    : null;
  const netProfit = expenses ? round2(grossProfit - expenses.total) : null;

  const byEmployee = employeeSales
    .map(row => {
      const employeeNet = round2(row.grossSales - row.discounts);
      const employeeCogs = round2(costByUser.get(row.userId) ?? 0);
      const profit = round2(employeeNet - employeeCogs);
      return {
        userId: row.userId,
        name: row.name,
        transactionCount: row.transactionCount,
        netSales: employeeNet,
        cogs: employeeCogs,
        grossProfit: profit,
        marginPct: margin(profit, employeeNet),
      };
    })
    .sort((a, b) => b.netSales - a.netSales);

  return {
    transactionCount: sales.transactionCount,
    grossSales: round2(sales.grossSales),
    discounts: round2(sales.discounts),
    netSales,
    cogs,
    grossProfit,
    marginPct: margin(grossProfit, netSales),
    expenses,
    netProfit,
    netMarginPct: netProfit === null ? null : margin(netProfit, netSales),
    taxCollected: round2(sales.taxCollected),
    serviceChargeCollected: round2(sales.serviceChargeCollected),
    byEmployee,
    topProducts: products.map(row => ({
      productId: row.productId,
      productName: row.productName,
      quantity: row.quantity,
      revenue: round2(row.revenue),
      cogs: round2(row.cogs),
      profit: round2(row.revenue - row.cogs),
    })),
  };
}
