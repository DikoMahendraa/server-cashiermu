/**
 * End-to-end: in-app account deletion (Google Play requirement). Registers a brand-new throwaway store each run,
 * fills it with linked data (shift, product, sale, expense), deletes it with the owner's PIN and checks it is gone.
 * It never touches the shared e2e stores. Run with the local API up.
 */
import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { call, ensureShift } from './helpers';

const PIN = '482915';

async function registerFreshStore() {
  const id = randomUUID().slice(0, 8);
  const email = `delete-${id}@e2e.cashiermu.test`;
  const phone = `0899${Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, '0')}`;
  const reg = await call('', 'POST', '/auth/register', {
    storeName: `E2E Delete ${id}`,
    ownerName: 'E2E Owner',
    email,
    phone,
    pin: PIN,
    pinConfirm: PIN,
  });
  expect(reg.status, JSON.stringify(reg.data)).toBe(201);
  return { email, token: reg.data.accessToken as string };
}

describe('delete account', () => {
  it('requires login', async () => {
    expect((await call('', 'POST', '/store/delete-account', { pin: PIN })).status).toBe(401);
  });

  it('rejects a wrong PIN and keeps the store', async () => {
    const { token } = await registerFreshStore();
    const res = await call(token, 'POST', '/store/delete-account', { pin: '000000' });
    expect(res.status).toBe(401);
    expect((await call(token, 'GET', '/store')).status).toBe(200);
  });

  it('rejects a malformed PIN', async () => {
    const { token } = await registerFreshStore();
    expect((await call(token, 'POST', '/store/delete-account', { pin: '12' })).status).toBe(422);
  });

  it('erases the store with all linked data, and the owner can no longer log in', async () => {
    const { email, token } = await registerFreshStore();

    // Linked data in every table that points at the store: shift, product, sale (items + payments), expense
    const shift = await ensureShift(token);
    const category = (await call(token, 'GET', '/categories')).data[0].id;
    const product = await call(token, 'POST', '/products', {
      name: 'E2E Delete Product',
      sku: `DEL-${randomUUID().slice(0, 8)}`,
      categoryId: category,
      buyPrice: 3000,
      sellPrice: 7000,
      stock: 0,
      trackStock: false,
    });
    expect(product.status, JSON.stringify(product.data)).toBe(201);
    const sale = await call(
      token,
      'POST',
      '/transactions',
      {
        shiftId: shift.id,
        items: [
          {
            productId: product.data.id,
            quantity: 1,
            unitPrice: 7000,
            selectedVariants: [],
            note: '',
            itemDiscount: null,
          },
        ],
        payments: [{ method: 'cash', amount: 7000, reference: null }],
        customerName: '',
        note: '',
      },
      { 'Idempotency-Key': `e2e-${randomUUID()}` },
    );
    expect(sale.status, JSON.stringify(sale.data)).toBe(201);
    const expense = await call(token, 'POST', '/expenses', {
      category: 'rent',
      amount: 1000,
      spentAt: new Date().toISOString(),
    });
    expect(expense.status, JSON.stringify(expense.data)).toBe(201);

    const del = await call(token, 'POST', '/store/delete-account', { pin: PIN });
    expect(del.status, JSON.stringify(del.data)).toBe(200);

    const login = await call('', 'POST', '/auth/login', { credential: email, pin: PIN });
    expect(login.status).toBe(401);
    // The old access token can no longer read the store
    expect((await call(token, 'GET', '/store')).status).toBe(404);
  });
});
