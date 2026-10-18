// The columns of the import template / export file, generated from the store's kind of business.
// A laundry's file gets laundry columns, a café's gets café columns, with no per-kind code here.

import type { FieldDef, FieldOption, SubtypeConfig } from '../../sectors/sector.types';
import { normalise } from './import.values';

export type ColumnType = 'text' | 'integer' | 'money' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date';

export type BaseColumnKey =
  | 'name'
  | 'sku'
  | 'category'
  | 'sellPrice'
  | 'buyPrice'
  | 'unit'
  | 'trackStock'
  | 'stock'
  | 'minStock'
  | 'barcode'
  | 'allowDecimalQty'
  | 'isActive';

export interface ImportColumn {
  /** Stable id: a base key, or `attr:<fieldKey>` for a sector field stored in `Product.attributes`. */
  key: string;
  /** Header text shown in the file. A trailing " *" marks a column that is required for NEW items. */
  header: string;
  type: ColumnType;
  required: boolean;
  options?: FieldOption[];
  /** One sentence for the "Petunjuk" sheet. */
  help: string;
  /** Extra header spellings accepted on import (other kinds' wording, common abbreviations). */
  aliases: string[];
  /** The sector field this column fills, for `attr:` columns. */
  field?: FieldDef;
}

const FIELD_TYPE: Record<FieldDef['type'], ColumnType> = {
  text: 'text',
  textarea: 'text',
  number: 'number',
  select: 'select',
  multiselect: 'multiselect',
  boolean: 'boolean',
  date: 'date',
};

export const attrKey = (fieldKey: string): string => `attr:${fieldKey}`;

export function buildImportColumns(kind: SubtypeConfig): ImportColumn[] {
  const v = kind.vocabulary;
  const item = v.itemLower;

  const base: ImportColumn[] = [
    {
      key: 'name',
      header: `${v.nameLabel} *`,
      type: 'text',
      required: true,
      help: `Nama ${item}. Wajib untuk ${item} baru.`,
      aliases: ['nama', 'nama produk', 'nama menu', 'nama layanan', 'nama item', 'product name', 'name'],
    },
    {
      key: 'sku',
      header: 'SKU',
      type: 'text',
      required: false,
      help: `Kode unik di usaha ini. Kosongkan agar dibuat otomatis dari nama. Jika SKU sudah ada, ${item} tersebut DIPERBARUI.`,
      aliases: ['kode', 'kode produk', 'sku kode', 'kode item'],
    },
    {
      key: 'category',
      header: 'Kategori *',
      type: 'text',
      required: true,
      help: 'Nama kategori. Kategori yang belum ada dibuat otomatis.',
      aliases: ['category', 'kategori produk', 'kategori menu', 'kategori layanan'],
    },
    {
      key: 'sellPrice',
      header: `${v.priceLabel} *`,
      type: 'money',
      required: true,
      help: 'Angka saja, tanpa titik atau "Rp" (mis. 15000). Harus lebih dari 0.',
      aliases: ['harga jual', 'tarif', 'harga', 'price', 'harga satuan'],
    },
    {
      key: 'buyPrice',
      header: v.costLabel,
      type: 'money',
      required: false,
      help: `${v.costHint} Kosongkan jika belum tahu (laba akan terlihat terlalu besar).`,
      aliases: ['harga beli', 'hpp', 'modal', 'modal biaya', 'harga pokok', 'cost'],
    },
    {
      key: 'unit',
      header: v.unitLabel,
      type: 'select',
      required: false,
      options: kind.units.map(unit => ({ value: unit.value, label: unit.label })),
      help: `Satuan harga. Pilihan: ${kind.units.map(unit => unit.label).join(', ')}. Kosong = ${kind.units.find(unit => unit.value === kind.defaultUnit)?.label ?? kind.defaultUnit}.`,
      aliases: ['satuan harga', 'satuan tarif', 'unit', 'satuan porsi'],
    },
    {
      key: 'trackStock',
      header: 'Lacak Stok',
      type: 'boolean',
      required: false,
      help: 'Ya = stok berkurang setiap terjual. Tidak = jasa atau stok tanpa batas. Kosong = mengikuti jenis usaha.',
      aliases: ['lacak', 'pakai stok', 'track stock'],
    },
    {
      key: 'stock',
      header: 'Stok',
      type: 'integer',
      required: false,
      help: 'Jumlah stok saat ini (bilangan bulat). Hanya berarti jika Lacak Stok = Ya.',
      aliases: ['stok saat ini', 'stock', 'qty'],
    },
    {
      key: 'minStock',
      header: 'Batas Menipis',
      type: 'integer',
      required: false,
      help: 'Stok di bawah angka ini ditandai menipis. Kosong = 5.',
      aliases: ['stok minimum', 'min stok', 'minimum stok', 'min stock'],
    },
    {
      key: 'barcode',
      header: 'Barcode',
      type: 'text',
      required: false,
      help: "Kode barcode, harus unik di usaha ini. Jika diawali angka 0, ketik dengan tanda petik di depan ('0123) agar 0 tidak hilang.",
      aliases: ['kode barcode', 'ean', 'upc'],
    },
    {
      key: 'allowDecimalQty',
      header: 'Boleh Desimal',
      type: 'boolean',
      required: false,
      help: 'Ya = jumlah boleh pecahan, mis. 2,5 kg. Hanya untuk item dengan Lacak Stok = Tidak. Kosong = otomatis untuk satuan kg, m², jam.',
      aliases: ['desimal', 'jumlah desimal', 'boleh jumlah desimal'],
    },
    {
      key: 'isActive',
      header: 'Aktif',
      type: 'boolean',
      required: false,
      help: `Ya = tampil di kasir. Tidak = disembunyikan. Kosong = Ya untuk ${item} baru.`,
      aliases: ['status', 'aktif tidak', 'tampil di kasir'],
    },
  ];

  const attributes: ImportColumn[] = kind.fields.map(field => ({
    key: attrKey(field.key),
    header: `${field.label}${field.unit ? ` (${field.unit})` : ''}${field.required ? ' *' : ''}`,
    type: FIELD_TYPE[field.type],
    required: !!field.required,
    options: field.options,
    help: describeField(field),
    aliases: [field.label],
    field,
  }));

  return [...base, ...attributes];
}

function describeField(field: FieldDef): string {
  const parts: string[] = [];
  if (field.type === 'select') parts.push(`Pilihan: ${(field.options ?? []).map(option => option.label).join(', ')}.`);
  if (field.type === 'multiselect')
    parts.push(
      `Boleh lebih dari satu, pisahkan dengan koma. Pilihan: ${(field.options ?? []).map(option => option.label).join(', ')}.`,
    );
  if (field.type === 'boolean') parts.push('Isi "Ya" atau "Tidak".');
  if (field.type === 'date') parts.push('Format tanggal 2027-12-31 atau 31/12/2027.');
  if (field.type === 'number')
    parts.push(
      `Angka${field.unit ? ` dalam ${field.unit}` : ''}${field.min !== undefined ? `, minimal ${field.min}` : ''}${field.max !== undefined ? `, maksimal ${field.max}` : ''}.`,
    );
  if (field.showWhen) parts.push('Hanya diisi untuk jenis tertentu; abaikan jika tidak relevan.');
  if (field.help) parts.push(field.help);
  if (field.required) parts.push('Wajib.');
  return parts.join(' ') || 'Opsional.';
}

/** Header text normalised for matching: "Modal / Biaya (HPP) *" → "modal biaya". Parentheses and "*" are ignored. */
export const normaliseHeader = (header: string): string => normalise(header.replace(/\(.*?\)/g, ' '));

export interface HeaderMatch {
  /** file header → matched column */
  matched: Map<string, ImportColumn>;
  /** file headers that matched nothing (reported as ignored, never fatal) */
  ignored: string[];
}

export function matchHeaders(columns: ImportColumn[], headers: string[]): HeaderMatch {
  const lookup = new Map<string, ImportColumn>();
  // Exact headers win over aliases, so register aliases first and let exact headers overwrite them
  for (const column of columns) for (const alias of column.aliases) lookup.set(normaliseHeader(alias), column);
  for (const column of columns) lookup.set(normaliseHeader(column.header), column);

  const matched = new Map<string, ImportColumn>();
  const used = new Set<string>();
  const ignored: string[] = [];
  for (const header of headers) {
    const column = lookup.get(normaliseHeader(header));
    if (column && !used.has(column.key)) {
      matched.set(header, column);
      used.add(column.key);
    } else if (header.trim()) {
      ignored.push(header);
    }
  }
  return { matched, ignored };
}
