/**
 * End-to-end: cost snapshot + profit report, trackStock, and per-store SKU/barcode uniqueness.
 * Run with the local API up: `npm run test:e2e`.
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, e2eEnv, ensureOwner, ensureShift } from './helpers';

const STORE_1 = 'E2E Test Store';
const STORE_2 = 'E2E Test Store 2';
const uid = () => randomUUID().slice(0, 8);

let t1 = ''; // owner token, store 1
let t2 = ''; // owner token, store 2
let shift1 = { id: '', openedHere: false };
let categoryId = '';
let category2Id = '';
const createdProductIds: string[] = [];

async function createProduct(token: string, catId: string, overrides: Record<string, unknown> = {}) {
  const res = await call(token, 'POST', '/products', {
    name: `E2E ${uid()}`,
    sku: `E2E-${uid()}`,
    categoryId: catId,
    buyPrice: 4000,
    sellPrice: 10000,
    stock: 100,
    ...overrides,
  });
  if (res.status === 201 && token === t1) createdProductIds.push(res.data.id);
  return res;
}

const sale = (productId: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) => ({
  shiftId: shift1.id,
  items: [{ productId, quantity, unitPrice, selectedVariants: [], note: '', itemDiscount: null }],
  payments: [{ method: 'transfer', amount: unitPrice * quantity, reference: null }],
  customerName: '',
  note: '',
  ...extra,
});

const checkout = (body: unknown) =>
  call(t1, 'POST', '/transactions', body, { 'Idempotency-Key': `e2e-${randomUUID()}` });
const stockOf = async (id: string): Promise<number> => (await call(t1, 'GET', `/products/${id}`)).data.stock;

beforeAll(async () => {
  t1 = await ensureOwner({ email: e2eEnv.email, phone: e2eEnv.phone, storeName: STORE_1 });
  t2 = await ensureOwner({ email: e2eEnv.email2, phone: e2eEnv.phone2, storeName: STORE_2 });
  // known config so totals are predictable
  await call(t1, 'PATCH', '/store', {
    taxEnabled: false,
    serviceChargeEnabled: false,
    globalDiscountEnabled: false,
    shiftEnabled: true,
  });
  shift1 = await ensureShift(t1);
  categoryId = (await call(t1, 'GET', '/categories')).data[0].id;
  category2Id = (await call(t2, 'GET', '/categories')).data[0].id;
});

afterAll(async () => {
  for (const id of createdProductIds) await call(t1, 'DELETE', `/products/${id}`);
  if (shift1.openedHere) await call(t1, 'POST', '/shifts/close', { closingBalance: 0, notes: 'e2e' });
});

describe('cost snapshot', () => {
  it("stores the buy price on the sale line and keeps it when the product's buy price changes later", async () => {
    const product = (await createProduct(t1, categoryId, { buyPrice: 4000 })).data;
    const first = await checkout(sale(product.id, 1, 10000));
    expect(first.status, JSON.stringify(first.data)).toBe(201);

    await call(t1, 'PATCH', `/products/${product.id}`, { buyPrice: 7000 });
    const second = await checkout(sale(product.id, 1, 10000));
    expect(second.status).toBe(201);

    const costs = await Promise.all(
      [first, second].map(async r =>
        Number((await call(t1, 'GET', `/transactions/${r.data.id}`)).data.items[0].costPrice),
      ),
    );
    expect(costs).toEqual([4000, 7000]);
  });
});

describe('profit report', () => {
  it('computes net sales, COGS and profit for a window, excluding tax and voided sales', async () => {
    const product = (await createProduct(t1, categoryId, { name: 'E2E Profit Item', buyPrice: 4000, sellPrice: 10000 }))
      .data;
    // Start the window strictly after the previous tests' sales so only this test's sales are counted.
    await new Promise(resolve => setTimeout(resolve, 25));
    const from = new Date().toISOString();

    const a = await checkout(sale(product.id, 2, 10000)); // 20.000 sales, 8.000 cost
    const b = await checkout({
      ...sale(product.id, 1, 10000, { payments: [{ method: 'transfer', amount: 9000, reference: null }] }),
      discount: { type: 'percent', value: 10, label: 'E2E 10%' }, // 9.000 net, 4.000 cost
    });
    const voided = await checkout(sale(product.id, 5, 10000)); // must NOT count
    expect([a.status, b.status, voided.status], JSON.stringify([a.data, b.data, voided.data])).toEqual([201, 201, 201]);
    const voidRes = await call(t1, 'POST', `/transactions/${voided.data.id}/void`, {
      ownerPin: e2eEnv.pin,
      reason: 'e2e',
    });
    expect(voidRes.status, JSON.stringify(voidRes.data)).toBe(200);

    const to = new Date(Date.now() + 60_000).toISOString();
    const res = await call(t1, 'GET', `/reports/profit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(res.status, JSON.stringify(res.data)).toBe(200);

    expect(res.data).toMatchObject({
      transactionCount: 2,
      grossSales: 30000,
      discounts: 1000,
      netSales: 29000,
      cogs: 12000,
      grossProfit: 17000,
      marginPct: 58.62,
      taxCollected: 0,
    });
    expect(res.data.byEmployee).toHaveLength(1);
    expect(res.data.byEmployee[0]).toMatchObject({
      name: 'E2E Owner',
      transactionCount: 2,
      netSales: 29000,
      cogs: 12000,
      grossProfit: 17000,
    });
    expect(res.data.topProducts[0]).toMatchObject({
      productName: 'E2E Profit Item',
      quantity: 3,
      revenue: 30000,
      cogs: 12000,
      profit: 18000,
    });
  });

  it("is scoped to the caller's store and validates its query", async () => {
    const other = await call(t2, 'GET', '/reports/profit');
    expect(other.status).toBe(200);
    expect(other.data.transactionCount).toBe(0); // store 2 never sold anything

    const bad = await call(t1, 'GET', '/reports/profit?from=banana');
    expect([bad.status, bad.data.code]).toEqual([422, 'INVALID_QUERY']);
    expect((await call('', 'GET', '/reports/profit')).status).toBe(401);
  });
});

describe('trackStock', () => {
  it('sells an untracked product with zero stock, never changes its stock, and rejects stock adjustments', async () => {
    const service = (
      await createProduct(t1, categoryId, {
        name: 'E2E Service',
        stock: 0,
        trackStock: false,
        buyPrice: 5000,
        sellPrice: 30000,
      })
    ).data;
    expect(service.trackStock).toBe(false);

    const res = await checkout(sale(service.id, 5, 30000));
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(await stockOf(service.id)).toBe(0);

    const adjust = await call(t1, 'PATCH', `/products/${service.id}/stock`, { adjustment: 10 });
    expect([adjust.status, adjust.data.code]).toEqual([422, 'STOCK_NOT_TRACKED']);

    const listed = (await call(t1, 'GET', '/products?isActive=true')).data.find(
      (p: { id: string }) => p.id === service.id,
    );
    expect(listed.stockStatus).toBe('safe'); // untracked items are never "empty"
  });

  it('voiding gives stock back only for tracked products', async () => {
    const tracked = (await createProduct(t1, categoryId, { stock: 10 })).data;
    const untracked = (await createProduct(t1, categoryId, { stock: 0, trackStock: false })).data;

    const res = await checkout({
      shiftId: shift1.id,
      items: [
        { productId: tracked.id, quantity: 3, unitPrice: 10000, selectedVariants: [], note: '', itemDiscount: null },
        { productId: untracked.id, quantity: 2, unitPrice: 10000, selectedVariants: [], note: '', itemDiscount: null },
      ],
      payments: [{ method: 'transfer', amount: 50000, reference: null }],
      customerName: '',
      note: '',
    });
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(await stockOf(tracked.id)).toBe(7);

    const voidRes = await call(t1, 'POST', `/transactions/${res.data.id}/void`, {
      ownerPin: e2eEnv.pin,
      reason: 'e2e',
    });
    expect(voidRes.status).toBe(200);
    expect(await stockOf(tracked.id)).toBe(10);
    expect(await stockOf(untracked.id)).toBe(0);
  });
});

describe('SKU and barcode are unique per store', () => {
  it('rejects a duplicate SKU or barcode inside one store with a clear code', async () => {
    const sku = `E2E-${uid()}`;
    const barcode = `899${Date.now()}`;
    expect((await createProduct(t1, categoryId, { sku, barcode })).status).toBe(201);

    const dupSku = await createProduct(t1, categoryId, { sku });
    expect([dupSku.status, dupSku.data.code]).toEqual([409, 'SKU_TAKEN']);
    const dupBarcode = await createProduct(t1, categoryId, { barcode });
    expect([dupBarcode.status, dupBarcode.data.code]).toEqual([409, 'BARCODE_TAKEN']);
  });

  it('lets another store use the same SKU and barcode, and keeps the stores isolated', async () => {
    const sku = `E2E-${uid()}`;
    const barcode = `898${Date.now()}`;
    const mine = await createProduct(t1, categoryId, { sku, barcode });
    expect(mine.status).toBe(201);

    const theirs = await createProduct(t2, category2Id, { sku, barcode });
    expect(theirs.status, JSON.stringify(theirs.data)).toBe(201);

    expect((await call(t2, 'GET', `/products/${mine.data.id}`)).status).toBe(404);
    expect((await call(t1, 'GET', `/products/${theirs.data.id}`)).status).toBe(404);
    await call(t2, 'DELETE', `/products/${theirs.data.id}`);
  });
});
