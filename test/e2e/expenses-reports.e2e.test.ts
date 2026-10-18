/**
 * End-to-end: expenses, net profit, employee performance and table exports against the live local API.
 * Expense data uses a fixed month in 2020 so it never mixes with real or other tests' data.
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, e2eEnv, ensureOwner, ensureShift } from './helpers';

const uid = () => randomUUID().slice(0, 8);
const WINDOW = 'from=2020-03-01T00:00:00%2B07:00&to=2020-03-31T23:59:59%2B07:00';
const SPENT = '2020-03-15T12:00:00+07:00';
const headers = () => ({ 'Idempotency-Key': `e2e-${randomUUID()}` });

let t1 = '';
let t3 = '';
let shift = { id: '', openedHere: false };
let productId = '';
let userId = '';
const expenseIds: string[] = [];

const addExpense = async (body: Record<string, unknown>, token = t1) => {
  const res = await call(token, 'POST', '/expenses', { category: 'rent', amount: 1000, spentAt: SPENT, ...body });
  if (res.status === 201) expenseIds.push(res.data.id);
  return res;
};

beforeAll(async () => {
  t1 = await ensureOwner({ email: e2eEnv.email, phone: e2eEnv.phone, storeName: 'E2E Test Store' });
  t3 = await ensureOwner({ email: e2eEnv.email3, phone: e2eEnv.phone3, storeName: 'E2E Test Store Craft' });
  expect((await call(t1, 'PATCH', '/store', { shiftEnabled: true })).status).toBe(200);
  const me = await call(t1, 'GET', '/auth/me');
  userId = me.data.id ?? me.data.user?.id;
  expect(userId, JSON.stringify(Object.keys(me.data))).toBeTruthy();
  shift = await ensureShift(t1);
  const category = (await call(t1, 'GET', '/categories')).data[0].id;
  const product = await call(t1, 'POST', '/products', {
    name: `E2E Exp ${uid()}`,
    sku: `E2E-${uid()}`,
    categoryId: category,
    buyPrice: 2000,
    sellPrice: 7000,
    stock: 5,
  });
  expect(product.status, JSON.stringify(product.data)).toBe(201);
  productId = product.data.id;
});

afterAll(async () => {
  for (const id of expenseIds) await call(t1, 'DELETE', `/expenses/${id}`);
  if (productId) await call(t1, 'DELETE', `/products/${productId}`);
  if (shift.openedHere) await call(t1, 'POST', '/shifts/close', { closingBalance: 0, notes: 'e2e' });
});

describe('expenses CRUD', () => {
  it('requires login', async () => {
    expect((await call('', 'GET', '/expenses')).status).toBe(401);
  });

  it('creates, lists with totals by category, updates and deletes', async () => {
    const rent = await addExpense({ category: 'rent', amount: 500000, note: 'Sewa Maret' });
    expect(rent.status, JSON.stringify(rent.data)).toBe(201);
    expect(rent.data).toMatchObject({ category: 'rent', categoryLabel: 'Sewa', amount: 500000, note: 'Sewa Maret' });
    const transport = await addExpense({ category: 'transport', amount: 25000 });
    expect(transport.status).toBe(201);

    const list = await call(t1, 'GET', `/expenses?${WINDOW}`);
    expect(list.status).toBe(200);
    expect(list.data).toMatchObject({ total: 525000, count: 2, truncated: false });
    expect(list.data.byCategory.map((c: { category: string }) => c.category)).toEqual(['rent', 'transport']);
    expect((await call(t1, 'GET', `/expenses?${WINDOW}&category=transport`)).data.total).toBe(25000);

    const patched = await call(t1, 'PATCH', `/expenses/${transport.data.id}`, { amount: 30000, note: 'Bensin' });
    expect(patched.data).toMatchObject({ amount: 30000, note: 'Bensin' });

    const extra = await addExpense({ amount: 1 });
    expect((await call(t1, 'DELETE', `/expenses/${extra.data.id}`)).status).toBe(204);
    expect((await call(t1, 'DELETE', `/expenses/${extra.data.id}`)).status).toBe(404);
  });

  it('validates input', async () => {
    expect((await addExpense({ amount: 0 })).status).toBe(422);
    expect((await addExpense({ category: 'stock' })).status).toBe(422);
    expect((await addExpense({ spentAt: new Date(Date.now() + 10 * 86_400_000).toISOString() })).status).toBe(422);
    expect((await call(t1, 'PATCH', `/expenses/${expenseIds[0]}`, {})).status).toBe(422);
    expect((await call(t1, 'GET', '/expenses?from=yesterday')).status).toBe(422);
  });

  it('keeps stores apart and rejects another store’s branch', async () => {
    const id = expenseIds[0]!;
    expect((await call(t3, 'PATCH', `/expenses/${id}`, { amount: 1 })).status).toBe(404);
    expect((await call(t3, 'DELETE', `/expenses/${id}`)).status).toBe(404);
    expect((await call(t3, 'GET', `/expenses?${WINDOW}`)).data.count).toBe(0);

    const foreignBranch = (await call(t3, 'GET', '/branches')).data[0].id;
    const res = await addExpense({ branchId: foreignBranch });
    expect([res.status, res.data.code]).toEqual([422, 'BRANCH_NOT_FOUND']);
  });
});

describe('net profit', () => {
  it('is gross profit minus expenses (a loss in a month with no sales)', async () => {
    const report = await call(t1, 'GET', `/reports/profit?${WINDOW}`);
    expect(report.status).toBe(200);
    expect(report.data).toMatchObject({ netSales: 0, grossProfit: 0, netProfit: -530000 });
    expect(report.data.expenses.total).toBe(530000);
  });

  it('is null when filtered by employee', async () => {
    const report = await call(t1, 'GET', `/reports/profit?${WINDOW}&userId=${userId}`);
    expect(report.data.expenses).toBeNull();
    expect(report.data.netProfit).toBeNull();
  });
});

describe('employee performance and exports', () => {
  let invoiceNumber = '';

  beforeAll(async () => {
    const sale = await call(
      t1,
      'POST',
      '/transactions',
      {
        shiftId: shift.id,
        items: [{ productId, quantity: 1, unitPrice: 7000, selectedVariants: [], note: '', itemDiscount: null }],
        payments: [{ method: 'transfer', amount: 7000, reference: null }],
        customerName: '=HYPERLINK("http://evil.example")',
        note: '',
      },
      headers(),
    );
    expect(sale.status, JSON.stringify(sale.data)).toBe(201);
    invoiceNumber = sale.data.invoiceNumber;
  });

  const recent = () => `from=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`;

  it('ranks employees with sales, average and margin', async () => {
    const res = await call(t1, 'GET', `/reports/employee-performance?${recent()}`);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    const me = res.data.employees.find((e: { userId: string }) => e.userId === userId);
    expect(me.transactionCount).toBeGreaterThanOrEqual(1);
    expect(me.netSales).toBeGreaterThanOrEqual(7000);
    expect(me.averageSale).toBeGreaterThan(0);
    expect(res.data.totals.netSales).toBeGreaterThanOrEqual(7000);
    expect((await call(t1, 'GET', `/reports/employee-performance?${WINDOW}`)).data.employees).toEqual([]);
  });

  it('exports transactions as a table with formulas neutralised', async () => {
    const res = await call(t1, 'GET', `/reports/export/transactions?${recent()}`);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.headers).toHaveLength(res.data.rows[0].length);
    const row = res.data.rows.find((r: string[]) => r[1] === invoiceNumber);
    expect(row).toBeTruthy();
    expect(row[5]).toBe(`'=HYPERLINK("http://evil.example")`);
    expect(row[7]).toBe(7000);
  });

  it('exports expenses and employees, and rejects unknown datasets', async () => {
    const expenses = await call(t1, 'GET', `/reports/export/expenses?${WINDOW}`);
    expect(expenses.data.rows.map((r: (string | number)[]) => r[1])).toContain('Sewa');
    expect(expenses.data.rows.every((r: (string | number)[]) => String(r[0]).startsWith('2020-03-'))).toBe(true);
    expect((await call(t1, 'GET', `/reports/export/employees?${recent()}`)).data.rows.length).toBeGreaterThan(0);
    expect((await call(t1, 'GET', '/reports/export/secrets')).status).toBe(404);
    expect((await call(t1, 'GET', '/reports/export/expenses?to=nope')).status).toBe(422);
    expect((await call('', 'GET', '/reports/export/expenses')).status).toBe(401);
  });
});
