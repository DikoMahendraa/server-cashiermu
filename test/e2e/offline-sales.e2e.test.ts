/**
 * End-to-end: sales rung up offline and synced later (POST /transactions with an `offline` block).
 * Runs against the live local API with the first throwaway store (retail).
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, e2eEnv, ensureOwner, ensureShift } from './helpers';

const uid = () => randomUUID().slice(0, 8);
const headers = () => ({ 'Idempotency-Key': `e2e-${randomUUID()}` });

let token = '';
let shift = { id: '', openedHere: false };
let categoryId = '';
const productIds: string[] = [];

const makeProduct = async (overrides: Record<string, unknown> = {}) => {
  const res = await call(token, 'POST', '/products', {
    name: `E2E Off ${uid()}`,
    sku: `E2E-${uid()}`,
    categoryId,
    buyPrice: 2000,
    sellPrice: 7000,
    stock: 5,
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.data)).toBe(201);
  productIds.push(res.data.id);
  return res.data.id as string;
};

const sale = (
  productId: string,
  quantity: number,
  unitPrice: number,
  createdAt: Date | null,
  extra: Record<string, unknown> = {},
) => ({
  shiftId: shift.id,
  items: [{ productId, quantity, unitPrice, selectedVariants: [], note: '', itemDiscount: null }],
  payments: [{ method: 'transfer', amount: Math.round(unitPrice * quantity), reference: null }],
  customerName: '',
  note: '',
  ...(createdAt ? { offline: { createdAt: createdAt.toISOString(), receiptNumber: `OFF-${uid()}` } } : {}),
  ...extra,
});

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

beforeAll(async () => {
  token = await ensureOwner({ email: e2eEnv.email, phone: e2eEnv.phone, storeName: 'E2E Test Store' });
  expect(
    (
      await call(token, 'PATCH', '/store', {
        shiftEnabled: true,
        taxEnabled: false,
        serviceChargeEnabled: false,
        globalDiscountEnabled: false,
      })
    ).status,
  ).toBe(200);
  shift = await ensureShift(token);
  categoryId = (await call(token, 'GET', '/categories')).data[0].id;
});

afterAll(async () => {
  for (const id of productIds) await call(token, 'DELETE', `/products/${id}`);
  if (shift.openedHere) await call(token, 'POST', '/shifts/close', { closingBalance: 0, notes: 'e2e' });
});

describe('offline sync', () => {
  it('keeps the sale time and receipt number, assigns a real invoice number and is idempotent', async () => {
    const productId = await makeProduct();
    const createdAt = hoursAgo(3);
    const key = headers();
    const body = sale(productId, 1, 7000, createdAt);

    const first = await call(token, 'POST', '/transactions', body, key);
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    expect(new Date(first.data.createdAt).toISOString()).toBe(createdAt.toISOString());
    expect(first.data.syncedAt).toBeTruthy();
    expect(first.data.offlineReceiptNumber).toBe(body.offline!.receiptNumber);
    expect(first.data.invoiceNumber).toMatch(/^INV-/);
    expect(first.data.offlineIssues).toBeNull();

    const replay = await call(token, 'POST', '/transactions', body, key);
    expect([replay.status, replay.data.id]).toEqual([200, first.data.id]);
    expect((await call(token, 'GET', `/products/${productId}`)).data.stock).toBe(4); // decremented once
  });

  it('records a sale that makes stock negative and flags it; online the same sale is refused', async () => {
    const productId = await makeProduct({ stock: 1 });
    const online = await call(token, 'POST', '/transactions', sale(productId, 3, 7000, null), headers());
    expect([online.status, online.data.code]).toEqual([422, 'INSUFFICIENT_STOCK']);

    const res = await call(token, 'POST', '/transactions', sale(productId, 3, 7000, hoursAgo(1)), headers());
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(res.data.offlineIssues).toEqual([expect.objectContaining({ type: 'STOCK_NEGATIVE', productId, stock: -2 })]);
    expect((await call(token, 'GET', `/products/${productId}`)).data.stock).toBe(-2);
  });

  it('keeps the old price when the product was edited after the sale and flags the difference', async () => {
    const productId = await makeProduct();
    const saleTime = new Date(Date.now() - 5000);
    expect((await call(token, 'PATCH', `/products/${productId}`, { sellPrice: 8000 })).status).toBe(200);

    const online = await call(token, 'POST', '/transactions', sale(productId, 1, 7000, null), headers());
    expect([online.status, online.data.code]).toEqual([409, 'PRICE_CHANGED']);

    const res = await call(token, 'POST', '/transactions', sale(productId, 1, 7000, saleTime), headers());
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(Number(res.data.grandTotal)).toBe(7000);
    expect(res.data.offlineIssues).toEqual([
      expect.objectContaining({ type: 'PRICE_ADJUSTED', productId, clientUnitPrice: 7000, serverUnitPrice: 8000 }),
    ]);
  });

  it('refuses sales from the future or older than 30 days', async () => {
    const productId = await makeProduct();
    const future = await call(
      token,
      'POST',
      '/transactions',
      sale(productId, 1, 7000, new Date(Date.now() + 3_600_000)),
      headers(),
    );
    expect([future.status, future.data.code]).toEqual([422, 'OFFLINE_SALE_IN_FUTURE']);
    const old = await call(token, 'POST', '/transactions', sale(productId, 1, 7000, hoursAgo(24 * 31)), headers());
    expect([old.status, old.data.code]).toEqual([422, 'OFFLINE_SALE_TOO_OLD']);
    expect((await call(token, 'GET', `/products/${productId}`)).data.stock).toBe(5); // nothing was taken
  });

  it('rejects a malformed offline block', async () => {
    const productId = await makeProduct();
    const body = { ...sale(productId, 1, 7000, hoursAgo(1)), offline: { createdAt: 'not a date', receiptNumber: '' } };
    expect((await call(token, 'POST', '/transactions', body, headers())).status).toBe(422);
  });
});
