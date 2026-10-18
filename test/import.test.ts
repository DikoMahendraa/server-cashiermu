import { describe, expect, it } from 'vitest';
import { SECTORS, getSubtypeConfig } from '../src/modules/sectors/sector.config';
import { buildImportColumns, matchHeaders, normaliseHeader } from '../src/modules/products/import/import.columns';
import { planImport, type ExistingProduct, type ProductWrite } from '../src/modules/products/import/import.plan';
import { productToRow, templateExampleRows, type FileRow } from '../src/modules/products/import/import.format';
import {
  parseBoolean,
  parseDate,
  parseInteger,
  parseMultiselect,
  parseNumber,
  parseSelect,
  parseText,
  slugSku,
} from '../src/modules/products/import/import.values';

const kind = (sector: 'general' | 'culinary' | 'service', subtype: string) => getSubtypeConfig(sector, subtype);
const ALL_KINDS = SECTORS.flatMap(sector =>
  sector.subtypes.map(subtype => [`${sector.id}/${subtype.id}`, sector.id, subtype] as const),
);

// ─── cell parsers ────────────────────────────────────────────────────────────

describe('parseNumber / parseInteger', () => {
  it.each([
    [15000, 15000],
    ['15000', 15000],
    ['Rp 15.000', 15000],
    ['Rp15.000', 15000],
    ['15.000', 15000],
    ['15.000,50', 15000.5],
    ['15,000', 15000],
    ['15,000.50', 15000.5],
    ['15,5', 15.5],
    ['2.5', 2.5],
    ['  7000  ', 7000],
    ['0', 0],
  ])('accepts %j → %d', (raw, expected) => {
    expect(parseNumber(raw)).toEqual({ ok: true, value: expected });
  });

  it.each(['abc', '12abc', '', '1.2.3', '15 000x', true, Number.NaN, Infinity])('rejects %j', raw => {
    expect(parseNumber(raw).ok).toBe(false);
  });

  it('rejects negatives and non-integers where a whole number is needed', () => {
    expect(parseNumber('-5')).toMatchObject({ ok: false, error: 'tidak boleh negatif' });
    expect(parseNumber(-5).ok).toBe(false);
    expect(parseInteger('12')).toEqual({ ok: true, value: 12 });
    expect(parseInteger('12,5')).toMatchObject({ ok: false, error: 'harus bilangan bulat' });
    expect(parseInteger(3.2).ok).toBe(false);
  });
});

describe('other cell parsers', () => {
  it('parses Ya/Tidak in the ways people actually write it', () => {
    for (const yes of ['Ya', 'ya', ' YA ', 'y', 'Yes', 'true', 1, true, 'Aktif'])
      expect(parseBoolean(yes)).toEqual({ ok: true, value: true });
    for (const no of ['Tidak', 'tidak', 'T', 'no', 'false', 0, false, 'Nonaktif'])
      expect(parseBoolean(no)).toEqual({ ok: true, value: false });
    expect(parseBoolean('mungkin')).toMatchObject({ ok: false });
    expect(parseBoolean(2).ok).toBe(false);
  });

  it('matches choices by label or value, ignoring case, spacing and punctuation', () => {
    const options = [
      { value: 'regular', label: 'Reguler (2–3 hari)' },
      { value: 'express', label: 'Express (1 hari)' },
    ];
    expect(parseSelect('Express (1 hari)', options)).toEqual({ ok: true, value: 'express' });
    expect(parseSelect('express 1 HARI', options)).toEqual({ ok: true, value: 'express' });
    expect(parseSelect('regular', options)).toEqual({ ok: true, value: 'regular' });
    const bad = parseSelect('kilat', options);
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.error).toContain('Pilihan: Reguler (2–3 hari), Express (1 hari)');
  });

  it('parses several choices in one cell and de-duplicates them', () => {
    const options = [
      { value: 'wash', label: 'Cuci' },
      { value: 'iron', label: 'Setrika' },
      { value: 'fold', label: 'Lipat' },
    ];
    expect(parseMultiselect('Cuci, setrika; Cuci | Lipat', options)).toEqual({
      ok: true,
      value: ['wash', 'iron', 'fold'],
    });
    expect(parseMultiselect('', options)).toEqual({ ok: true, value: [] });
    expect(parseMultiselect('Cuci, Jemur', options).ok).toBe(false);
  });

  it('parses dates in several formats and rejects impossible ones', () => {
    expect(parseDate('2027-12-31')).toEqual({ ok: true, value: '2027-12-31' });
    expect(parseDate('31/12/2027')).toEqual({ ok: true, value: '2027-12-31' });
    expect(parseDate('1-2-2028')).toEqual({ ok: true, value: '2028-02-01' });
    expect(parseDate(46023)).toEqual({ ok: true, value: '2026-01-01' }); // Excel serial number (45658 = 2025-01-01)
    expect(parseDate(46023.9)).toEqual({ ok: true, value: '2026-01-01' }); // a time of day never pushes it to the next date
    for (const bad of ['2027-02-30', '31/02/2027', 'besok', '', 5, 99999])
      expect(parseDate(bad).ok, String(bad)).toBe(false);
  });

  it('trims text, enforces length, and turns numeric cells (barcodes) into text', () => {
    expect(parseText('  Kopi  ')).toEqual({ ok: true, value: 'Kopi' });
    expect(parseText(8991234567890)).toEqual({ ok: true, value: '8991234567890' });
    expect(parseText('x'.repeat(101), 100)).toMatchObject({ ok: false });
    expect(parseText(true).ok).toBe(false);
  });

  it('makes a readable, repeatable SKU from a name', () => {
    expect(slugSku('Cuci Kiloan Reguler')).toBe('CUCI-KILOAN-REGULER');
    expect(slugSku('  Es Teh   Manis!! ')).toBe('ES-TEH-MANIS');
    expect(slugSku('Kopi Susu Gula Aren Spesial Premium').length).toBeLessThanOrEqual(24);
    expect(slugSku('###')).toBe('ITEM');
    expect(slugSku('Cuci Kiloan Reguler')).toBe(slugSku('Cuci Kiloan Reguler'));
  });
});

// ─── columns ─────────────────────────────────────────────────────────────────

describe('import columns', () => {
  it.each(ALL_KINDS)('%s: headers are unique and every sector field has a column', (_name, sector, config) => {
    const columns = buildImportColumns(config);
    const headers = columns.map(column => normaliseHeader(column.header));
    expect(new Set(headers).size, `duplicate headers: ${headers}`).toBe(headers.length);
    expect(new Set(columns.map(column => column.key)).size).toBe(columns.length);
    for (const field of config.fields)
      expect(
        columns.some(column => column.field?.key === field.key),
        field.key,
      ).toBe(true);
    for (const column of columns) {
      expect(column.help.length, column.key).toBeGreaterThan(0);
      if (column.type === 'select' || column.type === 'multiselect')
        expect(column.options?.length, column.key).toBeGreaterThan(0);
    }
    void sector;
  });

  it("uses the kind's own wording in the headers", () => {
    const laundry = buildImportColumns(kind('service', 'laundry')).map(column => column.header);
    expect(laundry).toContain('Nama Layanan *');
    expect(laundry).toContain('Tarif *');
    expect(laundry).toContain('Modal / Biaya (HPP)');
    expect(laundry).toContain('Estimasi Selesai (jam)');
    expect(laundry).toContain('Kecepatan Layanan');
    const retail = buildImportColumns(kind('general', 'default')).map(column => column.header);
    expect(retail).toContain('Nama Produk *');
    expect(retail).toContain('Harga Jual *');
    expect(retail).not.toContain('Kecepatan Layanan');
    const workshop = buildImportColumns(kind('service', 'workshop')).map(column => column.header);
    expect(workshop).toContain('Jenis *');
    expect(workshop).toContain('Nomor Part');
  });

  it('matches headers by exact text, normalised text and aliases, and reports unknown ones', () => {
    const columns = buildImportColumns(kind('service', 'laundry'));
    const { matched, ignored } = matchHeaders(columns, [
      'Nama Layanan *',
      'nama produk',
      'HARGA JUAL',
      'hpp',
      'Satuan Tarif',
      'Warna Favorit',
      '',
      'Kecepatan Layanan',
    ]);
    const byHeader = Object.fromEntries([...matched].map(([header, column]) => [header, column.key]));
    expect(byHeader).toMatchObject({
      'Nama Layanan *': 'name',
      'HARGA JUAL': 'sellPrice',
      hpp: 'buyPrice',
      'Satuan Tarif': 'unit',
      'Kecepatan Layanan': 'attr:speed',
    });
    expect(byHeader['nama produk']).toBeUndefined(); // second header for the same column is ignored
    expect(ignored).toEqual(['nama produk', 'Warna Favorit']);
  });
});

// ─── planner ─────────────────────────────────────────────────────────────────

const laundry = kind('service', 'laundry');
const laundryColumns = buildImportColumns(laundry);
const H = Object.fromEntries(laundryColumns.map(column => [column.key, column.header]));
const categories = [
  { id: 'c-kiloan', name: 'Kiloan' },
  { id: 'c-satuan', name: 'Satuan' },
];

const existingRegular: ExistingProduct = {
  id: 'p-1',
  sku: 'CKR',
  name: 'Cuci Kiloan Reguler',
  categoryId: 'c-kiloan',
  unit: 'kg',
  sellPrice: 7000,
  buyPrice: 3000,
  stock: 0,
  minStock: 5,
  barcode: null,
  isActive: true,
  trackStock: false,
  allowDecimalQty: true,
  attributes: { speed: 'regular', turnaroundHours: 72 },
};

const plan = (rows: FileRow[], existing: ExistingProduct[] = [], headers?: string[]) =>
  planImport({
    kind: laundry,
    columns: laundryColumns,
    headers: headers ?? laundryColumns.map(column => column.header),
    rows,
    existing,
    categories,
  });

describe('planImport — new items', () => {
  it('creates an item with sensible defaults taken from the kind', () => {
    const result = plan([{ [H.name]: 'Cuci Sepatu', [H.category]: 'Satuan', [H.sellPrice]: 'Rp 25.000' }]);
    expect(result.summary).toEqual({ total: 1, create: 1, update: 0, unchanged: 0, error: 0 });
    expect(result.rows[0].write).toMatchObject({
      sku: 'CUCI-SEPATU',
      name: 'Cuci Sepatu',
      categoryName: 'Satuan',
      sellPrice: 25000,
      buyPrice: 0,
      unit: 'kg',
      trackStock: false,
      allowDecimalQty: true,
      stock: 0,
      minStock: 5,
      barcode: null,
      isActive: true,
      attributes: {},
    });
    expect(result.newCategories).toEqual([]);
  });

  it('reads every kind of cell: unit by label, sector fields, booleans, explicit SKU', () => {
    const result = plan([
      {
        [H.name]: 'Bed Cover',
        [H.sku]: 'bc-01',
        [H.category]: 'Satuan',
        [H.sellPrice]: 45000,
        [H.buyPrice]: '20.000',
        [H.unit]: 'Pcs',
        [H['attr:speed']]: 'Express (1 hari)',
        [H['attr:turnaroundHours']]: '24',
        [H['attr:includes']]: 'Cuci, Setrika',
        [H.isActive]: 'Tidak',
        [H.barcode]: 8991111222233,
      },
    ]);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].write).toMatchObject({
      sku: 'BC-01',
      unit: 'pcs',
      buyPrice: 20000,
      isActive: false,
      barcode: '8991111222233',
      allowDecimalQty: false,
      attributes: { speed: 'express', turnaroundHours: 24, includes: ['wash', 'iron'] },
    });
  });

  it('lists categories that do not exist yet, once, from valid rows only', () => {
    const result = plan([
      { [H.name]: 'A', [H.category]: 'Cuci Sepatu', [H.sellPrice]: 1000 },
      { [H.name]: 'B', [H.category]: 'cuci sepatu', [H.sellPrice]: 1000 },
      { [H.name]: 'C', [H.category]: 'kiloan', [H.sellPrice]: 1000 },
      { [H.name]: 'D', [H.category]: 'Kategori Gagal' }, // no price → error → its category is not created
    ]);
    expect(result.newCategories).toEqual(['Cuci Sepatu']);
    expect(result.summary).toMatchObject({ create: 3, error: 1 });
  });

  it('ignores completely empty rows and unknown columns', () => {
    const result = plan(
      [
        { [H.name]: 'A', [H.category]: 'Kiloan', [H.sellPrice]: 1000, 'Kolom Aneh': 'x' },
        { [H.name]: '', [H.sellPrice]: '' },
      ],
      [],
      [H.name, H.category, H.sellPrice, 'Kolom Aneh'],
    );
    expect(result.summary.total).toBe(1);
    expect(result.ignoredHeaders).toEqual(['Kolom Aneh']);
  });

  it('numbers rows like Excel does (header is row 1)', () => {
    const result = plan([{ [H.name]: 'A' }, { [H.name]: 'B', [H.category]: 'Kiloan', [H.sellPrice]: 1 }]);
    expect(result.rows.map(row => row.rowNumber)).toEqual([2, 3]);
  });
});

describe('planImport — errors are specific and per row', () => {
  const errorsFor = (row: FileRow, existing: ExistingProduct[] = []) => plan([row], existing).rows[0].errors;
  const valid = { [H.name]: 'Item', [H.category]: 'Kiloan', [H.sellPrice]: 5000 };

  it('reports missing required values for new items', () => {
    expect(errorsFor({ [H.name]: 'Item' })).toEqual(['Kategori: wajib diisi', 'Tarif: wajib diisi']);
    expect(errorsFor({ [H.category]: 'Kiloan', [H.sellPrice]: 5000 })).toContain('SKU atau Nama wajib diisi');
    expect(errorsFor({ ...valid, [H.sellPrice]: 0 })).toEqual(['Tarif: harus lebih dari 0']);
  });

  it('names the column and explains a bad value', () => {
    expect(errorsFor({ ...valid, [H.sellPrice]: 'murah' })).toEqual(['Tarif: harus berupa angka (mis. 15000)']);
    expect(errorsFor({ ...valid, [H.unit]: 'kilo' })).toEqual([
      expect.stringMatching(/^Satuan Tarif: "kilo" tidak dikenal\. Pilihan: Kg, Pcs/),
    ]);
    expect(errorsFor({ ...valid, [H.stock]: '2,5' })).toEqual(['Stok: harus bilangan bulat']);
    expect(errorsFor({ ...valid, [H.isActive]: 'mungkin' })).toEqual(['Aktif: isi dengan "Ya" atau "Tidak"']);
    expect(errorsFor({ ...valid, [H['attr:speed']]: 'turbo' })).toEqual([
      'Kecepatan Layanan: "turbo" tidak dikenal. Pilihan: Reguler (2–3 hari), Express (1 hari), Kilat (beberapa jam)',
    ]);
    expect(errorsFor({ ...valid, [H['attr:turnaroundHours']]: '99999' })).toEqual([
      'Estimasi Selesai (jam): maksimal 720',
    ]);
  });

  it('reports every problem of a row at once', () => {
    expect(errorsFor({ [H.name]: 'Item', [H.sellPrice]: 'x', [H.unit]: 'kilo' })).toHaveLength(3);
  });

  it('rejects the second row with the same SKU, including SKUs derived from identical names', () => {
    const result = plan([{ ...valid, [H.sku]: 'AA' }, { ...valid, [H.sku]: 'aa' }, { ...valid }, { ...valid }]);
    expect(result.rows.map(row => row.action)).toEqual(['create', 'error', 'create', 'error']);
    expect(result.rows[1].errors).toEqual(['SKU "AA" sudah muncul di baris 2. Beri SKU yang berbeda.']);
    expect(result.rows[3].errors[0]).toContain('sudah muncul di baris 4');
  });

  it('refuses a barcode used by another item or twice in the file', () => {
    const other: ExistingProduct = {
      ...existingRegular,
      id: 'p-2',
      sku: 'OTHER',
      name: 'Item Lain',
      barcode: '8990001',
    };
    expect(errorsFor({ ...valid, [H.barcode]: '8990001' }, [other])).toEqual([
      'Barcode: "8990001" sudah dipakai oleh Item Lain',
    ]);
    const result = plan([
      { ...valid, [H.sku]: 'A1', [H.barcode]: '555' },
      { ...valid, [H.sku]: 'A2', [H.barcode]: '555' },
    ]);
    expect(result.rows[1].errors).toEqual(['Barcode: "555" sudah muncul di baris 2']);
    // an item may keep its own barcode when it is re-imported
    expect(plan([{ [H.sku]: 'OTHER', [H.barcode]: '8990001' }], [other]).rows[0].action).toBe('unchanged');
  });

  it('refuses decimal quantities together with stock tracking', () => {
    expect(errorsFor({ ...valid, [H.trackStock]: 'Ya', [H.allowDecimalQty]: 'Ya' })).toEqual([
      'Boleh Desimal: hanya untuk item dengan Lacak Stok = Tidak',
    ]);
    // ...but quietly turns decimals off when tracking is simply switched on
    const turnedOn = plan([{ ...valid, [H.trackStock]: 'Ya' }]).rows[0];
    expect(turnedOn.write).toMatchObject({ trackStock: true, allowDecimalQty: false });
  });

  it('is fatal when no column is recognised, or nothing identifies a row', () => {
    const none = planImport({
      kind: laundry,
      columns: laundryColumns,
      headers: ['A', 'B'],
      rows: [{ A: 1 }],
      existing: [],
      categories,
    });
    expect(none.fatal?.code).toBe('NO_RECOGNISED_COLUMNS');
    const noId = planImport({
      kind: laundry,
      columns: laundryColumns,
      headers: [H.sellPrice],
      rows: [{ [H.sellPrice]: 5 }],
      existing: [],
      categories,
    });
    expect(noId.fatal?.code).toBe('NO_IDENTIFIER_COLUMN');
  });
});

describe('planImport — updating existing items by SKU', () => {
  it('updates only what the file provides and only what differs', () => {
    const result = plan(
      [{ [H.sku]: 'ckr', [H.sellPrice]: 8000, [H.buyPrice]: 3000, [H.name]: 'Cuci Kiloan Reguler' }],
      [existingRegular],
    );
    const row = result.rows[0];
    expect(row).toMatchObject({ action: 'update', sku: 'CKR', existingId: 'p-1', changes: ['Tarif'] });
    expect(row.write).toEqual({ sku: 'CKR', sellPrice: 8000 });
  });

  it('matches the SKU case-insensitively and works with only SKU + price columns', () => {
    const result = plan([{ [H.sku]: 'Ckr', [H.sellPrice]: 9000 }], [existingRegular]);
    expect(result.rows[0].action).toBe('update');
    expect(result.summary).toMatchObject({ update: 1, create: 0 });
  });

  it('finds the item again by name when the SKU cell is blank (SKUs are derived from names)', () => {
    const generated = { ...existingRegular, sku: 'CUCI-KILOAN-REGULER' };
    const result = plan([{ [H.name]: 'Cuci Kiloan Reguler', [H.sellPrice]: 7500 }], [generated]);
    expect(result.rows[0]).toMatchObject({ action: 'update', existingId: 'p-1', changes: ['Tarif'] });
  });

  it('reports "unchanged" when the file matches what is stored', () => {
    const result = plan(
      [
        {
          [H.sku]: 'CKR',
          [H.sellPrice]: 7000,
          [H.unit]: 'Kg',
          [H['attr:speed']]: 'Reguler (2–3 hari)',
          [H['attr:turnaroundHours']]: 72,
        },
      ],
      [existingRegular],
    );
    expect(result.rows[0]).toMatchObject({ action: 'unchanged', changes: [] });
    expect(result.rows[0].write).toBeUndefined();
  });

  it('merges sector fields into the existing ones and drops stale keys from removed kinds', () => {
    const stale = {
      ...existingRegular,
      attributes: { speed: 'regular', turnaroundHours: 72, productionType: 'ready_stock' },
    };
    const result = plan([{ [H.sku]: 'CKR', [H['attr:turnaroundHours']]: 48 }], [stale]);
    expect(result.rows[0].write?.attributes).toEqual({ speed: 'regular', turnaroundHours: 48 });
    expect(result.rows[0].changes).toEqual(['Estimasi Selesai (jam)']);
  });

  it('ignores the order of keys in stored attributes (Postgres reorders them)', () => {
    const reordered = { ...existingRegular, attributes: { turnaroundHours: 72, speed: 'regular' } };
    const result = plan(
      [{ [H.sku]: 'CKR', [H['attr:speed']]: 'Reguler (2–3 hari)', [H['attr:turnaroundHours']]: 72 }],
      [reordered],
    );
    expect(result.rows[0].action).toBe('unchanged');
  });

  it('does not rewrite an item just to clean leftovers from a kind it no longer uses', () => {
    const stale = {
      ...existingRegular,
      attributes: { speed: 'regular', turnaroundHours: 72, productionType: 'ready_stock' },
    };
    const result = plan([{ [H.sku]: 'CKR', [H.sellPrice]: 7000, [H['attr:speed']]: 'Reguler (2–3 hari)' }], [stale]);
    expect(result.rows[0]).toMatchObject({ action: 'unchanged', changes: [] });
  });

  it('moves an item to another category and flags it as a change (and creates the category)', () => {
    const result = plan([{ [H.sku]: 'CKR', [H.category]: 'Premium' }], [existingRegular]);
    expect(result.rows[0]).toMatchObject({ action: 'update', changes: ['Kategori'] });
    expect(result.newCategories).toEqual(['Premium']);
  });

  it('turning tracking on for a decimal item switches decimals off', () => {
    const result = plan([{ [H.sku]: 'CKR', [H.trackStock]: 'Ya' }], [existingRegular]);
    expect(result.rows[0].write).toMatchObject({ trackStock: true, allowDecimalQty: false });
  });

  it('validates an update too (bad price, unknown unit) and leaves the item alone', () => {
    const result = plan(
      [
        { [H.sku]: 'CKR', [H.sellPrice]: 'gratis' },
        { [H.sku]: 'CKR2', [H.name]: 'x' },
      ],
      [existingRegular],
    );
    expect(result.rows[0].action).toBe('error');
    expect(result.rows[1].action).toBe('error'); // new item without category and price
  });
});

// ─── round trips ─────────────────────────────────────────────────────────────

const toExisting = (write: ProductWrite, index: number): ExistingProduct => ({
  id: `p-${index}`,
  sku: write.sku,
  name: write.name ?? '',
  categoryId: `cat:${write.categoryName}`,
  unit: write.unit ?? 'pcs',
  sellPrice: write.sellPrice ?? 0,
  buyPrice: write.buyPrice ?? 0,
  stock: write.stock ?? 0,
  minStock: write.minStock ?? 5,
  barcode: write.barcode ?? null,
  isActive: write.isActive ?? true,
  trackStock: write.trackStock ?? true,
  allowDecimalQty: write.allowDecimalQty ?? false,
  attributes: write.attributes ?? {},
});

describe.each(ALL_KINDS)('round trip for %s', (_name, _sector, config) => {
  const columns = buildImportColumns(config);
  const priceHeader = columns.find(column => column.key === 'sellPrice')!.header;
  const examples = templateExampleRows(config, columns, 100);

  it('every starter example imports cleanly once a price is filled in', () => {
    if (examples.length === 0) return;
    const rows = examples.map((row, index) => ({ ...row, [priceHeader]: 1000 + index }));
    const result = planImport({
      kind: config,
      columns,
      headers: columns.map(column => column.header),
      rows,
      existing: [],
      categories: [],
    });
    expect(
      result.rows.map(row => row.errors),
      JSON.stringify(result.rows.filter(row => row.errors.length)),
    ).toEqual(rows.map(() => []));
    expect(result.summary.create).toBe(rows.length);
    config.templates.forEach((template, index) => {
      const write = result.rows[index].write!;
      expect(write.name).toBe(template.name);
      expect(write.unit).toBe(template.unit);
      expect(write.trackStock).toBe(template.trackStock);
      expect(write.attributes).toEqual(template.attributes ?? {});
    });
  });

  it('an untouched example (no price) is rejected, so it cannot be imported by accident', () => {
    if (examples.length === 0) return;
    const result = planImport({
      kind: config,
      columns,
      headers: columns.map(column => column.header),
      rows: examples,
      existing: [],
      categories: [],
    });
    expect(result.summary).toMatchObject({ create: 0, error: examples.length });
    for (const row of result.rows) expect(row.errors.join(' ')).toContain('wajib diisi');
  });

  it('export → import again changes nothing', () => {
    if (config.templates.length === 0) return;
    const rows = examples.map((row, index) => ({ ...row, [priceHeader]: 2500 + index }));
    const created = planImport({
      kind: config,
      columns,
      headers: columns.map(column => column.header),
      rows,
      existing: [],
      categories: [],
    });
    const existing = created.rows.map((row, index) => toExisting(row.write!, index));
    const categoryList = existing.map(product => ({
      id: product.categoryId,
      name: product.categoryId.replace('cat:', ''),
    }));
    const exported = existing.map(product =>
      productToRow(columns, { ...product, categoryName: product.categoryId.replace('cat:', '') }),
    );
    const again = planImport({
      kind: config,
      columns,
      headers: columns.map(column => column.header),
      rows: exported,
      existing,
      categories: categoryList,
    });
    expect(
      again.rows.map(row => [row.action, row.errors.join('; ')]),
      JSON.stringify(again.rows.filter(row => row.action !== 'unchanged')),
    ).toEqual(existing.map(() => ['unchanged', '']));
  });
});
