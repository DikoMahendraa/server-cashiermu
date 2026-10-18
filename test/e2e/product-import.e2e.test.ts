/**
 * End-to-end: product import / export through the real API (template, preview, commit, export round trip,
 * store isolation). Uses the third throwaway store (laundry). Run with the local API up.
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, e2eEnv, ensureOwner } from './helpers';

const uid = () => randomUUID().slice(0, 8).toUpperCase();
type Row = Record<string, string | number | boolean | null>;
interface TemplateColumn {
  key: string;
  header: string;
  required: boolean;
  options?: string[];
}

let t3 = '';
let t1 = '';
let columns: TemplateColumn[] = [];
const createdCategoryNames = new Set<string>();

const header = (key: string): string => columns.find(column => column.key === key)!.header;
const importBody = (rows: Row[]) => ({ headers: columns.map(column => column.header), rows });
const preview = (rows: Row[], token = t3) => call(token, 'POST', '/products/import/preview', importBody(rows));
const commit = (rows: Row[], token = t3) => call(token, 'POST', '/products/import', importBody(rows));
const listProducts = async (token = t3) =>
  (await call(token, 'GET', '/products')).data as {
    id: string;
    sku: string;
    name: string;
    sellPrice: string;
    unit: string;
    trackStock: boolean;
    allowDecimalQty: boolean;
    isActive: boolean;
    attributes: Record<string, unknown>;
    category: { name: string };
  }[];

beforeAll(async () => {
  t3 = await ensureOwner({
    email: e2eEnv.email3,
    phone: e2eEnv.phone3,
    storeName: 'E2E Test Store Craft',
    sector: 'service',
    subtype: 'laundry',
  });
  t1 = await ensureOwner({ email: e2eEnv.email, phone: e2eEnv.phone, storeName: 'E2E Test Store' });
  expect((await call(t3, 'PATCH', '/store', { sector: 'service', subtype: 'laundry' })).status).toBe(200);
  columns = (await call(t3, 'GET', '/products/import/template')).data.columns;
});

afterAll(async () => {
  for (const product of await listProducts()) {
    if (product.sku.startsWith('E2EIMP-') && product.isActive) await call(t3, 'DELETE', `/products/${product.id}`);
  }
  const categories = (await call(t3, 'GET', '/categories')).data as { id: string; name: string }[];
  for (const category of categories)
    if (createdCategoryNames.has(category.name)) await call(t3, 'DELETE', `/categories/${category.id}`);
});

describe('template', () => {
  it("is generated for the store's kind: laundry wording, laundry columns, safe examples", async () => {
    const res = await call(t3, 'GET', '/products/import/template');
    expect(res.status).toBe(200);
    expect(res.data.sheetName).toBe('Layanan');
    expect(res.data.kind).toMatchObject({ id: 'laundry' });
    const headers = res.data.columns.map((column: TemplateColumn) => column.header);
    expect(headers).toEqual(
      expect.arrayContaining([
        'Nama Layanan *',
        'Kategori *',
        'Tarif *',
        'SKU',
        'Satuan Tarif',
        'Kecepatan Layanan',
        'Estimasi Selesai (jam)',
        'Termasuk',
      ]),
    );
    expect(res.data.examples.length).toBeGreaterThan(0);
    for (const example of res.data.examples) expect(example['Tarif *']).toBe(''); // price left blank on purpose
    expect(res.data.notes.length).toBeGreaterThan(3);
    expect(res.data.columns.find((c: TemplateColumn) => c.key === 'attr:speed').options).toContain('Express (1 hari)');
  });

  it('differs per kind (a general store gets product columns, no laundry fields)', async () => {
    const general = await call(t1, 'GET', '/products/import/template');
    expect(general.data.sheetName).toBe('Produk');
    const headers = general.data.columns.map((column: TemplateColumn) => column.header);
    expect(headers).toContain('Nama Produk *');
    expect(headers).not.toContain('Kecepatan Layanan');
  });

  it('is owner-only and needs a login', async () => {
    expect((await call('', 'GET', '/products/import/template')).status).toBe(401);
    expect((await call('', 'GET', '/products/export')).status).toBe(401);
    expect((await call('', 'POST', '/products/import/preview', importBody([{}]))).status).toBe(401);
  });
});

describe('preview and import', () => {
  const sku = `E2EIMP-${uid()}`;
  const category = `Impor ${uid()}`;
  const baseRow = (overrides: Row = {}): Row => ({
    [header('name')]: `Cuci ${uid()}`,
    [header('sku')]: `E2EIMP-${uid()}`,
    [header('category')]: category,
    [header('sellPrice')]: 'Rp 7.500',
    [header('buyPrice')]: 3000,
    [header('unit')]: 'Kg',
    [header('attr:speed')]: 'Express (1 hari)',
    [header('attr:turnaroundHours')]: 24,
    [header('attr:includes')]: 'Cuci, Setrika',
    ...overrides,
  });

  it('previews without writing anything: counts, new category, row-level errors', async () => {
    createdCategoryNames.add(category);
    const before = (await listProducts()).length;
    const res = await preview([
      baseRow({ [header('sku')]: sku }),
      baseRow({ [header('sellPrice')]: 'murah' }), // bad price
      baseRow({ [header('unit')]: 'kilo' }), // unknown unit
      baseRow({ [header('attr:speed')]: 'turbo' }), // unknown choice
    ]);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data).toMatchObject({
      dryRun: true,
      summary: { total: 4, create: 1, error: 3 },
      newCategories: [category],
    });
    expect(res.data.rows[1].errors).toEqual(['Tarif: harus berupa angka (mis. 15000)']);
    expect(res.data.rows[2].errors[0]).toContain('Satuan Tarif: "kilo" tidak dikenal. Pilihan: Kg');
    expect(res.data.rows.map((row: { rowNumber: number }) => row.rowNumber)).toEqual([2, 3, 4, 5]);
    expect((await listProducts()).length).toBe(before); // nothing written
    expect(((await call(t3, 'GET', '/categories')).data as { name: string }[]).some(c => c.name === category)).toBe(
      false,
    );
  });

  it('imports the valid rows, skips and reports the bad ones, creates the category, applies sector rules', async () => {
    const good = baseRow({ [header('sku')]: sku, [header('name')]: 'Cuci Express E2E' });
    const res = await commit([good, baseRow({ [header('sellPrice')]: 0 })]);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data).toMatchObject({
      dryRun: false,
      applied: { created: 1, updated: 0, categoriesCreated: 1 },
      summary: { create: 1, error: 1 },
    });

    const item = (await listProducts()).find(product => product.sku === sku)!;
    expect(item).toMatchObject({
      name: 'Cuci Express E2E',
      unit: 'kg',
      trackStock: false,
      allowDecimalQty: true,
      isActive: true,
    });
    expect(Number(item.sellPrice)).toBe(7500);
    expect(item.category.name).toBe(category);
    expect(item.attributes).toEqual({ speed: 'express', turnaroundHours: 24, includes: ['wash', 'iron'] });
  });

  it('importing the same file again is safe: nothing is duplicated, nothing changes', async () => {
    const same = baseRow({ [header('sku')]: sku, [header('name')]: 'Cuci Express E2E' });
    const before = (await listProducts()).length;
    const res = await commit([same]);
    expect(res.data).toMatchObject({
      applied: { created: 0, updated: 0, categoriesCreated: 0 },
      summary: { create: 0, update: 0, unchanged: 1 },
    });
    expect((await listProducts()).length).toBe(before);
  });

  it('updates an existing item by SKU, touching only the columns provided', async () => {
    const res = await commit([
      { [header('sku')]: sku.toLowerCase(), [header('sellPrice')]: 9000, [header('attr:turnaroundHours')]: 12 },
    ]);
    expect(res.data).toMatchObject({ applied: { created: 0, updated: 1 }, summary: { update: 1 } });
    expect(res.data.rows[0].changes).toEqual(['Tarif', 'Estimasi Selesai (jam)']);

    const item = (await listProducts()).find(product => product.sku === sku)!;
    expect(Number(item.sellPrice)).toBe(9000);
    expect(item.name).toBe('Cuci Express E2E'); // untouched
    expect(item.attributes).toEqual({ speed: 'express', turnaroundHours: 12, includes: ['wash', 'iron'] }); // merged, not replaced
  });

  it('creates items from a SKU-less row (SKU derived from the name) and finds them again by name', async () => {
    const name = `Kemeja Impor ${uid()}`;
    const first = await commit([baseRow({ [header('name')]: name, [header('sku')]: '', [header('unit')]: 'Pcs' })]);
    expect(first.data.applied.created).toBe(1);
    const derived = first.data.rows[0].sku as string;
    expect(derived).toMatch(/^KEMEJA-IMPOR-/);
    const again = await commit([{ [header('name')]: name, [header('sellPrice')]: 8000 }]);
    expect(again.data).toMatchObject({
      summary: { create: 0, update: 1 },
      rows: [{ sku: derived, changes: ['Tarif'] }],
    });
    // tidy: derived SKUs do not carry the E2EIMP- prefix, so deactivate by hand
    const item = (await listProducts()).find(product => product.sku === derived);
    if (item) await call(t3, 'DELETE', `/products/${item.id}`);
  });

  it('rejects a SKU repeated inside the file and keeps the first row', async () => {
    const dup = `E2EIMP-${uid()}`;
    const res = await preview([baseRow({ [header('sku')]: dup }), baseRow({ [header('sku')]: dup })]);
    expect(res.data.summary).toMatchObject({ create: 1, error: 1 });
    expect(res.data.rows[1].errors[0]).toContain('sudah muncul di baris 2');
  });

  it('refuses a file with no recognisable columns, and more than 500 rows', async () => {
    const strange = await call(t3, 'POST', '/products/import/preview', {
      headers: ['Foo', 'Bar'],
      rows: [{ Foo: 1, Bar: 2 }],
    });
    expect([strange.status, strange.data.code]).toEqual([422, 'NO_RECOGNISED_COLUMNS']);
    const rows = Array.from({ length: 501 }, (_, i) => ({ [header('name')]: `X${i}` }));
    expect((await preview(rows)).status).toBe(422);
  });

  it('accepts a full 500-row file (bigger than the default request limit)', async () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      baseRow({ [header('sku')]: `E2EIMP-BULK-${i}`, [header('name')]: `Bulk item ${i} ${'x'.repeat(40)}` }),
    );
    const res = await preview(rows);
    expect(res.status).toBe(200);
    expect(res.data.summary).toMatchObject({ total: 500, create: 500, error: 0 });
  });
});

describe('export', () => {
  it('uses the same columns as the template and round-trips: export → preview → everything unchanged', async () => {
    const exported = await call(t3, 'GET', '/products/export');
    expect(exported.status).toBe(200);
    expect(exported.data.columns.map((c: TemplateColumn) => c.header)).toEqual(columns.map(column => column.header));
    expect(exported.data.total).toBe(exported.data.rows.length);
    expect(exported.data.total).toBeGreaterThan(0);

    const rows = exported.data.rows.slice(0, 500) as Row[];
    const res = await preview(rows);
    expect(res.status).toBe(200);
    const notUnchanged = res.data.rows.filter((row: { action: string }) => row.action !== 'unchanged');
    expect(notUnchanged, JSON.stringify(notUnchanged.slice(0, 3))).toEqual([]);
  });
});

describe('store isolation', () => {
  it("never exports another store's items, and the same SKU in another store creates a new item there", async () => {
    const sku = `E2EIMP-ISO-${uid()}`;
    const mine = await commit([
      {
        [header('name')]: `Milik Toko 3 ${uid()}`,
        [header('sku')]: sku,
        [header('category')]: 'Kiloan',
        [header('sellPrice')]: 5000,
      },
    ]);
    expect(mine.data.applied.created, JSON.stringify(mine.data)).toBe(1);

    const otherExport = await call(t1, 'GET', '/products/export');
    expect(otherExport.data.rows.some((row: Row) => row['SKU'] === sku)).toBe(false);

    const generalHeaders = (await call(t1, 'GET', '/products/import/template')).data.columns.map(
      (c: TemplateColumn) => c.header,
    );
    const nameH = generalHeaders.find((h: string) => h.startsWith('Nama'));
    const catH = generalHeaders.find((h: string) => h.startsWith('Kategori'));
    const priceH = generalHeaders.find((h: string) => h.startsWith('Harga Jual'));
    const res = await call(t1, 'POST', '/products/import', {
      headers: generalHeaders,
      rows: [{ [nameH]: `Milik Toko 1 ${uid()}`, SKU: sku, [catH]: 'Lainnya', [priceH]: 1234 }],
    });
    expect(res.data.summary, JSON.stringify(res.data)).toMatchObject({ create: 1, update: 0 }); // not an update of store 3's item
    const stillMine = (await listProducts()).find(product => product.sku === sku)!;
    expect(Number(stillMine.sellPrice)).toBe(5000);

    // tidy the item created in the general store
    const created = ((await call(t1, 'GET', '/products')).data as { id: string; sku: string }[]).find(
      product => product.sku === sku,
    );
    if (created) await call(t1, 'DELETE', `/products/${created.id}`);
  });
});
