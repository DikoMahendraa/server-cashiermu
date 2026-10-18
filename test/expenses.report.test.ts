import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '../src/modules/expenses/expense.categories';
import { createExpenseSchema, updateExpenseSchema } from '../src/modules/expenses/expenses.schema';
import { buildEmployeePerformance } from '../src/modules/reports/employee.report';
import {
  MAX_EXPORT_ROWS,
  employeesTable,
  expensesTable,
  formatWib,
  safeCell,
  transactionsTable,
} from '../src/modules/reports/export.report';
import { buildProfitReport } from '../src/modules/reports/profit.report';

const sales = { transactionCount: 3, grossSales: 200000, discounts: 10000, taxCollected: 0, serviceChargeCollected: 0 };
const employeeSales = [{ userId: 'u1', name: 'Siti', transactionCount: 3, grossSales: 200000, discounts: 10000 }];
const costs = [{ userId: 'u1', cogs: 90000 }];

describe('expense categories', () => {
  it('has a label for every category and matches the Prisma enum', () => {
    for (const key of EXPENSE_CATEGORIES) expect(EXPENSE_CATEGORY_LABELS[key]).toBeTruthy();
    const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
    const block = /enum ExpenseCategory \{([^}]*)\}/.exec(schema)![1]!;
    expect(block.split(/\s+/).filter(Boolean)).toEqual([...EXPENSE_CATEGORIES]);
  });
});

describe('expense schemas', () => {
  const ok = { category: 'rent', amount: 1500000 };
  it('accepts a minimal expense and defaults the date to now', () => {
    const parsed = createExpenseSchema.parse(ok);
    expect(parsed.note).toBe('');
    expect(Math.abs(parsed.spentAt.getTime() - Date.now())).toBeLessThan(5000);
  });
  it('rejects bad amounts, categories and far-future dates', () => {
    expect(createExpenseSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...ok, amount: -5 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...ok, amount: 10.123 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...ok, category: 'stock' }).success).toBe(false);
    expect(
      createExpenseSchema.safeParse({ ...ok, spentAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }).success,
    ).toBe(false);
  });
  it('requires at least one change on update', () => {
    expect(updateExpenseSchema.safeParse({}).success).toBe(false);
    expect(updateExpenseSchema.safeParse({ branchId: null }).success).toBe(true);
    expect(updateExpenseSchema.safeParse({ note: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('net profit', () => {
  it('subtracts expenses from gross profit and reports them by category', () => {
    const report = buildProfitReport(
      sales,
      employeeSales,
      costs,
      [],
      [
        { category: 'rent', total: 50000 },
        { category: 'transport', total: 10000 },
      ],
    );
    expect(report).toMatchObject({ netSales: 190000, grossProfit: 100000, netProfit: 40000, netMarginPct: 21.05 });
    expect(report.expenses).toEqual({
      total: 60000,
      byCategory: [
        { category: 'rent', total: 50000 },
        { category: 'transport', total: 10000 },
      ],
    });
  });
  it('can be negative (a loss)', () => {
    const report = buildProfitReport(sales, employeeSales, costs, [], [{ category: 'rent', total: 130000 }]);
    expect(report.netProfit).toBe(-30000);
  });
  it('is null when expenses cannot be attributed (employee filter) and zero-expense stores equal gross profit', () => {
    const filtered = buildProfitReport(sales, employeeSales, costs, [], null);
    expect([filtered.expenses, filtered.netProfit, filtered.netMarginPct]).toEqual([null, null, null]);
    const none = buildProfitReport(sales, employeeSales, costs, []);
    expect([none.expenses?.total, none.netProfit]).toEqual([0, none.grossProfit]);
  });
});

describe('buildEmployeePerformance', () => {
  const performance = buildEmployeePerformance(
    [
      { userId: 'a', name: 'Siti', transactionCount: 2, grossSales: 150000, discounts: 0 },
      { userId: 'b', name: 'Budi', transactionCount: 1, grossSales: 50000, discounts: 0 },
    ],
    [
      { userId: 'a', cogs: 60000 },
      { userId: 'b', cogs: 30000 },
    ],
    [
      { userId: 'b', name: 'Budi', voidedCount: 2, voidedAmount: 40000 },
      { userId: 'c', name: 'Dewi', voidedCount: 1, voidedAmount: 10000 }, // only voids, no paid sales
    ],
  );
  it('ranks by net sales with averages, margin and share', () => {
    expect(performance.employees.map(e => e.name)).toEqual(['Siti', 'Budi', 'Dewi']);
    expect(performance.employees[0]).toMatchObject({
      transactionCount: 2,
      netSales: 150000,
      averageSale: 75000,
      grossProfit: 90000,
      marginPct: 60,
      salesSharePct: 75,
      voidedCount: 0,
    });
  });
  it('includes employees who only have voided sales, without dividing by zero', () => {
    expect(performance.employees[2]).toMatchObject({
      name: 'Dewi',
      transactionCount: 0,
      netSales: 0,
      averageSale: 0,
      marginPct: null,
      salesSharePct: 0,
      voidedCount: 1,
    });
  });
  it('totals add up', () => {
    expect(performance.totals).toEqual({
      transactionCount: 3,
      netSales: 200000,
      grossProfit: 110000,
      voidedCount: 3,
      voidedAmount: 50000,
    });
  });
  it('handles an empty period', () => {
    expect(buildEmployeePerformance([], [], [])).toEqual({
      totals: { transactionCount: 0, netSales: 0, grossProfit: 0, voidedCount: 0, voidedAmount: 0 },
      employees: [],
    });
  });
});

describe('export tables', () => {
  it('neutralises spreadsheet formulas in text but leaves numbers alone', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    for (const text of ['+1', '-2', '@SUM(A1)', '\tx']) expect(String(safeCell(text)).startsWith("'")).toBe(true);
    expect(safeCell('Budi')).toBe('Budi');
    expect(safeCell(-5000)).toBe(-5000);
  });
  it('formats dates in WIB', () => {
    expect(formatWib(new Date('2026-10-18T03:30:00Z'))).toBe('2026-10-18 10:30');
  });
  it('builds a transactions table with labels and safe cells', () => {
    const table = transactionsTable([
      {
        createdAt: new Date('2026-10-18T03:30:00Z'),
        invoiceNumber: 'INV-1',
        status: 'voided',
        cashier: 'Siti',
        branch: 'Pusat',
        customerName: '=cmd()',
        paymentMethods: ['qris', 'cash'],
        subtotal: 10000,
        discountAmount: 0,
        taxAmount: 0,
        serviceChargeAmount: 0,
        grandTotal: 10000,
      },
    ]);
    expect(table.headers).toHaveLength(table.rows[0]!.length);
    expect(table.rows[0]).toEqual([
      '2026-10-18 10:30',
      'INV-1',
      'Dibatalkan',
      'Siti',
      'Pusat',
      "'=cmd()",
      'QRIS, Tunai',
      10000,
      0,
      0,
      0,
      10000,
    ]);
    expect(table.truncated).toBe(false);
  });
  it('marks a table as truncated when more rows matched than the cap', () => {
    const table = expensesTable([], MAX_EXPORT_ROWS + 1);
    expect(table.truncated).toBe(true);
  });
  it('builds expenses and employees tables whose rows match their headers', () => {
    const expenses = expensesTable([
      {
        spentAt: new Date('2026-10-18T03:30:00Z'),
        category: 'rent',
        amount: 100,
        note: '',
        branch: null,
        recordedBy: 'Owner',
      },
    ]);
    expect(expenses.rows[0]).toEqual(['2026-10-18', 'Sewa', 100, '', 'Semua cabang', 'Owner']);
    const employees = employeesTable(buildEmployeePerformance(employeeSales, costs, []));
    expect(employees.headers).toHaveLength(employees.rows[0]!.length);
  });
});
