/**
 * End-to-end: business types and kinds, kind-validated product attributes, decimal quantities, category
 * ownership and variant groups. Uses the third throwaway store (a service business: laundry, later a workshop).
 * Run with the local API up.
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, e2eEnv, ensureOwner, ensureShift } from './helpers';

// The store keeps its original name from when it was first registered (it started life as a craft shop).
const STORE_3 = 'E2E Test Store Craft';
const uid = () => randomUUID().slice(0, 8);

let t3 = '';
let t1 = '';
let shift = { id: '', openedHere: false };
let categoryId = '';
const productIds: string[] = [];

async function createProduct(overrides: Record<string, unknown> = {}, token = t3) {
  const res = await call(token, 'POST', '/products', {
    name: `E2E ${uid()}`,
    sku: `E2E-${uid()}`,
    categoryId,
    buyPrice: 3000,
    sellPrice: 7000,
    stock: 0,
    ...overrides,
  });
  if (res.status === 201) productIds.push(res.data.id);
  return res;
}

const getProduct = async (id: string) => (await call(t3, 'GET', `/products/${id}`)).data;
const setKind = (sector: string, subtype?: string) =>
  call(t3, 'PATCH', '/store', { sector, ...(subtype ? { subtype } : {}) });
const headers = () => ({ 'Idempotency-Key': `e2e-${randomUUID()}` });

const sale = (productId: string, quantity: number, unitPrice: number, extra: Record<string, unknown> = {}) => ({
  shiftId: shift.id,
  items: [{ productId, quantity, unitPrice, selectedVariants: [], note: '', itemDiscount: null }],
  payments: [{ method: 'transfer', amount: Math.round(unitPrice * quantity), reference: null }],
  customerName: '',
  note: '',
  ...extra,
});

beforeAll(async () => {
  t3 = await ensureOwner({
    email: e2eEnv.email3,
    phone: e2eEnv.phone3,
    storeName: STORE_3,
    sector: 'service',
    subtype: 'laundry',
  });
  t1 = await ensureOwner({ email: e2eEnv.email, phone: e2eEnv.phone, storeName: 'E2E Test Store' });
  // Self-healing: a previous crashed run may have left this store on another kind.
  expect(
    (await call(t3, 'PATCH', '/store', { sector: 'service', subtype: 'laundry', shiftEnabled: true })).status,
  ).toBe(200);
  shift = await ensureShift(t3);
  categoryId = (await call(t3, 'GET', '/categories')).data[0].id;
});

afterAll(async () => {
  await call(t3, 'PATCH', '/store', { sector: 'service', subtype: 'laundry' });
  for (const id of productIds) await call(t3, 'DELETE', `/products/${id}`);
  if (shift.openedHere) await call(t3, 'POST', '/shifts/close', { closingBalance: 0, notes: 'e2e' });
});

describe('GET /sectors', () => {
  it('is public, cacheable, and lists the 3 business types with their kinds, wording and starter items', async () => {
    const res = await call('', 'GET', '/sectors');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    expect(res.data.version).toBeGreaterThan(1);
    expect(res.data.sectors.map((s: { id: string }) => s.id).sort()).toEqual(['culinary', 'general', 'service']);

    const service = res.data.sectors.find((s: { id: string }) => s.id === 'service');
    expect(service.subtypes.map((s: { id: string }) => s.id)).toEqual([
      'ac',
      'laundry',
      'workshop',
      'massage',
      'printing',
      'general_service',
    ]);
    const laundry = service.subtypes.find((s: { id: string }) => s.id === 'laundry');
    expect(laundry.vocabulary.item).toBe('Layanan');
    expect(laundry.defaultUnit).toBe('kg');
    expect(laundry.templates.length).toBeGreaterThan(5);
  });
});

describe('registration and kind of business', () => {
  it('rejects a kind that does not belong to the chosen type, without creating an account', async () => {
    const res = await call('', 'POST', '/auth/register', {
      storeName: 'Should Not Exist',
      ownerName: 'Nobody',
      email: `nobody-${uid()}@cashiermu.test`,
      phone: `0899${Date.now().toString().slice(-8)}`,
      pin: e2eEnv.pin,
      pinConfirm: e2eEnv.pin,
      sector: 'culinary',
      subtype: 'laundry',
    });
    expect([res.status, res.data.code]).toEqual([422, 'INVALID_SUBTYPE']);
  });

  it('returns sector and kind from /auth/me; older stores are "general / default"', async () => {
    const me = await call(t3, 'GET', '/auth/me');
    expect(me.data.store).toMatchObject({ sector: 'service', subtype: 'laundry' });
    const old = await call(t1, 'GET', '/auth/me');
    expect(old.data.store).toMatchObject({ sector: 'general', subtype: 'default' });
  });

  it('validates changes: unknown kind, removed types, and kind reset when only the type changes', async () => {
    const bad = await call(t3, 'PATCH', '/store', { sector: 'service', subtype: 'bakery' });
    expect([bad.status, bad.data.code]).toEqual([422, 'INVALID_SUBTYPE']);
    expect((await call(t3, 'PATCH', '/store', { sector: 'craft' })).status).toBe(422); // removed type
    expect((await call(t3, 'PATCH', '/store', { sector: 'beauty' })).status).toBe(422);

    const culinary = await setKind('culinary');
    expect([culinary.status, culinary.data.sector, culinary.data.subtype]).toEqual([200, 'culinary', 'default']);
    const beverage = await call(t3, 'PATCH', '/store', { subtype: 'beverage' }); // kind only, type unchanged
    expect([beverage.status, beverage.data.subtype]).toEqual([200, 'beverage']);
    expect((await call(t3, 'PATCH', '/store', { subtype: 'laundry' })).data.code).toBe('INVALID_SUBTYPE'); // laundry is not a culinary kind

    await setKind('service', 'laundry');
  });
});

describe('laundry: attributes, units and decimal quantities', () => {
  it('stores valid attributes and rejects invalid ones with a message per field', async () => {
    const ok = await createProduct({
      unit: 'kg',
      allowDecimalQty: true,
      attributes: { speed: 'express', turnaroundHours: 24, includes: ['wash', 'iron'] },
    });
    expect(ok.status, JSON.stringify(ok.data)).toBe(201);
    expect(ok.data.attributes).toEqual({ speed: 'express', turnaroundHours: 24, includes: ['wash', 'iron'] });
    expect(ok.data.trackStock).toBe(false); // services do not track stock by default
    expect(ok.data.allowDecimalQty).toBe(true);

    const bad = await createProduct({ attributes: { speed: 'turbo', colour: 'red' } });
    expect([bad.status, bad.data.code]).toEqual([422, 'INVALID_ATTRIBUTES']);
    expect(bad.data.details.fields).toMatchObject({
      speed: 'pilihan tidak valid',
      colour: expect.stringContaining('tidak dikenal'),
    });
  });

  it('sells fractional kilos: 2.5 kg and 2.333 kg, with the line rounded to a whole Rupiah', async () => {
    const product = (await createProduct({ unit: 'kg', allowDecimalQty: true })).data;

    const a = await call(t3, 'POST', '/transactions', sale(product.id, 2.5, 7000), headers());
    expect(a.status, JSON.stringify(a.data)).toBe(201);
    expect(Number(a.data.grandTotal)).toBe(17500);
    expect(Number(a.data.items[0].quantity)).toBe(2.5);

    const b = await call(t3, 'POST', '/transactions', sale(product.id, 2.333, 7000), headers());
    expect(Number(b.data.grandTotal)).toBe(16331);
    expect(Number(b.data.items[0].quantity)).toBe(2.333);

    // stored quantity round-trips through the detail endpoint
    const detail = await call(t3, 'GET', `/transactions/${a.data.id}`);
    expect(Number(detail.data.items[0].quantity)).toBe(2.5);
  });

  it('refuses more than 3 decimals, non-decimal items with fractions, and unsafe combinations', async () => {
    const kgProduct = (await createProduct({ unit: 'kg', allowDecimalQty: true })).data;
    const tooPrecise = await call(t3, 'POST', '/transactions', sale(kgProduct.id, 2.3333, 7000), headers());
    expect(tooPrecise.status).toBe(422);

    const piece = (await createProduct({ unit: 'pcs' })).data; // allowDecimalQty defaults to false
    const fractional = await call(t3, 'POST', '/transactions', sale(piece.id, 1.5, 7000), headers());
    expect([fractional.status, fractional.data.code]).toEqual([422, 'INVALID_QUANTITY']);

    const tracked = await createProduct({ trackStock: true, allowDecimalQty: true });
    expect([tracked.status, tracked.data.code]).toEqual([422, 'DECIMAL_NEEDS_UNTRACKED_STOCK']);
    const flip = await call(t3, 'PATCH', `/products/${kgProduct.id}`, { trackStock: true });
    expect([flip.status, flip.data.code]).toEqual([422, 'DECIMAL_NEEDS_UNTRACKED_STOCK']);
    expect((await getProduct(kgProduct.id)).trackStock).toBe(false); // the rejected change did nothing
  });

  it('counts fractional sales in the profit report and lets a fractional sale be voided', async () => {
    const product = (
      await createProduct({
        name: 'E2E Kiloan Profit',
        unit: 'kg',
        allowDecimalQty: true,
        buyPrice: 3000,
        sellPrice: 7000,
      })
    ).data;
    await new Promise(resolve => setTimeout(resolve, 25));
    const from = new Date().toISOString();
    const made = await call(t3, 'POST', '/transactions', sale(product.id, 2.5, 7000), headers());
    expect(made.status).toBe(201);

    const to = new Date(Date.now() + 60_000).toISOString();
    const report = await call(
      t3,
      'GET',
      `/reports/profit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(report.status, JSON.stringify(report.data)).toBe(200);
    expect(report.data).toMatchObject({ transactionCount: 1, netSales: 17500, cogs: 7500, grossProfit: 10000 });
    expect(report.data.topProducts[0]).toMatchObject({
      productName: 'E2E Kiloan Profit',
      quantity: 2.5,
      revenue: 17500,
      cogs: 7500,
    });

    const voided = await call(t3, 'POST', `/transactions/${made.data.id}/void`, {
      ownerPin: e2eEnv.pin,
      reason: 'e2e',
    });
    expect(voided.status, JSON.stringify(voided.data)).toBe(200);
  });
});

describe('workshop: service vs spare part', () => {
  beforeAll(async () => {
    expect((await setKind('service', 'workshop')).status).toBe(200);
  });
  afterAll(async () => {
    await setKind('service', 'laundry');
  });

  it('requires choosing service or part, and derives stock tracking from it', async () => {
    const missing = await createProduct({});
    expect([missing.status, missing.data.details.fields.kind]).toEqual([422, 'wajib diisi']);

    const service = await createProduct({
      attributes: { kind: 'service', vehicleType: 'motor', durationMinutes: 15, partBrand: 'ignored' },
    });
    expect(service.status, JSON.stringify(service.data)).toBe(201);
    expect(service.data.trackStock).toBe(false);
    expect(service.data.attributes).toEqual({ kind: 'service', vehicleType: 'motor', durationMinutes: 15 }); // part-only field dropped

    const part = await createProduct({
      stock: 12,
      attributes: { kind: 'part', partBrand: 'NGK', durationMinutes: 99 },
    });
    expect(part.status, JSON.stringify(part.data)).toBe(201);
    expect(part.data.trackStock).toBe(true);
    expect(part.data.attributes).toEqual({ kind: 'part', partBrand: 'NGK' }); // service-only field dropped
  });

  it('only decrements stock for the spare part, not for the labour', async () => {
    const part = (await createProduct({ stock: 10, attributes: { kind: 'part' } })).data;
    const labour = (await createProduct({ attributes: { kind: 'service' } })).data;
    const res = await call(
      t3,
      'POST',
      '/transactions',
      {
        shiftId: shift.id,
        items: [
          { productId: part.id, quantity: 2, unitPrice: 7000, selectedVariants: [], note: '', itemDiscount: null },
          { productId: labour.id, quantity: 1, unitPrice: 7000, selectedVariants: [], note: '', itemDiscount: null },
        ],
        payments: [{ method: 'transfer', amount: 21000, reference: null }],
        customerName: '',
        note: '',
      },
      headers(),
    );
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    expect((await getProduct(part.id)).stock).toBe(8);
    expect((await getProduct(labour.id)).stock).toBe(0);
  });
});

describe('category ownership', () => {
  it('refuses a category from another store on create and update', async () => {
    const foreign = (await call(t1, 'GET', '/categories')).data[0].id;
    const created = await createProduct({ categoryId: foreign });
    expect([created.status, created.data.code]).toEqual([422, 'CATEGORY_NOT_FOUND']);

    const mine = (await createProduct({})).data;
    const moved = await call(t3, 'PATCH', `/products/${mine.id}`, { categoryId: foreign });
    expect([moved.status, moved.data.code]).toEqual([422, 'CATEGORY_NOT_FOUND']);
  });
});

describe('variant groups', () => {
  const sizes = {
    name: 'Ukuran',
    required: true,
    multiSelect: false,
    options: [
      { label: 'Kecil', priceModifier: 0 },
      { label: 'Besar', priceModifier: 5000 },
    ],
  };
  const extras = {
    name: 'Tambahan',
    required: false,
    multiSelect: true,
    options: [{ label: 'Antar-Jemput', priceModifier: 3000 }],
  };

  it('returns variants from the product list', async () => {
    const created = (await createProduct({ variantGroups: [sizes, extras] })).data;
    const listed = (await call(t3, 'GET', '/products?isActive=true')).data.find(
      (p: { id: string }) => p.id === created.id,
    );
    expect(listed.variantGroups.map((g: { name: string }) => g.name)).toEqual(['Ukuran', 'Tambahan']);
    expect(listed.variantGroups[0].options.map((o: { label: string }) => o.label)).toEqual(['Kecil', 'Besar']);
  });

  it('syncs variants on update: keeps ids of unchanged items, adds, edits and removes', async () => {
    const created = (await createProduct({ variantGroups: [sizes, extras] })).data;
    const [sizeGroup, extraGroup] = created.variantGroups;
    const [small] = sizeGroup.options;

    const updated = await call(t3, 'PATCH', `/products/${created.id}`, {
      variantGroups: [
        {
          id: sizeGroup.id,
          name: 'Ukuran Produk',
          required: true,
          multiSelect: false,
          options: [
            { id: small.id, label: 'Kecil', priceModifier: 1000 },
            { label: 'Sedang', priceModifier: 2500 },
          ],
        },
        { name: 'Warna', required: false, multiSelect: false, options: [{ label: 'Merah', priceModifier: 0 }] },
      ],
    });
    expect(updated.status, JSON.stringify(updated.data)).toBe(200);

    const groups = updated.data.variantGroups;
    expect(groups.map((g: { name: string }) => g.name)).toEqual(['Ukuran Produk', 'Warna']);
    expect(groups[0].id).toBe(sizeGroup.id);
    expect(groups[0].options.map((o: { label: string }) => o.label)).toEqual(['Kecil', 'Sedang']);
    expect(groups[0].options[0].id).toBe(small.id);
    expect(Number(groups[0].options[0].priceModifier)).toBe(1000);
    expect(groups.some((g: { id: string }) => g.id === extraGroup.id)).toBe(false);

    expect((await call(t3, 'PATCH', `/products/${created.id}`, { name: 'x' })).data.variantGroups).toHaveLength(2);
    expect((await call(t3, 'PATCH', `/products/${created.id}`, { variantGroups: [] })).data.variantGroups).toEqual([]);
  });

  it('refuses ids that belong to another product', async () => {
    const a = (await createProduct({ variantGroups: [sizes] })).data;
    const b = (await createProduct({ variantGroups: [extras] })).data;
    const res = await call(t3, 'PATCH', `/products/${b.id}`, {
      variantGroups: [{ id: a.variantGroups[0].id, name: 'Hijack', required: false, multiSelect: false, options: [] }],
    });
    expect([res.status, res.data.code]).toEqual([422, 'INVALID_VARIANT_ID']);
    expect((await getProduct(a.id)).variantGroups[0].name).toBe('Ukuran');
  });

  it('sells a variant at base price + modifier, and rejects a client price without it', async () => {
    const product = (await createProduct({ sellPrice: 20000, variantGroups: [sizes] })).data;
    const big = product.variantGroups[0].options.find((o: { label: string }) => o.label === 'Besar');
    const line = (unitPrice: number) => ({
      shiftId: shift.id,
      items: [
        {
          productId: product.id,
          quantity: 1,
          unitPrice,
          selectedVariants: [{ optionId: big.id }],
          note: '',
          itemDiscount: null,
        },
      ],
      payments: [{ method: 'transfer', amount: 25000, reference: null }],
      customerName: '',
      note: '',
    });

    const stale = await call(t3, 'POST', '/transactions', line(20000), headers());
    expect([stale.status, stale.data.code]).toEqual([409, 'PRICE_CHANGED']);

    const ok = await call(t3, 'POST', '/transactions', line(25000), headers());
    expect(ok.status, JSON.stringify(ok.data)).toBe(201);
    expect(Number(ok.data.grandTotal)).toBe(25000);
    expect(ok.data.items[0].selectedVariants[0]).toMatchObject({ optionLabel: 'Besar', groupName: 'Ukuran' });
  });
});
