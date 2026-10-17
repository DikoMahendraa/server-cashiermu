// Validates and cleans `Product.attributes` against a sector's field definitions.
// Pure functions (no database), so every rule is unit-tested.

import type { FieldDef, SubtypeConfig } from './sector.types';

export type AttributeErrors = Record<string, string>;

export type AttributeResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: AttributeErrors };

const DEFAULT_MAX_LENGTH = { text: 200, textarea: 1000 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBlank = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Checks one visible field. Returns the cleaned value, or an error message in Indonesian. */
function checkField(field: FieldDef, raw: unknown): { value: unknown } | { error: string } {
  switch (field.type) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return { error: 'harus berupa teks' };
      const value = raw.trim();
      const max = field.maxLength ?? DEFAULT_MAX_LENGTH[field.type];
      if (value.length > max) return { error: `maksimal ${max} karakter` };
      return { value };
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: 'harus berupa angka' };
      if (field.min !== undefined && raw < field.min) return { error: `minimal ${field.min}` };
      if (field.max !== undefined && raw > field.max) return { error: `maksimal ${field.max}` };
      return { value: raw };
    }
    case 'boolean':
      return typeof raw === 'boolean' ? { value: raw } : { error: 'harus berupa ya/tidak' };
    case 'date':
      return typeof raw === 'string' && isRealDate(raw)
        ? { value: raw }
        : { error: 'harus berupa tanggal yang valid (YYYY-MM-DD)' };
    case 'select': {
      const allowed = (field.options ?? []).map(option => option.value);
      return typeof raw === 'string' && allowed.includes(raw) ? { value: raw } : { error: 'pilihan tidak valid' };
    }
    case 'multiselect': {
      const allowed = (field.options ?? []).map(option => option.value);
      if (!Array.isArray(raw) || !raw.every(item => typeof item === 'string' && allowed.includes(item))) {
        return { error: 'pilihan tidak valid' };
      }
      if (new Set(raw).size !== raw.length) return { error: 'pilihan tidak boleh duplikat' };
      return { value: raw };
    }
  }
}

/**
 * Validates `input` for a sector:
 * - unknown keys are rejected (typos and stale data never sneak in);
 * - a field hidden by `showWhen` is dropped, so switching e.g. beauty "service" → "product" leaves no stale duration;
 * - required fields must be present when visible;
 * - blank optional fields are dropped instead of stored as "".
 */
export function validateAttributes(kind: Pick<SubtypeConfig, 'fields'>, input: unknown): AttributeResult {
  if (input === undefined || input === null) input = {};
  if (!isRecord(input)) return { ok: false, errors: { _: 'attributes harus berupa objek' } };

  const errors: AttributeErrors = {};
  const knownKeys = new Set(kind.fields.map(field => field.key));
  for (const key of Object.keys(input)) {
    if (!knownKeys.has(key)) errors[key] = 'isian ini tidak dikenal untuk bidang usaha ini';
  }

  const value: Record<string, unknown> = {};
  for (const field of kind.fields) {
    const visible = !field.showWhen || input[field.showWhen.field] === field.showWhen.equals;
    if (!visible) continue;

    const raw = input[field.key];
    if (isBlank(raw)) {
      if (field.required) errors[field.key] = 'wajib diisi';
      continue;
    }

    const checked = checkField(field, raw);
    if ('error' in checked) errors[field.key] = checked.error;
    else value[field.key] = checked.value;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * Default for `Product.trackStock` when the client did not send one: a select field with `trackStockByValue`
 * (e.g. a workshop "service") wins, otherwise the kind's default.
 */
export function resolveTrackStockDefault(
  kind: Pick<SubtypeConfig, 'fields' | 'trackStockDefault'>,
  attributes: Record<string, unknown>,
): boolean {
  for (const field of kind.fields) {
    const value = attributes[field.key];
    if (field.trackStockByValue && typeof value === 'string' && value in field.trackStockByValue) {
      return field.trackStockByValue[value];
    }
  }
  return kind.trackStockDefault;
}
