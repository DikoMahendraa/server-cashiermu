// Turns products and starter templates into file rows, using the SAME columns as the import.
// Export → edit in Excel → import therefore round-trips, and a unit test proves it.

import type { SubtypeConfig } from '../../sectors/sector.types';
import { attrKey, type ImportColumn } from './import.columns';
import type { ExistingProduct } from './import.plan';

export type Cell = string | number;
export type FileRow = Record<string, Cell>;

/** A stored value as it should appear in a cell: "Ya"/"Tidak", option labels, numbers as numbers. */
export function formatCell(column: ImportColumn, value: unknown): Cell {
  if (value === null || value === undefined) return '';
  switch (column.type) {
    case 'boolean':
      return value === true ? 'Ya' : value === false ? 'Tidak' : '';
    case 'select':
      return column.options?.find(option => option.value === value)?.label ?? String(value);
    case 'multiselect':
      return Array.isArray(value)
        ? value.map(item => column.options?.find(option => option.value === item)?.label ?? String(item)).join(', ')
        : '';
    case 'money':
    case 'integer':
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    default:
      return String(value);
  }
}

export function productToRow(columns: ImportColumn[], product: ExistingProduct & { categoryName: string }): FileRow {
  const base: Record<string, unknown> = {
    name: product.name,
    sku: product.sku,
    category: product.categoryName,
    sellPrice: product.sellPrice,
    buyPrice: product.buyPrice,
    unit: product.unit,
    trackStock: product.trackStock,
    stock: product.stock,
    minStock: product.minStock,
    barcode: product.barcode,
    allowDecimalQty: product.allowDecimalQty,
    isActive: product.isActive,
  };
  const row: FileRow = {};
  for (const column of columns) {
    const value = column.field ? product.attributes[column.field.key] : base[column.key];
    row[column.header] = formatCell(column, value);
  }
  return row;
}

/** Starter examples for the template. The price is left empty on purpose, so an untouched example cannot be imported by accident. */
export function templateExampleRows(kind: SubtypeConfig, columns: ImportColumn[], limit = 3): FileRow[] {
  return kind.templates.slice(0, limit).map(template => {
    const values: Record<string, unknown> = {
      name: template.name,
      category: template.category,
      unit: template.unit,
      trackStock: template.trackStock,
    };
    const row: FileRow = {};
    for (const column of columns) {
      const value = column.key.startsWith('attr:')
        ? template.attributes?.[column.key.slice(attrKey('').length)]
        : values[column.key];
      row[column.header] = formatCell(column, value);
    }
    return row;
  });
}
