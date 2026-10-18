const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface EmployeeSalesInput {
  userId: string;
  name: string;
  transactionCount: number;
  grossSales: number;
  discounts: number;
}

export interface EmployeeCostInput {
  userId: string;
  cogs: number;
}

export interface EmployeeVoidInput {
  userId: string;
  name: string;
  voidedCount: number;
  voidedAmount: number;
}

export interface EmployeePerformanceRow {
  userId: string;
  name: string;
  transactionCount: number;
  netSales: number;
  /** netSales / transactionCount (0 when there were no sales). */
  averageSale: number;
  discounts: number;
  grossProfit: number;
  marginPct: number | null;
  /** Share of the store's net sales in the period, 0–100. */
  salesSharePct: number;
  /** Sales this employee rang up that were later voided (a high count is worth a conversation, not proof of anything). */
  voidedCount: number;
  voidedAmount: number;
}

export interface EmployeePerformance {
  totals: {
    transactionCount: number;
    netSales: number;
    grossProfit: number;
    voidedCount: number;
    voidedAmount: number;
  };
  /** Best net sales first; employees who only have voided sales are included at the bottom. */
  employees: EmployeePerformanceRow[];
}

/** Pure: combines the three SQL aggregates. Employees are matched by id; anyone with sales or voids appears. */
export function buildEmployeePerformance(
  sales: EmployeeSalesInput[],
  costs: EmployeeCostInput[],
  voids: EmployeeVoidInput[],
): EmployeePerformance {
  const costByUser = new Map(costs.map(row => [row.userId, row.cogs]));
  const salesByUser = new Map(sales.map(row => [row.userId, row]));
  const voidsByUser = new Map(voids.map(row => [row.userId, row]));
  const userIds = new Set([...salesByUser.keys(), ...voidsByUser.keys()]);

  const totalNet = round2(sales.reduce((sum, row) => sum + (row.grossSales - row.discounts), 0));

  const employees = [...userIds]
    .map((userId): EmployeePerformanceRow => {
      const sale = salesByUser.get(userId);
      const voided = voidsByUser.get(userId);
      const netSales = round2((sale?.grossSales ?? 0) - (sale?.discounts ?? 0));
      const transactionCount = sale?.transactionCount ?? 0;
      const grossProfit = round2(netSales - (costByUser.get(userId) ?? 0));
      return {
        userId,
        name: sale?.name ?? voided?.name ?? '',
        transactionCount,
        netSales,
        averageSale: transactionCount > 0 ? round2(netSales / transactionCount) : 0,
        discounts: round2(sale?.discounts ?? 0),
        grossProfit,
        marginPct: netSales > 0 ? round2((grossProfit / netSales) * 100) : null,
        salesSharePct: totalNet > 0 ? round2((netSales / totalNet) * 100) : 0,
        voidedCount: voided?.voidedCount ?? 0,
        voidedAmount: round2(voided?.voidedAmount ?? 0),
      };
    })
    .sort((a, b) => b.netSales - a.netSales || b.voidedCount - a.voidedCount || a.name.localeCompare(b.name));

  return {
    totals: {
      transactionCount: employees.reduce((sum, row) => sum + row.transactionCount, 0),
      netSales: totalNet,
      grossProfit: round2(employees.reduce((sum, row) => sum + row.grossProfit, 0)),
      voidedCount: employees.reduce((sum, row) => sum + row.voidedCount, 0),
      voidedAmount: round2(employees.reduce((sum, row) => sum + row.voidedAmount, 0)),
    },
    employees,
  };
}
