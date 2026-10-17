/**
 * End-to-end checkout against a running local API (`npm run dev`, then `npm run test:e2e`).
 * Uses the throwaway E2E_* account from .env.example (registered on first run) and its own
 * product, so it never touches real store data. Payloads match what the mobile app sends.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function e2eEnv(): Record<string, string> {
  const fromExample = Object.fromEntries(
    readFileSync(join(__dirname, '../../.env.example'), 'utf8')
      .split('\n')
      .filter(line => line.startsWith('E2E_'))
      .map(line => line.split('=', 2) as [string, string]),
  );
  const pick = (k: string) => process.env[k] ?? fromExample[k];
  return { url: pick('E2E_API_URL'), email: pick('E2E_EMAIL'), phone: pick('E2E_PHONE'), pin: pick('E2E_PIN') };
}

const env = e2eEnv();
const host = new URL(env.url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`E2E checkout must run against a local API, got ${env.url}`);
}

let token = '';

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${env.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null };
}

const key = () => `e2e-${randomUUID()}`;

let shiftId = '';
let productId = '';
let openedShiftHere = false;
const PRICE = 15000;

const line = (unitPrice = PRICE, quantity = 1) => ({
  productId,
  quantity,
  unitPrice,
  subtotal: unitPrice * quantity,
  note: '',
  selectedVariants: [],
  itemDiscount: null,
});
const sale = (items: unknown[], payments: unknown[]) => ({ shiftId, items, payments, customerName: '', note: '' });

async function stock(): Promise<number> {
  const res = await call('GET', `/products/${productId}`);
  return res.data.stock;
}

beforeAll(async () => {
  let login = await call('POST', '/auth/login', { credential: env.email, pin: env.pin });
  if (login.status === 401) {
    const reg = await call('POST', '/auth/register', {
      storeName: 'E2E Test Store',
      ownerName: 'E2E Owner',
      email: env.email,
      phone: env.phone,
      pin: env.pin,
      pinConfirm: env.pin,
    });
    expect(reg.status, JSON.stringify(reg.data)).toBe(201);
    login = await call('POST', '/auth/login', { credential: env.email, pin: env.pin });
  }
  expect(login.status, JSON.stringify(login.data)).toBe(200);
  token = login.data.accessToken;
  expect(login.data.store.name).toBe('E2E Test Store'); // guard: never run against a real store

  // Known store config so totals are predictable.
  const store = await call('PATCH', '/store', {
    taxEnabled: false,
    serviceChargeEnabled: false,
    globalDiscountEnabled: false,
    shiftEnabled: true,
  });
  expect(store.status).toBe(200);

  const current = await call('GET', '/shifts/current');
  if (current.data) {
    shiftId = current.data.id;
  } else {
    const branches = await call('GET', '/branches');
    const opened = await call('POST', '/shifts/open', {
      type: 'pagi',
      openingBalance: 0,
      branchId: branches.data[0].id,
    });
    expect(opened.status, JSON.stringify(opened.data)).toBe(201);
    shiftId = opened.data.id;
    openedShiftHere = true;
  }

  const categories = await call('GET', '/categories');
  const product = await call('POST', '/products', {
    name: 'E2E Kopi',
    sku: `E2E-${randomUUID().slice(0, 8)}`,
    categoryId: categories.data[0].id,
    buyPrice: 8000,
    sellPrice: PRICE,
    stock: 10,
  });
  expect(product.status, JSON.stringify(product.data)).toBe(201);
  productId = product.data.id;
});

afterAll(async () => {
  if (productId) await call('DELETE', `/products/${productId}`);
  if (openedShiftHere) await call('POST', '/shifts/close', { closingBalance: 0, notes: 'e2e' });
});

describe('checkout e2e', () => {
  it('cash sale: server totals, change, applied cash amount, stock and shift totals', async () => {
    const before = await call('GET', '/shifts/current');
    const res = await call(
      'POST',
      '/transactions',
      sale([line()], [{ method: 'cash', amount: 20000, reference: null }]),
      { 'Idempotency-Key': key() },
    );

    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(Number(res.data.grandTotal)).toBe(15000);
    expect(Number(res.data.cashPaid)).toBe(20000);
    expect(Number(res.data.changeAmount)).toBe(5000);
    expect(res.data.payments.map((p: any) => [p.method, Number(p.amount)])).toEqual([['cash', 15000]]);
    expect(await stock()).toBe(9);

    const after = await call('GET', '/shifts/current');
    expect(Number(after.data.cashSalesTotal) - Number(before.data.cashSalesTotal)).toBe(15000);
    expect(after.data.transactionCount - before.data.transactionCount).toBe(1);
  });

  it('retry with the same Idempotency-Key returns the original sale without charging again', async () => {
    const k = key();
    const body = sale([line()], [{ method: 'qris', amount: PRICE, reference: null }]);
    const first = await call('POST', '/transactions', body, { 'Idempotency-Key': k });
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    const stockAfterFirst = await stock();

    const retry = await call('POST', '/transactions', body, { 'Idempotency-Key': k });
    expect(retry.status).toBe(200);
    expect(retry.headers.get('idempotent-replayed')).toBe('true');
    expect(retry.data.id).toBe(first.data.id);
    expect(retry.data.invoiceNumber).toBe(first.data.invoiceNumber);
    expect(await stock()).toBe(stockAfterFirst);
  });

  it('concurrent requests with the same key create exactly one sale', async () => {
    const k = key();
    const body = sale([line()], [{ method: 'qris', amount: PRICE, reference: null }]);
    const stockBefore = await stock();
    const results = await Promise.all(
      [1, 2, 3].map(() => call('POST', '/transactions', body, { 'Idempotency-Key': k })),
    );

    expect(results.map(r => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map(r => r.data.id)).size).toBe(1);
    expect(await stock()).toBe(stockBefore - 1);
  });

  it('accepts the same product on two lines (was rejected before)', async () => {
    const stockBefore = await stock();
    const res = await call(
      'POST',
      '/transactions',
      sale([line(PRICE, 1), line(PRICE, 2)], [{ method: 'transfer', amount: PRICE * 3, reference: null }]),
      { 'Idempotency-Key': key() },
    );
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(await stock()).toBe(stockBefore - 3);
  });

  it('rejects a stale price with PRICE_CHANGED and the line index the app maps back', async () => {
    const patched = await call('PATCH', `/products/${productId}`, { sellPrice: 17000 });
    expect(patched.status).toBe(200);
    const stockBefore = await stock();

    const res = await call(
      'POST',
      '/transactions',
      sale([line(PRICE)], [{ method: 'cash', amount: 20000, reference: null }]),
      { 'Idempotency-Key': key() },
    );
    expect(res.status).toBe(409);
    expect(res.data.code).toBe('PRICE_CHANGED');
    expect(res.data.details).toEqual([
      { index: 0, productId, productName: 'E2E Kopi', clientUnitPrice: PRICE, unitPrice: 17000 },
    ]);
    expect(await stock()).toBe(stockBefore);

    // What the app does next: apply the server price and pay again with a new key.
    const repaid = await call(
      'POST',
      '/transactions',
      sale([line(17000)], [{ method: 'cash', amount: 20000, reference: null }]),
      { 'Idempotency-Key': key() },
    );
    expect(repaid.status, JSON.stringify(repaid.data)).toBe(201);
    expect(Number(repaid.data.grandTotal)).toBe(17000);
  });

  it('rejects insufficient stock, underpayment and an invalid key without side effects', async () => {
    const stockBefore = await stock();
    const price = 17000;

    const noStock = await call(
      'POST',
      '/transactions',
      sale([line(price, 999)], [{ method: 'qris', amount: price * 999, reference: null }]),
      { 'Idempotency-Key': key() },
    );
    expect([noStock.status, noStock.data.code]).toEqual([422, 'INSUFFICIENT_STOCK']);

    const underpaid = await call(
      'POST',
      '/transactions',
      sale([line(price)], [{ method: 'cash', amount: 1000, reference: null }]),
      { 'Idempotency-Key': key() },
    );
    expect([underpaid.status, underpaid.data.code]).toEqual([422, 'INSUFFICIENT_PAYMENT']);

    const badKey = await call(
      'POST',
      '/transactions',
      sale([line(price)], [{ method: 'qris', amount: price, reference: null }]),
      { 'Idempotency-Key': 'bad key!' },
    );
    expect([badKey.status, badKey.data.code]).toEqual([422, 'INVALID_IDEMPOTENCY_KEY']);

    expect(await stock()).toBe(stockBefore);
  });

  it('rejects a shift id that is not open for this user', async () => {
    const res = await call(
      'POST',
      '/transactions',
      { ...sale([line(17000)], [{ method: 'qris', amount: 17000, reference: null }]), shiftId: randomUUID() },
      { 'Idempotency-Key': key() },
    );
    expect([res.status, res.data.code]).toEqual([422, 'SHIFT_NOT_OPEN']);
  });
});
