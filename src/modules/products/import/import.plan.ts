// Decides what an import file would do, row by row, WITHOUT touching the database.
// The caller loads what already exists in the store, this function returns the plan, and the service applies it
// (or just shows it as a preview). Keeping it pure means every rule below is covered by fast unit tests.

import { resolveTrackStockDefault, validateAttributes } from '../../sectors/sector.validation';
import type { FieldDef, SubtypeConfig } from '../../sectors/sector.types';
import { matchHeaders, type ImportColumn } from './import.columns';
import {
  isBlankCell,
  parseBoolean,
  parseDate,
  parseInteger,
  parseMultiselect,
  parseNumber,
  parseSelect,
  parseText,
  slugSku,
  type Parsed,
} from './import.values';

export const MAX_IMPORT_ROWS = 500;

export interface ExistingProduct {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  unit: string;
  sellPrice: number;
  buyPrice: number;
  stock: number;
  minStock: number;
  barcode: string | null;
  isActive: boolean;
  trackStock: boolean;
  allowDecimalQty: boolean;
  attributes: Record<string, unknown>;
}

/** What to write for a row. For a new item every field is filled in; for an update only what the file provided. */
export interface ProductWrite {
  sku: string;
  name?: string;
  categoryName?: string;
  sellPrice?: number;
  buyPrice?: number;
  unit?: string;
  trackStock?: boolean;
  allowDecimalQty?: boolean;
  stock?: number;
  minStock?: number;
  barcode?: string | null;
  isActive?: boolean;
  /** The complete new attributes object (existing values merged with the file's). */
  attributes?: Record<string, unknown>;
}

export type RowAction = 'create' | 'update' | 'unchanged' | 'error';

export interface PlannedRow {
  /** The row number as the user sees it in Excel (the header is row 1). */
  rowNumber: number;
  action: RowAction;
  sku: string;
  name: string;
  /** For updates: the columns whose value actually changes. */
  changes: string[];
  errors: string[];
  existingId?: string;
  write?: ProductWrite;
}

export interface ImportPlan {
  rows: PlannedRow[];
  /** Categories named in valid rows that do not exist yet (they will be created). */
  newCategories: string[];
  /** Headers in the file that matched no column. They are ignored, never an error. */
  ignoredHeaders: string[];
  summary: { total: number; create: number; update: number; unchanged: number; error: number };
  /** The file as a whole cannot be used (no recognisable columns). */
  fatal?: { code: string; message: string };
}

export interface PlanInput {
  kind: SubtypeConfig;
  columns: ImportColumn[];
  headers: string[];
  rows: Record<string, unknown>[];
  existing: ExistingProduct[];
  categories: { id: string; name: string }[];
}

const labelOf = (column: ImportColumn): string => column.header.replace(/\s*\*$/, '');

function parseAttribute(field: FieldDef, raw: unknown): Parsed<unknown> {
  switch (field.type) {
    case 'text':
      return parseText(raw, field.maxLength ?? 200);
    case 'textarea':
      return parseText(raw, field.maxLength ?? 1000);
    case 'number':
      return parseNumber(raw);
    case 'boolean':
      return parseBoolean(raw);
    case 'date':
      return parseDate(raw);
    case 'select':
      return parseSelect(raw, field.options ?? []);
    case 'multiselect':
      return parseMultiselect(raw, field.options ?? []);
  }
}

/** JSON text with object keys sorted, so `{a,b}` equals `{b,a}` (Postgres stores jsonb in its own key order). */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

const sameJson = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

export function planImport(input: PlanInput): ImportPlan {
  const { kind, columns, headers, rows, existing, categories } = input;
  const empty = { total: 0, create: 0, update: 0, unchanged: 0, error: 0 };

  const { matched, ignored } = matchHeaders(columns, headers);
  const headerOf = new Map<string, string>(); // column key → header text in the file
  for (const [header, column] of matched) headerOf.set(column.key, header);
  const columnOf = new Map(columns.map(column => [column.key, column]));

  if (matched.size === 0) {
    return {
      rows: [],
      newCategories: [],
      ignoredHeaders: ignored,
      summary: empty,
      fatal: {
        code: 'NO_RECOGNISED_COLUMNS',
        message: 'Tidak ada kolom yang dikenali. Gunakan template dari aplikasi.',
      },
    };
  }
  if (!headerOf.has('sku') && !headerOf.has('name')) {
    return {
      rows: [],
      newCategories: [],
      ignoredHeaders: ignored,
      summary: empty,
      fatal: { code: 'NO_IDENTIFIER_COLUMN', message: 'Kolom SKU atau Nama wajib ada agar baris bisa dikenali.' },
    };
  }

  const existingBySku = new Map(existing.map(product => [product.sku.toUpperCase(), product]));
  const existingByBarcode = new Map(
    existing.filter(p => p.barcode).map(product => [product.barcode as string, product]),
  );
  const categoryByName = new Map(categories.map(category => [category.name.trim().toLowerCase(), category]));
  const categoryNameById = new Map(categories.map(category => [category.id, category.name]));
  const unitOptions = columnOf.get('unit')?.options ?? [];
  const unitIsDecimal = (unit: string) => kind.units.find(option => option.value === unit)?.decimal === true;
  const knownAttributeKeys = new Set(kind.fields.map(field => field.key));

  const newCategories = new Map<string, string>(); // lower-case → name as typed
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const planned: PlannedRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const cellOf = (key: string): unknown => {
      const header = headerOf.get(key);
      return header === undefined ? undefined : row[header];
    };
    const isProvided = (key: string): boolean => headerOf.has(key) && !isBlankCell(cellOf(key));

    // Fully empty rows (a stray formatted row at the bottom of the sheet) are ignored, not reported
    if (![...headerOf.values()].some(header => !isBlankCell(row[header]))) return;

    const errors: string[] = [];
    const read = <T>(key: string, parse: (raw: unknown) => Parsed<T>): T | undefined => {
      if (!isProvided(key)) return undefined;
      const parsed = parse(cellOf(key));
      if (parsed.ok) return parsed.value;
      errors.push(`${labelOf(columnOf.get(key)!)}: ${parsed.error}`);
      return undefined;
    };
    const label = (key: string): string => labelOf(columnOf.get(key)!);

    const name = read('name', raw => parseText(raw, 100));
    const skuInFile = read('sku', raw => parseText(raw, 60))?.toUpperCase();
    const sku = skuInFile || (name ? slugSku(name) : undefined);
    const category = read('category', raw => parseText(raw, 60));
    const sellPrice = read('sellPrice', parseNumber);
    const buyPrice = read('buyPrice', parseNumber);
    const unit = read('unit', raw => parseSelect(raw, unitOptions));
    const trackStock = read('trackStock', parseBoolean);
    const stock = read('stock', parseInteger);
    const minStock = read('minStock', parseInteger);
    const barcode = read('barcode', raw => parseText(raw, 50));
    const allowDecimalQty = read('allowDecimalQty', parseBoolean);
    const isActive = read('isActive', parseBoolean);

    const providedAttributes: Record<string, unknown> = {};
    for (const column of columns) {
      if (!column.field || !isProvided(column.key)) continue;
      const parsed = parseAttribute(column.field, cellOf(column.key));
      if (parsed.ok) providedAttributes[column.field.key] = parsed.value;
      else errors.push(`${labelOf(column)}: ${parsed.error}`);
    }

    if (!sku) {
      errors.push('SKU atau Nama wajib diisi');
      planned.push({ rowNumber, action: 'error', sku: '', name: name ?? '', changes: [], errors });
      return;
    }

    // The same SKU twice in one file would make the second row overwrite the first
    const firstSeen = seenSku.get(sku);
    if (firstSeen !== undefined) {
      errors.push(`SKU "${sku}" sudah muncul di baris ${firstSeen}. Beri SKU yang berbeda.`);
    } else {
      seenSku.set(sku, rowNumber);
    }

    const current = existingBySku.get(sku);
    const isUpdate = current !== undefined;

    if (!isUpdate) {
      if (!name) errors.push(`${label('name')}: wajib diisi`);
      if (!category) errors.push(`${label('category')}: wajib diisi`);
      if (sellPrice === undefined && !errors.some(message => message.startsWith(label('sellPrice')))) {
        errors.push(`${label('sellPrice')}: wajib diisi`);
      }
    }
    if (sellPrice !== undefined && sellPrice <= 0) errors.push(`${label('sellPrice')}: harus lebih dari 0`);

    // Sector fields: merge into what the item already has (minus keys this kind no longer knows), then validate
    const keptAttributes = Object.fromEntries(
      Object.entries(current?.attributes ?? {}).filter(([key]) => knownAttributeKeys.has(key)),
    );
    const mergedAttributes = { ...keptAttributes, ...providedAttributes };
    let attributes: Record<string, unknown> | undefined;
    if (!isUpdate || Object.keys(providedAttributes).length > 0) {
      const checked = validateAttributes(kind, mergedAttributes);
      if (checked.ok) {
        attributes = checked.value;
      } else {
        for (const [fieldKey, message] of Object.entries(checked.errors)) {
          const column = columns.find(candidate => candidate.field?.key === fieldKey);
          errors.push(`${column ? labelOf(column) : fieldKey}: ${message}`);
        }
      }
    }

    // Stock tracking and decimals follow the same rules as the product form
    const finalTrackStock =
      trackStock ?? (isUpdate ? current.trackStock : resolveTrackStockDefault(kind, attributes ?? mergedAttributes));
    const finalUnit = unit ?? (isUpdate ? current.unit : kind.defaultUnit);
    let finalDecimal =
      allowDecimalQty ?? (isUpdate ? current.allowDecimalQty : !finalTrackStock && unitIsDecimal(finalUnit));
    if (finalTrackStock && finalDecimal) {
      if (allowDecimalQty === true)
        errors.push(`${label('allowDecimalQty')}: hanya untuk item dengan Lacak Stok = Tidak`);
      else finalDecimal = false;
    }

    // Barcodes are unique per store, both against existing items and within the file
    if (barcode) {
      const owner = existingByBarcode.get(barcode);
      if (owner && owner.sku.toUpperCase() !== sku)
        errors.push(`${label('barcode')}: "${barcode}" sudah dipakai oleh ${owner.name}`);
      const firstBarcodeRow = seenBarcode.get(barcode);
      if (firstBarcodeRow !== undefined)
        errors.push(`${label('barcode')}: "${barcode}" sudah muncul di baris ${firstBarcodeRow}`);
      else seenBarcode.set(barcode, rowNumber);
    }

    const displayName = name ?? current?.name ?? '';
    if (errors.length > 0) {
      planned.push({
        rowNumber,
        action: 'error',
        sku,
        name: displayName,
        changes: [],
        errors,
        existingId: current?.id,
      });
      return;
    }

    const categoryKey = category?.trim().toLowerCase();
    if (category && categoryKey && !categoryByName.has(categoryKey) && !newCategories.has(categoryKey)) {
      newCategories.set(categoryKey, category.trim()); // the first spelling in the file wins
    }

    if (!isUpdate) {
      planned.push({
        rowNumber,
        action: 'create',
        sku,
        name: displayName,
        changes: [],
        errors: [],
        write: {
          sku,
          name,
          categoryName: category,
          sellPrice,
          buyPrice: buyPrice ?? 0,
          unit: finalUnit,
          trackStock: finalTrackStock,
          allowDecimalQty: finalDecimal,
          stock: stock ?? 0,
          minStock: minStock ?? 5,
          barcode: barcode ?? null,
          isActive: isActive ?? true,
          attributes: attributes ?? {},
        },
      });
      return;
    }

    // Update: only what the file provided, and only what really differs from the stored value
    const write: ProductWrite = { sku };
    const changes: string[] = [];
    const change = <K extends keyof ProductWrite>(
      key: K,
      value: ProductWrite[K],
      stored: unknown,
      columnKey: string,
    ) => {
      if (value === undefined || sameJson(value, stored)) return;
      write[key] = value;
      changes.push(label(columnKey));
    };
    change('name', name, current.name, 'name');
    if (
      category !== undefined &&
      category.trim().toLowerCase() !== (categoryNameById.get(current.categoryId) ?? '').trim().toLowerCase()
    ) {
      write.categoryName = category;
      changes.push(label('category'));
    }
    change('sellPrice', sellPrice, current.sellPrice, 'sellPrice');
    change('buyPrice', buyPrice, current.buyPrice, 'buyPrice');
    change('unit', unit, current.unit, 'unit');
    change('stock', stock, current.stock, 'stock');
    change('minStock', minStock, current.minStock, 'minStock');
    change('barcode', barcode, current.barcode, 'barcode');
    change('isActive', isActive, current.isActive, 'isActive');
    change('trackStock', trackStock, current.trackStock, 'trackStock');
    // Decimal can also change implicitly (tracking switched on turns it off)
    if (finalDecimal !== current.allowDecimalQty) {
      write.allowDecimalQty = finalDecimal;
      if (allowDecimalQty !== undefined) changes.push(label('allowDecimalQty'));
    }
    if (attributes) {
      for (const column of columns) {
        if (!column.field || !(column.field.key in providedAttributes)) continue;
        if (!sameJson(attributes[column.field.key], current.attributes[column.field.key]))
          changes.push(labelOf(column));
      }
      // Compare with the KNOWN keys only: leftovers from a kind the store no longer uses are not a reason to write
      if (!sameJson(attributes, keptAttributes)) write.attributes = attributes;
    }

    const hasWrite = Object.keys(write).length > 1;
    planned.push({
      rowNumber,
      action: hasWrite ? 'update' : 'unchanged',
      sku: current.sku,
      name: displayName,
      changes,
      errors: [],
      existingId: current.id,
      write: hasWrite ? { ...write, sku: current.sku } : undefined,
    });
  });

  const count = (action: RowAction) => planned.filter(row => row.action === action).length;
  return {
    rows: planned,
    newCategories: [...newCategories.values()],
    ignoredHeaders: ignored,
    summary: {
      total: planned.length,
      create: count('create'),
      update: count('update'),
      unchanged: count('unchanged'),
      error: count('error'),
    },
  };
}
