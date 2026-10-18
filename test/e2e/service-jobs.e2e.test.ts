/**
 * End-to-end: service job tracking (customer phone, ETA, job status) and the public receipt page.
 * Store 3 is a service business (laundry), store 1 is a plain retail store. Run with the local API up.
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, e2eEnv, ensureOwner, ensureShift } from './helpers';

const uid = () => randomUUID().slice(0, 8);
const origin = new URL(e2eEnv.url).origin;
const headers = () => ({ 'Idempotency-Key': `e2e-${randomUUID()}` });

let t3 = '';
let t1 = '';
let shift3 = { id: '', openedHere: false };
let shift1 = { id: '', openedHere: false };
let serviceProductId = '';
let retailProductId = '';

const sale = (shiftId: string, productId: string, extra: Record<string, unknown> = {}) => ({
  shiftId,
  items: [{ productId, quantity: 1, unitPrice: 7000, selectedVariants: [], note: '', itemDiscount: null }],
  payments: [{ method: 'transfer', amount: 7000, reference: null }],
  customerName: '',
  note: '',
  ...extra,
});

const createProduct = async (token: string) => {
  const category = (await call(token, 'GET', '/categories')).data[0].id;
  const res = await call(token, 'POST', '/products', {
    name: `E2E Job ${uid()}`,
    sku: `E2E-${uid()}`,
    categoryId: category,
    buyPrice: 3000,
    sellPrice: 7000,
    stock: 0,
    trackStock: false,
  });
  expect(res.status, JSON.stringify(res.data)).toBe(201);
  return res.data.id as string;
};

beforeAll(async () => {
  t3 = await ensureOwner({
    email: e2eEnv.email3,
    phone: e2eEnv.phone3,
    storeName: 'E2E Test Store Craft',
    sector: 'service',
    subtype: 'laundry',
  });
  t1 = await ensureOwner({ email: e2eEnv.email, phone: e2eEnv.phone, storeName: 'E2E Test Store' });
  expect(
    (await call(t3, 'PATCH', '/store', { sector: 'service', subtype: 'laundry', shiftEnabled: true })).status,
  ).toBe(200);
  expect(
    (await call(t1, 'PATCH', '/store', { sector: 'general', subtype: 'default', shiftEnabled: true })).status,
  ).toBe(200);
  shift3 = await ensureShift(t3);
  shift1 = await ensureShift(t1);
  serviceProductId = await createProduct(t3);
  retailProductId = await createProduct(t1);
});

afterAll(async () => {
  await call(t3, 'DELETE', `/products/${serviceProductId}`);
  await call(t1, 'DELETE', `/products/${retailProductId}`);
  if (shift3.openedHere) await call(t3, 'POST', '/shifts/close', { closingBalance: 0, notes: 'e2e' });
  if (shift1.openedHere) await call(t1, 'POST', '/shifts/close', { closingBalance: 0, notes: 'e2e' });
});

describe('job fields at checkout', () => {
  it('a service sale starts as a pending job with phone and ETA', async () => {
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await call(
      t3,
      'POST',
      '/transactions',
      sale(shift3.id, serviceProductId, { customerName: 'Budi', customerPhone: '0812-3456-7890', dueAt }),
      headers(),
    );
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(res.data).toMatchObject({ jobStatus: 'pending', customerName: 'Budi', customerPhone: '0812-3456-7890' });
    expect(new Date(res.data.dueAt).toISOString()).toBe(dueAt);
    expect(res.data.jobUpdatedAt).toBeTruthy();
    expect(res.data.receiptToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it('a retail sale is not a job: phone/ETA are ignored and jobStatus stays null', async () => {
    const res = await call(
      t1,
      'POST',
      '/transactions',
      sale(shift1.id, retailProductId, { dueAt: new Date().toISOString() }),
      headers(),
    );
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect(res.data.jobStatus).toBeNull();
    expect(res.data.dueAt).toBeNull();
  });

  it('rejects a malformed phone number', async () => {
    const res = await call(
      t3,
      'POST',
      '/transactions',
      sale(shift3.id, serviceProductId, { customerPhone: 'abc123' }),
      headers(),
    );
    expect(res.status).toBe(422);
  });
});

describe('PATCH /transactions/:id/job', () => {
  let id = '';
  let retailId = '';

  beforeAll(async () => {
    id = (
      await call(t3, 'POST', '/transactions', sale(shift3.id, serviceProductId, { customerName: 'Sari' }), headers())
    ).data.id;
    retailId = (await call(t1, 'POST', '/transactions', sale(shift1.id, retailProductId), headers())).data.id;
  });

  it('moves the job through its stages and stamps jobUpdatedAt', async () => {
    const before = (await call(t3, 'GET', `/transactions/${id}`)).data.jobUpdatedAt;
    await new Promise(resolve => setTimeout(resolve, 20));
    const progress = await call(t3, 'PATCH', `/transactions/${id}/job`, { jobStatus: 'in_progress' });
    expect(progress.status, JSON.stringify(progress.data)).toBe(200);
    expect(progress.data.jobStatus).toBe('in_progress');
    expect(new Date(progress.data.jobUpdatedAt).getTime()).toBeGreaterThan(new Date(before).getTime());

    const ready = await call(t3, 'PATCH', `/transactions/${id}/job`, {
      jobStatus: 'ready',
      customerPhone: '+62 812 3456 7890',
    });
    expect(ready.data).toMatchObject({ jobStatus: 'ready', customerPhone: '+62 812 3456 7890' });
  });

  it('validates the body', async () => {
    expect((await call(t3, 'PATCH', `/transactions/${id}/job`, { jobStatus: 'flying' })).status).toBe(422);
    expect((await call(t3, 'PATCH', `/transactions/${id}/job`, {})).status).toBe(422);
  });

  it('does not touch other stores or non-job sales', async () => {
    expect((await call(t1, 'PATCH', `/transactions/${id}/job`, { jobStatus: 'ready' })).status).toBe(404);
    const res = await call(t1, 'PATCH', `/transactions/${retailId}/job`, { jobStatus: 'ready' });
    expect([res.status, res.data.code]).toEqual([422, 'NOT_A_JOB']);
  });

  it('?jobStatus=open lists unfinished jobs until they are completed', async () => {
    const open = await call(t3, 'GET', '/transactions?jobStatus=open');
    expect(open.data.some((tx: { id: string }) => tx.id === id)).toBe(true);
    expect(open.data.every((tx: { jobStatus: string }) => tx.jobStatus !== 'completed')).toBe(true);

    await call(t3, 'PATCH', `/transactions/${id}/job`, { jobStatus: 'completed' });
    const after = await call(t3, 'GET', '/transactions?jobStatus=open');
    expect(after.data.some((tx: { id: string }) => tx.id === id)).toBe(false);
    const done = await call(t3, 'GET', '/transactions?jobStatus=completed');
    expect(done.data.some((tx: { id: string }) => tx.id === id)).toBe(true);
  });
});

describe('public receipt page', () => {
  let id = '';
  let url = '';

  beforeAll(async () => {
    const created = await call(
      t3,
      'POST',
      '/transactions',
      sale(shift3.id, serviceProductId, { customerName: '<script>alert(1)</script>Dewi' }),
      headers(),
    );
    id = created.data.id;
    const link = await call(t3, 'POST', `/transactions/${id}/receipt-link`);
    expect(link.status, JSON.stringify(link.data)).toBe(200);
    url = `${origin}/r/${link.data.token}`;
    expect(link.data.url).toContain(`/r/${link.data.token}`);
  });

  it('is served without login, escapes user input and shows the live status', async () => {
    const res = await fetch(url);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(html).toContain('Menunggu');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');

    await call(t3, 'PATCH', `/transactions/${id}/job`, { jobStatus: 'ready' });
    expect(await (await fetch(url)).text()).toContain('Siap diambil');
  });

  it('does not expose staff names or internal ids', async () => {
    const html = await (await fetch(url)).text();
    const detail = (await call(t3, 'GET', `/transactions/${id}`)).data;
    expect(html).not.toContain(detail.user.name);
    expect(html).not.toContain(id);
  });

  it('returns the same link every time and a 404 page for unknown tokens', async () => {
    const again = await call(t3, 'POST', `/transactions/${id}/receipt-link`);
    expect(`${origin}/r/${again.data.token}`).toBe(url);
    expect((await fetch(`${origin}/r/${'a'.repeat(32)}`)).status).toBe(404);
    expect((await fetch(`${origin}/r/short`)).status).toBe(404);
    // another store cannot mint a link for this sale
    expect((await call(t1, 'POST', `/transactions/${id}/receipt-link`)).status).toBe(404);
  });

  it('shows a voided sale as cancelled and refuses further status changes', async () => {
    const voided = await call(t3, 'POST', `/transactions/${id}/void`, { ownerPin: e2eEnv.pin, reason: 'e2e' });
    expect(voided.status, JSON.stringify(voided.data)).toBe(200);
    expect(await (await fetch(url)).text()).toContain('Dibatalkan');
    const res = await call(t3, 'PATCH', `/transactions/${id}/job`, { jobStatus: 'completed' });
    expect([res.status, res.data.code]).toEqual([409, 'TRANSACTION_VOIDED']);
  });
});
